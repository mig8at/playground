# KYC · contexto
> **estado:** al día con main · El estudio del cliente por burós: Experian/Datacrédito da el ÚNICO score; TusDatos identidad; Ágil Data/Mareigua ingreso (PILA); Quanto ingreso estimado. Reporte crudo cifrado en `risk_central_user_data`, espejado a `user_summaries` + EAV.
> ⚠ **`risk_centrals` cubre DOS momentos del flujo, no uno.** Lo de arriba es el **onboarding** (antes del listado). La **biometría** —Ado, TusDatos-AML, crosscore, evidente— es del tramo **post-selección**, y su proveedor lo elige el lender: casi la mitad usa AWS Rekognition y **no deja fila en la BD**. Ver «`risk_centrals` NO es la lista de burós» más abajo (F-101) antes de interpretar una ausencia.

## Qué es
KYC es la etapa que, disparada desde el formulario personal/laboral (Onboarding), consulta a los burós para armar el **perfil consolidado** — el sujeto que después evalúan las reglas del listado (Onboarding) y del cupo (Profiling/CreditopX). El **único buró que da SCORE** es **Experian/Datacrédito** (producto Acierta); el resto son KYC de identidad/ingreso/biometría y **no dan score**.

Todo aterriza en tres lugares: el **reporte crudo** en `risk_central_user_data.data` (**cifrado AES-256-CBC con APP_KEY**), un **espejo** normalizado en `user_summaries`, y **EAV** en `user_field_values` (87 ingreso, 29 ocupación, 160 reportado-en-centrales, 90 egresos, 161 continuidad). En **local/dev el buró se MOCKEA** (`ExperianFixture`, 212 KB → score sintético 654 / Acierta+Quanto 707), así que el score de dev no es real. Sobre estos datos deciden **dos motores de datacrédito** con campos y comparadores distintos (viejo rt≠2 vs nuevo rt=2) — el detalle vive en **Profiling**.

## Contenido
**Proveedores** (id de `risk_centrals` + cómo lo lee `User`; conteos = BD local, snapshot 2026-07-03):

- **Experian · Acierta** — el ÚNICO con score. OAuth2 `POST /spla/oauth2/v1/token` + `POST /cs/credit-history/v1/hdcplus` con `ProductId 64`. `score` = **promedio de `ReportHDCplus.models[].scoreValue`**; de `agregatedInfo.overview.principals`: **negativos 12m** (`negativeHistoricalLast12Months`), **consultas 6m** (`consultedLast6Months`), **créditos en negativo** (`currentNegativeCredits`), **maduración** (`maturationSince`); de `balances`: **cuota deuda/mes** (`valueMonthlyPayment`, ×1000). `User::datacredito()` lo resuelve **por NOMBRE** `IN ('Experian - Acierta','Experian - Acierta+Quanto')` + `latest` (NO por id). 258 filas (257 con score).
- **Experian · Quanto** — **ingreso ESTIMADO**, `productValueList[0]` con `productCode==62`; posiciones 0/1/2 = **promedio / inferior / superior** (×1000). Mismo host/OAuth/endpoint que Acierta pero **producto aparte**; se pide solo, combinado ("Acierta+Quanto", `modelCode 'Z0'`, que fusiona ambos en un único `risk_central_user_data`) o reusado del caché.
- **Ágil Data** (rc_id 3, Asofondos/PILA) — **1ª fuente de ingreso** (IBC) + empleo. `GET .../historicoDetalladoEmpleo/...`, Basic Auth + **mTLS** (cert de S3). Da ocupación (`codRespuesta` 01 empleado / 21 pensionado), **edad exacta**, **género**, **continuidad** (3/6/12m). Escribe TODO en `additional_info` (**plano, sin cifrar**). 202 filas.
- **Mareigua** (rc_id 6, PILA/seguridad social) — **ingreso de respaldo** (2ª fuente, fallback de Ágil) + continuidad + `tipo_cotizante` (1 empleado/2 indep/3 pensionado). OAuth `/token` + `POST /consultas`. **0 filas en `risk_centrals`** pero **20.449 en `user_summaries`** (solo espeja).
- **TusDatos** — **identidad** (rc_id 2, `data.findings.*.match_code` 0/1/2, o `estado` VIGENTE/CANCELADA para CE) + **AML** (rc_id 4, `POST /api/launch` async → poll `GET /api/results/{jobid}`; `hasFindings = hallazgo===true && hallazgos==='alto'`). **No da score.** `isSmartPay` salta el AML. 0 filas.
⚠ **Hay una tabla de MONITOREO del cruce de nombres: `kyc_name_checks`** (desde 2026-07-23). Cada vez
que una central devuelve un nombre, `Modules/Identity/App/Services/KycNameCheckRecorder::record` guarda
el ingresado vs el devuelto (crudo y normalizado), `central` (`agildata`|`mareigua`|`tusdatos`),
documento, `passed` y un `reason` clasificado — `match` · `provider_no_data` · `wrong_document`
(ninguna palabra en común: típicamente la cédula consultada no es de esa persona) · `token_mismatch`.

