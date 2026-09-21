// creator.js — вкладка стартового меню «✨ Создатель»: карточка персонажа (и позже лорбук)
// пишутся моделью по полям. Перенос идей расширения Character Creator (CREC) на наш код:
// один запрос = одно поле, поле видит уже написанные, алгоритм сборки = переставляемые блоки промта.
//
// Живёт отдельным файлом (renderer.js и так на 2 МБ), функции глобальные — renderer.js зовёт
// openCreator() из обработчика вкладок. Всё, что нужно от renderer.js: lsGet/lsSet (серверная база),
// esc, rlmApi, rlmPrompt, apiCreds, CHAR_LIB_KEY, registerCharacter, getWorldbooks/getWorldbookEntries,
// startMenuRender, trTranslate (переводчик), OPTIONS_PARAMS (набор сэмплеров ноды «Опции»).

// ── Поля карточки ──
const CR_FIELDS = [
  { id: 'name', label: 'Имя', single: true },
  { id: 'description', label: 'Описание' },
  { id: 'personality', label: 'Личность' },
  { id: 'scenario', label: 'Сценарий' },
  { id: 'first_mes', label: 'Первое сообщение', greet: true },
  { id: 'mes_example', label: 'Примеры диалогов' },
];
const CR_FIELD_EN = { name: 'Name', description: 'Description', personality: 'Personality', scenario: 'Scenario', first_mes: 'First message', mes_example: 'Example dialogue' };

// Сэмплеры — набор ноды «Опции» (имена и порядок оттуда), но первые два значения свои:
// 300 токенов ответа режет описание на середине. Настоящие дефолты — после живого прогона.
const CR_OPT_DEF = ['1024', '16384', '0.7', '0', '0', '40', '0.5', '1.2', '0', '-1'];
function crOptParams() { return (typeof OPTIONS_PARAMS !== 'undefined' ? OPTIONS_PARAMS : []).map((p) => p.name); }
const CR_OPT_PARAM = ['max_tokens', null, 'temperature', 'frequency_penalty', 'presence_penalty', 'top_k', 'top_p', 'repetition_penalty', 'min_p', 'seed'];

// ── Шаблоны промтов. Текст уходит модели (по-английски [[rlm-prompts-english]]), комментарий — для человека.
// Подстановки простые: {{имя}} — никакого шаблонизатора, списки собираются кодом.
const CR_TPL_DEFAULTS = {
  guide: { name: 'Гайд: как писать карточку', grp: 'fields', vars: ['{{char}}', '{{user}}'],
    com: 'Правила хорошей карточки по замеру топ-50 Chub: описание маленькое, приветствие — половина карточки, биографии нет. Модель читает гайд перед каждым полем. ⚠ Текст — черновик: дефолтом станет только после живого прогона.',
    text: 'You are writing one field of a roleplay character card.\nWhat good cards do:\n- The card is small: description around 500 tokens, greeting around 240. No life story; the past only where it drives the present.\n- Description opens with one sentence: who this is. Then what the model must hold every turn: look, voice, wants, how {{char}} treats {{user}}.\n- Write a trait together with how it shows: not "shy" but "answers with a shrug and looks at the floor".\n- Prose by default. Use names instead of piling up pronouns.\n- The greeting is half the card: place and moment, what {{char}} is doing right now, a first line in the declared voice, and a turn toward {{user}}. It usually ends on an image, not on a question.\n- Personality and scenario stay short.' },
  cards: { name: 'Карточки из библиотеки', grp: 'fields', vars: ['{{cards}}'],
    com: 'Выбранные персонажи целиком — когда пишешь родню, соперника или «такого же, но…». Ничего не выбрано — блок не уходит.',
    text: '## Reference characters\n{{cards}}' },
  books: { name: 'Ворлд-буки', grp: 'fields', vars: ['{{books}}'],
    com: 'Записи выбранных ворлд-буков (только включённые) — чтобы персонаж жил в этом мире: места, фракции, правила. Ничего не выбрано — блок не уходит.',
    text: '## The world\n{{books}}' },
  fields: { name: 'Уже написанные поля', grp: 'fields', vars: ['{{fields}}', '{{notes}}'],
    com: 'Всё, что уже есть в карточке, плюс заметки. Поэтому каждое новое поле согласовано с остальными.',
    text: '## The card so far\n{{fields}}\n{{notes}}' },
  format: { name: 'Формат ответа', grp: 'fields', vars: ['{{format}}'],
    com: 'Подставляет инструкцию выбранного формата (Текст / XML / JSON) — чтобы ответ модели можно было чисто вырезать в поле.',
    text: '{{format}}' },
  fmt_text: { name: 'Формат: чистый текст', grp: 'fields', vars: [],
    com: 'Просит только текст поля. Умным моделям хватает; слабые иногда начинают с «Вот описание:» — тогда бери XML.',
    text: 'Reply with the text of the field only. No title, no quotes, no comments.' },
  fmt_xml: { name: 'Формат: XML', grp: 'fields', vars: [],
    com: 'Просит ответ внутри тега <response>. Вырезается надёжнее всего — стоит по умолчанию.',
    text: 'Wrap the text of the field in a single <response></response> tag. Nothing outside the tag.' },
  fmt_json: { name: 'Формат: JSON', grp: 'fields', vars: [],
    com: 'Просит {"response": "…"}. Для моделей, которые хорошо держат JSON.',
    text: 'Reply with JSON only: {"response": "<text of the field>"}' },
  task: { name: 'Задача: напиши поле', grp: 'fields', vars: ['{{field}}', '{{instruction}}', '{{fieldInstruction}}'],
    com: 'Последнее сообщение запроса: какое поле писать + общая инструкция + инструкция к полю. Без него модель не знает, что от неё нужно.',
    text: 'Write the "{{field}}" field of the card.\n{{instruction}}\n{{fieldInstruction}}' },
  rev_task: { name: 'Чат-правка: роль редактора', grp: 'revise', vars: ['{{field}}'],
    com: 'Начало каждой сессии правки: модель — редактор карточки. Отвечает коротко и на твоём языке, поля оставляет по-английски, фокус — вся карточка или одно поле.',
    text: 'You are a card editor working with the author on the card below.\nFocus: {{field}}.\nTalk to the author briefly, in the author\'s language. Card fields stay in English.\nChange only what the author asks for and say plainly what you changed.' },
  rev_json: { name: 'Чат-правка: формат ответа', grp: 'revise', vars: ['{{schema}}'],
    com: 'Как модель возвращает правку: объяснение + список изменений. Разбирается кодом, поэтому формат менять осторожно — иначе правки не применятся.',
    text: 'Reply with one JSON object and nothing else, in a ```json code block:\n{{schema}}' },
  lore_guide: { name: 'Лорбук: как писать записи', grp: 'lore', vars: [],
    com: 'Правила записи: один концепт на запись, коротко, ключи — слова, которые реально прозвучат в сцене. Цифры (1–4 ключа, 100–400 слов) — эвристика автора lorecard, никем не замерена: держим как ориентир, не как порог.',
    text: 'You write World Info (lorebook) entries for a roleplay setting.\nRules:\n- One entry = one concept: a place, a faction, a law of the world, a person, an event.\n- Keep an entry short and factual: what the model must know when the topic comes up. No prose flourishes.\n- Keys are words that would actually be SPOKEN in a scene where this entry matters: proper names, place names, rare distinctive words. Never generic words (man, woman, city, magic, love).\n- 1 to 4 keys per entry. Around 100-400 words of content.\n- Do not repeat what the existing entries already say.' },
  lore_book: { name: 'Лорбук: что уже есть в книге', grp: 'lore', vars: ['{{book}}'],
    com: 'Модель видит имена, ключи и начало текста уже существующих записей — чтобы не предлагать то же самое во второй раз.',
    text: '## Entries already in the book\n{{book}}' },
  lore_black: { name: 'Лорбук: отказы', grp: 'lore', vars: ['{{black}}'],
    com: 'Записи, которые ты отклонил. Уходят в следующий запрос, чтобы модель их не предлагала снова (приём World Info Recommender).',
    text: '## Rejected before — do not suggest again\n{{black}}' },
  lore_task: { name: 'Лорбук: задача', grp: 'lore', vars: ['{{task}}', '{{count}}'],
    com: 'Твоё задание и сколько записей просить за раз. Много сразу — модель хуже держит формат; 3–5 в самый раз.',
    text: 'Suggest {{count}} new entries.\nAuthor\'s request: {{task}}' },
  lore_json: { name: 'Лорбук: формат ответа', grp: 'lore', vars: [],
    com: 'Как модель возвращает записи: имя, ключи, текст. Разбирается кодом — формат менять осторожно.',
    text: 'Reply with one JSON object and nothing else, in a ```json code block:\n{\n  "entries": [ { "name": "<short title>", "keys": "<key1, key2>", "content": "<entry text>" } ]\n}' },
  xml_desc: { name: 'Описание → XML-блоки', grp: 'fields', vars: ['{{char}}', '{{user}}'],
    com: 'Просит разложить описание по XML-блокам: <Appearance> с полями Height / Build / Eyes / Hair / Clothing, плюс что нужно (шрамы, татуировки, аксессуары). Оговорка: у топ-50 проза в 33 картах против 6 структурных — стоит сравнить прогоном.',
    text: 'Translate the Description block into XML structure\nExample:\n> <Appearance>\nHeight: tall.\nBuild: slim woman.\nEyes: bright green eyes.\nHair: bronze hair.\nClothing: long dress.\n(If necessary, you can add fields for scars, tattoos, accessories, or anything else that is necessary in each specific case.)\n</Appearance>' },
  xml_pers: { name: 'Личность → XML-блоки', grp: 'fields', vars: ['{{char}}', '{{user}}'],
    com: 'То же для личности: <Personality> с блоками Character traits, Type, Emotions, Quirks/Habits, Likes, Dislikes, Secret, Relationships. Блоки можно добавлять и убирать (Fears, Habits, Goals).',
    text: 'Translate the Personality block into XML structure\nExample:\n> <Personality>\nCharacter traits: Very shy and inward. Anxious around people but shows quiet resolve. Kind and watchful, she senses others\' feelings easily.\nType: The Shy Loner Who Wants a Bond\n\nEmotions: When nervous, her voice gets quiet and her cheeks turn red. If turned down, she pulls back fully, says sorry many times, then leaves.\n\nQuirks/Habits: Twists her sweater hem when worried. Hums to herself when alone.\n\nLikes: Calm nights with tea and anime. Small kindnesses like smiles in the hall.\n\nDislikes: Busy places or loud sounds. Being overlooked or brushed off.\n\nSecret: She has mild depression from losing family recently.\n\nRelationships: Sees {{user}} as a safe, close choice for a link.\n\n(If necessary, additional elements such as "Fears," "Habits," or "Goals" should be added or removed. Any block is allowed if it helps reveal the character.)\n</Personality>' },
};
const CR_ALGO_DEFAULTS = {
  base: { name: 'Базовый', builtin: true,
    com: 'Заводской порядок: гайд → карточки → ворлд-буки → уже написанное → формат → задача. Подходит почти всегда.',
    blocks: [
      { tpl: 'guide', on: true, role: 'system' },
      { tpl: 'cards', on: true, role: 'system' },
      { tpl: 'books', on: true, role: 'system' },
      { tpl: 'fields', on: true, role: 'system' },
      { tpl: 'format', on: true, role: 'system' },
      { tpl: 'task', on: true, role: 'user' },
    ] },
  noguide: { name: 'Свой стиль (без гайда)',
    com: 'Гайд выключен: модель пишет только по твоей общей инструкции и заметкам. Для карточек в своём формате.',
    blocks: [
      { tpl: 'guide', on: false, role: 'system' },
      { tpl: 'cards', on: true, role: 'system' },
      { tpl: 'books', on: true, role: 'system' },
      { tpl: 'fields', on: true, role: 'system' },
      { tpl: 'format', on: true, role: 'system' },
      { tpl: 'task', on: true, role: 'user' },
    ] },
};
const CR_INSTR_DEFAULTS = {
  base: { name: 'Базовая', builtin: true,
    com: 'По умолчанию: опираться на заметки и уже написанные поля, придумывать смело, но без противоречий.',
    text: 'Write the field from the notes and the fields already written. Be inventive, stay consistent.' },
  rework: { name: 'Переделка загруженной',
    com: 'Для готовой карточки из библиотеки: сохранить суть персонажа, убрать воду и биографию.',
    text: 'Keep the loaded character\'s core. Rewrite the field tighter: no backstory, traits shown through behavior.' },
};
const CR_NOTE_HINT = 'Шпаргалка для модели, пока пишется карточка: идея, прошлое, внешность — всё, что поможет написать поля.\nВ сохранённую карточку шпаргалка не входит: в игре остаётся только то, что в полях.';
const CR_KEY = 'rlm.creator';

