# Ronda 2026-10-20 · listado, backoffice, formularios, datos, arrendamiento, actores

Comparado contra `origin/main` de cada repo (legacy-backend `406bf8a2`, legacy-application `0c86754d`,
frontend-monorepo `3492b905`) y contra la prosa de un `make canon-export` de hoy (revisión del corpus
`f201706ef5f8…`), no contra `tablero/canon`, que es del 2026-10-01. El hash nuevo de cada línea coincide
con el blob de `origin/main`.

37 líneas de la ronda, 31 archivos distintos (varios se repiten porque los declaran varias áreas).
Archivos borrados: 1. Piezas: 12 (6 `verificado`, 2 correcciones, 4 agregados).

## Piezas

| pieza | qué hace |
|---|---|
| `listado-verificado.json` | sube el hash de los 11 archivos de listado |
| `listado-politica-dura.json` (+ `.md`) | **corrección** de «La probabilidad clasifica; no significa que se pasó la política dura»: el rotativo (tipo 3) ahora SALE del listado nuevo si falla la política dura, salvo cupo rotativo aprobado; el histórico sigue sacando sólo tipo 2 |
| `listado-otra-solicitud.json` (+ `.md`) | **agregado**: elegir otra entidad origina otra solicitud, y esa rama pasa por la puerta de originación (403 `ALLIED_DISABLED`) |
| `backoffice-verificado.json` | sube el hash de 7 archivos de backoffice |
| `backoffice-rotativo.json` (+ `.md`) | **agregado**: el editor de reglas edita la política dura del rotativo (sin perfiles, nunca vacía), confirmarla destraba la pantalla de condiciones del rotativo |
| `formularios-verificado.json` | sube el hash de 4 archivos de formularios |
| `datos-verificado.json` | sube el hash de 8 archivos de datos |
| `datos-cancelacion.json` (+ `.md`) | **corrección** de «Qué cancela una solicitud y dónde queda el motivo»: la guarda también se niega con cuota inicial pagada (403 `INITIAL_FEE_PAID`), y eso alcanza a la cascada por desembolso |
| `datos-prueba.json` (+ `.md`) | **agregado**: la exclusión de lo de prueba en estadísticas por heurística y por la marca `is_test` |
| `datos-ficha-admin.json` (+ `.md`) | **agregado**: el admin viejo no deja editar a mano una ficha en blanco |
| `arrendamiento-verificado.json` | sube el hash de 1 archivo |
| `actores-verificado.json` | sube el hash de 1 archivo |

## Veredicto por línea

### actores
| archivo | veredicto | motivo |
|---|---|---|
| legacy-application `app/Http/Controllers/Admin/AlliedController.php` | verificado | suma el NIT al alta/edición y sólo muestra la clave del asesor de prueba a quien puede administrarlo (`AlliedController.php:140`); la jerarquía de tres niveles no cambia |

### arrendamiento
| archivo | veredicto | motivo |
|---|---|---|
| frontend-monorepo `apps/.../lenders-marketplace/available-lenders.tsx` | verificado | sólo agrega la rama de error `AlliedDisabledError` (`available-lenders.tsx:951`); el recorrido del titular no cambia |

### backoffice
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `Modules/Backoffice/App/Services/LenderRulesService.php` | verificado + agregado | abre los rotativos sólo con política (`LenderRulesService.php:201`); las secciones existentes siguen ciertas, lo nuevo va en `backoffice-rotativo` |
| legacy-backend `Modules/Backoffice/App/Services/LenderRulesWriterService.php` | verificado + agregado | rotativo: sin perfiles, política nunca vacía (`:91`), confirmación sin cambios (`:109`) |
| legacy-backend `Modules/Backoffice/App/Support/LenderRulesMap.php` | verificado + agregado | `POLICY_RESPONSE_TYPES = [2, 3]` (`LenderRulesMap.php:42`); el catálogo de seis reglas no cambia |
| frontend-monorepo `modules/backoffice/lender-rules/src/components/DiffDialog.tsx` | verificado | pasa al diálogo compartido `ReviewChangesDialog` (`DiffDialog.tsx:3`); mismo diff previo |
| frontend-monorepo `modules/backoffice/lender-rules/src/components/LenderRulesView.tsx` | verificado | pestañas según `rulesScreenFor` (`LenderRulesView.tsx:103`) y aviso de confirmación; la regla está en el agregado |
| frontend-monorepo `modules/backoffice/lender-rules/src/components/activity/ActivityTab.tsx` | **canon-patch** | borrado: se movió a `modules/backoffice/shared/src/components/audit/ActivityTab.tsx` (`@creditop/backoffice-shared`). Reapuntar el área «el diff previo, el aviso de condiciones especiales y la actividad del editor» del `backoffice/map.json` |
| legacy-backend `Modules/Backoffice/routes/backoffice.php` | verificado + agregado | suma las rutas `/revolving` (`backoffice.php:174`); las dos autenticaciones no cambian |
| frontend-monorepo `modules/backoffice/merchants/src/components/MerchantsListView.tsx` | verificado | refactor del subtítulo (`MerchantsListView.tsx:108`); mismo orden y conteo de incompletos |

