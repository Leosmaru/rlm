// ============================================================================
// rlm-cards.js — родной маршрут RLM: каталог карточек с внешних сайтов
// (chub.ai и character-tavern.com) для стартового меню.
//
// Зачем: холст RLM на file:// не может ходить на эти сайты напрямую (CORS + CSP),
// и парсить их удобнее на сервере. Здесь — поиск по каталогу, список тегов,
// получение полной карточки (для чтения описания и скачивания в библиотеку) и
// прокси картинок-миниатюр (отдаём data:-URL, чтобы CSP `img-src data:` их пустил).
//
// Все данные — публичные GET к самим сайтам. Ключей/логина не требуется.
// Монтируется в server-main.js ДО CSRF (как rlm.js / rlm-soul.js).
//
// Маршруты:
//   POST /api/rlm/cards/search {source, query, tags, nsfw, page, limit} -> {ok, items, count}
//   POST /api/rlm/cards/tags   {source}                                 -> {ok, tags:[{tag,count}]}
//   POST /api/rlm/cards/card   {source, id, ctId?}                      -> {ok, card, avatar, tags}
//   POST /api/rlm/cards/image  {url}                                    -> {ok, dataUrl}
// ============================================================================
import express from 'express';
import zlib from 'node:zlib';
import { Jimp, JimpMime } from '../jimp.js';

export const router = express.Router();

const UA_CHUB = 'SillyTavern';
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Разрешённые хосты для прокси картинок (чтобы это не был открытый прокси).
const IMG_HOSTS = [
    'avatars.charhub.io',
    'charhub.io',
    'ct-cards.storage.character-tavern.com',
    'ct-avatar.storage.character-tavern.com',
    'sv.risuai.xyz',
];

// fetch с таймаутом — внешний сайт не должен вешать сервер.
async function fetchT(url, options, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs || 20000);
    try {
        return await fetch(url, { ...options, signal: ac.signal });
    } finally {
        clearTimeout(timer);
    }
}

// URL-энкодинг пути «author/slug» посегментно (в slug бывают пробелы/регистр).
const encPath = (p) => String(p || '').split('/').map(encodeURIComponent).join('/');