**Es SOLO monitoreo y nunca lanza**: un error al registrar no tumba la validación de identidad. O sea
que **no decide nada** — no lo confundas con un filtro. Sirve para responder «¿por qué esta identidad
no cuadró?» con datos en vez de suposiciones.

- **Ado** (rc_id 5) — validación **biométrica/liveness** (Jumio-like, `GET .../Validation/{id}` async, 18 códigos `mapAdoState`, `IdState` 1=ok / 17=cancelado). Valida identidad; **no aporta capacidad de pago ni gatea la oferta**. 0 filas.

**Las tres formas de Experian**: Acierta trae `models[]` (score) sin `productValueList`; Quanto trae `productValueList` (ingreso) sin `models`; Acierta+Quanto trae **ambos**.

**Cascada de ingreso** (fiel al legacy): **Ágil Data → Mareigua → Quanto/declarado (EAV 87) → 0**. PILA manda; el estimado de Quanto y el salario **declarado** comparten el slot EAV 87 (`getSalary` = agildata > mareigua > EAV 87). El **declarado** solo se pide si Ágil y Mareigua vinieron null. **Score único** de Experian; **endeudamiento DERIVADO** (cuota deuda ÷ ingreso, no es dato directo). Fail-closed: un dato null o una API caída hace fallar la regla que lo necesita.

**`field 160` es AUTO-DECLARADO** por el usuario en el formulario — **NO viene del buró**; al procesar Quanto/Ágil/Mareigua se escribe `'no'` hardcodeado (igual que `29='Empleado'`).

**Mucho dato de Experian se calcula y se tira**: el modelo ML (H2O) que consumía ~20 campos `EX_*` (disputas, ahorros, saldo total, vectores por sector/mes) está **DESACTIVADO** (`makePrediction` retorna 404); esos campos quedan `consumido: no`. ⚠ **CORREGIDO el 2026-08-06**: el modelo NO está simplemente «muerto devolviendo 404» — en producción **se llama de verdad y está TIMEOUTEANDO**. Medido en la uReq 521997 de prod: cuatro `cURL error 28: Operation timed out after 15002 milliseconds … for http://profiler.inertia-production:8000/predict_w_experian` en una sola solicitud. El `timeout(15)` es literal de `ProfilerMLController::makePrediction`. O sea que sí consume tiempo (15 s por intento) y sí consume los campos `EX_*`; lo que no hace es responder. Y cada timeout **dispara un correo** a dos personas (`Notification::route('mail', …)` en el `catch`).

**Ábaco / "Información complementaria"**: ya NO es buró ni entra en la cascada. Requerimiento **post-selección** que la entidad pide si activó Ábaco; suma un ingreso EXTRA gig (Rappi/DiDi/Uber) al base pero es **informativo** — no cambia cupo ni cuota. Proveedor externo (CreditOp solo integra la API); su `Action` vive **solo en legacy-backend**. Apunta a población PEP (Permiso Especial de Permanencia)/migrante sin buró tradicional.

**KYC V2 (Credifamilia, solo legacy-backend, greenfield)**: cadena de identidad reforzada — **Evidente** (preguntas de identidad + OTP), **CrossCore** (enrolamiento + decisión) y **Jumio** (biometría); tablas `crosscore_evaluations` / `jumio_accounts` / `evidente_flow_steps`. Es el KYC del flujo Credifamilia (ver su nodo), no del listado general.

