# RLM — Форматы данных (как есть сейчас)

> **Устав документа**
> - **Зачем:** зафиксировать форматы хранения и их инварианты — чтобы ничего не нарушить при правках.
> - **Что сюда пишем:** структуру карточек, чатов, лорбуков, памяти; где файлы; что нельзя ломать.
> - **Чего НЕ пишем:** историю, детали UI-компонентов (это `architecture.md`).
> - **Правило ведения:** обновляется только при реальном изменении формата.

## Карточки персонажей — JSON внутри PNG (Card v2/v3)

Один `.png` = аватар + данные. JSON в `tEXt`-чанке PNG, закодирован base64. Ключ `ccv3` (v3) приоритетно, иначе `chara` (v2). Наш выбор: **карточки остаются в JSON** (родной формат ST, доступ к экосистеме Chub и др.).

Основные поля `data.*`: `name, description, personality, scenario, first_mes, mes_example, system_prompt, post_history_instructions, alternate_greetings[], character_book, tags, creator, extensions{}`.

**Правка карточки в библиотеке** (меню персонажа): имя пишется и в `ch.name`, и в `card.name`; тексты полей — в те же `data.*`; показанное приветствие — в `first_mes` или в `alternate_greetings[i]`. Записи встроенного `character_book` пишутся как у SillyTavern (`keys, secondary_keys, comment, content, constant, selective, selectiveLogic, insertion_order, case_sensitive, position, enabled`), а **наши надстройки** записи (тип триггера, семантика, метки Режиссёра — весь наш объект записи) кладутся в **`extensions.rlm`** и читаются оттуда назад (`parseLorebook`). Так карточка остаётся читаемой любым ST-клиентом, а RLM ничего своего не теряет.

Файлы: `data/<user>/characters/*.png`.

## Чаты — JSONL (одна строка = одно сообщение)

- Строка 1 — метаданные чата (`user_name, character_name, create_date, chat_metadata{}`).
- Строки 2..N — сообщения: `{name, is_user, is_system, send_date, mes, extra{}, swipes[]}`.

Плюсы: быстрый append, крашеустойчивость (битая строка не рушит файл). Файлы: `data/<user>/chats/<Персонаж>/*.jsonl`.

## Лорбуки / миры — JSON

`data/<user>/worlds/*.json`, структура `{entries: {0:{…}}}`. Запись: `key[]` (regex-триггеры), `content`, `constant`, `order`, `position`, `depth`, `probability`, рекурсия, timed-эффекты. Наш выбор: **лорбуки остаются в JSON**.

## Память — Markdown (плагин soul-md)

Наш выбор: **память в MD** (человекочитаемо, как в Soul of Waifu). Файлы привязаны к чату: `plugins/soul-md/data/<id_чата>/`:
- `Diary_ГГГГ-ММ-ДД.md` — дневник, append реплик со временем.
- `<Имя трекера>.md` — трекеры, перезапись на месте (имя = имя дока «Души»: `Статус.md`/`Мир.md`/`Психика.md`; старые данные ST могли быть `Status.md`/`World.md`/`Psyche.md`).
- `topics/*.md` — темы по фактам, семантический RAG. `*.md.off` = отключённая тема.
- **Ручные записи** (вид дока «ручная»: `Skills`, `Canon`) лежат **там же и так же, как трекеры** — `<Имя дока>.md` в корне папки чата. Отличие только в том, кто пишет: движок памяти их **не трогает**, файл заводит и правит человек (поле записи в ноде `Душа` → `/doc-save` с `group: tracker`).

**Как пишет (2026-08-29):** трекеры одной Души обновляются **одним запросом** (`updateMemoryBatch`) — модель возвращает документы блоками `### Имя`, код раскладывает их по файлам. В сетевой игре у каждого игрока своя папка `<чат>:<игрок>`, у Души мира — папка партии; на старте документы засеваются из описания «Персоны».

**Кто пишет:** движок памяти фронта (`updateMemory`) через маршруты `/api/rlm/soul/{append,tracker,topic-save}` (до CSRF); доки вида `manual` он пропускает. `<id_чата>` = `_chatId` ноды `Чат` (генерится, живёт в сборке; «Новый чат» → новый id → новая папка). Чтение в промт/вьюер — `/api/rlm/soul/{all,diary,topics}`. **Ручная правка/удаление** записей из ноды `Душа` — `/api/rlm/soul/{doc-save,doc-del}` (перезапись/удаление файла по `{chat,group,name}`); удаление всей памяти чата — `/purge`.