### datos
| archivo | veredicto | motivo |
|---|---|---|
| legacy-application `app/Models/User.php` | verificado + agregado ×2 | `isTemporal()` (`User.php:405`) y `testUsersQuery`; «un estado dice dónde está» sigue cierto. Agregados `datos-ficha-admin` y `datos-prueba` |
| legacy-application `app/Models/UserRequest.php` | verificado + agregado | `withoutFilteredUsers` suma `is_test = false` (`UserRequest.php:126`); va en `datos-prueba` |
| legacy-backend `Modules/LegalV1/App/Services/GetUserTermsAndConditionsDetailService.php` | verificado | refactor: lecturas directas y `LogicException` ante códigos sin mapear (`:314`); el repositorio sigue buscando variantes del celular, sigue sin rechazar marcadores temporales, descarta aceptaciones sin catálogo y separa LGV12003 de LGV12001 |
| legacy-backend `Modules/Loans/App/Services/UserProfilingService.php` | verificado + agregado | filtra `user_requests.is_test` (`UserProfilingService.php:158`); sigue excluyendo `TEMPORAL USER` por nombre completo exacto |
| legacy-backend `Modules/UsersV1/App/Services/CreateTemporalUserService.php` | verificado | sólo reformatea y cambia el mapa de códigos (`:131`); misma alta móvil |
| legacy-backend `Modules/Loans/App/Repositories/UserRequestRepository.php` | verificado + corrección | `safeCancel` se niega con cuota inicial aprobada (`UserRequestRepository.php:320`) |
| legacy-backend `Modules/Loans/App/Services/CancelRequestService.php` | verificado + corrección | lanza `InitialFeePaidCancellationException` (403, `INITIAL_FEE_PAID`) (`CancelRequestService.php:48`) |
| legacy-backend `Modules/Loans/App/Services/LoanAuthorizationService.php` | verificado | suma `registerIfCollectedInStore` al autorizar (`LoanAuthorizationService.php:215`); la cascada por desembolso no cambia. El registro de cuota inicial cobrada en tienda es de otro tema (ver «Para el coordinador») |

### formularios
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `Modules/Onboarding/App/Http/Controllers/OnboardingController.php` | verificado | suma el auto-onboarding sin OTP (`OnboardingController.php:962`), la puerta de originación (ONB041) y `risk_centrals` en la respuesta; autocompletado, límite de envíos y banderas no cambian |
| legacy-backend `Modules/Onboarding/App/Services/OnboardingService.php` | verificado | suma `riskCentralsCheck` (`OnboardingService.php:1422`), sólo lectura del resumen guardado |
| frontend-monorepo `apps/.../loan-application-form/employment-info.tsx` | verificado | lee `auto_check` del auto-onboarding (`employment-info.tsx:57`) |
| frontend-monorepo `apps/.../loan-application-form/loan-request-form.tsx` (2 líneas) | verificado | prellena fecha de nacimiento y de expedición del pedido (`loan-request-form.tsx:454`) y muestra el motivo del auto-onboarding; las dos banderas no cambian |
| legacy-backend `Modules/Onboarding/App/Services/OnboardingService.php` (2.ª línea) | verificado | misma pieza |

