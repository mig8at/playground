# CREDITOP · playground

Espacio propio de Miguel: organiza el conocimiento de **CreditOp** (fintech colombiana de originación
de crédito) y agrupa las herramientas de prueba. Existe para que un modelo entienda **antes** de atacar
una tarea.

## `make` es la puerta única

`make` sin argumentos lista todo lo que se puede correr, agrupado por para qué sirve. No hace falta
recordar en qué carpeta vive cada script.

| | |
|---|---|
| `make status` | **¿está el contexto al día?** Resumen de deriva + citas. No escribe nada |
| `make context` · `make tablero` · `make panel` | abre cada pieza (:5193 · :5191 · :5195) |
| `make context-align` | qué nodos quedaron viejos — **después de cada merge** |
| `make context-refs [NODE=x]` | ¿las citas `archivo:línea` apuntan a lo que dicen? |
| `make context-seal NODE=x` | "este nodo lo verifiqué hoy" — **solo si de verdad lo revisaste** |
| `make e2e-contract` · `make e2e-walk` · `make e2e-qr` | probar el canal QR / Bancolombia |

Convención: los **nombres propios** se quedan (`context`, `tablero`, `panel` son carpetas) y los
**verbos** van en inglés (`align`, `refs`, `seal`, `check`), como `proyecto-verbo`.

## EL CICLO — acá siempre pasa lo mismo

Se viene a resolver **tareas** sobre CreditOp con tres piezas — **tablero** (la tarea), **context**
(el conocimiento) y **frontend-e2e** (la prueba) — y el circuito es fijo:

1. **La TAREA vive en `tablero/data/<tarea>.md`** (una tarea = un archivo): en qué se trabaja, por
   qué y para qué — estado, decisiones, riesgos, preguntas abiertas.
2. **El CONTEXTO se lee ANTES de investigar.** `context/docs/ROUTE-MAP.md` es el índice (31 nodos
   validados contra `main`); abrí los que matcheen: `context/server/data/flows/<id>/doc.md` (el
   análisis) + `map.json` (las rutas fuente exactas). El código real vive **fuera**, en
   `~/Desktop/CREDITOP/github/` (`legacy-backend`, `frontend-monorepo`, `legacy-application`,
   `pre-approvals-service`) — grandes: entrar por grep sin mapa es la forma lenta.
3. **Lo que se descubre SE REGISTRA, con dos destinos.** El test: *si esto se mergea mañana, ¿el
   texto sigue siendo cierto?*
   - hallazgos **de la tarea** (avance, decisiones, riesgos, preguntas) → su `.md` del tablero;
   - trampas **del sistema**, verificadas (síntoma → causa raíz → evidencia → arreglo) →
     `context/server/data/flows/findings/doc.md` (F-01…). **Mirala antes de depurar un muro**: si
     ya nos pasó, está ahí.
4. **Probar de verdad es `frontend-e2e/`** (panel, runners, mocks): se comprueba **corriendo**, no
   leyendo. Una afirmación que se puede verificar ahí se verifica **antes** de escribirla como cierta.
5. **Al mergear, GRADÚA:** lo mergeado deja de ser tarea y pasa al nodo de contexto — ahí es "cómo
   funciona CreditOp". La tarea se marca `archived` en su frontmatter. Ejemplo hecho: la omisión de
   Experian por cupo ya confirmado vive hoy en el nodo `kyc`.

⚠ **El resto de carpetas NO son herramientas para contextualizarte** — hoy: `flow`, `engine`,
`domain-model`, `diccionario`, `creditop-woocommerce`. Son exploraciones que Miguel armó para entender
él mismo el negocio: **no están validadas contra el código** y varias describen un *deber ser*, no lo
que corre en producción. **No las cites como fuente ni las uses para decidir.** Si algo de ahí resulta
cierto, se verifica contra el código y gradúa a `context/` — hasta entonces, no existe para tu tarea.

**Reglas de la partición** (para que no se vuelva a mezclar): el árbol de context **no** lleva
nodos-tarea. El enlace es **unidireccional** — la tarea apunta a nodos (`context_nodes`); el nodo
nunca apunta a tareas, porque quedaría mintiendo al graduar. Y del `.md` de una tarea **solo**
`jira_title` + la sección `## Tarea (publicable)` salen a Jira (pasan el guard); todo lo demás es
privado y puede nombrar repos, rutas y F-xx. El error de enrutar mal se comete por **fricción**, no
por no entender la regla — hoy los dos destinos cuestan lo mismo: un archivo markdown.

