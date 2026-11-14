# Negocio: cómo funciona CreditOp

CreditOp es una fintech colombiana de **originación de crédito en el punto de compra**: cuando un
cliente quiere comprar algo en un comercio aliado y no lo paga de contado, CreditOp le muestra qué
entidades le pueden financiar esa compra, lo lleva por la validación y la firma, y entrega el crédito.
Este tema es el mapa: nombra las piezas, dice cómo encajan y remite al tema que explica cada una.
Cada afirmación tiene su fuente, pero el detalle y los límites están en el tema enlazado.

El porqué de negocio que el código no dice (quién trabaja en qué, decisiones de producto, modelo
comercial, lo que más se rompe en soporte, lo que viene) está en [business-context.md](../business-context.md),
sacado de Jira y sin verificar en código salvo donde lo indica.

Para ir directo a una pregunta:

| pregunta | tema |
|---|---|
| ¿qué estados tiene una solicitud y cuáles cierran? | `user-request-lifecycle` |
| ¿quién define la política y por qué riel se origina? | `lender-response-types` |
| ¿qué entidades le salen a un cliente y por qué no sale una? | `lender-listing`, `creditopx-setup-diagnosis` |
| ¿cuánto cupo le dan y con qué perfil? | `lender-profile-rules`, `creditopx-quota`, `creditopx-offer-calculation`, `field-scoring-policy` |
| ¿cómo se valida a la persona? | `kyc-pipeline`, `kyc-path-and-experian-trigger`, `identity-name-validation`, `otp-source-and-bypass`, `returning-client-personal-info` |
| ¿cómo se firma? | `deceval-promissory-note`, `cosigner-signature` |
| ¿qué pasa con el crédito CreditopX después? | `creditopx-payment-application`, `creditopx-portfolio-servicing`, `weekly-collection-reminders`, `device-locking` |
| ¿qué hace la app del cliente? | `creditop-mobile` |
| ¿qué reglas propias tiene cada entidad (Prami, Welli, Meddipay, Sistecrédito, Bancolombia…)? | `lender-integrations` |
| ¿cómo entra una tienda online o un código? | `ecommerce-context`, `client-code-redemption`, `purchase-code-lifecycle` |
| ¿cómo se da de alta un comercio y su convenio? | `merchant-onboarding`, `merchant-lender-agreement`, `admin-panel` |

## Quién es quién

- **Cliente** (`users`): la persona que compra y pide el crédito. Se identifica por celular (OTP) y
  documento.
- **Comercio o aliado** (`allieds`): la tienda que vende. Tiene **sucursales** (`allied_branches`), y
  la sucursal es la unidad operativa: tiene su `hash` (que va en las URLs del asistente), sus
  entidades habilitadas (`lenders_by_allied_branches`), si el monto queda fijo (`lock_amount`) y sus
  credenciales de integración ecommerce. El camino de KYC no vive en la sucursal: se decide por
  comercio (el hash se resuelve a su comercio y se busca en el setting `kyc_pipeline_allieds`).
- **Asesor**: el vendedor del comercio que acompaña al cliente en el punto de venta; la solicitud
  queda a su nombre (`user_requests.corporate_user_id`).
- **Entidad** (`lenders`): quien presta. Puede ser externa (un banco, una fintech) o un producto
  propio de CreditOp, CreditopX.
- **Solicitud** (`user_requests`): un intento de financiar una compra: cliente, comercio, sucursal,
  entidad elegida, monto, plazo, cuota, cuota inicial y tasa.

## Quién presta y con qué política: los rieles

La columna que más cambia el comportamiento es `lenders.response_type`. Separa a las entidades por
**de quién es la política de crédito** y **por qué riel se origina**:

- **0 Redirección** y **1 Integrada**: la entidad decide y origina en su propio sitio o flujo;
  CreditOp refiere al cliente (y en la 1 consulta su preaprobación por API).
- **2 CreditopX consumo** y **3 CreditopX rotativo**: la política es de CreditOp, que calcula cupo
  con su motor de perfiles y origina, firma y administra la cartera.
- **4 Originación delegada**: la política es de la entidad pero CreditOp origina por sus rieles
  (identidad, firma, pagaré) y, al autorizar, radica ante la entidad (`legacy-backend`,
  `LoanAuthorizationService`).

La cobranza es otro eje (`externally_serviced`), y la periodicidad de corte (`cutoff_type_id`:
mensual, quincenal, semanal) es por entidad. Detalle: `lender-response-types`.

## Por dónde entra un cliente

El canal queda en `users.onboarding_channel` la primera vez: en los dos monolitos, el modelo `User`
restaura el valor anterior si un update intenta cambiar uno no nulo. Es una guarda del modelo, no de
la base: una escritura que no pase por ese modelo puede pisarlo. El asistente sólo envía `merchant`
(ruta `/merchant`), `ecommerce` o `self_service`; `mobile` lo pone el backend en su flujo móvil.

