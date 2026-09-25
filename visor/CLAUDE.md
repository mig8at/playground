# visor — protocolo (un diseño de Figma, recorrido como lo recorrería el cliente)

`make visor` (UI :5193 · API :5194). La barra de la izquierda es un acordeón donde **cada proyecto es un
bloque en la raíz** (Altafinanciera, BCP, Credifamilia, CreditopX, flujo ecommerce, Motai Renting,
Smartpay), y adentro están directamente **sus pantallas** en los carriles del diseñador. Se abre de a uno
—con varios, cada bloque quedaba de dos renglones— y al final está «Sumar un flujo».

La página del archivo se elige sola: la que se llama «Flujo» o «Flow» (así las nombran los siete de
producto) o, si no hay, la primera que no sea portada, benchmark ni prototipo. *(Hubo tres versiones
antes, las tres descartadas por Miguel el mismo día: un bloque «Proyectos» con una lista adentro, la
carpeta de Figma como nivel, y las páginas del archivo —«Cover · Benchmark · Flujo»— como nivel. Lo que se
busca es el recorrido, no dónde vive ni cómo se reparte el archivo.)* Al centro la pantalla —la imagen de
Figma, su HTML o las dos—; a la derecha qué es, la capa señalada, la fidelidad, la paleta y la
tipografía. ← → recorren el carril, Retroceso vuelve, S señala una capa, 0 centra la pantalla y + / − son
el zoom.

⛔ **No hay zonas del prototipo, ni íconos de «tiene zonas» o «tiene comentarios» en los carriles, ni
«Lleva a» / «Llega desde»** (Miguel, 2026-09-25): las flechas ya recorren el carril, casi ninguna pantalla
de estos archivos tiene conexiones de prototipo, y el ojo que las mostraba parecía no hacer nada. La barra
derecha se aligeró en la misma pasada —sin «La traducción a HTML», «Botones» ni «La misma pantalla en otro
lugar»—: la interfaz es para mirar, y ese detalle es del modelo. Las conexiones **siguen** en el conector y
en el paquete para el modelo («A dónde lleva»), que es por consola.

**El tamaño máximo de la pantalla es el alto de la región**: al 100 % la llena de arriba abajo, y el zoom
la achica hasta el 25 %. El zoom es SÓLO por gestos —Ctrl + rueda o el pellizco del trackpad, anclado en
el puntero, y + / − en el teclado—: hubo una barra en la cabecera y Miguel la sacó. Depende sólo del ALTO, así que arrastrar un separador no la cambia de tamaño —el
primer intento, que la escalaba para entrar entera en la región, sí lo hacía—, y en Comparar las dos van a
la misma escala. Lo que no entra a lo ancho se mueve **arrastrando**, o con la rueda; doble clic en el
fondo la centra. Un clic sólo cuenta si el puntero no se movió, y arrastrar sobre el HTML también mueve el
lienzo.

## Para el modelo: la URL que pega Miguel es el ancla

Decisión de Miguel (2026-09-25): **la interfaz es para mirar; el modelo trabaja con comandos**, como con el
harness. Y **el trabajo empieza con lo que Miguel pega, no con el modelo buscando**: un diseño nuevo está
asociado a una tarea del tablero, y en algún momento Miguel dice «esta es la pantalla que hay que
adelantar» o «mirá esta capa, los chulos no se ven», con una URL. El modelo no sale a buscar qué podría ser:
entiende esa URL y trae eso.

    make visor-url U='<lo que pegó Miguel>'

**Es la puerta** (`visor/server/route.go`). Acepta la URL del visor (con `?capa=` y `?huella=`), el enlace
`visor:…@huella` de una tarea, la URL de Figma —de una pantalla o de CUALQUIER capa de adentro, lo que da
«Copy link to selection»: la pantalla que la contiene se encuentra por su lugar en el lienzo y se confirma
en su árbol— y `<clave>/<nodo>`. Contesta, en este orden:

1. **qué es**: una pantalla, o una capa de una pantalla, y de qué archivo;
2. **a qué tarea del tablero está asociada**: las que la enlazan, en su documento o en su pila (y si ninguna,
   el enlace listo para la pila);
