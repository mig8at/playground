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
- [x] Guardar de verdad y probarlo con el servicio: el asistente arma la plantilla (marcadores tapados sobre el
  original) y el mapper, los guarda con los ids nuevos en el catálogo, y el servicio los genera bien (formulario, plan
  de pagos con sus 12 filas y pagaré, en local).
- [ ] Conversión de Word a PDF: no hay conversor en la Mac (ni LibreOffice ni pandoc); decidir con qué se hace en el
  servicio. Termina cuando `autorizacion-libranza-ejemplo.docx` pasa por el asistente con sus campos.
- [ ] Una raya de firma dibujada (no con `____`) no se reconoce como zona de firma: el pagaré de ejemplo la tiene.
- [ ] Abrir el PR de la v2 (rama `pdf-v2` → `main` del Studio) y validarlo con el equipo; se mergea sólo si les sirve.
  Depende de: Miguel — el sí para publicar la rama y el PR.
- [ ] Conectar la caja de cada página con Claude (pedidos acotados a esa página), con las herramientas de la skill
  (`layout.py`, `grid.py`) para que ubique sin adivinar.
- [ ] Un marcador que en la referencia se sale de su recuadro (`[AnioNacimiento]` en el formulario de ejemplo) deja un
  espacio donde el dato no cabe: hoy se avisa; que lo resuelva Claude en la plantilla.
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

## Dónde vive

**En el PDF Mapper Studio** (`pdf-mapper-editor`), no en el backoffice (decisión de Miguel, 2026-11-24). La tarea
`pdf-mapper` (#105, CORE-818) sigue su camino aparte. Esta versión es la **v2**: va en un PR separado desde la rama
`pdf-v2`, que no se mergea a `main` hasta validarla con el equipo.

## Hecho

- El estudio es automático (`pdf-mapper-editor`, rama `pdf-v2`): sin edición manual, sin copias en el navegador (el
  servicio es la fuente de verdad), un ambiente a la vez elegido en la barra de abajo. Crear: el asistente. Ver: el
  documento en sólo lectura, con «Generar con datos demo».
- Skill `pdf-template`: `layout.py` (el plano de la página en coordenadas del mapper) y `grid.py` (cuadrícula y
  mapper dibujado) para Claude; `build_template.py` para documentos sin PDF de referencia.
