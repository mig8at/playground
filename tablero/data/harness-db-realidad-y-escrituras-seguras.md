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

✅ **Las dos mitades están hechas** (`8ac74de` el preflight · `e8d09d5` las escrituras).

**El próximo paso es** migrar los llamadores a `borrarSeguro`/`insertarFila` **de a uno, cuando se
toque cada archivo** — ya no es una deuda de seguridad (la guarda es estructural), es prolijidad.

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


## Lo que se hizo: las escrituras (2026-09-15)

> **MEDICIÓN · 2026-09-15** — de los 15 archivos que escriben, **nueve no nombraban la guarda nunca**.
> **Cómo se vuelve a comprobar:** por archivo, `grep -c "assertWriteAllowed"` contra el conteo de
> `INSERT|UPDATE|DELETE`.

| sin nombrar la guarda | escrituras propias |
|---|---|
| `dev/caso.ts` | 9 |
| `dev/montar-rto.ts` | 8 |
| `dev/caminar-wizard.ts` · `dev/inyectar-aml.ts` | 3 cada uno |
| `dev/listado.ts` · `dev/montar-kyc-flow.ts` · `dev/qr-corbeta.ts` · `dev/sweep.ts` | 2 cada uno |

⚠ **Y `exec()` no guardaba por sí mismo**, así que `make harness-caminar` contra `qa` le cambiaba la
lista de teléfonos del bypass (`settings`) **a todo el equipo**, en silencio. Es la misma forma de F-53.

### La guarda dejó de ser opcional

`exec()` ahora detecta que la sentencia **muta** (`mutacionDe()`) y llama la guarda sola. Comprobado
contra `qa`:

    escritura a DB COMPARTIDA bloqueada (target qa, host inertia-dev…rds.amazonaws.com)
      la disparó: UPDATE settings
      Si de verdad querés escribir ahí, exportá I_KNOW_THIS_TOUCHES_SHARED_DEV=1 en la shell.
      Si NO querés, corré con E2E_TARGET=local (F-53).

✔ **Y no marca de más:** `SET FOREIGN_KEY_CHECKS` (perilla de sesión, la usan los seeders) y un
`SELECT … WHERE motivo='delete'` **no** cuentan como mutación. Hay prueba para eso: un chequeo que
grita de más se aprende a ignorar.

✔ **De paso registra lo que toca**, y eso llena un hueco declarado: `dbops activity` reconstruye lo
escrito **consultando la base después**, y su propio comentario admite que **no ve los DELETEs** (una
fila borrada no está para ser vista). Este registro anota la sentencia cuando corre.

### `pkg/db-safe.ts` — las funciones nombradas

| función | qué impide |
|---|---|
| **`borrarSeguro()`** | sin `WHERE` no borra · un `WHERE` que no filtra (`1=1`) tampoco · **cuenta primero** y aborta si matchea más de `maxFilas` (50 en compartida, 5.000 en local) · `soloContar` mide el alcance sin borrar |
| **`actualizarFilas()`** | mismo trato: un `UPDATE` sin `WHERE` pisa la tabla entera y **no tiene la señal de alarma que tiene «delete»** |
| **`insertarFila()`** | columnas y valores salen del MISMO objeto, así que no se pueden desalinear — reemplaza las listas de 15 columnas y 15 `?` a mano |
| **`withWrite()` · `withWriteTx()`** | agrupan y etiquetan. La versión `Tx` **pasa la conexión** porque el `exec()` del módulo usa el pool: prometer atomicidad sin darla sería peor que no tenerla |

**El tope es la red que importa.** `WHERE tel = ?` con el parámetro vacío puede matchear miles de filas
y el `DELETE` no se queja. Probado: 6 filas contra un tope de 3 → aborta, y el conteo **no se movió**.

**37 pruebas en verde.** La mitad que necesita base **se salta si el target no es local**, sobre una
tabla propia por worker: probar la herramienta no es motivo para escribir en la compartida.

### Y lo que faltaba del preflight: `subDelAsesor()`

El caminador leía **sólo** `E2E_ASESOR_SUB`, que en `local` no está — así que su chequeo **se salteaba
sin decir nada**, y un chequeo que se saltea se lee igual que uno que pasó. La cadena
(`E2E_ASESOR_SUB` → `.flows.json`) estaba implementada **tres veces** (`bin/asesor`, el panel, el
caminador); ahora vive una sola vez. Comprobado corriendo: avisa **antes** de caminar y la línea
siguiente confirma el redirect que predijo.

