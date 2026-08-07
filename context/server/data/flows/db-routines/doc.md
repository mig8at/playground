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
  (`FN_CreditopX_Revolving_Credit_Multiplier`).
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

- ⚠ **CUATRO rutinas existen en producción y su código NO está en ningún repositorio**:
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

## Preguntas abiertas

- [ ] ¿Las 4 sin fuente tienen copia en algún lado (backup, otro repo, la máquina de alguien)? Si no, su
      lógica sólo existe en el binario de MySQL de cada ambiente.
- [ ] ¿Coinciden `FN_Mareigua_*` con `MareiguaExtractor`? Si divergen, dos caminos calculan el mismo
      ingreso distinto — el mismo patrón que las dos convenciones de tasa (F-71).
- [ ] ¿Prod, dev y staging tienen las MISMAS definiciones? `last_altered` por ambiente lo diría; no se
      comparó.
- [ ] `actualizar_json`: sin call site y sin fuente. ¿Resto o algo que corre por evento?

## Bitácora

- **2026-08-07** — Nodo creado al rastrear quién había hecho el backfill del vínculo buró↔solicitud
  (F-107). El rastro terminó en `migrate.sql` y destapó que hay 42 rutinas con lógica de negocio que el
  árbol no indexaba: la regla «`.sql` siempre dropea» tapaba una capa entera.

## Enlaces

- `kyc` — los campos `EX_*` y las centrales que estas rutinas leen.
- `profiling` — las reglas de categoría que consumen `FN_User_Occupation` / `FN_User_Income_Average`.
- `findings` — **F-107** (el vínculo buró↔solicitud y su SP) · **F-104** (el perfilador ML que consume
  estos features).
- `creditopx` — el motor rt=2/3 que usa el revolvente.
