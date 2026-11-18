# Antecedentes de otras reuniones

Reuniones que no son la Weekly CT y explican cómo funciona el negocio de crédito o por qué se decidió algo:
planificación de onboarding, capacitaciones de producto, e-commerce, Bancolombia y la organización de tecnología.
**Lo técnico es lo que se dijo en esa fecha**: puede haber cambiado. Lo vigente está en el código y en los temas de
knowledge; cada reunión trae lo que hay que contrastar. Cómo se arma: [README](README.md).

Quedaron afuera, a propósito: el bootcamp de IA, las pruebas de UMA, la revisión del front del monorepo, un 1:1, dos
reuniones sin resumen y la tech sync del 27 de marzo (fue una demostración).

### 2026-02-02 · Planning Onboarding

**De qué fue:** planeación del sprint del squad de onboarding: reparto de tareas, deudas del sprint anterior y cómo llenar los Rocks/OKRs del trimestre.

**Lo que conviene saber:**
- Los preaprobados de comercios estaban caídos: la API de preaprobados no se había adaptado a los usuarios «mock», y el servicio no cargaba para nadie. Jose Escobar quedó en consultarlo con Oscar.
- Se planteó un microservicio «Risk Central» (gateway de burós) para centralizar la consulta a Experian y otros burós: disparador, frecuencia y vencimiento de la consulta, conteo y restricción de consultas por usuario. Responsable: Yamid Viloria; Jose Escobar documenta los servicios de burós (colección de Postman).
- «Plan de choque» del OTP: el flujo está repartido en cuatro APIs que hacen varias cosas a la vez y eso dificulta rastrear errores; se reparte backend (Joel Riascos) y frontend (Miguel Ochoa).
- Límite de intentos para adivinar la fecha de expedición: el backend ya bloqueaba, pero devolvía un error genérico; faltaba el mensaje claro en el front para los comerciales.
- El perfilador es un modelo de machine learning general de CreditOp, con modelos de más de seis meses; se sospechaba de él por los pocos desembolsos de una entidad y se pidió un spike (2 puntos) para el cambio de perfilador del Banco de Bogotá, quizá con modelo propio.
- Usuarios temporales en Corbeta: los nombres no se capturan y se podría desembolsar a nombre temporal; se abrió un spike (Joel Riascos).
- Desembolsos del dashboard de CAMs: Metabase pasó a contar por fecha de actualización (no de creación), pero los CAMs descargan del admin de CreditOp, que seguía con la lógica vieja; se abrió una tarea aparte para el admin.
- Trustonic: las reglas de formularios dinámicos se separaron en backend (reglas y microservicio que entrega los JSON) y frontend, que queda para un sprint posterior.
- República Dominicana: para la mensajería se replica Twilio en vez de evaluar otra plataforma, por tiempo (investigación a cargo de Joel Riascos).
- La prueba de integración de e-commerce se arrastró: faltaba conectar la app y validar la lógica de retorno, y dependía del apoyo del equipo de CreditopX.

**Para contrastar con el código o los datos:**
- Que los desembolsos del admin de CreditOp y Metabase se calculen hoy por la misma fecha (en la base actual la vara es `disbursed_at`).
- Si el microservicio Risk Central / gateway de burós llegó a existir y qué hace hoy con frecuencia y vencimiento de Experian.
- Que el bloqueo por intentos de fecha de expedición esté en el backend y qué mensaje muestra el front.
- Nombres corregidos de la transcripción: «Merchans» → merchants (comercios); «MOC» → mock; «Corveta» → Corbeta; «Crédito X / APX» → CreditopX; «Amarigua / Mareigua» → Mareigua; «Triumph» y «UMA» quedaron sin identificar; «Agilidad Data» probablemente un buró, sin confirmar.

### 2026-04-01 · Dudas Ecommerce (Read AI)

**De qué fue:** coordinar la migración del flujo de e-commerce (redirección y notificaciones al comercio) desde Application/WooCommerce hacia legacy-backend y el front del monorepo.

