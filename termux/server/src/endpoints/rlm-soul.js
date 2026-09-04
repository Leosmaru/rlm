// ============================================================================
// rlm-soul.js — родные маршруты RLM для памяти «Душа» (MD + смысловой поиск).
//
// Зачем отдельно от плагина soul-md: плагин монтируется ПОСЛЕ CSRF, а узловой
// холст ходит без CSRF-токена → до плагина он не достучится. Эти маршруты
// монтируются в server-main.js рядом с /api/rlm (ДО CSRF, под whitelist), так
// что холст зовёт их простым POST — тем же путём, что ноду «API».
//
// Эмбеддер — РОДНОЙ ONNX/WASM ST (getTransformersVector). Модель задаётся в
// config.yaml (extensions.models.embedding = Xenova/multilingual-e5-small,
// многоязычная). e5 требует префиксы: запрос → "query: …", документ → "passage: …".
//
// Файлы памяти лежат там же, где у плагина: plugins/soul-md/data/<id_чата>/
//   Diary_<ГГГГ-ММ-ДД>.md — дневник (записи через пустую строку)
//   Status.md / World.md / Psyche.md — трекеры (перезапись на месте)
//   topics/<subject>.md (+ .off) — темы (RAG)
//
// Маршруты:
//   POST /api/rlm/soul/chats                        -> { ok, chats:[{id,docs}] }
//   POST /api/rlm/soul/all    { chat }              -> { ok, docs:[{name,group,text,off}] }
//   POST /api/rlm/soul/diary  { chat, query, k, threshold, cap } -> { ok, memory, entries, mode }
//   POST /api/rlm/soul/topics { chat, query, k }    -> { ok, memory, entries }
// ============================================================================
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { getTransformersVector } from '../vectors/embedding.js';

export const router = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Одна папка данных с плагином soul-md — единственный источник правды.
const ROOT = path.join(__dirname, '..', '..', 'plugins', 'soul-md', 'data');

// e5-префиксы. Модель обучена различать запрос и документ; без префиксов качество
// падает. Для не-e5 моделей префикс безвреден, а дефолт у нас e5. Режем до ~512
// токенов грубо по символам (у e5-small контекст 512 токенов).
const embedQuery = (t) => getTransformersVector('query: ' + String(t || '').slice(0, 1600));
const embedPassage = (t) => getTransformersVector('passage: ' + String(t || '').slice(0, 1600));

// векторы нормализованы (normalize:true) → косинус == скалярное произведение
const dot = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };

// ── КЭШ ВЕКТОРОВ ────────────────────────────────────────────────────────────────
// Раньше каждый поиск по смыслу считал эмбеддинг ЗАНОВО для каждой записи — на каждый ход, для
// всех дневников, тем и записей лорбука. Тексты между ходами почти не меняются, поэтому держим
// вектор рядом с текстом: ключ — хэш текста, так устаревшее просто перестаёт находиться.
// Два уровня: память процесса (быстро) и файл _vectors.json в папке чата (переживает перезапуск).
const VEC_MEM = new Map();                 // hash → вектор
const VEC_MEM_MAX = 6000;                  // потолок: дальше вытесняем самые старые
const VEC_DISK_MAX = 1200;                 // столько векторов держим в файле чата (≈3 МБ потолок)
const vecHash = (t) => crypto.createHash('sha1').update('e5|' + String(t)).digest('hex').slice(0, 16);
const vecFile = (dir) => path.join(dir, '_vectors.json');
const vecMemPut = (h, v) => {
    if (VEC_MEM.size >= VEC_MEM_MAX) { const first = VEC_MEM.keys().next().value; VEC_MEM.delete(first); }
    VEC_MEM.set(h, v);
};
function vecDiskLoad(dir) {
    if (!dir) return null;
    try {
        const p = vecFile(dir);
        if (!fs.existsSync(p)) return {};
        const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return (j && typeof j === 'object') ? j : {};
    } catch (_) { return {}; }   // битый кэш — не беда, пересчитается
}
function vecDiskSave(dir, store) {
    if (!dir || !store) return;
    try {
        let keys = Object.keys(store);
        if (keys.length > VEC_DISK_MAX) {                      // обрезаем хвост: свежие ключи в конце
            const drop = keys.slice(0, keys.length - VEC_DISK_MAX);
            for (const k of drop) delete store[k];
        }
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(vecFile(dir), JSON.stringify(store), 'utf-8');
    } catch (_) { /* кэш — не данные, потеря не страшна */ }
}
// Векторы для списка текстов: берём из кэша, считаем только недостающие, файл пишем один раз.
async function embedMany(dir, texts) {
    const store = vecDiskLoad(dir);
    let свежих = 0;
    const out = [];
    for (const raw of texts) {
        const text = String(raw || '');
        const h = vecHash(text);
        let v = VEC_MEM.get(h);
        if (!v && store && store[h]) { v = store[h]; vecMemPut(h, v); }
        if (!v) {
            v = await embedPassage(text);
            vecMemPut(h, v);
            if (store) { store[h] = Array.from(v).map((x) => +x.toFixed(4)); свежих++; }   // 4 знаков хватает: косинус не дрогнет, файл втрое легче
        }
        out.push(v);
    }
    if (свежих && dir) vecDiskSave(dir, store);
    return out;
}

