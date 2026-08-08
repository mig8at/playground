# Microservicios · qué corre además del monolito

> **medido contra producción** el **2026-08-07**: los `service_name` que emitieron logs a Loki en los
> últimos 7 días, y el volumen de las últimas 24 h. Las rutas de código se validaron contra `main` de
> cada repo.

## Qué es

Este árbol nació describiendo el monolito, y durante meses **eso fue todo lo que describió**. La
medición de arriba dice otra cosa: en producción corren **14 servicios**, y hasta hoy el árbol indexaba
**5 repos**. Nueve servicios eran invisibles — ninguna tarea sobre ellos podía rutear, y cualquier cita a
sus archivos **dropeaba en silencio** por no tener root.

Este nodo no explica qué hace cada servicio: dice **cuáles hay, cuánto pesan y dónde buscarlos**. Es la
pregunta que va antes de todas las demás.

## El censo (producción, 2026-08-07)

Volumen = líneas de log en 24 h. No mide importancia, mide **actividad**: sirve para separar el servicio
que atiende tráfico del que apenas late.

| servicio | líneas / 24 h | clonado | lo indexa el árbol |
|---|---:|---|---|
| **`financial-health-service`** | **86.350** | ✓ `microservices/` | ✓ *(desde hoy)* |
| `legacy-backend` | 75.737 | ✓ | ✓ |
| **`merchant-api`** | **35.840** | ❌ | ❌ |
| **`self-manager-api`** | **34.584** | ❌ | ❌ |
| `preapprovals-service` | 16.572 | ✓ | ✓ |
| `legacy-application` | 11.396 | ✓ | ✓ |
| **`otp-service`** | 1.647 | ❌ | ❌ |
| `onboarding-forms-service` | 328 | ✓ | ✓ *(desde hoy)* |
| **`merchant-gateways-service`** | 121 | ❌ | ❌ |
| **`reportery-service`** | 39 | ❌ | ❌ |
| `pdf-mapper-service` | 12 | ✓ `microservices/` | ✓ *(desde hoy)* |
| `customer-profiling-service` | 5 | ✓ | ✓ *(desde hoy)* |
| `customer-service` | — *(en 7 d, no en 24 h)* | ✓ `microservices/` | ✓ *(desde hoy)* |
| `form-service` | — *(en 7 d, no en 24 h)* | ✓ | ✓ |

**Lo que la tabla dice, y que no era la intuición de nadie:**

- ⚠ **El servicio que más loguea en producción NO es el monolito**, es `financial-health-service` —y el
  árbol no sabía que existía—. Sirve a la **app móvil**: sus códigos de respuesta son `MOBA*` y su
  entrada es el header `X-User-Id`. Expone `financial-health`, `financial-tips` y `financial-profile`.
  **Hay un producto entero —el móvil— fuera del alcance de este árbol**, con su propio repo
  (`creditop_mobile`, que ni siquiera tiene archivos de las extensiones que indexamos).
- ⚠ **Los servicios #3 y #4 por volumen (`merchant-api`, `self-manager-api`) no están ni clonados.**
  Juntos hacen más ruido que `legacy-application`. Sin el repo no hay nada que indexar y este nodo no
  puede decir más que su nombre.
- **`customer-profiling-service` está vivo pero casi no se usa** (5 líneas en 24 h). Es la evidencia que
  faltaba para contestar si el pipeline de KYC en Temporal ya reemplazó al bloque síncrono del monolito:
  **todavía no**. Ver abajo.

## `customer-profiling-service`: el KYC que viene

Es el servicio que más importa entender de los nuevos, porque **pisa dos nodos grandes del árbol**
(`kyc` y `profiling`). Go, arquitectura hexagonal, **PostgreSQL** (no MySQL) y **workflows de Temporal**.

Lo que hace `legacy-kyc-pipeline`: reemplaza el bloque de consultas a burós que hoy corre **síncrono
dentro del monolito**. En vez de reglas con `if`, recorre un **grafo dirigido configurable por comercio**
—cada nodo es un proveedor y declara a dónde seguir en caso de éxito (`next_success`) y de error
(`next_error`)—, guardado en la tabla `kyc_pipelines` de su propio Postgres. Eso le da reintentos con
backoff, tolerancia a un proveedor caído sin tumbar la solicitud, y una bitácora (`outcomes`) de qué se
consultó y qué respondió. Devuelve `COMPLETED` o `PENDING_USER_DATA` con los `missing_fields`.

**Cómo se conecta con el monolito, hoy**: al revés de lo que uno supondría. El monolito **no lo llama**;
expone un endpoint para que **él** resuelva el `users.id` a partir del `user_request_id`
(`OnboardingController.php:1647 showUserRequest`, cuyo comentario nombra explícitamente «the CPS
legacy-kyc-pipeline»). O sea que el orquestador es el servicio nuevo y el monolito es su fuente de datos.