// ── Состояние. Черновик и настройки живут в серверной базе (одна сессия на все устройства).
let crSt = null;
function crDefaults() {
  return {
    mode: 'char',
    fields: { name: { v: '', i: '' }, description: { v: '', i: '' }, personality: { v: '', i: '' }, scenario: { v: '', i: '' }, mes_example: { v: '', i: '' } },
    greets: [{ v: '', i: '' }], gIdx: 0,
    notes: [{ t: 'Идея', v: '' }], notesOpen: true,
    loadedId: '',
    instr: JSON.parse(JSON.stringify(CR_INSTR_DEFAULTS)), instrCur: 'base',
    model: 0, apiPreset: '', opts: CR_OPT_DEF.slice(), format: 'xml',
    trBy: 'yandex', trModel: 0, trOpts: CR_OPT_DEF.slice(),
    tpls: JSON.parse(JSON.stringify(CR_TPL_DEFAULTS)),
    algos: JSON.parse(JSON.stringify(CR_ALGO_DEFAULTS)), algoCur: 'base',
    ctxCards: [], ctxBooks: [],
    loreTarget: '', loreTask: '', loreCount: 4, loreSug: [], loreBlack: [],
    side: 'build',
  };
}
function crLoad() {
  if (crSt) return crSt;
  const saved = (typeof lsGet === 'function') ? lsGet(CR_KEY, null) : null;
  crSt = crDefaults();
  if (saved && typeof saved === 'object') {
    Object.keys(crSt).forEach((k) => { if (saved[k] !== undefined && saved[k] !== null) crSt[k] = saved[k]; });
    // заводские шаблоны/алгоритмы могли появиться позже сохранённых — доливаем недостающие
    Object.entries(CR_TPL_DEFAULTS).forEach(([k, v]) => { if (!crSt.tpls[k]) crSt.tpls[k] = JSON.parse(JSON.stringify(v)); });
    Object.entries(CR_ALGO_DEFAULTS).forEach(([k, v]) => { if (!crSt.algos[k]) crSt.algos[k] = JSON.parse(JSON.stringify(v)); });
    if (!crSt.algos[crSt.algoCur]) crSt.algoCur = 'base';
    if (!crSt.instr[crSt.instrCur]) crSt.instrCur = 'base';
  }
  crSt.busy = {}; crSt.trPrev = {};                      // эфемерное: не сохраняем
  return crSt;
}
let _crSaveT = null;
function crSave() {
  if (!crSt) return;
  crSaved('● сохраняю…');
  clearTimeout(_crSaveT);
  _crSaveT = setTimeout(() => {
    const { busy, trPrev, ...keep } = crSt;               // эфемерное в базу не кладём
    if (typeof lsSet === 'function') lsSet(CR_KEY, keep);
    crSaved('✓ черновик сохранён');
  }, 400);
}
function crSaved(txt) { const e = document.getElementById('cr-saved'); if (e) e.textContent = txt; }

// ── Мелкие помощники ──
function crEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function crQ(s) { return document.querySelector(s); }
function crQA(s) { return [...document.querySelectorAll(s)]; }
function crKey(fid) { return fid === 'first_mes' ? 'greet:' + crSt.gIdx : fid; }
function crLabel(key) {
  if (String(key).startsWith('greet:')) { const i = +String(key).slice(6); return i === 0 ? 'Первое сообщение' : 'Приветствие ' + (i + 1); }
  return (CR_FIELDS.find((f) => f.id === key) || {}).label || key;
}
function crEn(key) {
  if (String(key).startsWith('greet:')) { const i = +String(key).slice(6); return i === 0 ? 'First message' : 'Alternate greeting ' + i; }
  return CR_FIELD_EN[key] || key;
}
function crGet(fid) { return fid === 'first_mes' ? ((crSt.greets[crSt.gIdx] || {}).v || '') : crSt.fields[fid].v; }
function crSet(fid, v) { if (fid === 'first_mes') { if (crSt.greets[crSt.gIdx]) crSt.greets[crSt.gIdx].v = v; } else crSt.fields[fid].v = v; }
function crGetI(fid) { return fid === 'first_mes' ? ((crSt.greets[crSt.gIdx] || {}).i || '') : crSt.fields[fid].i; }
function crSetI(fid, v) { if (fid === 'first_mes') { if (crSt.greets[crSt.gIdx]) crSt.greets[crSt.gIdx].i = v; } else crSt.fields[fid].i = v; }
function crLib() { return (typeof lsGet === 'function' && typeof CHAR_LIB_KEY !== 'undefined') ? (lsGet(CHAR_LIB_KEY, []) || []) : []; }
function crLoadedChar() { return crLib().find((c) => c.id === crSt.loadedId) || null; }
function crBooks() { return (typeof getWorldbooks === 'function') ? (getWorldbooks() || []) : []; }

let _crToastT = null;
function crToast(html) {
  const t = document.getElementById('cr-toast'); if (!t) return;
  t.innerHTML = html; t.classList.remove('hidden');
  clearTimeout(_crToastT); _crToastT = setTimeout(() => t.classList.add('hidden'), 4200);
}
function crAutogrow(t) { if (!t || !t.offsetWidth) return; t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight, 46) + 'px'; }

// ── Окна (свои: в приложении общего confirm нет) ──
function crModal(html, cls) {
  const m = document.getElementById('cr-modal'); if (!m) return;
  const d = m.querySelector('.cr-dlg'); d.className = 'cr-dlg' + (cls ? ' ' + cls : '');
  d.innerHTML = html; m.classList.remove('hidden');
}
function crCloseModal() { const m = document.getElementById('cr-modal'); if (m) { m.classList.add('hidden'); m.querySelector('.cr-dlg').innerHTML = ''; } }
function crHead(title) { return '<div class="cr-dlg-hd"><span>' + crEsc(title) + '</span><button class="cr-ib" data-cr="modal-close">✕</button></div>'; }
function crConfirm(title, html, okLabel, onOk) {
  crModal(crHead(title) + '<div class="cr-dlg-bd"><div style="line-height:1.6">' + html + '</div></div>'
    + '<div class="cr-dlg-ft"><button class="cr-btn" data-cr="modal-close">Отмена</button><button class="cr-primary" id="cr-dlg-ok">' + crEsc(okLabel) + '</button></div>', 'small');
  const ok = document.getElementById('cr-dlg-ok');
  if (ok) ok.onclick = () => { crCloseModal(); onOk(); };
}
function crAsk(title, initial, cb) {                       // имя/название — общий мини-диалог приложения
  if (typeof rlmPrompt === 'function') rlmPrompt(title, initial, (v) => { if (v) cb(v); });
  else { const v = window.prompt(title, initial); if (v) cb(v.trim()); }
}

// ══════════════ МОДЕЛЬ: откуда берём подключение ══════════════
// Ноды API ТЕКУЩЕЙ сборки на холсте (в режиме пресета это и есть активный пресет). Ключи уже в них.
function crApiNodes() {
  return crQA('.node-api').filter((n) => !n.classList.contains('nvis') && !n.closest('.chat-vision')).map((el) => {
    const lbl = ((el.querySelector('.node-head .label') || {}).textContent || 'API').trim();
    const c = (typeof apiCreds === 'function') ? apiCreds(el) : { base: '', key: '', model: '' };
    return { el, label: lbl + (c.model ? ' — ' + c.model : ' — модель не задана'), base: c.base, key: c.key, model: c.model };
  });
}
function crApiPresets() { return (typeof getApiPresets === 'function') ? (getApiPresets() || []) : []; }
// Действующее подключение: выбранный пресет API перебивает выбор ноды (как в самой ноде «API»).
function crApi() {
  if (crSt.apiPreset) {
    const p = crApiPresets().find((x) => x.id === crSt.apiPreset);
    if (p && p.api) {
      const key = (typeof apiKeyFor === 'function' ? apiKeyFor(p.api.provider) : '') || ((typeof lsGet === 'function' ? (lsGet('rlm.apiConfig', {}) || {}) : {}).key || '');
      return { base: p.api.base, key, model: p.api.model, from: 'пресет «' + p.name + '»' };
    }
  }
  const nodes = crApiNodes();
  const n = nodes[crSt.model] || nodes[0];
  return n ? { base: n.base, key: n.key, model: n.model, from: n.label } : null;
}
function crParams(opts) {
  const p = {};
  (opts || crSt.opts).forEach((v, i) => {
    const name = CR_OPT_PARAM[i]; if (!name) return;                 // «Контекст, ток.» в запрос не уходит
    const s = String(v == null ? '' : v).trim(); if (s === '') return;
    const num = Number(s); if (!isFinite(num)) return;
    if (name === 'seed' && num < 0) return;                          // -1 = случайный, не шлём
    p[name] = num;
  });
  p.reasoning = { enabled: false };                                  // карточку пишем без рассуждений
  return p;
}

// ══════════════ СБОРКА ПРОМТА ══════════════
function crCardsText() {
  const lib = crLib();
  return crSt.ctxCards.map((id) => {
    const c = lib.find((x) => x.id === id); if (!c) return '';
    const d = c.card || {};
    return '### ' + (d.name || c.name || '') + '\n' + [d.description, d.personality && ('Personality: ' + d.personality), d.scenario && ('Scenario: ' + d.scenario), d.first_mes && ('First message: ' + d.first_mes)].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n');
}
function crBooksText() {
  return crSt.ctxBooks.map((id) => {
    const w = crBooks().find((x) => x.id === id); if (!w) return '';
    const entries = (typeof getWorldbookEntries === 'function' ? (getWorldbookEntries(id) || []) : []).filter((e) => e && !e.disable && (e.content || '').trim());
    if (!entries.length) return '';
    return '### ' + (w.name || '') + '\n' + entries.map((e) => '- ' + (e.comment || e.name || '') + (e.keys || e.key ? ' (keys: ' + [].concat(e.keys || e.key || []).join(', ') + ')' : '') + ': ' + String(e.content).trim()).join('\n');
  }).filter(Boolean).join('\n\n');
}
function crFieldsText(targetKey) {
  const out = [];
  CR_FIELDS.filter((f) => !f.greet).forEach((f) => { const v = crSt.fields[f.id].v.trim(); if (v) out.push('- ' + CR_FIELD_EN[f.id] + ': ' + v); });
  crSt.greets.forEach((g, i) => {
    const v = (g.v || '').trim(); if (!v) return;
    if (crSt.noOtherGreets && String(targetKey).startsWith('greet:') && ('greet:' + i) !== targetKey) return;
    out.push('- ' + crEn('greet:' + i) + ': ' + v);
  });
  return out.join('\n');
}
function crNotesText() {
  const n = crSt.notes.filter((x) => (x.v || '').trim()).map((x) => '- ' + (x.t || 'note') + ': ' + x.v.trim());
  return n.length ? '## Author\'s notes (not part of the card)\n' + n.join('\n') : '';
}
// Подстановка простая: только {{имя}}. Списки готовит код (шаблонизатора в приложении нет).
function crFill(text, data) {
  return String(text == null ? '' : text).replace(/\{\{(\w+)\}\}/g, (m, k) => (data[k] !== undefined ? String(data[k]) : m));
}
function crBuildMessages(targetKey, continueFrom) {
  const algo = crSt.algos[crSt.algoCur] || crSt.algos.base;
  const fmtTpl = crSt.tpls[{ text: 'fmt_text', xml: 'fmt_xml', json: 'fmt_json' }[crSt.format]] || { text: '' };
  const charName = (crSt.fields.name.v || '').trim() || '{{char}}';
  const data = {
    char: charName, user: '{{user}}',
    cards: crCardsText(), books: crBooksText(),
    fields: crFieldsText(targetKey) || '(nothing written yet)', notes: crNotesText(),
    format: fmtTpl.text,
    field: crEn(targetKey),
    instruction: (crSt.instr[crSt.instrCur] || {}).text ? 'General instruction: ' + crSt.instr[crSt.instrCur].text.trim() : '',
    fieldInstruction: '',
  };
  const fid = String(targetKey).startsWith('greet:') ? 'first_mes' : targetKey;
  const fi = (String(targetKey).startsWith('greet:') ? ((crSt.greets[+String(targetKey).slice(6)] || {}).i || '') : crSt.fields[fid].i).trim();
  data.fieldInstruction = fi ? 'For this field: ' + fi : '';
  const messages = [];
  algo.blocks.forEach((b) => {
    if (!b.on) return;
    const tpl = crSt.tpls[b.tpl]; if (!tpl) return;
    if (b.tpl === 'cards' && !data.cards) return;                     // нечего слать — блок пропускаем
    if (b.tpl === 'books' && !data.books) return;
    const content = crFill(tpl.text, data).replace(/\n{3,}/g, '\n\n').trim();
    if (content) messages.push({ role: b.role || 'system', content });
  });
  if (continueFrom) messages.push({ role: 'assistant', content: crSt.format === 'xml' ? '<response>' + continueFrom : continueFrom });
  return messages;
}
function crParse(raw) {
  let t = String(raw == null ? '' : raw).trim();
  const fence = t.match(/```(?:\w+)?\s*([\s\S]*?)```/); if (fence) t = fence[1].trim();
  if (crSt.format === 'xml') {
    const m = t.match(/<response>([\s\S]*?)<\/response>/i) || t.match(/<response>([\s\S]*)/i);
    if (m) return m[1].trim();
  }
  if (crSt.format === 'json') {
    try { const o = JSON.parse(t); if (o && typeof o.response === 'string') return o.response.trim(); } catch (_) {}
    const m = t.match(/"response"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/); if (m) return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
  }
  return t.replace(/^<response>/i, '').replace(/<\/response>$/i, '').trim();
}

// ══════════════ ГЕНЕРАЦИЯ ПОЛЯ ══════════════
async function crGenField(fid, continueIt) {
  const gi = crSt.gIdx, key = fid === 'first_mes' ? 'greet:' + gi : fid;
  if (crSt.busy[key]) return;
  const api = crApi();
  if (!api || !api.model) return crToast('Нет ноды «API» с моделью. Выбери подключение в «⚙ Сборке».');
  const base = continueIt ? crGet(fid) : '';
  crSt.busy[key] = true; crRenderField(fid);
  try {
    const messages = crBuildMessages(key, continueIt ? base : '');
    const r = await rlmApi('/api/rlm/generate', { _ctxKey: 'creator.field', base: api.base, key: api.key, model: api.model, messages, params: crParams() });
    const raw = (r && (r.text || r.content)) || '';
    if (!raw) throw new Error((r && r.error) || 'модель ответила пусто');
    const out = crParse(raw);
    if (!out) throw new Error('в ответе не нашлось текста поля');
    if (fid === 'first_mes') { if (crSt.greets[gi]) crSt.greets[gi].v = (continueIt ? base : '') + (continueIt ? '\n\n' : '') + out; }
    else crSt.fields[fid].v = (continueIt ? base + '\n\n' : '') + out;
    crSave();
  } catch (e) {
    crToast('Не вышло: ' + crEsc((e && e.message) || e));
  } finally {
    crSt.busy[key] = false; crRenderField(fid);
  }
}
async function crGenNote(i) {
  const k = 'note:' + i; if (crSt.busy[k]) return;
  const api = crApi(); if (!api || !api.model) return crToast('Нет ноды «API» с моделью.');
  const n = crSt.notes[i]; if (!n) return;
  crSt.busy[k] = true; crRenderForm();
  try {
    const sys = 'You are helping an author prepare notes for a roleplay character card. Notes are working material: they never go into the card itself.';
    const user = 'Card so far:\n' + (crFieldsText('') || '(empty)') + '\n' + crNotesText()
      + '\n\nWrite the note "' + (n.t || 'note') + '" for this character: short, concrete, only what helps to write the card fields. Reply with the note text only.';
    const r = await rlmApi('/api/rlm/generate', { _ctxKey: 'creator.note', base: api.base, key: api.key, model: api.model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], params: crParams() });
    const out = crParse((r && (r.text || r.content)) || '');
    if (!out) throw new Error((r && r.error) || 'пусто');
    if (crSt.notes[i]) crSt.notes[i].v = out;
    crSave();
  } catch (e) { crToast('Не вышло: ' + crEsc((e && e.message) || e)); }
  finally { crSt.busy[k] = false; crRenderForm(); }
}

// ══════════════ ПЕРЕВОД (свой выбор: Яндекс или ИИ своей моделью) ══════════════
async function crTranslate(text, to) {
  const src = String(text == null ? '' : text); if (!src.trim()) return src;
  if (crSt.trBy === 'ai') {
    const nodes = crApiNodes(); const n = nodes[crSt.trModel] || nodes[0];
    if (!n || !n.model) { crToast('Для перевода через ИИ выбери модель в «⚙ Сборке».'); return null; }
    const sys = to === 'ru'
      ? 'You are a translator. Translate the text into Russian. Keep formatting, markup, asterisks and {{macros}} untouched. Reply with the translation only.'
      : 'You are a translator. Translate the text into English. Keep formatting, markup, asterisks and {{macros}} untouched. Reply with the translation only.';
    const r = await rlmApi('/api/rlm/generate', { _ctxKey: 'creator.tr', base: n.base, key: n.key, model: n.model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: src }], params: crParams(crSt.trOpts) });
    const out = (r && (r.text || r.content)) || '';
    return out ? String(out).trim() : null;
  }
  const r = await rlmApi('/api/rlm/translate', { provider: 'yandex', text: src, to });
  return (r && r.ok) ? r.text : null;
}
async function crTrPreview(fid, btn) {
  const key = crKey(fid);
  if (crSt.trPrev[key] != null) { delete crSt.trPrev[key]; return crRenderField(fid); }
  btn.classList.add('busy');
  const t = await crTranslate(crGet(fid), 'ru');
  btn.classList.remove('busy');
  if (t == null) { btn.classList.add('err'); setTimeout(() => btn.classList.remove('err'), 1200); return; }
  crSt.trPrev[key] = t; crRenderField(fid);
}
async function crTrReplace(fid, btn) {
  const key = crKey(fid);
  if (crSt.trPrev[key] != null) { delete crSt.trPrev[key]; crRenderField(fid); }
  btn.classList.add('busy');
  const t = await crTranslate(crGet(fid), 'en');
  btn.classList.remove('busy');
  if (t == null) { btn.classList.add('err'); setTimeout(() => btn.classList.remove('err'), 1200); return; }
  crSet(fid, t); crSave(); crRenderField(fid);
}

