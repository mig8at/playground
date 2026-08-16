# agents · agentes propios, con Gemini

Banco de pruebas para armar **agentes de verdad** —modelo + herramientas + bucle— y entender cómo
funcionan por dentro. Cada agente es un archivo con dos cosas: **qué herramientas tiene** y **qué se le
pide**. Nada más.

> ⚠ **No confundir con `.claude/agents/`.** Aquella carpeta son *definiciones* que consume Claude Code
> (un `.md` con prompt y lista de herramientas permitidas; el bucle lo pone Claude Code). **Esta** carpeta
> tiene el bucle escrito a mano contra la API de Gemini: acá se ve la mecánica, allá se usa.

## Cómo arrancar

1. Sacá una API key en <https://aistudio.google.com/apikey>.
2. `cp .env.example .env` y pegá la key en `GEMINI_API_KEY`.
3. Probá que la key sirve y mirá qué modelos hay disponibles hoy:

   ```bash
   make agente-modelos
   ```

   Si el modelo por defecto no está en esa lista, poné otro en `GEMINI_MODEL` del `.env`.
4. Corré el primer agente:

   ```bash
   make agente-frontend
   ```

## Las piezas

| archivo | qué es |
|---|---|
| `gemini.py` | el **cliente**: una llamada a la API y el bucle de herramientas. No sabe nada de CreditOp — se reusa para el próximo agente |
| `frontend.py` | el **agente**: sus 4 herramientas + lo que se le pide. Lo único específico |

Esa separación es el punto del ejercicio: **el segundo agente reusa `gemini.py` y solo escribe su
propio archivo**. Ahí es donde «múltiples agentes» deja de ser una idea y pasa a ser dos archivos.

## Cómo funciona un agente, en cuatro líneas

1. Se le manda al modelo **la pregunta + la lista de herramientas** que puede usar.
2. El modelo contesta una de dos cosas: *«llamá a esta función con estos argumentos»* o *«acá está la
   respuesta»*.
3. Si pidió una función, **la corre el código, no el modelo**, y se le manda el resultado.
4. Se repite hasta que conteste texto, o hasta el tope de pasos.

El tope existe por algo: sin él, un modelo que se confunde puede pedir la misma herramienta para
siempre. `MAX_PASOS` es el cinturón.

## La diferencia que más importa: el agente NO tiene una shell

`frontend.py` le da al modelo **cuatro funciones concretas** y ninguna más. No puede correr comandos
arbitrarios, no puede escribir archivos, no puede tocar producción. Si querés que haga algo nuevo,
tenés que **escribir la función** — y en ese momento decidís si es de solo lectura.

Es lo contrario de darle una terminal y confiar. Para un agente que va a correr solo, es la única
forma sensata.

## El agente `frontend`

Contesta **una** pregunta: *¿el frontend está sano hoy, y si no, qué lo rompió?*

Está apuntado a un modo de falla real y repetido de `frontend-monorepo`: los merges de
`fixes-to-production` → `develop` **rompen el empaquetado** (pasó con `form-engine` y con
`@creditop/dynamic-form`). Por eso una de sus herramientas mira específicamente si se tocaron
`package.json` o `pnpm-lock.yaml`.

Sus herramientas, todas de **solo lectura** salvo la última:

| herramienta | qué hace |
|---|---|
| `listar_workspaces` | qué apps, modules y packages hay |
| `commits_recientes` | qué se movió en una rama, quién y qué archivos |
| `cambios_de_dependencias` | si se tocaron `package.json` / `pnpm-lock.yaml` — el disparador conocido |
| `compilar` | corre `turbo run build`. ⚠ **Lenta** (minutos) y la única que escribe algo (artefactos de build) |

## Reglas de esta carpeta

- **Solo lectura sobre los repos de la compañía**, salvo que una herramienta diga lo contrario en su
  nombre y en su docstring.
- **La key nunca se commitea**: `.env` está gitignoreado, `.env.example` es la plantilla versionada.
- Python **3.9** del sistema y **solo stdlib** (`urllib`) — sin `pip install`, sin venv. Misma decisión
  que el credibot de Duncan, y por la misma razón: que arranque sin ceremonia.
