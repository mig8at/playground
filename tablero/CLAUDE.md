# tablero — protocolo (las TAREAS a realizar)

Qué es y cómo se corre: `README.md`. Acá solo las reglas al trabajar con las tareas.

- **Una tarea = un archivo suelto**: `data/<tarea>.md`. `ls data/` responde *¿en qué se está
  trabajando?* — no crees carpetas por tarea ni por categoría (los 11 esfuerzos reales no
  clasificaban por ningún eje; la clasificación es `context_nodes`, que es una lista). El nombre
  del archivo es el slug y se puede renombrar a mano: el `id` vive en el frontmatter.
- **Frontmatter**: `id` · `title` · `stage` (`evaluation`|`work`|`tasks`) · `created` ·
  `archived?` · `context_nodes[]` · `jira[]` · `jira_title` · `ramas?` (uno o varios patrones, por
  coma). Archivar = poner `archived`, no
  mover el archivo.
- **La frontera del guard está DENTRO del archivo.** El cuerpo es privado y puede nombrar repos,
  rutas y F-xx. **Lo único que se publica** es `jira_title` + la sección `## Tarea (publicable)`,
  y pasa el guard del server (rechaza repos, rutas de archivo y F-xx). No muevas esa marca ni
  metas detalle técnico debajo de ella.

  ⚠ Y el guard **no** es la regla de qué escribir, sólo de qué no filtrar: son 4 regex (`F-\d+`,
  `playground`, unos nombres de repo, rutas con extensión). Un texto lleno de nombres de tabla, SQL y
  clases de Laravel **pasa el guard entero**. El registro de cada pieza lo define la lista de abajo, no
  el guard.

- **CINCO piezas, cinco preguntas distintas.** El título es lo único compartido; el resto no se repite
  entre piezas. La prueba para saber dónde va algo es **quién lo lee y qué necesita**:

  | pieza | contesta | la lee |
  |---|---|---|
  | `title` / `jira_title` | ¿cómo se llama esto? | todos — es el nombre compartido |
  | **el cuerpo** (privado) | **¿cómo se está atacando?** los caminos evaluados, por qué se descartó cada uno, contra qué se comprobó | vos, y un modelo que retoma la tarea |
  | **anotaciones** (`> **MEDICIÓN · fecha**`) | los HECHOS con fecha que la prosa no conserva | quien vuelve tres semanas después |
  | **bitácora** (`data/entries/`) | ¿en qué se fue el tiempo y qué pasó ese día? | vos, y el worklog de Jira |
  | **`## Tarea (publicable)`** | qué problema resuelve (**producto**) + **cómo se prueba** (**QA**) | el equipo, vía Jira |

  1. **La publicable NO es un resumen del cuerpo.** Es otro público y otra pregunta. El cuerpo explica
     *cómo se está resolviendo*; la publicable, *qué se logra y cómo se verifica*. Si al escribirla te
     sale «migración idempotente que resuelve los campos por nombre», eso es cuerpo — a producto le
     importa que el campo aparezca en cascada, no que el script se pueda correr dos veces.
  2. **La publicable tiene DOS mitades, y la plantilla ya existe** — no la inventes. Es la que usan
     Ábaco, la card de renting y el codeudor, y sale de medir, no de opinar:

         ## En una línea      ── producto: qué se logra, en una oración
         ## Por qué           ── producto: el motivo de negocio
         ## Qué cambia        ── producto: el cambio que se ve
         ## Alcance           ── producto: los límites (qué NO entra)
         ## Dónde probar      ── QA: ambiente, comercio, entidad, usuario
         ## Cómo validar      ── QA: los pasos, con los datos concretos
         ## Criterios de aceptación   ── QA: cómo se sabe que pasó
         ## Dependencias / contraparte ── QA: qué falta de afuera, y de quién

     Basta con que esté la mitad de QA para que `make tareas N=<x>` no se queje: en una tarea chica,
     «Cómo validar» sola ya deja a QA sin preguntas. Medido el 2026-08-19 sobre las 16 tareas de los
     últimos 4 sprints: **4 de 9 publicables tienen esa mitad y 5 son prosa suelta**, y 3 tareas no
     tienen sección publicable —así que de esas no sale nada a Jira—. La plantilla no es una propuesta:
     es lo que hacen las que quedaron bien.
  3. **Lo que se evaluó y se descartó va en el cuerpo, y va aunque no se haya elegido.** Es lo que
     evita re-discutir el mismo camino en tres semanas, y es lo que un modelo necesita para no proponer
     de nuevo lo que ya se probó y falló. Hoy lo registran 6 de 12 tareas: cuando está, se nota.
  4. **Una decisión, una medición, una pregunta abierta o un riesgo NO son prosa: son anotaciones.**
     El marcador con fecha (y con el `Como` que la vuelve a comprobar) existe porque la prosa se lee
     bien el día que se escribe y miente tres semanas después. Está construido y **se usa en 1 de 12
     archivos** — es la pieza más desaprovechada del tablero. Si escribiste «medimos que…» en prosa,
     eso quería ser una anotación.
  5. **La bitácora no repite el cuerpo**: dice *en qué se fue el tiempo*. El cuerpo dice **en qué** se
     trabaja, la bitácora **cuándo y cuánto**, y el pulso —que nadie escribe a mano— **cuándo se tocó
     código de verdad**. Tres cosas distintas: si la nota de la bitácora explica una decisión, esa
     decisión va al cuerpo (o es una anotación) y la nota se queda con el hecho del día.
  6. ⚠ **Al medir esto, cuidado con dónde termina la publicable: va del marcador hasta el FINAL del
     archivo.** Sus subtítulos son `##`, del mismo nivel que el marcador, así que un lookahead al
     próximo `##` la corta en la primera línea y da cero. Es exactamente el error que se cometió el
     2026-08-19 midiéndola: dio «7 de 12 sin publicable» cuando eran 3. El server lo hace bien
     (`cuerpo[loc[1]:]`); si escribís una medición aparte, copiá ese criterio.
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
  workflow de CORE no deja saltar estados. *(Acá decía «para pruebas hay que pasar por progreso
  primero». Está mal, medido el 2026-08-19 contra `GET /issue/{key}/transitions`: **a «En pruebas» no
  se llega desde ningún estado salvo «Terminada»**, y esa transición se llama «Se devuelve a pruebas»
  — es un retorno. El camino real es Por Hacer → En progreso → En revisión → Terminada.)*
  Y por consola es el único camino que **estima**: el del server crea y mete al sprint pero no tiene
  campo de puntos.
