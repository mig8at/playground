---
id: 43
title: "Internacionalización del onboarding — celular, tipos de documento y mensajes por país"
stage: evaluation
created: "2026-08-05T17:11:17-05:00"
context_nodes: [onboarding, dynamic-forms, merchants, entities, smartpay, hardcodes-entidades]
jira: []
jira_title: ""
---

# Internacionalización del onboarding
> **estado:** 🔎 en evaluación — se está definiendo **dónde vive la configuración de país** antes de escribir
> la descripción de la tarea. Nada implementado. Sin rama.
>
> La tarea **llega** por SmartPay (RD), pero el objetivo real es que el onboarding sea multi-país por
> **filas de configuración** y no por forks: **celular** (prefijo/longitud/validación), **tipos de
> documento** y **mensajes** (copy, plantillas, moneda y formatos).

## Contextos que usa
- **onboarding** — el journey que hay que parametrizar: entrada por hash de sucursal → celular/OTP → nace la
  `user_request` → formulario personal/laboral. El gate de país está en el loader de la pantalla de celular.
- **dynamic-forms** — la generación **G1 es el fork de RD** ("dynamic" quiere decir República Dominicana):
  5 pantallas propias con los tipos de documento y los rangos en RD$ escritos a mano en TS.
- **merchants** — donde vive la config por comercio/sucursal (`allieds.country_id`, la copia de reglas por
  sucursal, `lenders_by_allied_branches`). El país del comercio está acotado a `Rule::in([47, 60])`.
- **entities** — `lenders.country_id` (default 1) y el `response_type` como eje de despacho.
- **smartpay** — el canal por donde entra la tarea (RD: `country_id=60`, locale `es_DO`, moneda `DOP`).
- **hardcodes-entidades** — la lente transversal: la fila **"país RD/Colombia" (6 sitios, P2)** ya está en su
  catálogo de bloqueadores. Este trabajo es des-hardcodear esa fila.

## El dolor en una frase
**RD ya está en producción, pero como un fork y no como configuración.** `alliedCountry === 60` en el loader
de la pantalla de celular redirige a **un wizard entero aparte** (5 pantallas + `PersonalInfoForm.tsx` de 896
líneas + `FinancialInfoForm.tsx` de 577). Si el tercer país entra por el mismo camino, son 5 pantallas más y
un tercer catálogo de documentos.

## Censo: ya hay CUATRO columnas de país y tres mienten
El problema no es de cobertura — es del `DEFAULT 1`. Verificado contra `main` de
`legacy-backend`/`frontend-monorepo` + BD local (2026-08-05):

| Tabla | Columna | Datos reales | Estado |
|---|---|---|---|
| `allieds` | `country_id` NOT NULL **DEFAULT 1** | 264 en 47 · 2 en 60 | **sana** — y la única que el flujo lee (sesión `alliedCountry`) |
| `lenders` | `country_id` NOT NULL **DEFAULT 1** | **155 en 1** · 1 en 60 | basura + **tres** filtros literales `where('country_id', 1)`. Aun así decide mensajería y tasa |
| `users` | `country_id` NOT NULL **DEFAULT 1** | **215.844 en 1** · 12.183 en 47 · 1 en 60 | basura inconsistente, **sin lector** |
| `users` | `issue_country` varchar nullable | **0 filas** pobladas | vacía **pero sí se lee** → ver bug abajo |
| `allied_branches` | — | — | **falta** (la que sí hace falta) |
| `user_requests` | — | — | **falta** — la solicitud no congela el país |
| `countries` | la fila de config | `dial_code`, `cell_phone_lenght`, `locale`, `currency`, iso | **es la que ya casi sirve y casi nadie lee** |

**El defecto de diseño es el default, no la tabla.** `DEFAULT 1` apunta a una fila real (`id 1` =
Afghanistan), así que **"sin definir" es indistinguible de "definido mal"** — y es lo que pasó en las
tres columnas rotas. Con `NULL` los 155 lenders y los 215.844 usuarios habrían gritado el primer día.
Regla para lo que se agregue: **sin default, o nullable.**