3. **si cambió** desde que se enlazó, cuando lo pegado trae huella;
4. lo que hace falta para colaborar: con una **capa**, el informe de la capa (qué dice Figma, los recortes de
   Figma y del HTML en esa zona con cuánto se parecen, y el HTML exacto que la dibuja); con una **pantalla**,
   el paquete entero.

Lo demás son piezas sueltas, para cuando hace falta una sola cosa (adentro los verbos van en inglés —`cd
visor/server && go run . url|search|screens|screen|html|assets|tokens|components|fidelity|layer`—), y ninguno
necesita el visor corriendo:

    make visor-pantallas                                        # los proyectos, con su clave de Figma
    make visor-pantallas P=RkyauDfqEsFbJZBBoqChAV               # el flujo: carriles y pantallas, cada una con su id
    make visor-pantalla R=RkyauDfqEsFbJZBBoqChAV/266-1279       # el paquete: textos, destinos, imágenes, componentes, tokens, HTML
    make visor-recursos R=RkyauDfqEsFbJZBBoqChAV/266-1279 DIR=<carpeta> [SVG=1]   # las imágenes ORIGINALES, con el nombre de su capa
    make visor-html R=… [OUT=<archivo>] · make visor-tokens P=<clave> [FORMATO=css|tailwind|json] · make visor-componentes P=<clave>
    make visor-fidelidad R=RkyauDfqEsFbJZBBoqChAV/266-1279      # ¿cuánto se parece el HTML a Figma? sin el suavizado de las letras [NUEVA=1]
    make visor-capa R='<enlace con ?capa=>'                     # UNA capa que Miguel señaló: qué es, Figma, su HTML y los recortes
    make visor-buscar Q='alquila moto'                          # el caso RARO: nadie pegó nada; busca por lo que dice la pantalla

**El CLI habla en IDS de Figma** (decisión de Miguel, 2026-09-25): la pantalla es `<clave del archivo>/<nodo>`
—o la URL de Figma, que trae los dos—, y todo lo que imprime la nombra así. Los ids no dependen de cómo se
llame nada, y el nodo sobrevive a que el diseñador edite o renombre la pantalla. Acepta también el proyecto
por su nombre (`altafinanciera/266-1279`) y el enlace `visor:` de una tarea, que es como la nombran la
interfaz y el tablero, porque ahí se leen mejor. `visor-buscar` es lo único por nombre, para cuando alguien
dice «la de bienvenida» sin dar el id.

- ⚠ **Una pantalla se llama por lo que DICE, no por lo que es.** «bienvenida» no aparece en la bienvenida de
  Alta: su capa es «home» y su título, el titular. Por eso `visor-buscar`, cuando ninguna pantalla tiene todas
  las palabras pero una nombra un proyecto, da las pantallas que **abren cada carril** de ese proyecto —una
  bienvenida o un inicio suele ser una de ésas—. Medido: la de Alta sale entre las 12 entradas de Altafinanciera.
- **`visor-recursos` baja la resolución ORIGINAL** —la que se subió a Figma, no la exportación de la
  pantalla—: en la bienvenida de Alta, la foto de fondo es un PNG de 1448×1086 y el logo un JPEG de 200×200,
  los dos que la implementación reemplazó por los de otra marca porque «los tenía que dar diseño». El paquete
  (`visor-pantalla`) ya dice qué imágenes tiene la pantalla y con qué comando se bajan.
- **El mapa del flujo queda en disco por versión** (`<clave>/<versión>/maps/`): un comando cuesta un pedido
  chico a Figma (`Head`, un nivel del archivo) para saber si el diseñador guardó algo; el árbol entero sólo
  se vuelve a bajar entonces. La primera vez que se leen los siete flujos tarda ~24 s; después, ~4 s.
- Sale ≠0 si algo falla: 2 si es de uso (una ruta mal escrita, un verbo que no existe), 1 si es de datos
  (un proyecto que la biblioteca no conoce, Figma que no contesta).

## La ruta: `/<clave del archivo>/<pantalla>`, por ids de Figma

