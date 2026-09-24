# visor — protocolo (un diseño de Figma, recorrido como lo recorrería el cliente)

`make visor` (UI :5193 · API :5194). La barra de la izquierda es un acordeón donde **cada proyecto es un
bloque en la raíz** (Altafinanciera, BCP, Credifamilia, CreditopX, flujo ecommerce, Motai Renting,
Smartpay), y adentro están directamente **sus pantallas** en los carriles del diseñador. Se abre de a uno
—con varios, cada bloque quedaba de dos renglones— y al final está «Sumar un flujo».

La página del archivo se elige sola: la que se llama «Flujo» o «Flow» (así las nombran los siete de
producto) o, si no hay, la primera que no sea portada, benchmark ni prototipo. *(Hubo tres versiones
antes, las tres descartadas por Miguel el mismo día: un bloque «Proyectos» con una lista adentro, la
carpeta de Figma como nivel, y las páginas del archivo —«Cover · Benchmark · Flujo»— como nivel. Lo que se
busca es el recorrido, no dónde vive ni cómo se reparte el archivo.)* Al centro la pantalla con las zonas del prototipo que se pueden tocar; a
la derecha qué dice, a dónde lleva y de dónde se llega. ← → recorren el carril, Retroceso vuelve, H
muestra u oculta las zonas, 0 centra la pantalla y + / − son el zoom.

**El tamaño máximo de la pantalla es el alto de la región**: al 100 % la llena de arriba abajo, y el zoom
la achica hasta el 25 %. El zoom es SÓLO por gestos —Ctrl + rueda o el pellizco del trackpad, anclado en
el puntero, y + / − en el teclado—: hubo una barra en la cabecera y Miguel la sacó. Depende sólo del ALTO, así que arrastrar un separador no la cambia de tamaño —el
primer intento, que la escalaba para entrar entera en la región, sí lo hacía—, y en Comparar las dos van a
la misma escala. Lo que no entra a lo ancho se mueve **arrastrando**, o con la rueda; doble clic en el
fondo la centra. Un clic en una zona del prototipo sólo cuenta si el puntero no se movió, y el iframe del
HTML no recibe el puntero (es un dibujo: las zonas van encima), así que arrastrar sobre él también mueve
el lienzo.

## La ruta: `/<proyecto>/<pantalla>`, para enlazar desde afuera

`http://localhost:5193/credifamilia/1-4063` abre ese proyecto en esa pantalla: el proyecto por su nombre
en minúsculas y con guiones (`flujo-ecommerce`, `motai-renting`), la pantalla por su id de Figma con
guion, como lo escribe Figma en `node-id`. Sin pantalla abre la primera. Opcionales: `?modo=html` o
`?modo=comparar`, y `?nodo=<id>` cuando lo que se abrió no es la página de flujo del archivo sino una
sección pegada a mano. El botón de copiar de la cabecera da la de la pantalla que se está mirando.

- Un nombre que se repite entre dos proyectos no sirve de ruta: esos van por la **clave** del archivo,
  que también se acepta en lugar del nombre.
- Un proyecto que no está en la barra dice que no está, en vez de abrir el último que se miró.
- Los enlaces de antes —`#/<clave>/<nodo>/<pantalla>`— siguen abriendo y quedan reescritos a la ruta.

## De dónde salen los proyectos

**La API de Figma no lista los equipos de una cuenta ni lo «visto recientemente»**, así que la barra se
arma de dos fuentes, guardadas en `visor/.cache/library.json` (preferencia de esta máquina):

- **los equipos y proyectos que se suman con el +**, pegando la URL de su página
  (`figma.com/files/team/<id>/…` o `figma.com/files/project/<id>/…`, la que se abre al tocar la carpeta).
  Se prueba antes de guardarlo: uno al que la cuenta no entra vuelve con el 403 de Figma en vez de
  sumarse callado. El proyecto sirve cuando la cuenta ve una carpeta de otro equipo sin ser miembro;
- **los archivos abiertos o sumados sueltos**, agrupados por su **carpeta de Figma** (la da `/meta`), o en
  «Abiertos en el visor» si no se sabe. Es el caso de Kiu: sus flujos se le compartieron a la cuenta de a
  uno —«Carpetas compartidas» está vacía y la cuenta no es del equipo—, y los siete viven en «PRODUCTO».
  Sus claves salieron de abrir cada tarjeta de «Recientes» en Figma: la tarjeta no es un enlace y la
  clave no está en el HTML.

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

## Los controles del HTML responden: campos, casillas y botones

El HTML no es sólo un dibujo: sus **campos se escriben, sus casillas se marcan y sus botones siguen al
prototipo**. Se reconocen por el sistema de componentes de los diseños de producto, que usa los MISMOS
nombres de capa en Credifamilia, flujo ecommerce, Motai y BCP (las reglas y el censo, en
`visor/render/controls.go`):

