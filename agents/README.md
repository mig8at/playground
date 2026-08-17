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
| `gemini.py` | el **cliente**: una llamada a la API y el bucle de herramientas. No sabe nada de CreditOp — lo reusan todos |
| `frontend.py` | el primero: ¿el frontend está sano hoy? 4 herramientas |
| `seleccion.py` | **no contesta**: dice qué archivos habría que leer, y por qué. Sólo ve índices |
| `contraste.py` | el segundo seleccionador: elige lo que el primero NO miró. Tiene prohibido repetir |
| `lector.py` | lee lo que eligieron los otros + los nodos de `context/`, y concluye. Recorta a 300k tokens |
| `contexto.py` | el que rutea solo: entra por `context/`, decide qué necesita y recién ahí contesta |
| `datos.py` | el que **mide**: base de datos y logs reales, un ambiente por corrida |

Esa separación es el punto del ejercicio: **cada agente nuevo reusa `gemini.py` y solo escribe su
propio archivo**. Ahí es donde «múltiples agentes» deja de ser una idea y pasa a ser un archivo más.

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

## El agente `datos` — el único que no lee código

Todos los demás contestan **qué dice el código**. Eso deja afuera la mitad de las preguntas reales:
*¿esto pasa? ¿cuántas veces? ¿desde cuándo? ¿qué le pasó a ESTA solicitud?* Un `if` que existe puede no
haber disparado nunca — **una rama muerta se lee igual que una caliente**.

```bash
make agente-datos PREGUNTA='¿cuántas solicitudes quedan en estado 3?'                 # local
make agente-datos TARGET=prod PREGUNTA='¿esto pasa de verdad, y cuánto?'              # la fuente válida
```

**Un ambiente por corrida**, y las herramientas no reciben `target`: lo fija quien lanza y el agente no
lo puede cambiar. Así cada número tiene procedencia inequívoca — no existe el «¿ese conteo era de prod
o del dev compartido?», que es lo que vuelve inútil una medición. Para comparar dos ambientes, dos
corridas.

**Por qué se puede soltar contra producción:** la guarda de solo-lectura no está en el prompt, está en
Go (`trazador/server/sql.go`, `esSoloLectura`) — exige `SELECT`/`WITH`, prohíbe multi-sentencia, los
verbos de escritura y el `INTO OUTFILE` que una vez se les coló. **Un prompt se convence; esa función
no.** Todo lo demás son GET.

| herramienta | qué hace |
|---|---|
| `esquema` · `tablas` | las columnas y tablas **reales**. El antídoto contra inventarlas |
| `consultar_bd` | una consulta de solo lectura. La guarda está en Go |
| `leer_logs` | las líneas de Loki, para VER el error crudo |
| `contar_logs` | **cuántas** líneas matchean, contadas por Loki sobre la ventana entera |
| `traza_de_solicitud` · `historia_de_persona` | el trazador por etapas, y todos los intentos de una persona |

### La trampa que casi se queda adentro: una muestra disfrazada de conjunto

La primera versión de `leer_logs` llamaba a `trazador -query`, que ya sabe hablar con Loki. Anduvo a la
primera y el agente devolvió un informe con porcentajes. **Estaban todos mal.**

`trazador -query` es una **sonda de acceso**, no un lector: con `-limit 200` trae 200 líneas e imprime
**cuatro**. Para un humano que pregunta «¿puedo leer?» está perfecto. Para un agente es veneno — recibe
una muestra presentada como el conjunto, cuenta sobre ella y devuelve *«46% de los errores son del
profiler»* con total confianza. El número real, contado por Loki: **9,2%** (307 de 3.343 en 24h).

Lo que falló no fue el modelo: **fue mi herramienta, que le mintió**. Y ninguna instrucción del prompt
lo habría salvado, porque desde adentro las cuatro líneas se ven idénticas a doscientas. De ahí salen
las dos reglas:

- una herramienta que devuelve un subconjunto **tiene que decir que lo es** (`leer_logs` avisa cuando
  llegó al tope);
- y contar nunca puede depender de mirar: por eso `contar_logs` existe aparte, y le pregunta a Loki.

### Y el segundo error, que cometí arreglando el primero

`contar_logs` nació usando `query_range` y quedándose con el `max()` de la serie. Devolvió **35.036**.
El total real era **3.343**.

Un `count_over_time(…[24h])` pedido por rango no devuelve un total: devuelve **una ventana de 24h por
cada `step`**, todas solapadas y alineadas a límites absolutos de tiempo. Quedarse con el máximo elige
la ventana más grande, que cubre **otro período**. El total lo da la consulta **instantánea**
(`/query`), que evalúa la expresión una sola vez.

Es peor que el error que vino a corregir, porque **no se nota**: devuelve un entero plausible, sin
señal de que algo salió mal. Y lo escribí yo, con la lección anterior fresca. Por eso las dos
correcciones viven acá y no sólo en el commit: *el reflejo de «ya lo arreglé» es exactamente cuando se
mete el siguiente*. El mismo arreglo fue al trazador, que tenía el mismo defecto
(`trazador/server/main.go`, `valorInstantaneo`).

### Lo que encontró apenas se prendió

Midiendo, no leyendo — y las dos correcciones son a cosas que yo mismo había escrito:

- **`creditop.json` tenía mal los estados.** Decía `6 = Anulada` y es **`Negada`** — el estado más
  frecuente del sistema (41%). Una es administrativa, la otra es un rechazo de crédito: quien razone
  sobre «41% anuladas» llega a la conclusión opuesta. También `7`, `10`, `11` y `25`, y faltaban 20 de
  las 29 filas del catálogo. Se reemplazó por la tabla `user_request_statuses` leída en prod.
- **Existe `user_request_records`**, el historial de transiciones (cuándo cambió, quién y con qué
  comentario). No estaba en el diccionario, y sin ella «¿siguió avanzando?» no se puede ni preguntar.
- **El Estado 11 es terminal de verdad.** Yo había escrito una advertencia desde el catálogo («ojo, hay
  estados después del 11»); medida, resultó engañosa: de **10.182** solicitudes que tocaron el 11 en 90
  días, **3** avanzaron. La cola existe en el catálogo y no en los datos.

## Reglas de esta carpeta

- **Solo lectura sobre los repos de la compañía**, salvo que una herramienta diga lo contrario en su
  nombre y en su docstring.
- **La key nunca se commitea**: `.env` está gitignoreado, `.env.example` es la plantilla versionada.
- Python **3.9** del sistema y **solo stdlib** (`urllib`) — sin `pip install`, sin venv. Misma decisión
  que el credibot de Duncan, y por la misma razón: que arranque sin ceremonia.