## Dónde mirar
- **Disparo por aliado** (application): `app/Http/Controllers/Customer/DatacreditoQueryByAlliedController.php:21` (`userViability`) → `:26` (lee `alliedBranch.datacredito_trigger`) → `:221` (`DatacreditoFrequency::where(allied_id)`) → `:233-234` (`frequency===null` ⇒ `aciertaQuanto` si hay Prami / `creditScore`).
- **Trigger desde datos personales** (application): `app/Http/Controllers/Customer/PersonalInfoController.php:158` (`users.age` de `date_of_birth`) → `:434` (`userViability`) → `:766` (`Experian::aciertaQuanto`); `:866` (`experianMethod`: Pullman/DFS ⇒ `aciertaQuanto`, resto `quanto`).
- **Cliente HTTP del buró** (application): `app/Actions/RiskCentrals/Experian.php:51` (`authorize` OAuth2, POST `/spla/oauth2/v1/token` en `:59`) · `:227` (`ProductId 64`) · `:234` (POST `/cs/credit-history/v1/hdcplus`) · `:203-205` (mock `ExperianFixture` por escenario) · `:73`/`:93`/`:98`/`:136` (reuso de caché `created_at > now()->subMonths(1)`) · `:120-123` (merge Acierta+Quanto) · `:479` (`creditScore`) · `:511` (`quanto`) · `:543` (`aciertaQuanto`). Copia parallel-run: `[legacy] app/Actions/RiskCentrals/Experian.php:512` (`ProductId 64`; endpoints con prefijo `/experian/...` en `:480-482`).
- **Dónde se guarda + mapper** (application): `app/Models/RiskCentralUserData.php:20-23` (casts: `data`=`encrypted:collection` APP_KEY; `additional_info`/`request`=`collection` **PLANO**) · `Experian.php:240` (save) · `:267` (`score = avg(models[].scoreValue)`) · `:243-249` (`additional_info`: negativeAccounts, maturationSince) · `:320` (espejo `user_summaries`) · `:352` (EAV 87 ingreso) · `:374` (EAV 29 `'Empleado'` **HARDCODE**) · `:390` (EAV 160 `'no'` **HARDCODE**) · `:460-462` (EAV 90 egresos).
- **Relaciones `User`** (application): `app/Models/User.php:232` (`datacredito()` por NOMBRE + latest) · `:244` (`tusDatos`, rc 2) · `:250` (`agildata`, 3) · `:256` (`mareigua`, 6) · `:262` (`aml`, 4) · `:268` (`ado`, por nombre `'Ado'`).
- **KYC identidad / AML / liveness** (application): `app/Actions/RiskCentrals/Tusdatos.php:91` (AML `POST /api/launch`) → `app/Jobs/RiskCentrals/Tusdatos/CheckBackgroundJobStatus.php:61` (poll `GET /api/results/{jobid}`, `:72` dispatch `BackgroundJobResolved`) · `Agildata.php:26` (`certVerify` mTLS) `:112-113` (`withOptions(verify)`) `:159-163` (escribe en `additional_info`) · `Mareigua.php:128` (OAuth `/token`) `:82` (`POST /consultas`) · `Ado.php:23` (`GET .../Validation/{id}`) → `app/Jobs/RiskCentrals/Ado/StatusCheck.php:17` (poll; `:64` `IdState==1`, `:90-91` `IdState 17` cancelado, `:79` dispatch `StatusChanged`).
- **Trigger / frecuencia (models)** (application): `app/Models/DatacreditoFrequency.php` (`datacredito_frequencies`) · `app/Models/DatacreditoQueryByAllied.php` (`datacredito_query_by_allieds`).
- **KYC V2 Credifamilia** (solo legacy-backend, greenfield): `app/Services/Lenders/CredifamiliaV2/Evidente/EvidenteClient.php:28` (`validar`) · `CrossCore/CrossCoreClient.php:31` (`evaluate`) · `CrossCore/JumioOnboardingService.php:20` (`start` biometría).
- **Ábaco / "Información complementaria"** (solo legacy-backend): `app/Actions/RiskCentrals/Abaco.php` (ingreso gig; informativo, no gatea).
- **Mock local/dev** (application): `app/Actions/RiskCentrals/ExperianFixture.php` (212 KB) · `AgildataFixture.php` · `MareiguaFixture.php`.
- **Tablas**: `risk_central_user_data` (`data` cifrado, `additional_info`/`request` planos, `score`) · `risk_centrals` (catálogo) · `risk_central_credentials` (por lender) · `user_summaries` (`datacredito`/`quanto`/`agildata`/`mareigua`/`tusdatos`) · `user_field_values` (EAV 87/29/160/90/161) · `users` (`age`/`gender`/`date_of_birth`) · `datacredito_frequencies` + `datacredito_query_by_allieds`.

