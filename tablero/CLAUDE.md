# tablero — protocolo (las TAREAS a realizar)

Qué es y cómo se corre: `README.md`. Acá solo las reglas al trabajar con las tareas.

- **Una tarea = un archivo suelto**: `data/<tarea>.md`. `ls data/` responde *¿en qué se está
  trabajando?* — no crees carpetas por tarea ni por categoría (los 11 esfuerzos reales no
  clasificaban por ningún eje; la clasificación es `context_nodes`, que es una lista). El nombre
  del archivo es el slug y se puede renombrar a mano: el `id` vive en el frontmatter.
- **Frontmatter**: `id` · `title` · `stage` (`evaluation`|`work`|`tasks`) · `created` ·
  `archived?` · `context_nodes[]` · `jira[]` · `jira_title`. Archivar = poner `archived`, no mover
  el archivo.
- **La frontera del guard está DENTRO del archivo.** El cuerpo es privado y puede nombrar repos,
  rutas y F-xx. **Lo único que se publica** es `jira_title` + la sección `## Tarea (publicable)`,
  y pasa el guard del server (rechaza repos, rutas de archivo y F-xx). No muevas esa marca ni
  metas detalle técnico debajo de ella.
- **El test de enrutamiento**: *si esto se mergea mañana, ¿sigue siendo cierto?* Sí → es contexto,
  va a `context/`. Habla de decisiones, riesgos o preguntas de ESTA tarea → va acá. Al mergear,
  lo aprendido **gradúa** al nodo y la tarea se archiva.
- **Jira y Slack van por el server** (`npm run dev` → :8787, botones con vista previa) o por los
  conectores MCP (`cmd/jira-mcp`, stdio) — el browser no puede hablar con ninguno de los dos.
  Tareas nuevas van al **sprint activo del board 384**, no al backlog. Nada se publica sin que
  Miguel lo vea antes.
- `data/entries/*.jsonl` (bitácora de tiempo), `data/pulse/*.jsonl` (el pulso) y `data/cache/` están
  **fuera de git** a propósito (dato personal / snapshot descartable); los `.md` de tareas,
  `data/artifacts/*.html` y `settings.json` **sí** se versionan. No lo cambies.
- **PROTOTIPOS: `data/artifacts/<slug>.html`**, con el mismo slug que el `.md` de la tarea — y
  `<slug>.<variante>.html` cuando hay **varias propuestas** para la misma tarea (la variante es la
  etiqueta). La tarjeta de la tarea muestra entonces el botón **Prototipos**, al lado de Bitácora, que
  abre un cajón con la lista; cada uno se sirve en `GET /artifacts/<archivo>`. El vínculo es el
  **nombre**, no una entrada en el frontmatter: una convención de nombre no se desincroniza, una lista
  escrita a mano sí. Tres reglas:
  1. **Un HTML autocontenido, sin build.** Si necesita `npm install`, no es un artefacto: es una
     carpeta del playground con su entrada en el `Makefile`.
  2. **Lleva la fecha visible adentro.** Un prototipo sin fecha se lee como estado actual; con fecha
     se lee como lo que es — lo que se acordó ese día.
  3. **No gradúa a `context/`.** Describe lo propuesto, no cómo funciona CreditOp: muere con la
     tarea. Si algo de ahí resultó verdad perenne, se escribe en el nodo con palabras.
- **El pulso NO se escribe a mano ni desde el tablero.** Lo anota `server/cmd/pulso` (un LaunchAgent,
  cada 5 min) leyendo git: es la fuente objetiva de *cuándo toqué código*, y editarla la volvería otra
  bitácora. Se lee con `make pulso` o `GET /api/pulse`. El porqué del diseño: `README.md` → «El pulso».
  Si vas a razonar sobre cuánto se trabajó, mirá el pulso; la bitácora dice **en qué**, no **cuándo**.
