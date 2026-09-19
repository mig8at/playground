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

## Antes de concluir

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
- ⚠ **Las rutinas no son lo único invisible: hay un EVENT** que borra y reconstruye una tabla entera
  todas las noches, sin fuente en ningún repo. Ver «El EVENT» abajo — es el objeto de más riesgo del
  nodo, y el censo original no lo vio porque miró sólo `ROUTINES`.
- ⚠ **TRIGGERS: ya no son cero — son DOS, y entraron el 2026-09-18.** Acá decía «no hay», con un cero
  firme medido el 2026-08-15, y de ahí sacaba que «nada dispara en cada escritura». **Esa conclusión
  caducó.** Medido en prod el 2026-09-18: `trg_user_requests_disbursed_at_bu` (BEFORE UPDATE) y
  `trg_user_requests_disbursed_at_bi` (BEFORE INSERT), los dos sobre `user_requests`, creados ese
  mismo día a las 20:15. El resto sigue valiendo: el usuario tiene el privilegio `TRIGGER` sobre el
  schema —por eso el conteo es real y no un artefacto de permisos— y los 14 que aparecen en dev son
  de RDS y de MySQL (`sys`, `mysql`), ninguno de la aplicación. Ver la sección de abajo: **al depurar
  una escritura sobre `user_requests`, ahora hay un paso invisible desde el código**.

**(2026-08-28)** Dos cambios leídos enteros: `MareiguaService` ganó un `bypassMocks` **marcado
TEMPORAL** (existe sólo para `IdentityCentralRebuildService`, el backfill — borrar juntos) y un
**monitoreo no bloqueante de nombres** (`KycNameCheckRecorder`: lo ingresado vs lo devuelto, para ver
el porqué de los `wrong_document`). Y `Prami.php` ahora resuelve el cupo desde
`transaction_data.quotas` (CORE-319). Verificado contra `main`.

## Dónde mirar

**La fuente** es `legacy-backend/migrate.sql` (113 KB, único `.sql` de los dos repos; no va en `files[]`
por la regla de extensiones). Define **38 de las 42** — las otras 4 no tienen fuente en ningún lado
(abajo). Para leer una en vivo: `SHOW CREATE PROCEDURE creditop.<nombre>`.

**Las puertas desde el código**, por responsabilidad:

- **Features del perfilador ML** — `legacy-backend/Modules/Risk/App/Http/Controllers/ProfilerML/ProfilerMLController.php:306`
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
  `application/app/Services/lenders/RevolvingLoanConfigService.php:80`
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
| **Sin call site conocido** | 2 | ⚠ **corregido el 2026-08-15 — eran dos y es una**: a `SP_Update_User_Request_Risk_Centrals` la dispara un **EVENT** todas las noches (abajo), no «se corre a mano». La única realmente huérfana es `actualizar_json`: sin call site en código, **y verificado que tampoco la llama ningún event, ninguna rutina ni ninguna vista** |

## El EVENT: algo reconstruye ~1M de filas cada noche, y no está en ningún repo

El censo original miró `ROUTINES` y nada más. Al mirar el resto de `information_schema` (2026-08-15)
apareció **un** event en `creditop` — uno solo, y es de los objetos de más consecuencia del sistema:

| | |
|---|---|
| nombre | `ejecutar_Update_User_Request_Risk_Centrals` |
| cuerpo | `CALL SP_Update_User_Request_Risk_Centrals()` |
| cadencia | cada **1 DAY**, desde las 04:50 UTC (23:50 Colombia) |
| definer | `william@%` · creado 2025-11-11 |
| fuente en repos | **ninguna** — `grep` de `CREATE EVENT` sobre los cuatro repos no lo encuentra |

⚠ **En prod figura `SLAVESIDE_DISABLED` y eso NO significa apagado.** El endpoint de prod que atiende
Redash es una **réplica de lectura** (`@@read_only = 1`, medido), y una réplica siempre muestra así un
event que está activo en el primario. Leer ese estado como «no corre» es el error natural acá.

**La prueba de que corre son los datos, no la columna:** `user_request_risk_central_user_data` tiene
**969.866 filas y UNA sola fecha distinta** — todas escritas entre las 04:50:00 y las 04:50:16 de esa
madrugada (medido en prod el 2026-08-15). Dieciséis segundos para casi un millón de filas es la firma
de un `TRUNCATE` + reconstrucción total.

