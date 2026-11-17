# Wally — un chat con Gemini por la web de AI Studio, eligiendo el modelo

Para hacerle preguntas a Gemini sin abrir AI Studio: a la izquierda las conversaciones guardadas (con buscador y por
día: Hoy, Ayer, Últimos 7 días, Antes); al centro, **en pestañas, las abiertas** —varias a la vez, cada una con su
borrador y su modelo—, y abajo el campo, que crece con lo escrito. Cada respuesta dice con qué modelo salió, cuánto
tardó y a qué hora; un bloque de código lleva su lenguaje y su «Copiar».

**Las pestañas** siguen la gramática del taller (`tools/ui/README.md`, «documentos abiertos»): un clic en la lista
abre la conversación de paso (itálica, la reemplaza el próximo clic); doble clic, o mandar una pregunta, la deja fija;
«+» abre una nueva; ✕ o el botón del medio la cierran. Se recuerdan en esta máquina (`wally.tabs`). Mientras una
espera respuesta, su pestaña y su fila laten, y en las otras se escribe pero no se manda (las preguntas van de a una).

**Pregunta POR LA WEB, no por la API** (decisión de Miguel, 2026-11-17): cada pregunta la hace `bin/aistudio` (la
receta `jarvis/recipes/aistudio/ask.ts`) en su Chrome con Jarvis, con su cuenta y en un chat temporal de AI Studio
(no queda en el History ni en Drive). Usa el uso gratuito de la web, que acepta textos enormes, y no la cuota de una
llave. La primera versión, del mismo día, llamaba a la API con la llave de `connectors/.env` y se retiró por eso.

| pieza | qué es |
|---|---|
| `make wally` | levanta la interfaz (:5228, Vue) y la API (:5229, Go). En Cockpit es la app Wally |
| `server/main.go` | la API: `GET /api/models`, `GET/DELETE /api/conversations[/<id>]`, `DELETE /api/conversations/<id>/messages/<bloque>`, `POST /api/ask {id?, model, text}` |
| `src/App.vue` | la interfaz; la ruta es la pestaña activa: `#/c/<id>`, o `#/nueva/<n>` para una sin preguntas |
| `wally/.data/conversations.json` | lo guardado (fuera de git) |

- **Necesita Jarvis conectado en Chrome** y la sesión de Google de Miguel. Sin eso, la pregunta vuelve con el error de
  la receta.
- **De a una pregunta por vez** (409 si llega otra): Jarvis maneja una pestaña por vez y AI Studio corta si se le pide
  mucho.
- **La conversación la guarda Wally, en BLOQUES** (idea de Miguel, 2026-11-17): cada pregunta tuya y cada respuesta es
  un bloque con su id. AI Studio no recuerda nada (chat temporal: cada pregunta abre uno nuevo), así que la próxima
  pregunta le manda TODOS los bloques guardados como transcripción (`transcript`) y la pregunta nueva al final.
  **Cualquier bloque se borra** con su tacho (aparece al pasar el mouse), sin confirmación: así se saca contexto que
  no aporta y se queda sólo lo que sirve. Arriba a la derecha, «contexto: N bloques · M caracteres» dice lo que va a
  viajar. Los bloques de antes no tenían id: se les pone al cargar.
- **Los modelos** son dos, elegidos por Miguel para el día a día (2026-11-17) de las fichas del selector: Gemini
  3.8 Flash, el de siempre, y Gemini 4 Hydrogen para lo difícil (`chatModels`). Los dos sin «Paid».
- **Cuando Google corta** («Permiso denegado», 403, cuota) la receta deja una
  pausa de 1 a 5 min, al azar, para TODA la cuenta (`*` en `~/.cache/my-tools/aistudio-pausa.json`): el corte es por el ritmo de la
  cuenta, no por modelo (Flash Lite contestó a las 9:48 y a las 9:49 ya no, 2026-11-17). Wally muestra hasta qué hora
  y no deja preguntar.
- **Lo que contesta el modelo se trata como no confiable**: el Markdown se muestra, pero el HTML crudo sale como texto
  y sólo se enlaza a http(s).
- Si falla, la pregunta no se guarda y vuelve al campo para mandarla de nuevo.
