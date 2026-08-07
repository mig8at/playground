# Trazador · reconstruir el recorrido de UNA solicitud

> **verificado contra `main`** (rama local de `playground`) el **2026-08-07**. La herramienta vive en
> `playground/trazador` y no se despliega: se corre local contra prod/staging/dev en modo lectura.

## Qué es

Un server Go + una UI Vue que contestan **«¿qué le pasó a esta solicitud y por qué?»** cruzando dos
fuentes: la **BD** (MySQL vía Redash) y los **logs** (Grafana Loki). Es la herramienta de SOPORTE: se
entra con una cédula, un teléfono o un `user_request_id` y sale el recorrido por etapas, con la
evidencia colgando de cada paso.

Su regla de oro, que explica casi todas sus decisiones de diseño:

> **La BD dice QUÉ pasó (hecho). Los logs dicen POR QUÉ. La AUSENCIA de un log NO PRUEBA NADA.**

De ahí sale el resto: un estado de `user_requests` puede pintar una etapa, un log no puede *negar* una
etapa, y cuando no se puede afirmar nada la etapa sale `sin-evidencia` en vez de `ok` o `skip`.

## Contenido

**Las 9 etapas** (el orden es de FLUJO, no de hora) usan el vocabulario del wizard, porque el reporte de
soporte llega en ese idioma («falló en firma de documentos», no «falló en formalization»):

`amount` → `authorization` → `personal-info` (incluye burós) → `profiler` → `lenders` →
`selected lender` → `lender response` → `validation` → `disbursement`

**Dos mapas declarativos**, embebidos con `go:embed` (por eso **un cambio de mapa exige recompilar**):

- `mapa/etapas.json` — a qué ETAPA va cada línea de log (matchers por prefijo/exacto/regex), y la
  semántica de los estados de BD: `bd.estados` (pertenencia) · `bd.cierran` (prueban que TERMINÓ) ·
  `bd.detienen` (la solicitud está adentro y no salió). Esas tres son preguntas distintas y mezclarlas
  produjo dos falsos verdes (ver Gotchas).
- `mapa/substeps.json` — a qué SUB-PASO dentro de la etapa, agrupado en bloques. Tipos: `hitos`
  (patrones de log), `catalogo` (centrales de riesgo declaradas), `familias` (entidades por
  `response_type`).
- `mapa/ramales.json` — qué etapas aplican por familia de lender y por canal; de ahí sale el `no aplica`.

**Cómo se corre** (todo lectura, y las consultas a prod quedan auditadas a nombre del token):

```bash
cd trazador/server
go run . -target prod -ureq 521997          # la traza en árbol
go run . -target prod -ureq 521997 -json    # estructurada
go run . -target prod -sql "SELECT …"       # UNA consulta de solo lectura
go run . -serve 127.0.0.1:5199              # la API que consume la Vue
npm run dev --prefix trazador               # server + UI juntos (:5192)
```

Diagnósticos: `-anclas` (cuánto se puede afirmar de cada línea), `-campos` (censo de campos del contexto
de log), `-spans` (si el `span_id` alcanza para ubicar lo que el texto no reclama), `-validar` (audita el
mapa contra un corpus de líneas crudas).

**La evidencia va con el paso.** Cada sub-paso de BD lleva un bloque `Evidencia` con la consulta que
corrió (con el `?` ya resuelto, para pegar en Redash) y las filas que produjeron ese renglón. Se
renderiza aparte de los logs a propósito: una fila de BD es un ESTADO, no un evento — pintarla como log
invita a armar una línea de tiempo con lo que no es una.

## Fronteras (qué cede este nodo)

- **Qué significa cada tabla/columna** del dominio → `profiling`, `entities`, `actors`.
- **Por qué el sistema se comporta así** (reglas, ramales, integraciones) → los nodos de flujo.
- **Los hallazgos** que el trazador ayudó a encontrar viven en `findings` (F-100…F-106), no acá.
- **Ejercitar/mockear un flujo** es `harness`. El trazador LEE lo que ya pasó; el harness lo PROVOCA.

## Dónde mirar