**Los tres filtros literales `->where('country_id', 1)` hoy funcionan por accidente** —leen el default,
no un país—: `LenderRetrievalService:458`, `OnboardingService:1782`, `Identity/LenderRepository:52`.
Poblar bien `lenders.country_id` sin arreglarlos primero **vacía el listado**. La versión parametrizada
ya existe y nadie la usa en ese camino (`Onboarding/LenderRepository:18-22`).

**Semántica correcta de cada una** (importa para no volver a mezclarlas):
- `allieds.country_id` = donde el comercio **reporta** (país central). Hoy hace **dos** trabajos: ese y
  "el país que gobierna el flujo". Con la de la sucursal hay que quitarle el segundo — si no, la columna
  nueva no arregla nada porque el gate sigue leyendo la del comercio.
- `allied_branches.country_id` = donde se **opera / se atiende al cliente**. Es la que debe gobernar.
- `lenders.country_id` = **en qué moneda está denominada esa fila** (no "dónde opera"). Por eso es
  singular y está bien que lo sea.
- `users.country_id` / `issue_country` = **de dónde es la persona**. Es OTRO EJE: un colombiano atendido
  en una sucursal RD es legítimo. No mezclar con el eje de operación.

**Dónde NO ponerla:** en `lenders_by_allied_branches` (el cableado) ni en las tablas de config que
cuelgan de esas (calculadora, group rules, categorías, tramos). Es derivable de los dos lados y ahí es
donde una tercera copia fabrica deriva: el cableado **valida** que sucursal y entidad coincidan, no
guarda una opinión propia.

**La que falta y nadie pidió: `user_requests`.** La solicitud congela `rate`, `initial_fee`,
`final_amount`, `fee_value`… y **no congela el país** (verificado: no tiene columna de país, moneda ni
locale). El día que se corrija el país de una sucursal, las solicitudes históricas cambian
**retroactivamente** de moneda, de documentos válidos y de plantilla de mensaje — en originación eso
toca documentos ya firmados. Snapshot, no FK viva, igual que el resto de esa tabla.

**Bug ya cobrando:** `issue_country` está en **0 filas** y se lee como
`$user->issue_country ?? 'COLOMBIANA'` (`OnboardingPayloadBuilder.php:129`) → **todos los documentos
generados afirman nacionalidad colombiana**, incluidos los de RD.

## Por dónde arrancar: "config de país" y "geolocalización" no son el mismo trabajo
La geografía **ya existe y es de tres niveles** (`countries` → `country_zones` = departamentos/provincias
→ `country_cities`), y está más completa de lo que parece. Censo (BD local):

| | |
|---|---|
| países | **253**, todos `status=1` → hoy no hay forma de decir "operamos acá" |
| países con zonas | **214** (4.110 zonas en total) |
| zonas de **RD** | **32** ✅ — son sus 31 provincias + Distrito Nacional, están bien |
| ciudades de **RD** | **0** ⛔ |
| ciudades de **CO** | 1.123 |
| `address_format` | **0 filas** pobladas |
| suciedad conocida | `country_zones.code`: de 4.110 filas solo 419 numéricas; en CO 3 malas (`EXT`, `MED`, `TODOS`) |

Y el dato que decide la prioridad: **el wizard RD hoy NO consume `country_cities`.** Su ciudad de
residencia (`field_id` 162) sale de constantes TS / del forms-service externo, no del árbol. El árbol lo
consume la **G2** (`form-service`, `PUT /v1/field-options/country-tree/{countryId}`) — que es justamente
el camino que **ya es multi-país por diseño** y que ya se ejercitó sin escribir código (la cascada
Departamento→Ciudad de nacimiento de Credifamilia, 2026-07-23).

→ **Cargar las ciudades de RD es un INSERT, no un diseño**, y solo hace falta el día que una pantalla de
RD pida ciudad desde el árbol. Arrancar por ahí gasta la primera semana en higiene de 250 países sin
mover nada observable, mientras los tres bloqueadores reales siguen intactos.

**Orden propuesto para el catálogo:**

