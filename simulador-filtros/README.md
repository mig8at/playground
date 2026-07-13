# Simulador de filtros — comercio × lender

> ⚠️ **Demo educativa — NO fiel a la realidad.** Reglas, umbrales (score 600/550, ingreso 1.3M…)
> y perfiles son **ilustrativos**: no reproducen la lógica real de originación (pipeline ML, unlock,
> categorías). Sirve para *entender el concepto* de filtrado comercio↔lender, no para predecir
> elegibilidad real. Las reglas reales viven en la BD (`lender_rules` / `lender_datacredito_rules`,
> inspeccionables con `backend-e2e: go run . get lender <alias>`) y el flujo real se ejerce con el
> harness [`../backend-e2e/`](../backend-e2e/).

> 📚 Contexto de negocio: docs maestros en [`../docs/`](../docs/) (empieza por
> [`../docs/CREDITOP.md`](../docs/NEGOCIO.md)). El modelo de datos / ERD vive en `../domain-model/`.

App **Vue 3 + [Vue Flow](https://vueflow.dev/)** que **simula cómo los comercios y los lenders filtran
al cliente** durante la originación: cada actor aplica sus **reglas duras** (familias regulatorio/KYC,
demográfico, capacidad de pago, riesgo/centrales, datos alternativos) y el simulador muestra, para un
perfil de cliente dado, **qué pasa cada filtro y qué entidades quedan disponibles** — multi-país (CO/PE/MX),
donde la misma regla cambia de **fuente del dato** y **umbral** según el país.

Es la cara navegable del concepto de NEGOCIO: *el marketplace = el resultado de filtrar los lenders del
comercio contra el perfil del cliente* (ver `../docs/CREDITOP.md` y `../docs/codigo/CASOS-ESPECIALES.md`).

## Qué muestra
- **Actores** (comercio vs lender) y las **familias de reglas** que cada uno aplica
  (el comercio: demográfico/capacidad/alternativo; el lender: todas, incl. regulatorio y buró).
- **Catálogo de reglas** configurable (edad, género, nacionalidad, ingreso mínimo, DTI, ocupación,
  score, mora, servicios al día…) con sliders/rangos/sets.
- **Evaluación en vivo:** ajustas el perfil del cliente y ves aprueba/no-aprueba por filtro y el
  resultado final, con el grafo de filtros en Vue Flow.
- **Multi-país:** misma regla, distinta fuente (`FactSourceBinding`) y umbral por país.

## Desarrollo
```bash
npm install
npm run dev      # http://localhost:5183
npm run build    # type-check (vue-tsc) + build a dist/
npm run preview  # sirve dist/
```
Requiere Node 18+.

## Estructura
```
src/
  views/SimuladorView.vue      # el simulador (reglas, actores, evaluación en vivo, grafo Vue Flow)
  components/RangeSlider.vue    # control de rango (edad, etc.)
  components/ValueSlider.vue    # control de valor (ingreso, score, DTI, etc.)
  router/index.ts              # ruta única "/" → SimuladorView
  App.vue · main.ts · style.css
```

> El ERD/modelo de datos y los docs de tablas (que antes vivían aquí) se movieron: el **modelo** está en
> `../domain-model/` y el resumen de tablas verificado en `../docs/codigo/MODELO-DATOS.md`.
