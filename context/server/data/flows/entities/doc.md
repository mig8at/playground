# Entities · contexto
> **estado:** al día con main · Qué ES un prestamista **como dato**: la fila `lenders` (anémica, sin economía), las ~60 tablas satélite que la configuran y el `response_type` como clave de despacho de toda la plataforma.

## Qué es
Una **entidad** = una fila de la tabla `lenders`. Es el catálogo de prestamistas del marketplace y la contraparte de **Merchants**: la entidad presta, el comercio vende.

La fila es **anémica a propósito**: guarda identidad, branding, ruteo y flags de comportamiento — **no guarda economía**. Ni monto, ni tasa, ni cuotas, ni enganche viven ahí. Eso baja por una cascada de tablas satélite (`credit_line_by_lenders` → `lenders_by_allieds` → `lender_users_categories`…). En la unión de las migraciones de los dos repos back, **60 tablas distintas declaran una columna `lender_id`**; en **prod** son **67** (medido el 2026-09-19 contra `information_schema`). El "lender" real es esa constelación, no la fila. *(Acá decía 46, medido cuando se escribió el nodo.)* ⚠ **Y la diferencia entre las dos varas es el dato:** siete tablas de prod no salen de ninguna migración de estos dos repos — nacieron de otro servicio o de un `CREATE TABLE` a mano. Contar sólo migraciones subestima la constelación.

El campo que manda es **`response_type` (rt)**: un `integer` que decide **quién decide el crédito** y, con eso, cómo se entrega al usuario y si el resultado es **inyectable/simulable localmente**. Este nodo cubre el **concepto y la configuración**; el recorrido de cada familia vive en los Subcontextos.

