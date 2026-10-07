---
id: 99
title: "Auto ecommerce: la tienda manda los datos del comprador y firma el pedido, y el cliente llega pre-perfilado"
stage: work
created: "2026-10-05T12:00:00-05:00"
knowledge: [ecommerce-context, lender-listing]
canon: []
jira: []
jira_title: "Ecommerce: la tienda puede enviar los datos del comprador y firmar el pedido para que llegue a las entidades sin repetir pasos"
ramas: feat/auto-onboarding, feat/auto-onboarding-risk-check, feat/auto-onboarding-personal-info-fallback, feat/auto-onboarding-birth-date, feat/auto-onboarding-merchant-signature
---

## Pendientes

- [ ] **Crear el issue en Jira** con `jira_title` y la publicable, en el sprint activo. Termina cuando `jira:` tiene la
      clave y el lint deja de avisar «tarea local». Depende de: Miguel — que lo apruebe.
- [ ] **Abrir los dos PRs a `qa`** de la firma: legacy-backend `feat/auto-onboarding-merchant-signature` (`df16c70b`) y
      frontend-monorepo, misma rama (`9410ac4d`). Termina con los dos PRs abiertos. Depende de: Miguel — que lo pida.
- [ ] **Entregar a Refurbi el contrato** ([Pedido firmado por la tienda](https://claude.ai/artifact/CGuFPWWV4euyUpwAKwybwu))
      y, por canal privado, el secreto de su credencial (`php artisan ecommerce:signing-secret c390eed9` en el ambiente
      donde pruebe). Termina cuando Refurbi firma un pedido en `qa` y entra sin código. Depende de: Refurbi.
- [ ] **Preguntarle a legal si la aceptación tomada por la tienda vale como autorización de consulta a centrales**
      (habeas data: previa, expresa y verificable). El contrato le hace declarar a la tienda que la tomó; falta el sí de
      legal antes de producción. Depende de: legal.
- [ ] **Correr el canal asesor contra la rama** (no regresión). Termina con `walk-wizard FLOW=merchant` cerrando en 11.
      Depende de: Miguel — renovar la sesión del asesor de prueba de Pullman (`c036610aa-fake@`), vencida el 2026-10-07.

## Objetivo

Que una compra de tienda llegue al listado con menos pantallas. La tienda manda en el pedido la fecha de expedición
(y la de nacimiento); si además ya validó el celular con su propio código y tomó la aceptación de términos, **firma el
pedido** y el comprador no escribe un segundo código: pasa directo a `validando` (cascada AgilData → Mareigua →
TusDatos) y a las entidades.

## Dónde se toca

**legacy-backend**
- `MerchantOrderSignatureService`: la cadena canónica y la verificación (secreto, coincidencia, `phone_verified`,
  términos, vigencia 15 min con 2 de tolerancia).
- `EcommerceRequestService::createEcommerceRequestOrchestrator`: verifica la firma al crear el pedido, devuelve
  `merchantVerified` y un `verificationToken` de un solo uso (se guarda sólo su sha256); un pedido firmado no se pisa
  con uno sin firma, y uno que ya tiene solicitud no se vuelve a firmar.
- `OnboardingController::startMerchantVerifiedSession` (`POST loan-application/merchant-verified/{hash}`): canjea el
  token y corre la validación del OTP de siempre con el teléfono DEL PEDIDO GUARDADO, sin chequear el código. ONB060
  (403) si no corresponde.
- `allied_ecommerce_credentials.signing_secret` (cifrado) y `ecommerce_requests.merchant_verified_at`,
  `merchant_verification`, `verification_token_hash`. Comando `ecommerce:signing-secret {hash} {--rotate}`.

**frontend-monorepo**
- `routes/ecommerce/checkout.tsx`: con `merchantVerified`, guarda el token en la sesión del servidor (cookie firmada,
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
- **Mandar el token del pedido firmado en la URL de `inicio`**: queda en el historial y en logs; va en la sesión.
- **Correr las centrales ANTES del OTP con la aceptación de la tienda**: espera el sí de legal (pendiente).

## Lo que NO entra

- Corbeta (QR) y el canal asesor: no cambian.
- El remapeo de nombres de `config`: los campos firmados van con su nombre estándar en `billing`.

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
- El pedido de la tienda puede traer la fecha de expedición y la de nacimiento del comprador.
- Si la tienda ya verificó el celular y la aceptación de términos, firma el pedido y el comprador no recibe un segundo código.
- Si la firma no llega o no es válida, el comprador sigue el recorrido de hoy, con código.

## Alcance
- No cambia Corbeta ni el canal del asesor.

## Dónde probar
QA, con la tienda de Refurbi.

## Cómo validar
- Pedido firmado: el comprador pasa directo a la validación de datos y a las entidades, sin pantalla de código.
- Pedido sin firma, con firma de otro secreto, con el celular cambiado o firmado hace más de 15 minutos: aparece la pantalla del código.

## Criterios de aceptación
- Un pedido firmado entra una sola vez sin código.
- Un pedido alterado nunca entra sin código.

## Dependencias / contraparte
- Refurbi implementa la firma con el contrato entregado.
- Legal confirma que la aceptación tomada por la tienda vale como autorización de consulta.
