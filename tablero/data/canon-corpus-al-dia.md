---
id: 74
title: "Canon: el corpus al día con main y con los docs de Santi"
ramas: canon/gate-de-preaprobado, canon/tema-nequi, canon/tablas-al-dia, canon/ronda-en-cero, canon/la-ronda-dice-como-leer-el-diff, canon/la-ficha-los-codigos-y-la-difusion, canon/las-dos-guardas-del-borrador, canon/leer-el-tema-por-partes, canon/el-recorte-tambien-por-api, canon/las-herramientas-por-http, canon/el-catalogo-no-miente, canon/la-historia-no-necesita-clones, canon/como-llegar-desde-un-agente, canon/el-arranque-en-markdown, canon/identidad-de-credifamilia, canon/altas-y-el-techo-de-palabras, canon/la-cartera-corregida, canon/arquitectura-en-dos-nodos, canon/onboarding-y-los-formularios, canon/el-cierre-y-sus-documentos, canon/el-empujon-por-glosario
stage: work
created: "2026-09-07T08:30:00-05:00"
context_nodes: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Canon (`Creditop-SAS/playground`, `tools/canon`, `canon.playground.creditop.com`) describe lo que corre en
`main`, y tenía dos huecos que Santi hizo visibles el 2026-09-06 al contar que su documentación vive en
`legacy-backend/docs/lenders/`: **un gate de preaprobado por configuración** que el corpus no nombraba
(#120, mergeado) y **la integración de Nequi entera** —59 archivos en dos repos, 44k palabras de doc del
equipo— sin un solo tema (#121, mergeado). El diccionario de tablas también estaba viejo (09-03) y le
faltaban las cinco columnas de Nequi (#122, mergeado). Y de paso salió el tercer hueco, que no era de
Santi: la **ronda** marcaba 78 cambios en 50 archivos declarados sin releer (#123, mergeado).

**Estado real al 2026-09-07: los pasos 1, 2, 2b y 3 están MERGEADOS** (#120, #121, #122, #123), la
ronda quedó en **0 cambios**, y salió un quinto PR de la pista muerta que apareció en el camino
(#124: la ronda mandaba a un comando retirado). El paso 4 —una línea de «qué hace» por archivo— sigue sin empezar, y ya
está medido: lo merecen sólo **37 de 816** archivos declarados (nombres genéricos como `api.php`,
`index.ts`, `Kernel.php`, `services.php`) más los **71** nombres que se repiten entre carpetas, o sea
~5%; el resto lo dice su propio nombre y el `objetivo` del área. Hacerlo exige cambiar la forma del
mapa (`"ruta": "hash"` → objeto con hash más línea), que toca el lint, el oráculo, la ronda y el
redactor: es una tarea propia, no una línea más.

No hace falta volver a leer la doc de Nequi ni los diffs de la ronda: lo verificable ya está en el
corpus, y lo que no coincide con `main` está anotado en Riesgos.

Y entró un frente que no estaba en el plan: Miguel pasó un **documento de candidatos** de la operación
de julio a septiembre, con la instrucción de validar antes de copiar. Se validó bloque por bloque y
entró lo que el corpus no tenía y resistió la verificación (#125): la ficha en blanco con su trampa
legal, cómo se lee un código del sistema nuevo, la difusión masiva sin idempotencia, y el sobre entre
módulos con las puertas sin credencial. Un bloque **ya lo teníamos** (el mecanismo del límite por
documento) y otro llegó **truncado** (el servicio de formularios).

Y el 2026-09-07, con la llave de escritura ya puesta, se **dictó por API por primera vez de verdad**
(#134): cinco documentos de CrossCore y Evidente que pasó Fercho, validados contra `main` antes de
escribir, de los que entraron dos secciones a `kyc`. El camino de escritura funcionó de punta a punta
—lint, guarda del banco y control de duplicado, los tres en silencio— y de paso destapó su propio
hueco: el guion pedía los archivos pero no el `objetivo` del área que forman, así que el área nacía con
un eco del título. Arreglado en el mismo PR, con el aviso en el momento de la omisión y el ensayo que
lo protege.

Y el 2026-09-08 se cerró el frente que Miguel abrió con una objeción de fondo —**que cada sección cargue
las palabras con que llega su pregunta no escala**— y terminó en algo bastante más grande. **PR #140,
MERGEADO** (`3f4df39`), en cinco partes:

1. **El glosario empuja a la sección que apunta.** Las palabras del reporte viven en un solo lugar con
   dueño en vez de repetirse en cada sección. 115/115 en la compuerta, 1er resultado de 89 a 92;
   apagándolo, 113/115. Los tres parches de prosa salieron, y uno nunca había hecho falta.
2. **Dos bugs viejos que destapó:** el glosario no se podía recortar (el recorte leía un solo balde de
   resultados), y dos pruebas elegían su tema recorriendo un mapa sin ordenar.
3. **Se guarda la TRAZA de cada pregunta.** Antes se guardaba el conteo de pasos y la traza —que ya
   estaba en la mano— se tiraba, así que del CÓMO llegó no quedaba nada. Ahora `-chats` resume «cómo
   llega» sin pedir SQL.
4. **Se sacó el ruido de «cómo se debe usar»:** tres frases hacían del banco la vara, y el guion que el
   modelo lee abría clasificando la pregunta y dictando cinco pasos. Las tres reglas quedaron arriba del
   README, antes de cualquier comando.
5. **Y el mapa del prompt dejó de decidir:** dice los TEMAS y ninguna de las 309 anclas. El atajo
   ahorraba un paso en el 13% y desviaba en el 20%; afuera, la pregunta afectada pasó de 1 de 3 a 3 de 3
   y el prefijo cacheado adelgazó ~4.200 tokens.

⚠ **La tensión del modelo que había quedado abierta —contestaba desde la entrada del glosario en vez de
seguir el enlace— se resolvió con la parte 5, y no con prosa ni con guion:** era el atajo del mapa, no el
glosario.

**El próximo paso es:** seguir con los temas que quedan. De los nodos gordos ya se partieron
`arquitectura`, `onboarding` y `formalizacion`; queda `kyc`, que ahora SÍ se puede tocar porque #134
mergeó — y es el que tiene los hallazgos más caros: el impostor del buró ya no se elige por el nombre del
ambiente, así que **en local sin host de simulación la consulta se paga contra el proveedor real**, y la
credencial del proveedor queda en claro en una columna que el modelo no oculta. Después, `bancolombia`
(12 hallazgos) y los demás. Referencia de tamaño: **`onboarding`** (16 secciones, 9
hallazgos) en «donde nace la solicitud» contra «qué se le pregunta al cliente»; **`formalizacion`** (18
secciones, 11 hallazgos) en «el cierre» contra «los documentos y quién los dibuja»; y **`kyc`** (18
secciones tras #134, 11 hallazgos y los más caros de todos — el impostor del buró ya no se elige por el
nombre del ambiente, así que en local sin host de simulación **la consulta se paga contra el proveedor
real**, y la credencial del proveedor queda en claro en una columna que el modelo no oculta). ⚠ `kyc`
espera a que #134 mergee, para no apilar ramas.

Y ojo con la distinción que el lint mezcla: hay **nodos** grandes —se parten moviendo secciones— y hay
**áreas** grandes (bancolombia con 28 archivos en 15 carpetas, nequi, listado, smartpay), que se parten
dividiendo un objetivo en varios y **no tocan la prosa**. Son dos trabajos distintos.

Pendiente de antes: el paso 4 (una línea por archivo, 37 de 816) sigue sin decidir; falta el resto del
bloque del servicio de formularios, que llegó cortado; y de los documentos de Fercho queda la tabla de
decisión de la biometría, el candidato más claro. ⚠ Y algo que no es de canon y no puede esperar: uno de
esos documentos trae **la credencial de producción y el identificador de inquilino en claro**, diez
veces, en `~/Downloads/fer/`.

## Objetivo

Que todo lo que Santi documentó y ya está en `main` sea consultable en canon, en lenguaje de negocio y
verificado contra el código; que ningún tema declare hashes viejos sin que alguien haya releído qué cambió;
y que el diccionario de tablas diga las columnas que la base de prod tiene hoy.

## Dónde se toca

- `github/playground/tools/canon/content/<tema>/{context.md,map.json}` — la prosa y el mapa.
- `content/tablas.json` — generado con `dev/tablas.py` desde tres CSV de `information_schema` de prod.
- Fuente de verdad ajena: `legacy-backend/docs/lenders/nequi/{README,ESTADO,CONTRATOS}.md` (Santi,
  últimas fechas 2026-08-14, último commit 08-18) — se lee, no se copia.
- El código real: `legacy-backend` (`app/Services/Lenders/Nequi/`, `Modules/Onboarding/…/NequiPayment*`,
  `app/Console/Commands/ReverseExpiredNequiIntentsCommand.php`) y `frontend-monorepo`
  (`modules/loan-request-wizard/lenders-marketplace/src/components/nequi/`, rutas `nequi-payment*`).

## Cómo se ataca

1. **Gate de preaprobado por configuración** — `content/preaprobado` + cruce desde `listado`. ✅ #120.
2. **Tema `nequi`** — seis secciones, cuatro áreas, 59 fuentes con hash; entrada en el glosario; enlazado
   desde `listado`, `cuota`, `vocabulario`. ✅ #121. 2b. **Tablas al día** — PR abierto.
3. **Barrido de la ronda** ✅ #123. 78 cambios en 50 archivos, leídos diff por diff (hash declarado →
   blob de `main`) y agrupados en **seis frentes**: monto por comercio · KYC de dos flujos · país
   (documentos y TyC) · rechazo del asesor en BCP · fianza y garantía de CreditopX · arrastres de Nequi
   y menores. 15 temas tocados, hashes subidos **después** de releer, ronda en 0.
4. **«Qué hace cada archivo»** — medido: lo merecen 37 de 816 (nombres genéricos) más 71 nombres
   repetidos. Exige cambiar la forma del mapa; pendiente de decisión.
5. **Las guardas del camino de escritura** ✅ #126. La del banco ya existía a medias y ahora mira los
   cinco escalones, no sólo el último: avisa cuando una pieza empuja una pregunta hacia abajo sin
   romperla. Más un aviso de duplicado por solapamiento del título, calibrado sobre seis casos. Y el
   arnés del dictado, que tenía tres suposiciones caducadas, de 12 fallos a 0.
6. **Leer un tema entero se recorta** ✅ #127 (la herramienta del agente) y ✅ #128 (la API que usan
   los agentes del equipo, con el mapa recortado también y el `q` ya puesto en la sugerencia de flujo).
   Un tema sin ancla devolvía todas sus secciones: 4.547 tokens contra 200 de una sección típica. Ahora
   trae las que responden, con el índice de anclas completo para pedir las demás. Habilita decidir el
   techo de palabras con datos en vez de a ojo.
7. **Canon usable desde un agente externo** ✅ #129, #130 y #131. De las nueve herramientas del
   agente, dos vivían sólo adentro y dos existían sin anunciarse. Ahora el catálogo ofrece 13 y un
   agente externo alcanza el corpus, el código de un área, el contenido de un archivo declarado, dónde
   vive un archivo y la historia de un archivo. Le falta el grep —necesita clones y el despliegue no
   los tiene a propósito— y consultar producción, que espera decisión.
8. **La API se explica a sí misma para un agente** ✅ #132 y #133. `/api` dice CÓMO llegar y no es lo
   mismo según por dónde entró el pedido: por el dominio advierte de la VPN y manda a curl desde la
   consola, por localhost advierte que el corpus embebido es una foto y que hereda el `.env`. Y
   `/claude` —con `/arranque` como alias neutro— devuelve un markdown de 2.600 tokens que reemplaza
   las cuatro llamadas de 14.000: cómo llegar, el rito con comandos, las reglas, el catálogo, los
   resúmenes de los 28 temas y cómo dictar. Se COMPONE de la API, así que no puede derivar como
   derivaron las tres guías borradas en agosto.
9. **El documento de candidatos** ✅ #125. Validado bloque por bloque contra el corpus y contra `main`
   antes de escribir nada: de cinco bloques, **uno ya estaba**, **tres entraron** con correcciones, y
   el quinto llegó truncado. Las cifras de disponibilidad del documento **no entraron**: no salen del
   código y no se midieron.

## Lo que se evaluó y NO se eligió

- **Correr el bucle de agentes en prod para el barrido** (ronda → analizar → redactor por tema). Es el camino
  diseñado para el día a día, pero acá los cambios se conocen —la mayoría son las adiciones de Nequi que ya se
  leyeron— y el redactor gasta tokens de Bedrock por tema. Se barre a mano con el triage de 0 tokens; el bucle
  queda para lo que entre después.
- **Poner una línea «qué hace» en cada archivo del mapa.** Son 983 archivos declarados; el `objetivo` del
  área ya dice qué hace el grupo, y una línea por archivo envejece con cada refactor. Se hace sólo donde el
  nombre miente, y primero se mide cuántos son.
- **Copiar los ejemplos de código y los endpoints de la doc de Santi al tema.** El lint los rechaza a
  propósito (nombres de archivo, CamelCase, rutas HTTP): el tema dice qué pasa y por qué; el mapa dice dónde.

## Lo que está decidido

> **DECISIÓN · 2026-09-07** — un tema nuevo tiene que encontrarse por su propio vocabulario, no por las
> palabras de todos. La primera versión de `nequi` bajó el banco a 112/115 y rompió el test del glosario
> por densidad («solicitud» ×25 en 1.961 palabras contra 6 en `bancolombia`; «consulta», «modelo agregador»).
> Con la densidad bajada: 115/115, soporte igual que `main`, glosario ✓.

> **DECISIÓN · 2026-09-07** — la doc de Santi es un SEGUNDO OBSERVADOR, no la fuente: cada afirmación se
> cotejó contra `main` y contra prod antes de escribirla. Lo que no coincide (abajo) se le reporta, no se copia.

> **DECISIÓN · 2026-09-07** — un PR por pieza: gate (#120), tema (#121), tablas, barrido. Nunca apilados.

## Lo que está bloqueado

> **PREGUNTA · 2026-09-07 · Miguel** — las incongruencias de la doc de Santi (abajo, «Riesgos»): ¿se las
> pasamos nosotros o las corrige él cuando retome Nequi?

> **PREGUNTA · 2026-09-07 · Miguel** — ¿se hace el paso 4? Son 37 archivos de 816 y obliga a cambiar la
> forma de `fuentes` en todos los mapas (hash → objeto), con su lint, su oráculo y su redactor.

> **PREGUNTA · 2026-09-07 · Miguel** — el bloque 5 del documento de candidatos (el servicio de
> formularios en Go, con su cadena de caché) llegó **cortado** en el diagrama. Falta el resto para
> validarlo; el corpus ya declara ese servicio como hueco conocido.

> **MEDICIÓN · 2026-09-07** — cuánto vale el recorte, y para quién. Sobre el tema más grande: entero
> 8.816 tokens en JSON y 4.547 en markdown; con términos, 2.725 y 923 — o sea −69% y −80%. Y cuán
> seguido aplica: de las 115 preguntas del banco, **30 (el 26%) ofrecen leer el tema entero**, sobre
> todo bancolombia (7), altas (5) y cartera (4); las 30 sugerencias traen el `q` puesto.
> ⚠ **Pero la pregunta de flujo que se corrió en prod NO lo ejercitó**: el agente resolvió con dos
> llamadas de secciones por ancla, agrupadas, y nunca pidió el tema entero — 3 pasos, 23,8 s,
> respaldada. Lo mismo en las otras seis preguntas del día. Así que el ahorro probado es de la vía de
> la API y de red de seguridad; **falta saber cuán seguido el agente pide un tema entero**, y eso se
> contesta contando los pasos `leer` sin ancla en las corridas guardadas en Postgres, que no se
> exponen por la API.

> **MEDICIÓN · 2026-09-07 · los minutos del día, corregidos** — los cuatro asientos sumaban 325
> minutos puestos por impresión. El pulso da **3h00** y el lapso de commits del repo compartido da
> **178 minutos en tres tramos** (08:54-10:19, 11:29-12:55, 14:04-14:12): las dos mediciones concuerdan,
> así que se repartieron los 178 por tramo y quedaron cinco asientos de 55, 29, 50, 36 y 8. La regla del
> repo es minutos MEDIDOS y estos estaban estimados. ⚠ Y hay un motivo por el que la jornada se siente
> más larga: buena parte fue leer, medir y esperar despliegues, y eso no toca archivos, así que ninguna
> de las dos medidas lo cuenta.

> **MEDICIÓN · 2026-09-07** — tres errores propios encontrados midiendo, y los tres del mismo tipo:
> el código funcionaba y el contrato mentía. (1) El catálogo anunciaba `ruta` donde el endpoint lee
> `archivo`; la prueba que lo impide llevó **tres** intentos, y los dos fallidos quedan escritos porque
> parecían correctos. (2) Registré el grep y la historia con el mismo candado y son dependencias
> distintas: en prod las dos daban 404 y una podía funcionar. (3) Probando desde el directorio del
> proyecto el grep respondía sin clones, porque el `.env` local los define — hay que probar desde
> `/tmp`, como el banco.

> **MEDICIÓN · 2026-09-07 · en producción, verificado** — el endpoint recortando: markdown entero
> 18.189 b contra 3.692 con términos (−80%), JSON entero 35.265 b contra 10.900 (−69%), las dos con su
> nota de recorte. ⚠ La primera tanda de tres medidas dio una anomalía —el markdown sin recortar— y NO
> era un bug: fue la ventana del despliegue rodante, dos instancias conviviendo. Reproducido un minuto
> después, las tres recortan. Guardado en la memoria de la sesión: el detector confirma que UNA
> instancia tiene lo nuevo, no todas.

> **DECISIÓN · 2026-09-07** — el arranque para un agente es un documento GENERADO, nunca escrito
> aparte: se compone de cómo llegar, las reglas, el catálogo y los resúmenes del corpus, que ya se
> sirven por otras puertas. Es la misma razón por la que se borraron CANON.md, CLAUDE-CODE.md y
> CREDIBOT.md el 2026-08-28. Y su prueba EJECUTA los comandos que enseña: componer no alcanza, porque
> un ejemplo con una ruta vieja es peor que no dar ejemplos.

> **DECISIÓN · 2026-09-07** — canon se puede consultar de dos formas y las dos se mantienen: su agente
> por la entrada de preguntas (la única que usa el bot de atención) y las herramientas por HTTP para
> quien orquesta desde afuera. Nada se quitó; el frontend quedó verificado endpoint por endpoint.

> **PREGUNTA · 2026-09-07 · Miguel** — ¿se expone consultar producción por HTTP? Hoy vive sólo dentro
> del agente, protegido por el guardián de sólo lectura. Abrirlo es tráfico a Redash desde fuera de la
> red. Si se abre, la forma correcta es aceptar POST **y** el método QUERY en la misma ruta: QUERY
> expresa lo que la operación es —lectura idempotente y cacheable con cuerpo— y el balanceador ya lo
> pasa, comprobado el 2026-09-07 con y sin cuerpo. Sigue siendo un borrador del grupo de HTTP, no un
> RFC, así que aceptar los dos evita apostar.

> **DECISIÓN PENDIENTE · 2026-09-07 · Miguel** — el techo de palabras. Miguel propuso subirlo de 3.000
> a 5.000 o 10.000; la recomendación fue no hacerlo por dos números medidos (leer un tema entero
> costaba 8.828 tokens en JSON y 4.559 en markdown, y sólo 2 de 28 temas están llenos) y partir los dos
> llenos. Con #127 el costo de leer bajó un 76% de media, así que la decisión se puede tomar con datos:
> falta medir el banco con un tema partido contra el mismo entero.

> **DECISIÓN · 2026-09-07** — la escritura desde el chat va como HERRAMIENTA del agente que ya
> contesta, no como agente separado: el que respondió ya tiene los archivos, los hashes y el porqué, y
> uno nuevo los reconstruiría. El bucle de cinco labores se retiró el 2026-09-03 por caro y esto no lo
> reintroduce. Y el aviso «el corpus no cubre esto» se muestra a TODOS, con o sin llave: es un campo
> del contrato de la respuesta, ocultarlo en el front sería cosmético y filtrarlo en el servidor daría
> dos respuestas distintas según quién pregunta. Sólo la ACCIÓN de agregar va con llave, y ya era así.

## Riesgos

> **RIESGO · 2026-09-07** — la doc de Nequi del equipo ya está detrás de `main` en tres cosas: describe el
> front como pendiente (está integrado desde el 14/8, 29 archivos), dice «migración pendiente» (en prod corrió),
> y el diagrama de §2 conserva «modo both → la UI elige» cuando §1 lo saca del alcance. Quien la lea sin
> canon se va a confundir.

> **RIESGO · 2026-09-07** — el barrido que reversa intentos vencidos de Nequi **no está agendado** (el
> planificador no lo nombra; su propia descripción lo advierte). Cuando la entidad se configure, los intentos
> vencidos se van a acumular. Está escrito en el tema; conviene que lo vea quien encienda Nequi.

> **RIESGO · 2026-09-07 · RESUELTO** — la ronda sugería `canon -expediente <tema>`, retirado el
> 2026-09-03 con el bucle de agentes. Arreglado en #124: la pista pasa a ser el diff entre el hash
> declarado y el de `main`, y la línea de cada cambio imprime los dos hashes (que ya estaban en el
> JSON y son los argumentos de ese diff). De paso, el README listaba un script borrado.

## Lo que NO entra

- Corregir la documentación de Santi en `legacy-backend` (es su repo y su doc: se le reporta).
- Configurar Nequi en prod (credenciales, estados, NIT de los aliados): es del equipo, no del corpus.
- Reescribir temas enteros que la ronda no marcó.

## Cómo se comprueba

Desde `tools/canon`, siempre con el binario recién construido (`-lint` y `-bench` leen el corpus EMBEBIDO):

    go build -o /tmp/canon-lint . && /tmp/canon-lint -lint && (cd /tmp && /tmp/canon-lint -bench)
    go test ./...                       # incluye el test del glosario recortado
    /tmp/canon-lint -ronda              # qué archivos declarados cambiaron en main

> **MEDICIÓN · 2026-09-07** — banco 115/115 desde `/tmp`; soporte con las mismas tres ✗ que `main`
> (construido en un worktree aparte); equipo 26/26.
> `git worktree add /tmp/canon-head-wt origin/main && (cd /tmp/canon-head-wt/tools/canon && go build -o /tmp/canon-head .) && /tmp/canon-head -soporte`

> **MEDICIÓN · 2026-09-07** — prod, por las herramientas de datos de canon: `lender_transactions` con 14
> columnas (las 5 de Nequi incluidas); `lender_allied_credentials` y `lender_transaction_statuses` con **0**
> filas para la entidad 192.

> **MEDICIÓN · 2026-09-07** — prod, sólo lectura, lo que respalda el barrido: **3 de 341** comercios
> declaran rango de monto · **1 de 341** tiene NIT (la doc del equipo medía 4 de 275 en dev) ·
> `document_types` **todavía no existe** en prod · la lista del pipeline de KYC tiene **un** comercio
> (ajuste 67, `{"allieds":[91]}`, tocado el 2026-09-03).
> `make trazador-sql TARGET=prod SQL='SELECT … FROM allieds' · … FROM settings WHERE \`key\` LIKE "%kyc%"`

> **MEDICIÓN · 2026-09-07** — el paso 4, antes de hacerlo: 816 archivos declarados, **37** con nombre
> genérico y **71** nombres repetidos entre carpetas. Los sufijos de rol ya dicen qué hace cada uno
> (86 `Service`, 82 `Controller`, 23 `Request`).

> **MEDICIÓN · 2026-09-07** — el documento de candidatos, verificado contra `main`: el tope del
> formulario personal sale de `personal_info_settings.rate_limit_rules` con **default 4**, se evalúa
> **sólo por documento** en Redis, y su clave tiene un **typo** (`..._per_houre`) que se lee primero;
> el bloqueo sale como `ONB040`/400, que es el genérico del onboarding y **no identifica el bloqueo**.
> La ficha temporal es `TEMP-<4 dígitos>-<celular>` con nombre `TEMPORAL USER` y tipo `-`. La difusión
> tiene `MESSAGING_SERVICE_TIMEOUT=10` **más `retry_times=2`**. Y **12 de 23** módulos llevan
> `TECHNICAL_DEBT.md`, **10** `ARCHITECTURE_EXCEPTIONS.md`, con `NEW_ARCHITECTURE.md` (22.340 palabras)
> como guía canónica.

## Registro

### 2026-09-08

- **#140 MERGEADO (`3f4df39`) y VALIDADO EN PROD**, con las dos preguntas de presupuesto y ninguna más.
  Prod corre `us.anthropic.claude-sonnet-5`.
  - «un cliente dice que le aprobaron y después le dijeron que no, qué le explico» → **respaldada, 4
    pasos, 17,4 s**, y **buscó DOS veces con palabras distintas** antes de leer: exactamente la conducta
    que habilita el cambio. Citó cuatro secciones de cuatro temas y contestó lo correcto —que lo que el
    cliente vio era un preaprobado, una estimación, y que eso pasa por diseño en varias entidades.
  - «qué pasa si el comercio cambia el plazo después de que el cliente firmó» → **respaldada** y con un
    `no_pude` honesto para el caso puntual, contestando bien los dos escenarios (crédito vivo por el hub
    de autogestión, con el hueco de validación conocido; y el plan de pagos). Pero **se comió los 14
    pasos y terminó en aterrizaje forzoso, 48,9 s**.
  - ⚠ **HALLAZGO, y es el costo del cambio con nombre y apellido:** de esos 15 pasos, **11 fueron `leer`
    y 8 de ellos de a UN id**. Sin el índice de anclas en el prompt, una pregunta que cruza varios temas
    descubre las anclas buscando y después las lee de a una, y ahí se acaba el presupuesto. Los primeros
    `leer` sí usaron el plural y después dejó de usarlo.
  - **No es un bug nuevo ni una sorpresa del todo:** el mismo cuadro —quedarse sin pasos repitiendo una
    herramienta— está documentado en el README de canon, y ahí la lección fue que **el arreglo es de
    herramienta**: a la tercera vez que pedía la misma área se le dio el índice en vez de regiones, y los
    pasos bajaron de 15 a 10-12 con −23% de entrada. El mismo tipo de arreglo aplica acá y **no se hizo**:
    es un cambio propio, con su propia validación de dos preguntas nuevas, y la decisión es de Miguel.
  - **Y una lección del despliegue, que costó una confusión:** es RODANTE. La sonda gratis dijo
    «desplegado» y el read siguiente devolvió `not_found` — dos pods distintos. Con 12 sondas seguidas dio
    12 de 12 nuevo. **Una sonda sola puede mentir mientras rueda: hay que sondear varias veces.**

- **Y Miguel aprobó la versión fuerte: el mapa del prompt dice los TEMAS y ninguna ancla.** Listaba las
  309 anclas de los 32 temas, y eso decidía por el modelo: una cuyo nombre se parecía a la pregunta era
  un atajo irresistible —iba derecho con `leer` y **no buscaba nunca**—, así que el ranking y cualquier
  mejora del ranking no participaban.
  - **Medido con `-atajo`, que se escribió para esto:** sobre el banco propio el atajo acertaba en 15 de
    115 y **desviaba en 23**; sobre el de soporte, escrito con las palabras con que llega un reporte,
    acertaba en 6 y desviaba en 12, y en **121 de 139** no alcanzaba. Ahorraba un paso en el 13% y
    mandaba a otro lado en el 20%.
  - **Con el atajo afuera, tres corridas del mismo modelo:** «el error del banco no dice nada util» pasó
    de 1 de 3 a **3 de 3**, y buscó en las tres. Quitando sólo las anclas del glosario daba 2 de 3 — el
    problema no era el glosario, era el atajo.
  - **Lo que cuesta, dicho completo:** las preguntas que el atajo acertaba pagan ahora un `buscar` (un
    paso, ~2.000 tokens sin caché), y a veces adivina un ancla, se lleva un rechazo y se recupera solo. A
    cambio el prefijo cacheado adelgaza **~4.200 tokens** y el camino lo elige el modelo: el corpus crece
    y esto no cambia. Ése es el punto — el atajo empeoraba a medida que hubiera más secciones parecidas.
  - **Tres cuidados:** lo fija una prueba con el motivo al lado (listar las anclas parece una gentileza);
    `-atajo` pasa a ser explícitamente un CONTRAFÁCTICO, porque medir «a dónde manda» describiría algo
    que ya no existe; y `EsDelGlosario` vuelve a tres usos, con su comentario al día.
  - **Probado con dos preguntas nuevas, de ningún banco:** «por qué una solicitud queda en el mismo
    estado varios días» → respaldada, arrancó buscando, y dio los dos motivos frecuentes (validación de
    identidad vencida y espera de firma del codeudor). «Qué se necesita para que una entidad nueva salga
    en el listado de un comercio» → respaldada, y **se armó un recorrido de cuatro pasos por su cuenta**
    citando tres temas distintos.
  - ⚠ El proveedor devolvió 503 dos veces en el medio. No era el código: el reintento contestó de una.

- **Y el cierre del día fue sacar el ruido, que es la parte que evita repetir el error.** Miguel lo pidió
  así: eliminar de «cómo se debe usar» todo lo que lleva a caer en lo mismo, decir que el banco es un
  EJEMPLO, que probar es con dos preguntas completamente nuevas, y mantener la metáfora de las
  herramientas versátiles.
  - **Lo que llevó a equivocarse estaba escrito, y sonaba razonable.** Tres frases hacían del banco la
    vara: «el banco es la única medida de si el agente contesta bien», «el orden de los resultados no
    cambia: el banco lo mide» y «el lint y el banco de preguntas contestan ahí». Y en la historia, el
    título «`-soporte`, la vara real» caducó por la misma razón —también es un archivo—: ahora lo dice y
    apunta adelante, sin reescribir lo medido.
  - **Las tres reglas quedaron ARRIBA del README, antes de cualquier comando**: herramientas versátiles
    en vez de instrucciones (ya estaba medido, pero vivía en la línea 509); el banco como ejemplo; y dos
    preguntas nuevas por cambio, con las tres cosas que se miran de la respuesta —`respaldada`, a qué
    ancla citó, y la traza— y por `/api/pregunta`, que es el único camino que guarda.
  - **Y la prueba práctica que faltaba, para no volver a meter una respuesta prefabricada: ¿esto describe
    el DATO, o dice qué hacer con él?** Si dice qué hacer y lo correcto depende de la pregunta, va afuera.
  - **El guion que el modelo lee quedó sin procedimiento impuesto.** `skills/consultar.md` abría
    clasificando la pregunta en dos tipos y seguía con cinco pasos numerados; ahora abre diciendo que el
    camino lo elige él, y lo que queda son los hechos medidos de la búsqueda. No se perdió una medición:
    se perdió el orden que nadie pidió. Igual el «empezá por `ubicar`» del prompt.
  - **Probado con la regla misma, dos preguntas de ningún banco.** «Qué temas del canon declaran el
    archivo que calcula la cuota del listado» → respaldada, y **usó `ubicar` por su cuenta** con el plural
    y los tres archivos en una llamada, sin que nadie le diga por dónde empezar. «Qué pasa si el cliente
    abandona el formulario a mitad y vuelve al otro día» → respaldada con lo que sabe y **nombrando el
    hueco** (el canon no cubre la persistencia de un formulario abandonado), que queda guardado como
    deuda de cobertura.

- **Y una tercera vuelta, de dos preguntas de Miguel — las dos con respuesta concreta en el código.**
  - **«¿estamos guardando el flujo para analizarlo después?» → NO.** Se guardaba `pasos integer`, el
    CONTEO. La traza existe desde siempre (la lista ordenada de `buscar(q=…)`, `leer(ids=…)` y los
    rechazos del bucle), **ya estaba en la mano** al guardar porque de ella se derivan las fuentes, y se
    descartaba. Del QUÉ contestó quedaba todo; del CÓMO, un número. Y no es teórico: el bug del mapa se
    tuvo que medir corriendo preguntas A MANO, de a una.
  - Ahora se guarda como `traza text[]`. Tres cuidados que valen más que el campo: **la migración va
    aparte** (`CREATE TABLE IF NOT EXISTS` no toca una tabla existente, y el protocolo extendido no
    acepta dos sentencias en un `Exec` — pegar el `ALTER` al `CREATE` rompía el arranque **sólo en el
    ambiente con datos viejos**); el modo sin texto conserva los nombres de herramienta y tira los
    argumentos; y **el análisis no exige SQL** — `-chats` gana la vista «cómo llega» (con qué arranca,
    cuántas NUNCA buscan, qué se llevó un rechazo). ⚠ La traza existe desde ahora: los turnos viejos no
    la tienen, y la vista lo dice.
  - **«nada prefabricado; que el modelo decida» → y tenía razón sobre algo que YO había metido.** La
    nota del glosario decía qué HACER con él: primero «se cita como cualquier sección», después mi
    cambio de la mañana, «es una PUERTA, leé la sección enlazada». Las dos son la misma clase de error, y
    **ninguna se pudo medir**. Lo que movió la aguja fue quitarle el atajo a la herramienta. Las saqué;
    la nota describe el dato y nada más. **La prueba práctica queda: ¿esto describe el dato, o dice qué
    hacer con él?**
  - **Y el método cambió, a pedido suyo: cada cambio se valida con DOS preguntas concretas y distintas,
    NUNCA del banco** — el banco es red de seguridad, no vara, porque el objetivo es contestar cualquier
    pregunta y no las 115 curadas. Hecho: «si un comercio quiere subir su monto mínimo, dónde se toca y a
    quién le pega» (respaldada, 2 pasos, arrancó buscando) y «por qué a dos clientes de la misma tienda
    les salen entidades distintas» (respaldada, 3 pasos, y contestó bien que la visibilidad se define en
    la SUCURSAL). La segunda citó una entrada del glosario **a la que llegó buscando**, que es
    exactamente para lo que se dejó de anunciarla como destino.

- **Y la segunda mitad del día salió de una pregunta de Miguel: «¿y si no le damos todo masticado, y que
  el modelo decida cómo consulta?»** Medirlo movió más que el arreglo de la mañana.
  - **Las formas de consultar ya son diez** (`buscar`, `leer`, `grep`, `codigo`, `archivo`, `historia`,
    `tablas`, `ubicar`, `datos`, `contestar`) y el modelo las usa: **mediana de 5 pasos**, p90 15-17 en
    las corridas guardadas. Eso no era el problema.
  - **Lo masticado es el MAPA del prompt**, y ahí estaba el bug: anunciaba todas las anclas de todos los
    nodos, glosario incluido — cuando `Search` manda el glosario a un balde aparte **justamente para que
    no compita como respuesta**. Dos capas en desacuerdo. Con un ancla que nombra la frase del reporte,
    el modelo iba derecho con `leer`, contestaba desde la definición y **no buscaba nunca**: o sea que el
    empujón de la mañana **ni se disparaba** en su camino.
  - **Medido, tres corridas por pregunta:** «por que todos aparecen como empleados» de **1 de 3 a 3 de
    3** (y buscó las tres veces); «el error del banco no dice nada util» de 1 de 3 a 2 de 3; y el caso
    inverso —«salen en refactor», donde la respuesta ES una entrada— sigue andando, 2 de 2. Las
    respuestas pasaron de 49-75 palabras a 112-132, citando las dos fuentes. Cuesta ~30k → ~48k de
    entrada cuando de verdad busca y lee; el prefijo cacheado adelgaza ~192 tokens.
  - **Y queda el instrumento: `-atajo`, cuesta cero.** El banco mide el buscador; esto mide el otro
    camino. Banco propio: 15 atajos buenos, **22 engañosos**, 78 sin atajo. Banco de soporte —el idioma
    con que llega un reporte—: 6 buenos, 12 engañosos y **121 de 139 sin atajo**. La medición que
    justificó el mapa era de COSTO; nadie había medido a dónde apunta cuando apunta mal.
  - ⚠ **DECISIÓN PENDIENTE de Miguel: la versión fuerte de su idea.** Sin ningún índice de anclas en el
    mapa, la pregunta del error del banco da **3 de 3** (contra 2 de 3 quitando sólo el glosario) y busca
    siempre. Sacaría los 22 atajos engañosos a cambio de los 15 buenos: **neto +7** por este proxy. NO se
    aplicó: es el contrato central, toca las 115 preguntas, y validarlo honesto es el banco de modelo,
    que cuesta. Es un `if` de una línea en `mapaDelCorpus` cuando se decida.
  - De paso, `EsDelGlosario` en un solo lugar: eran cuatro checks a mano que tienen que estar de
    acuerdo, y este bug es exactamente lo que pasa cuando se desincronizan.

- **El problema de las palabras dejó de arreglarse a mano.** Venía medido cuatro veces: agregar prosa a
  un tema bajaba el banco léxico, y la causa no era el volumen sino que **la sección que contesta no
  tenía las palabras con que llega la pregunta** y otra sección sí. El arreglo que se venía aplicando
  —escribir las dos formas EN la sección— cuesta media línea y hay que pagarlo en cada sección: con 306
  se aguanta, con 3.000 es un impuesto que nadie mantiene. Miguel lo objetó con esa razón exacta y tenía
  razón.
- **El arreglo (PR #140, hoy MERGEADO): el glosario empuja a la sección que apunta.** Las palabras del reporte
  ya tienen un lugar con dueño —el glosario, que por diseño se escribe con ellas— y cada entrada ya
  enlaza la sección que contesta. Ahora ese enlace se usa para rankear: si la consulta pega en una
  entrada, sube lo que la entrada apunta. Es la forma del grafo de entidades (consulta → entidad →
  documentos), con la entidad escrita a mano y cada empujón auditable en un campo propio de la respuesta.
- **Medido, con la compuerta léxica que es gratis:** 115/115 entre los tres primeros (igual que `main`) y
  el 1er resultado sube **89 → 92** con el empujón. Apagándolo sobre el mismo contenido: **113/115**. Ésa
  es la atribución — las entradas solas no alcanzan, el empujón las convierte en ruteo.
- **Los tres parches de prosa salieron** (`kyc`, `bancolombia`, `creditopx`) y pasaron a ser entradas de
  glosario. Y salió algo que vale más: **el de `creditopx` no cae ni con el empujón apagado** — nunca hizo
  falta. Se había agregado por analogía con los otros dos y nadie lo comprobó.
- **Dos límites del empujón, los dos aprendidos en rojo.** Pesa por cuánto de la pregunta cubre el
  **nombre** de la entrada, no su cuerpo: sin eso la entrada genérica «Entidad» empujaba sus secciones en
  cualquier consulta que dijera «entidad» y le ganaba a la correcta (115 → 114). Y es una fracción del
  acierto del glosario, para no pisar a una sección que matchea de frente.
- **Dos bugs que esto destapó.** `recortarTema` leía sólo el balde `prosa`, y los aciertos de
  `vocabulario/` van al balde `glosario` a propósito: **el glosario no se podía recortar**, devolvía el
  tema entero siempre. Estaba así desde que existen los dos baldes y no se notaba porque el glosario nunca
  era el tema más largo — al sumarle dos entradas pasó a serlo (2.838 palabras contra 2.786 de `kyc`) y
  las pruebas se pusieron rojas. Y **dos pruebas elegían el tema recorriendo el mapa sin ordenar**, que es
  exactamente cómo una ya pasó verde en local y roja en CI; van con `SortedIDs`, y la del recorte con `q`
  ahora exige un tema **con áreas** (con el glosario quedaba en «0 contra 0», que pasa sin probar nada).
- ⚠ **Lo que NO quedó resuelto, y es una decisión, no un bug.** Del lado del modelo (Gemini local,
  `gemini-2.5-flash`) el comportamiento se corre y no del todo para bien: **contesta desde la entrada del
  glosario y la cita a ella**, en vez de seguir el enlace y citar la sección. Corriendo **una** pregunta
  tres veces: **1 de 3** citó lo esperado. La respuesta es correcta y sale del corpus; lo que se pierde es
  el camino al detalle, que para soporte es el valor. El comportamiento ya existía (el glosario viaja en
  todas las búsquedas desde el 09-05), pero entradas que *contestan* lo hacen mucho más probable. Se
  probaron tres formas de entrada —paráfrasis (el modelo se queda), puntero pelado (cita bien y relaya el
  título sin contenido), y una línea de verdad más el enlace (la que quedó)— y ninguna lo resuelve del
  todo.
- **Y una regla de método que se confirmó sola:** la nota del glosario se cambió («es una PUERTA, no el
  destino») pero **no está medida** — con tres corridas no se distingue del ruido. Se cambió porque la
  frase anterior, «se cita como cualquier sección», contradice el diseño. El esfuerzo que sí movió la
  aguja fue el de la herramienta, no el del guion, otra vez.
- Modelo local: ⚠ **`gemini-3.8-flash` devolvió 503 tres veces** («high demand»). No era canon:
  `gemini-2.5-flash` contestó de una. Si el camino del modelo parece caído, probá el otro modelo antes de
  buscar el bug.

### 2026-09-07

- **Cuatro PRs mergeados y desplegados**: #120 (gate de preaprobado por configuración), #121 (tema
  `nequi`: 1.952 palabras, 6 secciones, 4 áreas, 59 fuentes, entrada en el glosario), #122 (diccionario
  de tablas regenerado contra prod: cinco columnas de Nequi, el rango de monto del comercio y el tope
  del punto de venta) y #123 (la ronda en cero: 78 cambios, 6 frentes, 15 temas).
- Validado en prod, cuatro preguntas en total y ninguna de más. «¿Qué es Nequi y por qué el cobro
  puede dar 409?» → **2 pasos, 15 s, respaldada**. Control de glosario → 5 pasos, respaldada, y dijo
  bien que el caso de UNA solicitud puntual no lo contesta el corpus. Tras el barrido: «¿un comercio
  puede poner su propio monto mínimo y máximo, y cuántos lo usan?» → **2 pasos, 8,7 s**, con la cifra
  de prod y distinguiendo sola el mecanismo cableado del configurable; «¿todos los comercios usan el
  pipeline nuevo de KYC?» → **3 pasos, 12,9 s**, con los dos flujos, el ajuste que decide y el «un
  solo comercio» de prod. El despliegue se detectó gratis, sin gastar preguntas contra la versión vieja.
- Tres lecciones medidas, todas del ranking: la densidad de palabras genéricas de un tema nuevo bajó el
  banco a 112/115; la entrada del glosario le robó una pregunta a `CATEGORY_RULE_REJECTED` y rompió su
  prueba; y **una sola palabra** («dice») agregada a una sección vieja sacó del top-3 una pregunta del
  banco (114/115). Los tres se detectan sin gastar un token; guardado en la memoria de la sesión.
- Encontrado y arreglado de paso (#124): la ronda mandaba a `canon -expediente`, retirado hace cuatro
  días con el bucle de agentes. Ahora manda al diff, e imprime los hashes que hacen falta para pedirlo.
- **Validado en prod tras el despliegue de #125**, con las cinco secciones nuevas servidas y dos
  preguntas: «un cliente pide constancia y su documento empieza con TEMP, ¿qué hago?» → **2 pasos,
  10,7 s, respaldada**, y contestó que no se emite, con el motivo legal completo; «el envío masivo dio
  timeout, ¿puedo reintentarlo?» → **2 pasos, 9,6 s**, y contestó que no, con la comprobación previa y
  la lectura de los resultados por destinatario. Seis ramas de la tarea, las seis en `main`.
- **#125, el documento de candidatos.** Cinco bloques validados uno por uno antes de escribir: el del
  límite por documento ya estaba en el corpus, tres entraron con correcciones y el del servicio de
  formularios llegó truncado. Cuatro imprecisiones del documento corregidas antes de entrar, entre
  ellas que el límite no es por sucursal ni por IP y que los módulos nuevos no están «sin
  autenticación» sino sin Cognito. Y la lección de la mañana se repitió, medida: la prosa nueva bajó
  el banco a 113/115 desplazando dos preguntas de Bancolombia por competir con «cuesta», «error»,
  «dice» y «nada»; con sinónimos volvió a 115 sin tocar el banco ni los hechos.
- **#134, el primer dictado por API de verdad** — con la llave de escritura puesta por Miguel, y con
  cinco documentos de CrossCore y Evidente que llegó Fercho. Validado documento por documento contra
  `main` antes de escribir: entraron **dos secciones** en `kyc` (NODECISION es la biometría sin
  terminar, no un error, con el criterio real de validada y la columna de estado que da un falso sí; y
  la otra puerta de identidad, que tras un rechazo se bloquea y el reintento **se factura** cortando
  con un 409 antes de dejar la fila que lo explique). Las dos áreas nacieron vigiladas: cuatro archivos
  al hash de `main` y dos tablas.
- **Lo que NO entró, a propósito:** la credencial, el identificador de inquilino y los endpoints que
  traía esa documentación —⚠ están en claro en `~/Downloads/fer/`, diez veces, y hay que rotarlos o al
  menos sacar el archivo de ahí—, y las fases que el equipo todavía no mergeó (dos columnas que
  **no están en `main`**, comprobado).
- **Y usar el camino de escritura destapó su propio hueco.** El guion del dictado nombraba los archivos
  que respaldan una pieza pero **no el `objetivo` del área** que esos archivos forman, ni las tablas;
  así que yo mismo, siguiendo el contrato, escribí dos áreas con el eco del título — el mismo eco que
  el 2026-09-03 se midió en 27 de 139 áreas y que una vez le robó el camino a «donde está el modelo de
  la solicitud». El campo existía; faltaba pedirlo. Ahora el guion lo pide, la respuesta avisa **en el
  momento** en que se omite en vez de dejarlo para un lint posterior, y el ensayo del dictado comprueba
  las dos mitades (probado quitando la guarda: falla). El lint pasó de 2 áreas de plantilla a 0.
- **La flota validó el corpus ENTERO, y el resultado cambió el plan de la tarea.** Un orquestador de 36
  lectores contrastó las 280 secciones y su grafo contra `main`; quedó pausado por costo con 34
  terminados y **178 hallazgos brutos**. Reanudar la refutación como estaba costaba ~40 M de tokens de
  entrada (medido sobre los 17 refutadores que sí corrieron), así que se cambió de camino: **leerlos yo**,
  que tengo el corpus entero en contexto — justo lo que un refutador no tiene.
- ⚠ **Y me equivoqué al llamarlos inflados.** Cada hallazgo trae cita textual del código con archivo y
  línea, y la mayoría no son matices: **invierten consejos de diagnóstico**. Verificados a mano contra
  `main`: **31 de 31 ciertos**, incluido uno donde mi propio chequeo había leído un comentario de ejemplo.
- **Dos correcciones fueron al propio `CLAUDE.md` de este repo.** La del test que recrea la BD compartida
  ya la había arreglado otra sesión en paralelo, y la coincidencia vale como aval. La otra la apliqué yo:
  el `APP_ENV` de staging **no es `development` y nunca lo fue** en la historia de los cuatro workflows,
  así que la instrucción quedó al revés — no dar por apagado nada ahí hasta medirlo en el servicio.
- **SEIS PRs MERGEADOS (#134 a #139) y 47 correcciones aplicadas.** El corpus pasó de 28 a **32 nodos**:
  nacieron `credenciales`, `fronteras`, `formularios` y `documentos`, los cuatro por partir un nodo que
  tenía dos asuntos adentro. `main` validado: 115/115, lint ✓, y CI verde.
- ⚠ **Y lo que más importa de todo el tramo: el banco NO es una métrica, es una COMPUERTA DE BUILD.**
  `-bench` sale con código 1 fuera de 115/115 y el Dockerfile lo encadena con `&&`, así que una caída
  **no es un costo, es un build rojo**. Estuve reportando 113, 114 y 112 como «costo medido» cuando eran
  tres PRs que no podían mergear. Se descubrió al ir a mergear, mirando por qué tres estaban «unstable».
- **Y los tres se arreglaron sin tocar el banco de preguntas, con la propia regla del corpus:** las
  secciones que perdían su pregunta no tenían las palabras con que llega, y la competidora sí. «El error
  del banco no dice nada útil» perdía contra una sección hermana cuyo título tiene «banco» y «dice»;
  «cuando se crea la solicitud» perdía contra una que dice «se crea» mientras la correcta decía sólo
  «nace»; «subir el ingreso hace que salgan más entidades» y «por qué todos aparecen como empleados»,
  igual. Escribirlas con la queja tal como llega devolvió las cuatro. **Recortar la prosa no movía
  ninguna** — se intentó primero, en dos de los tres.
- **Un defecto de prueba propio, que enseñaba solo:** la prueba del recorte del mapa elegía el tema
  recorriendo el mapa de nodos, que Go recorre en orden ALEATORIO, y sin exigir que hubiera un área que
  no respaldara la sección. Verde en local y rojo en CI **con el mismo corpus**. Con los nodos nuevos
  —que tienen dos áreas— la probabilidad de caer en el caso degenerado subió y salió a la luz.
- **La regla que salió medida, y es la que ordena lo que falta:** partir un nodo cuesta **cero** y
  recupera lo que el crecimiento costó; agregar prosa cuesta banco **en proporción al volumen** y no se
  arregla con sinónimos. El umbral está cerca de **500 palabras por nodo por tanda** — `arquitectura`
  (+367) y `cartera` (+490) costaron cero, `fronteras` (+509) costó una, `altas` (+1.314) costó dos y
  hubo que partirlo.
- **La pregunta de Miguel sobre nodos hijos y nietos destapó el trabajo más valioso del día.** No hace
  falta jerarquía: el corpus ya tiene DOS grafos y el que resuelve su caso **se deriva solo**, de los
  archivos que dos áreas comparten — y ése sí se usa al buscar, con el archivo compartido como prueba.
  Su ejemplo (algo hijo de dos padres) es un grafo, no un árbol. Pero al comprobarlo apareció que **la
  navegación no era pagable**: rutas por área sin tope (48 en una respuesta), vecinas sin tope (un área
  traía 18) y **el presupuesto no se aplicaba en el código, sólo se afirmaba y para una consulta** — de
  siete, cinco se pasaban. Arreglado en #136, con dos hallazgos de yapa: la respuesta va **indentada** y
  eso es el 18% de sus bytes, y el aviso del recorte se sumaba **después** de medir.
- Incongruencias entre la doc de Santi y `main`/prod anotadas en Riesgos.

## Tarea (publicable)

## En una línea
El asistente de contexto técnico del equipo (canon) responde sobre Nequi y sobre el gate de preaprobado por configuración, y su diccionario de tablas refleja la base de producción de hoy.

## Por qué
Había funcionalidades ya en producción —la integración de Nequi, el gate configurable del preaprobado— que el asistente no conocía: quien preguntaba recibía «no está en el corpus» o una respuesta armada de memoria. Y el diccionario de tablas negaba columnas que sí existen.

## Qué cambia
Un tema nuevo de Nequi (qué es, cómo cobra, qué escribe en la solicitud, qué pasa al reversar, qué falta para encenderlo), el gate de preaprobado documentado, y el diccionario de tablas regenerado. Todo verificado contra el código en main y contra producción.

## Alcance
No configura Nequi ni corrige la documentación interna del equipo de backend: sólo pone al día lo que el asistente sabe.

## Dónde probar
Canon, la herramienta interna de contexto del equipo, en su pestaña de preguntas. Necesita VPN; el
enlace está en el canal del squad.

## Cómo validar
1. Preguntar «¿qué es Nequi y por qué da 409?» → la respuesta debe decir que es un medio de pago, que exige la solicitud en «Seleccionó entidad» y que en producción no tiene credenciales.
2. Preguntar «¿qué columnas tiene lender_transactions?» → catorce, incluidas las cinco de Nequi.
3. Preguntar «¿qué entidades tienen el gate de preaprobado por configuración?» → hoy sólo una (Prami).

## Criterios de aceptación
- Las tres preguntas responden con citas y sin «no está en el corpus».
- Las puertas automáticas del despliegue (lint, banco 115/115, pruebas) siguen en verde.

## Dependencias
Ninguna.
