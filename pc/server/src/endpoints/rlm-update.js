// ============================================================================
// rlm-update.js — обновление сборки RLM с GitHub («Обновить?» на экране загрузки).
//
// Зачем: у людей стоит папка со сборкой (pc/ или termux/), скачанная с github.com/Leosmaru/rlm.
// Заставлять их качать всё заново нельзя — приложение само сверяет свои файлы с репозиторием
// и докачивает только те, что изменились.
//
// Почему на сервере, а не в Electron: в Termux Electron'а нет вообще — там живёт только этот
// сервер плюс браузер телефона на /rlm/. Один код на обе сборки.
//
// Как узнаём, что вышло новое: метка сборки в файле BUILD.txt рядом с package.json (одна строка,
// вида 20260903-1430). Локальную читаем с диска, свежую — одним лёгким запросом raw-файла с GitHub.
// Метки нет (BUILD.txt отсутствует) — значит это НЕ сборка, а рабочая dev-папка: обновление молчит
// и ничего не трогает, иначе репозиторий затёр бы рабочий код.
//
// Что обновляется: весь код ветки (app/, server/, скрипты запуска, docs/) и СТАРТОВЫЕ пресеты.
// Что не трогаем НИКОГДА: данные человека — чаты, карточки, персоны, ключи, память Душ, его
// собственные пресеты (их в репозитории нет, сверять не с чем — они и остаются как были).
//
// Маршруты (монтируются в server-main.js под /api/rlm/update, ПОСЛЕ whitelist):
//   POST /check    -> { ok, dev, branch, build, remote, hasUpdate }
//   POST /apply    -> { ok, started }            (работа идёт в фоне, следим через /progress)
//   POST /progress -> { ok, running, finished, phase, done, total, changed, failed, error }
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import express from 'express';
import { serverDirectory } from '../server-directory.js';

export const router = express.Router();

const REPO = 'Leosmaru/rlm';
const GITREF = 'main';
const RAW = (p) => 'https://raw.githubusercontent.com/' + REPO + '/' + GITREF + '/' + encodeURI(p);

// Корень сборки — папка НАД server/ (pc/ или termux/ у людей, корень проекта в dev).
const packRoot = () => path.join(serverDirectory, '..');
// Какая из двух сборок: у termux рядом лежит свой установщик, у ПК — нет.
const packBranch = () => (fs.existsSync(path.join(packRoot(), 'install-termux.sh')) ? 'termux' : 'pc');
const buildFile = () => path.join(packRoot(), 'BUILD.txt');

