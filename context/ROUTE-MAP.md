# CreditOp — Mapa de rutas de contexto

> Índice estático del árbol de contexto (reemplaza al MCP). **Cómo usar:** leé los `Cuándo:` de abajo, elegí 2–4 nodos que matcheen tu tarea, abrí `server/data/flows/<id>/doc.md` (el análisis) y `server/data/flows/<id>/map.json` (la lista de archivos fuente), y de ahí leé el código real. Las rutas de `map.json` son `alias/relpath`.

**Repos (alias → root):** `application`→`~/Desktop/CREDITOP/github/legacy-application` · `frontend-monorepo`→`~/Desktop/CREDITOP/github/frontend-monorepo` · `legacy-backend`→`~/Desktop/CREDITOP/github/legacy-backend` · `pre-approvals-service`→`~/Desktop/CREDITOP/github/pre-approvals-service` · `backend-e2e`→`~/Desktop/CREDITOP/playground/backend-e2e` · `frontend-e2e`→`~/Desktop/CREDITOP/playground/frontend-e2e`

**Mantenimiento:** validar que las rutas resuelven → `python3 tools/oracle.py <map.json>`. Regenerar este mapa → `python3 tools/build-route-map.py`.

## Árbol
```
- creditop
  - actors [ref]
  - architecture [ref]
    - application [ref]
    - frontend-monorepo [ref]
    - harness [ref]
    - legacy-backend [ref]
    - ms-preapprovals [ref]
  - confirmacion-de-cupo [task]
  - ecommerce [ref]
  - ecommerce-web-stateless [task]
  - entities [ref]
    - aggregator [ref]
      - corbeta [ref]
    - credifamilia [ref]
    - creditopx [ref]
      - amount-tiers [ref]
      - profiling [ref]
    - redirect [ref]
  - findings [ref]
  - fix-min-income [task]
  - formalization [ref]
    - dynamic-forms [ref]
  - hardcodes-entidades [ref]
  - merchants [ref]
    - motai [ref]
    - pullman [ref]
    - smartpay [ref]
  - motai-v2 [task]
  - onboarding [ref]
    - kyc [ref]
  - payments [ref]
  - servicing [ref]
```

## Nodos

### creditop — CreditOp  ·  _root_ · 58 archivos
**Cuándo:** Cuando la tarea toca material TRANSVERSAL que ningún contexto dueña: tablas y datos clave, máquinas de estado y el Estado 11, frontera de pruebas y harness, deuda técnica y hardcodes, glosario y colisiones de id. También cuando no sabés por dónde empezar.
Doc: `server/data/flows/creditop/doc.md` · Archivos: `server/data/flows/creditop/map.json`

### actors — Actors  ·  _reference_ · 63 archivos
**Cuándo:** Cuando la pregunta es de PERMISOS o de quién hace qué: cliente vs asesor vs back-office, login, Cognito y SSO, roles y alcance, y por dónde entra cada uno (QR, link de continuación, autogestión).
Doc: `server/data/flows/actors/doc.md` · Archivos: `server/data/flows/actors/map.json` · Padre: `creditop`

### aggregator — Aggregator  ·  _reference_ · 105 archivos
**Cuándo:** Cuando el prestamista decide AFUERA por API (rt=1): Bancolombia, Sistecrédito, Welli, Addi, Meddipay, Banco de Bogotá. Pre-aprobación, webhooks, cartera del tercero, y por qué no se puede simular en local.
Doc: `server/data/flows/aggregator/doc.md` · Archivos: `server/data/flows/aggregator/map.json` · Padre: `entities`

### amount-tiers — Amount tiers  ·  _reference_ · 33 archivos
**Cuándo:** Cuando el plazo se recorta o el cupo se topea según el MONTO pedido: los tramos por monto de rt=2. Ojo: no tocan el enganche (eso es de la categoría).
Doc: `server/data/flows/amount-tiers/doc.md` · Archivos: `server/data/flows/amount-tiers/map.json` · Padre: `creditopx`

### application — application  ·  _reference_ · 85 archivos
**Cuándo:** Cuando trabajás en el monolito Aliados (el que corre en prod): panel de administración, alta de entidades/comercios/sucursales, crons de cobranza y servicing, Inertia/Vue, rutas por audiencia admin/customer/api.
Doc: `server/data/flows/application/doc.md` · Archivos: `server/data/flows/application/map.json` · Padre: `architecture`

### architecture — Architecture  ·  _reference_ · 72 archivos
**Cuándo:** Cuando la duda es en QUÉ REPO vive algo, por qué está duplicado, o cómo se hablan entre sí: base de datos compartida, migraciones duplicadas, cutover al wizard nuevo, allowlist, SSO, VITE_API_URL. Índice de los repos.
Doc: `server/data/flows/architecture/doc.md` · Archivos: `server/data/flows/architecture/map.json` · Padre: `creditop`

