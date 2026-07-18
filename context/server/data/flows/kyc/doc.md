# KYC · contexto
> **estado:** al día con main · El estudio del cliente por burós: Experian da el ÚNICO score; TusDatos identidad+AML; Ágil Data/Mareigua ingreso; Quanto ingreso estimado. Todo cifrado en `risk_central_user_data`.
<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
KYC es la etapa donde, disparada desde el formulario personal, se consulta a los burós para armar el **perfil consolidado** (el sujeto que evalúan las reglas del listado y del cupo). El único buró que da **SCORE** es **Experian/Datacrédito** (producto Acierta). El resto son KYC de identidad/ingreso, **no dan score**. Todo se persiste en `risk_central_user_data` (reporte crudo **cifrado con APP_KEY**), se espeja a `user_summaries` y a EAV (`user_field_values`: 87 ingreso, 29 ocupación, 160 flag, 90 egresos).

En local/dev el buró se **MOCKEA** con `ExperianFixture` → el score de dev es sintético. Sobre estos datos deciden **dos motores de datacrédito** con campos y comparadores distintos (el viejo rt≠2 y el nuevo rt=2, ver contexto Profiling/CreditopX).

## Contenido
Qué aporta cada proveedor (nodos del simulador):

- **Experian · Acierta** (`node.experian`, único con score): OAuth2 + `POST /cs/credit-history/v1/hdcplus` (ProductId 64). Trae **score** (`risk_central_user_data.score`, promedio de `models[].scoreValue`), **negativos 12m**, **mora vigente** (`currentArrears`), **consultas 6m**, **antigüedad/maduración** (`maturationSince`), **cuota deuda/mes**. `risk_central` propio ("Experian - Acierta"), separado de Quanto.
- **Experian · Quanto** (`node.quanto`): **ingreso ESTIMADO** (certeza 3), productCode 62. Mismo host/OAuth/endpoint que Acierta pero **producto y risk_central aparte** ("Experian - Quanto"), credenciales y summary propios; se pide solo, combinado ("Acierta+Quanto") o reusado del cacheado. Es la **4ª prioridad** de la cascada de ingreso.
- **Ágil Data** (`node.agil`): **1ª fuente de ingreso** + empleo. Aporta **ocupación** (EAV 29), **edad**, **género**, **continuidad laboral** (`<3m/3m/6m/12m`). La edad NO viene del buró: se calcula de `date_of_birth`.
- **Mareigua** (`node.mareigua`): **ingreso de respaldo** (2ª fuente, fallback de Ágil) + continuidad + tendencia (informativa).
- **TusDatos** (`node.tusdatos`): **identidad** (`requireVerifiedIdentity`) + **AML/listas** (`requireCleanAml`), ambas pueden ser reglas duras. **No da score**. Estado del documento (vigente/cancelado) es informativo.

**Cascada de ingreso BASE** (fiel al legacy): Ágil Data → Mareigua → Quanto → declarado → 0. El salario **declarado** (nodo Solicitud) solo se pide si Ágil y Mareigua vinieron null. **Score único** de Experian; **endeudamiento DERIVADO** (cuota deuda ÷ ingreso, no es dato directo). Fail-closed: un dato null o una API caída hace fallar la regla que lo necesita.

**Ábaco / "Información complementaria"** (`node.ingresosextras`): ya NO es buró ni entra en la cascada. Es un requerimiento **post-selección** que la entidad pide si activó Ábaco; suma un ingreso EXTRA gig (Rappi/DiDi/Uber) al base, pero es **informativo** — no cambia cupo ni cuota (fiel al legacy). Proveedor externo (CreditOp solo integra la API). Apunta a población PEP (Permiso Especial de Permanencia)/migrante sin buró tradicional.

