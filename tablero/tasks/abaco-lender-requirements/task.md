---
id: 13
title: "Ábaco alineado a lender_requirements — se retiran los modos"
ramas: abaco-cupo-sin-buro, abaco-fuente-unica
stage: work
created: "2026-07-29T20:23:53-05:00"
knowledge: [abaco-requirements, lender-listing]
canon: [arrendamiento, kyc, preaprobado]
jira: [CORE-321]
jira_title: "Ábaco: el requisito lo define la entidad, sin «modos»"
---

El mecanismo revisado en `main` está en `knowledge/abaco-requirements`: requisito por entidad, vigencia configurable y salto de buró del motor modular. Las ramas llegaron a `main`, como registra la pila; queda comprobar migraciones, configuración y criterios de aceptación en el ambiente pertinente. La evidencia local y de QA de abajo conserva el alcance de su medición original.

QUÉ SE HIZO
1) PR #1028 — fuente única del requisito de Ábaco.
   - `AbacoRequirementService` dejó de tener dos fuentes: se borró la "Fuente A" (modos) y queda solo
     `lenderRequirementRepository->isAbacoEnabled((int) $userRequest->lender_id)` sobre
     `lender_requirements.abaco_is_enabled` (tabla de Fercho).
   - Migración `2026_07_28_100000_backfill_abaco_is_enabled_from_lender_product`: upsert idempotente
     `abaco_is_enabled = 1` para `lenders.product IN ('renting','rto')`. Sin esto, el mismo deploy que
     mueve la decisión a la tabla APAGA Ábaco en silencio (MOTV1001 → MOTV1000).
   - Migración `2026_07_28_110000_drop_allied_modes_and_user_request_modes_tables`: drop de
     `allied_modes` y `user_request_modes`. DESTRUCTIVA — `down()` recrea el esquema, no los datos
     (3 filas de catálogo + 22 históricas, ninguna posterior a junio). Verificado: sin FKs entrantes.

2) PR #1032 — cupo sin buró para quien valida ingreso por Ábaco.
   - `Modules/Loans/App/Services/LenderUserCategoryService::evaluateEligibility`: si el usuario no tiene
     fila de datacrédito Y el lender tiene `abaco_is_enabled`, se salta el corte duro
     (`if (!$user->datacredito) return eligible:false`) y el cupo sale de
     `calculateAvailableAmountWithInitialFee($rule->category)` — la misma que usa el precedente
     venezolano/Magnocell, que no toca `$user->datacredito`.
   - Helper nuevo `lenderValidatesIncomeWithAbaco(int $lender_id)`: lee `lender_requirements`; si la
     query falla, `catch` → exige buró (fallback conservador). Sin hardcodes de ids (a diferencia del
     precedente, que tiene `lender_id === 84` y categoría 22 quemados).
   - Marca en el log: `users_category_log.category_rules_acceptance` trae `"skipped_bureau_abaco":true`.

POR QUÉ EL SEGUNDO PR ES PARTE DE ESTA MISMA TAREA
La des-motaización mató, junto con los modos, el bypass de buró que daba `isMotaiRenting`. Alinear a
`lender_requirements` obligaba a reponer ese comportamiento como CONFIG, no como excepción por comercio.

VALIDADO
- Local: usuario PEP sin buró (1828537, uReq 464552) → 169/170 con cupo 50.000.000; 168 y Credifamilia
  (sin Ábaco) siguen sin cupo; usuario CC con buró score 700 → 25.000.000 sin regresión.
- qa: `POST /api/loans/lender/available-quota` {user 1827761, lender 158} → approved, 20.000.000, cat 179.
  El mismo POST contra dev → `eligibility_criteria_not_met`, 0.

## Pendientes

- [ ] Comprobar flags y ejecución de las migraciones en el ambiente de prueba; termina cuando
  el requisito responde según `lender_requirements` y la retirada de modos está acreditada.