Инвариант: удаление чата в ST → `CHAT_DELETED` → `/purge` стирает папку памяти этого чата.

**Сопроводительный промт дока** (`lead`) — не файл на диске, а поле **сборки** (живёт в ноде `Душа`, сохраняется вместе с графом). При подмешивании памяти в промт он идёт строкой **между заголовком блока и текстом записи**: `## Имя
<сопроводительный промт>
<запись>`. Пусто → блок как раньше, без строки.

## Озвучка (TTS) — модель и аудио (ПК-only, папка `tts/`)

Подсистема OmniVoice изолирована от мотора ST (`tts/` в корне проекта, **не** в `server/`). Файлы:
- `tts/model/` — веса **OmniVoice** в HF-формате: `config.json`, `model.safetensors` (+ `audio_tokenizer/model.safetensors`), `tokenizer.json`/`tokenizer_config.json`, `chat_template.jinja` (~3 ГБ). Наш выбор: модель **скопирована в папку проекта** (реальные файлы, не symlink — иначе загрузка падает).
- **Образец голоса** (`ref_audio`) — **WAV** пользователя; в графе хранится только **путь**, сам файл не копируется. *(ffmpeg не установлен → mp3-образцы без него не читаются; для WAV не нужен.)*
- `tts/out/out.wav` (и `out.ogg` для голосового Telegram) — результат, **24 kHz, ОДИН файл с перезаписью**: каждая новая озвучка удаляет прошлый (не накапливаем). Рендереру звук уходит base64-ом (CSP `file://` не пускает произвольный `file://` в `<audio>`).
- `tts/voices/<id>.wav` — **сохранённые голоса-профили** (сгенерированные генератором и записанные по «💾 Сохранить»). Файлы-образцы пользователя тут НЕ дублируются — на них хранится путь.
- **Библиотека голосов** — в серверном сторе, ключ **`rlm.tts.voices`** = `[{id, name, file, refText, seed, instruct, settings, _own}]` (общая на все чаты). `file` — путь к WAV (в `tts/voices/` или к образцу пользователя); `seed` — фикс./`null`(случайный); `settings` = профиль `{lang, tagging, nums, bools}` (подтягивается при выборе голоса); `_own` — наш ли это файл (можно удалять). Точность модели — ключ `rlm.tts.dtype` (fp16/bf16/fp32).
- `tts/venv/` — изолированный Python 3.12 + torch cu124 + omnivoice (ставится `setup_env.ps1`); в граф/сессии не входит.

Инвариант: `tts/` — отдельная Python-подсистема (сервис 8123), не мешать с Node-мотором ST (8100). Torch-сборку подбирать под драйвер GPU (детали — `architecture.md`, раздел «OmniVoice TTS»).

## Сборка (граф нод) — JSON в серверной базе (фронтенд)

