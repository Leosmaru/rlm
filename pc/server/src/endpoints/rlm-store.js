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
// Перед каждой перезаписью сервер кладёт копию прежнего файла в rlm-store/_backups/ (логи чатов —
// всегда, прочее — при усушке); лишние копии подчищаются.
//   POST /claim {clientId}   -> { ok, id, prev }   (стать ЕДИНСТВЕННЫМ пишущим клиентом)
//   POST /owner              -> { ok, id }         (кто сейчас пишет)
// Запись (set/setmany/del) идёт с clientId; чужой получает { ok:false, error:'not-owner' }.
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

// Три РАЗНЫХ случая, которые раньше сваливались в один «undefined»:
//   • файла нет            → undefined («ключа правда нет»);
//   • файл не прочитался   → БРОСАЕМ ошибку (на Windows это EBUSY/EPERM от антивируса и индексатора);
//     клиент должен получить «не смог», а не «пусто» — иначе он пишет дефолты поверх целого файла;
//   • файл битый (обрыв записи) → поднимаем последнюю целую копию и чиним файл на месте.
function readOne(key) {
    let raw;
    try { raw = fs.readFileSync(fileFor(key), 'utf8'); }
    catch (e) {
        if (e && e.code === 'ENOENT') return undefined;      // честное «ключа нет»
        throw e;                                             // сбой чтения — наверх, /get ответит ok:false
    }
    try { return JSON.parse(raw); } catch { /* битый — ниже */ }
    const saved = restoreFromBackup(key);
    if (saved !== undefined) {
        console.log('[rlm-store] ' + key + ': файл повреждён (' + raw.length + ' б) — поднял целую копию из _backups/');
        try { writeRaw(key, JSON.stringify(saved)); } catch { /* починим при следующей записи */ }   // чтобы не поднимать копию каждый раз
        return saved;
    }
    console.error('[rlm-store] ' + key + ': файл повреждён и целых копий нет');
    throw new Error('corrupt:' + key);   // лучше честная ошибка, чем «пусто» и запись дефолтов поверх
}
// Последняя по времени копия ключа, которая разбирается. Битые пропускаем и идём дальше вглубь.
function restoreFromBackup(key) {
    const dirs = [
        path.join(storeDir(), '_backups', encodeURIComponent(key)),   // новая раскладка: подкаталог на ключ
        path.join(storeDir(), '_backups'),                            // старая: файлы с префиксом ключа
    ];
    const prefix = encodeURIComponent(key) + '_';
    for (let i = 0; i < dirs.length; i++) {
        try {
            const list = fs.readdirSync(dirs[i])
                .filter((f) => (i === 0 ? f.endsWith('.json') : f.startsWith(prefix)))
                .map((f) => { try { return { f, t: fs.statSync(path.join(dirs[i], f)).mtimeMs }; } catch { return null; } })
                .filter(Boolean).sort((a, b) => b.t - a.t);   // свежие первыми
            for (const x of list) {
                try { return JSON.parse(fs.readFileSync(path.join(dirs[i], x.f), 'utf8')); } catch { /* эта битая — следующая */ }
            }
        } catch { /* копий нет */ }
    }
    return undefined;
}
// ── Копии перед перезаписью (страховка, как в ST: backups/ + троттлинг + лимит) ──────────────
// Зачем: файл ключа переписывается ЦЕЛИКОМ, и одна кривая запись стирала историю без следа
// (так пропал чат 2026-09-02). Прежний клиентский .bak не спасал: он делается, когда клиент
// ПРИНИМАЕТ серверную версию, а беда приходит с другой стороны — когда клиент её ЗАПИСЫВАЕТ.
// Теперь копию кладёт сам сервер, прямо перед записью файла:
//   • логи чатов (rlm.chatlog.*) — при каждой записи, но не чаще раза в 10 с;
//   • любой ключ, если новое ЗАМЕТНО короче старого (усушка) — всегда, без троттлинга;
//   • лишние копии подчищаются: 50 на чат (как numberOfBackups у ST), 10 для прочих ключей.
// Лежат в подкаталоге _backups/ — /keys берёт только *.json своего уровня, поэтому копии не
// превращаются в «ключи» и клиенту не грузятся.
const BK_THROTTLE_MS = 10000;   // не чаще раза в 10 с на ключ (throttleInterval у ST)
const BK_KEEP_CHAT = 50;        // копий на лог чата
const BK_KEEP_OTHER = 10;       // копий на прочие ключи
const BK_SHRINK = 0.6;          // новое меньше 60% старого = усушка, копия обязательна
const bkLast = new Map();       // key -> когда последний раз копировали