## Antes de concluir
- **HARDCODE Credifamilia (id 24)** en `application/app/Models/Lender.php:69-72` (docblock `:65-68`; acá decía `:59`, que hoy es `'path_id'` dentro del `$fillable`): es un **accessor de Eloquent**, así que solo aplica a lecturas en memoria (`$lender->response_type`, ~55 sitios). Las **queries** (`Lender::where('response_type', 2)`, 12+ sitios en application) leen la **columna cruda** y lo ignoran → el mismo lender "es" rt=1 en memoria y rt=BD en el `WHERE`.
- **`response_type` default = 1**: un lender mal configurado nace como integración externa. Y `StoreRequest` no restringe el valor: cualquier entero pasa.
- **rt=3 y rt=4 no están en `response_types`** → el dropdown del panel no los ofrece; se setean por SQL. Nadie valida `response_type` contra el catálogo.
- **Comentario mentiroso en el código**: `Modules/Loans/App/Services/LoanAuthorizationService.php:374` documenta la formalización externa como "(response_type 5)" cuando la constante que usa es **4** (`Modules/Loans/App/Services/LoanAuthorizationService.php:46`). No existe rt=5 en ningún otro lado.
- **`path_id = 3` no existe en ninguna migración ni seeder** de los dos backs (solo se siembran 1 y 2), pero el front lo consume como `MANAGED_LENDER_PATH_ID` para desviar a gestión manual (`lender-response.mapper.ts:126`; la constante, en `lender.constants.ts:143`). La fila se insertó fuera de migración.
- **Columna muerta**: `requires_restrictive_list_check` (migración + `->after()` de la siguiente migración) **no tiene un solo consumidor** en application, legacy-backend ni frontend-monorepo. Tampoco está en el `$fillable`.
- **Bug del panel — el email nunca se guarda**: los dos formularios Vue bindean `form.emails` (plural) y precargan `this.lender.emails`, pero la columna, el `$fillable` y el controlador usan **`email`** (singular). El campo renderiza vacío al editar y el POST no llega a la columna. ⚠ **Sigue vivo: verificado contra `main` el 2026-09-18** (`application/resources/js/pages/admin/lenders/lender-create/LenderCreate.vue:80` y `.../lender-edit/LenderEdit.vue:95`).
- ⚠ **Y el mismo patrón mordió una segunda vez, en el otro monolito — ése sí se arregló.** `originator_nit` no estaba en el `$fillable` de `legacy-backend/app/Models/Lender.php`, así que el backoffice lo mandaba, `fill()` lo descartaba **en silencio** y la pantalla «guardaba» sin persistir. Entró al `$fillable` el 2026-09-18 (`legacy-backend/app/Models/Lender.php:67`). La lección es del par, no de cada uno: **un campo que el formulario manda y el `$fillable` no declara se pierde sin error**, y en este modelo ya pasó dos veces. Al agregar una columna al panel, el `$fillable` es lo primero que hay que mirar.
- **Serialización que pisa el escalar**: `edit()` hace `$lender->load([... 'responseType' ...])`; Eloquent serializa esa relación en snake_case como `response_type`, **sombreando el entero**. Por eso el Vue lee `this.lender.response_type.id`. Cualquier consumidor que espere un `int` en ese payload se rompe.
- **Hardcodes por NOMBRE (string)**: `UserRequestController.php:969` hace `switch ($lender->name)` con `'Compensar' / 'Sistecrédito' / 'Meddipay'`; legacy al menos lo centralizó en `LenderTabBehaviorResolver::NON_NEW_TAB_LENDER_NAMES` — pero sigue comparando por nombre, no por id ni por flag. Renombrar un lender en el panel cambia su comportamiento de entrega. *(La lista sigue ahí: `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderTabBehaviorResolver.php:28`, leído el 2026-09-18.)*
- ⚠ **Ese resolver dejó de ser sólo «¿abre pestaña nueva?»**: desde el 2026-09-18 resuelve **dos** decisiones con el MISMO trío de datos —asesor autenticado, comercio autogestionado, entidad que manda el enlace—, y la segunda es si el proceso sigue en ese navegador o hay que entregárselo a alguien (`:105`). **La precedencia sorprende y es deliberada: un asesor con sesión abierta MANDA sobre la marca de autogestión del comercio** — con credenciales es punto de venta, y el traspaso es lo que corresponde. No deja al comercio autogestionado sin su recorrido porque el cliente que va solo no entra por esa puerta. Las dos viven juntas justamente para que no se contesten distinto en dos lugares.
- **Comparación rota en el gemelo legacy — y está en CINCO lugares, no en uno.** `Lender::where('status', 'Activo')` sobre una columna que en prod es **`tinyint(1)`** (medido el 2026-09-19): nunca matchea, y el síntoma es una lista vacía sin error. Viven en **tres repositorios distintos**: `Modules/Partner/…/LenderRepository.php:89` (`getActive`), `Modules/Loans/…/LenderRepository.php:32` (`getActive`) y `:49` (`getByAlliedBranch`), `Modules/Identity/…/LenderRepository.php:24` (`getByAlliedBranch`) y `:32` (`getActiveByIds`). ⚠ **Y hay CUATRO `LenderRepository.php` en legacy-backend** (Identity · Loans · Onboarding · Partner): buscarlo por nombre de archivo trae el que no es.
- ⚠ **Corrección: `getPaginated()` NO es código muerto.** Acá decía que ni él ni `getActive()` los llamaba nadie. `getActive()` sí está muerto —verificado el 2026-09-19, cero llamadores en los dos backs—, pero `getPaginated()` **es el listado de la API Partner**: lo llama `Modules/Partner/App/Services/LenderManagementService.php:246`. Lo que está muerto es **su filtro**: el servicio arma `$filters` con **`search` y nada más** (`:240-242`), así que la rama de `$filters['type']` —columna que en efecto no existe en `lenders`— no se alcanza nunca. La distinción importa: un método muerto se borra, un filtro inalcanzable dentro de un método vivo espera a que alguien le mande el parámetro.
- **Alta asimétrica rt=3**: `store()` crea `creditop_x_lender_configuration` solo si rt==2; `update()` (application) lo hace para 2 **y** 3. Un lender rotativo recién creado queda sin config hasta que alguien lo edite.
- **Migraciones no autocontenidas**: el árbol de legacy-backend depende de columnas creadas por migraciones de application (y viceversa). Levantar una base desde cero con un solo repo falla.
- **El `action` es `eval` disfrazado**: un FQCN guardado en BD e instanciado con `new $lenderClass()`. Si el string apunta a una clase inexistente, el flujo devuelve `'Lender action class not found'` en vez de fallar ruidosamente.
- ⚠ **Ya NO es cierto que «la única UI sea el panel Inertia», y las dos mitades de esa frase estaban mal.** Acá decía que `apps/admin` del frontend-monorepo estaba vacío (solo `.gitignore`) y que `Modules/Partner` no tenía consumidor. Verificado contra `main` el 2026-09-19:
  - **`apps/admin` no existe: se RENOMBRÓ a `apps/backoffice`** el 2026-07-16 (`d2c7dc39`, «Admin/integration fase 3», PR `Creditop-SAS/frontend-monorepo#713`) — el commit mueve el `.gitignore` y todo lo demás. Son **150 archivos** y tiene **cuatro rutas de entidades**: `lenders.tsx`, `lenders.config.tsx`, `lenders.rules.tsx`, `lenders.setup.tsx`.
  - **Ese backoffice escribe `lenders`.** Pega same-origin contra `/api/backoffice/lenders` (`app/providers/lender-config/lender-config.repository.ts:14`), servido por `legacy-backend/Modules/Backoffice/routes/backoffice.php` — `PUT /identity` · `/cutoff` · `/identity-validation` · `/credentials`, más `GET /{lender}/readiness`. De la fila toca **dos columnas**: `originator_nit` (`Modules/Backoffice/App/Services/LenderConfigService.php:283-284`) y `cutoff_type_id` (`:361-362`); los proveedores de identidad van a la satélite `lender_identity_validation_types` y la columna heredada `lenders.validation_type` sólo se **lee**, como `warning`.
  - **`Modules/Partner` sí tiene consumidor**: **9 archivos** del wizard llaman `/api/partners/…` — el form dinámico (`apps/loan-request-wizard/app/context/DynamicFormContext.tsx:34`) y el branding por comercio (`app/modules/partner-branding/infrastructure/partner-branding.repository.ts:95`).
  ⚠ **La lección del error es de MÉTODO, no de dato:** el nodo concluyó «no existe UI» de que una carpeta estuviera vacía, y la carpeta estaba vacía porque **se había mudado dos meses antes**. Una ausencia en el árbol de archivos no es una ausencia en el sistema; hay que preguntarle al `git log` de la ruta antes de concluir.