function localBuild() {
    try { return fs.readFileSync(buildFile(), 'utf8').trim() || null; } catch { return null; }   // нет файла = рабочая папка (dev)
}
async function remoteBuild(branch) {
    // ?t= — обход кэша CDN у raw.githubusercontent (иначе метка приезжает пятиминутной давности)
    // Таймаут обязателен: без него мёртвый вайфай на телефоне держал бы экран загрузки минутами.
    const r = await fetch(RAW(branch + '/BUILD.txt') + '?t=' + Date.now(), {
        headers: { 'User-Agent': 'RLM' }, signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error('GitHub ответил ' + r.status);
    return (await r.text()).trim();
}

// ── Что разрешено перезаписывать ────────────────────────────────────────────────
// Путь rel — внутри ветки, без её префикса (например 'app/renderer.js').
const FACTORY_PRESET = /^server\/data\/rlm-store\/rlm\.preset\..+\.json$/;   // стартовые пресеты: они лежат в репозитории
const PRESETS_LIST = 'server/data/rlm-store/rlm.presets.json';               // список пресетов — сливаем, а не перезаписываем
function allowPath(rel) {
    // Данные: из всей папки data трогаем ТОЛЬКО стартовые пресеты и список. Чаты, карточки, персоны,
    // стиль, выбор персонажа, лимиты токенов, ключи — личное, обновление их не видит.
    if (rel.startsWith('server/data/')) return FACTORY_PRESET.test(rel) || rel === PRESETS_LIST;
    if (rel.startsWith('server/plugins/soul-md/data/')) return false;        // память Душ
    if (/^docs\/Заметки Разработчика/i.test(rel)) return false;             // личный файл автора сборки
    return true;
}

// git-хэш файла: sha1('blob <длина>\0' + содержимое) — ровно то, что GitHub отдаёт в дереве,
// поэтому сравнение локального файла с репозиторием идёт без единой лишней закачки.
function blobSha(buf) {
    const h = crypto.createHash('sha1');
    h.update(Buffer.from('blob ' + buf.length + '\0', 'utf8'));
    h.update(buf);
    return h.digest('hex');
}
const isBinary = (buf) => buf.includes(0);   // NUL внутри = картинка/видео/шрифт, переносы там не трогаем

// «Файл уже такой же, как в репозитории?» Прямое сравнение хэшей — и второй заход с нормализованными
// переносами: git на Windows при клоне разворачивает LF в CRLF, отчего ТОТ ЖЕ файл получает другой хэш.
// Без этой поправки первое же обновление считало бы изменившимися полторы сотни нетронутых файлов.
function sameAsRepo(file, sha) {
    let buf;
    try { buf = fs.readFileSync(file); } catch { return false; }   // нет файла = скачать
    if (blobSha(buf) === sha) return true;
    if (isBinary(buf)) return false;
    return blobSha(stripCR(buf)) === sha;
}

// Переносы правим по БАЙТАМ, а не через строку: «Запустить RLM.bat» лежит в кодировке DOS, и любой
// прогон его через utf8-строку портит буквы — файл начинал считаться изменившимся при каждой проверке.
function stripCR(buf) {            // CRLF -> LF
    const out = Buffer.alloc(buf.length); let n = 0;
    for (let i = 0; i < buf.length; i++) { if (buf[i] === 13 && buf[i + 1] === 10) continue; out[n++] = buf[i]; }
    return out.subarray(0, n);
}
function addCR(buf) {              // LF -> CRLF
    const out = Buffer.alloc(buf.length * 2); let n = 0;
    for (let i = 0; i < buf.length; i++) { if (buf[i] === 10 && buf[i - 1] !== 13) out[n++] = 13; out[n++] = buf[i]; }
    return out.subarray(0, n);
}

// На диск кладём как приехало (в репозитории — LF). Исключение: .bat/.cmd на Windows — командному
// процессору нужны его родные CRLF, иначе запуск сборки может сломаться на ровном месте.
function toDisk(rel, buf) {
    if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(rel) && !isBinary(buf)) return addCR(buf);
    return buf;
}
function writeAtomic(dest, buf) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.rlmtmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);   // обрыв на середине не оставит покалеченный файл
}

// Список пресетов: стартовые берём из репозитория (там свежие имена), пользовательские —
// те, чьих id в репозитории нет, — оставляем как есть. Так «сохранить пресет как свой»
// переживает любое обновление.
function mergePresetList(remoteBuf, dest) {
    let remote = [];
    try { remote = JSON.parse(remoteBuf.toString('utf8')); } catch { return false; }
    if (!Array.isArray(remote)) return false;
    let local = [];
    try { local = JSON.parse(fs.readFileSync(dest, 'utf8')); } catch { /* при первой установке файла ещё нет */ }
    if (!Array.isArray(local)) local = [];
    const factoryIds = new Set(remote.map((p) => p && p.id));
    const mine = local.filter((p) => p && !factoryIds.has(p.id));
    writeAtomic(dest, Buffer.from(JSON.stringify([...remote, ...mine]), 'utf8'));
    return true;
}

// ── Состояние работы (одно на процесс) ──────────────────────────────────────────
const state = { running: false, finished: false, phase: '', done: 0, total: 0, changed: [], failed: [], error: null };

