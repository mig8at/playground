# CASOS ESPECIALES — por qué "falla el random" y la clasificación de fallos

> **Propósito (dueño):** este documento es la **guía interpretativa del `random`** del harness Go y de la
> **clasificación de fallos** (`classifyErr`). Su tesis única: **casi todos los ❌ son GAPS DE CONFIGURACIÓN del
> lender, no lógica de flujo distinta.** También es el **dueño de las cifras agregadas de "deuda de config"** (rt=2
> con criterio de garantía, cobertura de credencial Bancolombia).
>
> Lo que NO vive aquí (déjalo por enlace):
> - Taxonomía `response_type` 0-4 y ciclo de vida `user_request_statuses` → [./CREDITOP.md](../CREDITOP.md).
> - Estructura de tablas/columnas/relaciones → [./MODELO-DATOS.md](./MODELO-DATOS.md).
> - IDs/montos/status quemados, forks de entrada, magic numbers → [./LOGICA-QUEMADA.md](./LOGICA-QUEMADA.md).
> - Mecánica detallada por flujo (citas archivo:línea, mocks) → [./REFERENCIA-FLUJOS.md](./REFERENCIA-FLUJOS.md).
> - Encadenamiento FE↔BE (URL→archivo→endpoint→tabla→prueba) → [./REFERENCIA-FLUJOS.md](./REFERENCIA-FLUJOS.md).
> - CLI del harness (`random` y demás) → [../backend-e2e/SUITE.md](../../backend-e2e/SUITE.md); estado → [../backend-e2e/VALIDATION.md](../../backend-e2e/VALIDATION.md).

---

## TL;DR — la conclusión

**Los flujos son pocos y bien definidos; casi todos los ❌ son GAPS DE CONFIGURACIÓN, no lógica distinta.**

| Caso fallido | ¿Flujo distinto o config? | Veredicto |
|---|---|---|
| rt=0 (46 lenders) "falla" en cierre in-platform | **Flujo distinto** (son redirect, no se cierran in-platform) | comportamiento ÚNICO pero **todos iguales entre sí** — el random NO debe intentarlos |
| rt=2: unos cierran y otros dan 500 (125/96/37) | **Config** (mismo flujo, falta 1 fila/columna o sobra una mal formada) | **mismo comportamiento**, distinta completitud de config |
| Bancolombia "no preaprobado" en unos comercios | **Config** (falta `lender_allied_credentials`) | **mismo flujo**, comercio sin credencial |
| rt=1 externos (Welli/BdB/Meddipay/…) | mezcla: ~4 sub-comportamientos | grupos claros (§4) |

> Referencia rápida de qué es cada `response_type` (0=UTM, 1=Integración, 2=Creditop X, 3=Cupo Rotativo,
> 4=Credifamilia async): ver [./CREDITOP.md](../CREDITOP.md). Aquí solo importa **por qué cada uno se comporta como
> se comporta frente al cierre del harness**.

---

## 1. rt=0 (46 lenders) — TODOS iguales: redirect UTM puro

**Comportamiento:** el `case 0` del switch en `UserRequestService::updateUserRequest`
(`Modules/Onboarding/App/Services/UserRequestService.php`) **solo devuelve una URL y `openNewTab`**. **No llama a
ninguna Action, no consume API, no genera pagaré.** El proceso continúa 100% en el sitio del prestamista
(Rapicredit, AV Villas, Lulo, Sufi, Davivienda, Brilla, PayJoy…).

**De dónde sale la URL (corregido):** `lenders_by_allied_branches.url_utm` (línea `:396`) con **fallback** a
`lenders_by_allieds.url_utm` (línea `:400`) si la de branch es null. **Nunca** usa la columna `lenders.url`.

**Los 46 se comportan IGUAL.** Excepciones cosméticas (datos inconsistentes, no lógica):
- Credifamilia-addi (6) tiene `action=App\Actions\Lenders\Addi` registrada, pero el `case 0` **la ignora**.
- Wompi (52) tiene `url='wompi'` (lender fantasma; la integración real de Wompi es rt=1, ver §4).

