---
id: 67
title: "Canon compartido: el conocimiento de negocio, publicado para el equipo y consultable por API"
stage: work
created: "2026-08-25T12:00:00-05:00"
context_nodes: [creditop, negocio, findings, architecture]
jira: []
jira_title: "Documentación de negocio compartida para el equipo"
---

**ESTADO 2026-08-25.** La herramienta existe y pasa el CI del repo compartido: `Creditop-SAS/playground`
→ `tools/canon` (Go, cero dependencias, corpus embebido en el binario, lint que bloquea el deploy).
**Sin commitear** — el PR lo abre Miguel. **F1–F4 COMPLETAS + molde de F5: 26 nodos.** canon (7): money · invariants · entity-families · lifecycle ·
actors · risk-assessment · glossary. flows (8): origination · entity-listing · formalization · cosigner ·
payments · post-disbursement · channels · external-lenders. map (3): repos · services · database.
pitfalls (7): identity · reports · quota · data-reading · observability · environments · callbacks.
field (1): entity-credifamilia — **el molde, escrito SIN números comerciales**, para que la capa exista
mientras se decide qué se publica. Este archivo lleva EL MAPEO: qué nodo del `context/`
local alimenta qué nodo del corpus compartido.

## Las reglas de la migración

1. **Se REESCRIBE, no se copia.** Los docs locales tienen 1.024 citas `archivo:línea` y 781 `F-xx`;
   el lint del canon los rechaza tal cual. Migrar = destilar lo que sobrevive a la regla
   **nombre-vs-dirección** (tablas/settings/estados sí; archivos/clases/funciones/endpoints no).
2. **Sin F-xx en el compartido.** La trampa se cuenta completa (síntoma → causa → cómo se verificó);
   el registro F-xx sigue siendo LA FUENTE, acá en el playground personal. La procedencia va en la
   sección obligatoria «Cómo lo sabemos».
3. **`verified:` hereda la fecha del sello local.** 30 de 39 sellos son ≤2026-07-31: si el sello está
   viejo, re-verificar ANTES de migrar (`make context-diff NODE=x`), no después.
4. **Techos del lint:** 1500 palabras/nodo · 350/sección (400 en field/pitfalls) · summary ≤350
   caracteres. Los nodos locales de 3-5k palabras se parten o se destilan.
5. **Idioma:** ids/rutas/campos en inglés; prosa en español. La capa es un campo, no una carpeta:
   `content/<id>.md` plano.

## El mapeo — 39 nodos locales → ~20 compartidos

| local | destino compartido | nota |
|---|---|---|
| negocio | **canon.money** ✅ | hecho; el detalle de vistas con línea queda |
| creditop (raíz) | **canon.invariants** ✅ + canon.lifecycle + canon.glossary | 7 de 8 invariantes migraron; el fail-open de filtros por rol → pitfalls.access (es temporal, no invariante); la arista con archivo:línea queda |
| entities | **canon.entity-families** ✅ | el rt 0-4 como modelo de negocio; censo técnico queda |
| creditopx | **canon.entity-families** ✅ + **flows.entity-listing** ✅ | |
| kyc | **canon.risk-assessment** ✅ + **flows.origination** ✅ | fixtures/mocks quedan (laboratorio) |
| actors | **canon.actors** ✅ | Cognito detalle queda |
| profiling | flows.entity-listing + canon.risk-assessment | features del ML quedan |
| amount-tiers | flows.entity-listing | se funde |
| rotativo | flows.post-disbursement + canon.entity-families | rt=3 no comparte motor: eso es canon |
| onboarding | **flows.origination** ✅ | |
| formalization | **flows.formalization** ✅ | |
| deceval | **flows.formalization** ✅ (el pagaré como camino propio; el detalle del proveedor queda) | el detalle SOAP/WS-Security queda |
| codeudor | **flows.cosigner** ✅ (nodo propio: cambia la forma del cierre) | |
| payments | **flows.payments** ✅ | el bug vivo del gateway → pitfalls.payments |
| servicing | **flows.post-disbursement** ✅ | |
| ecommerce | **flows.channels** ✅ | |
| redirect | **flows.channels** ✅ | |
| aggregator | **flows.external-lenders** ✅ | webhook de ida y vuelta, pre-aprobación |
| ms-preapprovals | map.services + flows.external-lenders | |
| bancolombia | field.entity-bancolombia | específico y cambiante → field con fecha |
| credifamilia | field.entity-credifamilia | |
| corbeta | **flows.channels** ✅ (venta en caja) + field.merchant-corbeta | venta en caja es flujo; el grupo es field |
| smartpay | field.merchant-smartpay | |
| motai | field.merchant-motai | |
| pullman | field.merchant-pullman | chico |
| merchants | field.merchants | par/copia ya graduó a canon.invariants |
| architecture | **map.repos** ✅ | las costuras: lo conceptual migra |
| application | **map.repos** ✅ | casi todo queda (denso en direcciones) |
| legacy-backend | **map.repos** ✅ | ídem |
| frontend-monorepo | **map.repos** ✅ | ídem |
| microservicios | **map.services** ✅ | service_name es vocabulario, migró |
| form-service | **map.services** ✅ (nombrado, sin nodo propio) | |
| backoffice | map.services + canon.actors | |
| dynamic-forms | map.services (+ flows.forms candidato) | |
| db-routines | **map.database** ✅ (parcial: falta la lógica en rutinas) | el HECHO de la lógica en BD; 4 rutinas sin fuente |
| hardcodes-entidades | queda personal | censo con archivo:línea; el agregado medido → field candidato |
| findings (174) | pitfalls.\* temáticos | ~139 candidatas; ~35 de laboratorio quedan; ver regla 2 |
| harness | NO migra | herramienta personal |
| trazador | NO migra | herramienta personal |