1. **`countries` como fila de configuración** — el arranque real, y es chico. Ya tiene consumidor vivo
   (`currency_format`), así que lo que se agregue se usa el día uno.
   - `phone_code`: re-sembrar (migración no-op) **y decidir si sobrevive**: hoy hay dos columnas para lo
     mismo (`dial_code` sin `+`, `phone_code` vacía).
   - **las columnas ISO están corridas** (`iso_code_1`=alpha-2, `iso_code_2`=alpha-3, `iso_code_3`
     vacía): renombrar o documentar, pero no dejarlo — `PhoneService::resolveCountry` devuelve alpha-2 y
     cualquier join contra `iso_code_2` falla en silencio.
   - `cell_phone_lenght` (typo) vs el `$fillable` con el nombre correcto → renombrar columna + modelo.
   - `locale`: 6/250 pobladas y en dos notaciones (`es-CO` vs `es_DO`) → una sola + convertir en el borde.
   - **agregar**: `otp_length`, `date_format`, `template_suffix` (hoy es el `'do' : 'co'` hardcodeado).
   - **`status` que signifique algo** (o `is_operating`): las 253 están activas. Es lo que después le da
     sentido a "esta sucursal solo habilita entidades de este país".
2. **Tipos de documento** — catálogo + aplicabilidad (ver la sección de las tres capas). **No** es parte
   de geo y **no** es una columna JSON de `countries`: meterla ahí pierde los niveles sucursal/entidad
   que ya existen en `lenders_by_allied_branches.document_types`.
3. **`allied_branches.country_id`** — la única pieza *geo* que sí es de arranque, porque desbloquea todo
   lo demás. Va con **invariante**: la ciudad debe pertenecer a una zona de ese país, validado en el
   único camino de escritura. Sin eso no es una columna nueva, es una quinta opinión (la deriva ya
   existe: la sucursal del comercio RD apunta a una ciudad colombiana).
4. **Geo (datos)** — ticket aparte, no bloqueante: **ciudades de RD** (0 hoy), `address_format` y la
   limpieza de `country_zones.code`. Payoff diferido: recién pesa cuando una pantalla RD pida ciudad
   desde el árbol.

El patrón que no escala no es "faltan features": es que **el país es un `if` literal en vez de una fila
cargada una vez por solicitud**. En `main`: **28 archivos PHP con `'+57'` literal**, `?? '+57'` como default
en toda la cadena de OTP, y el predicado
`$isDoLogic = (lender.country_id === 60) || $countryIso === 'DO' || str_contains($cell_phone, '+')`
**copiado 4 veces** (`NotificationService` ×3 + `TwilioController.php:187`), con una definición de "es RD"
distinta de la del repositorio de mensajería (`LoanMessagingServiceRepository::getRoutingData`, que prioriza
el país del contexto sobre el del teléfono).

## Dónde vive la configuración: las tres capas que hay que separar
El debate "herencia (`countries` → tipos de documento) vs. tabla de configuración que une conceptos" mezcla
tres cosas distintas. La decisión de diseño de esta tarea es **separarlas**:

1. **CATÁLOGO — qué existe.** Un tipo de documento tiene atributos propios (código, label, regex, longitudes,
   código por proveedor). Eso es una entidad y merece su tabla (`document_types`). No es "ensuciar" nada:
   hoy ese conocimiento vive como **regex en TypeScript** (`dynamic-step-one.ts`) y **closures en PHP**
   (`PersonalInfoRequest`), duplicado y divergente. `CED` no es hijo de una fila de `countries`.
2. **APLICABILIDAD — dónde aplica.** Acá la regla de Fercho es la correcta: **no** colgar
   `country_document_types` de `countries` ni crear una tabla por par (país / comercio / sucursal / entidad =
   4 tablas que divergen). **Una** tabla que referencia a los padres. Y esto **ya está hecho a medias**: la
   migración de Motai v2 agregó `lenders_by_allied_branches.document_types` (json).
