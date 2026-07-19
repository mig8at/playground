# Trazador de solicitudes (`soporte`)

App Vue + Vue Flow donde buscás una **cédula**, ves los **intentos de solicitud** de ese cliente y el
flujo dibujado etapa por etapa en verde / ámbar / rojo / punteado: **hasta dónde llegó y por qué se rompió.**

> **Estado real: FASE 0 — 100 % mock.** No hay backend, no hay `fetch`, no hay variables de entorno.
> Verificado: `grep -rn "fetch\|axios\|http://\|VITE_" src/` no devuelve nada. Los datos salen de
> `src/mock.js` (5 cédulas, 6 intentos). El diseño del backend que lo alimentaría está en
> [`ARQUITECTURA-TRACING.md`](./ARQUITECTURA-TRACING.md), sin una línea de código escrita.

---

## Por qué existe

Soporte responde el mismo puñado de preguntas todo el tiempo —"el cliente veía un preaprobado y en el
punto de venta no le sale nada", "el lender ya desembolsó y el estado no cambia"— y la respuesta está en
[`flow/FAQ-SOPORTE.md`](../flow/FAQ-SOPORTE.md), que es un documento **genérico**: explica la causa
probable de un síntoma, no lo que le pasó a *esta* cédula.

El trazador es el paso siguiente: en vez de leer una FAQ y adivinar, mirás el recorrido concreto de la
solicitud y ves el corte. La etapa roja *es* la respuesta, y el detalle te manda a la entrada de la FAQ
que corresponde (`A1`, `D1`, `E1`, `G1`).

El otro motivo, más de fondo: **el "porqué" no está persistido de forma pareja.** Para agregadores
(rt=1) el motivo del rechazo sí se guarda (`preapproval_attempts` en DynamoDB, con `stage` + código);
para CreditopX (rt=2) el cupo se calcula y se tira, no queda razón en ninguna tabla. El demo hace
visible ese hueco antes de invertir en construirlo — es el argumento central de `ARQUITECTURA-TRACING.md`.

---

## Arranque rápido

```bash
cd playground/soporte
npm install
npm run dev          # → http://localhost:5192/
```

Verificado el 2026-07-19: arranca en 121 ms, `curl localhost:5192` da 200. Otros scripts reales
(`package.json`): `npm run build` (a `dist/`, ~253 kB JS) y `npm run preview` (también 5192).

En la UI: escribí una cédula o tocá uno de los **chips** de abajo del buscador (son `SAMPLE_IDS`, las 5
claves de `CASES`). Elegís un intento en la sidebar, y **clic en cualquier etapa o entidad** del canvas
abre su detalle en el panel derecho.

---

## Cómo está armado

Todo es front, sin router y sin librería de estado: cinco archivos y dos componentes de nodo.

| Archivo | Qué hace |
|---|---|
| `src/mock.js` | **La data entera.** `STAGES` (las 7 etapas canónicas) + `CASES` (cédula → intentos → estado por etapa). Es lo único que hay que tocar para agregar un caso. |
| `src/store.js` | Estado reactivo (`ui`) + computeds (`intento`, `selectedNode`) + `search()` / `selectIntento()` / `selectNode()` / `intentoSummary()`. ~40 líneas. |
| `src/App.vue` | Layout de 3 columnas (sidebar · canvas · detalle) y el `computed graph` que traduce un intento a nodos + aristas de Vue Flow. |
| `src/nodes/StageNode.vue` | Nodo de etapa: ícono, label, marca de estado y detalle; la razón del corte se pinta en el nodo **solo si el estado es `fail`** (`StageNode.vue:26`) — en las etapas `warn` (`UR-8790`, `UR-9333`) hay que abrir el panel derecho para leerla. Mismo sesgo contra `warn` que el de las aristas. |
| `src/nodes/LenderNode.vue` | Nodo de entidad colgando de `listado`: nombre, badge `rt`, veredicto. |
| `src/styles.css` | Tema oscuro por variables CSS (`--ok #46c98a`, `--warn #e6ab4b`, `--fail #ec6f6b`, `--skip #4b5262`). |
| `ARQUITECTURA-TRACING.md` | Diseño de la Fase 1 (ver abajo). |

`dist/` existe en disco pero está en `.gitignore` — es un build local, no un artefacto de despliegue.

---

## Conceptos que hay que tener claros

**Las 7 etapas** (`STAGES`, en orden): `registro → formulario → buro → listado → seleccion → cupo →
desembolso`. Son fijas: cada intento reporta un estado para **todas**, aunque no las haya alcanzado.

**Estado por etapa** — `ok` verde · `warn` ámbar · `fail` rojo · `skip` gris punteado (no se llegó).

**Intento** = una solicitud (`user_requests`, id tipo `UR-8842`). Lleva `outcome`
(`aprobado | roto | abandonado`) y `brokeAt` = id de la etapa que cortó, o `null`.

**Entidades bajo `listado`** — la etapa `listado` puede colgar nodos de lender con `rt` (response_type:
`2` = CreditopX in-platform, `1` = agregador que decide por su API) y `verdict`:
`ok` preaprobado · `lowp` probabilidad baja (no excluye, queda al fondo) · `error` no se pudo consultar ·
`excl` excluido. `lowp` y `excl` están en el diccionario de `LenderNode.vue` pero hoy solo `ok`, `lowp`
y `error` aparecen en la data.

### Los 5 casos que trae el mock

