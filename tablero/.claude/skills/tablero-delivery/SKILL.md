---
name: tablero-delivery
description: Saber dónde está y cómo va una tarea FUERA del playground: en qué ramas y ambientes vive su cambio (make tareas-ramas, patch-id y PR), dónde se prueba (dev, qa, staging comparten la base pero no el backend; prod se despliega al taguear; las migraciones no se aplican al mergear), qué se desplegó y qué falló (make deploys FALLAS=1), por qué falla Sonar (el paso o el gate), y cómo crear, mover o editar un issue de Jira (make jira-create/-move/-edit, transiciones de CORE).
---

# tablero · la entrega: ramas, ambientes, despliegues, Sonar y Jira

Lo que dice dónde está el trabajo de una tarea afuera del playground. Vivía en `tablero/CLAUDE.md` hasta
el 2026-09-27.

## Ramas: se declaran los patrones, el resto lo mide git

- **RAMAS: se declaran los PATRONES, el resto lo mide git.** `ramas: pais-como-dato` en el frontmatter
  —o varios separados por coma— y `make tareas-ramas` responde en qué ramas de qué repos vive la tarea,
  **en qué ambientes ya está el cambio** y **en qué estado está su PR**. Igual que los artifacts (son lo
  que hay en la carpeta) y los pendientes (salen del cuerpo): una lista de ramas escrita a mano **miente
  en silencio** en cuanto algo se mergea o se renombra. Medido el 2026-08-19 grepeando las 16 tareas de
  los últimos 4 sprints: de los nombres de rama que aparecen escritos en los cuerpos, **dos no resuelven
  hoy** — uno porque la rama se renombró (`codebtor-` → `cosigner-`, el cuerpo lo aclara al lado, pero un
  grep encuentra el viejo) y otro porque la remota se borró al mergear el PR. Seis reglas:
  1. **Se mide por PATCH-ID** (`git cherry`), no por nombre de rama: así se detecta un cambio que llegó
     por **squash**, donde el hash cambia y la rama ya no existe. Es cómo se supo que el backend de
     países estaba en `develop` y `staging` pero no en `main`.
     ⚠ **Pero el patch-id solo NO alcanza, y el agujero es grande: un squash cuyo mensaje o contenido se
     editaron al mergear cambia el patch, y la rama pasa a figurar «en ningún ambiente» aunque su
     cambio esté en `main`.** Medido el 2026-09-15: `frontend-monorepo#983`, squasheado a `3f3f8700`,
     estaba en `main` hacía un día y el tablero decía que no — y la tarea de Alta Fleet afirmaba, con esa
     medición, que nada suyo había llegado. Por eso hay una **segunda señal**: si el PR se mergeó y su
     commit resultante ya es ancestro del ambiente, el cambio está. Cada ✓ guarda **cómo se supo**
     (`como: patch | pr`) y la tabla marca distinto los que vinieron por el PR: un dato que no se puede
     explicar no se puede defender.
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
     —si un dato se ve viejo, fetcheá—. Los PRs son UNA llamada a `gh` por repo **más una por cada rama
     que esa llamada no cubrió**, y **degradan sin ruido**: sin `gh`, sin sesión o sin VPN, las ramas salen
     igual y sólo faltan los PRs. ⚠ La llamada por repo trae los **200 más nuevos**, y eso es una ventana:
     medido el 2026-09-14 llegaba al 24/8 en `legacy-backend` y al 13/8 en `frontend-monorepo`. Antes de
     la búsqueda por rama, 20 de 112 ramas salían «sin PR» —13 ya estaban en `main`— y una tenía un PR
     **abierto contra `main`** que nadie veía (`legacy-backend#1043`). Y `--search head:x` no es exacto
     (trae `x-onto-develop` también): se filtra por nombre después.
  6. **Medir UNA tarea (`-n`) no borra las demás.** Guardaba el resultado tal cual y el snapshot quedaba
     con esa sola: el tablero mostraba que ninguna otra tarea tiene ramas, sin avisar (2026-09-15). Ahora
     se fusiona con lo que había, y **cada tarea lleva su propia fecha de medición**, así que lo viejo se
     ve viejo en vez de heredar la fecha de la última corrida.
  7. **Las tareas que no declaran `ramas:` no se miden — y son la mitad.** `make tareas-ramas SUGERIR=1`
     propone patrones mirando las ramas reales: rankea por lo que comparten de RARO (un trozo que
     aparece en pocas ramas de todo el universo) y por la clave de Jira **del frontmatter**, no del
     cuerpo —el cuerpo menciona las claves de otras tareas—. Es una propuesta, no una medición: el patrón
     sigue siendo lo único que se escribe a mano.
  8. **Es un SNAPSHOT con fecha** (`data/cache/ramas.json`, fuera de git), como el del sprint: un estado
     de git sin fecha se lee como actual y no lo es. La clave es el **id** de la tarea, no el slug,
     porque el nombre del archivo se puede renombrar a mano.

