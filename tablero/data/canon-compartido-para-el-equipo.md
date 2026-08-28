---
id: 67
title: "Canon compartido: el conocimiento de negocio, publicado para el equipo y consultable por API"
stage: work
created: "2026-08-25T12:00:00-05:00"
context_nodes: [creditop, negocio, findings, architecture]
jira: []
ramas: feat/canon-limpieza-y-contexto-rico
jira_title: "Documentación de negocio compartida para el equipo"
---

**ESTADO 2026-08-27.** El corpus **se reinició por profundidad** y el artefacto principal cambió: ya no
es la prosa, es **`map.json`**. Un tema (`bancolombia`) con **147 archivos de 3 repos en 7 áreas**, cada
uno con su hash de blob de git, contra **un solo `context.md`** de ~1.400 palabras. PR abierto:
`Creditop-SAS/playground#10`, un solo commit, CI verde.

Y ya está el **bucle de recontextualización**: `-expediente` va de «qué cambió» a «qué hay que hacer»
—los PRs que movieron cada archivo, sus descripciones, el diff, candidatos a sumar y a quitar, y la
prosa contra la que contrastar—. **Probado rebobinando el mapa tres meses, encontró un defecto real
en su primera corrida.**

El giro salió de una medición: casi todo lo que había escrito a mano **se podía grepear del código**
(el monto fijo, los pisos de cada producto, hasta el pendiente en un comentario). Escribir eso es
copiar el código a un lugar donde envejece solo. Y al revés, lo que de verdad hace falta —que nadie
revisa el vencimiento del certificado con que se firma cada llamada al banco— **no se puede grepear
porque no está**. De ahí la regla: **el mapa dice dónde está lo que se deduce; la prosa guarda sólo lo
que no.**

**Bloqueado por infra para probarlo publicado:** falta el repo ECR `creditop/canon` y, sobre todo, el
**wildcard DNS `*.playground.creditop.com`** (hoy da NXDOMAIN, así que ninguna de las cuatro
herramientas del repo compartido es alcanzable). El handoff a Dani y Santi está en
`github/playground/PENDIENTE-PUBLICAR.md`.

**Lo de antes (F1–F5, 26 nodos temáticos) queda como historia de esta tarea**, no como corpus: cubría
mucho y poco a la vez. El mapeo de abajo sigue sirviendo de inventario de qué hay que cubrir.

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
| canon compartido (ahora) | **~31.500** | **50** |

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

Quinta tanda (+2): `pitfalls.empty-listing` (**la pregunta de soporte más frecuente** — «a este cliente
no le salió nada» — y su causa menos intuitiva: **una sola entidad rota tumba el listado ENTERO**, medido
en 17 comercios a la vez; más la pregunta que parte el diagnóstico en dos: ¿le pasa a un cliente o a
todos los de ese comercio?) y `pitfalls.terms-and-dates` (**al mejor cliente es al que no se le puede
cambiar el plazo**, porque la ausencia de tope se trata como tope cero; y a un crédito atrasado se le
ofrecen sólo fechas que el guardado rechaza).

Las dos comparten un patrón que conviene tener presente: **una lista se calcula con una regla y la
validación al guardar usa otra, y nadie comprueba que coincidan.** Cuando un cliente dice «elijo lo que
me ofrece y me lo rechaza», es eso.

Sexta tanda: **una ampliación y un nodo nuevo.** En vez de crear un nodo casi igual, se ampliaron dos
secciones a `pitfalls.identity` (con cédula colombiana **el nombre no se compara como texto** —el
veredicto sale de códigos de coincidencia, así que pasar con el nombre de otra persona NO es un error
sino cómo funciona para ese documento—; y **el mismo cliente se comporta al revés según por qué sistema
entre**, porque la misma función devuelve valores opuestos en los dos). Es la regla de «cada sección
aporta un hecho que no está en otra» aplicada al revés: si el nodo ya existe y tiene lugar, se amplía.

Nodo nuevo: `field.what-is-off` — **lo que existe en el código y hoy no corre**. El canal del código de
compra dejó de emitir (de miles mensuales a fines de 2025 a **cero desde abril de 2026**), el modelo que
ordena el listado nunca corre en producción, hay módulos sin consumidor y avisos desactivados por
defecto. La regla que resume: **cuando algo no aparece, la primera pregunta no es «¿por qué falla?» sino
«¿está corriendo?»** — se ven igual desde afuera y la segunda se contesta mucho más rápido.

Séptima tanda: `pitfalls.admin-config` — **la causa real de «se le cambió sola la configuración de una
entidad»**, que es un reporte recurrente y suena imposible. No se cambió sola: **la cambió otro
comercio**. La pantalla se abre por comercio y en el título dice «este comercio, esta entidad», pero
parte de lo que guarda se almacena **por entidad y punto**, o sea compartido por todos los comercios que
la usan. Y guardarla en el tipo de entidad equivocado **borra** la configuración de todos.

El nodo incluye la pregunta que separa este síntoma del de la copia por sucursal, que se parece mucho:
**¿la configuración quedó VIEJA o quedó DISTINTA de lo que puse?** Vieja es copia; distinta es pisada.

Y se amplió `pitfalls.silent-success` con un caso del mismo mecanismo: **se puede elegir una entidad que
nunca se le ofreció al cliente** — el sistema no distingue «no es de este comercio», «no existe» y «no se
la ofrecí»: las dos primeras fallan con el mismo error genérico y la tercera **se acepta sin chistar**.

Octava tanda — **y acá el pozo de las trampas se secó**: las que quedaban ya estaban cubiertas o
graduaron a nodos locales, y las sueltas apuntaban todas al mismo hueco. Así que en vez de forzar más
trampas se escribió el nodo al que apuntaban: `flows.revolving`, el cupo rotativo, que no tenía nodo
propio pese a ser una de las dos familias in-platform.

Lo que trae: el cupo sale de **un multiplicador de seis variables**, no de escalones · **dos de los cinco
niveles no se pueden alcanzar nunca** (el corte rechaza antes de leer la tabla, así que cerca de la mitad
de la configuración está muerta y desde el panel se ve activa) · **no tener dato es peor que tener mal
dato** (sin fuente de continuidad laboral se puntúa cero, peor que el peor cliente) · y **dos motores dan
resultados distintos para el mismo cliente**, tratando su deuda previa al revés uno del otro.

