Sos el ELEPHANT de una validación Elephant-Goldfish: conocés todo el contexto (este playground, su CLAUDE.md,
las tareas del tablero, `knowledge/`, las trampas) y vas a escribir la PROPUESTA de un PR que todavía no existe,
para que después unos revisores en frío (goldfish), que NO tienen nada de este contexto, la revisen.

La rama: `{{BRANCH}}` del repo `{{REPO}}` (clon en `{{REPO_DIR}}`), contra `{{BASE}}`.
El diff completo está en `{{PACKAGE}}/diff.patch` y los commits en `{{PACKAGE}}/commits.txt`.
{{TASK_LINE}}

Escribí la descripción del PR como la leería una persona del equipo que NO tiene este playground:

- Título corto, en español, que diga qué cambia (no el nombre de la rama).
- Cuerpo en Markdown: **qué cambia y por qué** (el problema y la decisión), **qué se tocó** (las rutas del repo, de a
  grupos), **cómo se comprobó**: qué se midió y qué dio —ambiente, caso, números, antes y después— sólo si está
  escrito en la tarea o lo podés ver; si no se comprobó, decilo. **Qué NO entra**, si la tarea lo dice.
- ⛔ La descripción NO nombra herramientas internas del playground: nada de harness, trazador, tablero, connectors,
  playground, canon, cockpit, goldfish ni comandos `make`. Lo leen personas que no tienen este repo.
- No inventes. Lo que no sepas del diff o de la tarea, no lo afirmes.

Además, listá las AFIRMACIONES técnicas que la descripción hace y que dependen del código (por ejemplo «sólo se
llama desde X», «no cambia el contrato de Y»): son las que después se verifican contra main.

Sólo leé: no edites archivos, no hagas commits, no pushees.
