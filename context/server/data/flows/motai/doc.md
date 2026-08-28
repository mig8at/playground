# Motai · contexto
> **verificado contra `main` el 2026-08-20.** `qa` se mergeó a `main` el 2026-08-19/20 (backend PR #1150 y #1169 · front #856 y #861), así que **la v2 que este nodo describe es lo que corre**. Se re-leyeron en `main`: `AbacoStepResolver`, `AbacoConsultRepository`, `IncomeBreakdownService`, `MonthlyIncomeResolver`, `LenderCalculator`/`FormulaCalculator`, `CalculatorPaymentScheduleService`, `AlliedInfoController`, `RegisterCellPhoneService::storeTermsAndConditions` y las rutas de Ábaco; y se midió contra la **BD de producción** el padrón de entidades, la configuración por sucursal y el ledger de migraciones. Lo que no se re-auditó línea por línea (los códigos `ABAC*` endpoint por endpoint, el detalle del front) viene de la verificación del 2026-07-29 contra `qa`, que hoy es ancestro de `main`.
>
> Comercio aliado **158**, con **un lender por producto** (`lenders.product`) y **Ábaco** (ingresos de apps gig) como paso **configurable por lender**. Ya **no hay modos**: `allied_modes`/`user_request_modes` se borraron (código y tablas). Si venís de la v1 y buscás `isMotaiRenting`, `merchant_mode` o `partner_modes`, **no existen**.

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
| Qué documentos se firman | plantillas por convención de nombre | **`lender_signing_documents`** (→ ver **codeudor**) |
| Quién dirige el flujo | el front, por strings de modo | el **backend**, por **`next_step`** |

## Antes de concluir
- **El ingreso de Ábaco YA alimenta la decisión** — esto cambió en agosto y es lo contrario de lo que valía antes. `IncomeBreakdownService` persiste el consolidado gig como **ingreso informal** (campo 235) y `MonthlyIncomeResolver` resuelve `formal + informal` para la política; lo consume **`LenderUserCategoryService`** (el motor de categorías) y `DebtSummaryService`. Si venís con «Ábaco es informativo, no decide», eso ya no es cierto. Lo que sigue sin existir es una **regla de negocio propia de Ábaco** (umbrales, rechazo por ingreso gig): lo que hay es el ingreso entrando por la puerta de siempre.
- ⚠ **El campo de ingreso mensual (87) nunca se sobreescribe con 0**, y la lectura cae a él solo cuando `formal + informal` da 0. Las dos condiciones son excluyentes a propósito: la política no depende de que la escritura haya ocurrido. Si «arreglás» una de las dos mitades sin la otra, rompés esa simetría.
- **Ábaco ya NO cuenta intentos: ahora vale por VIGENCIA.** `AbacoStepResolver` muestra el paso si el lender lo tiene encendido **y** el usuario no tiene una consulta viva en `risk_central_user_data` (**1 mes**, igual que Experian/Mareigua). Desaparecieron `AbacoStepSettings` y `AbacoStepStateRepository` con su fila `'Abaco step state'`. El contador de intentos que quedó vivo es **del front** (`abaco-attempt-state.ts`), no del motor de pasos.
- **`GET scraping/init/gig-economy` ya NO está roto.** Se implementó `initGigEconomyFromToken()` en vez de borrar la ruta (el cliente y el contrato del proveedor ya existían). Si un nodo o una tarea lo cita como roto, está viejo.
- **`lender_requirements` nace VACÍA y con `abaco_is_enabled = false`.** Un lender sin fila no pide Ábaco. Por eso la migración de la v2 hace **backfill** desde `product IN ('renting','rto')`: sin eso, mover la decisión a la tabla apagaría Ábaco en silencio (`MOTV1001` → `MOTV1000`) sin que nadie tocara config.
- ⚠ **`lenders_by_allied_branches.document_types` nace NULL en las filas NUEVAS, y ahí se pierde el PEP.** El backfill cubrió las filas que existían ese día; toda fila creada después (una sucursal nueva, o una entidad reasignada desde el admin) nace sin valor, `AlliedInfoController::resolveAllowedDocumentTypes` cae al piso `["CC","CE"]` y el selector del formulario **deja de ofrecer PEP** — sin error, sin log. Medido en producción el 2026-08-20: pasó en una sucursal creada ese mismo día mientras las otras cuatro sí lo tenían. Es **F-76**, y sigue vivo: antes de depurar «desapareció el PEP», mirá la fila de esa sucursal.
- **El endpoint viejo (`motai/check-abaco-requirement`) todavía NO se puede deprecar**: sigue en `routes/api.php` marcado *DEPRECATED* como alias de `abaco/check-requirement` porque el front lo consume desde varios puntos.
- **Webhook `scraping.completed` = NO-OP**: `webhook_enabled = false` por defecto → la finalización se detecta por **polling** del front.
- **En dev/qa no hay mock de Ábaco** (`mock_pass` solo se usa en `local`): el login va al proveedor **real**, así que con usuario sintético `login/step-2` devuelve `ABAC4005` y la plataforma queda en `error`. **Eso no es un bug**. El camino feliz completo solo se ve en `local` con `bin/mock-abaco`.
- **PEP migratorio ≠ PEP AML**: aquí PEP = Permiso Especial de Permanencia (migrante gig); el literal `'PEP'` no dispara consulta a centrales. En el AML de TusDatos "PEP" = Persona Expuesta Políticamente.
- **Terminología invertida** (C1): el `renting` del código = el *rent-to-own* del PRD (se queda el bien). Fijar diccionario (memoria `nomenclatura-negocio`).
- **Que el lender esté asociado a la sucursal NO alcanza para que liste**: si no tiene `group_rules` propias en esa sucursal, el listado sale **vacío** (ver `findings` **F-75**). Es config de datos, no código.
- ⚠ **Renting y Rent to Own NO se diferencian por `product` ni por la calculadora: se diferencian por el CATÁLOGO DE DOCUMENTOS.** Los dos corren como `product = 'renting'` con matriz `plans`, mismo `response_type`, mismo wizard y mismo `next_step`. Si vas a buscar la diferencia en el código del flujo, no está ahí — está en `lender_signing_documents` y en la política de codeudor de las categorías. → § «Renting y Rent to Own».
- **IMEI / device-lock (MDM)** es el cierre de la **compra de celulares** del allied Motai, árbol separado sin cruce con Ábaco — fuera de este nodo (patrón afín en **SmartPay**).

## El padrón de entidades y su config difieren POR AMBIENTE — y no solo los ids
Esto ya confundió más de una vez, y en agosto se volvió más peligroso porque ahora lo que difiere es **la fórmula que cotiza**, no solo el número:

| | producción | dev/qa | dump local |
|---|---|---|---|
| entidades del comercio | `62` Motai X (credit) · `158` Motai Renting · **`193` Rent to Own** | `62` · `158` · **`205` Rent to Own** | `168/169/170` (Motai C/R/RB) |

**Nunca asumas que un id significa lo mismo en los dos lados: mirá `lenders.product`** (y ojo: los ids 169/170 del dump local son **otras** entidades en dev).

⚠ **Y la calculadora del Rent to Own NO es la misma en los dos ambientes.** Medido el 2026-08-20: producción y qa tienen tasas distintas, y la configuración de cada uno la puso una **migración que no existe en el repositorio** (ni en una rama ni en el historial). O sea que **lo que valides en un ambiente no predice el otro**, y la config de producción no se puede reconstruir desde el código. Antes de conciliar un número contra el Excel, mirá contra qué ambiente estás midiendo.

⚠ **El "Rent to Own" es un CLON del renting, no un producto nuevo.** La migración que lo crea copia la fila entera del 158 —calculadora incluida— y deja **`product` en `'renting'` a propósito**: así el clon se comporta idéntico de punta a punta (la card lo dibuja con el layout de renting, el `calculator` expone `plans`, y el plan de pagos despacha por la **matriz** del calculator, no por `product`). Consecuencia práctica: **la rama `terms` de la calculadora sigue sin ejercitarse en ningún ambiente**. Pasarlo a `'rto'` es un `UPDATE` de un campo el día que se quiera. Lo que la migración **no** clona: categorías de usuario y sus reglas (ahí vive `min_initial_fee`), credenciales, ciudades, métodos de pago y requisitos — hay que configurarlos a mano.

## El flujo lo dirige el backend por `next_step`
El self-service tiene **un único punto de entrada**: el front pregunta el paso y **obedece**. `POST /api/loans/customer/requests/confirm` → `CreditopXFlowService::getNextStepData` resuelve, en este orden, leyendo `lender_requirements`:

```
confirmación → [formulario dinámico] → [ábaco] → validación de identidad
```

Cada paso se **prende/apaga por lender** (`dynamic_form_is_enabled` + `dynamic_form_type_id` · `abaco_is_enabled`). Para un lender sin fila en `lender_requirements` los resolvers devuelven `null` y el flujo sigue a identidad **exactamente como antes** (cero cambio de comportamiento). El **formulario dinámico no lo sirve legacy**: el backend solo dice "es el `form_type_id` X" y quien entrega/recibe el formulario es el MS **form-service** (ver nodo `form-service`).

## Ábaco: paso configurable, con vigencia, que no bloquea
**Cómo se decide.** `POST abaco/check-requirement` (alias *deprecated*: `motai/check-abaco-requirement`) → `AbacoRequirementService`: **`lender_requirements.abaco_is_enabled` es la FUENTE ÚNICA**. Devuelve `MOTV1001` (requiere) / `MOTV1000` (no) / `MOTV1002` (error). Ya **no** mira el modo (borrado) ni el `product` (fue el puente transitorio de la des-motaización; `product` sigue vivo para la calculadora y la UI).

**El sub-flujo gig** (rutas `prefix scraping`): `GET platforms` → `POST init/gig-economy` (JWT + cookie `sessionid`) → `login/step-1` → `login/step-2` (OTP de la plataforma gig) → `POST results`. Scrapea earnings de Uber/DiDi/Yango/inDrive/Rappi/DiDiFood, los **promedia** (`average_income`) y persiste un resumen por plataforma en `UserSummary.abaco`. Códigos por endpoint `ABAC1001–6004`. Ábaco es proveedor **EXTERNO** (CreditOp solo integra su API; cliente `Abaco.php`, **mock en env `local`** vía `AbacoFixture::generateDynamicMock`).

**Cuándo se muestra el paso, y cuándo deja de mostrarse.** `AbacoStepResolver` pide dos cosas: lender encendido **y** sin consulta viva. La consulta se registra en `risk_central_user_data` y **vale un mes** (`AbacoConsultRepository::hasRecentConsult`), con la misma política de reemplazo que Mareigua/Experian: una sola consulta viva por usuario. Con consulta viva el `next_step` salta a identidad — Ábaco **nunca deja atrapado** al usuario, y tampoco se reconsulta (ni se re-factura) dentro del mes.

**Qué hace con el ingreso.** Al cerrar `results` OK, `AbacoService` llama a `IncomeBreakdownService`, que escribe el **informal** (campo 235) **siempre, incluso en 0** — «pasó por Ábaco y no aportó ingreso» es información distinta de «nunca pasó» — y el **formal** desde la primera central con monto real (agildata → mareigua → quanto). Esa escritura corre en un `try/catch` propio a propósito: fallar registrando el desglose no debe convertir un `ABAC5001` en un `ABAC5004` cuando el scraping ya se guardó.

**(2026-08-28)** Ábaco ganó una **tercera ruta hermana**: `POST abaco/sync-results`
(`AbacoSyncResultsController`, commits `04e0f8ea`/`1a8277d4`). Existe porque el polling del front no
tiene el `customerId` que exige el `scraping/results` del proveedor: esta ruta se direcciona por
`userRequestId` como sus hermanas, **resuelve el customer por dentro y empuja el scraping pendiente**.
El front la consume desde `sync-abaco-results.uc.ts`. Verificado contra `main` (ruta + controller +
compuerta cubierta por test).

## La calculadora vive en la base de datos, y es UNA sola
`lenders.calculator` (json, nullable) guarda la fórmula **de cada lender**. `App\Support\FormulaCalculator` la evalúa con **symfony/expression-language** — sin `eval`, pasando solo escalares y con un `guard()` que prohíbe llamadas a función y limita la expresión a aritmética. `null` = **identidad** (el default de `credit`: devuelve el monto tal cual).

Encima vive **`App\Support\LenderCalculator`**, que es lo que hay que conocer para tocar esto: si el config declara una **matriz** (`plans` para renting, `terms` para rto) corre la fórmula **una vez por fila**, inyectando en el scope cada valor numérico de la fila (así `factor` modula el `payment` sin que el evaluador sepa qué es un plan) y devuelve un `LenderCalculation` con los escalares, las opciones y su `payment` ya resuelto. Existe porque el cálculo lo necesitan **tres** consumidores y dos implementaciones del mismo número es exactamente cómo el PDF y la app terminaron diciendo cosas distintas:

| consumidor | qué produce | detalle que importa |
|---|---|---|
| `LenderListingService` | el `calculated` de la card, y el endpoint liviano `recalculate` | **se traga los errores**: si el config está mal degrada a `{amount}` en vez de tumbar el listado |
| `CalculatorPaymentScheduleService` | el plan de pagos que ve el cliente y el que imprime el PDF | pasa además `initial_fee_percentage` desde la categoría del usuario |
| `CalculatorAuthorizationAmounts` | los montos que se persisten al autorizar y los que imprime el contrato | |

⚠ **El input SIEMPRE es `original_amount`, nunca `amount`.** La fórmula `amount` es acumulativa: `amount` guarda el resultado de una corrida previa (para renting, el precio ya inflado), así que alimentarla con él lo vuelve a inflar **sin error y sin que nadie lo note**.

⚠ **Las fórmulas se guardan como LISTA, no como objeto.** Las columnas `JSON` de MySQL **no conservan el orden de las claves de un objeto** (las reordenan por longitud y después por bytes), y el encadenamiento depende del orden: con `{amount, initial_fee, payment}` volvía `{amount, payment, initial_fee}` y `payment` se evaluaba antes de que `initial_fee` existiera → *«Variable initial_fee is not valid»*. El formato canónico es `"formulas": [{"name": …, "expression": …}, …]`; el objeto se sigue aceptando para configs viejas, pero **para config nueva, siempre lista**.

**La cuota inicial se aplica sobre el PRECIO, no sobre el costo** — asimetría deliberada respecto del crédito, donde se descuenta del original. En renting el cliente no financia el costo del equipo: alquila a un precio, y la inicial es un abono contra ese precio. El porcentaje sale de `lender_users_categories.min_initial_fee` y **los inputs le ganan a los `params`**, así que la config es el piso y la categoría manda cuando existe.

> **Dependencia con versión atada:** `symfony/expression-language` está fijado en **`^7.4`** y el `composer.json` declara `config.platform.php = 8.3`. La v8.1 exige PHP ≥ 8.4 y rompía el build de los ambientes: se subió por error y lo corrigió Joel (PR #1026). No lo vuelvas a subir sin mirar el PHP de los ambientes.

**(2026-08-28)** El eslabón que faltaba entre la calculadora y lo PERSISTIDO ya está en `main`:
`CalculatorAuthorizationAmounts` (commits `118566d2`/`fcbac492`). Antes, autorizar amortizaba con
tasa como cualquier crédito y un renting real quedaba con `final_amount` = el COSTO (1.500.000) en vez
del precio calculado (7.140.000) y `fee_value` = 0 — el contrato imprimía «Valor del plan: $0» y **el
cupo consumido era el costo, no el precio**. Decisión de negocio del 16-08: `final_amount` = el precio
de la calculadora (consume cupo, es el «pago total» del contrato) y `fee_value` = el pago PERIÓDICO
del plan. Sólo aplica a lenders **con matriz de planes** en su `calculator`; sin ella devuelve `null`
y el llamador sigue amortizando como siempre. Verificado contra `main` leyendo el servicio entero.

## Por qué la distinción legal importa (y no es cosmética)
El techo de **usura** aplica al crédito, no al arrendamiento. Sin opción de compra el cliente **nunca es dueño**: paga por *usar* la moto y la devuelve, así que no hay capital que amortizar → **no hay interés** → no es crédito → no le aplica el techo. Con opción de compra sí hay saldo, sí hay interés, y el PRD lo dice con sus palabras: *"esencialmente **un crédito disfrazado de arriendo**"*.

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

**La tabla del `VLOOKUP`: el plazo cambia el precio de la semana.** Se paga **siempre semanal** (`D12`: *"Siempre son pago semanales"*); lo que el plan mueve es cuánto vale esa semana. La **base es la fila del Mes** y las otras dos cuelgan de ella:

| plan | celda | fórmula | factor | ejemplo (precio 15.470.000) |
|---|---|---|---|---|
| Semana | `C13` | `C14 * D13` | **1,25** | 233.188,23 |
| **Mes** | `C14` | `-PMT(1,8% ; 24 ; precio)/30*7` | **1,00** (base) | 186.550,59 |
| Trimestre | `C15` | `C14 * D15` | **0,94** | 175.357,55 |

Alquilar una sola semana sale **25% más caro** y comprometer un trimestre trae **6% de descuento** — eso es lo que el selector de plan de la card tiene que comunicar. Reproducido con el evaluador real del backend con delta < 0,0001 en las tres, y **re-reproducido el 2026-08-20 contra `Calculadora Renting VF (3).xlsx`**, que además trae la pestaña Rent to Own con su plazo en **52 / 78 / 104 semanas** (= 12/18/24 **meses**, no semanas) y su tarifa como `PMT` sobre la tasa semanal equivalente `(1+tasa)^(12/52) − 1`.

> **Límite de lo verificable acá:** la hoja muestra el **mecanismo**, no si alcanza legalmente. Si el arrendamiento se recaracteriza como crédito encubierto es una opinión jurídica (legal de CreditOp), no algo deducible de un Excel. Lo verificado es que **la hoja no calcula interés**.

> ⚠ **Consecuencia para quien toque la calculadora:** "arreglar" el prorrateo del renting para que use la conversión compuesta **no es un fix**, es recaracterizar el producto. Si alguien lo hace, el arrendamiento pasa a tener una tasa y con eso entra al perímetro del crédito. Por eso el parámetro del config se llama **`anchor_rate`** y no `monthly_rate`.

> ⚠ **La terminología del código está invertida respecto del PRD** (gotcha C1): el `renting` **del código** es el *rent-to-own* del PRD (**es crédito**), y lo que el PRD llama *renting operativo* (**no es crédito**) es el alquiler puro. O sea que **Ábaco aplica al producto que legalmente SÍ es un crédito**.

## Renting y Rent to Own: en qué se diferencian de verdad
**Legalmente son productos distintos** (§ «Por qué la distinción legal importa»): sin opción de compra el cliente devuelve el bien; con opción, termina siendo dueño. **Técnicamente comparten casi todo**: el mismo `response_type`, el mismo wizard, el mismo motor de pasos, y —porque el RTO es un clon— el mismo `product = 'renting'` y la misma matriz `plans`. La diferencia operativa vive en **dos lugares de configuración**, no en el flujo:

| | Motai Renting | Rent to Own |
|---|---|---|
| qué firma | contrato de **renting**, pagaré + carta, plan de pagos | contrato **con opción de adquisición** (cláusula Vigésima Cuarta), acuerdo de codeudoría, pagaré + carta, **garantía mobiliaria**, plan de pagos |
| ramas del catálogo | **las dos** (`requires_cosigner` true y false) | **sólo la rama con codeudor** — ver el hueco abajo |
| tipo de documento propio | — | **`chattel_mortgage`** (prenda sin tenencia) |
| de dónde sale la config | migraciones del repo | migraciones del repo **+ una que no está en el repo** |

**`chattel_mortgage` es un tipo nuevo y no podía llamarse `guarantee`.** Ese nombre ya lo usa la garantía del **FGA**, que tiene su propia tabla (`guarantees`), su plantilla genérica y un guard de runtime que decide por score de centrales. Reusarlo haría que la prenda del vehículo escribiera en la tabla del FGA y que un score bajo impidiera constituirla. **Y el orden de las filas no es cosmético:** la prenda va después del pagaré porque su cláusula Segunda referencia el número del título, que sólo existe una vez que el pagaré se generó.

⚠ **El hueco: el Rent to Own no tiene documentos para el cliente que NO necesita codeudor** — y lo declara la propia migración que lo siembra: *«legal entregó únicamente las versiones con deudor solidario… ES UN HUECO CONOCIDO»*. Como `SigningDocumentResolver::resolveForPolicy()` filtra `where('requires_cosigner', $requiresCosigner)`, la rama sin filas devuelve vacío. **Y el síntoma cambia según el ambiente**, que es lo que lo vuelve traicionero:

- donde corrió la migración que copió la config del 158 (qa/prod), la rama falsa quedó apuntando a las plantillas de **renting** → el cliente firma un arrendamiento **sin opción de compra**, que es lo contrario del producto que compró. La migración avisa que la categoría llamada «Codeudor» está justamente en `requires_cosigner = 0`;
- en un ambiente armado **sólo con las migraciones del repo** (un local nuevo), esa rama no existe → **no se genera ningún documento**, y el flujo sigue como si no hubiera catálogo.

Ninguno de los dos falla con error. **Antes de concluir nada sobre los documentos del RTO, mirá qué filas tiene su catálogo en ESE ambiente.**

⚠ **Y la config del RTO no es reproducible desde el código.** `2026_08_20_120000_seed_rent_to_own_cosigner_documents` nombra como antecesora a `2026_08_18_120000_copy_renting_config_to_rent_to_own_lender`, que **no existe en ninguna rama ni commit** — mismo patrón que la calculadora (§ «El padrón de entidades»). O sea: **dos** piezas de la configuración del Rent to Own las puso una migración fantasma, y por eso lo que valga en un ambiente no predice el otro.

**Lo que sí quedó comprobado corriéndolo** (local, 2026-08-22): con el catálogo de la rama con codeudor sembrado por la migración de `main`, el Rent to Own **cierra de punta a punta** — el codeudor entra por su token, resuelve elegibilidad, el titular firma y la solicitud se difiere, y al firmar el codeudor la autorización termina en **estado 11**. El detalle del recorrido está en `codeudor`; los tropiezos del camino, en `findings` **F-150**, **F-151**, **F-152** y **F-153**.

**(2026-08-28)** El ciclo de la solicitud de este comercio **se espeja hacia `merchant-api-service`**:
legacy reporta seis hitos del funnel para que el proveedor mantenga su copia de las solicitudes de su
lender, sin que el flujo dependa de que su servicio esté arriba. El detalle (hitos y compuerta por
marcador de workflow) está en el nodo codeudor, porque cinco de los seis hitos son de ese recorrido.

## Decisión manual + cierre
La decisión del renting **sigue siendo manual**: el asesor la toma en la pantalla de perfil financiero (`financial-profile.repository.ts` → `POST motai/update-status`, `approve` booleano; el ingreso que muestra viene de `FINANCIAL_HEALTH_API_URL`, **≠** Ábaco) → `BackDoorUserService`: aprobado ⇒ `targetStatus=11` + voucher; rechazado ⇒ `9`.

⚠ **Pero el cierre por firma ya no siempre llega a 11.** Si la política del usuario exige codeudor, la autorización se **difiere** y la solicitud queda en el estado macro «Pendiente firma codeudor» hasta que firmen los dos. Motai es hoy la entidad que ejercita ese camino (tiene catálogo de documentos con rama de codeudor sembrado por migración) — **→ ver `codeudor`**. El resto del cierre CreditopX (OTP/pagaré/ADO/Estado 11) es del tronco **CreditopX**; la copia de reglas por sucursal, del padre **Merchants**.

## Dónde mirar
- **Config por lender / requisitos** (legacy): `app/Models/LenderRequirement.php` · `LenderRequirementRepository.php` + su interfaz · migraciones `..._create_lender_requirements_table.php` (+ los dos `add_dynamic_form_*`) · `..._backfill_abaco_is_enabled_from_lender_product.php` (traduce la verdad vieja al modelo nuevo) · `..._drop_allied_modes_and_user_request_modes_tables.php` (cierra la des-motaización).
- **Motor de pasos por `next_step`** (legacy): `CreditopXFlowService.php` (`getNextStepData`, orden formulario → ábaco → identidad) · `DynamicFormStepResolver.php` + `DynamicFormRequirementService.php` · `AbacoStepResolver.php` (las **dos** condiciones: encendido y sin consulta viva).
- **Gate + flujo Ábaco** (legacy): `AbacoRequirementService.php` (MOTV, fuente única = tabla) + `AbacoRequirementController.php` · `AbacoController.php` · `AbacoService.php` (`ABAC*`, registra la consulta y dispara el desglose de ingreso) · `AbacoParserService.php` (`average_income`, `UserSummary.abaco`) · `AbacoConsultRepository.php` (**la vigencia de 1 mes**) · `Abaco.php` (mock local) + `AbacoFixture.php` · `Modules/Onboarding/routes/api.php` (prefijos `abaco` y `scraping`, con el alias deprecated marcado).
- **El ingreso, de Ábaco a la política**: `IncomeBreakdownService.php` (escribe informal/formal/87, con la regla de por qué el 87 nunca baja a 0) · `MonthlyIncomeResolver.php` (`formal + informal`, y por qué es `> 0` y no `no null`) · `LenderUserCategoryService.php` (quien lo consume para decidir).
- **Productización y calculadora** (legacy): `app/Support/LenderCalculator.php` (la matriz `plans`/`terms` y la inyección por fila) · `app/Support/FormulaCalculator.php` (evaluación segura + el porqué del formato lista) · `app/Models/Lender.php` (`product`, `calculator`) · `LendersByAlliedBranch.php` (`document_types`) · `AlliedInfoController.php` (la **unión** con piso CC/CE que decide si aparece PEP) · `app/Models/AlliedDocument.php` · `LenderListingService.php` (adjunta `calculated`/`product`, y el endpoint `recalculate`).
- **La misma calculadora, en documentos y montos**: `CalculatorPaymentScheduleService.php` · `CalculatorDocumentSchedule.php` · `CalculatorAuthorizationAmounts.php` · `CutoffCalendar.php` (las FECHAS; la plata es del calculator).
- **Los documentos de los dos productos**: `app/Models/LenderSigningDocument.php` (los dos ejes del catálogo — cuándo aplica la fila vs quién firma; el detalle en **codeudor**) · `Modules/Loans/App/Services/Signing/SigningDocumentResolver.php` (`resolveForPolicy`, el filtro por rama del que depende el hueco) · `database/migrations/2026_08_20_120000_seed_rent_to_own_cosigner_documents.php` — **leé su cabecera antes de tocar nada del RTO**: declara el hueco de la rama sin codeudor, por qué `chattel_mortgage` no podía ser `guarantee`, y por qué el orden de las filas importa.
- **TyC por comercio**: `RegisterCellPhoneService.php` → `storeTermsAndConditions` — el orden real es Credifamilia (doc 18, todavía quemado) → filas de `allied_documents` del comercio → default en código (último TyC activo + doc 13). ⚠ La config por comercio **REEMPLAZA** al default: si está incompleta, el comercio pierde su política de datos.
- **Front Ábaco**: módulo `modules/…/abaco/` (use-cases, `abaco.repository.ts`, `abaco-attempt-state.ts` = los intentos, que hoy viven acá y no en el backend) + rutas `app/routes/abaco/*`.
- **Front calculadora + decisión**: `LenderCardContent.tsx` / `useLenderSelection.ts` / `AvailableLenders.tsx` (**leen** `calculated`, ya no calculan) · `financial-profile.repository.ts` (decisión manual) · `loan-confirmation.tsx` (maneja `next_step`).
- **application** = solo scaffolding de esquema (2 migraciones abaco portadas), **cero lógica** — nada que migrar desde ahí.

## Lo que NO está verificado
- **Qué migración dejó la calculadora que corre hoy en cada ambiente.** Las que aparecen en el ledger de prod y de dev/qa para el Rent to Own **no existen en el repositorio**: la config actual no es reproducible desde el código, y reconstruirla es trabajo pendiente, no un dato que este nodo pueda afirmar.
- **Si el `product = 'rto'` funciona de punta a punta.** Sigue sin verificarse, y conviene no confundirlo con lo que sí se probó: el recorrido completo del Rent to Own se ejercitó **con el clon tal como está configurado**, o sea `product = 'renting'` y matriz `plans` (medido en el propio lender antes de correrlo). La rama `terms` de la calculadora y la card propia del RTO **siguen sin ejercitarse en ningún ambiente**.
- **Las versiones sin codeudor de los documentos del RTO.** No existen: legal no las entregó. Que la solución sea escribirlas o cerrar la categoría que no pide codeudor es decisión de negocio, no algo que este nodo pueda afirmar.
