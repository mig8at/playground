# backend-e2e — tests E2E de la originación de crédito (Go, sin UI)

> 🔒 **Repo LOCAL. Nunca se pushea.** Repo git solo para versionado local de estas herramientas;
> sin remoto, no debe subirse a ningún origin.

**Motor de tests automatizados** en Go que ejerce la **originación de crédito** de Creditop a nivel
backend (sin navegador): compone `[canal] → [comercio] → [lender]` y corre el flujo end-to-end contra el
**`legacy-backend`**. Es el par "backend" de [`../frontend-e2e`](../frontend-e2e/README.md) (Playwright,
mismo stack desde la UI del wizard).

**Target:** **local por defecto** (legacy en Docker, proveedores externos en `fake`) o **dev compartido**
con `--target=dev` (solo read-only + `create`/`clean`; ver [`DEV-TARGET.md`](DEV-TARGET.md)). El perfil
aprobado se arma por **inyección** (seed vía tinker), no llamando centrales — el KYC real y las rutas con
mocks fake (`negative`) se **retiraron**.

## 📖 Contexto de negocio → docs maestros en [`../docs/`](../docs/)
El conocimiento de negocio/dominio (qué es Creditop, flujos, hardcodes, modelo de datos) vive en los **docs
maestros** compartidos: empieza por **[`../docs/NEGOCIO.md`](../docs/NEGOCIO.md)**, luego
[`../docs/REFERENCIA-FLUJOS.md`](../docs/REFERENCIA-FLUJOS.md) · [`../docs/CASOS-ESPECIALES.md`](../docs/CASOS-ESPECIALES.md) ·
[`../docs/LOGICA-QUEMADA.md`](../docs/LOGICA-QUEMADA.md) · [`../docs/MAPA-FLUJOS.md`](../docs/MAPA-FLUJOS.md) ·
[`../docs/MODELO-DATOS.md`](../docs/MODELO-DATOS.md). Índice: [`../docs/README.md`](../docs/README.md).

Para la taxonomía `response_type` (0=UTM · 1=Integración · 2=Creditop X · 3=Cupo Rotativo · 4=Credifamilia
async) y el ciclo de vida de estados, **ver [`../docs/NEGOCIO.md`](../docs/NEGOCIO.md)** (dueño). Todos los
IDs/montos/magic numbers hardcodeados que aparecen abajo viven catalogados en
[`../docs/LOGICA-QUEMADA.md`](../docs/LOGICA-QUEMADA.md).

Este README es la **portada del harness**. El detalle operativo se reparte así:
- **[`SUITE.md`](SUITE.md)** — CLI completo (todos los subcomandos, defaults, ejemplos por eje). Fuente única.
- **[`VALIDATION.md`](VALIDATION.md)** — estado de validación del backend (qué flujos pasan, bloqueadores).
- **[`DEV-TARGET.md`](DEV-TARGET.md)** — correr contra el **dev compartido** (`--target=dev`): habilitado en
  read-only (`list`/`get`/`doctor`/`login`) + `create`/`clean` (namespaced, con guard I_KNOW); el flujo
  completo sigue gated. Leer las guardas antes de tocar dev.

## Modelo: `[channel] → [merchant] → [lender]`
Un solo módulo Go (`creditop-tests`) organizado por los **tres ejes** de la originación. Un CLI compone
y corre cualquier combinación al vuelo.

```bash
go run . web pullman credipullman      # canal → comercio → lender
go run . asesor 3e67eade 77,95         # lista de lenders = matriz multi-lender (ambos rt=2)
```

`web`/`asesor` es el **canal** (primer argumento posicional); el resto es comercio + lender(s). El CLI
expone además los subcomandos `list`, `offer`, `random`, `smartpay`, `perfilador`, `setup`
y los de **operación** `prep` / `get` / `doctor` / `clean` — documentados en [`SUITE.md`](SUITE.md). Sin
argumentos (o con `help`/`-h`) imprime el uso.

