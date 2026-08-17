# workers · el índice de los repos y los agentes que lo consumen

Un solo proyecto con dos mitades que se necesitan:

- **el ÍNDICE** — cómo están CONSTRUIDOS los proyectos de CreditOp, entrando **por repo**
  (`context/` es el otro índice: entra por pregunta de negocio). Casi todo **derivado de `main`**.
- **los AGENTES** — Gemini con el bucle a la vista, que consumen ese índice para elegir archivos,
  leerlos y concluir; y uno que no lee código: **mide** contra la base y los logs reales.

Van juntos porque **los agentes rinden cuando cada herramienta les devuelve exactamente lo que hace
falta**: concluyen bien sobre contexto ya armado, y queman presupuesto cuando tienen que *descubrir*
(¿cómo se filtra un error? ¿qué columna es? ¿qué archivos existen?). El trabajo fino vive en los
índices y en las herramientas, no en el prompt — separarlos sería una frontera de mentira.

> ⚠ La dependencia va en un solo sentido: **workers lee `context/`** (su `roots.py`, sus `map.json`)
> **y `context/` no sabe que esto existe.** El enlace unidireccional evita que al mover una pieza la
> otra quede mintiendo.

## La regla que gobierna todo

> **Lo que se puede derivar, no se escribe.** Sólo se escribe a mano lo que ninguna máquina puede
> deducir: **por qué** algo importa.

Por eso `repos.json` tiene prosa y nada más; todo lo demás sale de `main` en el momento — y por eso no
se pudre.

---

# La espina — por dónde empezar

```bash
./cli.py negocio --zoom 1   # el recorrido en seis renglones
./cli.py negocio            # normal: cada concepto con su nombre en código y su nodo
./cli.py negocio --zoom 3   # todo lo derivado, incluido si DEJA RASTRO en producción
./cli.py negocio cupo       # uno solo, con dónde seguir
```

    CONFIGURACIÓN   comercio → sucursal → entidad → la arista → response_type → canal
    LA SOLICITUD    solicitud → estado → cliente → OTP → datos declarados
    LA DECISIÓN     central de riesgo → perfilamiento → categoría → reglas → cupo → enganche
    LA OFERTA       listado de entidades → pre-aprobación
    EL CIERRE       formalización → pagaré → documentos de legalización
    DESPUÉS DEL 11  servicing

Había tres vocabularios y ninguno contestaba la pregunta de quien llega: `creditop.json` traduce ids
a nombres, el glosario traduce español a código, y los nodos explican cada área en profundidad.
**Faltaba el orden.**

Son **23 conceptos**, de `comercio` a `servicing`, cada uno con: cómo se llama en el código, sus
sinónimos de reunión, su tabla, y **qué nodo lo explica en serio**.

⚠ Se escribe a mano **sólo el orden y el concepto** — eso no se deriva, sale de entender el negocio.
Todo lo demás (cuántos archivos tocan esa tabla, cuántos tiene el nodo) se resuelve al vuelo contra
los otros mapas. Por eso es corto y **no puede quedar viejo: lo que envejece no está escrito ahí**.

⚠ Y **no reemplaza a `context/`**: una línea por concepto, la que ubica. El detalle y las trampas
viven en el nodo.

## El árbol · 10 tramos × 39 pasos

```bash
./cli.py negocio --zoom 4          # el árbol
./cli.py negocio --zoom 4 --json   # con sus señales, para consumir
```

     3. validacion_identidad_kyc
        Validación de identidad y KYC  ·  siempre
          ● validar_fecha_expedicion        ⚠ Invalid expedition date, returning ONB005
          ● cascada_identidad_registraduria ⚠ AgilData errors and no TusDatos retry
          ○ biometria_facial_ado            ⚠ Validación facial fallida
          ○ consulta_antecedentes_aml       ⚠ TusDatos AML timeout

    ● ocurre en producción  ·  ○ sólo existe en el código

**Dos pasadas de un agente**: la primera leyendo el corpus del código (1.576 mensajes), la segunda
agregándole **logs reales de producción** — frecuencia y 8 recorridos en orden cronológico.

