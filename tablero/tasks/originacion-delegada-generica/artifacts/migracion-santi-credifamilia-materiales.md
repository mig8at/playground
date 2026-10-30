# Migrar `feature/credifamilia-materiales` sobre `feat/originacion-delegada` (CORE-918)

Guía para pasar los cambios de Santi a las ramas de CORE-918 sin perderlos, y dejarlos listos para `qa`.
Está escrita para que un agente (o una persona) la siga paso a paso. Fecha: 2026-10-30.

---

## 1. Contexto: qué es CORE-918 y por qué se hizo

### El problema

Las entidades con `lenders.response_type = 4` son las de **originación delegada**: la entidad define su
propia política de crédito y Creditop origina por sus rieles (plan de pago, firma, pagaré y radicación); la
entidad desembolsa y cobra. Hoy las usan Credifamilia Salud (24) y Credifamilia Materiales (214 en
producción, 216 en dev, qa y staging).

El código ya entraba a ese riel por el tipo (autorización, fechas de pago, plan de cuotas), pero todo lo de
adentro estaba atado a Credifamilia:

- los servicios del plan de pago filtraban con `CredifamiliaLenders::lenderIds()`;
- el perfil (fuente de la fianza, tipo forzado, 4x1000) era un `match` por id en `CredifamiliaLenderProfile`;
- los días de pago 2 y 16 estaban escritos en el código;
- tasa, seguro y monto máximo salían siempre de la preaprobación de Credifamilia;
- al autorizar se armaba siempre el paquete de legalización de Credifamilia;
- las rutas eran `payment-plan/credifamilia/*`, así que Materiales (slug `credifamilia-materiales`) no tenía ruta.

### Por qué

Banco Finandina entra por el mismo riel. Así como estaba, había que duplicar todo lo de Credifamilia o
meterla en un riel que no le corresponde. Con otra entidad del tipo 4, **la autorización terminaba en 422**
porque le exigía los documentos de legalización de Credifamilia.

### El criterio (importante para no volver atrás)

El tipo de una entidad lo define **de quién es la política de crédito**, no quién ejecuta la evaluación:

| tipo | nombre | política | origina y firma |
|---|---|---|---|
| 0 | Redirección | de la entidad | la entidad, en su sitio |
| 1 | Integrada | de la entidad | la entidad, en su flujo |
| 2 | CreditopX consumo | de Creditop | rieles de Creditop |
| 3 | CreditopX rotativo | de Creditop | rieles de Creditop |
| 4 | **Originación delegada** | de la entidad | rieles de Creditop, y se radica ante la entidad |

**Regla de oro:** dentro de `app/Services/PaymentPlan/DelegatedOrigination/` no va nada de una entidad en
particular, ni ids, ni `lender_id === 24`, ni textos con su nombre. Lo que es de una entidad se configura en
su perfil (tabla) o vive en su propia carpeta de integración.

---

## 2. Los PRs y las ramas

| repo | rama | PR (base `qa`) |
|---|---|---|
| legacy-backend | `feat/originacion-delegada` | https://github.com/Creditop-SAS/legacy-backend/pull/1815 |
| frontend-monorepo | `feat/originacion-delegada` | https://github.com/Creditop-SAS/frontend-monorepo/pull/1314 |

### legacy-backend: seis commits, en orden

1. `26fe0cbe6` **Rutas por entidad.** `payment-plan/{lender_slug}/…` (continuar, fechas, cuotas, opciones,
   resumen, comprobante). El slug se resuelve con `DelegatedOriginationLenders::findBySlug` (cualquier
   entidad con `response_type = 4`). Si el slug no es del riel responde 404 `CP011`. `payment-plan/credifamilia/*` sigue
   sirviendo a Salud. Las opciones de crédito calculan con la entidad de la ruta aunque la solicitud no tenga
   entidad todavía.
2. `05fc86d4a` **Perfil en tabla.** Nueva tabla `delegated_origination_profiles` (una fila por entidad del
   riel) y su siembra para Salud y Materiales. Se borra `CredifamiliaLenderProfile`; lo reemplaza
   `DelegatedOriginationLenderProfile`, que lee la fila. Una entidad del riel sin perfil **falla explícito**.
   El vertical del SOAP (`Salud`/`Materiales`) pasa a `CredifamiliaLenders::soapVerticalFor`.
