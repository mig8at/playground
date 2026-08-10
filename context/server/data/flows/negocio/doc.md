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

⏳ **Y viene un TERCER modelo, distinto de los dos** (piloto Cuotéalo BCP en Perú, PRD 2026-07-31 — todavía
sin código): la entidad presta, hace riesgo, KYC, cartera y cobranza… pero **desembolsa a CreditOp**, y
**CreditOp le abona al comercio a T+1**. O sea que acá **CreditOp toca la plata**, algo que no pasa ni en
CreditopX (donde el capital es del comercio desde el principio) ni en el agregador clásico (donde la
entidad le paga al comercio directo). Lo que CreditOp aporta en ese modelo es **originación en punto de
venta** —el banco es fuerte en digital y débil en POS— más el link de pago y el administrador del
comercio. Si el piloto escala, es una fila nueva de esta tabla y no una variante de las otras dos.

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
- ⚠ **SEGURO DE VIDA y FONDO DE GARANTÍA son DOS cosas distintas, y confundirlas es fácil** porque
  ambas son «un % extra que cubre el impago». La BD las separa y el negocio también:
  - **Fondo de garantía** (`guarantee_fund_percentage`, `guarantee_insurance_per_million`,
    `guarantee_fixed_monthly_percentage`) — **reemplaza al CODEUDOR**, que es inviable en microcrédito.
    Cobra un % adicional sobre el monto (del orden del 5 % o más), **se acumula**, y de ahí se cubren
    los créditos que no se pagan. Es lo que permite aprobar en línea sin pedir un tercero que firme.
  - **Seguro de vida** (`life_insurance_percentage`, `life_insurance_fixed`,
    `insurance_fixed_monthly_percentage`) — cubre **muerte o incapacidad** del cliente. Es **opcional
    para el comercio** (obligatorio solo en entidades vigiladas) y va por **brokers** para abaratarlo.
  - Los dos se negocian **por comercio**, y por eso sus porcentajes viven en la calculadora del par.
- ⚠ **El tercero NO existe como entidad en el modelo de datos** — ni el fondo ni la aseguradora. Solo
  hay porcentajes y unos criterios por lender (`lender_guarantee_criteria`, con `originator_nit` /
  `originator_legal_name`, que son los **contratos de asociación**: cuando el producto tiene IVA,
  CreditopX entra como tercero para que el impuesto sobre intereses no encarezca el crédito).
  Consecuencia práctica: **no se puede responder desde la BD «qué fondo o qué aseguradora cubre este
  crédito»**, ni auditarlo por proveedor.
- 🔴 **El fondo cobra pero el sistema NO sabe reclamarlo.** La regla de negocio es que el fondo cubre
  las deudas con **más de 90 días de mora** — y `grep` de ese umbral en los tres repos da **cero**: no
  hay código que marque un crédito como cubierto por el fondo ni que lo descuente. El % entra en cada
  crédito y la reclamación es proceso manual, invisible para el sistema.
- **Los hardcodes por id salieron de una demanda comercial real** — los comercios piden flujos muy
  customizados y cada pedido entró como código (causa raíz de los 24 acoplamientos de
  `hardcodes-entidades`). ⚠ **Pero eso NO significa que la customización sea el producto deseado**: la
  posición de producto es que **la POLÍTICA de riesgo debe ser modular y parametrizable, y la
  personalización de UX debe LIMITARSE** justamente para no pagar ese costo de desarrollo. O sea que el
  hardcoding es deuda reconocida, no estrategia — y el norte declarado es **plug-and-play**: que el
  gestor de cuenta y el comercio parametricen sus políticas y activen integraciones **desde el front**,
  sin desarrollo. Hoy montar un comercio nuevo lleva **cerca de una semana**.
- 🔴 **Una solicitud que se cae por una entidad externa se detecta porque EL ASESOR AVISA.** No hay
  alerta: el comercio espera que el crédito salga, el asesor pierde el tiempo con el cliente adelante, y
  recién ahí alguien se entera y hay que ir a hablar con la entidad. Es el hueco que justifica el OKR de
  alertas de salud, y da el requisito real: la alerta útil no es «hay 5xx», es **«las solicitudes de
  este lender dejaron de cerrar»**.

## El producto, en el vocabulario de negocio
De la capacitación de producto (Manuela Romero, 2026-06-05 — grabación y transcripción en el Drive del
equipo). Lo que sigue está contrastado contra el código: **lo que no coincide va marcado**.

- **CreditopX se vende como «proveedor tecnológico y administrativo», no como financiera.** El comercio
  es **dueño del pagaré** y financiador; CreditOp le administra cartera y cobranza para que el comercio
  no monte una financiera propia. El pitch explícito: *no ganamos intereses, ganamos por gestionar*.