Novena tanda: `map.migration` — **por qué hay dos sistemas y qué falta para apagar uno**. Es el nodo que
más explica del corpus: casi todas las rarezas (esquemas duplicados, piezas gemelas divergidas, código
que nadie llama) **se leen como descuido si no se sabe esto**, y dejan de parecerlo cuando se sabe.

La tesis que lo ordena: **no se le quitó el renderizado al sistema viejo para ponerle una interfaz
encima — se construyó casi una copia en otro repositorio**, y desde entonces hay que mantener los dos. De
ahí salen, de una sola vez, las definiciones de esquema copiadas a mano, los gemelos que divergieron y el
código construido antes de conectarse.

Y la frase que cambia cómo se estima cualquier tarea de migración: **el objetivo no es terminar una
reescritura, es apagar un sistema que nunca dejó de recibir cambios**. No hay línea de llegada estática:
hay un blanco que se mueve.

Incluye la compuerta real (dos parámetros de operación, por sucursal y por comercio, evaluados con O),
que **vive por completo en el sistema viejo** —el nuevo no puede decirte si un comercio está migrado— y
que **no la crea ninguna semilla**, así que un ambiente recién levantado nace con todo apagado y eso no
es una falla.

Décima tanda (+2): **cómo LEER cada repo**, que es distinto de dónde están las cosas.
`map.reading-backend` y `map.reading-wizard` recogen las convenciones que, si no se reconocen, hacen
sacar conclusiones equivocadas del mismo código.

Lo más valioso de cada uno:

- **El sufijo V1/V2 no significa versión: significa GENERACIÓN de arquitectura.** Un módulo con sufijo y
  otro sin él no son dos versiones compitiendo — pueden resolver cosas distintas y los dos están vivos.
  Y ⚠ **la guía que trae el propio repositorio aplica sólo a una de las dos generaciones**, lo dice en su
  primera página: leerla y aplicarla a un módulo portado es un error fácil.
- **En el wizard hay DOS organizaciones internas de módulo conviviendo**, y el propio repositorio
  advierte: «no asumas la forma, leela del módulo». Abrir uno esperando la estructura del anterior y no
  encontrarla no es un error del módulo.
- Más el índice de los once módulos con qué resuelve cada uno, y la librería marcada como «no leer».

**Control de cobertura, y encontró tres huecos.** Se probó si el corpus contesta «¿qué es CreditopX?» y
«¿qué es rt2?»: el segundo daba **CERO RESULTADOS**. La abreviatura que usa toda la empresa —rt, rt=2,
rt1— **no estaba escrita en ningún lado**, y «response type» con espacio tampoco matcheaba porque el
corpus sólo tenía el nombre del campo con guion bajo, que tokeniza como un término solo.

Y faltaba la definición explícita de CreditopX: se usaba el término dando por sentado que se conoce.
Ahora tiene sección propia, con la colisión que importa: **CreditopX puede ser la familia in-platform, el
modelo de negocio, o una entidad concreta que se llama así** — cuando alguien lo diga, hay que preguntar
cuál de las tres.

Y un cuarto hueco del mismo tipo: **«response type» escrito con espacio no matcheaba**, porque el corpus
sólo tenía el nombre del campo con guion bajo — y el guion bajo cuenta como letra, así que tokeniza como
UN término. Escribirlo también separado en la prosa subió el banco dos puntos.

Banco ampliado a 91 preguntas: **1er resultado 73/91 · en los 3 primeros 83/91 · alcanzable 91/91**.

**El ritmo cambió y conviene registrarlo:** de acá en adelante el rendimiento por tanda de trampas baja —
las ~85 que quedan son mayormente de laboratorio o muy específicas de un caso. El esfuerzo rinde más en
los nodos de `flows` y `field` que faltan: servicing, ecommerce, los comercios restantes, y las
entidades agregadoras.

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

## Auditoría del corpus: una debilidad estructural, ya cerrada

Con 46 nodos se auditó el corpus en vez de seguir agregando. Dos cosas salieron limpias —**ninguna
sección al límite** de palabras, y los nodos más flacos (383-441p) están enfocados, no sobra ninguno— y
una salió mal:

**15 de 46 nodos eran huérfanos del grafo: nadie los enlazaba.** A un tercio del corpus sólo se llegaba
buscando, nunca siguiendo un enlace — y el segundo paso del recorrido (`nodes_hit`) se apoya en el grafo.

La causa es estructural y vale registrarla porque se va a repetir: **la tendencia natural es escribir
enlaces de lo específico hacia lo general** (el nodo de una entidad apunta al canon) **y olvidar la
bajada**. Todos los enlaces subían; ninguno bajaba.

Arreglado agregando bajadas en 12 nodos generales → **0 huérfanos**. Y convertido en regla del lint, para
que no se degrade otra vez: un nodo que nadie enlaza ahora **bloquea el despliegue**, igual que un enlace
muerto. Comprobado con un nodo de prueba: exit 1.

⚠ **Y un error propio que vale anotar:** el primer intento de agregar esa regla **no se aplicó y no
avisó** —el parche buscaba un nombre de variable que no era y `replace` devolvió el texto intacto—, así
que el lint dijo «todo en orden» sobre código que no existía. Es exactamente el patrón de
`pitfalls.silent-success` cometido en el andamiaje. Se rehízo con una aserción que aborta si el ancla no
matchea.

## El vocabulario financiero y los proveedores: el hueco más grande que quedaba

Miguel propuso enriquecer el corpus con lenguaje financiero y con quién es cada proveedor. Al medirlo,
el hueco era mayor de lo esperado: **el corpus no nombraba a UN SOLO proveedor**. Ni Experian, ni
Mareigua, ni TusDatos, ni Deceval. Todo estaba escrito en genérico —«el proveedor de identidad», «el
depositario»—, que fue **sobreaplicar la regla de nombre-vs-dirección**: el nombre de un proveedor es
vocabulario del negocio igual que el de una tabla. Soporte dice «falló Experian».

Dos nodos nuevos:

