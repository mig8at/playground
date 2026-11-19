# point — dónde tocar en una captura

**Para qué existe:** pasarle una captura y una pregunta («¿dónde le doy para continuar?», «el botón de pagar») y que
devuelva el punto donde tocar, en píxeles de la imagen (Miguel, 2026-11-18). Es lo que un modelo de lenguaje grande hace
caro y lento; un modelo de visión chico lo hace en la Mac, sin red. Herramienta personal de my-tools.

    bin/point captura.png '¿dónde le doy para continuar?'      → 639 566
    bin/point captura.png 'exportar a Excel' --json           → {"found":false,…}   (sale 3: no está en la pantalla)
    bin/point status · bin/point stop
    make point IMG=captura.png Q='…' [JSON=1]

- **Sale 0** con el punto, **3** si el modelo dice que no está (no inventa un lugar: así se le pide), **1** si falló.
  `--json` agrega el ancho y alto de la imagen, la respuesta cruda y los segundos.
- **El modelo es Qwen3-VL-4B** (`Qwen/Qwen3-VL-4B-Instruct-GGUF`, oficial, Apache 2.0; Q4_K_M + su proyector, 3 GB en
  `~/.cache/my-tools/models`) en `llama-server` (Homebrew), en `127.0.0.1:5251`. **Se levanta solo** con la primera
  pregunta (~4 s) y **se apaga solo** a los 15 minutos sin uso (`point serve` lo vigila; su log en
  `~/.cache/my-tools/point/server.log`). Ocupa ~3 GB de memoria mientras está arriba.
- **Cuánto tarda:** 2–3 s una captura nueva; ~0,3 s otra pregunta sobre la misma captura (llama-server guarda la imagen
  ya leída).
- Las coordenadas que da el modelo van de 0 a 1000 y se pasan a píxeles con el tamaño real de la imagen: sirve
  cualquier tamaño (probado a 1280×800 y 390×844). PNG o JPEG.

## Cómo se eligió (2026-11-18)

La vara está en `eval/`: 42 preguntas en español sobre 10 capturas (Panel Andino y las tareas de práctica de Jarvis, el
login del wizard en escritorio y en teléfono, una página de Hugging Face y una de GitHub), cada una con la **caja real
del elemento sacada del DOM**; acierta si el punto cae adentro. 24 fáciles (botones con texto) y 18 difíciles (íconos
sin texto, enlaces chicos, una página densa y 3 preguntas por cosas que NO están). `python3 -I point/eval/run.py` la
corre contra `bin/point`.

| modelo | fáciles | difíciles | tiempo |
|---|---|---|---|
| UI-Venus-2-9B (especialista, inclusionAI) | 24/24 | 16/18 | 6–9 s |
| **Qwen3-VL-4B (general)** | 24/24 | 15/18 | 2–3 s (0,3 s repetida) |
| Holo2-4B (especialista, H Company) | 22/24 | 11/18 | igual |
| GUI-Owl-1.5-2B (especialista, mPLUG) | 18/24 | 8/18 | más rápido |

Los cuatro con el mismo prompt (el del recetario de Holo2; todos son de la familia Qwen3-VL). Se quedó Qwen3-VL-4B: casi
lo de UI-Venus, de 3 a 30 veces más rápido. Los otros tres se borraron de la caché.

**Con el comando tal como quedó: 37 de 42** (22 fáciles, 15 difíciles). Pedirle que diga «no está» le costó dos de las
fáciles: un clic que erró por 10 px y una casilla chica que dijo que no estaba. Se dejó así a propósito: un punto
inventado sobre algo que no existe es peor que un «no está».

- ⚠ **Los íconos chicos sin texto** (el de copiar de Hugging Face, 14 px) no los acertó ningún modelo.
- ⚠ **«No está» acierta 2 de 3**: ante una acción que importa, confirmá con la captura antes de tocar.
- 42 preguntas comparan modelos; no son una tasa de aciertos para prometer.

## Cómo está construido

| pieza | dónde |
|---|---|
| el comando, el prompt y el servidor que se levanta y se apaga solo | `main.go` (pruebas en `main_test.go`) |
| la vara: capturas, preguntas con su caja y el script | `eval/` |
