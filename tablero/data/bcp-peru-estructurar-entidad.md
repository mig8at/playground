---
id: 45
title: "BCP Perú — estructurar la entidad para el flujo de registro"
stage: evaluation
created: "2026-08-10T09:00:00-05:00"
context_nodes: [entities, hardcodes-entidades, aggregator, onboarding, merchants, negocio, ms-preapprovals, dynamic-forms]
jira: [CORE-399]
jira_title: "Estructurar BCP para el flujo de registro"
---

# BCP Perú — estructurar la entidad
> **estado:** 🔎 en evaluación — bajada de Jira el 2026-08-10. Nada implementado, sin rama.
>
> Es el gemelo de lo que hicimos con **comercios** (el mapa del operador de `merchants` §9), pero del lado
> de las **entidades**: qué hay que tocar, y en qué orden, para que una entidad nueva exista de verdad.
> BCP es el caso más duro posible porque estrena **tres cosas a la vez**: un país nuevo (Perú), un
> producto nuevo (vehicular) y un patrón de integración nuevo (simulador embebido del banco).

## Contextos que usa
- **entities** — qué ES una entidad como dato: la fila `lenders`, las ~46 tablas satélite y el
  `response_type` que despacha todo. Es la base del checklist.
- **hardcodes-entidades** — los 24 acoplamientos por id que hacen que integrar una entidad cueste
  código. Leerlo ANTES de proponer cómo entra BCP, para no sumar el 25.º.
- **aggregator** — si BCP decide afuera (banco), cae en `response_type=1`: pre-aprobación, handoff y
  webhook. La maquinaria genérica está ahí.
- **onboarding** — el tramo que las historias del épico describen (inicio, OTP, captura de datos).
- **merchants** — el par (comercio, entidad) es quien decide la conducta (F-34), y la credencial del par
  es la que hace que la integración se invoque.
- **negocio** — de qué lado cobra CreditOp con un banco: al comercio Y a la entidad, y le entrega el
  perfil enriquecido. Eso define qué tiene que hacer la pre-aprobación acá.
- **ms-preapprovals** — el patrón para un lender que decide por API externa.
- **dynamic-forms** — la captura de datos del vehículo va por formulario configurable (CORE-400 es de José).

## El épico: BCP es un flujo VEHICULAR, no un crédito de consumo más
`CORE-331 · BCP` (épico, sin descripción) tiene **13 historias**, todas en Por Hacer y **todas con la
descripción vacía**. Leídas en orden, describen el flujo que hay que construir:

| Jira | Historia | Dueño |
|---|---|---|
| CORE-332 | Inicio de solicitud y selección de flujo | — |
| CORE-333 | Verificación por OTP | — |
| CORE-334 | **Consulta de preaprobado en el simulador BCP (embebido)** | — |
| CORE-335 | Captura de datos del **vehículo** para la simulación | — |
| CORE-336 | **Gate de preaprobado (decisión del asesor)** | — |
| CORE-337 | Captura de datos del cliente (identidad) | — |
| CORE-338 | Captura de datos finales del vehículo | — |
| CORE-339 | Generación y envío del **link de pago** | — |
| CORE-340 | Recepción del resultado y estados de la transacción | — |
| CORE-341 | Administrador para el comercio | — |
| **CORE-399** | **Estructurar BCP para el flujo de registro** | **Miguel** |
| CORE-400 | Formularios dinámicos para BCP | José |
| CORE-401 | Permitir a un comercio elegir flujo vehicular | José |

**Lo que esa lista implica** (y que ninguna historia dice, porque están vacías):
- **BCP decide, no CreditOp** — hay un «simulador BCP embebido» y un «gate de preaprobado». Eso es
  `response_type = 1` (agregador), no CreditopX.
- **Hay un actor que no existe en el modelo actual: el VEHÍCULO.** Dos historias capturan sus datos, y
  la simulación depende de ellos. Hoy `user_requests` no tiene noción de vehículo salvo el IMEI de
  SmartPay y el renting de Motai (`lenders.product`).
- **El gate lo decide el ASESOR**, no el sistema. Eso es un paso humano en medio del flujo.
- **El cobro va por link de pago**, no por la cuota inicial del wizard.

## Lo MEDIDO: el punto de partida (2026-08-10)

### BCP no existe en ninguna parte
`grep -rliE "BCP|Peru|vehicul"` sobre `legacy-backend/app` y `Modules/` → **cero archivos**. No hay
Action, ni credencial, ni fila de lender, ni configuración. Es greenfield.

### Perú SÍ existe como país, pero incompleto — y la comparación es el checklist
Fila `countries.id = 167`, `status = 1`. Contra los dos países que hoy funcionan:

| campo | Colombia (47) | RD (60) | **Perú (167)** |
|---|---|---|---|
| `dial_code` | `57` | `1` | **vacío** |
| `phone_code` | `+57` | `+1` | **NULL** |
| `cell_phone_lenght` | `10` | `10` | **vacío** |
| `nationality` | `COLOMBIANA` | `DOMINICANA` | **NULL** |
| `locale` | `es-CO` | `es-DO` | **`es_PE`** ⚠ |
| `currency` | `COP` | `DOP` | `PEN` ✓ |
| `iso_code_1/2` | `CO`/`COL` | `DO`/`DOM` | `PE`/`PER` ✓ |
| zonas · ciudades | 36 · 1.123 | 32 · 8 | **25 · 0** |

⚠ **Dos hallazgos que salen de esa tabla y hay que atacar antes de construir encima:**