3. **RESOLUCIÓN — quién gana.** Es **código**, no schema: un resolvedor, una precedencia escrita, un test.
   Motai v2 ya eligió una regla — **unión** de los `document_types` de las entidades de la sucursal, con piso
   `["CC","CE"]` (`AlliedInfoController::resolveAllowedDocumentTypes`). Es una regla válida y hay que
   heredarla, con una corrección obligatoria multi-país: **la unión debe intersectarse con el catálogo del
   país**, o una sucursal mixta le ofrecería `CED` a un colombiano.

**El hallazgo que decide el foco:** `lenders_by_allied_branches.document_types` está poblada en **6231 de
6231 filas** de la BD local (`["CC","CE"]` ×6228, `["CC","CE","PEP"]` ×3 = Motai) y **no tiene ningún lector
en `main`** de ninguno de los dos repos — su único consumidor vive en `feature/motai-v2`. Mientras tanto el
wizard sigue con `z.enum(["CC","CE","PEP"])` y el backend con `in:CC,CE,PEP`. O sea: **la pregunta "dónde
viven los tipos de documento" ya se contestó una vez en la BD y la respuesta está muerta.** El riesgo de esta
tarea no es elegir mal la forma de la tabla: es construir la tabla y no matar los catálogos hardcodeados.

**Forma propuesta** (una tabla de aplicabilidad, FKs reales, precedencia por especificidad):

```
document_types        (id, code, name, regex, min_length, max_length, sort, status)      -- catálogo
document_type_scopes  (id, document_type_id FK, country_id FK NULL, allied_id FK NULL,
                       allied_branch_id FK NULL, lender_id FK NULL, is_enabled, sort, status)
```

Gana el ámbito **más específico no-nulo**. Se eligen FKs nullables y **no** un `(scope_type, scope_id)`
polimórfico a propósito: los ámbitos son pocos y conocidos, y este código ya tiene dos tablas sin FK que sus
propios docs describen como no confiables (`user_field_values` sin unique ni FKs; `settings` con arrays de
ids en JSON). La clase de bug que más veces mordió acá es exactamente la que una FK ataja
(`country_id` default 1). Costo aceptado: una dimensión nueva = una migración.

**Y la regla para no reinventar `settings`:** tabla de configuración = **columnas tipadas + FK al catálogo**.
No key/value, no bolsa JSON. El JSON de `document_types` es aceptable mientras el catálogo sea cerrado y
diminuto (CC/CE/PEP); deja de serlo al entrar CED/PAS/CI_VE con regex por país.

**Alcance del genérico:** hacerlo **para tipos de documento primero**. Longitud de celular, `otp_length`,
locale y moneda salen de `countries` (S1) mientras no haya un segundo caso que exija ámbito por sucursal.
Construir el motor genérico antes de tener dos casos es cómo nace un `settings` nuevo.

## Lo que la premisa "sucursales en otro país" necesita antes de existir
La sucursal **no sabe en qué país está**: no hay `allied_branches.country_id`; el flujo lee el país del
**comercio**. Consecuencias:
- Una sucursal en otro país es hoy **invisible** para el flujo.
- Los dos criterios ya se contradicen en el dato: la única sucursal del comercio RD (`country_id=60`) apunta
  a una **ciudad colombiana**. Es 1 fila de 1692 — dato sucio, no un comercio multi-país real; pero nada lo
  impide porque nada lo valida.
- Derivar el país por `country_city_id` → `country_zones` **no** sirve como camino canónico: el nodo
  `bancolombia` documenta que `country_zones` está sucio (4110 filas, solo 419 con código numérico).

→ **Decisión propuesta:** `allied_branches.country_id` explícito (nullable, fallback al comercio), poblado
desde la ciudad **una vez** y con check de consistencia, en vez de derivarlo en caliente por dos joins sobre
una tabla sucia. Y `session('alliedCountry')` pasa a leer el país de la **sucursal**.

## ¿Una entidad puede operar en varios países? El esquema ya contestó: NO
Si un comercio puede tener sucursales en varios países, la pregunta simétrica es si una **entidad**
puede. La respuesta no es de criterio, es de esquema: **la economía de la entidad está denominada en
moneda y vive en `credit_line_by_lenders`, que cuelga de `lender_id` y no tiene dimensión de país.**
Verificado en la BD local:

