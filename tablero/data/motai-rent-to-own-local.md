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


## 2026-08-22 · en `main` NO lista ningún rt=2 — y en la rama de trabajo SÍ

`legacy-backend` quedó en `origin/main` al día (`a2484149`, 30 commits traídos) con las 11 migraciones
de agosto corridas. Y ahí ningún CreditopX lista, en ningún comercio: pullman, kreditkasa, dormiluna y
godentist, todos sin un solo rt=2.

⚠ **Corrección de una atribución mía.** Primero lo escribí como «regresión de la actualización», y no
lo es. La diferencia aparece antes:

| dónde | ¿lista CrediPullman (77)? |
|---|---|
| rama `fix/CORE-258-sesion-por-telefono-canonico` | **sí** — es donde corrió todo el barrido de hoy |
| `main` viejo (`e52c4570`, 20-ago) | no |
| `main` al día (`a2484149`, 22-ago) | no |

O sea que **es una diferencia entre esa rama y `main`**, no algo que trajeron los 30 commits. El
momento en que lo vi fue el `checkout main`, y lo anoté al pasar como «una entidad menos, esperable
porque el código difiere» sin verificarlo — que es justo el tipo de observación que hay que parar a
medir.

**RESUELTO.** El diff de esa carpeta da 4 archivos, y el que manda es
`LenderUserCategoryService.php`: **+417 líneas en la rama**, o sea que `main` lo ELIMINÓ. El commit es
`729eb963` «refactor(policy): one category engine, and the hardcoded lender 160 fork goes with it»:

> *«The listing had its own copy of LenderUserCategoryService — a literal port of the one in
> legacy-application plus two criteria — while available-quota, extended and cosigner ran a separate
> rewrite in Loans. Two engines answering the same question, and a user could see one cupo on the
> marketplace card and another when the quota endpoint was asked… It is removed and both of its call
> sites now go through the surviving engine.»*

Así que **no es regresión ni bug: es una consolidación deliberada**, y en esta base local el motor
sobreviviente (el de `Modules/Loans`) no resuelve categoría para esos rt=2. La rama todavía tiene el
motor viejo, que sí la resolvía — de ahí que ahí listen.

Y de paso el mismo commit se llevó el `if ($ctopx_lender_id == 160)` que el mapa de lo quemado había
encontrado: era SmartPay y sólo en producción (`production ? 160 : 152`), «which meant the listing's
behaviour for that lender was not reproducible outside it».

**Lo que sigue para el RTO:** averiguar qué le pide el motor de `Loans` a la categoría que la base
local no tiene. Con eso listan todos los rt=2 —no sólo el Rent to Own— y recién ahí se puede ejercitar
la firma con codeudor.

⚠ **Y un defecto del runner corregido acá que cambia cómo leer TODO lo medido antes.** El monto del
listado viaja por QUERY (`ListLenderController::index:39` → `$request->query('amount', 180000)`), no
sale de la solicitud. El runner no lo mandaba, así que **todo lo medido hasta hoy se calculó con
180.000**, incluido el censo de 223 comercios. Medido después de arreglarlo: para Pullman el monto
**no cambia quiénes salen, sólo el orden** — consistente con «el monto clasifica, no excluye» —, así
que el censo se sostiene en su conclusión gruesa. Pero cualquier medición fina de tramos por monto
hecha antes de este arreglo hay que rehacerla.


## 2026-08-22 · RESUELTO: el RTO lista y su política de codeudor bloquea la firma

Miguel tenía razón en el razonamiento: **si corre en producción con `main`, el código está bien y lo
que falta es dato local.** Lo era, y eran DOS cosas.

**1 · Faltaban los TIPOS de categoría.** `main` consolidó los dos motores de categorías en uno
(`729eb963`), y el que sobrevive —el de `Modules/Loans`— pide un `typeId`:
`getLenderUserCategory($user_id, $lender_id, $typeId = LenderUsersCategoryType::TITULAR_INITIAL)`, con
tipos **titular_initial (1) · titular_extended (2) · cosigner (3)**. La tabla
`lender_users_category_types` y la columna `lender_users_category_type_id` (en las tablas de REGLAS,
no en la categoría) no existían en local: faltaban dos migraciones del **30 de julio**. Corridas:

    2026_07_30_120000_create_lender_users_category_types_table
    2026_07_30_120100_add_lender_users_category_type_id_to_policy_tables

Con eso **volvieron TODOS los rt=2**, no sólo los de Motai: `pullman` recuperó CrediPullman (77) y en
Motai aparecieron 168, 169 y 170.

**2 · Al RTO le faltaban sus categorías.** El clon no las copia (a propósito). Se copiaron las **cuatro**
del hermano Motai RB (170), todas con `requires_cosigner = 1`. ⚠ Con UNA sola —la «Premium», la más
estricta— seguía sin listar: un cliente que no pasa ese tier se queda sin categoría y la card
desaparece. Los que listan tienen los cuatro tiers, de Premium a Malos.

Resultado: `#f0548728` → `[170, 169, 168, 6, **173**, 8]`.

**Y la política de codeudor bloquea, como debe.** Cerrando por el 173:

    applicant_signature_blocked_missing_cosigner  {"user_request_id": 465276, "lender_id": 173}
    «Tu solicitud requiere un codeudor aprobado antes de firmar los documentos.»

