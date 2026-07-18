# Actors · contexto
> **estado:** al día con main · Los actores del flujo: ASESOR y CLIENTE (originan la solicitud por dos canales de entrada) y ADMINISTRADOR (back-office que da de alta y configura la oferta). Quién ve qué y quién decide.
<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Este contexto separa a los **actores** que participan en una solicitud de crédito, tal como el simulador los modela en el nodo **Canal** y el nodo **Comercio**. La distinción importa porque *quién origina* la solicitud cambia por dónde entra (y con ello el origen del monto), mientras que *quién decide* el crédito no es ninguno de esos actores humanos sino el `response_type` de la entidad elegida.

El simulador modela hoy el **canal como una etiqueta de contexto** (asesor | ecommerce): aún no es una columna de config, el nodo modela el deber-ser para preparar la bifurcación wizard-de-asesor vs checkout-de-tienda.

## Contenido

**ASESOR** — canal `asesor`. Un asesor del comercio arma la solicitud desde el wizard `/merchant/*`. El campo "Nombre asesor" identifica quién origina (hoy `display`, sin columna de config; propuesto en `frontend-monorepo`/`legacy-backend`). El monto que captura viaja por `session('amount')`.

**CLIENTE / solicitante** — es el sujeto (`user`) de la `user_request`. En el canal `ecommerce` entra por autogestión desde el **checkout de la tienda online** (campo "Nombre de tienda"), con el monto en la **query base64**; en el wizard el monto llega en el body del `otp-validate`. Sus datos personales/laborales + el perfil de buró (KYC) son lo que después evalúan las reglas.

**ADMINISTRADOR** — el back-office (controllers `app/Http/Controllers/Admin/*`) que **da de alta** lender/comercio/sucursal (MAP §S1) y **configura la oferta** (MAP §S2: calculadora por comercio + copia de reglas por sucursal). No decide caso a caso: define el catálogo y las reglas que gobernarán la solicitud del cliente. Al crear la sucursal se **genera el `hash` + QR** (guardado en S3) que es la **llave de entrada** al flujo.

**Quién decide el crédito** (eje `response_type`, no un actor humano):
- **rt=0** redirect/`url_utm` — no decide nadie en CreditOp, redirige a la web del lender.
- **rt=1** agregador — decide la **API externa** del lender (Welli, Bancolombia, Meddipay…); el simulador lo modela con un switch **aprueba / rechaza / timeout** (rechaza/timeout saca al lender del listado). No inyectable local.
- **rt=2** CreditopX in-platform — decide **CreditOp** con el motor de categorías local (perfil de buró → 1ª categoría por prioridad que cumple → cupo). Inyectable.
- **rt=3** rotativo — CreditOp, cupo rotativo local.

**El monto tiene 3 orígenes según el canal** (MAP §S3): `session('amount')` (asesor), query base64 (ecommerce), body `amount` del `otp-validate` (wizard). En legacy el body tiene prioridad.

## Dónde mirar
- **Canal** (frontend-monorepo / legacy-backend): la bifurcación de canal la registra `allied_ecommerce_credentials` (MAP §S3, tablas). Hoy el canal no es columna de config (nodo forward-looking).
- **Asesor (captura de monto)** — application: `app/Http/Controllers/Customer/SimulatorController.php:190-211` (`startV2` guarda `session('amount')`, redirige, no crea UR). Wizard (frontend): `apps/loan-request-wizard/app/routes/dynamic/request-amount.tsx:200`.
- **Cliente / ecommerce (entrada + monto base64)** — application: `app/Http/Controllers/Customer/RegisterCellPhoneController.php:232-241` (ecommerce, amount en query base64) · `:77`/`:138-146` (entrada por hash de sucursal).
- **Administrador · alta** (MAP §S1) — application: `LenderController.php:196` (crea lender) · `AlliedController.php:101` (crea comercio) · `AlliedAlliedBranchController.php:174` (crea sucursal → **genera hash + QR** → `:203`).
- **Administrador · config/reglas** (MAP §S2) — application: `AlliedLenderController.php:137` (calculadora por comercio) · `AlliedAlliedBranchController.php:102` (override por sucursal, disparador de la copia) · `LenderRulesController.php:330` + `LenderDatacreditoRulesController.php:75` (copia de reglas).
- **Comercio (contexto de la oferta)** — application/legacy: `allieds.name` resuelve la calculadora (`lenders_by_allieds`); el `hash` de `allied_branches` resuelve `allied_id` + `allied_branch_id`.
- **Decide rt=1 (API externa)** — `PreApprovedLenderService` (MAP §S6); rt=2 = motor de categorías local (MAP §S5).

## Gotchas / riesgos
- El **canal aún no es una columna de config**: el nodo Canal modela el deber-ser (asesor | ecommerce); hoy es una etiqueta de contexto que más adelante ramificará el flujo (wizard vs checkout).
- El nombre del asesor y el de la tienda son `display` (identifican quién origina), no participan en la decisión.
- **Ningún actor humano decide el crédito**: lo hace el `response_type` de la entidad elegida (motor local rt=2/3 o API externa rt=1). El "administrador" solo configura el catálogo y las reglas.
- Hardcodes por id de comercio que deberían ser config: Pullman 94, Corbeta [24,209,210,211], DENTIX 189 (`merch.nombre`).
- La sucursal se reconstruye entera en cada save (DELETE + recreate); las reglas ya copiadas quedan huérfanas si se deselecciona el lender (MAP §S2).

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (nodos Canal + Comercio/Merchant + SettingsBar + fieldDocs `node.canal`/`canal.asesor`/`canal.tienda`/`node.comercio` + MAP.md §S1-S3, tabla `response_type`).

## Enlaces
- Padre: raíz **CreditOp**. Simulador: playground/flow (nodos Canal, Comercio). Mapa: playground/flow/MAP.md §S1-S3 + eje `response_type`.
