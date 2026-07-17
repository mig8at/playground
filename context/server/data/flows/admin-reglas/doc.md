# Alta y reglas por sucursal · referencia
> **estado:** al día con main · Nodo de referencia (no es un flujo): sintetiza el alta operativa en el panel admin de `application` y el mecanismo de copia de reglas por sucursal, con los datos duros (números, ids, líneas) para no tener que abrir los docs.

<!-- REFERENCIA = sustrato transversal (cuelga del group Plataforma). Autosuficiente: los datos duros están acá para no abrir docs/. -->

## Qué responde
- ¿Cómo se da de alta un comercio en CreditOp y qué se escribe en BD en cada paso?
- ¿Cómo se crea una sucursal (allied_branch) y por qué no copia reglas al crearse?
- ¿En qué paso exacto nacen las copias de reglas por sucursal? (habilitar la entidad en la sucursal, Paso 4)
- ¿De dónde salen las 37.284 copias de reglas duras y cuánta deriva tienen (5%)?
- ¿Qué es el default hardcodeado Banco de Bogotá lender_id=5 / score 640 y a cuántas entidades afecta (42 sin política propia)?
- ¿Cuál es el segundo disparador de la copia (credencial e-commerce)?
- ¿Por qué quedan reglas huérfanas al desasignar una entidad?
- ¿Qué es el gemelo Modules/Partner en legacy y por qué no importa (no se invoca)?
- ¿Qué field_id quemados usa una regla dura (29 ocupación / 160 centrales / 87 ingresos)?
- ¿Qué escribe realmente el tab 'Modulos' (status_per_profiles, no los modos)?
- ¿Por qué no hay una única fuente de verdad de las reglas de una entidad?

## Qué es
Nodo de referencia (no es un flujo): sintetiza el alta operativa en el panel admin de `application` y el mecanismo de copia de reglas por sucursal, con los datos duros (números, ids, líneas) para no tener que abrir los docs.

## Contenido
## Nodo de referencia: admin-reglas — "Alta y reglas por sucursal"

Responde: **¿cómo se da de alta un comercio/sucursal en el panel admin de `application`?** y **¿de dónde salen las 37.284 copias de reglas por sucursal?**

Todo el CRUD de alta vive en el monolito **`application`** (Laravel + Inertia + Vue/Vuetify). `legacy-backend/Modules/Partner` tiene un **gemelo del copiador que NO se invoca** desde ningún panel. Verificado contra código (multi-agente 2026-07-08, veredicto CONFIRMED) y re-verificado línea-a-línea en `legacy-application`/`legacy-backend` para este nodo.

---

### 1. El recorrido de alta (pantalla → endpoint → efecto BD)

| Paso | Pantalla (application/resources/js) | Endpoint | Controller (app/Http/Controllers/Admin) | Escribe en BD | ¿Copia reglas? |
|---|---|---|---|---|---|
| **1. Crear comercio** | `allieds/Index.vue` → `AlliedCreate.vue` + `components/allieds/AlliedInfoCreate.vue` (botón solo `user_profile_id===2`) | `POST admin.allieds.store` | `AlliedController@store` (L101-136) | **solo `allieds`** (slug/hash, img→S3; `allied_caterogy_id=1`, `new_screens=true`, `country_id=47` y colores `FFFFFF` quemados) | NO — nace "pelado" |
| **2. Crear sucursal** | tab "Puntos de venta" → `AlliedEditTabAlliedBranches.vue` → `AlliedBranchCreateModal.vue` | `POST admin.allieds.branches.store` | `AlliedAlliedBranchController@store` (L174) | **solo `allied_branches`** (+QR→S3, `hash=crc32(now)`). No hay selección de lenders al crear | NO |
| **3. Asignar entidad al COMERCIO** | tab "Entidades" → `AlliedEditTabLenders.vue` → `AlliedLenderCreateModal.vue` | `POST admin.allieds.lenders.create` | `AlliedLenderController@store` (L49) | `lenders_by_allied` (**nivel comercio** = toda la calculadora). Si `response_type==2`: pagaré en `lender_guarantee_criteria` + permisos "view creditop x" a perfiles `[6,4]` | **NO** (error común creer que la copia nace acá) |
| **4. Habilitar entidad en la SUCURSAL** | tab "Puntos de venta" → modal `AlliedBranchEdit.vue` (§"Entidades activas", toggle) | `PUT admin.allieds.branches.update` (body `lenders_selected`) | `AlliedAlliedBranchController@update` (L102) | **DESTRUCTIVO**: `delete` de todos los `lenders_by_allied_branches` del branch + re-insert. **← AQUÍ NACEN LAS COPIAS** | **SÍ** |
| **5. Editar reglas por sucursal** | botón "Editar reglas" → `allied-rules/AlliedRules.vue` (1 card/lender: duras + panel datacrédito + Frecuencia + Disparador) | `admin.allied-rules.*` | `LenderRulesController@store`(L118)/`@update`(L214); `LenderDatacreditoRulesController@update`(L24); `DatacreditoFrecuenciesController`; `AlliedAlliedBranchController@updateTrigger`(L230) | `group_rules`+`lender_rules`; `lender_datacredito_rules`; `datacredito_frequencies`; `allied_branches.datacredito_trigger` | crea más |
| **6a. "Modulos"** | `AlliedEditTabModules.vue` | — | `AlliedModulesController@store` (L65, DELETE total + re-insert) | ⚠️ **NO son los "modos"** — escribe `status_per_profiles` (perfil-usuario × estado-solicitud = permisos de visibilidad back-office) | — |
| **6b. "Productos"** | `AlliedEditTabProducts.vue` | — | `AlliedProductsController@store` (L34; `destroy`=baja lógica `status=0`) | `products` (form solo captura `name`+`initial_fee` aunque el fillable es más ancho) | — |

