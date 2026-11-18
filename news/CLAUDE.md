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
| la interfaz | `src/App.vue` · `src/style.css`, con la base de `tools/ui` (`make style-sync`); los colores de cada tema son propios (`--t-*`) |
