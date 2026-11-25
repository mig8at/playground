---
id: 140
title: "Flow: el simulador de los rieles, como app de Cockpit"
clase: proyecto
nivel: miguel
stage: work
created: "2026-11-25T00:00:00-05:00"
jira: []
jira_title: ""
---

## Pendientes

- [x] ~~Traerlo de `temp/flow` a my-tools, con su puerto (:5252) y `make flow`~~ — 2026-11-25.
- [x] ~~Separar el riel 4 (originación delegada) de CreditopX: una sola «delegada», con su ficha~~ — 2026-11-25.
- [x] ~~El servicio de preaprobación como nodo, con su respuesta editable (rt=1 y rt=4)~~ — 2026-11-25.
- [x] ~~Registrarlo en Cockpit (app, ícono, documentación) y en el chequeo de nombres~~ — 2026-11-25.
- [ ] Pasarlo al tema compartido (`tools/ui-sync.py`) cuando valga la pena.
- [ ] Poner al día `docs/` (citan el playground y el trazador) o borrarlos.

## Objetivo

Que Miguel entienda los rieles —qué decide quién y qué pasa después de elegir una entidad— tocando un grafo, sin
correr nada. Es para entender, no para medir: se pone al día de vez en cuando y no tiene que seguir al código al pie
de la letra. Lo de un caso real sigue siendo del harness y de los conectores.
