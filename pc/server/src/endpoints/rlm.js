// ============================================================================
// rlm.js — родной маршрут RLM: звонок к LLM-провайдеру от лица ноды «API».
//
// Зачем: узловой холст RLM не должен звонить провайдеру напрямую из браузера
// (провайдеры режут кросс-доменные запросы, да и ключ светить нельзя). Сервер
// RLM звонит сам и отдаёт результат. Ключ и адрес приходят из ноды в теле запроса.
//
// Путь — OpenAI-совместимый (POST {base}/chat/completions, GET {base}/models,
// заголовок Authorization: Bearer <key>). Покрывает OpenRouter и большинство
// провайдеров из списка ноды. Anthropic/Gemini с их особым API — отдельными
// адаптерами позже (сейчас вернут понятную ошибку, если base не совместим).
//
// Маршруты (монтируются в server-main.js ДО CSRF/логина, под защитой whitelist):
//   POST /api/rlm/models    { base, key }                       -> { ok, models:[{id}] }
//   POST /api/rlm/generate  { base, key, model, messages, params } -> { ok, text }
// ============================================================================
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const require = createRequire(import.meta.url);

export const router = express.Router();

// base может прийти со слэшем на конце или без — приводим к единому виду.
const trimBase = (base) => String(base || '').trim().replace(/\/+$/, '');

// «Размышления: Выкл» у разных хостеров называются по-разному. Наша нода «Опции» шлёт
// `reasoning: { enabled: false }` — так понимает OpenRouter. ArliAI это поле ИГНОРИРУЕТ:
// живой замер 2026-09-12 на DeepSeek-V4-Flash — с `reasoning:{enabled:false}` мысли заняли
// 675 знаков и съели лимит, ответ пришёл обрезанным. Их движок слушает `reasoning_effort: "none"`
// (и `chat_template_kwargs.enable_thinking: false`). Дописываем синоним по адресу хостера,
// чтобы галочка в ноде работала везде одинаково.
function applyReasoningOff(base, payload) {
    const off = payload && payload.reasoning && payload.reasoning.enabled === false;
    if (!off) return;
    if (/arliai\.com|featherless\.ai/i.test(String(base || ''))) {
        payload.reasoning_effort = 'none';
        payload.chat_template_kwargs = { ...(payload.chat_template_kwargs || {}), enable_thinking: false };
    }
}

// Общий вызов с таймаутом: провайдер не должен вешать сервер навсегда.
// `stop` — сигнал отмены ВСЕГО запроса клиента (крестик / «⏹ Стоп»). Слушатель не снимаем в finally
// намеренно: fetch возвращается на заголовках, а тело (у OpenRouter оно тянется весь ответ) читается
// уже после — отмена обязана рвать и чтение тела.
async function callProvider(url, options, timeoutMs, stop) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    if (stop) { if (stop.aborted) ac.abort(); else stop.addEventListener('abort', () => ac.abort(), { once: true }); }
    try {
        return await fetch(url, { ...options, signal: ac.signal });
    } finally {
        clearTimeout(timer);
    }
}