Lo que aportaron los logs reales, y no estaba en el corpus: **de los 1.576 mensajes que el código
puede emitir, sólo 297 aparecieron en 6 horas.** Cuatro de cada cinco pasos que el código sabe dar,
no los da — y un árbol que los trata igual miente sobre lo que pasa.

⚠ **Todo verificado, y no todo pasó.** Las 39 señales existen en el código: **39/39**. Pero el
`visto_en_prod` NO se le creyó al modelo, se **midió**: de 39 declaraciones, **3 estaban mal** — las
tres afirmando que algo ocurre sin evidencia. Corregidas por la medición.

## Y el otro eje: las ACCIONES

Los conceptos son **sustantivos** y no alcanzan: «validar credenciales» y «enviar código» no son
cosas, son **actos**. Por eso hay un segundo vocabulario:

```bash
./cli.py negocio --acciones          # las 12 acciones
./cli.py negocio --traza <trace_id>  # qué hizo el sistema en una corrida
```

    QUÉ HIZO EL SISTEMA · 69 líneas → 6 acciones

       16×  consultar buró          [central de riesgo, cliente, comercio]
        2×  validar identidad       [cliente]
        2×  armar el listado        [comercio, entidad]  ⚠ 1 fallo(s)
        2×  validar credenciales    [sucursal]

Es **la capa que faltaba**: el trazador agrupa en 7 etapas (muy grueso) y la secuencia cruda son
decenas de pasos (muy fino). Esto dice qué pasó sin obligar a leer cada línea, y marca **dónde falló**.

⚠ Los patrones salieron del CORPUS, no de la imaginación: se miró qué palabras usan los 1.576
mensajes reales. Cobertura medida: **69%**.

⚠ Y `FALLÓ` va **aparte**, porque no es una acción sino un **desenlace**: puede acompañar a cualquiera,
y contarlo como una más escondería cuál falló.

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

> ⚠ **El mapa de logs NO se construye acá, y es a propósito.** `extraer` llena hasta un presupuesto
> en KB y **corta**: es selectivo. Un mapa de mensajes tiene que ser **completo**, o los lookups
> fallan en silencio sobre los archivos que no entraron al corte. Por eso vive en `logs.py`, con su
> propio recorrido. Lo que sí hace el nodolite es **llevar el dato**: cada archivo del «vecindario»
> dice `loguea N` o `SIN LOGS`, que es lo que decide si se lo va a poder seguir en producción.

**7 · El índice de tags** — `./cli.py tags --construir` recorre los repos y arma `{sha: [tags]}`.
Después `--tag lender:160` responde en 0,2 s. ⚠ **La llave es el sha del CONTENIDO, no de la ruta**:
un archivo cambiado tiene otra llave, así que el caché no puede devolver algo viejo — se autoinvalida.
`./cli.py tags` sin argumentos es el censo del código por concepto de negocio.

## Los mapas se cruzan — y ahí aparece lo que ninguno sabe solo

Todos comparten la misma llave, la **ruta**, así que se juntan sin ceremonia:

    context/ (map.json)  →  qué archivos describe cada nodo de negocio   → campo `nodos`
    logs.json            →  qué archivos emiten mensajes                 → campo `loguea`
    el extractor         →  de qué tipo es cada archivo                  → campo `tipo`

Cruzarlos contesta algo que ninguno contesta por su cuenta:

```bash
./cli.py sin-rastro     # qué código que el negocio documenta es INVISIBLE en producción
```

Medido: de **390** services y controllers que un nodo describe, **269 no emiten una sola línea de
log** — no se pueden trazar. Encabezan `CreditopXFlowService`, `SimulatorController` y los dos
controladores del listado de entidades.

⚠ El filtro a services y controllers **no es cosmético**: sin él sale que el 88% del árbol es ciego,
y ese número no significa nada — encabezan archivos de rutas, config y front, que **no loguean por
diseño**. Un `routes/api.php` sin logs no es un problema; un `CreditopXFlowService` sin logs, sí.

