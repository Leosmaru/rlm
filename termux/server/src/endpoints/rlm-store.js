// ============================================================================
// rlm-store.js — ОБЩЕЕ хранилище RLM (ключ-значение) на сервере ПК: единая база для всех
// устройств в локальной сети. Персонажи, пресеты, чаты/логи/графы, конфиг API — всё здесь,
// поэтому открыл RLM с телефона → те же персонажи и та же сессия, что на ПК (не пустая).
//
// Хранение: КАТАЛОГ <dataRoot>/rlm-store/, ОДИН ФАЙЛ НА КЛЮЧ (имя = encodeURIComponent(key)+'.json').
// Так частые правки (лог чата на каждое сообщение) переписывают только свой файл, а не всю базу.
//
// Маршруты — ПОСЛЕ whitelist-middleware (читать/писать может только доверенное устройство):
//   POST /get {key?}         -> { ok, value }   (значение ключа; без key — ВЕСЬ объект базы)
//   POST /set {key, value}   -> { ok }
//   POST /setmany {entries}  -> { ok, n }        (пакетно — для миграции с localStorage)
//   POST /del {key}          -> { ok }
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

export const router = express.Router();

function storeDir() {
    const root = globalThis.DATA_ROOT
        || (globalThis.COMMAND_LINE_ARGS && globalThis.COMMAND_LINE_ARGS.dataRoot)
        || './data';
    const dir = path.join(root, 'rlm-store');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* уже есть */ }
    return dir;
}
const fileFor = (key) => path.join(storeDir(), encodeURIComponent(key) + '.json');

function readOne(key) {
    try { return JSON.parse(fs.readFileSync(fileFor(key), 'utf8')); } catch { return undefined; }
}
function writeOne(key, value) {
    fs.writeFileSync(fileFor(key), JSON.stringify(value));
}
function readAll() {
    const out = {};
    try {
        for (const f of fs.readdirSync(storeDir())) {
            if (!f.endsWith('.json')) continue;
            try { out[decodeURIComponent(f.slice(0, -5))] = JSON.parse(fs.readFileSync(path.join(storeDir(), f), 'utf8')); } catch { /* битый файл — пропустить */ }
        }
    } catch { /* каталога ещё нет */ }
    return out;
}

router.post('/get', (req, res) => {
    const key = req.body && req.body.key;
    if (key) return res.json({ ok: true, value: readOne(key) ?? null });
    res.json({ ok: true, value: readAll() });
});

// Список ключей (без значений) — чтобы клиент грузил базу ПО КЛЮЧАМ, а не одним куском (~16 МБ):
// монолитный /get валился на телефоне (fetch/JSON.parse огромной строки) → база не читалась.
router.post('/keys', (_req, res) => {
    let keys = [];
    try { keys = fs.readdirSync(storeDir()).filter((f) => f.endsWith('.json')).map((f) => decodeURIComponent(f.slice(0, -5))); }
    catch { /* каталога ещё нет */ }
    res.json({ ok: true, keys });
});

router.post('/set', (req, res) => {
    const { key, value } = req.body || {};
    if (!key || typeof key !== 'string') return res.json({ ok: false, error: 'Не задан ключ' });
    try { writeOne(key, value); res.json({ ok: true }); }
    catch (e) { console.error('rlm-store set:', e); res.json({ ok: false, error: String((e && e.message) || e) }); }
});

router.post('/setmany', (req, res) => {
    const entries = (req.body && req.body.entries) || {};
    let n = 0;
    try {
        for (const [k, v] of Object.entries(entries)) { if (k) { writeOne(k, v); n++; } }
        res.json({ ok: true, n });
    } catch (e) { console.error('rlm-store setmany:', e); res.json({ ok: false, error: String((e && e.message) || e) }); }
});

router.post('/del', (req, res) => {
    const key = req.body && req.body.key;
    if (key && typeof key === 'string') { try { fs.unlinkSync(fileFor(key)); } catch { /* уже нет */ } }
    res.json({ ok: true });
});
