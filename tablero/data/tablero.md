---
id: 84
title: "Tablero"
clase: proyecto
stage: work
created: "2026-09-14T21:40:00-05:00"
context_nodes: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local del tablero. La agenda, la retoma en frío y el cierre diario ya se
derivan de los archivos, Git, ramas y bitácora. La organización local cambia a siete contenedores
permanentes: una tarea por herramienta y `playground` para asuntos transversales o todavía sin Jira.

El laboratorio Jev de tablero está apagado por defecto. Sobre una retoma mínima pregunta en paralelo
el siguiente tipo de acción, el bloqueo externo y la urgencia. El banco sintético repetido dio 16/16
en las tres etiquetas, con 15 sugerencias y una revisión manual; una retoma real quedó etiquetada en
preview y no se envió.

**El próximo paso es:** usar la nueva estructura durante una jornada completa, corregir cualquier
fricción, probar la proyección JSON con workers y reunir varias etiquetas reales antes de considerar
Jev dentro de la agenda.

> **MEDICIÓN · 2026-09-19** — sobre la tarea KYC #47, el Markdown completo pesa 64.571 bytes; la proyección compacta pesa 6.243 bytes (**90,3 % menos**) y la variante con borrador 11.856 bytes.
> make tarea-json N=47; make tarea-json N=47 CONTENIDO=1; wc -c

## Pendientes

- [ ] Comprobar que ninguna tarea local nueva nazca fuera de los siete nombres canónicos.
- [ ] Confirmar que bitácora y retoma siguen agrupadas bajo la herramienta correcta.
- [ ] Medir cuántos archivos y tokens evita `make tarea-json` en una retoma real con workers.
- [ ] Reunir una muestra representativa de etiquetas antes de comparar Jev con trabajo real.

## Cómo se comprueba

`make tareas TODAS=1`, `make tarea-json N=tablero`, `make tablero-jev-test`, los tests del servidor y
`make cierre JSON=1`.

## Registro

### 2026-09-19

Se absorbió `tablero-retomar-en-frio` y se aplicó la consolidación de todas las tareas locales. La
API ya no crea tareas locales sueltas; el CLI también las detecta y hace fallar el lint.

La tarea ahora tiene una proyección JSON tipada y generada desde el Markdown. Expone el estado
operativo sin copiar todo el cuerpo privado y deja el texto largo como evidencia consultable.
