# news — News, lo nuevo de Hugging Face cada semana

**Para qué existe:** saber qué salió en Hugging Face cada semana sin buscarlo, y tener documentados los modelos que
importan (Miguel, 2026-11-18: «documentar los modelos existentes y ver qué es lo más innovador de cada semana»). Es una
herramienta personal de my-tools, no de CreditOp.

`make news` (UI :5240 · API :5241) o la app **News** de Cockpit. A la izquierda las **semanas** y los **temas** (Texto,
Multimodal, Imagen y video, Audio y voz, Otros), cada uno con su ícono y su color; al centro la **portada** de la semana:
lo más innovador (con por qué importa), los modelos nuevos que entraron en tendencia, los que siguen subiendo aunque no
sean de la semana y los papers más votados; a la derecha la **ficha** del modelo elegido: tarea, fecha, tamaño,
licencia, formatos, librería, idiomas, base, tendencia, y qué hace y qué trae de nuevo. Rutas: `#/<semana>` (p. ej.
`#/2026-W47`). Por consola: `make news ONCE=1` actualiza la semana de hoy y dice qué eligió.

## Los favoritos (`#/favorites`)

Modelos curiosos que se guardan para no perderlos de vista (Miguel, 2026-11-19: «no necesariamente para el trabajo, pero
interesantes, y que puedan correr en la máquina»). Arriba en el sidebar, «Favoritos», con un grupo por tipo (Ya
probados, Voz que conversa, Música y sonido, Rarezas, Diminutos, Detectores raros, Para crear, Especialistas, Piden GPU
NVIDIA); al centro una tarjeta por modelo con lo que hace y si corre en la Mac; a la derecha su ficha: tarea, tamaño,
licencia, si corre en la Mac, qué hace, por qué es interesante, ideas y, si lo probamos, lo que dio.

- **Viven en `news/favorites.json`, en git**: no salen de una semana, así que sobreviven al cambio de semana. Los elige
  y los escribe Claude, a mano, después de leer la ficha de cada modelo en Hugging Face; los datos (tamaño, licencia,
  fecha) salen de su API. `GET /api/favorites` los sirve y se niega a uno a medio escribir (sin id, grupo, qué hace o
  por qué); `TestFavoritesFileIsValid` falla con un error de tipeo en el archivo.
- **«Corre en la Mac» (`mac`: yes · no · unknown) es lo que dice la ficha o lo que sale de su tamaño**, no una prueba:
  `tried` es lo único medido.
- **Los probados son el historial** (grupo `tried`, una tabla arriba de todo): cuándo se probó (`triedOn`), si vale la
  pena o se descartó y se borró (`verdict`: `keep` · `dropped`, con `verdictWhy`), qué herramienta lo usa (`usedBy`) y
  qué claves de «Instalados» son suyas (`installed`), para ver cuánto ocupa y borrarlo desde su ficha. Uno descartado
  se queda en el historial aunque ya no esté en la Mac.
- Para sumar uno: agregarlo al archivo con su `group` (`tried`, `voice`, `music`, `odd`, `tiny`, `detect`, `create`,
  `specialist`, `gpu`); la interfaz lo toma al recargar.

## Los instalados

En el sidebar, «Instalados» lista lo que hay en la Mac de los modelos que probamos, con su tamaño y una papelera (el
primer toque pregunta en la misma fila y el segundo borra: los diálogos del navegador no siempre aparecen dentro de
Cockpit). Sale de tres lugares, siempre los mismos (`server/installed.go`):

- la caché de Hugging Face (`$HF_HUB_CACHE`, `$HF_HOME/hub` o `~/.cache/huggingface/hub`): un modelo por carpeta, con el
  tamaño de los blobs a los que apuntan sus snapshots. Un blob que comparten dos modelos no se borra con uno solo;
- los GGUF de `~/.cache/my-tools/models` (llama-server), agrupados por modelo: el peso y su proyector juntos;
- los entornos: cada carpeta de `~/.cache/my-tools` con un venv (el código y las librerías de algo que se probó);
- los modelos de whisper.cpp de `~/.cache/whisper` (el dictado del chat usa `ggml-large-v3-turbo-q5_0.bin`).

`DELETE /api/installed?key=…` sólo borra una clave que salió de esa misma lista, sólo dentro de esas carpetas, y pide el
encabezado `X-News: 1` (una página de otro origen no puede mandarlo sin preguntar). Lo que usa otra herramienta se marca con su
nombre y lo dice antes de borrar: sale del registro `models/registry.json`, el mismo que lee `bin/models`
([`models/CLAUDE.md`](../models/CLAUDE.md)). La búsqueda y el borrado son de `lib/models`, compartidos con ese CLI. Borrar no se deshace: se vuelve a bajar.

## Cómo lo arma

- **La semana es la ISO**, de lunes a domingo. La de hoy se actualiza **cada 6 horas** mientras el servidor corre (y al
  tocar «Actualizar» en el pie); al cambiar de semana, la anterior queda como estaba en su última actualización. Cada
  semana es un archivo: `news/.data/weeks/<año>-W<semana>.json` (fuera de git).
- **Los datos son de la API pública de Hugging Face, sin cuenta**: los 100 modelos en tendencia (`/api/models?sort=
  trendingScore`), la ficha de los creados en la semana y de los primeros 8 (`/api/models/<id>`: licencia por el tag
  `license:`, parámetros por `safetensors.total`, idiomas y base por `cardData`, formatos por los archivos), el comienzo
  del README de cada nuevo (`/<id>/raw/main/README.md`, 5.000 caracteres sin el YAML ni HTML) y los papers de cada día
  de la semana (`/api/daily_papers?date=`; sin fecha devuelve sólo los últimos, por eso va día por día). «Nuevo» es
  creado dentro de la semana.
- **Los textos, con el modelo de fondo** (`lib/background`: Claude en el Bedrock de CreditOp por defecto, el elegido en
  Cockpit). Dos preguntas por actualización: una con los modelos nuevos y sus README (elige el más innovador —«el que
  trae algo realmente nuevo, no el más popular»— y escribe qué hace y qué trae cada uno, y si la licencia permite uso
  comercial) y otra que pasa al español los 25 papers más votados. Sólo viaja lo público de Hugging Face. Medido el
  2026-11-18: una actualización completa tarda ~70 s.
- **No se le vuelve a preguntar si no cambió la lista** (`fingerprint`: los ids de los nuevos y de los papers): si es la
  misma, los textos de antes pasan a la versión nueva (`carry`). Si el modelo falla, la semana se guarda igual con los
  textos de la vez anterior y el error en el pie.
- ⚠ Lo que escribe sale del README, que es lo que el autor dice de su modelo: las cifras no están verificadas. El
  prompt le pide no afirmar lo que la ficha no dice.

## Cómo está construido

| pieza | dónde |
|---|---|
| la API, las semanas guardadas y la actualización cada 6 h | `server/main.go` (pruebas en `server/main_test.go`) |
| traer la semana de Hugging Face | `server/hf.go` |
| los textos con el modelo de fondo | `server/write.go` |
| los favoritos: el archivo y su ruta | `favorites.json` · `server/favorites.go` |
| los instalados: la API, sobre `lib/models` y el registro | `server/installed.go` (las pruebas, en `lib/models`) |
| la interfaz | `src/App.vue` · `src/style.css`, con la base de `tools/ui` (`make style-sync`); los colores de cada tema son propios (`--t-*`) |
