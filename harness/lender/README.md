# `lender/` — eje LENDER (el cierre) por UI

Espejo de `backend-e2e/lender/`: aquí van las estrategias de **cierre** por la UI del wizard
(seleccionar el lender en el marketplace → completar el cierre según `response_type`).

**Estado: implementado.** Acá viven `close.ts` (`selectLenderAndClose`) y las specs `creditopx-close`,
`cierre-x` y `wompi-close`. El cierre rt=2 corre punta a punta hasta `loan-approved` / Estado 11.

> ⚠ Este README decía *"vacío por ahora, el bloqueador son los `data-testid`"*. Las dos cosas quedaron
> viejas: los archivos existen, y el muro real no eran los testids sino la **configuración del lender en
> el mirror** (ver `../docs/PLAN-PRUEBAS.md`). Se corrigió el 19-07-2026.

Detalle del estado por flujo (qué corre verde y qué está en `fixme`) en `../docs/VALIDATION.md`
(Modelo composable). El mapa de flujos vivía en `docs/MAPA-FLUJOS.md`, borrado de `main`
(`git show 159906a:docs/MAPA-FLUJOS.md`); hoy el equivalente vivo es
`../../context/docs/ROUTE-MAP.md`.