async function fetchTree(branch) {
    const r = await fetch('https://api.github.com/repos/' + REPO + '/git/trees/' + GITREF + '?recursive=1', {
        headers: { 'User-Agent': 'RLM', 'Accept': 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error('GitHub API ответил ' + r.status);
    const j = await r.json();
    if (!j || !Array.isArray(j.tree)) throw new Error('GitHub вернул не дерево файлов');
    const pref = branch + '/';
    return j.tree
        .filter((e) => e && e.type === 'blob' && typeof e.path === 'string' && e.path.startsWith(pref))
        .map((e) => ({ rel: e.path.slice(pref.length), path: e.path, sha: e.sha }))
        .filter((e) => allowPath(e.rel));
}

async function downloadOne(item, root) {
    const r = await fetch(RAW(item.path) + '?t=' + Date.now(), { headers: { 'User-Agent': 'RLM' } });
    if (!r.ok) throw new Error(r.status + ' ' + item.rel);
    const buf = Buffer.from(await r.arrayBuffer());
    if (blobSha(buf) !== item.sha) throw new Error('файл приехал битым: ' + item.rel);   // CDN отдал не то — лучше пропустить, чем испортить
    const dest = path.join(root, item.rel);
    if (item.rel === PRESETS_LIST) { if (!mergePresetList(buf, dest)) throw new Error('не разобрал список пресетов'); }
    else writeAtomic(dest, toDisk(item.rel, buf));
}

// Зависимости сервера ставим, только если менялся его package.json — иначе приложение
// поднимется с новым кодом и старыми модулями и упадёт на первом же импорте.
function npmInstall(dir) {
    return new Promise((resolve) => {
        const p = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir, shell: true, stdio: 'ignore' });
        p.on('error', () => resolve(false));
        p.on('close', (code) => resolve(code === 0));
    });
}

async function runUpdate() {
    const root = packRoot();
    const branch = packBranch();
    state.running = true; state.finished = false; state.phase = 'list';
    state.done = 0; state.total = 0; state.changed = []; state.failed = []; state.error = null;
    try {
        const tree = await fetchTree(branch);
        state.total = tree.length;
        state.phase = 'check';
        // Сверка: список пресетов сливаем всегда (у человека там свои строки — хэш совпасть не может),
        // остальное — только при расхождении хэшей.
        const todo = tree.filter((e) => e.rel === PRESETS_LIST || !sameAsRepo(path.join(root, e.rel), e.sha));
        state.done = state.total - todo.length;
        state.phase = 'files';
        const queue = todo.slice();
        const worker = async () => {
            while (queue.length) {
                const item = queue.shift();
                try { await downloadOne(item, root); state.changed.push(item.rel); }
                catch (e) { state.failed.push(item.rel + ' — ' + String((e && e.message) || e)); }
                state.done++;
            }
        };
        await Promise.all(Array.from({ length: 6 }, worker));   // по 6 файлов разом — быстрее и без нагрузки на GitHub
        if (state.changed.some((r) => r === 'server/package.json' || r === 'server/package-lock.json')) {
            state.phase = 'deps';
            const ok = await npmInstall(path.join(root, 'server'));
            if (!ok) state.failed.push('зависимости сервера не поставились — выполни: cd server && npm install --omit=dev');
        }
        state.phase = 'done';
    } catch (e) {
        state.error = String((e && e.message) || e);
        state.phase = 'error';
    } finally {
        state.running = false; state.finished = true;
    }
}

router.post('/check', async (req, res) => {
    const build = localBuild();
    const branch = packBranch();
    if (!build) return res.json({ ok: true, dev: true, branch, build: null, remote: null, hasUpdate: false });
    try {
        const remote = await remoteBuild(branch);
        res.json({ ok: true, dev: false, branch, build, remote, hasUpdate: !!remote && remote !== build });
    } catch (e) {
        // Нет интернета — не повод пугать человека: просто «обновления не видно», приложение работает.
        res.json({ ok: false, dev: false, branch, build, remote: null, hasUpdate: false, error: String((e && e.message) || e) });
    }
});

router.post('/apply', (req, res) => {
    if (!localBuild()) return res.json({ ok: false, error: 'Это рабочая папка (нет BUILD.txt) — обновление отключено.' });
    if (state.running) return res.json({ ok: true, started: false });   // уже идёт — просто следим за прогрессом
    runUpdate();
    res.json({ ok: true, started: true });
});

router.post('/progress', (req, res) => {
    res.json({
        ok: true, running: state.running, finished: state.finished, phase: state.phase,
        done: state.done, total: state.total, changed: state.changed.length, failed: state.failed, error: state.error,
    });
});
