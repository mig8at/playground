# Redirect · contexto
> **estado:** al día con main · Familia de prestamistas por REDIRECCIÓN (`response_type=0`, "UTM"): CreditOp escribe una `url_utm`, redirige al sitio del lender y pierde toda visibilidad — nadie decide el crédito dentro de la plataforma y no hay retorno.

## Qué es
Familia de prestamistas por **redirección** (`response_type` **0**, canónicamente **"UTM"** en la tabla `response_types`). Es el contraste máximo con CreditopX: **nadie decide el crédito dentro de la plataforma**. CreditOp muestra la card en el marketplace y, al seleccionarla, resuelve una `url_utm` (de config), manda al usuario al sitio del lender, y desde ahí la decisión, el monto y el desenlace ocurren **afuera, sin retorno**. No es inyectable ni rastreable localmente.

Es una de las 3 familias por `response_type` bajo **Entities** (rt=0 redirect / rt=1 aggregator / rt=2·3 CreditopX). El `response_type` **default es 1** (migración `create_lenders_table`, comentario inline `url UTM => 0 / lender integration => 1 / lender form => 2`), así que rt=0 es **opt-in por lender**: un admin lo fija explícitamente para un referido. En los seeders del repo **ningún lender nace rt=0** → es una familia **latente/de-config**, no un set fijo de entidades.

## Contenido
**Dónde vive la URL.** `url_utm` es columna de DOS tablas: `lenders_by_allieds.url_utm` (por **comercio**) y `lenders_by_allied_branches.url_utm` (por **sucursal**). La URL efectiva = `COALESCE(branch, allied)`: la sucursal es un override que hereda del comercio. Al guardar sucursales, el branch persiste `url_utm` **solo si difiere** del valor del comercio; si coincide guarda `NULL` y hereda (dedup, `AlliedAlliedBranchController.php:135`). Es la **única herencia viva real** de la config de listado — las reglas/datacrédito, en cambio, se COPIAN por sucursal (memoria `reglas-copia-por-sucursal`).

**Ruteo / entrega.** Tras seleccionar el lender, el backend resuelve el destino (`UserRequestService.php:411` / application `UserRequestController.php:787`):
```
$url = branch->url_utm;
if (branch->url_utm == null && rt !== 2 [&& rt !== 4 en legacy]) $url = allied->url_utm;
switch (rt) {
  case 0: case 1:  → data.url = url_utm;  openNewTab = !asesorLogueado || allied.user_self_management===false
  case 2: case 3 [case 4 en legacy]: → ruta INTERNA (continue-user-flow / self-service confirmation), pisa url_utm
}
```
El dato clave: **rt=0 comparte código con rt=1-sin-credencial** (`case 0: case 1:`) — ambos solo devuelven la `url_utm` y salen. rt=2/3 en cambio pisan la URL con una ruta interna y siguen estado-por-estado. rt=0 **con** credencial igual redirige (`case 0` del else = `data.url = url`): rt=0 nunca integra.

**Frontend.** El wizard trata rt=0 como `LENDER_RESPONSE_TYPE.STANDARD` (=0). Lo **excluye de las promesas de pre-aprobación** (`available-lenders.tsx:150`, "per eligible lender response_type !== 0") — no hay veredicto externo que traer. Al seleccionar, la estrategia de salida es **"external-redirect"** (`openNewTab=false`, típico asesor) o **"external-popup"** (`openNewTab=true`), y ejecuta `routeHelpers.redirectExternal(url)` (`route-helpers.ts:173` = `redirect(url)`).

**Sin retorno.** No hay Estado 11, ni webhook, ni polling, ni cron post-desembolso. "El cliente sale a una URL del prestamista y la responsabilidad de Creditop termina" (git `159906a:docs/codigo/MAPA-FLUJOS.md`, §Ciclo E2E). Contraste: rt=1 al menos radica por API y vuelve por webhook/`StatusCheck`; rt=2/3 cierran in-platform.

