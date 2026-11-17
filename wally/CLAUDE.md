# Wally — un chat con Gemini por la web de AI Studio, eligiendo el modelo

Para hacerle preguntas a Gemini sin abrir AI Studio: a la izquierda las conversaciones guardadas, al centro la
abierta y, abajo, el campo y el selector de modelo. Cada respuesta dice con qué modelo salió y cuánto tardó.

**Pregunta POR LA WEB, no por la API** (decisión de Miguel, 2026-11-17): cada pregunta la hace `bin/aistudio` (la
receta `jarvis/recipes/aistudio/ask.ts`) en su Chrome con Jarvis, con su cuenta y en un chat temporal de AI Studio
(no queda en el History ni en Drive). Usa el uso gratuito de la web, que acepta textos enormes, y no la cuota de una
llave. La primera versión, del mismo día, llamaba a la API con la llave de `connectors/.env` y se retiró por eso.

| pieza | qué es |
|---|---|
| `make wally` | levanta la interfaz (:5228, Vue) y la API (:5229, Go). En Cockpit es la app Wally |
| `server/main.go` | la API: `GET /api/models`, `GET/DELETE /api/conversations[/<id>]`, `POST /api/ask {id?, model, text}` |
| `src/App.vue` | la interfaz; la ruta es `#/c/<id>` |
| `wally/.data/conversations.json` | lo guardado (fuera de git) |

- **Necesita Jarvis conectado en Chrome** y la sesión de Google de Miguel. Sin eso, la pregunta vuelve con el error de
  la receta.
- **De a una pregunta por vez** (409 si llega otra): Jarvis maneja una pestaña por vez y AI Studio corta si se le pide
  mucho.
- **Cada pregunta abre un chat nuevo**: la conversación anterior viaja en el texto, como transcripción
  (`transcript`). Una conversación larga manda cada vez más.
- **Los modelos** son los de chat que la web ofrece sin «Paid» (`chatModels`, leídos del selector el 2026-11-17); el
  de siempre es Gemini 3.5 Flash Lite. **Cuando Google corta** («Permiso denegado», 403, cuota) la receta deja una
  pausa de 30 min para TODA la cuenta (`*` en `~/.cache/my-tools/aistudio-pausa.json`): el corte es por el ritmo de la
  cuenta, no por modelo (Flash Lite contestó a las 9:48 y a las 9:49 ya no, 2026-11-17). Wally muestra hasta qué hora
  y no deja preguntar.
- **Lo que contesta el modelo se trata como no confiable**: el Markdown se muestra, pero el HTML crudo sale como texto
  y sólo se enlaza a http(s).
- Si falla, la pregunta no se guarda y vuelve al campo para mandarla de nuevo.