### Comandos de operación + `scripts/flow.sh`

Además del flujo, el harness expone subcomandos de **operación** (antes vivían en el extinto
`creditop-cli`; ahora son nativos en Go y reusan `merchant.Resolve`/`lender.Resolve`/`database`):

- `go run . prep --merchant X --lender Y [--asesor n] [--branch h]` — siembra precondicionales (branch +
  oferta en `lenders_by_allieds` + credencial si aplica + asesor sintético namespaced por seed). Exporta
  `E2E_*` por stdout para `eval`; resumen humano por stderr.
- `go run . get <user-request|merchant|lender> <arg> [--json]` — inspector read-only (kubectl get / gh pr view).
- `go run . doctor [--json]` — diagnóstico del setup local (8 checks con fix inline).
- `go run . clean [--seed X]` — borra el namespace que sembró `prep` (seguro: solo el marcador del seed).

Para un E2E completo con **precondicionales sembrados + snapshot del resultado**, `scripts/flow.sh`
orquesta `prep` → flujo → `get` (→ `clean` opcional). Ya **no requiere `npm link`** (solo Go):

```bash
# desde backend-e2e/:
./scripts/flow.sh pullman credipullman --branch=3e67eade

# salida (resumida):
▶ Verificando setup...
▶ Sembrando precondicionales...
  ✓ E2E_PARTNER_HASH=e9409aff · E2E_LENDER_ID=77 · E2E_COGNITO_ID=comercial__<seed>_test
▶ Corriendo backend-e2e: asesor e9409aff 77
  [9/9] Autorización → Estado 11 · ✓ user_request #464135 → Estado 11 (Autorizada)
🟢 FLUJO OK · 9/9 pasos · 12.7s

▶ Snapshot del user_request resultante:
USER REQUEST #464135
  Cliente:  TEST CREDITOP · Lender: CrediPullman (#77, rt=2)
  Estado:   11 (Autorizada) · Creada: 13s
```

Argumentos:
- `<merchant>` — alias/id/hash del comercio (ej. `pullman`, `94`, `3e67eade`).
- `<lender>` — alias/id del lender (ej. `credipullman`, `77`).
- `--branch=<hash>` — branch específico (default: primer branch activo).
- `--clean` — limpia el namespace del seed tras correr (`go run . clean`).

Lo que el script hace internamente:
1. **`go run . doctor`** (silencioso) — health check del setup; advierte si falla pero no bloquea.
2. **`go run . prep --merchant X --lender Y`** — siembra y exporta `E2E_PARTNER_HASH`, `E2E_LENDER_ID`, `E2E_COGNITO_ID`, etc.
3. **`go run . asesor $E2E_PARTNER_HASH $E2E_LENDER_ID`** — ejecuta el flujo end-to-end.
4. **`go run . get user-request <id>`** — extrae el `user_request_id` del output y muestra el snapshot final.

| Paquete | Eje | Qué hace |
|---|---|---|
| [`channel/`](channel/) | **canal** | cómo entra el flujo: `web` (ecommerce base64) · `asesor` (register→otp→personal→laboral) |
| [`merchant/`](merchant/) | **comercio** | resuelve la branch desde la BD, infiere su tipo (corbeta/pullman/motai/ecommerce) y verifica su comportamiento |
| [`lender/`](lender/) | **lender** | resuelve el lender y despacha el cierre: Creditop X in-platform, cupo rotativo, Motai IMEI, Bancolombia, Credifamilia |
| `pkg/` | infra | `client` (HTTP), `config`, `database` (mysql TCP + migraciones), `mocks` (seed/bypass vía tinker) |

Comercio y lender se resuelven **por nombre/slug/hash/id desde la BD** — nada hardcodeado en ese paso
(`merchant.Resolve` / `lender.Resolve`). El dispatch de cierre del lender (Motai/Credifamilia/Bancolombia/
revolving/external vs. Creditop X default) vive en UNA tabla `strategies` en
[`lender/lender.go`](lender/lender.go). **Para agregar un lender / comercio / canal nuevo**, ver
[`../docs/HARNESS-ARQUITECTURA.md`](../docs/HARNESS-ARQUITECTURA.md) (checklist de extensión, espejado con
frontend-e2e).

