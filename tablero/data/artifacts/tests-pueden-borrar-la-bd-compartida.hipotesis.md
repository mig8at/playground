# Cómo las pruebas automáticas *podrían* borrar la base de datos de un ambiente

**19 de agosto de 2026 · punto de partida para el análisis, no una conclusión**

> ⚠ **Esto es una hipótesis.** Describe un camino que existe hoy en el código y que **alcanza** para
> borrar una base real. No afirma que sea lo que pasó el 19/08 — es la explicación que mejor encaja con
> lo que vimos, y abajo está cómo confirmarla o descartarla.

---

## En una frase

Hay dos pruebas automáticas que, para correr, **vacían la base de datos y la reconstruyen desde cero**.
Eso es normal… siempre que apunten a una base descartable. El problema es que **lo único que asegura a
qué base apuntan es un candado que no alcanza**.

---

## La idea, sin tecnicismos

Cuando alguien corre esas dos pruebas, el sistema hace tres cosas en orden:

1. **Borra todas las tablas** de la base a la que esté apuntando.
2. **La reconstruye vacía**, paso por paso.
3. Recién ahí corre la prueba.

El paso 1 es a propósito: la prueba necesita empezar de cero. Nadie escribió eso por error, y en
cualquier proyecto es una práctica normal.

**Lo que falla es la puntería.** Para que esto sea seguro hacen falta dos candados:

| candado | qué asegura | ¿está puesto? |
|---|---|---|
| **cuál base** | que se llame `testing` y no la real | 🟡 puesto, pero **se puede saltar** |
| **cuál servidor** | que sea tu máquina y no el servidor compartido | 🔴 **nunca se puso** |

El segundo candado **no existe en el proyecto** y nunca existió. Eso significa que las pruebas se conectan
**al servidor que tenga configurado quien las corre** — y si esa persona tiene su configuración apuntando
al ambiente compartido, ahí es donde borran.

El primer candado tampoco es firme: sólo se aplica si esa configuración **no venía ya puesta de antes**.
Si el nombre de la base ya viene definido en el entorno —cosa habitual cuando se trabaja con contenedores—
el candado **se saltea en silencio**, sin avisar.

> 🔴 **Y no se arregla solo.** El paso 2 —reconstruir la base— **falla a mitad de camino en este
> proyecto**. Así que si esto se dispara, no queda «una base recién hecha»: queda **una base vacía y a
> medio armar**. Se paga el destrozo completo y ni siquiera se obtiene una prueba que pase.

**Lo más incómodo: quien lo dispara no se entera.** No hay confirmación, ni advertencia, ni mensaje que
diga «vas a borrar el ambiente compartido». La prueba simplemente falla, y falla por un motivo que parece
otro.

---

## Dónde está, exactamente

Todo esto vive en el repositorio **`legacy-backend`**. Son tres archivos:

| archivo | qué hay ahí |
|---|---|
| `Modules/Loans/tests/Unit/CreditopXDatacreditoAdjustmentServiceTest.php` (línea 16) | una de las dos pruebas que borran. Está desde el **9 de enero de 2026** |
| `Modules/Loans/tests/Feature/SafeCancelTest.php` (línea 26) | la otra. Está desde el **29 de abril de 2026** |
| `phpunit.xml` (línea 30) | **el único candado que hay**, el de «cuál base». Está desde que nació el repositorio, en junio de 2025 |

Son las **únicas dos** de 140 archivos de prueba. No es una plaga: son dos, y están identificadas.

Y conviene tener presente la antigüedad: las pruebas llevan **4 y 7 meses**, pero el hueco del candado
del servidor lleva **14 meses**. O sea que el riesgo no es nuevo — lo nuevo es que alguien pasó por ahí.

---

## Por qué creemos que fue esto

Cuatro cosas que vimos, y lo que esta explicación predice para cada una:

