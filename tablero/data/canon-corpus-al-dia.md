---
id: 74
title: "Canon: el corpus al día con main y con los docs de Santi"
ramas: canon/gate-de-preaprobado, canon/tema-nequi, canon/tablas-al-dia, canon/ronda-en-cero, canon/la-ronda-dice-como-leer-el-diff
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

**El próximo paso es:** decidir con Miguel si el paso 4 se hace —cambiar la forma del mapa por 37
archivos— o si la tarea se cierra acá.

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
