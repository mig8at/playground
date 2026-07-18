# Dynamic Forms · contexto
> **estado:** al día con main · Conviven **tres generaciones** de "formulario definido por config": el modelo relacional legacy (`fields`/`forms`/`form_types`), el wizard de **República Dominicana**, y el `backend-driven-form` de información adicional. Las respuestas caen en el EAV `user_field_values` — salvo las de la generación más nueva, que ni siquiera pasan por CreditOp.

## Qué es
"Formularios dinámicos" no es **un** subsistema: es un nombre que en este árbol tapa tres implementaciones distintas, de tres épocas, con contratos incompatibles entre sí, que hoy corren en paralelo. Ninguna de las tres se lee sola sin la otra: comparten el destino de las respuestas (el EAV `user_field_values`) y comparten un mismo proveedor externo (**onboarding-forms-service**, fuera de estos tres repos) que expone **tres endpoints distintos** para lo que conceptualmente es "dame el esquema".

Importa porque es la frontera entre *lo que se puede cambiar por config* y *lo que exige deploy*, y porque el destino de esas respuestas es decisional: el ingreso (`field_id` 87) y la ocupación (`field_id` 29) que llena un formulario los lee después el motor de categorías de la entidad, y la tabla `lender_user_fields_scoring_policy` convierte cualquier par (campo, valor) en puntaje por entidad.

## Contenido

### Las tres generaciones, de una mirada

| | **G0 — relacional legacy** | **G1 — wizard RD** | **G2 — backend-driven-form** |
|---|---|---|---|
| Dónde se define el form | 5 tablas en la BD de CreditOp | onboarding-forms-service | onboarding-forms-service |
| Quién lo pide | controladores Blade/Inertia en `application` | loader SSR del wizard | loader SSR del wizard |
| Endpoint del esquema | — (Eloquent directo) | `GET {VITE_ONBOARDING_FORM_SERVICE}/dynamic/{partner_hash}/schema` | `GET {VITE_FORM_SERVICE_BASE_URL}/v1/dynamic-form/{formTypeId}/schema` |
| Clave del form | `form_types.id` | **hash del comercio** (allied_branch) | `formTypeId` numérico (por **lender**) |
| Quién renderiza | Vue/Blade en `application` | React **hardcodeado** (`PersonalInfoForm.tsx`, 896 líneas) | React genérico (`DynamicFormRenderer`) |
| Dónde caen las respuestas | `user_field_values` | `user_field_values` (vía legacy) | **el form-service** — no toca CreditOp |
| Estado | vivo solo en `application` | vivo, gated por país | vivo, gated por entidad |

Y hay una **cuarta** pieza, `packages/form-engine`, que es la más grande y sofisticada de todas y **no está conectada a nada** (ver abajo).

### G0 — El modelo relacional legacy: la definición vive en 5 tablas
Todas creadas el mismo día (2023-04-20) y presentes **idénticas en `legacy-backend` y `application`**:

- `field_categories` — la "sección" (name, description, image, status).
- `fields` — el campo: `field_category_id`, `parent_id`, `related_field_id`, `parent_value`, `name`, `description`, `help_message`, `field_group`, `field_appearance`, `type`, `validation`, `data_source`, `status`.
- `field_options` — opciones: `field_id`, `key`, `name`, `sort`, `status`.
- `form_types` — el formulario (name, description, status) + `lender_id` agregado **2026-05-14**, con FK a `lenders` y `onDelete('set null')`.
- `forms` — la junta: `form_type_id`, `field_id`, `hidden`, `editable`, `sort`, `status`.
- `user_field_values` — las respuestas (el EAV).

El punto clave: **el contrato zod del frontend más nuevo es un espejo camelCase exacto de estas columnas** (`BackendFieldSchema` lleva `fieldGroup`, `fieldAppearance`, `dataSource`, `relatedFieldId`, `parentId`, `parentValue`, `hidden`, `editable`, `sort`, `status`). Es decir: el `onboarding-forms-service` externo re-sirve el mismo modelo de datos que ya existía en la BD de CreditOp desde 2023. No es un modelo nuevo: es el viejo, mudado de dueño.