El bloqueo ocurre **al generar el pagaré**, antes de autorizar. O sea que la rama de codeudor del RTO
está ejercitada de punta a punta en local.

⚠ **Lo que queda para cerrar de verdad:** el runner no implementa el sub-flujo del codeudor
(invitación → token → onboarding → OTP → firma). Sin eso no hay codeudor aprobado y la solicitud se
queda ahí — que es la conducta correcta, no un fallo.

⚠ **Y la config del 173 es de PRUEBA, no de negocio:** categorías y reglas copiadas del 170 sin
revisar, que es exactamente lo que la migración del clon desaconseja. Sirve para ejercitar el flujo;
no para concluir nada sobre conducta.


## 2026-08-22 · el sub-flujo del codeudor, recorrido: 4 de 6 pasos

Rutas reales (prefijo `api/v1/user-request`, de `Modules/UserRequestV1/routes/api.php`):

| paso | endpoint | resultado |
|---|---|---|
| 1 · arrancar | `POST /{ur}/cosigner-flow/start` | ✅ `statusId: 17` |
| 2 · invitar | `POST /{ur}/cosigner` `{"cellPhone":"…"}` | ✅ `cosignerId 1` · `pending` · **`invitationSent: false`** |
| 3 · entrar | `GET /cosigner/invitation/{token}` | ✅ `actor: cosigner` · `partnerHash` |
| 4 · onboardear | `phone/register` + `otp-validate` con `X-Cosigner-Token` | ✅ devuelve **la MISMA `user_request`** |
| 5 · identidad | `personal-info` con el token | ❌ **se traba** (abajo) |
| 6 · firmar | `POST /cosigner/signature/otp` + `/otp/verify` | sin llegar |

**Confirmado en vivo lo que el nodo decía:** el `invitationSent: false` con la fila creada igual (el
WhatsApp es best-effort), y que el codeudor entra a la **misma solicitud** — el `otp-validate` devolvió
`user_request_id: 465276`, el del titular.

⚠ **Faltaba sembrar el catálogo `cosigner_statuses`.** Sin él, registrar al codeudor devuelve
`URV15003 Internal server error` y el traceback apunta a `CosignerRepository::statusIdByCode` →
`firstOrFail()`. Lo siembra `database/seeders/CosignerStatusesSeeder` (9 estados: pending, validating,
not_eligible, approved, waiting_applicant_signature, waiting_cosigner_signature, formalized,
cancelled, replaced). La migración crea la tabla pero NO la llena.

**[SUPERADO — ver abajo] Dónde se traba (paso 5):** `personal-info` del codeudor revienta con
`ValueError: max(): Argument #1 must contain at least one element` en
`Modules/Identity/App/Services/AgildataService.php:159` — el `max(array_keys($periods))` sin guarda
cuando la respuesta del buró no trae pagos. Y ocurre **aunque el mock devolvió 8 pagos con períodos
actuales** (verificado en su log: `→ agildata default (doc 1099444002)`), así que el dato bueno no
está llegando al extractor por ese camino. Es lo próximo a mirar: por qué la consulta del CODEUDOR no
consume la misma respuesta que la del titular.


## 2026-08-22 (cont.) · 5 de 6 pasos, y el bloqueo final identificado

**El paso 5 se resolvió, y la causa era la CACHÉ DE UN MES.** El usuario del codeudor ya tenía una
fila de Agildata de 200 bytes —la respuesta mínima que se había dictado en un primer intento— y el
backend la reusó sin llamar al mock. Con `DELETE FROM risk_central_user_data WHERE user_id=…`,
`personal-info` pasó: `actor: cosigner`, `next_step: identity_validation`.

⚠ Es la trampa 1 de la tarea 49, y muerde distinto acá: el síntoma no fue «datos viejos» sino
`ValueError: max(): Argument #1 must contain at least one element` en `AgildataService.php:159` — el
`max(array_keys($periods))` no tiene guarda para una respuesta sin pagos. **Un buró que responde sin
historial laboral tumba el `personal-info` con un 500**, venga de un mock o de un proveedor real.

**El paso 6 no se alcanzó, y la compuerta está identificada.** `evaluate-eligibility` devuelve
`evaluated: false` a propósito: `EvaluateCosignerEligibilityService` sólo evalúa cuando
`hasCompletedValidations()` es cierto, y eso pide **AML + identidad**:

    return $aml['completed'] && (!$identity['applies'] || $identity['completed']);

- **Identidad: NO aplica.** Copiado `lender_identity_validation_types` del 170 al 173 (otra tabla que
  el clon no clona), `providers` responde `primary_provider: "none"`.
- **AML: falta.** El codeudor no tiene fila de `TusDatos - AML` (central id 4). La crea
  `TusDatosService::getOrCreateBackground`, expuesta en `POST /api/identity/aml/launch`
  (`Modules/Identity/routes/api.php:76`) — pero ese endpoint está **detrás de autenticación de
  sesión**: con el `X-Cosigner-Token` responde un redirect 302 a `/`, no un 401.

**Por dónde seguir:** o se dispara el AML desde el flujo (ver qué paso del wizard lo llama para el
titular, que ahí sí corre) o se resuelve la autenticación de ese endpoint. Es lo único que separa de
llegar a la firma con las dos partes.
