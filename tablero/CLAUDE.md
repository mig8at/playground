# tablero — protocolo (las TAREAS a realizar)

Qué es y cómo se corre: `README.md`. Acá solo las reglas al trabajar con las tareas.

- **Una tarea = un archivo suelto**: `data/<tarea>.md`. `ls data/` responde *¿en qué se está
  trabajando?* — no crees carpetas por tarea ni por categoría (los 11 esfuerzos reales no
  clasificaban por ningún eje; la clasificación es `context_nodes`, que es una lista). El nombre
  del archivo es el slug y se puede renombrar a mano: el `id` vive en el frontmatter.
- **Frontmatter**: `id` · `title` · `stage` (`evaluation`|`work`|`tasks`) · `created` ·
  `archived?` · `context_nodes[]` · `jira[]` · `jira_title` · `ramas?`. Archivar = poner `archived`, no
  mover el archivo.
- **La frontera del guard está DENTRO del archivo.** El cuerpo es privado y puede nombrar repos,
  rutas y F-xx. **Lo único que se publica** es `jira_title` + la sección `## Tarea (publicable)`,
  y pasa el guard del server (rechaza repos, rutas de archivo y F-xx). No muevas esa marca ni
  metas detalle técnico debajo de ella.
- **El test de enrutamiento**: *si esto se mergea mañana, ¿sigue siendo cierto?* Sí → es contexto,
  va a `context/`. Habla de decisiones, riesgos o preguntas de ESTA tarea → va acá. Al mergear,
  lo aprendido **gradúa** al nodo y la tarea se archiva.
- **El tablero se lee por CONSOLA, sin levantar nada** — su propio dominio, no el de terceros:

      make tareas                       las abiertas, con etapa, Jira y nodos
      make tareas N=kyc-segundo         una: separa lo PÚBLICO de lo PRIVADO y chequea el guard
      make tareas STAGE=work TODAS=1 JSON=1
      make tareas-guard F=<archivo>     ¿este texto puede salir a Jira? SALE 1 si no
      make sprint                       el sprint activo con puntos, del SNAPSHOT
      make bitacora DAYS=7              el tiempo registrado, por día
      make tareas-ramas                 en qué ramas vive cada tarea y hasta dónde llegó (mide git)
      make tareas-ramas N=43 JSON=1     una sola, en json

  El `-guard` reusa `internal/guard`, que es la fuente única (la UI compila esos mismos patrones y
  `issue-create` los aplica al publicar). Correlo ANTES de escribir lo publicable, no después: el
  cuerpo de una tarea NUNCA pasa —nombra el playground, repos y rutas—, y esa es justamente la
  frontera. Que salga con código 1 es a propósito: sirve para frenar, no sólo para informar.

- **Jira y Slack tienen TRES caminos**, no dos: el server (`npm run dev` → :8787, botones con vista
  previa), los conectores MCP (`cmd/jira-mcp`, stdio — sólo si están registrados) y **la CONSOLA**,
  que es la que sirve cuando no hay UI a mano y **no depende del server corriendo**:

      make jira-create JSON=t.json     # crea y mete al sprint activo; el único que puede ESTIMAR
      make jira-move KEY=CORE-309 A=prueba
      make jira-edit JSON=t.json

  ⚠ El `status` de `jira-create` es una lista **ORDENADA** de subcadenas, no un destino suelto: el
  workflow de CORE no deja saltar estados — para «pruebas» hay que pasar por «progreso» primero.
  Y por consola es el único camino que **estima**: el del server crea y mete al sprint pero no tiene
  campo de puntos.

  Los tres necesitan `ATLASSIAN_*` en `tablero/.env`. Tareas nuevas van al **sprint activo del board
  384**, no al backlog. **Nada se publica sin que Miguel lo vea antes** — los tres escriben hacia
  afuera y lo ve el equipo.
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
- **RAMAS: se declara UN patrón, el resto lo mide git.** `ramas: pais-como-dato` en el frontmatter, y
  `make tareas-ramas` responde en qué ramas de qué repos vive la tarea y **en qué ambientes ya está el
  cambio**. Igual que los prototipos (el vínculo es el nombre) y las anotaciones (salen del cuerpo): una
  lista de ramas escrita a mano **miente en silencio** en cuanto algo se mergea o se renombra — pasó tres
  veces en un día con países (`-onto-develop`, `-onto-staging`, y un PR viejo a `main` que ya no era el
  camino). Cuatro reglas:
  1. **Se mide por PATCH-ID** (`git cherry`), no por nombre de rama: así se detecta un cambio que llegó
     por **squash**, donde el hash cambia y la rama ya no existe. Es cómo se supo que el backend de
     países estaba en `develop` y `staging` pero no en `main`.
  2. **La señal es «¿está la PUNTA en el ambiente?»**, no «¿le queda algo propio?». Lo segundo engaña:
     una rama cortada de `main` arrastra ~190 commits ajenos contra `develop` y decir «falta en
     develop(190)» sugiere 190 pendientes cuando el pendiente es uno.
  3. **No habla con la red**: lee lo que el último `git fetch` dejó. Si un dato se ve viejo, fetcheá — un
     comando de lectura que sale a internet sorprende, y en 13 repos nadie lo correría.
  4. **Es un SNAPSHOT con fecha** (`data/cache/ramas.json`, fuera de git), como el del sprint: un estado
     de git sin fecha se lee como actual y no lo es. La clave es el **id** de la tarea, no el slug,
     porque el nombre del archivo se puede renombrar a mano.

- **El pulso NO se escribe a mano ni desde el tablero.** Lo anota `server/cmd/pulso` (un LaunchAgent,
  cada 5 min) leyendo git: es la fuente objetiva de *cuándo toqué código*, y editarla la volvería otra
  bitácora. Se lee con `make pulso` o `GET /api/pulse`. El porqué del diseño: `README.md` → «El pulso».
  Si vas a razonar sobre cuánto se trabajó, mirá el pulso; la bitácora dice **en qué**, no **cuándo**.