**Lo que conviene saber:**
- La `return_url` y la `process_url` de la tienda se guardan en `ecommerce_request` y hay que inyectarlas en la pantalla final para redirigir y notificar al comercio.
- Hoy (abril) el flujo va de Aliados/Application a Legacy, que valida los datos y arma la URL de retorno; la idea es unificar en legacy-backend y redirigir desde el monorepo, con una vista única de «crédito aprobado» en el front de lenders.
- El flujo debe mirar primero si el usuario tiene BNPL o consumo y mandarlo al camino que corresponde.
- Las entidades que sacan al usuario de la app confirman aprobación o rechazo por webhook: hay doble notificación (entidad → CreditOp → comercio).
- Riesgo de doble consumo: la URL de originaciones consume servicios de validación que el flujo de lenders podría repetir.
- Corbeta usa sólo Bancolombia y por ahora se queda en Application hasta que todo pase a Legacy.
- Bancolombia tiene un sandbox estático e inestable, con parámetros fijos, que provoca timeouts en dev; Santiago Villaquiran compartió su rama como referencia.
- Bloqueos de prueba: errores opacos en el front, timeouts al listar lenders en legacy-backend, validaciones estrictas sin logs claros, y faltaba un `partner_hash_id` o usuarios de prueba vigentes.
- La redirección e-commerce funcionaba en desarrollo pero sólo en una rama, sin publicar a producción.

**Para contrastar con el código o los datos:**
- Que `ecommerce_request` guarde `return_url`/`process_url` con esos nombres y en qué pantalla se usan hoy.
- Si Corbeta sigue en Application o ya pasó a legacy-backend.
- Nombres corregidos: «Legacy Marketing» → legacy-backend; «Monorail» → monorepo (frontend-monorepo); «Corvetta» → Corbeta; «SOT» quedó sin identificar; «DEP» probablemente dev.

### 2026-06-05 · Capacitaciones producto

**De qué fue:** capacitación de producto (Manuela Romero) sobre cómo funciona el negocio del agregador y de CreditopX: crédito, riesgo, cobranza, garantías y la meta de autogestión de comercios.

**Lo que conviene saber:**
- Dos negocios: el agregador (entidades financieras) y CreditopX, que incluye cupo rotativo, crédito de consumo y una línea de renting.
- En CreditopX el comercio es el dueño de los pagarés y el que financia; CreditOp pone la tecnología, el motor de riesgo y la administración de cartera y cobranza, no gana como entidad financiera.
- Amortización francesa: cuota fija para el cliente, pero el interés se causa sobre el saldo diario, así que el saldo consultado cambia día a día.
- Cupo rotativo para tickets menores a ~1 millón (el cupo se libera al pagar); consumo para tickets mayores (no se libera).
- En vez de codeudores, fondos de garantía que cobran un porcentaje adicional (5% o más) y cubren deudas de más de 90 días de mora; seguro de vida opcional vía broker con Seguros Mundial.
- Políticas de riesgo modulares y parametrizables por industria; la personalización de UX se limita para no disparar costos de desarrollo.
- Segmentación de clientes de «premium» a «malos»: a los no bancarizados o reportados se les presta con más garantía y cuota inicial (hasta 70%) y reportes positivos a DataCrédito.
- Cobranza preventiva y coactiva (prejudicial y judicial; la judicial casi no se usa por costo); para Motai hay estados nuevos de recuperación de producto y por fondo de garantía (motos con GPS y prenda), que dejan el saldo en cero.
- Identidad con ADO o AWS; ADO se prefiere en algunos comercios por exigencia y seguro contra fraude, y por operar en varios países (p. ej. República Dominicana) reutilizando la integración con otras credenciales.
- Montar un comercio de crédito tarda ~1 semana; la meta es un producto «plug and play» donde gestores de cuenta y comercios parametrizan políticas e integraciones desde el front.

**Para contrastar con el código o los datos:**
- El caso de éxito citado (un comercio que pasó de 20 a 350 millones mensuales, +25% de conversión, triple de ticket) es una cifra de la presentación, no medida.
- Escala de score de DataCrédito 0–950 y umbrales de ticket del cupo rotativo vs. consumo.
- Que existan en el código los estados de recuperación de producto y por fondo de garantía.
- Nombres corregidos: «Crédito X» → CreditopX; «Data Crédito» → DataCrédito; «Mediarte» (comercio del caso) y «Colbook» (empresa de cobranza con agentes de IA) quedaron como se oyeron; «Dendix» probablemente Dentix.