### corbeta — Corbeta  ·  _reference_ · 28 archivos
**Cuándo:** Cuando la venta se cierra en caja física de un retail Corbeta (Alkosto 209 / K-Tronix 210 / Alkomprar 211, allied 24) — checkout ecommerce base64 → PIN de la API Fondos → factura en tienda → conciliación batch por PIN → estado 26 Facturado → confirmación diferida a Bancolombia (BNPL lender 68 / Consumo lender 100).
Doc: `server/data/flows/corbeta/doc.md` · Archivos: `server/data/flows/corbeta/map.json` · Padre: `aggregator`

### credifamilia — Credifamilia  ·  _reference_ · 134 archivos
**Cuándo:** Cuando la tarea toca Credifamilia (lender 24, el único response_type=4): radicación por SOAP, KYC V2 (Evidente/CrossCore/Jumio), plan de cuotas dinámico, o el gate local que hace que no aparezca en pruebas.
Doc: `server/data/flows/credifamilia/doc.md` · Archivos: `server/data/flows/credifamilia/map.json` · Padre: `entities`

### creditopx — CreditopX  ·  _reference_ · 14 archivos
**Cuándo:** Cuando la pregunta es por qué una entidad aparece o NO aparece en el listado, y con qué enganche, cupo y plazo. La cascada in-platform rt=2/3: reglas de grupo, datacrédito, categoría y cupo disponible.
Doc: `server/data/flows/creditopx/doc.md` · Archivos: `server/data/flows/creditopx/map.json` · Padre: `entities`

### dynamic-forms — Dynamic Forms  ·  _reference_ · 90 archivos
**Cuándo:** Cuando hay que agregar o cambiar un CAMPO del formulario por configuración: las tres generaciones de formulario dinámico, EAV user_field_values, tipos de documento por sucursal.
Doc: `server/data/flows/dynamic-forms/doc.md` · Archivos: `server/data/flows/dynamic-forms/map.json` · Padre: `formalization`

### ecommerce — Ecommerce  ·  _reference_ · 71 archivos
**Cuándo:** Cuando la solicitud entra desde el checkout de una tienda online (VTEX, WooCommerce, desarrollo propio) — hay credencial en `allied_ecommerce_credentials`, contrato base64 del carrito, `/vtex/init`+`/settel`, `ecommerce-request/create/{partner_id}`, notificación al comercio o “volver al comercio” (`return_url`/`process_url`).
Doc: `server/data/flows/ecommerce/doc.md` · Archivos: `server/data/flows/ecommerce/map.json` · Padre: `creditop`

### entities — Entities  ·  _reference_ · 50 archivos
**Cuándo:** Cuando la pregunta es qué ES un prestamista como dato: la fila lenders, sus tablas de configuración, y sobre todo el response_type (0/1/2/3/4) que despacha toda la plataforma. Alta de una entidad nueva.
Doc: `server/data/flows/entities/doc.md` · Archivos: `server/data/flows/entities/map.json` · Padre: `creditop`

### findings — Findings  ·  _reference_ · 24 archivos
**Cuándo:** Cuando algo NO funciona en el entorno LOCAL y querés saber si ya lo diagnosticamos — pantallas rotas sin mensaje, flujos que se traban, errores que el front se traga, o "esto que veo, ¿es real o es un mock?". También ANTES de invertir tiempo depurando un muro del harness: cada hallazgo trae síntoma, causa raíz verificada, evidencia y arreglo. Es un registro VIVO: al descubrir algo nuevo, se agrega una entrada acá.
Doc: `server/data/flows/findings/doc.md` · Archivos: `server/data/flows/findings/map.json` · Padre: `creditop`

### formalization — Formalization  ·  _reference_ · 84 archivos
**Cuándo:** Cuando el problema está DESPUÉS de elegir entidad: plan de pagos, documentos, pagaré, firma con OTP, autorización hasta el Estado 11 y desembolso.
Doc: `server/data/flows/formalization/doc.md` · Archivos: `server/data/flows/formalization/map.json` · Padre: `creditop`

### frontend-monorepo — frontend-monorepo  ·  _reference_ · 85 archivos
**Cuándo:** Cuando trabajás en el wizard React: pantallas y rutas del wizard, SSR, repositories, paquetes @creditop, data-testid para pruebas e2e, o a qué backend le pega cada pantalla.
Doc: `server/data/flows/frontend-monorepo/doc.md` · Archivos: `server/data/flows/frontend-monorepo/map.json` · Padre: `architecture`

