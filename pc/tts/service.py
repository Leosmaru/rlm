#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OmniVoice TTS-сервис для RLM — озвучка БЕЗ ComfyUI.

Грузит модель OmniVoice ОДИН РАЗ (из tts/model) и держит в памяти, отвечает по HTTP.
Electron лениво поднимает этот сервис и проксирует сюда запросы ноды «Озвучка».

Эндпоинты:
  GET  /health   -> {ok, ready, cuda, device, error}
  POST /tts      {text, ref_audio, ref_text, params:{...}} -> {ok, file, sr} | {ok:false, error}

Режим — только КЛОН голоса: ref_audio (образец, WAV) + ref_text (транскрипт; пусто → omnivoice
транскрибирует сам) + text (что озвучить). Результат — ОДИН файл out/out.wav (каждая генерация
ЗАТИРАЕТ прошлый).

Реальный API omnivoice (сверено с пакетом):
  model.generate(text, language=None, ref_text=None, ref_audio=None, duration=None, speed=None,
                 generation_config=OmniVoiceGenerationConfig(...), normalize_text=False, ...)
  OmniVoiceGenerationConfig: num_step, guidance_scale, t_shift, layer_penalty_factor,
     position_temperature, class_temperature, denoise, preprocess_prompt, postprocess_output,
     audio_chunk_duration, audio_chunk_threshold, pad_duration, fade_duration.
Сэмплеры со скрина ложатся в generation_config; text/ref/language/duration/speed/normalize_text —
прямые аргументы; seed → torch.manual_seed.

