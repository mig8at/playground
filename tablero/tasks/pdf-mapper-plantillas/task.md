---
id: 139
title: "PDF Mapper: plantillas y mapper desde la referencia de la entidad"
stage: evaluation
created: "2026-11-24T07:52:37-05:00"
knowledge: [signing-document-generation]
jira: []
jira_title: "PDF Mapper: plantillas y mapper desde la referencia de la entidad"
ramas: pdf-mapper-editor:pdf-v2
---

## Pendientes

- [x] Validar la detección con referencias de varios tipos (`artifacts/referencias/`, armadas con
  `build_references.py`): formulario por recuadros con casillas y fechas partidas, plan de pagos en tabla, pagaré
  con blancos sin marcador y dos columnas de firma, y los T&C reales de Finandina.
- [ ] Probar el mapper que sale de la detección estampándolo en el servicio (hoy el asistente no exporta el mapper):
  termina cuando las cuatro referencias se generan con datos de ejemplo y cada dato cae en su lugar.
- [ ] Conversión de Word a PDF: no hay conversor en la Mac (ni LibreOffice ni pandoc); decidir con qué se hace en el
  servicio. Termina cuando `autorizacion-libranza-ejemplo.docx` pasa por el asistente con sus campos.
- [ ] Una raya de firma dibujada (no con `____`) no se reconoce como zona de firma: el pagaré de ejemplo la tiene.
- [ ] Conectar los pasos de verdad: convertir Word a PDF, tapar marcadores reservando el espacio, armar el mapper y
  guardar plantilla y mapper en el servicio. Antes, decidir dónde vive esto (ver «Ojo»).
- [ ] Conectar la caja de cada página con Claude (pedidos acotados a esa página).
- [ ] Ids que faltan en el catálogo para los T&C de Finandina: los 5 montos en letras y la prima de Protección
  Financiera (ver la tarea `finandina-originacion`).

## Objetivo

Que armar la plantilla de un documento de firma y su mapper deje de ser trabajo manual: se carga la referencia que
manda la entidad (PDF o Word), se prepara la plantilla lo más fiel posible a su diseño, se revisa página por página
con los datos demo encima y pidiéndole cambios a Claude, y se guardan juntos la plantilla y su mapper.

## Cómo se ataca

Dos pasos separados: (1) la plantilla PDF —lista, o convertida desde la referencia reservando el espacio de cada
dato, porque un PDF no reacomoda el texto— y (2) el mapper con ids del catálogo, que puede salir solo de dónde
estaban los marcadores. El servicio no distingue un PDF hecho por nosotros de uno cargado.

## Ojo

La tarea `pdf-mapper` (#105, CORE-818) lleva el editor de mappers al backoffice (frontend-monorepo) y dice
«retirar el PDF Mapper Studio aparte». El prototipo vive hoy en el Studio (`pdf-mapper-editor`, rama `pdf-v2`):
antes de construirlo de verdad, decidir si va al módulo del backoffice.

## Hecho

- Skill `pdf-template` en `pdf-mapper-editor/skills/`: texto marcado → plantilla PDF + mapper.
- Editor: importar plantilla + mapper; trabajar sólo contra el servicio local (`VITE_PDF_MAPPER_TARGET=local`);
  arreglos de «Subir PDF» y de la hoja cortada.
- Prototipo del asistente (`/project/<proyecto>/new`): referencia, preparación, revisión por página con datos demo
  sobre los marcadores reales del PDF y aviso de «no cabe», y guardado con nombre sugerido.
- Detección general en el asistente (`src/prototype/detect.ts`): marcadores `[X]`, blancos `____` nombrados por su
  rótulo, casillas `[ ]`/`( )` agrupadas por pregunta, tablas por fila modelo `[Plan.X]` con las filas contadas en la
  cuadrícula, y zonas de firma. Cada dato ocupa hasta el próximo texto o raya de su recuadro.
