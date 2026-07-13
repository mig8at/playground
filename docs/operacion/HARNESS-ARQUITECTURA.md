# 🏗️ Arquitectura de los harness E2E — composer + estrategias

> Tool-specific (cómo están construidos los harness), pero **transversal** a backend-e2e y frontend-e2e.
> Para el *qué/por qué* del negocio (response_type, estados, IDs), ver [CREDITOP.md](../CREDITOP.md).

## Por qué este doc existe

Ambos harness modelan la misma realidad: la originación de Creditop es `[channel] → [merchant] → [lender]`,
y cada eje puede aportar comportamiento específico (Cognito en `/merchant/*`, auto-inyección de Quanto en
Pullman, sandbox de Bancolombia, etc.). En vez de duplicar el flujo por cada combinación posible,
**componemos** los tramos compartidos y enchufamos lo específico solo donde difiere.

Cuando descubras un **hallazgo nuevo** (un comercio con flujo distinto, un lender con cierre nuevo, un
canal nuevo), este doc te dice **dónde tocar** sin tener que rastrear todo el árbol.

---

## Modelo común: composer + estrategias

Ambos harness tienen las mismas dos piezas:

1. **Un runtime `Flow`** que numera pasos, imprime `[i/N] título · ↳ desc · ✓ detalle`, se detiene en el
   primer ✗, y soporta `--explain` (imprime el plan sin ejecutar).
   - Backend: [`backend-e2e/pkg/flow/flow.go`](../../backend-e2e/pkg/flow/flow.go)
   - Frontend: [`frontend-e2e/pkg/flow.ts`](../../frontend-e2e/pkg/flow.ts)

2. **Un composer** que arma el `Flow` concatenando los pasos de cada eje:
   - Backend: [`backend-e2e/main.go::runOne`](../../backend-e2e/main.go) (siempre estuvo así)
   - Frontend: [`frontend-e2e/pkg/composer.ts::composeFlow`](../../frontend-e2e/pkg/composer.ts) (añadido para emparejar al backend)

```
   ENTRADA (canal)            VERIFICACIÓN (comercio)       CIERRE (lender)
┌─────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────┐
│ AsesorSteps/WebSteps│ +  │  m.Verify(db, uReqID)   │ +  │  l.CloseSteps(...)  │
│  (channel package)  │    │  (merchant package)     │    │  (lender package)   │
└─────────────────────┘    └─────────────────────────┘    └─────────────────────┘
                                Flow.Add(...).Run()
```

---

## Backend (`backend-e2e/`)

### Resolución de ejes
- **Comercio:** [`merchant.Resolve(db, q)`](../../backend-e2e/merchant/merchant.go) acepta hash/slug/name/id;
  infiere `Kind` (Standard/Corbeta/Pullman/Motai/Ecommerce) leyendo BD (`inferKind`). **No hay matriz
  hardcodeada**: las reglas viven en datos (`allied_id`, `settings.corbeta_allieds`,
  `allied_ecommerce_credentials`).
- **Lender:** [`lender.Resolve(db, q)`](../../backend-e2e/lender/lender.go) acepta id/slug/name; el
  comportamiento se elige por **tabla de estrategias** (siguiente sección).
- **Canal:** un enum `Web` / `Asesor`. Cada canal expone `AsesorSteps`/`WebSteps` → `[]flow.Step`.

### Tabla de estrategias del lender
[`backend-e2e/lender/lender.go`](../../backend-e2e/lender/lender.go) tiene UNA tabla `strategies` que
centraliza TODO el dispatch por lender. Antes este switch se repetía en tres lugares (`CloseSteps`,
`flowSummary`, override de TestDoc en `runOne`); hoy vive en un solo sitio.

```go
var strategies = []strategy{
    {name: "motai",        matches: ..., summary: ..., closeFn: motaiClose, ...},
    {name: "credifamilia", matches: ..., summary: ..., closeFn: credifamiliaClose, ...},
    {name: "bancolombia",  matches: ..., summary: ..., docOverride: "1998228194", closeFn: bancolombiaClose, ...},
    {name: "revolving",    matches: l.ResponseType == 3, ..., closeFn: revolvingClose, ...},
    {name: "external",     matches: l.ResponseType == 1, ..., closeFn: externalClose, ...},
}
var creditopXDefault = strategy{... stepsFn: creditopXSteps} // fallback rt=2 in-platform
```