**Matiz importante — el switch tiene DOS ramas según `empty($credential)`** (`UserRequestService.php:425` vs `:450`):
- **Sin credencial:** `case 0` y `case 1` **caen juntos** (solo URL + `openNewTab`, sin ejecutar Action); `case 2/3/4`
  redirigen al confirmation self-service (`standBy=true`).
- **Con credencial:** `case 0` solo da URL; `case 1` sí ejecuta la integración (`register()`).

**Por qué el cierre in-platform "falla" sobre rt=0:** no son Creditop X. El pagaré/firma está gateado por
`response_type` **2 y 3**: `CreditopXQuotaController.php:159` desvía rt=3 (cupo rotativo) a `resolveRevolvingQuota()`, y
solo si `response_type != 2` (`:170`) rechaza con `lender_not_creditop_x` (mensaje "Creditop X o Cupo Rotativo", `:186`).
**No es un bug: rt=0 NO se cierra in-platform por diseño** — por eso el `random` los excluye del pool (ver §5).

**Diferencia con rt=1:** rt=0 entrega una URL **estática** y no inicia nada; rt=1 **ejecuta la Action** (`register()`)
que llama la API del banco y genera la URL/transacción. rt=0 = "link"; rt=1 = "integración".

**Citas:** `UserRequestService.php:396,400,427,453`, `CreditopXQuotaController.php:159,170,186`. (Mecánica completa →
[./REFERENCIA-FLUJOS.md](./REFERENCIA-FLUJOS.md).)

---

## 2. rt=2 — MISMO flujo, falla por config faltante

Los rt=2 comparten el **mismo cierre** (in-platform → Estado 11). Hay solo **2 variantes reales de lógica de cierre**:
**ownership/traditional** (PDF local) y **deceval** (SOAP externo). Lo que hace fallar a unos es **config incompleta**,
no flujo distinto:

| Lender | promissory_type | qué le falta / sobra | dónde revienta |
|---|---|---|---|
| **77 CrediPullman** ✅ | ownership | nada | cierra a 11 |
| **125 Medipast X** ❌ | ownership | tiene fila en `lender_guarantee_criteria` + `FGA=0` (ver mecanismo abajo) | `authorize` 500 |
| **96 Celupresto** ❌ | ownership | no hay `lenders_by_allieds(96, allied-del-request)` si se fuerza en otro comercio | `GET promissory-note` 500 (`PaymentCalculationService.php:25` `firstOrFail`) |
| **37 Creditop X** ❌ | **deceval** | no hay `RiskCentralCredential` tipo Lender para 37 (deceval requiere credencial) | `GET promissory-note` 500 (`DecevalSoap.php:54`) |

### 2.1. El 500 de garantía — mecanismo REAL (no es "variable NULL → eval")

Este es el gap **más común** y suele malinterpretarse. La cadena exacta (verificada):

1. En `authorize`, `DocumentSigningService::generateGuaranteeDocument` llama
   `GuaranteeService::generateGuaranteePdf()` (`DocumentSigningService.php:536`).
2. `generateGuaranteePdf` **devuelve `null` cuando `FGA <= 0`** (`GuaranteeService.php:125` def, `:137` el
   `return null`). Con `FGA=0` **no se persiste ninguna fila `Guarantee`**.
3. De vuelta en `DocumentSigningService`, `shouldRequestGuarantee($userRequest)` es **`true`** porque
   **existe una fila en `lender_guarantee_criteria`** (en `GuaranteeService.php:212`,
   `$guarantee = isset($criteria)` → cualquier fila de criterio hace `shouldRequestGuarantee=true`).
4. Entonces entra al bloque que busca la garantía recién creada: `Guarantee::where(...)->first()`
   (`DocumentSigningService.php:541`) → **`null`** (porque el paso 2 no la creó).