## Fases

- **F1 · canon: COMPLETA** ✅ (7 nodos).
  Es el vocabulario: sin esto, el resto se lee mal.
- **F2 · flows: COMPLETA** ✅ (7 nodos).
- **F3 · map: COMPLETA** ✅ (3 nodos).
- **F4 · pitfalls: COMPLETA** ✅ (7 nodos).
- **F5 · field: molde puesto** (`field.entity-credifamilia`, sin cifras comerciales). El resto sigue
  esperando la decisión de qué se publica.
- **F5 · field** — DESPUÉS de decidir la sensibilidad (abajo).

## Regla editorial que salió de escribir los primeros nodos

**Cada sección aporta un hecho que no está en otra sección.** Se sacó de `flows.entity-listing` la
sección «Qué preguntar cuando el listado sale mal»: era una checklist que restataba reglas ya escritas
en el mismo nodo. Una copia dentro del corpus es peor que una ausencia — las dos derivan y la búsqueda
devuelve la más débil. Corolario implementado: **«Cómo lo sabemos» no entra al índice de búsqueda**
(es procedencia, no respuesta); medido, salía SEGUNDA en una consulta de contenido.

## Lo que se aprendió calibrando la búsqueda (2026-08-25)

Se probaron dos arreglos sobre una consulta que fallaba y **los dos se revirtieron**, cada uno por su
motivo. Vale dejarlo escrito para no repetirlo:

- **Rellenar títulos de sección con las palabras de la consulta: NO.** Hundió otra búsqueda que sí
  andaba (el alcance del asesor pasó a devolver el glosario). El glosario nombra TODOS los conceptos,
  así que con peso alto en el título gana cualquier consulta. Es sobreajustar el contenido al ranker.
- **Bajar el peso de los títulos: no cambia nada.** Medido con 4:6, 2:3 y 1:2 sobre el mismo barrido de
  6 consultas — resultado idéntico en las tres. Se restauró 4:6.
- **Lo que SÍ funcionó:** plegar plurales (`solicitudes`→`solicitud`), simétrico al indexar y consultar;
  y sacar «Cómo lo sabemos» del índice de búsqueda (es procedencia, no respuesta).
- **Queda un fallo conocido y documentado**: «cómo se llama la tabla de solicitudes» no llega al
  glosario porque esa sección no usa la palabra «tabla». Es el límite de la búsqueda léxica, está en
  `/api/tools` y en el README, y la salida es el índice.

## El banco de preguntas, y lo que NO hay que volver a probar

`tools/canon/preguntas.txt` congela 21 consultas de soporte con el nodo que debería contestarlas.
**20/21 con 18 nodos.** Corrélo después de cada tanda: un nodo nuevo puede robarle una consulta a otro —
pasó dos veces (`flows.channels` le robó la del asesor a `canon.actors`; `flows.payments` le robó
«no le sale esta entidad» a `flows.entity-listing`).