⚠ **Y lo destapó una corrida que se me movió sola:** pedí `13874eb6` y caminé `f0548728`, porque
otra sesión reasignó al asesor por afuera mientras yo trabajaba. El preflight lo dice ahora; antes el
síntoma era «la entidad 77 no salió en el listado».


## La comprobación en PARALELO: 4 comercios, y el listado coincide entidad por entidad (2026-09-15)

> **MEDICIÓN · 2026-09-15** — la pregunta original («¿el harness lee la realidad de la BD o hay cosas
> quemadas que mienten en qué lenders van a salir?») contestada corriendo, contra cuatro comercios
> distintos a la vez.
> **Cómo se vuelve a comprobar:**
> `E2E_TARGET=local make harness-caminar CASOS='#a1a55fab:6;#dc835830:100;#2b2b4b16:7;#2e4fdf84:23' FLOW=self-service PAR=1`

**4/4 listaron en 7,9 s.** Y contrastando cada listado contra los lenders activos de ESA sucursal
(`lenders_by_allied_branches` + `lenders.status`):

| comercio | la BD declara | el wizard listó | |
|---|---|---|---|
| `a1a55fab` 14-85 Dental Spa | `5,6,9,23,39,68` | `39,9,23,5,68,6` | ✅ los mismos 6 |
| `dc835830` ACTION BIKES | `5,6,9,68,100` | `9,5,68,100,6` | ✅ los mismos 5 |
| `2b2b4b16` AHL | `5,6,7,9,16,17,20,68` | `9,5,68,16,20,17,6,7` | ✅ los mismos 8 |
| `2e4fdf84` Aliviamos | `5,23,68,100` | `100,5,23,68` | ✅ los mismos 4 |

✔ **Conclusión medida: el CONJUNTO de entidades que lista el wizard es exactamente el que declara la
sucursal en la base.** No hay lista quemada en ningún lado.

⚠ **El ORDEN sí difiere, y eso NO es un desajuste.** El orden lo decide el ranking (ML H2O + fallback
por matrices, con rt=2/rt=3 forzados arriba), no la base. Leer la diferencia de orden como «el harness
miente» sería un falso positivo; lo que hay que comparar es el conjunto.

⚠ **Y el canal importa para esta prueba.** Se usó `FLOW=self-service` a propósito: el canal de ASESOR
está pegado a la sucursal del asesor logueado, así que **no se pueden correr varios comercios en
paralelo por ahí** — los cuatro aterrizarían en la misma sucursal. Por autogestión el hash del caso
manda, y ahí sí se puede variar el comercio.

### Y correr en paralelo destapó un bug MÍO, del mismo día

`_etiqueta` del registro era un `let` de **módulo** —una por proceso—, así que dos `withWrite`
concurrentes se la pisaban: en un `Promise.all` los dos la fijan antes de que resuelva el primer
`await`, y ganaba el último. El registro atribuía las escrituras de un caso al otro.

⚠ **Es exactamente la trampa que `pkg/trace.ts` ya había pagado** y que `harness/CLAUDE.md` tiene
escrita —*«el estado de la traza vivía en el módulo, o sea UNA por proceso: correcto para los tres
runners de un caso, y roto para N casos a la vez»*—. La volví a cometer, el mismo día, en el archivo de
al lado. Arreglado con `AsyncLocalStorage` y **con su prueba**, que es lo único que la caza: con el
`let` de módulo daba 0 y 2 en vez de 1 y 1.


## La tanda que CIERRA en paralelo: 3 comercios rt=2, y dos hallazgos (2026-09-15)

> **MEDICIÓN · 2026-09-15** — tres comercios con entidades `rt=2` **distintas**, cerrando en
> plataforma, contra local con PHP en multi-worker (1+6) y los PDF por **Blade** (el camino real, no el
> mock — así se ejercitan las plantillas, F-150).
> **Cómo se vuelve a comprobar:**
> `E2E_TARGET=local make harness-caminar CASOS='#bb534d6a:37;#5aff189c:46;#fbaf73a6:48' FLOW=self-service PAR=1 CERRAR=1 MANUAL=1`

**1/3 cerró, en 43 s** — o sea **tres casos en el tiempo de uno** (el que cerró tardó 43 s solo).

| caso | entidad | desenlace |
|---|---|---|
| `#5aff189c` Mediarte | **46** Mediarte X | ✅ **estado 11 «Autorizada»**, 11 pantallas |
| `#fbaf73a6` Unidad odontofacial | **48** UOF credit | 🔴 muere en el **OTP de firma** |
| `#bb534d6a` Creditop | **37** Creditop X | 🔴 muere en **`confirmation`** |