## El contexto se mide contra `main`, y lo que no está en main se marca

`context/` describe **lo que corre**, y la vara es `main` (o la rama que sirva ese target — ver abajo).
Un contexto que describe una rama sin mergear es una trampa: se lee como verdad y no lo es.

Cuando haya que documentar algo que **todavía no está en `main`**, se marca en el propio `doc.md`, en el
lugar donde aparece:

```markdown
> ⏳ **PENDIENTE DE MERGE** — esto vive en `feature/motai-v2`, no en `main`.
> Al mergear: re-verificar con el oráculo, actualizar y **borrar esta marca**.
```

Dos razones por las que la marca va inline y no en una lista aparte: se ve justo donde engaña, y todas se
encuentran de una con `grep -rn "PENDIENTE DE MERGE" context/`. Revisá esa lista después de cada merge:
lo que entró **actualiza el contexto**, y así el árbol siempre describe lo que de verdad está corriendo.

## Git

- **Este repo** (`playground`) se commitea local. El push lo decide Miguel — no pushees por tu cuenta.
- **Los repos reales** (`legacy-backend`, `frontend-monorepo`, `legacy-application`) trabajan en ramas y
  stashes locales. **No armes PRs ni pushees ahí sin pedir permiso explícito.**

## Entorno local

- Hay una **copia local de la BD** en Docker: contenedor `legacy-backend-mysql-1`, schema `creditop`.
  Usala para verificar contra datos reales en vez de suponer.
- **`E2E_TARGET` por defecto es `dev`**, no `local` (`frontend-e2e/pkg/db.ts:12`). Cualquier consulta o
  script que lo omita pega contra el **dev compartido**. Para local, exportalo:
  `E2E_TARGET=local`. (`dev/sweep.ts:34` ya lo fuerza; el panel setea
  `I_KNOW_THIS_TOUCHES_SHARED_DEV` cuando el target es `dev`.)
- El harness del wizard se maneja desde el **panel**: `cd frontend-e2e && npm run dev`. Los `bin/` son
  plumbing, no una segunda entrada.

## Trampas que ya costaron tiempo

- En `user_requests`, el estado de la solicitud es **`user_request_status_id`**, no `status`. Mirar la
  columna equivocada hace creer que una solicitud cancelada está sana (F-50).
- `playground/docs/` **fue borrada** de `main` (absorbida por `context/`). Toda ruta `docs/X.md` que veas
  citada es histórica: `git show 159906a:docs/<archivo>`.

## Dos reglas de honestidad

- Si tocaste rutas de un nodo, validá con `python3 context/tools/oracle.py <map.json>` — una ruta mal
  escrita no falla en ningún lado: la lee un modelo y abre un archivo inexistente.
- **Nunca afirmes como verificado algo que no comprobaste contra el código.** Si no lo miraste, decilo.

## Variables de entorno

Cada herramienta guarda su configuración por target en su propio **`.env.<target>`** (`local` · `dev` ·
`staging`), **autosuficiente**: ahí viven tanto los **hechos** del entorno (BD, API base, `APP_KEY`)
como las **perillas** (Cognito, mocks, `SEED`). Ya **no** hay capa compartida `env/<target>.env` — se
eliminó el 2026-07-22 (solo la usaba `frontend-e2e`; `backend-e2e`/`backend-mcp`, que la compartían, se
borraron). Prioridad: `process.env` > `<herramienta>/.env.<target>`.

**Qué rama sirve cada target** (`local` → local · `dev` → **develop** · `staging` → **qa**). `staging`
comparte la **BD** con `dev` (mismas credenciales; si rotan, actualizá las dos) pero **NO el API**: en el
cluster `inertia-develop` conviven dos servicios —`legacy-backend` (rama `develop`) y
**`legacy-backend-qa`** (rama `qa`)—, así que el nombre del cluster engaña. Apuntar `staging` al backend
de dev mezcla ambientes y te hace validar código que no es el del front desplegado; costó varias corridas
creyendo que un feature estaba roto cuando la rama con el cambio no era la que respondía.

**Los permisos no van en archivo.** El flag `I_KNOW_THIS_TOUCHES_SHARED_DEV` **no** vive en ningún
`.env.*`: se exporta a mano en la shell cuando de verdad vas a escribir a la BD compartida de dev (el
panel lo inyecta solo para sus corridas). Meterlo en un archivo desarma la guarda (F-53).

`.env.*` está gitignoreado (trae secretos); las plantillas versionadas y documentadas son
`<herramienta>/.env.<target>.example`.
