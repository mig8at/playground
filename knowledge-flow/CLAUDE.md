# knowledge-flow — Knowledge, el vigía de la biblioteca

**Para qué existe:** que `knowledge/` no quede vieja sin que nadie se entere (Miguel, 2026-11-18: «que esté al pendiente
de cuando queda vieja el contexto y arranque la recontextualización como un flujo, paso a paso, como los workflows de
GitHub»). No muestra el contenido de knowledge: dice si está al día con `main` y, cuando no, la pone al día SOLA.
Vivía a mano en Wally (Porygon) y en `make knowledge-drift`; se sacó de Wally porque un flujo con pasos no es un chat.

`make knowledge-flow` (UI :5232 · API :5233) o la app **Knowledge** de Cockpit. A la izquierda las **corridas** (en
curso, en cola, las anteriores por día, cada una con su resultado); al centro la elegida, **paso a paso**, con su
estado, quién lo hace (comando o modelo), cuánto tardó y una línea de qué salió; a la derecha **la biblioteca** (cuántos
temas y fuentes están al día), **el vigía** (cada cuánto mira, la última y la próxima mirada, el modelo) y qué está viejo
o en cola. La ruta es `#/run/<n>`.

## Cómo decide

- **Mira `main` cada 30 minutos** (`lookEvery`), y al tocar «Mirar ahora»: trae los clones sólo-main (`cmd/knowledge
  fetch`) y corre `knowledge check`. Mirar no gasta modelo.
- **Si una fuente cambió, arranca una corrida** con los diez pasos (abajo). Una a la vez: lo que entra mientras corre
  **no se mezcla**; queda en cola (se ve a la izquierda y como aviso arriba de la corrida) y, al terminar bien, mira
  otra vez y arranca otra, hasta que no quede nada. Después espera.
- **Una corrida no se repite sobre los mismos cambios** (la huella de las fuentes viejas, `fingerprint`): si frenó,
  espera a que la mires o a que entre un cambio nuevo; si terminó y esas fuentes siguen viejas, también espera, porque
  repetirla sería un bucle que gasta modelo sin arreglar nada. **Una que FALLÓ sí se reintenta** (no hubo veredicto):
  sin límite si fue porque el modelo no contestaba (`modelDown`), y hasta 3 veces seguidas si fue otra cosa.