## Dónde mirar
- **Gate de disparo por aliado** (application): `app/Http/Controllers/Customer/DatacreditoQueryByAlliedController.php:20` (`userViability`, lee `alliedBranch.datacredito_trigger`) → `:210` (frecuencia vía `datacredito_frequencies`) → `:234-266`.
- **Trigger desde datos personales** (application): `app/Http/Controllers/Customer/PersonalInfoController.php:158` (`users.age` de `date_of_birth`) → `:434` (`userViability`) → `:766` (`Experian::aciertaQuanto`).
- **Cliente HTTP del buró** (application): `app/Actions/RiskCentrals/Experian.php:51-63` (OAuth2) · `:224-234` (POST hdcplus) · `:201-221` (mock `ExperianFixture` en local/dev) · `:479` (`creditScore`) · `:511` (`quanto`) · `:543` (`aciertaQuanto`). Cliente legacy (parallel-run): `[legacy] app/Actions/RiskCentrals/Experian.php:519` (POST hdcplus, ProductId 64).
- **Dónde se guarda + mapper** (application): `app/Models/RiskCentralUserData.php:20-24` (`data` = `encrypted:collection`, APP_KEY) · `Experian.php:237-240` (save) · `:266-268` (score = avg `models.scoreValue`) · `:243-249` (`additional_info`: negativeAccounts, maturationSince) · `:314-323` (espejo `user_summaries`) · `:348-397` (EAV 87/29/160; ocup='Empleado' y flag='no' **hardcodeados**) · `:433-473` (EAV 90 egresos).
- **KYC identidad/ingreso** (application): `app/Actions/RiskCentrals/Tusdatos.php` (identidad + AML) · `Agildata.php` (empleo/ingreso gig) · `Mareigua.php` (analytics) · `Ado.php` (liveness).
- **KYC V2 Credifamilia** (solo legacy): `app/Services/Lenders/CredifamiliaV2/Evidente/EvidenteClient.php` · `CrossCore/CrossCoreClient.php` + `JumioOnboardingService.php`.
- **Tablas**: `risk_central_user_data` (`data` cifrado, `additional_info`, `score`) · `risk_centrals` (catálogo) · `risk_central_credentials` (por lender) · `user_summaries` (`datacredito`, `quanto`, `agildata`, `mareigua`, `tusdatos`) · `user_field_values` (EAV 87/29/160/90) · `users` (`age`/`gender`/`date_of_birth`) · `datacredito_frequencies` + `datacredito_query_by_allieds`.

## Gotchas / riesgos
- **EAV forzados**: al procesar Quanto se escribe `29='Empleado'` y `160='no'` **hardcodeados** → un usuario sin central queda marcado Empleado artificialmente.
- **`users.age` no viene del buró**: se calcula de `date_of_birth` (TusDatos/Ágil o carga manual); es el gate de CrediPullman.
- En **local/dev el buró se MOCKEA** (`ExperianFixture`, 212KB) → score/additional_info sintéticos.
- **El mapper vive en `Experian.php` de application**: `kyc-gateway` (Go) reimplementa clientes de buró pero está **sin consumidores** (greenfield muerto); si se cablea, la normalización quedaría sin dueño.
- **Dos motores, mismo reporte, campos distintos** para "cuentas negativas" y comparador de maduración OPUESTO (`<=` viejo vs `<` nuevo) — el detalle vive en el contexto de datacrédito/profiling.
- Cuidado con los dos "PEP": el del tipo de doc = Permiso Especial de Permanencia (migratorio); el de AML/TusDatos = Persona Expuesta Políticamente.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (nodos Experian/Quanto/Agil/Mareigua/TusDatos/Buro/IngresosExtras + fieldDocs `node.*`/`buro.*` + MAP.md §S4).

## Enlaces
- Padre: **Onboarding**. Simulador: playground/flow (nodos Experian · Acierta / Quanto / Ágil Data / Mareigua / TusDatos / Perfil consolidado / Información complementaria). Mapa: playground/flow/MAP.md §S4.
