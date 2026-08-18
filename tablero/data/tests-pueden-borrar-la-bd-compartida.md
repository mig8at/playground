---
id: 50
title: "La suite de tests puede borrar la base de datos compartida de dev y staging"
stage: work
created: "2026-08-18T18:30:00-05:00"
context_nodes: [findings]
jira: []
jira_title: "Blindar la suite de pruebas para que no pueda borrar la base de datos de un ambiente"
---

# La suite de tests puede borrar la BD compartida
> **estado (2026-08-18):** 🔴 **abierta, y verificada leyendo el código de PHPUnit.** No es una hipótesis:
> la única barrera que separa la suite de una base real es **condicional**, y hoy hay siete archivos de
> test que ejecutan `migrate:fresh`. Salió al preparar el PR del canal de WhatsApp, cuando revisé qué
> tests podía correr sin riesgo antes de correrlos.

## En una frase
`phpunit.xml` protege la base **solo por el nombre** (`DB_DATABASE=testing`), esa protección **no se
aplica si la variable ya viene del entorno**, y el **host nunca se sobreescribe** — así que la suite
apunta a donde apunte el `.env`, y siete tests ahí borran todas las tablas.

## La cadena, pieza por pieza (todo verificado)

**1 · La única defensa es el nombre de la base.** `phpunit.xml:30` declara
`<env name="DB_DATABASE" value="testing"/>`. No hay `<env>` para `DB_HOST`, `DB_USERNAME` ni
`DB_PASSWORD`: **el host es siempre el del `.env`**, sin excepción.

**2 · Y esa defensa es condicional.** PHPUnit 10.5.63, en
`vendor/phpunit/phpunit/src/TextUI/Configuration/PhpHandler.php:112`:

```php
if ($force || getenv($name) === false) {
    putenv("{$name}={$value}");
}
```

El `phpunit.xml` **no usa `force`**, así que si `DB_DATABASE` ya existe en el entorno, PHPUnit **la
respeta y no la pisa**. La protección desaparece justo en los contextos donde las variables se exportan:
un `docker exec -e DB_DATABASE=…`, un contenedor de ECS (la task definition las inyecta como variables
de entorno), o cualquier shell donde alguien las haya exportado para otra cosa.

**3 · Lo que hacen los tests.** Siete archivos usan `RefreshDatabase`, y Laravel
(`vendor/laravel/framework/src/Illuminate/Foundation/Testing/RefreshDatabase.php:73`) lo implementa con
**`migrate:fresh`** — que **borra todas las tablas** antes de migrar:

- `Modules/Loans/tests/Feature/SafeCancelTest.php`
- `Modules/Loans/tests/Unit/CreditopXDatacreditoAdjustmentServiceTest.php` ⚠
- `Modules/Loans/tests/Unit/CreditopXFlowServiceValidationTypeTest.php` ⚠
- `tests/Feature/Commands/UnrollDevicesPaidCommandTest.php`
- `tests/Feature/ExampleTest.php`
- `tests/Feature/Jobs/DeviceUnrollJobTest.php`
- `tests/Feature/Jobs/PollDeviceReleaseBatchJobTest.php`

**4 · La trampa dentro de la trampa.** Dos de los siete viven bajo un directorio **`tests/Unit`**. Por
convención un test unitario no toca la base, así que «corro solo los unitarios, que son seguros» es
exactamente el razonamiento que dispara el borrado. El nombre miente sobre lo que el archivo hace.

**5 · El radio de impacto, medido el 2026-08-18.** La base `inertia-dev` sirve **dev y staging a la
vez** (no son dos bases: es la misma) y tiene **262 tablas, 227.796 usuarios, 360.843 solicitudes y
~24 GB**. Perderla no frena a una persona: frena al equipo entero y a QA, y se lleva puestos los datos
sembrados de cada prueba en curso.

## Qué tan cerca estuvo
Hoy mismo, en esta sesión, corrí `php artisan` dentro del contenedor `legacy-backend-laravel.test-1`
con `-e DB_HOST=<inertia-dev> -e DB_DATABASE=creditop -e DB_USERNAME=admin -e DB_PASSWORD=…` para
aplicar las migraciones de países a staging. **En ese mismo contenedor y con esas mismas variables
exportadas vive `./vendor/bin/pest`.** Un `pest` ahí —sin ningún flag raro, sin querer— habría corrido
`migrate:fresh` contra la base de dev y staging. Lo único que lo evitó fue revisar los traits de cada
test **antes** de ejecutarlos.

