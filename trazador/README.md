# sonda

**¿Puedo leer los logs que CreditOp empuja a Loki, desde acá, ahora?** Una sola pregunta, contestada
corriendo. No escribe nada: solo `GET`.

```bash
make sonda-loki
```

## Por qué existe

Porque "¿ya tengo acceso?" no se contesta con un 200. Un token de Grafana Cloud puede autenticar
perfecto y no servir para nada: si la access policy quedó en el realm equivocado, `/labels` devuelve
**200 con la lista vacía** y `query_range` devuelve **cero streams**. Desde afuera los dos casos se leen
igual —"no hay logs"— y son problemas distintos: uno se **pide**, el otro se arregla **mirando otra
ventana de tiempo**. La sonda separa las preguntas y dice en cuál se cayó:

| | |
|---|---|
| 1 | ¿el token es válido y qué permisos trae? — `grafana.com/api`, **sin** necesitar URL ni ID |
| 2 | ¿autentica contra Loki? — `GET /loki/api/v1/labels` |
| 3 | ¿aparecen las etiquetas de CreditOp? — `GET /loki/api/v1/label/<x>/values` |
| 4 | ¿puedo leer líneas de verdad? — `GET /loki/api/v1/query_range` |

El paso 1 es el que más rinde y el que nadie hace: los scopes del token se averiguan **antes** de tener
la URL. Se pide un endpoint que exige `accesspolicies:read` y, si el token no lo tiene, el 401 llega con
la lista de lo que **sí** tiene (`received [logs:read]`). Un error que trae adentro el dato que buscabas.
Eso separa de entrada *"el token está mal emitido"* de *"el token está bien y me falta un dato de
conexión"* — que es la diferencia entre volver a molestar a quien lo emitió o pedirle una sola cosa.

## Configuración

**Un archivo por STACK, no por rama** — el nombre del target dice a qué Grafana le hablás:

| target | stack | `User` | estado |
|---|---|---|---|
| `prod` (default) | `creditop.grafana.net` | `1339721` | ✅ confirmado 2026-08-04 |
| `dev` | `creditopdev.grafana.net` | `1339770` | ✅ confirmado 2026-08-04 |

**Misma URL (`logs-prod-036`) y mismo token para los dos** — los dos stacks viven en la misma región. Lo
único que cambia es el `User`, que es **por stack**. Y `creditopdev` sirve **dev y qa a la vez**: ver abajo.

Copiá `.env.prod.example` al target que necesites (gitignoreado) y completá. **Lo único obligatorio es el
token**: la URL se deduce de la región que el token trae codificada adentro, y cuando la sonda acierta
imprime la línea exacta para pegar. Cada archivo es **autosuficiente**: no hay capa compartida (el
`playground/.env` donde vivía el token se eliminó el 2026-08-04 y su contenido pasó a `sonda/.env.prod`).
Se aceptan además los nombres `GRAFANA_LOKI_*` que usa legacy-backend, para pegar las variables del deploy
tal como están.

```bash
go run .                                  # el chequeo completo contra prod
go run . -target dev                      # contra creditopdev, cuando exista .env.dev
go run . -query '{service_name="legacy-backend"}'   # forzar un selector en vez de descubrirlo
go run . -since 24h -limit 50             # ventana y cantidad
```

## Qué etiquetas busca

Las que **de verdad** escribe el backend, no las que uno supondría. Según
`legacy-backend/config/grafana.php` y `app/Logging/LokiHandler.php`:

- `app` — `GRAFANA_TEMPO_SERVICE_NAME`, default `creditop-api`
- `environment` — `APP_ENV`
- `level`, `channel`, y opcionalmente `lender`, `provider`, `trace_id`, `span_id`

La línea es un JSON `{message, context, extra}`; la sonda saca `message` para que se lea. Si no encuentra
ninguna etiqueta con pinta de CreditOp, cae a la primera de baja cardinalidad para al menos probar que la
lectura funciona.

## Tres trampas que esta sonda ya pagó

Están acá porque cada una cuesta media hora la primera vez, y las tres **mienten sobre su causa**:

1. **Un Bearer pelado nunca funciona contra Grafana Cloud Loki.** Devuelve `legacy auth cannot be
   upgraded because the host is not found`, que suena a URL equivocada — y no lo es: el mensaje es
   **idéntico en los 25 hosts reales** de Loki. Es el gateway pidiendo el par `<ID de instancia>:<token>`.
   Con basic-auth el error cambia a `invalid authentication credentials`, o sea que ahí sí parseó el par.
   **Esa diferencia de mensajes es el diagnóstico**, y es lo que separa "token inválido" de "falta el ID".
2. **`*.grafana.net` tiene un CNAME comodín.** Un hostname inventado resuelve igual que uno real y
   después devuelve `530 / error 1016`, que se lee como "Grafana está caída". Los hosts reales tienen
   registro A propio; los falsos heredan el comodín. Por eso el DNS se chequea **antes** de pegarle.
3. **La región del token no es el hostname.** `prod-us-east-0` es una región *legacy* y su Loki es
   `logs-prod3.grafana.net` — no `logs-prod-us-east-0`, no `logs-prod-006`.

## Estado: acceso CONFIRMADO (2026-08-04)

Lectura verificada corriendo: 200, etiquetas resueltas y líneas devueltas.

```
LOKI_URL=https://logs-prod-036.grafana.net
LOKI_USER=1339721
```