- **`canon.providers`** — quién aporta qué, con nombre propio. Y el falso negativo caro: **Experian
  aparece en VARIAS entradas porque son productos distintos**, y consultar uno no es consultar otro, así
  que mirar una sola para decidir «¿se consultó el buró?» puede dar que no cuando sí. Más: contar filas
  vivas subestima los intentos, porque cada reintento borra lógicamente el anterior.
- **`canon.loan-mechanics`** — cuota fija con amortización francesa, los CUATRO componentes de la cuota
  (capital, interés, seguro de vida y fondo de garantía — los dos últimos no son intereses), los tres
  montos que se confunden, y el resultado más contraintuitivo del motor: **poner más cuota inicial SUBE
  el cupo, no lo baja** — subir el mínimo de una categoría no la vuelve más restrictiva.

⚠ **Y la guarda volvió a ganarse el sueldo**: al agregar los dos nodos, «cómo se cobra si el cliente no
paga el celular» quedó SIN CAMINO. Causa fina: el nodo decía «al pagar» y la pregunta dice «no paga» —
**el plegado maneja plurales, no conjugaciones**. Es la tercera vez que un hueco de vocabulario lo
atrapa la máquina en vez de un lector.

## Un error de exactitud que encontró Miguel, y la forma nueva de las fichas

**El problema.** `field.entity-credifamilia` decía «necesita seis servicios externos, y todos fallan
igual». Eso salió de **reproducirlo en LOCAL**, donde hay que tener los seis simulados y la ausencia de
cualquiera produce el mismo síntoma. Escrito así se lee como si describiera producción — donde los seis
están y responden. La frase correcta es otra: **cuando uno falla, el síntoma no señala cuál.**

Es un error de framing, no de dato, y es el que más fácil se comete en la capa `field`. Quedó como regla
en el README: **en `field`, cada afirmación dice DÓNDE se observó**; producción y local no son lo mismo.

**La forma nueva de las fichas de entidad y comercio**, que pidió Miguel:

1. **`## En qué se diferencia de las demás`** — una tabla comparativa contra el resto. Es lo que aterriza
   una pregunta rápido: Credifamilia radica y usa formulario dinámico; Motai arrienda, exige codeudor y
   ofrece **tres productos**; SmartPay garantiza con el equipo y opera en otro país; Corbeta cierra en
   caja con **una sola entidad**; Bancolombia corre su originación **entera acá adentro**.
2. **`## Tech`, opcional y salteable** — carpetas y módulos clave, **nunca archivos**, marcada
   explícitamente para que una consulta de negocio la ignore. Incluye qué suite del harness la ejercita.

Las diferencias salieron del harness, que es donde están simuladas: sus suites declaran los tres
productos de Motai, el codeudor cerrando con dos firmas, y Credifamilia cerrando **en serie** porque falla
si alguno de sus externos no contesta.

⚠ **Y una cosa NO se dio por buena:** que SmartPay use formulario dinámico. Miguel lo mencionó y encaja
—es un canal de RD y el formulario dinámico es el recorrido de RD— pero el árbol local no lo confirma, así
que quedó escrito como **inferencia sin verificar**, no como hecho.

## Auditoría de exactitud: tres afirmaciones más mal enmarcadas

Buscando lo mismo que Miguel encontró en Credifamilia —local escrito como si fuera producción— salieron
tres más, ya corregidas:

- `pitfalls.empty-listing` decía «Medido: afectaba a **17 comercios**». Salía de una copia LOCAL. Ahora
  dice que la cifra da **la escala del efecto**, no cuántos comercios lo sufren hoy.
- `flows.post-disbursement` decía «vacía en el **90 %** de las filas» sin decir que se contó sobre una
  copia.
- Dos nodos decían «Hecho, **medido**» sobre una **ausencia de registro** — eso no se mide, se lee en el
  código. Bajado a «verificado».

Lo declarado como no verificado está todo marcado y es poco: una inferencia (el formulario dinámico de
SmartPay), un testimonio (el cambio manual a autorizada) y dos inferencias sobre causas que encajan con
el mecanismo pero no se rastrearon caso por caso.

## «Cómo lo sabemos»: se poda el relleno, se conserva la señal

Miguel propuso quitarla entera. Medido antes de decidir: **11 % del corpus**, y **30 de 48 nodos
distinguían fuentes** (producción / local / testimonio / inferencia) mientras **17 sólo repetían
«verificado contra el código»**.

El argumento decisivo es de esta misma sesión: **esa sección es lo que permitió cazar los cuatro errores
de arriba**. Sin ella, «necesita seis servicios externos» se lee como hecho de producción y nadie lo
cuestiona.

Solución aplicada: **el valor por defecto es «verificado contra el código» y ya no se escribe** — la
sección se podó de 17 nodos. Y el lint la exige **sólo cuando hay algo que distinguir**: si el nodo
declara `measured:`, o si su prosa contiene una inferencia, un testimonio o una reproducción local.
⚠ La regla nueva atajó de inmediato dos nodos que se habían podado de más.

## Tech vs negocio: no se parte el corpus, se agrega la pregunta que faltaba

Miguel propuso dividir la documentación en una parte para tech y otra para negocio, con ejemplos como
«¿cuánto facturó Pullman hoy?» o «¿cuántas solicitudes se cancelaron?».

**Esas no son preguntas de documentación: son preguntas de datos.** Ningún documento las contesta y uno
que lo intentara estaría viejo mañana. Y partir el corpus en dos sería duplicar — el error que se viene
evitando toda la sesión: dos copias derivan y la búsqueda devuelve la peor.

Pero adentro había una pregunta que la documentación **sí** contesta y que faltaba: **¿con qué se cuenta
cada cosa y qué trampa tiene?** De ahí sale `canon.counting`, escrito como **índice por métrica** —
punteros, no copias, para no duplicar lo que ya explican otros nodos.

Doce métricas con su trampa: los desembolsos no se cuentan con el estado · «lo que recibe el comercio»
tiene dos bases que difieren en 38 % · la comisión da cero fuera de rango · el país por defecto arrastra
cientos de miles · **no hay columna de canal**, así que todo reporte por canal está reconstruido · el
medio de pago dice quién registró · contar consultas a un buró subestima los intentos.

Y el corte tech/negocio a nivel de párrafo ya existía: la sección `## Tech`, opcional y salteable.

## La retroalimentación: `/api/propose`, y la pregunta que la hace funcionar