Para qué sirve, en una frase: **decide si una pregunta de soporte se va a poder contestar antes de
prometerlo.** Si el archivo que importa está en esa lista, no hay traza que buscar — hay que
instrumentar primero.

### El mapa de FLUJOS: qué es demostrable corriéndolo

```bash
./cli.py flujos --construir   # lee los specs del harness
./cli.py flujos               # qué escenarios sabe probar
./cli.py flujos --codigos     # ⟵ el cruce que lo justifica
```

`context/` dice cómo funciona, `logs.json` qué dejó rastro, `archivos.json` qué significa un archivo.
**Ninguno sabe qué es demostrable CORRIÉNDOLO** — y eso vive sólo en `harness/`.

⚠ Sale de los nombres de `test()`, **no de los pasos**. `new Flow(...).step()` declara pasos con
descripción y está en **4 de 45** specs: un patrón demo que no se propagó. Los `test('…')` están en 37
y resultaron mejor material, porque llevan el recorrido y los códigos:

    Ecommerce LOCAL real: /checkout → solicitar → amount → phone → OTP(real) → personal-info
    fecha imposible (31/02/2010) → ONB005 + EXPEDITION_DATE_INVALID

**El flujo REAL, el que nadie escribió:**

```bash
./cli.py flujos --traza <trace_id>    # los pasos de una corrida, en orden
```

    1. OnboardingController::storeLaboralInfo: entered
    2. Experian disparado desde storeLaboralInfoOrchestrator
    3. Requesting credentials for Experian Acierta+Quanto
    …
   12. quantoMedioAverage valid, writing UserFieldValue field 87 (income)

⚠ Es el recorrido de **una** corrida, no el flujo canónico: otra solicitud puede diferir. Para el
deber ser está `context/`, que es donde vive lo verificado.

⚠ Y se entra por **traza**, no por ureq: sólo el 11% de las líneas llevan el `user_request_id` en su
texto, así que anclar por ureq devolvía casi siempre cero — que se lee como «no hizo nada». Para
entrar por solicitud está `make trazador-ureq`, que cruza la BD.

**El cruce**: `logs.json` sabe qué códigos existen en el código, este mapa sabe cuáles prueba un spec,
y la diferencia es trabajo pendiente. Medido: **6 códigos que el cliente recibe y ningún spec recorre**
— `ONB004`, `ONB021`, `ONB022`, `ONB023`, `ONB040`, `ONB014_OTP_GENERATION_FAILED`.

⚠ Separado de la **telemetría interna** (`CATEGORY_*`, `QUOTA_*`), que no son fallos y no hay nada que
probar de ellos. Mezclarlos daba 24 en vez de 6 e inflaba el número hasta volverlo inútil.

Y lo construye **workers, no harness**: la misma regla que con `context/` — workers **lee** las otras
herramientas y no escribe en ellas.

### La huella por lender — y por qué la de comercio no existe

`flujos.huella_por_lender()` agrupa las trazas por su `lender_id` y devuelve los archivos que
recorren. Funciona, **y dice menos de lo que parece**:

| | atribuible a nivel TRAZA |
|---|---|
| `lender_id` | **57%** (aparece en el 15% de las líneas, y basta una por traza) |
| `allied_id` | **8%** (aparece en el 1%) |

Por eso **no hay mapa por comercio**: al 8%, saldría casi vacío y se leería como «este comercio no
opera», que es peor que no tenerlo.

⚠ Y la huella del lender **no es su recorrido: es dónde se escribe su id**. Medido: los lenders 77,
46 y 94 devuelven los **mismos tres archivos** —el chequeo de cupo— porque ahí es el único lugar que
loguea `lender_id`. Su paso por el listado, la formalización y la firma no lo nombra y es invisible.

Es una limitación de la **instrumentación**, no del método: propagar `lender_id`/`allied_id` al
contexto de log convertiría esto en lo que promete.

### Auditar `context/` sin tocarlo

```bash
./cli.py menu              # ¿cuánto del menú de cada nodo tiene señal de negocio?
./cli.py menu backoffice   # con ejemplos
```