| lender | país | `min_amount` | `max_amount` | `rate` |
|---|---|---|---|---|
| SmartPay (153) | 60 RD | 1.000 | 100.000 | 10,00 |
| CrediPullman (77) | 1 *(default)* | 500.000 | 6.000.000 | 1,82 |
| Creditop X (37) | 1 *(default)* | 1.000.000 | 3.000.000 | 0,20 |

→ **Modelo: una fila de `lenders` por país.** No es una convención que se pueda elegir: es lo que el
esquema obliga, y es lo que de hecho ya pasa (SmartPay RD es el lender 153/160, no una variante del
mismo). La alternativa (`lender_countries` N:M) forzaría una dimensión de país en las 8+ tablas que
cuelgan de `lender_id` — `credit_line_by_lenders`, `lenders_by_allieds`, `lender_users_categories`,
`creditop_x_conditions_by_amount_by_lender`, tramos, reglas… Eso es un refactor de la plataforma, no
una internacionalización.

**Dos consecuencias:**
1. La regla que propone Miguel —*una sucursal solo habilita entidades de su país*— pasa a ser una
   **igualdad simple** entre dos columnas que ya existen, no un join contra una tabla N:M. Barata.
2. Y pasa a ser **necesaria**, no opcional: con una fila por país el catálogo crece (N países × M
   entidades) y sin esa validación el admin puede cablear la fila del país equivocado — que es
   justamente la fila con la moneda equivocada. Hoy en el dump ya hay **1 fila así**.
3. El corolario incómodo: cada canal que se gatea **por id de lender** paga un hardcode por país.
   `isSmartPay()` ya lo demuestra (`id === 160` en prod, 153 en dev). Con una fila por país, la
   capacidad tiene que ser **columna/flag** (`path_id`, `product`, un `capability`), nunca un id.

## Plan por bloques
Orden pensado para que ningún bloque posterior tenga que volver a decidir país.

**A · Fundamento**
1. `countries` como única fuente de verdad — **el arranque**; detalle y orden en «Por dónde arrancar» (los
   4 arreglos de datos + `otp_length` / `date_format` / `template_suffix` / `status` que discrimine).
1.bis `allied_branches.country_id` con invariante contra `country_city_id`, y quitarle a
   `allieds.country_id` el segundo trabajo (dejar de gobernar el flujo).
2. Un solo resolvedor de país por solicitud, con precedencia escrita (sucursal → comercio → teléfono →
   default) y **un** lugar donde vive el default.
3. Que el país llegue al front como **payload**, no como `if` en el loader: extender `partner-info` (ya trae
   `country_id`) con `country: { iso2, dial_code, phone_length, otp_length, document_types[], locale, currency }`.
4. **No abrir un tercer wizard: converger el fork de RD.** Con (3), el wizard clásico y las 5 pantallas
   `request-*` son el mismo flujo con otro catálogo y otra moneda. Se puede pantalla por pantalla, empezando
   por celular/OTP (lo que menos difiere).

**B · Celular**
5. Un `PhoneField` único configurado por país. Hoy "10 dígitos" y el prefijo están cableados en ≥6 sitios
   independientes (`imei/Entry.tsx:6-7,49,56`, `register-imei-action.server.ts:13-14` con el **mismo Set
   duplicado**, `phone-number-step-form.tsx:67`, `update-user-phone.schema.ts:9`).
6. Guardar **E.164** y dejar de inferir el país del formato del string: hoy `users.cell_phone` queda a veces
   nacional y a veces `+1809…`, y el backend usa `str_contains($cell_phone, '+')` como prueba de que es RD.
   Agregar `users.country_id` (o `dial_code`).
7. libphonenumber en los dos lados. El backend ya lo tiene (`PhoneService::resolveCountry` / `toNational`);
   el front no: `normalizePhoneE164` marca **cualquier** número de 10 dígitos como `+57` — y RD también tiene
   10 dígitos, así que todo usuario dominicano entra a la analítica como colombiano.
