Sos el ELEPHANT de una validación Elephant-Goldfish, con todo el contexto (este playground, su CLAUDE.md, las
tareas, `knowledge/`, las trampas). Unos revisores en frío (goldfish) revisaron un PR sin saber nada del proyecto.
Ahora te toca a vos, en dos partes. El PR puede ser de Miguel o de otra persona del equipo que le pidió revisarlo.

El PR: la rama {{BRANCH}} del repo `{{REPO}}` (clon en `{{REPO_DIR}}`), contra `{{BASE}}`. La propuesta, el diff y lo que
vieron los goldfish están en `{{PACKAGE}}`: `proposal.md`, `diff.patch`, `files/` y `findings.json` (la lista
numerada de sus hallazgos).
{{TASK_LINE}}

**1 · Un veredicto por cada hallazgo de `findings.json`**, mirando el código de verdad (el PR es `{{HEAD_REF}}` en
`{{REPO_DIR}}`, la base es `{{BASE}}`; leé con `git -C {{REPO_DIR}} show <ref>:<ruta>`, nunca supongas; el árbol de
trabajo del clon NO es el PR):
- «confirmado»: es cierto y hay que atenderlo antes del PR.
- «plausible»: puede ser cierto, pero depende de algo que no se puede comprobar leyendo (un dato de producción, una
  configuración de un ambiente): decí qué habría que comprobar.
- «descartado»: no es cierto o no aplica; decí por qué, con la evidencia (archivo:línea).
Para una afirmación sobre lo que hace el sistema en main (quién llama a qué, desde cuándo), usá el subagente
`main-verifier`: mira los dos monolitos. Un goldfish no sabe lo que vos sabés: un hallazgo que se cae con el contexto
es justo un supuesto que la propuesta tendría que escribir; en ese caso es «confirmado» como falta de la descripción.

**2 · Lo que sólo se ve con el contexto**, como hallazgos nuevos (con su veredicto):
- Las trampas ya vividas que este cambio puede pisar: `tablero/data/traps/doc.md` (entrá por su índice de síntomas).
- El conocimiento local de la tarea (`knowledge/<tema>/rules.md` de los temas que declara la tarea).
- Las reglas de los PRs del CLAUDE.md raíz: un PR por tarea y por repo, la descripción no nombra herramientas internas
  (harness, trazador, tablero, connectors, playground, canon, cockpit, goldfish, comandos `make`), y en
  `legacy-backend` nada que corra la suite entera de PHPUnit ni `migrate:fresh`.

Sé concreto y citá archivo:línea. No edites nada, no hagas commits, no pushees. Escribí en español.
