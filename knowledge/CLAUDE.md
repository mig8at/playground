# Contrato del conocimiento local

Guardá sólo explicaciones reutilizables que ahorren investigar y tengan un alcance claro. Cada tema
usa un nombre en inglés con minúsculas y guiones, `rules.md` y `sources.json`. Prosa en español.
No reconstruyas el antiguo servicio context/ ni importes el corpus productivo completo.

## El índice: `CREDITOP.md`

[`../CREDITOP.md`](../CREDITOP.md) ordena los temas por paso del recorrido de una solicitud y por entidad, con el
`tema#ancla` que contesta cada pregunta. Un tema nuevo, renombrado o con una sección nueva que alguien vaya a buscar
se suma ahí en el mismo commit. `make knowledge-index` comprueba que cada enlace exista y lista los temas que no nombra.

## Revisar y escribir

1. Leé el código real contra `main` en los **clones sólo-main** (`main_clones` en `tools/repos.json`,
   `~/Desktop/CREDITOP/main-clones/<repo>`): sólo siguen main, así que se les hace fetch (`make knowledge-check FETCH=1`)
   sin tocar las ramas ni los stashes de los clones de trabajo de `github/`, que usan otras sesiones. Desde el
   2026-11-17 `knowledge-check`, `knowledge-touch`, `knowledge-deriva` y los comandos de código de Wally leen de ahí
   (`MainRoot`, `connectors/repos`); un repo sin clon ahí cae a su clon de trabajo. Si una regla cruza ambos
   monolitos, revisá ambos y distinguí sus entradas.
2. Escribí el mecanismo, las condiciones y sus límites. Cada `##` genera un ancla; no repitas títulos.
   El `#` inicial debe coincidir con `title` de los metadatos.
3. Registrá `version: 1`, `title`, `summary`, `reviewedAt` en RFC3339, y `sources`: cada fuente lleva
   `repo` (alias de tools/repos.json), `path` relativa al repo, `commit` y `blob` completos, y `sections`
   (anclas de los encabezados que respalda). Toda sección necesita fuentes. Obtener un hash no sustituye
   haber leído el archivo y comprobado la afirmación.
4. Corré `make knowledge-check`. Si cambia una fuente, releé el diff y la sección antes de actualizar
   el commit y el blob. No selles automáticamente una explicación porque el archivo siga existiendo.

Las refs locales pueden estar atrasadas. Usá la ref y fecha visibles en la comprobación como límite;
si la tarea exige verificar el remoto, actualizá el clon por el procedimiento normal y repetí el chequeo.

## Quién la mantiene al día

