---
id: 138
title: "Minutes: grabar una reunión sin tomar notas"
clase: proyecto
nivel: miguel
stage: work
created: "2026-11-23T19:40:00-05:00"
jira: []
jira_title: ""
---

## Objetivo

Minutes: un recordatorio de cada reunión que funciona como un dictado. Graba la pantalla (≈1 captura por segundo,
sólo las que cambian), el micrófono y el audio de la reunión sin quitarle el micrófono a Meet, Zoom o Slack, lo
transcribe en vivo y al final cruza lo dicho con lo que estaba en pantalla («esto que les muestro»). Es una
herramienta personal de Miguel en my-tools: no es de CreditOp y no va a Jira. Cómo funciona está en
`minutes/CLAUDE.md`.

## Dónde se toca

`minutes/` (`make minutes`, `bin/minutes`).

## Specs

- S1: `bin/minutes start` arranca y `bin/minutes stop` frena una grabación, que queda en `minutes/recordings/<fecha>/`.
- S2: la carpeta tiene las capturas distintas (`frames/`), la transcripción con tiempos (`transcript.jsonl`) y el
  resumen (`summary.md`, `summary.html`, `timeline.json`) que cruza lo dicho con lo visto.
- S3: `go test ./minutes` pasa.

## Pendientes

- Probarla en una reunión real de Meet o Zoom (la prueba del 2026-11-23 fue con voz sintética por los parlantes).
- Las reuniones largas: el resumen de lo dicho hoy recorta la mitad del texto pasado de ~30 mil caracteres; hace falta
  resumir por partes.
