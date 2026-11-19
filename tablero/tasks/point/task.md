---
id: 135
title: "point: dónde tocar en una captura"
clase: proyecto
nivel: miguel
stage: work
created: "2026-11-18T20:10:00-05:00"
jira: []
jira_title: ""
---

## Pendientes

- [x] ~~Comparar modelos que señalan dónde tocar, con capturas cuya respuesta sale del DOM~~ — 2026-11-18: cuatro modelos, 42 preguntas.
- [x] ~~El comando con el elegido (Qwen3-VL-4B), que levante y apague solo su servidor~~ — 2026-11-18: `bin/point`, 37 de 42.
- [ ] Usarlo desde Jarvis cuando una pantalla no tiene localizador: la captura de `bin/jarvis shot` y el punto de `bin/point`.
  Termina cuando una meta de Jarvis toca un botón por su punto y lo verifica con `look`.
- [x] ~~Decidir si se borra UI-Venus-2-9B de la caché~~ — 2026-11-18: borrado (Miguel); el comando usa Qwen3-VL-4B.

## Objetivo

Pasarle una captura y una pregunta («¿dónde le doy para continuar?») y que devuelva el punto donde tocar, en la Mac y
sin red.

## Dónde se toca

`point/` (el comando y la vara en `eval/`), `bin/point`, `make point`. Cómo se usa y cómo se eligió: `point/CLAUDE.md`.

## Lo que se evaluó y NO se eligió

- **UI-Venus-2-9B**: el que más acertó (40 de 42), pero tarda 6–9 s por pregunta contra 2–3 s.
- **Holo2-4B** (33 de 42) y **GUI-Owl-1.5-2B** (26 de 42): especialistas que acertaron menos que el general con el mismo
  prompt; se borraron.
- **Que nunca diga «no está»**: sin esa salida el modelo inventa un lugar; con ella pierde dos fáciles (de 39 a 37).