3. `e6d79b57c` **Insumos por fuente.** `DelegatedOriginationInputs` + `DelegatedOriginationInputsSources`:
   el perfil nombra de dónde salen tasa, seguro, máximo y fianza. La llamada a pre-approvals de Credifamilia
   se movió sin cambios a `CredifamiliaPreApprovalInputs`.
4. `c8e1845ea` **Formalización por perfil.** `DelegatedOriginationFormalization` +
   `DelegatedOriginationFormalizations`: al autorizar, `LoanAuthorizationService` usa la formalización que
   nombra el perfil (`CredifamiliaFormalizationService` para Salud y Materiales). Una entidad sin
   formalización no se radica y lo deja en el log.
5. `ce45c5d72` **Renombre puro.** Lo del riel sale de `PaymentPlan/Credifamilia` a
   `PaymentPlan/DelegatedOrigination`, sin el prefijo `Credifamilia` (tabla de nombres abajo).
6. `9081bb7fb` **Limpieza.** Un solo `4` (`DelegatedOriginationLenders::RESPONSE_TYPE`), pruebas del riel en
   su carpeta, y los textos `lender` (opciones) y `credit_type` (comprobante) toman el nombre de la entidad.

### frontend-monorepo: un commit

`437048054`: `supportsDynamicPaymentPlan` decide por `response_type === 4` y no por la lista de ids
`[24, 214, 216]`. Se borraron `DYNAMIC_PAYMENT_PLAN_LENDER_IDS` y `CREDIFAMILIA_MATERIALES_LENDER_IDS`. `4`
entra a `LenderResponseType` y a `LENDER_RESPONSE_TYPE` como `DELEGATED_ORIGINATION`.

### La tabla `delegated_origination_profiles`

| columna | qué es | Salud (24) | Materiales (214/216) |
|---|---|---|---|
| `bond_percentage_source` | `pre_approval` o `fng_table` | `pre_approval` | `fng_table` |
| `forced_bond_type` | `Anticipada` / `Vencida` / null | null | `Anticipada` |
| `applies_four_per_thousand` | cobra 4x1000 sobre la fianza | true | **false en la rama; Santi lo cambia a true** |
| `payment_days` | JSON, el primero es el default | `[2, 16]` | `[2, 16]` |
| `inputs_source` | clave de `DelegatedOriginationInputsSources` | `credifamilia_pre_approval` | `credifamilia_pre_approval` |
| `formalization` | clave de `DelegatedOriginationFormalizations` | `credifamilia_radication` | `credifamilia_radication` |

Migraciones: `2026_10_30_120000_create_delegated_origination_profiles_table` y
`2026_10_30_120100_seed_delegated_origination_profiles_for_credifamilia`. La siembra usa
`CredifamiliaLenders::materialesLenderId()` (214 en producción, 216 fuera), salta si la entidad no existe y
no pisa una fila ya cargada.

### Nombres viejos → nuevos (legacy-backend)

Namespace: `App\Services\PaymentPlan\Credifamilia\…` → `App\Services\PaymentPlan\DelegatedOrigination\…`

