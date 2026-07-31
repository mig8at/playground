---
title: "PDF Mapper: borrado protegido con clave, publicación unificada a los dos ambientes y reemplazo de plantilla"
---

Mejoras al estudio de mapeo de documentos y a su servicio de generación:

- Borrado protegido: eliminar un proyecto o documento ahora exige una clave validada en el servicio; sin ella el borrado se rechaza. Evita borrados accidentales.

- Publicación unificada: al sincronizar, el estudio publica plantilla y mapeo en los dos ambientes (desarrollo y producción) en una sola acción, con reporte por ambiente. Se elimina tener que subir el mismo documento dos veces.

- Reemplazar plantilla: desde el editor se puede cambiar el documento por otro; si el nuevo tiene menos páginas, se descartan las páginas sobrantes del mapeo para no romper la generación.

- Valores de ejemplo: la previsualización toma los valores de muestra del catálogo de campos en vez de un texto genérico.

Desplegado y verificado en desarrollo y producción.
