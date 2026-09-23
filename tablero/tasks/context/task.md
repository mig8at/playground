---
id: 89
title: "Context"
clase: proyecto
stage: work
created: "2026-09-19T08:00:00-05:00"
canon: []
ramas: canon/graduar-desde-context, canon/graduar-desde-context-2, canon/backoffice-readiness
jira: []
jira_title: ""
---

## Frentes activos

- **Vigencia:** repetir alineación y referencias después de cambios relevantes en los repos. Al
  re-verificar, `make context-diff NODE=x CITAS=1` antes de leer el diff; medir cuántas veces evitó
  leerlo entero.
- **Citas dentro de los `CLAUDE.md`:** al mover las secciones, sus `archivo:línea` salieron del
  alcance de `refs.py`, que sólo mira el árbol. Hoy nadie avisa si una se corre. Es el precio del
  retiro y conviene cerrarlo.
- **Clasificar la deriva:** la parte determinista ya está (`CITAS=1`) y dónde anotarla también
  (`context-triar`). Lo que falta antes de pensar en un modelo es la vara: un banco de cambios
  pasados etiquetado desde el historial — y triar a mano ya lo va llenando, porque cada veredicto
  escrito es una etiqueta real.
- **Ramas:** usar la consola en el trabajo diario y ajustar la clasificación si aparece un estado que
  la comparación actual no distingue.
- **Jev:** comparar calidad, abstenciones, latencia y superficie enviada al modelo generativo.
- **Findings:** mantener visible qué parte fue comprobada sin declarar revisado el nodo entero. El
  índice ya no se puede quedar atrás sin que el lint lo diga (`L9`).

## Cómo se comprueba

`make context-lint`, `make context-ramas`, `make context-ramas-test`, `make context-jev-test`,
`make context-jev ARGS='bench'`, `make estilo-ui` y las herramientas de alineación y referencias. Una
corrida Jev no verifica conocimiento ni renueva sellos.