| lo que se vio en la base | qué dice esta hipótesis |
|---|---|
| Las tablas fueron **creadas de nuevo**, no vaciadas | ✅ el proceso borra y recrea, no limpia |
| Todo el trabajo aparece como **una sola tanda desde cero** | ✅ es una reconstrucción completa, no un cambio incremental |
| Quedó **a mitad de camino**, con tablas pero sin datos | ✅ la reconstrucción falla en este proyecto |
| **No hubo despliegues ni procesos automáticos** a esa hora | ✅ el camino es alguien corriéndolo **desde su computador** |

---

## Más caminos posibles (segunda opinión, 19/08)

Se le pasó el caso completo —con el código— a un segundo analista. Aportó **tres vías que no estaban**,
y las tres son plausibles:

- **Correr una prueba suelta desde el editor.** PhpStorm y VS Code, al darle *Run* a un archivo de
  prueba, **no siempre cargan la configuración de pruebas**. Sin ella no hay ningún candado: la prueba
  usa directamente lo que diga el `.env`. Encaja bien con «no quedaron datos», porque estas pruebas
  envuelven su trabajo en una transacción y la deshacen al terminar. **Quien lo hizo pudo haber visto
  sólo un tick verde.**
- **La variable `DATABASE_URL`.** Es una forma alternativa de escribir toda la conexión en una sola
  línea, y **le gana a las variables sueltas**. Está soportada en cuatro lugares de
  `config/database.php`. Si alguien la tiene puesta, un candado sobre «cuál servidor» o «cuál base»
  **no sirve de nada**: se saltea entero.
- **Configuración compilada.** Si alguien ejecutó el comando que compila la configuración
  (`config:cache`), las pruebas obedecen a esa copia y **ignoran los candados** del archivo de pruebas.

⚠ **Y una hipótesis suya se descartó midiendo.** Propuso que la reconstrucción no se detuvo, sino que
el proyecto tiene sólo 19 migraciones porque las viejas estaban colapsadas en un volcado. Se verificó:
hay **361 archivos** de migración en `main` y **no existe** esa carpeta de volcado. La reconstrucción sí
se quedó a mitad.

## Cómo confirmarlo o descartarlo

- **Mirar los registros del servidor de base de datos.** Este proceso deja una huella muy reconocible: una
  ráfaga de borrados seguida de una ráfaga de creaciones. Y el registro dice **desde qué computador y con
  qué usuario** entró la conexión. Eso es lo que separa «alguien desde su máquina» de «algo del servidor».
- **Preguntar, sin señalar a nadie.** Alcanza con *«¿alguien corrió las pruebas hoy?»*. Vale insistir en
  que quien lo haya hecho **no tenía forma de saberlo**: no hubo ninguna advertencia.
- **Terminar de descartar lo demás.** Ya quedaron afuera los despliegues (no ejecutan este paso) y los
  procesos automáticos (no corrió ninguno a esa hora). Falta revisar tareas programadas y accesos manuales.

---

## 🔴 El agravante, medido el 19/08: las credenciales son las del usuario maestro

Los archivos de configuración del harness (`playground/harness/.env.dev` y `.env.staging`) guardan las
credenciales de la base compartida. Se midió **qué puede hacer ese usuario**, consultándolo contra el
propio servidor:

> Conectado como **`admin@%`** — el usuario maestro del RDS — con **27 privilegios**, entre ellos
> **`DROP`**, `DELETE`, `ALTER`, `CREATE USER`, `DROP ROLE`, `RELOAD` y `SYSTEM_VARIABLES_ADMIN`.

Dos conclusiones:

1. **Esos archivos, por sí solos, no pueden disparar el borrado.** Sus variables se llaman `E2E_DB_*`, y
   se verificó que el harness no las traduce a los nombres que lee Laravel (`DB_*`). Correr la suite de
   pruebas no los mira.
2. **Pero son la fuente de la que salen las credenciales.** El procedimiento de apuntar un contenedor
   local a la base compartida —que se usó hace días para aplicar migraciones— toma la contraseña de
   ahí. Y lo que se copia es una cuenta que **puede borrar el servidor entero**.

