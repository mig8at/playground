# workers · el índice de los repos y los agentes que lo consumen

Un solo proyecto con dos mitades que se necesitan:

- **el ÍNDICE** — cómo están CONSTRUIDOS los proyectos de CreditOp, entrando **por repo**
  (`context/` es el otro índice: entra por pregunta de negocio). Casi todo **derivado de `main`**.
- **los AGENTES** — Gemini con el bucle a la vista, que consumen ese índice para elegir archivos,
  leerlos y concluir; y uno que no lee código: **mide** contra la base y los logs reales.

Vivieron separados (`code-index/` y `agents/`) hasta 2026-08-16. Se unificaron porque la medición fue
una sola: **los agentes rinden cuando cada herramienta les devuelve exactamente lo que hace falta** —
concluyen bien sobre contexto ya armado, y queman presupuesto cuando tienen que *descubrir* (¿cómo se
filtra un error? ¿qué columna es? ¿qué archivos existen?). O sea: el trabajo fino vive en los índices
y en las herramientas, no en el prompt. Dos carpetas para eso era una frontera artificial — los
seleccionadores ya importaban el índice.

> ⚠ La dependencia va en un solo sentido: **workers lee `context/`** (su `roots.py`, sus `map.json`)
> **y `context/` no sabe que esto existe.** El enlace unidireccional evita que al mover una pieza la
> otra quede mintiendo.

## La regla que gobierna todo

> **Lo que se puede derivar, no se escribe.** Sólo se escribe a mano lo que ninguna máquina puede
> deducir: **por qué** algo importa.

Por eso `repos.json` tiene prosa y nada más; todo lo demás sale de `main` en el momento — y por eso no
se pudre.

---

# El índice

**Es un CLI, no un puñado de targets de `make`** — porque lo usa tanto una persona como un modelo, y
un modelo necesita **descubrirlo**. `--help` lista los subcomandos; `<subcomando> --help`, sus opciones
con los valores válidos. La ayuda es la documentación y no se desincroniza, porque sale del código que
corre. Todo acepta `--json`.

```bash
cd workers
./cli.py --help                       # qué sabe hacer
./cli.py repos frontend-monorepo      # qué es y por dónde entrar
./cli.py subramas legacy-backend      # las unidades de adentro
./cli.py mapa frontend-monorepo       # qué parte del negocio vive en cada unidad
./cli.py buscar "firma pagaré"        # describís y te da archivos
./cli.py extraer legacy-backend --zoom 2   # la forma del repo, del CÓDIGO
./cli.py puente                       # cobertura del árbol por repo
./cli.py check                        # ¿siguen vivas las rutas escritas a mano?
```

Desde la raíz, `make workers` muestra esa misma ayuda (y `ARGS='…'` reenvía).

## Las capas

**1 · El repo** — a mano, en `repos.json`. Qué es, stack, cuándo nació, cómo se ensambla, y 3-6 archivos
de entrada con **por qué** cada uno. Criterio: *si leo esto, entiendo cómo se arma*.

**2 · Las subramas** — **derivadas**, nunca escritas. Las unidades con **ensamblado propio** de adentro:
los workspaces del monorepo (25) y los módulos de Laravel (20). Se descubren leyendo `main`.

> ⚠ **De `main`, no del working tree.** Medido el 2026-08-15: `legacy-backend` estaba checkeado en una
> rama donde `Modules/Backoffice` **no existe**. Un descubridor que caminara el disco lo habría borrado
> del índice sin que nada avisara — justo el módulo que sólo vive en `main`.

**3 · El puente** — **derivado**: qué nodos de `context/` describen cada repo. Cada `map.json` ya lista
sus archivos como `alias/relpath`; la pertenencia estaba en los datos, sólo faltaba leerla al revés.

**4 · El mapa de negocio** — `./cli.py mapa <alias>`. Cruza las capas 2 y 3: para **cada unidad** del
repo, qué nodos de negocio la citan. Y mide **lo que NO está cubierto**: unidades sin nodo que las
describa — plomería, o negocio sin escribir.