El token es el `glc_` de la access policy `custom-tool-logs-reader` (org `1493278`, región
`prod-us-east-0`), y vive en `playground/.env` como `LOKY`. El UUID que también llegó por Slack
(`4e043b4f-…`) **no sirve para nada**: grafana.com no lo reconoce como token y como `X-Scope-OrgID` se
ignora.

Dos cosas que se descartaron **midiendo**, no opinando:

- **No era la VPN.** Con el túnel activo (`utun4`, salida `3.151.190.239`) el error era idéntico. El
  fallo estaba en la capa de autenticación, no en la red — un bloqueo por IP allowlist da 403 con otro
  mensaje.
- **El host no era deducible.** `logs-prod-036` no se puede derivar de la región del token; hay que
  pedirlo. Barrer `logs-prod-0NN` tampoco alcanzó: el barrido llegó hasta 030.

### El ambiente es el STACK, y `creditopdev` trae cuatro

En `creditop` (prod) `environment` tiene **un único valor**: `production`. Los otros ambientes viven en
`creditopdev`, y ahí sí hay varios — medido en 30 días:

| `environment` | quién | sirve al target |
|---|---|---|
| `development` (+ `develop`) | `legacy-backend` y los 14 microservicios Go | **dev** |
| `qa` | **`legacy-backend-stg`** | **staging** |
| `local` | `CreditopDev` — una máquina de desarrollo empujando | (ver abajo) |
| `testing` | `CreditopDev` | — |

⚠ **Dev y staging comparten el stack Y la base de datos.** O sea que el mismo `user_request_id` tiene
líneas de las **dos ramas de código** (`legacy-backend` en `develop` y `legacy-backend-stg` en `qa`). Sin
filtrar por `environment` estás mirando dos ramas mezcladas — la misma trampa que ya costó corridas
creyendo que un feature estaba roto. Por eso `E2E_LOKI_ENV` en el harness **no es opcional**.

⚠ Ojo con `develop` vs `development`: `web-auth-service` usa la primera y el resto la segunda. Un filtro
exacto por `development` lo deja afuera; de ahí que el valor sea una alternativa de regex.

💡 **`local` existe**, lo cual quiere decir que el camino rápido del harness **sí se puede observar**: no
hace falta Loki en Docker, alcanza con poner `GRAFANA_LOKI_ENABLED=true` y estas credenciales en el `.env`
del legacy-backend local. Eso desmiente lo que parecía un callejón sin salida.

### Qué hay adentro

13 servicios en `service_name`: `legacy-backend`, `legacy-application`, `preapprovals-service`,
`form-service`, `onboarding-forms-service`, `pdf-mapper-service`, `merchant-api`,
`merchant-gateways-service`, `customer-profiling-service`, `financial-health-service`, `otp-service`,
`reportery-service`, `self-manager-api`.

Y las etiquetas que hacen esto útil para una tarea: **`lender`** (`bancolombia`, `bancolombia_bnpl`, `ado`,
`welli`, `deceval`, `device_locking`, `139`, `160`, `163`), **`provider`** (`netco`) y **`trace_id` /
`span_id`**, que permiten seguir una solicitud entera cruzando servicios:

```bash
go run . -query '{service_name="legacy-backend", lender="bancolombia"}' -since 6h
go run . -query '{trace_id="788912dc72ce8af65d6b2b2fa8a5ac1a"}' -since 24h
```

## Cómo consultar sin pisar las dos minas

Dos hallazgos medidos el 2026-08-04 que cambian cómo se escribe una query acá:

**1. Filtrá por `service_name`, no por `environment`.** Conviven dos convenciones de etiqueta y son
**excluyentes**, así que filtrar por una descarta la otra mitad de la flota **en silencio**:

| selector | qué devuelve |
|---|---|
| `{environment="production"}` | **solo 2**: `legacy-backend`, `legacy-application` (convención Laravel, `LokiHandler`) |
| `{deployment_environment="production"}` | **los 13** microservicios Go (convención OTel) |
| `{service_name="..."}` | **funciona para los 15** — es la única etiqueta universal |

**2. Nunca consultes el lado Laravel sin acotar.** `LokiHandler.php` promueve **`trace_id` y `span_id` a
etiquetas**, y en Loki cada valor distinto crea un stream nuevo: son 959 streams cada 15 minutos. Un
`{environment="production"}` a 30 días devolvió **14,5 MB de series y expiró** a los 45 s. Del lado Go no
pasa porque no ponen el trace en etiquetas.

O sea: agregá siempre `service_name` (y si podés `lender`) y una ventana corta. El `trace_id` sirve
perfecto como filtro **puntual** — `{trace_id="..."}` es barato y es la mejor forma de seguir una
solicitud cruzando servicios; lo caro es *enumerarlos*.

## El ambiente NO es una etiqueta, es el stack

`environment` y `deployment_environment` tienen **un solo valor** (`production`): filtrar por ellas no
discrimina nada. La separación de ambientes está a nivel de **stack** de Grafana Cloud, y hay dos —
`creditop.grafana.net` y **`creditopdev.grafana.net`** (verificado: los dos vivos, Grafana Enterprise
13.2.0, misma región). Cambiar de ambiente es apuntar la sonda a otro stack, no agregar un matcher.

Para sumar dev, lo barato es **agregar `creditopdev` a los Realms de la access policy que ya existe** (el
campo acepta varios) en vez de emitir un segundo token, y capturar su par `URL` + `User` en Details → Loki.
⚠ **El `User` es distinto por stack** aunque la URL puede repetirse — asumir que se reusa da
`invalid authentication credentials` y parece un token roto.
