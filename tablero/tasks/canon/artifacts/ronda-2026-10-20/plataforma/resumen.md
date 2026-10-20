# Ronda 2026-10-20 · plataforma

Temas: arquitectura, infraestructura, repos, observabilidad, local, fronteras, ambientes, servicios,
mobile e internacionalizacion. **41 líneas de la ronda** (32 archivos distintos). Comparé cada una contra
la prosa del corpus exportado hoy (`make canon-export`, revisión `f201706ef5f8…`), no contra la copia de
`tablero/canon`.

Contra `origin/main` de: legacy-backend `406bf8a2` · legacy-application `0c86754d` ·
frontend-monorepo `3492b905` · infrastructure `ab18af4` · merchant-api `0b860ad`. Los 31 archivos que
siguen existiendo tienen en main exactamente el hash nuevo de la ronda.

**Resultado por línea: 31 verificado (2 de ellas también alimentan el agregado) · 9 corrección ·
1 canon-patch · 0 sin decidir.** Piezas: 9 correcciones (8 de la ronda y 1 arrastrada), 1 agregado y
10 `verificado`. Las 41 líneas cuentan 10 temas. Hay dos repetidas (`.env.example` en local y el ECS de development en infraestructura)
porque las declaran dos áreas: cada una lleva su veredicto.

## Piezas

| pieza | tipo | node · sección |
|---|---|---|
| `infraestructura-rds-desarrollo` | corrección | infraestructura/operar · Si un servicio de desarrollo no llega a la base… |
| `infraestructura-despliegue-revierte` | agregado | infraestructura/operar · Un despliegue de ECS que no arranca vuelve solo a la versión anterior |
| `local-levantar-backend` | corrección | local/operar · Levantar el backend: make up, y make setup solo la primera vez |
| `local-lo-que-borra-la-base` | corrección | local/operar · Lo que borra la base: make test y make fresh no se corren |
| `local-antes-de-correr-una-carpeta` | corrección (arrastrada) | local/operar · Antes de correr una carpeta… |
| `observabilidad-codigo-de-respuesta` | corrección | observabilidad/operar · Un código de respuesta del sistema nuevo… |
| `observabilidad-prefijos` | corrección | observabilidad/operar · Los prefijos de módulo en uso hoy |
| `repos-registros-por-modulo` | corrección | repos/operar · Cada módulo del sistema nuevo lleva escrito lo que está mal a propósito |
| `repos-api-de-comercios` | corrección | repos/operar · La API de comercios lee la base heredada y orquesta el codeudor |
| `<tema>-verificado` ×10 | verificado | sube el hash de los archivos releídos de cada tema (ambientes, arquitectura, fronteras, infraestructura, internacionalizacion, local, mobile, observabilidad, repos, servicios) |

Orden de envío: primero las correcciones y el agregado, después los `verificado`. El `verificado` de un
tema con corrección firma el área ya con la prosa nueva.

«Antes de correr una carpeta» no está en la ronda: la arrastra la corrección de «Lo que borra la base».
Decía que sobre main el patrón marca siete archivos, y hoy marca más. La reescribí sin el número.

## Veredicto por línea

### ambientes (3)
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `Modules/Identity/App/Services/AgildataService.php` | verificado | El cambio sólo agrega la adopción «completada» y una fila de auditoría. La comparación exacta de nombre sigue sin atajo por entorno (`AgildataService.php:454`) |
| legacy-backend `Modules/Onboarding/App/Services/OnboardingService.php` | verificado | Agrega `riskCentralsCheck` (`:1422`). La consulta de preaprobados sigue atada a `environment('local','development')` (`:681`) |
| legacy-backend `Modules/OnboardingV2/App/Services/StorePersonalInfoService.php` | verificado | Sólo cambia un comentario. El salto de teléfonos QA sigue exigiendo `local`/`development` (`StorePersonalInfoService.php:926`) |