⚠ **Lo desplegado no es lo usado.** Tiene deploy a producción por tag (`main-prod.yaml`, con migraciones)
y cuatro releases (`v0.0.1`…`v0.0.4`), pero **5 líneas de log en 24 h**. Y `origin/develop` va por
delante de `main` con commits del 2026-08-04 («Now legacy backend decides whether the data is valid»),
o sea que la integración se sigue moviendo. **Para una tarea de burós HOY, la verdad sigue estando en el
monolito**; este servicio es hacia dónde va, no dónde está.

## Dónde mirar

- **El pipeline de KYC** — `customer-profiling-service/internal/core/workflows/legacykycpipeline/workflow.go`
  (el workflow de Temporal) · `walk.go` (el recorrido del grafo: es donde se decide el `next_success` /
  `next_error`) · `internal/core/domain/pipeline.go` (el modelo del grafo y su `Validate()`) ·
  `internal/infra/storage/postgres/pipeline_repository.go` (de dónde sale la configuración por comercio).
  El otro workflow, `internal/core/workflows/kyc/workflow.go`, es distinto — no se leyó.
- **El punto de contacto con el monolito** —
  `legacy-backend/Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1647 showUserRequest`.
  Es de una línea, y su comentario es la única mención de CPS en todo `main`.
- **El backend del móvil** — `financial-health-service/cmd/http-server/main.go` y los tres handlers de
  `internal/infra/handlers/http/` (`financial_health`, `financial_tips`, `financial_profile`). Cada uno
  tiene su `response_codes.go`, que es donde viven los `MOBA*`.
- **Los otros dos indexados** — `customer-service/cmd/http-server/main.go` y
  `pdf-mapper-service/cmd/http-server/main.go` (este último rellena plantillas PDF; su editor,
  `pdf-mapper-editor`, es otro repo y **no** se indexa porque no corre en producción).

## Cómo volver a medir esto (la receta)

El censo envejece. La fuente es Loki, y la pregunta se contesta en dos comandos:

```bash
cd trazador && set -a && . ./.env.prod && set +a
# qué servicios existen
curl -s -u "$LOKI_USER:$LOKI_TOKEN" \
  "$LOKI_URL/loki/api/v1/label/service_name/values?start=$(( $(date +%s) - 604800 ))000000000&end=$(date +%s)000000000"
# cuánto pesa cada uno en 24 h
curl -s -u "$LOKI_USER:$LOKI_TOKEN" --get "$LOKI_URL/loki/api/v1/query" \
  --data-urlencode 'query=sum by (service_name) (count_over_time({service_name=~".+"}[24h]))' \
  --data-urlencode "time=$(date +%s)"
```

**El criterio para sumar un root a `tools/roots.py` es este censo, no el disco**: que el servicio esté
vivo en producción **y** el repo esté clonado. Un repo clonado que no corre documentaría algo que no
existe; un servicio que corre sin repo no se puede indexar y se queda en esta tabla.

## Gotchas / riesgos

- ⚠ **La ausencia de un `service_name` en Loki NO prueba que el servicio esté muerto.** Puede no estar
  instrumentado, loguear con otro nombre, o mandar a otro backend — es exactamente lo que pasa con el
  **wizard**, que existe y no manda una sola línea a Loki (sale por OTLP hacia PostHog). Están clonados y
  no aparecen en el censo: `kyc-gateway`, `web-auth-service`, `messaging-service`, `dynamic-form`,
  `cognito-pre-sign-up`, `vtex`. **No concluir que son restos.**
- ⚠ **Cada servicio tiene su propia base**, y varias son **PostgreSQL**. Buscar una tabla en el MySQL de
  `creditop` y no encontrarla **no prueba nada** sobre un microservicio. Pasó en esta misma medición:
  `kyc_pipelines` no está en MySQL porque vive en el Postgres de CPS.
- **`onboarding-forms-service` está clonado DOS veces** (`~/github/onboarding-forms-service` y
  `~/github/microservices/onboarding-forms-service`), con contenidos parecidos y fechas distintas. El
  root apunta al de primer nivel, que es el más nuevo. No confundirlo con `form-service`, que es otro
  servicio y otro repo (ver el nodo `form-service`).
- **`financial-health-service` tiene `feat/n8n` checkeada, no `main`.** El oráculo valida contra `main`
  —que existe— así que no hay problema, pero al abrir el repo a mano se lee otra rama.

## Lo que NO está verificado
- El workflow `internal/core/workflows/kyc/` de customer-profiling-service (distinto de `legacykycpipeline`): no se leyó.

## Enlaces

- `architecture` — el padre: cómo se reparte el sistema.
- `kyc` · `profiling` — los dos nodos que `customer-profiling-service` va a pisar cuando entre al camino
  caliente.
- `form-service` — un microservicio que **sí** tenía nodo. No confundir con `onboarding-forms-service`.
- `ms-preapprovals` — el otro microservicio con nodo propio.
- `findings` — **F-123** (la medición y por qué el árbol no lo veía).
- `trazador` — la herramienta que ya habla con Loki; la receta de este nodo usa sus credenciales.
