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

⚠ **Esta tarea ahora tiene fecha de vencimiento: `context/` se apaga por graduación a canon.** El
árbol es la sala de espera; cada nodo que se toca, gradúa y se borra. Ver el Registro del
2026-09-21 para lo medido y el piloto. Lo que NO migra es `findings`.

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

**El próximo paso es:** terminar de vaciar `creditopx` —le quedan «Dónde se SACA una entidad del
listado» y el bloque de «Antes de concluir», que hay que comparar contra canon antes de decidir si
gradúan o son inventario— y después seguir con los 6 duplicados restantes, al mismo commit.
⚠ El PR sigue **sin pushear**: son 8 reglas en 3 temas, y a partir de acá cada tema que se sume lo
hace más difícil de revisar. Conviene abrirlo pronto.

## Frentes activos

- **Vigencia:** repetir alineación y referencias después de cambios relevantes en los repos. Al
  re-verificar, `make context-diff NODE=x CITAS=1` antes de leer el diff; medir cuántas veces evitó
  leerlo entero.
- **Citas dentro de los `CLAUDE.md`:** al mover las secciones, sus `archivo:línea` salieron del
  alcance de `refs.py`, que sólo mira el árbol. Hoy nadie avisa si una se corre. Es el precio del
  retiro y conviene cerrarlo.
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

### 2026-09-21 · el plan: context se apaga por graduación a canon

**Un PR, un commit: `canon/graduar-desde-context`.** Se aplastaron los cinco commits en uno solo
con todo el detalle en la descripción, y desde ahí cada tema nuevo se enmienda ahí mismo. La rama se
renombró porque el alcance dejó de ser un tema. **Ocho reglas, canon en 403 secciones.**

**`creditopx`: dos piezas graduadas** — el cupo con aprobación manual (con su lección de
idempotencia: decidir con el flag y escribir «si el estado no es éste, ponelo» no es idempotencia,
es pisar cualquier estado que no sea el destino) y el permiso de pre-aprobados, que deja la regla
general de que **«no aplica» y «se rompió» no pueden verse igual**. Y otra vez apareció lo mismo:
tres de sus reglas **ya estaban en canon** —el bloqueo por crédito activo, el ingreso que no decide
el listado, el motor propio del rotativo— y una cuarta apareció al verificar y acá no estaba: la
aprobación manual se evalúa antes que el codeudor.

**`backoffice` GRADUADO Y BORRADO — el ciclo cierra.** El árbol pasó de 37 a **36 nodos**; canon
pasó de 395 a **401 secciones**. Seis piezas en un PR (`canon/backoffice-readiness`, cinco commits,
sin pushear): los cinco chequeos de «listo para operar», el motivo redactado del perfilamiento, el
orden de montaje con su rastro de sólo escritura, la zona horaria de la base, los dos paneles con la
trampa de despliegue, y el pool de Cognito con sus dos límites de intentos.

⚠ **Tres cosas que sólo aparecen al graduar, y que ninguna herramienta habría dicho:**
- **Lo que NO se lleva.** De los 81 términos del nodo quedaron 40 sin cubrir, y son **inventario**
  —rutas del front, nombres de paquetes, endpoints—: canon pide reglas, no catálogos. Borrarlos es
  la decisión, no una pérdida.
- **Lo que ya estaba, y mejor.** El 409 por versión y la regla de los clones no se tocaron. Y el
  dato de que el panel se despliega desde `lab` **ya estaba en el nodo `microservicios`**: estaba
  disperso en context, no sólo duplicado con canon.
- **Lo que estaba MAL.** El nodo afirmaba que no había workflow de dev para esta app; sí lo hay,
  dispara desde `lab`. Verificar contra `main` antes de dictar lo atrapó.

**Queda sin casa** lo que el nodo declaraba como no verificado, y no gradúa porque canon no admite
lo que no está comprobado: qué ve cada rol dentro del panel (el guard es uno solo, no se comprobó si
hay alcance por rol), y si los dos paneles conviven hoy en producción y bajo qué criterio se manda
gente a uno o al otro. Son preguntas, y su lugar es una tarea cuando alguien las tome.