Запуск: <tts>/venv/Scripts/python.exe service.py [--port 8123]
"""
import argparse
import dataclasses
import json
import os
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(HERE, "model")
OUT_DIR = os.path.join(HERE, "out")
OUT_WAV = os.path.join(OUT_DIR, "out.wav")
SR = 24000  # OmniVoice отдаёт 24 kHz

# Прямые аргументы generate() (кроме text/ref_audio/ref_text — их кладём отдельно).
GEN_DIRECT = {"language", "duration", "speed", "normalize_text"}

_state = {"ready": False, "error": None, "cuda": False, "device": "cpu"}
_dtype_name = "fp16"     # точность модели на GPU: fp16 (быстро) | bf16 (баланс) | fp32 (качество). На CPU всегда fp32.
_model = None


def _torch_dtype():
    """Имя точности → torch-dtype (только для GPU; на CPU вызывающий сам берёт float32)."""
    import torch
    return {"fp16": torch.float16, "bf16": torch.bfloat16, "fp32": torch.float32}.get(_dtype_name, torch.float16)
_cfg_cls = None          # класс OmniVoiceGenerationConfig
_cfg_fields = set()      # имена его полей (для фильтрации входящих params)
_lock = threading.Lock()  # генерация — по одному запросу за раз (одна GPU)

# Прогресс (для индикации в UI): phase = load | gen | idle; value = 0..1.
# Загрузка модели — по росту VRAM (from_pretrained % не отдаёт).
# Генерация — ПО ВРЕМЕНИ с калибровкой (EMA секунд/символ): диффузия — лишь ЧАСТЬ времени, дальше идёт
# декод аудио + постобработка, у которых нет forward-проходов → чистый счётчик шагов «застревал на 99%».
# Время учитывает весь путь. Первый прогон (калибровки ещё нет) — по шагам диффузии (forward-hook).
_progress = {"phase": "idle", "value": 0.0, "step": 0, "total": 0}
_gen_total = 32          # ожидаемое число шагов текущей генерации (num_step)
_gen_step = 0            # счётчик forward-проходов текущей генерации (для первого прогона)
_gen_start = 0.0         # время старта генерации
_gen_len = 1             # длина текста (символов) текущей генерации
_ema_per_char = 0.0      # EMA: секунд генерации на символ (калибровка, точнеет с каждым прогоном)
_load_target = 1.8e9     # грубая цель VRAM (байт) под загрузку — уточняется по файлам модели


def log(*a):
    print("[tts]", *a, flush=True)


def _on_forward(*_a):
    """forward-hook: 1 проход = 1 шаг диффузии. Просто СЧИТАЕМ (значение прогресса двигает монитор)."""
    global _gen_step
    if _progress.get("phase") == "gen":
        _gen_step += 1


def _gen_monitor():
    """Пока идёт генерация — двигаем value ПО ВРЕМЕНИ (учитывает и декод/постобработку, не только шаги).
    Есть калибровка (EMA сек/символ) → по времени; нет (первый прогон) → по шагам диффузии."""
    global _progress
    import time
    while _progress.get("phase") == "gen":
        elapsed = time.time() - _gen_start
        if _ema_per_char > 0:
            est = max(0.5, _ema_per_char * _gen_len)
            v = elapsed / est
        else:
            v = _gen_step / max(1, _gen_total)          # первый прогон — по шагам
        _progress = {"phase": "gen", "step": _gen_step, "total": _gen_total, "value": min(0.985, v)}
        time.sleep(0.25)


def _load_monitor():
    """Пока модель грузится — оцениваем прогресс по росту занятой VRAM (from_pretrained % не даёт)."""
    global _progress
    try:
        import torch
    except Exception:
        return
    while not _state["ready"] and not _state["error"]:
        try:
            alloc = torch.cuda.memory_allocated() if torch.cuda.is_available() else 0
        except Exception:
            alloc = 0
        _progress = {"phase": "load", "step": 0, "total": 0,
                     "value": min(0.99, alloc / _load_target) if _load_target else 0.0}
        import time
        time.sleep(0.5)


def load_model():
    """Загрузка модели один раз. Тяжёлое (минуты) — в отдельном потоке при старте."""
    global _model, _cfg_cls, _cfg_fields, _load_target, _progress
    try:
        import torch
        from omnivoice import OmniVoice
        from omnivoice.models.omnivoice import OmniVoiceGenerationConfig
        cuda = torch.cuda.is_available()
        device = "cuda:0" if cuda else "cpu"
        dtype = _torch_dtype() if cuda else torch.float32   # точность выбирается в ноде «Озвучка» (fp16/bf16/fp32)
        _state["cuda"] = cuda
        _state["device"] = device
        _cfg_cls = OmniVoiceGenerationConfig
        _cfg_fields = {f.name for f in dataclasses.fields(OmniVoiceGenerationConfig)}
        # цель VRAM ≈ 0.55 × размер safetensors на диске (fp32→fp16); грубо, для прогресс-бара
        try:
            sz = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(MODEL_DIR)
                     for f in fs if f.endswith(".safetensors"))
            if sz:
                _load_target = 0.55 * sz
        except Exception:
            pass
        _progress = {"phase": "load", "value": 0.0, "step": 0, "total": 0}
        threading.Thread(target=_load_monitor, daemon=True).start()
        log("loading model from", MODEL_DIR, "device", device, "dtype", dtype)
        _model = OmniVoice.from_pretrained(MODEL_DIR, device_map=device, dtype=dtype)
        try:
            _model.register_forward_hook(_on_forward)   # считать шаги генерации
        except Exception as e:
            log("forward hook not set:", e)
        _state["ready"] = True
        _progress = {"phase": "idle", "value": 0.0, "step": 0, "total": 0}
        log("MODEL READY. cfg fields:", sorted(_cfg_fields))
    except Exception as e:
        _state["error"] = f"{type(e).__name__}: {e}"
        log("LOAD FAILED:", _state["error"])
        traceback.print_exc()


def generate(payload):
    """Клон-озвучка. Пишет out/out.wav (перезапись) и возвращает путь."""
    import soundfile as sf
    import torch

    text = (payload.get("text") or "").strip()
    ref_audio = (payload.get("ref_audio") or "").strip()
    ref_text = (payload.get("ref_text") or "").strip()
    instruct = (payload.get("instruct") or "").strip()
    if not text:
        return {"ok": False, "error": "пустой text (нечего озвучивать)"}
    # Два режима: КЛОН (есть файл образца) или ГЕНЕРАТОР голоса по описанию (instruct, без образца).
    # Если образца нет, но задан instruct — voice-design; иначе клон и образец обязателен.
    has_ref = bool(ref_audio) and os.path.exists(ref_audio)
    design = bool(instruct) and not has_ref
    if not design and not has_ref:
        return {"ok": False, "error": f"нет файла образца ref_audio: {ref_audio!r}"}

    p = payload.get("params") or {}

    # seed: -1/пусто = выбрать СЛУЧАЙНЫЙ конкретный (чтобы вернуть его наружу и можно было воспроизвести
    # тот же голос). Иначе — заданный. В любом случае фиксируем и возвращаем used_seed в ответе.
    import random
    seed = p.get("seed")
    try:
        used_seed = int(seed) if seed is not None else -1
    except (TypeError, ValueError):
        used_seed = -1
    if used_seed < 0:
        used_seed = random.randint(0, 2**31 - 1)
    torch.manual_seed(used_seed)

    # generation_config — только реальные поля конфига
    cfg_kwargs = {k: v for k, v in p.items() if k in _cfg_fields and v is not None}
    cfg = _cfg_cls(**cfg_kwargs) if _cfg_cls else None

    global _gen_total, _gen_step, _gen_start, _gen_len, _ema_per_char, _progress
    import time
    _gen_total = int(cfg_kwargs.get("num_step") or (cfg.num_step if cfg else 32) or 32)
    _gen_step = 0
    _gen_len = max(1, len(text))
    _gen_start = time.time()
    _progress = {"phase": "gen", "step": 0, "total": _gen_total, "value": 0.0}
    threading.Thread(target=_gen_monitor, daemon=True).start()

    # прямые аргументы generate()
    direct = {k: v for k, v in p.items() if k in GEN_DIRECT and v is not None}

    if design:
        kwargs = {"text": text, "instruct": instruct}   # генератор голоса по описанию — без образца
    else:
        kwargs = {"text": text, "ref_audio": ref_audio}   # клон голоса по образцу
        if ref_text:
            kwargs["ref_text"] = ref_text
    if cfg is not None:
        kwargs["generation_config"] = cfg
    kwargs.update(direct)

    try:
        with _lock:
            audio = _model.generate(**kwargs)
    finally:
        dur = max(0.001, time.time() - _gen_start)
        per_char = dur / _gen_len
        _ema_per_char = per_char if _ema_per_char <= 0 else (0.5 * _ema_per_char + 0.5 * per_char)
        _progress = {"phase": "idle", "value": 1.0, "step": _gen_total, "total": _gen_total}

    wav = audio[0] if isinstance(audio, (list, tuple)) else audio
    os.makedirs(OUT_DIR, exist_ok=True)

    # Формат вывода: по умолчанию WAV (чат читает WAV-плеером). fmt='ogg' → OGG/OPUS —
    # это то, что Telegram принимает как ГОЛОСОВОЕ сообщение (sendVoice). Opus не собрался —
    # фолбэк на WAV (нода Telegram тогда уйдёт в sendAudio, а не sendVoice).
    fmt = (payload.get("fmt") or "wav").lower()
    if fmt == "ogg":
        out_ogg = os.path.join(OUT_DIR, "out.ogg")
        try:
            if os.path.exists(out_ogg):
                os.remove(out_ogg)
        except OSError:
            pass
        try:
            sf.write(out_ogg, wav, SR, format="OGG", subtype="OPUS")
            return {"ok": True, "file": out_ogg, "sr": SR, "fmt": "ogg", "seed": used_seed}
        except Exception as e:
            log("OGG/OPUS encode failed, fallback to WAV:", e)

    if os.path.exists(OUT_WAV):
        try:
            os.remove(OUT_WAV)  # старую озвучку удаляем — файл всегда один
        except OSError:
            pass
    sf.write(OUT_WAV, wav, SR)
    return {"ok": True, "file": OUT_WAV, "sr": SR, "fmt": "wav", "seed": used_seed}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._send(200, {"ok": True, **_state, "dtype": _dtype_name})
        if self.path.startswith("/progress"):
            return self._send(200, {"ok": True, **_progress})
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/tts"):
            return self._send(404, {"ok": False, "error": "not found"})
        if not _state["ready"]:
            return self._send(503, {"ok": False, "error": _state["error"] or "модель ещё грузится"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(n) or b"{}")
            self._send(200, generate(payload))
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})


def main():
    global _dtype_name
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8123)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--dtype", default="fp16", choices=["fp16", "bf16", "fp32"])  # точность на GPU (нода «Озвучка»)
    args = ap.parse_args()
    _dtype_name = args.dtype
    threading.Thread(target=load_model, daemon=True).start()  # модель грузится в фоне, сервер уже слушает
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    log(f"listening on http://{args.host}:{args.port}  (model loading in background)")
    srv.serve_forever()


if __name__ == "__main__":
    main()
