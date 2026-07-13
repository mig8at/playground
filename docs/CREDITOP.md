# CreditOp — qué es, cómo se adquiere un crédito, y el índice maestro de docs

> **Documento de entrada único.** Explica **a nivel de negocio** qué es CreditOp, quiénes participan,
> las **distintas formas de adquirir un crédito** (los 4 ejes), cómo se decide/firma/continúa, el
> **estado actual** (arquitectura y migración), y la **tesis de fondo**. Su §12 es el **índice canónico**:
> cada tema tiene un doc dueño; este doc lo referencia y no lo re-documenta.
>
> **Regla maestro↔dueño:** cada hecho se documenta UNA vez en su doc dueño (§12); el resto referencia.
> Si buscás un dato, el índice te dice quién manda.

---

## 1. Qué es CreditOp (en una frase y en un párrafo)

**CreditOp es una plataforma colombiana de crédito en el punto de venta y ecommerce**: conecta a **comercios** (aliados) que quieren vender a crédito, **clientes** que necesitan financiación, y **prestamistas** (lenders) que ponen el dinero. Bajo la marca **CreditopX**, además, CreditOp **opera el crédito directamente** (originación, firma y cobranza in-platform) — pero **el capital y el riesgo los pone el comercio**, no CreditOp; CreditOp gana una **comisión** por operar y recaudar (ver «los dos sombreros» abajo).

Cuando un cliente va a comprar en un comercio aliado (tienda física con un asesor, o checkout de ecommerce), CreditOp le arma una solicitud de crédito, le **muestra las opciones de financiación disponibles** para ese comercio y ese cliente (un **marketplace de lenders**), evalúa el riesgo, y lleva la operación hasta el **desembolso** y la firma. Según la opción elegida, **quien pone el dinero puede ser un banco/financiera externa (agregador) o el propio comercio (CreditopX, con CreditOp operando el crédito por detrás)**. CreditOp gana por **originar** (comisión/spread) y, en CreditopX, por **operar y cobrar** el crédito (comisión por recaudo).

> **La idea clave:** no hay "un solo flujo de crédito". Hay **varias formas de adquirir un crédito** que se combinan en 4 ejes (§4). El eje más determinante es **quién decide y quién gestiona el préstamo** (`response_type`).

### Los dos sombreros de CreditOp (la distinción de negocio más importante)

- **CreditOp como BRÓKER (marketplace):** conecta al cliente con prestamistas **externos** (Bancolombia, Banco de Bogotá, Welli, Sistecrédito, Credifamilia…). El dinero y la decisión son del tercero; CreditOp cobra por originar. `response_type` 0 (referido) o 1 (integración).
- **CreditOp como OPERADOR del crédito (CreditopX):** opera el crédito **de punta a punta bajo marca blanca** — decide con reglas locales, genera el pagaré, firma con OTP, desembolsa **dentro de su plataforma** (llega al **Estado 11 = Autorizada**) y lleva la **cobranza/servicing**. Pero **el capital y el riesgo los pone el COMERCIO, no CreditOp**: el comercio financia a su cliente (ej. Pullman le entrega el colchón a crédito) y CreditOp **cobra por operar y recaudar** (comisión por cada recaudo, girando el neto al comercio). `response_type` 2 (in-platform) o 3 (cupo rotativo).

> **⚠️ Corrección de negocio (2026-07):** CreditopX **no** es "CreditOp presta con capital propio". Hoy, en **todos** los comercios de CreditopX, el capital y el riesgo los pone el **comercio**; CreditOp es el **operador/servicer** que gana comisión. El **único** caso histórico en que CreditOp prestó con dinero propio fue **Motai X**, ya **retirado**. *(Pendiente por confirmar: el catálogo lista un lender 62 «Motai X» como `rt=4` — no verificado que sea el mismo producto histórico; ver [REGLAS-POR-COMERCIO-Y-LENDER.md](./codigo/REGLAS-POR-COMERCIO-Y-LENDER.md).)*
>
> **Dos capas, no confundir:** (a) **técnica/operativa** — CreditOp origina, firma, desembolsa y cobra in-platform (rt=2/3; los flujos no cambian); (b) **económica** — el capital y el riesgo son del comercio, CreditOp gana comisión por recaudo.
>
> Por eso *"CreditopX no es para todos los comercios"*: operar el crédito del comercio requiere un **acuerdo comercial + de riesgo** con ese comercio. La oferta efectiva se decide por **configuración en BD** (§4), no por una bandera global.

---

## 2. Los actores

| Actor | Qué es |
|---|---|
| **Cliente** | La persona que pide el crédito para su compra. |
| **Comercio / Aliado** (`allieds`) | El negocio que vende a crédito (tiene **sucursales**, `allied_branches`, con `hash` como llave de entrada). Cada comercio define qué lenders ofrece y con qué reglas. Ej.: Amoblando Pullman, Alkosto, Dentix, Sonría, Motai. |
| **Asesor** (`corporate_user`) | Empleado del comercio que arma la solicitud en el punto de venta. |
| **Lender / Prestamista** (`lenders`) | Quien pone el dinero. Hay **~150** configurados. Bancos/financieras externas (Bancolombia, Sistecrédito, Welli, Credifamilia…) o **CreditopX** (marca blanca operada por CreditOp; el **capital lo pone el comercio** — CrediPullman, Magnocréditos…). |
| **CreditOp** | La plataforma: origina, decide (según el caso), y en CreditopX **opera y cobra** la cartera (con capital del comercio) a cambio de comisión. |
| **Proveedores de riesgo** | Servicios externos que aportan datos para decidir: Experian/Datacrédito, TusDatos (AML), Ábaco (ingresos gig), Mareigua, Ado, Agildata. |

