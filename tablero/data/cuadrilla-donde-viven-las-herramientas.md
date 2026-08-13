---
id: 48
title: "cuadrilla: el tablero de épicas del equipo — funciona, pero no tiene dónde vivir"
stage: work
created: "2026-08-13T16:00:18-05:00"
context_nodes: []
jira: [CORE-421]
jira_title: "Tablero del equipo: en qué anda cada quien y qué está esperando aprobación"
---

**ESTADO 2026-08-13 · EN PROGRESO** — la herramienta corre y se usa en local. Lo que la bloquea **no
es código**: no hay un lugar donde publicarla para el equipo.

**Jira: [CORE-421]** · CORE Sprint 11 · 5 puntos · estado «🚧 En progreso».

## Qué hay hecho

Corre con `make cuadrilla` (:5197). Vue 3 + un server Node **sin dependencias** (`node:http` +
`node:sqlite`).

- **Épicas de verdad, en SQLite**: nombre, gente, repos con su rama base por repo.
- **La unidad es la RAMA, no el PR** — cada persona ata las ramas que ya empujó, y solo se le ofrecen
  las que salen de la base que la épica asignó (una rama de otra base ensucia la épica).
- **Documentación por persona**, markdown con editar/preview, en un panel lateral.
- **Tokens por persona** (sha256, prefijo `cua_`, se muestran una vez) para que un agente escriba
  **solo como su dueño**: no puede tocar el contrato de la épica ni la documentación de otro.
- **Podio de quién más aprueba PRs** y **el impostor** (juego, SSE) para que la gente entre.
- Login con GitHub por OAuth andando (cuenta propia; falta aprobación de la org).

## Qué sigue siendo mentira

El **estado de cada rama** (PR abierto, días esperando, mergeada) y **quién aprobó** se simulan por
consola. Salen de verdad cuando exista una **GitHub App de la organización** con `Contents: read` +
`Pull requests: read`. Ese es el otro pendiente, y es chico al lado del de abajo.

## El pendiente que bloquea: dónde vive una herramienta interna

Hoy cada herramienta corre en la máquina de quien la escribió. Eso es lo que hay que resolver, y no
es específico de cuadrilla: es la condición para que cualquier herramienta interna la use el equipo.

**Lo que se intentó y por qué no salió** (2026-08-13). Se intentó colgarla del dominio de
`credibrain`: PR mergeado a `main` y **revertido el mismo día** (`0f6d47c`; el árbol quedó idéntico
al de Oscar y la rama `feature/cuadrilla` se borró). Cuatro hallazgos, todos verificados:

1. **`main` de credibrain NO es lo que corre.** Producción es **Lambda** (SAM, `template.yaml`) en la
   VPC → **RDS con pgvector** → embeddings por **Bedrock**. Vive en la rama **`feature/infra`**, donde
   `qdrant` y `ollama` ya se borraron. El `docker-compose.prod.yml` y el `Caddyfile` de `main`
   describen el MVP viejo en una VM: leerlos como si fueran producción cuesta una sesión entera.
2. **El deploy automático existe, en esa rama**, y filtra por rutas: `apps/web/**` → S3+CloudFront,
   `apps/brain/**` o `template.yaml` → SAM. Ninguna ruta de una herramienta nueva matchea, así que
   mergear no dispara nada ni en `main` ni en `feature/infra`.
3. **cuadrilla no entra en ese molde**: es un proceso **con estado** — SQLite en disco y SSE abierto.
   Lambda tiene disco efímero y SSE no pasa por API Gateway REST. Y no se arregla yéndose a
   contenedores administrados: tampoco persisten disco, y montar red compartida con SQLite es un combo
   que SQLite mismo desaconseja (el locking sobre NFS no es confiable).
4. **El CI de la casa** son workflows reusables centrales que asumen **ECR + ECS** (piden
   `ecr_repository`, `ecs_cluster`, `task_definition`) y corren en runners de **CodeBuild**, no en los
   de GitHub. Reusarlos implica re-plataformar, no copiar un YAML.

**Las dos salidas** (decisión pendiente, y es de infra tanto como mía):

- **(a) Un lugar donde un proceso viva con disco de verdad.** Sirve para cuadrilla y para las que
  vengan, sin reescribirlas. Es lo que pido.
- **(b) Adaptar cada herramienta al molde serverless**: SQLite → Postgres, SSE → polling. Se hereda el
  deploy que ya existe, pero se paga por herramienta y cada una pierde lo que la hacía simple.

## Preguntas abiertas

- ¿Quién es dueño de ese servidor y cómo se despliega? Lo que quiero evitar es una VM más que nadie
  mantiene.
- ¿Se ordena el `main` de credibrain? Hoy no refleja producción, y el próximo que llegue va a pisar el
  mismo hueco. Dato suyo que vale rescatar: en `feature/infra` se deshabilitó `synchronize` de TypeORM
  porque *«was wiping pgvector embeddings»*.
- Permisos: hoy tengo **`maintain`** en el repo de credibrain (no `admin`, así que los *secrets* de
  Actions los tiene que poner un owner).

## Tarea (publicable)

El equipo no tiene una forma de ver en qué anda cada quien cuando varias personas trabajan sobre la
misma épica. Hoy eso se pregunta por chat: quién tocó qué, qué cambios están esperando aprobación y
desde cuándo, y cuánto falta para cerrar. La consecuencia práctica es que un cambio puede quedarse
días esperando revisión sin que nadie se dé cuenta, y que revisar el trabajo de otro —que es lo que
sostiene la calidad— no se ve en ninguna parte.

Se armó un tablero de épicas del equipo. Por cada épica se ve la gente involucrada, los cambios que
cada uno tiene abiertos, cuáles esperan aprobación y hace cuántos días, y cuánto se avanzó (el avance
se calcula sobre lo que ya se integró, no se declara a mano). Incluye documentación por persona, para
que el contexto de una tarea no viva solo en la cabeza de quien la hizo, y un reconocimiento a quien
más revisa el trabajo de los demás.

Estado: funcionando y en uso en un equipo local.

**Pendiente, y es lo que bloquea que el equipo lo use:** no hay un lugar donde publicar herramientas
internas. Cada herramienta corre hoy en el computador de quien la escribió, así que nadie más la
alcanza. Se necesita un servidor donde puedan vivir varias herramientas del equipo, con dos
condiciones que hoy no están cubiertas: que puedan **guardar datos** de forma permanente y que puedan
**mantener conexiones abiertas** con el navegador. Sin eso, cada herramienta nueva se queda en la
máquina de quien la hizo.

Falta también un permiso de la organización para leer el estado real de los cambios; mientras no
esté, esa parte del tablero se alimenta a mano.