5. La línea siguiente la **desreferencia**: `$guarantee->id . '_' . ...` (`DocumentSigningService.php:543`) →
   **null deref → 500**.

> **La causa es "existe fila de criterio + `FGA=0`", NO "variable NULL".** Al contrario: que `variable` sea NULL
> **evita** el path peligroso del `eval()` (`GuaranteeService.php:214` `if ($x === 'SCORE')` → `:216`
> `eval("return ($condition);")`). Ese path está **MUERTO en la BD actual**: las **56/56 filas** de
> `lender_guarantee_criteria` tienen `variable=NULL` (verificado por SQL), así que el `eval` nunca se ejerce hoy.
> El riesgo real es el null-deref, no el `eval`.

**Citas:** `GuaranteeService.php:125,137,212,214,216`; `DocumentSigningService.php:536,541,543`.

### 2.2. Config mínima para que un rt=2 cierre

`promissory_type_id` resoluble (ownership/traditional, o deceval **con** su `RiskCentralCredential`),
`credit_line_by_lenders`, `lenders_by_allieds` para el (lender, allied) del request, categoría
(`lender_users_categories`), y que **NO exista** una fila en `lender_guarantee_criteria` cuando `FGA` resolverá a 0
(porque esa combinación produce el 500 de §2.1).

### 2.3. Agrupación de los rt=2

- ✅ **cierran out-of-the-box**: ownership, sin fila de `guarantee_criteria` problemática, asociación correcta
  (CrediPullman 77, Audivel X 95).
- ❌ **fila de `guarantee_criteria` + `FGA=0`** (la mayoría, ver §6) → `authorize` 500.
- ❌ **asociación allied faltante** (96) → `promissory-note` 500.
- ❌ **deceval sin credencial** (37, 139) → `promissory-note` 500.

> Es decir: **el "flujo" rt=2 es uno solo**; el random ❌ mide **completitud de config del lender**, no comportamiento
> distinto. Estructura de las tablas implicadas → [./MODELO-DATOS.md](./MODELO-DATOS.md); IDs concretos →
> [./LOGICA-QUEMADA.md](./LOGICA-QUEMADA.md).

---

## 3. Bancolombia PLS — MISMO flujo, el comercio sin credencial no aplica

PLS da "cupo" o "no preaprobado" según **una sola cosa: si el comercio tiene `lender_allied_credentials` para 68/100**.
`validateBancolombiaPreapprove` (`PreApprovedLenderService.php:663-727`) prueba 68 (BNPL) + 100 (consumo);
`validateQuota` (`BancolombiaBnpl.php:645`) llama `LenderAlliedCredential::findOrFailByLenderAndAlly(68, branch)` como
primer paso (`:675`). Si no existe credencial → `ModelNotFoundException` → catch (`:676`) → `hasBnpl=false` → default →
**PLS005 "El cliente no tiene ningún preaprobado"**.

| Comercio | lenders_by_allieds(68/100) | lender_allied_credentials(68/100) | PLS |
|---|---|---|---|
| Magnocell / Dormiluna ✅ | sí | **sí** (tipo Allied) | cupo |
| BICICLETAS STRONGMAN ❌ (allied 228) | sí | **VACÍO** | PLS005 (no preaprobado) |

**El gate NO es `lenders_by_allieds`** (eso solo lo muestra en la lista) **sino `lender_allied_credentials`**.
`bancolombia_type` solo se usa después, para la URL de redirect (BNPL vs Consumo), no para decidir cupo.
**Mismo flujo PLS**; el comercio sin credencial simplemente no entra.

**Citas:** `PreApprovedLenderService.php:663-727`, `LenderAlliedCredential.php:63` (def. de
`findOrFailByLenderAndAlly`; el query está en `:73`), `BancolombiaBnpl.php:675`.

---

## 4. rt=1 externos (no Bancolombia) — 4 sub-comportamientos