| Cédula | Intentos | Rompe en | Historia | FAQ |
|---|---|---|---|---|
| `1032424008` | 2 | `cupo` / `formulario` | Preaprobado en la app, cupo $0 en el POS por crédito CreditopX activo. El 2º intento es un abandono en el formulario. | A1 · G1 |
| `1000637753` | 1 | — | Recorrido completo aprobado con Bancolombia (rt=1). El caso feliz de referencia. | — |
| `98137181` | 1 | `desembolso` | Prami desembolsó pero el webhook `lender-result` no llegó → estado pegado en "en proceso". | D1 |
| `1000218988` | 1 | `cupo` | CrediPullman: en el POS corre la 2ª capa y el score no pasa el mínimo de esa sucursal (548 < 550). | A1 |
| `1002959408` | 1 | `registro` | OTP correcto que rebota. Corta en la primera etapa. | E1 |

Dos de los cinco casos comparten el patrón de § A1 — los que rompen en `cupo`: `1032424008` (crédito
CreditopX activo) y `1000218988` (no pasa las reglas de la sucursal). En ambos, **lo que la app muestra no
es la decisión final**. Los otros dos cortes son de familias distintas: `98137181` es sincronización de
estado por webhook (§ D1, la familia "migración/refactor" del *Patrón de fondo* de la FAQ) y el 2º intento
de `1032424008` es abandono con reciclaje de solicitud (§ G1).

---

## Gotchas

- **La búsqueda es match exacto.** `search()` hace `String(q).replace(/\D/g,'')` y busca esa clave en
  `CASES`. Escribir `1032` muestra "Sin resultados" hasta completar los 10 dígitos — no hay búsqueda
  parcial ni fuzzy. Usá los chips.
- **Cualquier cédula real dice "sin resultados"**, y está bien: es Fase 0. Si alguien lo abre esperando
  datos de producción se va a confundir; el hint de la sidebar lo aclara, el título no.
- **Sin `strictPort`.** `vite.config.js` fija `port: 5192` pero no `strictPort`, así que si 5192 está
  ocupado Vite se corre al siguiente libre sin drama — y **5193 es la UI de `context`**. Mirá la línea
  `Local:` que imprime Vite, no asumas el puerto. (`flow`, en cambio, usa 5190 con `strictPort: true`.)
- **Las aristas nunca se pintan ámbar entre etapas.** En `App.vue:32` el color sale de un ternario que
  solo distingue `fail` y `skip`; un `warn` recibe arista **verde**. Se nota en `UR-8790` (formulario
  warn) y `UR-9333` (desembolso warn): el nodo es ámbar, la flecha que entra es verde. El ámbar de la
  leyenda solo aplica a nodos y a aristas de lender `lowp`.
- **La referencia a la FAQ es texto plano, no link** (`App.vue:138` renderiza "ver A1 · FAQ-SOPORTE.md"
  en un `<span>`). Hay que abrir `../flow/FAQ-SOPORTE.md` a mano.
- **Layout hardcodeado.** Posiciones calculadas (`x = 40 + i*212`, lenders en `y = 330 + j*88`), nodos no
  arrastrables, sin auto-layout. Agregar una etapa a `STAGES` funciona pero ensancha el canvas.
- **Los lenders se identifican por nombre** (`nodeId = 'lender:' + name`). Dos entidades con el mismo
  nombre dentro de un intento colisionan en la selección.
- **PII, a confirmar.** El comentario de `mock.js` dice "cédulas enmascaradas": el *nombre visible* sí lo
  está (`Cliente 1032•••008`), pero **la clave del objeto es el número completo de 10 dígitos** y está
  commiteada. No pude verificar si son cédulas reales de #tech-ops o inventadas — si son reales, hay que
  reemplazarlas. El contrato de Fase 1 (§7 de `ARQUITECTURA-TRACING.md`) exige enmascarado siempre.
- **Código muerto menor:** `MARK` (`App.vue:17`) y `prev` (`App.vue:31`) se declaran y no se usan.

---

## Qué falta para que sea útil de verdad (Fase 1)

`ARQUITECTURA-TRACING.md` diseña un `tracing-service` en Go hexagonal que arma la traza real
componiendo `user_requests` + `user_request_records` + `risk_central_user_data` + `displayed_lenders`
(SQL) + `preapproval_attempts` (DynamoDB, vía `pre-approvals-service`) + re-evaluación de reglas para
rt=2 + Loki opcional. **El contrato JSON de salida es exactamente el shape de `src/mock.js`**, para que
el front solo cambie el origen y no toque la UI.

Nada de eso existe todavía: es diseño, no código. Los puntos abiertos honestos están en su §10
(read-replica vs endpoints internos, si el back ya loguea `user_request_id`, qué motor de reglas usar
para re-evaluar rt=2).

**Divergencia conocida:** `FAQ-SOPORTE.md` lista 8 etapas e incluye `cartera` (post-desembolso, su
sección F). El trazador modela 7 y **termina en `desembolso`** — los casos de mora y servicing no se
pueden trazar acá.

---

## Docs relacionados

- [`ARQUITECTURA-TRACING.md`](./ARQUITECTURA-TRACING.md) — el diseño de Fase 1: fuentes por etapa,
  contrato JSON, seguridad/PII, fases 0-3. Léelo antes de tocar `mock.js` si vas a cambiar el shape.
- [`../flow/FAQ-SOPORTE.md`](../flow/FAQ-SOPORTE.md) — origen de los casos. Barrido de ~590 mensajes de
  #tech-ops (jun–jul 2026), síntomas A→I con causa probable y nivel de confianza 🟢🟡🔴.
- [`../flow/MAP.md`](../flow/MAP.md) — mapa maestro del flujo a nivel archivo+línea. Es el que dice
  dónde vive cada dato que la Fase 1 tendría que leer.

---

*Convención del repo: `playground` se commitea local, sin push.*
