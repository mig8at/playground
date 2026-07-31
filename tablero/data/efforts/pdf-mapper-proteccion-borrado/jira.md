---
title: "PDF Mapper: protección de eliminación, reemplazo de plantilla y mejoras al catálogo de campos"
---

Conjunto de mejoras al estudio de mapeo de documentos, su servicio de generación y el catálogo de campos:

- Protección de eliminación: borrar un proyecto o documento ahora exige una clave, validada en el servicio; sin ella el borrado se rechaza. Evita borrados accidentales.

- Reemplazo de plantilla: desde el editor se puede cambiar el documento por otro; si el nuevo tiene menos páginas, se descartan las páginas sobrantes del mapeo para no romper la generación.

- Mejoras al catálogo de campos: se agregó el campo de autorización de tratamiento de datos personales (incluye perfilamiento crediticio); la previsualización toma los valores de muestra del catálogo en vez de un texto genérico; y el catálogo quedó idéntico en desarrollo y producción.

- Publicación unificada: al sincronizar, documento y catálogo se publican en los dos ambientes (desarrollo y producción) en una sola acción, con reporte por ambiente.

Desplegado y verificado en desarrollo y producción.