`http://localhost:5193/7M01d0CZPzzJs0iZeKhwvf/381-1052` abre ese archivo en esa pantalla: la **clave del
archivo** y el **nodo** con guion, como lo escribe Figma en `node-id`. **Los nombres son para la barra; la
ruta, el enlace de las tareas y el CLI van por ids** (decisión de Miguel, 2026-09-25): un id no depende de
cómo se llame nada. Una ruta vieja con el nombre del proyecto en minúsculas y con guiones
(`/credifamilia/381-1052`) sigue abriendo y queda reescrita a la de ids. Sin pantalla abre la primera. Opcionales: `?modo=html` o
`?modo=comparar`, y `?nodo=<id>` **sólo cuando hace falta**: si la pantalla vive fuera de la página de flujo
del archivo (la página «prototipo», por ejemplo) y se abrió pegando su sección. Una sección pegada que está
adentro de la página de flujo —el caso de `flujo-ecommerce`, 334-455 dentro de «Flujo»— no lo lleva: el
visor averigua en segundo plano qué pantallas tiene la página de flujo y lo saca. ⚠ Y al centro se queda lo
que se abrió: releer el bloque de la barra no reemplaza una sección de otra página por la de flujo (lo hacía,
y la ruta del prototipo terminaba en otra pantalla). El botón de copiar de la cabecera da la de la pantalla
que se está mirando.

- **Cuánto vive una ruta: lo que vive la pantalla en Figma.** La pantalla va por su id de nodo, que Figma
  conserva mientras el nodo exista: el diseñador la puede editar, mover o renombrar y la ruta sigue
  abriendo, **con el contenido nuevo** después de «Volver a leer» del bloque (o de reiniciar el server: el
  mapa se guarda en memoria mientras corre). Si la borra, la ruta muere; y copiar y pegar la pantalla, o
  duplicarla y borrar la original, también la mata, porque la copia es un nodo nuevo con otro id.
- **Una ruta muerta lo DICE, no abre otra pantalla.** Hasta el 2026-09-24 abría la primera del flujo y
  reescribía la ruta, así que un enlace roto pegado en una tarea parecía sano. Ahora distingue «el
  diseñador la borró» (Figma devuelve 404) de «sigue en el archivo pero no en la página de flujo», con el
  enlace a Figma. ⚠ Y mientras una ruta manda, el bloque que quedó abierto de la visita anterior no se
  queda con el centro al terminar de cargar: esa carrera tapaba el aviso.
- **El enlace que se COPIA lleva la huella de la pantalla** (`?huella=52065d0ce692`): el resumen del contenido
  de ese momento (`connectors/figma.Fingerprint`, el mismo mecanismo que canon con el hash del blob de cada
  fuente). El id dice si la pantalla existe; la huella, si sigue siendo la que se enlazó: el diseñador la
  puede cambiar entera sin cambiarle el id. Abrir un enlace con huella lo compara con Figma y lo dice en el
  detalle («sin cambios» · «el diseño cambió: lo que diga la tarea puede estar viejo»). Cambia también si el
  diseñador edita un componente que la pantalla usa: eso también es «se ve distinta». Medido: dos lecturas
  frescas y una guardada horas antes dieron la misma huella.
- **`make visor-enlaces` rastrea TODOS los enlaces del visor de las tareas** (`tablero/tasks`, o `DIR=`): por
  cada uno dice `igual`, `CAMBIÓ` (con la huella vieja y la nueva), `BORRADA` o `sin huella`, con el archivo
  y la línea. Sale ≠0 si alguno se rompió (borrada, o un proyecto que la biblioteca no conoce); «cambió» es
  un aviso para releer, no un error. Pregunta a Figma, no a la caché.
- **Renombrar el archivo no mata la ruta**: la biblioteca guarda los nombres que tuvo (`aliases`), y el
  nombre viejo sigue abriendo el proyecto. El enlace que se copia después ya usa el nombre nuevo.
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
- **La interfaz sigue la base, en claro y en oscuro.** El botón de tema va en el pie (`bindThemeToggle`) y
  el renglón que lo aplica antes de pintar lo inyecta Vite desde `THEME_BOOT`. La imagen y el HTML de la
  pantalla NO siguen el tema: son el diseño, con sus propios colores. Las piezas son las de
  `tools/ui` (filas `.row`, alternador, avisos `.alert`, vacío `.empty`); lo propio del visor —el lienzo, el
  marco de la pantalla, la capa señalada— está al final de `App.vue`, y sus colores salen de tokens del tema.
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

