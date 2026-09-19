---
id: 89
title: "Context: el árbol de conocimiento al día con main, y que envejecer se note"
clase: proyecto
stage: work
created: "2026-09-19T08:00:00-05:00"
context_nodes: []
jira: []
jira_title: ""
---

## Para qué sirve, en una línea

<!-- `clase: proyecto` no sale a Jira; esto queda como nota del cuerpo -->
Que lo que `context/` afirma sea cierto **hoy**, y que cuando deje de serlo se vea sin leerlo entero.

## Si retomás esto sin contexto, empezá acá

**Estado al 19/9: los 39 nodos están re-verificados contra `main`. 38 sellados** (9 el 18/9, 29 el
19/9) y **`findings` deliberadamente SIN sellar**, con un bloque adentro que dice qué se comprobó y qué
no — sellar significa «lo revisé entero» y son 239 hallazgos con 77.000 palabras. No hay que volver a
medir el diagnóstico: cada nodo lleva su nota `(2026-09-19) Nodo RE-VERIFICADO entero` con el conteo de
afirmaciones auditadas y qué se corrigió.

**El próximo paso es** decidir si `findings` se sella por tandas o se queda declarado como está, y —lo
que más rinde— ponerle **una línea de estado por hallazgo**: hoy «¿cuáles siguen vivos?» es una lectura
de 77.000 palabras, con una ficha sería un grep. Está escrito en el propio nodo.

## Objetivo

Que `context/` describa lo que corre en `main` y no lo que corría; y que la deriva la detecte una
herramienta, no la memoria de alguien.

## Dónde se toca

- `context/server/data/flows/<nodo>/{doc.md,map.json}` — los 39 nodos.
- `context/tools/{oracle.py,refs.py,alinear.py,sellar-verificado.py}` — la validación.
- `make context-lint` · `context-refs` · `context-align` · `context-diff` — las puertas.

## Cómo se ataca

El protocolo de `context/CLAUDE.md`: extraer afirmaciones → clasificar **CÓDIGO** (leer `main`) /
**DATO** (medir, no leer) / **HISTORIA** (no re-verificar) → verificar **el SIGNIFICADO, no el ancla**
→ siempre `git show origin/main:<ruta>`, nunca el working tree → contar confirmadas separando
**fuertes** (leí la función) de **débiles** (el símbolo existe). De ese conteo depende si el nodo se
sella.

## Cómo se comprueba

`make context-lint` + `python3 context/tools/oracle.py <map.json>` (KEPT/DROPPED) +
`make context-refs NODE=x` (ancladas / movidas / corridas / fuera / no existen). Los tres tienen que
salir limpios **antes** de `python3 tools/sellar-verificado.py <nodo>`.

## Lo que se aprendió, y no estaba escrito

- 🔴 **La causa nº1 de citas mal no es la deriva de líneas: es la CITA SIN REPO.** Como el nombre del
  archivo existe en los dos monolitos, la cita «resuelve» contra el equivocado y apunta a otra cosa sin
  fallar nunca. Apareció en seis nodos (`entities`, `credifamilia`, `kyc`, `bancolombia`, `merchants`,
  `negocio`). **Y su variante peor es el archivo que NO existe**: en `merchants` la cita mandaba a
  `application/…/AlliedManagementService.php`, que no existe en ese repo — quien fuera a arreglar ese
  bug no habría encontrado nada y habría concluido que ya estaba arreglado.
- 🔴 **`context-refs` no ve las citas cortas `:NNN`, y son justo donde se esconde la deriva.**
  `ms-preapprovals` tenía 15 de 40 así: la herramienta informaba **«0 movidas»** sobre un nodo que había
  derivado entero —describía un caché con `ShouldCheckAgain` que ya no existe como función—. Un nodo
  «sano» según la herramienta puede estar completamente viejo.
- ⚠ **Un nodo sin ninguna cita con línea nunca aparece en el ranking de deriva.** `motai` informa 0 de
  0. No significa que esté al día; significa que no hay por dónde agarrarlo. (Estaba al día, pero eso
  hubo que comprobarlo a mano.)
- ⚠ **Una ausencia en el árbol de archivos no es una ausencia en el sistema.** `entities` concluía que
  no había UI de entidades en el frontend porque `apps/admin` estaba vacía; estaba vacía porque se
  **renombró** a `apps/backoffice` dos meses antes, con 150 archivos y cuatro rutas de entidades.
  Antes de concluir desde una carpeta vacía, `git log` de la ruta.
- ⚠ **Medir contra el dump local documenta problemas que producción no tiene** (`corbeta`) **y
  subestima los que sí** (`servicing`: 56 pagos retenidos en el dump contra **732** en prod).

## Registro

### 2026-09-19

**Los 39 nodos re-verificados, 38 sellados.** Barrido completo contra `origin/main`, con
las mediciones de DATO re-hechas contra prod por `make trazador-sql`. Lo más caro que encontró, por
nodo:

- `ms-preapprovals` — **describía un mecanismo borrado**: `ShouldCheckAgain` no existe y
  `RejectedRetryHours` no aparece en el repo. Hoy todo `check` sale al proveedor. Quedaron tres rastros
  muertos que se leen como vivos (un finder en el puerto sin llamadores, un `IsActive()` sin llamadores
  y un `//nolint` que nombra la función borrada). Y creció: 8 → 11 keys, 3 → 5 estados.
- `negocio` — el reporte mensual de desembolsos, **lo único automático del cierre con la entidad**, se
  apagó el 2026-09-11 (`96211634`). Hoy no queda ninguna entrada mensual viva en el scheduler.
- `entities` — el panel que «no existía» se había mudado; y `getPaginated()` no es código muerto, es el
  listado vivo de la API Partner.
- `architecture` — las migraciones exclusivas pasaron de 47+67 a **51+171**: el lado de legacy-backend
  se multiplicó por 2,5 justo cuando se dejó de copiarlas.
- `profiling` — el mínimo de capacidad de endeudamiento es un **porcentaje del salario**, no un monto; y
  el fail-closed por buró ya no es «siempre» (Ábaco y país sin centrales activas lo saltan).
- `kyc` — `verifyCoincidence` no está en tres archivos sino en **siete**, con cuatro copias en el
  monolito que hoy sirve el tráfico.
- `onboarding` — los dos bugs del camino feliz siguen vivos carácter por carácter; el módulo G2 pasó de
  198 a 268 archivos y sus tests de 14 a 47.
- `servicing` — cero deriva. Y un contraste que vale: sus tres crons siguen agendados en
  `legacy-backend` mientras el commit del 11/9 apagaba los de `application`. Los dos schedulers se
  mueven por separado, así que «los crons están apagados» nunca es una afirmación del sistema.
- `motai` — el más limpio: toda la v2 existe tal cual en prod y lo que declara muerto está muerto
  (`allied_modes` y `user_request_modes` no existen como tablas).
- `findings` — integridad **perfecta** (las 239 `F-xx` citadas están las 239 definidas) y **cero deriva
  de citas**, el mejor resultado del árbol para su tamaño. Sin sellar, a propósito.

⚠ Un commit de otra sesión sobre el mismo worktree (`3ba814a`) se llevó parte de estos cambios mientras
estaban stageados. No se perdió nada; el resto quedó en `c9312f3`. La lección —stagear y commitear en
el mismo comando— quedó en memoria.
