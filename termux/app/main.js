// main.js — главный процесс Electron.
// Задача: открыть тёмное окно с холстом (index.html) и дать рендереру
// безопасно закрывать/перезапускать приложение через IPC.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('disable-http-cache'); // всегда грузить свежие файлы (без кэша)
// Экран первого запуска играет тему и голос сам, без клика — иначе Chromium держит звук до жеста.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Официальный значок RLM (тот же логотип-чип, что на сплэше и в фавиконе).
// На Windows берём .ico (многоразмерный, чёткий на таскбаре/в заголовке), иначе — 512px PNG.
const APP_ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: APP_ICON,             // иконка окна и таскбара
    backgroundColor: '#0d0d0f', // фон окна = фон холста, чтобы не мигало белым при старте
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // рендерер изолирован
      nodeIntegration: false,   // без прямого доступа к node из страницы
      webviewTag: true,         // разрешить <webview> для встраивания живого SillyTavern
    },
  });
  win.setMenuBarVisibility(false); // без стандартного меню — чище
  win.loadFile(path.join(__dirname, 'index.html'));
}

// ── ВЫХОД ЖДЁТ СОХРАНЕНИЯ ────────────────────────────────────────────────────────────────────
// Раньше окно закрывалось мгновенно (крестик, Alt+F4, «Закрыть»), а рендерер в это время дожимал
// снимок и лог — запросы обрывались вместе с процессом. Теперь первый выход откладываем, просим
// окно сохраниться и ждём его ответ (или 4 секунды), и только потом выходим по-настоящему.
let quitting = false;
function askRendererToSave() {
  return new Promise((resolve) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return resolve();
    let done = false;
    const finish = () => { if (done) return; done = true; ipcMain.removeListener('app:saved', finish); resolve(); };
    ipcMain.once('app:saved', finish);
    try { win.webContents.send('app:flush'); } catch (_) { return finish(); }
    setTimeout(finish, 4000);   // не ждать вечно, если окно уже не отвечает
  });
}
app.on('before-quit', (e) => {
  if (quitting) return;         // второй заход — выходим по-настоящему
  e.preventDefault();
  quitting = true;
  askRendererToSave().then(() => app.quit());
});