✔ **Y los dos fallos se REPRODUCEN EN SERIE**, así que **no son del paralelismo** — la capa de
escrituras nueva aguanta la concurrencia. Es el control que hacía falta para creerle a la tanda.

### Hallazgo 1 · UOF credit (48): el OTP de firma nace ya validado

El backend, preguntado directo, es explícito:

    POST /api/loans/requests/promissory-note/validate/verify-otp  {user_request_id:466688, otp:"929600"}
    → HTTP 422  {"success":false,"message":"Este usuario no tiene un OTP pendiente de validación."}

Y las filas de `otps` dicen por qué: **nacen con `updated_at == created_at` y `validated = 1`**, así
que nunca hay uno *pendiente* que verificar. Comparado con el caso que SÍ cerró:

| | primera fila de `otps` | |
|---|---|---|
| Mediarte (cerró) | creada 17:36:29 · **actualizada 17:36:30** | estuvo pendiente y **se validó** |
| UOF (falla) | creada 17:38:50 · actualizada 17:38:50 | **nació validada** |

⚠ **Ninguno de los dos teléfonos está en `qa_otp_bypass_phones`**, así que el bypass de QA no
interviene: es el camino de OTP de local. **Por qué una entidad nace con el OTP validado y la otra no,
NO lo aislé** — queda como el hilo a tirar. Reproducido 3 veces.

### Hallazgo 2 · Creditop X (37): `confirmation` responde un error genérico

    {"data":{"error":true,"errorCode":"unexpected","errorMessage":"No pudimos confirmar tu solicitud…"}}

Muere en la 4.ª pantalla, justo después de que la solicitud pasa a estado 3 «Seleccionó entidad».
`errorCode: "unexpected"` no dice nada del negocio: la causa está del lado del servidor y **no la
busqué** (en local un error así no deja rastro — el tracer va a un Loki que no existe; el camino es
repedirle el endpoint, según `harness/CLAUDE.md`).

### Y dos debilidades del runner, arregladas

1. **Reportaba `confirmation respondió error: true`.** Leía `error` —que en ese envelope es un
   **booleano**, «hubo error», no el detalle— y buscaba el texto sólo en `message`, cuando esa pantalla
   lo manda en `errorMessage`. Para saber qué había pasado hubo que repetir la llamada a mano. Ahora
   busca las tres formas y, si no hay ninguna, imprime el cuerpo. **Con eso el hallazgo 2 salió en la
   corrida siguiente, sin trabajo extra.**
2. Lo de la etiqueta del registro (arriba), que sólo se ve corriendo en paralelo.


## El log de la corrida, lo más detallado que se pudo (2026-09-15)

Tres cosas que **hoy hubo que averiguar a mano** y ahora salen en el log, en los **dos** caminos: la
consola (`harness-caminar`) y la UI (el panel, que transmite el stdout de `guided.spec.ts`).

### 1 · Lo que el arnés le escribió a la base

El registro de `pkg/db.ts` existía y **nadie lo imprimía**. Al cerrar:

    ── LO QUE EL ARNÉS ESCRIBIÓ EN LA BASE · local ──
       (la siembra y los bypasses; lo que escribe el backend por la API va aparte — `dbops activity`)
       user_field_values       INSERT               3 fila(s)
       users                   UPDATE               2 fila(s)
       risk_central_user_data  DELETE+INSERT        1 fila(s)
       8 sentencia(s) · incluye DELETEs, que `dbops activity` no puede ver
       detalle sentencia por sentencia → .runs/escrituras-<ts>.json

**Importa para algo concreto:** una corrida puede decir «0/N cerraron» y haber dejado la base llena
—ya pasó tres veces (F-176, F-180)— y **relanzarla entonces DUPLICA los datos**. Contra una base
compartida eso es lo primero que hay que mirar antes de volver a lanzar.

⚠ **La cabecera aclara que es lo que escribe EL ARNÉS, no el flujo.** Sin eso se lee al revés
(«escribió 8 sentencias y no veo la solicitud»): lo que escribe el backend cuando el runner le pega por
la API no pasa por este registro.

### 2 · El status HTTP del paso que falló — y de QUIÉN es

Un 422 y un 500 se depuran distinto, y sin el número había que repetir la llamada para saber cuál fue.

⚠ **Pero el status se etiqueta como «del FRONT», y no es pedantería.** Medido con el OTP de firma: el
front responde **200 con el error adentro del cuerpo** mientras el backend había devuelto **422**.
Leer ese 200 como «el backend estuvo bien» manda a buscar el bug en el lugar equivocado.

