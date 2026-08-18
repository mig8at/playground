---
id: 49
title: "Simular las centrales: tres mecanismos conviviendo → uno solo, dictado por header"
stage: work
created: "2026-08-15T13:30:00-05:00"
context_nodes: [kyc, harness, onboarding]
jira: []
jira_title: "Pruebas de originación: unificar la simulación de las centrales de riesgo"
---

**ESTADO 2026-08-15 · RESUELTO POR OTRO CAMINO, Y VERIFICADO EN STAGING.** El spike del header se
descarta entero; el mecanismo quedó en el lambda y **ya está desplegado y probado de punta a punta**.
Si volvés a esta tarea sin contexto, leé en este orden: § «Cómo se prueba HOY» → § «La respuesta de
Joel» → § «Lo que queda».

## Cómo se prueba HOY (la receta, verificada 2026-08-15 23:51Z)

Todo lo demás de esta tarea es historia. Esto es lo que sirve:

```bash
LAMBDA=https://ub79ck0htd.execute-api.us-east-2.amazonaws.com/development
API=http://legacy-backend-stg.inertia-develop
DOC=1077665544          # una cédula NUEVA cada corrida
CEL=3108000011          # un bypass LIMPIO (ver más abajo cómo elegirlo)

# 1· dictar qué responde cada central para esa cédula (sin token: el admin API está abierto)
curl -X POST "$LAMBDA/mockoon-admin/global-vars" -H 'Content-Type: application/json' \
  -d '{"key":"agildata_'$DOC'","value":"{\"codRespuesta\":\"16\",\"respuesta\":null}"}'
curl -X POST "$LAMBDA/mockoon-admin/global-vars" -H 'Content-Type: application/json' \
  -d '{"key":"mareigua_'$DOC'","value":"{\"respuesta_id\":4,\"primer_nombre_persona_natural\":\"CARLOS\",...}"}'

# 2· correr el flujo:  register → otp-validate (código = últimos 4 del teléfono) → personal-info

# 3· limpiar
curl -X POST "$LAMBDA/mockoon-admin/state/purge"
```

Claves por central: `agildata_<céd>` · `mareigua_<céd>` · `tusdatos_<céd>` ·
`experian_<céd>` / `experian_quanto_<céd>` / `experian_acierta_quanto_<céd>`.

**Las cuatro trampas que costaron intentos** — sin esto la receta no funciona:

1. **Caché de 1 mes.** Si el usuario ya tiene fila en `risk_central_user_data`, el backend la reusa y
   **ni llama al mock**. Cédula nueva cada corrida, o borrar la fila.
2. **Teléfono de bypass LIMPIO.** Reutilizar uno con solicitud abierta da
   `document number already in use`. Elegir así:
   `SELECT tel WHERE (SELECT COUNT(*) FROM users WHERE cell_phone=tel)=0` sobre
   `settings.qa_otp_bypass_phones` (35 teléfonos; el código OTP son sus últimos 4 dígitos).
3. **`otp-validate` devuelve el `user_request_id` dentro de `errors.payload`**, no de `payload`,
   cuando el usuario es temporal (`ONB005`→ en realidad `ONB002 "temporal user found"`). Parsear ahí.
4. **Mockoon no valida el JSON** que se le dicta: lo emite tal cual con `200`. Un JSON roto se lee
   después como «respuesta inválida del proveedor». Validar antes con `jq .`.

**Lo que esa corrida demostró** (traza completa en Loki, 23:51:28-29Z, solicitud 464879):

```
Agildata: calling lambda mock host        [source=lambda · 200]
AgilData inconclusive, will consult Mareigua        ← la cascada AVANZA
Mareigua: calling lambda mock host        [source=lambda · 200]
kyc.name_adoption  central=mareigua · decision=adopted · reason=within_tolerance
```

Se tecleó `RUIZ MENDOSA` y en `users` quedó **`RUIZ MENDOZA`**: la central corrigió la ortografía. Es
la primera vez que la regla de CORE-420 se ve funcionando en staging con datos controlados.

## Lo que se subió (todo mergeado y desplegado el 2026-08-15)

| repo | PR | qué |
|---|---|---|
| `legacy-backend` | #1108 | las 4 centrales loguean `risk_central.source` = `real`/`lambda`/`fixture`/`fixture_fallback`, y el mensaje cuando el lambda falla. Antes sólo Experian dejaba rastro |
| `risk-services-mockery-lambda` | #27 | dictar la respuesta por cédula: `{{#if getGlobalVar}}` en las 6 rutas + admin API condicionado a token |
| `risk-services-mockery-lambda` | #28 | admin API **encendido siempre**; el token sigue siendo opcional |

