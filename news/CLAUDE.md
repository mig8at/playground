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

## Cómo está armada la pantalla (el taller, 2026-11-19)

Usa las regiones de `tools/ui` y nada propio para dividir la pantalla:

- **El sidebar son cuatro vistas** (`sidebar en-bloques` y `.view`, como el del chat): **Semana** (las semanas y, con
  su encabezado de grupo, los temas), **Favoritos**, **Instalados** e **Investigación**. Cada una se pliega con su
  encabezado y scrollea sola; las abiertas se reparten el alto, salvo Instalados, que mide lo que tiene (hasta un
  tercio). Lo abierto queda en `news.sidebar-views`. Los encabezados llevan el dato que resume la vista (la semana, el
  conteo, lo que ocupan los instalados o qué máquina es) y su acción frecuente (actualizar la semana, volver a medir).
- **La consola** (la región `panel`, abajo del editor; arranca cerrada y se abre con su botón del pie o tocando el
  contador de avisos). Tres pestañas:
  - **Actividad**: la bitácora del servidor (`server/activity.go`, `GET /api/activity`): cada actualización paso a
    paso, lo medido en Hugging Face, lo borrado. Vive en memoria, los últimos 200 renglones desde que arrancó.
  - **Esta Mac / Este PC** (`GET /api/machine`): procesador, memoria, GPU y con qué acelera; los motores para correr
    modelos y si están; y en qué carpetas se buscan los instalados.
  - **Avisos**: lo que pide atención ahora, con qué hacer (sin sesión del modelo de fondo, semana incompleta, una
    sección que no cargó, un motor que falta y cuántos favoritos lo piden). Sale de lo que la interfaz ya sabe.
- **El pie quedó corto**: de cuándo es lo de Hugging Face, el contador de avisos y «Actualizar». El detalle de un
  error largo (el del modelo de fondo) ya no se corta ahí: está en Avisos.

## Dos máquinas: la Mac y el PC

El repo es uno y News se abre en dos máquinas: la Mac (Apple Silicon, donde se probaron los modelos) y el PC con Linux
(una GPU NVIDIA con su propia memoria). Desde el 2026-11-19 News pregunta en cuál está (`lib/machine`: `mac` · `pc`, con
su RAM, su GPU y con qué acelera: `mps`, `cuda` o `cpu`) y habla de ESA: «Instalados» y «Ningún modelo en…» dicen «la
Mac» o «el PC», y cada favorito trae si corre acá (`here`, que calcula `server/fits.go`).

- **En la Mac no cambia nada**: `here` es lo que dice `mac` en `favorites.json`, y la interfaz se ve como antes.
- **En el PC** casi nada está probado, así que se **estima por tamaño**: los parámetros a media precisión (2 bytes) y
  cuantizados a 4 bits (~0,6), con 20 % de margen, contra la memoria de la GPU y el 70 % de la RAM. Da `yes` (entra en
  la GPU), `slow` (corre en la RAM), `no` o `unknown` (la ficha no dice el tamaño), siempre con el porqué. Un repo en
  formato de Apple (`mlx-community/…`, `-mlx`, Core ML) es `no` en el PC. La ficha muestra las dos filas, «En la Mac» y
  «En el PC», y dice cuándo es una estimación.
- **Cuando algo se prueba en el PC se escribe `pc`** en el favorito (`yes` · `no` · `unknown`): manda sobre la cuenta,
  igual que `mac` en la Mac. `triedIn` (`mac` · `pc`) dice en qué máquina se probó; sin él es la Mac, que es donde se
  probó todo hasta ese día. Los dos campos son opcionales: un `favorites.json` sin ellos sigue siendo válido.
- **Lo medido en Hugging Face** (`server/facts.go`, 2026-11-19): por cada favorito se piden a la API pública sus
  parámetros (`safetensors.total` o `gguf.total`), el tamaño de cada archivo `.gguf` y el del repo entero, y de ahí con
  qué se corre (llama.cpp, PyTorch, MLX, ONNX). Queda en `news/.data/facts.json`, fuera de git —cada máquina el suyo—,
  se renueva a la semana y se baja de fondo, de a cuatro: la primera vez la interfaz dice «Midiendo…» y vuelve a
  pedir. Con eso la cuenta usa el peso REAL del GGUF (un 27 B de 1 bit pesa 5,5 GB y entra en 8 GB de GPU, aunque por
  parámetros diera «lento»), se completa el tamaño que la ficha escrita a mano no trae, y la ficha dice «En disco» y
  «Se corre con», con si esa máquina tiene el motor y cómo instalarlo. Lo declarado (`mac`, `pc`) sigue mandando.
