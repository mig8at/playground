"""Pronóstico de Timestral-5M (mistralai/Timestral-5M) para Sentinel, en modo sombra: el mismo protocolo que chronos.py.

Lee por stdin {"series": [[n, null, …], …], "rest": [[0, 1, …], …], "horizon": 1, "quantiles": [0.01, 0.5, 0.99]}
y devuelve por stdout {"q": [[[q por cuantil] por paso] por serie], "device": "cpu", "seconds": 1.2}. `rest` (opcional)
es la covariable de fines de semana y festivos, conocida para el contexto y el horizonte.

Timestral da 21 cuantiles fijos (0,01, 0,05, 0,1 … 0,95, 0,99): cada cuantil pedido tiene que ser uno de ellos.
Corre en su propio venv (~/.cache/my-tools/timestral/.venv); el modelo (21 MB) se baja una vez de Hugging Face.
"""
import json
import math
import sys
import time

import numpy as np
import torch
from timestral import TimestralForecaster

MODEL = 'mistralai/Timestral-5M'
BATCH = 512


def main():
    req = json.load(sys.stdin)
    horizon = int(req.get('horizon', 1))
    wanted = req.get('quantiles', [0.01, 0.5, 0.99])
    series = np.array([[math.nan if x is None else float(x) for x in s] for s in req['series']], dtype=np.float32)
    rest = req.get('rest')
    began = time.time()
    model = TimestralForecaster.from_pretrained(MODEL, device='cpu')
    levels = [round(l, 4) for l in model.quantile_levels]
    idx = []
    for w in wanted:
        if round(w, 4) not in levels:
            raise SystemExit(f'timestral: el cuantil {w} no está entre los suyos {levels}')
        idx.append(levels.index(round(w, 4)))
    out = []
    for i in range(0, len(series), BATCH):
        ctx = series[i:i + BATCH]
        kw = {}
        if rest:
            kw['known_covariates'] = np.array(rest[i:i + BATCH], dtype=np.float32)[:, None, :]
        fc = model.forecast(ctx, prediction_length=horizon, **kw)
        q = fc.quantiles.float().cpu().numpy()  # (B, pasos, Q), o (B, V, pasos, Q) con varias variables
        if q.ndim == 4:
            q = q[:, 0]
        out.extend([[[round(float(row[j]), 3) for j in idx] for row in steps] for steps in q])
    json.dump({'q': out, 'device': 'cpu', 'seconds': round(time.time() - began, 1)}, sys.stdout)


if __name__ == '__main__':
    main()
