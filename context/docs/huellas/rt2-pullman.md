# Huella medida · rt=2 in-platform · Pullman 94 × CrediPullman 77

> GENERADO por `tools/huella.py` desde la corrida **uReq 464684** (target `local`). Es EVIDENCIA de qué toca el flujo, no explicación de por qué — eso vive en los nodos.

## Tablas (28 escritas · 42 leídas)

| tabla | escrituras | ¿algún nodo la explica? |
|---|---|---|
| `users_category_log` | 60 | profiling · trazador |
| `user_requests` | 17 | actors · creditop · findings |
| `creditop_x_log` | 15 | **ninguno** |
| `risk_central_user_data` | 13 | formalization · kyc · trazador |
| `promissory_notes` | 11 | deceval · formalization |
| `user_request_records` | 9 | creditop · findings · formalization |
| `creditop_x_consents` | 8 | formalization |
| `creditop_x_user_requests_records` | 8 | findings · onboarding |
| `users` | 7 | actors · application · backoffice |
| `otps` | 7 | backoffice · findings |
| `twilio_logs` | 6 | **ninguno** |
| `otp_logs` | 6 | trazador |
| `guarantee_acceptances` | 6 | formalization |
| `user_field_values` | 5 | credifamilia · deceval · dynamic-forms |
| `model_has_roles` | 4 | db-routines · merchants |
| `user_terms_acepteds` | 4 | **ninguno** |
| `user_summaries` | 3 | kyc · legacy-backend |
| `creditop_x_requests_history` | 3 | application · creditop · findings |
| `lender_users_categories` | 3 | creditopx · entities · profiling |
| `confirmation_email_logs` | 2 | **ninguno** |
| `lender_transactions` | 2 | bancolombia · harness |
| `user_request_products` | 2 | findings · formalization · smartpay |
| `user_request_modes` | 2 | findings · motai |
| `user_request_device_infos` | 2 | **ninguno** |
| `revolving_credits` | 2 | findings · trazador |
| `logs` | 2 | actors · architecture · corbeta |
| `creditop_x_revolving_credits` | 2 | harness |
| `user_requests_by_ecommerce_request` | 2 | corbeta · ecommerce · onboarding |

**5 tabla(s) que el flujo ESCRIBE y ningún nodo nombra:** `creditop_x_log`, `twilio_logs`, `user_terms_acepteds`, `confirmation_email_logs`, `user_request_device_infos`

## Código (6 clases con span)

| clase::método | spans | archivo en `main` | nodo |
|---|---|---|---|
| `LenderUserCategoryService::getLenderUserCategory` | 15 | application/app/Services/lenders/LenderUserCategoryService.php | application · creditopx · dynamic-forms · hardcodes-entidades · legacy-backend · profiling · pullman |
| `ValidateOtpPromissoryNoteController::verifyOtp` | 1 | legacy-backend/Modules/Loans/App/Http/Controllers/Customer/ValidateOtpPromissoryNoteController.php | deceval · findings · formalization · hardcodes-entidades · smartpay |
| `LoanMessagingServiceRepository::sendSms` | 1 | legacy-backend/Modules/Loans/App/Repositories/LoanMessagingServiceRepository.php | **ninguno** |
| `ValidateOtpPromissoryNoteController::disburse` | 1 | legacy-backend/Modules/Loans/App/Http/Controllers/Customer/ValidateOtpPromissoryNoteController.php | deceval · findings · formalization · hardcodes-entidades · smartpay |
| `LoanMessagingServiceRepository::sendVoucherNotification` | 1 | legacy-backend/Modules/Loans/App/Repositories/LoanMessagingServiceRepository.php | **ninguno** |
| `PromissoryNoteController::show` | 1 | application/app/Http/Controllers/Customer/PromissoryNoteController.php | amount-tiers · deceval · formalization · hardcodes-entidades · smartpay |

## Eventos (72 líneas en 3 traces)

**info** 57· **debug** 7· **error** 6· **warning** 2

Fallas de la corrida (que igual cerró):

  · Message Sent Response
  · Messaging service connection failed
  · Notification failed
  · Voucher generation failed
  · [OtpBypassService] OTP bypass activado para teléfono
  · voucher_disbursement_notification_failed

## Qué NO ve esta huella

- **Código:** solo 6 clases emitieron span para un flujo que escribió 28 tablas. La instrumentación de OTel es rala: **una ausencia acá no prueba nada**. Para el mapa real de archivos haría falta cobertura (pcov/xdebug están instalados en el contenedor, pero exigen tocar el php.ini y reiniciar).
- **Front:** el wizard no manda logs a Loki (van a PostHog), así que todo lo que decide en pantalla es invisible acá.
- **Otros servicios:** el `trace_id` no se propaga a los micros Go.
- **Alcance:** es UNA corrida de UN par (comercio, entidad). Otro par puede tocar otras tablas — la conducta la decide el par, no la entidad (F-34).
