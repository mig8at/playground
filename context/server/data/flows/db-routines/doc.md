# Rutinas de BD · la lógica de negocio que `grep` no encuentra

> **verificado contra `main` + producción** el **2026-08-07**. 42 rutinas medidas en
> `information_schema.routines` de prod; los call sites, grepeados en los tres repos.

## Qué es

**42 procedimientos y funciones almacenados en MySQL** que ejecutan lógica de negocio real —no
plomería— y que el árbol de contexto **no puede indexar por diseño**: `tools/roots.py` sólo mira
`.php .go .ts .tsx .js .jsx .mjs .cjs .vue`, y el protocolo dice que `.sql` siempre dropea de `files[]`.
Esa regla existe para que el mapa no se llene de migraciones, y tiene este costo.

Se invocan desde PHP como **string dentro de `DB::select` / `DB::scalar` / `CALL`**, así que buscar el
nombre del campo en el código nunca llega a la fórmula. Ejemplo real: el **ingreso promedio y la
ocupación** que deciden la categoría del cliente no los calcula PHP — los calcula una función de MySQL,
que además recibe el `APP_KEY` como parámetro porque el reporte del buró está cifrado y lo descifra
adentro de la base.

## Dónde mirar

**La fuente** es `legacy-backend/migrate.sql` (113 KB, único `.sql` de los dos repos; no va en `files[]`
por la regla de extensiones). Define **38 de las 42** — las otras 4 no tienen fuente en ningún lado
(abajo). Para leer una en vivo: `SHOW CREATE PROCEDURE creditop.<nombre>`.

**Las puertas desde el código**, por responsabilidad:

- **Features del perfilador ML** — `legacy-backend/Modules/Risk/App/Http/Controllers/ProfilerML/ProfilerMLController.php:261`
  (`CALL SP_AgilData_Mareigua_Extract_Data`) y `:290` (`CALL SP_Experian_Extract_Data`). Esos dos
  procedimientos son el paraguas: adentro llaman a las **23 `FN_Experian_*`**
  (`CC_Debt_Balance`, `CC_Vector_Overdue`, `CC_Is_Delinquent`, `Liabilities_*`, `Savings_Is_Seized`…),
  que ninguna se invoca desde PHP. **Son los ~20 campos `EX_*` que el nodo `kyc` dice que «se calculan
  y se tiran»**: acá es donde se calculan.
- **Insumos de la categoría (onboarding vivo)** —
  `legacy-backend/Modules/Onboarding/App/Services/ExperianProfileService.php:42` (`FN_User_Income_Average`),
  `:46` (`FN_User_Occupation`), `:102` (`FN_CreditopX_Profiling_Fixed_Expense_Perc`). El gemelo por
  lender: `legacy-backend/app/Actions/Lenders/Prami.php:378` · `:384` · `:497`.
- **Mareigua** — `legacy-backend/Modules/Identity/App/Services/MareiguaService.php:339`
  (`FN_Mareigua_Incomes_Average`, el `approximate_real_salary`). El extractor V2 y su advertencia:
  `legacy-backend/Modules/RiskV2/App/Extractors/RiskCentral/MareiguaExtractor.php:23` · `:66`.
- **Revolvente rt=3** — `legacy-backend/Modules/Loans/App/Repositories/RevolvingCreditRepository.php:115`
  (`CALL SP_CreditopX_Revolving_Credit`) y
  `legacy-application/app/Services/lenders/RevolvingLoanConfigService.php:80`
  (`FN_CreditopX_Revolving_Credit_Multiplier`). ⚠ **No son dos capas de lo mismo: son dos
  implementaciones que dan resultados distintos** — el SP recalcula todo el otorgamiento en SQL con otra
  función de multiplicador. Ver **F-114** y el nodo `rotativo`.
- **Descifrado** — `FN_Decrypt_Data`: 13 usos DENTRO de otras rutinas, **cero** desde PHP. Es la que
  abre el reporte cifrado (`laravel_encrypt`) para que las demás puedan leerlo.
- **El vínculo buró↔solicitud** — `SP_Update_User_Request_Risk_Centrals`: **cero call sites**. Se corre
  a mano. Ver **F-107**, que explica por qué su resultado NO es un hecho sino una inferencia por fecha.