## Ambientes: cada uno tiene su ruta para probar

- **AMBIENTES: cada uno tiene su propia ruta para probar, aunque compartan la BD.** Una tarea no
  termina cuando mergea: termina cuando alguien la pudo *probar*, y para eso hay que decir **dónde**.

  **Acá no hay lista de ambientes, a propósito: nacen por necesidad.** `qa` se creó para trabajar
  Motai, y mañana puede haber otro para otra tarea. La fuente es el **workflow de cada repo**
  (`.github/workflows/`): hay un archivo de deploy por ambiente y cada uno declara su rama y su
  servicio. Si querés saber qué ambientes existen HOY, se leen ahí — no acá.

  Lo que sí es estable, y es lo que hay que tener claro al escribir una tarea:

  1. **Comparten la base de datos, no el código.** Medido el 2026-08-20: `dev`, `qa` y `staging`
     apuntan los tres a la **misma** base (`inertia-dev`), pero a **backends distintos**
     (`legacy-backend`, `legacy-backend-qa`, `legacy-backend-stg`) y **fronts distintos**. De ahí las
     dos caras: sembrar un dato o correr una migración **una vez sirve para los tres** —por eso las
     migraciones de Motai aparecen aplicadas en dev y en qa a la vez—, pero **la misma solicitud se
     comporta distinto según a qué backend le pegues**. Probar contra el ambiente equivocado mide la
     rama equivocada (**F-73**).
  2. ⚠ **Nombrar el ambiente no alcanza: hay que saber a qué le habla.** El front desplegado de
     `staging` llama al backend de **`develop`** (`loans-stg.yaml`), no al de staging. Así que «lo
     probé en staging» desde el navegador **no** es lo mismo que apuntarle al backend de staging.
  3. **Prod es otra base y otro disparador.** No se despliega al mergear a `main`: se despliega al
     **taguear** (`on: push: tags` en los dos repos). «Está en `main`» y «está en producción» son dos
     preguntas distintas — y las migraciones de prod hay que correrlas aparte, siempre.
  4. **Mergear no aplica migraciones** en ningún ambiente: el pipeline solo actualiza el servicio y
     las migraciones van por un workflow manual (**F-77**). Si tu tarea lleva una, «mergeada» no es
     «terminada»: el 2026-08-20 eso dejó a producción con el código nuevo y la fila vieja, y el plan
     de pagos salió con una cuota que no era la del contrato.

  **Consecuencia para la publicable:** «Dónde probar» nombra **el ambiente concreto**, no «el ambiente
  de pruebas». QA prueba en dev, en qa y en staging según la tarea, y los tres se ven iguales porque
  muestran los mismos datos — si la sección no lo dice, tiene que adivinar entre tres.

## Despliegues

- **DESPLIEGUES: `make deploys` dice el PASO que falló, no «falló».** Es la pregunta del día a día que
  se contestaba abriendo GitHub repo por repo. Sale de `gh`, que ya está autenticado: no hace falta
  ningún token nuevo.

  ⚠ **La distinción que justifica la herramienta:** una corrida en rojo no es «falló el deploy». Medido
  el 2026-09-15 sobre las 8 últimas fallas de `legacy-backend`, dos eran de **Dependabot** (ni siquiera
  son despliegues), tres del deploy a ECS, dos del **análisis de SonarCloud** y una del build de la
  imagen. Leerlas todas igual son cuatro conclusiones equivocadas de ocho. Por eso el ruido de
  dependencias se filtra por el nombre del workflow, y de cada falla se muestra **el job y el paso**.

  > **MEDICIÓN · 2026-09-15** — 201 despliegues en 15 días, 11 fallidos: 7 en «Build Image» y 4 en «Deploy Task Def to ECS»; por ambiente, 6 en qa, 3 en develop y 2 en producción. El deploy a producción del 2026-09-02 se cayó en el paso de **SonarCloud**, porque el scanner no pudo cargar los perfiles de calidad del proyecto — el código estaba bien, falló la herramienta de análisis.
  > `make deploys DIAS=15 JSON=1`

  **`FALLAS=1` es el modo de todos los días**: sólo lo fallido, con el ERROR del log y el enlace. Sin
  él hay que buscar los ✗ entre 122 líneas, de las cuales 106 están en verde — medido, y es justo lo
  que la herramienta venía a evitar. Trae el repo, el ambiente, la rama, el paso y el motivo:

      ✗ 2026-09-10  legacy-backend → develop
         dónde   develop / deploy / Deploy Task Def to ECS → Deploy to Amazon ECS
         por qué Failed to register task definition in ECS: Actual length: '65558'. Max allowed length is '65536' bytes.

  ⚠ **El error sale del marcador `##[error]` del runner, y NO siempre está**: de las 4 fallas de la
  última semana, 3 lo traen y 1 no. Cuando falta hay un respaldo que busca líneas con «error», y si
  tampoco hay **se dice que no se pudo leer** y queda el enlace. Inventar un motivo sería peor: quien lo
  lee dejaría de abrir el log, que es donde está la respuesta.

  El detalle de cada falla se pide EN PARALELO (dos llamadas por falla, una de ellas un log de ~30 KB):
  en fila eran 19 s para tres, ahora 11 s. Un comando que se usa cuando algo se rompió no puede hacer
  esperar.