8. Enrutar mensajería por país, no con un booleano: `sendWhatsAppNotification` elige cuenta Twilio,
   `contentSid` y `messagingServiceSid` con `if($dialCode){}else{}` y **los SIDs literales en el método**.
   El sufijo de plantilla (`whatsapp_auth_otp_do` / `_co`) es el mecanismo correcto — hacerlo
   `strtolower($iso2)`. Unificar los 4 `$isDoLogic` copiados.

**C · Tipos de documento**
9. Catálogo + aplicabilidad + resolvedor, según la sección de arriba; y **matar** los tres catálogos que hoy
   compiten: el `z.enum` del clásico, las regex TS del wizard RD, y las `field_options` de la G2.
10. **Antes de agregar códigos, auditar quién les da semántica de negocio.** `document_type` hoy decide cosas
    que no son del país: `DatacreditoRuleEvaluator.php:21` (`CE` + lender 84 **cortocircuita el gate de
    datacrédito**; gemelo en `LenderUserCategoryService.php:356`), `DecevalSoap` mapea `CC=>1, CE=>2` en tres
    sitios, `WelliRegistrationData.php:49-50`, `TusDatosService.php:45,252`, PEP en `UsersService.php:1276`.
    Un `CED` cae al `else` **en silencio**. → `document_types.provider_codes` + hacer esos mapas fail-closed,
    y quitar el default `'CC'` de `UserService.php:170`, `VtexService.php:213`,
    `EcommerceRequestService.php:335`, `CorbetaCheckoutController.php:905`.
11. Validar en un lugar, derivado del catálogo: `PersonalInfoRequest.php:21` (`in:CC,CE,PEP` + closure con
    reglas colombianas: 5-10 dígitos, rango `10000..3000000000`) y su gemelo
    `OnboardingV2/.../StorePersonalInfoRequest.php:52`.

**D · Mensajes**
12. i18n en el wizard: **no existe** (`i18next` está solo en `apps/backoffice`). Medido: **139 de 355 `.tsx`**
    del subárbol de onboarding tienen literales con tildes/ñ (~438 ocurrencias, y es el piso). Alcance
    sugerido: solo `loan-application-form` + `dynamic-form` (justo lo que converge el punto 4), con `es-CO` /
    `es-DO` como primeros locales.
13. El backend también tiene copy y **no tiene infraestructura**: `config/app.php` declara `'locale' => 'es'`
    y **no hay directorio `lang/` en `main`**. Regla propuesta: **el back manda `code`, el front pinta el
    texto** — el contrato `ONB0xx`/`BDPH00x` ya existe y el wizard ya rutea por código; el `message` queda
    como debug. Lo que sí traduce el back es lo que **sale** de CreditOp (SMS/WhatsApp por plantilla con
    sufijo de país, mails, PDFs). Ojo con `ACTION_ERRORS` en `register-imei-action.server.ts:29-71`: 9
    mensajes en español duros **en el server del front**.
14. Moneda y fecha del país, no del componente. El patrón bueno ya está en `main`:
    `currency_format = [locale, currency]` derivado de `allied->country`
    (`LenderListingController.php:27-38`, `ContinueUserFlowController.php:45`,
    `PaymentScheduleController.php:94`). Extenderlo a toda respuesta con dinero y borrar los defaults
    hardcodeados (`es-DO`/`DOP` en consumer-hub, `es-CO` en `stat-cards.tsx:33`, `COP $` en
    `bancolombia/payment-success.tsx:75`). Detalle que se pasa de largo: `amountToBucket` tiene los cortes en
    500K-5M — **escala COP**; en DOP todo cae en el bucket más bajo.

**E · Que no se vuelva a romper**
15. Arreglar `->where('country_id', 1)` (`LenderRetrievalService.php:458`, `OnboardingService.php:1782`)
    **antes** de que una entidad nazca con su país correcto y **desaparezca del listado sin error**. Ya existe
    la versión parametrizada: `LenderRepository.php:18-22`. Dos líneas, bloqueador silencioso.