### 3 · En la UI, los BORRADOS que la comprobación no podía ver

El panel corre el spec como **hijo**, así que su registro vive en la memoria del hijo: el spec lo
vuelca a `.runs/escrituras-guiado.json` y el panel lo lee. Su bloque post-corrida gana:

    arnés:      users (UPDATE 2) · risk_central_user_data (DELETE+INSERT 1) · …
                ↑ lo que escribió el ARNÉS (siembra y bypasses), 8 sentencia(s)
                  — con BORRADOS en …, que la línea «tablas» no puede ver

✔ **Ése es el dato nuevo.** La línea `tablas:` sale de `dbops activity`, que **reconstruye** el rastro
consultando la base después — y su propio comentario admite que **no ve los DELETEs**, porque una fila
borrada no está para ser consultada. **El scrub del cliente borra en CADA corrida (F-52) y nunca
apareció en esa comprobación.**


### 4 · Y el hueco que quedaba: la causa del backend, cuando en local no hay dónde buscarla

> **MEDICIÓN · 2026-09-15, en esta máquina** — `LOG_CHANNEL=loki` en el `.env` de `legacy-backend`,
> Loki (`:3100`) **sin contestar**, y el último `laravel.log` con datos era del **13 de septiembre**.
> O sea que **los errores de backend de todas las corridas del día se perdieron**: el 422 «no tiene un
> OTP pendiente» del OTP de firma y el `errorCode: unexpected` de `confirmation` hubo que ir a
> buscarlos con `curl`.
> **Cómo se vuelve a comprobar:** `grep LOG_CHANNEL <legacy-backend>/.env` + `curl localhost:3100/ready`.

`harness/CLAUDE.md` ya llama a esa combinación **«el peor de los dos mundos»** —ni archivo ni Loki— y
es la **configuración normal de trabajo**: el `.env` queda en `loki` y el stack de observabilidad no se
levanta para cada corrida.

**`avisoLogsDelBackend()` lo DIAGNOSTICA** en vez de avisar siempre: lee el `LOG_CHANNEL` del otro repo
y prueba `:3100`. Si Loki está arriba **no dice nada** — un aviso que sale igual en los dos casos se
aprende a ignorar. Sale **cuando un caso no cierra**, que es cuando se va a buscar la causa, en el
caminador **y** en el spec visual (consola y UI):

    ⚠ LOS ERRORES DEL BACKEND DE ESTA CORRIDA NO QUEDARON EN NINGUNA PARTE.
       `LOG_CHANNEL=loki` en el .env de legacy-backend y Loki (:3100) no contesta: el handler se
       traga su propio fallo y el fallback a storage/logs NO dispara. Ni archivo ni Loki.
       Para ver la causa de un 500 sin levantar nada, pedile el endpoint de nuevo:
         curl -s -w '\nHTTP %{http_code}\n' http://localhost/api/loans/requests/promissory-note/466694
       O levantá el stack: `make harness-obs-up`

✔ Trae el comando **con la solicitud ya puesta**, el mismo idioma que los avisos de PostHog y de Loki.

### ⚠ Y un bug mío, visto en la primera salida del registro

`mutacionDe` leía `DROP TABLE IF EXISTS x` como la tabla **«if»**, porque el `IF EXISTS` va entre el
verbo y el nombre. Lo vi en el propio log que vine a hacer confiable. **Un registro con nombres
inventados se lee como si fueran tablas reales: es peor que no tenerlo.** Arreglado con su prueba.

**39 pruebas en verde** entre las tres suites, typecheck 0.

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

### 2026-09-15 (3) · las escrituras seguras, hechas
`exec()` guarda y registra solo; `borrarSeguro`/`actualizarFilas`/`insertarFila`/`withWrite` en
`pkg/db-safe.ts`. Lo que cambió el plan respecto de la propuesta: **no hizo falta migrar 18 archivos**
para cerrar el riesgo — poniendo la guarda dentro de `exec()` quedaron cubiertos los nueve que no la
nombraban, de una. Migrar los llamadores a las funciones nombradas pasa a ser prolijidad, de a uno
cuando se toque cada archivo. 37 pruebas, typecheck 0.

### 2026-09-15 (4) · la comprobación en paralelo
Cuatro comercios distintos a la vez, 4/4 en 7,9 s, y el conjunto de entidades coincide con lo que
declara cada sucursal — la pregunta original queda contestada corriendo, no leyendo. El paralelo
además destapó que mi propio registro guardaba la etiqueta en el módulo: mismo error que trace.ts,
arreglado con `AsyncLocalStorage` y con la prueba que lo caza.

