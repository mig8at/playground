---
id: 132
title: "Knowledge: el vigía de la biblioteca"
clase: proyecto
nivel: miguel
stage: work
created: "2026-11-18T15:00:00-05:00"
jira: []
jira_title: ""
---

## Pendientes

- [x] ~~Una corrida real de punta a punta~~ — 2026-11-18: la #1 sobre `infrastructure-changes` (2 fuentes): los diez
      pasos, verificada, aplicada y commiteada sola (`db4b393e`); `knowledge-check` quedó en 0.
- [x] ~~Dejarla de fondo (`make knowledge-flow-install`) y en la barra de Cockpit (`make cockpit`)~~ — 2026-11-18.
- [ ] Ver una corrida que FRENA de verdad (la verificación encuentra algo, o una sección sin decidir) y que el aviso
      lleve a ella; termina con la primera que pase.
- [ ] Ver la cola en vivo: un cambio que entra mientras corre otra corrida y arranca solo al terminar.

## Objetivo

Que `knowledge/` no quede vieja sin que nadie se entere: mirar `main` cada 30 minutos y, cuando una fuente cambia,
correr solo el método de `tools/knowledge-drift`, paso a paso y a la vista, como un workflow de GitHub. El diseño, las
reglas y cómo está construida: [`knowledge-flow/CLAUDE.md`](../../../knowledge-flow/CLAUDE.md).

## Lo que se evaluó y NO se eligió

- **Dentro de Wally (Porygon en Auto)**: Wally no corre de fondo y un flujo con pasos no es un chat; Miguel prefirió una
  herramienta propia.
- **Esperar el sí de Miguel antes de aplicar**: decidió que aplique solo si la verificación sale limpia.