**(2026-09-19) Nodo RE-VERIFICADO entero.** 24 afirmaciones auditadas —22 contra `origin/main` y 2
medidas en prod—, cero chequeos débiles y **una falsa**. Exactos: el seeder de `response_types` con
**tres** filas (0 UTM · 1 Integración · 2 Creditop X), la migración de `paths` que siembra sólo 1 y 2,
el comentario mentiroso «(response_type 5)» contra la constante 4, la columna muerta
`requires_restrictive_list_check` (cero consumidores en los tres repos), el bug del email
(`form.emails` contra la columna `email`), `originator_nit` recién entrado al `$fillable`, y las doce
anclas de despacho en los dos monolitos. La falsa era **`getPaginated()` como código muerto**: es el
listado vivo de la API Partner; lo muerto es su filtro `type`. Y el error más caro fue de método —el
nodo concluyó «no hay UI» de una **carpeta vacía** que en realidad se había **renombrado** dos meses
antes, con lo que se perdió de vista un segundo panel de entidades que ya escribe la fila. Corregidos
además cinco conteos que crecieron (46→**60** tablas satélite, 21→**31** clases `action` contando
subpaquetes, 5→**6** archivos Vue) y **tres citas corridas**, dos de ellas contra el propio nodo, que
ya se citaba a sí mismo con dos números distintos para el mismo lugar.

## Contenido

### 1 · La tabla `lenders`: qué guarda y qué no
La migración original (`create_lenders_table`, **byte-idéntica en los dos repos back**) declara **12 columnas de negocio**: `name, image, description, benefits, response_type, url, email, slug, sort, country_id, additional_data, status` (+`id`+timestamps). `response_type` nace con **`default(1)`** y el comentario inline `// url UTM => 0 / lender integration => 1 / lender form => 2`.

Sobre esa base se atornillaron **24 columnas más** por migraciones posteriores, y acá aparece el hallazgo estructural del nodo: **el set de migraciones está PARTIDO entre los dos repos, que apuntan a la MISMA base**.

| | columnas que solo migra ese repo |
|---|---|
| **application** (6) | `available_until` · `fallback_removal_min_amount` · `fallback_removal_specific_lender_ids` · `is_fallback_lender` · `promissory_type_id` · `requires_payment_schedule_signature` |
| **legacy-backend** (8) | `externally_serviced` · `intro_background_url` · `path_id` · `pdf_mapper_project_slug` · `requires_restrictive_list_check` · `show_disbursement_details` · `show_intro_screen` · `signing_provider_id` |
| **duplicadas en ambos** (10) | `action` · `allow_payment_date_selection` · `amount_to_lend` · `complementary_form` · `cutoff_type_id` · `ecommerce` · `max_rev_credit` · `originator_nit` · `validation_type` · `voucher_image_url` |

El otro repo se limita a agregar la columna a `$fillable`/`$casts` del modelo. Consecuencia concreta y verificable: `legacy-backend/…/2026_02_12_150844_add_requires_restrictive_list_check_to_lenders_table.php:15` hace `->after('is_fallback_lender')`, y **ninguna migración de legacy-backend crea `is_fallback_lender`** (la crea `application/…/2025_11_20_160156_…`). El árbol de migraciones de legacy-backend **no es autocontenido** sobre `lenders`.

