# Negocio · contexto
> **fuente: Miguel (2026-08-09), contrastado contra BD y código donde se pudo** — lo que NO se pudo verificar va marcado. Por qué CreditOp tiene la forma que tiene: quién pone la plata, quién cobra, de qué vive la empresa y quién decide qué se construye.

## Qué es
El árbol describe **cómo** funciona el sistema con mucho detalle. Este nodo es la otra mitad: **por qué
es así**. Existe porque la mayoría de las rarezas del código no son deuda técnica accidental — son
decisiones comerciales con consecuencias en el esquema, y sin saberlas un modelo propone «simplificar»
cosas que sostienen el negocio.

**Los dos sombreros no son dos configuraciones: son dos negocios distintos.**

| | **CreditopX** (rt=2/3) | **Agregadores** (rt=0/1/4) |
|---|---|---|
| Quién pone la plata | **el COMERCIO** | la entidad (bancos, Welli, Sistecrédito…) |
| Quién cobra al deudor | **CreditOp**, y le devuelve la plata al comercio | la entidad, por su cuenta |
| De qué vive CreditOp | **comisión al comercio por cada crédito** | comisión de la entidad por llevarle originación |
| Riesgo de crédito | del comercio (con el colchón, abajo) | de la entidad |

## Antes de concluir
- **El lender de CreditopX ES la marca blanca del comercio, no una entidad financiera.** Pullman tiene
  su lender `CrediPullman`; el comercio le ofrece crédito a sus clientes **sobre los rieles de
  CreditOp**. Medido: **71 de los 74 lenders rt=2 están habilitados en UN solo comercio**, y los
  nombres lo confirman (`Mediarte X Tunja`, `MonteX`, `Dental Force X`, `Oral credit X`). Consecuencia
  directa: para rt=2, **«configuración por lender» y «por comercio» son lo mismo** — y las 3
  excepciones que sí comparten (`Crediteame` 3 comercios, `DENTIX FINANCIAL SERVICES` 2) son
  exactamente donde esa equivalencia se rompe (**F-127**).
- ⚠ **EL SISTEMA NO COBRA LA COMISIÓN: solo la MUESTRA** (verificado 2026-08-09, contra el código).
  Se creía que se tomaba una parte de cada cuota; el código dice otra cosa. Hay **un solo lector** de
  `comission_percentage` en los tres repos: el accessor `UserRequest::getCommissionValueAttribute`
  (`application/app/Models/UserRequest.php:125`), que calcula
  **`(comission_percentage / 100) × final_amount`** — un porcentaje del **total del crédito**, una vez,
  no por cuota. Y sus únicos consumidores son **tres vistas del panel** que lo pintan; **la cascada de
  imputación no menciona comisión en ninguna línea**. O sea: el reparto de cada pago **no separa** la
  comisión. Que operativamente se facture por cuota puede ser cierto, pero **pasa fuera del sistema** —
  acá no queda registro ni se descuenta.
- ⚠ **Y las vistas no coinciden entre sí sobre «lo que recibe el comercio»**: dos calculan
  `final_amount − comisión` y una calcula `amount − comisión`. No son la misma base —`amount` incluye
  el fondo de garantía y `final_amount` no— y **difieren en 30.749 de 81.877 solicitudes (38 %)**. Ver
  **F-128**.
- **El «colchón» de las aseguradoras se negocia POR COMERCIO**, y por eso sus porcentajes viven en la
  calculadora del par (`guarantee_fund_percentage`, `guarantee_insurance_per_million`,
  `guarantee_fixed_monthly_percentage`). Es el tercero que cubre el impago para que no lo absorba entero
  el comercio.
- ⚠ **La aseguradora NO existe como entidad en el modelo de datos.** No hay tabla: solo porcentajes y
  unos criterios por lender (`lender_guarantee_criteria`, con `originator_nit`). Consecuencia práctica:
  **no se puede responder desde la BD «qué tercero cubre este crédito»**, ni auditar el colchón por
  proveedor. Todo lo que el sistema sabe del acuerdo es cuánto se cobra.
- **Los hardcodes por id NO son descuido: son el modelo comercial.** Los comercios piden **flujos muy
  customizados** y cada pedido entró como código. Es la causa raíz de los 24 acoplamientos de
  `hardcodes-entidades` y de que integrar una entidad nueva cueste desarrollo. Proponer
  «parametrizar todo» sin entender que la customización **es lo que se vende** es proponer cambiar el
  producto.
- 🔴 **Una solicitud que se cae por una entidad externa se detecta porque EL ASESOR AVISA.** No hay
  alerta: el comercio espera que el crédito salga, el asesor pierde el tiempo con el cliente adelante, y
  recién ahí alguien se entera y hay que ir a hablar con la entidad. Es el hueco que justifica el OKR de
  alertas de salud, y da el requisito real: la alerta útil no es «hay 5xx», es **«las solicitudes de
  este lender dejaron de cerrar»**.

## El cliente que manda es el COMERCIO
CreditOp gana con comercios y con entidades agregadoras, pero el que decide es el comercio: es quien
firma, quien en CreditopX pone el capital, y cuyos clientes son los que toman el crédito. Eso ordena
todo lo demás — la prioridad de lo que se construye, la customización por comercio, y por qué un
comercio grande sin poder vender a crédito es el peor incidente posible.

## Dónde mirar
Dónde el modelo comercial **se vuelve código** — es lo que hay que abrir para verificar cualquier
afirmación de arriba:

- `application/app/Models/LendersByAllied.php:19` (`$fillable`) — **la calculadora del par
  comercio-entidad**: acá viven, juntas, la comisión de CreditOp (`comission_percentage`), el colchón
  del asegurador (`guarantee_fund_percentage`, `guarantee_insurance_per_million`,
  `guarantee_fixed_monthly_percentage`) y el seguro de vida. Si el negocio cambia, cambia esta fila.
- `application/app/Http/Controllers/Admin/AlliedLenderController.php:254` — dónde se escribe ese
  acuerdo desde el panel, y el borrado por `lender_id` que solo es inocuo gracias al 1:1 (**F-127**).
- `application/app/Http/Controllers/Admin/CreditopXPaymentController.php:62` (`processPayment`) — la
  cascada que reparte cada pago; **es donde habría que confirmar si la comisión se descuenta acá**.
- `application/app/Models/Lender.php:27` (`$fillable`) — el `response_type` que elige el sombrero, más
  las columnas de branding que hacen posible la marca blanca.
- `application/app/Services/lenders/LenderUserCategoryService.php` — la categoría que fija enganche y
  FGA: es donde el riesgo del comercio se convierte en condiciones para el cliente.

## Lo que NO está verificado
- **Cómo se liquida de verdad la comisión, fuera del sistema.** Verificado que el código no la
  descuenta (arriba); lo que NO se puede saber desde acá es qué pasa después: si se factura al comercio
  por cuota o por crédito, contra qué reporte, y quién concilia. Es proceso, no código.
- **El segundo modelo de comisión con agregadores.** Miguel mencionó que CreditOp «también comisiona por
  llevar el crédito de la persona» con entidades como Bancolombia o Welli, y que **cree que eso se
  maneja fuera de CreditOp**. Sin confirmar: no se sabe si deja huella en el sistema.
- **Cuánto es la comisión.** `comission_percentage` existe por par comercio-entidad, pero no se midió su
  distribución real ni si hay un valor estándar.
- **Quiénes son las aseguradoras.** No están en el sistema; hay que preguntarlo.