### arquitectura (7)
| archivo | veredicto | motivo |
|---|---|---|
| legacy-application `app/Console/Kernel.php` | verificado | Suma `app:reconcile-payment-unlocks` cada 10 min (`Kernel.php:65`). Sigue cierto que hay tareas programadas en los dos sistemas y que el nuevo bloquea y desbloquea equipos |
| legacy-backend `Modules/Loans/App/Http/Controllers/Customer/ValidateOtpPromissoryNoteController.php` | verificado | Agrega el cambio de celular en la pantalla del código de firma. El aviso de respaldo al cierre sigue ahí (`:486`), igual que el observador con su marca para no avisar (`app/Observers/UserRequestObserver.php:54`) |
| legacy-backend `Modules/Onboarding/App/Services/EcommerceRequestService.php` | verificado | Agrega la firma del comercio y el auto-onboarding. Nada de eso toca el aviso a la tienda que cuenta la sección |
| legacy-backend `Modules/Loans/App/Services/WompiWebhookService.php` | verificado | Mueve el asiento de la cuota inicial a `RecordOnlineInitialFeeService` (`:338`). El nuevo sigue recibiendo sólo avisos de la pasarela y del proveedor de ingresos informales |
| legacy-backend `Modules/Loans/routes/api.php` | verificado | Rutas nuevas de cambio de celular y del QR de continuación. No entra ningún aviso de entidad nuevo |
| legacy-backend `Modules/Onboarding/routes/api.php` | verificado | Ruta `merchant-verified` (`:47`) y un comentario sobre `generate-services`. No entra ningún aviso de entidad nuevo |
| legacy-application `app/Http/Controllers/Admin/UserController.php` | verificado | Excluye usuarios de prueba y no deja editar un temporal. El enlace de continuación sigue saliendo de `NewFrontendUrlService::isEnabledFor` (`UserController.php:423`) |

### fronteras (4)
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `NEW_ARCHITECTURE.md` | verificado | Suma SigningV1, que es sólo servicios y no abre ninguna puerta HTTP. Las reglas del sobre y de las credenciales no cambian |
| frontend-monorepo `apps/loan-request-wizard/app/routes.ts` | verificado | Agrega el árbol `/auto` (páginas) y `continue-qr.svg` anidada. Arriba siguen las cuatro rutas de reenvío (`routes.ts:454`) |
| legacy-backend `Modules/Loans/App/Services/PaymentIntentService.php` | verificado | Rechaza una cuota inicial ≥ total (`:450`). El reenvío de pagos y su token apagado por defecto no cambian (`config/services.php:352`) |
| legacy-backend `Modules/Loans/routes/api.php` | verificado | Las rutas nuevas están bajo `requests`, no bajo el grupo `payments` (`api.php:175`) que reenvía el asistente |

### infraestructura (8)
| archivo | veredicto | motivo |
|---|---|---|
| infrastructure `environments/development/rds-microservices/terragrunt.hcl` | corrección | `microservices-development` ya admite `172.32.0.0/16` y tiene autenticación IAM (`terragrunt.hcl:27`). La sección decía «sólo desde ese rango» |
| infrastructure `modules/rds/main.tf` | corrección | Soporta autenticación IAM, exportación de logs y option group (`main.tf:105`). Entra en la misma reescritura |
| infrastructure `modules/vpc/routes.tf` | corrección | La ruta del peering ahora también va a la tabla de las subredes de base (`routes.tf:83`). Sin ella, la conexión entre cuentas quedaba en timeout |
| infrastructure `environments/development/ecs-application/terragrunt.hcl` (área tmpfs) | verificado | Suma access-service, cerbos y loan-servicing. `readonly_root_filesystem` y los `tmpfs` del principal siguen como dice la sección (`:348`) |
| infrastructure `environments/development/ecs-application/terragrunt.hcl` (área sólo-lectura) | verificado | Los servicios con sistema de archivos de sólo lectura siguen siendo los cinco de `legacy-application` |
| infrastructure `environments/prod/ecs-application/terragrunt.hcl` | verificado + agregado | Suma autoescalado y retención de logs a 14 días. El sólo-lectura sigue en web, workers y scheduler (`:344`). El agregado cuenta el autoescalado |
| infrastructure `modules/ecs-application/variables.tf` | verificado + agregado | `readonly_root_filesystem` sigue en falso por defecto. Suma `deployment_circuit_breaker` con vuelta atrás (`variables.tf:386`, aplicado en `service.tf:157`): va en el agregado |
| infrastructure `environments/prod/internal-tools/terragrunt.hcl` | verificado | Sólo suma `rds-db:connect` (IAM) a canon, cuadrilla, tracer y forecast. Imagen, puerto, familia `canon-production` (`:371`) y OIDC siguen iguales |

