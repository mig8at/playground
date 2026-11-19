# point — dónde tocar en una captura

**Para qué existe:** pasarle una captura y una pregunta («¿dónde le doy para continuar?», «el botón de pagar») y que
devuelva el punto donde tocar, en píxeles de la imagen (Miguel, 2026-11-18). Es lo que un modelo de lenguaje grande hace
caro y lento; un modelo de visión chico lo hace en la Mac, sin red. Herramienta personal de my-tools.

    bin/point captura.png '¿dónde le doy para continuar?'      → 639 566
    bin/point captura.png 'el botón de pagar' --box             → 881 275  (recuadro 826,259–936,292)
    bin/point captura.png 'el botón de pagar' --mark marcada.png   (una copia con el recuadro y el punto dibujados)
    bin/point captura.png 'exportar a Excel' --json           → {"found":false,…}   (sale 3: no está en la pantalla)
    bin/point status · bin/point stop
    make point IMG=captura.png Q='…' [JSON=1]

- **Le pide al modelo el recuadro del control a tocar y el punto es su centro** (desde el 2026-11-19: 39 de 42 contra 37
  pidiendo el punto directo). `--box` imprime también el recuadro; `--json` lo trae siempre, con el ancho y alto de la
  imagen, la respuesta cruda y los segundos. `--mark <png>` guarda la imagen con el recuadro y el punto dibujados.
- **Sale 0** con el punto, **3** si el modelo dice que no está (no inventa un lugar: así se le pide), **1** si falló.
- **El modelo es Qwen3-VL-4B** (`Qwen/Qwen3-VL-4B-Instruct-GGUF`, oficial, Apache 2.0; Q4_K_M + su proyector, 3 GB en
  `~/.cache/my-tools/models`) en `llama-server` (Homebrew), en `127.0.0.1:5251`. **Se levanta solo** con la primera
  pregunta (~4 s) y **se apaga solo** a los 15 minutos sin uso (`point serve` lo vigila; su log en
  `~/.cache/my-tools/point/server.log`). Ocupa ~3 GB de memoria mientras está arriba.
- **Cuánto tarda:** 2–3 s una captura nueva; ~0,5 s otra pregunta sobre la misma captura (llama-server guarda la imagen
  ya leída).
- Las coordenadas que da el modelo van de 0 a 1000 y se pasan a píxeles con el tamaño real de la imagen: sirve
  cualquier tamaño (probado a 1280×800 y 390×844). PNG o JPEG.

## Cómo se eligió (2026-11-18)

La vara está en `eval/`: 42 preguntas en español sobre 10 capturas (Panel Andino y las tareas de práctica de Jarvis, el
login del wizard en escritorio y en teléfono, una página de Hugging Face y una de GitHub), cada una con la **caja real
del elemento sacada del DOM**; acierta si el punto cae adentro. 24 fáciles (botones con texto) y 18 difíciles (íconos
sin texto, enlaces chicos, una página densa y 3 preguntas por cosas que NO están). `python3 -I point/eval/run.py` la
corre contra `bin/point`, y `python3 -I point/eval/gallery.py` dibuja lo que dio en `point/eval/gallery.html` (cada
pregunta con el recuadro y el punto del modelo y la caja real), para verlo.

| modelo | fáciles | difíciles | tiempo |
|---|---|---|---|
| UI-Venus-2-9B (especialista, inclusionAI) | 24/24 | 16/18 | 6–9 s |
| **Qwen3-VL-4B (general)** | 24/24 | 15/18 | 2–3 s (0,3 s repetida) |
| Holo2-4B (especialista, H Company) | 22/24 | 11/18 | igual |
| GUI-Owl-1.5-2B (especialista, mPLUG) | 18/24 | 8/18 | más rápido |

Los cuatro con el mismo prompt (el del recetario de Holo2; todos son de la familia Qwen3-VL). Se quedó Qwen3-VL-4B: casi
lo de UI-Venus, de 3 a 30 veces más rápido. Los otros tres se borraron de la caché.

**Con el comando tal como quedó (2026-11-19): 39 de 42** (24 fáciles, 15 difíciles), y el recuadro cubre en mediana el
84 % del elemento real (IoU 0,84). Pidiendo el punto directo daba 37: pedirle «no está» le había costado dos fáciles, y
el recuadro las recuperó. Pedirlo como «el elemento» devolvía la tarjeta entera que contiene al botón; como «el control
a tocar, ajustado», el botón. Las tres que falla: el ícono de copiar y dos de las tres que no están, donde inventa un
lugar.

- ⚠ **Los íconos chicos sin texto** (el de copiar de Hugging Face, 14 px) no los acertó ningún modelo.
- ⚠ **«No está» acierta 2 de 3**: ante una acción que importa, confirmá con la captura antes de tocar.
- 42 preguntas comparan modelos; no son una tasa de aciertos para prometer.

## Cómo está construido

| pieza | dónde |
|---|---|
| el comando, el prompt y el servidor que se levanta y se apaga solo | `main.go` (pruebas en `main_test.go`) |
| la vara: capturas, preguntas con su caja y el script | `eval/` |