**No hay seeders** de `fields`/`field_options` en ninguno de los tres repos → el catálogo de campos (qué es el `field_id` 87) es dato de producción, no está versionado en código.

### G1 — El wizard RD: "dynamic" quiere decir República Dominicana
El gate es de **país**, no de feature: en `/merchant/{hash}/solicitar`, si `session.alliedCountry === 60` el loader redirige al wizard dinámico en vez del clásico. Las 5 pantallas (`request-amount`, `request-phone`, `request-otp`, `request-personal-info`, `request-financial-info`) cuelgan de `merchant-dynamic-layout.tsx`.

Que es RD se prueba en los datos, no en el nombre:
- Los rangos de ingreso/egreso están en **pesos dominicanos**: `"Menos de RD$20,000"` … `"Más de RD$60,000"`.
- Los tipos de documento son **CED** (cédula dominicana, exactamente 11 dígitos), **CI_VE** (6-11 dígitos, cédula venezolana), **PAS** / **PAS_VE** (pasaporte, `[A-Z0-9]{6,9}`). **No** son CC/CE/PEP — ese juego es del flujo colombiano clásico.
- Edad admitida 18-100.

Aunque el loader baja un `FormSchema` remoto, **los formularios están escritos a mano**: `PersonalInfoForm.tsx` (896 líneas), `FinancialInfoForm.tsx` (577) y las opciones son constantes TS en `financial-info-options.ts`. La sesión también es de forma fija (`stepOneData` con exactamente name/lastName/email/city/documentType/document/issueDay/Month/Year). El esquema remoto aporta tema, logo y textos; **no** la lista de campos.

**El estado del wizard vive en Redis**, no en BD: `Modules/Partner/App/Services/DynamicFormSessionService.php`, prefijo `dynamic-form:`, **TTL 3600 s**, y el TTL **se refresca en cada lectura**. Tres rutas bajo `api/partners/dynamic-form/session/{transactionId}`: POST (upsert), GET, DELETE.

**El cierre (`create-user`) es server-to-server.** El endpoint `POST /api/onboarding/dynamic-forms/create-user` existe en legacy y **ningún archivo del frontend-monorepo lo llama** (grep vacío). Recibe `{ id: uuid, hash: alfanumérico 4-16, data: {...} }` y hace tres cosas notables:
1. Vuelve a pedirle el esquema al form-service — por un endpoint **distinto** al del front: `GET /v1/dynamic/full/{hash}/schema`, exigiendo `code === "OFS1000"`.
2. Valida el payload **contra el esquema, en ambas direcciones**: campo del spec que falta en el payload = error, y campo del payload que no está en el spec = error. Única excepción: `associateNumberScreenshot`.
3. Usa **el mismo `hash` como id de formulario y como hash del comercio** (`alliedBranchRepository->findByHash`) → un formulario por comercio.

Tipos validados en el backend (11): `email, checkbox, choice, radio, select, text, phone, otp, lastname, dateSelect, file`. `text` tope 60 caracteres; `phone` 10-15 dígitos; `dateSelect` `yyyy-mm-dd` con validez de calendario; **`otp` no valida nada** (`validateOtpField` devuelve `null` siempre).

Además, al crear el usuario el servicio **llama a una API externa de género** (`api.genderapi.io`, `country=CO`) para derivar `users.gender` del nombre de pila.

### G2 — `backend-driven-form`: información adicional por entidad
Esta sí es genuinamente backend-driven. Corre **después** de elegir entidad, dentro del journey (`/merchant/{hash}/{loan_request_id}/additional-info`):

