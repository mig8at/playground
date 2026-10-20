# Ronda 2026-10-20 · ecommerce, canales, cuota, comercio, sucursal, asesor, welli, nequi, meddipay

Comparé con el corpus vigente (`make canon-export`, revisión `f201706ef5f8…`), no con `tablero/canon`. Leí cada
diff `hash_viejo → hash_nuevo` en los clones; en los 33 archivos el blob de `origin/main` es el `hash_nuevo`.
Ninguno está borrado ni renombrado, así que no hay líneas para canon-patch.
Las líneas son 53 porque el mismo archivo aparece una vez por área que lo declara. Las rutas `archivo:línea` son de `origin/main`.

## Las piezas (16)

| pieza | qué hace |
|---|---|
| `ecommerce-verificado.json` | sube el hash de los 16 archivos de ecommerce, que releí |
| `ecommerce-auto-onboarding.json` + `auto-onboarding.md` | **agregado**: el auto-onboarding de tienda, con el pedido firmado que salta el código. Crea un área con 7 archivos nuevos |
| `ecommerce-pedido-viaja.json` + `pedido-viaja.md` | **corrección**: el pedido firmado también escribe el vínculo, por la misma validación |
| `ecommerce-comprador-corrige.json` + `comprador-corrige.md` | **corrección**: el pedido trae además las fechas de expedición y de nacimiento; en el auto-onboarding el formulario sólo sale si la validación falla |
| `ecommerce-entra-directo.json` + `entra-directo.md` | **corrección**: en el auto-onboarding no hay pantalla de celular |
| `ecommerce-cuota-pasarela.json` + `cuota-pasarela.md` | **corrección**: la pasarela no cobra una cuota inicial que iguala o supera el total |
| `sucursal-app-puntos-de-venta.json` + `app-puntos-de-venta.md` | **corrección**: el mapa de la App ahora también cuenta las entidades de tipo 3; el tipo «ambos» se lee pero no se escribe |
| `sucursal-verificado.json` | sucursal, 6 archivos |
| `comercio-originacion-deshabilitado.json` + `originacion-deshabilitado.md` | **agregado**: un comercio o sucursal deshabilitados no originan en el monolito nuevo, sólo en cuatro puertas; en el viejo no hay regla |
| `comercio-verificado.json` | comercio, 6 archivos |
| `asesor-verificado.json`, `canales-verificado.json`, `cuota-verificado.json`, `welli-verificado.json`, `nequi-verificado.json`, `meddipay-verificado.json` | un verificado por tema |

Una pieza con prosa enlaza su sección y no sube hashes. Por eso cada archivo que respalda una corrección va también
en el `verificado` de su tema: lo releí y la prosa corregida es cierta.

## Veredicto por línea

### asesor
| línea | veredicto | motivo |
|---|---|---|
| asesor · legacy-backend:Modules/Loans/App/Services/OtpValidationService.php | verificado | Ahora valida contra el celular pendiente si el cliente lo corrigió en la firma (`OtpValidationService.php:72`). Sigue quitando el token del asesor antes de usar el número (`:73`) |

### canales
| línea | veredicto | motivo |
|---|---|---|
| canales · legacy-application:app/Models/User.php | verificado | El candado del canal sigue igual (`User.php:121`). Se agregaron `is_temporal` y `testUsersQuery`, que no lo tocan |
| canales · legacy-backend:Modules/Onboarding/App/Services/UserRequestService.php | verificado | Sólo agrega la puerta de originación en la rama que crea otra solicitud (`UserRequestService.php:320`). El origen tienda/mostrador/autogestión no cambia |
| canales · legacy-backend:app/Models/EcommerceRequest.php | verificado | Agrega las columnas de la verificación del comercio y `isMerchantVerified` (`EcommerceRequest.php:48`). La búsqueda del vínculo en tres lugares queda igual |

