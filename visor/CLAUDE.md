# visor — protocolo (un diseño de Figma, recorrido como lo recorrería el cliente)

`make visor` (UI :5193 · API :5194). La barra de la izquierda tiene dos vistas apiladas: **Proyectos**,
un acordeón proyecto → archivo → páginas, y **Carriles**, las pantallas de la página abierta en los
carriles que armó el diseñador. Al centro la pantalla con las zonas del prototipo que se pueden tocar; a
la derecha qué dice, a dónde lleva y de dónde se llega. ← → recorren el carril, Retroceso vuelve, H
muestra u oculta las zonas. Un enlace de Figma con `node-id` también abre directo (`#/<clave>/<nodo>`).

## De dónde salen los proyectos

**La API de Figma no lista los equipos de una cuenta ni lo «visto recientemente»**, así que la barra se
arma de dos fuentes, guardadas en `visor/.cache/library.json` (preferencia de esta máquina):

- **los equipos y proyectos que se suman con el +**, pegando la URL de su página
  (`figma.com/files/team/<id>/…` o `figma.com/files/project/<id>/…`, la que se abre al tocar la carpeta).
  Se prueba antes de guardarlo: uno al que la cuenta no entra vuelve con el 403 de Figma en vez de
  sumarse callado. El proyecto sirve cuando la cuenta ve una carpeta de otro equipo sin ser miembro;
- **los archivos abiertos en el visor**, que se anotan solos en «Abiertos en el visor».

⚠ Desde un archivo suelto no se llega a su equipo: `/meta` dice la carpeta («PRODUCTO») pero no el id
del proyecto ni del equipo. Y ⚠ el equipo de `figma.com/files/team/<id>/recents-and-sharing` es el de la
URL, no el de los archivos que se ven en esa pantalla: «recientes» mezcla archivos de otros equipos.

## Qué es y qué no

- **Lee, no escribe.** Todo sale de `connectors/figma`: el mapa es el mismo `bin/pg figma map`, y la
  imagen de cada pantalla es la exportación de Figma a 2×.
- **Tres modos en la cabecera: Imagen · HTML · Comparar.** El HTML lo traduce `visor/render` desde el
  JSON del nodo: el auto-layout es flexbox, un marco sin auto-layout pone a sus hijos en absoluta con las
  coordenadas de Figma, los textos son texto con su fuente, y los dibujos (vectores, íconos enteros) son
  el SVG que exporta Figma. Lo que no tiene equivalente —máscaras, modos de mezcla, degradados que no son
  lineales— no se imita: va al reporte de la traducción, en el detalle.
- **La imagen es la VARA del HTML: `make visor-fidelidad REF='<url>'`** dibuja el HTML en Chromium,
  lo compara píxel a píxel con la exportación y deja un mapa de diferencias por pantalla en
  `visor/.cache/fidelity/`. Medido el 2026-09-24 sobre las 49 pantallas móviles de `flujo-ecommerce`:
  mediana **99,3 %**, 47 de 49 por encima del 97 %, la peor 91,2 %. Cada arreglo del traductor salió
  de mirar el mapa de la peor.
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

## Lo que ya costó en la traducción (y está fijado con su prueba en `visor/render`)

- **Un `HUG` sin contenido en el flujo mide 0 en CSS.** En Figma una instancia vacía con la imagen de
  fondo conserva su tamaño; en CSS «ajustarse al contenido» sin contenido la deja en el padding. En
  «Número de celular» el logo quedaba en 16×16 y la pantalla entera subía 92 px (86,5 % → 99 %). Sin
  contenido que lo sostenga, va con la medida de Figma.
- **`STRETCH` en una imagen es el RECORTE de Figma**, con su `imageTransform`, no «estirar»: como
  `cover`, la foto del documento salía entera y chica. 18 de las 43 imágenes del archivo van así, y
  arreglarlo subió cinco pantallas de ~85 % a más de 99,8 %.
- **Un marco en absoluta que además tiene hijos no se puede pisar con `position: relative`** para
  ubicarlos: ya sirve de referencia siendo absoluto.
- **En la medición**, dos trampas que dieron números falsos: la exportación de Figma deja transparente
  lo que no tiene relleno —leído a secas es negro contra el blanco de la captura: el rombo de decisión
  daba 48 %—, y una respuesta que no es el HTML (un 429 de Figma) se medía como «pantalla distinta»
  (0,8 %). Ahora las dos imágenes se componen sobre el mismo fondo, y una respuesta que no es HTML sale
  como error, no como medida.
- **El límite de Figma (429) se toca con una tanda.** El conector espera lo que pide `Retry-After` y
  reintenta; el server guarda el JSON de cada pantalla en disco por versión, para no volver a pedirlo
  en cada reinicio.

## Cómo se comprueba

    make visor-test                   # la traducción (visor/render) y las guardas del server, sin red
    make visor-fidelidad REF='<url>'  # el HTML contra la imagen de Figma, con el visor corriendo
    go test ./connectors/figma/       # las reglas que deducen carriles, títulos y zonas
    make estilo-check                 # el visor es la cuarta UI del tema compartido

## Qué deja esto en la tarea

Lo que se vio en un diseño va a la pila de la tarea como bloque, con el comando que lo reproduce —el
`bin/pg figma map '<url>'` de la sección, no una captura— y el enlace al archivo en `artifacts/` (un
`.url`). A Jira no va la herramienta: va «el diseño del flujo tiene tal recorrido».