1. `GET {VITE_API_URL}/api/loans/customer/{loanRequestId}/form-type` → legacy resuelve `user_request.lender_id` → **último `form_type` activo de ese lender**. Si el user_request no tiene lender, devuelve `null`.
2. Si el `formTypeId` es `null` → **se saltea el formulario** y redirige directo a firmar documentos. O sea: el formulario adicional es opcional y su existencia la decide la entidad.
3. `GET {VITE_FORM_SERVICE_BASE_URL}/v1/dynamic-form/{formTypeId}/schema` → esquema (zod-validado).
4. `POST {VITE_FORM_SERVICE_BASE_URL}/v1/dynamic-form/{formTypeId}/response/{userRequestId}` → **las respuestas van al form-service, no a legacy**.

Mecánica del renderer:
- Cada sección del esquema es un paso del wizard; se ordenan por `sort` y se filtran por `status`.
- La clave interna es `formKey = "field_{id}"` (para que React Hook Form no interprete puntos como paths), pero **el payload se emite keyed por `String(field.id)`** — el mismo id que `user_field_values.field_id`.
- Visibilidad condicional: `parentId` + `parentValue`, con `parentValue` **pipe-separado** y comparación insensible a acentos/mayúsculas/espacios. Un solo nivel, solo igualdad.
- Campos ocultos se **omiten** del payload (no se mandan como `null`); campos visibles sin valor van como `null`.
- La validación zod se genera desde `validation` (minLength/maxLength/min/max/regex/dataType).
- 14 tipos conocidos y 6 apariencias; lo desconocido cae silenciosamente a `text` / `input`.

### El huérfano: `packages/form-engine`
Es el motor más completo del árbol — 32 archivos, DSL propio (`defineForm`), 20 tipos de campo, condicionales `showIf` con 8 operadores (`== != > < >= <= in notIn`), pasos/secciones/grid, `recharge` de campos dependientes, OTP con timer, subida de archivos con MIME y tamaño, persistencia en localStorage, tematización, panel de debug de 619 líneas, y hasta un analizador de regex que deriva props de input. **Y no está enchufado a nada:**

- Su único consumidor en la app es `app/routes/dynamic/dynamic.tsx`, que **no está registrado en `routes.ts`**.
- En modo remoto el renderer busca su esquema en `/api/{scope}/schema`; **esa ruta no existe** en la app.
- `createDispatcher` — el proxy que serviría justamente esa ruta — se exporta y **no se usa en ningún lado**.
- Lo único que lo ejercita es Storybook, cuya story además documenta una ruta (`/dynamic/:scope`) que no existe.

### El EAV `user_field_values` y su censo de `field_id`
Tabla plana: `field_id`, `user_id`, `user_request_id`, `form_id`, `value` (text), `file`, `file_name`, `status`. **Sin foreign keys y sin índice único** sobre la terna (`field_id`,`user_id`,`user_request_id`) — la unicidad la sostiene solo el `updateOrCreate` del código.

Censo verificado de los `field_id` hardcodeados:

| id | significado | dónde se escribe |
|---|---|---|
| 25 | estado civil | `CreditopXFormController` (con `form_id` **5**) |
| 29 | ocupación / situación laboral | perfilamiento; y Experian lo **fuerza** a `'Empleado'` |
| 30 | estrato social | `OnboardingService::storeSocialStratum` |
| 44 | dirección (sin acentos, sin símbolos) | flujo de aceptación de términos Bancolombia |
| 70 | código CIIU | `CreditopXFormController` |
| **87** | **ingreso mensual** | ~10 sitios — es el más disputado |
| **90** | **egresos** | Experian; form RD |
| 158 | personas a cargo | `CreditopXFormController` |
| 159 | estrato (viejo) | **solo en código comentado** → lo reemplazó el 30 |
| 160 | flag "reportado" | siempre `'no'`, hardcodeado |
| 161 | continuidad de ingresos | Ágil Data / Mareigua |
| 162-172 | los 11 campos del form RD | `DynamicFormsService` |

Los **87 y 90 son los únicos numéricos**: el modelo los coacciona a entero redondeando **hacia arriba** (`ceil`) antes de guardar.

