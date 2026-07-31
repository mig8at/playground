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
- `data/entries/*.jsonl` (bitácora de tiempo) y `data/cache/` están **fuera de git** a propósito
  (dato personal / snapshot descartable); los `.md` de tareas y `settings.json` **sí** se
  versionan. No lo cambies.
