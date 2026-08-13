---
id: 47
title: "KYC: el «no coincide» del segundo apellido se traga — `0 == null` en TusDatosService"
stage: work
created: "2026-08-13T09:16:27-05:00"
context_nodes: [kyc, credifamilia, deceval]
jira: []
jira_title: "La validación de identidad acepta un segundo apellido que la central reporta como incorrecto"
---

**ESTADO 2026-08-13 · EN PRUEBAS** — el arreglo está hecho, verificado en dos capas y **pusheado**;
falta que alguien lo valide antes de mergear.

> ⚠ `stage: work` porque el tablero sólo tiene tres estados (`evaluation` · `work` · `tasks`) y
> ninguno es «pruebas». No se inventa un valor que la UI no sabe pintar ni el guard conoce: el estado
> real va acá, en el cuerpo. Si «en pruebas» va a repetirse, el arreglo es agregar la etapa al tablero
> (`src/App.vue` → `STAGES`), no meter un `stage` fantasma en el frontmatter.

- **Rama:** `fix/kyc-second-surname-mismatch` en `legacy-backend`, commit `7f4c2903`, **pusheada a
  `origin`** el 2026-08-13. **Sin PR** — se abre cuando pase la validación.
- **Qué hay que probar:** que un cliente con segundo apellido mal escrito ya NO avance (ve el error en
  el campo apellido y lo corrige), y que un cliente que legítimamente tiene **un solo** apellido siga
  pasando sin fricción. Lo segundo es lo que hay que mirar con lupa: es el riesgo de este cambio.
- **Cómo probarlo en un comando** (stack local, drivers de KYC en fake):
  `cd playground/harness && node dev/kyc-apellido.ts` → exit 0 correcto · 1 defecto vivo · 2 no
  concluyente.
- Causa raíz **VERIFICADA** en producción (BD vía Redash + Loki) y **REPRODUCIDA** en test y por API.
- `legacy-backend` quedó en esta rama; los 6 stashes intactos. Para volver a lo tuyo:
  `git checkout feature/pais-como-dato`.

**Pasos 2, 3 y 5 HECHOS.** Secuencia medida:

- test de comportamiento contra `main` sin arreglo → **rojo por el motivo correcto**
  («Failed asserting that false is true»: `error` viene en `false`, o sea que el servicio ACEPTÓ la
  identidad con el segundo apellido reportado como no coincidente);
- red de protección (cliente que legítimamente no tiene segundo nombre ni segundo apellido) → **verde
  antes y después**;
- con `=== null` → **36 passed / 66 assertions**, y las otras suites que usan esos fakes intactas
  (`tests/Feature/E2E/HttpFakeUsageExamplesTest` 7 passed).

Diff: **1 línea de producción** (`TusDatosService.php:189`), 2 escenarios nuevos en `TusdatosHttpFake`
(+ el `status` de raíz que faltaba en los 4 escenarios CC), 1 test de forma y 1 archivo de test nuevo.

**Paso 4 HECHO por el carril rápido** (API, sin navegador), con herramienta nueva:
`harness/dev/kyc-apellido.ts` — «¿se acepta un segundo apellido que la central reporta como
incorrecto?». Exit code = veredicto, igual que `sweep` / `experian-check`. Verificada en los dos
sentidos contra el stack local con los drivers en fake:

| | sin el arreglo | con el arreglo |
|---|---|---|
| escenario `second-surname-mismatch` | **ACEPTADO** · `ONB004` · guarda `ANDREA / MUSUSU NEMPEGIE` | **RECHAZADO** · `ONB005 / KYC_VALIDATION_FAILED` · `payload.surname = "Segundo apellido no coincide."` · **no queda fila en `users`** |
| escenario `single-name-and-surname` | ACEPTADO | ACEPTADO (`ONB004`) — la tolerancia legítima intacta |
| exit code | **1** | **0** |

O sea que el daño de producción se reproduce entero por API: el mismo nombre mal escrito termina
escrito en `users`. **Falta el recorrido VISUAL** (panel + wizard), que es el carril de Miguel — ver
abajo qué quedó listo para eso. Y faltan los pasos 6-8.