---

## 3. El journey general de un crédito (alto nivel)

Independiente de la forma, el esqueleto es:

1. **Entrada** — el cliente inicia la compra: por **ecommerce** (checkout de la tienda) o por **asesor** en el punto de venta.
2. **Onboarding** — registro (celular + OTP), datos personales, aceptación de términos.
3. **Riesgo / KYC** — se consultan datos de buró e identidad; se valida al cliente (AML, identidad, capacidad).
4. **Marketplace de lenders** — CreditOp muestra las **opciones de crédito disponibles** para ese comercio y cliente, ordenadas por probabilidad.
5. **Selección** — el cliente/asesor elige una opción (un lender + monto + plazo).
6. **Aprobación** — se decide el crédito (adentro en CreditopX, o vía la API del lender en agregadores).
7. **Firma y desembolso** — se firman documentos (pagaré, contratos) y se autoriza el desembolso → **Estado 11 (Autorizada/desembolsada)**.
8. **Uso y vida del crédito** — el cliente usa el crédito; luego paga en cuotas (el "servicing", §7).

> El punto donde termina la **originación** y empieza la **continuación** es el **Estado 11**.

### El ciclo de vida de la solicitud (`user_request_statuses`)

El crédito de un cliente es un `user_request` que avanza por estados. El catálogo es **`user_request_statuses`** (plural); la FK en `user_requests` es **`user_request_status_id`**:

| id | Estado | Significado |
|----|--------|-------------|
| 9 | Formulario de perfil | OTP validado, perfil en curso |
| 3 | Seleccionó entidad | el cliente eligió un lender del marketplace |
| 10 | Pendiente de autorización | esperando firma/autorización |
| **11** | **Autorizada** | **crédito aprobado/desembolsado — objetivo del cierre in-platform** |
| 25 | Pendiente de facturación | — |
| 8 | Cancelado | sin cupo / rechazado / abortado |

Solo los flujos **CreditopX (rt=2/3)** llegan a 11 *in-platform*; los externos (rt=1) llegan a 11 **asíncrono** (cuando el banco confirma) y los UTM (rt=0) ni siquiera (el crédito se cierra fuera de CreditOp).

> **No confundir con `lender_transaction_statuses`.** Los estados **40 = CREDIT_IN_PROCESS** y **41 = CREDIT_APPROVED** (que aparecen en flujos tipo Credifamilia) pertenecen a **otra tabla** (`lender_transaction_statuses`, sobre `lender_transactions`), **no** a `user_request_statuses` (cuyo id máximo es 28). Son dos ciclos que conviven.

---

## 4. Las FORMAS de adquirir un crédito — los 4 ejes (el corazón)

Una operación concreta = **una combinación de un valor por cada uno de 4 ejes ortogonales**. No confundirlos es la clave. *(Dueño del detalle técnico por flujo: los docs `*-FLUJO-ANALISIS.md`, §12.)*

### Eje 1 — ¿Quién DECIDE y quién GESTIONA el préstamo? (`response_type`)

El más importante: define qué se muestra, quién aprueba, quién lleva la cartera, y qué se puede simular en pruebas. Nombres oficiales (tabla `response_types`, **catálogo con filas 0-3**):

