# <Nombre> · tarea
> **flujo:** <flujo padre> · **rama:** <feature/x> · **PR:** <→develop / →staging> · **estado:** <en progreso | en pruebas | listo>
>
> <TL;DR: qué resuelve la tarea, en 1 frase>

<!-- TAREA = trabajo sobre un flujo, con ramas propias por repo. Doc MAGRO: NO repite el
     "cómo funciona" del flujo (eso vive en el flujo padre; enlazalo). Acá va el objetivo,
     lo que se hizo, la bitácora y los pendientes. La bitácora es el corazón del doc.
     Secciones sin marca = obligatorias; (opcional) = poné solo si aplica. -->

## Objetivo
<Qué resuelve + sobre qué flujo trabaja (link al flujo padre). No re-explicar el flujo.>

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