### 2026-06-26 · Tech sync

**De qué fue:** interfaces agénticas, demostraciones con MCP y estandarización de despliegues (sólo se resume lo pedido).

**Lo que conviene saber:**
- Ante la falta de paridad entre producción y los ambientes de prueba (planteada por Hans Castellar), Yamid Viloria propuso desarrollo basado en tronco: una rama principal que genera los artefactos, para que todos los ambientes corran lo mismo.
- Daniel Sánchez quedó en aplicar convenciones de commits y ramas (Conventional Commits, PRs ligados a Jira) en todos los repositorios.
- No hubo reorganización de equipos ni Rocks en esta reunión.

**Para contrastar con el código o los datos:**
- Si el desarrollo basado en tronco se adoptó: hoy los repos se despliegan por ramas `develop`/`qa`/`staging`/`main`, que contradice la propuesta.

### 2026-07-08 · Tech sync

**De qué fue:** reorganización del área de tecnología en dos equipos y presentación de los Rocks (objetivos trimestrales) con sus KPIs de predictibilidad y estabilidad.

**Lo que conviene saber:**
- Dos equipos: «CreditopX» (Fercho, Abel, Luis, Hans) y «Core» (José, Miguel, Santiago); Yamid transversal (innovación y migración), Joel sólo soporte, Mauricio en móvil.
- Tecnología tiene dos Rocks de área: entregar a tiempo (predictibilidad) y estabilidad. Cada persona define el suyo en Confluence, con 2–3 KPIs cuantificables y medidos semana a semana.
- Los Rocks no son entregables (nadie tiene «entregar el microservicio X»): son objetivos que se atacan dentro del trabajo planeado con producto.
- KPI de predictibilidad: % de entregables del pipeline en producción en la fecha comprometida; los detenidos se separan por causa técnica interna o externa (p. ej. un error de Credifamilia).
- KPI de estabilidad: incidentes críticos en producción con meta cero. Crítico = el usuario no puede terminar un flujo (registrarse, desembolsar); una mala configuración reportada por operaciones no cuenta.
- Aunque la falla sea del tercero cuenta igual: había que reaccionar más rápido o tener un fallback (p. ej. el arreglo de la fecha de nacimiento para Welli debió estar contemplado antes).
- Otros KPIs: disponibilidad semanal de flujos críticos (el tiempo hasta decidir y mitigar cuenta), releases sin regresión e incidentes por release (meta ≤1).
- Jira es la fuente de las métricas que ve negocio: registrar todo con disciplina es lo que permite defender tiempos y esfuerzo en estabilidad.
- Se pidió ownership y probar a fondo antes de pasar a QA; las solicitudes de acceso a bases o servicios se piden por correo, como evidencia para certificaciones de seguridad.
- «On Vacation»: un comercio con línea CreditopX donde el cliente sólo pone OTP, se registra y en la pantalla de entidades ve la tarjeta CreditopX si pasó la política (si no, efectivo y tarjeta); Duncan Estrada lo probó en develop.

**Para contrastar con el código o los datos:**
- Cifras de esa semana: 36,36% de entregables a tiempo; tres incidentes críticos (certificado de Dentix, que se resolvió apagándolo; Welli, que no podía desembolsar por la fecha de nacimiento; fondo de garantías); disponibilidad 99,1% general y 99,7% interna; 33% de releases sin regresión y dos incidentes por release. El propio presentador dijo que algunos números estaban mal mapeados.
- Nombres corregidos: «Wally/Willy» → Welli (entidad); «Dentis/Dentics» → Dentix; «Créditox / crédito PX / BX» → CreditopX; «Lcky» → Loki. «On Vacation» se dejó como se oyó.

### 2026-07-24 · Capacitación

**De qué fue:** segunda capacitación de producto (Manuela Romero) sobre garantías, seguros, costos, políticas de riesgo y por qué priorizar un backoffice para parametrizar políticas.

