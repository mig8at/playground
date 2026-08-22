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

**Descartado, con medición:**

| hipótesis | medido |
|---|---|
| no está cableado a la sucursal | está: `lenders_by_allied_branches` lo tiene |
| entidad o arista inactivas | las dos en `status=1` |
| falta a nivel comercio | `lenders_by_allieds` tiene los diez |
| sin `group_rules` en la sucursal | la 682 tiene **11** |
| sin tramo por monto | los 158/168/169/170/173 no tienen, **pero el 62 sí y tampoco lista** |
| `have_ctopx` | el comercio lo tiene en **0** |

Tampoco hay bucket `false_lenders` en la respuesta: los rt=2 se caen sin dejar rastro en los logs, o
sea que el corte es **antes** de evaluar reglas.

**Por dónde seguir:** leer `LenderRetrievalService::getLenders` en `main` para ver cuál es la base real
de la consulta en este comercio — que es lo que ninguna de las seis hipótesis de arriba explica.
