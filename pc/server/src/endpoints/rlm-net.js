// ============================================================================
// rlm-net.js — управление доступом по локальной сети (whitelist) из приложения RLM.
//
// Зачем: чтобы открыть холст RLM с телефона (http://<ip-ПК>:<порт>/rlm/), устройство
// должно быть в белом списке. Эти маршруты дают панели «Доступ по сети» (стартовое меню)
// показать адрес/список и добавлять-убирать записи БЕЗ ручной правки config.yaml и без
// перезапуска сервера (см. setWhitelist в middleware/whitelist.js).
//
// Безопасность: маршруты смонтированы ПОСЛЕ whitelist-middleware, значит менять список
// может только уже разрешённое устройство. ПК (127.0.0.1) разрешён всегда, поэтому
// настройка идёт с доверенной машины, а телефон получает доступ уже после добавления.
//
// Маршруты (монтируются в server-main.js под /api/rlm/net, ДО CSRF/логина):
//   POST /info            -> { ok, whitelist:[...], clientIp, serverIPs:[...], port, url }
//   POST /add   { entry } -> { ...info }   (entry — IP или подсеть: 192.168.1.77 / 192.168.1.*)
//   POST /remove{ entry } -> { ...info }
// ============================================================================
import os from 'node:os';
import express from 'express';
import ipMatching from 'ip-matching';
import { getIpFromRequest } from '../express-common.js';
import { getWhitelist, setWhitelist } from '../middleware/whitelist.js';
import { getConfigValue } from '../util.js';

export const router = express.Router();

// Все не-внутренние IPv4 адреса машины (обычно это адрес(а) в Wi-Fi/LAN).
function lanIPv4() {
    return Object.values(os.networkInterfaces())
        .flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal)
        .map((i) => i.address);
}

// «Домашний» адрес для показа. Ранжируем: 192.168.* — самый вероятный домашний Wi-Fi/LAN;
// 10.* — частный класс A; 172.16-31.* часто виртуальные (Docker/WSL), поэтому ниже приоритетом.
function preferLanIP(ips) {
    const score = (a) => {
        if (/^192\.168\./.test(a)) return 3;
        if (/^10\./.test(a)) return 2;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return 1;
        return 0;
    };
    return [...ips].sort((a, b) => score(b) - score(a))[0] || '127.0.0.1';
}

// Единый снимок состояния для панели.
function info(req) {
    const ips = lanIPv4();
    const port = Number(getConfigValue('port', 8000, 'number'));
    const scheme = getConfigValue('ssl.enabled', false, 'boolean') ? 'https' : 'http';
    return {
        ok: true,
        whitelist: getWhitelist(),
        clientIp: getIpFromRequest(req),
        serverIPs: ips,
        port,
        url: `${scheme}://${preferLanIP(ips)}:${port}/rlm/`,
    };
}

router.post('/info', (req, res) => {
    res.json(info(req));
});

router.post('/add', (req, res) => {
    const entry = String((req.body && req.body.entry) || '').trim();
    if (!entry) return res.json({ ok: false, error: 'Пустая запись' });
    try {
        // Бросит исключение, если это не валидный IP/подсеть/CIDR.
        ipMatching.getMatch(entry);
    } catch (e) {
        return res.json({ ok: false, error: `Неверный IP или подсеть: ${entry}` });
    }
    const list = getWhitelist();
    if (!list.includes(entry)) list.push(entry);
    setWhitelist(list);
    res.json(info(req));
});

router.post('/remove', (req, res) => {
    const entry = String((req.body && req.body.entry) || '').trim();
    // Loopback защищён в setWhitelist (вернётся обратно), но не будем и пытаться его убрать.
    const list = getWhitelist().filter((x) => x !== entry);
    setWhitelist(list);
    res.json(info(req));
});
