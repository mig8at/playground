# visor — protocolo (un diseño de Figma, recorrido como lo recorrería el cliente)

`make visor` (UI :5193 · API :5194). Se pega la URL de una **sección o página** de Figma —la que se
copia del navegador, con su `node-id`— y queda: a la izquierda los carriles que armó el diseñador, al
centro la pantalla con las zonas del prototipo que se pueden tocar, a la derecha qué dice, a dónde lleva
y de dónde se llega. ← → recorren el carril, Retroceso vuelve, H muestra u oculta las zonas.

## Qué es y qué no

- **Lee, no escribe.** Todo sale de `connectors/figma`: el mapa es el mismo `bin/pg figma map`, y la
  imagen de cada pantalla es la exportación de Figma a 2×. No hay HTML de la pantalla: es la imagen.
  Traducir el diseño a HTML es el paso siguiente, y va encima de esto.
- **El carril y el título se DEDUCEN** del lienzo (filas + rótulos grandes; el texto más grande de la
  pantalla), y la UI lo dice. Las reglas y lo que las justifica están en
  `connectors/figma/structure.go`; si un archivo nuevo sale mal agrupado, se corrige ahí, con su prueba,
  no en la Vue.
- **El token no sale del server.** El navegador pide `/api/screen` y nunca ve ni el token ni el enlace
  de S3 que devuelve Figma (que además vence). El enlace se baja SIN el token.

## Lo que hay que saber antes de tocarlo

- **Las imágenes se guardan en `visor/.cache/<archivo>/<versión>/`** (gitignoreado). La versión va en la
  ruta: un cambio del diseñador cambia la versión y la imagen vieja no se sirve. «Volver a leer» en la
  barra de carriles pide el mapa de nuevo y, con él, la versión.
- **Al abrir un mapa, el server baja todas las pantallas en segundo plano**, de a 12. La primera que se
  mira casi siempre ya está; una imagen que se pide mientras se baja no se pide dos veces
  (`TestScreenDownloadsOnceAndServesFromDisk`).
- **La clave y el id terminan en una ruta de disco**: se validan contra su forma exacta, no se limpian.
- **El tipo de pantalla va en `data-kind`, no en una clase**: `panel` es la región compartida del
  workbench, y como clase le ponía su fondo y su borde al dispositivo. Lo frenó `make estilo-check`.
- **Una pantalla que avanza sola** (prototipo con `AFTER_TIMEOUT`) no avanza sola acá: muestra el botón
  «Avanza sola a …». Un temporizador haría saltar la pantalla mientras se la está mirando.

## Cómo se comprueba

    make visor-test                   # las guardas del server, sin red
    go test ./connectors/figma/       # las reglas que deducen carriles, títulos y zonas
    make estilo-check                 # el visor es la cuarta UI del tema compartido

## Qué deja esto en la tarea

Lo que se vio en un diseño va a la pila de la tarea como bloque, con el comando que lo reproduce —el
`bin/pg figma map '<url>'` de la sección, no una captura— y el enlace al archivo en `artifacts/` (un
`.url`). A Jira no va la herramienta: va «el diseño del flujo tiene tal recorrido».
