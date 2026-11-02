# Negocio: cómo funciona CreditOp

CreditOp es una fintech colombiana de **originación de crédito en el punto de compra**: cuando un
cliente quiere comprar algo en un comercio aliado y no lo paga de contado, CreditOp le muestra qué
entidades le pueden financiar esa compra, lo lleva por la validación y la firma, y entrega el crédito.
Este tema es el mapa: nombra las piezas, dice cómo encajan y remite al tema que explica cada una.
Cada afirmación tiene su fuente, pero el detalle y los límites están en el tema enlazado.

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
| ¿cómo entra una tienda online o un código? | `ecommerce-context`, `client-code-redemption`, `purchase-code-lifecycle` |
| ¿cómo se da de alta un comercio y su convenio? | `merchant-onboarding`, `merchant-lender-agreement`, `admin-panel` |

## Quién es quién

- **Cliente** (`users`): la persona que compra y pide el crédito. Se identifica por celular (OTP) y
  documento.
- **Comercio o aliado** (`allieds`): la tienda que vende. Tiene **sucursales** (`allied_branches`), y
  la sucursal es la unidad operativa: tiene su `hash` (que va en las URLs del asistente), sus
  entidades habilitadas, el grafo de KYC (el pipeline se elige por comercio), si el monto queda fijo (`lock_amount`) y sus
  credenciales de integración ecommerce.
- **Asesor**: el vendedor del comercio que acompaña al cliente en el punto de venta; la solicitud
  queda a su nombre.
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
  (identidad, firma, pagaré) y radica ante la entidad.

La cobranza es otro eje (`externally_serviced`), y la periodicidad de corte (`cutoff_type_id`:
mensual, quincenal, semanal) es por entidad. Detalle: `lender-response-types`.

## Por dónde entra un cliente

El canal queda en `users.onboarding_channel` la primera vez:

- **`merchant`**: el asesor abre el asistente con el hash de su sucursal y acompaña al cliente.
- **`self_service`**: el cliente entra solo, por QR o código en tienda física, o por las rutas de
  autogestión.
- **`ecommerce`**: una tienda online (WooCommerce, VTEX, Shopify, link de pago) manda el pedido
  serializado; hay una solicitud por pedido.
- **`mobile`**: el cliente se registra en CreditOp Mobile; la app genera un código para comprar en un
  comercio aliado por venta asistida o tienda física.

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
6. **Autorizada** (11): el crédito existe. Es terminal; al llegar, se cancelan las otras solicitudes
   CreditopX del cliente en ese comercio.

En los rieles 0 y 1 el desenlace lo cuenta la entidad por webhook o lo marca el comercio a mano.
Nequi también figura en el listado como entidad de riel 0, pero es un **pago de contado**: un cobro
aprobado lleva la solicitud a 11 sin crédito detrás (ver `user-request-lifecycle`).

## Después de originar

- **Entidad externa**: desembolsa y cobra ella. CreditOp conserva la solicitud y su estado.
- **CreditopX**: CreditOp administra la cartera. Cada noche se causan intereses, se aplican pagos
  retenidos, se condonan colillas, se cobran gastos de cobranza por mora y se aplican beneficios
  (subsidio de intereses de las primeras cuotas). El cliente paga por Wompi (portal de pagos, app),
  en caja del comercio, o por otros medios configurados por entidad. Los equipos financiados pueden
  bloquearse por mora (IMEI).

Detalle: `creditopx-payment-application`, `creditopx-portfolio-servicing`, `device-locking`.

## Qué sistema hace qué

- **legacy-backend** (Laravel modular): el backend del asistente nuevo, de la app móvil y del
  backoffice; KYC, listado, cupo, firma, pagos por la API nueva.
- **legacy-application** (Laravel + Inertia, «application»): el monolito anterior: admin de staff,
  portal de aliados, y los comandos de la cartera CreditopX que corre de noche loan-servicing.
- **frontend-monorepo**: asistente de solicitud, backoffice, portal de pagos, landing.
- **Servicios en Go**: pre-approvals-service (preaprobación multi-entidad), merchant-api (comercios
  y sedes para la app), self-manager-api (códigos QR, de barras y numéricos de autogestión),
  customer-profiling-service (pipeline de KYC), financial-health-service (salud financiera de la app),
  loan-servicing (la noche de cartera), y otros más nuevos (identity-service, entitlement-service,
  access-service).
- **creditop_mobile**: la app Flutter del cliente final.

Muchas reglas existen en **los dos monolitos** con diferencias; antes de afirmar una, se revisan
ambos.
