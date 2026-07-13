# Welli (23 · 141 · 142 · 166) — un lender, cuatro variantes

> Ficha de entidad (vista transversal). Dueño: [AGREGADORES-FLUJO-ANALISIS.md](../codigo/AGREGADORES-FLUJO-ANALISIS.md) §3.

**Cuatro lenders sobre la MISMA Action** (`Welli.php`): **23 Tasa Full · 141 Tasa Cero · 142 Subvencionada ·
166 Riesgo Compartido**. Financiación de salud (el flujo incluye `changeClinic`).

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **API externa**: `POST /api/externals/risk/run_risk/` → `data.estado=='approved'` (+ `monto_aprobado>0` en el MS) |
| ¿Quién pone la plata / cobra? | Welli |
| ¿Cómo cierra? | **Handoff**: CreditOp redirige a `next_step_url` de Welli; el cierre se sigue por **polling** (`StatusCheck` job, ttl 1800s) |
| ¿Simulable E2E? | ✅ mock HTTP de `run_risk` — con los matices de exclusión de abajo |

## Lo distintivo

- **Grupo memoizado:** las 4 variantes comparten UNA consulta a la API (constante `WELLI_LENDER_IDS`, `WelliService.php:26`); el MS **colapsa 141/142 → '23'** en el cache key, pero **166 no se colapsa**.
- **Monto mínimo $180.000** quemado (`WelliService.php:36`; legacy fuerza ese piso al consultar).
- **La rareza del listado:** el path **v1** excluye `[12,23,141,142,166]` (las 4 Welli + Prami) con un `array_filter` **antes** de pre-aprobar (`LenderRetrievalService.php:248-256`) — en v1 Welli ni llega al listado. El **wizard usa v2**, que recorta esa parte: la pre-aprobación la resuelve el **front progresivamente** contra el MS (`pre-approvals-service`). Dueño del matiz: [ONBOARDING-DATOS-DECISION-ANALISIS.md](../codigo/ONBOARDING-DATOS-DECISION-ANALISIS.md) §7.1.
- **No extiende `Integration`** (la clase base de lenders) — otra Action a medida.
- Tras el `register`: `changeClinic` + `updateStatus`; estados mapeados en `STATUS_MAP` (`Welli.php:29`).

## Hardcodes que lo tocan (muestra)

`WELLI_LENDER_IDS=[23,141,142]` duplicado en `WelliService.php:26` y `PreApprovedLenderService.php:229` · mínimo 180k · exclusión v1 `[12,23,141,142,166]` · inventario: [LOGICA-QUEMADA.md](../codigo/LOGICA-QUEMADA.md) §2.