**5 · La extracción** — `./cli.py extraer <alias>`. Lee el CÓDIGO y saca por archivo qué **define**,
qué **importa** y qué **rutas HTTP** expone. Algoritmo portado de `carto`, adaptado a PHP/Laravel,
TypeScript y Go. Puntúa por estructura y llena hasta un presupuesto en KB — y cuando corta, lo dice.
`--zoom N` no filtra: agrupa en carpetas de N niveles (todo `legacy-backend` en diez líneas y 1,3 s).

**6 · La capa de CreditOp** — `extraer` es genérico a propósito (por eso sirvió igual en PHP, TS y Go).
Encima corre `creditop.py`, que traduce lo extraído al negocio: qué lender, qué comercio, qué
`response_type`, qué tabla, qué marcador de log, si bifurca por ambiente. Habilita `--lender 160` ·
`--allied 94` · `--rt 2` · `--tabla profiling_reviews` · `--marca QUOTA_CHECK_REJECTED` · `--gates`
(los que bifurcan por ambiente: **la trampa de staging**, que corre con `APP_ENV=development`).

⚠ Va **separado** del extractor: meterle negocio lo volvería un segundo lugar donde vive ese
conocimiento, compitiendo con `context/`. El diccionario (`creditop.json`) declara de qué nodo salió
cada grupo; ante una diferencia **manda el nodo**. Y sus **datos duros se midieron contra prod**: el
catálogo de estados es la tabla `user_request_statuses` leída de producción el 2026-08-16, no una
glosa — la glosa a mano tenía mal el estado más frecuente del sistema (`6 = Negada`, no «Anulada»).

**7 · El índice de tags** — `./cli.py tags --construir` recorre los repos y arma `{sha: [tags]}`.
Después `--tag lender:160` responde en 0,2 s. ⚠ **La llave es el sha del CONTENIDO, no de la ruta**:
un archivo cambiado tiene otra llave, así que el caché no puede devolver algo viejo — se autoinvalida.
`./cli.py tags` sin argumentos es el censo del código por concepto de negocio.

## Mantenimiento

`./cli.py check` valida que las rutas escritas a mano sigan existiendo en `main`; sale 1 si alguna
murió. **Un índice que apunta a un archivo que ya no está es peor que no tenerlo**: un modelo lo abre,
no lo encuentra y concluye cualquier cosa. Las otras capas se derivan de `main` en el momento.

---

# Los agentes

Cada agente es un archivo con dos cosas: **qué herramientas tiene** y **qué se le pide**. El bucle está
a la vista en `gemini.py` y lo reusan todos.

| archivo | qué es |
|---|---|
| `gemini.py` | el **cliente**: una llamada a la API y el bucle de herramientas. No sabe nada de CreditOp. `--modelos` dice qué habilita tu key hoy |
| `contexto.py` | **no es un agente**: la caja de herramientas compartida (índices + leer código de `main`) |
| `seleccion.py` | **no contesta**: dice qué archivos habría que leer, y por qué. Sólo ve índices |
| `contraste.py` | el segundo seleccionador: elige lo que el primero NO miró. Tiene prohibido repetir |
| `lector.py` | lee lo que eligieron los otros + los nodos de `context/`, y concluye. Recorta a 300k tokens |
| `datos.py` | el que **mide**: base de datos y logs reales, un ambiente por corrida |

## Cómo arrancar

1. API key en <https://aistudio.google.com/apikey> → `cp .env.example .env`, pegá la key.
2. `make agente-modelos` — si el modelo por defecto no aparece, cambiá `GEMINI_MODEL` en `.env`.

## Cómo funciona un agente, en cuatro líneas

1. Se le manda al modelo **la pregunta + la lista de herramientas**.
2. El modelo contesta una de dos: *«llamá a esta función con estos argumentos»* o *«acá está la respuesta»*.
3. Si pidió una función, **la corre el código, no el modelo**, y se le manda el resultado.
4. Se repite hasta que conteste texto, o hasta `MAX_PASOS` — el cinturón contra pedir lo mismo para siempre.