### internacionalizacion (1)
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `Modules/Onboarding/App/Services/OnboardingService.php` | verificado | `riskCentralsCheck` lee el resumen ya guardado y no consulta ninguna central (`:1422`). La compuerta por país no cambia |

### local (4)
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `.env.example` (área levantar/drivers) | verificado | Sólo suma `NETCO_PASSWORD_DERIVATION_BYTES` (`.env.example:120`) |
| legacy-backend `.env.example` (área soporte) | verificado | `SUPPORT_BOT_TOKEN` y su comentario de cierre en 503 siguen (`.env.example:227`) |
| legacy-backend `docker-compose.yml` | corrección | Nuevo servicio `localstack` que emula S3 (`docker-compose.yml:82`, más `docker/localstack/init-s3.sh`). `.env.example` no apunta `AWS_ENDPOINT`/`AWS_URL` a él |
| legacy-backend `Modules/Backoffice/tests/Feature/LenderRulesWriterServiceTest.php` | corrección | El archivo sigue usando el trait (`:29`). En main ahora son 7 archivos activos y no 3: entran `RevolvingConditionsWriterServiceTest`, `RevolvingSimulationServiceTest`, `Partner/BranchRuleCopyTest` y `tests/Feature/Commands/SyncDeviceLocksCommandTest` |

### mobile (1)
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `Modules/MobileOnboardingV1/App/Services/ConfirmSignUpService.php` | verificado | Sólo borra dos líneas en blanco. Se sigue quitando el identificador a otra persona (`:306`) |

### observabilidad (5)
| archivo | veredicto | motivo |
|---|---|---|
| frontend-monorepo `…/loan-application-form/otp-verification.tsx` | verificado | Agrega el manejo de `ALLIED_DISABLED` (`:527`). La identidad por teléfono y el alias por número de solicitud siguen (`:38`) |
| legacy-backend `Modules/Onboarding/App/Http/Controllers/OnboardingController.php` | verificado | Suma `ONB060` y `ONB041`. `ONB040` sigue siendo el genérico de «falla de quien llama» |
| legacy-backend `Modules/Onboarding/App/Services/OnboardingService.php` | verificado | El tope por documento sigue leyendo primero la clave con la «e» de más (`:1593`) |
| legacy-backend `Modules/OnboardingV2/App/Services/ValidateOtpAuthService.php` | verificado | Suma `OBV22012` (403, comercio o sucursal deshabilitados, `:117`). No toca el bloqueo por ráfaga |
| legacy-backend `NEW_ARCHITECTURE.md` | corrección ×2 | Falta el prefijo `SGV1` (`NEW_ARCHITECTURE.md:412`). Además el código ya emite `URV32…` (`CreateUserRequestService.php:79`) y `USV29…` (`UpdateUserDataService.php:58`), y la sección decía que llegaban a URV31 y USV25 |

### repos (7)
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `NEW_ARCHITECTURE.md` | corrección | Ahora son 17 módulos: los 17 llevan `TECHNICAL_DEBT.md` y 14 llevan `ARCHITECTURE_EXCEPTIONS.md`. Siguen 3 ítems sin marcador (los dos de legal y uno de pedidos de tienda): SigningV1 marca los suyos |
| merchant-api `internal/modules/merchant/infra/storage/mysql/queries/merchant.sql` | corrección | El catálogo admite entidades de tipo 2 y 3 (`merchant.sql:29`) |
| merchant-api `internal/modules/merchant/infra/storage/mysql/queries/user_request.sql` | **canon-patch** | Borrado en `8792817` («return catalog without user request restrictions»). Ver abajo |
| merchant-api `README.md` | corrección | El catálogo de CreditopX es el mismo para todos los clientes (`README.md:159`), y ya no se lee ninguna solicitud. La sección decía que se leían |
| legacy-backend `Modules/Onboarding/routes/api.php` | verificado | `/api/onboarding` sigue registrado. Sólo suma la ruta `merchant-verified` |
| legacy-backend `Modules/RiskV2/routes/api.php` | verificado | Se retiró `fetch/experian-open-customer-info` y se agregó `overwriteFreshnessDays`. El prefijo `/api/v2/risk` y las lecturas que usa el perfilamiento siguen (`api.php:18`) |
| legacy-backend `Modules/UsersV1/App/Services/GetUserService.php` | verificado | Un código no mapeado ahora lanza `LogicException` (`:54`). El nombre separado y el contrato con el perfilamiento no cambian |

