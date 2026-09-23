---
id: 43
title: "Internacionalización de CreditOp"
stage: tasks
created: "2026-08-05T17:11:17-05:00"
canon: [onboarding, formularios, altas, listado, smartpay]
jira: [CORE-365]
jira_title: "Internacionalización de CreditOp"
ramas: pais/el-pais-deja-de-suponerse, pais/el-usuario-temporal-no-nace-colombiano, pais/la-autoridad-emisora-sale-del-pais-y-el-tipo, documento/la-tarjeta-muestra-la-fecha-de-nacimiento, pais-como-dato, pais-configuracion, pais/el-pais-es-configuracion, pais/backfill-del-default-historico, pais/reparar-columnas-de-documentos, pais/documentos-que-acepta-el-backend, pais/borrar-documentos-de-sucursal, pais/monto-y-telefono-en-solicitar, pais/el-largo-del-celular-en-el-flujo-dinamico
---

# Internacionalización de CreditOp

## Las ramas de esta tarea

**Esta es la lista buena.** A propósito **omite las ramas anteriores** (`feature/pais-como-dato` en los
tres repos y `feature/pais-como-dato-onto-staging` del backend): existieron, algunas siguen abiertas
como PR, pero **no son el camino** y tenerlas a la vista es lo que causó el desorden. Si un PR viejo
estorba, se cierra; no se mergea.