Tres métodos sobre `Lender` consultan la tabla:
- `l.Strategy()` — primer match (es la ÚNICA función con el switch).
- `l.Summary()` — texto de una línea para el banner.
- `l.ApplyOverrides(cfg)` — aplica overrides de cfg (ej. `TestDoc=1998228194` para Bancolombia).

### Si descubres un lender con cierre nuevo

1. Agregar la función de cierre en `lender/closes.go` (firma `func(db, cfg, uReqID, l) error` para
   estrategia monolítica, o `func(db, cfg, l) []flow.Step` para descomponerla en pasos como Creditop X).
2. Agregar una fila a `strategies` en `lender/lender.go` con `matches`, `summary`, `title`, `desc`, y
   `closeFn` (o `stepsFn`). Si el lender exige un doc específico para sandbox, poner `docOverride`.
3. Nada más. El CLI (`go run . asesor pullman <nuevo-lender>`), `--explain`, el banner y el override
   de cfg lo recogen automáticamente.

### Si descubres un comercio con comportamiento nuevo

1. Identificar qué dato de BD lo distingue (allied_id, setting, credencial, etc.).
2. Agregar el caso en `merchant.inferKind` que devuelve el nuevo `Kind`.
3. Agregar la rama correspondiente en `merchant.Verify` (qué se debe ver en BD tras la entrada).
4. Si el comercio cambia el wizard de entrada (ej. salta el laboral), reflejarlo en `Merchant.SkipLaboral()`
   / `NeedsPersonalInfo()` / `IsMotai()` (`merchant/merchant.go`) — `AsesorSteps` ya los consulta.

### Si descubres un canal nuevo

Hoy hay dos (`Web`, `Asesor`). Para un tercero: agregar constante en `channel.Channel`, escribir su
`XxxSteps(db, cfg, m, p) []flow.Step` en `channel/`, y agregar la rama en `runOne` (es la única función
con el dispatch web/asesor — está bien, son solo 2 casos).

---

## Frontend (`frontend-e2e/`)

### Autosuficiente en TS + flujo `make`
frontend-e2e hace sus ops contra la DB con `mysql2` e inyecta el KYC armado in-process (`pkg/inject`,
ya NO shellea a backend-mcp). Flujo principal: `make auto asesor|ecommerce <merchant> [preview] [local]`
(DEV por defecto, `local` opcional) → `bin/asesor` levanta el wizard, hace login Cognito / checkout, y en
`/personal-info` inyecta el KYC → `/lenders`. Specs sueltos: `make test [specs]` / `npx playwright test`.
Ops de DB puntuales: `node bin/dbops.ts <whois|assign|revoke|scrubphone|list|ecommerce-url|synth-fill>`.

### Composer
[`pkg/composer.ts`](../../frontend-e2e/pkg/composer.ts) — `composeFlow({merchant, page, partnerHash})` arma
el `Flow` ensamblando `channels[X]` + `wizards[Y]`. La pieza clave para el reuso es la matriz declarativa
`merchantSpecs`:

```ts
const merchantSpecs: Record<string, MerchantSpec> = {
    pullman:         { channel: 'self-service',     wizard: 'standard' },
    corbeta:         { channel: 'self-service',     wizard: 'standard' },
    credifamilia:    { channel: 'self-service',     wizard: 'standard' },
    'cupo-rotativo': { channel: 'self-service',     wizard: 'standard' },
    motai:           { channel: 'merchant-cognito', wizard: 'standard' },
};
```

Cuatro comercios comparten el wizard `standard`; Motai usa el mismo wizard con entrada distinta (Cognito).
SmartPay queda **fuera** del composer a propósito (wizard `request-*` distinto, vive en su propio spec).

### Pasos atómicos (sin duplicación)
[`pkg/wizard-steps.ts`](../../frontend-e2e/pkg/wizard-steps.ts) es el módulo HOJA con `fillAmountStep`,
`fillPhoneStep`, `fillOtpStep`, etc. Lo consumen TANTO el composer como `channel/steps.ts` (que existe
como aggregator de back-compat: re-exporta los `fillX` y deja `runHappyPathUntilLenders` como wrapper de
`composeFlow`). Una sola implementación del wizard standard, cero duplicación.

### Si descubres un comercio con flujo conocido (mismo wizard que otro)