Comparten la base (`Integration`, `LenderTransaction`, `findOrFailByLenderAndAlly`, dispatch en `case 1`), pero
**cierran de 4 formas distintas**:

| Grupo (mismo comportamiento) | Lenders | Cómo cierra |
|---|---|---|
| **A. Redirect + async** | Welli(23), Banco de Bogotá(5), Sistecrédito-Pay(9), Approbe(41) | `register()`→URL de redirect + Job `StatusCheck` o webhook → Estado 11 **async** |
| **B. OTP in-store** | Sistecrédito-POS(9), Compensar(47) | 2 pasos: `register()` pide OTP → `validate()` confirma → Estado 11 inline |
| **C. Link por notificación** | Meddipay(39) | `register()` retorna `url=''`; Meddipay manda link al cliente por WhatsApp/SMS; modal de espera |
| **D. Pasarela de pago** (no crédito) | Wompi (la Action opera vía credencial `wompi_method` **dentro del `case 1`** sobre otro lender; el lender 52 es rt=0/fantasma), Payvalida, BdB CeroPay(133) | pago PSE/Nequi/checkout; Wompi tiene mock local; Payvalida usa tabla propia |

**Cómo se decide cada rama (corregido):**
- **OTP (grupo B):** **solo Sistecrédito-POS implementa la interface `OtpValidation`** (`app/Actions/Lenders/OtpValidation.php`,
  `SistecreditoPos.php`). El OTP de **Compensar NO viene de la interface** — está gateado **por nombre** en el switch:
  `UserRequestService.php:556-557` (`case 'Compensar': $data['validateLenderOtp']=true`). El de Sistecrédito-POS se
  decide por la credencial `sistecredito_pos` (`UserRequestService.php:564`).
- **Wompi-sobre-otro-lender (grupo D):** se dispara por la credencial `wompi_method` **dentro del `case 1`** (no es un
  lender propio); BNPL vs Consumo de Bancolombia se decide por `bancolombia_type` en el credential.

**Únicos por integración:** Banco de Bogotá (mTLS cert/key), Approbe (AES-128 propio), Compensar (OAuth2 + header
`idrespuesta`), Meddipay (2 hosts auth+API), Wompi (único con mock de entorno `WOMPI_MOCK_ENABLED`,
`config/services.php:297`), Payvalida (tabla `payvalida_transactions` propia). **Sistecrédito** es el único con doble
personalidad: POS (OTP) vs Pay (redirect) según la credencial.

**Para validar E2E** cada uno necesita mock de su host (`*.fake`) — mismo patrón que el bypass de Bancolombia.
Solo **Wompi** trae mock nativo (`WOMPI_MOCK_ENABLED=true`).

**Citas:** `Integration.php:13`, `Welli.php:178`, `BancoDeBogota.php:70`, `SistecreditoPos.php:147`, `Compensar.php:46`,
`Meddipay.php:53`, `Wompi.php:403`, `Payvalida.php:24`, `UserRequestService.php:457-580`. Mecánica completa por lender →
[./REFERENCIA-FLUJOS.md](./REFERENCIA-FLUJOS.md).

---

## 5. Resumen: mismos vs diferentes (para el `random`)

| response_type | ¿comportamiento entre sí? | ¿cierra in-platform? | el random debería… |
|---|---|---|---|
| **0 · UTM** (46) | TODOS iguales (redirect a URL del lender) | ❌ no (por diseño: el crédito se cierra fuera de Creditop) | **excluir** |
| **2 · Creditop X** (73 activos) | TODOS el mismo flujo | ✅ sí, si la config está completa | incluir; ❌ = gap de config (3 tipos), no flujo |
| **3 · Cupo Rotativo** (13) | todos iguales (revolving) | ✅ sí | incluir |
| **4 · Credifamilia async** (1) | estudio asíncrono | ⚠️ APROBADO, no 11 | incluir (con bypass) |
| **1 · Integración** (16) | 4 sub-grupos (A/B/C/D) | ⚠️ async/redirect, no 11 sync | incluir solo con mock de host (Bancolombia hecho) |