// IPC: кнопки «Закрыть» / «Перезапуск» в тулбаре зовут это через preload.
ipcMain.handle('app:close', () => app.quit());
ipcMain.handle('app:restart', async () => {
  await askRendererToSave();                                   // сперва дать окну дописать состояние
  if (serverProc) { try { serverProc.kill(); } catch (_) {} serverProc = null; }   // гасим свой сервер: иначе он переживает перезапуск и работает на СТАРОМ коде
  if (ttsProc) { try { ttsProc.kill(); } catch (_) {} ttsProc = null; }
  app.relaunch();
  quitting = true;              // before-quit уже не нужен — мы только что сохранились
  app.exit(0);
});
// IPC: открыть внешнюю ссылку (страница карточки на сайте) в системном браузере.
ipcMain.handle('win:openExternal', (_e, url) => { try { const u = String(url || ''); if (/^https?:\/\//i.test(u)) shell.openExternal(u); } catch (e) {} });

// Мобильный режим: ужать САМО окно под размер телефона (имитация Termux) и вернуть обратно.
// setContentSize — размер веб-контента (без рамки ОС), т.е. честный «экран телефона».
// Десктопные границы запоминаем, чтобы точно восстановить при выходе.
let desktopBounds = null;
ipcMain.handle('win:mobile', (e, on, size) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return { ok: false };
  if (on) {
    if (!desktopBounds) desktopBounds = win.getBounds();
    const w = (size && size.w) || 412, h = (size && size.h) || 892; // крупный Android по умолчанию
    win.setContentSize(w, h);
    win.center();
  } else if (desktopBounds) {
    win.setBounds(desktopBounds);
    desktopBounds = null;
  }
  return { ok: true };
});

// Надёжное хранилище (ключ API, сборка, пресет): файл в userData через ГЛАВНЫЙ процесс.
// Почему не localStorage: страница у нас file://, а его localStorage в Electron не переживает
// перезапуск надёжно (+ app.exit(0) обрывает дозапись). fs.writeFileSync пишет на диск сразу.
// Синхронный IPC (sendSync) — чтобы рендерер мог читать конфиг сразу при создании ноды.
const storePath = () => path.join(app.getPath('userData'), 'rlm-store.json');
const readStoreAll = () => {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { /* нет файла или битый */ }
  try { return JSON.parse(fs.readFileSync(storePath() + '.bak', 'utf8')); } catch { /* и копии нет */ }
  return {};
};
// Пишем через временный файл: прямая запись при обрыве оставляла обрубок, и файл переставал читаться —
// вместе с ним молча пропадали ключ API и настройки. Прежняя версия остаётся в .bak.
const writeStoreAll = (obj) => {
  try {
    const dst = storePath();
    const tmp = dst + '.tmp';
    try { if (fs.existsSync(dst)) fs.copyFileSync(dst, dst + '.bak'); } catch (_) { /* копия не критична */ }
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, JSON.stringify(obj)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, dst);
  } catch (e) { console.error('store write:', e); }
};
ipcMain.on('store:get', (e, key) => { const all = readStoreAll(); e.returnValue = key ? (all[key] ?? null) : all; });
ipcMain.on('store:set', (e, key, value) => { const all = readStoreAll(); all[key] = value; writeStoreAll(all); e.returnValue = true; });

// IPC-мост к серверу RLM: холст не может звать сервер напрямую (строгий CORS мотора
// у file://-страницы), поэтому запрос идёт через главный процесс — тут CORS не действует.
// Путь: холст → сюда → сервер RLM (8100) → провайдер.
const RLM_SERVER = 'http://127.0.0.1:8100';
ipcMain.handle('rlm:api', async (_e, { path, body }) => {
  try {
    const r = await fetch(RLM_SERVER + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: 'Нет связи с сервером RLM на 8100 (запущен ли он?): ' + String((e && e.message) || e) };
  }
});

// ── OmniVoice TTS (озвучка чата) — ПК-only, тяжёлый python-сервис (модель ~3 ГБ на GPU).
// Поднимаем ЛЕНИВО: только по первому зову из ноды «Озвучка», чтобы модель не грузилась зря.
// Порт 8123; сервис сам грузит модель в фоне (минуты при первом запуске). Звук отдаём рендереру
// base64-ом — CSP страницы (file://) не пускает произвольный file:// в <audio>.
const TTS_SERVER = 'http://127.0.0.1:8123';
const TTS_DIR = path.join(__dirname, '..', 'tts');
let ttsProc = null;
async function ttsHealth() {
  try { const r = await fetch(TTS_SERVER + '/health', { signal: AbortSignal.timeout(800) }); return await r.json(); } catch { return null; }
}
async function ensureTts() {
  const h = await ttsHealth();
  if (h && (h.ready || !h.error)) return;              // готова или ещё грузится — не трогаем
  if (h && h.error && ttsProc) {                       // сервис жив, но модель НЕ загрузилась (напр. чинили файлы) — перезапустим
    try { ttsProc.kill(); } catch (_) { /* игнор */ } ttsProc = null;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (ttsProc) return;                                 // уже поднимается
  const py = path.join(TTS_DIR, 'venv', 'Scripts', 'python.exe');
  const svc = path.join(TTS_DIR, 'service.py');
  if (!fs.existsSync(py) || !fs.existsSync(svc)) throw new Error('TTS не установлен (нет venv/service.py в ' + TTS_DIR + ')');
  // Точность модели выбирается в ноде «Озвучка» и хранится в store (rlm.tts.dtype) — передаём сервису.
  let dtype = 'fp16';
  try { const v = readStoreAll()['rlm.tts.dtype']; if (v === 'fp16' || v === 'bf16' || v === 'fp32') dtype = v; } catch (_) { /* дефолт fp16 */ }
  ttsProc = spawn(py, [svc, '--dtype', dtype], { cwd: TTS_DIR, windowsHide: true, stdio: 'ignore' });
  ttsProc.on('error', (e) => console.error('TTS spawn error:', e));
  ttsProc.on('exit', () => { ttsProc = null; });
}
ipcMain.handle('tts:health', async () => (await ttsHealth()) || { ok: false, ready: false, error: 'сервис не запущен' });
ipcMain.handle('tts:progress', async () => { try { const r = await fetch(TTS_SERVER + '/progress', { signal: AbortSignal.timeout(800) }); return await r.json(); } catch (e) { return null; } });
ipcMain.handle('tts:ensure', async () => { try { await ensureTts(); return { ok: true }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
// Перезапустить TTS-сервис — чтобы модель поднялась в НОВОЙ точности (её ensureTts берёт из store
// по ключу rlm.tts.dtype). Зовётся, когда в ноде «Озвучка» сменили точность (fp16/bf16/fp32).
ipcMain.handle('tts:restart', async () => {
  if (ttsProc) { try { ttsProc.kill(); } catch (_) { /* игнор */ } ttsProc = null; await new Promise((r) => setTimeout(r, 600)); }
  try { await ensureTts(); return { ok: true }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// Сохранить понравившийся голос: пишем WAV (base64 из пробы) в tts/voices/<id>.wav — стабильный файл,
// который потом идёт как образец (ref_audio) для клона. Библиотека голосов хранит путь к нему.
ipcMain.handle('tts:saveVoice', async (_e, { b64, id } = {}) => {
  try {
    if (!b64) return { ok: false, error: 'нет данных голоса' };
    const dir = path.join(TTS_DIR, 'voices');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '');   // только безопасное имя файла
    const file = path.join(dir, (safe || 'voice') + '.wav');
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { ok: true, file };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// Удалить файл сохранённого голоса (когда пресет убирают из библиотеки). Только внутри tts/voices.
ipcMain.handle('tts:deleteVoice', async (_e, { file } = {}) => {
  try {
    const dir = path.join(TTS_DIR, 'voices');
    const abs = path.resolve(file || '');
    if (abs.startsWith(path.resolve(dir)) && fs.existsSync(abs)) fs.unlinkSync(abs);
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// Прочитать аудиофайл образца/пресета в base64 — чтобы «прослушать» его напрямую (без генерации).
const TTS_AUDIO_MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac' };
ipcMain.handle('tts:readAudio', async (_e, { file } = {}) => {
  try {
    if (!file || !fs.existsSync(file)) return { ok: false, error: 'файл образца не найден' };
    const ext = (String(file).split('.').pop() || '').toLowerCase();
    if (!TTS_AUDIO_MIME[ext]) return { ok: false, error: 'не аудиофайл' };
    return { ok: true, b64: fs.readFileSync(file).toString('base64'), mime: TTS_AUDIO_MIME[ext] };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('tts:generate', async (_e, body) => {
  try { await ensureTts(); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  const h = await ttsHealth();
  if (!h) return { ok: false, error: 'TTS-сервис запускается — модель грузится (минуты при первом запуске). Нажми ещё раз чуть позже.' };
  if (!h.ready) return { ok: false, error: h.error ? ('Ошибка загрузки модели: ' + h.error) : 'Модель ещё грузится — подожди и нажми снова.' };
  try {
    const r = await fetch(TTS_SERVER + '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json();
    if (j && j.ok && j.file && fs.existsSync(j.file)) j.audioB64 = fs.readFileSync(j.file).toString('base64');
    return j;
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// ── ПЕРВЫЙ ЗАПУСК: ставим зависимости сервера и показываем это в окне ──────────────
// Раньше первый запуск выглядел как поломка: движок SillyTavern лежит без node_modules, сервер
// падал молча (stdio 'ignore'), а окно через минуту выдавало «Нет связи с сервером RLM». Теперь
// приложение ставит зависимости САМО и рассказывает окну, что делает: сколько пакетов, сколько
// мегабайт, последняя строка npm. Окно рисует это на экране загрузки.
const SERVER_DEPS_TOTAL = 508;    // столько пакетов и
const SERVER_DEPS_MB = 361;       // столько мегабайт весит установленный server/node_modules
const serverDir = () => path.join(__dirname, '..', 'server');

// Состояние отдаём и по запросу (окно спрашивает при старте), и толчком (по мере установки) —
// иначе сообщение, посланное до готовности страницы, просто пропадёт.
let setupState = { active: false, phase: '', done: 0, total: SERVER_DEPS_TOTAL, mb: 0, totalMb: SERVER_DEPS_MB, line: '' };
function setupSend(patch) {
  setupState = { ...setupState, ...patch };
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) { try { win.webContents.send('rlm:setup', setupState); } catch (_) { /* окно закрылось */ } }
}
ipcMain.handle('setup:state', () => setupState);

const depsInstalled = () => fs.existsSync(path.join(serverDir(), 'node_modules', 'express'));

// Сколько пакетов уже распаковано — дёшево (один readdir), поэтому спрашиваем часто.
function countPackages() {
  try {
    const root = path.join(serverDir(), 'node_modules');
    let n = 0;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name[0] === '.') continue;
      if (e.name[0] === '@') { try { n += fs.readdirSync(path.join(root, e.name)).length; } catch (_) {} continue; }
      n++;
    }
    return n;
  } catch (_) { return 0; }
}
// Сколько мегабайт легло на диск — обход всего дерева, поэтому реже (раз в пару секунд).
function dirSizeMb(dir) {
  let bytes = 0;
  const walk = (d) => {
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of items) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { bytes += fs.statSync(p).size; } catch (_) {} }
    }
  };
  walk(dir);
  return Math.round(bytes / 1048576);
}

function installServerDeps() {
  return new Promise((resolve) => {
    setupSend({ active: true, phase: 'deps', done: 0, mb: 0, line: 'первый запуск: ставлю движок' });
    const p = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: serverDir(), shell: true, windowsHide: true });
    const say = (buf) => {                                   // последняя непустая строка npm — чтобы было видно, что идёт работа
      const line = String(buf).split(/\r?\n/).filter((s) => s.trim()).pop();
      if (line) setupSend({ line: line.trim().slice(0, 120) });
    };
    if (p.stdout) p.stdout.on('data', say);
    if (p.stderr) p.stderr.on('data', say);
    const tick = setInterval(() => setupSend({ done: countPackages() }), 500);
    const tickMb = setInterval(() => setupSend({ mb: dirSizeMb(path.join(serverDir(), 'node_modules')) }), 2500);
    const finish = (ok) => {
      clearInterval(tick); clearInterval(tickMb);
      setupSend({ done: countPackages(), mb: dirSizeMb(path.join(serverDir(), 'node_modules')) });
      resolve(ok);
    };
    p.on('error', () => finish(false));
    p.on('close', (code) => finish(code === 0));
  });
}

// Сам поднимаем сервер RLM, если он ещё не запущен — тогда «Запустить RLM.bat»
// одним кликом даёт и сервер, и холст. Если сервер уже поднят (напр. запущен
// вручную при разработке) — не трогаем его.
let serverProc = null;
async function ensureServer() {
  try {
    await fetch(RLM_SERVER + '/', { signal: AbortSignal.timeout(800) });
    return; // отвечает — сервер уже есть
  } catch (_) { /* не поднят — запустим ниже */ }
  if (!depsInstalled()) {                                  // первый запуск: движка ещё нет на диске
    const ok = await installServerDeps();
    if (!ok) { setupSend({ phase: 'error', line: 'не удалось поставить зависимости — открой server/ и выполни: npm install --omit=dev' }); return; }
  }
  setupSend({ active: setupState.active, phase: 'server', line: 'поднимаю сервер' });
  try {
    const serverDir = path.join(__dirname, '..', 'server');
    // stdio: 4-м дескриптором добавляем 'ipc' — канал сообщений между Electron и сервером. Через него
    // сервер просит перезапуск приложения, когда «Перезапуск» нажали С ТЕЛЕФОНА (там нет моста window.rlm):
    // телефон → /api/rlm/app/restart → сервер process.send({rlm:'relaunch'}) → обработчик ниже. См. endpoints/rlm-app.js
    serverProc = spawn('node', ['server.js'], { cwd: serverDir, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    serverProc.on('error', (e) => console.error('Не удалось запустить сервер RLM:', e));
    // Сервер попросил перезапуск (кнопка на телефоне) → тот же relaunch, что и кнопка «Перезапуск» на ПК.
    serverProc.on('message', (m) => { if (m && m.rlm === 'relaunch') { app.relaunch(); app.exit(0); } });
    if (setupState.active) {                               // ждём, пока сервер реально ответит, и гасим экран установки
      (async () => {
        for (let i = 0; i < 240; i++) {
          try { await fetch(RLM_SERVER + '/', { signal: AbortSignal.timeout(1000) }); setupSend({ active: false, phase: 'done' }); return; }
          catch (_) { await new Promise((r) => setTimeout(r, 500)); }
        }
      })();
    }
  } catch (e) {
    console.error('Не удалось запустить сервер RLM:', e);
  }
}

app.whenReady().then(async () => {
  // Свой AppUserModelID — иначе Windows группирует окно под electron.exe и показывает
  // дефолтный значок Electron на таскбаре вместо нашего.
  if (process.platform === 'win32') app.setAppUserModelId('com.rlm.roleplaymachine');
  // Окно — ПЕРВЫМ: на первом запуске установка движка идёт минуты, и человек должен видеть процесс,
  // а не пустой экран, который через минуту скажет «нет связи».
  createWindow();
  ensureServer();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => { // гасим сервер/TTS, если это мы их подняли
  if (serverProc) { try { serverProc.kill(); } catch (_) { /* игнор */ } serverProc = null; }
  if (ttsProc) { try { ttsProc.kill(); } catch (_) { /* игнор */ } ttsProc = null; }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
