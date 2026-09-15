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

✅ **El preflight YA ESTÁ (commit `8ac74de`).** Miguel eligió arrancar por ahí el 15/9.

**El próximo paso es** decidir si se hace la **capa de escritura segura** (§«Propuesta», la mitad que
falta) — es un refactor de 18 archivos y no bloquea nada: el preflight ya tapa la mentira.

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


## Lo que se hizo: el preflight (2026-09-15)

> **MEDICIÓN · 2026-09-15** — el chequeo que ya existía miraba la fuente equivocada, y por eso no
> cazaba nada.
> **Cómo se vuelve a comprobar:** `E2E_TARGET=qa node bin/dbops.ts sucursal-check pullman <sub>`

**El hallazgo que faltaba:** `bin/asesor` y el panel comparan
`whois(SUB).matches[0].allied_branch_hash` contra el hash del catálogo. Eso mira la **BASE**, que es un
**proxy**: el wizard no usa `users.allied_branch_id`, usa lo que le devuelve el **BACKEND** para el sub
logueado (`GET /api/onboarding/loan-application/user` con `x-cognito-identity-id`, y de ahí
`allied_branch.hash`). Por eso la corrida del 15/9 imprimió «ya en 'pullman' (13874eb6) — sin write» y
aterrizó en otra sucursal: el chequeo decía la verdad **sobre la tabla**, y la tabla no es lo que manda.

Medido preguntándole al backend por cada sub:

| sub | el backend devuelve | de quién |
|---|---|---|
| `E2E_ASESOR_SUB` de `.env.qa` | `1bfb8cd0` CeluRD Santo Domingo | **oscar+dentix@creditop.com** |
| `asesor.sub` de `.flows.json` | `f0548728` PRINCIPAL (Motai) | a.arismendy@uniandes.edu.co |
| la sesión cacheada | → aterrizó en `ec977139` | un tercero |

⚠ **Y el sub configurado para qa es de OTRA PERSONA.** No es sólo que el catálogo esté viejo: las tres
fuentes apuntan a tres asesores distintos.

**`pkg/preflight-sucursal.ts` — SÓLO LECTURA** (no escribe, no reasigna, no borra sesiones). Dos
mitades, y la segunda es la que vale:

1. **`preflightSucursal()`** — le pregunta al **backend** por el sub y lo compara con el catálogo.
   Expuesto como `dbops sucursal-check <merchant|hash> <sub>`, cableado en `bin/asesor` (después de
   `load-permiso`) y en el rastro del panel.
2. **`avisoDeRedireccion()`** — **caza el caso sin importar cuál de las tres fuentes esté mal**: si el
   wizard te mueve de sucursal, el 302 ya se veía en el log como un salto más de navegación; ahora dice
   que **invalida el anuncio**. Cableado en `guided.spec.ts`, una vez por corrida.

✔ **«No se pudo comprobar» se dice como tal, no como desajuste** — un aviso que grita igual en los dos
casos se aprende a ignorar, y el día que sí hay desajuste tampoco se mira. Hay prueba para eso.

**Comprobado:** desajuste (`pullman`) avisa 7 líneas · control (`celurd`) **0 avisos** · 9 pruebas
nuevas, **23/23** con las del trío · typecheck **0** · `bash -n bin/asesor` ok.

## Registro

### 2026-09-15 · auditoría y propuesta
Auditado de dónde salen los lenders del panel (BD, no hardcode) y toda la superficie de escritura (18
archivos, `exec` crudo). Encontrada la mentira de SUCURSAL: `.flows.json` (catálogo estático) vs
`users.allied_branch_id` (BD) se leen aparte y nunca se contrastan — medido con Amoblando Pullman
(`13874eb6` branch 659 vs `ec977139` branch 390, listas distintas). Propuesta `pkg/db-safe.ts`: un
preflight que caza la mentira (no escribe) + una capa de escritura por función con guarda no-opcional,
transacción, registro y undo. Falta que Miguel elija alcance.

### 2026-09-15 (2) · el preflight, hecho
Cableado el chequeo en `bin/asesor`, el panel y el spec visual. Lo que destapó construirlo: el chequeo
que ya existía comparaba contra la **BASE** (`whois`) y el wizard usa el **BACKEND** — por eso decía
«ya en X — sin write» y se iba a otra sucursal. Y el `E2E_ASESOR_SUB` de `.env.qa` resuelve a un
comercio de **otra persona**. La mitad dinámica (`avisoDeRedireccion`) es la que caza el caso sin
importar cuál de las tres fuentes esté mal. Queda la capa de escritura, que no bloquea nada.