**Los pesos de campo NO son el problema — medido dos veces.** Cinco calibraciones (4:6, 3:4, 2:3, 2:2,
1:2), primero con 10 nodos/6 consultas y después con 18/21: resultado **idéntico** en todas. Está
anotado en el código para que nadie lo re-litigue. Cuando una búsqueda falla, el arreglo es de PROSA: la
sección no usaba la palabra con la que llega la pregunta («no le SALE la entidad», «el LINK del
codeudor», «en qué REPO vive», «qué comercios están MIGRADOS»).

**Y no se arregla metiendo la consulta en un título de sección** — se probó y hundió otra búsqueda: los
títulos pesan, y un nodo que nombra muchos conceptos (el glosario) empieza a ganar cualquier cosa.

## La medición cambió, y es lo más importante del tramo

Miguel señaló que un LLM **no acierta a la primera**: busca, lee, reformula, sigue enlaces. Mi banco
medía precisión en el primer resultado — la métrica equivocada.

**Ahora mide alcanzabilidad:** ¿se llega al nodo correcto en ≤2 pasos? Y lo único que rompe la corrida
es **sin camino** (ni los 3 primeros resultados ni sus `nodes_hit` llevan al nodo esperado). Eso sí es
un defecto del corpus, y frena el despliegue — comprobado metiendo una pregunta imposible: exit 1.

Dos cambios que salieron de ahí:

1. **`/api/search` devuelve `nodes_hit`**: por cada nodo que apareció, sus OTRAS secciones y con qué se
   conecta. Antes, un acierto parcial costaba dos llamadas más para saber a dónde ir; ahora una sola
   búsqueda deja al agente listo para el paso siguiente.
2. **El banco es una modalidad del binario** (`-bench`), corre en proceso sin servidor, y el Dockerfile
   lo ejecuta junto al lint antes de armar la imagen.

Estado con 26 nodos: **1er resultado 36/39 · en los 3 primeros 38/39 · alcanzable ≤2 pasos 39/39**.

**Y la métrica se ganó el sueldo en la última tanda.** Al sumar 4 nodos el primer acierto se desplomó a
30/39 — pero alcanzable siguió en 39/39, así que no había nada roto. Al diagnosticar, los 9 fallos
salieron de TRES causas distintas: 2 eran expectativas MÍAS mal puestas (el resultado era mejor que lo
que yo esperaba), 4 eran huecos de vocabulario en mi prosa (escribí «registros de ejecución» donde
soporte dice **logs**, «documento» donde dice **cédula**, «ambientes de prueba» donde dice **local**) y
2 eran títulos con sustantivos comunes. Cerrar los 4 de vocabulario movió el número de 30 a 36.

**Tercera medición de los pesos, ahora con 26 nodos y 39 preguntas:** una sola pregunta de diferencia
entre la calibración máxima y la mínima. En la misma corrida, la prosa movió seis. **Proporción 6 a 1 —
escribí mejor, no calibres.** Anotado en el código y en `preguntas.txt` para no repetirlo una cuarta vez.

## Sobre meter «preguntas» en el índice: no, pero por otro motivo

Llegó la sugerencia de que el índice describa conocimiento y NO anticipe preguntas, y que un summary
escrito en vocabulario de pregunta «sesga la navegación». **La conclusión es correcta (nada de un campo
`questions:`) y el motivo no.**

- **El summary NO se indexa** — verificado: la búsqueda solo mira título de nodo, título de sección y
  cuerpo. Un resumen en vocabulario del lector no puede sesgar el ranking; solo ayuda a ELEGIR.
- **Usar las palabras del negocio no es anticipar preguntas.** Medido en esta misma sesión: escribir
  «logs» en vez de «registros de ejecución», «cédula» en vez de «documento» y «local» en vez de
  «ambientes de prueba» movió el banco de 30/39 a 36/39. Ninguna de esas es una pregunta.
- **`topics` se descarta**: sería una tercera copia, escrita a mano y sin validación, de lo que ya dan
  el índice invertido (validado por el banco) y `connects_to` (validado por el lint).
- **Lo que sí señalaba un hueco real**: títulos que cuentan cosas en vez de decir qué hay. Se
  reescribieron 5 — mejor prosa, **cero cambio en el banco**. Es legibilidad, no recuperación.
- **Y salió una regla nueva**: el título de sección ES el identificador, así que renombrarlo rompe los
  enlaces (el lint cazó 3 al hacerlo). Se escribe bien la primera vez y NO se toca para afinar búsqueda.

## Defecto encontrado por una pregunta de Miguel: el total mentía