El mapa del form RD (162-172) es un `const` en el servicio: `cityOfResidence` 162, `averageMonthlyIncome` 163, `primaryOccupationType` 164, `associateNumberScreenshot` 165, `incomeType` 166, `employmentOrBusinessTenure` 167, `incomeChannels` 168, `activeCredits` 169, `hasActiveCreditCard` 170, `approximateMonthlySpend` 171, `hasPaymentDelaysOver30Days` 172. Además de guardar el **texto** del rango, el servicio deriva un **número** hacia 87 y 90 parseando la etiqueta: toma la última cifra del rango; si dice "menos de/hasta/under" usa `techo − 5000`; si dice "más de/o más/above" cae a un fallback fijo (**65000** para ingreso, **55000** para egreso).

Y de ahí sale a decisión: el motor de categorías lee el 87 como salario (después de Ágil Data y Mareigua), el 29 como ocupación contra `rule->occupation` (también pipe-separada), y `lender_user_fields_scoring_policy` (`lender_id`, `field_id`, `value`, `score`) suma puntaje por coincidencia exacta de valor. El detalle de esas reglas es del contexto de perfilamiento; acá basta con saber que **lo que el formulario escribe, la decisión lo lee**.

### El "config" del formulario clásico no es un formulario dinámico
El endpoint que el frontend clásico llama "config de personal-info" (`GET /api/onboarding/loan-application/personal-info/{hash}/{loanRequestId}/config`) **no describe campos**. Devuelve exactamente dos booleanos:

- `should_use_manual_birth_date` — true si el comercio está en una **constante hardcodeada** (`MANUAL_BIRTH_ALLIED_IDS = [272]`) o si la sucursal tiene asociada alguna entidad de `MANUAL_BIRTH_LENDER_IDS = [39, 23, 141, 142, 166, 24]` (con un TODO pendiente de agregar las de Credifamilia).
- `should_collect_stratum` — sale del setting de BD `stratum_field_allieds`.

O sea: el formulario clásico es React fijo con **dos toggles**, uno de los cuales vive en código.

## Dónde mirar

**G1 — wizard RD, backend**
- **Servicio maestro** (legacy-backend): `Modules/Onboarding/App/Services/DynamicFormsService.php:43-55` (mapa 162-172) · `:37-41` (87/90 + fallbacks 65000/55000) · `:659-707` (parseo de rangos) · `:1173-1191` (validación bidireccional) · `:1398-1413` (11 tipos) · `:1565-1568` (OTP no valida) · `:1040-1076` (genderapi).
- **Cliente del form-service**: `Modules/Onboarding/App/Repositories/DynamicFormsRepository.php:22` (código `OFS1000`) · `:55` (config) · `:79` (`/v1/dynamic/full/{formId}/schema`).
- **Envelope de entrada**: `Modules/Onboarding/App/Http/Requests/DynamicForms.php:10-22` (id uuid / hash / data) · `:36-43` (hash 4-16 alfanumérico).
- **Ruta**: `Modules/Onboarding/routes/api.php:193-195`.
- **Config**: `Modules/Onboarding/config/config.php:6-8` (`ONBOARDING_FORMS_SERVICE_BASE_URL`), fusionada por `Modules/Onboarding/App/Providers/OnboardingServiceProvider.php:268`.
- **Sesión en Redis**: `Modules/Partner/App/Services/DynamicFormSessionService.php:10-11` (prefijo + TTL) · `:54` (refresco) · rutas en `Modules/Partner/routes/api.php:218-222`.

**G1 — wizard RD, frontend**
- **El gate de país**: `apps/loan-request-wizard/app/routes/loan-application-form/phone-number.tsx:63-69` (`alliedCountry === 60` → `/request-amount`).
- **Fetch del esquema**: `apps/loan-request-wizard/app/routes/dynamic/request-amount.tsx:40` (`VITE_ONBOARDING_FORM_SERVICE`) · `:60` (`/dynamic/{partner_hash}/schema`).
- **Que es RD**: `modules/loan-request-wizard/dynamic-form/src/ui/components/financial-info-options.ts:1-8` y `:44-51` (rangos `RD$`) · `modules/loan-request-wizard/dynamic-form/src/lib/utils/dynamic-step-one.ts:22-24` (CED/CI_VE/PAS) · `:17-18` (18-100 años).
- **Sesión (forma fija)**: `modules/loan-request-wizard/dynamic-form/src/lib/types/dynamic-form-session.ts:13-21`; cliente en `apps/loan-request-wizard/app/context/DynamicFormContext.tsx:34` / `:76` / `:95`.
- **Rutas del wizard**: `apps/loan-request-wizard/app/routes.ts:82-87`.