Miguel propuso que la herramienta permita corregir y agregar, haciendo «preguntas clave para ubicar el
aporte en el contexto», con un modelo detectando si la respuesta del usuario confirma o refina.

Construido como `/api/propose`. Recibe una corrección en palabras de quien la aporta y devuelve **dónde
podría ir** (con la misma búsqueda del corpus), **qué le rechazaría el lint** dicho por adelantado, y
**las preguntas que faltan**. Probado: un aporte con `LenderListingService.php` y `getLenders()` recibe
los tres rechazos explicados antes de que nadie abra un PR.

**Las preguntas no son un cuestionario inventado: son las que el lint va a hacer igual.** Preguntarlas
antes convierte un rechazo en una conversación. Y la cuarta es la que no se me había ocurrido y sale de
todo lo medido en esta sesión: **«¿con qué palabras preguntarías vos por esto?»** — la respuesta va al
TEXTO, no a un campo aparte, porque la búsqueda es léxica y sólo encuentra lo escrito. **Quien aporta el
hecho es quien sabe cómo se pregunta por él**, y eso resuelve de raíz el hueco de vocabulario que apareció
cuatro veces acá.

⚠ **No escribe nada, a propósito.** El destino sigue siendo una rama y un pedido de revisión: git ya es el
registro, la comparación, la aprobación y la auditoría.

## Qué contesta hoy el corpus (medido por público)

22 preguntas reales de cinco públicos, **22 aterrizan**: soporte (no le salió nada · pagué y no se ve ·
el codeudor no recibió el link) · producto y comercial (de qué vive CreditOp · quién pone el capital · si
pone más cuota inicial le baja el cupo) · operaciones (cómo cuento los desembolsos · el reporte no me
cuadra) · dev nuevo (por qué hay dos sistemas · qué significa el sufijo V2) · QA (qué puedo probar de
punta a punta · el buró en pruebas es real).

Dos imperfectas, las dos por **colisión de palabras**, no por falta de cobertura: «dónde están los
modelos» choca con «modelo de negocio», y «por dónde empiezo a leer» choca con «no leer».

## La escritura por API, probada de punta a punta — y los tres bugs que encontró

Miguel pidió que fuera orgánico: que la herramienta detecte en la conversación la intención de corregir o
agregar, y sepa ubicarlo sola. Y propuso una prueba concreta: leer los repos de PDF, subir información por
la API, meter algo mal a propósito y corregirlo.

**Reconsiderada una postura.** Se venía diciendo «la API no escribe, el destino es un PR». La objeción era
a un ALMACÉN PROPIO — pero escribir los `.md` **es** la fuente única, así que no hay contradicción. Ahora
`/api/propose` acepta `apply`, valida el corpus ENTERO con el cambio adentro **antes** de tocar el disco, y
recarga en vivo. Sigue sin haber segunda fuente de verdad, y el commit sigue siendo del humano.

**La prueba corrió entera y encontró tres cosas:**

1. **No se puede crear un nodo huérfano** — la regla del grafo actuó como guarda de ESCRITURA, no sólo de
   despliegue: el primer intento fue rechazado. Se agregó `linked_from`, que escribe la bajada **en la misma
   operación**. No se puede crear un huérfano, y tampoco hay que arreglarlo a mano.
2. **Al reiniciar, el servidor servía el corpus del último build y no el del disco** — el embebido pisaba
   lo recién escrito, así que un nodo nuevo se veía huérfano contra un estado viejo. Corregido: **si hay
   `content/` en disco, ése manda**; el embebido queda de respaldo para la imagen desplegada.
3. **Corregir el contenido de una sección NO corrige su título** — y el título es el identificador. La
   corrección invirtió el sentido del texto y el encabezado siguió diciendo lo contrario. **Renombrarlo es
   una migración** (rompe los enlaces), así que la API no lo hace sola: hay que decidirlo.

Resultado: `map.pdf-documents` creado, colgado de `flows.formalization`, con un dato falso insertado y
corregido por la misma API — y el corpus devolviendo la respuesta correcta al final, sin reiniciar.

## Las dos llaves: lo que protege no es el 403

Miguel propuso dos llaves: una de lectura para los bots y otra de escritura para una persona, y que **la
de lectura ni siquiera muestre que existe la escritura**.

Esa segunda parte es la buena, y es más que cosmética: **un modelo no intenta lo que no sabe que existe**.
Un 403 llega tarde; la omisión llega antes. Implementado así — `/api/tools` se adapta a la llave y con la
de lectura `/api/propose` no aparece ni en los pasos ni en la lista. El 403 queda igual para quien conozca
la ruta, y su mensaje **deriva a una persona** en vez de sólo negar.

Tres decisiones que lo hacen encajar con el repo:

- **Sin llaves configuradas, todo abierto** — es `task dev`. Pedir configuración para levantar la
  herramienta en la propia máquina sería fricción sin ganancia.
- **`/health` y `/api/yo` quedan siempre abiertos**: son el contrato del repositorio y `task conforme` los
  prueba sin llave. Cerrarlos rompería el despliegue, no lo aseguraría.
- **Los nombres van a `.env.example`**, con el nombre y nunca el valor, como manda ese archivo.

Probados los tres niveles: sin llave → 401 · con la de lectura → 5 herramientas, sin `propose`, y el
intento de escribir deriva a una persona · con la de escritura → 6 herramientas.

## El giro: el mapa es el artefacto, la prosa es el resto (2026-08-27)

El corpus de 26 nodos **cubría mucho y poco a la vez** — así que se reinició por profundidad: un tema
bien hecho antes que veinte por encima. Y al rehacerlo cambió qué es lo importante.

**La medición que lo decidió.** Antes de reescribir la prosa, grepeé el código a ver cuánto de ella
salía de ahí:

| lo que había escrito a mano | en el código |
|---|---|
| «la consulta va con un monto fijo» | `$request->amount = 1000000` |
| «el producto chico arranca en $100.000» | `$hasBnpl => 100000` |
| «se muestra sin cupo confirmado» | `// ToDo: solo se muestran preaprobados` |

**~70 % era transcripción.** Al revés, `git grep -licE 'validTo|notAfter|certificate.*expir'` en los
tres repos devolvió **0**: nadie revisa el vencimiento del certificado con que se firma cada llamada al
banco. **Eso no se puede grepear porque no está** — y el día que venza, el canal deja de responder sin
que nada avise.