## El paquete para el modelo: una pantalla, lista para pasar a código

**`make visor-pantalla R=<clave/nodo>`** da en un solo texto (Markdown) todo lo que un modelo necesita para pasarla a Vue o React (`/api/brief?key=<clave>&id=<pantalla>`, en
`visor/server/brief.go`): el enlace `visor:` con su huella, el de Figma, el carril y el tamaño; sus **textos en
orden de lectura** (sin la barra de estado: que el modelo no invente copy); **a dónde lleva** cada zona del
prototipo; sus controles; los **componentes** del sistema que usa, con las variantes que tienen en el
archivo; los **tokens** que usa, con su variable o clase; lo que el HTML no traduce; y el **HTML traducido**
entero. Se pega en la conversación con el modelo o en la tarea.

⛔ **La interfaz ya no tiene «Para la tarea» ni «Para el modelo», ni título, carril y tipo en la barra
derecha** (Miguel, 2026-09-25): **lo visual es para ver qué tan bien pasa Figma a HTML; lo que es
información para el modelo va por consola.** La barra derecha tiene sólo la capa señalada con su HTML, la
fidelidad, la paleta y la tipografía. Si hace falta información nueva, va primero al CLI.

- Nada se escribe a mano: sale del mapa, del nodo, de la traducción y de las hojas del archivo.
- Pesa lo que pesa el HTML: 25 KB en «Completa tu solicitud» de Credifamilia, 22 de ellos el HTML.
- ⚠ Una pantalla que es casi toda una imagen pegada trae pocos textos: los de la imagen no son texto en
  Figma. El reporte de la traducción ya lo dice («Imágenes 1»).

**Medido el 2026-09-25: ¿le sirve a un modelo el paquete, o alcanza con la API?** Tres pantallas (dos
formularios de Credifamilia y una de flujo-ecommerce con imagen), un modelo por caso con la MISMA consigna
—«esta pantalla como HTML y CSS de desarrollador»— y sólo su archivo de entrada: A la respuesta cruda de
`/nodes`, B el paquete. La vara es la de `visor-fidelidad`, contra la imagen de Figma:

    pantalla        A · API cruda                   B · paquete
    381-1052        99,2 % · 207 k tokens · 205 s   99,4 % · 102 k tokens · 60 s
    237-2727        97,8 % · 172 k tokens · 190 s   97,8 % · 100 k tokens · 51 s
    1302-1363       96,5 % · 139 k tokens · 157 s   97,7 % · 100 k tokens · 56 s

- **La fidelidad es casi la misma**: un modelo de hoy traduce bien el JSON crudo, y hasta encontró los
  nombres de los estilos en la respuesta. El paquete NO es lo que lo hace posible.
- **Lo que sí cambia es el costo y lo que falta**: con el paquete, **~40 % menos tokens y ~3× más rápido**;
  y con la API cruda la imagen del logo quedó como un círculo gris (el JSON trae una referencia, no la
  imagen) y los íconos, redibujados a mano a partir de su nombre.
- ⚠ **La respuesta cruda es UNA línea de 129.194 caracteres**, y la herramienta de lectura de un modelo la
  corta en ~39.000: el primer modelo A se frenó con el 30 % de la pantalla, y dos de los tres usaron
  comandos para leer el resto. Hubo que pasarle el JSON con saltos de línea (296 KB) para que pudiera.
- ⚠ Tres pantallas y una corrida por caso: es una señal, no una estadística. Y la medida por píxel se
  satura con los fondos lisos: el logo gris cuesta apenas un punto.

## Los componentes: qué piezas hay que tener antes de armar pantallas

**`make visor-componentes P=<clave>`**: las piezas del sistema de diseño que usa el flujo
(`connectors/figma/inventory.go`), con las **variantes con que aparece** cada una y las pantallas donde
está. Es la lista de componentes de Vue o React que hay que tener: los que ya existen en el front se
reusan, los que no se arman primero. El paquete de cada pantalla trae los que usa ESA pantalla.

