---
id: 50
title: "La suite de tests puede borrar la base de datos compartida, y el trait que lo hace ni siquiera funciona"
stage: evaluation
created: "2026-08-18T18:30:00-05:00"
context_nodes: [findings]
jira: [CORE-431]
jira_title: "Blindar la suite de pruebas para que no pueda borrar la base de datos de un ambiente"
---

# La suite de tests puede borrar la BD compartida
> 🔴🔴 **PASÓ DE VERDAD — 2026-08-19, 15:43:33 UTC (10:43 hora local): la BD compartida de dev+staging
> quedó VACÍA.** Ya no es una vulnerabilidad teórica: es un incidente medido. La predicción de esta
> tarea se cumplió al pie de la letra, incluida la parte de que **la re-migración falla a mitad**.
>
> **Evidencia (tomada en caliente, antes de cualquier restore):**
> - `information_schema`: `allieds`, `users`, `user_requests` y `migrations` tienen `CREATE_TIME`
>   **2026-08-19 15:43:33–15:43:42 UTC**. Fueron recreadas, no vaciadas.
> - `migrations`: **todas `batch = 1`** — un `migrate` desde cero. Se lo vio **avanzar en vivo**: 19
>   filas en la primera medición y **184** minutos después, y ahí **se detuvo** (tres muestras
>   separadas 15s, sin moverse). Producción lleva **426**, así que quedó en el **43%**.
> - La última aplicada es `2024_11_21_170930_create_colombian_holidays_table`: la migración **185** es
>   donde se plantó.
> - **147 tablas** creadas de las que debería haber, y **cero datos**: `SELECT COUNT(*) FROM allieds`
>   → **0** con la tabla ya existiendo. `GET /api/loans/allied/{hash}` → **404** para hashes que 20
>   minutos antes devolvían 200 con datos completos.
> - Eso es exactamente «entrega la mitad destructiva y no la restaurativa», sólo que el punto de muerte
>   **no** es el que midió esta tarea contra una base desechable (207 de 358, por
>   `initial_fee_percentage`). Acá se plantó mucho antes, en la 185 — o sea que **hay más de un punto de
>   falla** en la cadena de migraciones, y el diagnóstico previo se quedó corto.
>
> **Qué NO fue** (descartado con medición, no por descarte lógico):
> - **no fue un deploy**: el de `legacy-application` a dev (PR #68) usa `deploy-multi-service.yaml`, que
>   no tiene paso de migraciones, y corrió **15:17:55 → 15:24:15 UTC**, 19 minutos ANTES;
> - **no fue CI**: cero corridas de Actions en `legacy-backend` y `legacy-application` en la ventana
>   15:35–15:50 UTC;
> - **no fue el harness**: Playwright no tiene `globalSetup` ni `webServer` activos, y los specs que
>   corrieron esa mañana (`warm-session`, una sonda de navegación) no importan nada de BD.
>
> Por descarte y por firma, **alguien corrió la suite PHPUnit desde su máquina contra el host
> compartido** — el camino que esta tarea describe: `phpunit.xml` fija `DB_DATABASE=testing` sólo si la
> variable no viene ya puesta, y **`DB_HOST` no lo fija nunca**.
>
> ✅ **Producción intacta** (verificado el mismo día: 326 comercios, 530.376 solicitudes, 426
> migraciones). ⚠ **Staging cae con dev**, porque comparten esta misma base.
>
> **Desde cuándo existe el agujero** (medido en `legacy-backend`, contra `origin/main`):
> - `Modules/Loans/tests/Unit/CreditopXDatacreditoAdjustmentServiceTest.php` — el trait entró el
>   **2026-01-09** (`c208156a`, Jose Escobar, «Develop (#244)»): **7 meses**.
> - `Modules/Loans/tests/Feature/SafeCancelTest.php` — el **2026-04-29** (`d98bf553`, hans peter,
>   «Evitar cancelar creditos en estado 11»): **4 meses**.
> - Y lo que los deja llegar a una base real es más viejo que los dos: `phpunit.xml` trae
>   `DB_DATABASE=testing` desde el **init del proyecto, 2025-06-25** (`47a50dca`), y **nunca tuvo
>   `DB_HOST`** — `git log -S 'DB_HOST' -- phpunit.xml` no devuelve **ningún** commit. El host siempre
>   fue el del `.env`. O sea: **el agujero tiene 14 meses**; lo nuevo es que alguien pasó por él.
>
> 📄 **Documento de arranque para el análisis del equipo**, corto y con las rutas exactas:
> `data/artifacts/tests-pueden-borrar-la-bd-compartida.hipotesis.md`. Está escrito **como hipótesis,
> no como prueba reina** — describe el camino que existe y alcanza, con los 3 archivos, la cadena de 4
> eslabones, qué encaja con lo observado y cómo confirmarlo o descartarlo. Deliberadamente **no nombra
> a nadie**: el punto es el mecanismo, que lleva 14 meses abierto y es invisible para quien lo pisa.
>
> 🔎 **Barrido de los 11 `.env` del playground (`make env-auditoria`, nuevo el 19/08).** Imprime cada
> clave con los **3 primeros caracteres** del valor —alcanza para distinguir `loc`alhost de
> `ine`rtia-dev, no alcanza para usar un secreto— y clasifica por riesgo. Destapó **un choque de nombres
> que nadie había visto**:
>
> `trazador/.env.{dev,staging,local}` definía sus variables **sin prefijo**: `DB_HOST`, `DB_PORT`,
> `DB_NAME`, `DB_USER`, `DB_PASS`. Las dos primeras son **exactamente** los nombres que lee Laravel
> (`config/database.php`), y apuntaban al RDS compartido. Un `set -a; . trazador/.env.dev` —el patrón
> que este mismo repo documenta como trampa— dejaba `DB_HOST` exportado, y a partir de ahí **cualquier
> `artisan` en esa terminal heredaba el host compartido**. Las credenciales no colisionan
> (`DB_USER`≠`DB_USERNAME`), así que por sí solo no completaba la cadena; pero era el ingrediente que
> convierte «cargué un archivo de configuración» en «mis comandos apuntan a otro lado».
>
> ✅ **Corregido el 19/08**, y salió gratis: `trazador/server/main.go` ya aceptaba los dos nombres
> (`alias` mapea `dbHost` → `{"DB_HOST", "E2E_DB_HOST"}` y `pick()` recorre la lista entera), así que
> **el arreglo fue renombrar las claves en los 3 archivos a `E2E_DB_*` — cero cambios de código**. Se
> dejó un aviso en la cabecera de cada archivo explicando por qué el prefijo no se saca. `harness/` ya
> usaba el prefijo y por eso nunca tuvo el problema.
>
> ⚠ **Lo que el barrido NO puede arreglar y sigue en rojo:** las 6 entradas donde el usuario de BD es
> `admin` (el maestro del RDS) o `root`. Eso es cambio de infraestructura, no de archivo.
>
> 🚧 **CORE-431 está EN PROGRESO desde el 2026-08-19** (verificada contra Jira vivo: existe, «Blindar la
> suite de pruebas…», Tarea, 3 pt; estaba «Por Hacer» en backlog y se movió con `jira-move`). Los
> `Ref: CORE-431` de los commits y el «Ver CORE-431» del mensaje de la guarda apuntan a ese ticket.
>
> ✅ **Los DOS PR del arreglo están abiertos (2026-08-19), con revisor pedido (Joelsrh23):**
> - `legacy-backend` **#1140** — borra los 2 tests destructivos **y** agrega la guarda
>   (`fix/CORE-431-remove-destructive-db-tests`, 1 commit, +87/−534).
> - `legacy-application` **#70** — la guarda + `phpunit.xml` endurecido, sin borrar nada
>   (`fix/CORE-431-lock-test-database`, 1 commit, +92/−1).
>
> **La guarda quedó VALIDADA reproduciendo el incidente** sobre un schema local desechable
> (`creditop_guardtest`, réplica de 244 tablas): sin guarda, el mismo ataque lo dejó en 160 tablas y 0
> países — el incidente en miniatura; con guarda, **9 vectores bloqueados en los dos repos** (incluido
> `docker exec -e DB_DATABASE=creditop` dentro del contenedor, el que derrota al `phpunit.xml`) y el
> schema intacto. Los tests legítimos siguen pasando (SupportBot `OK` dentro del contenedor).
> **Hallazgo de la validación: el `force="true"` de PHPUnit NO protege** — escribe `putenv()`/`$_ENV`
> pero no `$_SERVER`, y el `env()` de Laravel lee `$_SERVER` primero. La única protección real es la
> guarda, que lee la config ya resuelta.
>
> 🔴 **Lo que los PR NO cierran, y es de infra:** `make fresh` / `artisan migrate:fresh` a mano no pasan
> por el bootstrap de tests. Se cierra con las cuentas acotadas sin `DROP` (+ rotar contraseña, separar
> dev de staging, y arreglar `run-migrations.yml`). Las cuatro están enumeradas en la descripción de los
> dos PR para que infra las lea ahí.
>
> 👉 **Esto reabre la prioridad**: la tarea estaba en backlog «hasta aterrizar bien la vulnerabilidad».
> Ya se aterrizó sola, con un ambiente compartido caído.

> **estado (2026-08-18):** ⏸ **CORE-431 creada y SACADA del sprint**, a pedido de Miguel: se queda en el
> backlog hasta aterrizar bien la vulnerabilidad. El ticket conserva descripción y 3 puntos; no se borró
> (borrar un issue de Jira es permanente y no hay papelera). Para volver a meterla al sprint, alcanza con
> arrastrarla desde el backlog.
>
> 🔴 **El hallazgo en sí sigue abierto y medido corriendo.** Salió al preparar el PR del canal de
> WhatsApp: antes de correr los tests del módulo revisé cuáles tocaban la base, y apareció que la única
> barrera que separa la suite de una base real es condicional. Al medirlo apareció algo mejor: **el trait
> destructivo no puede funcionar en este repo**, así que quitarlo no cuesta nada.

## En una frase
`RefreshDatabase` borra todas las tablas y después migra desde cero; **en este repo migrar desde cero
falla**, así que entrega su mitad destructiva y no la restaurativa — y lo único que le impide apuntar a
la base de dev y staging es una protección que se omite en silencio.

## Los tres hechos, medidos

**1 · La protección es condicional, y no cubre el host.**
`phpunit.xml:30` declara `<env name="DB_DATABASE" value="testing"/>`. No hay `<env>` para `DB_HOST`,
`DB_USERNAME` ni `DB_PASSWORD`: **el servidor es siempre el del `.env`**. Y el override del nombre es
condicional — PHPUnit 10.5.63, en
`vendor/phpunit/phpunit/src/TextUI/Configuration/PhpHandler.php:112`:

```php
if ($force || getenv($name) === false) {
    putenv("{$name}={$value}");
}
```

El `phpunit.xml` **no usa `force`**, así que si `DB_DATABASE` ya viene del entorno PHPUnit la respeta.
Eso pasa exactamente donde más duele: un `docker exec -e DB_DATABASE=…`, o un contenedor de ECS, donde
la task definition inyecta esas variables.

**2 · 🔴 `RefreshDatabase` no puede funcionar acá — y falla DESPUÉS de borrar.**
El trait corre `migrate:fresh`
(`vendor/laravel/framework/src/Illuminate/Foundation/Testing/RefreshDatabase.php:73`), que **primero
borra todas las tablas** y después migra desde cero. Medido contra una base vacía y desechable: `migrate`
aplica **206 migraciones y muere** en la 207 de 358 —
`2025_02_12_212827_add_insurance_per_million_to_lenders_by_allieds` — con
`SQLSTATE[42S22]: Unknown column 'initial_fee_percentage' in 'lenders_by_allieds'`: la migración depende
de una columna que ninguna migración anterior crea.

O sea que correr uno de esos tests contra cualquier base **la destruye, deja 206 tablas a medio armar sin
datos, y encima falla**. Se paga el costo entero y no se obtiene ni un test que pase. Esos dos tests no
pueden estar pasando hoy, en ningún ambiente.

**3 · El censo real: son 2 archivos de 140, no una plaga.**
De **140 archivos de test** en `develop`, solo **2** usan `use RefreshDatabase;` de verdad:

| archivo | ubicación | por qué toca la BD |
|---|---|---|
| `Modules/Loans/tests/Feature/SafeCancelTest.php` | correcta (Feature) | — |
| `Modules/Loans/tests/Unit/CreditopXDatacreditoAdjustmentServiceTest.php` | ⚠ **mal ubicado en `tests/Unit`** | el servicio consulta la BD por dentro (ver abajo) |

⚠ Ojo con el conteo: **`grep -l RefreshDatabase` da 7 y es un falso positivo**. Los otros 5 solo la
mencionan — en `tests/Feature/ExampleTest.php` está **comentada** (es el scaffold de Laravel) y en el
resto lo que aparece son imports de modelos. Hay que grepear `^\s+use RefreshDatabase;`, no el nombre.

## El equipo ya tomó la decisión correcta, y está escrita en el código
`Modules/SupportBot/Tests/Unit/ClientLookupServiceTest.php` usa **`DatabaseTransactions`** y lo explica en
una línea: *«DatabaseTransactions y no RefreshDatabase: las migraciones del repo no corren desde cero»*.
Y `Modules/Loans/tests/Unit/CreditopXFlowServiceValidationTypeTest.php` va un paso más allá: **mockea el
repositorio**, dice en su docblock *«All tests are pure unit tests — no DB required»* y **deja marcados
como pendientes de nivel Feature** los tests de restricciones que sí necesitan base. Ese es el reparto
correcto, y ya está articulado adentro del repo. Lo que queda es residuo viejo.

## Por qué el test mal ubicado necesita una base (y es un síntoma, no una necesidad)
No la necesita por la conducta que verifica: la necesita porque
`CreditopXDatacreditoAdjustmentService::calculateAdjustment()` **hace sus propias consultas**. El test
tiene que sembrar con `DB::table('lenders')->insertGetId(…)`, `user_requests` y
`creditop_x_requests_history` para que el servicio encuentre algo. Un servicio que recibiera un
repositorio se probaría con un doble, sin base — exactamente lo que hace su vecino
`CreditopXFlowServiceValidationTypeTest`. **La dependencia de BD en un test unitario es casi siempre un
diagnóstico sobre el código, no sobre el test.**

## Radio de impacto, medido el 2026-08-18
La base `inertia-dev` sirve **dev y staging a la vez** (es la misma) y tiene **262 tablas, 227.796
usuarios, 360.843 solicitudes y ~24 GB**. Perderla frena al equipo y a QA, y se lleva los datos sembrados
de cada prueba en curso. Y como las migraciones no corren desde cero, **no se puede reconstruir migrando**:
habría que restaurar de un backup.

## Qué tan cerca estuvo
Hoy, en esta sesión, corrí `php artisan` dentro del contenedor `legacy-backend-laravel.test-1` con
`-e DB_HOST=<inertia-dev> -e DB_DATABASE=creditop -e DB_USERNAME=admin -e DB_PASSWORD=…` para aplicar las
migraciones de países a staging. **En ese mismo contenedor, con esas mismas variables exportadas, vive
`./vendor/bin/pest`.** Un `pest` ahí habría corrido `migrate:fresh` contra dev+staging. Lo único que lo
evitó fue revisar los traits **antes** de ejecutar.

## Lo que NO es
- **No es un agujero de CI.** Verificado: ningún workflow de `legacy-backend` corre la suite, y el
  `sonarcloud.yaml` de `config-ci` tampoco ejecuta tests ni toca variables de BD. **El disparador es
  humano**, y por eso el arreglo va en el código, no en el pipeline.
- **No es teórico por falta de credenciales.** Las de admin de esa base están en `.env.*` locales de las
  herramientas: cualquiera con el repo las tiene.

## El arreglo, en el orden en que conviene hacerlo
1. **Erradicar `RefreshDatabase` de los 2 archivos.** Es gratis: no pueden estar pasando hoy. Donde haga
   falta base, `DatabaseTransactions`, que **revierte en vez de borrar** — la decisión que el test del bot
   ya tomó.
2. **Al test mal ubicado, quitarle la base atacando la causa**: inyectarle un repositorio al servicio y
   probarlo con un doble. Si eso no entra en el alcance, moverlo a `Feature/` para que su nombre no
   mienta.
3. **Una guarda que falle cerrado en el `TestCase` base**: antes de cualquier test, si el host de BD
   resuelto no está en una lista blanca de destinos locales, abortar explicando por qué. Es lo único que
   protege sin depender de que alguien mantenga una configuración al día. Misma filosofía que el token del
   canal de WhatsApp: lo desconocido endurece.
4. **`force="true"` en las variables de BD de `phpunit.xml`**, y agregar `DB_HOST`, `DB_USERNAME` y
   `DB_PASSWORD`. Cierra el agujero del entorno, pero sigue siendo una lista que hay que mantener: va
   después de la guarda, no antes.

⚠ **`DatabaseTransactions` baja el radio pero no es licencia para apuntar a una base compartida:** el
rollback no devuelve los `AUTO_INCREMENT` consumidos, cualquier DDL hace commit implícito y se escapa de
la transacción, y nada de lo que vive fuera de la base (caché, colas, archivos) se revierte. Sirve para
que un test no destruya; no para que sea sano correrlo contra datos de otros.

## 🔴 Hallazgo aparte que esto destapó
**La cadena de migraciones está rota desde la 207 de 358.** Nadie puede levantar un ambiente nuevo
migrando desde cero: hay que partir de un dump. Eso vuelve imposible cualquier estrategia de «base
desechable creada por migraciones» —incluida la del punto 3— hasta arreglarlo. Merece su propia tarea; el
error exacto está arriba.

## Cómo se verifica el arreglo
Reproducir el caso: exportar `DB_DATABASE` y un `DB_HOST` que no sea local, correr la suite, y comprobar
que **aborta** en vez de conectar. Contra una base desechable, nunca contra `inertia-dev`.

## Bitácora
- **2026-08-18** — Encontrado al preparar el PR del canal de WhatsApp contra `develop`. Verificado leyendo
  PHPUnit (`PhpHandler.php:112`, sin `force`) y Laravel (`RefreshDatabase.php:73`, `migrate:fresh`).
- **2026-08-18 (2)** — Corregido el conteo tras la observación de Miguel: **son 2 archivos, no 7** —
  `grep -l` cuenta menciones, incluida una comentada en el scaffold de Laravel. Y medido contra una base
  vacía desechable: **`migrate` desde cero falla en la 207 de 358**, así que `RefreshDatabase` no puede
  funcionar en este repo y solo entrega su mitad destructiva. Eso vuelve el arreglo casi gratis y destapa
  un hallazgo aparte: no se puede bootstrapear un ambiente migrando.
- **2026-08-18 (3)** — Creada **CORE-431** (sprint 11, 3 puntos) y **sacada del sprint el mismo día**:
  Miguel prefiere aterrizar la vulnerabilidad antes de ponerla a rodar con el equipo. Queda en el backlog.
  Además, leídas las dos pruebas para saber si conviene arreglarlas o borrarlas — **ninguna se borra**:
  - `SafeCancelTest` (Feature, 5 casos) blinda el bug de los **16 casos de CreditopX** que quedaron en
    estado 8 «Cancelado» con la CREACIÓN **viva en el core**, porque la ruta de borrado se registró sin el
    middleware de estado. ⚠ **Esta SÍ necesita base**: dos de sus asserts comprueban que una fila **no** se
    escribió en `user_request_records`, y eso no se verifica sin base. A esta solo se le cambia el
    mecanismo; no se le quita la base.
  - `CreditopXDatacreditoAdjustmentServiceTest` (8 casos) reconcilia lo que sabe el core contra lo que
    reporta DataCrédito, que va con retraso: crédito nuevo aún no reportado → ajuste **+cuota**; crédito ya
    pagado que la central sigue reportando → **−cuota**; pago parcial con cuota vieja inflada → negativo.
    Decide **cuánto se le presta a la persona**. Es aritmética sobre datos: **esta es la que sobra la base**,
    y la necesita solo porque el servicio consulta por su cuenta.

## Tarea (publicable)
La suite de pruebas automatizadas puede borrar por completo la base de datos de un ambiente compartido.

Dos pruebas usan un mecanismo que **vacía la base antes de correr** y luego la reconstruye. La
configuración de pruebas cambia el nombre de la base para que eso ocurra en una base aparte, pero no
cambia el servidor, y ese cambio de nombre se omite en silencio cuando el valor ya viene del entorno —
que es justamente lo que ocurre dentro de un contenedor desplegado.

El agravante es que **la reconstrucción no funciona**: la secuencia de cambios de estructura no se puede
aplicar desde cero, y se corta a mitad de camino. O sea que el mecanismo cumple su parte destructiva y no
la de recuperación. Las dos pruebas que lo usan no pueden estar pasando hoy en ningún ambiente, así que
quitarlo no cuesta nada.

La base afectada la comparten el ambiente de desarrollo y el de pruebas: son la misma, y no se podría
reconstruir aplicando los cambios de estructura — habría que restaurar una copia de respaldo. Perderla
detiene al equipo y a quienes están validando.

La propuesta, en orden: quitar ese mecanismo y reemplazarlo por uno que **revierta en vez de borrar**;
quitarle la dependencia de base a la prueba que no debería tenerla, atacando la causa —el código
consultado hace sus propias consultas en vez de recibirlas—; y agregar una verificación que **falle
cerrado**, comprobando contra qué servidor se va a escribir antes de empezar y deteniéndose si no es uno
permitido.

No hay evidencia de que haya ocurrido. Es preventivo, y el disparador sería una persona corriendo las
pruebas de buena fe: hoy nada la detiene.
