# Motai v2 — qué se hizo, por qué, y en qué rama vive cada cosa

> **Documento de contexto para el equipo.** Consolida y verifica todo el trabajo agrupado bajo
> «Motai v2» entre el 15 de julio y el 30 de julio de 2026, más lo que se construyó encima durante
> agosto.
>
> **Verificado el 2026-08-19** contra `legacy-backend` y `frontend-monorepo` (ramas remotas y PRs
> reales). Cuando una afirmación no se pudo comprobar en código, lo dice explícitamente.
>
> Repos involucrados: **`legacy-backend`** y **`frontend-monorepo`**. `application` **no se tocó**:
> no tiene lógica de Motai — solo copy de marketing en el listado de entidades y dos migraciones de
> esquema de Ábaco que trajo otro frente.

---

## 0. Resumen en una página

**El problema.** Motai (comercio aliado `158`) tenía un flujo de originación **bifurcado por código**:
un booleano `isMotaiRenting` — que el front derivaba de una constante `MOTAI_LENDER_IDS = [158]` —
viajaba en cada payload del wizard (teléfono, OTP, datos personales) y, del otro lado, el backend
saltaba pasos del proceso mientras el front calculaba el precio del producto con una fórmula escrita
a mano. El mismo anti-patrón («preguntar si es Motai por un id fijo») estaba repetido en ~35 puntos de
los dos repos. Consecuencia práctica: **dar de alta un segundo comercio de arrendamiento requería un
despliegue**, no una fila de configuración.

**Lo que se hizo.** Se reemplazó ese disparador por **configuración en base de datos**, en siete
frentes:

| # | Frente | Antes | Ahora |
|---|---|---|---|
| 1 | Disparador del flujo | `isMotaiRenting` / id `158` / `merchant_mode` en payloads y `if`s | `lenders.product` (`credit`\|`renting`\|`rto`) |
| 2 | Los «modos» del comercio | tablas `allied_modes` / `user_request_modes` + pantalla de modos | **eliminados** (código y tablas) |
| 3 | Calculadora del producto | fórmula quemada y **duplicada** en el front | `lenders.calculator` (JSON) evaluado en backend |
| 4 | Recálculo al cambiar el monto | no existía (los valores quedaban viejos) | endpoint liviano `recalculate` (~0,15 s) |
| 5 | Términos y condiciones | ids `13`/`16`/`17`/`18` quemados y duplicados | tabla `allied_documents` por comercio |
| 6 | Requisito de validar ingresos con Ábaco | modo del comercio | `lender_requirements.abaco_is_enabled` |
| 7 | Tipos de documento (habilitar PEP) | `if merchantMode === 'motai-renting'` en el front | `lenders_by_allied_branches.document_types` |

**Estado hoy (2026-08-19).** Todo está **mergeado en `qa`** (9 PRs propios entre el 24 y el 30 de
julio). **Nada de la mitad configurable llegó a `develop`, `staging` ni `main`.** En cambio, **sí
llegó a `main` y `staging` la mitad que BORRA** el mecanismo viejo (PRs #786 y #790 del frontend, 10
de agosto) — eso deja una asimetría con consecuencias reales que están descritas en la §6 y que hay
que decidir.

**Regla mental para el que venga después:** *ajustar el comportamiento de un comercio o de una
entidad ya no es tocar un `if` — es editar una fila.* El Anexo A es la tabla «quiero cambiar X → toco
Y».

---

## 1. El problema, con nombre y apellido

Motai atiende **población sin historial en centrales de riesgo colombianas**: trabajadores de
plataformas (Rappi, DiDi, Uber, inDrive, Yango) y migrantes con **PEP** (Permiso Especial de
Permanencia). Para que esa población pueda avanzar, el flujo original hacía cuatro cosas por
excepción:

1. **Habilitaba PEP** como tipo de documento (el resto de las entidades no lo admite).
2. **Saltaba la consulta al buró** (`userViability`, Experian, `validateRiskCentrals`).
3. **Forzaba** `corbetaOnboarding = false`.
4. **Cambiaba el precio en pantalla**: el front sobreescribía el monto con
   `(monto + 1.500.000) × 2 × 1,19` y dibujaba una tarjeta distinta.

Todo eso se disparaba desde un booleano en el request. Dónde vivía, con posiciones previas al cambio:

**Backend (`legacy-backend`)**
- Disparador dual: `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1216`
  → `$isMotaiRenting = $request->input('isMotaiRenting') === true || $request->input('merchant_mode') === 'motai_renting'`
- Rama de bypass completa: `:1217-1311` — fuerza `corbeta=false` (`:1222`), salta
  `userViability`/Experian (`:1279`), salta `validateRiskCentrals` (`:1311`).
- El campo whitelisteado en los requests de OTP: `ValidateOtpCodeRequest.php:36`,
  `SendOtpCodeRequest.php:40`.
- Plumbing del flag: `RegisterCellPhoneService.php`, `UserService.php`, `OtpService.php:364,371`.

**Frontend (`frontend-monorepo`)**
- Constante: `lenders-marketplace/src/lib/domain/constants/lender.constants.ts:13` →
  `MOTAI_LENDER_IDS = [158]`, **más una copia inline** en
  `loan-application-form/src/components/phone-number-step-form.tsx:24`.
- Sobreescritura del monto: `available-lenders/hooks/useLenderSelection.ts:164`.
- Salto de la validación de cuota inicial: `AvailableLenders.tsx:553-557`.
- Salto del OTP/modal → `continue`: `app/routes/lenders-marketplace/available-lenders.tsx:77`.
- Tarjeta especial: `lender-card/LenderCardContent.tsx:895`.
- Habilitar PEP: `forms/personal-info-form.tsx:63-69`.
- El flag en los payloads: `phone-number.tsx:190`, `otp-verification.tsx:131`,
  `loan-request-form.tsx:257`.

Y un dato que conviene tener presente: **el id `158` no existía en el backend como lógica** — el
acople por id era exclusivamente del front. El backend se acoplaba por el **flag** y por el **modo**.

---

## 2. Inventario de ramas y PRs

### 2.1 `legacy-backend`

| Rama | Commits propios | PR | Destino | Estado |
|---|---|---|---|---|
| `feature/motai-v2` | `936f0a7c` des-motaización · `32cd4203` TyC por comercio · `607fd2b0` recálculo liviano · `5013f4af` quitar columna `abaco` · `35f05305` des-motaización de OnboardingV2 · `dac479cd` Ábaco desde `product` · `f9ea720c` RTO también pide Ábaco · `098322a8` fix `$hasCredifamilia` · `4022b6c9` fix ProfilerML | **#983** | `develop` | **ABIERTO / superseded** |
| `feature/motai-clean-v2` | `ecebd9fd` — **39 archivos, +1.027/−649** | **#1020** | `qa` | **MERGEADO 24/07** |
| `feature/abaco-fuente-unica` | `f01f7f95` (2 migraciones) — la rama además llevaba el trabajo de `lender_requirements` y los resolvers de pasos, de José | **#1028** | `qa` | **MERGEADO 29/07** |
| `feature/abaco-cupo-sin-buro` | `6f8392e6` — 1 archivo, +66/−1 | **#1032** | `qa` | **MERGEADO 30/07** |
| `feature/motai-renting-planes` | `9390b3ff` — 1 migración, +129 | **#1033** | `qa` | **MERGEADO 30/07** |

**Por qué existen dos ramas para lo mismo (`feature/motai-v2` y `feature/motai-clean-v2`).** La
primera nació de `staging`; a mitad de camino se pidió retargetearla a `develop`, lo que obligó a
mergear `develop` dentro de la rama. El resultado fue un PR cuyo diff mostraba ~52 archivos, la mayor
parte **divergencia heredada `staging`↔`develop`** y no trabajo de Motai — imposible de revisar. Se
rehizo entonces como **un solo commit limpio sobre `qa`** (`ecebd9fd`), dejando deliberadamente afuera
lo que no era Motai. **PR #983 sigue abierto y ya no debería mergearse: está superseded por #1020.**