⚠ **El admin API del lambda quedó ABIERTO** (sin `ADMIN_API_TOKEN`). Decisión consciente: el stack es
`risk-services-mockery-development` —los dos workflows despliegan al mismo, no hay uno de producción—
y lo alterable son respuestas de mentira. **Para cerrarlo basta definir `ADMIN_API_TOKEN` en el
entorno del Lambda**, sin tocar código. El riesgo real no es un atacante: es que alguien dicte una
variable, no la limpie, y deje el mock respondiendo raro para todos.

Salió de la tarea 47 (KYC). Al buscar por qué una prueba en staging no concluía, aparecieron **tres**
mecanismos distintos para simular las mismas cuatro centrales, hechos por tres personas en tres meses.

## La respuesta de Joel (2026-08-15) — desmiente la premisa

Preguntado por los dos mecanismos, Joel —que mantiene el lambda— contestó dos cosas que dan vuelta
la tarea:

**1 · `mock_rules` NO se puede retirar.** No es un mock de centrales: es el mock del onboarding
**Mobile**, y existe porque **Apple y Google exigen un usuario de prueba** para revisar y aprobar la
app. Es un requisito externo con consecuencias reales. Textual: *«no lo puede retirar porque eso
mantiene el mock de mobile»*. El spike lo borraba.

**2 · El lambda es el mecanismo canónico, no duplicación.** *«La forma única de simular centrales ya
existe: es la lambda. Ese tiene todas las centrales, agildata mareigua y tus datos»*, y la vía para
casos nuevos es **agregar fixtures ahí** — *«mejor edite la lambda, es más viable»*. Es un repo propio
(`Creditop-SAS/risk-services-mockery-lambda`), creado por Yamid y mantenido por Joel. El spike también
lo borraba.

⚠ **Entonces el spike borra exactamente las dos cosas que hay que conservar.** Se descarta esa mitad.

### Y hay que ser honesto sobre el header

El argumento a favor era que el catálogo de escenarios es cerrado y global. Pero **el lambda recibe el
número de documento en todas las llamadas** (Ágil en la URL, las otras tres en el cuerpo), así que
puede variar la respuesta por cédula — y eso resuelve lo mismo:

| lo que se buscaba | por header | por el lambda |
|---|---|---|
| casos nuevos sin tocar el catálogo | sí | sí, agregando fixtures |
| combinaciones entre centrales | sí | sí, si la cédula manda en las tres |
| dos personas sin pisarse | sí | sí, cada una con su cédula |
| **funciona desde el front** | **NO** — muere en el SSR | **sí** — la cédula viaja igual |

La última fila decide: **el lambda ya resuelve el hueco de QA que el header no podía cerrar** sin
tocar el frontend. El header queda redundante con un lambda bien usado.

### Lo que SÍ vale rescatar del spike

- **Los 7 tests de cascada** — no dependen del header, se reescriben con `Http::fake` directo. Son la
  primera cobertura que existe de la cascada completa.
- **El hallazgo del `ValueError`** del `max()` con `detalladoEmpleos` vacío, que ningún `catch` agarra
  (`ValueError` extiende `Error`, no `Exception`).
- El inventario de los tres caminos y su precedencia, que queda documentado más abajo.

### La pregunta que faltaba — RESPONDIDA

**¿El lambda varía la respuesta según la cédula?** Sí: ya traía una regla para `1234512345` (Ágil y
Mareigua sin información) y ahora además se puede dictar cualquier respuesta en caliente.

