# canon-deriva — poner canon al día contra main

`make canon-deriva PASO=…` (`deriva.py`). El método se probó el 2026-11-10 contra una pasada única de 1M sobre
la misma deriva: tardó lo mismo en reloj y encontró 76 secciones a corregir contra 34. Tiene que avanzar **de
lo barato a lo caro**: el modelo lee código sólo donde la prosa probablemente quedó mal. El registro completo
de esa corrida está en la tarea **#74** del tablero.

Trabaja fuera de git, en `CANON_DERIVA_DIR` (por defecto `~/Desktop/CREDITOP/canon`): los clones en `repos/`,
compartidos entre corridas, y cada corrida en `runs/<fecha>/`. `runs/ACTUAL` apunta a la última; `RUN=<carpeta>`
elige otra.

## El recorrido

| paso | quién | qué |
|---|---|---|
| `foto` | comando | fetch de los clones (clona los que falten, en su rama: mobile en `main-pro`), `canon round -force` y `canon export`, en el mismo minuto. Avisa si un clon no coincide con el del servidor |
| `paquete` | comando | ronda → archivos → diffs → PRs (por la API, commit → PR) → secciones, y la higiene del mapa. Sin modelo. Avisa de los archivos que main **movió o borró** |
| `triaje` | comando + agentes | paquetes de prosa + PRs + tamaño de cada diff, **sin código**. Un agente por paquete con `prompts/triaje.md` → `triaje/resultado-N.json` |
| `codigo` | comando + agentes | paquetes de lo que el triaje no descartó, con el diff **bajo demanda**, más los de la **segunda mirada a ciegas** sobre lo descartado. `prompts/codigo.md` y `prompts/segunda.md` |
| `final` | comando | junta código, segunda mirada y `overrides.json`: las correcciones a mano, que mandan sobre todo |
| `piezas` | comando | arma el lote para `canon-write` con los chequeos del lint de antemano. Deja aparte los títulos y objetivos de área |
| ensayo y escritura | persona | `CANON_TIMEOUT=…m make canon-write DRY=1 PIECE="$(cat …/LOTE.txt)"`. Después, sin `DRY`, **con el OK de Miguel** |
| `movidos` | comando | reapunta en un export fresco los archivos que main movió. `canon-patch`; con `APPLY=1` publica |
| validación | persona | `make canon-round FORCE=1` en cero, `make canon-search` de cada sección tocada y `make canon-eval` |

Para lanzar un agente, reemplazá `{paquete}` y `{salida}` en el prompt. Ningún paso de modelo escribe en canon:
escribir es `canon-write` sin `DRY` o `APPLY=1`, y lo decide Miguel.

## Lo que ya costó, y dónde quedó cableado

- **Una entrada de la ronda sin hash nuevo es un archivo movido o borrado**, no ruido. Exigir hash a los dos
  lados las descartaba en silencio: 13 se perdieron así. Está en `parse_ronda`, con prueba. `paquete` las
  lista con su destino y `movidos` las reapunta: un `verificado` no reapunta nada.
- **La clase del tema sale de su archivo** (`context.md` u `operar.md`): `operar` tiene otro techo por sección
  (500) y otra forma de nodo (`tema/operar`). Los techos se leen de `policy.go` del repo compartido.
- **El ancla es la de `AnchorOf` de canon** (a-z0-9; el resto colapsa en un guion). Una regla propia inventó
  11 «secciones inexistentes», y una pasada de modelo reportó una de ellas como hallazgo.
- **El repo va por el alias del tema**, el corto si existe. Con el nombre de la carpeta, el `verificado` lo
  rechaza.
- **El recorte de las descripciones de PR no puede ser fijo y corto**: con 2500 caracteres, 41 de 60 ítems
  quedaron en «no se sabe» por un solo PR largo. Hoy el tope es 12.000.
- **Un archivo hub no une paquetes**: agrupar por archivo compartido juntó 172 de 205 ítems en un solo
  paquete. Un archivo que comparten más de `HUB` ítems repite su diff.
- **El paquete de código no lleva el código**: el agente abre el diff del clon cuando lo necesita. Con diffs
  y PRs enteros, cada paquete pesaba unos 200 mil tokens; sin ellos, unos 20 mil.
- **Los límites de canon van en el prompt, no se descubren en el ensayo**: sección ≤ 600/500 palabras,
  enlaces `[[tema/clase#ancla]]`, sin nombres de módulo en `context`, sin fechas ni crónica. `piezas` avisa
  igual. Una sección nueva sin `archivos` envejece sin vigilancia: también avisa.
- **En el lote van primero las adiciones**: una corrección que enlaza a su otra mitad falla si esa mitad
  todavía no existe.
- **La segunda mirada a ciegas atrapa al triaje, pero no es infalible**: atrapó los 3 errores del triaje y
  dejó pasar uno, que se resolvió leyendo el código a mano. Un desacuerdo entre pasadas se resuelve en
  `overrides.json`, con evidencia.
- **El `verificado` del servidor re-sella por ruta sin mirar el repo.** Con la misma ruta declarada en dos
  monolitos, pisa el hash del otro. Hasta que se arregle en canon, después de escribir mirá la ronda: un
  archivo que aparece invertido es esto.

`python3 -m unittest tools/canon-deriva/test_deriva.py` prueba las trampas que se pueden probar sin red.