Entró por soporte: «se guardó un usuario solo con un nombre y un apellido», dos cédulas —
**26115588** y **1015452769**.

## El caso

| | 26115588 | 1015452769 |
|---|---|---|
| usuario | 23858 · `CANDIDA` / `LICONA` | 378811 · `ANDREA` / `MUSUSU NEMPEGIE` |
| solicitud | 519533 · estado 11 · 2026-08-04 | 523201 · estado 11 · 2026-08-08 |
| comercio | Sonría LA PLAYA | Sonría PLAZA IMPERIAL |
| radicación SOAP | 200 «Se guardó la transacción» 08-05 10:36 | 200 «Se guardó la transacción» 08-10 22:47 |

**La cadena de ANDREA (hubo dos avisos y se perdieron los dos):**

1. Ágil Data: `codRespuesta 99` «Consulta no exitosa para la entidad» → cae a Mareigua.
2. **Mareigua devolvió el nombre correcto**: `ANDREA MUSUSU NEMPEQUE` (con Q). No coincidió con lo
   tecleado (`surname_valid: false`, reason `token_mismatch`) → se **descartó el dato de Mareigua** y se
   pidió reintento con TusDatos.
3. **TusDatos dijo que el segundo apellido NO coincide** (`second_surname: 0`) → **se tragó** (ver causa).
4. Se guardó lo tecleado y se radicó `apellido: "MUSUSU NEMPEGIE"`.

**CANDIDA no tuvo ningún aviso:** en su flujo de 2026 **no se consultó ninguna central de identidad**
(solo Experian, score 821 — `risk_central_user_data` tiene rc 1/4/5, no 2/3/6). Es usuaria de 2024 con
`validated=1`: su nombre entró por el flujo viejo de `legacy-application` y nunca se volvió a verificar.
Su correo es `candelarialicona2@gmail.com`, lo que sugiere un segundo nombre ausente — **señal, no
prueba**. No hay logs suyos anteriores a 2026 (la tabla `logs` no tiene nada).

## La causa raíz

`legacy-backend/Modules/Identity/App/Services/TusDatosService.php:189`

```php
if ($message !== '' && !(($fieldKey == 'middle_name' || $fieldKey == 'second_surname') && $matchCode == null)) {
```

La intención (correcta) es tolerar **no haber mandado** un segundo nombre/apellido. Pero **en PHP
`0 == null` es `true`** (verificado corriendo `var_dump(0 == null)` → `bool(true)`), y **`0` es el código
de TusDatos para «no coincide»**. Así que «el segundo apellido está mal» se descarta con el mismo
silencio que «no lo mandé». El `match` de `:182` es **estricto** y sí construye el mensaje «Segundo
apellido no coincide» — el `if` lo tira. **Arreglo: `=== null`.**

**Medido en prod** sobre 4.874 chequeos de TusDatos desde 2026-07-23 (`kyc_name_checks`, 9.554 filas
totales): **198 validaciones pasaron con un «no coincide» declarado** — 87 de segundo apellido, 87 de
segundo nombre, 24 de segundo apellido sin segundo nombre.

## Por qué nada lo agarró — dos razones estructurales

**1. La cascada de identidad es una COMPUERTA, no una fuente.** Ágil, Mareigua y TusDatos devuelven los
tres `'names' => $form_name, 'surnames' => $form_surname` (`AgildataService.php:105`,
`MareiguaService.php:127`, `TusDatosService.php:242`) — **te devuelven lo que le mandaste**. Pueden
**vetar** el nombre, nunca completarlo ni corregirlo. Y el formulario no exige cantidad de tokens:
`PersonalInfoRequest.php:57-68` es `required|string|min:3|regex letras`. Lo que teclea el asesor queda.
⚠ Esto **cambió con el backend**: `legacy-application/PersonalInfoController.php:208-209` **sí**
sobrescribía con `primer_nombre` + `segundo_nombre` de Mareigua. El nuevo no.

**2. El corpus de fakes tiene el hueco exactamente ahí.** `TusdatosHttpFake` (en `main`) tiene **20
escenarios y ninguno menciona `second_surname`**. El que más se acerca, `verifyCcNameMismatch()`, pega en
`first_name: 0` y `first_surname: 2` — justo los dos campos que **no** están en la condición con el bug,
por eso nunca se cayó.