function backupsDir() {
    const dir = path.join(storeDir(), '_backups');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* уже есть */ }
    return dir;
}
function bkStamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + String(d.getMilliseconds()).padStart(3, '0');
}
function bkTrim(dir, keep) {   // оставить только N самых свежих копий этого ключа
    try {
        // Сортируем по времени файла: имена с разными суффиксами («shrink-», «auto-») в лексикографическом
        // порядке врут, и первой удалялась как раз самая ценная копия.
        const files = fs.readdirSync(dir)
            .map((f) => { try { return { f, t: fs.statSync(path.join(dir, f)).mtimeMs }; } catch { return null; } })
            .filter(Boolean).sort((a, b) => a.t - b.t);
        for (const x of files.slice(0, Math.max(0, files.length - keep))) {
            try { fs.unlinkSync(path.join(dir, x.f)); } catch { /* уже нет */ }
        }
    } catch { /* каталога нет — нечего чистить */ }
}
function backupBefore(key, nextRaw) {
    let prevSize = 0;
    try { prevSize = fs.statSync(fileFor(key)).size; } catch { return; }         // файла ещё нет — терять нечего
    if (!prevSize) return;
    const isChat = key.indexOf('rlm.chatlog.') === 0;
    const shrink = nextRaw.length < prevSize * BK_SHRINK;                        // история усохла
    if (!isChat && !shrink) return;
    if (!shrink && (Date.now() - (bkLast.get(key) || 0)) < BK_THROTTLE_MS) return;
    try {
        // Копию делаем ФАЙЛОМ, а не через чтение в память: у крупных ключей (библиотека карточек —
        // десятки мегабайт) чтение на каждую запись вешало сервер целиком.
        const dir = path.join(backupsDir(), encodeURIComponent(key));            // свой подкаталог на ключ:
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* есть */ }     // иначе ключи с общим префиксом лезли в чужие копии
        fs.copyFileSync(fileFor(key), path.join(dir, (shrink ? 'shrink-' : 'auto-') + bkStamp() + '.json'));
        bkLast.set(key, Date.now());
        bkTrim(dir, isChat ? BK_KEEP_CHAT : BK_KEEP_OTHER);
        if (shrink) console.log('[rlm-store] ' + key + ': новое короче старого (' + prevSize + ' → ' + nextRaw.length + ' б) — прежнее сохранено в _backups/');
    } catch (e) { console.error('[rlm-store] копия ' + key + ' не вышла:', e); }
}

// Сырая атомарная запись — ею же чиним битый файл после подъёма копии.
function writeRaw(key, raw) {
    const dst = fileFor(key);
    const tmp = dst + '.tmp' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
    try {
        const fd = fs.openSync(tmp, 'w');
        try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        // На Windows rename поверх существующего падает с EPERM/EBUSY, если файл держит антивирус
        // или индексатор — а держит он как раз только что созданный. Несколько попыток решают.
        let last = null;
        for (let i = 0; i < 5; i++) {
            try { fs.renameSync(tmp, dst); return; } catch (e) { last = e; try { fs.rmSync(dst, { force: true }); } catch { /* нет */ } }
        }
        throw last;
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* уже нет */ }
        throw e;
    }
}
function writeOne(key, value) {
    const raw = JSON.stringify(value);
    backupBefore(key, raw);
    // АТОМАРНО (как writeFileAtomicSync у ST): временный файл + переименование поверх. Прямая запись
    // большого файла при перезапуске обрывалась на середине, и ключ выглядел как пропавший.
    writeRaw(key, raw);
}
function readAll() {
    const out = {};
    try {
        for (const f of fs.readdirSync(storeDir())) {
            if (!f.endsWith('.json') || f.startsWith('_')) continue;   // служебка мимо
            try { out[decodeURIComponent(f.slice(0, -5))] = JSON.parse(fs.readFileSync(path.join(storeDir(), f), 'utf8')); } catch { /* битый файл — пропустить */ }
        }
    } catch { /* каталога ещё нет */ }
    return out;
}