**Y `migrate.sql` describe lo contrario de lo que corre.** Su versión del SP (último commit
**2025-08-15**, un año) hace lo **incremental**: arma una tabla temporal `user_request_missing`, une por
`ur.created_at` y filtra `risk_central_id = 1`; **no tiene un solo `TRUNCATE`** (verificado). La viva
trunca todo, une por `ur.updated_at` y toma `risk_central_id IN (1, 9)`. Quien lea el repo para
entender esta tabla, entiende otra cosa.

Tres consecuencias, la primera medida y las otras dos leídas del cuerpo (que sólo se puede leer desde
dev — ver la sección de Redash):

1. **Esa tabla no tiene historia.** Su `created_at` no es cuándo se vinculó el buró con la solicitud:
   es cuándo fue el último rebuild. Hoy todas dicen hoy. Cualquier análisis temporal sobre esa columna
   es falso.
2. **La atribución puede cambiar sola de una noche a otra.** La unión va contra `updated_at`, que se
   mueve: tocar una solicitud puede reasignarle **otro** reporte de buró en el próximo rebuild. **F-107**
   ya decía que el vínculo es una inferencia por fecha y no un hecho; el mecanismo lo confirma y agrega
   lo peor: **la inferencia se rehace todas las noches**.
3. **Las vistas que leen esa tabla cambian de salida sin que cambie nada más** — ver abajo.

## Las VISTAS también calculan (28 en prod)

No son proyecciones: varias son motor. Las que deciden o computan:

- **`VW_User_Request_Track`** — calcula `INCOMES_AVERAGE`, `CONTINUITY`, `OCCUPATION`, `FIXED_EXPENSES`
  y además **`REVOLVING_LOAN` / `PAYMENT_CAPACITY`** llamando a `FN_CreditopX_Revolving_Credit` y
  `FN_CreditopX_Profiling_Multiplier_Risk`. Es el motor del rotativo expuesto como vista → **rotativo**.
- **`VW_Matrix_Income_Continuity_Occupation`** — los insumos de la categoría, todos por función SQL.
- **`VW_Risk_Central_*`** (Experian, Mareigua, TusDatos, AgilData) — desarman el JSON del buró
  descifrándolo. Son las más consumidas por el código: entran por
  `Modules/Onboarding/App/Services/ExperianProfileService.php` y `app/Actions/Lenders/Prami.php`.

⚠ **Las dos primeras leen `user_request_risk_central_user_data`**, la tabla que el event trunca: **su
salida puede cambiar de un día para otro sin que cambie una línea de código ni un dato de la solicitud.**

⚠ **Doce de las 28 llevan un literal de clave embebido en su propia definición** (el que se le pasa a
`FN_Decrypt_Data`), y **ese mismo literal está commiteado en `migrate.sql`**, que es un archivo
versionado. Es un asunto de seguridad, no de contexto: no se resuelve en este nodo y **no se transcribe
acá**.

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

## Los DOS triggers de `user_requests`: por fin se pueden contar desembolsos

Desde el 2026-09-18 `user_requests` tiene **`disbursed_at`**, y la llena un **trigger de MySQL**, no código de aplicación (`legacy-backend/database/migrations/2026_09_16_130000_add_disbursed_at_triggers_to_user_requests_table.php`). La razón de que sea un trigger está escrita y es buena: esa tabla **la escriben las dos aplicaciones** —`legacy-application` es donde entran los webhooks de las entidades— desde **más de veinte puntos**, con `->update([...])`, con asignación + `save()`, con query builder, y encima hay ajustes manuales en la base. Un hook de modelo habría cubierto una parte; el trigger es el único punto que cubre todos los caminos sin duplicar la regla.

Cuatro cosas de su diseño que cambian cómo se lee la columna:

- **Guarda la PRIMERA autorización y nunca pisa un valor.** Si la aplicación fija `disbursed_at` explícitamente —por ejemplo con la fecha real que reporta la entidad— el trigger no la toca; sólo rellena cuando viene `NULL`. Volver a pasar por el estado autorizado no la mueve.
- **El id del estado va HORNEADO en el trigger**, resuelto **por nombre** al correr la migración, porque el catálogo `user_request_statuses` no está versionado y **ya divergió entre ambientes**. O sea que el trigger de cada ambiente lleva su propio número.
- **La zona horaria se resuelve adentro**: si el UPDATE viene de Eloquent, `updated_at` cambia en la misma sentencia y se copia tal cual; si viene de SQL crudo, se toma `UTC_TIMESTAMP()` convertido a `-05:00`. Es seguro porque Colombia no tiene horario de verano.
- **Requisito de servidor:** con binlog activo, `CREATE TRIGGER` exige `SUPER` o `log_bin_trust_function_creators = 1` (error 1419); en RDS va en el parameter group. Si una migración de trigger falla con 1419, es eso y no permisos del usuario.