Un `map.json` es una lista **curada a mano**, y con el tiempo se le suma plomería. El costo no es el
archivo: es que el **menú del seleccionador se diluye**, y elegir bien es todo su trabajo. Medido:
`backoffice` cita 119 archivos y **22 tienen negocio**; `bancolombia`, 29 de 145.

⚠ **«Mudo» no significa sobrante.** Se muestrearon 24 mudos del front y **22 eran de verdad
componentes de presentación** —`AdminHeader`, `AdminLayout`— o sea bien clasificados. Es una señal
para quien cura, no una lista para borrar: las herramientas **auditan** el `map.json`, no lo escriben.
Curarlo a mano es a propósito.

### El modelo de datos, reconstruido

```bash
./cli.py relaciones                     # de dónde salió cada relación
./cli.py relaciones profiling_reviews   # qué apunta a una tabla y a qué apunta
```

La base tiene **487 columnas `_id` y sólo 44 claves foráneas declaradas**: las relaciones viven en el
código, no en el esquema. **432 reconstruidas**, y el `via` dice de dónde salió cada una porque **no
valen lo mismo**:

| origen | cuántas | qué tan firme |
|---|---|---|
| convención (`X_id` → `Xs`) | 317 | mecánico y exacto |
| FK declarada | 44 | está en el esquema |
| inferida por un agente | 71 | roles y abreviaturas — **verificada contra los datos** |

Las inferidas son las que la convención no puede dar: `disbursed_lender_id` y `recommended_lender_id`
apuntan **las dos** a `lenders` y significan cosas distintas. El agente las resolvió con **36 de 36
tablas válidas** — pero al verificarlas contra los datos, **5 no se sostienen** (hay huérfanos reales)
y quedaron marcadas con ⚠. Las había declarado todas «alta confianza».

⚠ **En este esquema `0` significa «ninguno», no una referencia.** Un JOIN que no lo excluye cuenta 156
huérfanos donde hay cero — me pasó verificando `related_field_id`, y por poco descarto una relación
que estaba bien.

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
| `plan.py` | el primero de la fila: no busca, decide **cuántos ángulos y cuáles** + el puente español→código |
| `analisis.py` | corre la fila entera (plan → N seleccionadores → lector). La entrada normal |
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

## El pipeline de código — la fila de hormigas

```bash
make agente-analisis PREGUNTA='…'     # la fila entera; es la entrada normal
```

    plan  →  N seleccionadores (uno por ángulo, cada uno evitando a los anteriores)  →  lector

**1 · `plan.py`** — no busca archivos: decide **cómo** se va a buscar. Ve sólo la superficie de
RUTEO (ROUTE-MAP + el vocabulario de negocio ≈ 10k tokens; los 38 `doc.md` enteros serían **208.636**,
el 70% de la ventana del lector) y devuelve: qué **clase** de pregunta es, los **ángulos** —uno por
seleccionador—, el **puente español→código**, los nodos y la **ambigüedad** si la hay.

> ⚠ **No reescribe la pregunta**, y es deliberado. La tentación era «mejorarla» antes de pasarla: es
> una mala idea con forma de buena, porque si el refinador la entiende mal, el error lo heredan TODOS
> los de abajo **y queda invisible** — un punto de falla único y silencioso en el primer paso. La
> pregunta viaja verbatim; el plan se **suma**.

Los ángulos eran hasta hoy texto libre que alguien escribía a mano (los decidía el subagente
`orquestador`; al retirarlo quedaron sin dueño). El puente al código mata en el origen el bug
español↔inglés que apareció **tres veces** — «migración» nunca iba a matchear `migrations`.

**2 · `seleccion.py` ×N** — cada uno con su ángulo y con `--evitar` de los anteriores. Sólo ven
índices. Devuelven hashes.

**3 · `lector.py`** — junta todo, recorta a 300k y concluye.

