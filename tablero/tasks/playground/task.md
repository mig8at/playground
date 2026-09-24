---
id: 90
title: "Playground"
clase: proyecto
stage: evaluation
created: "2026-09-19T14:55:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Con acción vigente

- **Reglas vigentes en los CLAUDE.md:** decidir el destino de diez correcciones y dejar la regla
  actual sin el relato de cómo cambió.
- **País fuera del código:** revisar el cambio pendiente, ejecutar la matriz de QA y preparar lo que
  todavía no llegó a producción.
- **Logs con contexto de negocio:** definir la convención de campos y contrastarla con el mapa del
  trazador antes de cambiar mensajes que otras herramientas consumen.
- **OTP de pruebas:** decidir si la simulación vive en el servicio de mocks y cuál es su comportamiento
  seguro por defecto.
- **Internacionalización restante:** abrir el cambio de los filtros que aún suponen el país histórico.
- **Perfil de riesgo:** pedir la nueva prueba en dev y, si sigue bloqueado, verificar la caché de
  permisos.
- **Rastro del documento firmado:** decidir si se crea Jira; el arreglo local ya está probado y no
  existe fuera de esta máquina.
- **SDK del comercio:** medir cuántos comercios ecommerce mapean el documento antes de decidir si la
  experiencia propuesta es realista.
- **Una consulta por ambiente, en `connectors/`:** fases 0 y 1 hechas (el módulo único y
  `connectors/sql`); sigue la 2, `connectors/logs`.

## Frente: una consulta por ambiente, en `connectors/`

**Objetivo.** Una sola forma de preguntar «datos, logs o eventos en tal ambiente», y **toda** la lógica
en `connectors/`: qué fuente atiende cada ambiente, las credenciales, el chequeo de sólo lectura y la
normalización de lo que vuelve. Y lo mismo para los servicios (canon, Jira, Confluence, Slack, Jev),
con su propia regla: leer es libre y escribir hacia afuera se muestra antes de ejecutarse. Las
herramientas (tablero, trazador, harness, workers) sólo llaman.

**Por qué, medido el 2026-09-23.** Hay clientes repetidos, y ya no coinciden entre sí:

| qué | quién tiene su propio cliente |
|---|---|
| SQL | `tablero/server/internal/dbquery` · `trazador/server/fuentes.go` · `harness/pkg/db.ts` (lee **y escribe**) · `workers/datos.py` (le pregunta al trazador) |
| Loki | `trazador/server` · `harness/pkg/loki.ts` · `workers/datos.py` |
| PostHog | `trazador/server/posthog.go` · `harness/pkg/posthog.ts` |

`tablero-db` exige el ambiente y `trazador-sql` va a `prod` si no se lo dan; cada uno tiene su propio
chequeo de sólo lectura, escrito distinto; y las credenciales están en los `.env` de cuatro
herramientas, con nombres distintos para lo mismo (`TABLERO_DB_*`, `E2E_DB_*`, `LOKI_*`).

**El contrato — la forma única:**

- Tres conectores por la PREGUNTA, no por el proveedor: `connectors/sql`, `connectors/logs`,
  `connectors/events`. Redash, Loki y PostHog son detalles de adentro.
- **El ambiente es obligatorio**: `local` · `dev` · `qa` · `staging` · `prod`. No hay default.
- **Cada resultado dice ambiente + fuente + consulta + si se cortó.** La fuente se nombra
  aunque dos ambientes compartan base: `qa` y `staging` leen la misma base que `dev`, y el resultado
  tiene que decirlo.
- **Una combinación que no existe falla con su motivo, nunca devuelve vacío** (logs en `local`, si no hay Loki).
- **Sólo lectura**, con UN chequeo para todos. Escribir queda afuera (ver «Lo que NO entra»).
- Por consola, un binario con tres verbos y `--json` para el agente:

      pg sql    --target prod "SELECT …"      [--json | --csv]
      pg logs   --target qa   '{service_name="…"}' --since 1h
      pg events --target dev  --ureq 502705

**Qué atiende cada ambiente** (lo marcado con `?` se mide en la fase de su conector, no se supone):