Граф сериализуется (`serializeGraph`) и хранится в **серверной базе** (`rlm-store`): пресет — `rlm.preset.<id>`, снимок чата — `rlm.chatgraph.<id>` (легаси-ключ `rlm.graph`). Формат ноды:
- `nodes[]`: `{ type, x, y, collapsed, data }` — `type` = api / options / local / sysprompt / prompt / character / persona / lorebook / soul / director / embedder / translator / tts / chat / console / scanner; `data` = значения ноды по типу:
  - `api` — провайдер/URL/ключ/модель/режим/**label**; `options` — сэмплеры (+**label**); `local` — сэмплеры; `sysprompt` — `{ text, mix, order, label, prefill, prefillOn }` (свой текст + режим смешивания с ВХОДЯЩИМ промтом по проводу — карточка/Душа/др.; `label` — подпись ноды; `prefill`+`prefillOn` — «начать ответ модели с…» и галочка вкл/выкл, уходит последним сообщением роли assistant); `prompt` — плашки комплитера; `character` — поля/аватар; `persona` — `{ activeId, name, avatar, desc }` (`activeId` — id активной персоны из общей библиотеки `rlm.personas`; `name/avatar/desc` дублируются в снимок для совместимости/восстановления); `chat` — `{ msgs, chatId }` (`chatId` = папка памяти чата); `console`/`scanner` — без данных (журнал/предпросмотр эфемерны).
  - `lorebook` — `{ entries[], scan, scope }`, где запись = `{ id, name, trigger, injection, keys, keys2, logic, whole, case, content, sticky, cooldown, delay, prob, order, constant, ignoreBudget }` (+ поля под тип: `semTrigger`/`semThreshold`/`vecThreshold`, `msgMin`/`msgMax`, `dependsOn`/`chainDelay`). `trigger` = keyword/semantic/vectorized/always_on/range/random/chain; `injection` = lore/event; `scan` = дальность сканирования; `scope` = world/char/chat (видна в имени «Лорбук · <область>»). **`order`** — приоритет для **бюджета** (выше = раньше влезает; импорт из ST `insertion_order`); **`ignoreBudget`** — запись всегда влезает мимо лимита (импорт из `extensions.ignore_budget`). Бюджет — «% от контекста» (движок `loreText`/`loreBudgetTokens`, см. `architecture.md`/`decisions.md` Р-22).
  - `embedder` — `{ model }` (multilingual-e5-small / all-MiniLM-L6-v2 / jina-…-en). `translator` — `{ preview:{provider}, replace:{provider}, prompt, prefill, prefillOn }` (провайдер каждого режима google/yandex/bing/neuro; при «Нейро» — секция «Нейро-промт»: `prompt` = инструкция перевода, `prefill`+`prefillOn` = префилл с галочкой; **боковой ВЫХОД** ноды втыкается в разъём «Промт» ноды `API·перевод`). `tts` — `{ refAudio, refText, lang, tagging, voiceMode, design{}, whisper, testPhrase, seed, nums{}, bools{}, autoSpeak }` (нода «Озвучка»: `refAudio` = **путь** к WAV-образцу голоса — сам файл в граф НЕ копируется; `refText` = транскрипт образца; `lang`; `tagging` = галочка авто-тегов; `voiceMode` = `clone`\|`design` (образец\|генератор); `design` = черты генератора `{gender,age,pitch,accent}` + `whisper`; `testPhrase` = фраза пробы; `seed` = отдельное поле, `-1`=случайный; `nums` = числовые сэмплеры по РЕАЛЬНЫМ именам omnivoice: `num_step`/`guidance_scale`/`t_shift`/`speed`/`duration`/`position_temperature`/`class_temperature`/`layer_penalty_factor`/`audio_chunk_duration`/`audio_chunk_threshold` (seed — уже отдельно); `bools` = `denoise`/`preprocess_prompt`/`postprocess_output`/`normalize_text`; `autoSpeak` = авто-озвучивание каждой реплики ИИ: перевод→голос, ПК-only). Библиотека сохранённых голосов — отдельно (`rlm.tts.voices`, см. раздел «Озвучка (TTS)»). `soul` — `{ docs[], batch, delta, topk }`, где док = `{ id, name, kind, desc, enabled, custom }` (`kind` = diary/tracker/topic; `desc` — строка «за что док»; `enabled` — вкл/выкл; `custom` — свой добавленный док, его можно удалять, дефолтные только выключаются); `batch`/`delta`/`topk` — настройки движка памяти (обновлять каждые N сообщ. / глубина анализа / тем в контекст RAG; из SW). Инструкции доков в граф НЕ пишутся — они в подключённых нодах `sysprompt` (провод в порт дока `doc:<id>`); сами MD-файлы памяти пишет движок на диск.
- `connections[]`: `{ from:[nodeIndex, portKey], to:[nodeIndex, portKey] }`, где `portKey` **семантический** (`plate:<id>`, `field:<id>`, `doc:<id>` — вход дока `Души`, `in:prompt|options`, `in:lastmes` — нижняя ножка «Последнее сообщение» ноды `Чат`, `out`, `in`) — устойчив к перерисовке нод. **Боковые порты со своим ключом:** `Транслитер` — svc-**out** (ключ `out`, втыкается в `in:prompt` `API·перевод`; бывший вход `in:neuro` убран); `Озвучка` — вход `in` ← выход `out` ноды `Чат`.

Инвариант: провода восстанавливаются по `portKey`, а не по порядку DOM. *(Старый ключ `in:firstmes` больше не существует — ножку «Первое сообщение» убрали, приветствие засевается авто от `Персонажа`; сборки с этим ключом грузятся без ошибки — `findPort` вернёт `null`, провод пропустится.)*

**Ключ/настройки `API`** — в **серверной базе** (ключ `rlm.apiConfig` = `{ provider, base, key, model, mode }`), **не в графе**; одно соединение на все устройства (см. `decisions.md` Р-30). При экспорте графа в файл ключа нет. Сборки/сессии — тоже в серверной базе: `rlm.presets`/`rlm.preset.<id>` (пресеты), `rlm.chatgraph.<id>` (снимок чата), `rlm.current` (контекст); `rlm.graph` — **легаси**. Оформление (одна сессия): `rlm-style`/`rlm-preset`/`rlm-wire2`/`rlm-wire-op`/`rlm.shade`.

## Стартовое меню: персонажи / чаты / пресеты (серверная база; кнопка ☰)

Отдельно от графа, в **серверной базе** (одна сессия на все устройства; см. `decisions.md` Р-30, Р-21):
- `rlm.characters` — библиотека: `[{ id, name, card, avatar? }]` (регистрируется при загрузке карточки в ноду «Персонаж»).
- `rlm.personas` — **общая библиотека персон** (профиль игрока, одна на все чаты): `[{ id, name, avatar, desc }]`. Нода «Пользователь» держит активную (её `activeId` — в снимке графа), выпадашкой выбираешь/＋добавляешь/✕удаляешь; правки полей идут write-through в активную персону (см. `architecture.md`).
- `rlm.chats.<charId>` — чаты персонажа: `[{ id, name, preset }]` (`id` = `_chatId` = папка памяти `plugins/soul-md/data/<id>/`; `preset` = метка пресета запуска).
- `rlm.chatlog.<chatId>` — сообщения чата: `{ msgs: [...] }` (пишет `persistChatLog`). Сообщение = `{ role:'user'|'char'|'sys', text, … }`.
- `rlm.chatlog.<chatId>.bak` — резервная копия лога `{ msgs, at }` перед тем, как синхронизация приняла серверную версию.

**Перевод-предпросмотр** реплики (кнопка 🌐 EN→RU) хранится прямо в сообщении: `_tr` (русский текст) + `_showTr` (показывать ли перевод) — **закреплён за репликой и сохраняется в лог**, но в **промт к модели и в консоль НЕ идёт** (все сборщики контекста читают только `text`; правка текста реплики снимает `_tr/_showTr`). У **приветствия** с вариантами (`swipes`) перевод хранится ПО ВАРИАНТАМ — `swipeTr = { <индекс>: <перевод> }`: листаешь ‹ › — каждый вариант показывает свой перевод, чужой не подставляется. Разбор критика в реплике — `criticReview = { reason }` (только сам разбор; полные «было»/«стало» не хранятся — раздували лог).
- `rlm.chatgraph.<chatId>` — **снимок графа чата** (что помнит чат: расстановка/содержимое/настройки).
- `rlm.presets` — `[{ id, name }]` (верхний = дефолт); `rlm.preset.<id>` — граф пресета.
- `rlm.current` — `{ mode:'preset'|'chat', presetId, charId, chatId }` (текущий контекст). **Читается только своё** — из `localStorage` устройства; серверная копия обновляется и служит сидом для первого входа на новом устройстве. Телефон и ПК могут быть в разных чатах.
- **Ворлд-буки** (библиотека World Info на постоянке, отдельно от персонажей/пресетов; вкладка «Лорбуки»): `rlm.worldbooks` — `[{ id, name, cover, srcId? }]` (`cover` = data-URL обложки; `srcId` = метка источника `chub:lorebooks/…`, если скачан из каталога); `rlm.worldbook.<id>` — `{ entries }` (записи ST-формата, как у ноды `Лорбук`); `rlm.activeWorldbook` — id активного (или `null`; применяется в ноду `Лорбук мира` на все чаты).

**Новый чат = дефолт:** свежий `_chatId`, пустой чат, лорбук персонажа ← `character_book` карточки, **лорбук чата пустой**, **лорбук мира (World Info) сохраняется** (держится пресетом; если выбран активный ворлд-бук — его записи), Душа пустая. **Удаление персонажа** (✕ в меню) стирает его чаты/логи/снимки/память.

## Принцип разделения форматов

Медленный авторский контент (карточки/лорбуки/память) — читаемые форматы (JSON/MD). Горячий лог чата — JSONL (append + метаданные на сообщение). Подробное обоснование — `decisions.md` и `backend-research.md`.