`allieds` resource: `show`→redirige a requests, `edit`→redirige a branches (no vistas propias). En `update` el `$request->validated()` está **comentado** (whitelist por `->only(...)`).

---

### 2. El MECANISMO exacto de la copia (Paso 4) — verificado línea a línea

`AlliedAlliedBranchController@update:102`:
```
LendersByAlliedBranch::where(allied_branch_id)->delete();   // destructivo
foreach ($lenders_selected as $lender) {                     // :127
   LendersByAlliedBranch::create([lender_id, allied_branch_id, url_utm (NULL si == el del comercio), sort]);
   $lenderDatacreditoRules->addNewRule($lender_id, $alliedBranch);   // :142
   $lenderRules->addNewLenderRule($lender_id, $alliedBranch);        // :143
}
```

**A) Reglas de datacrédito — `LenderDatacreditoRulesController@addNewRule` (L75+):**
1. ¿ya existe fila con este `lender_id` + `allied_branch_id`? → NO re-copia (idempotente).
2. si no, busca **plantilla** = fila con `allied_branch_id = NULL`.
3. **si no hay plantilla propia → DEFAULT hardcode inline `LenderDatacreditoRule::where('lender_id', 5)` = Banco de Bogotá** (score 640).
4. `LenderDatacreditoRule::create` con el `allied_branch_id` de la sucursal.
- **Guarda de país**: datacrédito NO se copia si `country_id != 47` (Colombia). Las **reglas duras se copian siempre**.

**B) Reglas duras — `LenderRulesController@addNewLenderRule` (L330+):**
1. plantilla = `LenderRule` con `group_rule_id = NULL` para ese `lender_id`.
2. si ya existe `GroupRule` de esa sucursal+lender → no re-copia (idempotente).
3. crea `GroupRule{ allied_branch_id, rule_name:'AB'+branchId }` (L344) y **CLONA cada fila** (L350).

**`LenderRulesController@store` (creación manual de política, L118)** crea 1 `group_rule` + 6 `lender_rules` con **`field_id` quemados**: `29`=ocupación (`=`), `160`=reportado en centrales (`=`), `87`=ingresos mensuales (`>=`); + género/edad sobre tabla `users`.

**Segundo disparador — credencial e-commerce:** `AlliedEcommerceCredentialsController@store` (L96-99) recorre cada `LenderAlliedCredential` del comercio y vuelve a llamar `addNewRule`/`addNewLenderRule` → **copia igual, por otra vía**.

**Huérfanas:** `AlliedLenderController@destroy` borra las asignaciones (`lenders_by_allied`/`..._branches`) pero **NO** borra las `group_rules`/`lender_rules`/`lender_datacredito_rules` ya copiadas → reglas huérfanas (fuente extra de deriva).

**Asimetría de propagación (fabrica la deriva):** `store` y `updateTrigger` ofrecen **"aplicar a todas las sucursales"** (fan-out que crea/actualiza en TODAS); los `@update` de reglas **NO propagan** (solo la sucursal editada).

---

### 3. Los números (BD local `creditop`, snapshot 2026-07-03)

