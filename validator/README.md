# validator — herramienta de carga y observabilidad

> 📚 Contexto de negocio de Creditop: docs maestros en [`../docs/`](../docs/). Este README es tool-specific.

Pequeña herramienta en Go (solo stdlib) que dispara un **mix realista de peticiones**
contra un microservicio para *hacer reaccionar* su dashboard de Grafana y observar
cómo se comporta (throughput, status codes, latencia, errores).

Cada microservicio es **autocontenido**: su generador de tráfico (con SUS endpoints),
su dashboard de Grafana y sus scripts de validación viven en su carpeta. El motor de
carga (mecánica común) se comparte en `internal/engine`.

```
validator/
├── go.mod
├── README.md
├── internal/engine/            motor genérico de carga (compartido, no cambia)
│   └── engine.go
└── <servicio>/                 todo lo de ESTE servicio
    ├── .env                    URL por defecto (VALIDATOR_URL), embebida en el binario
    ├── main.go                 endpoints propios -> engine.Run(...)
    ├── observability/          dashboards de Grafana (JSON para importar)
    │   └── grafana-dashboard.json
    └── validation/             scripts de validación
        └── loki-check.sh        valida conexión a Loki y confirma el tráfico
```

### Agregar otro proyecto

1. Crea `validator/<otro-servicio>/main.go`:
   ```go
   package main
   import "validator/internal/engine"
   func main() {
       engine.Run(engine.Options{
           DefaultURL: "http://<otro-servicio>.inertia-develop:8080",
           Scenarios: []engine.Scenario{
               {Name: "health 200", Method: "GET", Path: "/health", Weight: 40},
               // ...los endpoints de ESE servicio...
           },
       })
   }
   ```
2. (Opcional) agrega su `observability/` y `validation/`.
3. Córrelo con `go run ./<otro-servicio>`.

## Uso

La URL de dev ya está en `pdf-mapper-service/.env`, así que el comando es directo:

```bash
cd validator

# Genera el mix de peticiones contra DEV por 5 min -> míralo en tiempo real en Grafana
go run ./pdf-mapper-service --duration 5m
```

Eso dispara solo (sin pasar URL) las diversas solicitudes (2xx/4xx/400/500 + latencia)
y hace reaccionar el dashboard. Overrides opcionales:

```bash
go run ./pdf-mapper-service --duration 5m --rate 20         # más carga
go run ./pdf-mapper-service --duration 3m --external        # incluye merge-urls real (latencia)
go run ./pdf-mapper-service --url http://localhost:8080     # contra local (no reacciona Grafana)
```

> La URL por defecto (en `.env`) apunta a **dev**, que es donde los logs llegan a Grafana
> Cloud. Apuntar a tu local no mueve las gráficas (tu máquina no exporta a Grafana Cloud).

## Flags

| Flag | Default | Descripción |
| :--- | :--- | :--- |
| `--url` | `VALIDATOR_URL` del `.env` | URL base. Prioridad: `--url` > env `VALIDATOR_URL` > `.env` > fallback. |
| `--rate` | `8` | Peticiones por segundo (global). |
| `--duration` | `2m` | Duración total (`90s`, `5m`, `1h`…). Termina solo, o con `Ctrl-C`. |
| `--concurrency` | `12` | Workers concurrentes (para que las llamadas lentas no bloqueen el ritmo). |
| `--external` | `false` | Incluye el escenario `merge-urls` que descarga URLs **reales** (PDF+imagen) → 200 con latencia alta. Requiere egress a internet desde el servicio. |

## Mix de escenarios

Pesos relativos; producen variedad de `status_code`, `method`, `path` y latencia:

| Escenario | Resultado esperado |
| :--- | :--- |
| `GET /health`, `/api/projects`, `…/documents`, `…/status` | **2xx** |
| `GET …/missing/template`, `…/missing/mapper` | **404** |
| `GET /api/fields` | 200 o 404 (según exista el catálogo) |
| `POST /api/merge-urls` con JSON inválido / `urls` vacío | **400** |
| `POST /api/merge-urls` con URL no alcanzable (`127.0.0.1:9`) | **500** (rápido) |
| `POST /api/merge-urls` con PDF+imagen reales (`--external`) | **200**, latencia alta |

## Salida

En vivo (se actualiza cada segundo) y un resumen al final:

```text
[    42s] total=336    8.0 req/s | 2xx=300 4xx=28 5xx=8 err=0 | avg=37ms
──────────────────────────────────────────────
Resumen
  Total peticiones : 336
  2xx=300  3xx=0  4xx=28  5xx=8  transport-err=0
  Latencia media   : 37 ms
  Por status_code: 200/400/404/500…
  Por escenario:   conteo por cada tipo
```

## Validación en Loki

Tras generar tráfico, confirma desde terminal que llegó a Loki:

```bash
export LOKI_URL="https://logs-prod-XX.grafana.net"
export LOKI_USER="<instance-id>"
export LOKI_TOKEN="<access-policy-token con logs:read>"

./pdf-mapper-service/validation/loki-check.sh
```

Valida la conexión, cuenta las peticiones del servicio y muestra el desglose por
`status_code`. Variables opcionales: `SERVICE` (default `pdf-mapper-service`), `RANGE` (default `1h`).

## Dashboards de Grafana

Importa `pdf-mapper-service/observability/grafana-dashboard.json` en Grafana
(**Dashboards → New → Import → Upload JSON**) y elige el datasource Loki. Las queries
usan structured metadata de los logs OTLP (sin `| json`) y ventanas `[5m]`/`[$__range]`.
