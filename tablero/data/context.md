---
id: 89
title: "Context"
clase: proyecto
stage: work
created: "2026-09-19T08:00:00-05:00"
context_nodes: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local de `context`. Los 39 nodos fueron re-verificados contra `main`; 38 están
sellados y `findings` permanece deliberadamente sin sello porque una validación parcial no debe
presentarse como revisión completa.

El laboratorio de Jev propone qué nodo leer mediante una preselección local y una decisión tipada.
Está apagado por defecto, guarda reportes fuera del corpus y conserva el mapa completo como
recuperación. La integración opcional de workers solo se usa con preguntas generales sin datos
personales. `brief --text` imprime la ficha en texto; es lo que consume `make retomar BRIEF=1` del
tablero, donde Jev no rutea nada porque la tarea ya declara sus nodos.

Tablero mantiene una consola inferior de ramas para la tarea enfocada. Su sidebar derecho enumera
sólo los repos asociados a las ramas de esa tarea y la tabla muestra rama, PR, ambientes y commit.
Esta tarea tiene la ruta estable `#/tareas/context`; al recargar vuelve a abrirla. El inventario
completo de repos permanece en la UI propia de Context; ambas lecturas salen de Git local y nunca
hacen `fetch` al renderizar.

**El próximo paso es:** etiquetar qué nodo ayudó en consultas generales reales, comparar el recorrido
completo cuando vuelva a existir una credencial válida para el LLM generativo y decidir si
`findings` se revisa y sella por tandas explícitas.

## Frentes activos

- **Vigencia:** repetir alineación y referencias después de cambios relevantes en los repos. Al
  re-verificar, `make context-diff NODE=x CITAS=1` antes de leer el diff; medir cuántas veces evitó
  leerlo entero.
- **Clasificar la deriva:** la parte determinista ya está (`CITAS=1`) y dónde anotarla también
  (`context-triar`). Lo que falta antes de pensar en un modelo es la vara: un banco de cambios
  pasados etiquetado desde el historial — y triar a mano ya lo va llenando, porque cada veredicto
  escrito es una etiqueta real.
- **Ramas:** usar la consola en el trabajo diario y ajustar la clasificación si aparece un estado que
  la comparación actual no distingue.
- **Jev:** comparar calidad, abstenciones, latencia y superficie enviada al modelo generativo.
- **Findings:** mantener visible qué parte fue comprobada sin declarar revisado el nodo entero. El
  índice ya no se puede quedar atrás sin que el lint lo diga (`L9`).

## Cómo se comprueba

`make context-lint`, `make context-ramas`, `make context-ramas-test`, `make context-jev-test`,
`make context-jev ARGS='bench'`, `make estilo-ui` y las herramientas de alineación y referencias. Una
corrida Jev no verifica conocimiento ni renueva sellos.

## Registro

### 2026-09-21

`context-diff` suma `CITAS=1`: antes del diff cruza los rangos del cambio contra los números de las
citas `archivo:línea` del doc y dice si el cambio tocó lo que el nodo afirma. Es la parte
determinista de clasificar la deriva —la que no necesita modelo—: el diff de `trazador` son 112.358
caracteres y el mapa veinte líneas. Distingue tres casos que costaron un diagnóstico equivocado cada
uno mientras se escribía: el lado viejo del hunk, la inserción pura (no reescribe nada citado) y la
cita escrita después del sello (no comparable). Las tres piezas quedaron puras y con prueba
(`make context-diff-test`), verificadas mutando el código: las cuatro mutaciones caen.

La comparación es **siempre contra `main`**, nunca contra la rama en la que esté parado el clon:
medido el 2026-09-21, tres de los repos estaban en `fix/…`, `qa` y `develop`, y los tres se
compararon igual contra `origin/main`. Lo resuelve la pieza compartida, y el diff va entre dos
commits, así que el working tree tampoco entra. Ahora además se imprime contra qué ref se comparó y
por qué —«el local va 20 detrás»—, que faltaba: un resultado que no dice de qué ref salió no se
puede contrastar con nada.

Y quedó la pieza donde eso se anota: `make context-triar NODE=x VEREDICTO='…'` escribe un campo
`triado` (hasta qué commit se miró, quién lo dijo, con qué veredicto) **sin tocar `verified`**, se
niega si alguna cita cayó dentro del cambio, y `alinear.py` lo descuenta mostrándolo como 👁 «triado,
sin sellar» — un estado propio, no «al día». Hoy sólo se escribe a mano; `source` está listo para
otra procedencia. Lo reversible es el punto: si mañana la fuente resulta mala, se borran los `triado`
y no se perdió nada, porque el sello nunca se movió.

Lo que sigue, si se quiere clasificar el resto: un banco con etiquetas REALES sale del historial
—`git log` de cada `doc.md` dice cuándo se editó el nodo, cruzado con los commits de sus archivos—,
y recién con esa vara se puede medir si un clasificador acierta. ⚠ Y el error es asimétrico: un falso
«sólo refactor» es invisible y permanente, un falso «mirá esto» cuesta una lectura. Los umbrales
tendrían que ser asimétricos, y eso va en código.

`lint.py` suma `L9`: cruza cada `## Índice` de `findings` contra sus anclas `### F-xx`, en los dos
sentidos. Encontró **9 hallazgos de 239 fuera del índice de síntomas** —F-175…F-182 y F-184, los
últimos agregados— que para quien entra por la puerta declarada no existían. Se escribieron sus nueve
filas y el nodo quedó en verde. Probado al revés: quitar una fila, citar un `F-999` inexistente y
agregar un hallazgo sin indexarlo salen ✗ con exit 1. El síntoma lo sigue escribiendo una persona; lo
que la máquina garantiza es que no falte.

`brief` acepta `--text`: la misma ficha sin `kind`, `version` ni `source_sha256`, para una terminal o
una sesión; la consola sigue consumiendo el JSON. Lo consume `make retomar BRIEF=1` del tablero. Y
quedó escrito dónde Jev NO entra: al retomar una tarea que ya declara nodos, `route` sólo agrega un
modo de error; el ahorro es la ficha, y si no contesta, la pregunta va a `workers/`.

### 2026-09-19

Se absorbió `context-arbol-al-dia`. El router Jev quedó optativo y medido; el estado vigente se redujo
a esta tarea canónica y el detalle anterior permanece en Git.

La vista de Context incorporó una consola redimensionable para recorrer el inventario completo sin
salir del mapa. Tablero usa otro corte: su panel inferior agrupa únicamente las ramas medidas de la
tarea enfocada, con tabla principal y selector de sus repos a la derecha. Se puede redimensionar y
cerrar, y el pie mantiene visible cómo recuperarlo. Las tareas recibieron rutas restaurables para
sobrevivir a una recarga.
