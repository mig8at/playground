# Notas de reuniones

Lo que se dice en las reuniones de CreditOp sobre crédito: qué se quiere, cómo se va y qué se decidió. **No es un tema
de la biblioteca**: son intenciones, metas y cifras dichas en una reunión, no comportamiento comprobado en el código
ni números medidos. Lo verificado en `main` está en los temas (`make knowledge-map`).

| archivo | qué es |
|---|---|
| [`weekly-ct.md`](weekly-ct.md) | la **Weekly CT** semana a semana: cifras, decisiones, prioridades y tareas de producto y tecnología |
| [`background.md`](background.md) | antecedentes de otras reuniones: planificación de onboarding, capacitaciones de producto, Bancolombia, ecommerce, la organización de tecnología |
| `raw/` | las notas tal como se bajaron, **fuera de git**: transcripciones, nombres y datos internos. Su índice: `raw/INDEX.md` |

## De dónde sale

- **Notas de Gemini**: el documento que Google Meet deja en Drive (resumen, decisiones, próximos pasos, detalles y la
  transcripción).
- **Informes de Read AI**: los que manda por correo quien agrega Read a la reunión (resumen, capítulos y tareas).

Las dos son automáticas y se equivocan: nombres mal transcritos («Crédito PX» por CreditopX, «Mutai» por Motai), cifras
que no cierran entre sí y fechas mal puestas. Por eso cada semana tiene un bloque **«Para contrastar»**: una cifra que
importe se mide en la base (`bin/pg sql`) antes de usarla.

## Ponerlo al día

Cada miércoles, después de la Weekly:

1. `make meetings-fetch` baja lo nuevo de Drive y Gmail a `raw/` y rehace el índice.
2. Se agrega la semana arriba de «Semana a semana» en `weekly-ct.md`, con la misma forma que las demás, leyendo el
   resumen, las decisiones, los próximos pasos y los detalles (la transcripción, sólo para una duda); se suma su fila a
   las tablas de cifras y, si cambió el rumbo, se reescribe la «Síntesis».

**Qué entra**: metas y cifras de negocio, comercios y entidades, decisiones, prioridades de producto, tecnología y
crédito, financiación y cambios de organización. **Qué no**: vacaciones, logística de oficina, eventos, temas de
personas o de RR. HH. y cualquier dato de clientes. Las personas se nombran sólo como responsables de una tarea o quien
presentó un tema.