### servicios (1)
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend `Modules/LegalV1/App/Services/SignAndSendTermsAndConditionsService.php` | verificado | Reordena el código y hace que un código no mapeado lance. La firma de términos sigue generando el PDF como efecto (`:153`) |

## Para un canon-patch (no hice pieza)

- **repos · área `area-894dd71497a2`** («Leer el catálogo de comercios e industrias y las solicitudes…»):
  retirar `merchant-api:internal/modules/merchant/infra/storage/mysql/queries/user_request.sql` (borrado
  en main) y sacar `user_requests` de sus `tablas`. Su `objetivo` y su `se_deduce_leyendo` todavía dicen
  «y las solicitudes»: hay que reescribirlos. La prosa ya va corregida en `repos-api-de-comercios`.

## Lo que vi y no es de mis temas (para las otras sesiones)

- **imei / cartera:** los dos monolitos tienen ahora una reconciliación de desbloqueo por pago cada 10 min.
  En legacy-application es `app:reconcile-payment-unlocks` (`Kernel.php:65`), la red de seguridad para los
  pagos que aplica legacy-backend. En legacy-backend es `device-locking:reconcile-payment-unlocks`
  (`Modules/DeviceLockingV1/App/Providers/DeviceLockingV1ScheduleServiceProvider.php:36`).
- **onboarding / comercio:** un comercio o una sucursal deshabilitados ya no originan desde el paso del
  código: v1 responde `ONB041` (403) y v2 `OBV22012` (403), los dos con subcódigo `ALLIED_DISABLED`. Corta
  antes de crear o reutilizar la solicitud.
- **ecommerce:** auto-onboarding sin OTP con el pedido firmado por el comercio: `merchant-verified`,
  `ONB060`, setting `auto_onboarding_allied_branches` y el árbol `/auto` del asistente.
- **formalización / firma:** el cliente del auto-onboarding puede corregir una vez su celular en la
  pantalla del código de firma (`phone-change`, `change-phone`).
- **salud-financiera:** RiskV2 retiró la ruta `fetch/experian-open-customer-info`, pero el README de
  `financial-health-service` todavía la nombra.
- **ambientes:** un comentario de código (`AgildataService.php:454`) dice que «staging corre como
  `development`». Canon dice, por los workflows, que la imagen lleva `APP_ENV=develop`. No lo cambié: no
  es un archivo que la sección cite para eso.

## Ensayo

`make canon-write DRY=1 PIECE='<las 19 piezas>'` (correcciones y agregado primero, `verificado` después):
**19/19 ✓, ningún rechazo del lint, exit 0**. «(ensayo: el borrador se abandonó, no se escribió nada)».

- Las 9 correcciones reemplazan su sección y el agregado entra al final de infraestructura/operar.
- Cada pieza con prosa avisa `ya_vigilados_nota`: los archivos que ya declaraba un área quedan enlazados
  y su hash no se mueve. Ese hash lo suben los `verificado`.
- Los 10 `verificado` suben hash: ambientes 3, arquitectura 7, fronteras 4, infraestructura 7,
  internacionalizacion 1, local 3, mobile 1, observabilidad 5, repos 6, servicios 1 (38 archivos).
- En el primer ensayo «Antes de correr una carpeta» avisó que quedaba sin archivos. Le agregué
  `archivos` y en el segundo ensayo ya no avisa.

No escribí en canon, no commiteé y no toqué nada fuera de esta carpeta.