**Antes:** `backoffice` casi vaciado: cuatro piezas graduadas en un solo PR. En la rama
`canon/backoffice-readiness` (desde `main`, tres commits, sin pushear): los cinco chequeos de «listo
para operar», el motivo redactado del perfilamiento, el orden de montaje con su rastro de sólo
escritura, y —la que más vale— **los timestamps de la base están en hora Colombia, no en UTC**, que
salió del docblock de un middleware y es regla de PLATAFORMA: canon tenía la mitad (`bancolombia`
dice que la app declara UTC) y sin la otra mitad esas dos verdades juntas son justo lo que produce
el error de cinco horas. Esa fue a `datos/context`, no a `backoffice`: gradúa al tema donde alguien
la buscaría, no al nodo de donde salió. `-lint` en verde, 398 secciones.

Del nodo quedan «Qué es» y «Contenido» (la arquitectura del panel nuevo y su autenticación), que es
lo que falta para poder borrarlo.

Dos cosas que el dictado rechazó y valen como formato: **no se describe un endpoint por su llamada**
(«GET /…»), sino la operación; y `section` es el **título legible**, que el ancla la deriva canon.

**Primera graduación hecha, de punta a punta.** `LenderReadinessService` ya vive en canon
(`backoffice/context` § «Listo para operar son cinco chequeos, y dos no bloquean a propósito»),
dictado por su API: la pieza pasó el ensayo con `ready: true`, el área nació con su objetivo, sus
tablas y el hash resuelto solo, y `-lint` quedó en verde (33 nodos · 395 secciones). El commit está
en la rama `canon/backoffice-readiness` del repo compartido, sacada de `main`; el push y el PR los
decide Miguel. De este lado el sub-bloque se reemplazó por su puntero, que es lo que significa
graduar.

Lo que enseñó el piloto, y vale para las próximas:
- **`section` es el TÍTULO legible, no el slug.** Mandarlo como slug deja un `## ` feo en el
  documento; el ancla la deriva canon sola. Costó una corrida y un revert.
- **Sin `objetivo` y `se_deduce_leyendo`, el área nace con un eco del título** que compite en la
  búsqueda con los objetivos de verdad. Canon lo avisa al entrar la pieza y hay que reenviarla.
- **Verificar contra `main` antes de dictar no es ceremonia:** apareció que este nodo numeraba mal
  dos de los cinco chequeos.

**La decisión (Miguel):** no mantener dos contextos. `canon` es lo que está en `main` y se comparte
con el equipo; el tablero es lo que está en progreso; `context/` pasa a ser **la sala de espera de
canon** y se apaga a medida que sus nodos graduan. Nada de migración de golpe.

Lo medido antes de decidirlo: **no son una copia**. 37 nodos contra 33 temas, **8 en común**, y en
esos ocho entre el **49 % y el 84 %** de los términos de context no están en canon — graduar es
migrar contenido real, no borrar repetido. Son dos cortes distintos: canon por tema de negocio,
context por pieza del sistema. `findings` (497 KB, 239 hallazgos) **no migra**: canon rechaza la
crónica por regla escrita («no agregues un relato de quién lo descubrió… ni resultados de
experimentos»), y eso es justo lo que lo hace consultable por el equipo.

**Piloto corrido (`backoffice`, el más acotado):** de cuatro piezas candidatas, **dos ya estaban en
canon y mejor escritas** —la regla de los clones por sucursal explica allá el hueco del admin viejo,
que acá no está—. Lo que falta de verdad es `LenderReadinessService`: **no aparece en ningún tema**,
y sus dos tablas de bitácora están en el diccionario sin prosa que diga qué significan. Se verificó
contra `origin/main` (los cinco chequeos, `blocking: false` en política dura y `applicable: false`
en pagos con cobranza externa) y el aporte pasó el ensayo de canon: `ready: true`, sin rechazos.
⚠ Corrección al pasar: en el código el orden es identidad · validación · pagos · **política** ·
**perfiles**; este nodo los numeraba al revés en los dos últimos.