## Vivas vs. internas vs. sin fuente (medido)

| | cuántas | qué son |
|---|---|---|
| **Llamadas desde PHP** | 13 | el camino caliente: los 2 `SP_*_Extract_Data`, los insumos de categoría, Mareigua, revolvente |
| **Sólo internas** | 27 | las 23 `FN_Experian_*`, `FN_Decrypt_Data`, `FN_User_Continuity`, `FN_CreditopX_Profiling_Multiplier_Risk`… — las usa otra rutina, nunca el código |
| **Sin call site conocido** | 2 | `SP_Update_User_Request_Risk_Centrals` (F-107) · `actualizar_json` |

## Gotchas / riesgos

- ⚠ **CUATRO rutinas existen en producción y su código NO está en ningún repositorio** (pero SÍ se
  pueden rescatar desde dev — ver la receta abajo, y hacerlo es la acción pendiente):
  `FN_Mareigua_Incomes_Average` (creada 2025-10-29) · `FN_CreditopX_Revolving_Credit_Multiplier`
  (2025-12-27) · `FN_Replace_Special_Characters` (2025-07-29) · `actualizar_json` (2025-06-11). Las dos
  primeras **se llaman desde PHP en producción**. No se pueden revisar en un PR, ni versionar, ni
  reproducir en un entorno nuevo desde el repo. El propio código ya lo advierte en
  `MareiguaExtractor.php:23`: *«calls the SQL stored function FN_Mareigua_Incomes_Average, which is NOT
  defined in the repository's migrations»*.
- **`migrate.sql` no está bajo el flujo de migraciones.** Vive en la raíz del repo, su último commit es
  de 2025-08-15 y la tabla `migrations` de prod no lo registra: se corre a mano. O sea que **no hay
  forma de saber desde el repo qué versión de una rutina está corriendo** — sólo
  `information_schema.routines` (columnas `created` / `last_altered`) lo dice.
- **Cambiar una rutina no deja rastro en el código.** Un `CREATE OR REPLACE` en prod altera el cálculo
  del ingreso o de la ocupación sin un solo commit, sin PR y sin deploy. Al depurar un perfilamiento
  raro, comparar `last_altered` con la fecha del síntoma es una pregunta legítima.
- **No emiten logs.** Una función SQL no escribe a Loki, así que el tramo del cómputo es invisible para
  el trazador: puede mostrar la entrada (la fila del buró) y la salida (la categoría), nunca el medio.
  Es un límite hermano del «el wizard no manda logs a Loki».
- **El parseo por buró está duplicado en dos lugares**: las `FN_Mareigua_*` / `FN_AgilData_*` en la BD, y
  los extractores de `Modules/RiskV2/App/Extractors/RiskCentral/`. No se verificó si coinciden.

## Lo que Redash SÍ y NO puede contestar acá

Medido el 2026-08-07 con el usuario de Redash (`ms_app`):

- ⚠ **El CUERPO de una rutina: NO por Redash, SÍ por MySQL directo.** Con el usuario de Redash
  (prod) `routine_definition` viene **NULL** —falta el privilegio— y `SHOW CREATE FUNCTION` tampoco;
  la copia local da lo mismo. **Pero la conexión DIRECTA a MySQL de dev sí los lee**: el trazador
  apunta a `inertia-dev` sin pasar por Redash, y ahí las 42 devuelven cuerpo. La receta:

  ```bash
  cd trazador/server
  go run . -target dev -sql "SELECT routine_definition FROM information_schema.routines \
      WHERE routine_schema='creditop' AND routine_name='<nombre>'"
  ```

  Eso **rescata las 4 que no tienen fuente en ningún repo**, y hay evidencia fuerte de que la versión
  de dev es la misma que corre en prod: `created` y `last_altered` coinciden **al segundo** en las
  cuatro (p. ej. `FN_Mareigua_Incomes_Average` 2025-10-29 20:08:05 en los dos ambientes). No es
  prueba de identidad byte a byte, pero sí de que las desplegó la misma corrida.
- ❌ **Qué tablas se usan de verdad**: `performance_schema` está denegado
  (`SELECT command denied … table_io_waits_summary_by_table`).