## Omitir Experian: el cupo ya confirmado y la frecuencia por comercio

**Mergeado 2026-07-21** (front `784585fe` + back `a603a5cd`). Ya no es una tarea: es cómo funciona hoy.

Hay **dos mecanismos independientes** que evitan pagar la consulta:

**1. Flujo "cupo ya confirmado" (`flow_id = 2`).** Si el comercio está habilitado (setting
`allowed_to_omit_experian_allieds`), el wizard pregunta si el cliente ya tiene cupo en otras entidades;
al responder que sí se firma el flujo y la solicitud queda con `flow_id = 2`
(`Flow::ALREADY_CONFIRMED_PRE_APPROVAL`). El **corte real** está en `app/Actions/RiskCentrals/Experian.php`:
retorna `null` antes de consultar, en **los tres modos** (Acierta · Quanto · Acierta+Quanto). La
arquitectura nueva lo espeja en `CheckExperianTriggerService` Stage 3 → `RKV24029`. Como el supuesto es
que el cupo viene de una entidad **sin** integración directa, el listado se recorta a `response_type = 0`
(`Modules/Onboarding/App/Http/Controllers/LenderListingController.php`).

**2. Frecuencia por comercio.** Contador de consultas por allied con regla de `every`/módulo
(`GetExperianQueryCountByAlliedIdService` lee sin avanzar · `IncrementExperianQueryCountByAlliedIdService`
avanza). **El contador sube solo justo antes de consultar de verdad**, así que refleja consultas reales.
Sin regla → `RKV24023`; `count % every !== 0` → `RKV24024`. Ahorra **incluso fuera** del flujo de
pre-aprobado.

⚠ **Deuda viva (F-58)**: al firmar el flujo, el rechazo `URV13004` viaja en **HTTP 200** y el front lo
toma como éxito → la solicitud queda en `flow_id = 1` y **se consulta Experian** sin dejar rastro. Hoy no
se dispara (el front valida lo mismo antes, sobre la misma sucursal), pero el validador anuncia más
rechazos por venir. Detalle en `findings` F-58.