| ambiente | sql | logs | events |
|---|---|---|---|
| `local` | MySQL de Docker (`legacy-backend-mysql-1`) | Loki local (`harness/bin/loki-local`, según el README del trazador; a medir) | ? |
| `dev` | MySQL directo, base compartida | Loki `creditopdev`, `service_name="legacy-backend"` | ? |
| `qa` | la misma base que `dev` | Loki `creditopdev`, `service_name="CreditopDev"` | ? |
| `staging` | la misma base que `dev` | Loki `creditopdev`, ? | ? |
| `prod` | Redash, auditado a nombre del token | Loki `creditop` | PostHog de producción |

**Y los servicios: la segunda familia de `connectors/`.** canon, Jira, Confluence, Slack y Jev también
viven ahí, pero su riesgo no es el ambiente sino ESCRIBIR hacia afuera: un issue, un mensaje, una
revisión de canon que lee todo el equipo. Hoy:

| servicio | cliente de hoy | lee | escribe |
|---|---|---|---|
| `canon` | `tablero/server/internal/canon` + `tools/canon.py` (envoltorio) | buscar, leer, código | borrador → piezas → cierre |
| `atlassian/jira` | `tablero/server/internal/atlassian` + `cmd/jira-mcp` hecho a mano | issues, sprint | crear, mover, worklog |
| `atlassian/confluence` | sólo `tools/confluence.py` | espacios, páginas | — |
| `slack` | `tablero/server/internal/slack` + `cmd/slack-mcp` hecho a mano | canales, hilos | enviar |
| `jev` | sólo `tablero/tools/jev_transport.py` | — | — (sin uso cableado desde el 2026-09-23) |

Jira y Confluence comparten credenciales y cliente HTTP: son UN conector `atlassian` con dos partes.

El contrato de esta familia:
- **Leer es libre.** Escribir es un verbo aparte que **por defecto sólo muestra** lo que haría, y
  ejecuta con `--apply`. Es lo que ya hacen `jira-create` con su vista previa y `canon-propose` frente
  a `canon-write`, ahora como regla de todos.
- **Todo texto que sale** a Jira o a Slack pasa por el guard (`internal/guard`), que se muda con ellos:
  hoy lo aplica cada comando por su cuenta.
- canon es el único con ambiente (`local` · `prod`), y es obligatorio igual que en los datos: lo que
  se escribe en el local no lo ve el equipo.
- Jev se porta como transporte y nada más: la regla del 2026-09-23 es no cablearlo a la interfaz hasta
  que haya un uso decidido.

**Fases** — cada una termina con el A/B idéntico, la copia vieja borrada y un chequeo que falla si
vuelve a aparecer un cliente fuera de `connectors/` (se cablea, no se escribe):

0. **Un solo módulo de Go en la raíz.** Hoy `tablero/server` y `trazador/server` son módulos separados
   y no pueden compartir paquetes. Se comprueba con las pruebas de los dos y la consola del tablero
   comparada antes y después.
1. **`connectors/sql`.** Se parte de `dbquery` (ya separa MySQL y Redash) y se le suma lo de
   `trazador/server/fuentes.go`. El chequeo de sólo lectura es la unión de los dos, con pruebas de cada
   caso que uno frenaba y el otro no. El A/B: la misma batería de consultas en los cinco ambientes por
   `tablero-db`, por `trazador-sql` y por el conector, con las mismas filas. Se mide ahí lo que difiere
   entre Redash y MySQL directo (tipos, límite de filas, caché de resultados) y se normaliza.
   Después `tablero-db` y `trazador-sql` pasan a usarlo, y `workers/datos.py` pregunta al conector.
2. **`connectors/logs`.** Sale del trazador, con el mapa de etiquetas por ambiente escrito una sola
   vez. El harness conserva su forense, pero su cliente HTTP (`pkg/loki.ts`) pasa a ser `pg logs
   --json`; lo mismo `workers/datos.py`.
3. **`connectors/events`.** Lo mismo con PostHog: `trazador/server/posthog.go` + `harness/pkg/posthog.ts`.
4. **Los servicios que ya están en Go se mudan**: `canon`, `atlassian/jira` y `slack` salen de
   `tablero/server/internal` a `connectors/`, con el guard. Es mover y reapuntar imports: el A/B es la
   consola del tablero y sus pruebas, antes y después, sin escribir nada afuera (las escrituras se
   comparan en su modo de vista previa).