### El modo `random` y por qué "fallan" algunas tripletas
`random N` elige merchant aleatorio → lender **asociado en `lenders_by_allieds`**, filtrando a los lenders
con cierre montado: `response_type IN (2,3)` **o** `id IN (24,68,100)` — es decir, **2** (in-platform),
**3** (cupo rotativo), **24** (Credifamilia, único rt=4), **68/100** (Bancolombia)
(`main.go:466`). Luego elige canal compatible (web si el branch es ecommerce) y corre el E2E.
Los ❌ revelan **gaps de config** de combinaciones válidas (categoría/branch-association faltante), no
errores del harness. La clasificación de fallos vive en
[`../docs/CASOS-ESPECIALES.md`](../docs/CASOS-ESPECIALES.md).

## Conexión: LOCAL por defecto (hardcodeada) · DEV vía `.env.dev`
Por defecto (`--target` ausente o `local`) la conexión está hardcodeada en
[`pkg/config/config.go`](pkg/config/config.go) (`GetConfig("local")`) + [`pkg/client/client.go`](pkg/client/client.go),
apuntando al stack local de Docker (Sail) — sin `.env`. Con **`--target=dev`** lee `E2E_DB_*`/`E2E_API_BASE_URL`
de [`.env.dev`](.env.dev) (gitignored) y exige `I_KNOW_THIS_TOUCHES_SHARED_DEV=1` para los WRITE.

- **BD:** contenedor `legacy-backend-mysql-1`, esquema `creditop`, usuario **`creditop`** / `password`,
  expuesto en `127.0.0.1:3306`, vía el driver mysql por TCP (`config.go:12`).
- **API:** base URL **`http://127.0.0.1:80/api`** (`config.go:13`), con vhost
  `legacy-backend.inertia-develop` aplicado por header `Host` (`client.go:24`).
- **BackdoorAPIKey:** `gKz9fG25ylWZmB7lfrH13F8CVZDuBBG2` (`config.go:18`) — debe coincidir con
  `BACKDOOR_API_KEY` del `.env` del backend; prerequisito para el flujo `smartpay`.

Consulta directa a la BD local:
```bash
docker exec legacy-backend-mysql-1 mysql -ucreditop -ppassword creditop -e "SQL"
```

## Modo mock del legacy-backend (recursos externos en fake)
```bash
cd ../../github/legacy-backend && make up && make mock-all && make restart
```
Matriz de drivers + `.env.mock` (hosts/credenciales dummy) en `github/legacy-backend/docs/local-dev.md`.

Notas operativas:
- **OTP de onboarding:** valida con cualquier código (driver fake) **salvo** si el teléfono está en el
  setting `qa_otp_bypass_phones` (entonces el código son los **últimos 4 dígitos** del teléfono — el
  harness usa ese bypass para que el OTP del pagaré no pegue a Twilio).
- **Bypasses ya aplicados:** los bypasses del legacy-backend (incluido el fake de `PdfMapper` que el cierre
  Creditop X necesita) **ya están aplicados al working tree** de `legacy-backend` — no hay que aplicar
  nada para correr los flujos de cierre. Si necesitas reaplicarlos desde un árbol limpio, los stashes
  relevantes son `stash@{0}` (SmartPay forms-service FAKE) y `stash@{1}` (cierre Creditop X / fake
  pdf-mapper). El procedimiento detallado vive en [`SUITE.md`](SUITE.md).

> El viejo `mock-server` (`validation-driven`, :4000) fue **eliminado** — superado por este modo mock,
> que ejerce el backend PHP real en vez de una reimplementación en TS. El header `DEV_SESSION` /
> `X-Dev-Session` también es obsoleto.