### listado
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `Modules/Onboarding/App/Services/lenders/LenderValidationService.php` (3 líneas: áreas 0, 15, 16) | **corrección** + verificado | `dropsWhenRulesFail` (`LenderValidationService.php:35`, uso en `:433`): el rotativo sale si falla política dura salvo cupo aprobado. legacy-application sigue con sólo tipo 2 (`app/Services/lenders/LenderValidationService.php:376`). Las secciones de foto e historial del perfilamiento siguen ciertas |
| legacy-backend `Modules/Onboarding/routes/api.php` | verificado | suma `merchant-verified` (`api.php:47`) y un comentario en `generate-services`; las dos puertas del listado no cambian |
| frontend-monorepo `modules/.../MobileContinuationPrompt.tsx` | verificado | el QR lleva la pantalla abierta (`MobileContinuationPrompt.tsx:34`); ninguna sección de listado lo cuenta (la guarda de escritorio es de formalización) |
| legacy-application `app/Http/Requests/Admin/Allied/UpdateRequest.php` | verificado | suma la validación del NIT (`UpdateRequest.php:74`); el panel sigue validando sólo techo ≥ piso |
| frontend-monorepo `modules/.../lib/utils/index.ts` | verificado | sólo reexporta `withCurrentScreen` |
| frontend-monorepo `apps/.../available-lenders.tsx` | verificado + agregado | rama `AlliedDisabledError` (`available-lenders.tsx:951`) → `listado-otra-solicitud` |
| legacy-backend `Modules/Onboarding/App/Services/UserRequestService.php` | verificado + agregado | `rejectDisabledOrigination` en la rama que origina otra solicitud (`UserRequestService.php:320`) → `listado-otra-solicitud` |
| frontend-monorepo `modules/.../loan-options.repository.ts` | verificado | reconoce el subcódigo y lanza `AlliedDisabledError` (`loan-options.repository.ts:163`); el canal de tienda sigue sin viajar |
| legacy-backend `app/Models/EcommerceRequest.php` | verificado | suma la marca de pedido firmado (`EcommerceRequest.php:48`); el vínculo guardado sigue siendo lo que contesta el canal |
| legacy-backend `Modules/Backoffice/routes/backoffice.php` | verificado | sólo suma rutas del rotativo; la tabla de tarjetas no cambia |
| frontend-monorepo `apps/loan-request-wizard/app/routes.ts` | verificado | suma el árbol `/auto` (`routes.ts:45`) y el QR compartido; `validate-lender-otp` sigue sólo en el árbol del asesor (`routes.ts:233`) |

## Ensayo

`make canon-write DRY=1 PIECE='<las 12>'`: **pasa**, las 12 entran y el borrador se abandona.

- El primer ensayo falló por la tabla `revolving_credits` de `listado-politica-dura`; la real es `creditop_x_revolving_credits`, corregida.
- Avisos que no frenan:
  - `ya_vigilados_nota` en las 6 piezas con prosa: las secciones quedan enlazadas a las áreas que ya declaran esos archivos. Los hashes los sube el `verificado` del mismo tema.
  - `tablas_nota` en `listado-politica-dura`: sus tablas no se declaran porque la pieza no crea un área nueva. Si se quieren vigiladas, van al `tablas` del área 0 de `listado/map.json` por canon-patch.
- Los archivos nuevos (`OriginationGuard.php`, `allied-disabled.ts`, `RevolvingConditions*`, `InitialFeePaymentStatusRepository.php`, `InitialFeePaidCancellationException.php`, `TestAdvisorProvisioner.php`, las migraciones de `is_test`, los controladores y requests del admin) entran como áreas nuevas, cada una con su `objetivo`.

## Para el coordinador (fuera de mis temas)

- **Puerta de originación** (`OriginationGuard`, ONB041 / CCO008, `ALLIED_DISABLED`): también la usan el OTP (`OnboardingController`) y el canje del código de cliente. Mi agregado cubre sólo la selección; puede que comercio/sucursal/onboarding tengan que contarla en general.
- **Auto-onboarding sin OTP de ecommerce** (`merchant-verified`, pedido firmado, token de un solo uso, `risk_centrals`, árbol `/auto`): es de ecommerce/onboarding. No hice pieza.
- **Registro de cuota inicial cobrada en tienda al autorizar** (`registerIfCollectedInStore`, `LoanAuthorizationService.php:215`): de cuota/formalización.
- **El rotativo aplica su política dura también en `/available-quota`** (`RevolvingHardPolicyGate`, commit `e8c9f963`): de creditopx/cuota. Mi corrección cubre sólo el listado.
- **NIT del comercio** editable y validado en el admin, y la clave del asesor de prueba visible sólo a quien lo administra: de comercio.