## Lo que NO es
- **No es un agujero de CI.** Verificado: ningún workflow de `legacy-backend` (`main-dev`, `main-stg`,
  `main-prod`, `main-qa`, `run-migrations`) corre la suite, y el `sonarcloud.yaml` de `config-ci` tampoco
  ejecuta tests ni toca variables de BD. **El disparador es humano**, y por eso el arreglo tiene que ser
  una guarda en el código, no un cambio de pipeline.
- **No es teórico por falta de credenciales.** Las credenciales de admin de esa base están en archivos
  `.env.*` locales de las herramientas del playground: cualquiera del equipo que tenga el repo las tiene.

## Arreglo propuesto (a discutir antes de implementar)
1. **`force="true"` en las variables de BD de `phpunit.xml`**, y agregar las que hoy faltan
   (`DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`) apuntando a un destino local. Cierra el agujero del
   entorno, pero sigue siendo una lista que hay que acordarse de mantener.
2. **Una guarda que falle cerrado en el `TestCase` base**: antes de cualquier test, si el host de BD
   resuelto **no** está en una lista blanca de destinos locales, abortar con un mensaje que explique por
   qué. Misma filosofía que el token del canal de WhatsApp: lo desconocido endurece, no abre. Esto es lo
   que de verdad protege, porque no depende de que el `phpunit.xml` esté completo.
3. **Mover o renombrar los dos tests mal ubicados** en `tests/Unit`, para que el nombre no mienta.
4. Evaluar `.env.testing` versionado, para que el destino de pruebas sea explícito y no herencia.

⚠ El punto 2 es el que hay que hacer primero: los otros tres son buenos, pero los tres dependen de que
alguien mantenga una configuración al día. La guarda no.

## Cómo se verifica el arreglo
Reproducir el caso exacto: exportar `DB_DATABASE` y un `DB_HOST` que no sea local, correr la suite, y
comprobar que **aborta** en vez de conectar. Con una base desechable de por medio — nunca contra
`inertia-dev`.

## Bitácora
- **2026-08-18** — Encontrado al preparar el PR del canal de WhatsApp contra `develop`: antes de correr
  los tests del módulo revisé cuáles usaban `RefreshDatabase` para no borrar la base local, y ahí
  apareció que la barrera de `phpunit.xml` es condicional. Verificado leyendo el código de PHPUnit
  (`PhpHandler.php:112`, sin `force`) y el de Laravel (`RefreshDatabase.php:73`, `migrate:fresh`).
  Medido el radio de impacto contra la base compartida. Confirmado que ningún workflow corre la suite,
  así que el disparador es humano.

## Tarea (publicable)
La suite de pruebas automatizadas puede borrar por completo la base de datos de un ambiente compartido.

La configuración de pruebas cambia el **nombre** de la base a una de pruebas, pero no cambia el
**servidor**, y ese cambio de nombre además se omite en silencio cuando el valor ya viene del entorno —
que es justamente lo que ocurre dentro de un contenedor desplegado. Siete archivos de prueba borran
todas las tablas antes de correr, y dos de ellos están guardados en la carpeta que por convención
contiene pruebas que no tocan la base, así que su nombre no advierte del riesgo.

La base afectada la comparten el ambiente de desarrollo y el de pruebas: son la misma. Perderla detiene
al equipo y a quienes están validando, y se lleva los datos preparados para cada validación en curso.

La propuesta es que la suite **falle cerrado**: que antes de correr verifique contra qué servidor va a
escribir y se detenga si no es uno permitido, en vez de confiar en que la configuración esté completa.
Se complementa ajustando la configuración para que no pueda omitirse y moviendo las dos pruebas mal
ubicadas.

No hay evidencia de que haya ocurrido. Es una medida preventiva, y el disparador sería una persona
corriendo las pruebas de buena fe: hoy nada la detiene.