**Dónde vive la economía** (nada de esto está en `lenders`):
- `credit_line_by_lenders` — piso/techo global del lender: `min_amount, max_amount, min_fee_number, max_fee_number, fee_numbers, fee_interval, rate, rate_suffix, fee_name`. Se crea **siempre** con `credit_line_id = 1` en el alta.
- `lenders_by_allieds` — **la calculadora por COMERCIO**: 28 campos `fillable` (seguros, FGA, IVA, costos administrativos fijo y %, `initial_fee_percentage`, `min/max_amount`, `comission_percentage`, `bank_id`, `user_self_management`, `hide_probability`, `enable_collection`, `url_utm`…).
- `lenders_by_allied_branches` — **por SUCURSAL solo 5 campos**: `lender_id, allied_branch_id, url_utm, sort, status`. El contraste 28 vs 5 es la anatomía real del panel (memoria `admin-anatomia-creditop`).
- `creditop_x_lender_configuration` — 2 campos, solo rt=2/3: `late_payment_interest_rate`, `installments_waived_interest`.
- `lender_users_categories` — perfilamiento/tramos (lo cubre **Profiling**; ojo: `rate` y `life_percentage` están en el `$fillable` de legacy-backend y **no** en el de application).

`additional_data` es un `longText` con JSON de **textos de marketing** (`amount_text, number_fee_text, rate_text, conditional_text`) que el alta serializa a mano — no es config.

### 2 · `response_type`: la clave de despacho

| rt | fila en `response_types` | Quién decide el crédito | Entrega al seleccionar | ¿Inyectable local? |
|---|---|---|---|---|
| **0** | `UTM` — **sembrada** | nadie (redirige) | `url_utm` (+ pestaña externa) | n/a |
| **1** | `Integración` — **sembrada** | **API externa** del lender | `$lender->action` → `register()`/`consult()`, o `url_utm` | ❌ |
| **2** | `Creditop X` — **sembrada** | **CreditOp**, motor local | ruta interna (`continue-user-flow` / `self-service/{hash}/{ur}/confirmation`) | ✅ |
| **3** | **NO sembrada** | CreditOp (cupo rotativo) | igual que 2 | ✅ |
| **4** | **NO sembrada** | externo, gestión Credifamilia | `self-service/…/confirmation` + `standBy=true` — **solo en legacy-backend** | ❌ |

La tabla catálogo `response_types` es mínima (`id, name, status`) y su seeder inserta **exactamente 3 filas** (0/1/2, con `NO_AUTO_VALUE_ON_ZERO` para poder forzar el id 0). El seeder es byte-idéntico en los dos repos.

**rt=3 y rt=4 existen en el código pero no en el catálogo.** El panel de alta llena su dropdown con `ResponseType::select(...)->where('status', 1)->get()` → un admin **no puede elegir 3 ni 4 desde la UI**: esas filas se setean por SQL directo.

**rt=4 no tiene constante compartida**: está redefinido como `private const` con nombre distinto en **4 archivos** (`EXTRA_DETAILS_RESPONSE_TYPE`, `EXTERNAL_MANAGED_RESPONSE_TYPE`, `EXTERNALLY_MANAGED_RESPONSE_TYPE` ×2), más decenas de literales `== 2` / `== 3` sueltos. No hay enum PHP de `response_type` en ningún repo.

**El despacho ocurre en dos lugares gemelos y divergentes** (`switch ($lender->response_type)`), después de un gate por credencial (`if (empty($credential))`):
- **legacy-backend** `UserRequestService.php:481` — `case 0/1` · `case 2/3/4` · rama con credencial `case 0` / `case 1` / `case 4`.
- **application** `UserRequestController.php:818` — `case 0/1` · `case 2/3`. **No hay `case 4`.**

Esa ausencia explica el hardcode más famoso del modelo: `application/app/Models/Lender.php:69-72` define `getResponseTypeAttribute()` que **devuelve 1 si `id == 24`** (Credifamilia), sin importar la BD. Es el parche que evita que Credifamilia caiga en un `switch` sin rama. El accessor **no existe** en legacy-backend, que sí tiene su `case 4`.

**El front define su propia taxonomía**: `LENDER_RESPONSE_TYPE = { STANDARD: 0, PRE_APPROVED: 1, CREDITOP_X: 2, CREDITOP_X_REVOLVING: 3 }` y el tipo `LenderResponseType = 0 | 1 | 2 | 3`. Para el rt=4 hay un parche defensivo: `PRE_APPROVAL_FLOW_RESPONSE_TYPES = new Set([2, 3, 4])` tipado como `number` justamente porque 4 no entra en la unión.

**Única fuente compartida de ruteo por rt**: `LenderTabBehaviorResolver` — `EXTERNAL_REDIRECT_RESPONSE_TYPES = [0, 1]`; solo esos dos abren pestaña externa. El resolver lo consumen a la vez el listado y la selección para que no se desincronicen.

### 3 · Los otros ejes (que NO son `response_type`)
No existe columna `product_type`. El "tipo de producto" y el comportamiento se modelan con flags sueltos:

- **`path_id`** → tabla `paths` (`name` único). La migración siembra **solo 2 filas**: `1 = default`, `2 = IMEI` ("validación IMEI y bloqueo de dispositivo", el canal SmartPay). Default `1`. El backend lo publica como metadata (`lender_path`) junto a `credit_type` (`3 → revolving`, `2 → consumer`, resto → `other`).
- **`action`** — string con el **FQCN** de la clase de integración, instanciada dinámicamente: `$lenderClass = $lender->action; … new $lenderClass();`. Hay **21 clases en la raíz** de `legacy-backend/app/Actions/Lenders/` y **20** en application; contando recursivo, legacy llega a **31** porque suma **dos** subpaquetes: `CredifamiliaConsumo/` (4 archivos) y **`Bcp/` (6)**, el canal vehicular de Perú. *(Acá sólo se nombraba `CredifamiliaConsumo/`.)* ⚠ **Sólo las de la raíz son candidatas a `action`**: las de los subpaquetes son colaboradoras (payloads, cliente SOAP), y `Bcp/Bcp.php` es la que entra por la columna. El reemplazo moderno es `LenderServiceFactory::make()`, que recorre servicios tipados por `supports($lenderId)` y cae a `LegacyLenderService` (que `supports()` **todo**, siempre `true`).
- **`is_fallback_lender` + `fallback_removal_min_amount` + `fallback_removal_specific_lender_ids`** — eje nuevo (v2, aditivo): el lender se consulta recién después de los primarios y su card se oculta si un primario ya cubre el monto.
- **`externally_serviced`** — el crédito existe pero **CreditOp no gestiona su ciclo de vida**: corta pagos, cambios y crons de servicing.
- **`validation_type`** — escalar legacy de KYC, en **dual-read** contra la tabla nueva `lender_identity_validation_types`: si ambos resuelven y difieren se loguea `identity.validation_type.drift_detected`; si solo hay el escalar, `identity.validation_type.legacy_fallback_used`.
- **`country_id`** — default 1 (Colombia); **60 = República Dominicana**, que fuerza modal/QR y nunca abre pestaña.
- **`status`** — booleano `default(true)`. El borrado es **soft**: `destroy` solo hace `status = 0`.
- **SmartPay** no es un flag: es un **id resuelto por ambiente** en `config/lenders.php` (`production ? 160 : 153`), con punto único de consumo `Lender::isSmartpayChannel()`. Este config **solo existe en legacy-backend**.

### 4 · Alta y administración de una entidad
Hay **dos CRUD gemelos** sobre la misma tabla, y comparten hasta los FormRequest (`App\Http\Requests\Admin\Lender\StoreRequest`, duplicado en ambos repos):

| | **application** (vivo) | **legacy-backend** (gemelo) |
|---|---|---|
| Entrada | Inertia, `routes/admin.php:52-55` (`entidades`) | API, `Modules/Partner/routes/api.php:129` |
| Controlador | `Admin/LenderController` | `Partner/…/LenderController` → `LenderManagementService` → `LenderRepository` |
| UI | **6 archivos** Vue en `resources/js/pages/admin/lenders/` (4 pantallas + 2 pestañas del detalle) | **`frontend-monorepo/apps/backoffice/`** — 4 rutas de entidades sobre `Modules/Backoffice`, no sobre este módulo |

El alta hace siempre lo mismo, en transacción: sube la imagen a S3 → `Lender::create` (slug derivado de `Str::slug($name)`, sin chequeo de unicidad) → **siempre** `CreditLineByLender::create(credit_line_id: 1)` → y **solo si rt==2** crea `CreditopXLenderConfiguration`.

Asimetría real: el **`store` cubre solo rt==2**, mientras el **`update` de application borra y recrea la config para `rt == 2 || rt == 3`**. Un lender nacido rt=3 arranca **sin** `creditop_x_lender_configuration` hasta el primer guardado. El gemelo legacy tiene el bug en las dos puntas: `createLender` y `updateLender` chequean solo `== 2`.

**Cobertura del panel**: el formulario expone 23 campos y de `lenders` escribe **13 columnas** (`name, description, benefits, response_type, url, email, country_id, additional_data, slug, sort, status, complementary_form, image`) — el resto va a `credit_line_by_lenders` (8) y `creditop_x_lender_configuration` (2). Las **~23 columnas restantes** de `lenders` (`path_id, action, validation_type, amount_to_lend, promissory_type_id, signing_provider_id, is_fallback_lender, externally_serviced, available_until, ecommerce, voucher_image_url, …`) **no tienen UI en ESTE panel**: se setean por SQL directo. ⚠ **Pero ya no es «no tienen UI» a secas:** desde el backoffice nuevo, **`originator_nit` y `cutoff_type_id` se editan por pantalla** (ver «Antes de concluir»). Son dos columnas que este panel no expone y el otro sí — o sea que **la cobertura hay que preguntarla a los dos**, y van a seguir divergiendo mientras la migración esté a mitad de camino.