### hardcodes-entidades — Hardcodes de entidades/comercios (deuda que frena la plataforma)  ·  _reference_ · 101 archivos
**Cuándo:** Cuando la tarea sea INTEGRAR / agregar / parametrizar una entidad (lender) o comercio (allied) nuevo, tocar el flujo de uno existente (Motai/Welli/Bancolombia/Corbeta/Pash/Credifamilia/Meddipay/etc.), o preguntarse por qué un flujo está QUEMADO / CABLEADO / ACOPLADO a un id, por qué CreditOp NO ESCALA o no es config-driven, o vayas a escribir un if por id / array de ids / branch por nombre de lender: el mapa de los 24 acoplamientos hardcodeados que impiden la integración por-config y lo que cuesta des-hardcodear cada uno. DOLOR: leelo ANTES de sumar otro hardcode.
Doc: `server/data/flows/hardcodes-entidades/doc.md` · Archivos: `server/data/flows/hardcodes-entidades/map.json` · Padre: `creditop`

### harness — Harness  ·  _reference_ · 68 archivos
**Cuándo:** Cuando la tarea es “necesito probar / ejercitar / mockear un flujo de originación E2E” — correr un triplete canal→comercio→lender de punta a punta, sembrar/inyectar un perfil aprobado, decidir qué se puede sellar localmente vs. qué lo decide una API externa, o levantar el demo del wizard (2 ventanas / panel).
Doc: `server/data/flows/harness/doc.md` · Archivos: `server/data/flows/harness/map.json` · Padre: `architecture`

### kyc — KYC  ·  _reference_ · 21 archivos
**Cuándo:** Cuando la tarea toca burós o datos de riesgo: score, Experian/Datacrédito, ingreso (Ágil Data, Mareigua, Quanto), identidad, AML, biometría, cifrado del reporte, o armar un usuario sintético para pruebas.
Doc: `server/data/flows/kyc/doc.md` · Archivos: `server/data/flows/kyc/map.json` · Padre: `onboarding`