| antes | ahora |
|---|---|
| `CredifamiliaPayloadBuilder` | `PaymentPlanPayloadBuilder` |
| `CredifamiliaPaymentPlanCalculatorService` | `PaymentPlanCalculatorService` |
| `Contracts\CredifamiliaPaymentPlanCalculatorInterface` | `Contracts\PaymentPlanCalculatorInterface` |
| `DTO\CredifamiliaPaymentPlanInput` / `…Result` | `DTO\PaymentPlanInput` / `DTO\PaymentPlanResult` |
| `Engine\CredifamiliaAmortizationEngine` | `Engine\AmortizationEngine` |
| `Engine\ScheduleGenerator`, `Engine\CalculationContext`, `Math\*`, `ValueObjects\*`, `Exceptions\PaymentPlanCalculationException` | mismo nombre, namespace nuevo |
| `Lender\BondPercentageSource` | `BondPercentageSource` (raíz del namespace) |
| `Lender\CredifamiliaLenderProfile` | **borrado** → `DelegatedOriginationLenderProfile` (lee la tabla) |
| `Constants\CredifamiliaPaymentPlanErrorCodes` | `Constants\PaymentPlanErrorCodes` |
| `ContinueRequest\CredifamiliaContinueRequestService` | `ContinueRequest\PaymentPlanContinueRequestService` |
| `InstallmentPlan\CredifamiliaInstallmentPlanService` | `InstallmentPlan\InstallmentPlanService` |
| `LoanOptions\CredifamiliaLoanOptionsService` | `LoanOptions\PaymentPlanLoanOptionsService` |
| `PaymentDates\CredifamiliaPaymentDatesService` | `PaymentDates\PaymentPlanDatesService` |
| `PaymentPlanSummary\CredifamiliaPaymentPlanSummaryService` | `PaymentPlanSummary\PaymentPlanSummaryService` |
| `Voucher\CredifamiliaVoucherService` | `Voucher\PaymentPlanVoucherService` |
| `Modules\Onboarding\…\PaymentPlan\Credifamilia*Controller` | `PaymentPlan*Controller` (`CredifamiliaInstallmentPlanController` → `InstallmentPlanController`, `CredifamiliaPaymentPlanController` → `PaymentPlanCalculateController`) |
| `CredifamiliaPaymentPlanRequest` | `PaymentPlanCalculateRequest` |
| `LenderIntegrationRules::RESPONSE_TYPE_CREDIFAMILIA` | `RESPONSE_TYPE_DELEGATED_ORIGINATION` |

**Se quedan en `App\Services\PaymentPlan\Credifamilia\…`** (son de la integración): `Constants\CredifamiliaLenders`
(ids, `engineLenderIdFor`, `soapVerticalFor`) y `CredifamiliaPreApprovalInputs`. Siguen igual, fuera de esa
carpeta: la radicación SOAP (`app/Actions/Lenders/CredifamiliaConsumo/*`), CrossCore/Evidente/Jumio,
`CredifamiliaFormalizationService`, `CredifamiliaLegalizationDocumentService` y `CredifamiliaDocumentsBuilder`.

**Pruebas movidas:** `tests/Unit/Services/PaymentPlan/Credifamilia/*` → `tests/Unit/Services/PaymentPlan/DelegatedOrigination/*`
(con su `fixtures/`), y `tests/Unit/PaymentPlan/Credifamilia/CredifamiliaLenderProfileTest.php` →
`tests/Unit/PaymentPlan/DelegatedOrigination/DelegatedOriginationLenderProfileTest.php`. Las pruebas que montan
SQLite ahora corren también las dos migraciones del perfil.

**Lo que NO cambió a propósito:** los textos de log `'CredifamiliaPayloadBuilder: …'`, la URL
`payment-plan/credifamilia/calculate`, el `formula_version` `CREDIFAMILIA_V1_…` y los valores de las respuestas
para Salud.

---

## 3. La rama de Santi: qué tiene y qué pasa con cada cosa