16. Guardrail en CI: fallar si aparece `=== 60`, `== 47`, `'+57'`, `es-CO`, `CC,CE,PEP` fuera de la capa de
    config. Es lo único que funcionó con la des-motaización.
17. Ejercitar el segundo país **corriendo**: eje `country` en el harness con un comercio RD. Aviso: la
    originación distintiva de SmartPay **es falsa fuera de producción** (`isSmartPay()` hardcodea lender 160;
    en dev el del canal es 153 — F-21), así que el canal donde nace la tarea no es probable sin sortear eso.

## Decisiones abiertas
- ~~¿Se arranca por enriquecer la geolocalización?~~ **RESUELTO (2026-08-05):** no. El árbol geo ya existe
  y es de 3 niveles (RD ya tiene sus 32 provincias); lo que falta son datos (ciudades de RD) con payoff
  diferido. Se arranca por **`countries` como fila de config** → tipos de documento →
  `allied_branches.country_id`. Detalle en «Por dónde arrancar».
- **¿Cuál país manda?** Sucursal, comercio, entidad o teléfono del cliente. Hoy los cuatro están cableados en
  puntos distintos del mismo flujo. El resolvedor (A2) no se escribe sin esta respuesta. Recomendación:
  la **sucursal** (donde se atiende), con el comercio como fallback.
- **¿`phone_code` sobrevive o se queda solo `dial_code`?** Son dos columnas para lo mismo y una está vacía.
  Elegir una antes de que el código nuevo lea la equivocada.
- **¿Se congela el país en `user_requests`?** Sin snapshot, corregir el país de una sucursal reescribe
  moneda/documentos/plantillas de solicitudes ya firmadas. Yo lo agregaría; es decisión de negocio.
- **¿`allied_branches.country_id` entra en esta tarea o es prerequisito aparte?** Sin él, "sucursales en otro
  país" no existe; con él, hay que revisar la copia de reglas por sucursal (37.284 copias) y `Rule::in([47,60])`.
- **¿Se converge el fork de RD (A4) o se acepta un wizard por país?** Convergir es más trabajo ahora y es lo
  único que hace que el país N+1 sea configuración.
- **¿i18n de verdad, o "un idioma, N países"?** CO y RD comparten español: si el próximo mercado también, D12
  se puede diferir y el 80% del dolor está en documentos, moneda y formatos.
- **¿`lenders_by_allied_branches.document_types` (json, en `feature/motai-v2`) se mergea y luego migra a la
  tabla nueva, o se reemplaza antes de mergear?** No hacer las dos.
- ¿RD corre **solo** SmartPay u otros canales? (pregunta ya abierta en el nodo `smartpay`).

## Trampas verificadas (arreglar antes de construir encima)
- **`countries.phone_code` está vacío en las 250 filas.** La migración `2026_02_20_100000_add_phone_code_…`
  siembra con `where('iso_code_2','CO')`/`'DO'`, pero **`iso_code_2` guarda el alpha-3** (`COL`, `DOM`): las
  dos UPDATE matchearon 0 filas. Las columnas están corridas — `iso_code_1`=alpha-2, `iso_code_2`=alpha-3,
  `iso_code_3` vacío. Importa doble: `PhoneService::resolveCountry` devuelve alpha-2, así que cualquier join
  contra `iso_code_2` falla. **Verificado en la BD local; falta confirmar en dev/prod.**
- **`Country::$fillable` declara `cell_phone_length` y la columna es `cell_phone_lenght`** (typo) → ese
  fillable no escribe nada. `dane_code` del fillable tampoco existe en la tabla.
- **`locale` en dos notaciones**: la tabla dice `es-CO` (estilo `Intl`) y el PDF de SmartPay usa `es_DO`
  (estilo PHP/Carbon, `DeviceLockAgreementService.php:164`). Elegir una y convertir en el borde.
- Solo **6 de 250** filas de `countries` tienen `locale`; `currency` igual. `dial_code` viene **sin `+`**
  (`57`, `1`) mientras el código compara contra `'+57'`.
