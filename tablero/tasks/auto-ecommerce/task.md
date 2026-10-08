---
id: 99
title: "Auto ecommerce: la tienda manda los datos del comprador y firma el pedido, y el cliente llega pre-perfilado"
stage: work
created: "2026-10-05T12:00:00-05:00"
knowledge: [ecommerce-context, lender-listing]
canon: []
jira: [CORE-731]
jira_title: "Ecommerce: la tienda puede enviar los datos del comprador y firmar el pedido para que llegue a las entidades sin repetir pasos"
ramas: feat/auto-onboarding, feat/auto-onboarding-risk-check, feat/auto-onboarding-personal-info-fallback, feat/auto-onboarding-birth-date, feat/auto-onboarding-merchant-signature, feat/dictado-centrales-restaurado, feat/admin-api-sin-token, feat/dictado-por-parametros, feat/experian-acierta-quanto, fix/auto-onboarding-validation-errors
---

## Pendientes

- [x] ~~Firma de la tienda con lo acordado con Refurbi~~ — HMAC del pedido (`v1=` + HMAC-SHA256) con la aceptación
      de los documentos acordados: Términos y Condiciones y Política de Tratamiento de Datos V20260206, adjuntos en
      CORE-731. La firma reemplaza el código del inicio.
- [x] ~~Abrir los PRs a `qa`~~ — [legacy-backend#1617](https://github.com/Creditop-SAS/legacy-backend/pull/1617) y
      [frontend-monorepo#1153](https://github.com/Creditop-SAS/frontend-monorepo/pull/1153) (firma y «Cambiar número»),
      y [frontend-monorepo#1161](https://github.com/Creditop-SAS/frontend-monorepo/pull/1161) (el motivo del rechazo
      automático en `personal-info`), mergeados.
- [x] ~~Crear el issue en Jira~~ — [CORE-731](https://creditop.atlassian.net/browse/CORE-731), en «CORE Sprint 19»,
      con los PDFs de términos y política adjuntos.
- [x] ~~Probar en `qa` con Refurbi~~ — pedido firmado cerrado en 11: 503385 (caminador) y 503388 (panel); correo y
      documento de otro cliente marcados en `personal-info` (503372, 503373).

## Objetivo

Que una compra de tienda llegue al listado con menos pantallas. La tienda manda en el pedido la fecha de expedición
(y la de nacimiento); si además ya validó el celular con su propio código y tomó la aceptación de términos, **firma el
pedido** y el comprador no escribe un segundo código: pasa directo a `validando` (cascada AgilData → Mareigua →
TusDatos) y a las entidades.

## Dónde se toca

**legacy-backend**
- `MerchantOrderSignatureService`: la firma es lo único que decide el salto del OTP del inicio. Esquema de los eventos
  CreditopX (`v1=` + HMAC-SHA256 de `v1\n{ts}\n{o}`, con el `o` tal como viaja). Lo que el pedido declara de la
  aceptación (`terms_accepted_at`, `terms_version`, `privacy_policy_version`, de los PDFs V20260206) se guarda como
  constancia y no decide nada.
- `CreateEcommerceRequest`: `signature` y `signatureTimestamp`, opcionales.
- `EcommerceRequestService::createEcommerceRequestOrchestrator`: con firma válida devuelve `merchantVerified` y un
  `verificationToken` de un solo uso (se guarda sólo su sha256), que el front canjea al entrar.
- `OnboardingController::startMerchantVerifiedSession` (`POST loan-application/merchant-verified/{hash}`): canjea el
  token y corre la validación del OTP de siempre con el teléfono DEL PEDIDO GUARDADO, sin chequear el código. ONB060
  (403) si no corresponde.
- `allied_ecommerce_credentials.signing_secret` (cifrado) y `ecommerce_requests.merchant_verified_at`,
  `merchant_verification`, `verification_token_hash`. Comando `ecommerce:signing-secret {hash} {--rotate}`.

**frontend-monorepo**
- `routes/ecommerce/checkout.tsx`: pasa `sig` y `ts` de la URL al backend; con `merchantVerified`, guarda el token en la sesión del servidor (cookie firmada,
  httpOnly), nunca en la URL.
- `routes/auto-onboarding/start.tsx`: si hay token lo canjea (`StartMerchantVerifiedSessionUc`) y sigue a `validando`;
  si el backend lo rechaza, sigue por el código como hoy.

## Cómo se ataca

El OTP es hoy lo único que impide usar el teléfono de otra persona: el pedido y la credencial `t` viajan en la misma
URL, así que el comprador puede editar el pedido. La firma HMAC con un secreto que no viaja en la URL es lo que
permite confiar en el teléfono del pedido. Todo lo que falla cae al recorrido con código: el peor caso es el de hoy.

## Lo que se evaluó y NO se eligió

- **Saltar el OTP sólo por estar la sucursal en `auto_onboarding_allied_branches`**: el pedido es editable por el
  comprador; sería entrar con el celular de cualquiera.
- **Vigencia de la firma, `phone_verified`, exigir los campos de aceptación, no pisar un pedido firmado y no volver a
  firmar uno con solicitud** (se probaron el 2026-10-07): se sacaron porque no salen de los PDFs y hay que socializarlos
  con Refurbi. Queda sólo que la firma decide el salto del OTP.
- **Una cadena canónica de 8 campos del pedido** (la primera versión): obligaba a la tienda a firmar el `total` con el
  mismo texto y no admitía el remapeo de `config`. Se cambió por el esquema de los eventos CreditopX, que firma el `o`
  entero (decisión de Miguel, 2026-10-07).
- **Mandar el token del pedido firmado en la URL de `inicio`**: queda en el historial y en logs; va en la sesión.
- **Correr las centrales ANTES del OTP con la aceptación de la tienda**: espera el sí de legal (pendiente).

## Lo que NO entra

- Corbeta (QR) y el canal asesor: no cambian.

## Cómo se comprueba

En local, con el front de la rama sirviendo :5174 y el backend en la rama:

```harness
cd harness && E2E_TARGET=local E2E_MERCHANT_SIGNATURE=valid MERCHANT=refurbi CASES=aprobado node dev/auto-onboarding.ts
```
Resultado: checkout → inicio → validando → lenders, sin la pantalla del código. Con `invalid` o `none`, pasa por
`/otp` y llega igual a lenders.

En el panel: canal «Auto (tienda)», Refurbi, «Firma de la tienda: Firmado: sin OTP». El secreto de Refurbi en local se
genera con `docker exec legacy-backend-laravel.test-1 php artisan ecommerce:signing-secret c390eed9`.

## Referencias

- [Pedido firmado por la tienda](https://claude.ai/artifact/CGuFPWWV4euyUpwAKwybwu): el contrato para Refurbi.
- [Diseño de la propuesta](https://claude.ai/artifact/Y8NvUGW3Bf5SFrFWhM2P4x): embudo, contrato y prototipo.
- Ya en `qa`: legacy-backend #1588 y #1594; frontend-monorepo #1134, #1139, #1140 y #1142.
- Tarea #95 (`ecommerce-pruebas-en-conjunto`) y #6 (`ecommerce-stateless`).

## Tarea (publicable)

## En una línea
La tienda puede enviar los datos del comprador y firmar el pedido para que llegue a las entidades sin repetir pasos ni escribir un segundo código.

## Por qué
Hoy el comprador repite en CreditOp datos que la tienda ya tiene y valida dos veces su celular, y la mayoría se queda en el formulario de perfil antes de ver entidades.

## Qué cambia
- El pedido de la tienda puede traer, además de los datos de siempre, la fecha de expedición y la de nacimiento del comprador; con ellos CreditOp valida sus datos sin formulario.
- Si la tienda firma el pedido (ya verificó al comprador de su lado), el comprador entra sin el código del inicio.
- Si la validación automática rechaza un dato del pedido (por ejemplo, un correo que ya es de otro cliente), el comprador lo ve marcado en el formulario y lo corrige.
- En la firma del pagaré, quien entró con un pedido firmado puede corregir su celular antes de validar el código.

## Alcance
- No cambia Corbeta ni el canal del asesor.
- Qué ve el comprador si el pedido llega sin firma o con una firma inválida queda por definir con producto; hoy se le pide el código como siempre.

## Dónde probar
QA, con la tienda de Refurbi (su sucursal ecommerce está habilitada para este recorrido).

## Cómo validar
- Pedido firmado: el comprador pasa directo a la validación de datos y a las entidades, sin pantalla de código.
- Pedido firmado con un correo que ya es de otro cliente: el formulario de datos personales muestra el correo marcado con el motivo.
- En la firma del pagaré, «Cambiar número» envía el código al número nuevo, y el cliente queda con ese número sólo después de validarlo.

## Criterios de aceptación
- Un pedido firmado entra sin código; uno sin una firma válida no.
- Ningún dato que el sistema rechace queda sin mostrarse al comprador.

## Dependencias / contraparte
- Refurbi implementa la firma con el contrato entregado.
- Producto define qué ve el comprador si el pedido llega sin firma o con una firma inválida.
- Legal confirma que la aceptación tomada por la tienda vale como autorización de consulta.