**El ensamblado**: `trazador/server/etapas.go` es el corazón (~3.400 líneas) — `ArmarTraza` cruza BD y
logs, reparte líneas por etapa y por hito, fusiona el hecho de BD con la evidencia de log
(`fusionarCentrales`), y arma el resumen de hallazgos (`armarHallazgos`). **Las fuentes**:
`fuentes.go` (SQL + Redash + el parseo de `ML_predictions`). **El mapa**: `mapa.go` (tipos, matchers,
`EstadoEtapa`/`EstadoCierra`/`EstadoDetiene` derivados del JSON). **La API**: `serve.go`. **La vista de
terminal**: `vista.go` + `imprimirTraza` en `etapas.go`.

**La UI**: `src/components/Etapas.vue` (el árbol lateral, dibujado desde el mapa declarado aunque no
haya traza), `src/components/Detalle.vue` (los pasos, sus logs y el bloque de BD), `src/trazaTexto.js`
(serializa la traza entera a texto plano para pegar en un hilo de soporte).

## Gotchas / riesgos

- **Un estado dice DÓNDE está la solicitud, nunca QUÉ completó.** Es la trampa que ya costó tres veces:
  el estado 10 pertenece a `disbursement` pero significa «adentro, sin firmar» (F-103); la fila de
  estado 9 **se escribe al CREAR la solicitud**, no al completar el formulario (F-106); y
  `user_request_records` **no registra todas las transiciones** — los estados 1 y 10 nunca dejan fila
  (F-105). Por eso `cierran` y `detienen` están separados en el mapa.
- **El wizard NO manda logs a Loki**: sus logs de ruta salen por OTLP hacia PostHog. Verificado el
  2026-08-07 buscando `service_name` que matchee wizard/front/loan-request/remix/react: cero líneas. O
  sea que **la pantalla se INFIERE del endpoint que el backend sirvió**, y una pantalla que no llama al
  backend es invisible. Eso no se arregla con el mapa: es la frontera de lo que la herramienta puede
  afirmar.
- **`risk_central_user_data` se cruza por `user_id`, no por solicitud**: un cliente con varias
  solicitudes en la misma ventana contamina la traza abierta. El árbol lo avisa en los warnings, pero
  las filas igual cuentan en los totales.
- **Sólo ~13 % de las líneas de log dice a qué solicitud pertenece, y lo dice con tres nombres
  distintos** (`context_user_request_id`, `context_userRequestId`, `context_request_id`) — F-102. El
  resto se ubica por herencia de span, y eso se declara en el pie de la traza.
- **`LOKI_ENV` no es el mismo valor en los dos stacks**: prod es `production`; el stack de dev/qa usa
  `development|local|testing` y **no tiene el valor `qa`**. Filtrar por `environment=qa` devuelve cero
  líneas mientras los logs existen. Filtrá por `service_name`.
- **Los mapas van embebidos** (`go:embed mapa/*.json`): editar un JSON y no reiniciar el server deja la
  UI mostrando el mapa viejo. Es la confusión más frecuente al iterar.

## Preguntas abiertas

- [ ] `-validar` no corre desde el 2026-08-06: el corpus de líneas crudas vivía en un scratchpad y se
      perdió. Regenerarlo implica decidir si líneas de producción entran al repo.
- [ ] El tramo `validation` (identity) tiene 12 matchers marcados `soloEnCodigo` (OCR/Rekognition/ADO)
      que ninguna traza medida alcanzó: se mantienen, pero no están comprobados.
- [ ] El veredicto del listado por log (`lenders_count`) necesita un campo `campos` en `HitoDef` para
      mostrarse como hito; hoy lo lee el ensamblador directo.

## Bitácora

- **2026-08-07** — Nodo creado. La herramienta existía desde julio pero no estaba en el árbol: su
  conocimiento vivía sólo en los comentarios del código. Se agregó `trazador` a `tools/roots.py` (mismo
  caso que `harness`: subdirectorio de playground, no repo propio).

## Enlaces

- `harness` — el gemelo que PROVOCA flujos en vez de leerlos.
- `findings` — F-100…F-106 salieron de usar esta herramienta.
- `profiling` · `actors` · `entities` — el significado de los datos que el trazador muestra.