// ── Одна активная сессия: писать может только ПОСЛЕДНИЙ подключившийся клиент ──────────────
// Зачем: у каждого клиента (окно ПК, вкладка, телефон) чат живёт в памяти и уходит на сервер
// ЦЕЛИКОМ. Клиент со вчерашним состоянием молча клал его поверх свежего — так пропадали чаты.
// Теперь: кто последним подключился, тот и пишет; прежний получает отказ «not-owner», уходит в
// просмотр и больше ничего не записывает. Читать (get/keys) может кто угодно — второй клиент
// поэтому и подхватывает ровно то, что успел наиграть первый.
let owner = null;   // { id, since }
// Владелец в памяти пропадал при рестарте сервера: защита исчезала молча, а клиент, ушедший в
// просмотр, об этом не узнавал. Держим его в файле рядом с данными.
function ownerFile() { return path.join(storeDir(), '_owner.json'); }
function ownerLoad() {
    // Читаем файл КАЖДЫЙ раз: кэш в памяти делал невозможным освобождение права снаружи
    // (удалили файл — сервер всё равно держал прежнего владельца до перезапуска).
    try { owner = JSON.parse(fs.readFileSync(ownerFile(), 'utf8')); } catch { owner = null; }
    return owner;
}
function ownerSave(o) {
    owner = o;
    try { fs.writeFileSync(ownerFile(), JSON.stringify(o)); } catch { /* не критично */ }
}
// Мусор от оборванных записей: .tmp* остаются, если процесс убили между записью и переименованием.
let tmpSwept = false;
function sweepTmp() {
    if (tmpSwept) return; tmpSwept = true;
    try { for (const f of fs.readdirSync(storeDir())) if (f.includes('.tmp')) { try { fs.unlinkSync(path.join(storeDir(), f)); } catch { /* занят */ } } } catch { /* нет каталога */ }
}
router.post('/claim', (req, res) => {
    const id = req.body && req.body.clientId;
    if (!id || typeof id !== 'string') return res.json({ ok: false, error: 'Не задан clientId' });
    sweepTmp();
    const prev = ownerLoad() && owner.id;
    ownerSave({ id, since: Date.now() });
    console.log('[rlm-store] активный клиент: ' + id + (prev && prev !== id ? ' (прежний ' + prev + ' отключён от записи)' : ''));
    res.json({ ok: true, id, prev: prev || null });
});
// Кто сейчас пишет — клиент опрашивает, чтобы понять, не отобрали ли у него право.
// Клиент уходит (закрыли окно, ушли со страницы) — отпускает право, чтобы следующий не ждал впустую.
router.post('/release', (req, res) => {
    const id = req.body && req.body.clientId;
    const o = ownerLoad();
    if (o && id && o.id === id) { owner = null; try { fs.unlinkSync(ownerFile()); } catch { /* уже нет */ } console.log('[rlm-store] клиент ' + id + ' отпустил право записи'); }
    res.json({ ok: true });
});
router.post('/owner', (_req, res) => { const o = ownerLoad(); res.json({ ok: true, id: o ? o.id : null, since: o ? o.since : 0 }); });
// Право на запись: своих пускаем, чужих отшиваем. Клиент без clientId — старая сборка, пускаем.
// Сколько сообщений в значении: у лога чата — msgs, у снимка сборки — истории всех бесед ноды партии.
// null = «считать нечего» (ключ не про историю), такие значения правилом не ограничиваем.
function msgCount(value) {
    try {
        if (!value || typeof value !== 'object') return null;
        if (Array.isArray(value.msgs)) return value.msgs.length;
        if (Array.isArray(value.nodes)) {
            let n = null;
            for (const nd of value.nodes) {
                if (!nd || (nd.type !== 'netgame' && nd.type !== 'telegram')) continue;
                const cv = (nd.data && nd.data.convos) || {};
                n = (n || 0) + Object.keys(cv).reduce((a, k) => a + (((cv[k] || {}).msgs || []).length), 0);
            }
            return n;
        }
    } catch { /* не наше дело */ }
    return null;
}
// Правило записи вместо блокировки клиентов: история не укорачивается сама собой.
// Клиент, который РЕАЛЬНО удалил реплики или очистил чат, шлёт shrinkOk — тогда пишем.
function mayShrink(key, value, req) {
    const next = msgCount(value);
    if (next === null) return true;                       // не история — правило не применяем
    if (req && req.body && req.body.shrinkOk) return true; // намеренное удаление/очистка
    let prev = null;
    try { prev = msgCount(JSON.parse(fs.readFileSync(fileFor(key), 'utf8'))); } catch { return true; }
    if (prev === null) return true;
    if (next >= prev) return true;
    console.log('[rlm-store] ' + key + ': отклонена запись короче имеющейся (' + prev + ' → ' + next + ' сообщ.) — это не удаление, а отставший клиент');
    return false;
}
function mayWrite(req) {
    // ПИШУТ ВСЕ. Телефон, ПК, вторая вкладка — любой клиент, который что-то добавил, делает это истиной.
    // Раньше здесь стоял отказ чужому клиенту, и играющий телефон молча оставался без сохранения.
    // Владельца держим только как отметку «кто сейчас активен» — она нужна плашке, а не записи.
    const id = req.body && req.body.clientId;
    if (id) { const o = ownerLoad(); if (!o || o.id !== id || (Date.now() - (o.since || 0)) > 10000) ownerSave({ id, since: Date.now() }); }
    return true;
}