**Cómo arma el random su pool:** filtra `response_type IN (2,3) OR id IN (24,68,100)` (`backend-e2e/main.go:466`). Es
decir: incluye rt=2 y rt=3 por tipo, y **fuerza por ID** a Credifamilia (24, que es rt=4) y Bancolombia (68/100, rt=1).
Excluye rt=0 y el resto de rt=1. Notar que **Credifamilia entra por ID quemado, no por su response_type**. (CLI y
defaults del `random` → [../backend-e2e/SUITE.md](../../backend-e2e/SUITE.md); IDs forzados →
[./LOGICA-QUEMADA.md](./LOGICA-QUEMADA.md).)

**Implicación para el harness:** el `random` ya excluye rt=0 y rt=1-otros correctamente. Los ❌ que quedan en rt=2 son
un **diagnóstico de completitud de config** del lender (útil), no fallos del flujo. Para tener un random 100% verde
habría que (a) saltar lenders rt=2 con fila de `guarantee_criteria` + `FGA=0` / deceval-sin-credencial, o (b) sembrar
esa config — pero como contexto, lo valioso es **saber que el flujo es único y el ❌ es config**.

---

## 6. Cifras de "deuda de config" — FUENTE ÚNICA (auditoría de BD)

> Estas son las **cifras canónicas**; otros docs deben enlazar aquí en vez de duplicarlas. Verificadas por SQL contra
> la BD local (`docker exec legacy-backend-mysql-1 mysql -ucreditop -ppassword creditop -e "…"`). Pueden moverse ±1
> con cada seed; el método de conteo está anotado.

### 6.1. rt=2 — cobertura del gap de garantía

| Métrica | # | base | % |
|---|---|---|---|
| rt=2 **activos** (`status=1`) | 73 | — | — |
| rt=2 **totales** (incl. inactivos) | 76 | — | — |
| rt=2 activos **con** fila en `lender_guarantee_criteria` | **51** | 73 activos | **~70%** |
| rt=2 activos **sin** fila de criterio | 22 | 73 | ~30% |
| rt=2 activos **sin** `lender_users_categories` | 23 | 73 | ~32% |
| `lender_guarantee_criteria` — filas totales / con `variable=NULL` | **56 / 56** | — | **100% NULL** |

> Sobre la base de 76 totales, los "con criterio" son ~52/76 ≈ **68%**; sobre 73 activos, 51/73 ≈ **70%**. Ambas
> framings describen el mismo hecho: **la mayoría de los rt=2 arrastra una fila de criterio que, combinada con
> `FGA=0`, produce el 500 de §2.1.** Es **deuda de config sistémica**, no un caso aislado.

**Método:** `COUNT(*) FROM lenders WHERE response_type=2 [AND status=1]`; los "con criterio" = `COUNT(DISTINCT l.id)`
join con `lender_guarantee_criteria`. (Los buckets de "prioridad exclusiva" de versiones anteriores no eran
reproducibles por SQL puro y se reemplazaron por estos conteos directos.)

> Nota sobre **Celupresto(96)**: aparece como cerrable a nivel de lender, pero falla si se fuerza sobre un comercio que
> no es su allied (gap **relacional** `lenders_by_allieds(96,allied)`, §2). En `random` —que elige de
> `lenders_by_allieds`— se corre sobre su propio allied → cierra. El gap relacional no se ve en la auditoría por-lender,
> solo por-par.

### 6.2. rt=1 Bancolombia — cobertura de credencial

| Métrica | # allieds (distinct) |
|---|---|
| Ofrecen 68/100 (`lenders_by_allieds`) | **109** |
| Con `lender_allied_credentials` 68/100 (resolviendo branch→allied) | **~111** |
| **Ofrecen pero SIN credencial** (caso BICICLETAS STRONGMAN → PLS005) | **~6** |

