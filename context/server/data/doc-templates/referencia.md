# <Nombre> · referencia
> verificado contra `main` el <YYYY-MM-DD> — <MÉTODO: qué se leyó/corrió/midió para poder afirmarlo>
> <TL;DR: qué tema acotado cubre, en 1 frase>

<!-- REFERENCIA = material transversal que los flujos consultan.

     EL ORDEN NO ES DECORATIVO. Un modelo abre 2–4 nodos con una hipótesis ya formada, y lo
     primero que necesita es saber QUÉ DE LO QUE ESTÁ POR ASUMIR ES FALSO. Por eso «Antes de
     concluir» va SEGUNDO, no al final: se midió que estaba llegando al 60–92% del documento,
     o sea después de toda la descripción, que es justo donde ya no cambia ninguna decisión.

     ANTES DE ESCRIBIR EL DOC, ESCRIBÍ EL `when` DEL map.json. Es la interfaz real: si el `when`
     no matchea el vocabulario con el que LLEGA la tarea, el nodo no se abre nunca y nada de lo
     que escribas acá existe. El doc es la segunda mitad del trabajo, no la primera.

     Reglas de escritura:
     · Test del párrafo: o cambia lo que un modelo haría en una tarea plausible, o previene un
       error que YA pasó (citá su F-xx). Si ninguna de las dos, no va.
     · Un hecho, UNA casa: si pertenece a otro nodo, «→ ver <nodo> § <sección>» y no lo repitas.
       Lo que vive en el código NO se copia (columnas, enums, códigos): se apunta a la línea.
     · Marcá el estado de cada afirmación: lo verificado va sin marca, lo INFERIDO lo dice
       («inferido de los callers», «sin confirmar contra BD»), y lo que no se pudo comprobar
       baja a «Lo que NO está verificado». Leerse igual es como `servicing` terminó llamando
       «stand-by» al estado 21 durante meses.
     · Nada de estado-vivo contable («hoy hay N…»): eso lo calculan las tools, no la prosa.
     · Historia → git · preguntas → tablero (son tarea) · trampas con síntoma → findings. -->

## Qué es
<El tema en 1 párrafo, la conclusión primero: qué decide, dónde vive, qué lo hace no-obvio.>

## Antes de concluir
<!-- EL BLOQUE QUE MÁS RINDE. Cada ítem corrige una conclusión que parece obvia y es falsa, o
     avisa de un riesgo vivo. Todos con su recibo: F-xx, commit, o el método con que se comprobó.
     Si no tenés nada contraintuitivo que decir, el nodo probablemente no hacía falta. -->
- **<la regla>** — <la conclusión falsa que corrige, y con qué se comprobó>.

## <El cuerpo, en secciones ### por responsabilidad>
<El análisis que NO se deduce leyendo un archivo solo: cruces entre repos, orden real de
evaluación, vocabulario del dominio que el código usa sin definir.>

## Dónde mirar
<!-- SOLO rutas con ancla y porqué — la lista completa de archivos ya vive en map.json.
     También vale agrupar por responsabilidad: `- **Qué resuelve el grupo**: ruta · ruta`. -->
- `repo/ruta/archivo.php:123` — <la conclusión no-obvia que se ve ahí (dónde DECIDE, no qué es)>.

## Lo que NO está verificado <!-- (opcional) -->
<Afirmaciones que faltó comprobar, con el método que falta (correr X, mirar la tabla Y).
NO son preguntas hipotéticas: si ninguna tarea la va a hacer, no ocupa contexto.>