Rama: `feature/credifamilia-materiales` (front y back). Sus PRs anteriores ya están en `qa`
(legacy-backend #1733 y #1742, frontend-monorepo #1224). Quedan **dos commits del backend sin PR**:

| commit | qué hace | estado sobre `feat/originacion-delegada` |
|---|---|---|
| `3767dae2d` feat(credifamilia): Materiales now charges the 4x1000 | Materiales pasa a cobrar 4x1000 (Credifamilia lo confirmó por escrito) y fija tres casos oficiales | **choca**: el perfil ya no está en código, ahora es una fila de la tabla |
| `92c7760e9` feat(credifamilia): expose supplier and total bond in document payload | agrega `supplier_name`, `supplier_nit`, `total_bond` y `bond_percentage` al payload de documentos | **entra limpio** |

**Front (`cd5875794`, PR #1224):** ya está en `qa` y en `feat/originacion-delegada`, y quedó **superado**:
nuestro commit decide por el riel (`response_type === 4`), así que Materiales calcula su cuota en el backend
sin lista de ids. No hay nada que portar del front.

---

## 4. Cómo migrar, paso a paso

> ⚠ En legacy-backend **nunca** se corre la suite entera de PHPUnit (`make test`, `artisan test` sin ruta,
> `migrate:fresh`, ni Run desde el editor): una prueba con `RefreshDatabase` puede vaciar la base que diga el
> `.env`. Correr **sólo** las rutas de abajo.

### 4.1 Rama de trabajo

```bash
git fetch origin feat/originacion-delegada feature/credifamilia-materiales
git switch -c feature/credifamilia-materiales-riel4 origin/feat/originacion-delegada
```

### 4.2 Commit 1: 4x1000 de Materiales (`3767dae2d`)

```bash
git cherry-pick -n 3767dae2d
```

Va a dar conflictos *modify/delete* en dos archivos que ya no existen. Resolver así:

1. **Borrar los dos archivos viejos** (su contenido ya vive en otro lado):
   ```bash
   git rm app/Services/PaymentPlan/Credifamilia/Lender/CredifamiliaLenderProfile.php \
          tests/Unit/PaymentPlan/Credifamilia/CredifamiliaLenderProfileTest.php
   ```
2. **Llevar el cambio de dato a la siembra del perfil:**
   `database/migrations/2026_10_30_120100_seed_delegated_origination_profiles_for_credifamilia.php`, en el
   perfil de `CredifamiliaLenders::materialesLenderId()`:
   ```php
   'forced_bond_type'          => 'Anticipada',
   'applies_four_per_thousand' => true,   // antes false
   ```
   y actualizar el comentario de la clase: Materiales también cobra 4x1000 porque Credifamilia confirmó por
   escrito que la fianza FNG lo genera, al revés del alcance inicial.
   *(Ver el punto 5 si esta migración ya corrió en algún ambiente.)*
3. **Llevar la aserción a la prueba movida:**
   `tests/Unit/PaymentPlan/DelegatedOrigination/DelegatedOriginationLenderProfileTest.php`, en
   `test_materiales_profile`:
   ```php
   $this->assertTrue($profile->appliesFourPerThousand());   // antes assertFalse
   ```
4. **Adaptar la prueba nueva** `tests/Unit/Lenders/CredifamiliaConsumo/MaterialesFourPerThousandOfficialCasesTest.php`:
   - imports y usos:
     `CredifamiliaPayloadBuilder` → `App\Services\PaymentPlan\DelegatedOrigination\PaymentPlanPayloadBuilder`,
     `CredifamiliaPaymentPlanCalculatorService` → `…\DelegatedOrigination\PaymentPlanCalculatorService`,
     `Engine\CredifamiliaAmortizationEngine` → `…\DelegatedOrigination\Engine\AmortizationEngine`,
     `Engine\ScheduleGenerator` → `…\DelegatedOrigination\Engine\ScheduleGenerator`;
   - en `setUp`, después de las dos migraciones FNG, sumar las del perfil (si no, el perfil de Materiales no
     existe y el cálculo tira error):
     ```php
     'database/migrations/2026_10_30_120000_create_delegated_origination_profiles_table.php',
     'database/migrations/2026_10_30_120100_seed_delegated_origination_profiles_for_credifamilia.php',
     ```
   - en `tearDown`, antes de borrar `lender_term_fng_percentages`:
     ```php
     Schema::dropIfExists('delegated_origination_profiles');
     ```
5. `BondBreakdown.php`, `SoapPayloadMaterialesTest.php` y `CredifamiliaPayloadBuilderFngTest.php` se
   fusionan solos; revisar que no aparezca ningún nombre viejo de la tabla de la sección 2.

### 4.3 Commit 2: datos del proveedor y la fianza (`92c7760e9`)

```bash
git cherry-pick -n 92c7760e9
```

Entra limpio en `Modules/Loans/App/Services/DocumentGeneration/Payload/OnboardingPayloadBuilder.php`.
`credit_conditions.bond_percentage` y `credit_conditions.total_bond` existen igual en
`PaymentPlanSummaryService` de la rama nueva.

### 4.4 Verificar

```bash
./vendor/bin/sail composer dump-autoload
./vendor/bin/sail artisan test tests/Unit/Lenders/CredifamiliaConsumo/MaterialesFourPerThousandOfficialCasesTest.php
./vendor/bin/sail artisan test tests/Unit/PaymentPlan tests/Unit/Services/PaymentPlan tests/Unit/Lenders/CredifamiliaConsumo tests/Unit/DocumentGeneration/Payload/OnboardingPayloadBuilderTest.php
```

Resultado esperado (medido al armar esta guía):

- los **3 casos oficiales pasan** (2.545.000 a 24 meses, 9.563.641 a 48 y 8.756.214 a 12);
- en el resto: **173 pasan y 8 fallan**. Las 8 ya fallan en `qa` sin estos cambios: 7 de la radicación SOAP
  (`DocumentRequestTest`, `TransactionRequestTest`: campos del payload como `DiaPago` y `ciudadEmpresa`) y 1 de
  `OnboardingPayloadBuilderTest` (una ciudad que sale en mayúsculas). Una falla distinta a esas sí es de la
  migración.

Buscar que no quede nada viejo:

```bash
git grep -n -E "CredifamiliaLenderProfile|PaymentPlan\\\\Credifamilia\\\\(Lender|DTO|Engine|Math|ValueObjects|LoanOptions|Voucher)|CredifamiliaPayloadBuilder[^:]" -- app Modules tests database
```

Sólo deben salir los tres textos de log `'CredifamiliaPayloadBuilder: …'` de `CredifamiliaPreApprovalInputs.php`
y el nombre de la prueba `CredifamiliaPayloadBuilderFngTest`.

### 4.5 Commits y PR

Hacer dos commits, uno por cada cambio original, y conservar sus mensajes:

```bash
git commit -m "feat(credifamilia): Materiales now charges the 4x1000" -- <archivos del 4.2>
git commit -m "feat(credifamilia): expose supplier and total bond in document payload" -- Modules/Loans/App/Services/DocumentGeneration/Payload/OnboardingPayloadBuilder.php
git push -u origin feature/credifamilia-materiales-riel4
```

Abrir el PR **contra `feat/originacion-delegada`** (no contra `qa`), para que entre junto con CORE-918
(#1815) y no haya un `qa` con una mitad sin la otra. Con eso, la rama `feature/credifamilia-materiales` queda
cubierta y se puede cerrar.

Hay un parche de referencia con la migración ya resuelta: `santi-credifamilia-materiales-sobre-originacion-delegada.patch`
(se aplica sobre `feat/originacion-delegada` en `9081bb7fb` con `git apply --index`). Sirve para comparar con lo
que haga el agente; los commits hay que hacerlos igual, para conservar los mensajes.

---

## 5. Despliegue en qa

1. **Las migraciones van antes que el código.** Correr `run-migrations.yml` (manual) con
   `2026_10_30_120000_create_delegated_origination_profiles_table` y
   `2026_10_30_120100_seed_delegated_origination_profiles_for_credifamilia`. Sin la siembra, Credifamilia no
   calcula su plan de pago. dev, qa y staging comparten base: migrar una vez sirve para los tres.
2. **Si la siembra ya corrió antes de que entre el cambio de 4x1000**, editarla no alcanza: la migración
   figura como aplicada y no pisa filas existentes. En ese caso, en vez de editar la siembra, agregar una
   migración nueva que actualice la fila:
   ```php
   DB::table('delegated_origination_profiles')
       ->where('lender_id', CredifamiliaLenders::materialesLenderId())
       ->update(['applies_four_per_thousand' => true, 'updated_at' => now()]);
   ```
   (con su `down()` volviendo a `false`).
3. Mergear el PR de Santi a `feat/originacion-delegada`, después #1815 y #1314 a `qa`, y desplegar.
4. Validar en qa con Duncan, de punta a punta, que Credifamilia Salud y Materiales siguen funcionando:
   cuota en la tarjeta, fecha (2 o 16), plan de cuotas, documentos (incluidos los nuevos datos de proveedor y
   fianza), firma, autorización y radicación. Para Materiales, el monto financiado ahora incluye el 4x1000.

## 6. Lo que queda abierto

- Finandina entra después de esta validación: necesita su fila en `delegated_origination_profiles`, una
  fuente de insumos propia y su formalización (entrega de la operación).
- `ExternallyManagedPaymentScheduleService` conserva su nombre; renombrarlo toca el registro de estrategias de
  plan de pago de Loans.
