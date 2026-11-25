# Flow — el simulador de los rieles

`flow` es un **simulador para entender**, no producción ni un catálogo real: un grafo editable (Vue 3 + Vue Flow, sin
backend, el estado en `localStorage`) donde una solicitud camina comercio → canal → solicitud → burós → reglas →
perfilamiento → listado → lo que pasa después de elegir. Es de Miguel, para su propio entendimiento: se pone al día
de vez en cuando y **no tiene que seguir al código al pie de la letra**. Lo que muestra Flow nunca es evidencia.

- **Abrir:** la app Flow de Cockpit, o `make flow` (:5252, Vite). Sin servidor propio.
- **Por consola, para un modelo:** `python3 flow/tools/flow_context.py map --text` · `route "<pregunta>" --text` ·
  `brief <tema> --text`. Mapa → una ficha → la fuente que cita. No le pases cédulas, solicitudes ni datos de un caso.
- **Un caso o un estado real** no se contesta acá: el harness (correr), `bin/pg` (la base, Loki) y, en prod, el
  tracer del repo compartido.

## Los rieles (el `response_type` de la entidad)

| rt | riel | quién decide | después de elegir |
|---|---|---|---|
| 2 | CreditopX | CreditOp, con categorías y tramos | recheck → identidad → [Ábaco, codeudor] → plan (6/15/28) → firma → 11 |
| 4 | originación delegada | la política de la entidad: la aplica nuestro motor (Finandina) o la decide su API (Credifamilia) | recheck → identidad → formulario de la entidad → plan con su ficha → firma → [radicación] → 11 |
| 1 | agregador | la API de la entidad | radica → la entidad contesta después |
| 0 | redirect | la entidad, en su sitio | se redirige |

El rt=3 (rotativo) se dobla a rt=2. **El riel 4 se separó el 2026-11-25** (antes se doblaba a CreditopX): su ficha
(`delegatedOf` en `src/store.js`, el nodo `DelegatedProfileNode.vue`) modela `delegated_origination_profiles` —de
dónde salen los números (`source`), días de pago, fianza (% y anticipada o mensual) y si radica al autorizar—, con
dos presets: Finandina y Credifamilia. La cuota del riel 4 es aproximada (sin 4×1000 ni intereses de los días hasta
la primera cuota).

## Lo que conviene saber antes de tocarlo

- **`npm run build` es la vara**: no hay pruebas de la UI. Mirá cómo se ve con `make ui-shot URL=http://localhost:5252/` (con `make flow` arriba) o en la app.
- Los nombres en español que traía al entrar a my-tools son deuda congelada de `make tablero-naming`; lo nuevo, en
  inglés.
- Tiene su propio `styles.css` (el lienzo de Vue Flow): no usa todavía el tema compartido de `tools/ui-sync.py`.
- `docs/` es histórico, de cuando vivía en `temp/` (cita `playground`, el trazador y `make flow-context`, que ya
  no existen acá).
