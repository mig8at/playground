# El admin de `application` — cómo se da de alta la operación (recorrido visual verificado)

> **Estado:** verificado contra código (mapeo multi-agente 5 áreas + verificación adversarial, 2026-07-08).
> **Qué responde:** cómo un administrador crea un comercio, sus sucursales, le asigna entidades y reglas —
> pantalla por pantalla, con el endpoint y el efecto en BD — y **el punto exacto donde nacen las copias de reglas**.
> Todo el CRUD de alta vive en el monolito **`application`** (Laravel + Inertia + Vue/Vuetify);
> `legacy-backend/Modules/Partner` tiene un **gemelo** del mecanismo de reglas que **no se invoca** desde este panel.

---

## 1. El recorrido visual (paso a paso)

### Paso 1 — Crear el comercio (`allieds`)
- **Pantalla:** `resources/js/pages/admin/allieds/Index.vue` → botón "Crear comercio" (solo perfil `user_profile_id===2`) → `AlliedCreate.vue` + `components/allieds/AlliedInfoCreate.vue`.
- **Campos:** nombre, tipo de comercio, valor a pagar antes de IVA, descripción, industria, país (default `47` quemado), imagen.
- **Backend:** `POST admin.allieds.store` → `app/Http/Controllers/Admin/AlliedController.php::store` (L101-136) → escribe **solo `allieds`** (slug/hash, imagen a S3; `allied_caterogy_id=1`, `new_screens=true`, colores `FFFFFF` quemados).
- El comercio nace **"pelado"**: sin sucursales, sin lenders, sin reglas.
- Detalle de navegación: `show`/`edit` del resource **no renderizan vista propia** — redirigen (`show`→requests, `edit`→branches). En `update` (L157-214) el whitelist es `collect($request)->only(...)`; el `$request->validated()` está **comentado** (L184).

### Paso 2 — Crear sucursal(es) (`allied_branches`)
- **Pantalla:** tab **"Puntos de venta"** → `AlliedEditTabAlliedBranches.vue` → modal `AlliedBranchCreateModal.vue`.
- **Campos:** nombre, dirección, ciudad, zona, contacto (nombre/documento/celular), orden. **No hay selección de lenders al crear.**
- **Backend:** `POST admin.allieds.branches.store` → `AlliedAlliedBranchController.php::store` (L174) → inserta **solo `allied_branches`** (+ QR a S3, `hash=crc32(now)`). **No copia reglas.**

### Paso 3 — Asignar entidades al COMERCIO (`lenders_by_allied`)
- **Pantalla:** tab **"Entidades"** → `AlliedEditTabLenders.vue` → modal `AlliedLenderCreateModal.vue`.
- **Campos:** lender, URL utm, orden, switches (auto-gestión, recaudo), calculadora (castigo, costos, seguros, comisión, IVA), cuota inicial, correos.
- **Backend:** `POST admin.allieds.lenders.create` → `AlliedLenderController.php::store` (L49) → `LendersByAllied::updateOrCreate` (**nivel comercio**). Si `response_type==2` (CreditopX): crea el pagaré en `lender_guarantee_criteria` y otorga permisos "view creditop x" a perfiles `[6,4]`.
- ⚠️ **Este paso NO copia reglas ni toca `lenders_by_allied_branches`** (error común: creer que la copia nace acá).

### Paso 4 — Habilitar entidades en la SUCURSAL → **acá nacen las copias de reglas**
- **Pantalla:** tab "Puntos de venta" → modal **`AlliedBranchEdit.vue`** → sección *"Entidades activas en el punto de venta"* (expansion panels con toggle Habilitar/Inhabilitar).
- **Backend:** `PUT admin.allieds.branches.update` (`AlliedBranchEdit.vue:153-164`, body `lenders_selected`) → `AlliedAlliedBranchController::update` (L102). Es **destructivo**: borra todos los `lenders_by_allied_branches` del branch y re-inserta los activos. Por **cada** lender activo (L127):

```
AlliedAlliedBranchController@update:102
  foreach lenders_selected (:127)
  ├─ addNewRule($lender,$branch):142        → LenderDatacreditoRulesController::addNewRule (L75)
  │     plantilla = fila con allied_branch_id=NULL (L96)
  │     sin plantilla propia → default BdB lender_id=5 (hardcode inline, L102)
  │     LenderDatacreditoRule::create con allied_branch_id de la sucursal (L107)
  └─ addNewLenderRule($lender,$branch):143  → LenderRulesController::addNewLenderRule (L330)
        plantilla = LenderRule con group_rule_id=NULL (L332)
        crea GroupRule 'AB'+branchId (L344) y CLONA cada fila (L350)
```