**La forma que salió de ahí.** Cada área del mapa declara dos cosas: su `objetivo` (qué resuelve, en
palabras de negocio) y `se_deduce_leyendo` (qué va a encontrar el agente si abre esos archivos). No se
lo escribo: le digo dónde mirar. Los archivos van **separados por repositorio** —la misma ruta existe
en más de uno— y cada uno con su **hash de blob de git**, el mismo que usa git, así que cambia
exactamente cuando cambia el contenido.

Las 7 áreas del tema, con sus archivos: decidir el producto (2) · hablar con el banco (6) · el paso a
paso en el backend (28) · el código de compra de la caja (3) · las pantallas del banco (48) · las rutas
del recorrido (46) · el aviso de estado ⚠ que vive en el sistema histórico (12).

⚠ **Y un área que se llama «el resto» no le sirve a nadie.** El primer reparto dejó dos bultos con 77
de los 145; se rehizo hasta que cada área declara un objetivo real. Vale la pena mirarlo al agregar el
próximo tema: es el error fácil.

**Dos documentos, no cuatro.** `business.md` (qué reclamo produce cada comportamiento y qué se le
contesta a un comercio) y `pitfalls.md` (ausencias y consecuencias). Las otras dos clases se caían
solas: describían lo que el mapa ya dice dónde está.

**Y `business.md` no explica qué es Bancolombia** — un modelo ya lo sabe. Guarda lo que sólo se sabe
midiendo nuestro sistema: que el crédito grande se muestra sin cupo confirmado, que un «no habilitado»
se trata como sin cupo y **no deja rastro de fallo en ningún lado**, que el aviso del banco lo atiende
el sistema viejo aunque el flujo corra en el nuevo.

**El puente para el futuro.** Con el hash, `-deriva` contesta qué cambió desde que se escribió el tema
y `-afectados <rutas…>` lo inverso: qué documentos dejó viejos un merge. Un webhook de GitHub trae
justo esa lista de rutas. `/api/propose` ya valida y, en una instancia sin disco, devuelve el archivo
listo y la rama sugerida en vez de fallar — que es lo que necesita un agente para abrir el PR él mismo.

**Verificado:** los archivos existen en `main` de sus repos y 0 derivaron · `task ci` verde (desde un
worktree limpio, no desde el árbol de trabajo) · y `/api/read` **ahora sí entrega el mapa junto al
documento** (no lo hacía: el agente recibía la mitad cara sin saber dónde buscar la otra).

## El expediente: de «qué cambió» a «qué hay que hacer» (2026-08-27)

`-deriva` decía qué archivos se movieron. Eso solo no alcanza: una lista de rutas no dice si el texto
quedó mintiendo, ni si faltan archivos, ni si alguno sobra. **`-expediente <tema> <repos>`** arma todo
lo que hace falta para decidirlo, en un documento, y **no decide él** —no vive ningún modelo en el
binario—: junta la evidencia y hace las preguntas.

**Lo que lo hace exacto: el hash ubica el punto en la historia.** El blob guardado *es* el estado del
archivo cuando se documentó, así que se camina hacia atrás por los commits del archivo hasta encontrar
ese blob y todo lo posterior es lo que hay que revisar. Ni un commit de más, y sin guardar ninguna
fecha aparte.

**Dos mediciones cambiaron el diseño:**

| medido | qué cambió |
|---|---|
| **35 % de los PRs mergeados de `legacy-backend` no tiene descripción** (60 mirados; los que sí, promedian 2.000 caracteres) | el expediente nunca se apoya sólo en la descripción: diff y mensajes de commit van siempre, y la ausencia se marca |
| de **75 candidatos a sumar**, los **9** en una carpeta ya declarada eran todos plausibles; los 66 restantes eran `Dockerfile` y workflows | se ordenan por **cercanía de carpeta**, no por cuántos PRs los tocaron |

⚠ **Y encontró un defecto real en su primera corrida.** Rebobinando el mapa al 2026-05-27, marcó 61 de
145 archivos movidos. Leyéndolo: la prosa decía que una caída del banco *«no deja rastro de error en
ningún lado»*, y desde junio de 2026 existe una tabla de capturas de error del aliado que guarda justo
eso — **la prosa la mencionaba cero veces**, y de los 5 archivos que la nombran el mapa ya declaraba 3.
Se corrigió el texto y se sumaron los 2 que faltaban.

## Un solo archivo de prosa, decidido por Miguel (2026-08-27)

De 5 capas → 4 clases → 2 → **1**. El motivo fue siempre el mismo: las categorías describían lo que el
mapa ya dice dónde encontrar. Y con más de un archivo quedaba una **decisión de enrutado en cada
edición**, que es exactamente donde un agente se equivoca —por fricción, no por no entender la regla—.

`context.md` no es un documento estructurado: **párrafos, en prosa, estilo historia**. Se amplía sin
reorganizarlo, que es la operación que un agente hace bien.

⚠ **La reserva, y su arreglo:** una bitácora sin regla para lo que dejó de ser cierto se pudre. La regla
va escrita en el propio encabezado del archivo — *cuando algo deja de ser cierto no se borra, se corrige
y se dice desde cuándo* — y el ejemplo vivo quedó en el texto de Bancolombia: «hasta agosto de 2026 la
solicitud quedaba viva y sin captura».

**Dos consecuencias que aparecieron al hacerlo:**

- **El banco de preguntas tuvo que subir la vara a la SECCIÓN.** Con un archivo por tema, acertar el
  documento es gratis. A nivel sección: 11/11 alcanzables, 9/11 al primer resultado.
- **El preámbulo competía con las secciones.** Como describe de qué trata el archivo entero, matcheaba
  cualquier pregunta del tema y se robaba el primer puesto sin contestar nada — medido con «qué le
  contesto al comercio cuando no le sale Bancolombia». Se sacó del índice, igual que «Cómo lo sabemos»:
  es tapa, no respuesta.

## La prosa se reescribió contra el nodo real, y dos afirmaciones se cayeron (2026-08-27)

Miguel: *«creo que el context de bancolombia no se ajusta con la realidad»*. Tenía razón — la escribí
**antes** de leer `context/server/data/flows/bancolombia/doc.md`, así que varias cosas las inferí.