1. **La internacionalización deja a Perú en NULL, en silencio.** La rama de CORE-365 pobla `phone_code`
   **desde `dial_code`** — y el `dial_code` de Perú está **vacío**. O sea que el trabajo que hace que el
   flujo lea el prefijo del país **no le va a dar prefijo a Perú**. Hay que cargar `dial_code = 51` (o
   escribir `phone_code` directo) **antes** de que BCP toque una pantalla de teléfono.
2. **El `locale` de Perú usa guión BAJO** (`es_PE`) mientras Colombia y RD usan guión medio (`es-CO`,
   `es-DO`). Cualquier formateo que pase ese valor a `Intl` o a un comparador de locales trata a Perú
   distinto. Es una fila, pero rompe el formato de plata — y BCP es en `PEN`.

Y la tercera, que es la misma que RD ya pagó: **Perú tiene 25 zonas y CERO ciudades**. El selector de
ciudad no puede ofrecer nada. Es un INSERT, no un diseño (ver cómo se resolvió para RD en la tarea 43).

## El análisis que falta: ¿qué es «estructurar una entidad»?
Es el gemelo del mapa del operador de comercios, y está por escribirse. La forma que va a tener, según lo
que el árbol ya sabe:

- **Capa 1 · la entidad como dato** — la fila `lenders` (anémica a propósito: identidad, branding, ruteo)
  + `credit_line_by_lenders` + el `response_type` que despacha. El alta la hace
  `Admin/LenderController::store`, que siempre crea la línea de crédito con `credit_line_id = 1` y solo
  crea la config CreditopX si `rt == 2` → **para un rt=1 como BCP hay que saber qué NO se crea**.
- **Capa 2 · el par (comercio, entidad)** — `lenders_by_allieds` (la calculadora) y
  `lenders_by_allied_branches` (si se ve y en qué orden). Y la pieza que decide si la integración se
  invoca siquiera: **la credencial del par** (F-34). Sin ella el flujo ni llama.
- **Capa 3 · la integración** — para rt=1 hay dos caminos vivos: el switch legacy por id
  (`PreApprovedLenderService`) y el MS Go (`pre-approvals-service`, adapter + auth + strategy por
  lender). **Cuál de los dos usar es la primera decisión de diseño de esta tarea**, y de ella depende si
  BCP suma un hardcode o entra por el patrón nuevo.
- **Capa 4 · lo que BCP estrena y no tiene lugar hoy** — el vehículo como entidad de datos, el gate
  humano del asesor, el simulador embebido y el link de pago como forma de cobro.

## Preguntas abiertas (a resolver antes de estimar)
- [ ] **¿BCP es rt=1?** Todo apunta a que sí (simulador propio, gate de preaprobado), pero hay que
  confirmarlo con producto: si CreditOp pusiera capital sería CreditopX y cambia todo el diseño.
- [ ] **¿Por el MS de pre-aprobaciones o por el switch legacy?** Es la decisión que define si esto suma
  deuda o la evita.
- [ ] **¿Dónde vive el vehículo?** Tabla nueva, EAV (`user_field_values`) vía formularios dinámicos
  (CORE-400), o `user_request_products` como SmartPay. Las tres tienen consecuencias distintas para
  reportería.
- [ ] **¿El «simulador embebido» es un iframe del banco o una API que consumimos?** Cambia por completo
  quién valida y dónde queda el dato.
- [ ] **¿El link de pago es el de CreditOp** (`PaymentLinkController`, ya existe) **o uno de BCP?**
- [ ] **¿Perú necesita proveedores de identidad y buró propios?** Hoy la selección de burós **no mira el
  país** — todos los proveedores son colombianos, y RD solo lo esquiva por el hardcode de SmartPay
  (hallazgo de la tarea 43). Perú con un banco de verdad no lo va a esquivar.
- [ ] **¿Quién es el comercio?** El épico tiene «Administrador para el comercio» y «permitir a un
  comercio elegir flujo vehicular»: hay un concesionario detrás. Sin saber cuál, la capa 2 no se puede
  cerrar.

## Dependencias
- **CORE-365** (internacionalización, hoy en pruebas) — es el prerrequisito real: hace que el flujo lea
  el país del comercio. BCP necesita eso **más** los datos de Perú cargados.
- **CORE-400** (formularios dinámicos para BCP, José) — la captura del vehículo probablemente sale de ahí.
- **CORE-401** (elegir flujo vehicular, José) — el toggle por comercio.

## Tarea (publicable)
_Pendiente: la descripción de CORE-399 está vacía en Jira y no se sube nada hasta cerrar las preguntas
abiertas de arriba — sobre todo si BCP es rt=1 y por qué camino entra la integración._

## Bitácora
- **2026-08-10** — Bajada de Jira. CORE-399 llega **sin descripción, sin puntos y sin comentarios**;
  todo el contexto está en el épico `CORE-331` (también vacío) y en los títulos de sus 13 historias, que
  son lo único que describe el flujo. Medido el punto de partida: **BCP no existe en el código** (cero
  archivos) y **Perú existe como país pero incompleto** — `dial_code`, `phone_code`,
  `cell_phone_lenght` y `nationality` vacíos, `locale` con guión bajo a diferencia de los otros dos
  países, y 25 zonas con 0 ciudades. De ahí sale el hallazgo que más importa hoy: **la migración de
  CORE-365 pobla `phone_code` desde `dial_code`, así que a Perú lo deja en NULL sin avisar.**