Por eso la recomendación de abajo deja de ser una buena práctica y pasa a ser el arreglo concreto: hoy
**cualquier camino que llegue a esa base llega con permiso para destruirla**.

## Qué se puede arreglar sin esperar el diagnóstico

Son independientes de quién lo haya disparado, y ninguna es costosa. **En este orden**:

1. **Sacar el usuario maestro de la configuración de todos los días.** Crear dos cuentas acotadas
   —una de **sólo lectura** para consultar, y otra con permiso de **leer y escribir filas pero no de
   eliminar tablas** para las pruebas que necesitan sembrar datos— y reemplazar con ellas al `admin`
   en la configuración del harness. Es el único arreglo que cubre *todas* las vías a la vez, porque no
   depende de ninguna configuración ni de que nadie se equivoque: el borrado simplemente **no se puede
   ejecutar**. Los cambios de estructura los aplica la pipeline, que sí tiene ese permiso.
   ⚠ Y conviene **rotar esa contraseña**: recordá que dev y staging comparten credenciales, así que hay
   que actualizar los dos archivos.
2. **Poner el candado que falta en la configuración de pruebas.** Fijar **cuál servidor**, además de
   cuál base, de forma que el entorno no lo pueda pisar. ⚠ Y hay que incluir **`DATABASE_URL`**: si se
   olvida, quien la tenga configurada se saltea el candado completo. Esto tapa el camino de las pruebas,
   pero **no** el de un comando destructivo escrito a mano.
3. **Quitarles a esas dos pruebas la parte que borra.** Hoy no están pasando en ningún ambiente —no
   pueden, porque la reconstrucción falla—, así que sacarlo no pierde nada real.

---

<details>
<summary><b>Detalle técnico</b> (para quien vaya a hacer el arreglo)</summary>

El mecanismo es el trait `RefreshDatabase` de Laravel, que ejecuta `migrate:fresh`
(`vendor/laravel/framework/src/Illuminate/Foundation/Testing/RefreshDatabase.php`, en
`refreshTestDatabase()`): elimina todas las tablas y luego migra desde cero.

`phpunit.xml:30` declara `<env name="DB_DATABASE" value="testing"/>` pero **no declara `DB_HOST`,
`DB_USERNAME` ni `DB_PASSWORD`** — `git log -S 'DB_HOST' -- phpunit.xml` no devuelve ningún commit en toda
la historia del repositorio. El host es siempre el del `.env`.

Y el override del nombre es condicional
(`vendor/phpunit/phpunit/src/TextUI/Configuration/PhpHandler.php:112`):

```php
if ($force || getenv($name) === false) {
    putenv("{$name}={$value}");
}
```

`phpunit.xml` no usa `force="true"`, así que un `DB_DATABASE` ya presente en el entorno —un
`docker exec -e DB_DATABASE=…`, una task definition de ECS, o una shell con el entorno cargado— gana.

Si se endurece `phpunit.xml`, **`DATABASE_URL` tiene que ir en la lista** o el resto no sirve:

```xml
<env name="DATABASE_URL" value="" force="true"/>
<env name="DB_HOST" value="127.0.0.1" force="true"/>
<env name="DB_DATABASE" value="testing" force="true"/>
<env name="DB_USERNAME" value="root" force="true"/>
<env name="DB_PASSWORD" value="" force="true"/>
```

⚠ Al censar los archivos afectados: `grep -l RefreshDatabase` da **7 y es falso positivo**. Hay que buscar
`^\s*use RefreshDatabase;` — los otros 5 sólo lo mencionan (en `tests/Feature/ExampleTest.php` está
comentado, es el scaffold de Laravel).

Y dev y staging **comparten la misma base**, así que cae un ambiente y se llevan dos.

</details>

---

*Documento de arranque para el análisis. La evidencia forense completa —tiempos, mediciones y lo ya
descartado— está en la tarea del tablero.*