- **Matices verificados:**
  - **Idempotente**: si ya existe el `GroupRule`/fila datacrédito de esa sucursal, no re-copia.
  - **Guarda de país**: datacrédito **no** se copia si el comercio no es Colombia (`country_id!=47`, L79-82); las **reglas duras se copian siempre**.
  - **Segundo disparador**: crear una **credencial e-commerce** también copia (`AlliedEcommerceCredentialsController@store:96-99`, por cada `LenderAlliedCredential`).
  - **Huérfanas**: `AlliedLenderController::destroy` borra las asignaciones pero **no** borra las `group_rules`/`lender_rules` copiadas → reglas huérfanas (fuente extra de deriva).

### Paso 5 — Editar reglas por sucursal
- **Pantalla:** botón "Editar reglas" en `AlliedBranchEdit.vue` → `admin.allied-rules.index` → **`AlliedRules.vue`** (una card por lender: reglas duras + panel datacrédito; a nivel aliado, Frecuencia (`datacredito_frequencies`) y Disparador (`allied_branches.datacredito_trigger`), solo si `country_id===47`).
- **Backend:** `LenderRulesController@store` (L118) / `@update` (L214); `LenderDatacreditoRulesController@update` (L24); `DatacreditoFrecuenciesController`; `AlliedAlliedBranchController@updateTrigger` (L230).
- `store` crea 1 `group_rule` + 6 `lender_rules` con `field_id` **quemados** (29=ocupación, 160=reportado centrales, 87=ingresos; género/edad sobre `users`).
- **Asimetría de propagación:** `store` y `trigger` ofrecen **"aplicar a todas"** (fan-out que crea/actualiza en TODAS las sucursales); los `update` de reglas **no propagan** (solo la sucursal editada) → así se fabrica la deriva.

### Paso 6 — "Modulos" y "Productos"
- **Tab "Modulos"** (`AlliedEditTabModules.vue`): ⚠️ **el nombre engaña — NO configura los "modos" (`allied_modes`)**. Escribe `status_per_profiles` (matriz perfil-de-usuario × estado-de-solicitud = permisos de visibilidad). `AlliedModulesController@store` (L65) hace DELETE total del allied y re-inserta lo marcado.
- **Tab "Productos"** (`AlliedEditTabProducts.vue`): escribe `products` vía `AlliedProductsController@store` (L34). El form solo captura `name` + `initial_fee` (el modelo `Product` tiene fillable mucho más ancho: `max_term`, `lender_id`, `price`…). `destroy` = baja lógica (`status=0`).

---

## 2. Lo que este recorrido revela

1. **Las copias de reglas nacen en el Paso 4** (habilitar entidad en la sucursal) y en el disparador secundario de credenciales e-commerce — **no** al asignar la entidad al comercio (Paso 3). Escala y deriva medidas en [HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md](./HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md) (37.284 copias, 5% deriva, 42 entidades con default BdB/640).
2. **El "modo" de Motai NO tiene pantalla.** Ningún tab del admin escribe `allied_modes`: el modo renting (`MOTAI_RENTING_ALLIED_MODE_ID=2`) es un **id seedeado en BD + condicionales en el código** del onboarding (legacy-backend). Ni siquiera es configurable por un administrador — otro argumento para reemplazarlo por producto/categoría de catálogo ([UNIFICACION-Y-RESPONSABILIDADES.md](../vision/UNIFICACION-Y-RESPONSABILIDADES.md)).
3. **El mecanismo de copia existe en AMBOS repos**: `application` (el que usa este panel) y su gemelo en `legacy-backend/Modules/Partner` (`AlliedManagementService.php:257-258`; default en `LenderRuleRepository::findDefaultDatacreditoRule():148`). Dos copias del copiador: la deriva también aplica al código.
4. **Acoplamientos del propio admin:** bifurcaciones por `response_type==2` en store/update/destroy de lenders, `country_id==47` como gate de datacrédito, perfiles `[6,4]`/`[1,2,5]` quemados, país default `47`, colores/flags por defecto quemados en `store`.

---

*Origen: mapeo multi-agente del 2026-07-08 (5 lectores por área + verificación adversarial de la cadena de copia, veredicto CONFIRMED). Complementa a [LOGICA-QUEMADA.md](./LOGICA-QUEMADA.md) (inventario transversal) y alimenta el Apéndice — Fuente de [UNIFICACION-Y-RESPONSABILIDADES.md](../vision/UNIFICACION-Y-RESPONSABILIDADES.md).*