**G2 — backend-driven-form**
- **Resolución del form por entidad**: `Modules/Loans/App/Services/FormTypeService.php:29-37` · ruta `Modules/Loans/routes/api.php:124`.
- **Salto si no hay form**: `apps/loan-request-wizard/app/routes/additional-info.tsx:36-39`.
- **Contrato del esquema**: `modules/loan-request-wizard/backend-driven-form/src/domain/types/backend-form.ts:21-40` (espejo de `fields`).
- **Endpoints**: `.../infrastructure/repositories/dynamic-form-schema.repository.ts:5-6` y `:19` · `.../save-form-response.repository.ts:18` (las respuestas salen a la MS) · `.../form-type.repository.ts:18` · `.../supplementary-info.repository.ts:7-8` (typo del proveedor documentado en comentario).
- **Normalización**: `.../application/mappers/backend-to-internal.mapper.ts:17-32` (14 tipos) · `:44-46` (fallback silencioso a `text`) · `:56` (`required = nullable === false`) · `:72` (`formKey`).
- **Visibilidad y payload**: `.../application/field-visibility.ts:21-28` · `.../application/submit-payload-builder.ts:33` (keyed por `field.id`).
- **Hardcode de país**: `apps/loan-request-wizard/app/routes/additional-info-form.tsx:34` (`COUNTRY_ID = 47`) · `:169` (submit) · `:186` (→ firmar documentos).

**El huérfano form-engine**
- **DSL**: `packages/form-engine/src/types.ts:14` (8 operadores) · `:120-136` (20 tipos) · `:185-202` (`defineForm`).
- **Fetch remoto sin ruta que lo sirva**: `packages/form-engine/src/renderer.tsx:188` (`/api/{scope}/schema`).
- **Proxy exportado y nunca usado**: `packages/form-engine/src/dispatcher.ts:1`, exportado en `packages/form-engine/src/index.ts:24`.
- **La ruta que no se registra**: `apps/loan-request-wizard/app/routes/dynamic/dynamic.tsx:16` (ausente de `apps/loan-request-wizard/app/routes.ts`).

**G0 y el EAV**
- **Definición**: `database/migrations/2023_04_20_225944_create_fields_table.php` · `..._230613_create_forms_table.php:17` · `..._230159_create_field_options_table.php` · `..._225653_create_field_categories_table.php` · `..._225816_create_form_types_table.php` + `2026_05_14_030659_add_lender_id_to_form_types_table.php`.
- **Tabla EAV**: `database/migrations/2023_04_20_230901_create_user_field_values_table.php:14-27` (sin FKs ni unique) · coerción numérica en `app/Models/UserFieldValue.php:31` y `:62`.
- **EAV → decisión**: `Modules/Loans/App/Services/LenderUserCategoryService.php:346-351` (scoring por campo) · `:384-389` (87 como salario) · `:409` (29 como ocupación) · tabla en `database/migrations/2026_02_19_214838_create_table_lender_user_fields_scoring_policy.php`.
- **Los ids del perfilamiento** (application, vivo): `app/Http/Controllers/Customer/GenericFormController.php:20` (form_type 4) · `:36` (estado 9) · `:74`/`:91`/`:125` (29/87/160) · rutas en `routes/customer.php:143-144`.
- **Los ids del complementario** (application, vivo): `app/Http/Controllers/Customer/CreditopXFormController.php` (25/158/70) · `routes/customer.php:270-271` · gate por entidad en `database/migrations/2024_08_28_212910_add_complementary_form_to_lenders_table.php`.
- **Estrato y fecha manual**: `Modules/Onboarding/App/Services/OnboardingService.php:1198` · `:1214` · `:1239` (field 30) · constantes en `Modules/Onboarding/App/Constants/ManualPersonalDataAllieds.php:20-23`.
- **El "config" de dos booleanos**: `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:1616-1634`; cliente en `apps/loan-request-wizard/app/modules/personal-info-config/infrastructure/personal-info-config.repository.ts:14`.