- `Country::COLOMBIA_ID = 47` existe **solo en `application`**; `legacy-backend` no lo tiene.
- **`users.issue_country` está en 0 filas y SÍ se lee**: `$user->issue_country ?? 'COLOMBIANA'`
  (`OnboardingPayloadBuilder.php:129`) → todos los documentos generados afirman nacionalidad colombiana,
  incluidos los de RD. Arreglo barato y visible.
- **`users.country_id` es la cuarta columna de país y nadie la lee**: 215.844 filas en el default 1 contra
  12.183 en 47 y 1 en 60. Algo escribe 47 a veces: hay que encontrar qué antes de darle semántica.
- **Hay TRES filtros literales `->where('country_id', 1)`** sobre `lenders`, no dos:
  `LenderRetrievalService:458`, `OnboardingService:1782` y `Identity/LenderRepository:52`.
- **`countries.status` no discrimina**: las 253 filas están en 1. Hoy no hay forma de expresar "operamos
  en este país", que es justo lo que necesita la regla de habilitación por sucursal.
- **`address_format` está vacío en las 253 filas** y `country_zones.code` está sucio (419 numéricas de
  4.110; en CO `EXT`/`MED`/`TODOS`) → no derivar el país de la solicitud por ese camino.

## Tarea (publicable)
Hoy el onboarding asume un solo país en el código: el prefijo y la longitud del celular, los tipos de
documento válidos, los textos, la moneda y los formatos están escritos en el programa en vez de venir de
configuración. Por eso el segundo país se resolvió con una copia paralela de las pantallas de solicitud, y un
tercero costaría otra copia.

El objetivo es que el país sea **configuración**: una sola definición de país (prefijo telefónico, longitud
del celular, tipos de documento admitidos, idioma, moneda y formato de fecha) que el flujo consulte una vez
por solicitud, y una sola pantalla de solicitud que se adapte a esa configuración. Con eso, habilitar un país
nuevo pasa a ser cargar datos, no publicar una versión.

Incluye: definir dónde vive esa configuración y con qué precedencia cuando comercio, sucursal y entidad no
coinciden; unificar la captura y validación del celular; convertir los tipos de documento en catálogo
configurable por país y por sucursal; y separar los textos del programa para poder tenerlos por país.

Queda fuera de esta tarea el resto del recorrido posterior a la solicitud (firma, desembolso y cobranza), y
la traducción a un idioma distinto del español.

## Bitácora
- **2026-08-05** — Tarea abierta en evaluación. Barrido de contexto + verificación contra `main` de los dos
  repos y la BD local: las tres nociones de país, el fork de RD, los 28 archivos con `'+57'`, el predicado
  `isDoLogic` cuadruplicado, y el estado real de `countries`. Hallazgo que orienta el diseño:
  `lenders_by_allied_branches.document_types` ya existe y está poblada (6231/6231) **sin ningún lector en
  `main`** — el problema no es la forma de la tabla, es que nada la consume y los catálogos hardcodeados
  siguen vivos. Pendiente: cerrar las decisiones abiertas y recién ahí escribir `jira_title` + afinar la
  sección publicable.
- **2026-08-05 (2)** — Aterrizado el arranque. Censo de columnas de país: son **cuatro** y tres mienten
  (`lenders` 155/156 en el default, `users` 215.844 en el default sin lector, `issue_country` vacía pero
  leída). El defecto raíz es `DEFAULT 1`, que hace indistinguible "sin definir" de "definido mal".
  Descartado arrancar por geolocalización: el árbol ya es de 3 niveles y **RD ya tiene sus 32 provincias**
  — falta cargar sus ciudades (0), pero el wizard RD no consume `country_cities` (las toma de constantes /
  del forms-service), así que es un INSERT diferido y no un diseño. Orden acordado: `countries` como fila
  de config → tipos de documento → `allied_branches.country_id` (con invariante) → geo como ticket de datos.
  Sumado el hueco de snapshot en `user_requests`. En `flow` quedó el modelo visible: un select de país por
  nodo de config, con el estado real de cada columna.
</content>
</invoke>
