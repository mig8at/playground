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

## Antes de concluir

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

## El censo (producción, 2026-08-07)

Volumen = líneas de log en 24 h. No mide importancia, mide **actividad**: sirve para separar el servicio
que atiende tráfico del que apenas late.

> ⚠ **CORREGIDO el 2026-08-28: ni siquiera mide actividad. En dos casos medía el LATIDO.**
> `self-manager-api` (el #4 de esta tabla) hace **34.564 líneas en 24 h y cero errores**, y la mitad
> exacta dice «http request started» y la otra «http request completed»: **dos líneas por cada chequeo
> de `/health` del balanceador**, en nivel debug. Su volumen entero es el latido.
> Y `merchant-api` (el #3) pasó de **35.840 a 242** líneas en tres semanas sin que nada indique que se
> apagó — el volumen se mueve por **cómo** loguea un servicio, no por cuánto se usa.
> Para decidir si un servicio importa hay que contar **peticiones de negocio o errores**, no líneas.
> Los cuatro que faltaban clonar (`merchant-api`, `self-manager-api`, `otp-service`,
> `reportery-service`) **ya están clonados**; el quinto se llama `merchant-gateways`, no
> `merchant-gateways-service`.

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

## La topología DESPLEGADA (infra, 2026-08-31 + sondeado el 2026-09-11)

El censo de arriba se hizo con Loki: dice **quién loguea**. Este dice **quién está desplegado**, que es
otra pregunta — y es justo la que el propio nodo advierte que Loki no contesta («la ausencia de un
`service_name` NO prueba que el servicio esté muerto»). Fuente: el documento *Environments Sites* de
infraestructura, con fecha de actualización **2026-08-31**; lo que dice cada tabla se volvió a **sondear
desde la máquina el 2026-09-11** y las diferencias están marcadas.

**Sólo hay DOS clusters ECS**: `inertia-develop` y `inertia-production`. Dev, staging, QA y canary son
**el mismo cluster** con servicios distintos; no hay una cuenta ni una red por ambiente.

**El formato del nombre interno es `http://{servicio}.{cluster}:{puerto}`** — service discovery, sin
TLS y sin pasar por el ALB. Es lo que ya usan los `.env.*` del arnés (`E2E_API_BASE_URL`,
`E2E_PREAPPROVALS_ENDPOINT`) y los del wizard.

### Lo que sólo existe en un lado

| Sólo en PROD | Sólo en DEV |
|---|---|
| `legacy-application-worker-high` | `legacy-application-stg` · `legacy-application-canary` (+ su worker) |
| `legacy-application-scheduler` | `legacy-backend-stg` · `-qa` · `-rec` · `-lab` |
| **`legacy-backend-scheduler`** | `loan-request-wizard-stg` · `-qa` |
| **`legacy-backend-worker`** | `payment-gateway-service` · `payment-service` · `risk-profile-service` |
| `uma` | **`profiler-ml`** |

Las dos filas en negrita de PROD son **F-209**: fuera de producción el monolito nuevo no tiene ni cola
ni cron. Verificado sin depender del documento — `legacy-backend-worker.inertia-develop` y
`legacy-backend-scheduler.inertia-develop` **no resuelven en DNS**, mientras que
`legacy-application-worker.inertia-develop` sí.

**`profiler-ml` no tiene workflow de producción**, y es el perfilador *nuevo* (`services.new_profiler_ml`),
el primario de la cadena que describe el nodo `profiling`. En dev está vivo y es rápido: sondeado el
2026-09-11, `GET http://profiler-ml.inertia-develop:8000/` contesta **200 en 0,18 s**.

⚠ **`h2o` es otra cosa.** Está en los dos clusters y en dev **arranca en frío**: la primera llamada a
`/3/Cloud` tardó **13,9 s** y las cinco siguientes **1,3–2,8 s**. Es el modelo del camino **legacy** del
perfilador (`services.h2oapi`, `ProfilerMLController::makePrediction`, `timeout(15)`). Que esté lento no
basta para explicar un listado lento: hay que comprobar antes que el fallback se haya disparado (ver
F-207).

### Cinco `legacy-backend` sobre UNA base

En el cluster de dev corren **cinco** servicios del mismo repo —`legacy-backend`, `-stg`, `-qa`, `-rec`,
`-lab`—, y los cuatro con workflow construyen la imagen con **`APP_ENV=develop`** (verificado en
`main-dev.yaml`, `main-stg.yaml`, `main-qa.yaml`, `main-lab.yaml`). Comparten la **misma base**
(`inertia-dev`). Dos consecuencias que ya costaron tiempo:

- **«es dev» no se puede probar desde un log.** Los cinco emiten con las mismas etiquetas, así que en
  Grafana no se distingue cuál contestó. Es por qué una inferencia por conteo de líneas entre dev y qa
  no vale — cualquiera de los cinco pudo escribirlas.
- **la advertencia de la BD compartida es por cinco, no por dos.** `CLAUDE.md` dice que staging comparte
  la base con dev; son cinco backends y dos monolitos viejos sobre el mismo RDS.

⚠ **`legacy-backend-rec` no tiene rama ni workflow.** Resuelve en DNS, pero en `origin` no hay rama `rec`
ni `main-rec.yaml`: corre una imagen que nadie vuelve a publicar. No lo uses como ambiente y no supongas
qué código tiene.

### Rama → despliegue

| ambiente | dispara con |
|---|---|
| DEV | push a `develop` |
| STG | push a `staging` |
| QA | push a `qa` |
| LAB | push a `lab` *(el documento no lo lista para `legacy-backend`; el workflow sí — verificado)* |
| Canary | push a `canary` (sólo `legacy-application`; el workflow vive en esa rama) |
| PROD | **un tag**, no una rama |

Excepción que engaña: **`backoffice` (en `frontend-monorepo`) usa la rama `lab` para DEV y `main` para
PROD** — nada de `develop`. Y hay **dos `lab` distintos**: el de `frontend-monorepo` sirve al backoffice,
el de `legacy-backend` sirve a `legacy-backend-lab`.

### URLs públicas: qué host es qué ambiente

Tres ALB internet-facing, todos por host-header y sólo HTTPS; un host que no matchea da **403**, que se
lee como «el servicio está caído» y no lo es.

- **PROD** (`Live`): `api` · `admin` · `aliados` · `loans` · `originaciones` · `smartpay` · `uma` ·
  `backoffice` · `ws` `.creditop.com`.
- **DEV/STG/QA/Canary** (`alb-inertia-develop`), todos bajo `dev.creditop.com` salvo staging y canary:
  `dev` · `admin.dev` · `aliados.dev` · `originaciones.dev`, más
  **`originaciones-stg.dev.creditop.com`** y **`originaciones-qa.dev.creditop.com`** (los wizards de
  staging y QA), y `admin/aliados/api.staging.creditop.com` y `*.canary.creditop.com` para los monolitos
  viejos de esos ambientes.
- **Herramientas** (`alb-internal-tools`): `redash` · `metabase` · `playground` y sus hijos
  (`credibot`, `cuadrilla`, `canon`).

⚠ **`auth.creditop.com` sólo enruta `/auth/login` y `/auth/callback`** al `web-auth-service`; cualquier
otro path de ese host cae al default y da 403. Un 403 ahí no dice nada del servicio.

Y hay **dos ALB `internal`** (`alb-internal-develop`, `alb-internal-production`) que no exponen nada
públicamente.

### Cómo volver a comprobarlo (sin pedirle nada a nadie)

Desde la máquina de Miguel los nombres del cluster **resuelven y responden** (hay ruta a la VPC), así que
el documento se audita solo:

```sh
dscacheutil -q host -a name <servicio>.inertia-develop     # ¿existe el servicio?
curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}s\n' http://<servicio>.inertia-develop:<puerto>/
```

⚠ **Con control, siempre.** Un nombre inventado (`no-existe-este-servicio.inertia-develop`) **no resuelve**
y un puerto inventado da *cerrado*: si tu sonda no distingue esos dos casos, no está midiendo. Y `nc -z`
sólo prueba el TCP — `onboarding-forms-service` acepta conexión en 8089 **y** en 8092, pero el único que
habla HTTP es **8092**.

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

**(2026-08-28)** El pipeline de KYC del perfilamiento ganó **timeout por compuerta de datos: 2
horas** — la respuesta de negocio a «el cliente fue a buscar el desprendible»: suficiente para volver,
corto para que una solicitud abandonada no deje una corrida abierta indefinidamente
(`legacykycpipeline/workflow.go`). Y el monolito le sumó la ruta `abaco/sync-results` que empuja el
scraping pendiente (ver nodo motai). Verificado contra `main`.

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

## Lo que NO está verificado
- El workflow `internal/core/workflows/kyc/` de customer-profiling-service (distinto de `legacykycpipeline`): no se leyó.
