---
id: 86
title: "Harness: que refleje la BD real y no catálogos que mienten, y escrituras seguras con funciones definidas"
clase: proyecto
stage: work
ramas:
created: "2026-09-15T17:00:00-05:00"
context_nodes: [harness, findings]
jira: []
jira_title: ""
---

# Harness: la BD como única verdad, y una capa de escritura segura

## Si retomás esto sin contexto, empezá acá

Miguel pidió dos cosas, el 2026-09-15, a raíz de que el panel anunció unas entidades y la corrida usó
otras: **(1)** validar que el harness lea la realidad de la BD (local o compartida) y no cosas quemadas
que mientan sobre qué lenders van a salir; **(2)** si hay que mejorar, hacer **funciones claras y
seguras para insertar/borrar** en las tablas, para que los flujos que escriben sean seguros.

**El próximo paso es** decidir el alcance de la capa de escritura segura (§«Propuesta») — Miguel elige
entre el arreglo mínimo (sólo el preflight que caza la mentira) y la capa completa.

## Lo que se auditó, y el veredicto (2026-09-15)

> **MEDICIÓN · 2026-09-15** — el panel **no** tiene los lenders quemados: los lee de la BD por
> `bin/dbops.ts lenders-for <hash>` → `lenders_by_allied_branches`. Lo que miente es **de qué sucursal**
> los lee.

**Verdicto corto: los lenders salen de la BD, no de un hardcode. La mentira es de SUCURSAL.**

El panel arma su anuncio (`panel/server.ts:467`) con `branchHashForSlug(slug, target)`, que resuelve el
hash **desde `.flows.json`** — un catálogo estático, mantenido a mano. Pero el wizard aterriza en la
sucursal que el asesor tiene **asignada en la BD** (`users.allied_branch_id` → el backend la devuelve
como `allied_branch.hash`, y `default-layout.tsx:108` redirige ahí si no coincide). Cuando esos dos
desacuerdan, el panel anuncia los lenders de una sucursal y la corrida usa los de otra.

**Medido, el caso que lo destapó:**

| | hash | branch | lenders activos |
|---|---|---|---|
| panel anunció (`.flows.json` → `pullman`) | `13874eb6` | 659 | Sistecrédito, CrediPullman, Cierre X |
| corrida usó (asesor asignado en BD) | `ec977139` | 390 | Addi, Vanti, CrediPullman, **Crédito 365** |

Los dos son «Amoblando Pullman» — sucursales distintas del mismo comercio, con listas distintas. El
`.flows.json` apunta a 659; el asesor de qa está asignado a 390. Nadie mintió a propósito: el catálogo
quedó viejo respecto de a qué sucursal quedó asociado el asesor la última vez.

⚠ **Esta es la clase de mentira que preocupa, y hoy nada la avisa:** el anuncio y el flujo real leen la
sucursal de **dos fuentes distintas** (`.flows.json` vs `users.allied_branch_id`) y nunca se contrastan.

### Lo demás que se leyó, y es sano

- **`.flows.json`** (29 comercios) declara **sólo** `branch_hash`/`por_target` y el asesor — **no**
  declara lenders. Verificado: 0 comercios con `lenders` adentro. Es un mapa de hashes, no una fuente de
  entidades.
- **`comercios/*.json`** (alta.json, alta-compartida.json) son **specs de siembra** (`make
  harness-comercio`): describen lo que se VA a crear en una base vacía, no lo que hay. No se consultan
  para anunciar.
- **`suites/*.json`** declaran lo ESPERADO de un caso (asersiones), no lo que existe.
- El resto de las lecturas del panel (`lenders-for`, `is-corbeta`, `flow-id`, `ecommerce-ok`) van todas
  a la BD por `dbops`.

## La superficie de ESCRITURA, hoy (2026-09-15)

`exec()` crudo se llama en **18 archivos**. Cada uno arma su `INSERT`/`UPDATE`/`DELETE` a mano. La
guarda `assertWriteAllowed()` (F-53) existe y cubre el host compartido, pero **se llama a criterio de
cada quien**: `bin/dbops.ts` la llama en 3 de sus casos de escritura; los runners (`caso.ts`,
`caminar-wizard.ts`, `close.ts`) la llaman una vez al arrancar; y hay escrituras que **no la nombran**
(el `DELETE FROM users` de `guided.spec.ts:884`, los `UPDATE settings` del bypass de OTP).

