---
id: 49
title: "Simular las centrales: tres mecanismos conviviendo → uno solo, dictado por header"
stage: work
created: "2026-08-15T13:30:00-05:00"
context_nodes: [kyc, harness, onboarding]
jira: []
jira_title: "Pruebas de originación: unificar la simulación de las centrales de riesgo"
---

**ESTADO 2026-08-15 · SPIKE HECHO, LOCAL, SIN COMMITEAR.** Rama `spike/fake-response-por-header` en
`legacy-backend`, 16 archivos. Verificado: **0 tests rotos** de 509, 14 nuevos en verde. Falta hablar
con José y con Joel antes de subir nada — y resolver el hueco de QA por el front (§ «El hueco»).

Salió de la tarea 47 (KYC). Al buscar por qué una prueba en staging no concluía, aparecieron **tres**
mecanismos distintos para simular las mismas cuatro centrales, hechos por tres personas en tres meses.

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

**Y elimina `ONBOARDING_FAKES_ALLOW_HEADER`** (decisión de Miguel): era redundante. Si el driver ya
dice `fake`, ese entorno ya está simulando; elegir CUÁL respuesta sintética no es un permiso
adicional. Las guardas que sí importan siguen en pie: el driver en `fake`, y que la app **se niegue a
arrancar** con fakes bajo `APP_ENV=production`.

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

## El hueco: QA por el front

⚠ **Borrar `mock_rules` quita el único mecanismo que funcionaba desde el navegador.** El header lo
manda quien llama, y el navegador no manda headers propios.

El front llama al backend **directamente** desde el navegador (`VITE_API_URL`, `VITE_GATEWAY_URL`), así
que una extensión tipo ModHeader o Requestly resuelve el caso: Duncan pone el header ahí y navega
normal. Es la práctica estándar de QA y no necesita nada del servidor.

⚠ Un **comando de consola NO resuelve esto**: corre del lado servidor, y al haber borrado el estado en
BD no queda dónde dejar la selección. Si se quisiera esa vía habría que reintroducir estado
compartido — que es justo lo que se está sacando, y que además hace que dos personas probando se
pisen (`mock_rules` tiene UN solo `phone_number`).

**Hay que confirmarlo con Duncan antes de subir.** Si la extensión no le sirve, la alternativa es que
el front reenvíe el header desde un parámetro de URL o `localStorage` — pero eso es un cambio en el
front y otra tarea.

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