> **Método:** `COUNT(DISTINCT allied_id)` sobre `lenders_by_allieds` para ofrecen; para credencial se resuelve el morph
> `allied_type` (110 a nivel `App\Models\Allied` + 1 vía `App\Models\AlliedBranch`→allied = 111 distintos). El
> "ofrecen-sin-credencial" se computa por diferencia de conjuntos = 6. (Las cifras 115/7 de versiones anteriores
> contaban filas/branches en vez de allieds distintos.)

La cobertura es alta (~94%): solo **~6 comercios** ofrecen Bancolombia sin tener credencial. BICICLETAS STRONGMAN es uno
de esos 6 — la excepción, no la regla. Por eso `random` dio 12/12 en Bancolombia (§7).

---

## 7. Resultado empírico (`go run . random 18`)

Corrida real de 18 tripletas válidas al azar (`lenders_by_allieds`):

```
RANDOM: 17 ✅ / 1 ❌
  rt=2:  3 ✅ / 1 ❌   → [authorize 500 (guarantee_criteria + FGA=0) ×1: CrediFis 0% #124]
  rt=3:  1 ✅ / 0 ❌
  rt=4:  1 ✅ / 0 ❌   (Credifamilia → APROBADO)
  rt=1: 12 ✅ / 0 ❌   (todos Bancolombia: comercios CON lender_allied_credentials)
```

**Lecturas:**
- **94% de los combos válidos al azar cierran limpio** — confirma que el motor genérico cubre cualquier combinación
  válida; el flujo es uno solo por `response_type`.
- El único ❌ es **exactamente** el gap predicho de §2.1 (fila de `guarantee_criteria` + `FGA=0`), no una sorpresa de
  flujo. CrediFis 0% (#124, rt=2) tiene fila en `lender_guarantee_criteria` (todas NULL) → consistente.
- **`smartpay` (#152) cerró OK** desde el comercio CeluRD Test (country 60). **SmartPay #152 es rt=2 y cierra por el
  flujo estándar Creditop X (`CreditopXClose`: promissory-note → authorize), NO por IMEI.** El IMEI es el colateral del
  flujo **Motai (lender 158)**, no de SmartPay (verificado en `backend-e2e/lender/lender.go:73-83`, donde solo
  `motaiClose` usa `testIMEI`, `closes.go:14,105`; SmartPay #152 cae en el `default → CreditopXClose`). Lo que falta
  para el E2E completo de SmartPay es el microservicio del **formulario dinámico** (la entrada), no el cierre.
- Los 12 Bancolombia verdes son comercios que **sí** tienen credencial — contrasta con BICICLETAS STRONGMAN (§3).

El `random` clasifica el ❌ con `classifyErr()` (`backend-e2e/main.go:551`): cada fallo se etiqueta con su tipo de gap
de config (p. ej. `authorize 500 (guarantee_criteria mal formada)`, `promissory-note 500 (deceval-sin-cred /
asociación allied faltante)`).

---

## 8. Conclusión del entendimiento

1. **Flujos: pocos y únicos** (5 cierres × 6 entradas; cadenas detalladas en
   [./REFERENCIA-FLUJOS.md](./REFERENCIA-FLUJOS.md)).
2. **La divergencia real es config**, y está **cuantificada** (§6): ~70% de los rt=2 activos arrastran la fila de
   `guarantee_criteria` que rompe `authorize` cuando `FGA=0`; ~6 comercios Bancolombia ofrecen sin credencial; los forks
   de entrada (Pullman, Motai, SmartPay/RD, Corbeta, ecommerce) son **conjuntos pequeños de IDs quemados** —ese inventario
   vive en [./LOGICA-QUEMADA.md](./LOGICA-QUEMADA.md), no aquí.
3. El `random` sobre `lenders_by_allieds` es un **medidor de completitud de config** — su ❌ mapea 1:1 con estos gaps,
   no con diferencias de lógica.
