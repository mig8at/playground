# Flow — el simulador de los rieles

`flow` es un **simulador para entender**, no producción ni un catálogo real: un grafo editable (Vue 3 + Vue Flow, sin
backend, el estado en `localStorage`) donde una solicitud camina comercio → canal → solicitud → burós → reglas →
perfilamiento → listado → lo que pasa después de elegir. Es de Miguel, para su propio entendimiento: se pone al día
de vez en cuando y **no tiene que seguir al código al pie de la letra**. Lo que muestra Flow nunca es evidencia.

- **Abrir:** la app Flow de Cockpit, o `make flow` (:5252, Vite). Sin servidor propio.
- **Armar un escenario sin clics:** `bin/cockpit open flow '#/lender?name=Finandina&rt=4'` crea la entidad si no
  existe y la elige en el listado, con la oferta guardada (`src/route.js`). Cada navegador guarda sus propias
  entidades: lo de Cockpit no está en el navegador de la sesión, ni al revés.
- **Por consola, para un modelo:** `python3 flow/tools/flow_context.py map --text` · `route "<pregunta>" --text` ·
  `brief <tema> --text`. Mapa → una ficha → la fuente que cita. No le pases cédulas, solicitudes ni datos de un caso.
- **Un caso o un estado real** no se contesta acá: el harness (correr), `bin/pg` (la base, Loki) y, en prod, el
  tracer del repo compartido.

## Los rieles (el `response_type` de la entidad)

| rt | riel | quién decide | después de elegir |
|---|---|---|---|
| 2 | CreditopX | CreditOp, con categorías y tramos | recheck → identidad → [Ábaco, codeudor] → plan (6/15/28) → firma → 11 |
| 4 | originación delegada | la entidad, por el servicio de preaprobación | recheck → identidad → formulario de la entidad → plan con su ficha → firma → [radicación] → 11 |
| 1 | agregador | la API de la entidad | radica → la entidad contesta después |
| 0 | redirect | la entidad, en su sitio | se redirige |

El rt=3 (rotativo) se dobla a rt=2. **El riel 4 se separó el 2026-11-25** (antes se doblaba a CreditopX) y es UNA
sola «delegada»: no se distingue Finandina de Credifamilia. Dos nodos lo explican:

- **Servicio de preaprobación** (`PreApprovalNode.vue`, `preApprovalResponseOf` en `src/store.js`), también para el
  rt=1: dictás lo que contesta pre-approvals-service —aprueba, rechaza o no contesta, el monto máximo y la tasa— y el
  listado y el resto del flujo reaccionan.
- **Ficha de originación delegada** (`DelegatedProfileNode.vue`, `delegatedOf`): `delegated_origination_profiles`
  —días de pago, fianza (% y anticipada o mensual) y si radica al autorizar—.

La cuota del riel 4 es aproximada (sin 4×1000 ni intereses de los días hasta la primera cuota).

## Lo que conviene saber antes de tocarlo

- **`npm run build` es la vara**: no hay pruebas de la UI. Mirá cómo se ve con `make ui-shot URL=http://localhost:5252/` (con `make flow` arriba) o en la app.
- Los nombres en español que traía al entrar a my-tools son deuda congelada de `make tablero-naming`; lo nuevo, en
  inglés.
- **El tema y la base son los compartidos** (`theme.css`, `workbench.css` y `workbench.js`, copiados por `make style-sync`;
  `make style-check` lo vigila): el lienzo es el `editor`, el detalle de un campo el `auxiliarybar`, y hay un pie.
  **El tema no se elige en Flow**: lo hereda de Cockpit (claro/oscuro y paleta). `styles.css` arranca con el puente:
  lo neutro apunta a los tokens del tema y lo propio (el color de cada riel y sus tintes, mezclados con la tarjeta)
  queda acá. ⚠ La base también define `.field` (en columna): el de Flow va en fila a propósito.
- `docs/` es histórico, de cuando vivía en `temp/` (cita `playground`, el trazador y `make flow-context`, que ya
  no existen acá).