- **Dos modalidades, y el corte es el TICKET**: **cupo rotativo** para tickets **< 1 millón** (el cupo
  se libera al pagar) y **crédito de consumo** para **> 1 millón** (no se libera). La elección depende
  del perfil del comercio. *(Umbral no verificado en código: lo que sí existe es el tope
  `lenders.max_rev_credit` y los tramos por monto → `amount-tiers`, `rotativo`.)*
- **Amortización francesa con interés sobre SALDO DIARIO**: la cuota que ve el cliente es fija, pero los
  intereses se causan sobre el saldo del día, así que **el saldo consultado cambia día a día**. Eso es
  exactamente lo que hace el cron de las 00:30 (→ `servicing`), y explica por qué no se puede responder
  «cuánto debe» sin decir «a qué fecha».
- **Cobranza en dos tiempos**: **preventiva** (antes del vencimiento) y **coactiva** (tras la mora),
  esta última prejudicial y judicial — pero **el cobro jurídico casi no se usa**: cuesta más que el
  saldo de un microcrédito de menos de 10 millones. Las llamadas las hace un proveedor externo con
  agentes de IA (**Colbook**). ⚠ **Colbook no aparece en el código** (cero referencias en los tres
  repos): es relación operativa, no integración.
- **Segmentación premium → malos, con intención de RESCATE**: a los no bancarizados o reportados se les
  ofrece crédito con más garantía y cuota inicial alta (ej. 70 %), y se les reporta positivo a
  Datacrédito para que mejoren historial. La segmentación vive en `profiling`.
- **Refinanciar ≠ condonar**: la refinanciación estira el plazo para bajar la cuota **sin perdonar**
  intereses ni capital (la pide seguido Motai). Deja rastro en el ledger como `movement_type`
  (`REDUCCIÓN DE CUOTA` · `CAMBIO DE PLAZO` · `CAMBIO DE NÚMERO DE CUOTAS` → `servicing`). Los
  **acuerdos de pago**, en cambio, implican concesiones y **hoy no hay ninguno autorizado**: requieren
  aprobación explícita de crédito y del comercio.
- **ADO se elige sobre AWS en algunos comercios porque es más exigente y trae seguro contra fraude**, y
  porque opera en varios países (RD incluido): se reutiliza la integración cambiando credenciales. Es la
  estrategia de proveedores para multipaís (→ `kyc`).
- ⚠ **Motai: los estados «recuperación de producto» y «recuperación por fondo de garantía» NO están en
  la BD.** El catálogo `creditop_x_user_request_statuses` sigue teniendo **4 filas** (Al día · En mora ·
  Paz y salvo · Cancelado). Se anunciaron en la capacitación; hoy son pendiente, no realidad. El caso de
  negocio sí es real: Motai pone GPS y prenda sobre las motos y recupera el vehículo (4 recuperadas), y
  ahí el crédito queda en saldo cero.

### El embudo SÍ está instrumentado (y casi nadie lo sabe)
Existe un tercer catálogo de estados que no es ni el de la solicitud ni el del préstamo:
**`creditop_x_user_requests_process_statuses`** — **15 pasos, 9 activos**, desde «Ingreso a creditop»
hasta «Crédito originado», con `step_number`. Cada paso se registra en
`creditop_x_user_requests_records` (medido: **8 escrituras** en una sola corrida rt=2) y lo consume el
export `RequestsCtopXStatsExport`. Es la respuesta a **«¿dónde se cae la gente?»**, que es la pregunta
del caso Mediarte — y está viva, no es andamiaje.

**El caso Mediarte, y por qué conecta con F-112.** Mediarte tenía conversión baja; al estudiarla
encontraron que **clientes con buen score se rechazaban por capacidad de endeudamiento y por deudas
chicas de servicios públicos**. Con el perfilamiento nuevo pasó de **20 a 350 millones mensuales**,
+25 % de conversión y triplicó el ticket. Ahora leelo junto a **F-112**: la compuerta de capacidad corre
en solo el 18 % de los tiers y **no mira los gastos declarados** por el cliente. Es el mismo fenómeno
visto desde los dos lados — negocio lo vio como conversión perdida, el código lo muestra como una
compuerta que mide otra cosa de la que su nombre sugiere.

## Dónde termina el sistema y empieza el proceso manual
La liquidación **no la hace el código**: otro departamento toma un reporte y sigue a mano. Verificado
2026-08-09 — y la frontera es esta:

**Lo que el sistema entrega es el «Reporte de Recaudo»** (`app/Exports/PaymentCollectReportExport.php`,
ruta `descarga-recaudo`), con una fila por pago y estas columnas: *Id pago · Documento · Nombre usuario ·
Monto pagado · Capital pagado · Intereses pagados · Intereses mora pagados · Seguros pagados · Monto
retenido · Medio de pago · Referencia · Fecha de pago*. Está filtrado por rol, así que un comercio
descarga lo suyo. **No trae la comisión de CreditOp en ninguna columna**: el reporte dice qué pagó el
deudor y cómo se imputó, no cuánto le queda a quién.

⚠ **Y hay UNA excepción, que es el único lugar del código donde se calcula un ingreso de CreditOp**:
`app/Exports/UserRequestsCorbetaExport.php`. Ahí, para los créditos de Corbeta:
- **Consumo (lender 100)**: una **tabla de 40 tramos escrita a mano** en un JSON dentro del archivo
  (1M → 40M, uno por millón). El monto se trunca al millón (`floor(final_amount/1e6)*1e6`), se busca el
  tramo por **igualdad exacta**, y el total se reparte **50/50 entre Corbeta y CreditOp**.
- **BNPL (lender 68)**: sin tabla — **1 % para CreditOp** y **0,5 % para Bancolombia**, sobre
  `final_amount`.

O sea que la comisión que el negocio describe como su fuente de ingreso **no está modelada**: existe
`comission_percentage` por par comercio-entidad que nadie usa para cobrar (arriba), y existe este cálculo
hardcodeado para un solo grupo de comercios. Ver **F-129**.

## Con quién hablar (lo más perecedero de este árbol — al 2026-08-09)
El árbol nunca dijo a quién preguntarle, y es lo que más rinde cuando algo se traba. ⚠ **Es también lo
que primero se pudre**: la gente cambia de rol. Si una respuesta no cuadra, empezá por dudar de esta
tabla y no de la persona.

| Para… | Preguntar a |
|---|---|
| **Política, y por qué existe algo** | Manuela (producto) |
| **Qué le pasó a ESTA solicitud** | Joel (soporte) |
| **La plata después del desembolso** — liquidación, recaudo, mora | Juan Camilo (cobros) |
| **CreditopX** — motor, cupo, pagos, servicing | Laura, Hans |
| **Bancolombia** | Santi, Abel |
| **Qué pidió el comercio de verdad** | Fabián (gestores de cuenta) |

**Contrastado contra git**, y coincide donde más importa: en `Admin/CreditopXPayment*` y
`Commands/UpdateCreditopX*` firman **Laura Cabra** (27 commits entre sus dos identidades) y **hans
peter**; en `app/Services/lenders/` (el motor) Laura otra vez, con 38. ⚠ Pero el método tiene un límite
visible: en `Actions/Lenders/Bancolombia*` los commits recientes son de otras personas, y a quien hay
que preguntarle es a Santi. **Quien commiteó último no es necesariamente el dueño del tema** — la misma
advertencia que `alinear.py` ya hace sobre los autores.

## El alta de un comercio: la semana se va en NEGOCIAR, no en configurar
El dato importa porque contradice la teoría implícita del roadmap. Montar un comercio nuevo lleva
**cerca de una semana**, y ese tiempo se va en **reuniones de parte y parte**: aclarar el modelo de
negocio, los porcentajes que ofrece CreditOp, las comisiones, qué entidades quiere prender y en qué
sucursales.

⚠ **Consecuencia incómoda para el «plug and play».** El norte declarado es que el gestor de cuenta y el
comercio parametricen sus políticas desde el front para «eliminar la intervención manual prolongada».
Pero si el cuello de botella es el **acuerdo comercial**, un panel autogestionado ataca la parte que ya
es rápida —cargar la configuración— y no mueve la semana. No invalida el proyecto: cambia cómo medirlo.
Prometer «alta en un día» por tener mejor UI es prometer sobre el tramo equivocado. Lo que sí podría
acortar la negociación es que el formulario **haga las preguntas correctas** y deje el acuerdo
estructurado, no que sea autoservicio.

## El ciclo de la plata: mensual, con cierre de mes
El recaudo se le devuelve al comercio **mensualmente**, con cierre de mes. Lo que el sistema automatiza
de eso es **poco**: la única entrada mensual del scheduler es
`app:lender-disbursements-report-command`, que corre **el día 4 a las 05:00**
(`app/Console/Kernel.php:48`) y es un reporte de **desembolsos**, no de liquidación. Todo el resto del
cierre —consolidar, descontar la comisión, transferir— es manual.

## La reportería real es Redash, no los exports
⚠ **Corrección importante para quien vaya a buscar «el reporte»** (Miguel, 2026-08-09): en la práctica
**se entra a la BD o a Redash y se escribe la query**. Los 20 `app/Exports/*` existen, pero no son
necesariamente lo que se usa, y **no hay una consulta canónica** que se pueda señalar como la fuente de
la liquidación. Después alguien lo baja a Excel y hace los descuentos a mano. Qué puede y qué no puede
Redash acá: → `db-routines`.