router.post('/get', (req, res) => {
    const key = req.body && req.body.key;
    try {
        if (key) return res.json({ ok: true, value: readOne(key) ?? null });
        return res.json({ ok: true, value: readAll() });
    } catch (e) {
        console.error('[rlm-store] /get ' + (key || '(вся база)') + ':', e);
        return res.json({ ok: false, error: String((e && e.message) || e) });   // НЕ «пусто»: пусто клиент понимает как «можно писать своё»
    }
});

// Список ключей (без значений) — чтобы клиент грузил базу ПО КЛЮЧАМ, а не одним куском (~16 МБ):
// монолитный /get валился на телефоне (fetch/JSON.parse огромной строки) → база не читалась.
router.post('/keys', (_req, res) => {
    // Раньше весь цикл был в одном try: одно кривое имя файла (или занятый каталог) → пустой список
    // с ok:true → клиент считал базу пустой, стартовал с нуля и писал дефолты поверх живых данных.
    let files;
    try { files = fs.readdirSync(storeDir()); }
    catch (e) {
        if (e && e.code === 'ENOENT') return res.json({ ok: true, keys: [] });   // каталога ещё нет — база правда пустая
        console.error('[rlm-store] /keys не прочитал каталог:', e);
        return res.json({ ok: false, error: String((e && e.message) || e) });    // сбой — честно говорим «не смог»
    }
    const keys = [];
    for (const f of files) {
        if (!f.endsWith('.json') || f.startsWith('_')) continue;   // _owner.json и прочая служебка — не данные, клиенту не нужны
        try { keys.push(decodeURIComponent(f.slice(0, -5))); } catch { /* битое имя — пропускаем именно его */ }
    }
    res.json({ ok: true, keys });
});

router.post('/set', (req, res) => {
    const { key, value } = req.body || {};
    if (!key || typeof key !== 'string') return res.json({ ok: false, error: 'Не задан ключ' });
    mayWrite(req);   // отметить активного клиента (запись не блокируется)
    if (!mayShrink(key, value, req)) return res.json({ ok: true, skipped: 'shorter' });   // отставший клиент — молча не портим историю
    try { writeOne(key, value); res.json({ ok: true }); }
    catch (e) { console.error('rlm-store set:', e); res.json({ ok: false, error: String((e && e.message) || e) }); }
});

router.post('/setmany', (req, res) => {
    const entries = (req.body && req.body.entries) || {};
    if (!mayWrite(req)) return res.json({ ok: false, error: 'not-owner', owner: owner && owner.id });
    let n = 0;
    const failed = [];
    for (const [k, v] of Object.entries(entries)) {
        if (!k) continue;
        try { writeOne(k, v); n++; } catch (e) { failed.push(k); console.error('[rlm-store] setmany ' + k + ':', e); }   // раньше падение на одном ключе рвало цикл на середине
    }
    res.json({ ok: !failed.length, n, failed });
});

router.post('/del', (req, res) => {
    if (!mayWrite(req)) return res.json({ ok: false, error: 'not-owner', owner: owner && owner.id });
    const key = req.body && req.body.key;
    if (key && typeof key === 'string') {
        try { fs.unlinkSync(fileFor(key)); } catch { /* уже нет */ }
        // Копии удалённого ключа больше не нужны — иначе каталог рос по числу когда-либо живших ключей.
        try { fs.rmSync(path.join(storeDir(), '_backups', encodeURIComponent(key)), { recursive: true, force: true }); } catch { /* нет копий */ }
        bkLast.delete(key);
    }
    res.json({ ok: true });
});