**Y el agravante:** el match de nombres es una rama de `APP_ENV`, no un driver —
`MareiguaService.php:362`, `AgildataService.php:357`, `TusDatosService.php:458`:

```php
if (app()->environment(['local', 'development'])) { return true; }
```

O sea que **el único entorno donde se puede inyectar un fake es el único donde la comparación está
apagada**. No es casualidad que nadie lo agarrara.

## Lo que YA existe y no hay que construir

`app/Support/Onboarding/External/Http/` está **en `main`**: `TusdatosHttpFake`, `AgildataHttpFake`,
`MareiguaHttpFake`, `ExperianHttpFake` con escenarios nombrados. Y **funcionan en runtime**, no solo en
tests: `OnboardingDriverServiceProvider::boot()` los registra con `Http::fake()` cuando
`ONBOARDING_DRIVER_<x>=fake` (`config/onboarding.php:29-32`), con switch por request vía header
`X-Fake-Scenario` si `ONBOARDING_FAKES_ALLOW_HEADER=true` (`FixtureLoader.php:88-100`). El guard
`ensureFakeDriversAllowed()` rechaza `fake` con `APP_ENV=production`. Manual: `docs/local-dev.md`;
targets `make drivers` · `make mock-all` · `make mock-off` · `make restart`.

**Conclusión de diseño: NO hace falta un `APP_ENV` nuevo ni un mock server en el harness.** Un
environment nuevo movería **24 guards en 20 archivos** de golpe (OTP bypass, Redis, `CacheRepository`,
Evidente, Ábaco, sesiones del form dinámico) cuando hay que mover 3. Y `testing` ya está tomado por
phpunit (`phpunit.xml:27`), así que `test` queda a una letra.

## Plan

**Paso 0 — punto de partida. HECHO.** `main` = `9a972697`, árbol limpio.

**Paso 1 — burós en fake, sin tocar credenciales.** `make mock-all` (flipea los `ONBOARDING_DRIVER_*`
del `.env` existente; reversible con `make mock-off`) → `make drivers` para confirmar → `make restart`
(**obligatorio** tras cambiar drivers). ⚠ **NO** `cp .env.mock .env`: pisa el `.env` actual.

**Paso 2 — el escenario que falta (~12 líneas).**
`TusdatosHttpFake::verifyCcSecondSurnameMismatch()` con `first_name: 1`, `first_surname: 1`,
`second_surname: 0` y `middle_name` **ausente** (= null, igual que ANDREA). Más su unit test en
`tests/Unit/Support/HttpFakes/`, como pide el README de esa carpeta.

**Paso 3 — reproducir la cadena COMPLETA en un feature test.** Es la única capa donde se puede: en
`testing` el bypass de `verifyCoincidence` no aplica, así que acá **sí** se reproduce además el rechazo
de Mareigua por nombre distinto (el camino literal de ANDREA).

```php
Http::fake(array_merge(
    AgildataHttpFake::notFoundOrError('99'),          // igual que prod
    MareiguaHttpFake::notFound(),                     // o el nombre con typo, acá sí discrimina
    TusdatosHttpFake::verifyCcSecondSurnameMismatch(),
));
// POST /api/onboarding/loan-application/personal-info/{hash}/{id}
```

| | hoy (main) | con el arreglo |
|---|---|---|
| respuesta | **200, sigue** | **ONB005** + `errors.surname` |
| `users.surname` | `MUSUSU NEMPEGIE` | no se guarda el apellido malo |
| `kyc_name_checks` | `passed = 1` con `second_surname: 0` | `passed = 0` |

⚠ **CORRECCIÓN de lo que dije al planear:** sí existe `Modules/Identity/tests/Feature/Services/TusDatosServiceTest.php`
(estaba en `Modules/`, no en `tests/`, y mi grep no lo alcanzó). Pero no cambia la conclusión, la empeora
— ver «tres paredes» abajo. El test nuevo se puso en archivo aparte
(`TusDatosSecondSurnameMismatchTest.php`) para no heredar su `beforeEach` roto.

## Cuatro paredes encontradas al implementar (ninguna es del caso, las cuatro son de `main`)

