# visor — protocolo (un diseño de Figma, recorrido como lo recorrería el cliente)

`make visor` (UI :5193 · API :5194). **La interfaz es para mirar** qué tan bien pasa Figma a HTML; **el
modelo trabaja con comandos** (decisión de Miguel, 2026-09-25). Para cambiar el visor por dentro —la
traducción a HTML, los controles, los tokens, la fidelidad, la ruta, la interfaz— cargá la skill
**`visor-render`**.

## La URL que pega Miguel es el ancla

**El trabajo empieza con lo que Miguel pega, no con el modelo buscando**: un diseño está asociado a una
tarea del tablero, y Miguel dice «esta es la pantalla que hay que adelantar» o «mirá esta capa», con una
URL. El modelo no sale a buscar qué podría ser: entiende esa URL y trae eso.

    make visor-url U='<lo que pegó Miguel>'

**Es la puerta** (`visor/server/route.go`). Acepta la URL del visor (con `?capa=` y `?huella=`), el enlace
`visor:…@huella` de una tarea, la URL de Figma —de una pantalla o de CUALQUIER capa de adentro— y
`<clave>/<nodo>`. Contesta, en este orden:

1. **qué es**: una pantalla o una capa, y de qué archivo;
2. **a qué tarea del tablero está asociada** (y si ninguna, el enlace listo para la pila);
3. **si cambió** desde que se enlazó, cuando lo pegado trae huella;
4. lo que hace falta: con una **capa**, qué dice Figma, los recortes de Figma y del HTML en esa zona con
   cuánto se parecen, y el HTML exacto que la dibuja; con una **pantalla**, el paquete entero.

Las piezas sueltas, para cuando hace falta una sola cosa (ninguna necesita el visor corriendo):

    make visor-pantallas                                        # los proyectos, con su clave de Figma
    make visor-pantallas P=<clave>                              # el flujo: carriles y pantallas, cada una con su id
    make visor-pantalla R=<clave>/<nodo>                        # el paquete: textos, destinos, imágenes, componentes, tokens, HTML
    make visor-recursos R=<clave>/<nodo> DIR=<carpeta> [SVG=1]  # las imágenes ORIGINALES, con el nombre de su capa
    make visor-html R=… [OUT=<archivo>] · make visor-tokens P=<clave> [FORMATO=css|tailwind|json] · make visor-componentes P=<clave>
    make visor-fidelidad R=<clave>/<nodo>                       # ¿cuánto se parece el HTML a Figma?
    make visor-capa R='<enlace con ?capa=>'                     # UNA capa que Miguel señaló
    make visor-buscar Q='alquila moto'                          # el caso RARO: nadie pegó nada

- **Lee todas las páginas del archivo**, no sólo la de flujo: una pantalla que no está en «Flujo» (la versión
  Q3 de App Creditop, el prototipo) se busca en las demás. La primera vez que hace falta lee cada página de
  Figma (~30 s en App Creditop); después salen de la caché por versión.
- **El CLI habla en IDS de Figma**: la pantalla es `<clave del archivo>/<nodo>` —o la URL de Figma, que trae
  los dos—. Los ids sobreviven a que el diseñador edite o renombre la pantalla. Acepta también el proyecto
  por nombre y el enlace `visor:` de una tarea.
- ⚠ **Una pantalla se llama por lo que DICE, no por lo que es**: «bienvenida» no aparece en la bienvenida de
  Alta. Si ninguna pantalla tiene todas las palabras, `visor-buscar` da las que **abren cada carril** del
  proyecto nombrado.
- **`visor-recursos` baja la resolución ORIGINAL**, la que se subió a Figma, no la exportación de la pantalla.
- El mapa del flujo queda en disco por versión: un comando cuesta un pedido chico a Figma para saber si el
  diseñador guardó algo (~4 s; la primera vez de los siete flujos, ~24 s).
- Sale ≠0 si algo falla: 2 si es de uso, 1 si es de datos.

## El paquete para el modelo: una pantalla, lista para pasar a código

**`make visor-pantalla R=<clave/nodo>`** da en un solo Markdown lo que un modelo necesita para pasarla a Vue
o React (`/api/brief`, en `visor/server/brief.go`): el enlace `visor:` con su huella, el de Figma, el carril y el tamaño; los **textos en orden de
lectura** (sin la barra de estado: que el modelo no invente copy); **a dónde lleva** cada zona; los
controles; los **componentes** con sus variantes; los **tokens** con su variable o clase; lo que el HTML no
traduce; y el **HTML traducido** entero. Nada se escribe a mano.

- Frente a pasarle la API cruda de Figma, la fidelidad es casi la misma, pero con el paquete cuesta **~40 %
  menos tokens y ~3× menos tiempo**, y trae las imágenes y los íconos reales (medido el 2026-09-25 en tres
  pantallas; el detalle, en la skill).
- ⚠ Una pantalla que es casi toda una imagen pegada trae pocos textos: los de la imagen no son texto en Figma.

⛔ **La interfaz no tiene «Para la tarea» ni «Para el modelo»** (Miguel, 2026-09-25): lo que es información
para el modelo va por consola. Si hace falta información nueva, va primero al CLI.

## Qué es y qué no

- **Lee, no escribe.** Todo sale de `connectors/figma` (el mapa es el mismo `bin/pg figma map`); el token
  de Figma no sale del server.
- **El HTML lo traduce `visor/render`** desde el JSON del nodo, y **la imagen de Figma es su vara**:
  `make visor-fidelidad` los compara en Chromium. Lo que no tiene equivalente en CSS (máscaras, modos de
  mezcla, degradados no lineales) no se imita: va al reporte de la traducción.
- **El carril y el título se DEDUCEN** del lienzo. Las reglas están en `connectors/figma/structure.go`: si
  un archivo nuevo sale mal agrupado, se corrige ahí, con su prueba, no en la Vue.
- **Una ruta muerta lo DICE**, no abre otra pantalla; y **el enlace que se copia lleva la huella** del
  contenido de ese momento, así se sabe si la pantalla cambió aunque conserve el id.

## Cómo se comprueba

    make visor-test                      # la traducción (visor/render) y las guardas del server, sin red
    make visor-fidelidad R=<clave/nodo>  # una pantalla: su porcentaje, sin el visor corriendo
    make visor-fidelidad REF='<url>'     # el flujo entero, con el visor corriendo
    make visor-enlaces                   # ¿las pantallas que enlazan las tareas siguen igual, cambiaron o las borraron?
    go test ./connectors/figma/          # las reglas que deducen carriles, títulos y zonas
    make estilo-check                    # el visor es una de las UIs del tema compartido

## Qué deja esto en la tarea

Una pantalla puntual va en un bloque como **`[Título](visor:<clave>/<nodo>@<huella>)`**, que `make
visor-pantalla` da listo en su primer renglón: el tablero lo abre en el visor en esa pantalla, y `make
visor-enlaces` puede decir mañana si cambió o la borraron. Va como tipo propio y no como
`http://localhost:5193/…`, igual que `repo:`: el enlace nombra qué es. Lo que se vio en un diseño va con el
comando que lo reproduce (`bin/pg figma map '<url>'`), no con una captura. A Jira no va la herramienta: va
«el diseño del flujo tiene tal recorrido».