- **campo**: un texto «Input Text» adentro de un «Input Container» es un `<input>` en el mismo lugar. El
  gris de Figma es el placeholder; lo que se escribe va del color de la etiqueta del «Text- fields». Un
  texto oscuro ya es un valor escrito;
- **lista**: con «icon/arrow-down» **visible** es un `<select>` en el lugar del texto, estirado por debajo de
  la flecha para que toda la caja lo abra. ⚠ La flecha viene en casi todos los campos, OCULTA: sin mirar si
  se ve, el número de celular salía como lista. ⚠ Y **tiene una sola opción, la que dibuja el diseño**:
  ninguna de las 46 listas de los cuatro archivos muestra una alternativa (sólo «Cundinamarca», «Bogotá»
  o «Selecciona una opción»), y el reporte lo dice. Los catálogos reales existen en la base (`countries`,
  `country_zones`, `country_cities`), pero enchufarlos pide verificar en `main` cuál usa cada campo;
- **casilla**: la instancia «Check Box» alterna entre sus dos dibujos de Figma **sin script** (el documento
  no corre ninguno): un input invisible encima y `:checked` elige cuál se ve. El dibujo de la otra variante
  sale de OTRA INSTANCIA de esa variante, en la pantalla o en otra del archivo (`fileVariants` en el
  server). ⚠ No del componente: Figma no exporta los componentes de las variantes de este sistema
  («invisible o vacío», medido con los de Credifamilia). Una pregunta de «Sí» y «No» es un radio; una
  lista de opciones, casillas. La opción entera es un `<label>`: tocar el texto también marca;
- **botón**: la instancia «Botones» o el marco con un texto «Button Text» es un `<button>`. Un clic sigue la
  zona del prototipo que tiene encima, también con las zonas ocultas (H).

Para que se usen, el iframe **recibe el puntero**. La página escucha su documento (es del mismo origen):
un clic en un control es del control, y un arrastre o la rueda desde cualquier otra parte mueven el lienzo
igual que afuera. Con el foco adentro, las flechas y la H siguen andando salvo mientras se escribe.

Medido el 2026-09-24 contra la imagen de Figma: la fidelidad queda **idéntica pantalla por pantalla** en
Credifamilia (31) y flujo ecommerce (49), con los campos y con las listas. ⚠ Una tanda de
`visor-fidelidad` puede dar una pantalla muy abajo (43 % en «Pago mínimo») porque midió antes de que
cargara una imagen: antes de creerle a una caída, medila sola con `SOLO=<id>`. Y lo que queda vivo, por archivo (pantallas móviles):

    Credifamilia     31   38 campos · 15 casillas · 34 opciones sí/no · 23 botones
    flujo ecommerce  49   13 campos ·  4 casillas ·                      34 botones
    Motai           107   43 campos · 16 casillas ·                      76 botones
    BCP              28   44 campos · 36 casillas ·                      18 botones

## Lo que ya costó en la traducción (y está fijado con su prueba en `visor/render`)

- **Un `HUG` sin contenido en el flujo mide 0 en CSS.** En Figma una instancia vacía con la imagen de
  fondo conserva su tamaño; en CSS «ajustarse al contenido» sin contenido la deja en el padding. En
  «Número de celular» el logo quedaba en 16×16 y la pantalla entera subía 92 px (86,5 % → 99 %). Sin
  contenido que lo sostenga, va con la medida de Figma.
- **`STRETCH` en una imagen es el RECORTE de Figma**, con su `imageTransform`, no «estirar»: como
  `cover`, la foto del documento salía entera y chica. 18 de las 43 imágenes del archivo van así, y
  arreglarlo subió cinco pantallas de ~85 % a más de 99,8 %.
- **Una elipse con `arcData` es un ARCO, no un disco.** Un anillo (radio interior > 0) o un progreso (barrido
  que no da la vuelta) como caja con `border-radius: 50%` salía lleno: el progreso «2/3» de Credifamilia
  era una bola violeta. Van como el SVG de Figma, y ese SVG viene **recortado a lo que se ve** (35×36 para
  una caja girada de 46×46), así que el arco se ubica por `absoluteRenderBounds`. ⚠ Sólo el arco: esos
  límites descuentan también el recorte del marco padre y el SVG de un vector cualquiera no, y ubicar así
  todos los dibujos achicó 1 px el velo de «Pago mínimo» (99,7 % → 99,5 %). Medido: 10 de las 31
  pantallas de Credifamilia mejoran (mediana 98,6 → 98,8 %) y `flujo-ecommerce` queda igual.
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