- **Lo que la cuenta todavía no ve**: lo que el modelo pida aparte de memoria, y los repos que no declaran tamaño en
  ningún lado (quedan `unknown`). Es para orientarse, no para decidir sin probar.
- **Para sumar una máquina** (otro id): un caso en `lib/machine` y, si se quiere declarar a mano, su campo en `Favorite`.

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

## La investigación: cómo mejoran los modelos (`#/research`)

Para entender cómo se calibran y se mejoran los modelos, cómo trabaja la comunidad y con qué máquinas (Miguel,
2026-11-19: «si se necesitan grandes data centers o si hay personas que lo han logrado con una Mac»). En el sidebar,
bajo «Investigación», junto a Papers:

- **Cómo mejoran** (`#/research`): cada idea que mejoró modelos (LoRA, destilación, cuantización, RLHF, DPO, mezcla de
  expertos…) es una tarjeta con el problema que resolvió, la idea, **la evidencia** (la cifra del paper, antes y
  después) y **la máquina que hizo falta** (`hardware`: `mac` · `gpu` · `server` · `datacenter` · `unknown`), agrupadas
  por etapa (datos, arquitectura, entrenamiento, calibrar y alinear, achicar y acelerar, al usarlo) y filtrables por
  máquina. Su ficha suma cómo se hace en esta Mac (`mac`), quién lo logró con poco (`cheap`), **lo que medimos acá**
  (`ours`, de nuestras pruebas) y los favoritos que la usan (`models`).
- **Evolución** (`#/research/lineages`): familias de modelos paso a paso (LLaMA y la comunidad, DeepSeek, GPT-3 a
  ChatGPT, Whisper), con la idea que entró en cada salto; tocar una idea abre su ficha.
- **Hecho con poco** (`#/research/cheap`): lo que se hace en esta Mac, lo que se entrenó en grande y acá sólo se usa, y
  quién lo logró con una GPU o unos cientos de dólares.

Vive en `news/research.json`, en git, escrito a mano por Claude: **cada cifra sale del resumen de su paper o de la ficha
del modelo, con el enlace**; lo que la fuente no dice no se escribe (si la máquina no se publicó, `unknown`). `GET
/api/research` lo sirve y `TestResearchFileIsValid` falla con una idea sin problema, idea, evidencia o paper, con una
etapa o máquina desconocida, con un favorito que no existe o con un linaje que cita una idea que no existe.

## Los instalados

En el sidebar, «Instalados» lista lo que hay EN LA MÁQUINA DONDE ESTÁ ABIERTO (la Mac o el PC) de los modelos que probamos, con su tamaño y una papelera (el
primer toque pregunta en la misma fila y el segundo borra: los diálogos del navegador no siempre aparecen dentro de
Cockpit). Sale de tres lugares, siempre los mismos (`server/installed.go`):

- la caché de Hugging Face (`$HF_HUB_CACHE`, `$HF_HOME/hub` o `~/.cache/huggingface/hub`): un modelo por carpeta, con el
  tamaño de su carpeta (los blobs viven adentro: antes se sumaban además por los enlaces de los snapshots y salía
  el doble). Un blob que comparten dos modelos no se borra con uno solo;
- los GGUF de `~/.cache/my-tools/models` (llama-server), agrupados por modelo: el peso y su proyector juntos;
- los entornos: cada carpeta de `~/.cache/my-tools` con un venv (el código y las librerías de algo que se probó);
- los modelos de whisper.cpp de `~/.cache/whisper` (el dictado del chat usa `ggml-large-v3-turbo-q5_0.bin`).

`DELETE /api/installed?key=…` sólo borra una clave que salió de esa misma lista, sólo dentro de esas carpetas, pide
`force=1` si la usa una herramienta del registro (responde 409 sin él: antes el aviso vivía sólo en la pantalla) y pide el
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
| la investigación: las ideas, los linajes y su ruta | `research.json` · `server/research.go` |
| los instalados: la API, sobre `lib/models` y el registro | `server/installed.go` (las pruebas, en `lib/models`) |
| la interfaz | `src/App.vue` · `src/style.css`, con la base de `tools/ui` (`make style-sync`); los colores de cada tema son propios (`--t-*`) |