### legacy-backend — legacy-backend  ·  _reference_ · 90 archivos
**Cuándo:** Cuando trabajás en el backend nuevo modular: módulos Onboarding/Loans/Identity/Partner/Risk, rutas /api/*, arquitectura V1 y V2, envelope code/message/data, o dónde poner un endpoint nuevo.
Doc: `server/data/flows/legacy-backend/doc.md` · Archivos: `server/data/flows/legacy-backend/map.json` · Padre: `architecture`

### merchants — Merchants  ·  _reference_ · 51 archivos
**Cuándo:** Cuando el problema es 'a este comercio le pasa distinto': configuración por entidad/comercio/sucursal, copia de reglas por sucursal, hash de entrada, credenciales de ecommerce, toggles del comercio.
Doc: `server/data/flows/merchants/doc.md` · Archivos: `server/data/flows/merchants/map.json` · Padre: `creditop`

### motai — Motai  ·  _reference_ · 59 archivos
**Cuándo:** Cuando la tarea es del comercio Motai (allied 158): modos compra/renting/alquiler, Ábaco (ingreso de apps gig) y los ifs quemados por id 158 que la task motai-v2 está sacando.
Doc: `server/data/flows/motai/doc.md` · Archivos: `server/data/flows/motai/map.json` · Padre: `merchants`

### ms-preapprovals — MS Pre-approvals  ·  _reference_ · 72 archivos
**Cuándo:** Cuando la pre-aprobacion de un lender rt!=0 falla o hay que tocar el microservicio Go (pre-approvals-service): contrato del servicio (check / me-check / lender-attempts / docs), workflow de 4 etapas, matriz de 8 proveedores (adapter+client+strategy por lender), taxonomia de errores, timeouts/cache DynamoDB, y el consumo cliente en el wizard/legacy.
Doc: `server/data/flows/ms-preapprovals/doc.md` · Archivos: `server/data/flows/ms-preapprovals/map.json` · Padre: `architecture`

### onboarding — Onboarding  ·  _reference_ · 83 archivos
**Cuándo:** Cuando el problema está ANTES del listado: entrada por hash de sucursal, registro de celular y OTP, creación de la user_request, formulario personal y laboral, captura del monto, códigos de error ONB0xx.
Doc: `server/data/flows/onboarding/doc.md` · Archivos: `server/data/flows/onboarding/map.json` · Padre: `creditop`

### payments — Payments  ·  _reference_ · 65 archivos
**Cuándo:** Cuando la pregunta es sobre cómo CreditOp habla con la pasarela de pago — Wompi o Payvalida: crear/firmar la transacción, el checkout, el polling o webhook de confirmación, la cuota inicial de formalización (el enganche antes de desembolsar, incl. el rebote rt=2 `initial_fee>0`), el recaudo del préstamo desde la pasarela, los links de pago, o credenciales de gateway.
Doc: `server/data/flows/payments/doc.md` · Archivos: `server/data/flows/payments/map.json` · Padre: `creditop` · Usa: `formalization`, `servicing`

### profiling — Profiling  ·  _reference_ · 30 archivos
**Cuándo:** Cuando el usuario cae en la categoría equivocada, o el cupo/enganche/plazo salen mal: las categorías rt=2 y sus reglas (ocupación, edad, salario, continuidad, score).
Doc: `server/data/flows/profiling/doc.md` · Archivos: `server/data/flows/profiling/map.json` · Padre: `creditopx`

### pullman — Pullman  ·  _reference_ · 13 archivos
**Cuándo:** Cuando la tarea es de Amoblando Pullman o su entidad CrediPullman (77): el caso rt=2 vanilla y el canónico para pruebas con usuario sintético, más sus hardcodes por allied_id 94.
Doc: `server/data/flows/pullman/doc.md` · Archivos: `server/data/flows/pullman/map.json` · Padre: `merchants`

### redirect — Redirect  ·  _reference_ · 24 archivos
**Cuándo:** Cuando el prestamista es solo un enlace (rt=0, UTM): se arma la url, se redirige al sitio del lender y se pierde visibilidad. Nadie decide el crédito adentro de CreditOp.
Doc: `server/data/flows/redirect/doc.md` · Archivos: `server/data/flows/redirect/map.json` · Padre: `entities`

### servicing — Servicing  ·  _reference_ · 60 archivos
**Cuándo:** Cuando el problema es DESPUÉS del desembolso (Estado 11): cartera, causación de interés, fecha de corte, mora, cobranza, pagos y cupo rotativo. Los 6 crons diarios y el ledger del préstamo. Ojo: corre 100% en application.
Doc: `server/data/flows/servicing/doc.md` · Archivos: `server/data/flows/servicing/map.json` · Padre: `creditop`

### smartpay — SmartPay  ·  _reference_ · 74 archivos
**Cuándo:** Cuando la tarea es de SmartPay: el celular financiado como garantía, IMEI, bloqueo de dispositivo y MDM, salto de AML, desembolso diferido y crons de bloqueo por mora.
Doc: `server/data/flows/smartpay/doc.md` · Archivos: `server/data/flows/smartpay/map.json` · Padre: `merchants`

### confirmacion-de-cupo — Confirmación de cupo (omite buró)  ·  _task_ · 6 archivos
**Cuándo:** Cuando la tarea toca el flujo 'Confirmación de cupo' / omitir Experian: el selector que salta el buró vía flow-signature (flow_id=2), las 2 APIs con verdicto en `code`, recortar lenders a rt=0, o la rama frontend de Miguel (contraparte del backend de Jose).
Doc: `server/data/flows/confirmacion-de-cupo/doc.md` · Archivos: `server/data/flows/confirmacion-de-cupo/map.json` · Padre: `creditop` · Usa: `onboarding`, `kyc`

### ecommerce-web-stateless — Ecommerce web stateless (→ wizard sin cookie)  ·  _task_ · 20 archivos
**Cuándo:** Cuando la tarea toca la migración de la originación de ecommerce (VTEX/Woo/self) al wizard STATELESS (sin cookie) en legacy-backend + frontend: PRs 795 (backend, en main) / 551 (frontend, en develop), el entry ecommerce/checkout, los endpoints de contexto, o el estado 'backend en main, front aún en develop'.
Doc: `server/data/flows/ecommerce-web-stateless/doc.md` · Archivos: `server/data/flows/ecommerce-web-stateless/map.json` · Padre: `creditop` · Usa: `ecommerce`, `onboarding`, `payments`, `architecture`

### fix-min-income — Fix min_income (piso de ingreso NO-OP)  ·  _task_ · 6 archivos
**Cuándo:** Cuando la tarea toca el bug min_income: la columna real es `lender_users_category_rules.monthly_income` pero los motores leen `$rule->min_income` (inexistente→null) → el piso de ingreso de categorías nunca filtra (pasa siempre); arreglarlo endurece la asignación de categoría rt=2.
Doc: `server/data/flows/fix-min-income/doc.md` · Archivos: `server/data/flows/fix-min-income/map.json` · Padre: `creditop` · Usa: `profiling`, `onboarding`

### motai-v2 — Motai v2  ·  _task_ · 56 archivos
**Cuándo:** Task en curso: des-motaizar la originación de Motai — sacar los ifs por id 158 y los modos, y moverlos a configuración por columna en base de datos.
Doc: `server/data/flows/motai-v2/doc.md` · Archivos: `server/data/flows/motai-v2/map.json` · Padre: `creditop` · Usa: `motai`, `creditopx`, `merchants`, `dynamic-forms`, `kyc`