// ══════════════ ЭКРАН ══════════════
function openCreator() {
  crLoad();
  smView = 'create';
  ['sm-grid-view', 'sm-char-view', 'sm-books-view', 'sm-browse-view'].forEach((id) => { const e = document.getElementById(id); if (e) e.classList.add('hidden'); });
  const host = document.getElementById('sm-create-view'); if (!host) return;
  host.classList.remove('hidden');
  if (!host.dataset.built) { crBuildView(host); host.dataset.built = '1'; }
  crRenderBar(); crRenderForm(); crRenderBuild(); crRenderAlgo(); crShowSide(crSt.side || 'build');
  updateTabs();
}
function crBuildView(host) {
  host.innerHTML = `
    <div class="cr-bar">
      <div class="cr-seg" id="cr-mode">
        <button data-cr="mode" data-v="char" class="on" title="Карточка персонажа">Персонаж</button>
        <button data-cr="mode" data-v="lore" title="Записи лорбука">Лорбук</button>
      </div>
      <button class="cr-btn" data-cr="load" title="Взять карточку из библиотеки: переписать её или сделать на её основе новую">📂 Загрузить карточку</button>
      <div class="cr-src" id="cr-src"></div>
      <span class="cr-saved cr-hide-m" id="cr-saved">✓ черновик сохранён</span>
      <div class="cr-bar-right">
        <button class="cr-btn cr-narrow" data-cr="side" data-v="build" title="Модель, сэмплеры, перевод">⚙ Сборка</button>
        <button class="cr-btn cr-narrow" data-cr="side" data-v="algo" title="Алгоритм сборки и шаблоны">🧩 Алгоритм</button>
        <button class="cr-btn" data-cr="clear" title="Очистить все поля и заметки">⟲ Очистить</button>
        <button class="cr-btn" data-cr="override" id="cr-override" hidden></button>
        <button class="cr-primary" data-cr="create" title="Добавить персонажа в библиотеку (вкладка «Персонажи»)">＋ Создать персонажа</button>
      </div>
    </div>
    <div class="cr-body">
      <div class="cr-form sm-scroll" id="cr-form"></div>
      <aside class="cr-side" id="cr-side">
        <div class="cr-side-tabs">
          <button class="cr-stab on" data-cr="side" data-v="build">⚙ Сборка</button>
          <button class="cr-stab" data-cr="side" data-v="algo" title="Что и в каком порядке уходит модели">🧩 Алгоритм сборки</button>
          <button class="cr-stab" data-cr="side" data-v="chat">💬 Чат-правка</button>
          <button class="cr-ib cr-side-close" data-cr="side-close" title="К карточке">✕</button>
        </div>
        <div class="cr-pane sm-scroll" id="cr-pane-build"></div>
        <div class="cr-pane sm-scroll hidden" id="cr-pane-algo"></div>
        <div class="cr-pane sm-scroll hidden" id="cr-pane-chat"></div>
      </aside>
    </div>
    <div class="cr-modal hidden" id="cr-modal"><div class="cr-dlg"></div></div>
    <div class="cr-toast hidden" id="cr-toast"></div>`;
}
function crShowSide(which) {
  crSt.side = which;
  crQA('#sm-create-view .cr-stab').forEach((b) => b.classList.toggle('on', b.dataset.v === which));
  ['build', 'algo', 'chat'].forEach((k) => { const p = document.getElementById('cr-pane-' + k); if (p) p.classList.toggle('hidden', k !== which); });
  const side = document.getElementById('cr-side'); if (side) side.classList.add('open');
  if (which === 'chat') crRenderChat();
}
function crRenderBar() {
  const ch = crLoadedChar();
  const src = document.getElementById('cr-src');
  if (src) src.innerHTML = ch
    ? `<span class="cr-mini"${ch.avatar ? ` style="background-image:url('${ch.avatar}');background-size:cover"` : ' style="background:var(--node-head)"'}>${ch.avatar ? '' : crEsc((ch.name || '?')[0])}</span><span>Загружена: <b>${crEsc(ch.name)}</b></span><button class="cr-ib" data-cr="unlink" title="Отвязать: поля останутся, «Записать» и сравнение ⇄ пропадут">✕</button>`
    : '<span>Новая карточка</span>';
  const ov = document.getElementById('cr-override');
  if (ov) { ov.hidden = !ch; if (ch) ov.textContent = '⤓ Записать в «' + ch.name + '»'; }
  crQA('#cr-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === crSt.mode));
}

// ── Форма карточки ──
function crRenderForm() {
  const host = document.getElementById('cr-form'); if (!host) return;
  if (crSt.mode === 'lore') { host.innerHTML = crRenderLore(); crQA('#cr-form textarea').forEach(crAutogrow); return; }
  const ins = crSt.instr[crSt.instrCur] || {};
  let h = `<div class="cr-sec">
    <div class="cr-sec-hd"><span>Общая инструкция</span>
      <select class="cr-sel cr-push" data-cr="instr-sel" title="Пресет общей инструкции">${Object.entries(crSt.instr).map(([k, p]) => `<option value="${k}"${k === crSt.instrCur ? ' selected' : ''}>${crEsc(p.name)}</option>`).join('')}</select>
      <button class="cr-ib" data-cr="instr-new" title="Новый пресет (копия текущего)">＋</button>
      <button class="cr-ib" data-cr="instr-ren" title="Переименовать">✎</button>
      <button class="cr-ib" data-cr="instr-del" title="Удалить пресет"${ins.builtin ? ' disabled' : ''}>🗑</button>
    </div>
    <div class="cr-sec-bd">
      <input class="cr-in" data-cr="instr-com" value="${crEsc(ins.com || '')}" title="Комментарий к пресету — для тебя, модели не уходит" placeholder="комментарий к пресету…">
      <textarea class="cr-ta" data-cr="instr-text" rows="2" title="Уходит модели при каждом поле (по-английски)">${crEsc(ins.text || '')}</textarea>
    </div></div>`;
  h += `<div class="cr-sec">
    <div class="cr-sec-hd"><span class="cr-collapse" data-cr="notes-toggle">${crSt.notesOpen ? '▾' : '▸'} Заметки · ${crSt.notes.length}</span>
      <button class="cr-ib cr-push" data-cr="note-add">＋ заметка</button></div>
    ${crSt.notesOpen ? `<div>${crSt.notes.map((n, i) => {
      const nb = !!crSt.busy['note:' + i];
      return `<div class="cr-note-item">
        <div class="cr-note-hd"><input class="cr-note-title" data-cr="note-t" data-i="${i}" value="${crEsc(n.t || '')}" placeholder="название заметки">
          <button class="cr-ib hot" data-cr="note-gen" data-i="${i}" title="Написать заметку моделью"${nb ? ' disabled' : ''}>${nb ? 'пишет…' : '✨'}</button>
          <button class="cr-ib" data-cr="note-del" data-i="${i}" title="Удалить заметку">🗑</button></div>
        <textarea class="cr-val" data-cr="note-v" data-i="${i}"${i === 0 ? ` rows="${CR_NOTE_HINT.split('\n').length + 1}" placeholder="${crEsc(CR_NOTE_HINT)}"` : ' placeholder="пусто — впиши или нажми ✨"'}${nb ? ' readonly' : ''}>${crEsc(n.v || '')}</textarea></div>`;
    }).join('') || '<div class="cr-sec-bd"><span class="cr-note">Заметок нет. Заметка — шпаргалка для модели, пока пишется карточка; в сохранённую карточку не входит.</span></div>'}</div>` : ''}
  </div>`;
  CR_FIELDS.forEach((F) => { h += crFieldHtml(F); });
  host.innerHTML = h;
  crQA('#cr-form textarea').forEach(crAutogrow);
}
function crFieldHtml(F) {
  const key = crKey(F.id), busy = !!crSt.busy[key];
  const val = crGet(F.id), ins = crGetI(F.id);
  const prev = crSt.trPrev[key], shown = prev != null ? prev : val;
  const ch = crLoadedChar();
  let nav = '';
  if (F.greet) {
    nav = `<span class="sm-greet-nav"><button class="sm-greet-arrow" data-cr="g-prev" title="Предыдущее приветствие">‹</button><span class="sm-greet-count">${crSt.gIdx + 1}/${crSt.greets.length}</span><button class="sm-greet-arrow" data-cr="g-next" title="Следующее приветствие">›</button>
      <button class="cr-ib" data-cr="g-add" title="Добавить альтернативное приветствие">＋</button>${crSt.gIdx > 0 ? '<button class="cr-ib" data-cr="g-del" title="Удалить это приветствие">🗑</button>' : ''}</span>`;
  }
  return `<div class="sm-fld cr-fld${busy ? ' busy' : ''}" data-f="${F.id}">
    <div class="sm-fld-hd"><span class="sm-fld-lbl">${crEsc(F.greet ? crLabel(key) : F.label)}</span>${nav}
      ${busy ? '<span class="cr-busy-lbl">пишет…</span>' : ''}
      <span class="sm-fld-btns">
        <button class="cr-ib hot" data-cr="gen" title="Написать поле моделью (один запрос — одно поле)"${busy ? ' disabled' : ''}>✨ Написать</button>
        <button class="cr-ib" data-cr="cont" title="Дописать: модель продолжит текущий текст"${busy || !val ? ' disabled' : ''}>→</button>
        <button class="cr-ib" data-cr="clear-f" title="Стереть поле"${busy || !val ? ' disabled' : ''}>⌫</button>
        <button class="cr-ib" data-cr="chat-f" title="Обсудить это поле в чат-правке">💬</button>
        <button class="cr-ib" data-cr="cmp" title="${ch ? 'Сравнить с загруженной карточкой' : 'Сравнение — когда загружена карточка'}"${ch ? '' : ' disabled'}>⇄</button>
      </span></div>
    ${F.single ? `<input class="cr-in cr-val-one" data-cr="val" data-f="${F.id}" value="${crEsc(shown)}" placeholder="пусто — впиши или нажми ✨"${busy || prev != null ? ' readonly' : ''}>`
      : `<textarea class="cr-val" data-cr="val" data-f="${F.id}" placeholder="пусто — нажми ✨ Написать"${busy || prev != null ? ' readonly' : ''}>${crEsc(shown)}</textarea>`}
    <div class="cr-tr-wrap"><div class="tr-btns">
      <button class="tr-b${prev != null ? ' on' : ''}" data-cr="tr-prev" title="Предпросмотр перевода EN→RU · повторно — вернуть оригинал">RU</button>
      <button class="tr-b" data-cr="tr-repl" title="Перевести RU→EN и ЗАМЕНИТЬ текст">EN</button>
    </div></div>
    ${F.single ? '' : `<div class="cr-instr"><span class="cr-instr-ico">✎</span><input class="cr-instr-in" data-cr="instr-f" data-f="${F.id}" value="${crEsc(ins)}" placeholder="инструкция к этому полю (необязательно): «короче», «черты через поступки»…"></div>`}
  </div>`;
}
function crRenderField(fid) {
  const el = crQ(`#cr-form .cr-fld[data-f="${fid}"]`); if (!el) return crRenderForm();
  const tmp = document.createElement('div'); tmp.innerHTML = crFieldHtml(CR_FIELDS.find((f) => f.id === fid));
  const nw = tmp.firstElementChild; el.replaceWith(nw);
  nw.querySelectorAll('textarea').forEach(crAutogrow);
}

// ── Правая панель: «Сборка» ──
function crRenderBuild() {
  const host = document.getElementById('cr-pane-build'); if (!host) return;
  const nodes = crApiNodes(), presets = crApiPresets();
  const cur = crSt.apiPreset ? presets.find((p) => p.id === crSt.apiPreset) : null;
  const optNames = crOptParams();
  const fmtKey = { text: 'fmt_text', xml: 'fmt_xml', json: 'fmt_json' }[crSt.format];
  host.innerHTML = `
  <div class="cr-sec"><div class="cr-sec-hd">Модель</div><div class="cr-sec-bd">
    <select class="cr-sel" data-cr="model">${cur ? `<option value="p" selected>Пресет «${crEsc(cur.name)}» — ${crEsc((cur.api || {}).model || '')}</option>` : ''}${nodes.length ? nodes.map((n, i) => `<option value="${i}"${!cur && i === crSt.model ? ' selected' : ''}>${crEsc(n.label)}</option>`).join('') : '<option value="0">нод «API» на холсте нет</option>'}</select>
    <div class="cr-note">Ноды «API» текущей сборки — ключи уже в них, здесь только выбор.</div>
    <div class="cr-row"><span class="cr-lbl">Пресет</span>
      <select class="cr-sel cr-grow" data-cr="apipreset" title="Пресет = снимок подключения и «Опций», как в ноде API">
        <option value="">— не выбран —</option>${presets.map((p) => `<option value="${p.id}"${p.id === crSt.apiPreset ? ' selected' : ''}>${crEsc(p.name)}</option>`).join('')}</select></div>
  </div></div>

  <div class="cr-sec"><div class="cr-sec-hd"><span>Опции · сэмплеры</span><button class="cr-ib cr-push" data-cr="opts-reset" title="Вернуть заводские значения">↺</button></div><div class="cr-sec-bd">
    <div class="cr-opts">${optNames.map((n, i) => `<label class="cr-opt"><span class="cr-lbl">${crEsc(n)}</span><input class="cr-in" data-cr="opt" data-i="${i}" value="${crEsc(crSt.opts[i] == null ? '' : crSt.opts[i])}"></label>`).join('')}</div>
    <div class="cr-note">Набор как в ноде «Опции». Пустое поле — параметр не уходит в запрос.</div>
  </div></div>

  <div class="cr-sec"><div class="cr-sec-hd">Формат ответа</div><div class="cr-sec-bd">
    <div class="cr-seg">${[['text', 'Текст'], ['xml', 'XML'], ['json', 'JSON']].map(([k, l]) => `<button data-cr="fmt" data-v="${k}" class="${crSt.format === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="cr-note">${crEsc((crSt.tpls[fmtKey] || {}).com || '')}</div>
  </div></div>

  <div class="cr-sec"><div class="cr-sec-hd">Перевод</div><div class="cr-sec-bd">
    <div class="cr-row"><span class="cr-lbl">Кто переводит</span>
      <div class="cr-seg">${[['yandex', 'Яндекс'], ['ai', 'ИИ']].map(([k, l]) => `<button data-cr="trby" data-v="${k}" class="${crSt.trBy === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="cr-note">Кнопки RU / EN у каждого поля: RU — предпросмотр перевода, EN — перевести и заменить текст.</div>
    ${crSt.trBy === 'ai' ? `
    <div class="cr-row"><span class="cr-lbl">Модель</span><select class="cr-sel cr-grow" data-cr="trmodel">${nodes.map((n, i) => `<option value="${i}"${i === crSt.trModel ? ' selected' : ''}>${crEsc(n.label)}</option>`).join('')}</select></div>
    <div class="cr-lbl">Опции переводчика</div>
    <div class="cr-opts">${optNames.map((n, i) => `<label class="cr-opt"><span class="cr-lbl">${crEsc(n)}</span><input class="cr-in" data-cr="tropt" data-i="${i}" value="${crEsc(crSt.trOpts[i] == null ? '' : crSt.trOpts[i])}"></label>`).join('')}</div>` : ''}
  </div></div>`;
}

// ── Правая панель: «Алгоритм сборки» ──
function crRenderAlgo() {
  const host = document.getElementById('cr-pane-algo'); if (!host) return;
  const algo = crSt.algos[crSt.algoCur] || crSt.algos.base;
  const lib = crLib(), books = crBooks();
  const chip = (name, act, id) => `<span class="cr-chip">${crEsc(name)}<button data-cr="${act}" data-id="${id}" title="Убрать">✕</button></span>`;
  const blockHtml = (b, i, n) => {
    const t = crSt.tpls[b.tpl] || { name: b.tpl, com: '' };
    let extra = '';
    if (b.tpl === 'cards') extra = `<div class="cr-chips">${crSt.ctxCards.map((id) => { const c = lib.find((x) => x.id === id); return c ? chip(c.name, 'card-x', id) : ''; }).join('') || '<span class="cr-note">не выбрано</span>'}<button class="cr-ib" data-cr="cards-pick">＋ выбрать</button></div>`;
    if (b.tpl === 'books') extra = `<div class="cr-chips">${crSt.ctxBooks.map((id) => { const w = books.find((x) => x.id === id); return w ? chip(w.name || '(без имени)', 'book-x', id) : ''; }).join('') || '<span class="cr-note">не выбрано</span>'}<button class="cr-ib" data-cr="books-pick">＋ выбрать</button></div>`;
    if (b.tpl === 'fields') extra = `<label class="cr-check" style="font-size:11px"><input type="checkbox" data-cr="no-other-greets"${crSt.noOtherGreets ? ' checked' : ''}> не слать другие приветствия, когда пишешь одно из них</label>`;
    return `<div class="cr-block${b.on ? '' : ' off'}" data-i="${i}">
      <span class="cr-grip" title="Порядок — стрелками">⋮⋮</span>
      <input type="checkbox" data-cr="block-on" data-i="${i}"${b.on ? ' checked' : ''} title="Слать этот блок модели">
      <span class="cr-bname" title="${crEsc(t.name)}">${crEsc(t.name)}</span>
      <span class="cr-bacts">
        <select class="cr-sel cr-role" data-cr="block-role" data-i="${i}" title="От чьего имени уходит блок">${['system', 'user', 'assistant'].map((r) => `<option${b.role === r ? ' selected' : ''}>${r}</option>`).join('')}</select>
        <button class="cr-ib" data-cr="up" data-i="${i}"${i === 0 ? ' disabled' : ''} title="Выше">↑</button>
        <button class="cr-ib" data-cr="down" data-i="${i}"${i === n - 1 ? ' disabled' : ''} title="Ниже">↓</button>
        <button class="cr-ib" data-cr="tpl-edit" data-tpl="${b.tpl}" title="Открыть шаблон">✎</button>
        ${crSt.tpls[b.tpl] && crSt.tpls[b.tpl].custom ? `<button class="cr-ib" data-cr="block-del" data-i="${i}" title="Убрать блок">🗑</button>` : ''}
      </span>
      <span class="cr-bcom">${crEsc(t.com)}</span>
      ${extra ? `<div class="cr-bextra">${extra}</div>` : ''}
    </div>`;
  };
  const grp = (g) => Object.entries(crSt.tpls).filter(([, t]) => t.grp === g);
  const tplRow = ([k, t]) => `<div class="cr-tpl"><span class="cr-tpl-name">${crEsc(t.name)}${t.custom ? '<span class="cr-tpl-tag">свой</span>' : (CR_TPL_DEFAULTS[k] && CR_TPL_DEFAULTS[k].text !== t.text ? '<span class="cr-tpl-tag">изменён</span>' : '')}</span><button class="cr-ib" data-cr="tpl-edit" data-tpl="${k}">✎ открыть</button><span class="cr-tpl-com">${crEsc(t.com)}</span></div>`;
  host.innerHTML = `
  <div class="cr-sec"><div class="cr-sec-hd"><span>Пресет</span>
      <select class="cr-sel cr-push" data-cr="algo" title="Пресет алгоритма">${Object.entries(crSt.algos).map(([k, a]) => `<option value="${k}"${k === crSt.algoCur ? ' selected' : ''}>${crEsc(a.name)}</option>`).join('')}</select>
      <button class="cr-ib" data-cr="algo-new" title="Новый алгоритм (копия текущего)">＋</button>
      <button class="cr-ib" data-cr="algo-ren" title="Переименовать">✎</button>
      ${algo.builtin ? '<button class="cr-ib" data-cr="algo-restore" title="Вернуть заводской порядок">↺</button>' : '<button class="cr-ib" data-cr="algo-del" title="Удалить алгоритм">🗑</button>'}
    </div><div class="cr-sec-bd">
    <input class="cr-in" data-cr="algo-com" value="${crEsc(algo.com || '')}" placeholder="комментарий к алгоритму…" title="Комментарий — для тебя, модели не уходит">
    <div class="cr-note">Сверху вниз — что и в каком порядке уйдёт модели, когда пишется поле. Порядок — ↑↓, галочка — слать или нет, роль — от чьего имени.</div>
    <div class="cr-blocks">${algo.blocks.map((b, i) => blockHtml(b, i, algo.blocks.length)).join('')}</div>
    <button class="cr-ib" data-cr="block-add" style="align-self:flex-start">＋ свой блок</button>
  </div></div>

  <div class="cr-sec"><div class="cr-sec-hd">Шаблоны промтов · ${Object.keys(crSt.tpls).length}</div><div class="cr-sec-bd" style="gap:0">
    <div class="cr-note" style="margin-bottom:6px">Текст шаблона уходит модели (по-английски). Комментарий — для тебя.</div>
    <div class="cr-tpl-grp">Для полей</div>${grp('fields').map(tplRow).join('')}
    <div class="cr-tpl-grp" style="margin-top:12px">Для чат-правки</div>${grp('revise').map(tplRow).join('')}
    <div class="cr-tpl-grp" style="margin-top:12px">Для лорбука</div>${grp('lore').map(tplRow).join('')}
  </div></div>

  <button class="cr-btn" data-cr="reset-all" style="align-self:center;color:var(--muted)">⚠ Сбросить алгоритмы и шаблоны к заводским</button>`;
}

// ── Окна: библиотека, ворлд-буки, сравнение, шаблон ──
function crOpenLibrary(multi) {
  const lib = crLib();
  const sel = new Set(crSt.ctxCards);
  const cards = lib.map((c) => `<div class="sm-card${multi && sel.has(c.id) ? ' pick' : ''}" data-cr="lib-card" data-id="${c.id}">
      <div class="sm-ava${c.avatar ? ' has-img' : ''}"${c.avatar ? ` style="background-image:url('${c.avatar}')"` : ''}>${c.avatar ? '' : `<span class="cr-ava-ph">${crEsc((c.name || '?')[0])}</span>`}</div>
      <div class="sm-card-name">${crEsc(c.name)}</div></div>`).join('') || '<div class="cr-note">Библиотека пуста.</div>';
  crModal(crHead(multi ? 'Карточки в контекст' : 'Загрузить карточку из библиотеки')
    + `<div class="cr-dlg-bd"><div class="cr-note">${multi ? 'Отметь персонажей — модель увидит их целиком (шаблон «Карточки из библиотеки»).' : 'Поля заполнятся из карточки. Дальше — переписать и «Записать» поверх, или «Создать персонажа» — новая карточка на её основе.'}</div><div class="cr-libgrid">${cards}</div></div>`
    + (multi ? '<div class="cr-dlg-ft"><button class="cr-btn" data-cr="modal-close">Отмена</button><button class="cr-primary" data-cr="lib-ok">Готово</button></div>' : ''));
  crQ('#cr-modal').dataset.multi = multi ? '1' : '';
}
function crOpenBooks() {
  const sel = new Set(crSt.ctxBooks);
  crModal(crHead('Ворлд-буки в контекст')
    + `<div class="cr-dlg-bd"><div class="cr-note">Включённые записи отмеченных ворлд-буков уйдут модели.</div>${crBooks().map((w) => `<label class="cr-check"><input type="checkbox" data-cr="wb" data-id="${w.id}"${sel.has(w.id) ? ' checked' : ''}> ${crEsc(w.name || '(без имени)')}</label>`).join('') || '<div class="cr-note">Ворлд-буков нет.</div>'}</div>`
    + '<div class="cr-dlg-ft"><button class="cr-btn" data-cr="modal-close">Отмена</button><button class="cr-primary" data-cr="wb-ok">Готово</button></div>', 'small');
}
function crWordDiff(a, b) {                                  // простое сравнение по словам (LCS)
  const A = String(a || '').split(/(\s+)/).filter((x) => x !== ''), B = String(b || '').split(/(\s+)/).filter((x) => x !== '');
  if (A.length * B.length > 1200000) return { l: crEsc(a), r: crEsc(b) };
  const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, l = '', r = '';
  while (i < n && j < m) {
    if (A[i] === B[j]) { l += crEsc(A[i]); r += crEsc(B[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { l += '<span class="d-del">' + crEsc(A[i]) + '</span>'; i++; }
    else { r += '<span class="d-add">' + crEsc(B[j]) + '</span>'; j++; }
  }
  while (i < n) l += '<span class="d-del">' + crEsc(A[i++]) + '</span>';
  while (j < m) r += '<span class="d-add">' + crEsc(B[j++]) + '</span>';
  return { l, r };
}
function crOpenCompare(fid) {
  const ch = crLoadedChar(); if (!ch) return;
  const key = crKey(fid), d = ch.card || {};
  let was = '';
  if (String(key).startsWith('greet:')) { const i = +String(key).slice(6); was = i === 0 ? (d.first_mes || '') : ((d.alternate_greetings || [])[i - 1] || ''); }
  else was = d[fid] || '';
  const now = crGet(fid);
  const diff = crWordDiff(was, now);
  crModal(crHead('Сравнение · ' + crLabel(key))
    + `<div class="cr-dlg-bd">${was === now ? '<div class="cr-note">Разницы нет.</div>' : ''}<div class="cr-diff">
      <div class="cr-diff-col"><span class="cr-lbl">В карточке «${crEsc(ch.name)}»</span><div>${diff.l || '<i class="cr-note">пусто</i>'}</div></div>
      <div class="cr-diff-col"><span class="cr-lbl">Сейчас в поле</span><div>${diff.r || '<i class="cr-note">пусто</i>'}</div></div></div></div>`
    + '<div class="cr-dlg-ft"><button class="cr-primary" data-cr="modal-close">Закрыть</button></div>');
}
function crOpenTpl(k) {
  const t = crSt.tpls[k]; if (!t) return;
  const d = CR_TPL_DEFAULTS[k];
  crModal(crHead('Шаблон · ' + t.name) + `<div class="cr-dlg-bd">
    ${t.custom ? `<label class="cr-lbl">Название</label><input class="cr-in" id="cr-tpl-name" value="${crEsc(t.name)}">` : ''}
    <label class="cr-lbl">Комментарий — для тебя, модели не уходит</label>
    <textarea class="cr-ta" id="cr-tpl-com" rows="2">${crEsc(t.com || '')}</textarea>
    <label class="cr-lbl">Текст — уходит модели (по-английски)</label>
    <textarea class="cr-ta cr-code" id="cr-tpl-text" placeholder="пусто — блок ничего не добавит">${crEsc(t.text || '')}</textarea>
    <div class="cr-vars">Подстановки: ${(t.vars || []).map((v) => '<code>' + crEsc(v) + '</code>').join('') || '—'}</div>
  </div><div class="cr-dlg-ft">
    ${d ? '<button class="cr-btn cr-left" data-cr="tpl-reset" data-tpl="' + k + '">↺ Заводской текст</button>' : '<button class="cr-btn cr-left" data-cr="tpl-del" data-tpl="' + k + '">🗑 Удалить шаблон</button>'}
    <button class="cr-btn" data-cr="modal-close">Отмена</button><button class="cr-primary" data-cr="tpl-ok" data-tpl="${k}">Готово</button></div>`);
}

// ── Действия с карточкой ──
function crLoadCard(id) {
  const ch = crLib().find((c) => c.id === id); if (!ch) return;
  const doIt = () => {
    const d = ch.card || {};
    CR_FIELDS.filter((f) => !f.greet).forEach((f) => { crSt.fields[f.id] = { v: d[f.id] || '', i: '' }; });
    const alts = Array.isArray(d.alternate_greetings) ? d.alternate_greetings : [];
    crSt.greets = [{ v: d.first_mes || '', i: '' }].concat(alts.map((v) => ({ v: v || '', i: '' })));
    crSt.gIdx = 0; crSt.loadedId = ch.id; crSt.trPrev = {};
    crSave(); crCloseModal(); crRenderBar(); crRenderForm();
    crToast('Загружена «' + crEsc(ch.name) + '». Кнопка ⇄ у поля сравнивает с ней.');
  };
  const dirty = CR_FIELDS.filter((f) => !f.greet).some((f) => crSt.fields[f.id].v.trim()) || crSt.greets.some((g) => (g.v || '').trim());
  if (dirty) crConfirm('Загрузить карточку', 'Заменить текущие поля карточкой «<b>' + crEsc(ch.name) + '</b>»? Заметки останутся.', 'Заменить', doIt);
  else doIt();
}
function crCardData() {
  const d = {
    name: crSt.fields.name.v.trim(),
    description: crSt.fields.description.v,
    personality: crSt.fields.personality.v,
    scenario: crSt.fields.scenario.v,
    first_mes: (crSt.greets[0] || {}).v || '',
    mes_example: crSt.fields.mes_example.v,
    alternate_greetings: crSt.greets.slice(1).map((g) => g.v).filter((v) => (v || '').trim()),
  };
  return d;
}
function crCreateChar() {
  const name = crSt.fields.name.v.trim();
  if (!name) return crToast('Сначала имя — без него персонажа не создать.');
  const exists = crLib().some((c) => (c.name || '').trim() === name);
  crConfirm('Создать персонажа', exists
    ? 'В библиотеке уже есть «<b>' + crEsc(name) + '</b>» — его карточка будет <b>переписана</b> текущими полями. Продолжить?'
    : 'Создать «<b>' + crEsc(name) + '</b>» в библиотеке? Появится во вкладке «Персонажи». Черновик здесь останется.', exists ? 'Переписать' : 'Создать', () => {
    const ch = (typeof registerCharacter === 'function') ? registerCharacter({ data: crCardData() }) : null;
    if (!ch) return crToast('Не вышло создать персонажа.');
    crSt.loadedId = ch.id; crSave(); crRenderBar();
    crToast('✓ «' + crEsc(name) + '» в библиотеке (вкладка «Персонажи»)');
  });
}
function crOverrideChar() {
  const ch = crLoadedChar(); if (!ch) return;
  crConfirm('Записать в карточку', 'Переписать поля карточки «<b>' + crEsc(ch.name) + '</b>» текущими? Аватар и встроенный лорбук карточки не трогаем.', 'Записать', () => {
    const lib = crLib(); const rec = lib.find((c) => c.id === ch.id); if (!rec) return;
    const d = crCardData();
    rec.card = Object.assign({}, rec.card || {}, d);
    if (d.name) rec.name = d.name;
    lsSet(CHAR_LIB_KEY, lib);
    if (typeof startMenuRender === 'function') startMenuRender();
    crRenderBar(); crToast('✓ «' + crEsc(rec.name) + '» переписана');
  });
}
function crClearAll() {
  crConfirm('Очистить', 'Очистить все поля, приветствия и заметки? Пресеты, шаблоны и настройки не трогаем.', 'Очистить', () => {
    CR_FIELDS.filter((f) => !f.greet).forEach((f) => { crSt.fields[f.id] = { v: '', i: '' }; });
    crSt.greets = [{ v: '', i: '' }]; crSt.gIdx = 0; crSt.notes = [{ t: 'Идея', v: '' }]; crSt.loadedId = ''; crSt.trPrev = {};
    crSave(); crRenderBar(); crRenderForm();
  });
}

// ══════════════ РЕЖИМ «ЛОРБУК» ══════════════
// Модель ПРЕДЛАГАЕТ записи, в книгу они не попадают сами: у каждой «Добавить» / «Отказать»
// (отказ уходит в чёрный список и в следующий запрос) / «Сравнить» с одноимённой записью книги.
// Что уже есть в книге. У больших книг (200+ записей) текст записей в промт не влезает — тогда
// шлём только имена и ключи: их достаточно, чтобы модель не предлагала то же самое второй раз.
function crLoreBookText(id) {
  const entries = (typeof getWorldbookEntries === 'function' ? (getWorldbookEntries(id) || []) : []);
  if (!entries.length) return '(the book is empty)';
  const short = entries.length > 25;
  const head = short ? '(titles and keys only — the book is large: ' + entries.length + ' entries)\n' : '';
  return head + entries.map((e) => '- ' + (e.name || '(no title)') + ' [keys: ' + (e.keys || '—') + ']'
    + (short ? '' : ': ' + String(e.content || '').replace(/\s+/g, ' ').slice(0, 200))).join('\n');
}
async function crLoreSuggest() {
  const api = crApi(); if (!api || !api.model) return crToast('Нет ноды «API» с моделью. Выбери подключение в «⚙ Сборке».');
  if (!crSt.loreTarget) return crToast('Сначала выбери ворлд-бук, куда писать.');
  if (crSt.loreBusy) return;
  crSt.loreBusy = true; crRenderForm();
  try {
    const data = { book: crLoreBookText(crSt.loreTarget), black: (crSt.loreBlack || []).join('\n') || '(none)', task: (crSt.loreTask || '').trim() || 'anything this world is missing', count: crSt.loreCount || 4 };
    const msgs = [{ role: 'system', content: crSt.tpls.lore_guide.text }];
    if (crSt.ctxCards.length) msgs.push({ role: 'system', content: crFill(crSt.tpls.cards.text, { cards: crCardsText() }) });
    msgs.push({ role: 'system', content: crFill(crSt.tpls.lore_book.text, data) });
    if ((crSt.loreBlack || []).length) msgs.push({ role: 'system', content: crFill(crSt.tpls.lore_black.text, data) });
    msgs.push({ role: 'system', content: crSt.tpls.lore_json.text });
    msgs.push({ role: 'user', content: crFill(crSt.tpls.lore_task.text, data) });
    const r = await rlmApi('/api/rlm/generate', { _ctxKey: 'creator.lore', base: api.base, key: api.key, model: api.model, messages: msgs, params: crParams() });
    const raw = (r && (r.text || r.content)) || '';
    if (!raw) throw new Error((r && r.error) || 'модель ответила пусто');
    const j = crJsonFrom(raw);
    const list = j && Array.isArray(j.entries) ? j.entries : null;
    if (!list || !list.length) throw new Error('ответ не разобрался как JSON со списком entries — посмотри «>_ Консоль»');
    const add = list.filter((e) => e && (e.content || '').trim()).map((e) => ({
      id: 'sg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: String(e.name || '').trim(), keys: String(e.keys || '').trim(), content: String(e.content || '').trim(),
    }));
    crSt.loreSug = (crSt.loreSug || []).concat(add);
    crSave(); crToast('Предложено записей: ' + add.length + '. В книгу они пока не попали.');
  } catch (e) { crToast('Не вышло: ' + crEsc((e && e.message) || e)); }
  finally { crSt.loreBusy = false; crRenderForm(); }
}
function crLoreAdd(sid, silent) {
  const s = (crSt.loreSug || []).find((x) => x.id === sid); if (!s) return 0;
  const id = crSt.loreTarget; if (!id) { crToast('Не выбран ворлд-бук.'); return 0; }
  const entries = (typeof getWorldbookEntries === 'function' ? (getWorldbookEntries(id) || []) : []).slice();
  const e = (typeof loreNormEntry === 'function')
    ? loreNormEntry({ name: s.name, keys: s.keys, content: s.content, trigger: 'keyword' })
    : { name: s.name, keys: s.keys, content: s.content, trigger: 'keyword', injection: 'lore', order: 100, prob: 100 };
  entries.push(e);
  if (typeof saveWorldbookEntries === 'function') saveWorldbookEntries(id, entries);
  crSt.loreSug = (crSt.loreSug || []).filter((x) => x.id !== sid); crSave();
  if (!silent) { crRenderForm(); crToast('✓ «' + crEsc(s.name || 'запись') + '» в книге «' + crEsc((crBooks().find((w) => w.id === id) || {}).name || '') + '»'); }
  return 1;
}
function crLoreReject(sid) {
  const s = (crSt.loreSug || []).find((x) => x.id === sid); if (!s) return;
  crSt.loreBlack = (crSt.loreBlack || []).concat([(s.name || '').trim() || String(s.content).slice(0, 40)]).slice(-40);
  crSt.loreSug = crSt.loreSug.filter((x) => x.id !== sid); crSave(); crRenderForm();
  crToast('Отказ учтён — модель эту запись больше не предложит.');
}
function crLoreCompare(sid) {
  const s = (crSt.loreSug || []).find((x) => x.id === sid); if (!s) return;
  const entries = (typeof getWorldbookEntries === 'function' ? (getWorldbookEntries(crSt.loreTarget) || []) : []);
  const same = entries.find((e) => (e.name || '').trim().toLowerCase() === (s.name || '').trim().toLowerCase());
  const d = crWordDiff(same ? (same.content || '') : '', s.content || '');
  crModal(crHead('Сравнение · ' + (s.name || 'запись'))
    + `<div class="cr-dlg-bd">${same ? '' : '<div class="cr-note">В книге записи с таким именем нет — это новая.</div>'}<div class="cr-diff">
      <div class="cr-diff-col"><span class="cr-lbl">В книге</span><div>${d.l || '<i class="cr-note">пусто</i>'}</div></div>
      <div class="cr-diff-col"><span class="cr-lbl">Предложение</span><div>${d.r || '<i class="cr-note">пусто</i>'}</div></div></div></div>`
    + '<div class="cr-dlg-ft"><button class="cr-primary" data-cr="modal-close">Закрыть</button></div>');
}
function crRenderLore() {
  const books = crBooks();
  if (!crSt.loreTarget && books.length) crSt.loreTarget = (typeof activeWorldbookId === 'function' && activeWorldbookId()) || books[0].id;
  const n = crSt.loreTarget ? (typeof getWorldbookEntries === 'function' ? (getWorldbookEntries(crSt.loreTarget) || []).length : 0) : 0;
  const sug = crSt.loreSug || [];
  return `<div class="cr-sec"><div class="cr-sec-hd">Куда пишем</div><div class="cr-sec-bd">
      <div class="cr-row"><select class="cr-sel cr-grow" data-cr="lore-book">${books.map((w) => `<option value="${w.id}"${w.id === crSt.loreTarget ? ' selected' : ''}>${crEsc(w.name || '(без имени)')}</option>`).join('') || '<option>ворлд-буков нет</option>'}</select>
        <span class="cr-lbl">${n} зап.</span></div>
      <div class="cr-note">Ворлд-буки — из вкладки «Лорбуки». Записи попадут туда только по кнопке «Добавить».</div>
    </div></div>
    <div class="cr-sec"><div class="cr-sec-hd"><span>Задание</span>
        <span class="cr-lbl cr-push">записей за раз</span><input class="cr-in" data-cr="lore-count" value="${crSt.loreCount || 4}" style="width:48px;text-align:right">
        <button class="cr-ib hot" data-cr="lore-gen"${crSt.loreBusy ? ' disabled' : ''}>${crSt.loreBusy ? 'пишет…' : '✨ Предложить записи'}</button></div>
      <div class="cr-sec-bd"><textarea class="cr-ta" data-cr="lore-task" rows="3" placeholder="Что описать: «порт Карроу — фракции, законы, места», «магия: цена и запреты»…">${crEsc(crSt.loreTask || '')}</textarea></div></div>
    <div class="cr-sec"><div class="cr-sec-hd"><span>Предложения · ${sug.length}</span>
        ${sug.length ? '<button class="cr-ib cr-push" data-cr="lore-add-all">Добавить все</button>' : ''}
        ${(crSt.loreBlack || []).length ? `<button class="cr-ib${sug.length ? '' : ' cr-push'}" data-cr="lore-black-clear" title="Очистить список отказов">отказов: ${crSt.loreBlack.length} ✕</button>` : ''}</div>
      ${sug.length ? sug.map((s) => `<div class="cr-note-item">
        <div class="cr-note-hd"><input class="cr-note-title" data-cr="sug-name" data-id="${s.id}" value="${crEsc(s.name)}" placeholder="имя записи">
          <button class="cr-ib hot" data-cr="sug-add" data-id="${s.id}" title="Добавить запись в книгу">＋ Добавить</button>
          <button class="cr-ib" data-cr="sug-cmp" data-id="${s.id}" title="Сравнить с одноимённой записью книги">⇄</button>
          <button class="cr-ib" data-cr="sug-rej" data-id="${s.id}" title="Отказать: уйдёт в чёрный список">🗑</button></div>
        <div class="cr-instr"><span class="cr-instr-ico">🔑</span><input class="cr-instr-in" data-cr="sug-keys" data-id="${s.id}" value="${crEsc(s.keys)}" placeholder="ключи через запятую"></div>
        <textarea class="cr-val" data-cr="sug-content" data-id="${s.id}">${crEsc(s.content)}</textarea></div>`).join('')
      : '<div class="cr-sec-bd"><span class="cr-note">Пусто. Напиши задание и нажми «✨ Предложить записи» — они появятся здесь, а в книгу попадут только по «Добавить». Механику (всегда включено, липкость, глубина) ставишь потом в самом лорбуке.</span></div>'}
    </div>`;
}

// ══════════════ ЧАТ-ПРАВКА ══════════════
// Переписка с моделью о карточке. Модель отвечает JSON-ом: объяснение + список правок.
// Правки НЕ ложатся в карточку сами — у каждого шага снимок, «Применить» переносит итог.
const CR_SESS_KEY = 'rlm.creator.sessions';
let crSess = null, crChatBusy = false, crChatEdit = null, crCtxOpen = false;
function crSessions() { if (!crSess) crSess = (typeof lsGet === 'function' ? (lsGet(CR_SESS_KEY, []) || []) : []); return Array.isArray(crSess) ? crSess : (crSess = []); }
function crSessSave() { if (typeof lsSet === 'function') lsSet(CR_SESS_KEY, crSessions().slice(0, 20)); }   // храним последние 20
function crCurSess() { return crSessions().find((s) => s.id === crSt.sessCur) || null; }
function crSnapNow() {
  const f = {}; CR_FIELDS.filter((x) => !x.greet).forEach((x) => { f[x.id] = crSt.fields[x.id].v; });
  return { f, g: crSt.greets.map((g) => g.v) };
}
function crSnapOf(s) { for (let i = s.msgs.length - 1; i >= 0; i--) if (s.msgs[i].snap) return s.msgs[i].snap; return s.base; }
function crSnapGet(sn, key) { return String(key).startsWith('greet:') ? (sn.g[+String(key).slice(6)] || '') : (sn.f[key] || ''); }
function crSnapKeys(a, b) {
  const keys = ['name', 'description', 'personality', 'scenario'];
  const n = Math.max((a.g || []).length, (b.g || []).length);
  for (let i = 0; i < n; i++) keys.push('greet:' + i);
  keys.push('mes_example'); return keys;
}
// Имена полей для модели: greeting_1 = первое сообщение (людям в UI — «Приветствие 2» это greeting_2)
function crMdlName(key) { return String(key).startsWith('greet:') ? ('greeting_' + (+String(key).slice(6) + 1)) : key; }
function crKeyFromMdl(name) {
  const m = String(name || '').match(/^greeting[_\s-]?(\d+)$/i);
  if (m) return 'greet:' + Math.max(0, (+m[1] || 1) - 1);
  const id = String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (id === 'first_mes' || id === 'first_message') return 'greet:0';
  return ['name', 'description', 'personality', 'scenario', 'mes_example'].includes(id) ? id : null;
}
function crSnapText(sn) {
  const out = [];
  CR_FIELDS.filter((x) => !x.greet).forEach((x) => { const v = (sn.f[x.id] || '').trim(); if (v) out.push('### ' + crMdlName(x.id) + '\n' + v); });
  (sn.g || []).forEach((v, i) => { if ((v || '').trim()) out.push('### ' + crMdlName('greet:' + i) + '\n' + v.trim()); });
  return out.join('\n\n') || '(the card is empty)';
}
function crRevSchema(s) {
  if (s.scope !== 'card') return '{\n  "justification": "<what you changed and why, 1-2 sentences>",\n  "value": "<the new full text of the field>"\n}';
  return '{\n  "justification": "<what you changed and why, 1-2 sentences>",\n  "changes": [ { "field": "<name|description|personality|scenario|mes_example|greeting_N>", "value": "<new full text>" } ],\n  "greetings_add": [ "<new greeting text>" ],\n  "greetings_remove": [ 2 ]\n}\nUse only the keys you need. Leave a list out if you change nothing there.';
}
function crNewSession(scope, name) {
  const s = { id: 's' + Date.now(), name: name || ((scope === 'card' ? 'Вся карточка' : crLabel(scope)) + ' · ' + new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })),
    scope, readonly: false, base: crSnapNow(), msgs: [] };
  crSessions().unshift(s); crSt.sessCur = s.id; crSessSave(); crSave();
  return s;
}
function crOpenFieldChat(key) {
  const s = crSessions().find((x) => x.scope === key) || crNewSession(key);
  crSt.sessCur = s.id; crChatEdit = null; crShowSide('chat'); crRenderChat();
  setTimeout(() => { const i = document.getElementById('cr-chat-in'); if (i) i.focus(); }, 60);
}
function crNewSessionDlg() {
  const opts = [['card', 'Вся карточка'], ['name', 'Имя'], ['description', 'Описание'], ['personality', 'Личность'], ['scenario', 'Сценарий']]
    .concat(crSt.greets.map((g, i) => ['greet:' + i, crLabel('greet:' + i)])).concat([['mes_example', 'Примеры диалогов']]);
  crModal(crHead('Новая сессия правки') + `<div class="cr-dlg-bd">
    <label class="cr-lbl">О чём говорим</label><select class="cr-sel" id="cr-ns-scope">${opts.map(([k, l]) => `<option value="${k}">${crEsc(l)}</option>`).join('')}</select>
    <div class="cr-note">«Вся карточка» — модель может менять любые поля, добавлять и убирать приветствия. Одно поле — меняет только его.</div>
    </div><div class="cr-dlg-ft"><button class="cr-btn" data-cr="modal-close">Отмена</button><button class="cr-primary" data-cr="ns-ok">Начать</button></div>`, 'small');
}
function crRenderChat() {
  const pane = document.getElementById('cr-pane-chat'); if (!pane) return;
  const list = crSessions(), s = crCurSess();
  const draft = (document.getElementById('cr-chat-in') || {}).value || '';
  let h = `<div class="cr-chat-top">
    <div class="cr-row"><select class="cr-sel cr-grow" data-cr="sess"${list.length ? '' : ' disabled'}>${list.map((x) => `<option value="${x.id}"${x.id === crSt.sessCur ? ' selected' : ''}>${crEsc(x.name)}</option>`).join('') || '<option>сессий нет</option>'}</select>
      <button class="cr-ib hot" data-cr="sess-new">＋ Новая</button><button class="cr-ib" data-cr="sess-del"${s ? '' : ' disabled'} title="Удалить сессию">🗑</button></div>
    ${s ? `<div class="cr-row"><span class="cr-chip" style="padding-right:7px">О чём: ${crEsc(s.scope === 'card' ? 'вся карточка' : crLabel(s.scope))}</span>
      <label class="cr-check" title="Модель только обсуждает и советует — поля не меняет"><input type="checkbox" data-cr="sess-ro"${s.readonly ? ' checked' : ''}> только обсуждать</label></div>` : ''}
  </div>`;
  let log = '';
  if (!s) log = '<div class="cr-empty">Здесь переписка с моделью про карточку: «сделай её злее», «добавь приветствие утром», «сократи описание».<br><br>Модель отвечает правками — у каждой видно «было → стало». Итог переносишь кнопкой «Применить».<br><br><button class="cr-primary" data-cr="sess-new">＋ Новая сессия</button></div>';
  else {
    if (!s.msgs.length && !crChatBusy) log += '<div class="cr-empty">Напиши, что поменять' + (s.scope === 'card' ? ' в карточке' : ' в поле «' + crEsc(crLabel(s.scope)) + '»') + '.</div>';
    s.msgs.forEach((m) => {
      if (crChatEdit === m.id) { log += `<div class="cr-msg user" style="max-width:100%;align-self:stretch"><div class="cr-edit-box"><textarea class="cr-ta" id="cr-edit-ta" rows="4">${crEsc(m.text)}</textarea><div class="cr-row"><button class="cr-primary" data-cr="edit-save" data-id="${m.id}">✓ Отправить заново (всё ниже удалится)</button><button class="cr-ib" data-cr="edit-cancel">Отмена</button></div></div></div>`; return; }
      const acts = (m.role === 'user' && !m.manual && !crChatBusy ? `<button class="cr-ib" data-cr="msg-edit" data-id="${m.id}" title="Изменить и отправить заново">✎</button>` : '')
        + (m.snap && !crChatBusy ? `<button class="cr-ib" data-cr="msg-diff" data-id="${m.id}" title="Что изменилось на этом шаге">⇄ было/стало</button>` : '')
        + (!crChatBusy ? `<button class="cr-ib" data-cr="msg-del" data-id="${m.id}" title="Удалить это и всё ниже">🗑</button>` : '');
      const chips = (m.changes || []).length ? `<div class="cr-changes">${m.changes.map((c) => '<span class="cr-chg">' + crEsc(c) + '</span>').join('')}</div>` : '';
      log += `<div class="cr-msg ${m.role === 'user' ? 'user' : 'ai'}${m.manual ? ' manual' : ''}"><span class="cr-who">${m.role === 'user' ? (m.manual ? 'ты · вручную' : 'ты') : 'модель'}</span><div class="cr-bub">${crEsc(m.text)}</div>${chips}<div class="cr-msg-acts">${acts}</div></div>`;
    });
    const last = s.msgs[s.msgs.length - 1];
    if (!crChatBusy && last && last.role === 'ai' && !crChatEdit) log += '<button class="cr-ib cr-regen" data-cr="regen">↻ Перегенерировать ответ</button>';
    if (crChatBusy) log += '<div class="cr-msg ai"><span class="cr-who">модель</span><div class="cr-bub">пишет…</div></div>';
  }
  h += '<div class="cr-chat-log" id="cr-chat-log">' + log + '</div>';
  if (s) {
    const lock = crChatBusy || !!crChatEdit;
    h += `<div class="cr-chat-in"><textarea class="cr-ta" id="cr-chat-in" placeholder="${s.readonly ? 'Спроси совет — поля не изменятся…' : 'Что поменять? Enter — отправить, Shift+Enter — перенос строки'}"${lock ? ' disabled' : ''}></textarea><button class="cr-primary" data-cr="chat-send"${lock ? ' disabled' : ''} title="Отправить">➤</button></div>
      <div class="cr-chat-foot"><button class="cr-ib" data-cr="state" title="Карточка в этой сессии сейчас">👁 Состояние</button><button class="cr-ib" data-cr="manual"${lock ? ' disabled' : ''} title="Поправить поля руками — ляжет шагом в переписку">✎ Править вручную</button><button class="cr-primary" data-cr="apply"${lock ? ' disabled' : ''} title="Перенести итог сессии в карточку">✓ Применить к карточке</button></div>`;
  }
  pane.innerHTML = h;
  const ci = document.getElementById('cr-chat-in'); if (ci && draft) ci.value = draft;
  const lg = document.getElementById('cr-chat-log'); if (lg) lg.scrollTop = lg.scrollHeight;
  const et = document.getElementById('cr-edit-ta'); if (et) et.focus();
}
// Промт сессии: те же блоки, что у полей (гайд/карточки/ворлд-буки), + состояние карточки + переписка
function crRevMessages(s, userText) {
  const algo = crSt.algos[crSt.algoCur] || crSt.algos.base;
  const on = (k) => { const b = algo.blocks.find((x) => x.tpl === k); return b && b.on; };
  const sn = crSnapOf(s);
  const data = { char: (sn.f.name || '').trim() || '{{char}}', user: '{{user}}', cards: crCardsText(), books: crBooksText(), field: s.scope === 'card' ? 'the whole card' : ('the "' + crEn(s.scope) + '" field'), schema: crRevSchema(s) };
  const msgs = [];
  if (on('guide')) msgs.push({ role: 'system', content: crFill(crSt.tpls.guide.text, data) });
  if (on('cards') && data.cards) msgs.push({ role: 'system', content: crFill(crSt.tpls.cards.text, data) });
  if (on('books') && data.books) msgs.push({ role: 'system', content: crFill(crSt.tpls.books.text, data) });
  msgs.push({ role: 'system', content: crFill(crSt.tpls.rev_task.text, data) });
  s.msgs.forEach((m) => { if (m.role === 'user') msgs.push({ role: 'user', content: m.text }); else msgs.push({ role: 'assistant', content: m.text }); });
  msgs.push({ role: 'system', content: '## The card right now\n' + crSnapText(sn) });
  if (userText) msgs.push({ role: 'user', content: userText });
  if (s.readonly) msgs.push({ role: 'system', content: 'Discussion only: do not change the card, just answer the author.' });
  else msgs.push({ role: 'system', content: crFill(crSt.tpls.rev_json.text, data) });
  return msgs;
}
function crJsonFrom(raw) {
  let t = String(raw == null ? '' : raw);
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {}
  try { return JSON.parse(t.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1')); } catch (_) { return null; }
}
function crApplyRev(s, sn, res) {
  const next = JSON.parse(JSON.stringify(sn)), changes = [];
  const setKey = (key, v) => {
    if (key == null || typeof v !== 'string') return;
    if (String(key).startsWith('greet:')) { const i = +String(key).slice(6); if (next.g[i] === v) return; next.g[i] = v; }
    else { if (next.f[key] === v) return; next.f[key] = v; }
    changes.push('✎ ' + crLabel(key));
  };
  if (s.scope !== 'card') setKey(s.scope, typeof res.value === 'string' ? res.value : res.response);
  else {
    (Array.isArray(res.changes) ? res.changes : []).forEach((c) => { if (c) setKey(crKeyFromMdl(c.field), c.value); });
    (Array.isArray(res.greetings_remove) ? res.greetings_remove : []).map(Number).filter((n) => n > 1).sort((a, b) => b - a)
      .forEach((n) => { if (next.g[n - 1] !== undefined) { next.g.splice(n - 1, 1); changes.push('🗑 Приветствие ' + n); } });
    (Array.isArray(res.greetings_add) ? res.greetings_add : []).forEach((v) => { if (typeof v === 'string' && v.trim()) { next.g.push(v); changes.push('＋ ' + crLabel('greet:' + (next.g.length - 1))); } });
  }
  return { next, changes };
}
async function crRevSend(s, userText, keepUser) {
  const api = crApi();
  if (!api || !api.model) return crToast('Нет ноды «API» с моделью. Выбери подключение в «⚙ Сборке».');
  if (userText && !keepUser) s.msgs.push({ id: 'm' + Date.now(), role: 'user', text: userText });
  crChatBusy = true; crRenderChat();
  try {
    const sn = crSnapOf(s);
    const msgs = crRevMessages(s, keepUser ? userText : '');
    const r = await rlmApi('/api/rlm/generate', { _ctxKey: 'creator.revise', base: api.base, key: api.key, model: api.model, messages: msgs, params: crParams() });
    const raw = (r && (r.text || r.content)) || '';
    if (!raw) throw new Error((r && r.error) || 'модель ответила пусто');
    if (s.readonly) { s.msgs.push({ id: 'm' + Date.now() + 'a', role: 'ai', text: String(raw).trim() }); }
    else {
      const res = crJsonFrom(raw);
      if (!res) throw new Error('ответ не разобрался как JSON — посмотри «>_ Консоль»');
      const { next, changes } = crApplyRev(s, sn, res);
      const msg = { id: 'm' + Date.now() + 'a', role: 'ai', text: String(res.justification || '(без объяснения)').trim(), changes };
      if (changes.length) msg.snap = next;
      s.msgs.push(msg);
    }
    crSessSave();
  } catch (e) {
    crToast('Не вышло: ' + crEsc((e && e.message) || e));
  } finally {
    crChatBusy = false; crRenderChat(); crRenderForm();
  }
}
function crChatSend() {
  const s = crCurSess(), inp = document.getElementById('cr-chat-in'); if (!s || crChatBusy || !inp) return;
  const t = inp.value.trim(); if (!t) return;
  inp.value = ''; crRevSend(s, t);
}
function crStepDiff(s, id) {
  const i = s.msgs.findIndex((m) => m.id === id); if (i < 0 || !s.msgs[i].snap) return;
  const after = s.msgs[i].snap;
  let before = s.base; for (let j = i - 1; j >= 0; j--) if (s.msgs[j].snap) { before = s.msgs[j].snap; break; }
  const html = crSnapKeys(before, after).filter((k) => crSnapGet(before, k) !== crSnapGet(after, k)).map((k) => {
    const d = crWordDiff(crSnapGet(before, k), crSnapGet(after, k));
    return `<div style="margin-bottom:12px"><div class="cr-lbl" style="color:var(--accent);margin-bottom:4px">${crEsc(crLabel(k))}</div><div class="cr-diff">
      <div class="cr-diff-col"><span class="cr-lbl">Было</span><div>${d.l || '<i class="cr-note">пусто</i>'}</div></div>
      <div class="cr-diff-col"><span class="cr-lbl">Стало</span><div>${d.r || '<i class="cr-note">пусто</i>'}</div></div></div></div>`;
  }).join('') || '<div class="cr-note">На этом шаге ничего не изменилось.</div>';
  crModal(crHead('Что изменилось на этом шаге') + '<div class="cr-dlg-bd">' + html + '</div><div class="cr-dlg-ft"><button class="cr-primary" data-cr="modal-close">Закрыть</button></div>');
}
function crStateDlg(s) {
  const sn = crSnapOf(s);
  const body = crSnapKeys(sn, sn).map((k) => `<div style="margin-bottom:10px"><div class="cr-lbl" style="color:var(--accent)">${crEsc(crLabel(k))}</div><div class="cr-diff-col"><div>${crEsc(crSnapGet(sn, k)) || '<i class="cr-note">пусто</i>'}</div></div></div>`).join('');
  crModal(crHead('Карточка в этой сессии') + '<div class="cr-dlg-bd">' + body + '</div><div class="cr-dlg-ft"><button class="cr-primary" data-cr="modal-close">Закрыть</button></div>');
}
function crManualDlg(s) {
  const sn = crSnapOf(s);
  crModal(crHead('Править вручную') + '<div class="cr-dlg-bd"><div class="cr-note">Правка ляжет в переписку шагом «поправил вручную» — модель дальше будет видеть новую версию.</div>'
    + crSnapKeys(sn, sn).map((k) => `<label class="cr-lbl">${crEsc(crLabel(k))}</label><textarea class="cr-ta" data-cr="mk" data-k="${k}" rows="3">${crEsc(crSnapGet(sn, k))}</textarea>`).join('')
    + '</div><div class="cr-dlg-ft"><button class="cr-btn" data-cr="modal-close">Отмена</button><button class="cr-primary" data-cr="manual-ok">Сохранить</button></div>');
}
function crApplySession() {
  const s = crCurSess(); if (!s) return;
  const sn = crSnapOf(s), now = crSnapNow();
  const changed = crSnapKeys(now, sn).filter((k) => crSnapGet(now, k) !== crSnapGet(sn, k));
  if (!changed.length) return crToast('Карточка и сессия совпадают — переносить нечего');
  Object.keys(sn.f).forEach((k) => { if (crSt.fields[k]) crSt.fields[k].v = sn.f[k]; });
  crSt.greets = (sn.g || ['']).map((v, i) => ({ v, i: ((crSt.greets[i] || {}).i) || '' }));
  crSt.gIdx = Math.min(crSt.gIdx, crSt.greets.length - 1);
  crSave(); crRenderForm();
  crToast('✓ Перенесено в карточку: ' + changed.map((k) => crEsc(crLabel(k))).join(', '));
  const side = document.getElementById('cr-side'); if (side) side.classList.remove('open');
}

// ══════════════ СОБЫТИЯ ══════════════
document.addEventListener('click', (e) => {
  const host = document.getElementById('sm-create-view');
  if (!host || host.classList.contains('hidden') || !host.contains(e.target)) return;
  const b = e.target.closest('[data-cr]'); if (!b || b.disabled) return;
  const act = b.dataset.cr, fld = b.closest('.cr-fld'), fid = fld && fld.dataset.f, i = +b.dataset.i;
  const algo = crSt.algos[crSt.algoCur] || crSt.algos.base;
  e.stopPropagation();
  switch (act) {
    case 'modal-close': return crCloseModal();
    case 'mode': crSt.mode = b.dataset.v; crSave(); crRenderBar(); return crRenderForm();
    case 'side': return crShowSide(b.dataset.v);
    case 'side-close': { const s = document.getElementById('cr-side'); if (s) s.classList.remove('open'); return; }
    case 'load': return crOpenLibrary(false);
    case 'unlink': crSt.loadedId = ''; crSave(); crRenderBar(); crRenderForm(); return crToast('Карточка отвязана — поля остались');
    case 'clear': return crClearAll();
    case 'create': return crCreateChar();
    case 'override': return crOverrideChar();
    // поля
    case 'gen': return crGenField(fid, false);
    case 'cont': return crGenField(fid, true);
    case 'clear-f': crSet(fid, ''); crSave(); return crRenderField(fid);
    case 'cmp': return crOpenCompare(fid);
    case 'chat-f': return crOpenFieldChat(crKey(fid));
    // чат-правка
    case 'sess-new': return crNewSessionDlg();
    case 'ns-ok': { const sel = document.getElementById('cr-ns-scope'); const scope = sel ? sel.value : 'card'; crCloseModal(); crNewSession(scope); crChatEdit = null; return crRenderChat(); }
    case 'sess-del': { const s = crCurSess(); if (!s) return; return crConfirm('Удалить сессию', 'Удалить «' + crEsc(s.name) + '» со всей перепиской? Карточку не трогает.', 'Удалить', () => {
      crSess = crSessions().filter((x) => x.id !== s.id); crSessSave(); crSt.sessCur = (crSessions()[0] || {}).id || ''; crSave(); crRenderChat(); crRenderForm();
    }); }
    case 'chat-send': return crChatSend();
    case 'regen': { const s = crCurSess(); if (!s || crChatBusy) return; const removed = s.msgs.pop(); crSessSave();
      const lastUser = [...s.msgs].reverse().find((m) => m.role === 'user' && !m.manual);
      return crRevSend(s, lastUser ? lastUser.text : '', true).catch(() => { s.msgs.push(removed); crRenderChat(); }); }
    case 'msg-edit': crChatEdit = b.dataset.id; return crRenderChat();
    case 'edit-cancel': crChatEdit = null; return crRenderChat();
    case 'edit-save': { const s = crCurSess(); const ta = document.getElementById('cr-edit-ta'); const val = ta ? ta.value.trim() : '';
      const i = s.msgs.findIndex((m) => m.id === b.dataset.id); crChatEdit = null;
      if (i < 0 || !val) return crRenderChat();
      s.msgs = s.msgs.slice(0, i); s.msgs.push({ id: 'm' + Date.now(), role: 'user', text: val }); crSessSave();
      return crRevSend(s, val, true); }
    case 'msg-del': { const s = crCurSess(); return crConfirm('Удалить сообщение', 'Удалить это сообщение и всё, что ниже?', 'Удалить', () => {
      const i = s.msgs.findIndex((m) => m.id === b.dataset.id); s.msgs = s.msgs.slice(0, Math.max(0, i)); crSessSave(); crRenderChat(); crRenderForm();
    }); }
    case 'msg-diff': { const s = crCurSess(); return crStepDiff(s, b.dataset.id); }
    case 'state': { const s = crCurSess(); return crStateDlg(s); }
    case 'manual': { const s = crCurSess(); return crManualDlg(s); }
    case 'manual-ok': { const s = crCurSess(); const sn = crSnapOf(s); const next = JSON.parse(JSON.stringify(sn)); const ch = [];
      crQA('#cr-modal [data-cr="mk"]').forEach((ta) => { const k = ta.dataset.k;
        const was = crSnapGet(sn, k); if (was === ta.value) return;
        if (String(k).startsWith('greet:')) next.g[+String(k).slice(6)] = ta.value; else next.f[k] = ta.value;
        ch.push(crLabel(k)); });
      crCloseModal(); if (!ch.length) return;
      s.msgs.push({ id: 'm' + Date.now(), role: 'user', manual: true, text: 'Поправил вручную: ' + ch.join(', '), snap: next, changes: ch.map((x) => '✎ ' + x) });
      crSessSave(); return crRenderChat(); }
    case 'apply': return crApplySession();
    // лорбук
    case 'lore-gen': return crLoreSuggest();
    case 'sug-add': return crLoreAdd(b.dataset.id);
    case 'sug-rej': return crLoreReject(b.dataset.id);
    case 'sug-cmp': return crLoreCompare(b.dataset.id);
    case 'lore-add-all': return crConfirm('Добавить все', 'Добавить в книгу все предложенные записи (' + (crSt.loreSug || []).length + ')?', 'Добавить', () => {
      let k = 0; (crSt.loreSug || []).slice().forEach((x) => { k += crLoreAdd(x.id, true); });
      crRenderForm(); crToast('✓ Добавлено записей: ' + k);
    });
    case 'lore-black-clear': crSt.loreBlack = []; crSave(); return crRenderForm();
    case 'tr-prev': return crTrPreview(fid, b);
    case 'tr-repl': return crTrReplace(fid, b);
    case 'g-prev': crSt.gIdx = (crSt.gIdx - 1 + crSt.greets.length) % crSt.greets.length; return crRenderField('first_mes');
    case 'g-next': crSt.gIdx = (crSt.gIdx + 1) % crSt.greets.length; return crRenderField('first_mes');
    case 'g-add': crSt.greets.push({ v: '', i: '' }); crSt.gIdx = crSt.greets.length - 1; crSave(); return crRenderField('first_mes');
    case 'g-del': return crConfirm('Удалить приветствие', 'Удалить «' + crEsc(crLabel('greet:' + crSt.gIdx)) + '»?', 'Удалить', () => {
      crSt.greets.splice(crSt.gIdx, 1); crSt.gIdx = Math.max(0, crSt.gIdx - 1); crSave(); crRenderField('first_mes');
    });
    // заметки
    case 'notes-toggle': crSt.notesOpen = !crSt.notesOpen; crSave(); return crRenderForm();
    case 'note-add': crSt.notes.push({ t: 'Новая заметка', v: '' }); crSt.notesOpen = true; crSave(); return crRenderForm();
    case 'note-del': return crConfirm('Удалить заметку', 'Удалить заметку «' + crEsc((crSt.notes[i] || {}).t || '') + '»?', 'Удалить', () => { crSt.notes.splice(i, 1); crSave(); crRenderForm(); });
    case 'note-gen': return crGenNote(i);
    // общая инструкция
    case 'instr-new': return crAsk('Новый пресет инструкции', (crSt.instr[crSt.instrCur].name || '') + ' (копия)', (name) => {
      const id = 'i' + Date.now(); crSt.instr[id] = { name, com: crSt.instr[crSt.instrCur].com, text: crSt.instr[crSt.instrCur].text };
      crSt.instrCur = id; crSave(); crRenderForm(); crToast('Пресет «' + crEsc(name) + '» создан');
    });
    case 'instr-ren': return crAsk('Переименовать пресет', crSt.instr[crSt.instrCur].name || '', (name) => { crSt.instr[crSt.instrCur].name = name; crSave(); crRenderForm(); });
    case 'instr-del': return crConfirm('Удалить пресет', 'Удалить пресет инструкции «' + crEsc(crSt.instr[crSt.instrCur].name) + '»?', 'Удалить', () => { delete crSt.instr[crSt.instrCur]; crSt.instrCur = 'base'; crSave(); crRenderForm(); });
    // сборка
    case 'fmt': crSt.format = b.dataset.v; crSave(); return crRenderBuild();
    case 'trby': crSt.trBy = b.dataset.v; crSave(); return crRenderBuild();
    case 'opts-reset': return crConfirm('Вернуть заводские', 'Вернуть заводские значения сэмплеров?', 'Вернуть', () => { crSt.opts = CR_OPT_DEF.slice(); crSt.apiPreset = ''; crSave(); crRenderBuild(); });
    // алгоритм
    case 'up': { const t = algo.blocks[i - 1]; algo.blocks[i - 1] = algo.blocks[i]; algo.blocks[i] = t; crSave(); return crRenderAlgo(); }
    case 'down': { const t = algo.blocks[i + 1]; algo.blocks[i + 1] = algo.blocks[i]; algo.blocks[i] = t; crSave(); return crRenderAlgo(); }
    case 'block-del': algo.blocks.splice(i, 1); crSave(); return crRenderAlgo();
    case 'block-add': return crAsk('Свой блок: название шаблона', 'Мой блок', (name) => {
      const id = 'u' + Date.now();
      crSt.tpls[id] = { name, grp: 'fields', custom: true, com: 'Свой шаблон — напиши здесь, зачем он.', vars: ['{{char}}', '{{user}}', '{{field}}'], text: '' };
      Object.values(crSt.algos).forEach((a) => a.blocks.splice(Math.max(0, a.blocks.length - 1), 0, { tpl: id, on: true, role: 'system' }));
      crSave(); crRenderAlgo(); crOpenTpl(id);
    });
    case 'algo-new': return crAsk('Новый алгоритм сборки', (algo.name || '') + ' (копия)', (name) => {
      const id = 'a' + Date.now(); crSt.algos[id] = { name, com: algo.com, blocks: JSON.parse(JSON.stringify(algo.blocks)) };
      crSt.algoCur = id; crSave(); crRenderAlgo(); crToast('Алгоритм «' + crEsc(name) + '» создан');
    });
    case 'algo-ren': return crAsk('Переименовать алгоритм', algo.name || '', (name) => { algo.name = name; crSave(); crRenderAlgo(); });
    case 'algo-del': return crConfirm('Удалить алгоритм', 'Удалить «' + crEsc(algo.name) + '»?', 'Удалить', () => { delete crSt.algos[crSt.algoCur]; crSt.algoCur = 'base'; crSave(); crRenderAlgo(); });
    case 'algo-restore': return crConfirm('Вернуть заводской', 'Вернуть «Базовому» заводской порядок, роли и галочки?', 'Вернуть', () => { crSt.algos.base = JSON.parse(JSON.stringify(CR_ALGO_DEFAULTS.base)); crSave(); crRenderAlgo(); });
    case 'reset-all': return crConfirm('Сбросить к заводским', 'Вернуть заводские алгоритмы и шаблоны? Модель, формат, поля карточки не трогаем.', 'Сбросить', () => {
      crSt.tpls = JSON.parse(JSON.stringify(CR_TPL_DEFAULTS)); crSt.algos = JSON.parse(JSON.stringify(CR_ALGO_DEFAULTS)); crSt.algoCur = 'base';
      crSave(); crRenderAlgo(); crToast('Алгоритмы и шаблоны — заводские');
    });
    // шаблоны
    case 'tpl-edit': return crOpenTpl(b.dataset.tpl);
    case 'tpl-reset': { const k = b.dataset.tpl, d = CR_TPL_DEFAULTS[k]; if (!d) return; const ta = document.getElementById('cr-tpl-text'), co = document.getElementById('cr-tpl-com'); if (ta) ta.value = d.text; if (co) co.value = d.com; return; }
    case 'tpl-del': { const k = b.dataset.tpl; crCloseModal(); return crConfirm('Удалить шаблон', 'Удалить «' + crEsc((crSt.tpls[k] || {}).name || '') + '»? Блок уберётся из всех алгоритмов.', 'Удалить', () => {
      delete crSt.tpls[k]; Object.values(crSt.algos).forEach((a) => { a.blocks = a.blocks.filter((x) => x.tpl !== k); }); crSave(); crRenderAlgo();
    }); }
    case 'tpl-ok': { const k = b.dataset.tpl, t = crSt.tpls[k]; if (t) {
      const co = document.getElementById('cr-tpl-com'), ta = document.getElementById('cr-tpl-text'), nm = document.getElementById('cr-tpl-name');
      if (co) t.com = co.value; if (ta) t.text = ta.value; if (nm && t.custom) t.name = nm.value.trim() || t.name;
      crSave();
    } crCloseModal(); return crRenderAlgo(); }
    // контекст
    case 'cards-pick': return crOpenLibrary(true);
    case 'books-pick': return crOpenBooks();
    case 'card-x': crSt.ctxCards = crSt.ctxCards.filter((x) => x !== b.dataset.id); crSave(); return crRenderAlgo();
    case 'book-x': crSt.ctxBooks = crSt.ctxBooks.filter((x) => x !== b.dataset.id); crSave(); return crRenderAlgo();
    case 'lib-card': {
      const multi = !!crQ('#cr-modal').dataset.multi;
      if (!multi) return crLoadCard(b.dataset.id);
      b.classList.toggle('pick'); return;
    }
    case 'lib-ok': { crSt.ctxCards = crQA('#cr-modal .sm-card.pick').map((c) => c.dataset.id); crSave(); crCloseModal(); return crRenderAlgo(); }
    case 'wb-ok': { crSt.ctxBooks = crQA('#cr-modal [data-cr="wb"]').filter((c) => c.checked).map((c) => c.dataset.id); crSave(); crCloseModal(); return crRenderAlgo(); }
  }
}, true);

document.addEventListener('input', (e) => {
  const host = document.getElementById('sm-create-view');
  if (!host || host.classList.contains('hidden') || !host.contains(e.target)) return;
  const t = e.target, act = t.dataset.cr, i = +t.dataset.i;
  if (act === 'val') { crSet(t.dataset.f, t.value); if (t.tagName === 'TEXTAREA') crAutogrow(t); crSave();
    const el = t.closest('.cr-fld'); if (el) { const has = !!t.value; ['cont', 'clear-f'].forEach((a) => { const btn = el.querySelector('[data-cr="' + a + '"]'); if (btn) btn.disabled = !has; }); } return; }
  if (act === 'instr-f') { crSetI(t.dataset.f, t.value); return crSave(); }
  if (act === 'note-t') { if (crSt.notes[i]) crSt.notes[i].t = t.value; return crSave(); }
  if (act === 'note-v') { if (crSt.notes[i]) crSt.notes[i].v = t.value; crAutogrow(t); return crSave(); }
  if (act === 'instr-com') { crSt.instr[crSt.instrCur].com = t.value; return crSave(); }
  if (act === 'instr-text') { crSt.instr[crSt.instrCur].text = t.value; return crSave(); }
  if (act === 'opt') { crSt.opts[i] = t.value; return crSave(); }
  if (act === 'tropt') { crSt.trOpts[i] = t.value; return crSave(); }
  if (act === 'algo-com') { (crSt.algos[crSt.algoCur] || {}).com = t.value; return crSave(); }
  if (act === 'lore-task') { crSt.loreTask = t.value; crAutogrow(t); return crSave(); }
  if (act === 'lore-count') { crSt.loreCount = Math.max(1, Math.min(10, parseInt(t.value, 10) || 4)); return crSave(); }
  if (act === 'sug-name' || act === 'sug-keys' || act === 'sug-content') {
    const sg = (crSt.loreSug || []).find((x) => x.id === t.dataset.id); if (!sg) return;
    sg[act === 'sug-name' ? 'name' : act === 'sug-keys' ? 'keys' : 'content'] = t.value;
    if (act === 'sug-content') crAutogrow(t);
    return crSave();
  }
});

document.addEventListener('change', (e) => {
  const host = document.getElementById('sm-create-view');
  if (!host || host.classList.contains('hidden') || !host.contains(e.target)) return;
  const t = e.target, act = t.dataset.cr, i = +t.dataset.i;
  const algo = crSt.algos[crSt.algoCur] || crSt.algos.base;
  if (act === 'model') { if (t.value === 'p') return; crSt.model = +t.value; crSt.apiPreset = ''; crSave(); return crRenderBuild(); }
  if (act === 'apipreset') {
    crSt.apiPreset = t.value;
    const p = crApiPresets().find((x) => x.id === t.value);
    if (p && p.options && Array.isArray(p.options.values)) crSt.opts = p.options.values.slice();
    crSave(); crRenderBuild();
    if (p) crToast('Пресет «' + crEsc(p.name) + '»: модель ' + crEsc((p.api || {}).model || '') + ', сэмплеры подставлены');
    return;
  }
  if (act === 'trmodel') { crSt.trModel = +t.value; return crSave(); }
  if (act === 'instr-sel') { crSt.instrCur = t.value; crSave(); return crRenderForm(); }
  if (act === 'algo') { crSt.algoCur = t.value; crSave(); return crRenderAlgo(); }
  if (act === 'block-on') { algo.blocks[i].on = t.checked; crSave(); return crRenderAlgo(); }
  if (act === 'block-role') { algo.blocks[i].role = t.value; return crSave(); }
  if (act === 'no-other-greets') { crSt.noOtherGreets = t.checked; return crSave(); }
  if (act === 'lore-book') { crSt.loreTarget = t.value; crSave(); return crRenderForm(); }
  if (act === 'sess') { crSt.sessCur = t.value; crChatEdit = null; crSave(); return crRenderChat(); }
  if (act === 'sess-ro') { const s = crCurSess(); if (s) { s.readonly = t.checked; crSessSave(); } return crRenderChat(); }
});
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'cr-chat-in' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); crChatSend(); }
}, true);
window.addEventListener('resize', () => { const h = document.getElementById('cr-form'); if (h) crQA('#cr-form textarea').forEach(crAutogrow); });