## La diferencia que más importa: el agente NO tiene una shell

Cada agente recibe **funciones concretas** y ninguna más. No puede correr comandos arbitrarios, no
puede escribir archivos, no puede tocar producción salvo por funciones de sólo lectura. Si querés que
haga algo nuevo, **escribís la función** — y en ese momento decidís si es de sólo lectura.

Y la lección medida de esta carpeta, tres veces: **cuando el índice no ofrece lo que el modelo
necesita, el modelo lo fabrica** — hashes inventados, columnas adivinadas, quince conteos a mano para
armar una taxonomía. La respuesta nunca fue «pedirle que no»: fue darle la herramienta que devuelve
eso exactamente (el glosario español↔inglés, `esquema`, `agrupar_logs`).

---

# Cómo se orquesta — LA FORMA

*(Esto era el prompt del subagente `orquestador` de `.claude/agents/`, retirado en la unificación: lo
que decidía es una receta, y una receta se lee mejor de un archivo que de un agente.)*

## El pipeline de código

```bash
cd workers
rm -f _angulo-*.json                       # ⚠ selecciones de una pregunta anterior contaminan el lector

# 1) uno o VARIOS seleccionadores, cada uno con su ángulo. Sólo ven índices, no código.
python3 seleccion.py "<pregunta>" --min 4 --max 12 --salida _ultima-seleccion.json
python3 seleccion.py "<pregunta>" --angulo "…" --min 4 --max 10 \
        --evitar _ultima-seleccion.json --salida _angulo-2.json

# 2) el lector: junta TODAS las selecciones + los doc.md de los nodos, y concluye
python3 lector.py
```

⚠ La PRIMERA selección va siempre a `_ultima-seleccion.json`: el lector reparte el presupuesto de
izquierda a derecha y esa fuente va primero — ahí tiene que ir el ángulo principal.

## El vecindario y el triaje — la red bajo el seleccionador

Un archivo tenía sólo dos estados para el lector: **cargado entero** (~4.000 tokens) o **ausente** — y
el segundo era además **invisible**. Si el seleccionador se dejaba afuera el que contestaba, el lector
no tenía cómo sospecharlo: contestaba con lo que había, seguro.

El estado intermedio que faltaba es el **nodolite**, y sale casi gratis: MEDIDO, el mapa de todos los
archivos de un nodo cuesta **27-37x menos** que cargarlos (`kyc`: 39 archivos = 5.337 tokens de mapa
contra 197.177 enteros). Por eso el lector recibe ahora **«EL VECINDARIO»**: una línea por archivo del
nodo con lo que **define** cada uno, marcando los que ya tiene. ~0,7% del presupuesto.

Y arriba de eso, el **triaje**: una llamada chica y aparte que ve sólo la pregunta y el mapa, y
devuelve los `h` que faltan. Lo que pida se carga antes de armar el payload final.

### Por qué el triaje es una llamada del programa y no una instrucción

Costó dos intentos fallidos, y es la lección más transferible del día. Prueba: se le sacó a propósito
de la selección el archivo que tenía la respuesta (`LenderListingService`, con
`stampCreditopXApproval`), **dejándolo listado en el mapa con ese nombre a la vista**.

| intento | resultado |
|---|---|
| Instrucción en el prompt: «mirá el vecindario antes de contestar» | **no la siguió** |
| Herramienta con «OBLIGATORIA» en su descripción y en el prompt | **no la llamó** |
| Llamada aparte, hecha por el código, antes del payload | **rescató exacto ese archivo**, con el motivo correcto |

Sin el triaje la respuesta describía el camino **v1** y se perdía el **v2 entero**, sin una señal de
duda. Con el triaje cubre los dos. Control negativo: con la selección completa devuelve «no falta
ninguno» y explica por qué — no es un mecanismo que traiga archivos por las dudas.