⛔ **No hay vista de componentes ni de tokens en la interfaz** (Miguel, 2026-09-25): se deduce de la pantalla
que se trabaja —su paleta y su tipografía en la barra derecha, sus componentes y tokens en el paquete— y lo
del archivo entero sale por consola. Un enlace viejo a `/<proyecto>/tokens` o `/<proyecto>/componentes`
abre el proyecto.

- Cuenta las instancias de **primer nivel**: el ícono de adentro de un botón es parte del botón. La barra de
  estado no cuenta.
- ⚠ Los nombres son los de Figma **con sus erratas**, y a veces dicen algo del sistema: en Credifamilia hay dos
  sets de botón, «Botones» y «Bontones», y la variante de «Text- fields» se llama «Etate». Son dos componentes
  distintos en el archivo: conviene saberlo antes de programar uno solo.
- Medido el 2026-09-25 en Credifamilia: 25 componentes en 27 pantallas; el más repartido, «Text- fields»
  (35 usos en 14 pantallas).

## Los tokens: el diseño en el idioma de su sistema de diseño

Para que un modelo pase una pantalla a Vue o React sin copiar colores sueltos, el visor saca los **tokens**
del diseño: cada color y estilo de texto con su **nombre de Figma**, su valor y cuánto se usa
(`connectors/figma/tokens.go`). Salen de la misma respuesta que el árbol del mapa: no cuestan un pedido más.

- **Dónde:** por consola, `make visor-tokens P=<clave>` (o `bin/pg figma tokens '<url de la sección o
  página>'`, con `--css` · `--tailwind` · `--json`); en la interfaz, la paleta y la tipografía de cada
  pantalla con su token, y los enlaces a la hoja entera al pie de «Tipografía». `/api/tokens?key=<clave>&format=css`
  (o `tailwind`) sirve también como enlace directo: con el server recién arrancado lee sola la página de
  flujo del archivo, con la misma regla que la barra. *(Hasta el 2026-09-25 contestaba 404 si el archivo no
  se había abierto antes en el visor.)*
- **El HTML los usa:** lo que toma un estilo se escribe `var(--morado-500, rgba(76,57,255,1))` —con el valor
  por si falta la variable, así la fidelidad no cambia: medido idéntica en Credifamilia (31) y flujo
  ecommerce (49)— y el texto lleva la clase de su estilo (`class="text-small-medium"`). El documento
  declara en su `:root` las variables que usa, así se copia con su hoja.
- **El nombre de la variable junta las dos formas de las bibliotecas de producto**: la vieja
  «Colors/violet/violet-500» y la nueva «colors/violet/500» son el mismo `--violet-500`. ⚠ Un mismo nombre
  con dos valores es real —«neutral-50» es #fcfcfc y #e6e6e6 en flujo ecommerce y Motai—: el menos usado
  lleva su valor pegado (`--neutral-50-e6e6e6`) en vez de esconderse.
- **Los colores sin estilo van aparte**: se salen del sistema de diseño. Si su valor es el de un token, la
  hoja lo dice («es el valor de --neutral-0: usar el token»): en Credifamilia 13 de los 38 sueltos. La barra
  de estado del teléfono no cuenta: sus negros eran la mitad de los sueltos.
- ⚠ **Radios y espaciados van por valor, sin nombre**: las variables de Figma se leen con un permiso que el
  token no tiene (`/variables/local` contesta 403) y que Figma da en planes Enterprise.

Medido el 2026-09-25, estilos con nombre por archivo (variables después de juntar las dos formas):

    Credifamilia     33 colores → 33 variables · 17 textos · 38 colores sueltos
    flujo ecommerce  66 colores → 44 variables · 23 textos · 42 colores sueltos
    Motai            54 colores → 48 variables · 22 textos · 55 colores sueltos
    BCP              31 colores → 21 variables · 22 textos · 26 colores sueltos

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
- **botón**: la instancia «Botones» o el marco con un texto «Button Text» es un `<button>`.

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
- **Un `itemSpacing` NEGATIVO es SOLAPE, y `gap` no lo acepta.** Figma deja que los hijos de un auto
  layout se monten (−192 en la cortina de la bienvenida de Alta: el panel y dos hojas semitransparentes
  que asoman debajo); CSS tira un `gap` negativo sin decir nada y las hojas salían apiladas, estiradas
  hacia abajo. Va como margen negativo desde el segundo hijo, y con `itemReverseZIndex` el primero queda
  ENCIMA (`z-index` descendente). Medido en los cuatro flujos: 11 pantallas mejoran y ninguna empeora —la
  bienvenida 95,7 → 99,0 %, Motai 42:2144 65,2 → 98,5 %—.