> Seguimiento de la tarea: **CORE-293** · el detalle de trabajo vive en el tablero (esfuerzo "Omitir
> consulta de buró cuando el cupo ya está confirmado"), no acá.

## El catálogo real de centrales: son 12, y varía por ambiente

`risk_centrals` tiene **12 filas**, no las 4 o 5 que uno nombra de memoria. La lista completa (ids de prod):

| id | nombre | id | nombre |
|---|---|---|---|
| 1 | Experian - Acierta | 7 | Deceval |
| 2 | TusDatos - Validación de Identidad | 8 | Experian - Quanto |
| 3 | Agildata | 9 | Experian - Acierta+Quanto |
| 4 | TusDatos - AML | 10 | crosscore - Experian |
| 5 | Ado | 11 | evidente - Experian |
| 6 | Mareigua | — | (`Abaco` existe en el dump local y **no** en prod) |

Tres cosas que no se deducen de la lista y cambian cómo se lee una consulta:

- **`Agildata` NUNCA trae score.** 0 de 202 filas medidas tienen `score`. Un `score` vacío ahí no es un fallo: es lo normal. (Consistente con que sólo Experian aporte score.)
- **`Acierta` (1) y `Acierta+Quanto` (9) son entradas SEPARADAS**, y se puede consultar una sin la otra. En la uReq 519245 de producción se consultaron `Acierta+Quanto` (**score 209**), `Agildata` y `TusDatos - Identidad`, y **`Acierta` no**. Mirar sólo `risk_central_id = 1` para decidir "si se consultó Experian" da un falso negativo.
  <br>⚠ *Corregido el 2026-08-05 contra Redash: la versión anterior de esta línea decía «score 698» y listaba `Mareigua` entre las consultadas. Las dos cosas eran falsas — el score es 209 y ese usuario no tiene ninguna fila de Mareigua. Se anota el error en vez de borrarlo porque el número salió de una lectura apresurada de la propia traza, y es el modo de fallar que este nodo tiene que desalentar.*
- **Los REINTENTOS quedan en la BD, soft-deleted.** La misma 519245 tiene **cinco** filas de `TusDatos - Identidad`: cuatro con `deleted_at` y una viva. Cada reintento de la cascada escribe fila nueva y borra la anterior. Consecuencia práctica: «¿cuántos intentos hubo?» **sí** se responde desde la BD (contando con `deleted_at IS NOT NULL`), no sólo desde los logs — matiza F-97. Y cualquier consulta que filtre `deleted_at IS NULL` —como debe— ve el último intento, no la historia.
- **El catálogo varía por ambiente.** Cualquier vista que liste centrales tiene que leerlo de la BD del target, no de una lista fija.

Y para la pregunta "¿por qué no hay fila de buró nueva?", el backend **ya declara su propio pipeline** de decisión con cinco mensajes de log —`STAGE 0 — User request data`, `STAGE 1 — Existing risk-central data review`, `STAGE 2 — Frequency review`, `STAGE 3 — Check flow omitions`, `STAGE 4 — Bypass rules review`—, más `Experian frequency…`, `The allied is in the Experian trigger bypass list` y `The allied is not allowed to omit the requested risk central`. Es el vocabulario del código: usar otro agrega una capa de traducción. Leerlos en orden dice **en qué compuerta se cortó**, que es exactamente lo que F-60 obliga a descartar antes de afirmar que se omitió el buró.

> Mostrar el catálogo COMPLETO con las no consultadas marcadas no es cosmético: una ausencia sin universo no se puede interpretar. "No se consultó Mareigua" sólo significa algo si sabés que Mareigua existía como opción.

## `risk_centrals` NO es «la lista de burós»: sus filas se escriben en DOS momentos distintos

Es la trampa más caras de este nodo, porque la línea de resumen de arriba nombra «Ado biometría» al lado de
Experian y Ágil Data, y eso invita a leer las 12 centrales como si todas se consultaran en la misma etapa.
**No es así**: `risk_centrals` es la tabla donde se guarda cualquier dato de un tercero de identidad o
riesgo, y hay dos momentos del flujo que escriben ahí.

| momento | centrales | cuándo |
|---|---|---|
| **Onboarding** (antes del listado) | Experian - Acierta (1) · TusDatos - Identidad (2) · Agildata (3) · Mareigua (6) · Experian - Quanto (8) · Acierta+Quanto (9) | disparado por el formulario personal/laboral |
| **Post-selección** (tramo de cierre) | TusDatos - AML (4) · Ado (5) · crosscore (10) · evidente (11) | después de `confirmation`, antes del plan de pagos |
| **Ninguno de los dos** | Deceval (7) | no es una consulta: es el **pagaré** (`DecevalPromissoryNoteService`) |

**MEDIDO en prod el 2026-08-05** (Redash, 21 días): hay **2.431 filas de `Ado`**. Cruzando cada una con la
transición a estado 3 del mismo cliente (ventana ±6 h): **1.903 se escriben DESPUÉS de seleccionar entidad y
186 antes** — 91 %, en promedio 24 min después. ⚠ El cruce es por `user_id` porque
`risk_central_user_data` **no guarda la solicitud**, así que las 186 «antes» son compatibles con clientes de
varias solicitudes: la ventana las limita, no las elimina.

Y el orden completo se ve en la uReq **509592** (Credifamilia): AML 12:09:47 → crosscore 12:11:20 → evidente
12:11:47 → Ado 12:35:10, **todas** entre `seleccion` (12:05:57) y el estado 11 (12:44:19).

### El proveedor lo elige el LENDER, y casi la mitad no deja fila

El tramo post-selección no tiene un proveedor fijo: `confirmation` lee
`lender_identity_validation_types.identity_validation_type_id` (fallback `lenders.validation_type`) y
`IdentityValidationStepResolver::resolve` lo traduce a `step_details.type`
(`CreditopXFlowService.php:117`). El enum tiene 7 valores
(`Modules/Identity/App/Enums/IdentityValidationType.php`) y **sólo tres escriben en
`risk_central_user_data`**:

| id | tipo | `step_details.type` | ¿deja fila? | lenders in-platform en prod |
|---|---|---|---|---|
| 1 | None | `no_validation_required` | — | 9 |
| 2 | AwsOcrRekognition | `aws_validation` | **NO** | **46** |
| 3 | Questions | — | **NO** | 0 |
| 4 | Ado | `ado_validation` | sí (rc 5) | **64** |
| 5 | CrossCore | `crosscore_validation` | sí (rc 10) | Credifamilia |
| 6 | Evidente | `evidente_validation` | sí (rc 11) | Credifamilia |

> **La consecuencia es la que importa: para 46 de los 119 lenders in-platform, la ausencia de filas de
> central en el tramo biométrico es lo NORMAL.** El OCR del documento y el reconocimiento facial corren
> completos por AWS Rekognition y no dejan una sola fila — su único rastro son los logs
> (`Modules/Identity`: `Iniciando validación de documento`, `Starting face comparison`, `Resultado OCR
> frente/dorso`, `Validación facial completada exitosamente`). Cualquier vista que muestre «las centrales no
> consultadas» tiene que decir primero **qué camino tenía configurado ese lender**, o la ausencia se lee como
> un paso que faltó.

Y el tipo `1 · None` es la razón por la que este tramo es **condicional y no obligatorio**: hay 9 lenders que
no validan identidad, y para ellos `confirmation` salta directo a `first-payment-date`
(`loan-confirmation.tsx:218-239`). No hace falta suponerlo: está en el enum.

## Gotchas / riesgos
- **EAV forzados**: al procesar Quanto se escribe `29='Empleado'` (`Experian.php:374`) y `160='no'` (`:390`) **hardcodeados** → un usuario sin central queda marcado Empleado/no-reportado artificialmente. Encima, **`field 160` es auto-declarado por el usuario, no del buró**.
- **Solo `data` cifra**: `additional_info`, `request` y todo `user_summaries` van **PLANOS**. Ágil Data escribe TODO en `additional_info` (sin cifrar), y los derivados de Experian (`negativeAccounts`, `maturationSince`) también. Un INSERT de JSON plano en `data` rompe el descifrado → gate **fail-closed**. Sin el **APP_KEY** correcto Laravel no descifra y el listado falla en silencio.
- **`users.age` es COLUMNA real** (no accessor de `date_of_birth`): se calcula al capturar la persona (`PersonalInfoController.php:158`); es el gate de edad (Pullman).
- **Caché 1 mes**: Experian/Mareigua/Ágil reusan `risk_central_user_data < 1 mes` sin reconsultar (`Experian.php:73`); una fila inyectada se reusa (borrar la fila para refrescar).
- **`verifyCoincidence` (match de nombres) SIEMPRE true** en local/development.
- **Local/dev MOCKEA el buró** (`ExperianFixture`, 212 KB) → score/`additional_info` sintéticos; no es el score real.
- **DÓNDE se calculan los `EX_*`**: en la BD, no en PHP. Son **23 funciones `FN_Experian_*`** (`CC_Debt_Balance`, `CC_Vector_Overdue`, `Liabilities_*`, `Savings_Is_Seized`…) que envuelve `SP_Experian_Extract_Data`, invocado desde `ProfilerMLController.php:290`. Ninguna se llama desde PHP directamente y ninguna está indexada en este árbol — ver el nodo **db-routines**.
- **ML sin responder** (no «muerto»): ~20 campos `EX_*` de Experian se calculan y **se tiran** — gran parte del reporte no decide nada hoy, pero el intento cuesta tiempo de respuesta y genera correos. La cadena exacta de perfiladores, el timeout y por qué NO «cae a matrices»: **→ `profiling` §orden del listado** (F-104).
- **Dos motores, mismo reporte, campos/comparadores distintos** (maduración `<=` viejo rt≠2 vs `<` nuevo rt=2) — el detalle vive en **Profiling**.
- **Mapper de récord = application**: legacy-backend tiene una copia parallel-run (`app/Actions/RiskCentrals/`) + el rewrite modular (`Modules/Risk*`). El microservicio `kyc-gateway` (Go, **fuera de los 3 repos indexados**) reimplementa los clientes de buró (experian/agildata/mareigua) pero **no es** el mapper que corre.
- **Dos "PEP"**: el del tipo de doc = Permiso Especial de Permanencia (migratorio); el de AML/TusDatos = Persona Expuesta Políticamente.

## Lo que NO está verificado
- ¿`hasFindings` del AML (TusDatos) bloquea el listado de TODOS los lenders o solo el flujo Credifamilia? No se localizó un consumidor central que rechace por `aml()`.
