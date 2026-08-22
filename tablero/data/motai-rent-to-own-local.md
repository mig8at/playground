---
id: 61
title: "Motai Rent to Own: montarlo en local y probar la rama de codeudor"
stage: work
created: "2026-08-22T14:00:00-05:00"
context_nodes: [motai, codeudor, creditopx]
jira: []
jira_title: "Rent to Own: validar la firma con codeudor fuera de qa"
---

**ESTADO 2026-08-22.** El comercio está montado en local y el hallazgo grande ya salió (F-145). Lo
que falta es hacerlo LISTAR, y ahí me quedé sin explicación — lo dejo escrito para no volver a
recorrer lo descartado.

## Qué es el Rent to Own

Entidad clonada de Motai Renting. **Renting = arriendo operativo SIN opción de compra; RTO = el
cliente termina siendo dueño de la moto.** Al clonarse con el catálogo del 158 firmaba el contrato de
renting, que dice lo contrario del producto. El commit `35c866e3` (Laura, 20-ago) le dio sus cuatro
plantillas aprobadas por legal: contrato con opción de compra, acuerdo de codeudoría, pagaré + carta
de instrucciones, y garantía mobiliaria.

## Cómo se monta en local (hecho, reproducible)

`php artisan migrate` a secas NO sirve: choca con el dump (`allied_errors_captures already exists`).
Van una por una con `--path`, en este orden — las 15 de la cadena de codeudor + RTO, desde
`2026_07_17_000001_create_cosigner_statuses_table` hasta
`2026_08_20_120000_seed_rent_to_own_cosigner_documents`.

Resultado: **lender 173 `rent-to-own`** (⚠ en qa es el **205**: los ids NO son estables, por eso las
migraciones resuelven por `slug`) con **sólo la rama CON codeudor** en su catálogo — 5 documentos. La
rama sin codeudor sigue apuntando a renting: es el hueco que el propio commit declara, porque la
categoría «Codeudor» tiene `requires_cosigner = 0`.

Y se sembró a mano una categoría `requires_cosigner = 1` para el 173, porque **ningún lender de la
base local tenía la columna en 1** (se acaba de crear, default 0) y sin política el codeudor no se
exige nunca.

## Lo que NO se pudo: hacerlo listar

Ningún rt=2 del comercio Motai aparece en el listado local — ni el 173 ni el 158/168/169/170. Y el
listado devuelve entidades que **no** están cableadas a esa sucursal, así que la base del `getLenders`
para este comercio no es la que yo suponía.

**CONFIRMADO — el modelo de asignación (Miguel, 2026-08-22).** Los lenders se **asignan por COMERCIO**
(`lenders_by_allieds`) y se **activan por SUCURSAL** (`lenders_by_allied_branches`), y la base del
listado es la ACTIVACIÓN. Medido: la sucursal 867 tiene activados `5, 6, 8, 9, 11, 62` y el listado
devolvió exactamente `[6, 9, 11, 8, 5]` — los mismos menos el 62. Esto **no estaba dicho así en el
nodo**, y es lo que explica por qué mirar sólo una de las dos tablas confunde.

⚠ Y mi confusión anterior era otra cosa: yo consultaba una sucursal y el caso corría en OTRA. Los
`#hash` resuelven bien; lo que fallaba era mi consulta. Verificar SIEMPRE por el `allied_branch_id` de
la solicitud, no por el hash que uno creyó pasar.

**Descartado, con medición:**

| hipótesis | medido |
|---|---|
| no está cableado a la sucursal | está: `lenders_by_allied_branches` lo tiene |
| entidad o arista inactivas | las dos en `status=1` |
| falta a nivel comercio | `lenders_by_allieds` tiene los diez |
| sin `group_rules` en la sucursal | la 682 tiene **11** |
| sin tramo por monto | los 158/168/169/170/173 no tienen, **pero el 62 sí y tampoco lista** |
| `have_ctopx` | el comercio lo tiene en **0** — y Pullman, que SÍ lista su rt=2, también |
| sin `lender_rules` en la sucursal (F-75) | era cierto para el 173 y el 158 · **se copiaron las 6 del 170 y sigue sin listar** |
| falta el dato de buró | está: Agildata + Experian Acierta+Quanto (127 KB), lo mismo que la solicitud de Pullman que sí lista |