**0. Los escenarios de TusDatos eran INALCANZABLES en runtime, y el síntoma engañaba.** La cascada de
`storePersonalInfo` es Ágil → Mareigua → TusDatos y **corta en la primera que responde bien**. Como
`HttpFakeRegistrar::stubsFor()` cae al `success` del proveedor cuando el escenario no está en su mapa, y
los escenarios de KYC estaban registrados **sólo para tusdatos**, pedir `issue-date-mismatch` (o el mío)
hacía que **Ágil respondiera OK y TusDatos no se llamara nunca** — la solicitud pasaba y se leía como
«TusDatos aceptó». El log lo delata: *«laboral information obtained via risk centrals»*. Arreglado con
`TUSDATOS_VERDICT_SCENARIOS`: en esos escenarios Ágil y Mareigua se abstienen. ⚠ Esto afectaba también a
los 3 escenarios que ya existían (`issue-date-mismatch`, `name-mismatch`, `document-not-found`): ninguno
podía probar lo que su nombre dice.

⚠ Y de paso, la lección que se repitió DOS veces en esta tarea (una en el test, una en la herramienta):
**un rojo por el motivo equivocado es peor que no tener prueba.** La primera vez fue un `issue_date`
ausente que hacía fallar por la fecha; la segunda, Ágil resolviendo antes de que TusDatos opinara. Las
dos veces el veredicto era «correcto» y la razón, falsa.

**1. `TusDatosServiceTest.php` está 100 % ROJO en `main`: 33 tests fallidos, 0 assertions.** Todos
mueren en el `beforeEach` con `ArgumentCountError`: construye `new TusDatosService($a, $b)` y el
constructor pide **3** desde que se le agregó `UserRequestRepositoryInterface`. Nadie actualizó el test
y nadie lo notó, o sea que ese archivo no está bloqueando nada. Y aun cuando pasaba no probaba
comportamiento: los 33 son `method_exists`, `isProtected`, `toBeInstanceOf` y reflexión sobre una
propiedad. Cobertura de forma, no de conducta.

**2. `migrate:fresh` está roto en `main`, así que TODO test con BD está rojo.**
`database/migrations/2025_02_12_212827_add_insurance_per_million_to_lenders_by_allieds.php` hace
`->after('initial_fee_percentage')` sobre `lenders_by_allieds`, y esa columna **no la crea ninguna
migración** (la de 2024 la agrega a `allieds`, otra tabla). Los dumps la traen, así que en local/dev
nunca se ve; `RefreshDatabase` sí. Comprobado con `tests/Feature/Jobs/DeviceUnrollJobTest` → 9 failed,
`SQLSTATE[42S22] Unknown column 'initial_fee_percentage'`. **Workaround usado:**
`DatabaseTransactions` sobre el schema `testing` que ya existe (135 tablas; le falta `kyc_name_checks`,
pero el recorder está en try/catch y no estorba). ⚠ Esto merece tarea aparte: mientras siga roto, nadie
puede escribir un test de flujo con factories.

**3. El corpus de fakes NO servía para la ruta CC — por eso nunca se ejercitó.** Dos defectos, los dos
verificados corriendo el servicio contra los fakes:
- **Faltaba el `status` de la raíz.** `TusDatosService` recibe el body completo como `data` y lo descarta
  si no encuentra `$tusDatos->status` («Respuesta satisfactoria pero data es null») **antes** de mirar
  los `findings`. Los 4 escenarios CC de 200 no lo traían ⇒ ninguno llegaba nunca a la clasificación.
- **`verifyCcSuccess()` no produce un éxito.** Devuelve `findings` vacío, y por la ruta CC eso son tres
  «no proporcionado» (primer nombre, primer apellido, fecha) ⇒ `count($errors) === 3` ⇒ el servicio
  responde «Nombres, apellidos y fecha de expedicion no coinciden. Verifique numero de documento». Para
  el caso legítimo se agregó `verifyCcMatchWithoutSecondNames()`.
- Y de paso: el README de esa carpeta afirma que «Creditop treats absence of the field as match».
  **Es al revés**: la ausencia es «no proporcionado» y **sí** es error para primer nombre, primer
  apellido y fecha de expedición. La tolerancia existe **sólo** para `middle_name` y `second_surname`.