**Lo que no resistió la verificación:**

| lo que decía | qué pasó al verificarlo |
|---|---|
| «una guarda del código de compra imposible de cumplir» | **no existe**; la busqué en los dos servicios que generan el código y la comprobación real es normal |
| «aprobado y sin factura es normal en tienda física» | no está respaldado en ningún nodo ni en el código |

**Lo que apareció al leer el nodo real, y es mejor:**

- **Es el único agregador sin handoff.** El banco decide y se queda el crédito, pero la experiencia
  entera la renderiza CreditOp. El reflejo de «es del banco, que lo vean ellos» está mal acá.
- **No es «el lender del canal retail»: es transversal** (109 de 230 comercios).
- **Con los dos aprobados arranca siempre en BNPL** → las pantallas del otro no se alcanzan sin apagar
  esa compuerta. Es lo primero que hay que saber para probarlo.
- **El canal de ecommerce no escribe el identificador del trámite** — ahí la ausencia es real, no un
  artefacto de medir sobre el histórico. Ese matiz no lo tenía.
- Y la trampa de las **dos fuentes de verdad** del canal retail: un comercio en la dinámica y no en la
  lista fija pasa la comprobación y **falla en silencio** con un código que en caja no sirve.

⚠ **Y salió un hecho que no estaba en NINGÚN lado, ni en el nodo local.** Persiguiendo la única pregunta
que quedaba sin contestar («¿por qué no le sale Bancolombia?») apareció en el código una **hora de corte
diaria**: pasada esa hora el producto se quita del listado **sin siquiera consultar al banco**. Medido
contra **prod** el 2026-08-27: **20:30**, y son los **únicos dos** productos de la plataforma que la
tienen. El mismo cliente ve una lista distinta según la hora, y desde afuera se ve igual que un rechazo.

Eso también arregló el mapa: el área de la decisión ahora promete «la hora de corte y qué pasa al
pasarla» en su `se_deduce_leyendo`.

**Método que quedó claro:** la pregunta sin respuesta del banco de preguntas **no era ruido de la
búsqueda, era un hueco del contenido**. Perseguirla hasta el código encontró el hallazgo. Y el ajuste
final fue de **vocabulario, no de pesos** — coherente con lo medido en agosto.

**Banco de preguntas: 14/14 alcanzables, 11/14 al primer resultado**, exigiendo la sección.

## «Cómo lo sabemos» se retiró, y la premisa endureció el lint (2026-08-27)

Miguel: *«yo veo innecesario Cómo lo sabemos, porque asumimos que es verídico lo que agregamos»*. De
acuerdo, y con dos razones más que refuerzan la suya:

- **ya estaba fuera del índice de búsqueda** por contaminar el ranking — un texto que no puede ser
  respuesta y que nadie lee es peso muerto;
- **quedó redundante por diseño**: en el corpus viejo la procedencia era la ÚNICA señal de si algo había
  envejecido; hoy eso lo hacen los **hashes del `map.json`**, exactos y revisables por una máquina.

**Y la premisa lleva a algo más fuerte que la sección:** si se asume que lo que entra es verídico,
entonces **lo no verificado no debe entrar**. Así que el lenguaje de duda pasó de «declaralo aparte» a
**rechazarse**.

| regla nueva del lint | por qué |
|---|---|
| se rechaza `inferencia`, `hipótesis`, `sin verificar`, `testimonio` | se verifica antes de escribirlo, o no se escribe |
| «medido»/«verificado» **exige una fecha en la misma sección** | es lo único que la sección cubría y el mapa no: **un número medido contra un sistema vivo decae sin que cambie ningún archivo** —nadie toca el código cuando cambia una fila de la BD—, así que la fecha va pegada al número |
| una sección `## Cómo lo sabemos` **falla** | para que no vuelva por costumbre |

⚠ **Las tres se probaron rompiéndolas a propósito, y las tres fallan.** Una regla que nunca se vio fallar
no está verificada.

De paso salieron del README tres reglas que describían el corpus retirado (cabecera con frontmatter,
`## Tech`, la capa `field`): decían cómo se escribía un nodo que ya no existe.

## La forma de `content/`, y un error de medición que llevaba todo el día (2026-08-27)

Miguel preguntó lo obvio —*«¿cómo sabemos cuándo quedó desactualizada? por obvias razones siempre se
compara contra main»*— y ahí apareció el error.

⚠ **`-deriva` comparaba contra el `main` LOCAL.** Medido: el `main` local estaba **46, 76 y 5 commits
atrás** de `origin/main` en los tres repos. Con esa referencia el tema daba **«0 archivos cambiaron»** —
que es lo que reporté toda la tarde—; contra `origin/main` daban **2**, y no eran archivos cualquiera:
las **rutas del backend** y las **rutas del front**, justo los que cambian cuando al tema se le suman
pantallas o endpoints.

**Un clon viejo no da un error: da un «todo al día» tranquilizador y falso.** Arreglado: se compara
siempre contra `origin/main`, y `-temas` avisa cuánto está atrás la copia local (la medición es correcta
igual, pero lo que ves en el editor no es lo que se comparó).

**Y el bucle funcionó apenas se arregló la referencia.** El expediente de esos dos archivos llevó a:

- una **pantalla nueva del canal** (`resolve-checkout`, del 2026-08-25) que el mapa no declaraba;
- y de paso a que **el controlador del checkout del canal retail tampoco estaba declarado** — y es una
  de las dos puertas por donde el comercio mete al cliente a este canal.

**147 → 149 archivos.** ⚠ Y **la prosa no se tocó**: lo que cambió es mecanismo, y el mecanismo se
deduce leyendo. Es el caso que ilustra la regla «cambiar NO es dejar de ser cierto».

### La forma, ahora escrita

Un tema es **una carpeta con dos archivos** (`map.json` + `context.md`) y no hay más formas — el lint ya
rechazaba un archivo que exista y el mapa no declare. Tres comandos nuevos para que el ciclo sea
mecánico:

| comando | para qué |
|---|---|
| `-temas <repos>` | ¿cuál de mis temas quedó viejo? una fila por tema: archivos, derivados, palabras |
| `-nuevo <tema>` | deja la carpeta con la forma correcta, para que el arranque no invente variantes |
| `-expediente <tema> <repos>` | de «qué cambió» a qué hay que hacer |

