# KYC · contexto
> **estado:** al día con main · El estudio del cliente por burós: Experian/Datacrédito da el ÚNICO score; TusDatos identidad+AML; Ágil Data/Mareigua ingreso (PILA); Quanto ingreso estimado; Ado biometría. Reporte crudo cifrado en `risk_central_user_data`, espejado a `user_summaries` + EAV.

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
- **Ado** (rc_id 5) — validación **biométrica/liveness** (Jumio-like, `GET .../Validation/{id}` async, 18 códigos `mapAdoState`, `IdState` 1=ok / 17=cancelado). Valida identidad; **no aporta capacidad de pago ni gatea la oferta**. 0 filas.

**Las tres formas de Experian**: Acierta trae `models[]` (score) sin `productValueList`; Quanto trae `productValueList` (ingreso) sin `models`; Acierta+Quanto trae **ambos**.

**Cascada de ingreso** (fiel al legacy): **Ágil Data → Mareigua → Quanto/declarado (EAV 87) → 0**. PILA manda; el estimado de Quanto y el salario **declarado** comparten el slot EAV 87 (`getSalary` = agildata > mareigua > EAV 87). El **declarado** solo se pide si Ágil y Mareigua vinieron null. **Score único** de Experian; **endeudamiento DERIVADO** (cuota deuda ÷ ingreso, no es dato directo). Fail-closed: un dato null o una API caída hace fallar la regla que lo necesita.

**`field 160` es AUTO-DECLARADO** por el usuario en el formulario — **NO viene del buró**; al procesar Quanto/Ágil/Mareigua se escribe `'no'` hardcodeado (igual que `29='Empleado'`).

**Mucho dato de Experian se calcula y se tira**: el modelo ML (H2O) que consumía ~20 campos `EX_*` (disputas, ahorros, saldo total, vectores por sector/mes) está **DESACTIVADO** (`makePrediction` retorna 404); esos campos quedan `consumido: no`.

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

## Gotchas / riesgos
- **EAV forzados**: al procesar Quanto se escribe `29='Empleado'` (`Experian.php:374`) y `160='no'` (`:390`) **hardcodeados** → un usuario sin central queda marcado Empleado/no-reportado artificialmente. Encima, **`field 160` es auto-declarado por el usuario, no del buró**.
- **Solo `data` cifra**: `additional_info`, `request` y todo `user_summaries` van **PLANOS**. Ágil Data escribe TODO en `additional_info` (sin cifrar), y los derivados de Experian (`negativeAccounts`, `maturationSince`) también. Un INSERT de JSON plano en `data` rompe el descifrado → gate **fail-closed**. Sin el **APP_KEY** correcto Laravel no descifra y el listado falla en silencio.
- **`users.age` es COLUMNA real** (no accessor de `date_of_birth`): se calcula al capturar la persona (`PersonalInfoController.php:158`); es el gate de edad (Pullman).
- **Caché 1 mes**: Experian/Mareigua/Ágil reusan `risk_central_user_data < 1 mes` sin reconsultar (`Experian.php:73`); una fila inyectada se reusa (borrar la fila para refrescar).
- **`verifyCoincidence` (match de nombres) SIEMPRE true** en local/development.
- **Local/dev MOCKEA el buró** (`ExperianFixture`, 212 KB) → score/`additional_info` sintéticos; no es el score real.
- **ML muerto**: ~20 campos `EX_*` de Experian se calculan y se tiran (`makePrediction` 404) → gran parte del reporte no decide nada hoy.
- **Dos motores, mismo reporte, campos/comparadores distintos** (maduración `<=` viejo rt≠2 vs `<` nuevo rt=2) — el detalle vive en **Profiling**.
- **Mapper de récord = application**: legacy-backend tiene una copia parallel-run (`app/Actions/RiskCentrals/`) + el rewrite modular (`Modules/Risk*`). El microservicio `kyc-gateway` (Go, **fuera de los 3 repos indexados**) reimplementa los clientes de buró (experian/agildata/mareigua) pero **no es** el mapper que corre.
- **Dos "PEP"**: el del tipo de doc = Permiso Especial de Permanencia (migratorio); el de AML/TusDatos = Persona Expuesta Políticamente.

## Preguntas abiertas
- **AML**: ¿`hasFindings` (TusDatos) BLOQUEA el listado de TODOS los lenders o solo el flujo Credifamilia? No se localizó un consumidor central que rechace por `aml()`.
- **rc_ids por entorno**: los ids `risk_centrals` 2/3/4/6 están hardcoded en `User`, pero dependen del **orden de inserción** del entorno; por eso `datacredito` y `ado` se resuelven por **nombre** (ids catálogo Experian=1/Quanto=8/Combinado=9/Ado=5/Deceval=7 son del snapshot local, sin verificar en dev/prod).
- **Quanto "certeza"**: la etiqueta de certeza del seed del simulador no se pudo verificar en código; lo verificable es la banda `promedio/inferior/superior` (`productValueList` pos 0/1/2).

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (nodos Experian/Quanto/Agil/Mareigua/TusDatos/Buro/IngresosExtras + fieldDocs `node.*`/`buro.*` + MAP.md §S4).
- **2026-07-17** — Fase de data: superficie de código curada + doc enriquecido desde `git 159906a:docs/codigo/{ONBOARDING-DATOS-DECISION-ANALISIS.md, mapeo-datos-buros.json}`. Añadido: rc_ids + acceso por nombre/id (`User.php`), las 3 formas de Experian, cascada de ingreso corregida (Quanto es 3ª fuente vía EAV 87, no 4ª), conteos BD locales, ML H2O muerto, `field 160` auto-declarado, cifrado solo en `data`, KYC V2 Credifamilia (Evidente/CrossCore/Jumio). Line-anchors verificados contra application + legacy-backend.

## Enlaces
- Padre: **Onboarding** (cede el buró a este nodo). Hermanos: **Profiling** (los 2 motores de datacrédito + categoría), **CreditopX** (cupo rt=2), **Pullman** (score gate 400 / edad), **SmartPay** (salta AML), **MotaiX** (Ábaco/gig), **Formalization** (Credifamilia SOAP downstream).
- Simulador: `playground/flow` (nodos Experian · Acierta / Quanto / Ágil Data / Mareigua / TusDatos / Perfil consolidado / Información complementaria), mapa `playground/flow/MAP.md §S4`.
- Análisis fuente: `git 159906a:docs/codigo/ONBOARDING-DATOS-DECISION-ANALISIS.md` · `git 159906a:docs/codigo/mapeo-datos-buros.json`.
- Memorias: mapeo-datos-buros · onboarding-decision-data-map · datacredito-rules-per-lender · abaco-gig-scraping · credifamilia-flujo-mapa.