- [ ] Repetir cupo con y sin reporte de buró, con Ábaco encendido y apagado; termina cuando
  las reglas de categoría se conservan y el salto sólo aplica en los casos previstos.
- [ ] Comprobar el backend al que consulta pre-approvals y la configuración de vigencia;
  termina cuando la medición identifica el ambiente y no confunde el default de 7 días con un mes.
- [ ] Resolver la configuración de documentos PEP de entidades y sucursales al retomar ese frente;
  termina cuando la decisión tiene dueño y su comportamiento está probado, sin inferirlo de Ábaco.
  Depende de: producto y configuración — tipos de documento admitidos por entidad.

El viejo pendiente de parchear una segunda clase de categorías en Onboarding ya no describe
`main`: el listado modular usa el motor de Loans. `application` conserva otra implementación;
compartir BD no le agrega el salto de buró del backend modular. La publicación histórica del
contexto y los PRs de abajo no condicionan el cierre local ni sustituyen la aceptación funcional.

CONTEXTO ESCRITO
Nodo `motai` reescrito a v2 (commit b4c88da) + findings F-73…F-78 (commit 62077e5).
Ramas: `feature/abaco-fuente-unica` (#1028) y `feature/abaco-cupo-sin-buro` (#1032), ambas en `qa`.

## Tarea (publicable)

## En una línea
Que una entidad pida validación de ingresos con Ábaco ahora es un dato de configuración de esa entidad, y desaparece el mecanismo de "modos" que solo existía para un comercio.

## Por qué
Los "modos" eran un camino paralelo, exclusivo de un comercio, que decidía por código si el flujo pedía validación de ingresos con Ábaco. No se podía administrar, ninguna otra entidad lo usaba y obligaba a mantener un comportamiento distinto para un solo caso. Al pasarlo a configuración, cualquier entidad puede pedir Ábaco sin cambios de código.

## Qué cambia
- El requisito de validar ingresos con Ábaco se lee de la configuración de la entidad financiera.
- Se retira el concepto de "modo" del comercio en todo el flujo.
- Las personas **sin historia en centrales de riesgo** (por ejemplo, con documento PEP) pueden obtener cupo en las entidades que validan ingreso con Ábaco; antes quedaban sin cupo y no podían avanzar.

## Alcance
- Aplica al comercio de renting y a las entidades configuradas para validar ingresos con Ábaco.
- **No** cambia las entidades que no validan con Ábaco: siguen exigiendo historia en centrales de riesgo.
- Regresión: una persona **con** historia en centrales obtiene el mismo cupo que antes.
- Fallback: si la configuración no se puede leer, se exige central de riesgo — se comporta como hoy, no se abre cupo por error.

## Dónde probar
- Ambiente de pruebas · comercio de renting · marketplace de entidades.
- **Precondición:** comercio habilitado con la entidad de renting, y un usuario de prueba sin historia en centrales de riesgo (documento PEP).

## Cómo validar
1. Usuario **sin** historia en centrales → la entidad de renting aparece **con cupo** y el flujo permite continuar hasta la validación de ingresos.
2. Usuario **con** historia en centrales → obtiene el mismo cupo que antes (regresión).
3. Entidad que **no** valida con Ábaco + usuario sin historia → sigue **sin cupo** (no se abrió de más).

## Criterios de aceptación
- [ ] La entidad de renting ofrece cupo a un usuario sin historia en centrales y el flujo llega a la validación de ingresos.
- [ ] Las entidades que no validan con Ábaco no cambiaron su comportamiento.
- [ ] Ya no existe el concepto de "modo" de comercio en el flujo.

## Dependencias / contraparte
Requiere tres cosas antes de validar: la configuración de la entidad activada, la actualización de base de datos aplicada en el ambiente, y el cambio publicado en el ambiente que consulta el servicio de pre-aprobación de cupo. Si falta lo último, la tarjeta seguirá mostrando "sin cupo" aunque el cambio esté correcto.