- **CSS pinta lo POSICIONADO encima de lo que no lo está; Figma, por orden de capas.** Un hijo en el flujo
  que en Figma va DESPUÉS de un hermano en absoluta quedaba tapado: en la barra de pasos de Motai (1:6660)
  la barra morada —absoluta, de y=12 a 20— tapaba el trazo blanco de los tres chulos (y=12 a 19,3), que el
  SVG del grupo de círculos sí traía. Ese hijo va con `position: relative` y vuelve a pintarse en orden.
  Medido en los cuatro flujos (240 pantallas): 1:6660 queda en 100 % real, y otras siete suben —seis de
  Motai y dos de Credifamilia a 100 %, Ecommerce 1316:4181 de 98,0 a 99,2 % píxel a píxel—; ninguna baja.
  ⚠ En esa tanda dos de Alta salieron más bajas (192:4108: 96,2 %) y al repetirlas daban lo de siempre
  (99,4 %): la foto de relleno va como FONDO CSS y la medición sólo esperaba las `<img>`. Ahora espera
  también los fondos.
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

## Señalar una capa: «mirá, acá hay algo que no cuadra»

Miguel señala en la interfaz y el modelo lo lee por consola, con **el mismo enlace**.

- En la interfaz, el modo **Señalar** (botón de mira o <kbd>S</kbd>) marca la capa de abajo del mouse —la
  visible **más chica** cuya caja contiene el punto, igual en la imagen y en el HTML, con las cajas de
  `/api/layers`— y un clic la fija. Una superficie transparente se queda con el mouse mientras tanto: el
  iframe del HTML se lo llevaría. <kbd>Esc</kbd> sale del modo y
  después suelta la capa.
- La capa va a la ruta como **`?capa=<id>`** con guiones por «:» y **guion bajo por «;»**
  (`?capa=I1-6711_1265-1238`): las capas de adentro de un componente se llaman `I<instancia>;<pieza>`, y
  Go descarta sin avisar un parámetro con «;» sin codificar — un enlace pegado a mano lo perdería.
- La barra derecha («Capa señalada», `/api/layer`) dice qué es, por dónde se llega, su caja y lo que dice,
  muestra los **dos recortes** —Figma y el HTML— armados en el navegador, sin Chromium, y el **HTML de la
  capa** repartido para leer (`src/html-format.js`: una etiqueta por renglón con su sangría y una
  declaración del `style` por renglón; sigue siendo HTML válido). Copiar el HTML copia el original, exacto,
  de un renglón. Lo que Figma sabe de ella (auto-layout, ajuste, rellenos con su token, propiedades de
  componente) NO va en la barra —Miguel prefirió ver el código— y sí en `make visor-capa`. El botón de
  copiar de la cabecera deja el enlace con una línea para el chat.
- **`make visor-capa R='<ese enlace>'`** le da al modelo lo mismo y lo que no puede ver: los recortes en
  archivo (`<clave>/<versión>/layers/`), cuánto se parecen **en esa zona** (`fidelity.mjs --clip`) y el
  **pedazo de HTML** que la dibuja (`htmlFragment`: el elemento con su `data-figma` y todo lo de adentro).
  Si la capa va dibujada adentro de otra —un SVG de Figma, una imagen—, lo dice: no tiene elemento propio.
- Si el diseñador borra o rehace la capa, el id deja de existir: el enlace abre la pantalla y avisa que la
  capa ya no está, en la interfaz y en la consola.
- ⚠ **Sin verificar:** que Figma abra su propia URL con el id de una capa de adentro de una instancia
  (`node-id=I1-6711%3B1265-1238`). El visor y la consola no dependen de eso.

## La fidelidad: cuánto confiar en el HTML de una pantalla, en un número