### comercio
| línea | veredicto | motivo |
|---|---|---|
| comercio · legacy-application:app/Http/Controllers/Admin/AlliedController.php (área de alta) | verificado | Agrega el NIT al alta. La clave del asesor de prueba sólo se muestra a quien puede administrarlo (`AlliedController.php:140`). El orden de configuración queda igual |
| comercio · legacy-application:app/Http/Controllers/Admin/AlliedController.php (área de baja) | verificado | `changeStatus` (`AlliedController.php:347`) no cambió: la baja sigue apagando a los asesores |
| comercio · legacy-application:app/Http/Controllers/Admin/CreditopXRequestHistoryController.php | verificado | Ahora excluye también por `user_requests.is_test` (`:221`), lo que encaja con «excluye solicitudes de prueba». El arreglo de «Dinero recaudado», sin la cuota inicial, no lo cuenta esta sección |
| comercio · legacy-application:app/Http/Controllers/Admin/UserRequestController.php | verificado | Sólo cambia la firma con que se despacha el reporte de conciliación (`:689`), que es otro reporte |
| comercio · legacy-application:app/Services/CreditopX/OriginatedRequestsQuery.php | verificado | Agrega `is_test` a la exclusión (`:73`). Los cuatro roles no cambian |
| comercio · Creditop-SAS/frontend-monorepo:apps/landing/src/lib/merchant-signup-questions.ts | verificado | Cambia la lista de sectores (`:127`), que la sección no enumera |
| comercio · legacy-backend:Modules/AlliedV1/App/Http/Requests/StoreAlliedPreRegistrationRequest.php | verificado | Es la misma lista de sectores del lado del backend (`:29`) |
| (sin línea propia: lo dispara UserRequestService.php:320) | **agregado** | La puerta de originación existe desde f759c0a4 y ningún tema la cuenta. El main-verifier la confirmó en los dos monolitos: las cuatro puertas del monolito nuevo (`OnboardingController.php:1327`, `ClientCodeRedemptionService.php:124`, `UserRequestService.php:320`, `OnboardingV2/.../ValidateOtpAuthService.php:324`), qué caminos quedan afuera y que el viejo no tiene nada equivalente |

### cuota
| línea | veredicto | motivo |
|---|---|---|
| cuota · legacy-backend:Modules/Loans/App/Services/PromissoryNoteService.php | verificado | Lo nuevo es el pagaré rotativo: plantilla `pagare-revolving` y número de contrato del cupo activo (`:551`). No toca el monto que se avisa a la tienda |
| cuota · legacy-backend:Modules/Onboarding/App/Services/EcommerceRequestService.php | verificado | Lo nuevo son la firma y el auto-onboarding. El monto del aviso no cambia |
| cuota · legacy-backend:Modules/Onboarding/App/Services/UserRequestService.php | verificado | El 422 de la cuota inicial ≥ monto sigue igual. Sólo se suma la puerta de originación |