**Las tablas que toca el harness, agrupadas por para qué:**

| grupo | tablas | quién |
|---|---|---|
| identidad del cliente sintético | `users`, `user_summaries`, `user_field_values` | `inject.ts`, `caso.ts`, `caminar-wizard.ts` |
| buró forjado | `risk_central_user_data` | `inject.ts`, `caso.ts`, `inyectar-aml.ts` |
| la solicitud | `user_requests` | `qr.ts`, `listado.ts`, `sweep.ts`, `qr-corbeta.ts`, `guided.spec.ts`, `close.ts` |
| firma / cierre | `otps`, `payment_gateway_transactions`, `user_requests` | `close.ts`, `inject.ts` |
| el asesor | `users` (cognito_id/branch) | `asesor.ts` |
| perillas de ambiente | `settings` (`qa_otp_bypass_phones`) | `caso.ts`, `caminar-wizard.ts` |
| config del comercio | `lenders.status`, `lenders_by_allieds.sort`, `lender_allied_credentials` | `dbops.ts`, `inject.ts` |
| siembra de comercios | ~15 tablas | `montar-comercio.ts`, `montar-peru.ts`, `montar-rto.ts` |

**Riesgos concretos:**
1. **La mentira de sucursal** (arriba) — la fuente del anuncio ≠ la fuente del flujo.
2. **`assertWriteAllowed` es opt-in** — una escritura nueva que se olvide de llamarla pega contra el
   compartido sin red. Ya pasó con los specs de `channel/` (F-53 / la medición del 2026-09-14).
3. **Cada quien arma su SQL** — 18 copias de `INSERT INTO user_requests …` con columnas ligeramente
   distintas; una tabla que gane una columna NOT NULL rompe N sitios y cada uno se arregla aparte.
4. **Los borrados son directos** (`DELETE FROM users …`, `DELETE FROM risk_central_user_data …`) sin un
   lugar común que registre qué se borró ni que confirme el alcance.

## Propuesta: `pkg/db-safe.ts` — escrituras por función, no por SQL suelto

La idea es que **nadie vuelva a escribir `exec('INSERT …')` a mano** para las tablas del dominio, y que
la guarda y el registro no dependan de acordarse.

**Núcleo (barato, y no escribe nada — se puede hacer ya):**
- `preflightSucursal(slug, target)` — compara el hash de `.flows.json` contra la sucursal REAL del
  asesor en la BD, y **avisa si difieren** antes de anunciar lenders. Caza exactamente la mentira de
  este caso. Va en el panel y en `bin/asesor`.

**Capa de escritura (pide confirmación de alcance):**
- `withWrite(fn)` — envuelve toda mutación: llama `assertWriteAllowed()` una vez, corre en transacción,
  y **registra en `.runs/` cada tabla tocada**. Que la guarda no sea opt-in: si escribís, pasás por acá.
- funciones nombradas por intención, no por tabla: `seedSyntheticIdentity()`, `forgeBuro()`,
  `createUserRequest()`, `assignAdvisor()`, `setLenderStatus()`, `scrub…()` — cada una con su
  `undo`/snapshot como ya hace `asesor.ts` (que es el modelo a generalizar: guarda el estado previo y
  sabe revertir).
- los 18 sitios migran a estas funciones; el `exec` crudo queda sólo dentro de `db-safe.ts`.

⚠ **Todo esto escribe contra un RDS compartido en dev/qa/staging**, así que la capa se prueba **en
local** y cada función lleva su prueba (como `fecha-trio.spec.ts`). No se toca el compartido para
probar la herramienta.

## Registro

### 2026-09-15 · auditoría y propuesta
Auditado de dónde salen los lenders del panel (BD, no hardcode) y toda la superficie de escritura (18
archivos, `exec` crudo). Encontrada la mentira de SUCURSAL: `.flows.json` (catálogo estático) vs
`users.allied_branch_id` (BD) se leen aparte y nunca se contrastan — medido con Amoblando Pullman
(`13874eb6` branch 659 vs `ec977139` branch 390, listas distintas). Propuesta `pkg/db-safe.ts`: un
preflight que caza la mentira (no escribe) + una capa de escritura por función con guarda no-opcional,
transacción, registro y undo. Falta que Miguel elija alcance.
