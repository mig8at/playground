# knowledge-drift — poner `knowledge/` al día contra main

**Lo corre solo Knowledge** (`knowledge-flow/`, desde el 2026-11-18): mira main cada 30 minutos y, cuando una fuente
cambia, hace estos pasos con el modelo de segundo plano, verifica, aplica y commitea. A mano sigue sirviendo igual.

`make knowledge-drift STEP=paquete|codigo|final|aplicar` (`drift.py`). knowledge/ es la biblioteca local del día a
día. Sus fuentes guardan el commit exacto, así que no hay que buscar el blob en la historia. El método avanza **de lo
barato a lo caro**: el modelo lee código sólo donde la prosa probablemente quedó mal.

| paso | quién | qué |
|---|---|---|
| `paquete` | comando | fetch de los clones de `main_clones` (`tools/repos.json`), `knowledge-check`, fuentes cambiadas o perdidas → diffs, PRs y secciones; y los paquetes del triaje **sin código** |
| triaje | agentes | un agente por paquete con `prompts/triage.md` → `triaje/resultado-N.json` |
| `codigo` | comando + agentes | paquetes de lo que el triaje no descartó, con el diff bajo demanda, y la segunda mirada a ciegas sobre lo descartado (`prompts/code.md`, `prompts/second-look.md`) |
| `final` | comando | junta código, segunda mirada y `overrides.json`: las correcciones a mano, que mandan |
| `aplicar` | comando | escribe `rules.md` y `sources.json` (commit y blob al día, sigue los renombres; `reemplazos.json` para un archivo borrado que otro reemplazó) |

## ⚠ Local primero: medir knowledge son segundos, no minutos

Decisión de Miguel (2026-11-24), cuando una mirada tardaba 10 minutos consultando cosa por cosa lo que un `git fetch`
ya había traído. **La regla: se trae main UNA vez y todo lo demás sale del git local. A la red sólo va lo que git no
tiene, de a montones y con caché.**

| qué | cómo | tarda |
|---|---|---|
| traer main | `cmd/knowledge fetch`: UN fetch por clon sólo-main, que baja también el contenido (son parciales, `blob:none`). Lo hace la mirada; `drift.py paquete` lo repite sólo a mano (Knowledge le pasa `--no-fetch`) | ~1–4 min, 25 repos |
| qué fuente cambió | `knowledge check`: UN `git ls-tree -r` por repo y commit, nunca un proceso por fuente | 2 s (antes 6,5 min: 4 gits por fuente y `cat-file` que bajaba cada archivo) |
| diffs, commits, renombres | `git diff` / `git log` en el clon | local |
| de qué PR viene cada commit | GraphQL, 100 commits por consulta, en `~/.cache/my-tools/knowledge-drift-commit-prs.json` (un commit no cambia de PR) | segundos (antes una llamada a la API por commit: cientos) |
| título y descripción del PR | `gh api`, sólo los que no están en `~/.cache/my-tools/knowledge-drift-prs.json` (un PR mergeado no cambia) | segundos |

- **Git solo no sabe de qué PR viene un commit**: estos repos mezclan main en las ramas, y el merge más viejo que
  contiene al commit puede ser de otro PR (642 de 808 no coincidían con GitHub). Por eso eso va a GitHub, en lote.
- **Antes de sumar una consulta por ítem** (por fuente, por commit, por archivo), pensá cómo sale de UNA lectura local
  o de un lote. Un paso nuevo que tarde minutos con 500 fuentes está mal armado.
- **SSH puede no entrar** (2026-11-24: entraba una llave personal sin acceso a la org y el fetch fallaba con «Repository
  not found» mientras `check` decía «al día» leyendo main viejo). Los clones sólo-main van por HTTPS con la sesión de
  `gh` (config local de cada clon: `url.https://github.com/Creditop-SAS/.insteadOf` y `credential.helper` de `gh`), y
  `cmd/knowledge fetch` reintenta así si un clon nuevo no lo tiene. Un fetch que falla corta la corrida: nunca se mide
  contra main viejo.

Después van `make knowledge-check` y `make knowledge-test`. **La verificación independiente de los textos reescritos
es obligatoria**: en la corrida del 2026-11-10 encontró 6 contradicciones y unos 30 matices en 63 secciones.

- ⚠ `paquete` hace fetch de TODOS los clones antes de medir: `knowledge-check` no hace fetch, y un repo vecino
  atrasado 18 días hizo que un agente afirmara que una ruta no existía.
- Los prompts nombran clases, métodos y tablas: es el estilo de knowledge.
- Las corridas quedan fuera de git, en `KNOWLEDGE_DRIFT_DIR` (por defecto `tools/knowledge-drift/.runs/`).
- Nació junto al método que pone al día canon; ése vive desde el 2026-11-18 en el repo compartido
  (`tools/canon/recontext`), y acá no queda nada de canon.
