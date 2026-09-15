---
id: 81
title: "Listado de entidades: lo caro no es la base, es el perfilador"
stage: evaluation
ramas: perf/el-perfilador-que-falla-en-silencio
created: "2026-09-13T16:20:00-05:00"
context_nodes: [legacy-backend, findings, microservicios, profiling]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Veníamos optimizando el listado por el lado de las **consultas** (124 → 86, y la N+1 de
`orden_y_condiciones` en `legacy-backend#1382`). Miguel preguntó si se puede mejorar todavía más. Se
midió antes de responder, y la respuesta corta es **sí, pero no por ahí**.

⚠ **Trabajo en LOCAL, sin push.** Rama `perf/el-perfilador-que-falla-en-silencio`, nacida de `origin/qa`.

## Lo primero: había que medir el endpoint correcto

El front usa **`lenders-v2`** (`LenderListingController` → `LenderListingService`), no `lenders`
(`ListLenderController` → `LenderRetrievalService`). El harness pega por defecto a **v1**, así que la
primera medición fue del endpoint equivocado.

Y v2 no es una versión cosmética: existe porque **v1 consultaba los pre-aprobados DENTRO del backend**
y eso lo hacía lento. En v2 el backend entrega el listado y **el front consulta el microservicio de
pre-aprobados** (Miguel, 13/9). Esa es la optimización grande, y ya está hecha.

## ⚠ Lo que NO se puede concluir de qa

Se sacaron de Loki 172 listados de qa con el reloj por etapas y daban mediana 632 ms / p90 2,9 s /
max 12,9 s. **Esos números no describen producción**: qa tiene cambios que Miguel agregó y que no
están en `main` (dicho por él, 13/9). Quedan como forma, no como magnitud.

**Lo que sí vale, porque se midió contra prod o contra el código:**

| hecho | dónde se midió |
|---|---|
| prod hace **2.652 listados por semana** | Loki prod, 7 d |
| **17% de los listados son RE-listados** de la misma solicitud (1.035 llamadas sobre 855 solicitudes en 3 d) | Loki prod |
| prod no tiene **ni una línea** sobre el perfilador, ni de éxito ni de fallo | Loki prod, 7 d |
| prod no mide la latencia del listado: el reloj por etapas está **sólo en `origin/qa`** | `git grep` en las tres ramas |
| el perfilador ML hace **dos llamadas HTTP encadenadas**, con timeout de 15 s cada una | `ProfilerMLController::profileWithFallback` en `main` |
| `ExceptionNotification` **importa `ShouldQueue` y no lo implementa**; `QUEUE_CONNECTION` es `sync` y ningún despliegue corre un worker | código + `config/queue.php` + workflows |
| **162 lugares** mandan ese correo | `grep` |
| en un listado local, **64 de 130 consultas son repeticiones EXACTAS** (mismo texto, mismos valores) | log general de MySQL, local |

## Las tres cosas que valen la pena, en orden

**1 · Producción está ciega en su etapa más cara.** El reloj por etapas y la telemetría del fallback
existen, funcionan y están probados — en qa. En `main` no están. Mientras sigan ahí, cualquier
discusión sobre el costo del listado en prod es opinión. Es lo más barato de todo: el código ya está
escrito.

**2 · El perfilador nuevo rechaza y el fallback lo tapa.** Cuando el primario falla se llama al legacy,
así que nada se rompe visiblemente — pero se pagan dos llamadas HTTP. En qa eso pasó en el 19% de los
listados con código **422** (no timeout: cero expiraron), o sea el perfilador **rechazando el payload**,
no el servicio caído. ⚠ Ese 19% es de qa y no se puede extrapolar. La línea que lo registra guardaba el
código y **tiraba el mensaje** que dice qué objeta — arreglado en `61cd0558`, que es lo único
commiteado de este frente.

**3 · El correo va dentro de la petición.** Cada fallo del perfilador dispara
`Notification::route('mail', [...])->notify(new ExceptionNotification(...))` a dos personas. La clase no
implementa `ShouldQueue`, la cola es `sync` y nadie corre un worker: **el SMTP sale inline**. No se tocó:
quitarle a alguien su alerta no es una decisión técnica. El arreglo de fondo es infraestructura (F-209).

## Lo que se descartó, y por qué

**Las 64 consultas repetidas no son la palanca.** Son el 49% de las consultas de un listado y se pueden
sacar sin batching —son la misma consulta con los mismos valores, no pueden dar otra respuesta—, pero en
local cuestan ~12 ms de 87. La base es la mitad chica del problema. ⚠ Y hay una advertencia: en local
MySQL está en el mismo Docker (0,08 ms de ida y vuelta); contra una base remota el costo por consulta es
otro. **No está medido desde dentro de AWS**, así que no se sabe cuánto cambia — medirlo es requisito
antes de invertir ahí.

De dónde salen: `LenderUserCategoryService` se llama una vez por entidad y cada vez vuelve a traer el
mismo usuario (`UserRepository:13`), su `risk_central_user_data`, su `user_summaries`
(`MonthlyIncomeResolver:73`), sus `user_field_values`, y dos veces la entidad que ya tiene en la mano
(`:990` y `:1010`). Más `CreditopXDatacreditoAdjustmentService:72`, que consulta
`creditop_x_requests_history` del mismo usuario 10 veces porque cada llamador hace `new` del servicio.

**Cachear la predicción del ML por solicitud** cubriría el 17% de re-listados de prod, pero toca un
camino de decisión de riesgo y necesita acuerdo antes: no se hizo.

## Riesgos y preguntas abiertas

- **¿Cuál es el 422 real de producción?** Sin la telemetría en `main` no se sabe si el 19% de qa es un
  artefacto de lo que Miguel agregó ahí o un problema real. Es la pregunta que desbloquea todo lo demás.
- **¿Cuánto cuesta una consulta desde el backend en AWS?** Lo medido (106 ms) es desde la máquina de
  Miguel a la RDS y no sirve: el backend vive en la misma región. Sin ese número, las 64 repeticiones no
  se pueden priorizar.
- **El correo sincrónico** es de los 162 sitios, no sólo del perfilador. Cambiarlo es una decisión de
  quien recibe esas alertas.
