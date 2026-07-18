# <Nombre> · task
> **rama:** <feature/x> · **PR:** <→develop / →staging> · **estado:** <en progreso | en pruebas | listo>
>
> <TL;DR: qué resuelve la task, en 1 frase>

<!-- TASK = trabajo sobre CreditOp, con ramas propias por repo. Cuelga ABAJO de la raíz y
     COMPONE los CONTEXTOS de arriba que necesita (los lista en "Contextos que usa" = chips).
     Doc MAGRO: NO repite el contenido de esos contextos (los referencia). Acá va el objetivo,
     los contextos que usa, lo que se hizo, la bitácora y los pendientes.
     Secciones sin marca = obligatorias; (opcional) = poné solo si aplica. -->

## Contextos que usa
<!-- los nodos de contexto (de arriba) que esta task necesita para resolverse; se muestran
     como chips en la tarjeta y se resaltan al seleccionar la task. Elegí SOLO los relevantes. -->
- **<contexto>** — <por qué lo necesita esta task>.

## Objetivo
<Qué resuelve. No re-explicar los contextos; referencialos.>

## Ramas y PRs por repo
<!-- Una tarea cruza hasta 3 repos con ramas de bases distintas y retargeteos. Tabla > header. -->
| Repo | Rama | Base | PR → | Estado |
|---|---|---|---|---|
| <legacy-backend> | <feature/x> | <staging> | <develop> | <abierto/mergeado> |

## Lo que se hizo
<!-- por frente/cambio: QUÉ, POR QUÉ y CÓMO AJUSTAR (dónde tocar si hay que cambiarlo) -->
### <frente>
<qué · por qué · dónde vive · cómo ajustar>

## Cómo probar / validar <!-- (opcional) -->
<Cómo se verifica que el cambio funciona: plan dual-read, qué correr, barrido de confirmación (ej grep = 0 referencias). La evidencia de completitud.>

## Bitácora
<!-- fechado, append-only: el registro vivo de lo que se fue haciendo/decidiendo -->
- **YYYY-MM-DD** — <qué cambió y por qué>

## Pendientes
- [ ] <qué falta>

## Enlaces
<Jira · PRs · flujo padre · docs maestros.>
