---
id: 134
title: "News: lo nuevo de Hugging Face cada semana"
clase: proyecto
nivel: miguel
stage: work
created: "2026-11-18T18:45:00-05:00"
jira: []
jira_title: ""
---

## Pendientes

- [x] ~~La portada, la ficha y los papers con una semana real~~ — 2026-11-18.
- [x] ~~El servidor que junta la semana y le pide los textos al modelo de fondo~~ — 2026-11-18.
- [x] ~~Verla en la barra de Cockpit~~ — 2026-11-18: después de `make cockpit`, con la semana 47 y sus textos.
- [ ] Ver el cambio de semana: el lunes 23 de noviembre la 47 queda guardada y arranca la 48 sola.

## Objetivo

Saber qué salió en Hugging Face cada semana sin buscarlo: lo más innovador, los modelos nuevos documentados por tipo y
los papers más votados, en español.

## Dónde se toca

`news/` (servidor y interfaz). Cómo se usa y cómo está armada: `news/CLAUDE.md`.

## Lo que se evaluó y NO se eligió

- **La semana como «los últimos 7 días»**: se eligió la semana ISO (lunes a domingo) para que cada semana quede
  guardada una vez y se pueda volver a ella.
- **Documentar todos los modelos**: en Hugging Face hay millones; se documentan los nuevos de la semana que entraron en
  tendencia.
