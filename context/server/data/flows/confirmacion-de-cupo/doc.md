# Confirmación de cupo (omite buró) · task
> **rama:** `feat/backend-changes-for-already-confirmed-pre-approbal-flow-usage` (front, commit `784585fe`) · **PR:** — · **estado:** 🧪 en la rama, sin merge a main
>
> Un selector **"Confirmación de cupo"** en el onboarding que, para un cupo YA confirmado, **salta el buró (Experian)** vía un `flow-signature` y arranca la solicitud sin consultar central de riesgo. Trabajo de FRONTEND (Miguel), contraparte de las APIs de BACKEND (Jose).

## Contextos que usa
- **onboarding** — donde vive el flujo: el registro de celular/OTP y el `amount-form` se ramifican según el flow elegido; el selector y la firma del flow ocurren acá, ANTES del listado.
- **kyc** — lo que se OMITE: Experian / central de riesgo. El punto de la task es no consultar el buró cuando el cupo ya está confirmado; el detalle de burós vive en este nodo.

## Objetivo
Para un usuario con **cupo ya confirmado** (pre-aprobado por fuera), evitar la consulta a Experian: el front pregunta si puede omitir el buró y, si sí, firma un `flow-signature` (flow clásico, `flow_id=2`) que en backend **salta Experian y recorta los lenders a rt=0**. No re-explica el buró (ver **kyc**) ni el onboarding (ver **onboarding**).

⚠ **Flujo CLÁSICO, no el dynamic** — el dynamic es de RD, gateado por `alliedCountry===60`. Esta task es sobre el clásico.

## Ramas y PRs por repo
| Repo | Rama | Estado |
|---|---|---|
| `frontend-monorepo` | `feat/backend-changes-for-already-confirmed-pre-approbal-flow-usage` | commit `784585fe` en la rama, **sin merge a main** (la rama arrastra merges de staging; el trabajo real es SOLO ese commit) |
| `legacy-backend` (Jose) | familia `feat/new-flow-signature-api` · `feat/new-omit-experian-apis` · `feat/backend-changes-for-already-confirmed-pre-approbal-flow-usage` | las 2 APIs que el front consume |

> ⚠ **Contrato de las 2 APIs: el veredicto va en el `code` del body, NO en el HTTP status** (verificado). No leas el status para decidir; leé `code`.

## Lo que se hizo (frontend, commit `784585fe`)
### Net-new — la capa de pre-approval flow (5 archivos, en la rama, NO en el índice de main)
- `loan-application-form/src/lib/application/check-able-to-omit-experian.uc.ts` — el use-case que pregunta si este cupo puede omitir el buró.
- `loan-application-form/src/lib/application/sign-flow-signature.uc.ts` — firma el `flow-signature` (marca el flujo como confirmado).
- `loan-application-form/src/lib/infrastructure/pre-approval-flow.repository.ts` + `ports/pre-approval-flow.repository.ts` + `types/pre-approval-flow.ts` — el repositorio/puerto/tipos del flujo de pre-aprobación (las 2 APIs con verdicto en `code`).
### Modificados (6, resuelven en main)
- `app/routes/loan-application-form/phone-number.tsx` + `otp-verification.tsx` — el punto donde el flujo se ramifica.
- `components/phone-number.tsx` + `amount-form.tsx` — UI del selector/monto.
- `lib/index.ts` (exporta la capa nueva) + `lib/utils/schemas/phone-number.ts`.

## Cómo probar / validar
- Es un flujo de onboarding: usar el harness del wizard (**harness** → `bin/asesor`). Necesita un usuario con **cupo ya confirmado** en backend (las APIs de Jose deben estar desplegadas en el target).
- Verdicto correcto = leer el `code` del body de las 2 APIs (no el HTTP status); con `flow_id=2` el backend salta Experian y el listado queda recortado a rt=0.

## Bitácora
- **2026-07** — implementado en el front (commit `784585fe`) + verificado (typecheck 0 errores propios / biome). Depende de las APIs de backend de Jose (flow-signature + omit-experian).
- **2026-07-18** — registrada como task del árbol de context.

## Pendientes
- [ ] Merge de la rama a main (hoy solo en la feature branch, con ruido de staging encima).
- [ ] Confirmar que las 2 APIs de backend (Jose) estén desplegadas donde se pruebe.

## Enlaces
- Memoria: `[[pre-approval-omit-experian-frontend]]`.
- Contextos: **onboarding** (el flujo) · **kyc** (el buró que omite).