La moraleja de las cuatro juntas: el defecto no sobrevivió por falta de herramientas — sobrevivió porque
**ninguna de las herramientas estaba enchufada al camino que decide**.

## Listo para el carril VISUAL (el de Miguel)

Lo que hace falta para verlo en el wizard ya está puesto:

- `harness/pkg/config.ts` → `fakeScenarios.tusdatos.secondSurnameMismatch` y `.singleNameAndSurname`
  (los dos carriles usan la misma cadena).
- `harness/pkg/mock-control.ts` → `injectFakeScenario(page, escenario, url)` ya existía y resuelve el
  detalle fino: intercepta `**/*` (no sólo `/api/**`) porque el wizard tiene SSR y el `<Form method=post>`
  postea al server de Vite, que reenvía el header al backend sólo en `APP_ENV=local`.
- Backend: `ONBOARDING_DRIVER_*` en `fake` (`make mock-all`) + `ONBOARDING_FAKES_ALLOW_HEADER=true`
  (ya estaba en el `.env`).

⚠ Lo que **NO** está listo: `harness/channel/kyc-ui.spec.ts` tiene los 4 tests en `test.fixme` y
referencia `fakeScenarios.kyc.*`, un namespace que **no existe** en `pkg/config.ts` (es `.tusdatos`).
O sea que la suite está parqueada Y desfasada; su docblock dice que espera testids de una rama del
frontend (`feature/onboarding/fe-obs-04`). Reactivarla es tarea aparte, no un ajuste.

Y el wizard local se levanta con un modo propio de Vite sin tocar el `.env.local` de nadie:
`.env.<modo>.local` tiene prioridad sobre `.env.local`, así que
`pnpm dev --mode <modo>` con un `.env.<modo>.local` que fije `VITE_API_URL=http://localhost` alcanza.

**Paso 4 — el recorrido en el navegador (el «simular lo que pasó»).** Panel del harness en local, wizard
de asesor, header `X-Fake-Scenario: second-surname-mismatch`. Observar en la BD local
`users.first_name/surname` y `kyc_name_checks.passed/detail`. Tres trampas verificadas:

- **El fixture in-process le gana al fake HTTP.** `$useMock` se evalúa antes que `$useLambdaMock` y se
  prende con una setting de BD (`mock_rules`, código `MOBA1002`) que matchea por **teléfono**. Si el
  celular de prueba coincide, tu escenario nunca se llama.
- **Caché de 1 mes** (`$cacheDurationInMonths = 1`, `Experian.php:73`): la segunda corrida con el mismo
  usuario no reconsulta. Usuario nuevo por corrida, o borrar la fila de `risk_central_user_data`.
- **`shouldValidateTusDatos` es un contador en caché** con `personal_info_validation_error_max_attempts`
  (default 3): repetir con el mismo usuario deja de reintentar y el flujo corta antes de TusDatos.
- Y recordar: en local **el rechazo de Mareigua no se reproduce** (bypass); se llega a TusDatos con
  `MareiguaHttpFake::notFound()`.

**Paso 5 — el arreglo.** `=== null` en `TusDatosService.php:189`. Rama local
`fix/kyc-second-surname-mismatch` desde `main`, **sin push** (convención del playground). Correr pasos
3 y 4 en verde.

**Paso 6 — sacar el match de nombres de `APP_ENV`.** `onboarding.drivers.name_match = strict|bypass`
(default `strict`), leído por los 3 `verifyCoincidence`. Habilita la combinación que hoy no existe:
**fakes ON + match ESTRICTO** en runtime. Sigue el patrón que el repo ya estableció.

**Paso 7 — los dos daños colaterales (aparte, no bloquean).**

- **Credifamilia recibe el nombre sin partir.** `TransactionRequest.php:73-74` manda
  `nombre => first_name` / `apellido => surname`, y el REST `Credifamilia.php:205-206` manda
  `primerNombre`/`primerApellido` igual — el campo se llama *primer*Apellido y le entran los dos. De
  **1.574** solicitudes de Credifamilia en estado 11 (2024-02 → 2026-08): **1.498 (95%)** con los dos
  apellidos en un campo, **1.240 (79%)** con los dos nombres juntos, **37 (2,4%)** con un solo nombre y
  un solo apellido — CANDIDA es una de esas 37. Contraste: el payload de los PDF de vinculación **sí**
  parte bien (`PayloadFormatters::splitGivenNames`/`splitSurname`).
