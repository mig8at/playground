# Fix min_income (piso de ingreso NO-OP) · task
> **rama:** — · **PR:** — · **estado:** 🐛 identificado, sin arreglar
>
> Bug: la columna de ingreso mínimo de las categorías rt=2 se llama **`monthly_income`**, pero los tres motores de asignación de categoría leen **`$rule->min_income`** (atributo inexistente → `null`). Resultado: el piso de ingreso **nunca filtra** — todos pasan el chequeo de ingreso. Arreglarlo **endurece** la asignación de categoría.

## Contextos que usa
- **profiling** — el dominio del bug: la asignación de categoría rt=2 y sus reglas (ocupación, edad, **salario**, continuidad, score). `min_income` es la regla de salario que hoy es NO-OP.
- **onboarding** — de dónde viene el ingreso que se compara (`approximate_real_salary` / ingreso verificado, capturado en el formulario laboral); además una de las copias del motor vive en el módulo Onboarding.

## Objetivo
Hacer que el piso de ingreso de las categorías vuelva a filtrar. La fuente de verdad es la columna real `lender_users_category_rules.monthly_income`; el fix es leer esa columna (o exponerla como accessor) en vez del `min_income` inexistente. **Ojo de negocio:** arreglarlo cambia el comportamiento — usuarios que hoy caen en categorías que no deberían (por ingreso) empezarán a ser filtrados. No es un fix silencioso; hay que avisar/medir el impacto.

## La evidencia (verificada 2026-07-18)
- **Columna real:** `database/migrations/2025_02_11_202744_create_lender_users_category_rules.php:21` → `$table->integer('monthly_income')->nullable()`. NO existe columna `min_income` en ninguna migración.
- **Modelo:** `app/Models/LenderUsersCategoryRule.php` — `$fillable` incluye `monthly_income`, **sin** accessor `getMinIncomeAttribute` ni cast. → `$rule->min_income` devuelve `null`.
- **Efecto PHP:** `$salary >= null` / `$salary < null` → `null` se coacciona a `0` en la comparación numérica → el chequeo siempre pasa (nadie queda por debajo del piso).

## Lo que hay que tocar (motores que leen `->min_income`)
| Repo · archivo | línea | uso |
|---|---|---|
| `legacy-backend` Loans `LenderUserCategoryService.php` | `:416` | `$criteria['min_income'] = $salary >= $rule->min_income;` |
| `legacy-backend` Onboarding `lenders/LenderUserCategoryService.php` | `:111,114,121,125` | `if ($approximate_real_salary < $lenderUserCategoryRule->min_income)` |
| `legacy-backend` Risk `LenderRulesRepository.php` | `:262` | `$requiredIncome = $ruleConfig['min_income'] ?? 0;` (lee de un array de config, verificar si es la misma clave) |
| `application` `app/Services/lenders/LenderUserCategoryService.php` | `:111` | copia gemela del motor de Onboarding |
| `legacy-backend` `app/Models/LenderUsersCategoryRule.php` | — | la corrección más limpia: accessor `min_income`→`monthly_income`, o renombrar las lecturas |

## Cómo probar / validar
- Un usuario sintético con ingreso por DEBAJO del `monthly_income` de una categoría **hoy** cae en esa categoría igual (bug); tras el fix debe quedar excluido. Ver **profiling** para la receta de categorías y el harness (`synth`/`perfilador`) para inyectar el ingreso.
- Barrido de confirmación: `grep -rn '->min_income' legacy-backend application` = 0 tras el fix (o todas apuntando al accessor).

## Bitácora
- **2026-07-11** — detectado en el CENSO de campos (`CENSO-CAMPOS-CONFIG.md`): columna `monthly_income` vs lectura `min_income`.
- **2026-07-18** — re-verificado contra el código (columna, modelo, 4 sitios de lectura) y registrado como task.

## Pendientes
- [ ] Decidir el fix: accessor en el modelo (menos invasivo) vs renombrar las 4 lecturas.
- [ ] Confirmar si `LenderRulesRepository:262` (`$ruleConfig['min_income']`) es la misma clave o un array distinto (puede no ser el mismo bug).
- [ ] Medir/avisar el impacto de negocio ANTES de mergear (endurece la asignación).

## Enlaces
- Memorias: `[[flow-reorg-y-mapa-atributos]]` (el CENSO donde salió) · `[[simulador-gap-analisis]]`.
- Contextos: **profiling** (categorías rt=2) · **onboarding** (captura del ingreso).
