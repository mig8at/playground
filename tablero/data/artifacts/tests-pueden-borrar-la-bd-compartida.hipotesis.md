# Cómo la suite de tests *podría* borrar la base de datos de un ambiente

**19 de agosto de 2026 · punto de partida para el análisis, no conclusión**

> ⚠ **Léase como hipótesis.** Esto describe un camino que *existe* y que *alcanza* para borrar una base
> real. No afirma que sea lo que pasó el 19/08: es la posibilidad más consistente con lo observado, y lo
> que sigue es cómo confirmarla o descartarla.

---

## 1 · Los archivos

Todo esto vive en el repo **`legacy-backend`**. Son tres archivos:

| ruta exacta | qué tiene |
|---|---|
| `Modules/Loans/tests/Unit/CreditopXDatacreditoAdjustmentServiceTest.php:16` | `use RefreshDatabase;` — desde el **2026-01-09**. Además está **mal ubicado**: es un test en `tests/Unit` que toca la base |
| `Modules/Loans/tests/Feature/SafeCancelTest.php:26` | `use RefreshDatabase;` — desde el **2026-04-29** |
| `phpunit.xml:30` | `<env name="DB_DATABASE" value="testing"/>` — **la única protección que hay**. Existe desde el init del repo (2025-06-25) |

Son los **únicos dos** de 140 archivos de test que usan el trait.

⚠ Al contarlos: buscar por nombre da **7 y es falso positivo**. Hay que grepear `^\s*use RefreshDatabase;`,
porque los otros 5 sólo lo mencionan — en `tests/Feature/ExampleTest.php` está **comentado**, es el
scaffold de Laravel, y en el resto son imports de modelos.

---

## 2 · Por qué puede borrar

La cadena tiene cuatro eslabones, y **ninguno es un bug**: cada uno hace lo que promete.

**1. El trait borra antes de construir.**
`RefreshDatabase` ejecuta `migrate:fresh` — en
`vendor/laravel/framework/src/Illuminate/Foundation/Testing/RefreshDatabase.php`, método
`refreshTestDatabase()`:

```php
if (! RefreshDatabaseState::$migrated) {
    $this->artisan('migrate:fresh', $this->migrateFreshUsing());
    ...
}
```

`migrate:fresh` **primero elimina todas las tablas** y después migra desde cero. Es su comportamiento
normal y documentado.

**2. La protección cubre el nombre, no el servidor.**
`phpunit.xml` declara `DB_DATABASE=testing`, pero **no declara `DB_HOST`, `DB_USERNAME` ni
`DB_PASSWORD`** — y nunca los declaró en toda la historia del repo (`git log -S 'DB_HOST' -- phpunit.xml`
no devuelve ningún commit). El servidor al que se conecta es **siempre el del `.env`**.

**3. Y el nombre se puede perder también.**
PHPUnit no pisa una variable que ya venga del entorno
(`vendor/phpunit/phpunit/src/TextUI/Configuration/PhpHandler.php:112`):

```php
if ($force || getenv($name) === false) {
    putenv("{$name}={$value}");
}
```

`phpunit.xml` **no usa `force`**. Si `DB_DATABASE` ya está exportada —un `docker exec -e DB_DATABASE=…`,
un contenedor de ECS cuya task definition inyecta las variables, o una shell con el entorno cargado—
PHPUnit la respeta y el override **no ocurre**.

**4. Con el `.env` apuntando a un ambiente, el destino es ese ambiente.**
Si el `.env` tiene el host de `inertia-dev`, correr cualquiera de esos dos tests apunta ahí. Y como dev y
staging **comparten la misma base**, caen los dos ambientes.

> 🔴 **Y el daño no se revierte solo.** `migrate:fresh` borra y después migra — pero en este repo
> **migrar desde cero falla**. Se entrega la mitad destructiva y no la restaurativa: la base queda vacía
> y a medio armar, y encima el test tampoco pasa. Hay al menos **dos puntos de falla distintos** medidos
> en la cadena de migraciones, así que *dónde* se planta no es predecible.

---

## 3 · Qué encaja con lo observado

| lo que se vio | qué predice esta hipótesis |
|---|---|
| Las tablas fueron **recreadas**, no vaciadas (`CREATE_TIME` de golpe) | ✅ `migrate:fresh` hace drop + create, no delete |
| Todas las migraciones en `batch = 1` | ✅ una corrida desde cero, no incremental |
| Se detuvo a mitad, con tablas creadas y sin datos | ✅ migrar desde cero falla en este repo |
| Sin corridas de CI ni deploys en la ventana | ✅ el camino es una corrida **local**, desde una máquina |

---

## 4 · Cómo confirmarlo o descartarlo

- **Logs del servidor de base de datos.** Un `migrate:fresh` deja una ráfaga de `DROP TABLE` seguida de
  `CREATE TABLE`. El log dice desde qué host y con qué usuario entró la conexión — eso separa «una
  máquina» de «un contenedor del cluster».
- **Preguntar sin señalar.** Alcanza con *«¿alguien corrió la suite hoy?»*. El camino es **invisible para
  quien lo toma**: no hay confirmación ni advertencia, y el test aparenta fallar por otra cosa.
- **Descartar los otros caminos.** Ya se descartaron deploys (el workflow no tiene paso de migraciones) y
  CI (cero corridas en la ventana). Falta descartar tareas programadas y accesos manuales.

---

## 5 · Lo que se puede cerrar sin esperar el diagnóstico

Estas tres son independientes de quién lo haya disparado, y ninguna cuesta trabajo:

- **Fijar el host en `phpunit.xml`.** Agregar `DB_HOST`, `DB_USERNAME` y `DB_PASSWORD` apuntando a algo
  local, con `force="true"` para que el entorno no los pueda pisar. Es el arreglo de raíz: **sin host
  alcanzable, la suite no puede tocar un ambiente**.
- **Sacar el trait de los dos tests.** No están pasando hoy en ningún ambiente —no pueden, porque migrar
  desde cero falla—, así que quitarlo no pierde cobertura real.
- **Separar credenciales.** Que el `.env` de trabajo no tenga alcance de escritura a la base compartida
  convierte el accidente en un error de permisos.

---

*Documento de arranque para el análisis. La bitácora completa —evidencia forense, tiempos y lo ya
descartado— vive en la tarea del tablero.*
