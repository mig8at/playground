---
id: 92
title: "Workers"
clase: proyecto
stage: evaluation
created: "2026-09-19T14:55:00-05:00"
canon: [arquitectura]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local de workers. ⚠ **La cadena de agentes está caída desde el 2026-09-21**,
cuando se apagó el árbol `context/`: `plan.py` importa el router Jev desde `context/tools` y lee el mapa
de rutas de `context/docs/ROUTE-MAP.md`, y `contexto.py` lee también de `context/`. Con esas rutas
borradas, `python3 plan.py` falla en el import, así que `make agente-plan` y `make agente-analisis` —que
corre `plan.py` como subproceso— no llegan a planificar. Y el camino sin Jev no la salva: también lee el
mapa del árbol borrado.

> **MEDICIÓN · 2026-09-23** — `cd workers && python3 plan.py --help` → `ModuleNotFoundError: No module named 'jev'` (línea 35, `import jev as context_jev`, con `sys.path` apuntando a `context/tools`, que no existe). El `ROUTE-MAP.md` que lee la línea 157 tampoco existe.
> cd workers && python3 plan.py --help; ls ../context/docs/ROUTE-MAP.md

**El próximo paso es:** reapuntar la cadena a canon —el corpus que reemplazó a `context/`— en lugar del
árbol borrado, y retirar el ruteo Jev, cuyo laboratorio se fue con el árbol (y el del tablero, el
2026-09-23). Es trabajo de esta herramienta y no se hizo: sólo se constató la rotura.

## Pendientes

- [ ] Reapuntar `plan.py` y `contexto.py` a canon y retirar el ruteo Jev (`JEV=1`); termina cuando
      `make agente-analisis PREGUNTA='…'` vuelve a planificar, buscar y leer.
- [ ] Probar el recorrido completo con preguntas generales y sin datos sensibles.
- [ ] Etiquetar el nodo que realmente sirvió después de leer las fuentes.
- [ ] Mantener recuperación al mapa completo y comportamiento idéntico cuando Jev esté apagado.

## Registro

### 2026-09-23

> **2026-09-23 · sin avance.** Al retirar Jev del tablero se constató que la cadena de agentes está caída
> desde el 21/9: depende del árbol `context/`, que se borró. No se trabajó en la herramienta; la retoma se
> reescribió porque lo que decía («no afecta el funcionamiento normal sin Jev») había dejado de ser cierto.

### 2026-09-19

Se creó la tarea canónica de workers para separar sus mejoras de las del corpus de `context`.
