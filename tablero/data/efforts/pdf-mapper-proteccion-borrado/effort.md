---
id: 11
title: "PDF Mapper: protección de eliminación, reemplazo de plantilla y mejoras al catálogo de campos"
stage: tasks
created: "2026-07-24T13:46:32-05:00"
archived: "2026-07-24T13:49:13-05:00"
context_nodes: []
jira: []
jira_title: "PDF Mapper: protección de eliminación, reemplazo de plantilla y mejoras al catálogo de campos"
---

Sesión 2026-07-24. CONSOLIDADA (reemplaza los esfuerzos #9 y #10, archivados). Dos repos.

SERVICE (microservices/pdf-mapper-service) — v0.2.6 a dev y prod (task deploy:prod):
- Candado de borrado: middleware RequireDeleteKey en los 2 DELETE. Header X-Delete-Key = env DELETE_KEY (default "creditop"), o 401. + X-Delete-Key en CORS.
- /example cruza el catálogo global: usa defaultValue curado; VALOR_DE_TEXTO solo para ids fuera del catálogo. Tests+lint OK, cobertura 81%.

EDITOR (pdf-mapper-editor) — commit 9fbee89 en origin/main:
- Modal de clave antes de borrar; borra local solo si el server confirmó.
- Publicación unificada: PRIMARY=develop + WRITE_BASES=[dev,prod]; Sincronizar/catálogo/borrar hacen fan-out a los dos ambientes.
- Reemplazar plantilla (botón en el header); poda páginas sobrantes del mapper; flag templateDirty fuerza re-subida.
- Catálogo append-only (solo agregar, sin editar/borrar) y sacado del documento (gestión en la home). Nuevo campo data_processing_consent en el seed (DEFAULTS_VERSION 8→9).

CATÁLOGO VIVO: unificado vía PUT /api/fields a dev y prod → idénticos en 128 campos (dev estaba corto country/fianza_amount_iva + 3 labels reconciliados a canónico). data_processing_consent = checkbox de casilla única.

Verificado E2E dev y prod. Los push a prod los aprueba/corre Miguel (classifier local).

## Tarea (publicable)

Conjunto de mejoras al estudio de mapeo de documentos, su servicio de generación y el catálogo de campos:

- Protección de eliminación: borrar un proyecto o documento ahora exige una clave, validada en el servicio; sin ella el borrado se rechaza. Evita borrados accidentales.

- Reemplazo de plantilla: desde el editor se puede cambiar el documento por otro; si el nuevo tiene menos páginas, se descartan las páginas sobrantes del mapeo para no romper la generación.

- Mejoras al catálogo de campos: se agregó el campo de autorización de tratamiento de datos personales (incluye perfilamiento crediticio); la previsualización toma los valores de muestra del catálogo en vez de un texto genérico; y el catálogo quedó idéntico en desarrollo y producción.

- Publicación unificada: al sincronizar, documento y catálogo se publican en los dos ambientes (desarrollo y producción) en una sola acción, con reporte por ambiente.

Desplegado y verificado en desarrollo y producción.