**Ningún seeder crea lenders.** Los de `database/seeders/Lenders/` solo siembran satélites (estados de transacción); `CredifamiliaConsumoSeeder` documenta explícitamente que la fila del lender 24 ya debe existir.

## Subcontextos
- **CreditopX** — familia in-platform (rt=2 consumo / rt=3 rotativo): CreditOp decide con motor local, sella cupo y enganche, y cierra hasta el Estado 11. Cuelgan de él **Profiling** (categoría) y **Amount tiers** (tramos por monto).
- **Aggregator** — familia por integración/API (rt=1): la API externa decide, pone el cupo y gestiona la cartera.
- **Redirect** — familia por redirección (rt=0, UTM/referido): CreditOp deriva a la web del lender; no decide ni gestiona.

*(rt=4 "external-managed" (Credifamilia) no tiene nodo propio: hoy vive acá y en la memoria `credifamilia-flujo-mapa`.)*

**(2026-08-28) Re-verificación asistida de los 11 archivos derivados** (worker → 7; las que invalidaban,
verificadas a mano — ciertas): el modelo de entidad **ganó columnas `product`
(`credit|renting|rto`) y `calculator` (json de fórmulas)** — la afirmación «no existe tipo de producto,
son flags sueltos» quedó vieja para esta familia; y `lenders_by_allied_branches` ganó
**`document_types` (array)**: los tipos de documento habilitados se parametrizan POR SUCURSAL — el
contraste «28 columnas por comercio vs 5 por sucursal» ahora es 28 vs 6, y la sucursal dejó de ser sólo
url/orden/estado.

⚠ **Pero la columna de la sucursal NO es la que decide qué ve el cliente.** Quien resuelve la lista es
`app/Services/DocumentTypesService::resolver($branchId, $tiposDelPais)`, y toma otro camino: junta las
entidades **activas** de la sucursal (`lenders_by_allied_branches.status = 1`), une sus
**`lenders.document_types`** —la columna de la ENTIDAD, no la de la sucursal— y recorta con el catálogo
del país.

**El país es TECHO, no piso**, y las dos ramas del final lo dicen:

    if ($tiposDelPais === []) return [];                      // país sin catálogo -> vacío, y el front lo dice
    $cruce = array_values(array_intersect($deLasEntidades, $tiposDelPais));  // reindexa: la respuesta es LISTA, no objeto
    return $cruce !== [] ? $cruce : array_values($tiposDelPais); // cruce vacío -> manda el país

**Consecuencia práctica para habilitar un documento** (el PEP, por ejemplo): se carga en
`lenders.document_types` de la ENTIDAD —se edita desde el admin viejo— y alcanza con eso, siempre que el
catálogo del país lo tenga. Colombia es `["CC","CE","PEP"]`, verificado en la BD. Buscar dónde
«activarlo por sucursal» es buscar en la columna equivocada. Más: la autorización diferida por codeudor, el estado de validación consultable para
codeudores, y el disparo de Experian de Credifamilia movido a la confirmación (CRED-222).

## Dónde mirar

**Modelo y tabla**
- `application/app/Models/Lender.php` — `$fillable` (:27) · **HARDCODE** `getResponseTypeAttribute` id 24 → rt 1 (:56 comentario, :59 método) · relaciones `creditLines`/`responseType`/`creditopXConfig`/`path` (:64-133).
- `legacy-backend/app/Models/Lender.php` — `$fillable` con las columnas legacy-only (:34-66) · `isSmartpayChannel()` (:75-78) · `identityValidationTypes()` (:136) · **sin** el accessor.
- `application/database/migrations/2023_04_20_202610_create_lenders_table.php:21` — `response_type` `default(1)` + comentario `url UTM => 0 / …`. Gemelo byte-idéntico: `legacy-backend/database/migrations/2023_04_20_202610_create_lenders_table.php`.
- `legacy-backend/config/lenders.php:24` — `'smartpay_lender_id' => env('APP_ENV') === 'production' ? 160 : 153`.