### 2026-09-15 (5) · la tanda que cierra, y dos hallazgos del producto
Tres comercios con rt=2 distintas, cerrando: 1/3 en 43 s (tres casos en el tiempo de uno). Los dos
fallos se reproducen EN SERIE, así que no son del paralelismo — la capa de escrituras aguanta. UOF
credit (48) muere en el OTP de firma con un 422 «no tiene un OTP pendiente» y sus filas de `otps`
nacen ya validadas; Creditop X (37) muere en `confirmation` con `errorCode: unexpected`. Ninguna de
las dos causas raíz está aislada. Y el runner dejó de reportar «error: true»: buscaba el mensaje en
`message` cuando venía en `errorMessage`.

### 2026-09-15 (6) · el log de la corrida, detallado en los dos caminos
El registro de escrituras existía y nadie lo imprimía: ahora sale al cerrar (consola y UI), con el
detalle sentencia por sentencia volcado a `.runs/`, y el panel muestra los BORRADOS que `dbops
activity` admite que no puede ver — el scrub borra en cada corrida y nunca aparecía. Más el status
HTTP del paso que falló, etiquetado como «del front» porque medido responde 200 donde el backend dio
422. Y un bug mío en el propio registro (`DROP TABLE IF EXISTS x` → tabla «if»), visto en su primera
salida y arreglado con prueba.

### 2026-09-15 (7) · el aviso de que la causa del backend no quedó registrada
Cerrado el hueco: en local, con `LOG_CHANNEL=loki` y Loki abajo, los errores de runtime se pierden en
silencio — medido, el último `laravel.log` era de dos días antes y los errores del día entero no
existen. El runner lo diagnostica (no avisa siempre) y, cuando un caso no cierra, dice que no hay
rastro y da el comando que sí funciona con la solicitud puesta. En consola y en la UI.

### 2026-09-15 (8) · un solo lugar decide el ambiente, y hay cómo comprobarlo
La pregunta era si el arnés consulta el Loki y la base que le pidas, transparente por ambiente y sin
duplicar la lógica. **Medido: sí, por una sola cadena** (`process.env` > `.env.<target>`), y así
resuelven backend, front, base y Loki en los cuatro ambientes. **Corrección a la premisa: la base
local NO es la compartida** — `dev`, `qa` y `staging` sí comparten servidor, local es `127.0.0.1`,
un volcado en Docker. De esa diferencia depende la guarda que decide si una escritura pide permiso.

**Cinco lugares no le preguntaban a la cadena**, y el patrón es siempre el mismo: leer del entorno
pelado una clave que sólo vive en el archivo de UN ambiente, así que el valor no cambia nunca y no
falla — miente. El peor posteaba el carrito de la tienda al servidor local en los cuatro ambientes:
pidiéndole «ambiente de pruebas compartido» leía las credenciales de allá y escribía acá. Otros tres
mandaban el asesor del catálogo local contra un ambiente compartido, y eso borra el asesor de la
solicitud. El quinto dejaba un aviso al comercio apagado del todo, pareciendo encendido.

**La comprobación ya existía y no veía esta clase**: miraba los valores resueltos, y un lugar que
nunca pregunta los da perfectos. Ahora además revisa quién lee por fuera, con la lista de claves
derivada de los archivos de ambiente y no escrita a mano, y queda fijada con prueba. Entra al
catálogo (`make harness-ambiente TARGET=…`): estaba escrita y era invisible.

Tres cosas más aparecieron al hacerlo. La comprobación anunciaba en su encabezado que acepta el
ambiente por argumento y **nunca lo leía**: pedirle uno revisaba otro, con el aplomo de haber
revisado el pedido. El canal de la tienda decía «error 422» y tiraba el motivo que el propio cuerpo
traía. Y **ese 422 era mío, de hoy**: al agregar el teléfono por parámetro quedó una comparación que
sólo cae con valor nulo, y el parámetro ausente llega vacío, no nulo — así que el teléfono derivado
no se usaba nunca. Probé el camino nuevo, que siempre pasa el parámetro, y dejé roto el de siempre.
El canal vuelve a cerrar 16/16.

**Y hay una excepción deliberada a la transparencia, que se queda**: pedir el ambiente local
apuntando al Loki de un ambiente remoto está bloqueado a propósito. Con la base funciona —leés las
filas que tu corrida escribió—; con los registros no, porque tu corrida local no escribió allá y los
identificadores se solapan: mostraría la solicitud de otra persona como si fuera tuya. Transparencia
que produce un diagnóstico falso no es transparencia.