// ── ОТМЕНА ЗАПРОСА К МОДЕЛИ (крестик ленты / «⏹ Стоп») ────────────────────────────────────────
// Было (замер 2026-09-13 на муляже провайдера, ответ через 25 с, отмена на 5-й секунде): и крестик, и
// «Стоп» только выбрасывали ответ у клиента — провайдер дорабатывал все 25 с и списывал токены. В Electron
// запрос идёт мостом главного процесса без сигнала отмены, в браузере клиент отцеплялся, а сервер ждал
// дальше. Теперь клиент шлёт вместе с запросом номер `rid`, а на отмену — POST /abort { ids }: сервер рвёт
// запрос к провайдеру. На обрыв соединения клиента НЕ реагируем специально: уснувший телефон — не отмена.
const INFLIGHT = new Map();   // rid → AbortController идущего запроса
const ABORTED = new Map();    // rid → время: отмена пришла раньше самого запроса (гонка) — запрос оборвётся на старте
function trackRequest(rid) {
    const ctl = new AbortController();
    const k = rid ? String(rid) : '';
    if (k) {
        if (ABORTED.has(k)) { ABORTED.delete(k); ctl.abort(); }
        INFLIGHT.set(k, ctl);
    }
    return { signal: ctl.signal, done: () => { if (k && INFLIGHT.get(k) === ctl) INFLIGHT.delete(k); } };
}
const STOPPED = { ok: false, aborted: true, error: 'остановлено' };
router.post('/abort', (request, response) => {
    const ids = Array.isArray(request.body?.ids) ? request.body.ids : [];
    const now = Date.now();
    for (const [k, t] of ABORTED) if (now - t > 120000) ABORTED.delete(k);   // старые метки — вон
    let n = 0;
    for (const raw of ids) {
        const k = String(raw || ''); if (!k) continue;
        const ctl = INFLIGHT.get(k);
        if (ctl) { ctl.abort(); INFLIGHT.delete(k); n++; } else ABORTED.set(k, now);
    }
    if (n) console.log(`[rlm] оборвано по отмене клиента: ${n}`);
    response.json({ ok: true, aborted: n });
});

// Вытащить осмысленный текст ошибки из ответа провайдера (JSON или простой текст).
async function readError(resp) {
    const raw = await resp.text().catch(() => '');
    try {
        const j = JSON.parse(raw);
        return j?.error?.message || j?.error || j?.message || raw || resp.statusText;
    } catch {
        return raw || resp.statusText;
    }
}

// Часть эндпоинтов (reasoning-модели у ряда провайдеров) ОТКАЗЫВАЮТСЯ глушить «мысли»: на
// reasoning:{enabled:false} отвечают 400 «Reasoning is mandatory for this endpoint and cannot be
// disabled». RLM просит выключить reasoning почти везде (мысли едят лимит вывода), и раньше такой
// отказ ронял весь вызов — планировщик Режиссёра, критик, память просто писали ошибку провайдера.
// Теперь на этот конкретный отказ повторяем ТОТ ЖЕ запрос без поля reasoning: «мысли» придут, но
// они возвращаются отдельным полем и вызывающий берёт чистый content.
function reasoningForced(msg) {
    const s = String(msg || '');
    return /reason/i.test(s) && /(mandator|cannot be disabled|can't be disabled|cannot disable|must be enabled|always enabled|is required)/i.test(s);
}
// POST к провайдеру + этот автоповтор. Тело ошибки читается ОДИН раз (поток не перемотать),
// поэтому отдаём его наружу вместе с ответом.
async function postWithReasoningFallback(url, key, payload, timeoutMs, stop) {
    const send = (body) => callProvider(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key || ''}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    }, timeoutMs, stop);
    let resp = await send(payload);
    if (resp.ok || payload.reasoning === undefined) return { resp };
    const error = await readError(resp);
    if (!reasoningForced(error)) return { resp, error };
    const retry = { ...payload }; delete retry.reasoning;
    resp = await send(retry);
    return resp.ok ? { resp } : { resp, error: await readError(resp) };
}

