# goldfish — validar una rama antes de abrir su PR (Elephant-Goldfish)

Aplica el modelo [Elephant-Goldfish](https://github.com/google/elephant-goldfish-model) a las ramas de los repos
reales (`~/Desktop/CREDITOP/github/`). **Quien propone no valida su propio trabajo.** Nació el 2026-11-13.

| qué | cómo |
|---|---|
| la app (Cockpit: **Goldfish**) | `make goldfish` → :5216 · API :5217 |
| las ramas por subir | `make goldfish-list` |
| validar una rama | `make goldfish-run REPO=<carpeta> RAMA=<rama>`, o «Validar» en la app |

## El método, adaptado a un PR

El repo de Google revisa DOCUMENTOS de diseño antes de construir. Acá se revisa una rama lista para PR:

1. **La propuesta** (Go, sin agente): una carpeta con el diff contra `origin/main` (`git diff base...rama`; se corta en
   400 KB), los commits, los archivos tocados tal como quedan en la rama y, si la rama es de una tarea (`ramas:` de su
   `task.md`), lo que la tarea pide: sólo `Objetivo`, `Specs`, `Criterios`, `Tarea (publicable)` y `En una línea`.
2. **Elephant**: la descripción del PR. Si la rama ya tiene un PR abierto, la de GitHub; si no, la redacta un agente
   desde la raíz del playground (con su CLAUDE.md, la tarea y `knowledge/`), con las reglas de los PRs: sin nombrar
   herramientas internas.
3. **Dos goldfish, en paralelo y en frío**: `claude -p --restricted --strict-mcp-config` desde la carpeta de la
   propuesta, con sólo `Read`, `Grep` y `Glob`. No hay CLAUDE.md en ningún padre de esa carpeta ni configuración que
   cargar: saben únicamente lo que la propuesta dice. Uno mira **si la propuesta y el cambio dicen lo mismo**
   (`prompts/goldfish-intent.md`), el otro **qué puede salir mal** (`prompts/goldfish-risk.md`).
4. **Elephant otra vez**: el veredicto de cada hallazgo contra el código real (confirmado · plausible · descartado,
   con archivo:línea; puede pedirle a `main-verifier`), y lo que sólo se ve con el playground: las trampas, el
   conocimiento de la tarea, un PR por tarea y por repo, la descripción sin herramientas internas, nada de la suite
   entera de PHPUnit (`prompts/elephant-verdict.md`).
5. **Informe**: `goldfish/.runs/<id>/report.md` (fuera de git, con `package/`, que es EXACTAMENTE lo que vieron los
   goldfish). Si la rama es de una tarea, una copia en sus `artifacts/goldfish-<id>.md` y un bloque corto en su pila.

**Miguel resuelve**: decide qué corregir. Goldfish no abre PRs, no pushea y no edita los repos: los agentes del
elephant tienen negados `Edit`, `Write` y los `git` que escriben.

## Lo que hay que saber antes de tocarlo

- **Qué ramas lista**: las locales con commits que `origin/main` (la rama por defecto) no tiene, tocadas en los últimos
  45 días, sin las largas (`main`, `develop`, `qa`, `staging`). Su PR sale de `gh pr list --author @me`, una vez por
  repo. Primero las que no tienen PR, después las de PR abierto y, plegadas, las ya mergeadas o cerradas (una rama
  mergeada por squash sigue «por delante»).
- **Dos clones del mismo repo** (`legacy-backend` y `legacy-backend-finandina`, los del playground compartido) traen la
  misma rama: queda una, la del clon que se llama como el repo. ⚠ Los remotos usan alias de `~/.ssh/config`
  (`git@github.com-mig:…`): `reRemote` los acepta; sin eso no había PRs ni deduplicación.
- **Las respuestas de los agentes van con `--json-schema`** (`review/schemas.go`): se leen sin adivinar.
- **Cuesta**: cuatro corridas de `claude -p` por validación, del límite del plan de equipo. Cada paso muestra su costo
  equivalente en dólares de la API. Medido el 2026-11-13 (una rama de 3 archivos): la descripción ~US$1,3, cada
  goldfish ~US$0,25, y el veredicto es el más caro.
- **Una validación «corriendo» guarda su proceso** (`pid`): al arrancar, el servidor marca cortadas sólo las de un
  proceso muerto. Antes marcaba también las que corrían en la consola.
- Identificadores en inglés; prompts y comentarios en español.
