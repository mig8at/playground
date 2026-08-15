---
id: 49
title: "Simular las centrales: tres mecanismos conviviendo → uno solo, dictado por header"
stage: work
created: "2026-08-15T13:30:00-05:00"
context_nodes: [kyc, harness, onboarding]
jira: []
jira_title: "Pruebas de originación: unificar la simulación de las centrales de riesgo"
---

**ESTADO 2026-08-15 · SPIKE DESCARTADO EN SU PARTE DE BORRADO.** Joel contestó y desmintió la premisa:
las dos cosas que el spike borraba **hay que conservarlas**. Lo que queda por rescatar son los tests.
Ver § «La respuesta de Joel» — es lo primero que hay que leer de esta tarea.

Rama `spike/fake-response-por-header` en `legacy-backend`, local, **sin commitear**, 16 archivos.

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

### La única pregunta que falta

**¿El lambda ya varía la respuesta según la cédula?** Si sí, **no hay nada que construir**: la tarea se
cierra documentando cómo usarlo, y lo único pendiente son las variables de Dani para que staging lo
use. Si no, hay trabajo — pero en el repo del lambda, no en `legacy-backend`.

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

## Lo que NO se tocó, y por qué

Los escenarios con nombre. **El harness los usa en 9 archivos con 13 escenarios**
(`otp.success`, `tusdatos.nameMismatch`, `kyc.dateMismatch`, `experian.serverError`…). Y los de OTP
**no pasan por `Http::fake`** —van por el driver del contenedor—, así que ahí el nombre sigue siendo el
único mecanismo. Borrarlos rompe E2E que ya funcionan.

Propuesta: el header es el camino para casos nuevos; los escenarios quedan como recetas de lo que ya
se usa. Cuando el harness migre, se borran los de burós. Los de OTP se quedan.

## Antes de subir

- **José** — ¿`mock_rules` MOBA1002 se está usando? Es de mayo y lo leen las cuatro centrales. Cero
  tests rotos no significa cero uso: significa que nadie lo cubrió.
- **Joel** — ¿los `*_MOCK_HOST` apuntan a algo vivo? Uno respondió en staging el 2026-08-15.
- **Duncan** — ¿le sirve una extensión de navegador para inyectar el header?
- Y **separarlo en dos PRs**: el borrado y el header son decisiones distintas —una es de terceros, la
  otra es de Miguel—. Mezclados, si alguien objeta el borrado se cae también el header.

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