La forma de ese commit, para quien lo revise: **4 archivos nuevos** (`FormulaCalculator`,
`AlliedDocument` y las dos migraciones), **10 borrados** (los de la §3.2) y el resto son
modificaciones. El que más crece es `LenderListingService` (+184), que es donde entran
`buildCalculated` y `recalculate`; el que más adelgaza es `OnboardingController` (−88), que es la rama
de bypass.

Dos arreglos que se hicieron en el camino y **no son de Motai** — son bugs preexistentes de `develop`
que aparecieron al levantar el flujo en local:

- `098322a8` — variables `$hasCredifamilia` indefinidas rompían el registro de celular. Vinieron de
  un commit de observabilidad que renombró parámetros sin actualizar los cuerpos; se encontraron
  **tres** del mismo linaje (`OtpService::sendOtpCode`, `UserService::getOrCreateUser`,
  `UserService::storeTermsAndConditions`). Solo son fatales en local (`APP_DEBUG`); en los ambientes
  compartidos devuelven null en silencio. **Este bug también vive en `develop`.**
- `4022b6c9` — `ProfilerMLController::makePrediction` hacía `Http::baseUrl(config(...))` con host
  nulo cuando falta `H2O_API_HOST`, y eso lanza un `TypeError` (un `\Error`, no una `\Exception`, así
  que los `catch` no lo atrapaban) → **500 en toda la pantalla de entidades**. Se le puso un guard al
  tope que degrada al modelo legacy de matrices, que es el comportamiento vigente igualmente.

### 2.2 `frontend-monorepo`

| Rama | Commits propios | PR | Destino | Estado |
|---|---|---|---|---|
| `feature/motai-v2` | `653e7939` des-motaización · `15f3b3e9` TyC por comercio · `6708ea5b` recálculo | **#706** | `staging` | **ABIERTO / superseded** |
| `feature/motai-clean-v2` | `cdfd0b75` — **40 archivos, +352/−496** | **#742** | `qa` | **MERGEADO 24/07** |
| `feature/cosigner-signature-success` | `719d7c40` — 7 archivos, +154/−1 | **#747** | `qa` | **MERGEADO 28/07** |
| `fix/renting-sin-chips-de-cupo` | `bc6f07a4` — 5 archivos, +139/−9 | **#758** | `qa` | **MERGEADO 30/07** |
| `fix/monto-actualizando-sin-banner` | `71a7a949` — 2 archivos, +70/−7 | **#759** | `qa` | **MERGEADO 30/07** |
| `feature/abaco-continuar-sin-validar` | `0068e0ff` · `6feb5b52` · `86b2c495` | **#766 / #767** | `qa` | **MERGEADO 30/07** |

Igual que en el backend, **PR #706 quedó abierto y superseded por #742**.

La forma de `cdfd0b75`: **1 archivo nuevo** (la ruta-recurso `recalculate.tsx`), **4 borrados** (la
pantalla de modos en sus dos capas, su story y la imagen de 2,2 MB) y 35 modificaciones — más
deleciones que adiciones, que es lo esperable cuando se saca un camino paralelo. El renderizado de
renting **no quedó en un componente aparte**: vive dentro de `LenderCardContent.tsx` (108 líneas
tocadas), gobernado por `product`.

### 2.3 Ramas adyacentes que corren bajo el mismo paraguas (trabajo de otras personas)

Estas no son parte de los siete frentes, pero comparten la línea de `qa` y el nombre «Motai», así que
conviene no confundirlas:

| Rama | Quién | Qué |
|---|---|---|
| `feature/motai/flujo-codeudor` (mismo nombre en los dos repos) | Santi, con aportes de Oscar | El **flujo de codeudor** completo: tablas `cosigners`/`cosigner_statuses`/`cosigner_status_records`, endpoints, invitación por WhatsApp, estado macro **17** «Solicita codeudor», actor `applicant`\|`cosigner` en el motor de pasos, elegibilidad + polling, columna `signer_role` en `netco_signing_documents`, firma cruzada y el onboarding propio del codeudor. PRs #1031, #1035 (backend) · #753, #761, #769, #770 (frontend) |
| `feature/abaco-fuente-unica` (parte de José) | José | La tabla **`lender_requirements`** y el motor de pasos por **`next_step`** (`CreditopXFlowService::getNextStepData`, `AbacoStepResolver`, `AbacoStepSettings`, `DynamicFormStepResolver`) |
| `fix/composer-php83-symfony-downgrade` | Joel | **PR #1026** — bajó `symfony/expression-language` de `^8.1` a `^7.4`. La 8.1 exige PHP ≥ 8.4 y los ambientes corren **8.3**: se subió por error al introducir la calculadora y rompía el build. **No volver a subirla sin mirar el PHP del ambiente.** |
| `qa-motai-renting` | José, Luis | Ronda de correcciones de QA sobre el flujo (Ábaco, formulario dinámico, QR) |
| `chore/remove-allied-modes-user-request-modes` · `chore/cleanup-motai-residuals-qa` | Oscar | La limpieza de residuos, y **el camino por el que parte de esto llegó a `main` y `staging`** (ver §6) |

---

## 3. Los siete frentes, en detalle

### 3.1 Des-hardcode del disparador — el producto pasa a ser un dato

**Qué.** Eliminado de punta a punta: `isMotaiRenting` / `is_motai_renting`, `merchant_mode` /
`merchantMode`, `MOTAI_LENDER_IDS`, y el id `158` **como lógica**. Barrido de verificación por grep
sobre los dos repos: **0 referencias**.

**Por qué.** No era un flag de configuración: era un **camino paralelo de ejecución** que viajaba en
el request. Cualquier cambio de comportamiento («que esta otra entidad también salte el buró»)
significaba editar código en los dos repos y desplegar. Y como el trigger estaba **duplicado** (una
constante exportada más una copia inline), una de las dos copias podía quedar desactualizada sin que
nada avisara.

**Cómo funciona ahora.**
- `lenders.product` (`credit` por default \| `renting` \| `rto`) decide qué tarjeta se dibuja y qué
  pasos aplican.
- `lenders_by_allied_branches.document_types` (JSON) decide los tipos de documento habilitados por
  sucursal; el backend expone la **unión** de esos valores como `allowed_document_types` en
  `GET /api/loans/allied/{hash}` (`AlliedInfoController`) y el front la consume.
- El **salto de buró** dejó de ser un flag: pasó a ser el bypass **por tipo de documento PEP** que ya
  existía en `OnboardingService::storePersonalInfo` (`:314,338`). Es decir, se apoya en un mecanismo
  que ya estaba y que se dispara por el dato del cliente, no por la identidad del comercio.

**Detalle importante del front.** El filtro de tipos de documento estaba escrito como **constante de
módulo** (`const options = documentTypeOptions.filter(opt => opt.value !== "PEP")`), o sea evaluado
una sola vez al cargar el archivo. Aunque el backend mandara PEP habilitado, el selector seguía
mostrando solo CC/CE. Ahora se resuelve dentro del componente (`resolveDocumentTypeOptions` +
`useMemo`), con **piso deliberado**: sin `allowed_document_types` se cae a la lista sin PEP, para que
quitar el filtro no habilite PEP de golpe a los 167 lenders.

**Lo que queda por limpiar en el mismo linaje.** La tarjeta de PEP todavía fija
`nationality: 'VENEZOLANA'` (`init-loan-request.tsx:266-268`) — un default de negocio quemado. Y hay
dos anti-patrones idénticos, ajenos a Motai, que la misma solución debería absorber:
`ONVACATION_LENDER_IDS = [313]` (`phone-number-step-form.tsx:25`) y
`HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS = [160]` (`lender.constants.ts:31`).

---