## Gotchas / riesgos
- **"Dynamic form" ≠ formulario configurable.** En G1 el nombre engaña dos veces: los campos están hardcodeados en React, y "dynamic" en las rutas quiere decir **República Dominicana**. El seed de este nodo decía que el front "arma el formulario dinámicamente" desde el config de personal-info: es falso, ese config devuelve dos booleanos.
- **Tres endpoints para un mismo servicio.** `/dynamic/{hash}/schema` (front G1), `/v1/dynamic/full/{hash}/schema` (backend G1) y `/v1/dynamic-form/{formTypeId}/schema` (front G2), bajo **dos variables de entorno distintas** en el mismo frontend (`VITE_ONBOARDING_FORM_SERVICE` y `VITE_FORM_SERVICE_BASE_URL`). En G1 el esquema se baja **dos veces** —una para pintar, otra para validar— por endpoints distintos: si divergen, el usuario completa un formulario que el backend después rechaza.
- **`VITE_ONBOARDING_FORM_SERVICE` no está en `.env.example`.** Si falta, el loader tira 500 "Dynamic schema service is not configured". Solo está documentado `VITE_FORM_SERVICE_BASE_URL`.
- **Toda falla de validación sale como HTTP 500.** `DYFS1002` mapea a `INTERNAL_SERVER_ERROR` y el facade lo devuelve tanto para errores de infraestructura como para validación estática o dinámica fallida. Solo los conflictos de identidad (`DYFS1003/1004/1005`) son 422. Un campo mal escrito es indistinguible de una caída del proveedor.
- **La validación bidireccional es frágil por diseño.** Un campo nuevo en el esquema que el front todavía no manda, o un campo que el front manda de más, **aborta la creación entera**. La única excepción tallada a mano es `associateNumberScreenshot`.
- **`required` es fail-open en G2.** `required = validation.nullable === false`: si el proveedor omite el bloque `validation`, o manda `nullable: null`, el campo queda **opcional**. Y un `type` desconocido cae en silencio a `text`, sin log.
- **Las respuestas de G2 no están en CreditOp.** Van a `POST /v1/dynamic-form/{id}/response/{userRequestId}` del form-service; no hay ningún endpoint en legacy que las reciba. Si el form-service escribe o no en `user_field_values` no se puede afirmar desde estos repos.
- **El ingreso derivado de rangos puede quedar muy por debajo del real.** "Más de RD$60,000" se persiste como **65000** en el `field_id` 87 — el mismo campo que después el motor de categorías compara contra `min_income`. El tope abierto se aplasta a un número fijo.
- **`user_field_values` no tiene unique ni FKs.** La terna (`field_id`,`user_id`,`user_request_id`) es única solo por convención del código, y hay **tres repositorios paralelos** sobre la misma tabla (Onboarding, Identity, Loans) con nombres distintos para la misma operación (`createOrUpdate` vs `updateOrCreate`), más ~37 accesos directos al modelo.
- **`form_id` es basura.** El perfilamiento renderiza `form_type = 4` pero escribe `form_id = 1`; el complementario escribe `form_id = 5`; el form RD escribe siempre `1`. La columna no es confiable como discriminador.
- **Claves de payload muertas.** Los controladores viejos pasan `files`, `file_names`, `file_sizes`, `file_mime_types`, que **no existen** en el `$fillable` (las columnas son `file` y `file_name`, singulares): se descartan en silencio.
- **Código muerto verificado**: `createTemporaryUserEntity` en `DynamicFormsService.php:843` nunca se llama (el orquestador tira excepción si no encuentra usuario por teléfono). `Modules/Identity/App/Repositories/FormRepository.php:16-25` está registrado en el contenedor pero sus dos consultas filtran por una columna **inexistente** (`form_type`; la tabla tiene `form_type_id`) — reventaría si alguien la invocara.
- **Gemelos no invocados** (patrón conocido del strangler): `GenericFormController` y `CreditopXFormController` existen en `legacy-backend` **sin rutas**; las rutas vivas están solo en `application` (`/formulario-perfilamiento`, `/formulario-complementario`).
- **Dos archivos de config bajo el mismo namespace.** `config/onboarding.php` (drivers/fakes/logging) y `Modules/Onboarding/config/config.php` (dynamic_forms/abaco/redis) se fusionan ambos en `config('onboarding.*')` vía `mergeConfigFrom`. Hoy no chocan; el día que compartan una clave, gana el de raíz.
- **Detalles menores pero reales**: el docblock del repositorio dice `OFS1001` mientras la constante exige `OFS1000`; el endpoint upstream de información suplementaria tiene un typo (`/v1/suplementary-info/`, con una sola `p`) que el cliente replica a propósito; `COUNTRY_ID = 47` está hardcodeado en la ruta de información adicional; y `field_id` 159 (estrato) quedó huérfano tras ser reemplazado por el 30.
- **El catálogo de campos no está en código.** Sin seeders, no hay forma de saber desde el repo qué campo es un `field_id` que no esté en el censo de arriba.