5. **Los que están en Python se portan**: `atlassian/confluence` (`tools/confluence.py`, con `make
   confluence` comparado verbo por verbo) y `jev` (el transporte, con sus pruebas offline). Con esto
   `tools/canon.py` deja de ser necesario en cuanto `workers/` lea canon por el conector.
6. **Las credenciales, en un solo lugar por ambiente y por servicio**, y fuera de los `.env` de cada
   herramienta las claves que el conector ya resuelve. Se reescribe §«Variables de entorno» del
   `CLAUDE.md` raíz.
7. **El registro de comandos**: `pg help --json` sale de la misma lista que el binario, y de ahí el
   catálogo del hook de inicio y UN servidor MCP con los conectores como herramientas nativas del agente
   —los de lectura, y los de escritura con su vista previa—. Reemplaza a `jira-mcp` y `slack-mcp`, que
   hoy se mantienen a mano.

**Lo que NO entra.**
- **Escribir.** La siembra del harness y su guarda (`pkg/db-safe.ts`) son lógica del harness, no del
  conector. Moverla junto con la lectura mezclaría la herramienta más riesgosa con la más usada. El
  conector sólo le daría la conexión, más adelante y aparte.
- **Consultar prod sin Redash.**
- **Cambiar la lógica de los forenses** (qué se busca en los logs de una solicitud): eso sigue siendo del
  trazador y del harness.

**Decidido el 2026-09-24** («dale, arrancá»): `connectors/` para la carpeta y `pg` para el binario;
las credenciales centralizadas por ambiente, sólo para lo que resuelve cada conector; y `qa` como
ambiente propio. Las credenciales de la base se adelantaron a la fase 1, porque sin ellas `tablero-db`
no tenía fuente en ningún ambiente.

**Lo que dejaron las fases 0 y 1:**
- **Hechas.** Hay un solo módulo de Go en la raíz (`creditop/playground`) y existe `connectors/sql`:
  fuente por ambiente, ciclo de Redash, guarda de argumentos y un solo chequeo de sólo lectura, con
  credenciales en `connectors/.env.<target>`. El tablero (`tablero-db` y el validador de bloques
  ` ```sql `) y el trazador ya lo usan, y una prueba falla si reaparece un cliente SQL fuera de
  `connectors/`.
- ⚠ **Las claves de base van con el prefijo `E2E_DB_`, y el conector no lee `DB_HOST`** ni del archivo ni
  del proceso. Es el nombre que lee Laravel, y un `set -a` lo dejaba apuntando a la base compartida
  (CORE-431). Casi se reintroduce al crear los archivos del conector.
- **Redash no devuelve lo mismo que MySQL directo.** Los números ahora llegan exactos. Los DECIMAL
  difieren en ceros (`1560414.0` contra `1560414.0000`), y las cadenas binarias llegan en hex, así que
  se piden con `CAST(… AS CHAR)`.
- **Quedan secretos que ya nada lee**, y cuáles borrar lo decide Miguel: las claves `E2E_DB_*`/`REDASH_*`
  de `trazador/.env.*` y las `TABLERO_DB_*` de `tablero/server/.env`. Estas últimas nunca se leyeron:
  `db-query` no cargaba ese archivo.

## Sin próximo paso vigente

Antes de retomar cualquiera, decidir si merece Jira o cierre: flujos paralelos; receta local de
Credifamilia; bypass de documento no encontrado; contador de TusDatos; errores legibles y testids;
`min_income`; tarjeta de lender desde backend; costo del perfilador; Motai local; plazo elegido por el
cliente y SmartPay local.

## Cerrados retirados

Los archivos ya archivados de PDF Mapper, catálogo de campos y tarjeta parametrizable no se reabren
en este contenedor. Su contenido permanece en Git.

## Regla de uso

- No crear otro archivo local para una mejora general: agregar o actualizar un frente aquí.
- Si aparece una mejora de `canon`, `context`, `harness`, `tablero`, `trazador` o `workers`, moverla a
  la tarea canónica correspondiente.
- Cuando el trabajo se compromete con el producto o el equipo, crear o vincular Jira y sacarlo de esta
  lista.
- Mantener arriba solo estado y siguiente acción; el hecho de un día va al Registro.