**Reglas duras** (plantilla = `lender_rules.group_rule_id IS NULL`; copia = por `group_rule_id`→`group_rules.allied_branch_id`):
| Métrica | Valor |
|---|---|
| Plantillas (nivel entidad) | **679** filas / 136 entidades |
| Copias reales (por sucursal) | **37.284** filas / 135 entidades |
| Copias derivadas (≠ plantilla) | **1.861 = 5,0 %** |

Escala: Credifamilia-addi = 1 plantilla → **6.486 copias** en 1.081 sucursales; Bancolombia CPD = 5.982; Sistecrédito = 5.124; Banco de Bogotá = 4.807.

**Reglas datacrédito** (plantilla = `allied_branch_id IS NULL`):
| Métrica | Valor |
|---|---|
| Entidades activas | 149 |
| Con plantilla propia | **107** (⇒ **42 sin política de buró propia**) |
| Copias por sucursal | 7.076 |
| Copia fiel (= plantilla) | **6.125 = 87 %** ✅ |
| Sin plantilla → corriendo default **BdB score 640** | **32 entidades / ~772 filas** |
| Graves (entidad con política propia pero sucursal pisada con default) | **5 casos** |

Lectura: datacrédito mayormente sano (87 %); el problema estructural son las **reglas duras** (37 k copias, 5 % derivado) y las **42 entidades que aplican los cortes de Banco de Bogotá sin decidirlo**.

**Casos graves datacrédito (score propio vs. score que corre):**
| Entidad | Comercio/Sucursal | Score propio | Corre |
|---|---|---|---|
| Credifis X (Rotativo) | Tienda Fisio / Cali | 500 | **640** |
| Oral credit X | Oralcare / principal | 500 | **640** |
| Riex credit (y Rotativo) | Ríe odontológica / Villa del prado | 400 | **640** |
| CORESDENT | Dra. Andrea Forero / principal | 500 | **640** |

**Deriva de reglas duras (Credifamilia en "Colchones Ensueño", ~85-89 sucursales):** edad plantilla `20-74`→sucursal `35-73`; ocupación plantilla `Independiente`→sucursal `Empleado|Pensionado` (la plantilla parece la equivocada); género plantilla `M|F`→sucursal `F` (solo mujeres); ingreso campo 87 `>=1.850.000`→`>=0` en algunas. BdB en el mismo comercio: ingreso `>=1.300.000`→`>=0` en 26 sucursales (anula el piso).

---

### 4. El gemelo legacy `Modules/Partner` (NO invocado)

El mismo copiador existe **replicado** en `legacy-backend/Modules/Partner`: `AlliedManagementService.php:257-258` llama a `addNewRule`/`addNewLenderRule` idénticos; `Partner/App/Repositories/LenderRuleRepository::findDefaultDatacreditoRule()` (L146-148) también hace `where('lender_id', 5)`. Hay controllers gemelos `AlliedAlliedBranchController`/`LenderRulesController`/`LenderDatacreditoRulesController` en Partner. **Ningún panel los invoca** — el alta real corre 100 % en `application`. El default BdB también vive (para lectura) en `legacy-backend/Modules/Loans/App/Repositories/LenderRuleRepository.php`.

**Quién EVALÚA la copia por-sucursal** (por eso la deriva importa): en el onboarding, `LenderListingService` + `LenderValidationService` (duras) y `RiskCentralValidationService` (datacrédito legacy rt≠2) / `DatacreditoRuleEvaluator` (nuevo rt=2) leen la **copia por-sucursal, no la plantilla del lender**.

## Dónde mirar
- **AlliedAlliedBranchController@update (application)** (application): L102 — el corazón: borra los lenders_by_allied_branches del branch y por cada lender activo llama addNewRule/addNewLenderRule. AQUÍ nacen las copias (Paso 4).
- **LenderDatacreditoRulesController@addNewRule (application)** (application): L75-107 — copia datacrédito: plantilla allied_branch_id=NULL; si no hay, DEFAULT inline where('lender_id',5)=BdB score 640; guarda país country_id==47.
- **LenderRulesController@addNewLenderRule / @store (application)** (application): @addNewLenderRule L330 clona duras creando GroupRule 'AB'+branchId; @store L118 crea 6 reglas con field_id quemados 29/160/87 y ofrece 'aplicar a todas'.
- **AlliedEcommerceCredentialsController@store (application)** (application): L96-99 — segundo disparador de la copia: por cada LenderAlliedCredential del comercio re-copia reglas.
- **AlliedLenderController@destroy (application)** (application): borra la asignación pero NO las reglas copiadas → huérfanas; @store L49 escribe nivel comercio (lenders_by_allied) sin copiar.
- **AlliedBranchEdit.vue (application)** (application): la pantalla del Paso 4: toggle 'Entidades activas en el punto de venta' → PUT branches.update con body lenders_selected.
- **AlliedManagementService.php (Partner, legacy)** (legacy-backend): L257-258 — GEMELO del copiador que NO se invoca desde ningún panel; misma lógica que application. Partner/LenderRuleRepository::findDefaultDatacreditoRule L146-148 repite where('lender_id',5).
- **LenderListingService / RiskCentralValidationService / DatacreditoRuleEvaluator (legacy)** (legacy-backend): quién EVALÚA la copia por-sucursal en el onboarding (no la plantilla) — por eso la deriva de las 37k copias impacta la decisión de crédito.

