"""QUIÉN HABLA CUÁNDO en el audio de la reunión (el del sistema: el micrófono ya es «yo»), con Nemotron-3-Diarization
de NVIDIA, en esta Mac. Lo corre `summarize` (summarize.go, `diarize`) con el Python del entorno que dice el registro
de modelos (`env:diarization`, en ~/.cache/my-tools/diarization): torch y Transformers de la fuente, sin NeMo.

    python diarize.py <carpeta de la grabación>   →  escribe <carpeta>/diarization.json:
    {"model": "...", "seconds": 0.4, "segments": [{"speaker": 0, "start": 1.2, "end": 7.9}, ...]}

Los tramos de audio/system/<ms>.wav se ponen en su lugar en la línea de tiempo de la grabación (silencio entre medio),
así los tiempos que salen son los mismos que los de la transcripción. Hasta OFFLINE_MAX segundos se corre de una vez
(el modo que mejor separa); más largo, por partes con la caché de hablantes del modelo, que mantiene a cada persona
con el mismo número de una parte a otra. Medido el 2026-11-23: un minuto de audio en 0,44 s en CPU.
"""

import glob
import json
import os
import sys
import time

import numpy as np
import soundfile as sf
import torch
from transformers import AutoModelForAudioFrameClassification, AutoProcessor

MODEL_ID = "nvidia/Nemotron-3-Diarization"
OFFLINE_MAX = float(os.environ.get("MINUTES_DIARIZE_OFFLINE_MAX", 15 * 60))  # para probar el modo por partes


def load_timeline(folder, rate):
    files = sorted(glob.glob(os.path.join(folder, "audio", "system", "*.wav")))
    parts = []
    for f in files:
        try:
            start_ms = int(os.path.basename(f)[:-4])
        except ValueError:
            continue
        data, sr = sf.read(f, dtype="float32")
        if sr != rate:
            raise SystemExit(f"{f}: {sr} Hz, el modelo pide {rate}")
        parts.append((start_ms * rate // 1000, data))
    if not parts:
        return None
    total = max(off + len(d) for off, d in parts)
    audio = np.zeros(total, dtype="float32")
    for off, d in parts:
        audio[off:off + len(d)] = d
    return audio


def offline(proc, model, audio, rate):
    inputs = proc(audio, sampling_rate=rate)
    with torch.inference_mode():
        logits = model(**inputs).logits
    return proc.extract_speaker_dict(logits, inputs.attention_mask)[0]


def streaming(proc, model, audio, rate):
    proc.set_streaming_mode("low_latency")

    def chunks():
        yield proc(audio[: proc.num_samples_first_audio_chunk], sampling_rate=rate, is_streaming=True, is_first_audio_chunk=True)
        mel = proc.num_mel_frames_per_step
        start = proc.audio_chunk_start(mel)
        while (end := start + proc.num_samples_per_audio_chunk) <= audio.shape[0]:
            yield proc(audio[start:end], sampling_rate=rate, is_streaming=True, is_first_audio_chunk=False)
            mel += proc.num_mel_frames_per_step
            start = proc.audio_chunk_start(mel)
        yield proc(audio[start:], sampling_rate=rate, is_streaming=True, is_first_audio_chunk=False, is_last_audio_chunk=True)

    cache, logits = None, []
    with torch.inference_mode():
        for inputs in chunks():
            out = model(**inputs, speaker_cache=cache)
            logits.append(out.logits)
            cache = out.speaker_cache
    return proc.extract_speaker_dict(torch.cat(logits, dim=1))[0]


def main():
    folder = sys.argv[1]
    began = time.time()
    proc = AutoProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForAudioFrameClassification.from_pretrained(MODEL_ID).eval()
    rate = proc.feature_extractor.sampling_rate
    audio = load_timeline(folder, rate)
    segments = []
    mode = "none"
    if audio is not None and np.abs(audio).max() > 0:
        mode = "offline" if len(audio) / rate <= OFFLINE_MAX else "streaming"
        raw = offline(proc, model, audio, rate) if mode == "offline" else streaming(proc, model, audio, rate)
        segments = [{"speaker": int(s["Speaker"]), "start": round(float(s["Start"]), 2), "end": round(float(s["End"]), 2)} for s in raw]
    out = {"model": MODEL_ID, "mode": mode, "seconds": round(time.time() - began, 2), "segments": segments}
    tmp = os.path.join(folder, "diarization.json.tmp")
    with open(tmp, "w") as f:
        json.dump(out, f, indent=1)
    os.replace(tmp, os.path.join(folder, "diarization.json"))
    print(f"{len({s['speaker'] for s in segments})} personas, {len(segments)} tramos, {out['seconds']} s ({mode})", file=sys.stderr)


if __name__ == "__main__":
    main()