## Preguntas abiertas
- **¿El form-service persiste las respuestas de G2 en `user_field_values`?** Los answers van keyed por `field.id` (el mismo espacio de ids del EAV), lo que sugiere que sí, pero el servicio está fuera de estos tres repos y no hay endpoint receptor en legacy. Sin verificar.
- **¿`ONBOARDING_FORMS_SERVICE_BASE_URL`, `VITE_ONBOARDING_FORM_SERVICE` y `VITE_FORM_SERVICE_BASE_URL` apuntan al mismo host?** Los tres paths son distintos y solo el último está en `.env.example` (`form-service.inertia-develop:8082`). Sin confirmar en despliegue.
- **¿Quién llama a `dynamic-forms/create-user`?** No hay caller en el monorepo; la forma del payload (`id` uuid de transacción + `hash` de comercio + `data`) es compatible con un callback del propio form-service, pero es inferencia.
- **¿`COUNTRY_ID = 47` (árbol de países del form-service) y `alliedCountry === 60` (RD en CreditOp) conviven o se contradicen?** Son espacios de ids distintos; no se verificó el catálogo del proveedor.
- **El catálogo real de `fields`** (nombre y tipo de cada `field_id`, incluidos 162-172 en la BD): solo obtenible consultando producción.

## Bitácora
- **2026-07-18** — Fase de data: nodo documentado por ANALISIS DE CODIGO (no habia doc fuente) + superficie curada.
- **2026-07-17** — Contexto sembrado desde playground/flow (nodo `SolicitudNode` + `fieldDocs.js` `sol.*`/`node.solicitud` + MAP.md §S3 fila 6 / §S4 EAV).

## Enlaces
- Padre: **formalization**. Hermanos: **kyc** (el buró llena los mismos `field_id` 87/29/160/90 que el formulario, y le gana en prioridad), **onboarding** (el journey donde corren estos formularios), **profiling** (cómo el EAV se convierte en categoría y cupo), **entities** (`form_types.lender_id` y `lenders.complementary_form` son config por entidad), **legacy-backend** / **frontend-monorepo** / **application** (los tres repos que cruza esta fase).
- Memorias: `onboarding-decision-data-map` (EAV 87/29/160 y frontera de inyectabilidad), `reglas-comercio-lender-map` (dónde entra el ingreso en las 4 capas de reglas), `migracion-application-a-legacy-estado` (por qué hay gemelos sin rutas), `admin-anatomia-creditop` (config por comercio vs por sucursal).
- El simulador `playground/flow` modela esto como la fila "Form dinámico" de MAP.md §S3 y los inputs del nodo Solicitud, no como nodo propio.