`total` reportaba **cuántos resultados devolvía**, no cuántos había encontrado. Con el límite en 10
decía 10; con 50 decía 50. Un agente no podía distinguir «hay tres secciones sobre esto» de «hay 114 y
estás viendo diez» — que es justo la señal para decidir si afinar la pregunta.

Arreglado: ahora devuelve `matches_found` y `returned` por separado, más un aviso cuando hay más.
Medido: la consulta ancha «entidad comercio cliente solicitud» matchea **114 de 177 secciones** (64 % del
corpus) y con límite 50 devuelve 6.701 palabras — casi media biblioteca. El aviso dice explícitamente
que subir el límite no es la respuesta: más resultados de una pregunta vaga son más ruido.

Y quedó documentado qué devuelve por acierto: **el párrafo completo**, no la línea. Unos 600 caracteres
con sus vecinos. Eso solo es viable porque las secciones tienen techo de 350 palabras — segunda razón,
independiente de la primera, por la que ese techo no es estilo.

## Reformular la consulta: sí para tipeos, no para sinónimos

Miguel propuso que el modelo reformule la pregunta —corregir ortografía, agregar sinónimos— antes de
buscar. Medido, la idea se parte en dos mitades con respuestas opuestas.

**Tipeos: era un defecto real y está arreglado.** Las sugerencias salían por prefijo y orden alfabético,
así que «desembolzo» no llegaba a sugerir «desembolso» (seis palabras con `des` antes). Cambiado a
distancia de edición con tolerancia proporcional al largo: **7 de 7 tipeos recuperados, la palabra
correcta siempre primera**.

**Sinónimos: no hace falta tabla.** Medido — «prestamista», «aliado» y «buró» ni siquiera aparecen como
no encontradas: están en el corpus, porque la prosa usa el vocabulario del negocio y **el glosario mapea
concepto ↔ nombre en los datos**. El glosario ES el diccionario de sinónimos, escrito como prosa y
validado por el mismo banco. Una tabla de sinónimos sería otra copia a mano sin validación — el mismo
argumento que descartó `topics`.

**Y la expansión automática se descarta por un motivo más fuerte que el ruido.** Hoy, cuando una palabra
no existe, el sistema lo DICE. Esa señal es la que encontró los cuatro huecos de vocabulario que movieron
el banco de 30 a 36 sobre 39. Un buscador que sustituye en silencio habría contestado algo razonable las
cuatro veces **y nunca habríamos sabido que el corpus estaba escrito con las palabras equivocadas**.
La expansión automática esconde exactamente la señal que hace mejorar el corpus.

Quien reformula es el modelo, con lo que el sistema le informa. El servidor sugiere; no adivina.

## Destilar la pregunta: sí, y está medido

Miguel preguntó si conviene que el modelo lea el índice y reformule antes de buscar, y qué pasa con un
mensaje largo o con una consulta en inglés. Medido con un relato de soporte real de 300 palabras:

| consulta | secciones que matchean | dónde cae |
|---|---:|---|
| el relato entero, tal cual | **150** de 177 | secciones relevantes, pero vecinas |
| destilada a 10 palabras | **17** | la sección con la respuesta exacta |

**El párrafo largo NO colapsa** —esperaba que se fuera al glosario y no pasó: el ranking aguantó y
devolvió secciones pertinentes—. Pero toca el 85 % del corpus, así que la respuesta correcta y la vecina
quedan a un pelo. Destilar da diez veces menos ruido **y la sección exacta**.

**Inglés: no funciona, y está bien así.** `cosigner signature deferred` devuelve cero y lo dice. Los
identificadores de nodo sí son en inglés y el índice se entiende, así que la traducción la hace quien
pregunta. Duplicar el corpus en dos idiomas duplicaría el mantenimiento y garantizaría que una mitad
quede vieja — es el mismo argumento que descarta cualquier segunda copia.

Las dos cosas quedaron escritas en `/api/tools`, que es lo que un modelo lee para saber cómo usar esto.

**Defecto encontrado de paso:** sin resultados devolvía `null` en vez de lista vacía. Un cliente no
debería manejar dos formas del mismo campo según si hubo suerte. Arreglado.

## El índice es también el manual de uso

Miguel señaló que las reglas de uso deberían vivir en el índice, no en una ruta aparte. Tiene razón y
había un problema de descubrimiento que no se había visto: **el índice es la primera llamada natural**,
así que un modelo que arranca por ahí nunca vería el contrato si viviera solo en `/api/tools`.