Los pasos sueltos siguen disponibles (`agente-plan`, `agente-seleccion`, `agente-contraste`,
`agente-lector`) para inspeccionar una etapa. ⚠ Corriéndolos a mano, la PRIMERA selección va siempre a
`_ultima-seleccion.json`: el lector reparte de izquierda a derecha y ahí tiene que ir el ángulo
principal. `analisis.py` ya lo hace, y además **borra los `_*.json` viejos** — el lector junta todos
los que encuentre, así que una selección de otra pregunta entraría al payload sin avisar.

### Medido, en una corrida real de punta a punta

Pregunta: *«¿por qué a un cliente no le apareció una entidad y el comercio reclama?»* → forma
`mecanismo`, 3 ángulos (config comercial · motor local de riesgo · pre-aprobaciones externas), cada
uno entrando por nodos distintos:

| pieza | tokens |
|---|---|
| 23 archivos de los 3 ángulos | 153.168 |
| 9 `doc.md`, recortados por secciones | 34.541 |
| el mapa del vecindario (456 archivos visibles) | 12.123 |
| **el triaje: 4 archivos que los tres ángulos perdieron** | 19.085 |

Los que rescató el triaje: `ProfilingRulesService`, `LenderSpecialGrantingService`,
`ListLenderController` de `application` y el mapper del front. Con tres seleccionadores encima, la
red de abajo **igual encontró cuatro**.

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

### Las herramientas que ven los que eligen y el que lee

| herramienta | qué contesta |
|---|---|
| `mapa_de_rutas` · `abrir_nodo` | el árbol de contexto: por síntoma → nodo → sus archivos |
| `indice_de_repos` · `subramas_del_repo` · `mapa_de_negocio_del_repo` | cómo está armado cada repo, y qué negocio vive en cada carpeta |
| `buscar_archivos` | describís en palabras y te da candidatos, puntuados por parecido |
| `archivos_por_tag` | los que **tocan** algo, por hecho y no por parecido: `tabla:x` · `lender:N` · `rt:N` · `gates` |
| `gemelos` | qué existe en los DOS monolitos y qué **divergió** (321 idénticos · 213 divergidos) |
| `quien_usa` | dónde se **define** y dónde se **usa** un símbolo, en los 12 repos a la vez |
| `que_hay_en` | qué significa un archivo en el negocio **sin abrirlo** (~20 tokens contra ~15.000) |
| `codigo_de_log` | de una línea de LOG al código que la emitió — devuelve `archivo:línea` con su `h` |
| `leer_codigo` · `buscar_en_codigo` · `pedir_archivo` | el código real, siempre desde `main` |

Las cuatro del medio entraron el 2026-08-16 tapando un hueco que se encontró **comparando lo que el
índice sabía hacer contra lo que los agentes podían pedir**. La peor: se les pedía por escrito el
ángulo «mirá el gemelo en el otro repo» y no tenían con qué encontrarlo — adivinaban la ruta del otro
lado. *Pedir un ángulo sin la herramienta para recorrerlo es cómo se fabrica una respuesta inventada.*

⚠ `cruzar_rutas` (qué rutas HTTP comparten dos repos) existe en el CLI y **no se expuso**: mide 1
coincidencia sobre 157 y 178 rutas, porque del lado de Laravel la ruta extraída es sólo el fragmento
interno —el camino real se arma con el prefijo del módulo y los `Route::prefix()->group()` anidados—.
Devolvería «no se hablan», que es una conclusión falsa y no un resultado vacío.

### Las del que mide

| herramienta | qué hace |
|---|---|
| `esquema` · `tablas` | las columnas y tablas **reales**. El antídoto contra inventarlas |
| `consultar_bd` | una consulta de solo lectura. La guarda está en Go |
| `leer_logs` | las líneas de Loki, para VER el error crudo |
| `agrupar_logs` | los TIPOS de mensaje, agrupados por forma. La taxonomía en un paso |
| `contar_logs` | **cuántas** líneas matchean, contadas por Loki sobre la ventana entera |
| `traza_de_solicitud` · `historia_de_persona` | el trazador por etapas, y los intentos de una persona |
| `codigo_de_log` | la única que no mide: del log al CÓDIGO que lo emitió |