Tampoco hay bucket `false_lenders` en la respuesta: los rt=2 se caen sin dejar rastro en los logs, o
sea que el corte es **antes** de evaluar reglas.

## RESUELTO: no lista porque su configuración de negocio NUNCA se hizo — y es a propósito

La respuesta está en el docblock de `2026_08_15_140000_clone_motai_renting_lender_as_rent_to_own`:
clona **sólo tres tablas hijas** —`credit_line_by_lenders`, `lenders_by_allied_branches` (visibilidad)
y `lenders_by_allieds` (costos)— y dice explícito qué **NO** clona: «categorías de usuario y sus
reglas —ojo, ahí vive `min_initial_fee`—, credenciales por aliado, ciudades, métodos de pago,
requisitos y reglas. Clonar ese árbol entero crearía un gemelo a medias con reglas de riesgo copiadas
sin revisar, **que es peor que no tenerlas**».

Eso explica TODO lo que medí: 0 categorías, 0 reglas de categoría, 0 requisitos, 0 tramos. No son
huecos: es la decisión de la migración. El RTO no lista porque **su configuración de negocio no está
hecha**, y no lo está porque el lender todavía no tiene una sola solicitud.

⚠ **Y ojo con lo que hice yo:** sembré una categoría y copié 6 `lender_rules` del Motai RB para
intentar que listara. Eso es exactamente lo que la migración desaconseja — reglas de riesgo copiadas
sin revisar. **Sirve para probar el flujo, NO para concluir nada sobre conducta de negocio**, y hay
que borrarlo antes de medir cualquier otra cosa en esta base.

**No era el tipo de producto** (hipótesis de Miguel, verificada y descartada): `product` define si el
front muestra la calculadora y qué calcula (`app/Models/Lender.php:65`), no filtra el listado. Para
Ábaco ya lo reemplazó `lender_requirements`. Pero la pregunta destapó una inconsistencia real: el
clon quedó con **`product = renting`** cuando el valor `rto` existe y lo usa Motai RB (170).

**El corte es sistemático por `response_type`:** en las DOS sucursales probadas, todos los rt=2 de
Motai quedan fuera y los rt≠2 salen. Y no es config del lender — el 62 tiene 4 categorías, 4 tramos y
config CreditopX, y no lista; el 77 (CrediPullman) lista **sin un solo tramo**.

**Por dónde seguir:** leer `LenderRetrievalService::getLenders` en `main` siguiendo el camino rt=2
hasta el `unset`, con un `uReq` de Motai a mano. Todo lo de arriba ya está descartado con medición.


## 2026-08-22 · main al día: los rt=2 dejaron de listar EN TODAS PARTES

Se actualizó `legacy-backend` a `origin/main` (30 commits) y se corrieron las 11 migraciones de agosto
que faltaban. Antes y después, con el mismo comercio y el mismo caso:

    ANTES   pullman → [77, 100, 39, 68, 6, 9, 32]     ← 77 es CrediPullman, rt=2
    AHORA   pullman → [100, 39, 68, 6, 9, 32]         ← sin ningún rt=2

Y no es sólo Pullman: en kreditkasa, dormiluna y godentist tampoco aparece un solo rt=2. **O sea que
lo del Rent to Own NO era un caso particular** — es que después de actualizar, ningún CreditopX lista
en esta base. Hay que resolver ESO primero; el RTO viene después.

Sospechosos, sin verificar: las migraciones de calculadora
(`add_initial_fee_formula_to_calculator_lenders`, `store_calculator_formulas_as_an_ordered_list`) o
`disable_payment_date_selection_for_renting_and_rto`, todas de la tanda nueva. O un cambio de código
entre los 30 commits.

⚠ **Y un defecto del runner corregido acá que cambia cómo leer TODO lo medido antes.** El monto del
listado viaja por QUERY (`ListLenderController::index:39` → `$request->query('amount', 180000)`), no
sale de la solicitud. El runner no lo mandaba, así que **todo lo medido hasta hoy se calculó con
180.000**, incluido el censo de 223 comercios. Medido después de arreglarlo: para Pullman el monto
**no cambia quiénes salen, sólo el orden** — consistente con «el monto clasifica, no excluye» —, así
que el censo se sostiene en su conclusión gruesa. Pero cualquier medición fina de tramos por monto
hecha antes de este arreglo hay que rehacerla.