**Y el histórico está reconstruido, que es la salvedad que decide si se puede contar.** Medido en prod el 2026-09-18: **114.546 de 560.727** solicitudes tienen `disbursed_at`, desde 2023-08-02 hasta ese mismo día. Todo lo anterior al trigger lo llenó `user-requests:backfill-disbursed-at` con **dos fuentes en orden**: el primer `user_request_records` con el estado autorizado —la hora real del evento, que cubre **~77%**— y, para el resto, **`updated_at` como proxy**, porque las entidades que cambian el estado por webhook (Sistecredito, Bancolombia BNPL, Meddipay, Welli) **no dejan record**. El proxy coincide con el record al minuto en el 97% de los casos medidos, pero es una aproximación: **~23% del histórico no es la hora real del desembolso**, y esa distinción vive en el CSV de la corrida, no en la base.

## Lo que NO está verificado
- ¿`FN_Mareigua_*` coincide con `MareiguaExtractor`? Si divergen, dos caminos calculan el mismo ingreso distinto — el patrón de las dos convenciones de tasa (F-71).
- **¿Prod y dev tienen el MISMO CUERPO? Sigue sin poder contestarse, y ahora se sabe por qué.** Se
  comparó el 2026-08-15 hasta donde se pudo: **prod 42 · dev 47**, y **ninguna existe sólo en prod**
  (dev es superconjunto, así que la receta de rescate cubre las 42). Las 5 de más en dev son
  instrumental de índices creado el 2026-06-23, no negocio — ⚠ pero dos de ellas **cambian la
  visibilidad de índices**, o sea el plan de ejecución: una consulta puede rendir distinto en dev que
  en prod por algo que sólo existe en dev. De las 42 comunes, **41 tienen `created` y `last_altered`
  idénticos al segundo** y **una diverge**: `FN_CreditopX_Revolving_Credit`, mismo día pero **55
  minutos de diferencia** entre ambientes, con `created == last_altered` en los dos — dos despliegues
  manuales separados. Justo la que `VW_User_Request_Track` usa para el rotativo, familia que **F-114**
  ya marca como divergente. **Comparar los cuerpos es imposible con el acceso actual**:
  `routine_definition` viene NULL en 42 de 42 con el usuario de Redash, así que el timestamp es un
  proxy, no una prueba de identidad.
- `actualizar_json` sigue sin fuente y ahora **sin ningún invocador conocido**: se descartó que la
  llame un event, otra rutina o una vista. Coherente con que sea un script de migración que quedó.

**(2026-09-18) Los dos archivos que este nodo declara cambiaron, y NINGUNO de los dos cambios es de
este nodo.** Vale anotarlo porque es la forma más común de gastar una revisión: la deriva se mide por
archivos tocados, y un archivo puede estar acá por UNA razón (invoca una rutina) y cambiar por otra.

Verificado sobre el diff entero de los dos: **ni una sola línea tocada contiene `CALL`, `SP_` ni
`FN_`** — las llamadas a los procedimientos quedaron intactas, y lo que este nodo describe sigue
valiendo igual.

Adónde fue cada cambio, para que el que llegue acá siguiendo la deriva no lo busque dos veces:

- `MareiguaService.php` — **el nombre que devuelve la central ahora GANA sobre el tecleado**. Es un
  cambio de la cascada de identidad: va al nodo `kyc`.
- `ProfilerMLController.php` — los dos caminos del perfilador empezaron a medir su duración. Va al
  nodo `profiling`. ⚠ Su motivo sí es un dato duro para cualquiera que mire lentitud: **los dos tienen
  timeout de 15 s, así que encadenarlos da 30 s** — que es lo que tarda el listado en dev cuando el
  primario expira. Antes la línea decía qué camino se tomó y nunca cuánto tardó, así que «el primario
  resolvió» tapaba por igual un acierto en 200 ms y uno en 14,9 s.
