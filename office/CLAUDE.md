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
- **Los fondos son cuartos** (`ROOMS`, 2026-11-12: oficina, estudio, noche, sala, reunión): pared con zócalo, una ventana
  con su vista recortada por el marco, un mueble a un lado y el respaldo de la silla detrás de los hombros. Los
  paisajes de antes siguen en `SCENES` (el editor los ofrece), pero para el trabajo se usan los cuartos.
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
**Las voces** (`chat/src/callVoice.js`, servidor `chat/server/voice.go` y `voice_elevenlabs.go`, por el conector
`connectors/elevenlabs`): MIENTRAS LA VIDEOLLAMADA ESTÁ ABIERTA, cada mensaje que llega lo dice quien lo escribió, con
su voz de ElevenLabs (`voice` del JSON); varios a la vez esperan su turno y no se pisan; lo tuyo y lo que llegó antes de
abrirla no se lee. La boca se abre con el volumen real del audio. Las menciones se dicen por el nombre («@miguel/luigi» →
«Luigi», «@todos» → «todos») y los nombrados reaccionan mientras suena (recuadro marcado, miran arriba, 👋); si nombrás
vos a alguien, ése reacciona unos segundos. También cuenta el nombre al empezar, sin @ («Luigi, te envío…»), y en un
mensaje dirigido los demás siguen en lo suyo (teclean, un poco apagados). De cada mensaje se dice sólo lo conversado (`chat/src/callSpeech.js`: hasta ~40 s,
~650 caracteres; las listas punto por punto; sin títulos, tablas ni código); un adjunto lo tienen en la mano LOS QUE LO RECIBEN (los nombrados o, si no nombró a nadie,
todos los demás): una hoja, una foto, el llavero (claves, que no se leen) o una hoja que corre (lo largo), mirándolo
mientras quien lo mandó habla y unos segundos después. Cómo deben escribir los agentes: [`chat/CLAUDE.md`](../chat/CLAUDE.md). Cada frase se guarda una vez. Costo medido
(2026-11-12, `eleven_flash_v2_5`): ~0,2 créditos por carácter, ~30 por mensaje de 150 caracteres. **Topes para no gastar de más**:
cada mensaje se dice hasta ~40 s; uno de más de 150 palabras no se manda a la voz (se silencia: 🔇 sobre quien lo
mandó y «mandó algo muy largo: quedó en el chat»); la fila de voces no pasa de 24 frases (lo que no entra, igual); y el
servidor tiene un tope diario (`chat/server/voice_budget.go`, 20.000 caracteres, `CHAT_VOICE_DAILY_CHARS`; lo cacheado
no cuenta; `GET /api/voice` dice cuánto se usó). El tope de palabras se elige en el perfil del chat (Voz: 80, 150, 250 o 400; por
defecto 150) y vale también para el ▶ de cada mensaje, que ahora lee con ElevenLabs (`chat/src/speech.js`, voz a
elegir, por defecto Lina); un mensaje que lo pasa lleva un parlante tachado en vez del ▶. Las voces de macOS y Gemini se quitaron ese día. Funciona también en grupos (sólo salen sus miembros): `#oficina` es el de prueba, con Luigi,
Wario y Leo. ⚠ Un agente que habla con `playground send --as` llega sin decir qué agente es (el historial no lo
guarda) y no suena: para que suene, `bin/chat send … --as <agente>`. **La línea de tiempo** (abajo de la llamada, como la de un video en directo): una línea limpia con lo escuchado relleno
y un cabezal donde vas, sin marcas (hacían ruido). Cada mensaje tiene su lugar parejo a lo largo (por hora real los
huecos de horas apretarían todo) y al final está el directo. Se toca o arrastra en cualquier parte: el cabezal salta al
mensaje más cercano, arriba dice quién y cuándo, y al soltar suena de corrido; llevarlo hasta el final es volver al
directo. ⏮ desde el primero, ⏯ pausa, ← y → con el teclado. Repetir no gasta: las frases quedan guardadas JUNTO AL HISTORIAL
(`~/Library/Application Support/creditop-playground-chat/voice`, no en la caché de macOS, que se puede vaciar; la
primera vez se mudó lo de la caché vieja). Cambiar el servidor pide `make chat-install` (y
aceptar rápido el permiso de Escritorio de macOS: si tarda, Cockpit levanta su copia vieja y se queda con el puerto).

Para verlo en Cockpit basta compilar la interfaz (`cd chat && npm run build`): el servidor del chat sirve `chat/dist`
desde el disco, así que no hace falta reinstalarlo; se recarga la vista del chat y listo.

