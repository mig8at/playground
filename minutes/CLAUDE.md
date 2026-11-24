# minutes — grabar una reunión sin tomar notas

**Para qué existe:** que una reunión deje un recordatorio sin que nadie tome notas, como un dictado: lo dicho con sus
tiempos, las capturas de lo que se mostraba y las referencias entre ambos («esto que les muestro» → la pantalla que
estaba a la vista). Es una herramienta personal de Miguel, no de CreditOp. Tarea: `tablero/tasks/minutes` (#138).
Prototipo del 2026-11-23.

    bin/minutes start [--title '…'] [--no-mic] [--no-system] [--chunk 15] [--direct]
    bin/minutes live                  la transcripción a medida que sale (Ctrl-C no frena la grabación)
    bin/minutes status
    bin/minutes stop [--no-summary]   frena, termina de transcribir y arma el resumen (~1 min por una reunión corta)
    bin/minutes list · open [carpeta]
    bin/minutes summarize [carpeta] [--remote] [--max-screens 20]
    make minutes CMD=start TITLE='Weekly CT'  ·  make minutes CMD=stop

**La app de Cockpit** (`minutes`, `make minutes`: la interfaz en :5248 y la API `bin/minutes serve` en :5249): el botón
de grabar y frenar y las grabaciones a la izquierda; al centro, en vivo la última captura y, ya frenada, el
recordatorio y los momentos en pantalla; a la derecha (la barra auxiliar), TODA la conversación, como un chat («yo» a la
derecha, «reunión» a la izquierda), también en vivo. Tocar una frase lleva a su pantalla y «Lo dicho» en una pantalla
marca sus frases (decisión de Miguel, 2026-11-23). Usa las mismas funciones que el CLI (`server.go`, con la
guarda de Host y `X-Minutes` como el Llavero); al terminar un resumen avisa por `lib/notice`.

## ⚠ Lo grabado no sale de la Mac

Los audios y las capturas pueden tener datos internos o de clientes. Quedan en `minutes/recordings/<fecha>/`, que está
fuera de git (`minutes/.gitignore`). Whisper y Qwen3-VL corren en esta Mac. Lo único que sale es el texto del resumen,
y sólo con `summarize --remote` (`bin/pg model ask`, el modelo de fondo: el Bedrock de CreditOp). Un servicio externo
se elige a propósito, nunca por defecto. Las capturas incluyen TODA la pantalla, también lo que no era de la reunión.

## Lo que queda en la carpeta

| archivo | qué es | lo escribe |
|---|---|---|
| `frames/<ms>.jpg` + `frames.jsonl` | las capturas que cambiaron (`t` en segundos, `change` = fracción que cambió) | la grabadora |
| `audio/mic/<ms>.wav` · `audio/system/<ms>.wav` | tramos de 15 s, 16 kHz mono; el nombre es su comienzo | la grabadora |
| `recorder.json` · `recorder.log` | pid, comienzo, pantalla; al terminar `ended`, segundos y capturas | la grabadora |
| `transcript.jsonl` | `{start, end, source: mic\|system, text, chunk, echo?}` | `watch` (de fondo) |
| `timeline.json` | las pantallas clave con lo que dijo el modelo y cada frase con la captura a la vista | `summarize` |
| `summary.md` · `summary.html` | el recordatorio: resumen, decisiones, pendientes, momentos en pantalla y la transcripción | `summarize` |

`yo` es el micrófono y `reunión` es el audio del sistema. No hay diarización: dentro de «reunión» no se sabe quién habló.

## Cómo graba sin pisar el micrófono

- **La grabadora es nativa** (`recorder/main.swift`, Swift, armada como `recorder/.build/Minutes.app` por
  `recorder/build.sh`). Usa UN `SCStream` de ScreenCaptureKit para la pantalla (1 cuadro/s, de la pantalla donde está
  el mouse, hasta 1920 de ancho), el audio del sistema (`capturesAudio`, sin el propio) y el micrófono
  (`captureMicrophone`, macOS 15+).
- **El micrófono en macOS se comparte:** abrirlo no se lo quita a la app de la reunión. Lo que sí molesta es el
  procesamiento de voz (voice processing) de AVAudioEngine, que le baja el volumen al resto. No se usa.
- **Descarta lo repetido:** compara una miniatura gris de 64×36 con la última guardada y guarda sólo si cambió más del
  2 % (`--change`). En la prueba quedaron 7 capturas de 54.
- **Permisos:** «Grabación de pantalla y audio del sistema» (también cubre el audio del sistema) y «Micrófono». macOS
  los da a la app RESPONSABLE, por eso `start` la abre con `open`. Está firmada con el certificado de Captura
  («Captura playground local», ver `captura/build.sh`), así que el permiso sobrevive a recompilar. ⚠ La primera vez,
  macOS 26 la **rechazó sin preguntar**: `start` lo detecta, abre el panel de Ajustes y pide prenderla a mano, una sola
  vez. `--direct` la corre como hija de la terminal, con los permisos de la terminal.
- **Se frena** con el archivo `stop` en la carpeta (lo que hace `bin/minutes stop`) o con SIGTERM/SIGINT. SIGHUP se
  ignora.

## Cómo transcribe y cruza

- **Whisper large-v3-turbo** (el del dictado del chat: `whisper-cli` sobre Metal), pedido al registro
  (`models/registry.json`, uso `minutes`). `watch` corre de fondo desde `start`, transcribe cada tramo cuando
  aparece y le pasa como `--prompt` lo último dicho. El texto llega ~15 s detrás de lo dicho.
- **Lo que inventa Whisper:** con silencio escribe «Gracias.» o «Subtítulos…». Por eso un tramo con energía menor que
  `silenceRMS` no se transcribe, y esas frases se tiran (`hallucination`).
- **El eco:** sin audífonos, el micrófono graba los parlantes. Una frase del micrófono cuyas palabras son ≥60 % de una
  del sistema dicha en ±3 s queda `echo` y no se muestra (`markEcho`; `summarize` lo recalcula sobre todo).
- **Las pantallas clave** (`buildScreens`): cada captura vale hasta la siguiente. Es candidata si se vio ≥4 s o si
  mientras estaba alguien dijo «esto», «acá», «les muestro», «como ven»… (`deicticRe`; ⚠ sin `\b`, que en Go es sólo
  ASCII y no cumple «acá»). Quedan las mejores 20.
- **¿Lo dicho habla de la pantalla?** Qwen3-VL-4B (el de `point`, del registro) recibe la captura y lo dicho mientras
  estaba a la vista, y devuelve `seen`, `refers`, `evidence` y `key` (0–3). Corre en su propio llama-server en :5252
  (`lib/llamaserve`, se apaga a los 3 min sin uso). Ronda los 5 s por pantalla.
- **El resumen** (resumen, decisiones, pendientes, citando `[P3]`) lo escribe el mismo modelo, o el de fondo con
  `--remote`. Con 4B hubo que nombrarle qué es una decisión («decidimos», «quedamos en»): sin eso, no la veía.

## Lo probado (2026-11-23)

Una grabación de 54 s con `start --direct`: voz sintética (`say`) por los parlantes y tres páginas en pantalla.
Quedaron 7 capturas, la transcripción del sistema bien y el eco del micrófono marcado. 3 de 3 pantallas señaladas
salieron con `refers` y la frase justa, y apareció la decisión dicha. `stop` → resumen, en 75 s. `go test ./minutes`
cubre el eco, las alucinaciones, la elección de pantallas y el HTML.

Después, con el permiso prendido por Miguel, el camino normal (`start` → Minutes.app) grabó pantalla, micrófono y
sistema igual.

Lo que NO se probó: una reunión real de Meet o Zoom con otras voces, y una
reunión larga: el resumen de lo dicho recorta el medio pasados ~30 mil caracteres, y todavía no resume por partes.

## Lo que falta (en la tarea)

Resumir por partes y, si hace falta, diarización.