La medida es la de `visor/tools/fidelity.mjs` —Chromium dibuja el HTML al doble y lo compara con la
exportación de Figma—, también **de a una pantalla**: `make visor-fidelidad R=<clave/nodo>` por consola
(sin el visor corriendo: abre su propia API en un puerto libre para que Chromium lea el HTML) y
`/api/fidelity` en la barra derecha de la interfaz (`server/fidelity.go`), junto con la **paleta** (cada
color con su muestra, su token y sus usos, y los que no tienen estilo) y la **tipografía** (familia, peso,
tamaño e interlineado, con su clase), que salen del reporte del render.

- **La que se muestra es la REAL**: un píxel sólo es distinto si en la otra imagen **no hay uno parecido a
  menos de 1 px, en los dos sentidos**, y sólo cuenta en celdas de 4×4 px donde ocupa **al menos el 15 %**.
  Comparar píxel a píxel cuenta el borde de TODAS las letras (Chromium y Figma no suavizan igual, y medio
  píxel de corrimiento pinta un contorno entero). Queda alta en una pantalla bien traducida (Alta 266:1279:
  **99,98 %** real contra 99,0 píxel a píxel) y baja de verdad cuando algo está corrido (Motai 29:3117:
  86,5 %). La estricta se muestra al lado y es la de las medianas de arriba y de `make visor-fidelidad
  REF=`, que imprime las dos columnas. `RADIUS` y `FLOOR` están en `fidelity.mjs`, y cambiar el método
  invalida lo guardado (`fidelityMethod`).
- ⛔ **No hay mapa de calor ni «capas que difieren», y es a propósito.** Se construyeron (2026-09-25):
  cada celda distinta atribuida a la capa visible más chica, pintado encima de la imagen. Píxel a píxel
  marcaba el borde de cada letra; con la tolerancia, en Motai 1:6660 las zonas eran exactamente los tres
  chulos que el HTML no dibuja —pero en general seguía dando falsos positivos en el suavizado de letras e
  íconos, y Miguel decidió sacarlo: un mapa que hay que interpretar con desconfianza no guía. Un número
  sí sirve en conjunto; para saber QUÉ falta, se mira «Comparar».
- **Se guarda en disco por versión del archivo Y por binario** (`<clave>/<versión>/fidelity/`): la medida
  es de ESA traducción, así que un cambio en `visor/render` la invalida aunque el diseño sea el mismo (con
  `go run`, cada cambio de código es otro binario; se compara la huella del ejecutable). Medir cuesta 3–6 s.
- Por eso la interfaz, al abrir una pantalla, pide sólo la medida **guardada** (`cached=1`) y mide al tocar
  «Medir»: recorrer un carril no lanza un Chromium por pantalla. El paquete para el modelo
  (`visor-pantalla`) tampoco mide: si hay medida la incluye, y si no, da el comando.

## Cómo se comprueba

    make visor-test                   # la traducción (visor/render) y las guardas del server, sin red
    make visor-fidelidad R=<clave/nodo>  # una pantalla: su porcentaje, sin el visor corriendo
    make visor-fidelidad REF='<url>'  # el flujo entero contra la imagen de Figma, con el visor corriendo
    make visor-enlaces                # ¿las pantallas que enlazan las tareas siguen igual, cambiaron o las borraron?
    go test ./connectors/figma/       # las reglas que deducen carriles, títulos y zonas
    make estilo-check                 # el visor es la cuarta UI del tema compartido

## Qué deja esto en la tarea

Lo que se vio en un diseño va a la pila de la tarea como bloque, con el comando que lo reproduce —el
`bin/pg figma map '<url>'` de la sección, no una captura— y el enlace al archivo en `artifacts/` (un
`.url`). Una pantalla puntual va en un bloque como **`[Título](visor:<proyecto>/<pantalla>@<huella>)`**, que
`make visor-pantalla` da listo en su primer renglón («Enlace para la tarea»): el tablero lo pinta como enlace que abre el visor en esa
pantalla (con `?huella=`, así el visor dice si cambió), y `make visor-enlaces` puede decir mañana si esa
pantalla cambió o la borraron. Va como tipo propio y no como `http://localhost:5193/…` por lo mismo que
`repo:`: el enlace nombra qué es, y el validador de bloques rechaza lo que no sea `https://`. A Jira no va la herramienta: va «el diseño del flujo tiene tal recorrido».