// ── ЖУРНАЛ ПРАВОК ПАМЯТИ (healing log) ──────────────────────────────────────────
// Трекеры и темы модель перезаписывает целиком, и что именно она поменяла — не видно.
// Пишем это САМИ, без модели: сравниваем предложения старой и новой версии.
const healFile = (dir) => path.join(dir, '_healing.jsonl');
const предложения = (s) => String(s || '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 12);
function healLog(dir, file, oldText, newText) {
    try {
        if (!dir) return;
        const было = предложения(oldText), стало = предложения(newText);
        if (!было.length && !стало.length) return;
        const наборБыло = new Set(было), наборСтало = new Set(стало);
        const ушло = было.filter((s) => !наборСтало.has(s));
        const пришло = стало.filter((s) => !наборБыло.has(s));
        if (!ушло.length && !пришло.length) return;                 // текст не изменился — записи не делаем
        const короче = (arr) => arr.slice(0, 4).map((s) => s.length > 160 ? s.slice(0, 160) + '…' : s);
        const rec = { at: new Date().toISOString(), file, removed: короче(ушло), added: короче(пришло),
            sizes: [String(oldText || '').length, String(newText || '').length] };
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(healFile(dir), JSON.stringify(rec) + '\n', 'utf-8');
    } catch (_) { /* журнал — вспомогательный, ошибки глушим */ }
}

// ── ЗАЩИТА ОТ ОГРЫЗКА ───────────────────────────────────────────────────────────
// Движок памяти перезаписывает трекер/тему целиком. Если модель вернула обрубок (сорвалась,
// упёрлась в лимит, ответила одной строкой) — прежняя память была бы стёрта насовсем.
// Такую запись не принимаем: старое остаётся на месте, ответ говорит, почему.
const MIN_TRACKER = 80;    // короче — почти наверняка обрубок, а не «сцена стала проще»
const MIN_TOPIC = 50;
const SHRINK = 0.4;        // усушка больше чем в 2.5 раза — тоже подозрительно
function слишкомКоротко(oldText, newText, min) {
    const было = String(oldText || '').trim(), стало = String(newText || '').trim();
    if (!стало) return 'empty';
    if (стало.length < min) return 'short';
    if (было.length >= min * 2 && стало.length < было.length * SHRINK) return 'shrink';
    return '';
}

// имя папки чата — как в плагине (буквы/цифры/пробел/подчёрк/дефис), чтобы совпало на диске
const safeChat = (s) => String(s || '').replace(/[^\p{L}\p{N} _-]/gu, '_').trim();
const chatDir = (chat) => { const c = safeChat(chat); return c ? path.join(ROOT, c) : null; };

// к какой из трёх систем относится файл (для группировки во вьюере)
const groupOf = (name, inTopics) => inTopics ? 'topic' : (/^Diary_/i.test(name) ? 'diary' : 'tracker');

// список записей дневника: каждая timestamped-реплика = отдельный «кусок»
function readDiaryEntries(dir) {
    const entries = [];
    if (!fs.existsSync(dir)) return entries;
    for (const f of fs.readdirSync(dir).filter((n) => /^Diary_.*\.md$/i.test(n)).sort())
        for (const p of fs.readFileSync(path.join(dir, f), 'utf-8').split(/\n\n+/))
            if (p.trim()) entries.push({ file: f, text: p.trim() });
    return entries;
}

// ---- список чатов (папок памяти) — для выбора во вьюере -------------------------
router.post('/chats', (_req, res) => {
    try {
        if (!fs.existsSync(ROOT)) return res.json({ ok: true, chats: [] });
        const chats = fs.readdirSync(ROOT, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => {
                const dir = path.join(ROOT, d.name);
                let docs = 0;
                try { docs = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).length; } catch { /* пусто */ }
                try {
                    const td = path.join(dir, 'topics');
                    if (fs.existsSync(td)) docs += fs.readdirSync(td).filter((n) => n.endsWith('.md')).length;
                } catch { /* нет тем */ }
                return { id: d.name, docs };
            })
            .sort((a, b) => a.id.localeCompare(b.id, 'ru'));
        res.json({ ok: true, chats });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ---- все записи чата с текстом — для листалки во вьюере -------------------------
router.post('/all', (req, res) => {
    try {
        const dir = chatDir((req.body || {}).chat);
        if (!dir || !fs.existsSync(dir)) return res.json({ ok: true, docs: [] });
        Object.keys(TRACKER_LEGACY).forEach((nm) => migrateTracker(dir, nm));   // старые русские файлы трекеров → английские имена (при чтении)
        const docs = [];
        for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort())
            docs.push({ name: n, group: groupOf(n, false), text: fs.readFileSync(path.join(dir, n), 'utf-8'), off: false });
        const td = path.join(dir, 'topics');
        if (fs.existsSync(td))
            for (const n of fs.readdirSync(td).filter((x) => x.endsWith('.md') || x.endsWith('.md.off')).sort()) {
                const off = n.endsWith('.off');
                docs.push({ name: off ? n.slice(0, -4) : n, group: 'topic', text: fs.readFileSync(path.join(td, n), 'utf-8'), off });
            }
        res.json({ ok: true, docs });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ---- ДНЕВНИК = смысловой RAG (как в Soul of Waifu) ------------------------------
// Раньше отдавали «последние N по времени». Теперь: эмбеддим запрос и каждую запись,
// берём top-k по близости (порог опционален), склейку режем по длине (SW-обрезка «хвостом»).
// Без запроса — фолбэк на последние N по времени (тоже сценарий SW).
router.post('/diary', async (req, res) => {
    try {
        const { chat, query, k = 3, threshold = 0, cap = 2500 } = req.body || {};
        const dir = chatDir(chat);
        const entries = dir ? readDiaryEntries(dir) : [];
        if (!entries.length) return res.json({ ok: true, memory: '', entries: [], mode: 'empty' });

        const capTail = (s) => (cap && s.length > cap) ? ('... ' + s.slice(-cap)) : s;

        if (!query || !String(query).trim()) {
            const last = entries.slice(-Math.max(1, k));
            return res.json({ ok: true, memory: capTail(last.map((e) => e.text).join('\n\n')), entries: last, mode: 'recent' });
        }

        const qv = await embedQuery(query);
        const vecs = await embedMany(dir, entries.map((e) => e.text));      // кэш: считаем только новые записи
        entries.forEach((e, i) => { e.score = dot(qv, vecs[i]); });
        entries.sort((a, b) => b.score - a.score);
        const top = entries.filter((e) => e.score >= threshold).slice(0, Math.max(1, k));
        res.json({
            ok: true,
            memory: capTail(top.map((e) => e.text).join('\n\n')),
            entries: top.map((e) => ({ file: e.file, text: e.text, score: +e.score.toFixed(3) })),
            mode: 'rag',
        });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ---- ТЕМЫ = смысловой RAG (актуальные факты по субъекту) ------------------------
router.post('/topics', async (req, res) => {
    try {
        const { chat, query, k = 3 } = req.body || {};
        const dir = chatDir(chat);
        const td = dir ? path.join(dir, 'topics') : null;
        if (!td || !fs.existsSync(td)) return res.json({ ok: true, memory: '', entries: [] });
        const items = fs.readdirSync(td).filter((n) => n.endsWith('.md'))    // .off — исключённые, в поиск не идут
            .map((n) => ({ name: n.replace(/\.md$/, ''), text: fs.readFileSync(path.join(td, n), 'utf-8').trim() }))
            .filter((x) => x.text);
        if (!items.length) return res.json({ ok: true, memory: '', entries: [] });

        if (!query || !String(query).trim()) {
            const top = items.slice(0, Math.max(1, k));
            return res.json({ ok: true, memory: top.map((x) => x.text).join('\n\n'), entries: top.map((x) => ({ name: x.name, score: null })), mode: 'list' });
        }

        const qv = await embedQuery(query);
        const tvecs = await embedMany(dir, items.map((x) => x.text));       // кэш тем живёт в папке чата
        items.forEach((x, i) => { x.score = dot(qv, tvecs[i]); });
        items.sort((a, b) => b.score - a.score);
        const top = items.slice(0, Math.max(1, k));
        res.json({
            ok: true,
            memory: top.map((x) => x.text).join('\n\n'),
            entries: top.map((x) => ({ name: x.name, score: +x.score.toFixed(3) })),
            mode: 'rag',
        });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ---- Смысловое ранжирование: близость ОДНОГО запроса к списку текстов ----------
// Для semantic-лорбука (сцена ↔ фраза-эталон) и vectorized (сцена ↔ текст записи).
// Возвращает баллы в порядке texts. Векторы нормализованы → косинус = скалярное.
router.post('/score', async (req, res) => {
    try {
        const { query, texts } = req.body || {};
        if (!query || !String(query).trim() || !Array.isArray(texts) || !texts.length) return res.json({ ok: true, scores: [] });
        const qv = await embedQuery(query);
        // Лорбук зовёт это КАЖДЫЙ ход по всем записям — тут кэш экономит больше всего. Папки чата у
        // запроса нет (тексты приходят снаружи), поэтому кэш только в памяти процесса.
        const svecs = await embedMany(null, texts.map((x) => String(x || '')));
        const scores = texts.map((x, i) => (String(x || '').trim() ? +dot(qv, svecs[i]).toFixed(4) : 0));
        res.json({ ok: true, scores });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ============================================================================
// ЗАПИСЬ памяти (движок памяти пишет доки на диск). Все — ДО CSRF, как чтение.
// ============================================================================
const safeFile = (s) => { const f = String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '_'); return (f && f.endsWith('.md') && !f.includes('..')) ? f : null; };
const trackerFile = (name) => { const nm = safeChat(name).replace(/\s+/g, '_'); return nm ? nm + '.md' : null; };

// Миграция: раньше дефолт-трекеры звались по-русски (файлы Статус.md/Мир.md/Психика.md). Теперь имена
// английские (Status/World/Psyche). При первом обращении переименовываем старый русский файл в английский,
// чтобы накопленная память чата не потерялась. Кастомные/нестандартные имена не трогаем.
const TRACKER_LEGACY = { Status: 'Статус', World: 'Мир', Psyche: 'Психика' };
function migrateTracker(dir, name) {
    try {
        const fn = trackerFile(name);
        if (!dir || !fn) return;
        const target = path.join(dir, fn);
        if (fs.existsSync(target)) return;                       // английский файл уже есть — миграция не нужна
        const legacy = TRACKER_LEGACY[name];
        const legacyFn = legacy && trackerFile(legacy);
        const src = legacyFn && path.join(dir, legacyFn);
        if (src && fs.existsSync(src)) fs.renameSync(src, target);
    } catch (_) { /* миграция — best-effort, ошибки глушим */ }
}

// Дневник — ДОПИСАТЬ запись со временем (без перезаписи).
router.post('/append', (req, res) => {
    try {
        const { chat, date, text } = req.body || {};
        const dir = chatDir(chat);
        if (!dir) return res.json({ ok: false, skipped: 'no-chat' });
        if (!text || !String(text).trim()) return res.json({ ok: false, skipped: 'empty' });
        fs.mkdirSync(dir, { recursive: true });
        const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
        const time = new Date().toTimeString().slice(0, 5);
        fs.appendFileSync(path.join(dir, `Diary_${day}.md`), `\n\n**[${time}]**\n${String(text).trim()}`, 'utf-8');
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// Трекер — ПЕРЕЗАПИСАТЬ целиком по имени (Status/World/Psyche/…).
router.post('/tracker', (req, res) => {
    try {
        const { chat, name, text } = req.body || {};
        const dir = chatDir(chat); const fn = trackerFile(name);
        if (!dir || !fn) return res.json({ ok: false, skipped: 'no-chat-or-name' });
        const file = path.join(dir, fn);
        const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
        const беда = слишкомКоротко(prev, text, MIN_TRACKER);
        if (беда) return res.json({ ok: false, skipped: беда, kept: prev.length, got: String(text || '').trim().length });
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, String(text).trim(), 'utf-8');
        healLog(dir, fn, prev, String(text).trim());   // что именно поменялось — в журнал, без модели
        res.json({ ok: true, name: fn });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// Прочитать прошлую версию трекера (отдаём модели «обнови это на месте»).
router.post('/get', (req, res) => {
    try {
        const { chat, name } = req.body || {};
        const dir = chatDir(chat); const fn = trackerFile(name);
        if (dir) migrateTracker(dir, name);                      // старый русский файл трекера → английское имя
        const file = (dir && fn) ? path.join(dir, fn) : null;
        const text = (file && fs.existsSync(file)) ? fs.readFileSync(file, 'utf-8') : '';
        res.json({ ok: true, text });
    } catch (e) { res.status(500).json({ ok: false, text: '', error: String(e) }); }
});

// Тема — ПЕРЕЗАПИСАТЬ файл темы (Archivist).
router.post('/topic-save', (req, res) => {
    try {
        const { chat, name, text } = req.body || {};
        const dir = chatDir(chat);
        const td = dir ? path.join(dir, 'topics') : null;
        const fn = safeFile((name || '').endsWith('.md') ? name : `${name}.md`);
        if (!td || !fn) return res.json({ ok: false, skipped: 'bad-name' });
        const tfile = path.join(td, fn);
        const tprev = fs.existsSync(tfile) ? fs.readFileSync(tfile, 'utf-8') : '';
        const тбеда = слишкомКоротко(tprev, text, MIN_TOPIC);
        if (тбеда) return res.json({ ok: false, skipped: тбеда, kept: tprev.length, got: String(text || '').trim().length });
        fs.mkdirSync(td, { recursive: true });
        fs.writeFileSync(tfile, String(text).trim(), 'utf-8');
        healLog(chatDir(chat), 'topics/' + fn, tprev, String(text).trim());
        res.json({ ok: true, name: fn });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// Путь к конкретной записи памяти по группе (topic — в подпапке topics, иначе в корне чата).
function docFilePath(chat, group, name) {
    const dir = chatDir(chat); if (!dir) return null;
    const fn = safeFile((name || '').endsWith('.md') ? name : `${name}.md`); if (!fn) return null;
    return group === 'topic' ? path.join(dir, 'topics', fn) : path.join(dir, fn);
}
// Отредактировать запись памяти (ручная правка из ноды «Душа») — ПЕРЕЗАПИСАТЬ файл.
router.post('/doc-save', (req, res) => {
    try {
        const { chat, group, name, text } = req.body || {};
        const file = docFilePath(chat, group, name);
        if (!file) return res.json({ ok: false, skipped: 'bad-name' });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const было = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
        fs.writeFileSync(file, String(text == null ? '' : text).trim(), 'utf-8');   // ручная правка порогом НЕ ограничена: стереть своё — право ведущего
        healLog(chatDir(chat), path.basename(file), было, String(text == null ? '' : text).trim());
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});
// Журнал правок памяти: последние записи «что ушло / что пришло». Пишется без модели.
router.post('/healing', (req, res) => {
    try {
        const { chat, limit = 40 } = req.body || {};
        const dir = chatDir(chat);
        const p = dir ? healFile(dir) : null;
        if (!p || !fs.existsSync(p)) return res.json({ ok: true, log: [] });
        const rows = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean).slice(-Math.max(1, limit));
        const log = [];
        for (const r of rows) { try { log.push(JSON.parse(r)); } catch (_) {} }
        res.json({ ok: true, log: log.reverse() });        // свежие сверху
    } catch (e) { res.status(500).json({ ok: false, log: [], error: String(e) }); }
});

// Удалить запись памяти (кнопка ✕ у записи).
router.post('/doc-del', (req, res) => {
    try {
        const { chat, group, name } = req.body || {};
        const file = docFilePath(chat, group, name);
        if (!file) return res.json({ ok: false, skipped: 'bad-name' });
        if (fs.existsSync(file)) fs.unlinkSync(file);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});
// Стереть ВСЮ память чата (кнопка ✕ у чата в выпадашке «память чата»): удалить папку целиком.
router.post('/purge', (req, res) => {
    try {
        const { chat } = req.body || {};
        const dir = chatDir(chat);
        if (!dir) return res.json({ ok: false, skipped: 'bad-name' });
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// Копия ВСЕЙ памяти Души из одного чата в другой (для «Ветки»: новый чат наследует
// дневник/трекеры/темы исходного). Пустой источник — не ошибка (нечего копировать).
router.post('/copy', (req, res) => {
    try {
        const { from, to } = req.body || {};
        const src = chatDir(from), dst = chatDir(to);
        if (!src || !dst) return res.json({ ok: false, skipped: 'bad-name' });
        if (!fs.existsSync(src)) return res.json({ ok: true, empty: true });
        fs.cpSync(src, dst, { recursive: true, force: true });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});