**Un tema no envejece por tiempo: envejece cuando cambia alguno de los archivos que declara.**

## La arquitectura: dominio puro + adaptadores, verificado por una prueba (2026-08-27)

Miguel preguntó si hexagonal era viable. **Respuesta: a medias, y la mitad que sirve ya estaba.**
`LoadFrom(read, list)` recibe dos funciones — eso *es* un puerto con dos adaptadores, el embebido y el
disco. Lo que faltaba no era el patrón: era que **nada impidiera cruzarlo**.

**Por qué NO la ceremonia completa** (`domain/ports/adapters/application`): hay **un solo adaptador por
puerto** —un transporte, una implementación de git—, y en Go **una carpeta es un paquete**: partir en
siete obligaría a **exportar tipos que hoy son privados**, o sea debilitar el encapsulamiento en nombre
de reforzarlo.

**Lo que sí paga: la frontera que vigila el compilador.**

```
main.go                 el punto de composición
internal/corpus/        EL DOMINIO — documentos, política, índice, grafo.  PURO
internal/codebase/      los repos que el mapa señala: git y GitHub
internal/upkeep/        temas, deriva, expediente, molde, banco
internal/skills/        cómo trabajar con esto, para un modelo
internal/api/           las dos llaves, los handlers, el mux
```

**Medido:** `corpus` y `skills` tienen **cero** dependencias de `net/http` y `os/exec` y no importan
ningún paquete nuestro.

⚠ **La frontera está VERIFICADA, no declarada.** `boundary_test.go` parsea los imports del dominio y
falla si aparece transporte o sistema operativo; el Dockerfile corre `go vet && go test` **antes** del
lint y del banco, así que **si el dominio se ensucia no hay imagen**. Probada metiéndole un import
prohibido a propósito.

**Dos cosas que el corte destapó y que valían solas:**

- **Los tres `embed` estaban DENTRO del dominio**, atándolo al build: el corpus era «lo que se compiló»,
  no «lo que hay». Ahora se reciben, y el mismo código sirve el embebido en producción y el disco en la
  máquina de quien edita, **sin una sola condición adentro**.
- **El handler de propuestas tenía sus propias copias de los regex del lint.** Ahora pregunta
  `corpus.CheckText(...)`. Con copias, el día que una regla cambie habría dos verdades — y la que le
  contesta a quien propone sería la vieja.

⚠ Y el renombrado mecánico dejó dos trampas que conviene recordar: calificó un **campo de struct**
llamado `Node` como `corpus.Node`, y convirtió la bandera de línea de comandos `-expediente` en
`-upkeep.Dossier`. Las dos las atajó el compilador y una prueba a mano; un renombrado por regex sobre
Go **no es seguro en strings ni en campos**.

## Antes de eso: archivos por concern + `skills/` (2026-08-27)

Canon era **un `main.go` de 2.822 líneas**. El problema no era el tamaño: era que **para leer una regla
del lint había que pasar por encima de 570 líneas de handlers HTTP**.

**La forma la decidió el repo, no yo:** `credibot` son once archivos planos por concern
(`loki.py`, `redash.py`, `slack.py`…), en un solo paquete. Canon quedó igual — `corpus.go`,
`politica.go`, `busqueda.go`, `grafo.go`, `git.go`, `expediente.go`, `api.go`, `banco.go`, `skills.go`.
**Sin paquetes anidados:** es un binario, no una librería. El corte se hizo con un escáner que entiende
`/* */` y strings crudos; la verificación de que no se perdió nada es que compila y que las 72
declaraciones son las 71 de antes más `servidorHTTP`.

### `skills/` — el corpus dice QUÉ; los skills dicen CÓMO

Dos públicos, dos carpetas. `content/` lo lee quien tiene una pregunta de negocio; `skills/` lo lee un
modelo que va a **hacer algo**: `consultar` · `contextualizar` · `recontextualizar` · `corregir`.

- se sirven por `/api/skills` y `/api/skills/<id>`, y **se anuncian en la cabecera del índice y en
  `/api/tools`** — anunciarlos importa tanto como tenerlos, mismo principio por el que la escritura se
  **omite** para una llave de lectura;
- **no van en el corpus** porque ensuciarían la búsqueda: quien pregunta por el negocio recibiría
  instrucciones de mantenimiento;
- **no son el README**: el README es para una persona que construye canon, un skill es para un modelo
  que lo usa. Por eso son imperativos y cada uno dice **qué NO hacer**, con la medición que lo justifica.

⚠ El protocolo de consulta **era una constante de Go** a mitad del archivo. Como archivo se edita sin
recompilar el razonamiento y se sirve suelto; la fuente sigue siendo una sola porque la cabecera del
índice lo inserta desde el archivo.

**El lint los cuida:** sin `# título` falla, y por encima de 900 palabras falla. Las dos probadas
rompiéndolas.

### Y un arreglo en el lint del repo compartido

`dev/validar.js` dice *«acá no se mira cómo está escrito: se mira que responda lo que se le exige»*,
pero leía **un solo archivo** — así que en los hechos **obligaba a que toda herramienta Go viviera en un
`main.go`**. Ahora lee todos los archivos del mismo lenguaje que estén al lado, sin recursión
(`node_modules` está justo abajo). `task lint` verde en las 5 herramientas.

## El mapa navegable: masticado, grafo derivado, y por qué PageRank todavía no (2026-08-28)

Miguel pidió tres cosas: entregar **fragmentos masticados**, poder **navegar de un json a otro** como
grafo, y evaluar **PageRank** para las relaciones. Las tres tienen respuesta, y una es «todavía no».

**Masticado:** un hit de `in_the_map` ya no es una referencia — trae la llamada siguiente **ya armada**
(`code: /api/code?area=listado/context&n=2`), los archivos recortados a 8 por repo con `files_omitted`,
y sus vecinas. El modelo no arma URLs: las sigue.

**El grafo NO se declara: se deriva.** Dos áreas que citan el mismo archivo están conectadas por
construcción, y la arista viene con `via` — los archivos compartidos que la prueban. Medido al
construirlo (286 archivos declarados): existían **2 aristas** y las dos eran semánticamente correctas
sin que nadie las declarara — la decisión de producto de bancolombia ↔ la consulta de pre-aprobación
del listado (comparten `PreApprovedLenderService`), y el backend ↔ las dos puertas (comparten las
rutas). Derivada = no puede quedar vieja: sale de los mapas que ya se verifican contra origin/main.