| repo | rama de trabajo | va contra | estado |
|---|---|---|---|
| `legacy-backend` | `feature/pais-como-dato-onto-develop` | ⚪ **fuera de la vía** | ✅ **mergeada** (PR #1126, 18/8) y desplegada a dev |
| `legacy-application` | `feature/pais-como-dato-onto-develop` | ⚪ **fuera de la vía** | ✅ **mergeada** (PR #68, 19/8, la mergeó Miguel sin revisión: `develop` no tiene ruleset) |
| `frontend-monorepo` | `feature/pais-como-dato-onto-staging` | **`staging`** | ✅ **mergeada** (PR #834, 19/8 15:22, la apretó sanvipi-ctop) y desplegada a `loan-request-wizard-stg` |

**Segunda tanda — «el país es configuración» (2026-08-24).** El frente local se consolidó en
`playground.md`; acá queda el estado de las ramas para que esta tabla no mienta.

| repo | rama de trabajo | va contra | estado |
|---|---|---|---|
| `legacy-backend` | `feature/pais-desde-el-comercio` | ⚪ fuera de la vía | ✅ **mergeada** (PR #1191, 24/8) y desplegada a dev |
| `legacy-backend` | **`feature/pais-configuracion`** | **`qa`** | 🟡 **PR #1193 abierto**, un commit, esperando aprobación |
| `legacy-application` | **`feature/pais-configuracion`** | ⚪ **sin destino** | 🟡 **PR #80 abierto y SIN base válida** — hay que re-apuntarlo o rehacerlo sobre `main` |

⚠ **La vía de entrega hoy es `qa → main`, y después el resto de las ramas se pone al día DESDE `main`.**
Esto cierra la corrección de rumbo del 24/8, que ya decía que la rama de integración compartida **no era
el camino**: el historial muestra que **`main` se alimenta de ramas de feature directamente**, y que los
demás son **ambientes**, no etapas de un flujo. Por eso la segunda tanda va desde **`qa`**.

⚠ **Excepción: `legacy-application` NO TIENE rama `qa`.** Ahí la base hay que redefinirla: su PR abierto
(#80) quedó sin destino válido.

⚠ **Y `dev`, `qa` y `staging` son UNA SOLA base de datos** (mismo host, mismo schema): una migración se
corre una vez y sirve para las tres. Prod tiene la suya, y **sus ids de entidad NO coinciden** — 12 ids
son entidades distintas en cada base (el 152 es Refurbicredit en prod y smartpay en dev), así que
ninguna corrección de datos se copia de una a la otra.

**Ramas anteriores que quedaron sin camino** (no se mergean; si un PR viejo estorba, se cierra):
`feature/pais-desde-el-comercio-onto-qa` (reemplazada por la consolidada, PR #1192 cerrado) y el
PR #79 de `legacy-application` (cerrado, reemplazado por el #80).

**Por qué cada uno va a donde va:**
- **backend y admin**: lo mergeado en su momento sirvió para **probar en dev** —sus 3 migraciones ya
  están aplicadas ahí, y dev/qa/staging comparten BD—, pero **no es la vía de entrega**: eso es
  `qa → main`.
- **front → `staging`**: es donde se prueba. El deploy de dev del front **no corre desde el
  2026-07-03**, así que mergear ahí no pondría el cambio «en dev»: publicaría un build de hace mes y
  medio. Y no hace falta, porque el harness levanta el wizard **local** contra la API de dev, que ya
  publica `country`.

### Dónde se prueba esto (medido el 2026-08-19, después de mergear las tres)

**El wizard de staging NO habla con el backend de staging.** `loans-stg.yaml` construye
`loan-request-wizard-stg` con `VITE_API_URL=http://legacy-backend.inertia-develop` — o sea el servicio
de **dev**, exactamente el mismo que usa el wizard de dev. El servicio `legacy-backend-stg` (que sirve
la rama `staging`) **no es** lo que responde detrás del wizard desplegado en staging.

Eso resuelve el rompecabezas: **la pareja que sirve hoy es «front de `staging`» + «backend de
`develop`», y las dos mitades tienen el cambio.** Se puede probar de punta a punta ya.

⚠ Corolario incómodo: el port del backend a `staging` (#1121), que costó un día de trabajo, **no es lo
que sirve al wizard de staging**. Alimenta a `legacy-backend-stg`, un servicio aparte. No estuvo de más
—deja `staging` coherente consigo mismo— pero no era el camino crítico.

⚠ Y esto sale de los **build args** del workflow: un secreto de runtime (`dev/loan-request-wizard-stg`)
podría sobrescribirlo. Confirmarlo empíricamente en la primera corrida antes de sacar conclusiones de un
resultado raro.

**🔴 La trampa que va a morder: `E2E_TARGET=staging` del harness NO es staging.** Apunta a
`legacy-backend-qa` (rama **`qa`**) y a `originaciones-qa.dev.creditop.com` (el front de **`qa`**). El
commit de países **no está en `qa`** y encima **choca** ahí. Correr las pruebas con ese target mide la
rama equivocada y va a parecer que el cambio no funciona.

| qué probar | dónde | por qué |
|---|---|---|
| **wizard** (celular, prefijo, país) | wizard desplegado de `staging`, **o** wizard local `:5174` con `E2E_TARGET=dev` | el front de `staging` y el backend de `develop` tienen los dos el cambio |
| **admin** (selectores de ciudad) | **dev** (`main-dev.yaml`, desplegado `success` el 19/8) | `legacy-application` no tiene staging, y dev comparte BD con staging: las ciudades de RD ya están sembradas |
| ~~`qa`~~ | **no** | el commit no está ahí y choca al portarlo (Motai) |

📌 **Dato que falta:** la URL pública del servicio `loan-request-wizard-stg` no está escrita en ningún
lado del playground —lo único documentado es `originaciones-qa.dev.creditop.com`, que es **qa**—. Hay
que averiguarla y anotarla acá, o probar con el wizard local contra dev, que ya funciona.

### El desorden, dicho sin adornos (retrospectiva del 19/8)

Las tres ramas se cortaron **de `main`** y se apuntaron **a `main`**, que era lo cómodo pero no lo
correcto: `main` es producción y esta tarea todavía no está probada. De ahí salió todo lo demás.

1. **`legacy-backend`** no debió nacer contra `main`. En vez de eso salió contra
   `main` y después se portó **también a `staging`** (#1121) — un ambiente de más, con su propio port y
   su propia verificación. Trabajo duplicado por no haber elegido el destino al empezar.
2. **`frontend-monorepo`** también salió contra `main`. Debió nacer **en `staging`**. Hoy ya está bien
   parado ahí (#834) — pero llegó por un segundo port, no de entrada.
3. **`legacy-application`** tampoco. Salió contra `main` y, por afán, **se aprobó y
   mergeó ahí** el 19/8. Es el único de los tres que terminó en una rama de producción.

**La lección, para que sirva la próxima:** *el destino de la rama se elige ANTES del primer commit, y el
destino de una tarea sin probar nunca es `main`.* La convención `<rama>-onto-<ambiente>` que el repo ya
usa es el parche, no el plan — sirve para portar algo que ya existe, no para decidir a dónde va.

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

**Los OCHO filtros literales `->where('country_id', 1)` hoy funcionan por accidente** —leen el default,
no un país. `legacy-backend` (3): `LenderRetrievalService:458` · `OnboardingService:1782` ·
`Identity/LenderRepository:52`. **`application` (5)**: `Customer/ListLenderController:87` ·
`Customer/PersonalInfoController:1329` · `Customer/SimulatorController:44` ·
`Services/lenders/LenderRetrievalService:174` **y** `:459`.
Poblar bien `lenders.country_id` sin arreglarlos primero **vacía el listado en los dos frentes**. La
versión parametrizada ya existe y nadie la usa en ese camino (`Onboarding/LenderRepository:18-22`).

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

## Auditoría: dónde se usa el país, para qué, y qué está quemado
Barrido de los 4 repos contra `main` (2026-08-05). La conclusión que no esperaba: **buena parte del
código YA está parametrizado por país y está inerte porque el DATO está vacío.**

### 🔴 El hallazgo: la mensajería ya es multi-país y nadie lo sabe
**11 lectores** de `countries.phone_code`, en 6 archivos, todos con el mismo patrón:

```php
$phoneCode = $userRequest->allied?->country?->phone_code ?? '+57';
```

`NotificationService` (×5) · `VoucherService` (×2) · `ValidateOtpPromissoryNoteController` (×2) ·
`TwilioMessagingService` · `TwilioController`.

Y la columna está **vacía en las 253 filas** (su migración sembró por `iso_code_2`, que guarda el
alpha-3 → 0 filas tocadas). → **Los 11 caen siempre al `'+57'`**: el OTP del pagaré, las notificaciones,
el voucher y todo Twilio salen con prefijo colombiano **también para RD**.

→ **Corrección al plan: NO matar `phone_code` — poblarla.** Son **dos `UPDATE`** y es el arreglo más
barato y de mayor impacto de toda la tarea. La capa de mensajería no hay que internacionalizarla: hay
que encenderla.

### El mapa por propósito

| Para qué | Dónde | ¿Config o quemado? |
|---|---|---|
| **Decide el flujo** | `phone-number.tsx:70` `alliedCountry === 60` → wizard RD | lee config, **branch literal** |
| **Prefijo de mensajería** | 11 lectores de `country->phone_code` | **config ✓** — dato vacío → siempre `+57` |
| **Ruteo SMS/WhatsApp** | `$isDoLogic` **×4** (`NotificationService` ×3 + `TwilioController:187`) + `getRoutingData` (`'do':'co'`) | **quemado**, y con dos definiciones distintas de "es RD" |
| **Credenciales Twilio** | `sendWhatsAppNotification`: `if($dialCode){}else{}` + `contentSid`/`messagingServiceSid` literales en el método | **quemado** |
| **Moneda / formato** | `currency_format` desde `allied->country` (4 controllers) | **config ✓** |
| | `formatCurrencyWithSymbol(amount, locale="es-CO", currency="COP")` + `maximumFractionDigits: 0` | **quemado** — y el `0` borra los centavos del **DOP** |
| | 45 `Intl.NumberFormat` crudos + 13 `toLocaleString("es-CO"/"es-DO")` fuera del helper | **quemado** |
| | `'COP'` literal en `InitialFeePaymentService:312` (Wompi), `ValidateOtpController:135`, `SelfDevelopmentNotifier` ×2, `VtexService:53` | **quemado** |
| **Fecha / zona horaria** | `America/Bogota` **×7**: `ConsentService` ×2, `OnboardingPayloadBuilder:86` (fecha de firma), `LeaseAgreementService:102`, `DecevalSoap` ×2, `ReminderNotification:81` | **quemado** — en RD (UTC-4) un documento firmado 23:30 imprime el día anterior |
| | `->locale('es')` ×6 para formatear fechas | **quemado** |
| **Listado de entidades** | `->where('country_id', 1)` **×8** (3 legacy + **5 application**) | **quemado**; existe la versión parametrizada y no se usa |
| **Tasa y usura** | `PaymentCalculationService:201` (`!= 60`), `updateUsuryRate` (saltea 60) | **quemado**, pero reconocen el problema |
| **Gate de datacrédito** | `addNewRule:80` no crea reglas si el comercio no es CO | **config-ish ✓** en `application`; **el gemelo de legacy no tiene la compuerta** |
| **Documentos / KYC** | `issue_country ?? 'COLOMBIANA'`; genderapi `country=CO` ×2; Deceval `CC=>1/CE=>2` ×3 | **quemado** |
| **Geografía** | form-service lee `countries`/`country_zones`/`country_cities`, read-only, `status=1` | **config ✓** |
| | `COUNTRY_ID = 47` en `additional-info-form.tsx:34` | **quemado** |
| **Pagos** | Payvalida country `343` | **quemado** |
| **Alta / validación** | `Rule::in([47, 60])` en el alta de comercio; `Country::COLOMBIA_ID` solo existe en `application` | **quemado** |
| **Sin uso** | `users.country_id` (215.844 en el default, sin lector), `iso_code_3`, `address_format`, `image` | muerto |

### Cobertura: 13 repos, no 4

| Repo | Veredicto |
|---|---|
| `legacy-backend` | el grueso (ver tabla arriba) |
| `legacy-application` | 83 `country_id` en 56 archivos · `COLOMBIA_ID` ×4 — **contado, no auditado línea por línea** |
| `frontend-monorepo` | 7 `alliedCountry` · 64 `es-CO\|es-DO` · helper de moneda con default CO |
| `form-service` | ✅ read-only sobre el catálogo legacy, **sin hardcodes** |
| **`messaging-service`** | ✅ **country-first** — ver abajo |
| **`onboarding-forms-service`** | ⚠ **hardcodeado a RD** — ver abajo |
| `creditop_mobile` (Flutter) | `+57` en el router y el gateway de Cognito (`app_router.dart:165,189,192`, `cognito_auth_gateway_impl.dart`) |
| `dynamic-form` | ya tiene un **mapa país→prefijo** (`phone-analyzer.ts:4`: `CO:'57', MX:'52', US:'1', ES:'34', AR:'54', CL:'56'`) + `es-CO` como default ×5 en `logic.ts` |
| `pdf-mapper-editor` | `defaultValue: 'COLOMBIANA'` (`useEditorStore.ts:54`) — **el segundo sitio del mismo hardcode** |
| `pre-approvals-service` · `cognito-pre-sign-up` · `microservices` · `vtex` | agnósticos / cero |

### 🟢 `messaging-service` ya está construido country-first
El MS al que legacy le habla **no hay que internacionalizarlo: ya lo está.**
- `domain.Message` lleva `Country`; `provider_config.go` tiene `CountryISO2`.
- **Config de proveedor por país, en tabla**: `labsMobileConfigRepo.GetByCountry(countryISO2)` y
  `whatsAppConfigRepository.GetByTemplateAndCountry(templateName, countryISO2)`.
- El sufijo de plantilla **se deriva del ISO**, que es justo lo que propusimos:
  `fmt.Sprintf("whatsapp_auth_otp_%s", strings.ToLower(msg.Country))` (`send_message.go:65`).
- `normalizeNationalPhone(country, recipient)` normaliza según el país.
- Y **falla explícito** si falta la config: *"LabsMobile config disabled for country %s"* /
  *"WhatsApp config disabled for template %s country %s"*.

→ Dato nuevo: el proveedor SMS es **LabsMobile** (no solo Twilio), y su habilitación es **por país**.
→ Consecuencia: poblar `countries.phone_code` no alcanza — hay que **verificar que existan las filas de
config de `DO`** en el MS (LabsMobile + cada plantilla WhatsApp), o el envío falla con `ErrNotFound` en
vez de mandar mal. Se suma al paso 1.

### ⚠ `onboarding-forms-service` es el espejo invertido: hardcodeado a RD
El proveedor del wizard dinámico (el de las 5 pantallas RD) **asume República Dominicana**:
- `const countryISO3166Alpha3Prefix = "dom"` (`supplementary_document_repository.go:25`) — el prefijo de
  las rutas S3 de documentos, con un **TODO explícito** admitiéndolo, y el README lo repite.
- `getCountryFromPhone(phoneNumber)` deriva el país del teléfono, y `send_otp.go:166-168` usa
  `payload.country` con fallback al detectado.

→ O sea: **un servicio asume Colombia y el otro asume República Dominicana, y los dos alimentan el mismo
wizard.** Es la mejor foto del problema que encontró esta auditoría.

### `legacy-application` — el que más tiene (auditado línea por línea)
Es el monolito que corre en producción por defecto, y es el **menos** parametrizado de los dos backs.

- **⚠ 5 filtros literales `country_id = 1`** (arriba). Con los 3 de legacy son **ocho**.
- **`'+57'` pelado en 7 sitios** — y sin el `?->country?->phone_code ?? '+57'` que sí tiene legacy: acá
  es concatenación cruda al `PhoneNumber` de AWS SNS. `SmsController:21,45` · `OtpController:38` ·
  `ValidateIdentityController:654` · `ValidateOtpPromissoryNoteController:211` ·
  `CreditopXPaymentController:1608` · y **`app/Models/User.php:133`**, un accessor del modelo que
  devuelve `'+57' . $this->cell_phone`: el país está cosido al modelo de usuario.
- **⚠ La moneda entra en la FIRMA de Wompi**: `Actions/Lenders/Wompi.php:52` → `$rawSignature .= 'COP'`.
  No es cosmético — cambiar la moneda cambia el hash de integridad de la transacción.
- **`'COP'` en 9 sitios** de pagos e integraciones: `Wompi:52,116` · `WompiController:164` ·
  `Payvalida:37` (`'money'`) · `SistecreditoPay:40` · `UserRequestController:158,184` (`codigoMoneda`) ·
  `EcommerceController:208` · `VtexController:132` · `WoocommerceController:282` (los 3 últimos con
  fallback `?? 'COP'`).
- **`America/Bogota` ×3 más**: `ConsentController:66,146` (documentos de consentimiento) y
  `ReminderNotification:74`. **Total entre los dos repos: 10.**
- **`!= 60` en dos comandos de cron** (servicing): `CorrectNegativeInterestHistory:453` y
  `UpdateCreditopXRequestsCommand:64`.
- **`47` quemado en el front Vue**: `AlliedInfoCreate.vue:116` (`country_id: 47` como default del alta de
  comercio) y `AlliedRules.vue:1196` (`allied?.country_id === 47`, el gate de datacrédito **también** en
  el front). Y `AlliedController:86` mezcla las dos formas en una línea:
  `whereIn('id', [Country::COLOMBIA_ID, 60])`.
- **`Country::COLOMBIA_ID = 47`** existe solo acá (`app/Models/Country.php:16`), usado en 2 sitios.
- **Sí hay `lang/`** (a diferencia de legacy-backend), pero son **8 archivos del scaffolding de Laravel**
  (auth · pagination · passwords · validation) en `es` y `en`. No hay copy de la aplicación: la
  infraestructura existe y está vacía.

**🟢 Precedentes buenos que conviene copiar** (acá sí está bien hecho):
- El **menú del admin se filtra por país con una lista**, no con un `if`: `VerticalNavGroup.vue:24`,
  `VerticalNavLink.vue:16`, `VerticalNavSectionTitle.vue:16` → `countries.includes(auth?.allied_country_id)`.
- `CreditopXFormController:19` arma el select de departamentos con
  `CountryZone::where('country_id', $userRequest->allied->country_id)` — el país del comercio, no un literal.

**⚠ Documentos: 10 plantillas PDF nombradas por id de lender**, con el país cosido en el texto legal.
Y una que hay que **verificar con negocio**: `consent_152.blade.php` — el lender **152 se llama
"smartpay"** y en el dump está cableado a la sucursal del comercio RD, pero su consentimiento es un
contrato **100% colombiano**: acreedor *REFURBI COLOMBIA S.A.S.* con NIT, *cédula de ciudadanía*, mora
según la *Superintendencia Financiera de Colombia* y *Ley 1581 de 2012*. O el cableado del dump es
ruido, o hay un documento del país equivocado. En cualquiera de los dos casos el **mecanismo** —una
plantilla por id con el país en el texto— es el problema estructural.

### Volumen
`legacy-backend` 71 `country_id` (casi todos `$fillable`/modelos) · `application` 83 en 56 archivos ·
`frontend-monorepo` 7 `alliedCountry` en 3 archivos, 64 `es-CO|es-DO` en ~20 · `form-service` solo lee ·
**`pre-approvals-service` es agnóstico** (7 menciones, todas pass-through de `issue_country`).

**Lectura:** el problema no está repartido parejo. Se concentra en **mensajería** (que ya está resuelta y
apagada), **formato de dinero** (helper con default CO) y **fecha/zona horaria** (7 hardcodes en
documentos legales). El resto son literales sueltos.

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

### ¿Credifamilia creó tablas nuevas? NO — el form-service lee LAS MISMAS
Verificado en `github/form-service` (rama `main`, 2026-08-05). Sus queries no tienen tabla propia ni
migraciones: leen el catálogo legacy tal cual, y sus entidades viven bajo
`internal/core/entities/legacy_forms`.

| Query (`internal/infra/storage/mysql/queries/`) | Tabla | Qué hace |
|---|---|---|
| `GetCountryByID` · `GetCountryByISOCode1` · `ListAllCountries` | `countries` | **SELECT** de la fila completa: `dial_code, iso_code_1/2/3, address_format, cell_phone_lenght, phone_code, locale, currency, status` |
| `ListCountryZonesByCountryID` | `country_zones` | SELECT `WHERE country_id = ? AND status = 1` |
| `ListCountryCitiesByZoneIDs` | `country_cities` | SELECT `WHERE country_zone_id IN (…) AND status = 1` |

**Es read-only:** en todo el set de queries los únicos INSERT/DELETE son sobre `user_field_values`. No
hay DDL. → **No existe un segundo catálogo de países/ciudades, y no hay que crear uno.** `countries` ya
tiene **dos consumidores vivos en repos distintos** (el `currency_format` de legacy y el form-service);
una tabla paralela sería una tercera opinión del mismo hecho — justo la enfermedad que esta tarea cura.

**Consecuencia para el plan: los cambios a `countries` son ADITIVOS, no un refactor libre.** Tocar esas
columnas rompe un microservicio en otro repo, con deploy propio:
- **Renombrar `cell_phone_lenght`** (el typo) rompe `country_queries.sql` — el typo está horneado en el
  SELECT. Exige PR coordinado en los dos repos o lectura dual transitoria.
- **Renombrar las columnas ISO corridas** rompe `GetCountryByISOCode1`, que busca por `iso_code_1` — o
  sea que el form-service **ya depende** de que ahí viva el alpha-2. Mejor: **dejarlas quietas**,
  documentar el corrimiento y agregar una columna nueva bien nombrada si hace falta.
- **`status`** es gate vivo (ver arriba): no se reutiliza.
- **Poblar lo vacío es seguro y es la parte que rinde**: `phone_code`, `address_format`, `locale` y
  `currency` ya se están SELECTeando y hoy llegan nulos. Llenarlos no rompe nada y le da datos a un
  consumidor que ya los pide.

**Orden propuesto para el catálogo:**

1. **`countries` como fila de configuración** — el arranque real, y es **más chico de lo que parece**.

   **Inventario exacto (BD local, 253 filas):**

   | Columna | Llenas | Qué es | Veredicto |
   |---|---|---|---|
   | `name` | 253 | nombre | sirve |
   | `iso_code_1` | 253 | **alpha-2** (`CO`, `DO`) — la clave real | sirve; es la que usa `GetCountryByISOCode1` del form-service |
   | `status` | 253 en 1 | activo | **gate vivo** del form-service (countries/zones/cities) — no reutilizar |
   | `dial_code` | **2** | prefijo sin `+` (`57`, `1`) | solo CO y DO — que son justo los que operamos |
   | `cell_phone_lenght` *(sic)* | **2** | 10 y 10 | typo; el `$fillable` usa el nombre correcto y no escribe |
   | `locale` · `currency` | **6** | AR·CO·DO·MX·PE·PR | **dos notaciones dentro de la misma tabla**: `es-CO`/`es-DO` con guion, `es_AR`/`es_MX`/`es_PE`/`es_PR` con guion bajo |
   | `iso_code_2` | 253 | dice alpha-2 y **guarda alpha-3** (`COL`, `DOM`) | engaña; rompió la migración de `phone_code` |
   | `iso_code_3` · `address_format` · `image` · `phone_code` | **0** | — | muertas |

   **La buena noticia: para CO y RD la fila YA está completa en lo que sirve** (`dial_code`,
   `cell_phone_lenght`, `locale`, `currency`, `iso_code_1`). No hay que poblar casi nada.

   **Agregar — solo dos** (lo demás se deriva o no va acá):
   - **`is_operating`** (bool). No se puede derivar y `status` no se puede reutilizar: es gate vivo del
     form-service, apagar un país lo borraría del formulario dinámico.
   - **`otp_length`** (tinyint). Hoy son constantes (`OTP_LENGTH_SHORT=4` / `LONG=6`) más un
     `otpLength: 4` quemado en el wizard.

   **Arreglar, no agregar:**
   - **Poblar `phone_code`, NO matarla** — tiene **11 lectores vivos** que hoy caen al `'+57'` por defecto
     (ver la auditoría). Son dos `UPDATE`. Decidir si el valor lleva `+` (los lectores lo concatenan crudo).
   - **Unificar la notación de `locale`** — hoy la propia tabla se contradice.
   - **`iso_code_2`**: NO renombrar (el form-service depende de `iso_code_1`); documentar el corrimiento.
   - `cell_phone_lenght`: el typo está horneado en el SQL del form-service → renombrar solo con PR
     coordinado en los dos repos.

   **Lo que NO va en `countries`:**
   - **tipos de documento** → catálogo + aplicabilidad (pierde los niveles sucursal/entidad si va acá).
   - **burós/proveedores por país** → relación N:M propia, es el bloque A.bis.
   - **sufijo de plantilla** → se **deriva** de `lower(iso_code_1)`; no hace falta columna.
   - **formato de fecha / decimales** → los da `Intl` desde `locale` + `currency`.
   - **`timezone`** → real (CO es UTC-5, RD UTC-4, y hay 6 crons diarios con fecha de corte), pero es de
     **servicing**: anotado, fuera del alcance de onboarding.
2. **Tipos de documento** — catálogo + aplicabilidad (ver la sección de las tres capas). **No** es parte
   de geo y **no** es una columna JSON de `countries`: meterla ahí pierde los niveles sucursal/entidad
   que ya existen en `lenders_by_allied_branches.document_types`.
3. **`allied_branches.country_id`** — la única pieza *geo* que sí es de arranque, porque desbloquea todo
   lo demás. Va con **invariante**: la ciudad debe pertenecer a una zona de ese país, validado en el
   único camino de escritura. Sin eso no es una columna nueva, es una quinta opinión (la deriva ya
   existe: la sucursal del comercio RD apunta a una ciudad colombiana).
4. **Geo (datos)** — ⚠ **ya NO es diferido: es prerequisito del invariante ciudad↔país.** En prod las
   **13 sucursales de comercios RD apuntan a ciudades colombianas** porque RD tiene **0 ciudades**.
   Cargar las ciudades de RD, `address_format`, y limpiar `country_zones.code`.

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

**A.bis · La consecuencia más grande del país de la sucursal: los BURÓS**
Verificado (2026-08-05): **hoy ninguna selección de buró mira el país. Cero.** El buró se elige por reglas
de entidad/sucursal (`lender_datacredito_rules` copiadas por sucursal, los dos motores de datacrédito) y
por cascada de proveedores para el ingreso. Todos los proveedores son **colombianos**: Experian/Datacrédito,
TusDatos, Ágil Data, Mareigua, Quanto. `CreditBureauAggregatorService` sí toca `country_cities`, pero solo
como filtro de ciudad para listar sucursales — no para elegir proveedor. Y hay un `'country' => 'CO'`
**quemado** en la llamada a genderapi (`PersonalInfoProcessingService.php:243`, con un gemelo en
`DynamicFormsService`).

→ Una solicitud de una sucursal RD hoy llamaría a burós colombianos con una cédula dominicana. RD lo
esquiva de rebote porque `isSmartPay` **saltea el AML** y el path IMEI usa credenciales por-lender: otra
vez un hardcode haciendo de regla de país. **Los proveedores por país son una dimensión que no existe** y
hay que sumarla al catálogo (qué buró/proveedor aplica en cada país), no solo prefijo y moneda.

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

## ✅ CONTRASTE CONTRA PRODUCCIÓN (2026-08-05, vía `make trazador-sql`)
Todo lo anterior se auditó contra el dump local. Se corrió el mismo censo contra **prod** y hay
diferencias que cambian el plan. **Aviso que vale para todo el resto: los ids NO coinciden entre
ambientes** — en local el 152 se llama «smartpay» y en prod es «Refurbicredit». Cualquier conclusión
sobre un lender puntual sacada del dump local **no vale**.

| Pregunta | Local (dev) | **PROD** | Efecto |
|---|---|---|---|
| `countries.phone_code` | NULL ×253 | **NULL** | ✅ **P3 confirmado**: los 11 lectores caen al `'+57'` en producción |
| `cell_phone_lenght` DO | 10 | **11** | ⚠ **corrige lo que dije**: no son «los dos 10 dígitos» |
| `locale` / `currency` 47·60 | es-CO/COP · es-DO/DOP | **idem** | ✅ la fila de los dos países operativos está completa |
| Lenders cableados en **2 países** | 0 | **1** | ⚠ **hay conflicto en prod** — y es SmartPay |
| Lender **160** | no existe | **SmartPay · country_id 60 · rt=2 · 12 cableados en países 47 y 60** | ✅ resuelve 2 preguntas abiertas |
| Lenders 152 / 153 | «smartpay» / «SmartPay» | **«Refurbicredit» / «Crediemo»**, country_id 1, ambos CO | ✅ disuelve la alerta del consentimiento |
| Comercios · sucursales RD | 2 · 1 | **9 · 13** (vs 308 · 2209 en CO) — **2 son de prueba** | huella real pero chica |
| `users` por país | 215.844 en 1 · 12.183 en 47 | **363.240 en 1 · 12.189 en 47 · CERO en 60** | ⚠ ningún usuario RD tiene país |
| `users.issue_country` | 0 | **0 de 375.429** | ✅ bug confirmado en prod |

### Lo que cambia

**1. ✅ El conflicto de SmartPay (160) es CABLEADO MUERTO — no hay que partir la fila.** Investigado
contra prod:

| | |
|---|---|
| economía (`credit_line_by_lenders`) | `min 2.500 · max 95.000 · rate 1,9 · cuotas 6,8,10,12` → **escala DOP** |
| `path_id` | **2 = IMEI** → `isImeiPath()` true, y con id 160 `isSmartPay()` dispara |
| solicitudes | **206, TODAS en país 60**, del 2026-03-03 al 2026-08-05 (vivo hoy) |
| solicitudes por comercios CO | **CERO** |

Los 12 cableados incluyen comercios colombianos que **nunca se usaron**. Como la economía está en DOP
—95.000 COP no compra un celular— esos cableados no podían ser legítimos. → **No se parte la fila**: se
limpian los cableados CO. Y el 160 **ya tiene `country_id = 60` bien puesto**, así que ni siquiera entra
en los 129 UPDATE del backfill. **F2 vuelve a ser mecánico.**

**1.bis ⚠ Hilo abierto que sale de ahí, y toca a F1/F3.** El 160 tiene `country_id = 60`, así que el
filtro literal `->where('country_id', 1)` **lo excluye del listado**. Pero tiene 206 solicitudes: o
SmartPay no se ofrece por `getLenders` (entra por su propio canal IMEI, lo cual es coherente con el
nodo) o hay otro camino. **Confirmarlo ANTES de tocar los ocho filtros**, para no cambiarle el
comportamiento al único flujo RD vivo sin darnos cuenta.

**1.ter ✅ El documento del 160 no es problema.** No tiene `consent_160.blade`, pero tampoco lo
necesita: por el path IMEI firma el **acuerdo de bloqueo**, y `DeviceLockAgreementService` saca locale y
moneda de `$userRequest->allied?->country` — **el país del COMERCIO**. O sea que se adapta solo: RD →
`es-DO`/`DOP`, CO → `es-CO`/`COP`. Es la pieza mejor hecha de todo lo auditado.

**2. ✅ Se resuelven dos preguntas abiertas del nodo `smartpay`.** El lender **160 de prod es `rt=2`**
(el nodo lo daba por dudoso: su seeder lo crea `rt=1`) y su `country_id` **está bien puesto en 60** — no
es basura como los otros 155. Cuando se toque el nodo, esto gradúa.

**3. ✅ Muere la alerta del consentimiento colombiano.** En prod el lender 152 es **Refurbicredit** — y
el consentimiento nombra a *REFURBI COLOMBIA S.A.S.*, o sea que **está bien**. La alerta salía de que en
el dump local el 152 se llama «smartpay». Era ruido de ambiente, no un documento del país equivocado.
Queda una pregunta nueva y más chica: **qué documento usa el 160**, que no tiene blade propio.

**4. ⚠ `cell_phone_lenght` de RD es 11 en prod, no 10.** Probablemente signifique «1 + los 10
nacionales». Es ambiguo y hay que decidirlo **antes** de que el `PhoneField` (Fr3) lo lea, o RD va a
exigir 11 dígitos en un campo donde el usuario escribe 10.

**5. ⚠ Cero usuarios en país 60**, con 9 comercios y 13 sucursales RD activos. O los usuarios de RD caen
en el default 1 (lo más probable), o RD casi no origina. Se cruza con el otro dato: el `country_id = 47`
**dejó de escribirse el 2026-07-06** (el default 1 sigue creciendo hasta hoy). Algo que poblaba el país
del usuario se apagó hace un mes. Vale una pasada, no bloquea.

## 🔀 MODELO ACORDADO (2026-08-05, decisión de equipo): una BD por país

**Cada país es una base de datos**, con sus propias tablas de `allieds` y `lenders`. La jerarquía:

```
countries (1 fila = este país)  ──1:N──▶  allieds  ──1:N──▶  allied_branches
   │  country_zones / country_cities                              │
   │  tipos de documento · moneda · locale · bandera               │
   └──────────── se HEREDA hacia abajo ────────────────────────────┘
                                     allieds ──N:M──▶ lenders  (lenders_by_allieds)
                                     branch  ──N:M──▶ lenders  (lenders_by_allied_branches)
                                              ↑ acá la sucursal ACTIVA/DESACTIVA entidad y tipos de doc
```

- **Un comercio vive en UN país.** Totto en varios países = `Totto CO`, `Totto MX`, `Totto AR`, cada uno
  en su base, cada uno con sus sucursales y su config.
- **Un lender vive en UN país** — hay que recrearlo por país. No es una decisión nueva: el esquema ya lo
  obliga (la economía cuelga de `lender_id` **sin dimensión de país** y está denominada en moneda) y prod
  ya lo hace (SmartPay 160: economía en DOP, **206 solicitudes, todas de país 60**).
- **La sucursal hereda del comercio, y el comercio del país**: tipos de documento, moneda, locale,
  bandera. La sucursal es el último nivel y puede **activar/desactivar** entidades y tipos de documento.

### ✅ La tabla `countries` se queda, aunque tenga UNA fila
La duda era razonable: dentro de DB-CO tendría una sola fila. Se queda igual, por cuatro razones:
1. **No es "una tabla de una fila": es el registro de configuración del tenant.** La alternativa es que
   locale/moneda/prefijo vivan en `config`/`.env` — que es exactamente cómo se llegó a `'+57'` en 28
   archivos y a `America/Bogota` en 10.
2. **Las subtablas necesitan padre**: `country_zones.country_id` apunta a esa fila.
3. **`allieds.country_id` necesita a quién apuntar** (es la relación directa del modelo).
4. **El form-service ya la consulta** por id y por ISO (`GetCountryByID`, `GetCountryByISOCode1`);
   matarla rompe otro repo con deploy propio.

Y la razón de fondo: con la config del país **en la BD**, `legacy-backend` es **un artefacto desplegado
N veces** con distinta conexión. Si vive en el `.env`, la pregunta "de qué país soy" se muda al deploy —
invisible para SQL y para el admin, y con N configs divergiendo.

### ⛔ `allied_branches.country_id` NO se agrega (corrige M2)
Es derivable: `allied_branches.allied_id → allieds.country_id`. Mi argumento anterior ("el shard key
tiene que estar en cada fila que se mueve") **no aplica**: el join para extraer las filas de un país se
hace **una vez, dentro de la misma base, antes de partir**, y después del split la columna es una
**constante** — la misma enfermedad que este documento persigue (`country_id = 1` en 155 filas + ocho
`where('country_id', 1)`). Ninguno de los casos que la justificarían aplica: la sucursal no puede ser de
otro país (decidido), no se shardea por sucursal, y el runtime ya trae el comercio cargado con la
sucursal (cache de 30 s en `RegisterCellPhoneController` + sesión).

**Lo mismo vale para el resto**: ninguna tabla necesita columna propia de país, porque toda cadena de
padres queda **dentro del mismo shard**.

⚠ **Excepción, y por OTRA razón**: el snapshot de `user_requests` (`country_id`/`locale`/`currency`)
sigue en pie. No es shard key — es **hecho histórico**: el país de la sucursal *hoy* puede no ser el que
valía cuando esa solicitud se firmó, y ahí lo que se congela es la moneda y los documentos de un
contrato.

### De dónde lee el flujo "de qué país soy"
Dos opciones: (a) del comercio (`allieds.country_id → countries`) o (b) de la única fila de `countries`
de esta base. **Se elige (a)**, porque funciona en los dos mundos: hoy (una base con los dos países) y
después del split. El resolvedor se escribe una vez. Ojo con el sesgo de diseñar solo para el estado
final: la convivencia en una sola base va a durar mucho, y puede durar para siempre.

### Herencia de tipos de documento: el nivel que falta es el de ARRIBA
La cadena que pide el modelo —país → comercio → sucursal— encaja con el diseño de catálogo +
aplicabilidad + resolvedor. Dos precisiones:
- **El último eslabón ya existe**: `lenders_by_allied_branches.document_types` (json, en
  `feature/motai-v2`) es «la sucursal activa/desactiva tipos de documento», con unión + piso
  `["CC","CE"]`. Lo que falta es el nivel **país** por encima.
- ⚠ **Pero ese eslabón es por sucursal-ENTIDAD, no por sucursal.** Y está bien que lo sea: hay entidades
  con reglas propias de documento (Magnocell + `CE`, lender 84). Así que los ámbitos de aplicabilidad son
  **país · comercio · sucursal · entidad**, no tres.

### La N:M comercio↔entidad que pide el modelo YA EXISTE
`lenders_by_allieds` (nivel comercio) + `lenders_by_allied_branches` (nivel sucursal, donde se activa y
desactiva). Esa parte no hay que diseñarla: hay que **usarla** y sumarle el nivel país.

### ⚠ El costo que trae "un lender por país"
Recrear un lender por país duplica **todo su árbol de config** (`credit_line_by_lenders`,
`lender_users_categories` + reglas, tramos, `creditop_x_lender_configuration`). Con 5 países son 5 copias
que derivan. No bloquea nada hoy, pero conviene esperarlo: la salida es una **plantilla de entidad** de
la que cada país instancie.

### Pendientes de datos que el modelo destapa
- **Las 13 sucursales de comercios RD apuntan a ciudades colombianas** — porque RD tiene **0 ciudades**.
  El invariante ciudad↔país es correcto pero **no se puede encender** hasta cargarlas: **la geo de RD
  deja de ser diferida y pasa a ser prerequisito**.
- **3 sucursales sin comercio** (`allied_id` no resuelve) de 2.212: sin país, no se pueden asignar a
  ninguna base. Adoptarlas o borrarlas antes de partir.
- **`countries.image`** (la bandera del modelo) existe y está **vacía en las 253 filas**.
- El **hash de sucursal** tiene **4 colisiones en prod** y es `crc32` de un timestamp al segundo. Bajo BD
  por país sería la llave de **ruteo**. Va como finding aparte (F-103).

## 🎯 PRIMER ENTREGABLE: «el paso DO» — que República Dominicana quede bien parada
Alcance chico, cerrado y verificable: **solo datos + un invariante**. Ningún repo externo, ningún deploy
riesgoso. Al terminar, RD es un país de primera clase y el modelo acordado se puede encender.

### El hallazgo que lo justifica: «SANTO DOMINGO», la de Antioquia
Las **13 sucursales** de los comercios RD apuntan todas a una ciudad colombiana llamada
**SANTO DOMINGO** — que existe (municipio de Antioquia). Alguien escribió «Santo Domingo» en el
selector, salió una opción plausible, y **el dato equivocado es invisible a ojo**. Sus direcciones reales
son inequívocamente dominicanas:

| Comercio | Dirección | Provincia RD real |
|---|---|---|
| Carrefour · MAGGYSA · Multiservicios La Fe | `Autopista Duarte km 9/10/22`, `La Cuaba, Pedro Brand` | Santo Domingo (Oeste) |
| MAGGYSA | `Calle 4 Sur #11 Ensanche Luperón` | Distrito Nacional |
| MAGGYSA | `Av. San Vicente de Paúl 321, Santo Domingo Este` | Santo Domingo (Este) |
| Hot Tec · 2blea · Gold Clave · La Gracia | `Juan Sánchez Ramírez`, `Plaza Bienaventuranza`, `Plaza Europiel Herrera` | Distrito Nacional / Santo Domingo |

→ Todas están en el área metropolitana de Santo Domingo. **El re-apuntado es mecánico.**

### Las columnas de `countries`: qué se decide (spec cerrada)

| Columna | Hoy en prod | Decisión | Acción |
|---|---|---|---|
| `phone_code` | **NULL** en 253, con **11 lectores** que caen a `'+57'` | **es la columna canónica del prefijo, y lleva el `+`** (los lectores concatenan crudo) | `UPDATE` → `+57` / `+1` |
| `dial_code` | `57` · `1` (sin `+`), solo esas 2 filas | **se queda** (el form-service la `SELECT`ea) pero **no es la que el código lee** | documentar la diferencia |
| `cell_phone_lenght` *(sic)* | CO **10** · DO **11** | ⚠ **hoy es inconsistente.** Se define como **dígitos NACIONALES, sin prefijo** → DO debe ser **10** (809/829/849 + 7). «Con prefijo» se calcula: `LEN(dial_code) + esto` | `UPDATE` DO 11→10 |
| `locale` | `es-CO` · `es-DO` ✓ | correcta; las otras 4 filas usan `_` | `UPDATE` de notación |
| `currency` | `COP` · `DOP` ✓ | ya está | — |
| `iso_code_1` | alpha-2 (`CO`/`DO`) | **es la clave real** — `GetCountryByISOCode1` del form-service la usa | no tocar |
| `iso_code_2` | guarda **alpha-3** (`COL`/`DOM`) | mal nombrada; **NO renombrar** (rompe el MS) | documentar |
| `image` (la bandera del modelo) | **vacía** en 253 | del modelo, baja prioridad | opcional |
| `iso_code_3` · `address_format` | **vacías** en 253 | sin consumidor | dejar quietas |
| `status` | 253 en `1` | **gate vivo** del form-service (countries + zones + cities) | **no reutilizar** |
| **`is_operating`** | no existe | **AGREGAR** — es lo que dice «operamos acá», y es lo que después habilita la regla de entidades por país | `ALTER` + `UPDATE` 47/60 |
| **`timezone`** | no existe | **AGREGAR** — hay **10** `America/Bogota` quemados, incluida la **fecha de firma de documentos**. DO es `America/Santo_Domingo` (UTC-4): un contrato firmado 23:30 imprime el día anterior | `ALTER` + poblar; el arreglo de los 10 sitios va después |
| ~~`otp_length`~~ | — | **descartada**: el largo es 4 o 6 según el **momento** (pagaré = 6), no según el país. Sin consumidor = próxima `iso_code_3` | no se agrega |

### Tipos de documento a nivel país

⚠ **Corrección verificada:** `lenders_by_allied_branches.document_types` **NO existe en producción** —
vive solo en `feature/motai-v2`. Así que el nivel sucursal está **sin construir en prod**, y eso
simplifica: no hay forma heredada con la que ser compatible, y el JSON de motai-v2 conviene
**reemplazarlo antes de mergear** en vez de mergear y migrar.

**Forma:** el catálogo lleva el país, porque **un tipo de documento se define por el país que lo acepta**
— `CED` es dominicano, `CC` colombiano, `PEP` lo emite Colombia para migrantes. No es un catálogo global
con aplicabilidad por país: son catálogos distintos.

```
document_types (id, country_id, code, name, description, regex, min_length, max_length, sort, status)
   UNIQUE (country_id, code)   -- `PAS` puede existir en los dos países con reglas distintas
```

⚠ **Sin `provider_codes`** (decisión de Miguel, correcta): el catálogo describe **qué es** un tipo de
documento; cómo lo llama Deceval es **mapeo de integración** y sobrecargaría la tabla con lógica de
negocio. Va en tabla propia (ver abajo). Y **`users.document_type` sigue guardando el código como
string** — no se convierte en FK ahora: 375.429 filas y todos sus consumidores.

**Y el contenido ya existe: está hardcodeado.** Poblarlo es transcribir las reglas que hoy viven en
código, no inventar reglas nuevas:

| País | Código | Regla de hoy | De dónde sale |
|---|---|---|---|
| CO | `CC` | solo dígitos, 5-10, rango `10000..3000000000` | closure de `PersonalInfoRequest` |
| CO | `CE` · `PEP` | `[A-Za-z0-9]{3,20}` | misma closure |
| DO | `CED` | **exactamente 11 dígitos** | `dynamic-step-one.ts` |
| DO | `CI_VE` | 6-11 dígitos | idem |
| DO | `PAS` · `PAS_VE` | `[A-Z0-9]{6,9}` | idem |

**Los niveles de abajo solo RESTRINGEN.** Comercio / sucursal / entidad eligen un subconjunto de los
tipos de su país — nunca agregan uno que el país no tenga. La resolución es la que ya eligió motai-v2
(unión de lo que habilitan las entidades de la sucursal, con piso), **intersectada con el catálogo del
país**. Sin esa intersección, una sucursal mixta ofrecería `CED` a un colombiano.

**Ámbitos: cuatro, no tres** — país · comercio · sucursal · **entidad**. El último hace falta porque hay
entidades con regla propia de documento (Magnocell acepta `CE` donde el gate general no).

### Qué MÁS estamos hardcodeando hoy que merece tabla (verificado)

**Sí vale tabla nueva:**

| Qué | Cómo está hoy | Forma |
|---|---|---|
| **Tipos de documento** | tres catálogos hardcodeados (zod enum · closure PHP · constantes TS) | `document_types` (arriba) |
| **Códigos por integración** | `DecevalSoap` mapea `CC=>1, CE=>2` en **3 sitios** y `WelliRegistrationData` otro; un código desconocido cae al `else` **en silencio** | `(integration_key\|lender_id, document_code, external_code)` — lo que sacamos del catálogo |
| **Burós/proveedores por país** | ⚠ **ninguna selección de buró mira el país.** Todos son colombianos (Experian/Datacrédito · TusDatos · Ágil Data · Mareigua · Quanto) → una solicitud RD llamaría a Datacrédito con una cédula dominicana | `risk_centrals` **ya existe** como tabla; falta la **N:M con `countries`** |
| **Reglas regulatorias del país** | ver abajo, los dos verificados | `country_regulatory_rates(country_id, effective_from, usury_rate, tax_rate)` — con **historia**, porque la usura cambia mensualmente y está certificada |

**Los dos regulatorios, verificados en código:**
- **Impuesto.** `PromissoryNoteController:378` calcula el fondo de garantías con `* (1 + (19 / 100))` y el
  comentario *«se pone fijo el iva para todos en 19%»* — con la línea que usaba `$lender->iva`
  **comentada justo arriba**. En RD el ITBIS es **18%**. Es un impuesto: pertenece al país, no al lender.
- **Tasa de usura.** **No se guarda en ninguna parte.** Sale de un form (`$request->usury_rate`) y hace
  un **UPDATE masivo destructivo** de `credit_line_by_lenders.rate` para todo lender que la supere,
  salteando el 140 y el país 60. No queda registro de cuál era el techo en cada momento, y se **pierde**
  la tasa configurada del lender.

**NO hagas tabla — ya tienen hogar:**

| Qué | Dónde va |
|---|---|
| Plantillas y SIDs de WhatsApp/SMS | **`messaging-service` ya los tiene** en tabla por `CountryISO2` (`WhatsAppConfig`, `LabsMobileConfig`). El hardcode de legacy muere **delegando**, no creando tabla |
| Capacidades por lender (los arrays `[218,219,221,222]`, `MANUAL_BIRTH_*`, Welli `[23,141,142,166]`…) | son **columnas/flags**, y `lender_requirements` ya arrancó ese patrón (`abaco_is_enabled`, `dynamic_form_is_enabled`) |
| Plantillas de documento por id (`consent_{id}.blade`) | una **columna** `consent_template`, no una tabla |
| IVA por comercio | la columna **`lenders_by_allieds.iva` ya existe y está poblada** — solo está desconectada. Pero resuelve el caso equivocado: el IVA es impuesto, va al país |

**Anotado, no ahora:** feriados por país (afecta fecha de corte y mora) — es de servicing.

### Los cuatro pasos
1. **Cargar las ciudades de RD.** ✅ Las **32 provincias ya están** (`country_zones` ids 934-965, códigos
   de 2 letras, todas `status=1`) — solo falta `country_cities`, que está en **0**. Se cuelgan de las
   zonas existentes; no hay trabajo de zonas.
   - ⚠ **Decidir qué va en `country_cities.code`.** Para Colombia es el código DANE de 5 dígitos y el
     nodo `bancolombia` documenta que *derivar el departamento del código de ciudad es lo correcto*. Para
     RD no hay consumidor todavía: usar el código de la ONE (o `provincia+secuencia`) y **documentarlo**,
     porque el día que exista un consumidor va a asumir el formato colombiano.
   - Alcance mínimo viable: **Distrito Nacional + provincia Santo Domingo**. Completar el resto después.
2. **Re-apuntar las 13 sucursales** a su ciudad RD real, según la tabla de arriba.
3. **Completar la fila 60 de `countries`** según la spec de arriba: `phone_code = '+1'`,
   `cell_phone_lenght` 11→**10**, `timezone = 'America/Santo_Domingo'`, `is_operating = 1`.
4. **Encender el invariante** ciudad↔país: la ciudad de una sucursal debe pertenecer a una zona del país
   de su comercio. Recién es posible después de (1) y (2).

### Lo que este entregable NO toca
Ni los 8 filtros literales, ni el resolvedor, ni el front, ni los tipos de documento. Todo eso viene
después y **no bloquea** esto. Lo único externo: el `phone_code` del paso 3 exige que exista antes la
config de `DO` en `messaging-service` (**P2**).

### Limpieza que conviene incluir
- **12 cableados muertos** del lender 160 a comercios colombianos (0 solicitudes).
- **2 comercios de prueba en producción** dentro del set RD: `Comercio Prueba` (2 sucursales) y
  `pruebaaaaaa` (0). Inflan cualquier conteo de comercios por país.
- **3 sucursales sin comercio** (`allied_id` no resuelve) de 2.212: sin país, no se pueden asignar a
  ninguna base.

## PLAN DE ACCIÓN — la secuencia ejecutable (consolida todo lo anterior)
> Esta sección es **el orden real de ejecución**; «Plan por bloques» queda como mapa temático y el
> «Paso a paso CreditopX» como detalle de ese producto. Etiquetas: **[dato]** = SQL/config, sin deploy ·
> **[código]** = rama en repo real (sin PR hasta que Miguel apruebe) · **[negocio]** = pregunta a personas.

### AHORA — sin tocar código de producción
- ~~**P1**~~ ✅ **HECHO contra prod** (`make trazador-sql`) — ver «Contraste contra producción». El
  reparto **no** se sostiene: en prod hay **1 conflicto** (SmartPay 160, cableado en 47 y 60).
- ~~**P1.bis** ¿se parte SmartPay 160 en dos filas?~~ ✅ **RESUELTO con datos: NO.** Su economía está en
  DOP (2.500–95.000) y sus **206 solicitudes son todas de país 60**; los cableados a comercios CO tienen
  **cero uso**. Es cableado muerto → se limpia, no se parte. F2 vuelve a ser mecánico.
- **P1.ter [código, previo a F1]** Confirmar por dónde se ofrece SmartPay: con `country_id = 60` el
  filtro literal `= 1` lo excluye de `getLenders`, y sin embargo tiene 206 solicitudes. Hay que saber si
  entra por su canal IMEI antes de tocar los ocho filtros.
- **P2 [dato]** `messaging-service`: ubicar dónde viven las filas de config (`LabsMobileConfig`,
  `WhatsAppConfig`) y **verificar/crear las de `DO`** — sin ellas el envío RD falla con `ErrNotFound`.
- **P3 [dato]** Poblar `countries.phone_code`: `'+57'` en 47, `'+1'` en 60 (**después** de P2).
  ✅ **Confirmado en prod que está NULL**, y `dial_code` viene **sin `+`** (`57`, `1`) mientras los 11
  lectores concatenan crudo → el valor va **con** `+`. Riesgo bajo: para CO es no-op (igual al fallback);
  para RD corrige el prefijo. Enciende los 11 lectores.
- **P3.bis [negocio]** `cell_phone_lenght` de DO = **11** en prod (CO = 10). Decidir si significa
  «con el 1» o si está mal, **antes** de que Fr3 lo lea.
- **P4 [dato]** Unificar notación de `locale` (4 filas `es_XX` → `es-XX`, BCP-47 como `Intl`).
- ~~**P5** ¿el consentimiento del 152 está mal para RD?~~ ✅ **RESUELTO**: en prod el 152 es
  **Refurbicredit** (colombiano) y el documento lo nombra correctamente. Era ruido del dump de dev.
  Queda la versión chica: **qué documento firma el 160**, que no tiene blade propio.
- **P5 [negocio]** ¿RD corre solo SmartPay o más canales? (9 comercios y 13 sucursales en país 60, de los
  cuales `Comercio Prueba` y `pruebaaaaaa` son **de prueba, en producción**).

### ETAPA 1 — migraciones aditivas (`legacy-backend`, una rama) [código]
- **M1** `countries`: `+ is_operating` (true solo 47/60) · `+ otp_length` (default 4) · re-seed de
  `phone_code` **por `iso_code_1`** (la migración que no falle esta vez). **No renombrar nada** (el
  form-service lee estas columnas).
- **M2** ~~`allied_branches.country_id`~~ **se cae**: es derivable de `allied_id → allieds.country_id`
  (ver el modelo acordado). En su lugar: **endurecer `allieds.country_id`** como única fuente —
  `NOT NULL`, sin default, y dejar EXPLÍCITO que es inmutable (hoy lo es por accidente: no está en el
  `->only([...])` de `AlliedController::update`; el día que alguien lo agregue, "cambiar el país" pasa a
  significar "mover de base de datos"). Y el **invariante ciudad↔país** como check al escribir, que
  tampoco necesita columna — bloqueado hasta cargar las ciudades de RD.
- **M3** `user_requests`: `+ country_id / locale / currency` (snapshot). Escribirlo en **los tres
  gemelos** de creación: `UserRequestController` (G1) · `UserRequestService` (G2) ·
  `FindOrCreateService` (G3).
- **M4** Quitar el `DEFAULT 1` de `lenders.country_id` y `allieds.country_id` (queda obligatorio al
  escribir): que "sin definir" vuelva a ser distinguible de "definido mal".

### ETAPA 2 — los 8 filtros literales, con transición sin ventana [código, 2 ramas]
- **F1** Los 8 `->where('country_id', 1)` → `->whereIn('country_id', [1, $paisResuelto])`
  (3 en legacy · 5 en application). Deploy. *Acepta ambos mundos durante la transición.*
- **F2** Backfill `lenders.country_id`: los **129 UPDATE** del dry-run (`SQL=1`) + decidir a mano los
  **23 huérfanos activos** (o apagarlos).
- **F3** Limpiar el `1` del `whereIn` → `->where('country_id', $paisResuelto)`. Deploy. Fin: la columna
  vuelve a ser configuración.

### ETAPA 3 — el resolvedor y el gobierno de la sucursal [código]
- **R1** `session('alliedCountry')` ← país de la **sucursal** (fallback comercio). Es el cambio chico
  con blast radius grande: gobierna el gate del wizard.
- **R2** Un `CountryContext` único (precedencia sucursal → comercio → default) + test que la fije.
  Unificar los **4** `$isDoLogic` copiados y el `'do':'co'` para que lean de ahí.
- **R3** `application`: los **7 `'+57'` pelados** (incl. el accessor `User.php:133`) → prefijo del país
  del contexto, como ya hace legacy. Y los 2 `genderapi country=CO` + el `?? 'COLOMBIANA'` de
  `OnboardingPayloadBuilder:129` (+ su gemelo en pdf-mapper-editor).

### ETAPA 4 — front [código, `frontend-monorepo`]
- **Fr1** `partner-info` devuelve `country: { iso2, dial_code, phone_length, otp_length, locale,
  currency, document_types[] }` → el wizard deja de comparar `=== 60`.
- **Fr2** Moneda: `formatCurrencyWithSymbol` toma locale/currency del payload y
  `maximumFractionDigits` **por moneda** (el `0` actual le borra los centavos al DOP); migrar los 58
  formateos manuales al helper (los del flujo de solicitud primero).
- **Fr3** `PhoneField` único por país (mata los ≥6 sitios con "10 dígitos"/`+57` cableados) +
  `normalizePhoneE164` con libphonenumber (hoy etiqueta a los RD como `+57` en analítica).

### ETAPA 5 — tipos de documento [código + dato]
- **D1** Catálogo `document_types` + `document_type_scopes` + resolvedor (unión ∩ catálogo del país).
- **D2** Decidir el destino de `lenders_by_allied_branches.document_types` (json de motai-v2): migra o
  se reemplaza **antes** de mergear — no las dos.
- **D3** Los mapas por proveedor (`provider_codes`) y quitar los default `'CC'` fail-open.

### ETAPA 6 — validación y guardrail [código, playground]
- **V1** Eje `country` en el harness (comercio RD e2e; con el bloqueador F-21 documentado).
- **V2** Guardrail CI: prohibir `=== 60`, `== 47`, `'+57'`, `es-CO`, `in:CC,CE,PEP` fuera de la capa
  de config — lo único que evitó la recaída en motai-v2.

**Fuera de este alcance, ya anotado:** `America/Bogota` ×10 y `'COP'` en la firma de Wompi (fase
CreditopX-3: formalización/pagos por país) · geo de RD (INSERT diferido) · i18n de textos (CO y RD
comparten español) · timezone de servicing.

## Paso a paso para internacionalizar CreditopX
CreditopX (rt=2/3 in-platform) es el corte correcto para arrancar: **CreditOp decide con datos locales**,
así que no hay contrato con un tercero que renegociar por país — al revés de los agregadores rt=1, que son
instituciones colombianas. Y ya hay prueba de vida: **SmartPay RD es un miembro de la familia corriendo en
país 60**. La vara de éxito: **dar de alta el tercer país sin escribir código**.

**Fase 0 · Que el dato diga la verdad** *(sin código nuevo; bloquea todo lo demás)*
1. ✅ **HECHO** — `make harness-paises` (`harness/dev/paises.ts`, read-only; `SQL=1` imprime los
   UPDATE sin ejecutarlos). Corrida contra **local** (2026-08-05): **156 entidades → 129 a poblar ·
   0 en conflicto · 26 sin cablear (23 activas) · 1 ya correcta** (SmartPay 153).
   - **Cero conflictos**: hoy ninguna entidad está cableada en sucursales de dos países, así que el
     backfill es inequívoco para las 129. La única que no es CO es **SmartPay 152 → 60**.
   - **Radio de explosión: 128 entidades ACTIVAS** saldrían del default 1 al poblar → con los tres
     filtros literales vivos, desaparecen del listado sin error. **Los filtros van primero.**
   - Las 23 huérfanas activas se resuelven a mano (o se apagan si están muertas).
   - Confirmado de paso el desacuerdo de sucursal: **1** con comercio DO y ciudad CO.
   - Falta correrlo contra **dev/prod**: el reparto puede ser otro.
2. Backfill de `lenders.country_id` **y recién después** matar los **ocho** `->where('country_id', 1)`
   (3 en `legacy-backend` + 5 en `application`). En ese orden: al revés el listado queda vacío.
3. Poblar `countries` para CO y RD (aditivo: `phone_code`, `address_format`, `locale`, `currency`) + agregar
   `is_operating`, `otp_length`, `date_format`, `template_suffix`.

**Fase 1 · El país de la operación**
4. `allied_branches.country_id` con invariante contra `country_city_id`.
5. `session('alliedCountry')` pasa a leer la **sucursal**; `allieds.country_id` queda como origen/fallback.
6. `user_requests` **congela** país + locale + moneda al nacer (snapshot, no join).
7. Un resolvedor único con la precedencia escrita, y un test que lo fije.

**Fase 2 · Alta de un lender CreditopX en el país N — la prueba de fuego**
Todo esto ya cuelga de `lender_id`, así que **una fila por país lo resuelve solo**. Es checklist de datos:
8. `lenders` (country_id = N) + `credit_line_by_lenders` en moneda local + `lender_users_categories` y sus
   reglas (`min_income`, `max_amount` en moneda local) + tramos + `creditop_x_lender_configuration`.
9. Cablearlo en `lenders_by_allied_branches` de las sucursales de ese país, **con la validación de país**.
10. Empaquetarlo como **seeder**. Si el alta necesita tocar código, no está internacionalizado.

**Fase 3 · Lo que en rt=2 es colombiano y hay que parametrizar** *(el trabajo real)*
11. **Riesgo/burós.** El gate de datacrédito **pasa si no hay regla** (`DatacreditoRuleEvaluator`: sin regla
    → skip), y `application` ya bloquea crear reglas para comercios no-CO (`addNewRule:80`). Pero **el
    gemelo de `legacy-backend` NO tiene esa compuerta** (`AlliedManagementService`): una sucursal RD creada
    desde legacy recibe reglas colombianas → y ahí el evaluador es **fail-closed** (`no_datacredito_data`)
    → no se ofrece nada. **Es el primer arreglo de esta fase.** Y decisión de negocio: en un país sin buró,
    ¿el riesgo lo lleva solo la categoría de perfilamiento?
12. **Formalización.** Pagaré Deceval + garantía + Netco son colombianos. SmartPay RD ya demostró el
    reemplazo (un solo acuerdo de bloqueo), pero por `if id==160`. Llevarlo a config
    (`promissory_type_id`, `signing_provider_id`, plantilla de consentimiento).
13. **Cuota inicial.** rt=2 con `initial_fee > 0` va a Wompi/Payvalida, y Payvalida está quemado al country
    `343` (Colombia). Sin pasarela local: o el enganche es 0 en ese país, o hay pasarela por país.
14. **Regulación.** La usura es colombiana y ya hay dos hardcodes que lo reconocen
    (`updateUsuryRate` saltea `country_id == 60`; `calculateRate` bifurca en `!= 60`). Volverlos regla de
    `countries`, no un `60` literal.

**Fase 4 · Front** — país como payload en `partner-info` → `PhoneField` por país → documentos del catálogo
→ moneda/formatos en todas las respuestas → converger el fork del wizard RD.

**Fase 5 · Prueba** — eje `country` en el harness con un comercio RD. Bloqueador conocido: `isSmartPay()`
hardcodea el lender 160, así que la originación distintiva **no es ejercitable** fuera de producción (F-21).

## Decisiones abiertas
- ~~¿Se arranca por enriquecer la geolocalización?~~ **RESUELTO (2026-08-05):** no. El árbol geo ya existe
  y es de 3 niveles (RD ya tiene sus 32 provincias); lo que falta son datos (ciudades de RD) con payoff
  diferido. Se arranca por **`countries` como fila de config** → tipos de documento →
  `allied_branches.country_id`. Detalle en «Por dónde arrancar».
- ~~¿Cuál país manda?~~ **RESUELTO (2026-08-05, Miguel):** manda el de la **SUCURSAL** — es donde se
  atiende al cliente, y de ahí salen el prefijo del celular, los burós, la moneda y los documentos. El del
  **comercio** queda como país de **origen/reporte** (y fallback); el de la **entidad** significa "en qué
  moneda está denominada esa fila"; el del **usuario** es otro eje (de dónde es la persona). La
  `user_request` **copia** el de la sucursal al nacer (snapshot, no join vivo).
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

## Material de QA y backlog (heredado de la tarea 44, que se eliminó el 2026-08-09)

> ⚠ Esto está **arriba** de la marca publicable a propósito: NO se publica solo. La descripción que hoy
> vive en CORE-365 es la de este archivo; lo de abajo es lo que le faltaría al ticket para que QA pueda
> validar sin preguntar. Subirlo es una decisión, no un automatismo.

### Lo que NO entró en las ramas, y por qué (backlog real)
- **La corrección de los puntos de venta dominicanos. SIGUE PENDIENTE** — las 3 migraciones **no la
  hacen**, y es a propósito: sembrar las ciudades es la *precondición* (antes no había a dónde
  moverlos), no la corrección. **Re-medido en prod el 2026-08-18: son 16, no 13**, y las 16 son
  comercios dominicanos apuntando al «SANTO DOMINGO» de Antioquia. Cruzadas las direcciones contra los 8
  municipios sembrados, **solo 3 se resuelven solas**: 2201 → `SANTO DOMINGO ESTE`, 2234 →
  `LOS ALCARRIZOS`, y 2221 → `PEDRO BRAND` (⚠ ésta se contradice: la dirección dice «Pedro Brand» *y*
  «Santo Domingo Oeste»). Las otras 13 hay que **preguntárselas al comercio**: 2 no tienen dirección
  usable («Tienda 1», «Tienda 2») y varias son «Autopista Duarte km N», que cruza varios municipios. El
  comando `paises:auditar-sucursales` imprime la dirección de cada uno justamente para esto.
- **El registro de países mal cargado.** La fila `countries.id = 1` se llama «Afghanistan» y tiene moneda
  e idioma de Colombia; a ella apuntan **186 entidades y 364.527 usuarios**. Hoy es inocuo porque el
  camino vivo resuelve por comercio, que apunta a la fila correcta. **Tarea aparte por ser destructiva**,
  y en el mismo cambio tienen que ir las 8 consultas con id de país fijo o el listado de crédito queda
  vacío.
- **Consolidar la resolución del país en el backend.** Las 4 copias de `currency_format` y las 4 de la
  heurística `$isDoLogic` siguen repartidas. Nada se comporta mal hoy por eso: es orden.
- **El valor por omisión del formateador de plata del front.** De 28 llamadas, 21 no pasan el idioma y
  caen a Colombia en silencio. Quitarlo obliga a tocar esas 21 — merece su propio PR.
- **La semántica de `cell_phone_lenght`.** Dice 10 para Colombia y 11 para RD, y los dos móviles
  nacionales son de 10 dígitos. Sin definir eso, no se puede validar largos con esa columna, así que **no
  se expone al front**.

### En una línea
El país del comercio pasa a ser configuración que el sistema consulta, en vez de estar escrito dentro del
programa como «Colombia».

### Por qué
Llevamos cinco meses originando crédito en República Dominicana con el país escrito en el código, y eso ya
produce datos incorrectos: los puntos de venta dominicanos quedaron registrados en una ciudad de Colombia
que se llama igual, los mensajes salen con el prefijo telefónico colombiano y los contratos dominicanos
dicen «COLOMBIANA». No falta funcionalidad: falta que el país sea un dato que el sistema consulte.

### Qué cambia
- El **prefijo telefónico** sale del país del comercio. El dato ya existía, pero estaba guardado en una
  columna que el sistema no lee.
- Se cargan las **ciudades de República Dominicana**. No había ninguna, y por eso el selector sólo podía
  ofrecer ciudades colombianas.
- El **selector de ciudad del admin** sólo ofrece ciudades del país del comercio. Si el comercio es
  dominicano, la ciudad colombiana ya no aparece.
- Los **documentos** toman la nacionalidad del país del comercio cuando no está el dato del cliente, en
  vez de decir siempre «COLOMBIANA».
- El **país viaja al flujo de solicitud**: la pantalla del teléfono y la de datos complementarios lo usan
  en vez de asumir Colombia.
- Se agrega una **revisión** que lista los puntos de venta cuya ciudad está en otro país que su comercio.

### Alcance
- Aplica a los comercios de República Dominicana y a los de Colombia por igual: cada uno recibe su país.
- **Colombia no cambia.** Antes obtenía «+57» por omisión y ahora lo obtiene del dato: es el mismo valor.
- **No** corrige los puntos de venta ya mal registrados: eso necesita confirmar la dirección con cada
  comercio.
- **No** valida el largo del número de celular: ese dato está definido de forma ambigua entre los dos
  países y se decide aparte.
- Si el país no se puede determinar, todo se comporta como antes: ninguna pantalla queda bloqueada.

### Dónde probar
- Ambiente de pruebas · un comercio de República Dominicana y uno de Colombia.
- **Precondición:** el comercio dominicano debe tener el país configurado y al menos un punto de venta.

### Cómo validar
1. **Admin, comercio dominicano** → editar un punto de venta → el selector de ciudad sólo ofrece
   municipios dominicanos. Buscar una ciudad colombiana no devuelve nada.
2. **Admin, comercio colombiano** → el selector sigue ofreciendo las ciudades de siempre (regresión).
3. **Solicitud en comercio dominicano** → el documento generado dice «DOMINICANA».
4. **Solicitud en comercio colombiano** → el documento sigue diciendo «COLOMBIANA» (regresión).
5. **Revisión** → correr `paises:auditar-sucursales`: lista los puntos de venta mal registrados y no
   modifica nada.

### Criterios de aceptación
- Un comercio dominicano no puede quedar con una ciudad de otro país desde el admin.
- Un comercio colombiano se comporta exactamente igual que antes en las cuatro pantallas tocadas.
- El documento de una solicitud dominicana no dice «COLOMBIANA».
- Si el país de un comercio no está configurado, el flujo sigue funcionando con el comportamiento actual.
## Tarea (publicable)

## En una línea
Que el país sea configuración y no algo escrito en el programa, para poder habilitar un país nuevo
cargando datos en vez de publicando una versión.

## Por qué
El sistema asume un solo país en el código: el prefijo y la longitud del celular, los tipos de documento
válidos, los textos, la moneda y los formatos. Por eso el segundo país se resolvió con una copia paralela
de las pantallas de solicitud, y un tercero costaría otra copia.

Y hay un problema de fondo que salió al abrir esto: **casi todas las entidades financieras están
registradas en un país que no es el suyo**. La pantalla que las da de alta ofrecía una sola opción, mal
etiquetada, así que quien las cargó no podía elegir otra cosa ni darse cuenta. El sistema funciona porque
a ese país equivocado le copiaron encima los datos de Colombia. Mientras eso siga así, una entidad de otro
país no le aparece a nadie aunque esté bien configurada — que es exactamente lo que bloquea la operación
de Perú.

## Qué cambia
1. **El listado de entidades usa el país del comercio que está atendiendo**, en vez de asumir uno fijo.
   Para un comercio colombiano o dominicano no cambia nada; para uno de otro país, empieza a funcionar.
2. **El administrador ofrece los países donde se puede dar de alta**, leídos de una tabla y no de una
   lista escrita en el programa. Habilitar un país nuevo pasa a ser un cambio de dato.
3. **Se puede corregir el país de un comercio** mientras no tenga puntos de venta ni solicitudes. Hasta
   ahora era imposible: equivocarse al crearlo obligaba a crear otro y dejaba uno huérfano.
4. **Queda cargado el catálogo de los 18 países de Latinoamérica** con prefijo telefónico, longitud de
   celular, idioma y moneda — la base sobre la que después las pantallas pueden mostrar la moneda y el
   prefijo correctos.

**Y lo que se sumó después** (segunda tanda, lo que ve el solicitante):

5. **El formulario de solicitud habla en el idioma del país**: el monto en su moneda y con sus separadores,
   el celular con su prefijo y su longitud, y los tipos de documento que ese país acepta — no los
   colombianos.
6. **El documento que se le dibuja al solicitante se adapta.** Antes había dos ilustraciones fijas —la
   cédula colombiana y el permiso de permanencia— y se elegía entre ellas; ahora hay una sola que muestra
   la bandera del país del comercio, el gentilicio, el nombre real del documento elegido, la entidad que
   lo expide y la fecha de nacimiento cuando el comercio la pide. La entidad emisora depende del país **y**
   del tipo: los documentos de extranjeros los expide la oficina de migraciones, no la de nacionales.
7. **Lo que no se le pregunta al solicitante y no se puede deducir se marca visiblemente** en vez de
   inventarse, para que nadie confunda un relleno con un dato real.

## Alcance
**Entra**: el listado de entidades, el alta y edición de comercios y entidades, el registro de países, y
—en el flujo de solicitud— la moneda, el prefijo y la longitud del celular, los tipos de documento por país
y la ilustración del documento.

⚠ Los tres últimos figuraban antes como «no entra»: **entraron en la segunda tanda** y por eso se movieron.

**No entra** (son pasos siguientes, con su propio trabajo): el catálogo de ciudades de países nuevos; la
mensajería, que tiene su propio camino; el pasaporte, que tiene otra forma y se ilustra aparte; y
**corregir el registro de las entidades mal cargadas**, que se hace después y sólo una vez que este cambio
esté en el aire — al revés, desaparecen de los listados.

Habilitar un país **no** significa que el crédito funcione de punta a punta ahí: eso depende además de que
el país tenga central de riesgo, documentos y geografía cargados. La separación es deliberada — configurar
un comercio no origina crédito, así que no hay razón para impedir el alta mientras el país se prepara.

## Dónde probar
**El ambiente `qa`** (originaciones-qa), que es donde está todo esto. Comparte base de datos con desarrollo
y con staging, así que lo que se carga en uno se ve en los tres — pero **el código es distinto en cada
uno**, y esto está en `qa`. Comercios de referencia: uno colombiano (**Kreditkasa** o **Dentix**), uno
dominicano (**CeluRD**) y el comercio de prueba de Perú.

⚠ **Producción todavía no tiene nada de esto.** Y al desplegarlo habrá que cargar allá las banderas
aparte: son datos y no viajan con el código.

⚠ **El código de verificación por SMS no llega al teléfono en `qa`**: se publica en el canal de mensajería
de pruebas del equipo en Slack, en el hilo del número que se usó.

## Cómo validar

**La configuración (primera tanda)**

1. **Que no se rompió nada**: entrar con un comercio colombiano y con uno dominicano y confirmar que el
   listado muestra **exactamente las mismas** entidades que antes del cambio, en el mismo orden.
2. **Que el país nuevo funciona**: con el comercio de Perú, confirmar que su entidad aparece en el
   listado. Antes de este cambio ese listado salía **vacío**.
3. **Que el administrador acompaña**: al crear un comercio o una entidad, el selector de país ofrece los
   18 países de Latinoamérica y **no** ofrece ningún otro.
4. **Que el país se puede corregir**: en un comercio recién creado, sin puntos de venta ni solicitudes, el
   campo de país es editable. En uno con operación, no aparece.

**El flujo del solicitante (segunda tanda)**

5. Arrancar una solicitud con un comercio de cada país y mirar las primeras dos pantallas: el monto tiene
   que salir en la moneda del país y el celular con su prefijo y su cantidad de dígitos.
6. Llegar al paso de la fecha de expedición y comprobar el documento en cada país:

|| país || tipos que debe ofrecer || qué debe decir el documento ||
| Colombia | C.C. y C.E. | bandera colombiana · «Cédula de ciudadanía» · Registraduría · COLOMBIANA |
| Perú | DNI y C.E. | bandera peruana · «Documento Nacional de Identidad» · RENIEC |
| República Dominicana | Cédula y NUI | bandera dominicana · «Cédula de identidad» · JCE |

7. En esa misma pantalla: elegir la fecha de expedición y comprobar que **el documento gira solo** y muestra
   el reverso con esa fecha resaltada; volver a tocarlo para verlo de frente.
8. **El caso que más importa**: cambiar el tipo a cédula de extranjería. La entidad emisora tiene que
   cambiar también — en Colombia pasa a Migración Colombia, en Perú a Migraciones —, porque no la expide la
   misma oficina que la de nacionales.

## Criterios de aceptación
- El listado de entidades de un comercio colombiano y de uno dominicano es idéntico antes y después.
- La entidad peruana aparece en el listado de un comercio peruano, y **no** aparece en uno colombiano.
- Se puede crear un comercio y una entidad en cualquiera de los 18 países de Latinoamérica.
- Ningún país fuera de esa lista se puede elegir al crear un comercio o una entidad.
- El país de un comercio se puede corregir sólo mientras no tenga puntos de venta ni solicitudes.
- Ninguna entidad activa deja de aparecer en un listado donde antes aparecía.
- En los tres países se ve la bandera correcta y el nombre correcto del documento; al cambiar el tipo
  cambian el nombre y la entidad emisora.
- El documento gira al completar la fecha y responde al toque.
- Ningún dato aparece cortado a media palabra, y los que no se le piden al solicitante se ven marcados como
  desconocidos y no con un valor de relleno que se pueda confundir con uno real.
- Colombia no cambia respecto de lo que se veía antes, salvo por la bandera y el gentilicio, que no estaban.

## Dependencias / contraparte
- **Orden obligatorio**: el cambio del registro de países se aplica **antes** de publicar el cambio de
  código. Ya está aplicado en el ambiente compartido por desarrollo y QA.
- **Para producción**: además del despliegue hay que cargar las banderas de los países donde se opera. Es
  un cambio de datos, va por fuera del código, y sin él el documento se ve con un emblema gris en vez de la
  bandera.
- **Negocio**: confirmar la longitud del celular de los países que todavía no operan antes de abrir cada
  uno — varios planes de numeración son ambiguos, y la duda ya existe con República Dominicana, que hoy
  figura con una longitud distinta a la de Colombia.
- **Negocio**: decidir a qué país corresponden las entidades que hoy no tienen forma de deducirlo, o
  confirmar que están inactivas y se apagan. Hace falta para el paso siguiente, no para éste.