Ahora el índice abre con el contrato —español, destilar, usar el vocabulario del índice, afinar en vez
de subir el límite, no completar lo que el corpus no dice— y sigue con los nodos. El texto se escribe
**una sola vez en el código** y se sirve en los dos lugares: duplicarlo garantizaría que una copia quede
vieja, que es el error que este proyecto evita en todos lados.

**Distingue protocolo de estrategia a propósito.** El protocolo es fijo (idioma, destilar, no inventar);
la estrategia —cuántos pasos, qué nodo, cuándo parar— es del modelo. Forzar una secuencia rígida
rompería el recorrido iterativo, que es justamente lo que hace que esto funcione sin acertar a la
primera.

Costo del índice: ~2.400 palabras, +90 por nodo nuevo. Reparto medido: 55 % resúmenes (lo que rutea),
20 % anclas (permiten saltar sin buscar), 13 % contrato. **No se agregó un modo reducido**: el reparto es
sano y no hay evidencia de que haga falta — sería un segundo formato que mantener.

## El corpus está flaco, y está medido

Miguel señaló lo correcto: con 16.000 palabras **todo el corpus entra en el contexto de cualquier
modelo**, así que a ese tamaño la búsqueda no se gana el sueldo — se podría pegar entero. Medido:

| | palabras | nodos |
|---|---:|---:|
| árbol local `context/` | **135.703** | 39 |
| canon compartido (antes) | 16.040 | 26 |
| canon compartido (ahora) | **23.275** | **38** |

Y de lo local, `findings` solo son 39.516 palabras con 174 entradas, de las que se destilaron ~30.

**La salida NO es nodos más largos**: los techos (1500 por nodo, 350 por sección) son justo lo que los
vuelve recuperables — una sección que no entra en un resultado obliga a bajarse el nodo entero. La salida
son **más nodos donde llegan las preguntas**.

Primera tanda de profundidad (+4): `flows.profiling` (de dónde salen cupo y enganche — el escalón que
deja pasar no es el que pone el precio), `field.merchant-smartpay` (el celular como garantía, y el canal
partido en dos fuera de producción), `field.merchant-motai` (el ingreso de plataformas ya decide desde
agosto; arrendar y quedárselo solo difieren en los papeles), `field.merchant-corbeta` (crédito y compra
en momentos distintos; «¿es Corbeta?» tiene cuatro respuestas).

Segunda tanda (+2): `flows.forms` (las tres generaciones de formulario configurable, «obligatorio» que
falla abierto, el rango de ingreso que se aplasta a un número) y `field.entity-bancolombia` (la única
entidad externa cuya originación corre acá adentro; sin tiempos límite y dentro de la petición del
cliente, así que un banco lento se ve como una pantalla colgada nuestra).

Tercera tanda (+3), la que faltaba: **cómo navegar cada repositorio por dentro**. `map.repos` contaba la
RELACIÓN entre los dos sistemas, no la forma de cada uno. Ahora hay `map.repo-aliados` (el histórico se
divide por AUDIENCIA —administración, cliente, máquinas— no por tema), `map.repo-refactor` (módulos por
dominio con una cadena uniforme, y cuatro trampas: los modelos y el esquema NO viven en los módulos, en
un módulo los «controladores» son servicios, y hay módulos sin consumidor) y `map.repo-wizard` (un solo
producto real, no toca la base, y los módulos viven en TRES sitios distintos).

**Y el lint ya trazaba la línea correcta sin que nadie lo notara: una CARPETA es un lugar, un ARCHIVO es
una dirección.** `Modules/Onboarding` pasa; `LenderListingService.php` no. Por eso estos tres nodos
explican cómo navegar los repositorios **sin nombrar un solo archivo**.

Cuarta tanda (+3), las trampas: `pitfalls.silent-success` (**el mecanismo que más créditos cancela sin
que nadie se entere**: el backend emite 7 formas de validar identidad, las pantallas contemplan 5, y lo
no contemplado cae en un camino por defecto que CANCELA — así que cada entidad nueva con otra forma de
validar puede empezar a cancelar en silencio), `pitfalls.money-math` (dos convenciones de tasa
conviviendo y ya divergidas en producción; tres diferencias en el costo de la garantía que van **todas
hacia el mismo lado**: el sistema cobra de más) y `pitfalls.missing-config` («no pasa nada» es síntoma de
configuración, no de código — con una tabla para distinguirlo de un error real).

Banco ampliado a 66 preguntas: **1er resultado 55/66 · en los 3 primeros 62/66 · alcanzable 66/66**.