### 3.2 Muerte de los «modos» — y por qué eran el verdadero problema

**Qué.** Se deprecaron `allied_modes` y `user_request_modes`. En el backend se **borraron 10
archivos**: los modelos `AlliedMode` y `UserRequestMode`; los repositorios `AlliedModeRepository` y
`UserRequestModeRepository` con sus dos interfaces; **las copias del repositorio y su interfaz en
`OnboardingV2`** (el módulo tenía su propio par, y quedarse solo con el de `Onboarding` habría dejado
el mecanismo vivo por la otra puerta); `ValidateOtpAuthServiceConstants`; y
`AlliedModeLenderFilterService`. Se limpiaron además los bindings del provider y el contrato público
de `OnboardingV2` (`openapi.yaml`, que declaraba `isMotaiRenting` y `merchantMode`). En el front se
eliminó la pantalla de modos: `merchant-mode.tsx` (componente y ruta `route("modes")`), su story y la
imagen de fondo de 2,2 MB. Después, en otra rama, se **borraron las dos tablas**.

**Por qué — este es el punto que vale explicar.** Los modos no eran solo un hardcode: eran una
**inconsistencia de flujo**. El usuario **pre-elegía** el producto en una pantalla de modos; el modo
viajaba en la sesión; y al llegar a `/lenders`, `AlliedModeLenderFilterService` **volvía a decidir**,
filtrando el listado por ese modo. Dos decisiones para lo mismo, en dos lugares.

Y el remate: **ese filtro era NO-OP.** Leía `config['lenders']`, una clave que ningún `config` de modo
traía. O sea que la pantalla de modos condicionaba la percepción del usuario sobre el producto, pero
el filtro que supuestamente la hacía valer no filtraba nada. Sin modos, `/lenders` decide como para
cualquier otra solicitud.

Rastro de lo que había: `AlliedModeLenderFilterService.php:16-42`, cableado en
`LenderRetrievalService.php:211` y `LenderListingService.php:127` (ahora passthrough); la constante
`MOTAI_RENTING_ALLIED_MODE_ID = 2` en `OnboardingController.php:36`, **sin seeder** — la fila se
insertaba a mano; y una migración con nombre engañoso
(`2026_03_09_204622_create_merchant_modes_table.php`, que crea `allied_modes`).

**Decisión de producto que lo habilitó.** El producto se elige **en el marketplace de entidades**,
como cualquier otra opción de crédito — no en una pantalla previa. Con eso, la pantalla de modos no
tiene razón de existir.

---

### 3.3 La calculadora vive en la base de datos, no en el código

**Qué.** Dos columnas nuevas en `lenders`:

- **`lenders.product`** (string, default `credit`) — la categoría.
- **`lenders.calculator`** (JSON, nullable) — **la fórmula propia de cada entidad**. `null` =
  **identidad**: devuelve el monto tal cual (el default de `credit`, «no hace nada»).

Y un evaluador nuevo: **`app/Support/FormulaCalculator.php`**.

`LenderListingService::attachCalculatedFields` → `buildCalculated()` corre el `calculator` **una vez
por fila** de `plans` (renting) o `terms` (rto) y adjunta a cada entidad del listado
`calculated = {amount, plans:[{id,label,weeks,factor,payment}], payment_unit, default_plan}`.

**Por qué.** La fórmula de renting estaba **quemada y duplicada en el front**
(`LenderCardContent.tsx:236-245` usada en `:810`, más `useLenderSelection.ts:169`). Dos copias de una
regla de precio en el cliente significa: (a) el número se puede manipular desde el navegador, (b) una
copia puede quedar desactualizada, (c) cambiar una tarifa es un despliegue del frontend. Ahora es un
`UPDATE`.

**Cómo es seguro.** `FormulaCalculator` usa `symfony/expression-language` **sin registrar ninguna
función** y pasando **solo escalares** como scope — no hay forma de invocar código PHP. Encima, un
`guard()` de defensa en profundidad prohíbe llamadas a función y restringe la expresión a `números,
variables y + - * / % ** ( )`. **No hay `eval` en ningún punto.** Y `buildCalculated` es
**fail-safe**: si el config está mal, degrada a `{amount}` en lugar de romper el listado.

**Formato del `calculator`:**

```json
{
  "params":   { "setup_fee": 1500000, "margin": 1.0, "tax": 0.19,
                "anchor_rate": 0.018, "months": 24 },
  "formulas": { "amount":  "(amount + setup_fee) * (1 + margin) * (1 + tax)",
                "payment": "amount * anchor_rate / (1 - (1 + anchor_rate) ** (-months)) / 30 * 7 * factor" },
  "plans": [
    { "id": "semana",    "label": "Semana",    "weeks":  1, "factor": 1.25 },
    { "id": "mes",       "label": "Mes",       "weeks":  4, "factor": 1.0, "default": true },
    { "id": "trimestre", "label": "Trimestre", "weeks": 12, "factor": 0.94 }
  ]
}
```

Las fórmulas **se evalúan en orden y encadenan**: la segunda ve el resultado de la primera (por eso
`payment` puede usar `amount` ya transformado en precio de venta).

> ⚠ **Trampa que costó un bug y ya está resuelta.** Las columnas `JSON` de MySQL **no conservan el
> orden de las claves de un objeto**: las reordenan por longitud de clave y después por bytes. Con
> `{amount, initial_fee, payment}` lo que vuelve de la base es `{amount, payment, initial_fee}`, así
> que `payment` se evaluaba antes de que `initial_fee` existiera y reventaba con *«Variable
> initial_fee is not valid»*. El formato canónico pasó a ser una **lista** (los arrays JSON sí
> conservan orden): `"formulas": [{"name":"amount","expression":"…"}, …]`. El formato objeto se sigue
> aceptando para configs viejas, pero **para config nueva, usar siempre la lista**.
> (Corregido por Luis en `95db703d`, 15 de agosto.)

**En el front.** La tarjeta **solo lee** `calculated`. Elegir un plan cambia qué fila se muestra:
**no recalcula ni llama al backend**. Se borró el hardcode `getMotaiTotalAmount` / `RENTING_PLANS`.

**Se evaluó y se descartó** bajar las fórmulas al front: la política de seguridad del wizard
(`security-headers.server.ts`) es `script-src 'self' 'nonce-…'` **sin `unsafe-eval`**, así que
`new Function`/`eval` están bloqueados. Habría hecho falta un **segundo** evaluador, con riesgo de
divergencia de plata entre los dos (sobre todo el `**` del RTO), para ganar ~0,15 s. No vale.

---

### 3.4 Recálculo del monto: un endpoint liviano, no volver a correr todo

**Qué.** `GET lenders-v2/{user_request_id}/recalculate?amount=` →
`LenderListingController@recalculate` → `LenderListingService::recalculate` →
`{lenders: {<id>: {product, calculated}}}`. Corre **solo** `FormulaCalculator`.

**Por qué (el razonamiento, que es lo que importa).** Al cambiar el monto solicitado, la reacción
obvia es volver a pedir el listado. Pero **la elegibilidad y el cupo del pre-aprobado son del
usuario**: no dependen del monto pedido. Lo único que depende del monto es **la cuota**. Volver a
correr perfilamiento, Datacrédito y todas las consultas de pre-aprobación al mover un slider es
desperdicio puro. Medido: **~0,15 s el recálculo vs ~0,67 s el listado completo**.

**En el front.** `AvailableLenders.handleAmountChange` → `setRequestedAmount` inmediato (el cupo se
recalcula del lado del cliente) + **debounce de 450 ms** → `recalcFetcher.load(...)` → se mergea el
`calculated` recomputado sobre las tarjetas por id.

**Dos trampas que se atraparon en el camino:**