- **El pagaré duplica un apellido único.** `Modules/Loans/App/Actions/DecevalSoap.php:283-284` usa
  `Str::before` / `Str::after`, y `Str::after` devuelve **la cadena completa** si no encuentra el
  separador (verificado contra el vendor: `Str::after("LICONA", " ")` → `"LICONA"`). Con `surname =
  "LICONA"` sale `primerApellido_Nat=LICONA` **y** `segundoApellido_Nat=LICONA`. La traza de 519533
  confirma que el girador se creó y el pagaré se firmó. Engancha con el `SDL.DA.0439` del nodo `deceval`:
  el registro de giradores es nacional y rechaza por conflicto de identidad.

**Paso 8 — registrar.** F-xx en `findings` para el `0 == null` y para el `Str::after`. Y actualizar el
nodo `kyc`: hoy dice que `verifyCoincidence` siempre da `true` en local, pero **no** dice que eso hace
irreproducible el match estricto — que es la razón de fondo por la que el bug sobrevivió.

## Decisiones abiertas (son de Miguel, no de código)

- **¿Se corrigen los datos ya guardados?** 198 validaciones pasaron con mismatch declarado; 1.498
  radicaciones con los dos apellidos en un campo. Es decisión de producto/riesgo.
- **¿El reporte vino de Credifamilia o de nuestra BD?** Si vino de ellos, el Paso 7 sube de prioridad
  por encima del Paso 6.
- **No se puede afirmar el nombre legal de ninguna de las dos.** Para ANDREA hay dos fuentes
  independientes diciendo `NEMPEQUE` (Mareigua lo devolvió, TusDatos dijo que el nuestro no coincide).
  Para CANDIDA no hay ninguna: ninguna central se consultó.

## Cómo se verificó (2026-08-13, contra prod)

- `trazador -sql` (Redash, solo lectura): `users`, `user_requests`, `kyc_name_checks`,
  `risk_central_user_data`, `user_summaries`, `logs` (request/response de la radicación SOAP y del
  payload de vinculación), e `information_schema` para confirmar que `users` solo tiene `first_name`,
  `surname`, `full_name`.
- `trazador -ureq 519533` y `-ureq 523201`: trazas por etapas (BD + Loki).
- `trazador -query` sobre Loki: `validateAndStorePersonalInfoOrchestrator` como puerta de entrada;
  `Validación MRZ back` → **0 líneas en 7 días** (esa ruta de OCR no corre en prod en esta ventana).
- `git diff --stat origin/main` sobre los 4 archivos clave → **idénticos a `main`**; re-verificado tras
  el fetch a `9a972697`.

## Tarea (publicable)

Un cliente puede quedar registrado con el segundo apellido equivocado, aunque la central de
verificación de identidad haya avisado que no coincide.

La validación de identidad compara el nombre ingresado contra lo que reporta la central, campo por
campo. Está previsto y es correcto que un cliente **no tenga** segundo nombre o segundo apellido: en ese
caso el campo no se envía y no se exige coincidencia. El problema es que la validación trata
«el cliente no tiene ese apellido» y «ese apellido está mal» como si fueran lo mismo, y deja pasar el
segundo caso.

Consecuencia: la solicitud avanza con el nombre tal como se escribió, se firman los documentos con ese
nombre y se radica así ante la entidad financiera. En dos casos revisados la entidad aceptó el registro
sin observaciones, o sea que el error no se detecta en ningún punto posterior. Medición sobre las
verificaciones de identidad de las últimas tres semanas: **198** pasaron con una no-coincidencia
reportada en el segundo nombre o el segundo apellido.

Se corrige la comparación para que una no-coincidencia reportada se trate como error (el cliente ve el
mensaje y corrige antes de continuar), y se agrega la prueba automatizada del caso, que hoy no existe.

Pendiente de decisión: qué se hace con los registros ya guardados.