**Lo que conviene saber:**
- Prestar es legal en Colombia mientras no se capte dinero del público y se respete la tasa de usura (mensual); la garantía es un costo adicional, no interés, y no entra en ese límite.
- El costo de la garantía y el costo administrativo del comercio se capitalizan: se suman al capital y el interés se calcula sobre el total (modelo «vencido», el que se usa); el alternativo es cobrarlos al inicio («anticipado»).
- El fondo de garantías se paga mes a mes por los créditos originados; con buena cartera, lo cobrado al cliente supera lo pagado al fondo.
- Seguro de vida opcional vía corredor con Seguros Mundial, ~2.000 pesos por millón de saldo en cada cuota; los seguros se calculan con la «foto» del saldo en la fecha de corte, el interés se causa a diario.
- Cuota inicial variable por comercio y perfil de riesgo, como mitigación; el pricing ajusta cuota inicial y garantía por perfil (premium hasta ~5 millones de cupo, otros ~1,5 millones).
- Política estándar: score ≥ 600, sin mora vigente > 60 días en ningún sector, y capacidad de pago = ingresos − gastos personales y financieros; la política «ácida» toma los gastos personales como 50% del ingreso (datos de Experian).
- Dolor principal: las políticas viven en JSON, sin versionado ni trazabilidad (los cambios se rastrean por correo) y cada cambio de un comercio exige editar a mano cinco tablas; implementarlas toma ~5 días.
- Decisión: priorizar un backoffice para que los CAMs configuren las políticas desde el front, con registro de quién cambió qué; primero una base estándar y luego condiciones avanzadas modulares.
- No se guarda qué política se aplicó al originar («pasó/no pasó»), lo que impide analizar las cosechas por política.
- Estrategia comercial: SaaS fijo más comisión transaccional; se entra como agregador (poco riesgo) y se sube a CreditopX, donde el comercio asume el 100% del riesgo. En la pantalla del asesor, los costos (garantía, seguro) irán en un desplegable para no espantar la venta.

**Para contrastar con el código o los datos:**
- Score ≥ 600, mora > 60 días y gastos al 50% de la política «ácida» contra la configuración real de las políticas.
- Que la garantía y el costo administrativo se capitalicen en el cálculo de cuota del código.
- Que el cambio de política toque cinco tablas y cuáles son; que el crédito rotativo tenga cinco niveles de riesgo no parametrizables.
- Error señalado en la reunión: el texto de tasa en la tarjeta de la entidad difiere de la tasa real; se propuso separar «tasa a mostrar» y «tasa real» y un booleano para ocultarla (SmartPay usa rangos por categoría).
- Nombres que quedaron como se oyeron: «Pulman/Pullman» (alguien que hizo más compleja la política de un comercio), «Mediarte»; «Crédito X» → CreditopX.

### 2026-07-31 · Bancolombia

**De qué fue:** traspaso técnico (Santiago Villaquiran a Miguel Ochoa) para que el código de compra del canal QR de Corbeta se genere y consulte por la API de Bancolombia en vez de directo contra Corbeta.

**Lo que conviene saber:**
- Hasta entonces CreditOp hablaba directo con Corbeta para generar y consultar los PIN del código de compra que el cliente paga en caja con QR; con el cambio, Bancolombia queda de intermediario y consume los servicios de Corbeta.
- La tarea es sólo de backend: cambiar en el controlador del código de compra la llamada a Corbeta por la de Bancolombia, sin tocar el front ni crear tablas, reutilizando validaciones y el código de facturación existentes.
- La consulta de Bancolombia va sin cuerpo: el código va en cabeceras y se usa el ID de transacción (antes, con Corbeta, iban fechas de inicio y fin).
- Hay que validar el estado de la orden (pendiente de facturar, cancelada, facturada); si ya está facturada, no se vuelve a mostrar el código.
- Los PIN valen 24 horas, pero la pantalla limita el pago hasta las 8:30 p. m. (las cajas cierran a las 9); esa lógica ya existía y no cambia.
- La documentación de la API está en el portal de Bancolombia, sección de APIs públicas («instore billing»).

**Para contrastar con el código o los datos:**
- Ubicación del cambio: el controlador del código de compra (`purchase code controller`) y `onboarding app / services / merchants`, según se dijo; confirmar en qué monolito quedó y si ya está en `main`.
- Los estados «pending invoice / cancelada / facturada», la vigencia de 24 h y el corte de 8:30 p. m.
