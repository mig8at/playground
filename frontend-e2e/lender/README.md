# `lender/` — eje LENDER (el cierre) por UI

Espejo de `backend-e2e/lender/`: aquí van las estrategias de **cierre** por la UI del wizard
(seleccionar el lender en el marketplace → completar el cierre según `response_type`).

**Estado:** vacío por ahora. El cierre por UI está pendiente de un bloqueador concreto: las pantallas
de cierre (`sign-documents.tsx`, `otp-validation.tsx`, las cards del marketplace) **no tienen `data-testid`**
(el stash de testids del frontend-monorepo solo llega hasta `initial-fee`). Para habilitarlo:

1. Extender el stash de `data-testid` a esas pantallas.
2. Agregar aquí `close.ts` con `selectLenderAndClose(page, lender)`:
   - sembrar+forzar el lender (como `backend-e2e` `mocks.SeedApprovedProfile` + `SetStatusAndLender`, vía docker exec),
   - seleccionar la entidad en el marketplace,
   - rt=2 Creditop X: first-payment-date → sign-documents (pagaré, PdfMapper fake en stash) → OTP firma → authorize → `loan-approved`.

El cierre ya está validado a nivel backend en `backend-e2e` (`go run . asesor 3e67eade 77` → Estado 11);
falta llevarlo a la UI. Ver `../VALIDATION.md` (Modelo composable) y `../docs/MAPA-FLUJOS.md` (D).
