# <Nombre> · referencia
> verificado contra `main` el <YYYY-MM-DD> — <MÉTODO: qué se leyó/corrió/midió para poder afirmarlo>
> <TL;DR: qué tema acotado cubre, en 1 frase>

<!-- REFERENCIA = material transversal que los flujos consultan. Reglas de escritura:
     · Test del párrafo: o cambia lo que un modelo haría en una tarea plausible, o previene un
       error que YA pasó (citá su F-xx). Si ninguna de las dos, no va.
     · Un hecho, UNA casa: si pertenece a otro nodo, «→ ver <nodo> § <sección>» y no lo repitas.
       Lo que vive en el código NO se copia (columnas, enums, códigos): se apunta a la línea.
     · Nada de estado-vivo contable («hoy hay N…»): eso lo calculan las tools, no la prosa.
     · Historia → git · preguntas → tablero (son tarea) · trampas con síntoma → findings. -->

## Qué es
<El tema en 1 párrafo, la conclusión primero: qué decide, dónde vive, qué lo hace no-obvio.>

<El cuerpo va en secciones ### por responsabilidad: el análisis que NO se deduce leyendo un
archivo solo — cruces entre repos, orden real de evaluación, vocabulario del dominio que el
código usa sin definir.>

## Dónde mirar
<!-- SOLO rutas con ancla y porqué — la lista completa de archivos ya vive en map.json. -->
- `repo/ruta/archivo.php:123` — <la conclusión no-obvia que se ve ahí (dónde DECIDE, no qué es)>.

## Gotchas / riesgos
<Solo lo contraintuitivo VERIFICADO que cambia una decisión, cada uno con su recibo: F-xx,
commit, o el método con que se comprobó.>

## Lo que NO está verificado <!-- (opcional) -->
<Afirmaciones que faltó comprobar, con el método que falta (correr X, mirar la tabla Y).
NO son preguntas hipotéticas: si ninguna tarea la va a hacer, no ocupa contexto.>
