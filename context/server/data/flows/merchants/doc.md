# Merchants · contexto
> **estado:** al día con main · Los comercios aliados: su alta/configuración (entidad→comercio→sucursal) Y sus flujos de originación concretos. La contraparte de Entities en el marketplace.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Los **comercios/merchants** aliados. Cubre dos caras: (1) el **alta y configuración** — cómo se crean lender/comercio/sucursal, la calculadora económica por comercio, y cómo al habilitar una entidad en una sucursal se copian sus reglas; y (2) los **flujos de originación concretos** por comercio/canal (los subcontextos). Es la contraparte de **Entities** (los prestamistas) en el marketplace: aquí manda el eje "quién ofrece y dónde", no "quién presta".

El hecho estructural (MAP.md §S1): **el alta NO cablea la relación lender↔sucursal.** Crear las 3 entidades solo las deja existiendo sin relación; la habilitación (y la copia de reglas) ocurre en el *update* de la sucursal (§S2).

## Contenido
**Alta (S1).** Cada entidad se crea con `Model::create` en una transacción, en el panel admin de `application` (Inertia); el gemelo legacy es el módulo `Partner` (reconstruido 1:1, no es el admin vivo). Al crear el lender nace siempre su `credit_line_by_lenders` (credit_line_id=1) y, solo si rt==2, su `creditop_x_lender_configuration`. Comercio: país ∈ [47=CO, 60=RD], con `allied_caterogy_id=1` y `new_screens=true` **quemados**. Sucursal: genera hash + QR (la llave de entrada al flujo).

**Config en dos niveles + copia de reglas (S2).** Un lender se configura en dos niveles con controllers distintos:
- **Nivel COMERCIO** → `lenders_by_allieds` = **toda "la calculadora"** (monto máx, cuota inicial, plazos, IVA forzado a 19 si rt==2, comisión, seguros, banco). Es el nodo *Configurar comercio* del simulador.
- **Nivel SUCURSAL** → `lenders_by_allied_branches` = override mínimo (`url_utm`/`sort`; hereda del comercio por COALESCE).
- **Copia de reglas**: al habilitar la entidad en la sucursal (y también al crear credencial ecommerce) se **CLONAN** `group_rules`+`lender_rules` (duras) y `lender_datacredito_rules` (buró) con el `allied_branch_id` de esa sucursal → esto explica las ~37k filas duplicadas.

**La calculadora (nodo Configurar comercio).** Clasificada por "¿participa en la solicitud y quién paga?": *monto máx* (hereda del rango de la entidad → decide el cupo); *cargo fijo, costos admin, fondo de garantías (·1.19 IVA), seguros* → los paga el CLIENTE, entran en la cuota; *comisión* → cobro al COMERCIO tras originar (no toca la cuota); muertos: *IVA* (19% quemado), *castigo*, *múltiplo del ingreso*; pisado: *cuota inicial del comercio* (la pisa `category.min_initial_fee` en rt=2).

**Contexto de entrada.** El **nombre del comercio** resuelve su calculadora y ramifica hardcodes por id (Pullman 94, Corbeta [24,209,210,211], DENTIX 189). El **hash de la sucursal** resuelve `allied_id`+`allied_branch_id`. **Estado en sucursal** (`lenders_by_allied_branches.status`) = 1ª compuerta dura de `getLenders`. **Canal** (asesor | ecommerce) es forward-looking (aún no es columna de config).

## Subcontextos
- **MotaiX** — flujo Motai (comercio 158, in-platform rt=2): 3 productos CreditopX (crédito/renting/RTO) + Ábaco (info. complementaria, ingreso gig informativo).
- **SmartPay** — canal in-platform (path IMEI): el celular como garantía, salta el AML de TusDatos, bloqueo por MDM.
- **Pullman** — flujo CrediPullman/Pullman (rt=2 in-platform "vanilla"): el caso base de la familia CreditopX (hardcode allied_id==94).

## Dónde mirar
Refs de MAP.md §S1 (alta) y §S2 (asociación + copia).
- **Alta lender/comercio/sucursal** (application): `LenderController.php:196` (store lender → `:219` `Lender::create`) · `AlliedController.php:101` (store comercio) · `AlliedAlliedBranchController.php:174` (store sucursal + hash/QR). Modelos: `Allied.php` (flags `have_ctopx`/`show_profiling`/`flow_type`/`self_managed`/`initial_fee`), `AlliedBranch.php` (`datacredito_trigger`, `hasCreditopX()`).
- **Calculadora + copia** (application): `AlliedLenderController.php:137` (calculadora por comercio) · `AlliedAlliedBranchController.php:102` update (el disparador; `:123` DELETE + `:130` recreate) · `LenderRulesController.php:330 addNewLenderRule` · `LenderDatacreditoRulesController.php:75 addNewRule` (`:102` fallback a lender 5 BdB) · `AlliedEcommerceCredentialsController.php:53` (2º disparador).
- **Gemelo legacy** (legacy): `Modules/Partner/App/Services/AlliedManagementService.php:763 storeAllied` / `:280 storeAlliedBranch` / `:237-257` (delete-recreate + copia de reglas).

## Gotchas / riesgos
- **`min_amount` es fantasma** en `lenders_by_allieds`: está en el fillable pero ningún controller lo escribe (solo `max_amount`).
- La sucursal se **reconstruye entera** en cada save (DELETE + recreate); guardar con lista incompleta **borra** asociaciones, pero **las reglas ya copiadas NO se borran** → quedan **huérfanas**.
- La copia es **snapshot único e idempotente**: si la plantilla cambia después, las filas por sucursal no se re-sincronizan.
- **Fallback silencioso a lender 5 (BdB)**: un lender sin plantilla de datacrédito hereda los umbrales de BdB sin marca visible.
- Errores de copia se **tragan** (email a `santiago@creditop.com`) → una sucursal puede quedar habilitada **sin reglas**.
- `product_type` es fantasma (se modela con `response_type`+`path_id`); HARDCODE Credifamilia id 24 → rt=1 en el accessor del modelo.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (nodos MerchantNode/ComercioNode/CanalNode/BranchStatusNode + fieldDocs `node.comercio`/`node.comercioConfig`/`node.canal`/`suc.status`) y MAP.md §S1-S2. Se conservan los subcontextos motaix/smartpay/pullman.

## Enlaces
- Padre: **CreditOp** (raíz). Contraparte: **Entities**. Subcontextos: **MotaiX**, **SmartPay**, **Pullman**.
- Simulador: playground/flow (nodos Comercio, Configurar comercio, Estado en sucursal, Canal). Mapa: playground/flow/MAP.md §S1-S2.