| rt | Nombre oficial | Quién aprueba | Quién gestiona | Cómo cierra | Ejemplos |
|---|---|---|---|---|---|
| **0** | **UTM** | El banco, fuera de CreditOp | El banco | redirige a URL externa (solo referido) | AV Villas, Rapicredit, Lulo Bank |
| **1** | **Integración** | La **API del lender** | El **lender externo** | handoff/portal/webhook; Estado 11 **asíncrono** | Bancolombia (BNPL #68 / Consumo #100), Sistecrédito, Addi, Welli, Meddipay, Prami, Banco de Bogotá, Compensar |
| **2** | **Creditop X** | **CreditOp** (reglas locales) | **CreditOp opera; capital del comercio** | in-platform: pagaré + OTP → **Estado 11** | CrediPullman #77, Magnocréditos, Creditop X #37 |
| **3** | **Cupo Rotativo** | CreditOp | CreditOp, **cupo reutilizable** | in-platform; reutiliza el cupo | rotativos in-platform |
| **4** | *(sin fila en `response_types`)* | CreditOp origina; el lender formaliza | El **lender** (radicación SOAP) | radica → *polling* hasta APROBADO/RECHAZADO | Credifamilia #24 |

**En criollo:**
- **Agregador (rt=0/1):** CreditOp es **marketplace/intermediario**. Muestra opciones, arma la solicitud, pero **el lender presta y cobra**. El crédito **no vive en CreditOp**: tras el desembolso solo refleja el estado y **no lleva la cobranza**.
- **CreditopX (rt=2/3):** CreditOp **opera** todo el ciclo (cupo, desembolso, cobranza, revolving) y decide con reglas locales, pero el **capital y el riesgo son del comercio** — CreditOp gana **comisión por recaudo** (marca blanca; ver §1). Único flujo cuya vida completa CreditOp controla operativamente, y **único simulable de punta a punta** en el harness.
- **Credifamilia (rt=4):** CreditOp origina **adentro** (identidad, plan de pagos, firma) pero **radica el crédito en Credifamilia** por SOAP; de ahí en más lo gestiona el lender.

> **`rt=4` es una excepción "pegada" al catálogo:** la tabla `response_types` tiene filas **0-3**; no hay fila 4. `rt=4` existe solo como **valor** en el lender 24 (Credifamilia). Por eso se trata aparte.
>
> **Frontera de inyectabilidad (pruebas):** **rt=2/3 = 100% inyectable** (CreditOp decide con datos locales); **rt=1 / rt=4 = NO** (decide una API externa; solo se puede mockear a nivel HTTP).

### Eje 2 — ¿Qué PRODUCTO / garantía es?

- **Préstamo de compra** — dinero para una compra, sin garantía física.
- **SmartPay — financiación de celulares con bloqueo:** el crédito financia un **teléfono** y **el teléfono es la garantía**. En mora se **bloquea remotamente** (MDM); al pagar se **desbloquea**. Lo maneja `DeviceLockingApiClient` + crons diarios `lock-devices-past-due` (04:00) / `unlock-devices-paid` (05:00) / `unroll-devices-paid` (06:00). **Es de lo poco de servicing ya migrado a legacy-backend.** SmartPay es un **canal** (marca `isSmartpayChannel()` en el lender): salta AML de TusDatos y usa mailer propio; agrega un paso extra de enrolar el **IMEI** antes de desembolsar.
- **Arrendamiento (Motai)** — **no es un préstamo para poseer**. Dos productos (nombres según el **diccionario D2**, [MOTAI-PLAN-EVOLUCION.md](./mejoras/MOTAI-PLAN-EVOLUCION.md) §4.2): **Rent-to-Own** (arrienda y al final **se queda** el bien; código legado `motai-renting` ⚠) y **Renting operativo** (arrienda y **devuelve**; código legado `alquiler` ⚠). ⚠ El código y los PRDs viejos usan "renting" **invertido** — ante la duda, D2 manda (glosario completo: [NOMENCLATURA-NEGOCIO.md](./negocio/NOMENCLATURA-NEGOCIO.md)). Apunta a **población gig/migrante** (trabajadores de plataformas + migrantes con **PEP = Permiso Especial de Permanencia**) sin historial de buró: por eso valida ingresos con **Ábaco** (§5) en vez del score tradicional.

> ⚠️ **"PEP" tiene dos significados:** **Permiso Especial de Permanencia** (documento migratorio, contexto Motai renting) vs **Persona Expuesta Políticamente** (término AML/compliance, en Credifamilia y el onboarding). No confundir.

### Eje 3 — El MODO del comercio (variantes de producto)

Un mismo comercio puede ofrecer **varios "modos"** = productos distintos. Caso testigo: **Motai** (allied 158), 3 modos:
- `motai` — compra financiada estándar.
- `motai-renting` — renting; **exige validación externa Ábaco** (`isAbacoRequired: true`, vía `AbacoController`/`MotaiValidationService`).
- `alquiler` — arrendamiento puro.

> El modo selecciona **producto/underwriting**, no catálogo: hoy **no cambia qué lenders se ven** (`AlliedModeLenderFilterService` es NO-OP mientras `config` no traiga una lista `lenders`).

### Eje 4 — El CANAL de integración

Cómo entra la venta y cómo se le avisa a la tienda al cerrar:
- **Ecommerce:** WooCommerce (`ecommerce_type_id=1`) · Self-development (`=2`) · VTEX (`=3`) — cada uno cambia el **notificador** del cierre. Entrada VTEX por contrato base64 unificado (`/vtex/init`).
- **Asesor / punto de venta:** el asesor arma la solicitud; el cliente continúa por **QR de autogestión** (flujo de 2 dispositivos).
- **Corbeta (Alkosto / Alkomprar):** retail grande con integración especial — **facturación y conciliación por lotes** sobre Bancolombia (crons `invoice-process-corbeta`, `update-orders-from-corbeta`, `corbeta-conciliation-report`).

### Cómo se leen juntos (ejemplos)
- *CrediPullman (rt=2 CreditopX) · financiando un celular (SmartPay) · compra · por asesor en Amoblando Pullman.*
- *Bancolombia (rt=1 agregador) · préstamo · canal Corbeta en Alkosto.*
- *Motai (renting) · con validación Ábaco · ecommerce VTEX.*
- *Credifamilia (rt=4) · préstamo · por asesor* — CreditOp origina, radica por SOAP, Credifamilia gestiona.

---

## 5. Cómo se DECIDE un crédito (riesgo y reglas)

CreditOp reúne datos de riesgo y les aplica reglas configuradas **por comercio y por lender**. *(Dueño: [ONBOARDING-DATOS-DECISION-ANALISIS.md](./codigo/ONBOARDING-DATOS-DECISION-ANALISIS.md) y [REGLAS-POR-COMERCIO-Y-LENDER.md](./codigo/REGLAS-POR-COMERCIO-Y-LENDER.md).)*

### Los datos de riesgo (proveedores)
| Proveedor | Qué aporta |
|---|---|
| **Experian / Datacrédito** | Score de crédito, comportamiento, mora, endeudamiento (buró principal). |
| **TusDatos** | Validación de identidad + **AML** (listas restrictivas). |
| **Ábaco** | **Ingresos de economía gig** (Rappi/DiDi/Uber… con permiso del usuario) — underwriting alternativo para quien no tiene buró (Motai renting). |
| **Mareigua / Ado** | Centrales/validaciones adicionales (identidad, buró alterno). |
| **Agildata** | Datos de ingreso/perfil. |

### Las capas de decisión (resumen)
1. **Cobertura** — qué lenders ofrece la sucursal (catálogo base, duro).
2. **Group rules** (por sucursal) — edad, ocupación, ingreso mínimo, "reportado en centrales". Para agregadores **excluyen**; para CreditopX **solo clasifican** (ordenan).
3. **Datacrédito** — umbral de score (y mora/consultas). Solo en comercios habilitados para consulta de buró.
4. **Categoría / cupo** (solo CreditopX rt=2) — el **filtro duro real** de CreditopX: define si el cliente califica y con qué **cupo** (según score, edad, ocupación, historial).
5. **Agregadores (rt=1)** — la decisión final la toma **la API del lender externo** (CreditOp solo empaqueta los datos y consulta).

> En el **listado** las reglas mayormente **ordenan** (probabilidad alta/baja); el **corte duro** es el **cupo** (CreditopX rt=2) o la **decisión externa** (rt=1). Los **umbrales concretos viven en BD por comercio/lender** (varían por entorno).

---

## 6. Aprobación, firma y desembolso

- **Aprobación:** en CreditopX se sella adentro (cupo + categoría); en agregadores la confirma el lender.
- **Firma:** según el lender, se firman pagaré (Deceval), contratos/vinculación y autorizaciones (e-firma tipo Netco). SmartPay firma además el **acuerdo de bloqueo del dispositivo**; Credifamilia arma un paquete que **radica por SOAP**.
- **Desembolso → Estado 11 (Autorizada):** se libera el dinero / se habilita la compra, se genera un **voucher/comprobante** y se **notifica al comercio** (webhook al ecommerce). En SmartPay el desembolso se **difiere** hasta enrolar el IMEI.

---

## 7. Qué pasa DESPUÉS: la vida del crédito (servicing)

Aquí se separan aguas. *(Dueño: [CONTINUACION-CREDITO-ANALISIS.md](./codigo/CONTINUACION-CREDITO-ANALISIS.md).)*

- **CreditopX (rt=2/3) — la operación la lleva CreditOp (capital del comercio):** el préstamo vive en un **libro de eventos** (`creditop_x_requests_history`) y una batería de **procesos diarios** lo mueve: causación de intereses, corte, **mora**, **gasto de cobranza**, aplicación de pagos (cascada cobranza → mora → interés → seguro → capital), **recordatorios**, y **cupo rotativo** (al pagar capital se libera cupo). CreditOp **recauda del cliente y se queda una comisión**, girando el neto al comercio (que es quien puso el capital y asume el riesgo). Estados del préstamo: **al día → en mora → paz y salvo → cancelado**.
- **SmartPay — enforcement por hardware:** en mora, procesos diarios **bloquean el celular** vía MDM; al pagar, lo **desbloquean**; al terminar, lo dan de baja.
- **Agregadores (rt=1) — lo gestiona el lender:** CreditOp **no lleva la cartera**. El lender cobra en su sistema; CreditOp solo refleja el estado hasta la facturación/cierre.

---

## 8. El problema de fondo: CreditOp se adapta a todos, en vez de que todos se adapten a CreditOp

Es el dolor estructural y la tesis central.

**El deber ser:** CreditOp define UN estándar (de integración, de config, de producto) y **todos —comercios y entidades— se adaptan a él**. Nuevo comercio = una fila de config. Nuevo lender = implementa el contrato estándar.

**Lo que pasa hoy:** CreditOp **se adapta a cada quien**. Cada comercio/entidad especial tiene su **camino quemado en el código** en vez de en config:
- Condicionales por ID esparcidos (`allied_id == 94` para Pullman, listas de IDs para Corbeta, `country_id == 60` para RD…) en lugar de columnas de configuración.
- Cada lender externo (rt=1) es una **clase Action a medida** (Welli, Meddipay, Compensar, Bancolombia…), con su host, su auth (mTLS/OAuth/AES propio) y su shape — porque CreditOp se adaptó a la API de cada banco.
- Documentos de prueba, teléfonos quemados y listas de IDs duplicadas en varios sitios.

> **Conclusión:** los **flujos de negocio reales son pocos** (un puñado de cierres × unas pocas entradas). La explosión de "casos" **no son flujos distintos** — son **el mismo flujo con un `if` quemado**. Lo que está bien hecho (`response_type`, las capas de config, las factories de firma) es el **modelo a seguir**: mover los `if id==N` a columnas/config. El **inventario verificado** de esos hardcodes vive en [LOGICA-QUEMADA.md](./codigo/LOGICA-QUEMADA.md); la clasificación de fallos y cifras, en [CASOS-ESPECIALES.md](./codigo/CASOS-ESPECIALES.md).

---

## 9. Cómo está CreditOp HOY (arquitectura y migración)

CreditOp está en plena **migración de un monolito viejo a una arquitectura nueva**, con ambos **conviviendo** (patrón *strangler*, "parallel-run"). *(Dueño: [ESTADO-MIGRACION.md](./codigo/ESTADO-MIGRACION.md) y [PENDIENTES-MIGRACION.md](./codigo/PENDIENTES-MIGRACION.md).)*

### Las piezas
| Pieza | Rol | Estado |
|---|---|---|
| **`application`** (monolito viejo, PHP/Laravel + Vue) | Sistema histórico: originación + **todo el servicing/cartera** + panel admin. | **Vivo y por defecto**; sigue corriendo la operación (sobre todo la cartera). |
| **`legacy-backend`** (nuevo, Laravel modular) | Reconstrucción de la **originación** (onboarding, decisión, firma, Credifamilia, SmartPay device-lock). | En **parallel-run**, habilitado por comercio (allowlist). |
| **`frontend-monorepo`** (React) | El **wizard CreditopX** (marketplace, selección, identidad, plan de pagos). | Nuevo front de originación. |
| **Microservicios** | `pre-approvals-service` (pre-aprobación agregadores), `pdf-mapper-service`, `messaging-service`, `onboarding-forms-service`. | En uso. |

### Subdominios de la migración
Onboarding (entrada + OTP + perfil) · **Lenders Marketplace** (oferta y pre-aprobación rt=0/1/4) · **Loan Origination + CreditopX** (cierre rt=2/3). **Fuera de alcance:** Loan Servicing, Billing & Collections (post-desembolso) y el Perfilador (la decisión de riesgo).

### Qué está migrado y qué falta (hoy)
- ✅ **Originación** reconstruida en legacy-backend (con cutover gradual por comercio).
- ⚠️ **Pendiente:** cutover completo, algunos **webhooks de agregadores rt=1**, panel/SSO, y sobre todo la **cartera/servicing**.
- 🔴 **El servicing (cartera, pagos, cobranza, revolving) corre 100% en `application`.** legacy-backend solo tiene migrado el **bloqueo de dispositivo de SmartPay**; el resto son copias inactivas. Un crédito se **origina** en el sistema nuevo pero **"continúa su vida" en el viejo** (sobre la misma base de datos).

> Implicación práctica: para entender un crédito de punta a punta hoy hay que mirar **ambos** sistemas — originación en legacy, continuación en application.

---

## 10. Implicancias para pruebas / harness

| Flujo | ¿Simulable end-to-end? | Por qué |
|---|---|---|
| CreditopX rt=2/3 | ✅ Sí | CreditOp decide (datos locales inyectables) y gestiona el ciclo |
| Agregador rt=1 | ❌ No (solo mock HTTP) | La API del lender decide y gestiona |
| Credifamilia rt=4 | ⚠️ Parcial | Originación in-platform sí; KYC V2 + radicación SOAP = externos |
| SmartPay | ➕ capa extra | Suma el bloqueo/desbloqueo de dispositivo (crons + `DeviceLockingApiClient`) |
| Motai renting | ➕ capa extra | Suma el paso de validación Ábaco |

*(Cómo correr los harness y sus bypasses: [HARNESS-ARQUITECTURA.md](./operacion/HARNESS-ARQUITECTURA.md), [E2E-DATA-TESTIDS.md](./operacion/E2E-DATA-TESTIDS.md), y `../backend-e2e/` · `../frontend-e2e/`.)*

---

## 11. Glosario rápido + constantes (lo más consultado)

### `response_type`
Columna `lenders.response_type`. Catálogo `response_types` = filas **0-3**. `rt=4` = valor solo en lender 24 (sin fila).
- **0 — UTM**: solo referido. · **1 — Integración**: lender externo, redirige al portal. · **2 — Creditop X**: CreditOp opera in-platform (capital del comercio, no de CreditOp — ver §1). · **3 — Cupo Rotativo**. · **4 — Credifamilia** (async, radicación SOAP; fuera del catálogo).

### Estados clave — dos namespaces, no confundir
- **`user_request_statuses`** (FK `user_requests.user_request_status_id`): **9** perfil · **3** seleccionó entidad · **10** pendiente autorización · **11** Autorizada · **25** pendiente facturación · **8** cancelado.
- **`lender_transaction_statuses`** (otra tabla): **40** CREDIT_IN_PROCESS · **41** CREDIT_APPROVED.

### Las capas de config (qué ofrece un comercio) — *dueño: [MODELO-DATOS.md](./codigo/MODELO-DATOS.md)*
1. **Catálogo del comercio** (`lenders_by_allieds` / a nivel sucursal) — qué lenders ofrece.
2. **`allieds.have_ctopx`** — columna a nivel aliado. **Sí se lee y ramifica la lógica de decisión** de listado (trae la rama `lenders_all_with_ctopx` en `LenderRetrievalService`/`LenderListingService`, y en `LenderValidationService` decide si un rt=2 rechazado va a `false_lenders`) — **no es un simple cast/fillable**. Pero **no es el gate duro de la oferta rt=2**: la oferta efectiva pasa por catálogo + credencial (prueba: **CrediPullman #77 rt=2 se ofrece en el aliado 94 que tiene `have_ctopx=0`**).
3. **Credencial** (`lender_allied_credentials`) — contrato/llaves reales comercio↔lender. Sin credencial, aunque aparezca ofrecida, no funciona.

### IDs de negocio
> ⚠️ **Colisión de namespace:** allied y lender son secuencias **independientes**. Los números **24, 100 y 158 existen en AMBAS tablas** con significado distinto. Fijate el namespace antes de copiar un ID.

**Allieds (comercios):**
- **94** = Amoblando Pullman (`have_ctopx=0`) · **189** = DENTIX (alias "DFS"; en BD `DENTIX`) · **158** = Motai (`have_ctopx=0`; colisiona con lender 158) · **24** = Creditop (`have_ctopx=0`; colisiona con lender 24 = Credifamilia) · **209/210/211** = Alkosto/K-TRONIX/Alkomprar (Corbeta) · `settings.corbeta_allieds = [24,209,210,211]`.

**Lenders (`response_type`):**
- **24** = Credifamilia (`rt=4`) · **37** = Creditop X (`rt=2`) · **77** = CrediPullman (`rt=2`) · **68** = Bancolombia "Compra y paga después"/BNPL (`rt=1`) · **100** = Bancolombia "Crédito de consumo"/Consumo (`rt=1`; colisiona con allied 100) · **158** = Motai Renting (`rt=2`; colisiona con allied 158).
- **SmartPay** = **152** (`rt=2`, "smartpay") + **153** (`rt=1`, "SmartPay") en dev/local. **El lender 160 NO existe en la BD local/dev**: `160` es el `smartpay_lender_id` de **PRODUCCIÓN** (`config/lenders.php:24`, rama `APP_ENV==='production' ? 160 : 153`). El código no compara contra literal 160 sino contra `config('lenders.smartpay_lender_id')` vía `Lender::isSmartpayChannel()`. Detalle en [LOGICA-QUEMADA.md](./codigo/LOGICA-QUEMADA.md).

---

## 12. 📚 Índice canónico de docs

> Fuente de verdad única del conocimiento de dominio. Cada doc es **dueño** de su tema; los demás lo referencian. Verificado contra `application` / `legacy-backend` / `frontend-monorepo`.

### Cómo está organizada la carpeta — las 5 intenciones

La carpeta separa **qué es cada documento** para no mezclar realidad con propuestas:

| Carpeta | Intención | Pregunta que responde |
|---|---|---|
| **[codigo/](./codigo/)** | **LA REALIDAD** — cómo funciona HOY, verificado contra el código y la BD (citas `archivo:línea`) | "¿cómo ES?" |
| **[negocio/](./negocio/)** | El **lenguaje y las reglas de negocio**, independiente de la implementación | "¿cómo se LLAMA / qué significa?" |
| **[mejoras/](./mejoras/)** | **Planes accionables** y propuestas concretas (deber-ser por etapas) | "¿qué hacemos AHORA?" |
| **[vision/](./vision/)** | El **modelo estructural a futuro** (unificación + separación de responsabilidades) | "¿hacia DÓNDE va?" |
| **[operacion/](./operacion/)** | Cómo operar este workspace: harness E2E, convenciones, testids, bitácora | "¿cómo TRABAJO acá?" |
| **[lenders/](./lenders/)** | **Vista transversal por ENTIDAD** (fichas + tabla comparativa) — resume lo verificado y apunta a los dueños en `codigo/` | "¿en qué se diferencia X de Y?" |

> Regla de lectura: si un doc de `mejoras/` o `vision/` contradice a uno de `codigo/`, no es un error — `codigo/`
> describe lo que HAY, los otros lo que DEBERÍA haber. Este doc (CREDITOP.md) es la **entrada de negocio + el índice** y vive en la raíz.

### 📁 codigo/ — la realidad verificada

**Decisión, datos y reglas**
| Doc | Dueño de |
|---|---|
| [ONBOARDING-DATOS-DECISION-ANALISIS.md](./codigo/ONBOARDING-DATOS-DECISION-ANALISIS.md) | Datos de riesgo → decisión de crédito por lender; receta de usuario sintético; cascada de listado/perfilamiento. |
| [REGLAS-POR-COMERCIO-Y-LENDER.md](./codigo/REGLAS-POR-COMERCIO-Y-LENDER.md) | Config real de reglas en BD por comercio × lender (group rules / datacrédito / categoría / cobertura). |
| [HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md](./codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md) | **Hallazgo para negocio**: las reglas se COPIAN por sucursal (37.284 copias, 5% deriva; 42 entidades con default BdB/640) + ejemplos y veredictos. |
| [ADMIN-ALTA-OPERACION.md](./codigo/ADMIN-ALTA-OPERACION.md) | **El admin visual de `application`**: recorrido real de alta (comercio → sucursal → entidades → reglas → módulos/productos), el punto EXACTO donde nacen las copias de reglas, y dónde (no) se configura el "modo". |
| [MODELO-DATOS.md](./codigo/MODELO-DATOS.md) | Estructura de datos: tablas, columnas, relaciones, las capas de config. |
| [CENSO-CAMPOS-CONFIG.md](./codigo/CENSO-CAMPOS-CONFIG.md) | **Censo columna-por-columna** (176 cols, 11 tablas de config) verificado en ambos backends: qué DECIDE, qué se PISA (y quién), 33 muertas/write-only, ~20 divergencias app↔legacy, y el **bug `min_income`** (piso de ingreso no-op). |
| [MECANICA-CREDITO.md](./codigo/MECANICA-CREDITO.md) | Mecánica financiera (amortización francesa, tasas EA→MV→diaria, seguros/FGA) y operación de cartera. |
| [mapeo-datos-buros.json](./codigo/mapeo-datos-buros.json) | **Diccionario ÚNICO** de datos por buró: clave canónica → `sources` (ruta cruda por proveedor) + `ejemplos_fixture` (valores de muestra). Consolidó el antiguo `mapeo-datos-por-buro.json` (borrado 2026-07-08). |

**Flujos por lender / canal**
| Doc | Dueño de |
|---|---|
| [MAPA-FLUJOS.md](./codigo/MAPA-FLUJOS.md) | **Cadena FE↔BE** navegable: URL → archivo front → endpoint → controller/service → tabla → prueba E2E, por flujo. |
| [REFERENCIA-FLUJOS.md](./codigo/REFERENCIA-FLUJOS.md) | Referencia técnica **por flujo** (qué hace distinto, citas `archivo:línea`, mocks/bypasses E2E). |
| [AGREGADORES-FLUJO-ANALISIS.md](./codigo/AGREGADORES-FLUJO-ANALISIS.md) | Patrón end-to-end de lenders agregador rt=1 + matriz por lender + Corbeta batch. |
| [CREDIFAMILIA-FLUJO-ANALISIS.md](./codigo/CREDIFAMILIA-FLUJO-ANALISIS.md) | Credifamilia (lender 24, rt=4): 3 integraciones REST/V2 KYC/SOAP. |
| [CREDIFAMILIA-PIPELINE-DOCUMENTOS.md](./codigo/CREDIFAMILIA-PIPELINE-DOCUMENTOS.md) | Pipeline de documentos de Credifamilia de punta a punta (pdf-mapper, S3, firma; validado multi-agente). |
| [SMARTPAY-FLUJO-ANALISIS.md](./codigo/SMARTPAY-FLUJO-ANALISIS.md) | Canal SmartPay (enrolar IMEI + device-lock MDM). |
| [MOTAI-FLUJO-ANALISIS.md](./codigo/MOTAI-FLUJO-ANALISIS.md) | Motai (allied/lender 158) + 3 modos + gate Ábaco (renting). |
| [FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md](./codigo/FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md) | CreditopX rt=2 punta a punta (ADO/firma/polling/Echo) + veredicto de dependencias legacy↔application. |

**Servicing (post-Estado 11)**
| Doc | Dueño de |
|---|---|
| [CONTINUACION-CREDITO-ANALISIS.md](./codigo/CONTINUACION-CREDITO-ANALISIS.md) | Vida del crédito post-desembolso: 2 máquinas de estado, ledger, crons, cascada de pagos, revolving. |

**Hardcodes y casos**
| Doc | Dueño de |
|---|---|
| [LOGICA-QUEMADA.md](./codigo/LOGICA-QUEMADA.md) | Inventario transversal de hardcodes (IDs/status/`response_type`/montos/PII/branches) priorizado. |
| [CASOS-ESPECIALES.md](./codigo/CASOS-ESPECIALES.md) | Clasificación de fallos del harness (gap de CONFIG vs lógica distinta) + cifras de deuda de config. |

**Migración**
| Doc | Dueño de |
|---|---|
| [ESTADO-MIGRACION.md](./codigo/ESTADO-MIGRACION.md) | Estado por módulo: qué se reconstruyó, qué copia paralela sigue viva, ruteo por-comercio. |
| [PENDIENTES-MIGRACION.md](./codigo/PENDIENTES-MIGRACION.md) | Backlog priorizado (P0 cutover + webhooks agregadores rt=1 · P1 · P2 cartera/panel · P3). |
| [SERVICIO-PRE-APROBACIONES.md](./codigo/SERVICIO-PRE-APROBACIONES.md) | El microservicio Go `pre-approvals-service` (contrato HTTP, matriz de proveedores, cache, mock local). |

### 📁 lenders/ — las entidades, una por una
| Doc | Dueño de |
|---|---|
| [lenders/README.md](./lenders/README.md) | **Tabla comparativa** de entidades (quién decide / quién pone la plata / quién cobra / cómo cierra / simulable) + los dos sombreros + dónde viven las reglas por tipo. |
| [CREDITOPX.md](./lenders/CREDITOPX.md) · [BANCOLOMBIA.md](./lenders/BANCOLOMBIA.md) · [CREDIFAMILIA.md](./lenders/CREDIFAMILIA.md) · [WELLI.md](./lenders/WELLI.md) · [BANCO-DE-BOGOTA.md](./lenders/BANCO-DE-BOGOTA.md) · [SISTECREDITO.md](./lenders/SISTECREDITO.md) | **Fichas por entidad**: lo distintivo de cada una + hardcodes que la tocan + links a los docs dueños. Son *vistas* (no dueñas): si chocan con `codigo/`, manda `codigo/`. |

### 📁 negocio/ — lenguaje y reglas de negocio
| Doc | Dueño de |
|---|---|
| [NOMENCLATURA-NEGOCIO.md](./negocio/NOMENCLATURA-NEGOCIO.md) | **Glosario canónico** (decí/evitá); 14 choques de nombre (PRD MVP2 × código × docs), reorganización del PRD por niveles de política, reglas de estilo (canon vs cuota, permanencia, segmento de ingresos, "X" reservado). |
| [SIMULADOR-REGLAS-NEGOCIO.md](./negocio/SIMULADOR-REGLAS-NEGOCIO.md) | Guía de negocio del simulador `playground/flow`: el espíritu de cómo decide CreditOp (listado ≠ aprobación, CreditopX decide adentro, externos afuera). |

### 📁 mejoras/ — planes accionables (deber-ser por etapas)
| Doc | Dueño de |
|---|---|
| [PLAN-ACCION-SIMPLIFICACION.md](./mejoras/PLAN-ACCION-SIMPLIFICACION.md) | **Plan deber-ser general**: flujo único paramétrico, onboarding ADO-first, manifiestos declarativos, poda y redundancias (R1–R11), fases P0–P3 y KPIs. |
| [MOTAI-PLAN-EVOLUCION.md](./mejoras/MOTAI-PLAN-EVOLUCION.md) | Plan escalonado Motai→renting genérico (E0–E4); §10 = diseño vigente: productos como **lenders CreditopX por categoría** (CTPX-BUY/RENT/RTO), IDs de reglas (deprecar R1–R8), veredicto prototipo-vs-código. Prototipos en `../merchant-config/`. |
| [DES-MOTAIZACION.md](./mejoras/DES-MOTAIZACION.md) | **Ejecución del des-hardcodeo** (pedido 2026-07-12): censo de hardcodes re-verificado por repo (validado contra `staging`), PRD MVP2 de Manuela traducido a configuración (reglas estables, política por perfil, calculadora — incl. hallazgo C10: la columna "semanas" del simulador RTO está mal), y orden de PRs con dual-read para que Motai nunca deje de funcionar. |
| [DES-MOTAIZACION-CONFLUENCE.md](./mejoras/DES-MOTAIZACION-CONFLUENCE.md) | **Versión Confluence** del anterior, para compartir con **Manuela (producto) y Jose (brechas)**: censo digerible, cobertura del PRD, el hallazgo C10 destacado, plan por fases, cierre de las 11 brechas de Jose, y tabla de decisiones pendientes con dueño. Estilo negocio+tec (notas 🔧 Técnico). |
| [MODELO-RENTING-PROPUESTA.md](./mejoras/MODELO-RENTING-PROPUESTA.md) | **Doc para Confluence** (negocio+tec, simple): hoy vs deber-ser del renting, cuellos de botella (el "modo" primero), camino a un flujo reutilizable. |
| [MAPA-ATRIBUTOS-POR-NIVEL.md](./mejoras/MAPA-ATRIBUTOS-POR-NIVEL.md) | **Reubicación de config**: cada atributo (economía/reglas/flags) contra los 4 niveles (entidad/comercio/sucursal/categoría) — dónde vive hoy vs dónde debería, qué se pisa, qué es fantasma, qué decisión está quemada. Antes→después + prioridad P0-P3. |

### 📁 vision/ — el modelo estructural a futuro
| Doc | Dueño de |
|---|---|
| [RESUMEN-PROBLEMA-Y-SOLUCION.md](./vision/RESUMEN-PROBLEMA-Y-SOLUCION.md) | **One-pager**: el problema (CreditOp se adapta a cada comercio) y la solución (unificar + separar responsabilidades), al grano. |
| [UNIFICACION-Y-RESPONSABILIDADES.md](./vision/UNIFICACION-Y-RESPONSABILIDADES.md) | **Documento puente (negocio+tec)**: PRD de Manuela (el *qué*) × brechas de José (el *cómo-mínimo transitorio*) × el modelo estructural; cómo el modelo cubre el PRD y cierra las 11 brechas; **Apéndice — Fuente** con `archivo:línea` de cada falla. |

### 📁 operacion/ — cómo trabajar en este workspace
| Doc | Dueño de |
|---|---|
| [CONVENCIONES.md](./operacion/CONVENCIONES.md) | **Regla de oro** del workspace (playground commit-local vs repos reales stash/rama; mocks; anti-patrones). |
| [HARNESS-ARQUITECTURA.md](./operacion/HARNESS-ARQUITECTURA.md) | Arquitectura de los 2 harness E2E (composer + tabla de estrategias). |
| [E2E-DATA-TESTIDS.md](./operacion/E2E-DATA-TESTIDS.md) | Mapa `data-testid` → archivo → elemento (respaldo de `bin/testids`). |
| [hallazgos-backend.md](./operacion/hallazgos-backend.md) | Bitácora de bugs/guards/workarounds descubiertos validando E2E. |

### 📁 _archivo/
Hallazgos cerrados de referencia histórica (ej. `HALLAZGOS-CUOTA-MEDDIPAY.md`). Los dumps de schema (`schema-remoto.json/.md`) y `queries-*.sql` se **regeneran** con el probe del backend-e2e; no se versionan como docs.

> **Prerequisito operativo:** los harness dependen de **bypasses** (OTP, identidad, forms, PDF) y **testids** aplicados al working tree (`legacy-backend`, `frontend-monorepo`) desde `git stash`. Si fallan por OTP/identidad/forms o selectores, verificá que esos cambios sigan aplicados (ver `../backend-e2e/VALIDATION.md` y `../frontend-e2e/VALIDATION.md`).