## Dónde mirar
- **Definición rt=0 = UTM** (legacy-backend): `database/seeders/ResponseTypesTableSeeder.php` (id=0 `'UTM'`, id=1 `'Integración'`, id=2 `'Creditop X'`; rt=3/4 NO se siembran) · `database/migrations/2023_04_20_202610_create_lenders_table.php:21` (`response_type default(1)`, comentario `url UTM => 0`).
- **url_utm — storage + herencia** (application): `app/Models/LendersByAllied.php:22`, `app/Models/LendersByAlliedBranch.php:17` (fillable) · `app/Http/Controllers/Admin/AlliedAlliedBranchController.php:77` (COALESCE branch→allied), `:129/:135` (dedup write: NULL si == allied) · `app/Http/Controllers/Admin/AlliedLenderController.php:143,225` (write por comercio). Gemelo legacy: `Modules/Partner/App/Http/Controllers/AlliedLenderController.php:60,115` · `Modules/Partner/App/Services/AlliedManagementService.php:134` (COALESCE) + `:243-251` · `app/Models/LendersByAllied.php:22`, `app/Models/LendersByAlliedBranch.php:17`.
- **Ruteo / entrega rt=0** (el switch case 0): application `app/Http/Controllers/Customer/UserRequestController.php:787-792` (resolución url) + `:818` (`case 0: case 1:` → url_utm + openNewTab) · legacy `Modules/Onboarding/App/Services/UserRequestService.php:411-416` + `:442` (mismo case 0/1; `:467` case 0 con credencial).
- **Listado — url_utm → card.url** (application): `app/Http/Controllers/Customer/ListLenderController.php:106` (gate `response_type==0` **comentado**, hoy aplica a todos) `:112` · `app/Services/lenders/LenderRetrievalService.php:517` · `app/Services/lenders/LenderValidationService.php:349`. Legacy: `Modules/Onboarding/App/Services/lenders/LenderRetrievalService.php:517` · `Modules/Onboarding/App/Services/lenders/LenderValidationService.php:357`.
- **Frontend** (frontend-monorepo): `modules/loan-request-wizard/lenders-marketplace/src/lib/domain/constants/lender.constants.ts:37` (`LENDER_RESPONSE_TYPE.STANDARD=0`) · `apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx:85-105` (estrategia external-redirect/popup) `:150,290` (excluye rt=0 de pre-aprobación) · `apps/loan-request-wizard/app/utils/route-helpers.ts:173` (`redirectExternal`).
- **Otros lectores de url_utm** (pantallas de resumen): application `app/Http/Controllers/Customer/SimulatorController.php:54`, `app/Http/Controllers/Customer/ConfirmationController.php:39` · legacy `Modules/System/App/Http/Controllers/Customer/ConfirmationController.php:38`.

## Gotchas / riesgos
- **rt=0 ≡ rt=1-sin-credencial en el código** (`case 0: case 1:`): un lender rt=1 **sin credencial configurada degrada a redirect puro** (devuelve url_utm y sale, sin consumir la API externa). Un mal-config puede volver "invisible" a un agregador.
- **NO confundir con el "redirect" como CANAL de entrega de rt=1**: Addi / Banco de Bogotá / Sistecrédito-online son **rt=1** ("redirect-aggregators") que hacen handoff por redirect **pero SÍ vuelven** por webhook `self-manager`/polling. Este nodo es la **familia rt=0** (url_utm, nadie decide, sin retorno). Ese canal de rt=1 es del hermano **Aggregator**.
- **Callejón sin salida**: sin visibilidad post-redirect no se puede medir conversión ni cartera; el crédito "desaparece" del sistema. Es el único `response_type` sin ningún mecanismo de cierre de estado.
- **Divergencia app↔legacy en el fallback COALESCE**: application excluye solo rt=2 del fallback branch→allied; legacy excluye rt=2 **y rt=4** (`UserRequestService.php:414`). Además legacy agrupa rt=4 con 2/3 en la entrega interna; application no maneja rt=4.
- **Gate rt=0 muerto en el listado**: `ListLenderController.php:106` tenía `&& response_type == 0` para el bloque "Lender UTM"; está **comentado** → hoy `$lender->url = url_utm` se asigna a TODOS (rt=2 la pisa después con su ruta interna).
- **Familia latente**: `response_type` default=1 y ningún lender del seeder es rt=0 → verificar en la BD real qué entidades (referidos) corren como UTM antes de asumir que el set está vacío.

## Bitácora
- **2026-07-17** — Fase de data: superficie de código curada + doc enriquecido desde git `159906a:docs/codigo/MAPA-FLUJOS.md` + `AGREGADORES-FLUJO-ANALISIS.md` y verificación en código real (seeder `response_types`, switch `case 0`, COALESCE `url_utm`, `STANDARD=0` en el front).
- **2026-07-17** — Contexto sembrado desde playground/flow (psel.redirect + LendersNode rt=0 + MAP.md §0/Apéndice A).

## Enlaces
- Padre: **Entities** (3 familias por `response_type`). Hermanos: **Aggregator** (rt=1, incluye los "redirect-aggregators" que SÍ vuelven), **CreditopX** (rt=2/3 in-platform).
- Memorias: `modelos-canales-flujos` (Agregadores rt=1 vs originación), `reglas-copia-por-sucursal` (por qué `url_utm`-branch es herencia real y las reglas no), `admin-anatomia-creditop` (config por comercio vs sucursal).
- Fuente profunda: git `159906a:docs/codigo/MAPA-FLUJOS.md` (§Ciclo E2E "UTM rt=0 — solo redirige"), git `159906a:docs/codigo/AGREGADORES-FLUJO-ANALISIS.md` (contraste rt=0 vs rt=1). Simulador: playground/flow (nodo "Formalización" paso Redirección rt=0).
