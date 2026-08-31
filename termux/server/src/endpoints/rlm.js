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
import express from 'express';

const require = createRequire(import.meta.url);

export const router = express.Router();

// base может прийти со слэшем на конце или без — приводим к единому виду.
const trimBase = (base) => String(base || '').trim().replace(/\/+$/, '');

// Общий вызов с таймаутом: провайдер не должен вешать сервер навсегда.
async function callProvider(url, options, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: ac.signal });
    } finally {
        clearTimeout(timer);
    }
}

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
async function postWithReasoningFallback(url, key, payload, timeoutMs) {
    const send = (body) => callProvider(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key || ''}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    }, timeoutMs);
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

    try {
        const { resp, error } = await postWithReasoningFallback(`${b}/chat/completions`, key, payload, 120000);

        if (!resp.ok) {
            return response.json({ ok: false, status: resp.status, error: error != null ? error : await readError(resp) });
        }

        const data = await resp.json();
        // content — обычное поле; reasoning_content/reasoning — «мысли» reasoning-моделей ОТДЕЛЬНО.
        // ВАЖНО: отдаём content и reasoning раздельно, чтобы вызывающий (напр. приглашение гостя) мог взять
        // ЧИСТЫЙ ответ и НЕ подмешать «мысли». `text` (content||reasoning) оставлен для обратной совместимости:
        // на нём держатся старые вызовы, где content пустой и ответ реально лежит в reasoning_content.
        const msg0 = data?.choices?.[0]?.message;
        const content = msg0?.content || '';
        const reasoning = msg0?.reasoning_content || msg0?.reasoning || '';
        const text = content || reasoning || '';
        return response.json({
            ok: true,
            text,
            content,
            reasoning,
            finish_reason: data?.choices?.[0]?.finish_reason,
            usage: data?.usage,
        });
    } catch (e) {
        const msg = e?.name === 'AbortError' ? 'Таймаут: провайдер не ответил' : String(e?.message || e);
        return response.json({ ok: false, error: msg });
    }
});

// ---- Генерация в режиме text-completion (нода «Критик», «ядерный режим») --------
// Не chat, а «продолжи документ»: без ролей system/user/assistant. POST {base}/completions.
router.post('/complete', async (request, response) => {
    const { base, key, model, prompt, params } = request.body || {};
    const b = trimBase(base);
    if (!b) return response.json({ ok: false, error: 'Не задан Base URL' });
    if (!model) return response.json({ ok: false, error: 'Не задана модель' });
    if (typeof prompt !== 'string' || !prompt) return response.json({ ok: false, error: 'Пустой prompt' });

    const payload = { model, prompt, ...(params && typeof params === 'object' ? params : {}) };

    try {
        const { resp, error } = await postWithReasoningFallback(`${b}/completions`, key, payload, 120000);

        if (!resp.ok) {
            return response.json({ ok: false, status: resp.status, error: error != null ? error : await readError(resp) });
        }

        const data = await resp.json();
        const text = data?.choices?.[0]?.text || '';
        return response.json({
            ok: true,
            text,
            finish_reason: data?.choices?.[0]?.finish_reason,
            usage: data?.usage,
        });
    } catch (e) {
        const msg = e?.name === 'AbortError' ? 'Таймаут: провайдер не ответил' : String(e?.message || e);
        return response.json({ ok: false, error: msg });
    }
});

// ---- Перевод текста (нода «Транслитер» + кнопки перевода в полях/чате) ----------
// Провайдеры БЕЗ ключей — как в ST: google (google-translate-api-browser), yandex (free), bing.
// «Нейро»-перевод идёт НЕ сюда, а через /generate с подключённым к ноде «Транслитер» API.
//   POST /api/rlm/translate { provider, text, to } -> { ok, text }
function ucid32() { let s = ''; for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16); return s; }
router.post('/translate', async (request, response) => {
    const { provider, text, to } = request.body || {};
    const target = String(to || 'ru');
    const src = String(text == null ? '' : text);
    if (!src.trim()) return response.json({ ok: true, text: src });   // пусто — нечего переводить

    try {
        if (provider === 'yandex') {
            const params = new URLSearchParams();
            params.append('text', src);
            params.append('lang', target);
            const url = `https://translate.yandex.net/api/v1/tr.json/translate?ucid=${ucid32()}&srv=android&format=text`;
            const resp = await callProvider(url, { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 20000);
            if (!resp.ok) return response.json({ ok: false, error: await readError(resp) });
            const json = await resp.json();
            return response.json({ ok: true, text: (json.text || []).join('') });
        }
        if (provider === 'bing') {
            const { translate: bingTranslate } = await import('bing-translate-api');
            const res = await bingTranslate(src, null, target);
            return response.json({ ok: true, text: (res && res.translation) || '' });
        }
        // google (по умолчанию) — без ключа
        const g = require('google-translate-api-browser');
        const url = g.generateRequestUrl(src, { to: target });
        const resp = await callProvider(url, { method: 'GET' }, 20000);
        if (!resp.ok) return response.json({ ok: false, error: resp.statusText });
        const buf = await resp.arrayBuffer();
        const norm = g.normaliseResponse(JSON.parse(Buffer.from(buf).toString('utf-8')));
        return response.json({ ok: true, text: norm.text });
    } catch (e) {
        const msg = e?.name === 'AbortError' ? 'Таймаут: переводчик не ответил' : String(e?.message || e);
        return response.json({ ok: false, error: msg });
    }
});