> La causa no era falta de información ni de énfasis: **un modelo que ya tiene UNA respuesta deja de
> buscar**, y un archivo que falta no se siente como un hueco — se siente como una respuesta completa.
> Pedirlo mejor no cambia eso. Lo cambia que la decisión ocurra **antes de que exista una respuesta a
> la que aferrarse**, y que la dispare el código.

Es la misma forma que el `--evitar` del contraste: la calidad no salió de pedir, salió de **estructurar**.

## Cuántos ángulos y cuántos archivos

No hay número correcto fijo: depende de la pregunta.

| la pregunta es… | ángulos | archivos c/u | por qué |
|---|---|---|---|
| **puntual** («¿por qué a ESTE cliente no le salió X?») | 1-2 | 4-10 | la respuesta suele estar en 2 archivos; traer 30 diluye |
| **de mecanismo** («¿cómo se decide el cupo?») | 2-3 | 8-12 | contrastar el código con su config y sus tests |
| **de punta a punta** («todo el flujo de formalización») | 3-4 | 10-15 | son etapas distintas; un seleccionador ve una sola |
| **de contraste entre repos** («¿difieren los monolitos?») | 2 | 10-15 | uno por repo, y que el lector compare |

Medido: 15 archivos ≈ 96k de los 300k tokens del lector; 32 archivos ≈ 101k. El techo real antes de
que recorte está cerca de **35-40 archivos**. Pasarse no rompe —recorta y avisa— pero cambia archivos
enteros por fragmentos.

**El valor del contraste sale de PROHIBIR el camino fácil**: cada agente extra va con `--evitar` de
los anteriores. Ángulos que rinden: el gemelo en el otro repo · los tests y las migraciones · los
modelos y la config · el front (o al revés) · los findings. Medido: sin decírselo nadie, el primero
eligió *servicios y controllers* y el de contraste *modelos y repositorios* — la diversidad salió de
la prohibición, no de la instrucción.

## Código, datos, o los dos

| la pregunta es… | qué corrés |
|---|---|
| «¿cómo funciona X?», «¿por qué el código hace Y?» | el pipeline de código |
| «¿esto pasa, y cuánto?», «¿desde cuándo?» | `datos.py --target prod` |
| «¿qué le pasó a la solicitud N?» | `datos.py` en el ambiente donde vive |
| «¿el código hace lo que creemos?» | **los dos, y contrastás** |

La última fila es la que más rinde: el código dice qué *debería* pasar y los datos qué pasó — **cuando
difieren, eso es la respuesta**. Medido: una advertencia escrita desde el catálogo de estados («ojo,
hay estados después del 11») resultó engañosa al medirla — de 10.182 solicitudes que tocaron el 11 en
90 días, **3** avanzaron.

## ⚠ Si verificás algo, verificalo contra `main`

Ya falló de la peor forma: un orquestador «corrigió» números de línea del lector —que estaban BIEN—
hacia números equivocados, porque los chequeó contra el working tree y `legacy-backend` estaba en una
rama donde el mismo código está seis líneas más arriba. Una corrección con aire de diligencia y el
dato peor que antes.

```bash
git -C <repo> show main:<relpath> | grep -n "<lo que buscás>"     # ✅
grep -n "<lo que buscás>" <repo>/<relpath>                        # ❌ lee la rama que haya
```

Y si corregís algo, **decí cómo lo comprobaste**. Una corrección sin método es una opinión con formato
de dato.

## Reglas de la corrida

- ⚠ **Cuesta plata y hay cuota.** Cada seleccionador son ~8-12 llamadas. No lances 4 ángulos para una
  pregunta puntual. Un 429 se reporta, no se reintenta en bucle.
- **Si el pipeline falla, se reporta el fallo** — no se completa con lo que se supone.
- **Lo verificado se distingue de lo inferido**, y esa distinción se conserva al citar al lector.
- Si el lector dice que le faltaron archivos o que algo venía recortado, **eso va en el informe**: es
  información sobre el índice, y es lo que permite mejorarlo.

---

# El agente `datos` — el único que no lee código