### ecommerce
| línea | veredicto | motivo |
|---|---|---|
| ecommerce · legacy-application:app/Http/Controllers/Admin/UserController.php (área de recorrido nuevo) | verificado | Excluye usuarios de prueba (`:82`) y frena la edición de usuarios temporales. No toca la configuración del recorrido nuevo |
| ecommerce · legacy-application:app/Http/Controllers/Admin/UserController.php (área de orden) | verificado | El mismo cambio, que no toca la orden de comercio |
| ecommerce · frontend-monorepo:…/routes/ecommerce/checkout.tsx | **corrección** + verificado | Desvía las sucursales del auto-onboarding y pasa la firma (`checkout.tsx:143`). Corrijo «pedido viaja» y «entra directo al celular», y lo cuenta el agregado |
| ecommerce · frontend-monorepo:…/routes/loan-application-form/otp-verification.tsx | verificado | Agrega el manejo de ALLIED_DISABLED (`:527`). El vínculo y la orden quedan igual |
| ecommerce · frontend-monorepo:…/server/services/ecommerce-context.server.ts | verificado | Agrega dos fechas opcionales al prefill (`:31`), que cubre la corrección de «comprador corrige» |
| ecommerce · legacy-backend:…/EcommerceRequestService.php (área de orden) | **corrección** + verificado | Firma, token de un solo uso y `autoOnboarding` (`:378`, `:430`). Lo cuentan el agregado y «pedido viaja» |
| ecommerce · legacy-backend:…/UserRequestService.php (área de orden) | verificado | Sólo la puerta de originación (`:320`) |
| ecommerce · legacy-backend:app/Http/Middleware/RedirectIdValidationIfDesktop.php | verificado | El QR de escritorio ahora es un SVG que sirve el front (`:48`), armado con el mismo prefijo, así que la sección sigue cierta. Formalizacion dice «genera un QR», y también sigue cierto |
| ecommerce · frontend-monorepo:…/loan-application-form/loan-request-form.tsx | **corrección** + verificado | Prellena las dos fechas (`:425`) y muestra el motivo del rechazo del auto-onboarding. Corrijo «comprador corrige» |
| ecommerce · legacy-backend:…/EcommerceRequestService.php (área de prefill) | **corrección** + verificado | Agrega `expeditionDate`/`birthDate` (`:408`). Lo cubre la misma corrección |
| ecommerce · legacy-backend:Modules/Onboarding/routes/api.php (área de Corbeta) | verificado | Agrega la ruta `merchant-verified` (`api.php:47`, con límite de pedidos y token) y un comentario sobre generate-services. El contrato de Corbeta no cambia |
| ecommerce · legacy-backend:…/EcommerceRequestService.php (área del aviso) | verificado | El aviso no se toca |
| ecommerce · legacy-application:app/Console/Kernel.php | verificado | Agrega `reconcile-payment-unlocks` (`Kernel.php:65`). `update-ecommerce-requests` sigue comentado (`:69`), o sea que «un pedido abandonado no se cancela nunca» sigue cierto |
| ecommerce · legacy-backend:Modules/Onboarding/routes/api.php (área de cierre y reenvío) | verificado | Lo mismo de arriba. La ruta nueva exige token, así que no es una puerta sin credencial más |
| ecommerce · legacy-backend:Modules/Loans/App/Services/PaymentIntentService.php | **corrección** + verificado | Rechaza una cuota inicial ≥ total (`:450`). Corrijo «cuota la cobra la pasarela» |
| ecommerce · legacy-backend:Modules/Loans/App/Services/WompiWebhookService.php | verificado | El asiento pasa a `RecordOnlineInitialFeeService` (`:338`), igual que el respaldo por consulta. Lo que la sección dice no cambia |
| ecommerce · legacy-backend:Modules/Loans/routes/api.php | verificado | Agrega las rutas para corregir el celular en la firma (`:83`; las cuenta el agregado) y la del QR SVG |
| ecommerce · frontend-monorepo:…/available-lenders.tsx (área de monto) | verificado | Sólo el manejo de ALLIED_DISABLED (`:951`) |
| ecommerce · frontend-monorepo:…/available-lenders.tsx (área de cuota en tarjeta) | verificado | El mismo cambio |
| ecommerce · legacy-backend:app/Models/EcommerceRequest.php | verificado | Las columnas de la verificación. El total del pedido más reciente sigue igual |
| ecommerce · frontend-monorepo:…/routes/down-payment/confirm.tsx | **corrección** + verificado | El mensaje de AMOUNT_ABOVE_TOTAL (`confirm.tsx:63`), con la misma corrección |
| (sin línea propia) | **agregado** | El auto-onboarding con la firma del comercio no está en ningún tema. Releí `MerchantOrderSignatureService`, `EcommerceRequestRepository` (markMerchantVerified/consumeVerificationToken), `OnboardingController::startMerchantVerifiedSession`, `PromissoryNotePhoneChangeService` y las rutas `/auto/…` del asistente. El monolito viejo reenvía la query entera (`WoocommerceController.php:175`), así que `sig`/`ts` llegan. ⚠ La marca de tiempo no se valida contra la hora, y la prosa lo dice como debilidad |

### meddipay
| línea | veredicto | motivo |
|---|---|---|
| meddipay · legacy-backend:…/OnboardingService.php | verificado | `riskCentralsCheck` (`:1422`) sólo lee el resumen guardado y no consulta. Los pasos que consultan Meddipay no cambian |
| meddipay · frontend-monorepo:…/available-lenders.tsx | verificado | Sólo ALLIED_DISABLED |
| meddipay · legacy-backend:…/UserRequestService.php | verificado | Sólo la puerta de originación. La selección y la espera por socket no cambian |
| meddipay · legacy-backend:Modules/Onboarding/routes/api.php | verificado | Ruta `merchant-verified` y comentario. Nada de Meddipay |