**Taxonomía `response_type`**
- `legacy-backend/database/seeders/ResponseTypesTableSeeder.php:25` (`0 UTM`), `legacy-backend/database/seeders/ResponseTypesTableSeeder.php:30` (`1 Integración`), `legacy-backend/database/seeders/ResponseTypesTableSeeder.php:35` (`2 Creditop X`) — no hay 3 ni 4.
- `legacy-backend/database/migrations/2024_04_25_174044_create_response_types_table.php:15` — la tabla catálogo (`id, name, status`).
- `application/app/Models/ResponseType.php` · `legacy-backend/app/Models/ResponseType.php` — idénticos, `$fillable = ['name']`.
- `legacy-backend/Modules/Onboarding/App/Services/UserRequestService.php:421` (url: excluye rt 2 y 4) · `legacy-backend/Modules/Onboarding/App/Services/UserRequestService.php:481` switch · `legacy-backend/Modules/Onboarding/App/Services/UserRequestService.php:482-483` `case 0/1` · `legacy-backend/Modules/Onboarding/App/Services/UserRequestService.php:489-491` `case 2/3/4` · `legacy-backend/Modules/Onboarding/App/Services/UserRequestService.php:674-683` `case 4` con `standBy=true`.
- `application/app/Http/Controllers/Customer/UserRequestController.php:791` (url: excluye solo rt 2) · `application/app/Http/Controllers/Customer/UserRequestController.php:818` switch · `application/app/Http/Controllers/Customer/UserRequestController.php:819` `case 0/1` · `application/app/Http/Controllers/Customer/UserRequestController.php:828` `case 2/3` (**sin `case 4`**) · `application/app/Http/Controllers/Customer/UserRequestController.php:882` `switch ($lender->id)` con `case 24` · `application/app/Http/Controllers/Customer/UserRequestController.php:969` `switch ($lender->name)`.
- `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderTabBehaviorResolver.php:25` (RD=60), `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderTabBehaviorResolver.php:28` (nombres), `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderTabBehaviorResolver.php:31` (`EXTERNAL_REDIRECT_RESPONSE_TYPES = [0,1]`), `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderTabBehaviorResolver.php:33` `opensNewTab()`.
- `legacy-backend/Modules/Loans/App/Http/Middleware/AddOriginationFlowType.php:54` (`lender_path`) · `legacy-backend/Modules/Loans/App/Http/Middleware/AddOriginationFlowType.php:59-63` (`credit_type` 3→revolving / 2→consumer / other).
- rt=4, las 4 constantes privadas: `LoanAuthorizationService.php:43` · `ContinueUserFlowController.php:20` · `PaymentDateService.php:18` · `PaymentSchedule/ExternallyManagedPaymentScheduleService.php:20`.

**Ejes de configuración**
- `legacy-backend/database/migrations/2026_02_19_200000_create_paths_table.php:20-22` — siembra `1 default` / `2 IMEI`. Enganche: `…2026_02_19_200001_add_path_id_to_lenders_table.php:13` (`foreignId('path_id')->default(1)`). Modelos: `application/app/Models/Path.php`, `legacy-backend/app/Models/Path.php` (idénticos; la migración es legacy-only).
- `application/database/migrations/2024_02_01_101511_add_action_column_to_lenders_table.php:15` — la columna `action`. Consumo: `legacy-backend/Modules/Onboarding/App/Services/lenders/LegacyLenderService.php:48` (`$lenderClass = $lender->action`), `legacy-backend/Modules/Onboarding/App/Services/lenders/LegacyLenderService.php:50` (`class_exists`), `legacy-backend/Modules/Onboarding/App/Services/lenders/LegacyLenderService.php:54` (`new $lenderClass()`), `legacy-backend/Modules/Onboarding/App/Services/lenders/LegacyLenderService.php:22` (`supports()` → siempre `true`).
- `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderServiceFactory.php:38` `make()` · `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderServiceFactory.php:46` fallback.
- `application/database/migrations/2025_11_20_160156_add_is_fallback_lender_to_lenders_table.php:16` — columna app-only.
- `legacy-backend/database/migrations/2026_02_12_150844_add_requires_restrictive_list_check_to_lenders_table.php:15` — el `->after('is_fallback_lender')` cross-repo.
- `legacy-backend/database/migrations/2026_07_04_000000_add_externally_serviced_to_lenders_table.php:15`.
- `application/database/migrations/2025_01_28_164900_add_validation_type_to_lenders_table.php:23` + dual-read en `legacy-backend/Modules/Identity/App/Services/ValidationStatusService.php:322` (`resolveValidationType`), `legacy-backend/Modules/Identity/App/Services/ValidationStatusService.php:328` (lee el escalar), `legacy-backend/Modules/Identity/App/Services/ValidationStatusService.php:332` (drift), `legacy-backend/Modules/Identity/App/Services/ValidationStatusService.php:345` (fallback legacy).

**Tablas satélite (config)**
- `legacy-backend/app/Models/LendersByAllied.php:19-51` — 28 `fillable` = la calculadora por comercio. `legacy-backend/app/Models/LendersByAlliedBranch.php:14-20` — 5 campos por sucursal.
- `application/app/Models/CreditLineByLender.php:20` + `legacy-backend/database/migrations/2023_04_20_224625_create_credit_line_by_lenders_table.php:16`.
- `application/app/Models/CreditopXLenderConfiguration.php` (idéntico al de legacy) + `application/database/migrations/2024_10_17_173908_create_creditop_x_lender_configuration.php:15`.
- `application/app/Models/LenderUsersCategory.php` + `application/database/migrations/2025_02_11_205120_create_lender_users_categories_table.php:14` (detalle en **Profiling**).