## La promesa que hoy no se cumple: la autogestión
Se le vende al comercio que **puede configurar sus propias políticas**, y en la práctica casi todo pasa
por el equipo técnico. Es la brecha más citable del negocio, y le da destino a dos cosas que ya están
documentadas: el **mapa del operador** (`merchants` §9 — qué escribe cada pantalla, que es lo que ese
autoservicio tendría que replicar) y el **inventario de cutover** (`application` §5 — la capa de
configuración ya tiene API en `Modules/Partner` y no tiene front).

## El negocio de los AGREGADORES: se le cobra a los DOS lados
Es la mitad de la empresa y el árbol no lo tenía. Si el banco presta y el banco cobra, lo que CreditOp
vende es **distribución + dato**:

- **Le cobra al comercio** (por tener el marketplace) **y también a la entidad** — por **aparecer en los
  comercios** y por **direccionarle solicitudes**. Es un mercado de dos lados, no un canal gratis.
- **Y le entrega el perfil «masticado»**: CreditOp valida contra burós y le pasa a la entidad un
  candidato ya enriquecido, en vez de un dato crudo. Eso reduce el riesgo del lado del banco y es parte
  del valor que se cobra. ⚠ **No todas lo usan**: Bancolombia hace su propia validación (coherente con
  que tenga sus dos compuertas propias → `bancolombia`).
- Y por eso la capa de pre-aprobación **no es solo técnica**: `ms-preapprovals` y el perfilamiento son
  literalmente el producto que se le vende a la entidad. Degradarlos degrada el ingreso, no solo la UX.
- La otra mitad del valor es **la integración única**: la entidad se conecta una vez y llega a todos los
  comercios, en vez de integrarse con cada uno.

## Si un comercio se va, CreditOp sigue cobrando
La cartera viva **se sigue administrando hasta el último pago**, aunque el comercio ya no origine.
Consecuencia directa para el sistema: **dar de baja un comercio no puede ser apagar su configuración** —
los créditos vivos necesitan que el servicing siga corriendo (los 6 crons, el ledger, la imputación →
`servicing`). Cualquier «desactivar comercio» que corte eso rompe cobranza sobre plata que es del
comercio.

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
- **La liquidación de la comisión es MANUAL** (dicho por Miguel): alguien consolida la información de la
  BD y la pasa al equipo de cobros. El código confirma la mitad —no la calcula ni la descuenta— pero
  **no hay un reporte ni una consulta canónica** que se pueda señalar como «la fuente de la
  liquidación». Eso es lo que falta saber: contra qué se factura hoy y quién concilia.
- **Los umbrales del producto contra el código.** El corte rotativo/consumo en 1 millón, el % del fondo
  de garantía (≈5 %) y la cuota inicial del 70 % para reportados son cifras de política: no se buscó su
  equivalente exacto en las tablas de configuración.
- **Quiénes son los fondos de garantía y las aseguradoras.** El broker mencionado es **Seguros Mundial**
  para vida; el fondo de garantía no tiene nombre en el sistema. ⚠ Ninguno de los dos aparece en el
  código (cero referencias): hay que preguntarlo adentro.
- 🔴 **¿CreditOp está vigilada por la Superintendencia Financiera? SIGUE SIN RESPUESTA, y es la pregunta
  estructural del nodo.** Producto habla de «obligatorio en entidades supervisadas» como si fueran otras;
  Miguel supone que sí pero no lo tiene confirmado. Importa porque de eso depende la explicación del
  modelo entero: **si CreditOp no es vigilada, no puede prestar plata propia, y que el capital sea del
  comercio deja de ser una elección comercial para ser una consecuencia legal.** Hoy el árbol afirma lo
  primero sin poder descartar lo segundo. Preguntar a legal o a producto antes de repetirlo.
- **El prompt de producto.** Manuela quedó en compartir el prompt que el equipo de producto usa para
  explicarle el negocio de agregador y crédito a un modelo. Cuando llegue, es la fuente a contrastar
  contra este nodo.
- **El segundo modelo de comisión con agregadores.** Miguel mencionó que CreditOp «también comisiona por
  llevar el crédito de la persona» con entidades como Bancolombia o Welli, y que **cree que eso se
  maneja fuera de CreditOp**. Sin confirmar: no se sabe si deja huella en el sistema.
- **Cuánto es la comisión.** `comission_percentage` existe por par comercio-entidad, pero no se midió su
  distribución real ni si hay un valor estándar.
- **Quiénes son las aseguradoras.** No están en el sistema; hay que preguntarlo.