- ⚠ **`information_schema.tables.update_time` sirve como POSITIVO, no como negativo**: en InnoDB es
  NULL cuando el dato no está en memoria, así que «NULL» NO prueba que la tabla esté muerta. Medido:
  **72 tablas escritas en los últimos 7 días** (eso sí es firme) y 175 sin dato.
- ✅ **Qué existe y desde cuándo**: `routine_name`, `routine_type`, `created`, `last_altered`. Esa
  última columna es la única forma de saber si una rutina cambió — el repo no lo dice.
- ✅ **La cobertura real de una columna de atribución**: contar `SUM(col IS NOT NULL)`. Es lo que
  destapó F-108, y la regla que deja: **que una tabla declare `user_request_id` no significa que lo
  escriba** — dos de cuatro dieron cero.

De las 72 vivas, **45 están nombradas en el árbol (62 %)** y 27 no. De esas 27, catorce son tablas
de log (ver F-108) y cuatro son framework (`failed_jobs`, `model_has_roles`…).

## Qué hacen las 4 sin fuente (leídas desde dev el 2026-08-07)

- **`FN_Mareigua_Incomes_Average`** (1.707 B) — el `approximate_real_salary`. Recorre el JSON de
  aportantes, suma `resultado_pagos[].ingresos` de cada uno (capando la cantidad de pagos a `months`) y
  divide por **`months`**, no por la cantidad de pagos encontrados. ⚠ Eso significa que **un cliente con
  historial corto queda diluido**: 3 pagos reportados sobre una ventana de 12 se promedian contra 12. No
  se determinó si es intencional (ingreso anualizado) o un defecto — pero cambia qué significa ese campo.
- **`FN_Replace_Special_Characters`** (544 B) — normaliza texto: baja a minúsculas, quita tildes y `ñ`,
  borra todo lo que no sea alfanumérico y devuelve en MAYÚSCULAS. Utilitaria, sin riesgo de negocio.
- **`actualizar_json`** (2.201 B) — un cursor que **reescribe `profiling_reviews.ML_predictions`**,
  desarmando y rearmando el JSON por lender (`lender_id`, `model_name`, `prediction`). Es un script de
  migración de datos, y explica una de las tres formas de esa columna (ver F-104).
- **`FN_CreditopX_Revolving_Credit_Multiplier`** (5.973 B) — la más grande de las cuatro, y la de más
  consecuencia: **es el motor de riesgo entero del cupo rotativo rt=3**. Puntúa seis variables de 1 a 5
  (score Experian, negativos vigentes, negativos 12 m, consultas 6 m, tarjetas activas, continuidad
  laboral) y devuelve el promedio ponderado más un JSON con el detalle de cada una. Los pesos y los
  cortes **tampoco están en el código**: viven en `creditop_x_profiling_multiplier_risk_vars` /
  `_rangs`. O sea que **la política de riesgo de un producto entero es una función sin versionar que
  lee dos tablas de configuración** — un `CREATE OR REPLACE` o un `UPDATE` cambian a quién se le presta
  sin un solo commit. Desarmada en el nodo **`rotativo`**.

## Preguntas abiertas

- [x] ~~¿Las 4 sin fuente tienen copia en algún lado?~~ **Sí: se leen desde dev por MySQL directo.** Lo
      que queda es la ACCIÓN — dumpearlas a `legacy-backend` para que queden versionadas. Es un cambio a
      un repo real, no se hizo.
- [ ] ¿Coinciden `FN_Mareigua_*` con `MareiguaExtractor`? Si divergen, dos caminos calculan el mismo
      ingreso distinto — el mismo patrón que las dos convenciones de tasa (F-71).
- [ ] ¿Prod, dev y staging tienen las MISMAS definiciones? `last_altered` por ambiente lo diría; no se
      comparó.
- [ ] `actualizar_json`: sin call site y sin fuente. ¿Resto o algo que corre por evento?

## Enlaces

- `kyc` — los campos `EX_*` y las centrales que estas rutinas leen.
- `profiling` — las reglas de categoría que consumen `FN_User_Occupation` / `FN_User_Income_Average`.
- `findings` — **F-107** (el vínculo buró↔solicitud y su SP) · **F-104** (el perfilador ML que consume
  estos features).
- `creditopx` — el motor rt=2/3 que usa el revolvente.