**Alta / administración**
- `application/app/Http/Controllers/Admin/LenderController.php` — `application/app/Http/Controllers/Admin/LenderController.php:79` `create()` (dropdown `ResponseType…where('status',1)`), `application/app/Http/Controllers/Admin/LenderController.php:89` `update()` (**`application/app/Http/Controllers/Admin/LenderController.php:139` rt==2 || rt==3**), `application/app/Http/Controllers/Admin/LenderController.php:200` `destroy()` (soft `status=0`), `application/app/Http/Controllers/Admin/LenderController.php:210` `store()` → `application/app/Http/Controllers/Admin/LenderController.php:233` `Lender::create` → `application/app/Http/Controllers/Admin/LenderController.php:252` `CreditLineByLender::create` → `application/app/Http/Controllers/Admin/LenderController.php:266` `CreditopXLenderConfiguration` **solo rt==2**, `application/app/Http/Controllers/Admin/LenderController.php:280` `updateUsuryRate` (salta lender 140 y `country_id==60`, `application/app/Http/Controllers/Admin/LenderController.php:292`).
- `application/app/Http/Requests/Admin/Lender/StoreRequest.php:36` — `response_type` es solo `required` (sin `in:` ni `exists:`).
- `application/routes/admin.php:52-55` · pantallas `application/resources/js/pages/admin/lenders/lender-edit/LenderEdit.vue:80-83` (select de `responseTypes`), `application/resources/js/pages/admin/lenders/lender-edit/LenderEdit.vue:95` (`form.emails`), `application/resources/js/pages/admin/lenders/lender-edit/LenderEdit.vue:357` (`lender.response_type.id`) y `…/lender-create/LenderCreate.vue:68`.
- Gemelo legacy: `Modules/Partner/App/Http/Controllers/LenderController.php:152` `store` · `Modules/Partner/App/Services/LenderManagementService.php:30` `createLender` (`Modules/Partner/App/Services/LenderManagementService.php:67` rt default 1, `Modules/Partner/App/Services/LenderManagementService.php:93` rt==2), `Modules/Partner/App/Services/LenderManagementService.php:120` `updateLender` (`Modules/Partner/App/Services/LenderManagementService.php:188` rt==2), `Modules/Partner/App/Services/LenderManagementService.php:323` `destroyLender` (`Modules/Partner/App/Services/LenderManagementService.php:333` soft) · `Modules/Partner/App/Repositories/LenderRepository.php:24` `create` · `Modules/Partner/routes/api.php:129` (bloque lenders), `Modules/Partner/routes/api.php:147` (lender-rules).

**Front**
- `frontend-monorepo/…/lib/domain/constants/lender.constants.ts:134` `LENDER_RESPONSE_TYPE` · `frontend-monorepo/…/lib/domain/constants/lender.constants.ts:143` `MANAGED_LENDER_PATH_ID = 3` · `frontend-monorepo/…/lib/domain/constants/lender.constants.ts:146` `IMEI_LENDER_PATH_ID = 2` · `frontend-monorepo/…/lib/domain/constants/lender.constants.ts:154` `isCreditopXType` · `frontend-monorepo/…/lib/domain/constants/lender.constants.ts:165` `PRE_APPROVAL_FLOW_RESPONSE_TYPES` (incluye el 4 como literal, porque no está en el mapa) · `frontend-monorepo/…/lib/domain/constants/lender.constants.ts:1` Credifamilia 24 · `frontend-monorepo/…/lib/domain/constants/lender.constants.ts:47` `HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS = [160]`.
  ⚠ **Motai ya no se cita acá.** El `MOTAI_LENDER_IDS = [158]` que este nodo listaba **se borró de `main`**: la misma regla se escribe hoy por PRODUCTO, no por id — `isCalculatorProduct(product)` en `frontend-monorepo/apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.helpers.ts:46-48`, con el comentario que deja dicho que reemplaza al chequeo por id. Si buscás «por qué esta entidad se porta distinto», el eje ya no es el id.
- `frontend-monorepo/…/lib/domain/entities/loan-option.entity.ts:13` `LenderResponseType = 0|1|2|3` · `frontend-monorepo/…/lib/domain/entities/loan-option.entity.ts:159` el campo en el DTO.
- `frontend-monorepo/…/lib/mappers/lender-response.mapper.ts:126` (desvío por `MANAGED_LENDER_PATH_ID`) · `frontend-monorepo/…/lib/mappers/lender-response.mapper.ts:230` mapeo de `response_type`.

