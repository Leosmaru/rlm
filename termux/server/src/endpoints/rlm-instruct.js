// ============================================================================
// rlm-instruct.js — шаблоны инструкт-режима для текстового пути (Text Completion).
//
// Зачем: в чат-формате разметку накладывает сам провайдер, поэтому там всё чисто. В текстовом
// модель получает СПЛОШНОЙ текст и не знает, где чья очередь — дописывает и за игрока, и служебные
// куски промта. SillyTavern решает это шаблонами: у каждой линейки моделей своя разметка ролей
// (ChatML, Llama 3, Mistral, Alpaca…), и промт собирается по ней. Служебные метки шаблона заодно
// становятся стоп-последовательностями — руками ничего вписывать не нужно.
//
// Шаблоны уже лежат в форке: server/default/content/presets/instruct/*.json (37 штук). Здесь мы их
// просто отдаём холсту — своих файлов не заводим, чтобы обновление ST приносило и свежие шаблоны.
//
// Маршрут (монтируется в server-main.js под /api/rlm/instruct, ПОСЛЕ whitelist):
//   POST /list -> { ok, templates: [{ name, system_sequence, input_sequence, ... }] }
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { serverDirectory } from '../server-directory.js';

export const router = express.Router();

const dirs = () => [
    path.join(serverDirectory, 'default', 'content', 'presets', 'instruct'),
    path.join(globalThis.DATA_ROOT || './data', 'default-user', 'instruct'),   // пользовательские, если появятся
];

// Оставляем только то, что нужно для сборки промта: лишние поля ST в холсте не используются
// и только раздували бы ответ (37 файлов).
const ПОЛЯ = [
    'name', 'system_sequence', 'system_suffix', 'input_sequence', 'input_suffix',
    'output_sequence', 'output_suffix', 'last_output_sequence', 'first_output_sequence',
    'stop_sequence', 'sequences_as_stop_strings', 'wrap', 'names_behavior',
    'story_string_prefix', 'story_string_suffix', 'activation_regex',
];

router.post('/list', (req, res) => {
    const out = [];
    const seen = new Set();
    for (const dir of dirs()) {
        let files = [];
        try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')); } catch { continue; }
        for (const f of files) {
            try {
                const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                const name = String(j.name || f.replace(/\.json$/i, '')).trim();
                if (!name || seen.has(name)) continue;
                seen.add(name);
                const t = {};
                for (const k of ПОЛЯ) if (j[k] !== undefined) t[k] = j[k];
                t.name = name;
                out.push(t);
            } catch { /* битый файл шаблона пропускаем молча */ }
        }
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    res.json({ ok: true, templates: out });
});