- **Sin modelo no arranca** (2026-11-19: las corridas #4, #5 y #6 fallaron en el triaje con la sesión de `playground
  login` vencida y, por la huella, esos temas quedaban viejos aunque la sesión volviera). Antes de cada corrida pregunta
  si el modelo de segundo plano contesta (`background.Info`); si no, no gasta una corrida: espera («esperando al
  modelo» arriba de la corrida), **avisa una vez** por macOS con lo que lo arregla, y mientras haya fuentes viejas
  vuelve a mirar **cada 2 minutos** en vez de 30. Apenas entrás con `playground login`, arranca sola y avisa que el
  modelo volvió. La sesión se renueva sólo con el navegador: eso no lo puede hacer Knowledge.
- **Si el modelo se cae A MITAD de una corrida, esa misma se retoma** desde el paso donde cayó apenas vuelve (`resume`,
  marcada «retomada»): no nace otra que repita los pasos 1 a 3.
- **Una frenada se retoma a mano** (2026-11-23, la #15: `infrastructure` borró `pr-checks.yml` y `deploy-infra.yml`
  por workflows por ambiente, el paquete no traía los archivos nuevos y el modelo dejó 2 secciones «sin decidir»). Por
  consola, con `bin/knowledge` (abajo): `run <n>` dice qué la frenó y los comandos que siguen; `decide` escribe la
  decisión de una sección en `.data/runs/<n>/drift/overrides.json` y `replace` el archivo que reemplazó a uno borrado
  en `reemplazos.json`, los dos validados; `resume <n> --wait` la retoma. En la app, el botón **Retomar** del aviso
  (`POST /api/runs/{id}/resume`, con `X-Knowledge: 1`). Corre otra vez desde el paso que frenó (desde «Juntar» si frenó en la verificación). Sólo la
  última corrida y sin otra en curso; la atiende el loop, así que si está mirando main arranca al terminar la mirada.
- **La lista esconde lo superado** (Miguel, 2026-11-19: «que no quede ese ruido»): una corrida frenada o fallada queda
  «superada» cuando después pasó otra y ninguno de sus temas sigue viejo; «Ver todas» la muestra. No se borra del disco:
  es la pista si algo vuelve a fallar. Lo que sí pide algo (frenada o fallada con temas todavía viejos) sigue a la vista.
  La última mirada se guarda (`.data/look.json`): después de un reinicio, las superadas se esconden sin esperar a mirar.
- **Se pueden borrar** las frenadas y las falladas (Miguel, 2026-11-19: «para mantenerlo limpio»): la papelera de la
  cabecera de la corrida (el primer toque pregunta en la línea, el segundo borra) y «Borrar las superadas (N)» abajo de
  la lista (`DELETE /api/runs/{id}` · `POST /api/runs/clean`, con el encabezado `X-Knowledge: 1`). **Las que pasaron no
  se borran**: cada una está atada a un commit de `knowledge/`. Un número borrado no se reusa (`.data/last-run`).
- **La mirada a main se ve**: mientras trae los clones y comprueba (~5 min, sobre todo el `check` de ~1.300 fuentes),
  el sidebar y la biblioteca dicen «Mirando main» con su animación y cuánto lleva (`lookingSince`).
- **Aplica solo** (decisión de Miguel, 2026-11-18) si la verificación sale limpia, y **commitea** lo aplicado por ruta
  (`knowledge/<tema>/rules.md` y `sources.json`) con el número de corrida en el mensaje: cada cambio se puede rastrear
  o deshacer con git. Avisa por macOS al terminar (con sonido si frenó o falló); tocarlo abre la corrida.
- **Sólo corre el proceso que escucha el puerto**: el de fondo y el de Cockpit no se pisan (el segundo espera).

## Los diez pasos (los de `tools/knowledge-drift`)

⚠ **Local primero** (Miguel, 2026-11-24): main se trae UNA vez y lo demás sale del git local; a la red sólo va lo que
git no tiene, en lote y con caché. Una mirada no puede tardar 10 minutos consultando cosa por cosa. La regla, con lo que
tardaba cada paso antes y después: [`tools/knowledge-drift/CLAUDE.md`](../tools/knowledge-drift/CLAUDE.md) §«Local
primero».

**El modelo** es el de segundo plano: Claude por el puente de canon, Gemini por API o, desde el 2026-11-24 (con el puente
dando 502), **Gemini `gemini-4-hydrogen` por la web de AI Studio** en el Chrome de Miguel con Jarvis (`aistudio`,
`bin/pg model set aistudio`): ~1,5 min por pregunta, de a una. Los paquetes se arman según su tamaño y el modelo: con Claude, el
triaje hasta 80 mil caracteres y 60 ítems y el código hasta 15 mil de prosa y 360 mil expandido; **con AI Studio van
grandes** para aprovechar su ventana de ~1 millón de tokens (el triaje de 53 temas en 3 preguntas de ~190 mil tokens,
el código hasta 60 mil de prosa y 1,6 millones expandido): menos preguntas son también menos cortes de Google, que
limita por cantidad. `drift.py` lo decide solo leyendo el modelo elegido en Cockpit (`--big` lo fuerza) y una falla pasajera del modelo se
reintenta; tras un corte de Google, el reintento espera su pausa.

| # | paso | quién | qué |
|---|---|---|---|
| 1 | Traer main | comando | `cmd/knowledge fetch` (lo hace la mirada que dispara la corrida) |
| 2 | Detectar | comando | `knowledge check`: qué fuentes cambiaron o se perdieron (2 s: un `ls-tree` por repo y commit) |
| 3 | Armar paquetes | comando | `drift.py paquete --no-fetch`: el diff neto de cada archivo (del commit revisado a main), la línea de tiempo de los PRs que entraron (de git, con su descripción en caché) y las secciones. ~16 s |
| 4 | Triaje | modelo | `prompts/triage.md`, la prosa contra el diff neto (los PRs, como contexto): `no_toca` · `contradice` · `no_se_sabe` |
| 5 | Leer código | modelo | `drift.py codigo` arma los paquetes; `prompts/code.md` decide `sigue` · `cambia` (con el texto nuevo) |
| 6 | Segunda mirada | modelo | `prompts/second-look.md` sobre lo que el triaje descartó, a ciegas |
| 7 | Juntar | comando | `drift.py final` (con `overrides.json`). **Frena** si queda algo `sin_decidir` o un `cambia` sin texto |
| 8 | Verificar | modelo | una pregunta aparte por sección reescrita: el texto de antes, el nuevo, el diff y el archivo en main. **Frena** si encuentra algo |
| 9 | Aplicar | comando | `drift.py aplicar`. **Frena** si esos temas tienen cambios sin commitear (otra sesión) |
| 10 | Comprobar y commitear | comando | que las fuentes de la corrida queden al día, `make knowledge-test`, y el commit |

- **El modelo es el de segundo plano** (`lib/background`: Claude por defecto, el elegido en Cockpit). No corre nada:
  los prompts de drift se escribieron para agentes que corren `git`, así que cada paquete le llega con el diff de cada
  archivo y el archivo como está en `main` ya adentro (`expand`, recortados a 40 y 30 mil caracteres). Una pregunta
  por paquete.
- **Por qué «sin decidir» frena**: `aplicar` sella TODAS las fuentes de la corrida (commit y blob al día); con una
  sección sin decidir, marcaría al día algo que nadie verificó.
- **Si frena o falla después de aplicar**, la corrida deshace lo aplicado (`git checkout` de esos temas: aplicar sólo
  arranca con ellos limpios). Una corrida cortada por un reinicio queda «falló» y no se retoma a mitad.

## Por consola: `bin/knowledge` (para un agente)

| comando | qué |
|---|---|
| `status` | ¿al día con main? lo viejo, lo que corre, lo que espera, y si una corrida frenada te pide algo (con el comando) |
| `runs [--all]` · `run [<n>]` | las corridas; una paso a paso, con el detalle del freno y los comandos que siguen |
| `sections <n>` | las secciones de una corrida con su veredicto (del modelo o a mano) y su porqué: de acá salen los ids |
| `decide <n> '<tema>#<ancla>' --verdict keep\|change --why '…' [--text-file f.md] [--title '…'] [--evidence repo:ruta]` | decide una sección a mano. Rechaza una sección que no existe, un `change` sin texto o con su `## ` adentro, y una evidencia de un repo que la corrida no lee (el verificador no la recibiría) |
| `replace <n> <ruta-borrada> <ruta-nueva>` | main borró una fuente y otro archivo tomó su lugar: la nueva tiene que existir en main |
| `resume <n> [--wait]` · `look [--wait]` | retomar una frenada · mirar main ya. Van por la API |

Las lecturas leen `.data` sin la API. `--json` en todos; con `--json` también el error sale en JSON (`{"error","fix"}`).
Sale 0 bien · 1 falló o frenó · 2 uso · 3 no existe. Lo que imprime va en inglés (regla de my-tools); los datos de la
corrida, como están. Está en `server/cli.go`, en el mismo binario que el servidor (`bin/knowledge` lo compila a
`~/.cache/my-tools/knowledge`).

## Dónde queda

`knowledge-flow/.data/runs/<n>/run.json` (la corrida: pasos, estados, resumen) y `.../drift/` (los archivos de
drift.py: paquetes, resultados del modelo, `final.json`), fuera de git. Por consola: `make knowledge-flow ONCE=1` hace
una mirada y, si hace falta, una corrida.

## De fondo

`make knowledge-flow-install` deja la API como **LaunchAgent** (`com.creditop.my-tools.knowledge`, binario
`knowledge-flow/bin/knowledge-flow`, fuera de git): mira `main` aunque Cockpit esté cerrado. Después de cambiar el
servidor, `make knowledge-flow-install` de nuevo. `make knowledge-flow-status` · `make knowledge-flow-uninstall`. Su
salida: `~/Library/Logs/my-tools-knowledge.log`. Necesita la sesión de `playground login` (el modelo), `gh` con sesión
(los PRs del paso 3) y la VPN de dev no hace falta.

## Cómo está construido

| pieza | dónde |
|---|---|
| el vigía, la cola, la API y el LaunchAgent | `server/main.go` |
| una corrida y sus pasos, guardados | `server/run.go` |
| los pasos de comando (drift.py, aplicar, comprobar, commitear) | `server/steps.go` |
| los pasos con modelo y la verificación | `server/model.go` |
| la consola (`bin/knowledge`) | `server/cli.go` |
| la interfaz | `src/App.vue`, con la base de `tools/ui` (`make style-sync`) |
