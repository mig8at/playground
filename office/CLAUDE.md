# office — la llamada en papel cortado y los personajes

Una videollamada en grilla, ilustrada en papel cortado, donde se ve trabajar a las personas y a sus agentes. Por ahora
es solo visual: lo que dicen sale de un guion de ejemplo (`SCRIPT` en `index.html`), no del chat real.

| qué | dónde | cómo se abre |
|---|---|---|
| la llamada | `index.html` | `make office` → http://localhost:5220 |
| el editor de personajes | `editor.html` | http://localhost:5220/editor.html (botón «Editar personajes») |
| el CLI de personajes | `cli/personaje.mjs` | `make office-character ESPECIE=gato NOMBRE=Miso` (`OPCIONES=1` lista todo) |
| el paquete para compartir | `paquete/` → `paquete/dist/` | `make office-package`; se comparte la carpeta `dist/` (un JS, ejemplo, README) |
| el dibujo, compartido por los tres | `personajes.js` · `personajes.css` | — |
| hojas de referencia de Gemini (no se calcan) | `generacion/` | `node office/generacion/hoja.mjs <personaje> <salida.jpg>` |

## Cómo está armado

- **Un solo dibujo para todo.** `personajes.js` arma un personaje (`person(p)`) a partir de un objeto plano: especie,
  piel o pelaje, cara, ojos, nariz, dientes, peinado, gorro, extras, chaqueta y fondo. La llamada, el editor y el CLI
  lo cargan tal cual (en Node con `require`), así que lo que sale del CLI es lo que se ve en la llamada.
- **Los gestos los decide el CSS**, no el SVG. El recuadro lleva la clase `tile idle|typing|thinking|talking` y
  `personajes.css` elige la boca que se ve, adónde miran las pupilas, cómo van las cejas y qué se anima. La cabeza y
  el cuerpo se balancean por separado, poquito, como títeres de recortes. El CLI lee ese CSS para escribir las
  animaciones del JSON: no hay una segunda lista que pueda desincronizarse.
- **Las piezas se arman sobre la elipse de la cara** (`pt`, `arc`): el pelo y los gorros abrazan la cabeza en vez de
  flotar. Los gorros son una capa aparte, apoyada según cuánto abulta el peinado (`HAIR_VOL`, `hatLine`).
- **Los animales** (`SPECIES`) cambian la cabeza y conservan la cara animable y la chaqueta. Comparten piezas
  (`ANIMAL`: orejas, bigotes, melena, hocico) y narices (`NOSES`). El pico va aparte (`beak`) y habla como mandíbula.
- **Agregar una pieza** (un peinado, un gorro, una especie) es dibujarla una vez y nombrarla en `OPCIONES`: aparece
  sola en el editor, en el CLI y en «Al azar».

## Reglas

- ⛔ **Personajes originales, siempre.** Nada de personajes con derechos ni sus rasgos (gorras con la inicial,
  corbatas con siglas, overoles…). Se descartaron unos inspirados en un videojuego y se eligieron animales propios.
- **Colores planos de la paleta** (`P` y `--*` en `personajes.css`), sin degradados. La textura de papel es opcional
  (botón «Papel», preferencia en `localStorage`).
- **El servidor no cachea** (`serve.py`): con el servidor simple de Python el navegador mostraba versiones viejas de
  `personajes.js`. Si igual ves algo viejo, recargá con Cmd+Shift+R.
- Los personajes armados en el editor quedan en ese navegador (`office:custom`) y entran a la llamada en lugar de
  invitados de ejemplo. Para dejarlos fijos, se copia su JSON (editor o CLI: `config`) al `CAST` de `index.html`.
- Lo que genera el CLI queda en `office/generados/`, fuera de git.

## El JSON del CLI (`office.personaje.v1`)

`config` es la entrada de `CAST`. `states` trae, por gesto, el SVG animado y la boca que se ve. `animations` lista
qué pieza se anima (`part`), con qué `@keyframes`, cuánto dura y en qué gestos; `poses`, lo que se acomoda sin
animarse (pupilas, cejas). Cada SVG trae su CSS: cambiar el gesto es cambiar la clase del `<svg>` raíz.

## El paquete para compartir (`paquete/`)

`make office-package` arma `paquete/dist/office-personajes.js`: un solo archivo con el dibujo (`personajes.js` tal cual,
encerrado en su alcance), el estilo y el logo, más el componente `<office-personaje config='…' gesto="habla">` (shadow
DOM, no toca el CSS de la página) y las funciones `dibujar`, `svg`, `alAzar`, `personaje` y `OPCIONES`. En Node sólo
están `svg` y `alAzar` (no hay `HTMLElement`). Junto a él quedan `ejemplo.html` (armar el tuyo y copiar su JSON),
`README.md` y un `package.json` que lo declara módulo ES. `dist/` no se versiona (el `.gitignore` del repo ignora toda
carpeta `dist/`): se regenera con `make office-package` justo antes de compartirlo, y así nunca queda atrás de
`personajes.js` o `personajes.css`. `personajes.js` no toca la página
cuando está empacado (la constante `OFFICE_PAQUETE`).

## En el chat: la videollamada

El chat (`chat/`) usa estos personajes: en una conversación donde alguien más tiene personaje, el botón de la cámara del
encabezado cambia el hilo por la videollamada (`chat/src/CallView.vue`), con las personas de la conversación y sus
agentes. Por ahora es sólo visual: todos escuchan. Los personajes viven en `chat/src/characters/`, un JSON por personaje
(`{ name, handle | owner + agent, character }`): para sumar uno se deja su JSON ahí. El dibujo es una copia del paquete,
`chat/src/characters/office-characters.js`, que se regenera con `make office-package JS=chat/src/characters/office-characters.js`.
**Las voces** (`chat/src/callVoice.js`, servidor `chat/server/voice.go` y `voice_gemini.go`): cada mensaje lo dice
quien lo escribió y la boca se abre con el volumen real del audio. Tres motores, que el botón de la videollamada recorre (sólo
los que tienen llave): Gemini (`gemini-3.8-flash-lite-tts`, ~3 s la primera vez, ~US$0,0012 por mensaje de 8 s; el texto
va a Google; 10 pedidos por minuto y 100 por día por modelo, con respaldo en otros dos), ElevenLabs (por su conector,
`connectors/elevenlabs`, `bin/pg elevenlabs usage|voices|say`; gasta créditos del plan) y Local (`say` de macOS, gratis,
nada sale). Si el elegido falla, la frase sale con la voz local. Cada frase se guarda una vez. ⚠ A Gemini va SÓLO el texto: una instrucción de
estilo la leen en voz alta los modelos 3.8 y no aceptan `systemInstruction`. Cambiar el servidor pide `make chat-install`
(y aceptar el permiso de Escritorio de macOS rápido: si tarda, Cockpit levanta su copia vieja y se queda con el puerto).

Para verlo en Cockpit basta compilar la interfaz (`cd chat && npm run build`): el servidor del chat sirve `chat/dist`
desde el disco, así que no hace falta reinstalarlo; se recarga la vista del chat y listo.

