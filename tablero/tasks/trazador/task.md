---
id: 91
title: "Trazador"
clase: proyecto
ramas: tracer/nace
stage: evaluation
created: "2026-09-19T14:55:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Pendientes

- [ ] Mostrar cuándo se consultó una traza o búsqueda guardada («consultado hace…») y un «Actualizar» que vaya a la fuente; termina cuando una traza abierta desde IndexedDB dice su antigüedad y se puede refrescar sin borrar la caché a mano.
- [ ] Arreglar el recorte por antigüedad de `src/queryCache.js`: el índice y los cursores usan `guardadaEn` y los registros nuevos escriben `savedAt`; termina con el índice migrado y una prueba que siembre entradas viejas y vea que se recortan.
- [ ] Que elegir una etapa con el teclado o desde el detalle pase por `select()` (hoy `StageMap.vue` y `Detail.vue` asignan `selectedStage` directo y la URL no la guarda); termina cuando recargar conserva la etapa elegida por cualquiera de los tres caminos.

- [ ] Pedirle a Dani las tres fuentes para `tracer` + la puerta de Google + los recursos del servicio.
- [ ] Confirmar con Dani si el security group de `alb-internal-tools` está cerrado a la VPN: resuelve
      a IPs públicas, y de eso depende que mostrar cédulas sin llave propia sea correcto.
- [ ] Abrir el PR de `tracer/nace` (uno solo, con todo).
- [ ] Decidir qué pasa con el trazador de acá cuando el otro esté andando: hoy conviven a propósito.
- [ ] Leer los sin clasificar de 14 días y decidir: ¿faltan categorías, o es ruido?
- [ ] Definir categorías de incidente que produzcan una decisión concreta en código.
- [ ] Diseñar un estado derivado sin mensajes, ids, teléfonos ni payloads crudos.
- [ ] Conservar el clasificador actual como recuperación durante todo el experimento.