Los demás contestan **qué dice el código**. Eso deja afuera la mitad de las preguntas reales:
*¿esto pasa? ¿cuántas veces? ¿desde cuándo? ¿qué le pasó a ESTA solicitud?* Un `if` que existe puede no
haber disparado nunca — **una rama muerta se lee igual que una caliente**.

```bash
make agente-datos PREGUNTA='¿cuántas solicitudes quedan en estado 3?'                 # local
make agente-datos TARGET=prod PREGUNTA='¿esto pasa de verdad, y cuánto?'              # la fuente válida
```

**Un ambiente por corrida**, y las herramientas no reciben `target`: lo fija quien lanza y el agente no
lo puede cambiar. Así cada número tiene procedencia inequívoca. Para comparar dos ambientes, dos
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
| `agrupar_logs` | los TIPOS de mensaje, agrupados por forma. La taxonomía en un paso |
| `contar_logs` | **cuántas** líneas matchean, contadas por Loki sobre la ventana entera |
| `traza_de_solicitud` · `historia_de_persona` | el trazador por etapas, y los intentos de una persona |

### La trampa que casi se queda adentro: una muestra disfrazada de conjunto

La primera versión de `leer_logs` llamaba a `trazador -query`, que ya sabe hablar con Loki. Anduvo a la
primera y el agente devolvió un informe con porcentajes. **Estaban todos mal.**

`trazador -query` es una **sonda de acceso**, no un lector: con `-limit 200` trae 200 líneas e imprime
**cuatro**. Para un humano que pregunta «¿puedo leer?» está perfecto. Para un agente es veneno — recibe
una muestra presentada como el conjunto, cuenta sobre ella y devuelve *«46% de los errores son del
profiler»* con total confianza. El número real, contado por Loki: **9,2%** (307 de 3.343 en 24h).

Lo que falló no fue el modelo: **fue la herramienta, que le mintió**. Y ninguna instrucción del prompt
lo habría salvado, porque desde adentro las cuatro líneas se ven idénticas a doscientas. De ahí salen
las dos reglas:

- una herramienta que devuelve un subconjunto **tiene que decir que lo es** (`leer_logs` avisa cuando
  llegó al tope);
- y contar nunca puede depender de mirar: por eso `contar_logs` existe aparte, y le pregunta a Loki.

### Y el segundo error, que se cometió arreglando el primero

`contar_logs` nació usando `query_range` y quedándose con el `max()` de la serie. Devolvió **35.036**.
El total real era **3.343**.

Un `count_over_time(…[24h])` pedido por rango no devuelve un total: devuelve **una ventana de 24h por
cada `step`**, todas solapadas y alineadas a límites absolutos de tiempo. Quedarse con el máximo elige
la ventana más grande, que cubre **otro período**. El total lo da la consulta **instantánea**
(`/query`), que evalúa la expresión una sola vez.

Es peor que el error que vino a corregir, porque **no se nota**: devuelve un entero plausible, sin
señal de que algo salió mal. Y se escribió con la lección anterior fresca. Por eso las dos correcciones
viven acá y no sólo en el commit: *el reflejo de «ya lo arreglé» es exactamente cuando se mete el
siguiente*. El mismo arreglo fue al trazador (`trazador/server/main.go`, `valorInstantaneo`).

---

# Reglas de esta carpeta

- **Solo lectura sobre los repos de la compañía**, salvo que una herramienta diga lo contrario en su
  nombre y en su docstring.
- **La key nunca se commitea**: `.env` está gitignoreado, `.env.example` es la plantilla versionada.
  Los `_*.json` (selecciones, contrastes) son artefactos de corrida y tampoco se commitean.
- Python **3.9** del sistema y **solo stdlib** (`urllib`) — sin `pip install`, sin venv.
- Hubo dos agentes más: `frontend.py` (¿el frontend está sano hoy?, el primero que se escribió) y el
  `contexto.py` autónomo (ruteaba solo por el árbol). Se retiraron en la unificación — el pipeline los
  superó y dos formas de lo mismo era el problema a podar. Viven en git: `git log --follow -- workers/`.
