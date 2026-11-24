# knowledge-drift — poner `knowledge/` al día contra main

**Lo corre solo Knowledge** (`knowledge-flow/`, desde el 2026-11-18): mira main cada 30 minutos y, cuando una fuente
cambia, hace estos pasos con el modelo de segundo plano, verifica, aplica y commitea. A mano sigue sirviendo igual.

`make knowledge-drift STEP=paquete|codigo|final|aplicar` (`drift.py`). knowledge/ es la biblioteca local del día a
día. Sus fuentes guardan el commit exacto, así que no hay que buscar el blob en la historia. El método avanza **de lo
barato a lo caro**: el modelo lee código sólo donde la prosa probablemente quedó mal.

| paso | quién | qué |
|---|---|---|
| `paquete` | comando | fetch de los clones de `main_clones` (`tools/repos.json`; `--no-fetch` si ya lo hizo quien llama), `knowledge-check`, fuentes cambiadas o perdidas → el diff neto de cada archivo y las secciones; y los paquetes del triaje |
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
| armar los paquetes | `drift.py paquete --no-fetch`: el diff NETO de cada archivo, del commit revisado a main | segundos |
| qué PRs entraron en ese tiempo | del git local: cada «Merge pull request #N from org/rama» entre el commit revisado y main cuyo merge cambió el archivo, sin las ramas de sincronización (qa, develop, lab, `merge/…`, `chore/merge…`) | local |
| la descripción de esos PRs | `gh api`, sólo las que no están en `~/.cache/my-tools/knowledge-drift-prs.json` (un PR mergeado no cambia), 8 en paralelo | 53 s la primera vez con 85 PRs; 16 s todo el paso con caché (antes 7 min) |

- **Lo que se compara es el cambio NETO, no la historia** (Miguel, 2026-11-24): el archivo en el commit con que se
  escribió la sección contra el archivo en main. Si varios PRs encadenados tocaron lo mismo, el diff ya trae sólo el
  resultado final, que es lo que importa. El triaje leía antes las descripciones de los PRs para decidir sin mirar
  código, y buscarlas costaba una llamada a GitHub por commit. Ahora el triaje recibe la prosa, el diff neto (hasta 8
  mil caracteres por archivo; más es «CAMBIO GRANDE» y va al paso de código, que lee el archivo entero en main) y, como
  CONTEXTO, la línea de tiempo de los PRs que entraron en ese tiempo (fecha, rama, título y descripción hasta 2 mil
  caracteres): qué se quiso hacer, no qué decidir. Si un PR dice algo que el diff no muestra, manda el diff.
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