⚠ **Y la guarda se ganó el sueldo otra vez**: «el valor a financiar sale distinto» quedó SIN CAMINO y
frenó el build. El nodo decía «el costo de la garantía» y el negocio dice «el valor a financiar». Mismo
error de siempre, atrapado por la máquina en vez de por un lector meses después.

**Dónde está el resto**, por tamaño del nodo local: kyc (5.655 — ⚠ parcialmente cubierto ya por
`canon.risk-assessment`; lo que falta es la verificación de identidad post-selección y las reglas de
cuándo NO se consulta) · servicing (3.241) · merchants (3.234) · ms-preapprovals (3.120) · entities
(2.553) · db-routines (2.410) · ecommerce (2.287) · redirect · rotativo · amount-tiers · backoffice.
Más las **~110 trampas sin destilar**, que son la veta más grande y la más pedida por soporte.

⚠ **Y no todo debe graduar**: buena parte de esas 135.703 palabras son direcciones de código, hallazgos
de laboratorio y detalle por repositorio, que el lint rechaza por diseño. El objetivo realista es del
orden de 60-80 nodos de conocimiento durable — hoy hay 30.

## Decisiones abiertas

- **La frontera con credibrain** (herramienta de Oscar en el mismo catálogo, «la memoria de la
  compañía»). Mi lectura: canon = fuente curada; credibrain = el que contesta y cita. Hablarlo antes
  del PR.
- **La ficha de entidades** (aprobación, embudo, ticket por entidad — hoy `context/docs/ENTIDADES.md`):
  con `para: compania` la ve toda la empresa. ¿Entra, y con qué recorte?
- **Quién sella en el compartido:** ¿el review del PR equivale al `verified:`? Propuesta: sí — quien
  aprueba el PR pone su nombre en la fecha.

## Bitácora

- 2026-08-25 · F4 completa (+3: observability, environments, callbacks) y molde de F5
  (`field.entity-credifamilia`, sin cifras). Banco a 39 preguntas. Ver la sección de la métrica.
- 2026-08-25 · F4 arrancada: +4 pitfalls temáticos (identity, reports, quota, data-reading), sin F-xx
  —el registro numerado sigue siendo fuente acá—. Banco ampliado a 31 preguntas. Y la métrica cambió de
  precisión@1 a alcanzabilidad, ver sección arriba. CI verde.
- 2026-08-25 · F3 completa: +3 nodos (map.repos, map.services, flows.cosigner — el codeudor merecía
  nodo propio: cambia la FORMA del cierre, no le agrega un párrafo). Banco de preguntas congelado en
  `preguntas.txt`. Corpus: 18 nodos, 123 secciones. CI verde.
- 2026-08-25 · F2 completa: +5 nodos de flujo (formalization, payments, post-disbursement, channels,
  external-lenders). El lint atajó una referencia adelantada (`related` a un nodo aún no escrito), que
  es exactamente para lo que está. Corpus: 15 nodos, 102 secciones, 8.595 palabras; el índice cuesta
  1.203 (14 %). CI verde.
- 2026-08-25 · F1 completa: +3 nodos (actors, risk-assessment, glossary — este último derivado de
  `workers negocio --zoom 3`, que ya trae el par concepto ↔ nombre-en-datos). Calibración de búsqueda:
  ver sección arriba. CI verde.
- 2026-08-25 · +4 nodos (entity-families, lifecycle, origination, database) usando `workers negocio`
  (la espina de 23 conceptos) y `workers relaciones` (13 vecindarios medidos contra prod) como
  esqueleto derivado del código. Stopwords + procedencia fuera del ranking. CI verde.
- 2026-08-25 · armada la herramienta completa (API index/search/read/relations/policy/tools, lint,
  stopwords, índice-como-documento) + 3 nodos + este mapeo. CI del repo compartido verde.

## Tarea (publicable)

**En una línea:** Publicar la documentación de negocio en un repositorio compartido del equipo,
consultable por personas y por modelos vía API.

**Por qué:** El conocimiento del sistema vive hoy en notas personales; soporte, QA y producto lo
necesitan sin depender de una persona.

**Qué cambia:** Aparece una herramienta interna con la documentación por capas —reglas de negocio,
responsabilidades, flujos de punta a punta, observaciones fechadas y trampas conocidas— con búsqueda
y lectura por API.

**Alcance:** Solo lectura; los cambios entran por revisión. No incluye credenciales ni detalles de
implementación.
