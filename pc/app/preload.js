// preload.js — мостик между изолированным рендерером и главным процессом.
// Наружу отдаём только две безопасные команды: закрыть и перезапустить.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rlm', {
  close: () => ipcRenderer.invoke('app:close'),
  restart: () => ipcRenderer.invoke('app:restart'),
  // Мобильный режим: ужать окно под размер телефона (on=true) / вернуть десктопный (on=false).
  setMobile: (on, size) => ipcRenderer.invoke('win:mobile', on, size),
  openUrl: (url) => ipcRenderer.invoke('win:openExternal', url),
  // Зов серверных маршрутов RLM (нода API): rlm.api('/api/rlm/models', {...}) -> ответ сервера.
  api: (path, body) => ipcRenderer.invoke('rlm:api', { path, body }),
  // Выход/перезапуск: главный процесс просит окно дописать состояние и ждёт ответа.
  onFlush: (fn) => ipcRenderer.on('app:flush', () => fn()),
  flushDone: () => ipcRenderer.send('app:saved'),
  // Надёжное хранилище в файле (переживает перезапуск): синхронно, чтобы читать сразу при старте.
  store: {
    get: (key) => ipcRenderer.sendSync('store:get', key),
    set: (key, value) => ipcRenderer.sendSync('store:set', key, value),
  },
  // OmniVoice TTS (нода «Озвучка»): ленивый подъём сервиса + генерация. Возвращает {ok, audioB64, ...}.
  tts: {
    generate: (body) => ipcRenderer.invoke('tts:generate', body),
    health: () => ipcRenderer.invoke('tts:health'),
    ensure: () => ipcRenderer.invoke('tts:ensure'),
    progress: () => ipcRenderer.invoke('tts:progress'),
    restart: () => ipcRenderer.invoke('tts:restart'),   // перезапуск сервиса (после смены точности fp16/bf16/fp32)
    saveVoice: (b64, id) => ipcRenderer.invoke('tts:saveVoice', { b64, id }),   // сохранить понравившийся голос в tts/voices/<id>.wav → {ok, file}
    deleteVoice: (file) => ipcRenderer.invoke('tts:deleteVoice', { file }),     // удалить файл сохранённого голоса
    readAudio: (file) => ipcRenderer.invoke('tts:readAudio', { file }),         // прочитать WAV образца в base64 — для «прослушать пресет»
  },
  // Абсолютный путь выбранного файла (для образца голоса): новые Electron — webUtils, старые — File.path.
  pathForFile: (file) => { try { const { webUtils } = require('electron'); return webUtils.getPathForFile(file); } catch (e) { return (file && file.path) || ''; } },
});
