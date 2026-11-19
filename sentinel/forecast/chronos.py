"""Pronóstico de Chronos-2 (amazon/chronos-2, Apache 2.0) para Sentinel, en modo sombra.

Lee por stdin {"series": [[n, n, null, …], …], "rest": [[0, 1, …], …], "horizon": 1, "quantiles": [0.02, 0.5, 0.98]}
—cada serie es un contexto por hora, con null donde no hay dato; `rest` (opcional) marca cada hora del contexto Y del
horizonte que cae en fin de semana o festivo, una covariable que se conoce de antemano— y devuelve por stdout {"q": [[[q por cuantil] por paso] por serie],
"device": "mps", "seconds": 1.2}. No sabe nada de Sentinel: Go arma las series y decide qué hacer con el rango.

Corre en su propio venv (~/.cache/my-tools/chronos/venv); el modelo se baja una vez a la caché de Hugging Face.
"""
import json
import math
import sys
import time

import torch
from chronos import Chronos2Pipeline

BATCH = 256


def main():
    req = json.load(sys.stdin)
    horizon = int(req.get('horizon', 1))
    quantiles = req.get('quantiles', [0.02, 0.5, 0.98])
    series = [torch.tensor([math.nan if x is None else float(x) for x in s], dtype=torch.float32) for s in req['series']]
    rest = req.get('rest')
    if rest:
        # Chronos-2 recibe covariables conocidas: la del pasado al lado del contexto y la del futuro para el horizonte
        inputs = [{'target': s, 'past_covariates': {'rest': torch.tensor(r[:len(s)], dtype=torch.float32)},
                   'future_covariates': {'rest': torch.tensor(r[len(s):], dtype=torch.float32)}}
                  for s, r in zip(series, rest)]
    else:
        inputs = series
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    began = time.time()
    pipe = Chronos2Pipeline.from_pretrained('amazon/chronos-2', device_map=device)
    out = []
    for i in range(0, len(inputs), BATCH):
        q, _ = pipe.predict_quantiles(inputs[i:i + BATCH], prediction_length=horizon, quantile_levels=quantiles)
        # cada elemento: (variables=1, pasos, cuantiles)
        out.extend([[[round(float(v), 3) for v in step] for step in t[0]] for t in q])
    json.dump({'q': out, 'device': device, 'seconds': round(time.time() - began, 1)}, sys.stdout)


if __name__ == '__main__':
    main()