// ── chub.ai ─────────────────────────────────────────────────────────────────
async function chubSearch({ query, tags, nsfw, page, limit, sort, kind }) {
    const lore = kind === 'lorebook';                                  // отдельные лорбуки (namespace=lorebooks)
    const p = new URLSearchParams();
    p.set('search', query || '');
    p.set('first', String(limit || 30));
    p.set('page', String(page || 1));
    p.set('nsfw', nsfw ? 'true' : 'false');
    p.set('nsfl', nsfw ? 'true' : 'false');
    p.set('sort', sort === 'new' ? 'created_at' : (lore ? 'star_count' : 'download_count'));   // популярное / новое
    p.set('asc', 'false');
    p.set('venus', 'true');
    p.set('include_forks', 'true');
    if (lore) p.set('namespace', 'lorebooks');
    if (tags && tags.length) p.set('tags', tags.join(','));
    const r = await fetchT(`https://api.chub.ai/search?${p.toString()}`, { headers: { 'User-Agent': UA_CHUB, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('chub search ' + r.status);
    const j = await r.json();
    const nodes = (j && j.data && j.data.nodes) || [];
    const items = nodes.map((n) => {
        const segs = String(n.fullPath || '').split('/');
        const author = segs[0] === 'lorebooks' ? (segs[1] || '') : (segs[0] || '');
        return {
            source: 'chub',
            kind: lore ? 'lorebook' : 'character',
            id: n.fullPath,
            name: n.name,
            author,
            tagline: (n.tagline || '').trim(),
            blurb: (n.description || n.tagline || '').trim(),   // полное авторское описание (для карточки списка)
            tags: Array.isArray(n.topics) ? n.topics.map((t) => String(t).trim()).filter(Boolean) : [],
            downloads: lore ? (n.n_favorites || 0) : (n.nMessages || 0),
            likes: n.starCount || 0,
            messages: n.nMessages || 0,
            nsfw: !!n.nsfw_image,
            hasLorebook: lore ? true : (Array.isArray(n.related_lorebooks) && n.related_lorebooks.length > 0),
            thumb: n.max_res_url || n.avatar_url || '',   // max_res — резкий источник (сервер уменьшит под плитку); avatar_url мелкий → размыт
        };
    });
    return { items, count: (j && j.data && j.data.count) || items.length };
}
// Записи отдельного лорбука chub → {name, entries} (ST-формат из embedded_lorebook).
async function chubLorebook(fullPath) {
    const segs = String(fullPath).split('/').filter(Boolean);
    const rest = segs[0] === 'lorebooks' ? segs.slice(1) : segs;       // "lorebooks/creator/project" → creator/project
    const creator = rest[0], project = rest[1];
    if (!creator || !project) throw new Error('bad lorebook path');
    const r = await fetchT(`https://api.chub.ai/api/lorebooks/${encodeURIComponent(creator)}/${encodeURIComponent(project)}?full=true`,
        { headers: { 'User-Agent': UA_CHUB, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('chub lorebook ' + r.status);
    const meta = await r.json();
    const def = (meta.node && meta.node.definition) || {};
    const book = def.embedded_lorebook || {};
    const entries = Array.isArray(book.entries) ? book.entries : (book.entries ? Object.values(book.entries) : []);
    return { name: book.name || (meta.node && meta.node.name) || 'Lorebook', entries };
}

// Полная карточка chub → TavernCardV2 (маппинг как в content-manager.js downloadChubCharacter).
async function chubCard(fullPath) {
    const [creator, project] = String(fullPath).split('/');
    const r = await fetchT(`https://api.chub.ai/api/characters/${encodeURIComponent(creator)}/${encodeURIComponent(project)}?full=true`,
        { headers: { 'User-Agent': UA_CHUB, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('chub card ' + r.status);
    const meta = await r.json();
    const def = (meta.node && meta.node.definition) || {};
    const topics = (meta.node && meta.node.topics) || [];
    const data = {
        name: def.name,
        description: def.personality,
        personality: def.tavern_personality,
        scenario: def.scenario,
        first_mes: def.first_message,
        mes_example: def.example_dialogs,
        creator_notes: def.description,
        system_prompt: def.system_prompt,
        post_history_instructions: def.post_history_instructions,
        alternate_greetings: def.alternate_greetings || [],
        tags: topics,
        creator: creator,
        character_version: '',
        character_book: def.embedded_lorebook || undefined,
        extensions: def.extensions || {},
    };
    return { data, avatarUrl: (meta.node && meta.node.avatar_url) || '' };
}

// ── character-tavern.com ──────────────────────────────────────────────────────
const CT = 'https://character-tavern.com';
const CT_CARDS = 'https://ct-cards.storage.character-tavern.com';

async function tavernSearch({ query, tags, nsfw, page, limit, sort }) {
    const p = new URLSearchParams();
    if (query) p.set('query', query);
    p.set('limit', String(limit || 30));
    if (page && page > 1) p.set('page', String(page));
    if (nsfw) p.set('nsfw', 'true');
    if (sort === 'new') p.set('sort', 'newest');   // популярное = дефолт сайта; новое = newest
    if (tags && tags.length) for (const t of tags) p.append('tags', t);
    const r = await fetchT(`${CT}/api/search/cards?${p.toString()}`, { headers: { 'User-Agent': UA_BROWSER, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('tavern search ' + r.status);
    const j = await r.json();
    const hits = (j && j.hits) || [];
    const items = hits.map((h) => ({
        source: 'tavern',
        id: h.path,           // «author/slug» — ключ для арта/скачивания
        ctId: h.id,           // «CT_…» — ключ для под-ресурсов (лорбук/теги)
        name: h.name,
        author: h.author || String(h.path || '').split('/')[0],
        tagline: (h.tagline || '').trim(),
        blurb: (h.tagline || '').trim(),   // у tavern в поиске только tagline (полный блёрб — при открытии карточки)
        tags: [],
        downloads: h.downloads || 0,
        likes: h.likes || 0,
        messages: h.messages || 0,
        nsfw: !!h.isNSFW,
        hasLorebook: !!h.hasLorebook,
        thumb: `${CT_CARDS}/${encPath(h.path)}.png?width=480&quality=85&format=auto`,
    }));
    return { items, count: items.length };
}

async function tavernTopTags() {
    const r = await fetchT(`${CT}/api/catalog/top-tags`, { headers: { 'User-Agent': UA_BROWSER, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('tavern tags ' + r.status);
    const arr = await r.json();
    return Array.isArray(arr) ? arr.map((t) => ({ tag: t.tag, count: t.count })) : [];
}

// chub: настоящий список тегов (POST /tags → ~500 тегов, отсортированы по числу карточек).
// Отдельного GET нет (405), поэтому именно POST с пустым телом.
async function chubTopTags() {
    const r = await fetchT('https://api.chub.ai/tags', {
        method: 'POST',
        headers: { 'User-Agent': UA_CHUB, 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (!r.ok) throw new Error('chub tags ' + r.status);
    const j = await r.json();
    const arr = Array.isArray(j.tags) ? j.tags : [];
    return arr
        .filter((t) => t && t.name)
        .map((t) => ({ tag: String(t.name), count: t.non_private_projects_count || 0 }))
        .sort((a, b) => b.count - a.count);
}

// Разбор карты из PNG (tEXt/zTXt/iTXt, ключи chara[base64 JSON V2] / ccv3[V3]).
function cardFromPng(buf) {
    if (!buf || buf.length < 8) return null;
    const map = {};
    let off = 8;
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        const dataStart = off + 8, dataEnd = dataStart + len;
        if (dataEnd + 4 > buf.length) break;
        const data = buf.subarray(dataStart, dataEnd);
        try {
            if (type === 'tEXt') {
                const z = data.indexOf(0);
                map[data.toString('latin1', 0, z)] = data.toString('latin1', z + 1);
            } else if (type === 'zTXt') {
                const z = data.indexOf(0);
                map[data.toString('latin1', 0, z)] = zlib.inflateSync(data.subarray(z + 2)).toString('latin1');
            } else if (type === 'iTXt') {
                const z = data.indexOf(0);
                const kw = data.toString('latin1', 0, z);
                const compFlag = data[z + 1];
                let p = z + 3;                       // после compression flag + method
                p = data.indexOf(0, p) + 1;          // пропустить language tag
                p = data.indexOf(0, p) + 1;          // пропустить translated keyword
                const txt = data.subarray(p);
                map[kw] = compFlag ? zlib.inflateSync(txt).toString('utf8') : txt.toString('utf8');
            }
        } catch (e) { /* битый чанк — пропускаем */ }
        off = dataEnd + 4;
        if (type === 'IEND') break;
    }
    const raw = map['ccv3'] || map['chara'];
    if (!raw) return null;
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
    catch (e) { return null; }
}

async function tavernCard(path, ctId) {
    const r = await fetchT(`${CT_CARDS}/${encPath(path)}.png`, { headers: { 'User-Agent': UA_BROWSER } }, 30000);
    if (!r.ok) throw new Error('tavern png ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const parsed = cardFromPng(buf);
    const data = (parsed && (parsed.data || parsed)) || {};
    // Лорбук у tavern часто отдельным ресурсом — добираем, если во встроенной карте нет.
    if (ctId && !data.character_book) {
        try {
            const lr = await fetchT(`${CT}/api/character/${encodeURIComponent(ctId)}/lorebook`, { headers: { 'User-Agent': UA_BROWSER, 'Accept': 'application/json' } });
            if (lr.ok) { const lb = await lr.json(); if (lb && (lb.entries || Array.isArray(lb))) data.character_book = lb; }
        } catch (e) { /* без лорбука */ }
    }
    return { data, avatarDataUrl: 'data:image/png;base64,' + buf.toString('base64') };
}

// ── RisuRealm (realm.risuai.net) ──────────────────────────────────────────────
const RISU = 'https://realm.risuai.net';
const RISU_IMG = 'https://sv.risuai.xyz/resource/';

// Распаковка SvelteKit __data.json (формат devalue: плоский пул + ссылки-индексы).
function devalue(flat) {
    const seen = new Map();
    function res(i) {
        if (typeof i !== 'number') return i;
        if (i === -1) return undefined;
        if (i === -2) return null;
        if (i < 0) return undefined;
        if (seen.has(i)) return seen.get(i);
        const v = flat[i];
        if (v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) { const a = []; seen.set(i, a); for (const e of v) a.push(res(e)); return a; }
        const o = {}; seen.set(i, o); for (const k in v) o[k] = res(v[k]); return o;
    }
    return res(0);
}
// «4.1k» / «1167K» → число.
function parseCount(s) {
    if (typeof s === 'number') return s;
    const m = String(s || '').trim().match(/^([\d.]+)\s*([kKmM]?)/);
    if (!m) return 0;
    const mul = /[kK]/.test(m[2]) ? 1000 : /[mM]/.test(m[2]) ? 1e6 : 1;
    return Math.round((parseFloat(m[1]) || 0) * mul);
}

async function risuSearch({ query, tags, nsfw, page, sort }) {
    // q = свободный текст + теги как «tag:<t>» (как на сайте: /?q=tag:female). Страницы с 0.
    const parts = [];
    if (query) parts.push(query);
    if (tags && tags.length) for (const t of tags) parts.push('tag:' + t);
    const p = new URLSearchParams();
    p.set('q', parts.join(' '));
    p.set('page', String((page || 1) - 1));
    // У risu нет чистого «newest» (все варианты сводятся к загрузкам); популярное = download,
    // новое = trending (единственный отдельный «свежий» фид сайта).
    p.set('sort', sort === 'new' ? 'trending' : 'download');
    if (nsfw) p.set('nsfw', 'true');
    const r = await fetchT(`${RISU}/__data.json?${p.toString()}`, { headers: { 'User-Agent': UA_BROWSER, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('risu search ' + r.status);
    const j = await r.json();
    let root = null;
    for (const n of (j.nodes || [])) {
        if (n && n.type === 'data' && Array.isArray(n.data)) {
            const o = devalue(n.data);
            if (o && Array.isArray(o.cards)) { root = o; break; }
            if (!root) root = o;
        }
    }
    const cards = (root && Array.isArray(root.cards)) ? root.cards : [];
    const items = cards.filter((c) => c && c.id).map((c) => ({
        source: 'risu',
        id: c.id,
        name: c.name || '',
        author: c.authorname || '',
        tagline: (c.desc || '').trim(),
        blurb: (c.desc || '').trim(),
        tags: Array.isArray(c.tags) ? c.tags : [],
        downloads: parseCount(c.download),
        likes: 0,
        messages: 0,
        nsfw: !!c.nsfw,
        hasLorebook: !!c.haslore,
        thumb: c.img ? (RISU_IMG + c.img) : '',
    }));
    return { items, count: items.length };
}

// Карта risu = прямой PNG-v3 (полная V2/V3 внутри). Сам файл до ~8 МБ, поэтому в аватар
// берём маленькую миниатюру (thumb), а не саму карту.
async function risuCard(id, thumb) {
    const r = await fetchT(`${RISU}/api/v1/download/png-v3/${encodeURIComponent(id)}`, { headers: { 'User-Agent': UA_BROWSER } }, 40000);
    if (!r.ok) throw new Error('risu png ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const parsed = cardFromPng(buf);
    const data = (parsed && (parsed.data || parsed)) || {};
    let avatar = '';
    if (thumb) { try { avatar = await proxyImage(thumb); } catch (e) { avatar = ''; } }
    return { data, avatarDataUrl: avatar };
}
function risuTags() {
    const common = ['female', 'male', 'OC', 'anime', 'fantasy', 'romance', 'sci-fi', 'horror', 'non-human', 'game-character', 'yandere', 'tsundere', 'monster', 'assistant', 'rpg', 'furry'];
    return common.map((t) => ({ tag: t, count: 0 }));
}

// Забрать картинку и вернуть data:-URL (для CSP `img-src data:`).
// maxW>0 — миниатюра: качаем резкий источник (max_res) и уменьшаем на сервере до нужной ширины
// (Jimp умеет webp/png/jpeg/avif), чтобы плитки были чёткими, но лёгкими. Не влезло/формат чужой → отдаём оригинал.
async function proxyImage(url, maxW) {
    let u;
    try { u = new URL(url); } catch (e) { throw new Error('bad url'); }
    if (u.protocol !== 'https:' || !IMG_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) {
        throw new Error('host not allowed');
    }
    const r = await fetchT(url, { headers: { 'User-Agent': UA_BROWSER } }, 20000);
    if (!r.ok) throw new Error('image ' + r.status);
    let ct = r.headers.get('content-type') || 'image/png';
    let buf = Buffer.from(await r.arrayBuffer());
    if (maxW && maxW > 0) {
        try {
            const img = await Jimp.read(buf);
            const bw = img.bitmap.width, bh = img.bitmap.height;
            if (bw > maxW) {
                img.resize({ w: maxW, h: Math.round(bh * maxW / bw) });
                buf = await img.getBuffer(JimpMime.jpeg, { quality: 86 });
                ct = 'image/jpeg';
            }
        } catch (e) { /* формат не по зубам Jimp / битый файл — отдаём оригинал в полном качестве */ }
    }
    return 'data:' + ct + ';base64,' + buf.toString('base64');
}

// ── Маршруты ──────────────────────────────────────────────────────────────────
router.post('/search', async (request, response) => {
    const { source, query, tags, nsfw, page, limit } = request.body || {};
    try {
        const opts = { query, tags: Array.isArray(tags) ? tags : [], nsfw: !!nsfw, page: page || 1, limit: limit || 30, sort: (request.body || {}).sort === 'new' ? 'new' : 'popular', kind: (request.body || {}).kind === 'lorebook' ? 'lorebook' : 'character' };
        const res = source === 'tavern' ? await tavernSearch(opts)
            : source === 'risu' ? await risuSearch(opts)
                : await chubSearch(opts);
        response.json({ ok: true, ...res });
    } catch (e) {
        response.json({ ok: false, error: String(e.message || e) });
    }
});

router.post('/tags', async (request, response) => {
    const { source } = request.body || {};
    try {
        if (source === 'tavern') return response.json({ ok: true, tags: await tavernTopTags() });
        if (source === 'risu') return response.json({ ok: true, tags: risuTags() });
        // chub: настоящий топ-тегов (POST /tags). Если API недоступен — фолбэк на частый набор.
        try {
            return response.json({ ok: true, tags: await chubTopTags() });
        } catch (e) {
            const common = ['Female', 'Male', 'OC', 'Anime', 'Fantasy', 'Romance', 'RPG', 'Adventure', 'Sci-Fi', 'Horror', 'Femboy', 'Furry', 'Yandere', 'Tsundere', 'Monster', 'Villain', 'Assistant', 'Game'];
            return response.json({ ok: true, tags: common.map((t) => ({ tag: t, count: 0 })) });
        }
    } catch (e) {
        response.json({ ok: false, error: String(e.message || e) });
    }
});

router.post('/card', async (request, response) => {
    const { source, id, ctId, thumb } = request.body || {};
    if (!id) return response.json({ ok: false, error: 'no id' });
    try {
        if (source === 'tavern') {
            const { data, avatarDataUrl } = await tavernCard(id, ctId);
            return response.json({ ok: true, card: { data }, avatar: avatarDataUrl, tags: Array.isArray(data.tags) ? data.tags : [] });
        }
        if (source === 'risu') {
            const { data, avatarDataUrl } = await risuCard(id, thumb);
            return response.json({ ok: true, card: { data }, avatar: avatarDataUrl, tags: Array.isArray(data.tags) ? data.tags : [] });
        }
        const { data, avatarUrl } = await chubCard(id);
        let avatar = '';
        if (avatarUrl) { try { avatar = await proxyImage(avatarUrl); } catch (e) { avatar = ''; } }
        response.json({ ok: true, card: { data }, avatar, tags: Array.isArray(data.tags) ? data.tags : [] });
    } catch (e) {
        response.json({ ok: false, error: String(e.message || e) });
    }
});

// Записи отдельного лорбука (пока только chub) — для скачивания в World Info.
router.post('/lorebook', async (request, response) => {
    const { source, id } = request.body || {};
    if (!id) return response.json({ ok: false, error: 'no id' });
    try {
        if (source !== 'chub') return response.json({ ok: false, error: 'lorebooks only from chub' });
        const { name, entries } = await chubLorebook(id);
        response.json({ ok: true, name, entries });
    } catch (e) {
        response.json({ ok: false, error: String(e.message || e) });
    }
});

router.post('/image', async (request, response) => {
    const { url, w } = request.body || {};
    try {
        response.json({ ok: true, dataUrl: await proxyImage(url, Number(w) > 0 ? Number(w) : 0) });
    } catch (e) {
        response.json({ ok: false, error: String(e.message || e) });
    }
});

// экспорт помощников для локального теста (node --input-type=module)
export const _test = { chubSearch, chubCard, chubLorebook, tavernSearch, tavernTopTags, tavernCard, cardFromPng, proxyImage, risuSearch, risuCard, devalue, parseCount };
