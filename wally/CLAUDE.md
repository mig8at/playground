# Wally — un chat con Gemini, eligiendo el modelo

Para hacerle preguntas a Gemini sin abrir AI Studio: a la izquierda las conversaciones guardadas, al centro la
abierta y, abajo, el campo y el selector de modelo. Se puede cambiar de modelo en medio de una conversación: cada
respuesta dice con cuál salió y cuánto tardó. Nació el 2026-11-17, después de aprender AI Studio con Jarvis (su flujo
está en `jarvis/flows/aistudio-google-com/`).

| pieza | qué es |
|---|---|
| `make wally` | levanta la interfaz (:5228, Vue) y la API (:5229, Go). En Cockpit es la app Wally |
| `server/main.go` | la API: `GET /api/models`, `GET/DELETE /api/conversations[/<id>]`, `POST /api/ask {id?, model, text}` |
| `src/App.vue` | la interfaz; la ruta es `#/c/<id>` |
| `wally/.data/conversations.json` | lo guardado (fuera de git) |

- **La llave y la llamada son las del conector** (`connectors/gemini`, `GEMINI_API_KEY` de `connectors/.env`): Wally
  no guarda credenciales. Cada pregunta manda la conversación ENTERA (`Converse`): la API de Gemini no recuerda nada
  entre llamadas, así que una conversación larga cuesta más en cada vuelta.
- **Qué modelos salen**: los que la llave puede usar (`bin/pg gemini models`) menos los que no contestan texto en una
  conversación (voz, imagen, audio, transcripción, agentes como Deep Research). El filtro es `chatModel`; si aparece
  un modelo nuevo que no sirve para conversar, va ahí. Se piden a Google una vez cada 10 min.
- **Lo que contesta el modelo se trata como no confiable**: el Markdown se muestra, pero el HTML crudo sale como texto
  y sólo se enlaza a http(s).
- Si Gemini falla, la pregunta no se guarda y vuelve al campo para mandarla de nuevo.
- Lo que el conector sabe hacer y Wally todavía no muestra: búsqueda en Google, URL context, ejecución de código y
  salida JSON (`bin/pg gemini ask --search|--url-context|--code|--schema`).
