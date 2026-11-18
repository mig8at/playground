# knowledge-drift — poner `knowledge/` al día contra main

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

Después van `make knowledge-check` y `make knowledge-test`. **La verificación independiente de los textos reescritos
es obligatoria**: en la corrida del 2026-11-10 encontró 6 contradicciones y unos 30 matices en 63 secciones.

- ⚠ `paquete` hace fetch de TODOS los clones antes de medir: `knowledge-check` no hace fetch, y un repo vecino
  atrasado 18 días hizo que un agente afirmara que una ruta no existía.
- Los prompts nombran clases, métodos y tablas: es el estilo de knowledge.
- Las corridas quedan fuera de git, en `KNOWLEDGE_DRIFT_DIR` (por defecto `tools/knowledge-drift/.runs/`).
- Nació junto al método que pone al día canon; ése vive desde el 2026-11-18 en el repo compartido
  (`tools/canon/recontext`), y acá no queda nada de canon.