## Frontera de simulación / harness
Sin relación directa con el harness E2E: el alta y la copia de reglas ocurren en el panel admin de application (no hay bypass ni testid). Relevante al OKR de pruebas solo indirectamente: la deriva de las 37k copias por-sucursal es la razón por la que un usuario sintético debe inyectarse contra la copia por-sucursal correcta (lenders_by_allied_branches + group_rules del branch), no contra la plantilla del lender; los evaluadores que leen esa copia (LenderListingService/RiskCentralValidationService/DatacreditoRuleEvaluator) son la frontera de inyectabilidad rt=2.

## Gotchas / riesgos
- La copia NO nace al asignar la entidad al COMERCIO (Paso 3 / lenders_by_allied) sino al HABILITAR la entidad en la SUCURSAL (Paso 4 / AlliedAlliedBranchController@update). Error común.
- El default Banco de Bogotá lender_id=5 (score 640) está HARDCODEADO inline en addNewRule, no es configurable. 42 entidades sin plantilla de buró propia corren ese corte sin haberlo decidido.
- El tab 'Modulos' NO configura los modos (allied_modes) — escribe status_per_profiles (permisos back-office). El modo Motai renting es un id seedeado (MOTAI_RENTING_ALLIED_MODE_ID=2), sin pantalla admin.
- Asimetría que fabrica deriva: @store y updateTrigger ofrecen 'aplicar a todas las sucursales' (crean MÁS copias), pero los @update de reglas solo tocan la sucursal editada y no propagan.
- Cambiar la plantilla de una entidad NO actualiza las copias ya creadas → no hay fuente de verdad; a veces la copia de sucursal es la correcta y la plantilla está desactualizada.
- Reglas huérfanas: desasignar una entidad (destroy) deja group_rules/lender_rules/lender_datacredito_rules colgando.
- Guarda de país: datacrédito solo se copia si country_id==47 (Colombia); las reglas duras se copian SIEMPRE.
- El gemelo legacy Modules/Partner replica TODO el copiador (incluido el default 5) pero está muerto — no lo llama ningún panel; la deriva también aplica al código (dos copias del copiador).
- branches.update es DESTRUCTIVO: borra todos los lenders_by_allied_branches del branch antes de re-insertar los activos.
- El alta corre 100% en application (legacy-application); los repos son github/legacy-application (alias application), github/legacy-backend, github/frontend-monorepo.

## Preguntas abiertas
- [ ] ¿Se corrige el default hardcodeado BdB lender_id=5 por algo explícito/configurable? Si a BdB le cambian el id o borran su plantilla, las entidades nuevas quedan sin molde.
- [ ] ¿Las reglas deben vivir en la ENTIDAD (fuente de verdad) con la sucursal guardando solo excepciones? Falta una capa legítima por-COMERCIO (hoy inexistente, por eso se replica por sucursal).
- [ ] Confirmar con negocio los casos ⚠️/❌: género solo-mujeres (Credifamilia), ingreso en >=0 (BdB 26 sucursales), y los 5 scores pisados en 640.
- [ ] ¿Vale la pena eliminar el gemelo muerto Modules/Partner para no mantener dos copiadores?
- [ ] ¿Deberían limpiarse las reglas huérfanas al desasignar (destroy)?

## Bitácora
- **2026-07-17** — Nodo de referencia creado bajo el group Plataforma. Superficie: 30 archivos, 30/30 resuelven. Síntesis de `ADMIN-ALTA-OPERACION + HALLAZGO-GESTION-REGLAS-POR-SUCURSAL` para hacer el árbol autosuficiente (resolver tareas sin abrir docs/).

## Enlaces
- /Users/miguelochoa/Desktop/CREDITOP/playground/docs/codigo/ADMIN-ALTA-OPERACION.md
- /Users/miguelochoa/Desktop/CREDITOP/playground/docs/codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md