Una fila en `merchantSpecs` apuntando al preset que comparte:
```ts
'mi-comercio-nuevo': { channel: 'self-service', wizard: 'standard' },
```
(Para el flujo DEV/asesor, cacheá su `branch_hash` en `.flows.json` — `bin/asesor` lo resuelve en dev y lo
guarda solo la primera vez.)

### Si descubres un comercio con wizard distinto

1. Si el wizard solo cambia en algunos pasos: definirlo como wizard nuevo en `wizards` de
   `pkg/composer.ts` (usa los `fillX` atómicos de `pkg/wizard-steps.ts` como bloques).
2. Si el wizard es radicalmente distinto (ej. SmartPay), mantenlo **fuera del composer** — un spec
   dedicado con su propio `new Flow(...).step(...).step(...).run()`. La composición declarativa no es la
   herramienta correcta para flujos que no comparten pantallas.

### Si descubres un canal nuevo

1. Agregar key en `ChannelKey` (TS literal type).
2. Agregar entry en `channels` con sus pasos atómicos (ej. handshake checkout para `ecommerce-checkout`).
3. Si algún comercio lo usa, apuntarlo desde `merchantSpecs`.

### Cuándo NO usar el composer

- El test es una sola aserción (POST único, validación de contrato). El runtime `Flow` agrega ruido.
  Mejor un `test()` plano con assertions directas.
- El test es una batería de aserciones independientes con `test()`s separados (`channel/otp-subcodes.spec.ts`,
  `channel/kyc-subcodes.spec.ts`). Cada `test()` ya es la unidad mínima — no envolverlos.

---

## Narración en consola (cómo se ve)

Ambos harness imprimen lo mismo:

```
======================================================================
 asesor → pullman → credipullman
======================================================================
  Creditop X rt=2: originación in-platform hasta Estado 11 (Autorizada)

[1/8] Registro + políticas de datos
  ↳ Entra por el asesor: registra el celular y acepta términos/tratamiento de datos.
  ✓ celular registrado · OTP en modo bypass (últimos 4 dígitos)
...
🟢 FLUJO OK · 8/8 pasos · 12.3s
```

Con `--explain` (backend) o `--explain` del CLI dinámico (frontend), imprime SOLO los títulos y
descripciones de cada paso, sin tocar BD/navegador. Útil para auditar el plan antes de correrlo.

---

## Checklist al agregar un hallazgo

- [ ] ¿Es un **comercio** con flujo conocido? → fila en `merchantSpecs` (FE) o caso en `inferKind` (BE).
- [ ] ¿Es un **comercio** con flujo nuevo? → preset nuevo en `wizards` (FE) o `m.Verify` (BE).
- [ ] ¿Es un **lender** con cierre nuevo? → entrada en `strategies` (BE) + función en `closes.go`.
- [ ] ¿Es un **canal** nuevo? → entry en `channels` (FE) o `channel/<name>.go` (BE).
- [ ] ¿La narración paso-a-paso sigue legible? Correr con `--explain` antes de ejecutar.
- [ ] ¿Algún número/ID hardcodeado nuevo? Catalogarlo en
      [`LOGICA-QUEMADA.md`](../codigo/LOGICA-QUEMADA.md).
- [ ] ¿Algún `error_code` o sufijo descriptivo (subcódigo) nuevo? Sumarlo a la tabla de
      [`REFERENCIA-FLUJOS.md`](../codigo/REFERENCIA-FLUJOS.md) §13 y al catálogo TS
      `frontend-e2e/pkg/config.ts::expectedSubcodes`. Distinguir: `error_code` (ONBnnn = qué paso,
      sirve al routing del FE) vs sufijo (CODE_EXPIRED, EXPEDITION_DATE_INVALID, … = la causa, sirve
      a mensajes/observability). El backend real SÍ emite `error_subcode`, pero **anidado** bajo la
      clave `errors` (`errors.error_subcode`) — OtpService.php:181,203,256,781;
      OnboardingController.php:1097-1099,674-681,780-792; ApiResponse.php:44. Lo que era del mock muerto
      es el shape **top-level** `error_subcode` (fuera de `errors`), no el anidado.
- [ ] ¿Algún comportamiento de negocio nuevo? Documentar en
      [`REFERENCIA-FLUJOS.md`](../codigo/REFERENCIA-FLUJOS.md) (mecánica del flujo) y, si corresponde, en
      [`CREDITOP.md`](../CREDITOP.md) (qué/por qué).