- **Los estados NO se escriben en el código: se le preguntan a Jira.** La tarjeta tiene un botón
  **⇢ Mover** que lista lo que `GET /api/transitions` devuelve para ESE issue en ESE estado, así que
  nunca puede ofrecer un movimiento que Jira va a rechazar. Es la lección de haberlo hecho al revés: el
  botón anterior estaba cableado a «A pruebas» y **fallaba en 5 de los 6 estados**, porque esa
  transición sólo existe desde «Terminada». Dos detalles del diseño:
  1. El destino que cae en el estado de pruebas **no se mueve directo**: entra al flujo de QA, donde
     mover la tarjeta y avisarle a quien valida son un mismo acto y el mensaje se previsualiza (pasa el
     mismo guard que la bitácora). Se marca «+ aviso» en el menú para que no sorprenda.
  2. El POST **re-lee las transiciones antes de aplicar**: si alguien movió la tarjeta desde Jira con el
     menú abierto, el id queda viejo y Jira devuelve un 400 ilegible. Así se contesta 409 con el porqué.

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
- **RAMAS: se declaran los PATRONES, el resto lo mide git.** `ramas: pais-como-dato` en el frontmatter
  —o varios separados por coma— y `make tareas-ramas` responde en qué ramas de qué repos vive la tarea,
  **en qué ambientes ya está el cambio** y **en qué estado está su PR**. Igual que los prototipos (el
  vínculo es el nombre) y las anotaciones (salen del cuerpo): una lista de ramas escrita a mano **miente
  en silencio** en cuanto algo se mergea o se renombra. Medido el 2026-08-19 grepeando las 16 tareas de
  los últimos 4 sprints: de los nombres de rama que aparecen escritos en los cuerpos, **dos no resuelven
  hoy** — uno porque la rama se renombró (`codebtor-` → `cosigner-`, el cuerpo lo aclara al lado, pero un
  grep encuentra el viejo) y otro porque la remota se borró al mergear el PR. Seis reglas:
  1. **Se mide por PATCH-ID** (`git cherry`), no por nombre de rama: así se detecta un cambio que llegó
     por **squash**, donde el hash cambia y la rama ya no existe. Es cómo se supo que el backend de
     países estaba en `develop` y `staging` pero no en `main`.
  2. **La señal es «¿está la PUNTA en el ambiente?»**, no «¿le queda algo propio?». Lo segundo engaña:
     una rama cortada de `main` arrastra ~190 commits ajenos contra `develop` y decir «falta en
     develop(190)» sugiere 190 pendientes cuando el pendiente es uno.
  3. **El patrón puede ser una LISTA** porque la relación rama↔tarea es muchos-a-muchos: acá las ramas se
     cortan unas de otras, así que una rama carga trabajo de varias tareas y una tarea vive en varias.
     Medido: CORE-268 vive en `monto-actualizando-sin-banner` **y** en `motai-v2`, que no comparten
     ninguna subcadena. Y **no ensanches el patrón** para cubrir dos: `kyc` trae también
     `obs-kyc-03-codes`, que es observabilidad. Un patrón ancho no falla, miente.
  4. **Incluye las ramas LOCALES, marcadas.** Antes sólo miraba remotas y eso tenía un agujero
     sistemático: al aprobar un PR la remota se borra, así que dejaba de encontrar nada justo para las
     tareas TERMINADAS. `local` **no** quiere decir «sin pushear» — los ambientes dicen cuál de las dos es
     (la de Credifamilia sale «local» y a la vez «ya está en main»).
  5. **La parte de git NO habla con la red; la de los PRs SÍ.** Git lee lo que el último `git fetch` dejó
     —si un dato se ve viejo, fetcheá—. Los PRs son UNA llamada a `gh` por repo (no por rama) y **degradan
     sin ruido**: sin `gh`, sin sesión o sin VPN, las ramas salen igual y sólo faltan los PRs.
  6. **Es un SNAPSHOT con fecha** (`data/cache/ramas.json`, fuera de git), como el del sprint: un estado
     de git sin fecha se lee como actual y no lo es. La clave es el **id** de la tarea, no el slug,
     porque el nombre del archivo se puede renombrar a mano.

- **El pulso NO se escribe a mano ni desde el tablero.** Lo anota `server/cmd/pulso` (un LaunchAgent,
  cada 5 min) leyendo git: es la fuente objetiva de *cuándo toqué código*, y editarla la volvería otra
  bitácora. Se lee con `make pulso` o `GET /api/pulse`. El porqué del diseño: `README.md` → «El pulso».
  Si vas a razonar sobre cuánto se trabajó, mirá el pulso; la bitácora dice **en qué**, no **cuándo**.