// ---- Проверка связи + список моделей провайдера --------------------------------
// Нода: кнопка «Проверить связь». Успех = ключ/URL рабочие + заполняем выпадашку.
router.post('/models', async (request, response) => {
    const { base, key } = request.body || {};
    const b = trimBase(base);
    if (!b) return response.json({ ok: false, error: 'Не задан Base URL' });

    try {
        const resp = await callProvider(`${b}/models`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${key || ''}` },
        }, 20000);

        if (!resp.ok) {
            return response.json({ ok: false, status: resp.status, error: await readError(resp) });
        }

        const data = await resp.json();
        // OpenAI-совместимый ответ: { data: [{ id, ... }] }. Иногда — просто массив.
        const list = Array.isArray(data) ? data : (data?.data || data?.models || []);
        const models = list
            .map((m) => (typeof m === 'string' ? { id: m } : { id: m?.id || m?.name }))
            .filter((m) => m.id);

        return response.json({ ok: true, models });
    } catch (e) {
        const msg = e?.name === 'AbortError' ? 'Таймаут: провайдер не ответил' : String(e?.message || e);
        return response.json({ ok: false, error: msg });
    }
});

// ---- Генерация ответа модели ---------------------------------------------------
// Нода: реальный запрос к модели, возвращаем текст ответа. params — сэмплеры.
router.post('/generate', async (request, response) => {
    const { base, key, model, messages, params } = request.body || {};
    const b = trimBase(base);
    if (!b) return response.json({ ok: false, error: 'Не задан Base URL' });
    if (!model) return response.json({ ok: false, error: 'Не задана модель' });
    if (!Array.isArray(messages) || messages.length === 0) {
        return response.json({ ok: false, error: 'Пустой список сообщений' });
    }

    // Тело в формате OpenAI Chat Completions. Сэмплеры кладём как есть, если заданы.
    const payload = { model, messages, ...(params && typeof params === 'object' ? params : {}) };
    applyReasoningOff(b, payload);
    const track = trackRequest(request.body && request.body.rid);   // отмена по номеру запроса (крестик / «Стоп»)
    const stop = track.signal;

    try {
        let { resp, error } = await postWithReasoningFallback(`${b}/chat/completions`, key, payload, 120000, stop);

        if (!resp.ok) {
            return response.json({ ok: false, status: resp.status, error: error != null ? error : await readError(resp) });
        }

        let data = await resp.json();
        // ── Пустой ответ провайдера → ПОВТОР (до двух раз) ───────────────────────────────────────────
        // Замер на живой модели (z-ai/glm-5 через OpenRouter): один и тот же запрос уходит разным
        // хостерам, и часть из них обрывает генерацию у себя — отвечает 200 OK, но с пустым content и
        // finish_reason "error". Для приложения это выглядело как «модель вернула пустой ответ», и
        // повторять приходилось руками. Повторяем сами: следующий заход обычно попадает на другой хостер.
        // Условие узкое: пусто И content, И «мысли» (иначе повторяли бы reasoning-ответы, где текст в мыслях).
        for (let tries = 0; tries < 2; tries++) {
            const m = data?.choices?.[0]?.message;
            const fin = data?.choices?.[0]?.finish_reason;
            const empty = !String(m?.content || '').trim() && !String(m?.reasoning_content || m?.reasoning || '').trim();
            if (!empty || stop.aborted) break;      // хоть что-то пришло (или отменили) — повтора нет
            console.warn(`[rlm] пустой ответ провайдера (finish=${fin}) — повтор ${tries + 1}/2`);
            const again = await postWithReasoningFallback(`${b}/chat/completions`, key, payload, 120000, stop);
            if (!again.resp.ok) break;              // повтор не удался — отдаём то, что было
            data = await again.resp.json();
        }
        // content — обычное поле; reasoning_content/reasoning — «мысли» reasoning-моделей ОТДЕЛЬНО.
        // ВАЖНО: отдаём content и reasoning раздельно, чтобы вызывающий (напр. приглашение гостя) мог взять
        // ЧИСТЫЙ ответ и НЕ подмешать «мысли». `text` (content||reasoning) оставлен для обратной совместимости:
        // на нём держатся старые вызовы, где content пустой и ответ реально лежит в reasoning_content.
        const msg0 = data?.choices?.[0]?.message;
        const content = msg0?.content || '';
        const reasoning = msg0?.reasoning_content || msg0?.reasoning || '';
        const text = content || reasoning || '';
        if (stop.aborted) return response.json(STOPPED);   // отменили, пока разбирали ответ — не отдаём и не пишем
        // Пишем ответ в лог чата САМИ, не полагаясь на вкладку (она могла уснуть или закрыться).
        // В лог кладём только САМ ответ: мысли (reasoning) репликой не бывают. Раньше писался `text`
        // (= content || reasoning), и при пустом content — лимит съели размышления — в чат ложились мысли модели.
        const replyForLog = String(content || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/<think(?:ing)?>[\s\S]*$/i, '').trim();
        try { if (request.body && request.body._saveTo && request.body._saveTo.key) saveReplyToChatlog(request.body._saveTo.key, replyForLog); } catch (e) { console.error('[rlm] _saveTo:', e); }
        return response.json({
            ok: true,
            text,
            content,
            reasoning,
            finish_reason: data?.choices?.[0]?.finish_reason,
            usage: data?.usage,
        });
    } catch (e) {
        if (stop.aborted) return response.json(STOPPED);   // оборвали по крестику / «Стоп», а не таймаут
        const msg = e?.name === 'AbortError' ? 'Таймаут: провайдер не ответил' : String(e?.message || e);
        return response.json({ ok: false, error: msg });
    } finally {
        track.done();
    }
});

// ---- Генерация в режиме text-completion (нода «Критик», «ядерный режим») --------
// Не chat, а «продолжи документ»: без ролей system/user/assistant. POST {base}/completions.
// Ответ просим ПОТОКОМ и склеиваем сами: Featherless обрывает непотоковый /completions на ~2-й минуте. Замер
// 2026-09-13 на Kimi K2-Thinking: без потока заголовки через 7 с, тело оборвано на 132 с («terminated» /
// IncompleteRead); потоком тот же запрос — 226 с, ответ целиком. Провайдер поток не понял и прислал JSON — разбираем как раньше.
async function readCompletionBody(resp) {
    const type = String(resp.headers.get('content-type') || '');
    if (!type.includes('text/event-stream')) {
        const data = await resp.json();
        return { text: data?.choices?.[0]?.text || '', finish_reason: data?.choices?.[0]?.finish_reason, usage: data?.usage };
    }
    const dec = new TextDecoder();
    let buf = '', text = '', finish, usage, error;
    const eat = (line) => {
        const s = line.trim(); if (!s.startsWith('data:')) return;   // комментарии провайдера («: PROCESSING») пропускаем
        const p = s.slice(5).trim(); if (!p || p === '[DONE]') return;
        try {
            const j = JSON.parse(p); const ch = j?.choices?.[0];
            // «мысли» думающих моделей Featherless шлёт полем reasoning — в текст ответа они не идут
            if (ch) { text += ch.text || ''; if (ch.finish_reason) finish = ch.finish_reason; }
            if (j?.usage) usage = j.usage;
            if (j?.error) error = j.error.message || j.error;           // ошибка посреди потока (занято, лимит) — отдадим наверх
        } catch { /* строка не JSON — пропускаем */ }
    };
    for await (const chunk of resp.body) {
        buf += dec.decode(chunk, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) { eat(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    buf += dec.decode(); if (buf) eat(buf);
    return { text, finish_reason: finish, usage, error };
}
router.post('/complete', async (request, response) => {
    const { base, key, model, prompt, params } = request.body || {};
    const b = trimBase(base);
    if (!b) return response.json({ ok: false, error: 'Не задан Base URL' });
    if (!model) return response.json({ ok: false, error: 'Не задана модель' });
    if (typeof prompt !== 'string' || !prompt) return response.json({ ok: false, error: 'Пустой prompt' });

    const payload = { model, prompt, ...(params && typeof params === 'object' ? params : {}), stream: true };
    const track = trackRequest(request.body && request.body.rid);   // отмена по номеру запроса (крестик / «Стоп»)
    const stop = track.signal;

    try {
        const { resp, error } = await postWithReasoningFallback(`${b}/completions`, key, payload, 120000, stop);

        if (!resp.ok) {
            return response.json({ ok: false, status: resp.status, error: error != null ? error : await readError(resp) });
        }

        let out = await readCompletionBody(resp);
        // Тот же повтор, что и у /generate: провайдер отвечает 200 OK с пустым текстом (обрыв у него).
        for (let tries = 0; tries < 2; tries++) {
            if (String(out.text || '').trim() || stop.aborted) break;
            console.warn(`[rlm] пустой ответ провайдера (completions${out.error ? ': ' + out.error : ''}${out.finish_reason ? ', finish=' + out.finish_reason : ''}) — повтор ${tries + 1}/2`);
            const again = await postWithReasoningFallback(`${b}/completions`, key, payload, 120000, stop);
            if (!again.resp.ok) break;
            out = await readCompletionBody(again.resp);
        }
        if (stop.aborted) return response.json(STOPPED);
        if (!String(out.text || '').trim() && out.error) return response.json({ ok: false, error: String(out.error) });   // пусто и провайдер назвал причину — это ошибка, а не «пустой ответ»
        return response.json({
            ok: true,
            text: out.text || '',
            finish_reason: out.finish_reason,
            usage: out.usage,
        });
    } catch (e) {
        if (stop.aborted) return response.json(STOPPED);   // оборвали по крестику / «Стоп», а не таймаут
        const msg = e?.name === 'AbortError' ? 'Таймаут: провайдер не ответил' : String(e?.message || e);
        return response.json({ ok: false, error: msg });
    } finally {
        track.done();
    }
});

// ── Запись ответа в лог чата НА СЕРВЕРЕ ───────────────────────────────────────────────────────
// Клиент присылает вместе с запросом `_saveTo: { key }` — ключ лога чата. Как только модель ответила,
// сервер сам кладёт реплику в файл: заменяет плейсхолдер «…», если он последний, иначе дописывает.
// Это делает историю независимой от того, дожила ли вкладка до конца генерации.
function chatlogPath(key) {
    const root = globalThis.DATA_ROOT
        || (globalThis.COMMAND_LINE_ARGS && globalThis.COMMAND_LINE_ARGS.dataRoot)
        || './data';
    return path.join(root, 'rlm-store', encodeURIComponent(key) + '.json');
}
function saveReplyToChatlog(key, text) {
    if (!key || typeof key !== 'string' || !/^rlm\.chatlog\./.test(key)) return;
    if (!String(text || '').trim()) return;
    const file = chatlogPath(key);
    let box;
    try { box = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }   // лога ещё нет — клиент создаст сам
    if (!box || !Array.isArray(box.msgs)) return;
    const last = box.msgs[box.msgs.length - 1];
    if (last && last.role === 'char' && String(last.text || '').trim() === '…') last.text = text;   // плейсхолдер → ответ
    else if (last && last.role === 'char' && String(last.text || '') === text) return;             // уже записан — не двоим
    else box.msgs.push({ role: 'char', text });
    try {
        const tmp = file + '.tmp' + process.pid;
        const fd = fs.openSync(tmp, 'w');
        try { fs.writeFileSync(fd, JSON.stringify(box)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
        console.log('[rlm] ответ записан в ' + key + ' (' + box.msgs.length + ' сообщ.) — вкладка могла и не дожить');
    } catch (e) { console.error('[rlm] не записал ответ в ' + key + ':', e); }
}

// ---- Перевод текста (нода «Транслитер» + кнопки перевода в полях/чате) ----------
// Провайдеры БЕЗ ключей — как в ST: google (google-translate-api-browser), yandex (free), bing.
// «Нейро»-перевод идёт НЕ сюда, а через /generate с подключённым к ноде «Транслитер» API.
//   POST /api/rlm/translate { provider, text, to } -> { ok, text }
function ucid32() { let s = ''; for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16); return s; }
// Разрезать текст на куски не длиннее limit, стараясь рвать по естественным границам:
// пустая строка → перевод строки → конец предложения → пробел. Так перевод не теряет смысл на стыках.
function splitForTranslate(text, limit) {
    const out = [];
    const pushChunk = (t) => { if (t) out.push(t); };
    const cut = (str, seps) => {
        if (str.length <= limit) { pushChunk(str); return; }
        const sep = seps[0];
        if (sep === undefined) {                       // границ не осталось — режем жёстко по символам
            for (let i = 0; i < str.length; i += limit) pushChunk(str.slice(i, i + limit));
            return;
        }
        const parts = str.split(sep);
        let buf = '';
        for (const part of parts) {
            const piece = buf ? buf + sep + part : part;
            if (piece.length <= limit) { buf = piece; continue; }
            if (buf) { pushChunk(buf); buf = ''; }
            if (part.length <= limit) buf = part; else cut(part, seps.slice(1));   // кусок сам великоват — дробим мельче
        }
        pushChunk(buf);
    };
    cut(String(text || ''), ['\n\n', '\n', '. ', ' ']);
    return out;
}
// Перевести длинный текст по кускам и склеить. splitter получает кусок и возвращает его перевод.
async function translateInChunks(text, limit, translateOne) {
    const src = String(text || '');
    if (src.length <= limit) return await translateOne(src);
    const chunks = splitForTranslate(src, limit);
    const done = [];
    for (const c of chunks) {
        const t = await translateOne(c);
        if (t == null) throw new Error('переводчик не осилил кусок (' + c.length + ' симв.)');
        done.push(t);
    }
    return done.join('\n\n');
}
router.post('/translate', async (request, response) => {
    const { provider, text, to } = request.body || {};
    const target = String(to || 'ru');
    const src = String(text == null ? '' : text);
    if (!src.trim()) return response.json({ ok: true, text: src });   // пусто — нечего переводить

    try {
        if (provider === 'yandex') {
            // Большое полотно уходит по кускам: у бесплатного эндпоинта потолок около 10 000 символов,
            // берём 9000 с запасом. Куски режутся по абзацам и предложениям, потом склеиваются.
            const one = async (part) => {
                const params = new URLSearchParams();
                params.append('text', part);
                params.append('lang', target);
                const url = `https://translate.yandex.net/api/v1/tr.json/translate?ucid=${ucid32()}&srv=android&format=text`;
                const resp = await callProvider(url, { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 20000);
                if (!resp.ok) throw new Error(await readError(resp));
                const json = await resp.json();
                return (json.text || []).join('');
            };
            const text = await translateInChunks(src, 9000, one);
            return response.json({ ok: true, text });
        }
        if (provider === 'bing') {
            const { translate: bingTranslate } = await import('bing-translate-api');
            const oneB = async (part) => { const res = await bingTranslate(part, null, target); return (res && res.translation) || ''; };
            const text = await translateInChunks(src, 900, oneB);   // у бинга самый низкий потолок
            return response.json({ ok: true, text });
        }
        // google (по умолчанию) — без ключа; у него потолок ещё ниже яндексового, режем по 4500
        const g = require('google-translate-api-browser');
        const oneG = async (part) => {
            const url = g.generateRequestUrl(part, { to: target });
            const resp = await callProvider(url, { method: 'GET' }, 20000);
            if (!resp.ok) throw new Error(resp.statusText);
            const buf = await resp.arrayBuffer();
            const norm = g.normaliseResponse(JSON.parse(Buffer.from(buf).toString('utf-8')));
            return norm.text;
        };
        const gText = await translateInChunks(src, 4500, oneG);
        return response.json({ ok: true, text: gText });
    } catch (e) {
        const msg = e?.name === 'AbortError' ? 'Таймаут: переводчик не ответил' : String(e?.message || e);
        return response.json({ ok: false, error: msg });
    }
});
