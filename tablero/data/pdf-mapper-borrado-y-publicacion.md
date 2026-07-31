---
id: 9
title: "PDF Mapper — borrado con clave, publicación unificada dev/prod, reemplazar plantilla y ejemplos desde catálogo"
stage: tasks
created: "2026-07-24T13:39:41-05:00"
archived: "2026-07-24T13:46:59-05:00"
context_nodes: []
jira: []
jira_title: "PDF Mapper: borrado protegido con clave, publicación unificada a los dos ambientes y reemplazo de plantilla"
---

Sesión 2026-07-24. Dos repos.

SERVICE (microservices/pdf-mapper-service) — desplegado v0.2.6 a dev y prod (task deploy:prod: commit en develop → merge a main → tag):
- Candado de borrado: middleware RequireDeleteKey en los 2 DELETE (proyecto y documento). Header X-Delete-Key = env DELETE_KEY (default "creditop"), o 401. + X-Delete-Key en el CORS. Badén anti-accidente, no auth fuerte.
- /example: ahora cruza el mapper con el catálogo global y usa el defaultValue curado; VALOR_DE_TEXTO solo para ids fuera del catálogo. Tests + lint 0 issues + cobertura 81%.

EDITOR (pdf-mapper-editor) — commit 9fbee89 pusheado a origin/main:
- Modal de clave (password) antes de borrar; borra local solo si el server confirmó.
- Publicación unificada: PRIMARY=develop (lecturas/preview) + WRITE_BASES=[dev,prod]; Sincronizar/catálogo/borrar hacen fan-out a los dos ambientes con reporte por ambiente.
- Reemplazar plantilla desde el header de edición: si el PDF nuevo tiene menos páginas, poda las páginas sobrantes del mapper (evita romper el estampado). Flag templateDirty fuerza re-subida del template.
- Catálogo append-only (solo agregar, sin editar/borrar) y sacado del documento (gestión solo en la home).

Verificado E2E en dev y prod: DELETE sin header → 401; con clave → pasa; /example sin placeholders.
Nota: los push a prod (main/tag, PUT del catálogo) los frena el classifier local → los corre/aprueba Miguel.

## Tarea (publicable)

Mejoras al estudio de mapeo de documentos y a su servicio de generación:

- Borrado protegido: eliminar un proyecto o documento ahora exige una clave validada en el servicio; sin ella el borrado se rechaza. Evita borrados accidentales.

- Publicación unificada: al sincronizar, el estudio publica plantilla y mapeo en los dos ambientes (desarrollo y producción) en una sola acción, con reporte por ambiente. Se elimina tener que subir el mismo documento dos veces.

- Reemplazar plantilla: desde el editor se puede cambiar el documento por otro; si el nuevo tiene menos páginas, se descartan las páginas sobrantes del mapeo para no romper la generación.

- Valores de ejemplo: la previsualización toma los valores de muestra del catálogo de campos en vez de un texto genérico.

Desplegado y verificado en desarrollo y producción.
