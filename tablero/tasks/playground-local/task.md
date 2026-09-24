---
id: 96
title: "Playground local"
clase: proyecto
stage: work
created: "2026-09-24T12:00:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Alcance

Lo transversal a las herramientas locales —`harness`, `tablero`, `trazador`, `visor` y las que
vengan—: cómo se ve, cómo se divide la pantalla, cómo se llama cada parte y qué contrato cumple una
herramienta nueva para parecerse a las demás. Una mejora de una sola herramienta sigue yendo a su
contenedor; lo que no es de herramientas (negocio, conectores, país) sigue en `playground` (#90).

La fuente de lo que ya existe es `tools/ui/` (`tema.css`, `taller.css`, `workbench.js`,
`RegionMenu.vue`) y `make estilo-check`, que lo verifica en las cuatro.

## Frente: el estándar del esqueleto

**Objetivo.** Un documento —prototipo en artifact— que diagrame el esqueleto principal de una
herramienta y le dé nombre a cada parte visual (sidebar, editor, toolbar, statusbar…), con la regla
de cuándo existe cada una, para que una herramienta nueva se arme leyendo eso y no copiando otra.