1. La ruta-recurso `recalculate.tsx` se registra **una sola vez, bajo `merchant/`**, pero la página
   `/lenders` se monta **dos veces** (bajo `merchant/` y bajo el árbol self-service). Hay que
   llamarla con **path absoluto** `/merchant/...`; construirla con el parámetro de flujo daría un
   **404 silencioso** en self-service.
2. El monto es **stateless**: `getLenders` usa `?amount ?? user_requests.amount` para el cálculo *y*
   para el display, **sin persistir**. Verificado: sin `?amount` → 2 M; con `?amount=3M` → 10,71 M; la
   base intacta.

**Borde conocido.** Las entidades sensibles a un mínimo (Welli, MediPay, Prami, Bancolombia Consumo)
**no** se re-consultan solas al cruzar ese mínimo: para esas hay un botón «reintentar» por tarjeta,
habilitado cuando `requestedAmount >= minimumAmount`.

---

### 3.5 Términos y condiciones por comercio

**Qué.** Tabla nueva **`allied_documents`** (`allied_id`, `type` ∈ {`terms_and_conditions`,
`data_policy`, `risk_policy`, …}, `terms_and_conditions_id`, `sort`, `status`), modelo
`AlliedDocument`, relación `Allied::documents()`. El backend los expone en `AlliedInfoController`
(con la url/versión que viene del catálogo) y los persiste al aceptar, en
`RegisterCellPhoneService::storeTermsAndConditions`.

**Aclaración de modelo, para no malinterpretar la tabla.** `allied_documents` **no guarda la URL**:
guarda un **FK al catálogo `terms_and_conditions`**, donde la URL y la versión ya vivían. Lo que se
movió a configuración es el **mapeo comercio → documento**.

**Por qué.** Los ids estaban quemados **y duplicados**: `if ($isMotaiRenting)` → ids **16/17**, si no
**18/13**, en dos lugares a la vez (`RegisterCellPhoneService.php:411-442` y
`UserService.php:325-362`), más el id 18 suelto en `OnboardingController.php:120,810,812`. Lo legal
además estaba atado a una entidad concreta (`LegalService.php:31,35,41`, con
`ENABLED_LENDERS_FOR_LEGAL = [24]` y `templateProject = 'credifamilia'`), y las URLs de los PDF en S3
estaban escritas en el front (`phone-number-step-form.tsx:39,45`).

**Cómo resuelve hoy `storeTermsAndConditions`, en orden:**

1. Contexto legal de Credifamilia → documento **18** *(sigue hardcodeado, con un comentario que lo
   marca como placeholder del rollout del catálogo legal)*.
2. Comercio **con filas** en `allied_documents` → registra **esas**, respetando `sort`.
3. Si no hay filas → **default en código**: último TyC activo + política de datos **13**.

**Cuidados al configurar (importante).**
- La configuración por comercio **REEMPLAZA** al default: **debe ser completa**. Un comercio con solo
  TyC configurado **pierde su política de datos**.
- El backfill de la migración **cubre solo al 158** (`data_policy=16` + `terms_and_conditions=17`) y
  **no es idempotente**: usa `insert`, no `updateOrInsert` → **volver a correrla duplica filas**.
- El consentimiento sigue quemado como `terms: true` en el payload del front
  (`phone-number.tsx:187`, `otp-resend.tsx:122`): falta atarlo a la configuración real.
- Conviven **dos mecanismos** de TyC: el nuestro (`RegisterCellPhoneService` + `allied_documents`) y
  una rama de «legal previsualization» que entró por otro lado en `UserService::storeTermsAndConditions`
  (lender 24 → doc 18, comercio 179 OnVacation → doc 19). **Hay que converger.**

---

### 3.6 Ábaco: de flag a fuente única — y el cupo sin buró

Este frente tiene tres momentos, y el orden explica por qué terminó como terminó.

**Momento 1 — se introdujo una columna `lenders.abaco` y se retiró.** Se agregó un booleano
`lenders.abaco` y se **removió** antes de mergear (`5013f4af`): la forma final del dato (columna,
tabla, nombre) la define el equipo que trabaja Ábaco. No tenía sentido crear un esquema que otro iba a
reemplazar.

**Momento 2 — puente transitorio: Ábaco se deriva del producto.** Con la columna afuera,
`MotaiValidationService` dejó de leer los modos y derivó el requisito de `lenders.product`:
`renting` y `rto` piden Ábaco, `credit` no. Fue un puente explícito, no el destino.

**Momento 3 — fuente única: `lender_requirements.abaco_is_enabled`.** José construyó la tabla
`lender_requirements` y un motor de pasos por `next_step`. Con eso, `AbacoRequirementService` quedó
con **una sola** fuente de verdad: la tabla. Nuestro aporte en esa rama fueron **dos migraciones**:

- **`2026_07_28_100000_backfill_abaco_is_enabled_from_lender_product`** — upsert idempotente
  (`lender_id` es UNIQUE) que prende `abaco_is_enabled = 1` para `lenders.product IN ('renting','rto')`.
  **Por qué es crítica:** `lender_requirements` **nace vacía y con el flag en `false`**. Sin este
  backfill, **el mismo despliegue que mueve la decisión a la tabla apaga Ábaco en silencio**: la
  respuesta pasa de `MOTV1001` («requiere») a `MOTV1000` («no requiere») sin que nadie toque
  configuración, y se lee como «se rompió Ábaco» cuando en realidad es data faltante. Su `down()` es
  **deliberadamente no-op**: un rollback no debe borrar configuración de negocio que quizá alguien
  administró a mano.
- **`2026_07_28_110000_drop_allied_modes_and_user_request_modes_tables`** — cierra la
  des-motaización. **DESTRUCTIVA**: el `down()` recrea el esquema, **no los datos** (en dev: 3 filas
  de catálogo y 22 históricas, ninguna posterior a junio). Verificado antes de escribirla: **ninguna
  foreign key entrante** apunta a esas tablas. **Requiere revisión de DBA en ambientes con datos.**

