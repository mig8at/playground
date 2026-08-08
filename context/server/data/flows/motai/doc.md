# Motai · contexto
> **estado:** al día con **`qa`** (PR #1020 des-motaización + #1028 Ábaco, mergeados el 2026-07-29) · Comercio aliado **158**, con **un lender por producto** (`lenders.product` = `credit` | `renting` | `rto`) y **Ábaco** (ingresos de apps gig) como paso **configurable por lender**. Ya **no hay modos**: `allied_modes`/`user_request_modes` se borraron (código y tablas). Si venís de la v1 y buscás `isMotaiRenting`, `merchant_mode` o `partner_modes`, **no existen**.

> ⏳ **PENDIENTE DE MERGE — este nodo describe la v2, que vive en `qa` y NO en `main`.**
> Verificado el 2026-07-31: **14 archivos** que este nodo cita no existen en `main` ni en `develop`
> (`AbacoRequirementController` · `AbacoStepResolver` · `AbacoStepSettings` · `AbacoStepStateRepository` ·
> `AbacoRequirementService` · `DynamicFormRequirementController` · `DynamicFormRequirementService` ·
> `DynamicFormStepResolver` · `LenderRequirement` · `LenderRequirementRepository` + su interfaz ·
> `AlliedDocument` · `FormulaCalculator` · `abaco-attempt-state.ts`). Están en **`qa`**.
> Se sacaron de `files[]` para que el oráculo no dropee — sus rutas siguen citadas en prosa en
> *Dónde mirar*, así que no se perdió ningún puntero.
> **Al mergear `qa` → `main`:** devolver esas rutas a `files[]`, correr el oráculo y **borrar esta marca**.
>
> Mientras esto siga acá: lo que el nodo describe **no es lo que corre en producción**. Si la tarea es
> sobre lo que hay hoy en `main`, mirá la v1 (modos) en el historial: `git log -- server/data/flows/motai`.

## Qué es
**Motai** es un **COMERCIO** aliado colombiano (`allied_id = 158`), no un lender ni un `response_type`. Ofrece **varias líneas de producto** sobre el mismo wizard de originación. Apunta a población **gig/migrante** (trabajadores de plataformas Rappi/DiDi/Uber y migrantes con **PEP = Permiso Especial de Permanencia**) que no tiene historial en el buró colombiano; por eso su rasgo central es un **underwriting alternativo por ingresos gig (Ábaco)**.

> **Colisión de id `158`:** el número es **ambos** — el **allied 158** (el comercio, este nodo) y el **lender 158** ("Motai Renting", `response_type=2`, CreditopX in-platform). Entidades distintas en tablas distintas que comparten número.

**Cómo se pasó de modos a config (el cambio de la v2).** Antes la variante la elegía un **modo del comercio** (`allied_modes`, con `isMotaiRenting` y `merchant_mode` cableados por todo el flujo). Hoy **cada producto es un lender** con su configuración, y las decisiones salen de columnas/tablas en vez de `if`s por id:

| Qué decide | Antes (v1) | Ahora (v2) |
|---|---|---|
| Qué producto es | modo del comercio (`allied_modes.code`) | **`lenders.product`** (`credit`/`renting`/`rto`) |
| Si pide Ábaco | `AlliedMode.config['isAbacoRequired']` del modo activo | **`lender_requirements.abaco_is_enabled`** (por lender) |
| Qué calcula la cuota | fórmula quemada y duplicada en el front | **`lenders.calculator`** (json) evaluado en backend |
| Tipos de documento (PEP) | `if merchantMode === 'motai-renting'` en el front | **`lenders_by_allied_branches.document_types`** por sucursal |
| Los TyC | ids quemados | tabla **`allied_documents`** por comercio |
| Quién dirige el flujo | el front, por strings de modo | el **backend**, por **`next_step`** |

⚠ **El padrón de lenders difiere por ambiente** y eso ya confundió: en **dev/qa** Motai tiene `62` (*Motai X*, credit) y `158` (*Motai Renting*, renting); en el **dump local** hay `168/169/170` (*Motai C/R/RB* = credit/renting/rto) y los ids 169/170 de dev son **otros lenders de otros comercios**. Nunca asumas que un id significa lo mismo en los dos lados: mirá `lenders.product`.

## Contenido

### El flujo lo dirige el backend por `next_step`
El self-service tiene **un único punto de entrada**: el front pregunta el paso y **obedece**. `POST /api/loans/customer/requests/confirm` → `CreditopXFlowService::getNextStepData` resuelve, en este orden, leyendo `lender_requirements`:

```
confirmación → [formulario dinámico] → [ábaco] → validación de identidad
```

Cada paso se **prende/apaga por lender** (`dynamic_form_is_enabled` + `dynamic_form_type_id` · `abaco_is_enabled`). Para un lender sin fila en `lender_requirements` los resolvers devuelven `null` y el flujo sigue a identidad **exactamente como antes** (cero cambio de comportamiento). El **formulario dinámico no lo sirve legacy**: el backend solo dice "es el `form_type_id` X" y quien entrega/recibe el formulario es el MS **form-service** (ver nodo `form-service`).

### Ábaco: paso configurable, con reintentos, que no bloquea
**Cómo se decide.** `POST abaco/check-requirement` (alias *deprecated*: `motai/check-abaco-requirement`) → `AbacoRequirementService`: **`lender_requirements.abaco_is_enabled` es la FUENTE ÚNICA**. Devuelve `MOTV1001` (requiere) / `MOTV1000` (no) / `MOTV1002` (error). Ya **no** mira el modo (borrado) ni el `product` (fue el puente transitorio de la des-motaización, reemplazado por la tabla; `product` sigue vivo para la calculadora y la UI).

**El sub-flujo gig** (rutas `prefix scraping`): `GET platforms` → `POST init/gig-economy` (JWT + cookie `sessionid`) → `login/step-1` → `login/step-2` (OTP de la plataforma gig) → `POST results`. Scrapea earnings de Uber/DiDi/Yango/inDrive/Rappi/DiDiFood, los **promedia** (`average_income`) y persiste un resumen por plataforma en `UserSummary.abaco`. Códigos por endpoint `ABAC1001–6004`. Ábaco es proveedor **EXTERNO** (CreditOp solo integra su API; cliente `Abaco.php`, **mock en env `local`** vía `AbacoFixture::generateDynamicMock`).

**Reintentos y salida garantizada (v2).** `AbacoStepResolver` muestra el paso solo si está habilitado **Y** no está completado **Y** quedan intentos. `AbacoStepSettings` lee `max_attempts` del setting `abaco_config` (**fallback 3**). El estado vive en **una** fila de `user_request_additional_information` con `type_data = 'Abaco step state'` y `data_json = {attempts, status, last_attempt_at}` (no choca con `'Abaco results'`).
- **Cuenta intento fallido:** `ABAC2004` (init), `ABAC4005` (login step-2), `ABAC5004` (results).
- **Marca completado:** `results` OK (`ABAC5001`), **haya dado resultado positivo o negativo** — recolectó y guardó, el paso se cumple.
- Al agotarse los intentos o completarse, el `next_step` deja de ser `abaco` y el flujo **sale solo** a identidad: Ábaco **nunca deja atrapado** al usuario.

**Ábaco sigue sin DECIDIR.** `average_income` se computa y persiste pero **ningún path de decisión lo lee** — captura informativa. Lo que la v2 agregó es *trazabilidad del paso* (intentos/estado), no una decisión de riesgo.

### La calculadora ahora vive en el backend
`lenders.calculator` (json, nullable) guarda la fórmula **de cada lender** y `App\Support\FormulaCalculator` la evalúa con **symfony/expression-language** — sin `eval`, pasando solo escalares y con un `guard()` que prohíbe llamadas a función y limita la expresión a aritmética. `null` = **identidad** (el default de `credit`: devuelve el monto tal cual). El listado adjunta `calculated` por lender y el front **solo lo lee** (antes la fórmula estaba quemada y duplicada en dos lugares del front). Hay además un endpoint **`recalculate`** liviano para cuando cambia el monto: la elegibilidad y el cupo del pre-aprobado no dependen del monto pedido, solo la cuota.

Config real del 158 (dev/qa): `{"params":{"setup_fee":1500000,"margin":1,"tax":0.19},"formulas":{"amount":"(amount + setup_fee) * (1 + margin) * (1 + tax)"}}` → `4.534.000 → 14.360.920`.

> **Dependencia con versión atada:** `symfony/expression-language` está fijado en **`^7.4`** y el `composer.json` declara `config.platform.php = 8.3`. La v8.1 exige PHP ≥ 8.4 y rompía el build de los ambientes (que corren 8.3): se subió por error y lo corrigió Joel (PR #1026). No lo vuelvas a subir de versión sin mirar el PHP de los ambientes.

### Por qué la distinción legal importa (y no es cosmética)
El techo de **usura** aplica al crédito, no al arrendamiento. Sin opción de compra el cliente **nunca es dueño**: paga por *usar* la moto y la devuelve, así que no hay capital que amortizar → **no hay interés** → no es crédito → no le aplica el techo. Con opción de compra sí hay saldo, sí hay interés, y el PRD de Manuela lo dice con sus palabras: *"esencialmente **un crédito disfrazado de arriendo**"*.

Eso se ve en la propia calculadora (`Calculadora Renting VF.xlsx`), que trata el **mismo 1,8%** de dos maneras:

| pestaña | cómo lista el 1,8% | qué es |
|---|---|---|
| **Renting** (devuelve el bien) | "Tasa mensual · **Parámetro**" | fija un **precio**: amortiza el precio de venta a 24 meses y prorratea `÷30 ×7`. No es interés |
| **Rent to Own** (se queda el bien) | "Tasa mensual · **Equivale a ~0,4125% semanal**" | tasa de verdad, convertida y aplicada a un saldo |

De ahí sale el **+1,11%** entre los dos productos que se venía anotando como pregunta abierta: no es una conversión mal hecha — es que en el arrendamiento **no hay nada que convertir**. El prorrateo lineal es una decisión de precio.

**Cómo la hoja logra no cobrar interés (verificado celda por celda).** Lo más contundente es lo que NO está: la pestaña Renting **no tiene columna "Interés"**, y su tabla entera es una sola fórmula — `C21 = VLOOKUP(plan) * IF(semana<=C18,1,0)`, o sea repetir la tarifa las semanas del plan y cero después. La de Rent to Own sí trae `Saldo Inicial | Capital | INTERES | Cuota | Saldo Final` (`C24=saldo · D24=PPMT · E24=IPMT · G24=saldo final`).

Cuatro movidas:

1. **La plata está en el PRECIO.** `C6 Margen = (C4+C5)*D6` con `D6 = 1,0` → **duplica** la base. 4.534.000 de costo + 1.500.000 de alistamiento → precio de venta **14.360.920** = **3,17× el costo de la moto**. Toda la compensación por el tiempo va ahí, y un precio no es interés.
2. **El PMT es un divisor, no una amortización.** `C14 = -PMT(C10,24,C8)/30*7`. Dividir el precio en 24 daría 598.372; el PMT da 742.184 — **+24%**. El 1,8% solo agranda el pedazo.
3. **No hay saldo.** Sin saldo no existe base a la cual aplicar un porcentaje. El cliente no debe: paga por usar.
4. **El contrato dura 1, 4 o 12 SEMANAS** (`C18 = IF(plan="Semana",1,IF(plan="Mes",4,12))`). Los 24 meses del PMT **solo viven dentro de la fórmula del precio** — no son el plazo. Máximo tres meses, renovable: no hay obligación de largo plazo que leer como financiación.

**La tabla del `VLOOKUP`: el plazo cambia el precio de la semana** (verificado en `Calculadora Renting VF (2).xlsx`, 2026-07-30). Se paga **siempre semanal** (`D12`: *"Siempre son pago semanales"*); lo que el plan mueve es cuánto vale esa semana. La **base es la fila del Mes** y las otras dos cuelgan de ella:

| plan | celda | fórmula | factor | ejemplo (precio 15.470.000) |
|---|---|---|---|---|
| Semana | `C13` | `C14 * D13` | **1,25** | 233.188,23 |
| **Mes** | `C14` | `-PMT(1,8% ; 24 ; precio)/30*7` | **1,00** (base) | 186.550,59 |
| Trimestre | `C15` | `C14 * D15` | **0,94** | 175.357,55 |

Alquilar una sola semana sale **25% más caro** y comprometer un trimestre trae **6% de descuento** — eso es lo que el selector de plan de la card tiene que comunicar. Reproducido con `App\Support\FormulaCalculator` con delta < 0,0001 en las tres. Vive en `lenders.calculator` de 158 (`plans[].factor`), sembrado por `2026_07_30_120000_seed_motai_renting_plans_calculator`.

> **Límite de lo verificable acá:** la hoja muestra el **mecanismo**, no si alcanza legalmente. Si el arrendamiento se recaracteriza como crédito encubierto es una opinión jurídica (legal de CreditOp), no algo deducible de un Excel. Lo verificado es que **la hoja no calcula interés**.

> ⚠ **Consecuencia para quien toque la calculadora:** "arreglar" el prorrateo del renting para que use la conversión compuesta **no es un fix**, es recaracterizar el producto. Si alguien lo hace, el arrendamiento pasa a tener una tasa y con eso entra al perímetro del crédito. En `playground/engine` la constante se llama **`anchorRate`** y no `monthlyRate` justamente para que nadie la confunda con una tasa de interés.

**Ilustración (no es la tasa del producto, es lo que se vería si alguien lo recaracterizara).** Pagar la tarifa semanal de 173.176 durante 104 semanas sobre un precio de venta de 14.360.920 implicaría **26,27% E.A.**, contra el **23,87% E.A.** real del rent-to-own. El arrendamiento sale *más caro* en términos implícitos — que es exactamente el margen que la estructura permite.

> ⚠ **La terminología del código está invertida respecto del PRD** (gotcha C1): el `renting` **del código** es el *rent-to-own* del PRD (**es crédito**), y lo que el PRD llama *renting operativo* (**no es crédito**) es el alquiler puro. O sea que **Ábaco aplica al producto que legalmente SÍ es un crédito**. Las hojas de `playground/engine` usan los nombres del PRD, no los del código.

### Decisión manual + cierre
La decisión del renting **sigue siendo manual**: el asesor la toma en la pantalla de perfil financiero (`financial-profile.repository.ts` → `POST motai/update-status`, `approve` booleano; el ingreso que muestra viene de `FINANCIAL_HEALTH_API_URL`, **≠** Ábaco) → `BackDoorUserService`: aprobado ⇒ `targetStatus=11` + voucher; rechazado ⇒ `9`. El cierre CreditopX estándar (OTP/pagaré/ADO/Estado 11 `authorize`) es del tronco **CreditopX**; la copia de reglas por sucursal, del padre **Merchants**.

## Dónde mirar
- **Config por lender / requisitos** (legacy): `app/Models/LenderRequirement.php` · `LenderRequirementRepository.php` + su interfaz · migraciones `..._create_lender_requirements_table.php` (+ los dos `add_dynamic_form_*`) · `..._backfill_abaco_is_enabled_from_lender_product.php` (traduce la verdad vieja al modelo nuevo) · `..._drop_allied_modes_and_user_request_modes_tables.php` (cierra la des-motaización).
- **Motor de pasos por `next_step`** (legacy): `CreditopXFlowService.php` (`getNextStepData`, orden formulario → ábaco → identidad) · `DynamicFormStepResolver.php` + `DynamicFormRequirementService.php` · `AbacoStepResolver.php` + `AbacoStepSettings.php` + `AbacoStepStateRepository.php`.
- **Gate + flujo Ábaco** (legacy): `AbacoRequirementService.php` (MOTV, fuente única = tabla) + `AbacoRequirementController.php` · `AbacoController.php` · `AbacoService.php` (`ABAC*`, cuenta intentos y marca completado) · `AbacoParserService.php` (`average_income`, `UserSummary.abaco`) · `Abaco.php` (mock local) + `AbacoFixture.php` · requests `Abaco/{AbacoLogin,Init,Results,AbacoWebhook}Request.php` + `MotaiAbacoRequirementRequest.php` · `Modules/Onboarding/routes/api.php` (prefijos `abaco` y `scraping`) · `config.php` (`ABACO_*`) · settings `..._add_abaco_settings…` · columna `..._add_abaco_column_to_user_summaries…` · `UserSummary.php`.
- **Productización y calculadora** (legacy): `app/Support/FormulaCalculator.php` (evaluación segura, sin `eval`) · `app/Models/Lender.php` (`product`, `calculator`) · `LendersByAlliedBranch.php` (`document_types`) · `app/Models/AlliedDocument.php` · `LenderListingService.php` (adjunta `calculated`/`product`, y el endpoint `recalculate`) · migración `..._add_motai_v2_columns.php`.
- **Front Ábaco**: módulo `modules/…/abaco/` (use-cases `check-abaco-requirement`/`initialize-flow`/`fetch-platforms`/`request-otp`/`verify-otp`/`get-results`, `abaco-context.tsx`, `abaco.repository.ts`, `abaco-attempt-state.ts` = los reintentos) + rutas `app/routes/abaco/{index,layout,platforms,platform-otp-validation,internal-error}.tsx`.
- **Front calculadora + decisión**: `LenderCardContent.tsx` / `useLenderSelection.ts` / `AvailableLenders.tsx` (**leen** `calculated`, ya no calculan) · `financial-profile.repository.ts` (decisión manual) · `loan-confirmation.tsx` (maneja `next_step`, incluido `dynamic_form`).
- **application** = solo scaffolding de esquema (2 migraciones abaco portadas), **cero lógica** — nada que migrar desde ahí.

## Gotchas / riesgos
- **Ábaco NO cablea la decisión**: `average_income` es dato huérfano y el front solo usa el booleano `completed`; la "validación de ingresos" no valida. El PRD MVP2 lo quiere cablear + **revertir el bypass** (Datacrédito 100%): es greenfield, no un toggle.
- **`lender_requirements` nace VACÍA y con `abaco_is_enabled = false`.** Un lender sin fila no pide Ábaco. Por eso la migración de la v2 hace **backfill** desde `product IN ('renting','rto')`: sin eso, mover la decisión a la tabla apagaría Ábaco en silencio (`MOTV1001` → `MOTV1000`) sin que nadie tocara config.
- **El endpoint viejo (`motai/check-abaco-requirement`) todavía NO se puede deprecar**: el front lo sigue consumiendo en `api/validation-status`, `identity-validation-status` y `loan-continue` (solo `loan-confirmation` migró a `next_step`). Se dejó como alias a propósito.
- **`GET init/gig-economy` está ROTO** (`AbacoController` llama `initGigEconomyFromToken()`, inexistente en el service); solo el `POST` funciona.
- **Webhook `scraping.completed` = NO-OP**: dispatch comentado, solo loguea; además `webhook_enabled=false` por defecto → la finalización se detecta por **polling** del front.
- **En dev/qa no hay mock de Ábaco** (`mock_pass` solo se usa en `local`): el login va al proveedor **real**, así que con usuario sintético `login/step-2` devuelve `ABAC4005` y la plataforma queda en `error`. **Eso no es un bug** — y encima ejercita el contador de intentos. El camino feliz completo solo se ve en `local` con `bin/mock-abaco`.
- **PEP migratorio ≠ PEP AML**: aquí PEP = Permiso Especial de Permanencia (migrante gig); el literal `'PEP'` no dispara consulta a centrales. En el AML de TusDatos "PEP" = Persona Expuesta Políticamente.
- **Terminología invertida** (C1): el `renting` del código = el *rent-to-own* del PRD (se queda el bien). Fijar diccionario (memoria `nomenclatura-negocio`).
- **Que el lender esté asociado a la sucursal NO alcanza para que liste**: si no tiene `group_rules` propias en esa sucursal, el listado sale **vacío** (ver `findings` **F-75**). Es config de datos, no código.
- **IMEI / device-lock (MDM)** es el cierre de la **compra de celulares** del allied Motai, árbol separado sin cruce con Ábaco — fuera de este nodo (patrón afín en **SmartPay**).

## Enlaces
- Padre: **Merchants** (alta/config/copia de reglas). Hermanos: **SmartPay**, **Pullman**. Tronco in-platform: **CreditopX**; buró/identidad: **kyc**; perfilamiento: **Profiling**; cierre legal: **Formalization**; el formulario dinámico del paso: **form-service**.
- Simulador: playground/flow (comercio seed "Motai") y `playground/engine` (las dos líneas con su `legalNature`).
- Memorias: `modelos-canales-flujos`, `abaco-gig-scraping`, `motai-plan-evolucion`, `nomenclatura-negocio`. Fuente profunda: `git 159906a:docs/codigo/MOTAI-FLUJO-ANALISIS.md`.