- **`merchant`**: el asesor abre el asistente con el hash de su sucursal y acompaña al cliente.
- **`self_service`**: el cliente entra solo, por QR o código en tienda física, o por las rutas de
  autogestión; es también el valor por defecto de cualquier flujo que no sea comercio ni ecommerce.
- **`ecommerce`**: una tienda online manda el pedido, serializado en la URL de checkout o creado antes
  con `payment-link` (el conector de VTEX usa este); el pedido se vincula a su solicitud, y ese
  vínculo puede pasar a otra solicitud si se recrea.
- **`mobile`**: el cliente se registra en CreditOp Mobile; la app le pide a self-manager-api un
  código para comprar en un comercio aliado por venta asistida o tienda física.

Detalle: `onboarding-origin`, `ecommerce-context`, `creditop-mobile`.

## El recorrido de una solicitud

En términos de negocio, una originación pasa por estas etapas (los nombres de estado son los del
catálogo `user_request_statuses`):

1. **Validación OTP** del celular y datos personales del cliente.
2. **KYC**: identidad y centrales de riesgo (Experian, TusDatos, AgilData, Mareigua, Ábaco), por la
   cascada del monolito o por el pipeline de customer-profiling-service según el comercio.
3. **Listado de entidades** («Seleccionó entidad»): sólo las habilitadas para esa sucursal que pasan
   sus reglas; CreditopX muestra cupo y oferta, las integradas su preaprobación.
4. **Formulario de perfil** y, si la entidad lo pide, codeudor, documentos, aprobación manual o cuota
   inicial.
5. **Firma**: contrato y pagaré (Deceval), con OTP.
6. **Autorizada** (11): el crédito existe y la originación terminó (el asistente no deja retomarla).
   Al autorizar una CreditopX consumo (riel 2), `legacy-backend` cancela (8) las otras solicitudes
   de riel 2 del cliente en ese comercio, salvo las que ya están en 11, tienen el registro de creación
   en el core o tienen una cuota inicial aprobada. El riel 3 no dispara esa cascada.

En los rieles 0 y 1 el desenlace lo cuenta la entidad por webhook o lo marca el comercio a mano:
la gestión manual del portal de aliados en `legacy-backend` rechaza las solicitudes de los rieles
2, 3 y 4, que se mueven por el flujo. Nequi también figura en el listado como entidad de riel 0,
pero es un **pago de contado**: un cobro aprobado lleva la solicitud a 11 sin crédito detrás, y si
el pago se reversa vuelve a Cancelado (ver `user-request-lifecycle`).

## Después de originar

- **Entidad externa**: desembolsa y cobra ella. CreditOp conserva la solicitud y su estado.
- **CreditopX**: CreditOp administra la cartera. Cada noche loan-servicing agenda, por hora y dependencias, comandos
  de `legacy-application`: concilia pagos Wompi no aplicados, condona colillas, causa intereses (y ahí el
  gasto de cobranza por días de mora; un crédito con cuotas congeladas no causa interés hasta su
  inicio de amortización), aplica pagos retenidos, actualiza los créditos rotativos,
  aplica beneficios (subsidio de intereses de las primeras cuotas) y envía recordatorios. Si la
  causación termina con error, no corren los pasos que dependen de ella. El cliente paga por Wompi
  (portal de pagos, app), en caja del comercio, o por otros medios configurados por entidad. Los
  equipos financiados pueden bloquearse por mora (IMEI).

Detalle: `creditopx-payment-application`, `creditopx-portfolio-servicing`, `device-locking`.

## Qué sistema hace qué

- **legacy-backend** (Laravel modular): el backend del asistente nuevo, de la app móvil y del
  backoffice; KYC, listado, cupo, firma, pagos por la API nueva.
- **legacy-application** (Laravel + Inertia): el monolito anterior: admin de staff,
  portal de aliados, y los comandos de la cartera CreditopX que corre de noche loan-servicing.
- **frontend-monorepo**: asistente de solicitud, backoffice, portal de pagos, landing.
- **Servicios en Go**: pre-approvals-service (preaprobación multi-entidad), merchant-api (comercios
  y sedes para la app), self-manager-api (códigos QR, de barras y numéricos de autogestión),
  customer-profiling-service (pipeline de KYC), financial-health-service (salud financiera de la app),
  loan-servicing (la noche de cartera), identity-service (verificación de identidad con ADO) y
  entitlement-service (beneficios de la app móvil).
- **creditop_mobile**: la app Flutter del cliente final.

Muchas reglas existen en **los dos monolitos** con diferencias; antes de afirmar una, se revisan
ambos.