### El mapa de logs: para qué sirve, en criollo

Un log te dice **qué pasó**. No te dice **dónde**. Y ahí se va el rato: leés un error, y ahora hay que
encontrar de qué archivo salió, entre miles.

El mapa hace ese salto. Se arma una vez leyendo el código —qué mensaje escribe cada archivo— y después:

- **de un error → el archivo**, con su línea;
- **de una corrida entera → la lista de archivos que corrieron**, en orden.

Sirve para tres cosas concretas:

1. **Depurar un incidente sin adivinar.** En vez de sospechar qué mirar, los logs te lo dicen. Medido:
   126 archivos candidatos por parecido, contra **2 por evidencia** — y el que fallaba tenía 298 hits.
2. **Darle al agente la lista buena.** Esos archivos vienen listos para que otro los abra y explique.
3. **Ver el punto ciego.** Si algo no aparece nunca, es que **no deja rastro**. Así encontramos que el
   cliente de una API que falla 28 veces por día no escribe un solo log.

⚠ Y lo que NO dice: qué archivos **corrieron**. Dice cuáles **dejaron rastro**. Lo que no loguea es
invisible acá — y a veces eso invisible es justo la causa.

### Del log al código: la llave es el MENSAJE, no un hash

La cadena natural sería `log → hash de archivo → contenido`, pero **falta el primer eslabón: la línea
de log no trae el archivo**. Medido en prod: el campo `extra_file` aparece en ~5% de las líneas y
apunta a `vendor/laravel/framework` — el logger registrando su propia línea, no la de quien llamó.

Lo que sí resuelve es el **mensaje**, porque es un literal del código. Probado sobre seis líneas
crudas de producción: **seis de seis** resolvieron a un `archivo:línea` único. Y como devuelve el `h`,
engancha con el resto:

    log → codigo_de_log → h → que_hay_en(h)   qué toca ese archivo, sin abrirlo
                            → leer_codigo(h)  el código, en su línea

⚠ Dos lecturas que hay que hacer bien: los mensajes llevan valores interpolados, así que busca el
prefijo estático más largo (`prefijo_usado` dice con cuánto resolvió); y **varios candidatos suele ser
el parallel-run**, no ambigüedad — el mismo mensaje vive en los dos monolitos, y el `service_name` de
la línea dice cuál corrió.

### Contar y mirar son cosas distintas — las dos formas de mentir con logs

**Una herramienta que devuelve un subconjunto tiene que decir que lo es.** `trazador -query` es una
sonda de acceso: con `-limit 200` trae 200 líneas e **imprime cuatro**, y desde adentro las cuatro se
ven idénticas a doscientas. Contarlas dio *«46% de los errores son del profiler»*; el real era **9,2%**
(307 de 3.343 en 24h). Por eso `leer_logs` avisa cuando llegó al tope, y **`contar_logs` existe aparte**:
contar no puede depender de mirar.

**Y contar mal es más silencioso todavía.** Un `count_over_time(…[24h])` pedido por RANGO no da un
total: da una ventana de 24h por cada `step`, todas solapadas y alineadas a límites absolutos. Quedarse
con el máximo devolvió **35.036** donde el total era **3.343** — un entero plausible, sin ninguna señal
de que estaba mal. El total lo da la consulta **instantánea** (`/query`). Mismo arreglo en el trazador
(`valorInstantaneo`).

> Los dos errores fueron de la herramienta, no del modelo — y el segundo se escribió arreglando el
> primero. **El reflejo de «ya lo arreglé» es exactamente cuando se mete el siguiente.**

---

# Reglas de esta carpeta

- **Solo lectura sobre los repos de la compañía**, salvo que una herramienta diga lo contrario en su
  nombre y en su docstring.
- **La key nunca se commitea**: `.env` está gitignoreado, `.env.example` es la plantilla versionada.
  Los `_*.json` (selecciones, contrastes) son artefactos de corrida y tampoco se commitean.
- Python **3.9** del sistema y **solo stdlib** (`urllib`) — sin `pip install`, sin venv.