**Knowledge** (`knowledge-flow/`, la app de Cockpit) mira main cada 30 minutos y, cuando una fuente cambia, corre solo
el método de `tools/knowledge-drift` (triaje, código, segunda mirada, verificación), aplica y commitea. Un commit
«knowledge: puesto al día contra main (corrida #N de Knowledge)» es suyo. Si frena, espera a que se mire su corrida.

## Las trampas del sistema (`traps/`)

`traps/traps.md` es el registro vivo de las trampas (`F-xx`): un síntoma que ya costó tiempo, con su causa raíz
verificada, su evidencia y su arreglo. `traps/closed.md` guarda las crónicas de las cerradas. Vivían en el tablero
(`tablero/data/traps/`) hasta el 2026-11-18. **No es un tema**: no lleva `rules.md` ni `sources.json`, y la
biblioteca la salta. Se entra por el índice de síntomas, nunca leyendo el archivo entero.

- Una trampa nueva va al final, con su `### F-xx · título`, y su síntoma entra al índice. `make traps` falla si una
  queda fuera del índice o si una cita `archivo:línea` se corrió en `main` (`INDEX=1`, sólo el índice).
- Un tema y una trampa no se repiten: el tema explica el mecanismo vigente; la trampa, el síntoma que confunde y
  cómo se llegó a la causa. Si una trampa describe una regla que sigue en `main`, el tema la explica y la trampa
  lo enlaza.
- Las tareas citan una trampa por su número (`F-53`); `make agent` muestra las que pueden tocar la tarea.

## Separar el mecanismo de la evidencia de un caso

Las hipótesis, los PR sin mergear y las decisiones de una tarea viven en su documento o pila, con ese
estado explícito. Datos personales, secretos y volcados de producción no entran a esta biblioteca.
Los resultados del harness y las mediciones de los conectores siguen siendo evidencia del ambiente medido.

Para políticas o conocimiento de negocio/producto sin comprobación local, Confluence o documentos del equipo
son fuentes opcionales: citá cuál usaste y qué no verificaste. No conviertas una explicación documental
en hecho técnico sin contrastarla. Si hace falta guardar ese contexto, distinguí su fuente documental
del mecanismo respaldado por código; el lector actual exige fuentes Git para los temas técnicos.

## La búsqueda: por significado y por palabras (`make knowledge-search Q='…'`)

Desde el 2026-11-19 `knowledge search` busca por **significado**: cada sección se convierte en un vector con
Qwen3-Embedding-0.6B (en la Mac, en un llama-server propio en :5250 que se levanta con la primera búsqueda y se apaga
solo a los 15 minutos sin uso, `lib/llamaserve`) y la pregunta se compara contra todas. El índice vive en
`~/.cache/my-tools/knowledge-embed/index.json` y sólo recalcula las secciones que cambiaron. El modelo sale del registro
(`models/registry.json`, el uso de «knowledge»).

- **Una pregunta en lenguaje natural manda el significado; una que trae algo que parece código** (un nombre con guion
  bajo o camelCase, una ruta, `F-53`, algo entre comillas invertidas) **mezcla palabras y significado a la par**
  (`looksLikeCode`, `cmd/knowledge/semantic.go`). Medido el 2026-11-19 (los aciertos son el tema esperado entre los 3
  primeros): en 37 títulos de tareas que declaran `knowledge:`, por palabras 16, por significado 24 y así 23; en 20
  preguntas escritas a mano, 4, 19 y 19; en 30 identificadores exactos, 30, 12 y 30. Mezclar a la par siempre empeoraba
  las preguntas: las palabras comunes («cliente», «ecommerce») suben temas genéricos.
- **Cuánto tarda:** ~0,34 s por búsqueda con el servidor arriba; la primera de todas, ~30 s (levanta el servidor y arma
  el índice de ~340 secciones). Si el modelo no está o no contesta, busca sólo por palabras y lo dice en stderr.
- `--words` busca sólo por palabras; `--meaning`, sólo por significado; `-v` dice cómo buscó y cuánto tardó.
- El silencio sigue sin probar nada: el significado acerca el tema, no verifica el mecanismo.

## Uso y cierre

`make resume` y `make agent` sugieren solos las secciones que respaldan los archivos de las ramas de
la tarea y que su `knowledge:` no declara (el índice al revés de las fuentes, `touch.go`: sin red ni
modelo, primero las más específicas). `make knowledge-touch F='repo:a..b'` contesta lo mismo para un
rango de main: qué secciones releer después de un merge. La sugerencia es una pista: una sección entra
a `knowledge:` cuando se leyó y sirve.

Agregá `knowledge: [topic]` o `knowledge: [topic#ancla]` a las tareas que lo necesiten. Citá el archivo
en los bloques con `[texto](repo:my-tools/knowledge/topic/rules.md#L1)` para fijarlo a su commit.
Un tema ausente o que excede el presupuesto se avisa; no se reemplaza por una búsqueda parecida.
Los contratos de una herramienta se mantienen junto a ella, en su CLAUDE.md.

Canon es el conocimiento compartido del EQUIPO y no es de my-tools: se consulta y se mantiene en el repo
compartido (`playground canon search|read`; su puesta al día, en `tools/canon/recontext` de ese repo). No
se sincroniza hacia knowledge/ ni al revés: son dos bibliotecas separadas, cada una con su método. Esta biblioteca depende de archivos locales y fuentes comprobables.

## Adaptar lo que aparece en el tablero

Trabajá por pregunta y mecanismo reutilizable, no por cantidad de tareas o tamaño del corpus.
Leé el documento y la pila para encontrar la evidencia; después contrastá la explicación con el
código de la ref local de `main`. Un título de tarea, una casilla cerrada o una publicación en
Canon no sustituyen esa comprobación. Conservá la diferencia entre código disponible, despliegue
y comportamiento medido. Si el documento viejo contradice el código, aclaralo sin reescribir
los bloques históricos.

Reutilizá el tema existente y enlazá sólo el alcance que ayuda a retomar. No conviertas casos
individuales, porcentajes medidos en producción o secretos de ambiente en reglas generales.
Los pendientes de producto y los cambios que todavía no están en `main` permanecen en la tarea.
Actualizar una tarea publicada no implica reescribir su sección pública durante este barrido.
