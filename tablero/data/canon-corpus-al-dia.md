---
id: 74
title: "Canon: el corpus al día con main y con los docs de Santi"
ramas: canon/gate-de-preaprobado, canon/tema-nequi, canon/tablas-al-dia, canon/ronda-en-cero, canon/la-ronda-dice-como-leer-el-diff, canon/la-ficha-los-codigos-y-la-difusion, canon/las-dos-guardas-del-borrador, canon/leer-el-tema-por-partes, canon/el-recorte-tambien-por-api, canon/las-herramientas-por-http, canon/el-catalogo-no-miente, canon/la-historia-no-necesita-clones
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

**El próximo paso es:** decidir con Miguel si el paso 4 se hace —cambiar la forma del mapa por 37
archivos— o si la tarea se cierra acá; y pedirle el resto del bloque del servicio de formularios, que
llegó cortado.

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
8. **El documento de candidatos** ✅ #125. Validado bloque por bloque contra el corpus y contra `main`
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