**El cupo sin buró — la pieza que faltaba (PR #1032).** Al matar los modos también murió el bypass de
buró que daba `isMotaiRenting`. Alinearse a `lender_requirements` obligaba a **reponer ese
comportamiento como configuración, no como excepción**. El motor de categorías cortaba en seco:

```php
if (!$user->datacredito) { $criteria['datacredito'] = false; return ['eligible' => false, …]; }
```

Eso rechaza exactamente a la población que el producto atiende. Y el efecto en cadena es peor de lo
que parece: con cupo 0 la tarjeta sale **«Sin cupo disponible»**, no es seleccionable, y **el flujo
nunca llega a Ábaco** — la validación de ingresos que debía reemplazar al buró queda inalcanzable.
El bypass de PEP ya inyectaba la laboral mínima *«to force the pipeline to allow them into the
Marketplace»* prometiendo *«Real income validation happens later via Abaco»*; esto es lo que cumplía
esa promesa.

`Modules/Loans/App/Services/LenderUserCategoryService::evaluateEligibility`: si el usuario no tiene
fila de Datacrédito **y** la entidad tiene `abaco_is_enabled`, las reglas que dependen del buró se dan
por cumplidas y el cupo sale de `calculateAvailableAmountWithInitialFee($rule->category)`.

Decisiones, dichas explícitamente:
- El criterio es **configuración**, no id ni tipo de documento — deliberadamente distinto del
  precedente venezolano/Magnocell, que resuelve el mismo problema con `lender_id === 84` y la
  categoría `22` quemadas. Acá la entidad se habilita por dato y **conserva su propia categoría**.
- **No relaja** las reglas propias de la categoría: ocupación, edad, ingreso, género y continuidad se
  evalúan antes y siguen mandando. Solo deja de exigir un dato que este flujo no tiene.
- ⚠ **Consecuencia asumida:** ese cupo **no está ajustado por capacidad de pago** (no hay datos para
  hacerlo) — es el techo de la categoría, igual que el precedente. Quien debe acotarlo con el ingreso
  real es Ábaco, que corre después.
- **Fallback conservador:** si la tabla no se puede leer (ambiente a medio migrar), el helper cae a
  «exigir buró». El fallback es el comportamiento previo, **no un pase libre**. El `catch` es
  deliberado: este método corre en el hot path del listado y un throw dejaría el marketplace entero
  en 500.
- Queda marca en el log: `users_category_log.category_rules_acceptance` trae
  `"skipped_bureau_abaco": true`.
- **No** se tocó `userViability`/`validateRiskCentrals`: cuando esos corren, `user_request.lender_id`
  todavía es `NULL` (la entidad se elige después, en `/lenders`), así que el criterio «esta entidad
  pide Ábaco» no es evaluable ahí. Omitir esa consulta tampoco habría dado cupo — el corte era este.

**«Continuar sin validar» (PRs #766/#767).** El botón que permite avanzar sin completar Ábaco no
funcionaba. Tres arreglos: (1) el salto lleva a la validación de identidad, con su caso de uso propio
(`skip-abaco.uc.ts`); (2) la URL del salto perdía el hash del comercio y el id de la solicitud → 404;
(3) el salto se movió **al `action`** porque desde el navegador lo bloqueaba **Mixed Content**.

**Lo que Ábaco sigue **sin** hacer, y hay que saberlo.** `average_income` **se calcula** en
`AbacoParserService.php:168-190` **y no se persiste**: `AbacoService.php:575` ignora la clave. Ningún
camino de decisión lo lee. La «validación de ingresos» **no valida** todavía: es captura
informativa. Cablearlo es **prerrequisito de toda la política de MVP2**. En el mismo saneamiento:
`GET scraping/init/gig-economy` está **roto** (`AbacoController.php:42-51` llama
`initGigEconomyFromToken()`, que no existe — solo existe `initGigEconomy`) y el webhook
`scraping.completed` es **NO-OP** (`AbacoService.php:599-628`, `webhook_enabled = false`) → la
finalización se detecta por polling del front.

---

### 3.7 La tarjeta de renting: planes, pago semanal, etiquetas y estados de carga

Tres cambios, tres razones distintas.

**(a) Fuera las etiquetas de cupo en renting (PR #758).** Los chips «Pre aprobado» y «Cupo
disponible» se armaban en **tres** lugares y **ninguno miraba el producto**: `createTags` (mapper del
listado), `createApprovedLenderTags` (tras la pre-aprobación) y `buildTagsFromResolution` (rechazo).
Ahora `productHidesQuotaTags(product)` los apaga para renting. **Por qué importa:** ese cupo es un
techo interno, no plata disponible para el cliente — mostrarlo en un producto de alquiler promete algo
que el producto no entrega. Dos detalles de implementación: el chip se descarta **dentro** de la rama
de CreditopX (si no, un renting caía al `else` y mostraba un chip de probabilidad), y en el rechazo se
va el cupo pero **queda** «Sin cupo disponible» porque el cliente tiene que saber que no pasó. Se
sumaron 7 tests. **Deliberadamente NO** se agregó el 158 a `HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS`: ese
override es por id y el propio archivo pide borrarlo.

**(b) Planes y pago semanal (PR #1033).** La tarjeta ya sabía dibujar «Pago semanal» + selector de
plan, pero **solo si el backend manda `calculated.plans`**, y `buildCalculated` solo los emite si el
`calculator` trae la matriz. El del 158 tenía únicamente `formulas.amount`. **No era un bug del
front: era data faltante.** La migración
`2026_07_30_120000_seed_motai_renting_plans_calculator` la completa — **cero cambios de código**.

Los números salen de la calculadora oficial (`Calculadora Renting VF (2).xlsx`, pestaña **Renting**),
leída celda por celda:

| celda | fórmula | qué es |
|---|---|---|
| `C6`/`C8` | `(costo + alistamiento) * (1 + margen)` + IVA | **precio de venta** |
| `C14` | `-PMT(1,8% ; 24 ; precio) / 30 * 7` | tarifa **BASE** (fila Mes, factor 1,0) |
| `C13` | `C14 * 1,25` | Semana → **25% más caro** |
| `C15` | `C14 * 0,94` | Trimestre → **6% de descuento** |
| `C18` | `IF(plan="Semana",1, IF(plan="Mes",4, 12))` | duración: **1 · 4 · 12 SEMANAS** |
| `C21` | `VLOOKUP(plan; B13:C15; 2; 0) * IF(semana<=C18,1,0)` | repetir la tarifa las semanas del plan, y cero después |

Reproducido con el evaluador real del backend con **delta < 0,0001** en las tres tarifas. Verificación
independiente hecha para este documento:

| costo | precio de venta | Semana (×1,25) | **Mes (base)** | Trimestre (×0,94) |
|---|---|---|---|---|
| 2.000.000 | **8.330.000** | 125.562,90 | **100.450,32** | 94.423,30 |
| 4.534.000 | **14.360.920** | 216.470,43 | **173.176,35** | 162.785,76 |
| 5.000.000 | **15.470.000** | 233.188,23 | **186.550,59** | 175.357,55 |

> ### ⚠ El 1,8% del renting NO es una tasa de interés
>
> Es un **parámetro de precio**, y la distinción no es cosmética: **el techo de usura aplica al
> crédito, no al arrendamiento**. Sin opción de compra el cliente nunca es dueño — paga por *usar* el
> bien y lo devuelve — así que **no hay capital que amortizar → no hay interés → no es crédito**.
>
> Lo más contundente es lo que la hoja **no** tiene: la pestaña Renting **no tiene columna
> «Interés»**, y su tabla entera es una sola fórmula (`VLOOKUP` × `IF`). La pestaña Rent to Own **sí**
> trae `Saldo Inicial | Capital | INTERES | Cuota | Saldo Final`.
>
> Cuatro movidas que lo logran: (1) **la plata está en el PRECIO** — el margen `1,0` duplica la base,
> y 4.534.000 de costo + 1.500.000 de alistamiento dan un precio de **14.360.920 = 3,17× el costo**;
> (2) **el PMT es un divisor, no una amortización** — dividir por 24 daría 598.372, el PMT da 742.184
> (+24%); (3) **no hay saldo**, y sin saldo no hay base a la cual aplicar un porcentaje; (4) **el
> contrato dura 1, 4 o 12 semanas** — los 24 meses del PMT viven **solo dentro de la fórmula del
> precio**, no son el plazo.
>
> **Consecuencia para quien toque la calculadora:** «arreglar» el prorrateo `÷30 ×7` para que use una
> conversión compuesta **no es un fix, es recaracterizar el producto** — el arrendamiento pasaría a
> tener una tasa y con eso entra al perímetro del crédito. **Es una decisión de negocio y legal, no
> técnica.** Por eso el parámetro se llama `anchor_rate` y no `monthly_rate`.
>
> **Límite honesto de lo verificable:** la hoja muestra el **mecanismo**, no si alcanza legalmente. Si
> el arrendamiento se recaracteriza como crédito encubierto es una opinión jurídica del área legal,
> no algo deducible de un Excel. Lo verificado es que **la hoja no calcula interés**.
>
> Y un cruce de vocabulario que hay que fijar: **la terminología del código está invertida respecto
> del PRD**. El `renting` **del código** es el *rent-to-own* del PRD (el que **sí** es crédito), y lo
> que el PRD llama *renting operativo* es el alquiler puro.

**(c) Los puntitos van EN el número (PR #759).** Antes, al cambiar el monto aparecía un texto
«Actualizando opciones con el nuevo monto…» **debajo del campo**, mientras la tarjeta seguía mostrando
el valor viejo **sin ninguna señal de que estaba desactualizado**. Se reemplazó por tres puntos de
carga **en el número mismo** (monto y pago), vía un componente headless
(`RecalculatingAmountBridge`) que espeja «recálculo en curso» al flag por entidad
`isUpdatingAmount` que ya existía — así el loader sale sin tocar la tarjeta ni hilar props. Solo
aplica a entidades **con** `calculated`, para no chocar nunca con el reprecio externo. Dos
decisiones: los puntos arrancan **al tipear** (los 450 ms de debounce en los que el número está
viejo) y se apagan en la **transición del fetcher a idle**, no cuando llega la data — si el recálculo
falla, la data queda `undefined` y la tarjeta se quedaba cargando para siempre.

---

### 3.8 Codeudor: cierre propio tras la firma (PR #747)

**Qué.** Al confirmar el OTP de la firma (consentimiento, pagaré y fondo de garantías), la pantalla
final depende de **quién firmó**:

- **Comprador** → «¡Felicidades, tu monto ha sido aprobado!», con el monto y sus accesos (como hoy).
- **Codeudor** → «¡Firma realizada con éxito! / Tu firma fue registrada correctamente. El crédito ha
  quedado formalizado.» — sin monto y sin botones.

**Por qué.** Por simplificación, el codeudor recorre **el mismo wizard** que el comprador. Sin esto,
al firmar termina viendo el monto aprobado de un crédito **que no es suyo**: él solo lo respalda.

**Cómo está construido.** `resolveSignerRole()` en
`apps/loan-request-wizard/app/utils/signer-role.server.ts` es el **único punto de decisión** (6 tests);
`otp-validation.tsx` bifurca tras `authorize`; se agregó la ruta `signature-success` y el campo
`signer_role` opcional en la entidad del pagaré.

**Decisiones de diseño, que valen más que el código:**
- **Sin feature flag.** El resolver devuelve «comprador» mientras el dato no llegue → comportamiento
  **idéntico** al actual, nadie ve la pantalla nueva. Cuando el backend mande el campo, **sale sola,
  sin re-desplegar el front**.
- `signer_role` se declaró en `data` **y** en `metadata` porque no estaba decidido dónde iría, y el
  validador de esquema **descarta las claves no declaradas**: sin eso el campo habría llegado y el
  front lo habría tirado **en silencio** — un bug mudo.
- **El fallback es «comprador» a propósito.** Equivocarse hacia el comprador solo le muestra al
  codeudor la pantalla de hoy; al revés le **escondería el monto aprobado a quien compró**.

**Contrato acordado con Santi** (backend): en la ruta del `verify-otp` del pagaré, middleware
`cosigner.token` y, en el `success()`, `'signer_role' => …Actor::Cosigner / Actor::Applicant`. Es
seguro para el titular porque `ResolveCosignerToken` es **soft**: sin el header `X-Cosigner-Token`
hace `next()` y el flujo del titular pasa byte a byte igual.

**Hallazgo abierto que salió de acá y hay que resolver.** Cuando el titular firma **y hay codeudor
activo**, el backend **no autoriza**: difiere y responde HTTP 200 con `deferred_for_cosigner = true` y
`status_id = null`. El front valida ese endpoint solo por `success: true` → **mostraría «¡Felicidades,
tu monto ha sido aprobado!» con la solicitud SIN pasar a estado 11**. Es el patrón
pantalla-de-éxito-sin-sellar. La pantalla correcta **ya existe** (`cosigner-waiting-signature`) y
nadie la invoca desde la firma.

*(Nota de estado: en agosto entraron PRs de Oscar que atacan exactamente esto — #832 «la firma del
titular ya no cierra el crédito si falta el codeudor» y #833 «leer la señal de firma diferida en su
ruta real del envelope». Conviene confirmar con Oscar si el hallazgo quedó cerrado.)*

---

## 4. Las migraciones — el contrato de datos

Orden de aplicación y qué hace cada una. **Sin estas migraciones, el código se comporta como
`credit`** y Motai pierde su producto.

| Migración | Qué hace | Idempotente | Destructiva |
|---|---|---|---|
| `2026_07_15_120000_add_motai_v2_columns` | `lenders_by_allied_branches.document_types` (JSON) + backfill piso `["CC","CE"]` · `lenders.product` (default `credit`) · `lenders.calculator` (JSON) · backfill 158 → `renting` + fórmula del precio · 158 en todas sus sucursales → `["CC","CE","PEP"]` | por naturaleza (updates) | no |
| `2026_07_16_120000_create_allied_documents_table` | crea `allied_documents` + backfill 158 → `data_policy=16`, `terms_and_conditions=17` | **NO** — usa `insert` → re-correr **duplica** | no |
| `2026_07_28_100000_backfill_abaco_is_enabled_from_lender_product` | upsert `abaco_is_enabled = 1` para `product IN ('renting','rto')` | **sí** (`lender_id` UNIQUE) | no · `down()` no-op deliberado |
| `2026_07_28_110000_drop_allied_modes_and_user_request_modes_tables` | borra las dos tablas de modos | sí (`dropIfExists`) | **SÍ** — `down()` recrea esquema, **no datos**. Requiere DBA en ambientes con datos |
| `2026_07_30_120000_seed_motai_renting_plans_calculator` | agrega al `calculator` de 158 la matriz `plans` + `formulas.payment` | **sí** (no escribe si ya hay `plans`) | no · `down()` restaura el calculator anterior |

**Cómo se aplicaron.** Local y la base compartida de pruebas se corrieron con el artisan del
contenedor y las credenciales del ambiente, **por el ledger de migraciones** (batches 180 y 197) — no
con `UPDATE`s sueltos, para que el registro quede.

**Riesgo operativo detectado y no resuelto.** El workflow de despliegue de `qa` **solo actualiza el
servicio**; las migraciones van por un workflow manual aparte que además **parece roto** (usa inputs
no declarados y le faltan barras de continuación en el `docker run`). Al 29 de julio,
`allied_modes` y `user_request_modes` **seguían existiendo en los ambientes**. **Esto hay que
verificar antes de dar por desplegado cualquier frente de este documento.**

---

## 5. Cómo se validó

**Barrido de completitud por grep (los dos repos, 15 de julio).** La prueba de que la
des-motaización no dejó lógica quemada:

| Búsqueda | `frontend-monorepo` | `legacy-backend` |
|---|---|---|
| `isMotaiRenting` / `is_motai_renting` | **0** | **0** |
| `merchantMode` / `merchant-mode` / `merchant_mode` | **0** | **0** |
| `MOTAI_LENDER_IDS` | **0** (constante y export borrados) | n/a |
| ruta de modos (`merchant-mode.tsx`, `route("modes")`) | **0** | **0** |
| `allied_modes` / `user_request_modes` en código | n/a | **0** |
| id `158` **como lógica** | **0** | **0** |

Lo que legítimamente queda con «motai»/«158» **no es lógica**: el `158` de las migraciones es
**backfill de datos**; las rutas `/api/onboarding/motai/*` son **nombres** de endpoints cuya lógica
interna ya es genérica; y el bypass PEP de `storePersonalInfo` es el mecanismo correcto porque
`keyea` por `document_type === 'PEP'`.

**Verificaciones funcionales.**
- La cadena completa del wizard corriendo en local: registro → OTP → datos personales (con buró
  inyectado) → listado de entidades.
- `GET /api/loans/allied/{hash}` devolviendo `["CC","CE","PEP"]` para Motai.
- La tarjeta de renting renderizando en el listado real (con captura del flujo).
- La fórmula del precio: costo 3,6 M → 12.138.000 · costo 4.534.000 → **14.360.920** (coincide exacto
  con la fórmula quemada que se reemplazó y con el ejemplo del PRD).
- Los tres planes contra el `.xlsx`: **delta < 0,0001** en las tres tarifas.
- El endpoint `recalculate`: **~0,15 s** vs ~0,67 s del listado; a 8 M devuelve monto 22.610.000 y
  pagos 340.813 / 272.650 / 256.291.
- Cupo sin buró, usuario PEP **sin** fila de Datacrédito: 169 renting → **50.000.000** ✅ · 170 rto →
  **50.000.000** ✅ · 168 credit (sin Ábaco) → sin cupo (sin cambios) · Credifamilia → sin cupo (sin
  cambios). **No-regresión**: usuario con cédula y buró score 700 sigue por el camino normal →
  25.000.000, ajustado por sus datos.
- En el ambiente de pruebas: `POST /api/loans/lender/available-quota` {user 1827761, lender 158} →
  **approved, 20.000.000, categoría 179**. El mismo POST contra el ambiente de desarrollo →
  `eligibility_criteria_not_met`, 0 (porque ahí el cambio no está desplegado — ver §6).
- Codeudor: pantalla renderizada en desktop y mobile · 6/6 tests del resolver · typecheck sin errores
  nuevos (225 preexistentes, 225 después) · linter limpio.

**Una advertencia sobre el ambiente local.** El comercio real **158 no es visible en el dump local**:
le faltan filas de configuración que el ambiente compartido sí tiene (no tiene categorías de usuario,
ni la regla genérica de Datacrédito que el evaluador exige, y aun sembrando ambas sigue sin listar).
**No reconstruirlas a mano** — es fabricar configuración de otro ambiente. Para ver la tarjeta de
renting en local se «flota» una entidad que sí lista, poniéndole `product = renting` y el calculator
del 158; es reversible. El 158 real se prueba en el ambiente compartido.

**Y una regla de configuración que salió de acá:** que una entidad esté asociada a la sucursal **no
alcanza** para que aparezca en el listado. Si no tiene reglas de grupo propias en esa sucursal, el
listado sale **vacío**. Es configuración de datos, no código.

---

## 6. Dónde está cada cosa hoy — y el riesgo del despliegue parcial

Verificado el 2026-08-19 contra las ramas remotas:

| Pieza | `qa` | `develop` | `staging` | `main` |
|---|---|---|---|---|
| `FormulaCalculator` | ✅ | ❌ | ❌ | ❌ |
| Modelo `LenderRequirement` | ✅ | ❌ | ❌ | ❌ |
| Modelo `AlliedDocument` | ✅ | ❌ | ❌ | ❌ |
| Modelo `AlliedMode` (v1) | eliminado | eliminado | **presente** | **presente** |
| `isMotaiRenting` en backend | **0 archivos** | **10 archivos** | **10 archivos** | **10 archivos** |
| Pantalla de modos en el front | eliminada | presente | eliminada | eliminada |
| Payload `isMotaiRenting` en el front | eliminado | presente | **eliminado** | **eliminado** |
| `MOTAI_LENDER_IDS` en el front | **0** | presente | **5 archivos** | **5 archivos** |
| Tarjeta de renting con planes | ✅ | ❌ | ❌ | ❌ |

### ⚠ Tres consecuencias del despliegue asimétrico que hay que decidir

Los PRs **#786 (→ `main`)** y **#790 (→ `staging`)** del frontend, mergeados el **10 de agosto**,
llevaron **la mitad que borra** de nuestro PR #742 — 26 archivos, **+11/−405** — **sin la mitad que
configura**. Eso deja:

1. **El bypass del backend quedó inalcanzable en `main` y `staging`.** El backend sigue ramificando
   por `$request->input('isMotaiRenting') === true || $request->input('merchant_mode') === 'motai_renting'`
   (`OnboardingController.php:1227`), pero **el front ya no manda ninguno de los dos**. Verificado: en
   `origin/main` y `origin/staging` no queda un solo punto del front que ponga esos campos en un
   payload. Es decir: en esos ambientes, para Motai **ya no se fuerza `corbeta=false`, ya no se salta
   `userViability`/Experian y ya no se salta `validateRiskCentrals`** — y no hay `lenders.product` que
   reponga ese comportamiento porque la mitad de configuración no llegó.
2. **PEP quedó apagado en `main` y `staging`.** El filtro que excluía PEP volvió a ser una constante
   de módulo evaluada una sola vez (`const options = documentTypeOptions.filter(opt => opt.value !== "PEP")`),
   y el gate que lo habilitaba se fue con el borrado. Sin `allowed_document_types`, **nadie puede
   elegir PEP** en esos ambientes.
3. **Los TyC de Motai siguen quemados en `main` y `staging`.** `MOTAI_LENDER_IDS` sobrevive en 5
   archivos, incluido `phone-number-step-form.tsx`, que sigue eligiendo las URLs de política de
   privacidad y TyC por id.

**Qué hay que hacer con eso:** confirmar con quien promovió #786/#790 si el flujo de renting estaba
activo en esos ambientes y, si lo estaba, **promover la mitad configurable o revertir la limpieza**.
Un flujo que dejó de saltar el buró y no puede elegir PEP no es «más limpio»: es distinto.

**Además:** el servicio de pre-aprobación consulta el cupo contra el backend de **`develop`**, no
contra `qa` (comprobado a fines de julio — conviene reconfirmar la configuración de ese servicio).
Mientras el arreglo de cupo sin buró viva solo en `qa`, la tarjeta del marketplace **seguirá diciendo
«Sin cupo disponible»** aunque el cambio esté correcto. Hay que llevar el cambio a `develop` o
repuntar la configuración de ese servicio. Es exactamente lo que se ve en la evidencia de la §5: el
mismo POST devuelve *approved / 20.000.000* contra el ambiente de pruebas y
*`eligibility_criteria_not_met` / 0* contra el de desarrollo.

---

## 7. Lo que quedó abierto

### 7.1 Técnico

- [ ] **Promover de `qa` a `develop`/`staging`/`main`**, y aplicar las migraciones en cada ambiente
      (§4). Verificar el workflow manual de migraciones, que parece roto.
- [ ] **Backfill de `allied_documents` no idempotente** → cambiar `insert` por `updateOrInsert`, y
      backfillear el resto de los comercios reales.
- [ ] **Documentos `13`/`18` todavía hardcodeados** en el fallback de TyC, y **dos mecanismos de TyC
      conviviendo** (`allied_documents` vs la rama de «legal previsualization») → converger.
- [ ] **Consentimiento quemado** `terms: true` en el payload del front → atarlo a la configuración.
- [ ] **RTO (`product = 'rto'`)**: le falta la tarjeta propia (hoy un `rto` cae en la tarjeta de
      crédito) y la fórmula de valor a financiar. *Estado: en agosto se clonó el 158 como «Rent to
      Own» dejando `product` en `renting` a propósito — se pidió cambiar solo el nombre — así que la
      rama `terms` sigue sin ejercitarse. Pasarlo a `rto` es un `UPDATE` de un campo el día que se
      quiera.*
- [ ] **`PHP >= 8.4` en CI** si alguna vez se quiere volver a `symfony/expression-language ^8.1`
      (hoy fijado en `^7.4` por los ambientes en 8.3).
- [ ] **Renombrar las rutas** `/api/onboarding/motai/*` a nombres genéricos (`/abaco/*`). **No
      borrarlas todavía**: el front sigue consumiendo `check-abaco-requirement` desde varios puntos, y
      `motai/update-status` sale del perfil financiero.
- [ ] **CRUD de administración** para `product`, `calculator`, `document_types` y `allied_documents`.
      Hoy todo eso se edita por SQL o migración: la configuración existe pero **nadie del negocio
      puede tocarla**.
- [ ] **Hardcode `if ($ctopx_lender_id == 160)`** en `LenderRetrievalService.php:720` — **sigue
      presente en `qa`**. Solo CrediPullman va al servicio de Loans (el que tiene el arreglo de cupo);
      el resto, incluido el 158, va a la clase **gemela** de
      `Modules/Onboarding/App/Services/lenders/LenderUserCategoryService`, que **no tiene el skip**. De
      ahí salen plazo, `initial_fee_percentage`, `max_amount` y el filtro que elimina la entidad.
      **Decidir: parchear la gemela o unificar las dos clases.**
- [ ] **`document_types` nace `NULL`**: lo sembró un backfill, y las filas de
      `lenders_by_allied_branches` que se crean después nacen sin valor. Opciones: heredar en
      `AlliedManagementService`, poner default de columna, o mover el dato a `lender_requirements`.
- [ ] **Persistir `average_income` de Ábaco** (hoy se calcula y se descarta) y **borrar la ruta
      `GET scraping/init/gig-economy`**, que está rota.
- [ ] **La story del catálogo de componentes** de la tarjeta de renting quedó en la versión previa
      (sin `product` ni `calculated`) → no dibuja la tarjeta nueva; por eso lo visual solo se pudo
      verificar dentro del wizard.
- [ ] **Cerrar el hallazgo** de la firma del titular con codeudor activo (§3.8) — probablemente ya
      cubierto por los PRs #832/#833 de agosto; confirmar.
- [ ] **Los PRs #983 (backend) y #706 (frontend) siguen abiertos y están superseded.** Cerrarlos para
      que nadie los mergee.

### 7.2 Decisiones de negocio pendientes

- **Score mínimo del titular**: el PRD dice **400** en un lado y **0** en otro.
- **¿Datacrédito al 100% aplica a PEP?** El MVP2 pide consultar siempre, lo que **revierte** el
  bypass de buró que es el corazón del flujo actual. Para thin-file no hay historial que consultar.
- **¿Renting y RTO son dos entidades o una con un flag «opción de compra»?** La política es idéntica
  según el PRD; si son dos, necesitan plantilla de reglas compartida.
- **Confirmar los plazos del RTO: 52/78/104 semanas.** Verificado matemáticamente: las cuotas del PRD
  ($230.997 / $162.078 / $127.815) **solo cierran** con amortización semanal a 52/78/104 semanas, o
  sea **12/18/24 MESES**. La columna «Semanas» del simulador del PRD dice 12/18/24 y **está mal**.
- **La fórmula base de la tarifa de renting** (la tarifa del ejemplo está escalada; falta la
  definición formal).
- **El prorrateo `÷30 ×7`**: cualquier cambio es una decisión legal, no técnica (§3.7).

---

## 8. Qué se construyó encima, en agosto

Para que nadie duplique trabajo ni asuma que el flujo quedó como en julio. Todo esto está en `qa`:

**Codeudor** (Santi, Oscar, Luis) — flujo completo: rutas agrupadas bajo prefijo y pantallas de firma
(#754), la elegibilidad decidida por el **cupo type 3** (#1117, #831), guard que **bloquea al titular
de firmar sin el codeudor** (#1112), identidad del codeudor cuando la entidad usa AWS (#824), ruteo
del OTP a validación de identidad (#822, #1104), sincronización de las esperas del saga **por socket**
(#829, #830), y los dos arreglos de la firma diferida (#832, #833).

**Calculadora y plan de pagos** (Luis) — **plan de pagos de renting/rto derivado del `calculator`**
(#1105) — nótese que despacha por la **matriz** del calculator, no por `product` —, el front **manda
el plan elegido** al backend (#823), las líneas semanales dicen el **día de la semana** en lugar de un
día del mes (#825), los planes se etiquetan **por nombre** y no por cantidad de cuotas (#826), montos
de autorización (#1119), y el arreglo del **orden de las fórmulas** en MySQL (#95db703d, §3.3).

**Originación con corte semanal** (#1073) y **catálogo de documentos de firma** con política por
codeudor (#1110, #1113, #1114, #1115, #1118).

**Ábaco** (José, Luis) — rondas de QA: iconos de plataformas solo desde el backend (#816), rediseño de
las pantallas de plataformas y OTP (#821), ruteo del salto por `next_step` (#810), historial del
navegador (#818), pantalla de handoff del asesor como terminal (#827), `abaco_customer_id` en
`user_summaries`. **PR #1120 sigue abierto** («fix salary abaco»).

**Reintentos de Ábaco** — el paso ya no puede dejar atrapado al usuario: `AbacoStepResolver` lo
muestra solo si está habilitado **y** no completado **y** quedan intentos (`max_attempts` con fallback
3); el estado vive en una fila de `user_request_additional_information` con
`type_data = 'Abaco step state'`. Cuenta intento fallido: `ABAC2004`, `ABAC4005`, `ABAC5004`. Marca
completado: `results` OK (`ABAC5001`), **haya dado resultado positivo o negativo** — recolectó y
guardó, el paso se cumple.

> **Dato operativo útil:** en los ambientes compartidos **no hay mock de Ábaco** (`mock_pass` solo
> aplica en local), así que el login va al proveedor **real** y con un usuario sintético
> `login/step-2` devuelve `ABAC4005` y la plataforma queda en `error`. **Eso no es un bug** — y encima
> consume el contador de intentos. El camino feliz completo solo se ve en local.

---

## Anexo A — «Quiero cambiar X → toco Y»

| Quiero… | Antes | Ahora |
|---|---|---|
| que una entidad sea de arrendamiento | código en dos repos + despliegue | `UPDATE lenders SET product='renting'` |
| cambiar una tarifa o un factor de plazo | despliegue del frontend | editar el JSON de `lenders.calculator` |
| habilitar PEP en una sucursal | `if` en el front | `lenders_by_allied_branches.document_types` |
| que una entidad pida validación de ingresos con Ábaco | modo del comercio | `lender_requirements.abaco_is_enabled` |
| cambiar los TyC de un comercio | ids quemados en dos servicios | filas en `allied_documents` (⚠ **completas**) |
| agregar un plan de alquiler | código | una fila más en `calculator.plans` |
| cambiar el plan por defecto | código | mover `"default": true` de fila |
| dar de alta un segundo comercio de arrendamiento | proyecto | filas de configuración |

## Anexo B — Trampas de nomenclatura

- **El id `158` es dos cosas.** Es el **comercio** `allied_id = 158` (Motai) **y** la **entidad**
  `lender_id = 158` («Motai Renting», in-platform). Tablas distintas, mismo número. En otros
  contextos el 24 tiene la misma colisión.
- **El padrón de entidades difiere por ambiente.** En el ambiente compartido, Motai tiene `62` (Motai
  X, credit) y `158` (Motai Renting, renting); en el dump local hay `168/169/170` (Motai C/R/RB =
  credit/renting/rto), y los ids 169/170 del ambiente compartido son **otras entidades de otros
  comercios**. **Nunca asumir que un id significa lo mismo en los dos lados: mirar `lenders.product`.**
- **`lenders_by_allied_branches.status` es NO-OP para la visibilidad.** Lo que corta el listado es
  `lenders.status` (global). Cambiar el status de la sucursal no oculta nada.
- **PEP migratorio ≠ PEP AML.** Acá PEP = **Permiso Especial de Permanencia** (migrante); en el AML de
  los proveedores «PEP» = **Persona Expuesta Políticamente**. El literal `'PEP'` del tipo de documento
  no dispara ninguna consulta a centrales.
- **La terminología del código está invertida respecto del PRD** (§3.7): el `renting` del código es el
  *rent-to-own* del PRD.
- **El «renting» al que aplica Ábaco es, legalmente, el producto que SÍ es un crédito.** Consecuencia
  directa de la inversión anterior, y conviene tenerla presente antes de discutir política de riesgo.

---

## Anexo C — Referencias de Jira

| Ticket | Frente |
|---|---|
| **CORE-265** | flujo unificado (des-motaización) |
| **CORE-266** | calculadora por entidad |
| **CORE-267** | TyC por comercio |
| **CORE-268** | recálculo de monto |
| **CORE-317** | codeudor — cierre propio tras la firma |
| **CORE-321** | Ábaco como configuración de la entidad + retiro de los modos |
| **CORE-323** | tarjeta de renting: plan, pago semanal y estados de carga |
| **QC-170 · QC-175 · QC-181** | hallazgos de la ronda de QA del flujo de renting |