**Y NO hacen falta variables de Dani para los mocks.** Ágil, Mareigua y Experian ya tienen su
`<CENTRAL>_MOCK_HOST` en staging — confirmado en la traza del 2026-08-15. *(Acá se afirmó dos veces
que «sólo Experian la tiene»; era falso, y salía de confundir «no hay log» con «no está configurado»
— exactamente el error que el PR #1108 vino a cerrar.)* De TusDatos no hay evidencia: no llegó a
correr.

## Los tres mecanismos que conviven hoy

| mecanismo | quién | cuándo | cómo se controla |
|---|---|---|---|
| `mock_rules` MOBA1002 | **José** | 2026-05-11 | fila en BD, **un** `phone_number` |
| lambda `*_MOCK_HOST` | **Joel** | 2026-06-03 | variable de entorno, servicio externo aparte |
| drivers fake + `X-Fake-Scenario` | **Miguel** | 2026-08-13 | variable + header por petición |

Los tres cuelgan de las mismas centrales y en `Agildata.php` convivían en veinte líneas, con una
precedencia que nadie escribió a propósito: primero `mock_rules`, después el lambda, después la red.
El de los drivers intercepta más arriba, en la capa HTTP, así que gana sobre los dos.

⚠ **El lambda de Joel está VIVO**: se lo vio responder en la traza de staging del 2026-08-15
(`Calling lambda mock host`). Es un cuarto origen posible de respuestas que no estaba en el mapa.

## Los dos límites del catálogo de escenarios

1. **Es GLOBAL.** `X-Fake-Scenario` lleva UN nombre por petición y cada central lo busca en su propio
   mapa. No se puede pedir «Ágil que no resuelva **y** Mareigua que devuelva datos erróneos».
2. **Es CERRADO.** Cada caso nuevo cuesta rama, PR y despliegue.

Y falla en silencio: si el escenario no está en el mapa de una central, `stubsFor()` cae a su
`success`. Un error de tipeo da camino feliz — es lo que originó `TUSDATOS_VERDICT_SCENARIOS`.

## Lo que hace el spike

**Borra** `mock_rules` y el lambda de las cuatro centrales, más `MobileMock` (una `Rule` que sólo
existía para dejar pasar el teléfono de mock; se reemplazó por `regex:/^\d{10}$/`, que es su
comportamiento real). ⚠ Se conserva el código `MOBA1002`: no es sólo del mock, de ahí cuelgan también
`api_rules`, `rate_limit_rules` y un mapeo de errores HTTP.

**Agrega** un header por central que dicta la respuesta:

```
X-Fake-Agildata: {"codRespuesta":"16","respuesta":null}
X-Fake-Mareigua: {"respuesta_id":2}
```

Tres decisiones de diseño que salieron al construirlo:

- **Pisa sólo el endpoint de DATOS**, no el del token ni el del polling de AML. Si pisara todo,
  cambiar un campo obligaría a reconstruir a mano el handshake de OAuth de Experian y Mareigua.
- **Un JSON inválido FALLA ruidoso**, no cae a `success`. Es la corrección del error que ya costó
  tiempo con TusDatos.
- **`kyc.fake.http_drivers_registered` ahora dice qué centrales vinieron dictadas por header**, así
  que en Grafana se puede responder «esa corrida, ¿qué simuló?».

**Y elimina DOS variables de entorno** (las dos, decisión de Miguel — el mismo criterio aplicado dos
veces: si el driver ya dice `fake`, lo demás se deduce):

- **`ONBOARDING_FAKES_ALLOW_HEADER`** — redundante. Si el entorno ya está simulando, elegir CUÁL
  respuesta sintética no es un permiso adicional. Las guardas que importan siguen: el driver en
  `fake`, y que la app **se niegue a arrancar** con fakes bajo `APP_ENV=production`.
- **`ONBOARDING_FAKES_DEFAULT_SCENARIO`** — poner `fake` YA significa «camino feliz por defecto», y
  una variable que dejara un ambiente entero fallando por omisión es una trampa, no una función.
  ⚠ **La CLAVE de config se conserva** (`'default_scenario' => 'success'`): es el único punto de
  inyección donde no hay petición —consola, colas, crons— y **cuatro archivos de tests la usan** con
  `config()->set()` para forzar `provider-down` y los subcódigos de OTP.

De nueve variables quedan **siete**, y de esas sólo seis son perillas reales.

Cabe en un header: medido sobre las 169.977 respuestas reales de Ágil en producción, la mediana pesa
**~1 KB** y **sólo una** supera los 8 KB del límite típico. Y como `additional_info` se guarda sin
cifrar, se puede tomar una respuesta real de prod y reproducirla tal cual.

## Verificación

**0 tests rotos** de 509, con la base reconstruida antes de cada corrida y comparación test por test
con salida JUnit. Que borrar los dos mecanismos no rompiera nada dice algo por sí solo: **no había un
solo test que los cubriera**.

14 tests nuevos: 6 del mecanismo y **7 de la cascada real**, atravesando los servicios de verdad —

| caso | qué fija |
|---|---|
| Ágil no resuelve (cód 16) | `errors => null` → la cascada AVANZA |
| Ágil no resuelve **+** Mareigua erróneo | la combinación que el catálogo no puede expresar |
| Ágil no resuelve + Mareigua sí | se adopta el nombre de Mareigua |
| Ágil resuelve y coincide | corta la cascada |
| Ágil resuelve con un typo | **adopta** su ortografía |
| Ágil resuelve con otra persona | el techo protege, no adopta |
| Ágil resuelve **sin empleos** | `ValueError` del `max()`, que el `catch (\Exception)` NO agarra |

El último apareció solo al escribir los otros. Era un defecto teórico —el censo dice 0 de 131.046 en
dos años— y el header lo volvió reproducible en una línea. Es el mejor argumento a favor del cambio.

## Cómo prueba QA por el front (⚠ corregido dos veces)

**Primera versión, equivocada:** «una extensión tipo ModHeader resuelve el caso porque el front llama
al backend directamente». **Falso.** El wizard es **React Router v7 en modo framework — SSR**: el
navegador manda un `form POST` a una `action` que corre en el SERVIDOR, y esa action llama a
legacy-backend con headers propios. `buildBackendAuthHeaders` arma **exactamente uno**
(`x-cognito-identity-id`) y no reenvía nada de la petición entrante. Un header puesto en el navegador
muere en el SSR.

**Y el hueco es más chico de lo que parecía** (observación de Miguel): con los drivers en `fake` y el
escenario por defecto en `success`, **QA tiene camino feliz determinista por el front sin tocar un
solo header**. Las cuatro centrales responden lo mismo siempre. Los headers quedan sólo para casos
específicos.

Eso reordena la prioridad: lo del SSR deja de ser bloqueante y pasa a ser mejora.

| qué | cómo se resuelve |
|---|---|
| camino feliz por el front | **variables de Dani, sin código** |
| casos específicos por API | el header — ya funciona |
| casos específicos por el front | pendiente: reenvío en el SSR |

**Y el reenvío en el SSR es viable en un solo punto.** El nodo `frontend-monorepo` avisa que NO hay
cliente HTTP único —34 de 49 repositorios usan `fetch` crudo, sólo 13 usan `HttpClient`— pero
`installObservedFetch()` (`observed-fetch.server.ts:24`, invocado en `entry.server.tsx:18`)
**monkey-patchea `globalThis.fetch` en el servidor**: todo lo que sale pasa por ahí. Y ya existe
`AsyncLocalStorage` (`trace-context.server.ts`, `route-logging.server.ts`) para propagar contexto por
petición, que es justo lo que haría falta para llevar los `X-Fake-*` desde la entrada hasta la salida.
Cambio chico, un archivo, sobre rieles ya tendidos — pero **es otro repo y otro PR**.

⚠ **No borrar `mock_rules` hasta que 1 y 3 estén andando.** Si no, queda una ventana donde QA no
tiene con qué simular desde el front.

## DECISIÓN (Miguel, 2026-08-18): los drivers fake de BURÓS quedan sin usar

Los `Http::fake` de las centrales los hizo Miguel para poder inyectar por inyección de dependencias
cuando no había otra forma de probar. Después Yamid hizo el lambda, que **cumple el mismo objetivo y
mejor**: se le pide de antemano qué contestar POR CÉDULA, sin reiniciar ni desplegar, y sirve igual en
local que en staging. Teniendo los dos, mantener ambos es cargar una precedencia que nadie declaró —
y que ya costó: los drivers ganan sobre el lambda porque interceptan más arriba, así que con ellos
prendidos lo que se dicta **no llega y el flujo igual termina bien** (F-139).

**Queda:** las cuatro `ONBOARDING_DRIVER_{EXPERIAN,MAREIGUA,AGILDATA,TUSDATOS}` **se quitan del
`.env`** —no se ponen en `real`— y los cuatro `*_MOCK_HOST` apuntan al lambda.

⚠ **Quitarlas y ponerlas en `real` NO son lo mismo aunque resuelvan igual.** `config/onboarding.php`
ya usa `'real'` como default (`env('ONBOARDING_DRIVER_EXPERIAN', 'real')`), así que la línea explícita
resuelve al mismo valor pero **dice otra cosa**: sugiere un override deliberado que no existe. Los
ambientes desplegados no las tienen, y local tiene que verse igual — si no, el próximo que compare
dos `.env` cree que hay una diferencia de configuración donde no la hay. Verificado corriendo, ya SIN las variables: ingresos dictados 3.300.000 y 11.000.000 quedaron
exactamente así en `user_summaries`, con dos `Calling lambda mock host` en Loki.

⚠ **NO toca los drivers de OTP ni de CACHE**, que siguen en `fake`. El de OTP **no pasa por
`Http::fake`** —va por el driver del contenedor— así que el lambda no lo reemplaza, y sus escenarios
(`otp.success`, `otp.invalidCode`, `otp.expired`…) siguen siendo el único mecanismo.

**Lo que cuesta, y hay que decidir aparte:** cuatro specs del harness inyectan escenarios de BURÓS y
dependen de los drivers — `channel/kyc-subcodes.spec.ts` (OBS-KYC-03, fuerza cada sufijo `ONB005`),
`channel/kyc-ui.spec.ts`, `e2e/happy-path.spec.ts` y `merchant/motai.spec.ts`. Con los drivers en
`real` esa inyección no ocurre. Lo que esos specs cubren y el lambda todavía no replica son los
caminos de ERROR con nombre (`tusdatos.nameMismatch`, `experian.serverError`, `kyc.dateMismatch`): el
lambda dicta el CONTENIDO de la respuesta, y forzar un 500 del proveedor o un mismatch pide otra
receta. **Migrarlos o dejar los drivers prendidos sólo para esa suite es lo que queda abierto.**

## Lo que NO se tocó, y por qué

Los escenarios con nombre. **El harness los usa en 9 archivos con 13 escenarios**
(`otp.success`, `tusdatos.nameMismatch`, `kyc.dateMismatch`, `experian.serverError`…). Y los de OTP
**no pasan por `Http::fake`** —van por el driver del contenedor—, así que ahí el nombre sigue siendo el
único mecanismo. Borrarlos rompe E2E que ya funcionan.

Propuesta: el header es el camino para casos nuevos; los escenarios quedan como recetas de lo que ya
se usa. Cuando el harness migre, se borran los de burós. Los de OTP se quedan.

## Lo que QUEDA (estado al cerrar el 2026-08-15)

**Sin commitear en `legacy-backend`** — hay que decidir qué se hace:

- Rama **`spike/fake-response-por-header`** + un `git stash` («spike-completo»): el borrado de
  `mock_rules`/lambda y el mecanismo del header. **Se descarta entero** — Joel desmintió la premisa y
  el lambda resolvió el problema mejor. Tirar rama y stash.
- **6 tests + fixtures que SÍ valen**, sin PR:
  `Modules/Identity/tests/Feature/Services/CascadaConFixturesDelLambdaTest.php` y
  `Modules/Identity/tests/Fixtures/lambda-riskservices.json`. Son la cascada contra los fixtures
  reales del lambda —copiados de su `riskservices.json` con las plantillas de Mockoon resueltas a
  valores fijos— y pasan sobre `staging` limpio. Requieren mockear `MobileOnboardingSettingsService`
  en el `beforeEach`, si no `mock_rules` corta antes con «<central> no se encuentra disponible».

**De terceros:**

- **Joel** — el lambda de **Experian** falló **25 de 55 veces** en 30 días en staging: 18 con
  `500 {"error":"boom"}` y 7 con `404` devolviendo HTML. Ese `boom` **no está** en su
  `riskservices.json` de `main`, así que puede haber otra versión desplegada. Quedó preguntado en el
  PR #27.
- **Dani** — `SUPPORT_BOT_TOKEN` en staging (es de la tarea 46, no de ésta; las 16 rutas del canal de
  WhatsApp responden `CHANNEL_NOT_CONFIGURED` desde el 2026-08-14). ⚠ **NO le pidas las variables de
  mocks**: ya están.
- **Duncan** — todavía no se le preguntó nada. Con el lambda ya no hace falta la extensión de
  navegador: la cédula viaja sola desde el front, así que puede probar sin nada extra.

**Mejoras chicas, si duelen:**

- Documentar la receta en el README del lambda, sobre todo **la caché de un mes** — es la trampa que
  hace parecer que el mecanismo no funciona.
- La línea `lambda mock responded` no lleva `risk_central.source`, sólo `response.status`. Un panel
  que filtre por esa etiqueta ve los inicios y los fallos, pero no los éxitos.
- `mock_rules` sigue **sin un solo test** que lo cubra, y sostiene el mock de Mobile que Apple y
  Google exigen. Es el mecanismo más frágil de los tres y el de mayor consecuencia si se rompe.

## Tarea (publicable)

Hoy existen tres formas distintas de simular las respuestas de las centrales de riesgo para probar el
flujo de originación. Se construyeron por separado, se solapan y ninguna está cubierta por pruebas
automáticas, lo que hace difícil saber qué está simulado y qué es real en cada ambiente.

Se propone dejar una sola forma: que quien ejecuta la prueba indique, en la propia petición, qué debe
responder cada fuente de información. Con eso se pueden construir casos que hoy no se pueden expresar
—por ejemplo, que una fuente no encuentre a la persona y la siguiente devuelva datos incompletos— sin
necesidad de un despliegue por cada caso nuevo.

Beneficios: se elimina código duplicado, se reduce el riesgo de que una prueba pase por un camino
distinto al esperado, y queda registrado en el monitoreo qué se simuló en cada ejecución.

Pendiente de acordar con el equipo el impacto en las pruebas manuales y con quienes construyeron los
mecanismos actuales.