**Dos defectos de canon encontrados corriéndolo en local**, los dos reportados y sin tocar:
`content/.rino` (config de otra herramienta, en el gitignore GLOBAL) hace que canon descarte el
corpus de disco y use el embebido —hoy coinciden, así que no mintió, pero el día que se edite
`content/` en local la ronda no verá los cambios—, y `/api/propose` **entra en panic** con un `node`
inexistente (`server.go:1621` dereferencia la política sin comprobar). ⚠ Y revienta justo cuando el
aporte está BIEN formado: con uno incompleto contesta, porque el panic está dentro de `if listo`.

### 2026-09-21

La viz perdió la consola de Jev y el ruteo en vivo del buscador, y ganó la pregunta que sí se usa:
**«¿el cambio tocó lo que este nodo AFIRMA?»**, dentro del bloque de alineación y sólo en un nodo con
deriva. Corre `tools/diff.py --json` por un endpoint local —git y aritmética, sin modelo ni red— y
ofrece las dos salidas: leer y corregir, o el comando para triar. La viz sigue siendo de sólo
lectura: escribir es una afirmación de una persona.

Al verificarlo en el navegador aparecieron **dos fallos de contraste preexistentes**, los dos del
tipo que el chequeo estático no ve: el contador del encabezado del árbol heredaba la tinta gris del
`region-head` sobre el relleno de su badge (**1,21:1**) y el badge de deriva pintaba el color del
estado sobre ese mismo relleno (**2,29:1**). El segundo llevaba oculto porque sólo se pinta cuando
hay deriva, y ese día no había ninguno. Los dos arreglados con la regla de las píldoras: una
superficie trae su propia tinta, y el que dice su estado con color va de contorno.

**Los nodos `harness` y `trazador` se retiraron del árbol.** El árbol describe CreditOp; cómo se usa
una herramienta de acá vive en su `CLAUDE.md`, al lado del código y commiteado con él. Sus secciones
operativas se movieron **tal cual** (13 KB al del trazador, 10 KB al del arnés) y el dominio a su
casa: la fila rt=0 corregida en `entities` —verificada contra `main`— y el censo de las 14 tablas de
log a `db-routines`. El árbol quedó en 37 nodos, con lint, oracle, refs y check en verde.

⚠ Tres cosas que aparecieron al hacerlo, y que valen más que el retiro: la copia de la tabla de
`response_type` **ya contradecía** a `entities` en rt=0; los **tres** hallazgos que habían graduado a
un nodo de herramienta estaban incompletos (F-108 a medias —su medición nunca llegó a `db-routines`,
se rescató— y F-32/F-36 nunca llegaron, aunque su hecho ya vivía en `smartpay` y `deceval`, adonde
ahora apuntan); y del nodo `harness` había 61 términos, y del de `trazador` 96, que no estaban en el
`CLAUDE.md` de su herramienta.

Antes de eso, las herramientas de este repo dejaron de contar como deriva. `roots.es_local()` lo decide derivándolo
de la ruta —sin lista que mantener— y `alinear.py` las saca del conteo con un estado propio 🔧, con su
razón impresa: esconderlas sería el otro error. Lo que lo justifica, medido: de **24 archivos con
deriva en todo el árbol, 23 eran de herramientas locales y 1 de CreditOp**, y ese único que importaba
quedaba enterrado. El ranking pasó de tres nodos con ruido a ninguno.

⚠ Y al medir qué costaría RETIRAR esos nodos apareció lo que no se puede perder: de sus términos
propios, **61 del nodo `harness` y 96 del de `trazador` no están en el `CLAUDE.md` de su herramienta**
—entre ellos tablas y códigos de dominio (`ocr_logs`, `otp_logs`, `compare_face_logs`,
`user_request_records`, `CATEGORY_RULE_REJECTED`)—. El retiro es correcto pero pide rescatar primero,
y eso es una tarea propia; el inventario ya está hecho. Sí se rescató lo que ya había divergido: la
tabla de inyectabilidad del nodo `harness` duplicaba la de `entities` y diferían en rt=0. Verificado
contra `main`: el simulador que la copia atribuía a rt=0 es del canal ecommerce (su docstring dice que
imita el webhook de un agregador, y está bloqueado en producción), y ya vive documentado en el nodo
`ecommerce`. `entities` quedó con la fila corregida — en rt=0 decide el lender en su propio sitio y
la decisión no vuelve, que no es lo mismo que «nadie».

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