## Sonar

- **SONAR: «falla el sonar» son DOS cosas distintas, y se consultan distinto.** Credenciales en
  `server/.env`: `SONAR_URL` (`https://sonarcloud.io`), `SONAR_ORG` (`creditop-sas`) y `SONAR_TOKEN`.
  ⚠ El token de hoy es PERSONAL y vence; la propia pantalla de Sonar recomienda un *Scoped Organization
  Token* para automatización de equipo, que no muere con la cuenta de nadie.

  | «falla el sonar» | qué es | cada cuánto |
  |---|---|---|
  | **el PASO del deploy** | el scanner no pudo correr, y **tumba el despliegue entero** | raro: 1 de 40 |
  | **el GATE de calidad** | el análisis corrió bien y el código no pasa el umbral | permanente hoy |

  **1 · El PASO.** `make deploys FALLAS=1` lo muestra con su motivo. El del 2026-09-02 tumbó el deploy
  a **producción** con *«Failed to load the quality profiles of project … An unexpected error occurred.
  Please try again later»* — un fallo del lado de SonarCloud, no del código ni de la configuración (los
  perfiles existen: se comprueba con `api/qualityprofiles/search?project=…`). Se reintenta y pasa.

  **2 · El GATE.** El análisis SÍ corre y publica por rama. Para saber por qué está en rojo:

      source <(grep -E '^SONAR_(URL|ORG|TOKEN)=' tablero/server/.env)
      # qué ramas tienen análisis, cuándo, y su gate
      curl -s -u "$SONAR_TOKEN:" "$SONAR_URL/api/project_branches/list?project=Creditop-SAS_legacy-backend"
      # y POR QUÉ falla el gate de una rama: las condiciones que no pasan
      curl -s -u "$SONAR_TOKEN:" "$SONAR_URL/api/qualitygates/project_status?projectKey=Creditop-SAS_legacy-backend&branch=qa"

  > **MEDICIÓN · 2026-09-15** — `legacy-backend`, rama `qa` (analizada ese mismo día): gate en ERROR por dos condiciones — `new_coverage` en **0,0 %** contra un umbral de 80, y `new_maintainability_rating` en 3 contra 1. O sea que lo que traba el gate es que **el código nuevo no trae pruebas**, no una regla exótica. `legacy-application` en `develop` da OK; `frontend-monorepo` sólo tiene `main`, del 2026-07-03.
  > los dos `curl` de arriba

  ⚠ **LA TRAMPA QUE ME COMÍ, y es la que va a repetir cualquiera:** `api/components/show` devuelve el
  análisis de la **rama principal** del proyecto, y las principales están viejas (`main` de
  `legacy-backend`: 2026-07-10). Con esa consulta los tres repos dan **«lastAnalysisDate: NUNCA»** y se
  concluye que nadie los analiza — que es exactamente lo que afirmé acá antes de mirar las ramas. El
  análisis vivo está en `qa`, `develop` o `lab`. **Siempre preguntar por RAMA.**

## Jira

- **Jira y Slack tienen TRES caminos**, no dos: el server (`npm run dev` → :8787, botones con vista
  previa), el servidor MCP de los conectores (`bin/pg mcp`, stdio — sólo si está registrado) y **la CONSOLA**,
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
- **Las transiciones disponibles se le preguntan a Jira.** El icono de la fila llama a
  `GET /api/transitions` para ESE issue y reduce las salidas al único avance normal de CORE:
  *Por Hacer → En progreso → En revisión → Terminada*; Bloqueada y En pruebas se reincorporan al
  cauce. No ofrece invalidar, pausar ni retroceder. Es la lección de haberlo hecho al revés: el botón
  anterior estaba cableado a «A pruebas» y **fallaba en 5 de los 6 estados**, porque esa transición
  sólo existe desde «Terminada». Dos detalles del diseño:
  1. El destino que cae en el estado de pruebas **no se mueve directo**: entra al flujo de QA, donde
     mover el issue y avisarle a quien valida son un mismo acto y el mensaje se previsualiza (pasa el
     mismo guard que la bitácora). Se marca «+ aviso» en el menú para que no sorprenda.
  2. El POST **re-lee las transiciones antes de aplicar**: si alguien movió el issue desde Jira con el
     menú abierto, el id queda viejo y Jira devuelve un 400 ilegible. Así se contesta 409 con el porqué.

  Los tres necesitan `ATLASSIAN_*` en `tablero/.env`. Tareas nuevas van al **sprint activo del board
  384**, no al backlog. **Nada se publica sin que Miguel lo vea antes** — los tres escriben hacia
  afuera y lo ve el equipo.