### nequi
| línea | veredicto | motivo |
|---|---|---|
| nequi · legacy-backend:Modules/Onboarding/routes/api.php | verificado | Las rutas del cobro no cambian |
| nequi · legacy-backend:…/UserRequestService.php | verificado | La selección sigue devolviendo el id vigente. Sólo se suma el 403 de originación en la rama que crea otra solicitud |
| nequi · frontend-monorepo:apps/loan-request-wizard/app/routes.ts | verificado | Agrega el árbol `/auto` (`routes.ts:45`) y `continue-qr.svg`. Las rutas de Nequi siguen en los dos árboles |
| nequi · frontend-monorepo:…/available-lenders.tsx | verificado | Sólo ALLIED_DISABLED |

### sucursal
| línea | veredicto | motivo |
|---|---|---|
| sucursal · legacy-backend:Modules/Backoffice/App/Services/LenderRulesWriterService.php | verificado | Lo nuevo es para entidades rotativas: no se les escriben perfiles, la política dura necesita una regla activa y el primer guardado sin cambios la confirma (`:44`). La escritura de los dos niveles en una transacción sigue igual. **Para la sesión de backoffice**: la regla del rotativo no se cuenta acá |
| sucursal · Creditop-SAS/merchant-api:…/core/domain/storefront.go | **corrección** + verificado | Acepta el tipo `both` (`storefront.go:18`), que el backend y el panel no escriben (`StorefrontRules::TYPES`). Va en la corrección |
| sucursal · Creditop-SAS/merchant-api:…/queries/storefront.sql | **corrección** + verificado | `response_type IN (2, 3)` (`storefront.sql:60`) contradice «las de tipo 3 no alcanzan» |
| sucursal · Creditop-SAS/merchant-api:…/valkey/storefront_cache.go | verificado | Lee el payload y el TTL con un script atómico en vez de MULTI (`:19`). La regla «sin caché vigente no hay posición» se mantiene |
| sucursal · Creditop-SAS/frontend-monorepo:…/domain/contacto-publico.ts | verificado | Las regex son equivalentes (`\d` en vez de `[0-9]`, `:17`). El tipo sigue siendo físico o venta asistida |
| sucursal · Creditop-SAS/frontend-monorepo:…/components/BranchQrDialog.tsx | verificado | Sólo agrega `.catch` al dibujo y a la copia (`:34`) |

### welli
| línea | veredicto | motivo |
|---|---|---|
| welli · frontend-monorepo:…/available-lenders.tsx | verificado | Sólo ALLIED_DISABLED. La consulta única y la exención de la compuerta no cambian |
| welli · legacy-backend:…/OnboardingService.php | verificado | `riskCentralsCheck` no consulta. El payload a Welli y la exclusión de la 23 siguen igual |
| welli · legacy-backend:…/UserRequestService.php | verificado | El registro idempotente y el cambio de clínica no cambian |
| welli · legacy-backend:Modules/Onboarding/routes/api.php | verificado | No hay rutas nuevas de Welli: la de actualizar el monto sigue siendo la única |

## Lint (`make canon-write DRY=1`, las 16 piezas)

Entraron las 16 (✓) y el borrador se abandonó, así que no se escribió nada.
- verificado: asesor 1, canales 3, comercio 6, cuota 3, ecommerce 16, meddipay 4, nequi 4, sucursal 6, welli 4 archivos releídos.
- Las 5 correcciones dicen «reemplazó la sección» y la de comercio y la de auto-onboarding, «agregó la sección al final».
- El único aviso, en las correcciones, es `ya_vigilados_nota`: la sección queda enlazada al área que ya declara esos archivos. Es lo esperado. El hash lo suben los `verificado`.

## Para quien coordina
- No va nada de Shopify como plataforma 4: los cambios de mis temas no la tocan.
- Las rutas de agregado `ecommerce-auto-onboarding` crean un área nueva con 7 archivos que ningún mapa declaraba. `OnboardingController.php` quedó afuera a propósito, porque ya lo declaran onboarding, observabilidad y formularios.
- Fuera de mis temas: la sesión de backoffice tiene las reglas nuevas del rotativo (`LenderRulesWriterService.php:44-150`) y el pagaré rotativo con número de contrato (`PromissoryNoteService.php:551`) puede ser de formalizacion o cartera.