**PageRank: la estructura ya es esa, el algoritmo todavía no.** Aristas con peso (cuántos archivos
comparten) es exactamente lo que PageRank consume — si el corpus crece a decenas de temas se enchufa
sin rediseñar. Pero con 17 áreas y 2 aristas sería teatro: el grado del nodo da el mismo orden y se
explica mirándolo. Quedó escrito en `graph.go` para que no se re-litigue sin datos nuevos.

Banco sin cambios: 23/26 primero, 26/26 alcanzable. CI verde, worktree limpio, sin mergear.

## Tercer tema: creditopx — y el grafo probó su tesis (2026-08-28)

**25 archivos en 5 áreas** (cupo y sus tres evaluadores · categorías · ajuste de buró propio ·
exclusión silenciosa · frontera del rotativo), **863 palabras** de prosa. Todo salió del nodo local
`creditopx` (sello 2026-08-17) **re-verificado contra origin/main hoy**: la tolerancia de $1.000, el
corte por entidad (`user_id+lender_id+rt=2`), los tres evaluadores, y el `unset` silencioso en
`application` (:376).

**La prosa que quedó** — sólo lo no deducible: de quién es la plata (el comercio, y eso explica todas
las reglas) · el rechazo silencioso como comportamiento normal · el bloqueo por crédito activo con sus
tres precisiones · el ingreso no decide presencia (medido 2026-08-17) · la categoría corre al final ·
el rotativo con motor propio («sólo 6 cuotas» no es bug) · los dos gemelos corriendo.

⚠ **La arista con el listado apareció SOLA**: la área de exclusión de creditopx comparte
`LenderValidationService` y `LenderSpecialGrantingService` con el área «decidir qué entidades ve el
cliente» del listado, y el grafo la derivó sin que nadie la declarara. Primera prueba real de la tesis
del grafo derivado, un día después de construirlo.

⚠ Y **mi propio lint me atajó**: escribí «es la primera hipótesis de todo el mundo» y la regla
anti-lenguaje-de-duda (que no distingue uso y mención) lo rechazó. Se reescribió «es lo primero que
todo el mundo supone». La regla es tosca a propósito: un falso positivo cuesta una frase; un falso
negativo deja una afirmación sin verificar viviendo como cierta.

Banco: **35 preguntas, 32 al primero, 35/35 alcanzables**. Corpus: 3 temas · 313 archivos · 0
derivados. CI verde desde worktree limpio. Sin mergear.

## Cuarto tema: credifamilia — y el grafo conectó tres temas (2026-08-28)

**22 archivos en 5 áreas** — la compuerta local · el sondeo de pre-aprobación (única entidad con
polling) · el plan dinámico · la radicación SOAP al autorizar · la regeneración de documentos — y
**714 palabras**. Cuarto repo en el corpus: **`pre-approvals-service`** (el microservicio Go).

Verificado hoy contra origin/main antes de escribir: el aprobado sin guarda (`valor_disponible ?? null`
con `pre_approved=true`), la compuerta `totalNs<12 || !debtCapacity`, y la ruta de regeneración sin
middleware en su archivo de rutas.

**La prosa** — el híbrido y sus dos errores (tipo de entidad equivocado rompe el cierre sin romper nada
visible; la colisión del 24 entidad/comercio) · las dos puertas del listado (v1: 3, v2: 5, medido
2026-08-23) · el aprobado sin cupo (F-113) · el límite de intentos del proveedor que tapa diagnósticos ·
**la regla que clasifica y no excluye** (1.923 créditos de empleados en sucursales «sólo
independientes», F-162) · el sondeo como comportamiento normal · las dos ausencias del endpoint de
regeneración.

⚠ **El grafo conectó TRES temas sin que nadie lo declarara**: el área del sondeo de credifamilia salió
con 4 vecinas — bancolombia («decidir cuál producto», via `PreApprovedLenderService`) y tres áreas del
listado (via los constants, la entity del status y el fetch del front). Es la topología real del
sistema, derivada de los mapas.

Banco: **43 preguntas, 40 al primero, 43/43 alcanzables**. Corpus: **4 temas · 335 archivos · 0
derivados · 4 repos**. CI verde desde worktree limpio. Sin mergear.

## Decisiones abiertas

- **La frontera con credibrain** (herramienta de Oscar en el mismo catálogo, «la memoria de la
  compañía»). Mi lectura: canon = fuente curada; credibrain = el que contesta y cita. Hablarlo antes
  del PR.
- **La ficha de entidades** (aprobación, embudo, ticket por entidad — hoy `context/docs/ENTIDADES.md`):
  con `para: compania` la ve toda la empresa. ¿Entra, y con qué recorte?
- **Quién sella en el compartido:** ¿el review del PR equivale al `verified:`? Propuesta: sí — quien
  aprueba el PR pone su nombre en la fecha.

## Bitácora

- 2026-08-27 · **1h00 medido** (`make pulso`; el grueso del día fue frontend). El corpus se reinició
  por profundidad y **`map.json` pasó a ser el artefacto principal**: 145 archivos de 3 repos en 7
  áreas con hash de blob, contra 1.043 palabras de prosa. Lo decidió una medición (~70 % de lo escrito
  a mano era grepeable; el certificado sin vigilar, no). **De 4 clases de documento a 1** (decisión de
  Miguel): `context.md` en prosa corrida, con la regla de envejecer escrita en su encabezado. Y se armó
  el **expediente**, que cierra el bucle de recontextualización y encontró un defecto real en su primera
  corrida. Dos bugs propios encontrados y arreglados: `/api/read` no devolvía el mapa, y el preámbulo se
  robaba el primer resultado de la búsqueda. Y la prosa se **reescribió contra el nodo real**: dos
  afirmaciones inventadas fuera, y apareció la **hora de corte de las 20:30** —medida en prod, y que no
  estaba escrita en ningún lado—. Y se retiró **«Cómo lo sabemos»**, con el lint endurecido en su lugar.
  PR #10, un commit, CI verde.
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
