# Weekly CT

La reunión semanal de toda la compañía, resumida para quien trabaja en crédito: qué se quiere, cómo se va y qué se
decidió. **Son cosas dichas en la reunión, no medidas**: las cifras salen de notas automáticas (Gemini y Read AI) que se
equivocan con los nombres y a veces con los números. Antes de usar una cifra, medila en la base (`bin/pg sql`). Cómo se
arma y se pone al día: [README](README.md). Las notas crudas, fuera de git: `raw/weekly-ct/`.

Hay 19 reuniones, del 2025-12-16 al 2026-11-18. Faltan notas entre el 17 de febrero y el 4 de agosto.

## En una mirada

**Cómo cambió la estrategia** (según lo dicho):

| cuándo | qué se planteó |
|---|---|
| dic-2025 | Meta 2026: 500.000 millones de pesos en desembolsos (100.000 de CreditopX), burn de hasta US$100.000 al mes, equilibrio en julio, Serie A de US$10–15 millones. Foco B2C y cuatro industrias: celulares, colchones, salud y electrodomésticos |
| feb-2026 | Se cancela la ronda intermedia, se congelan contrataciones y se concentra en CreditopX y el agregador; CreditOp como «riel de crédito». Urge ajustar la política de score, que rechazaba perfiles AAA |
| ago-2026 | Primer millón de dólares de ingreso anualizado. Giro a *product-led growth*: premium y freemium el 1 de octubre; prioridad máxima a VTEX y Shopify; no más entidades sin un agregador estándar |
| sep-2026 | Ronda de US$6–10 millones, bajada a ~3. Metas: US$1,2 millones de ingreso al cierre del trimestre y 2,5 millones anualizados en marzo de 2027. Dos product owners (agregador y CreditopX). Club Creditop (la app) el 15 de octubre |
| oct-2026 | Registro gratis de comercios y cobro por desembolso. Se adelanta la ronda y se sube el burn; después, control de gasto y equilibrio con o sin ronda. Se prioriza la migración de arquitectura y se reorganiza tecnología. Motai deja el renting, que sigue con Alta |
| nov-2026 | CreditOp no presta ni asume riesgo de balance. Meta: un billón de pesos al año en desembolsos a junio de 2028, con 600 comercios y 20 entidades. Ronda de al menos US$3 millones para Perú y México. Un agente de IA base para todas las áreas |

**Cómo vino el negocio** (cifras dichas; las dudosas, en cada semana):

| semana | desembolsos | ingreso anualizado | caja y burn |
|---|---|---|---|
| 2025-12-16 | 15.000–20.000 millones de pesos al mes (agregador) | — | burn hasta US$100.000/mes |
| 2026-02-17 | 89 % de la meta (CreditopX, sobre la meta) | — | ~8.000 millones de caja, ~500 millones/mes de consumo |
| 2026-08-04 | 13.494 de 13.500 millones | US$805.000–820.000 | — |
| 2026-08-24 | — | ~US$1 millón | — |
| 2026-09-23 | 15.000–16.000 millones en el mes (récord) | US$1,2 millones sin Motai | US$1,8 millones, ~US$60.000/mes |
| 2026-09-30 | 76 % de la meta | — | — |
| 2026-10-07 | metas: 15.000 (oct), 17.000 (nov), 18.000 (dic) | > US$1 millón por primera vez | burn sube a 500 millones de pesos/mes |
| 2026-10-28 | agregador 93 %, CreditopX 141 % | ingresos al 105 % | 12 meses de caja |
| 2026-11-11 | ~US$5 millones al mes | US$1,2 millones | bajar a ~US$100.000/mes |
| 2026-11-18 | CreditopX 4.770 contra 4.200 millones (112 %); agregador 93 % | — | — |

**Lo que toca a Loan Origination**, a lo largo del año: la validación de identidad (el mayor dolor en el punto de
venta, y en noviembre la razón de que la app venda poco), el OTP y la fricción del registro, VTEX y Shopify plug and
play, el auto-onboarding de comercios, que toda entidad nueva funcione en todos los canales, el refactor (todos los
puntos de venta forzados a él) y la migración de arquitectura.

## Semana a semana

### 2026-11-18

**Fuentes:** Gemini · Read AI

**Cifras (según la reunión):**
- CreditopX: desembolsos de 4.770 millones contra una meta de 4.200 millones (112 %); se espera superar el 150 % de la meta de noviembre. Agregador al 93 % de lo esperado a la fecha. Cobranza: unos 150 millones recuperados en el mes.
- Comercios: Pullman cerca de su meta de 700–800 millones al mes; Motai proyectado en unos 900 millones; Mario Hernández supera los 100 millones en el mes, con más adopción que Free Spirit.
- Aplicación (lanzada el 15 de octubre): más de 27.000 descargas, 7.000 sesiones diarias, 33 ventas (ticket promedio «1.700», take rate cercano al 4 %) contra una meta anual de 1.000; 8 % de pagos por la app.
- Meta a 18 meses: 40.000 millones de pesos de ingresos anuales desembolsando un billón de pesos.

**Decisiones:**
- Un agente de IA base, de extremo a extremo, cuyas capacidades se cocrean con cada área.
- Ronda: se negocian términos con cuatro fondos por al menos US$3 millones, para Perú y México; no cambia el objetivo de equilibrio de Colombia.

**Prioridades de producto y crédito:**
- Prepararse para el pico de Black Friday: solicitudes, soporte e infraestructura.
- Lanzamientos: Finandina, Brilla (electrodomésticos y celulares para diciembre), Credifamilia Materiales y la originación desde la app; en la app, e-commerce para Pullman y Refurbi, pago de cuotas y retanqueo.

**Tareas que tocan a tecnología o producto:**
- Enviar los requerimientos funcionales por rol para la nueva plataforma de autogestión (el equipo).
- Investigar por qué falla la validación de identidad en la app y recoger feedback de los primeros compradores (el grupo); guía paso a paso de navegación (Kevin, Alejandra Schwarz).
- Revisar el flujo de caja de Free Spirit para que pueda crecer en colocación (Juan Camilo Rodríguez).

**Para contrastar:**
- Desembolsos de CreditopX: Gemini dice 4,77 mil millones; Read AI, 4.700 millones y «meta semanal»; la transcripción dice «la meta de la semana pasada».
- Meta a 18 meses: Gemini dice «10 millones de dólares» de ingresos; Read AI, «desembolsar 1.000 millones de pesos». La transcripción dice 40.000 millones de pesos de ingresos y un billón de pesos en desembolsos.
- El ticket promedio de la app (1.700) se dijo sin unidad. «MUT y Cacique» (Gemini) contra Motai (Read AI) para los 900 millones: no está claro si Cacique es otro comercio. El contrato con «Electroello»/«Electrovello» queda con el nombre sin confirmar.

### 2026-11-11

**Fuentes:** Read AI

**Cifras (según la reunión):**
- Histórico: US$80 millones desembolsados, US$1,2 millones de ingresos anualizados, más de 100.000 créditos, 12 entidades y 200 comercios.
- Desembolsos actuales de unos US$5 millones al mes; las entidades actuales podrían sostener hasta US$30 millones mensuales.
- Unos 1.000 usuarios nuevos al día a costo cero.
- Meta: un billón de pesos anuales en desembolsos al 30 de junio de 2028, con 600 comercios, 20 entidades y dos millones de usuarios; take rate de largo plazo del 5 %.
- Ronda: levantar al menos US$3 millones con una valoración de US$30 millones.

**Decisiones:**
- No ser prestamista ni asumir riesgo de balance; crecer impulsado por producto y monetizar con crédito propio de los comercios o comisiones de entidades.
- Reducir la sobreinversión mensual hacia US$100.000 sin depender de la ronda; congelar contrataciones con el equipo actual.
- Daniel Garzón sigue como CEO, enfocado en personas, financiación y cohesión; nueva estructura por bloques (Growth, Revenue Ops, Platform).

**Prioridades de producto y crédito:**
- Aplicación para pagar cuotas, construir historial y comprar en varios canales; liquidez para comercios; integraciones con ERP para simplificar la redención del crédito.
- Expansión: Perú (Ethan, meta de tres entidades y 100 comercios el primer año) y negociaciones en México, con sociedades rentables desde el primer día.
- Una persona nueva en crédito para impulsar la adopción en tiendas físicas y llevar el feedback de los comercios a producto.

### 2026-10-28

**Fuentes:** Gemini

**Cifras (según la reunión):**
- Ingresos: cumplimiento proyectado del 105 %.
- Desembolsos de la semana: agregador 93 %; CreditopX 141 %, empujado por Motai y Refurbi al 170 % de lo proyectado (mejoras en e-commerce, producto y política de riesgo).
- Welli: una negociación con Sonría podría subir su facturación hacia CreditOp un 30–40 % mensual.
- Caja asegurada para 12 meses de operación; fecha límite del 8 de noviembre para recibir términos de algún fondo.

**Decisiones:**
- Control estricto del gasto y búsqueda del punto de equilibrio con o sin ronda; se congelan contrataciones en tecnología (sí entran tres en comercial y una en customer).
- Reorganización de tecnología: Hans y José en arquitectura; Óscar lidera multilender y core; Laura, la aplicación y CreditopX.
- Jira y Confluence se cancelan y se migran a Notion antes del 9 de noviembre.

**Prioridades de producto y crédito:**
- Aplicación: unificar el cupo de crédito por persona en lugar de por comercio; meta de 76 compras en la semana; campaña de tres meses sin intereses; convertir primero a usuarios de la base antes de pauta masiva.
- Entidades: arranca el desarrollo de Finandina materiales (primero para Pullman); sale Alta con renting controlado; Ábaco con flujo para trabajadores de apps (Rappi, Uber, Didi); Credifamilia Materiales espera aprobación; Rapid Crédit no lanza este año y apuesta por un BNPL.
- Perú con BCP: piloto en noviembre–enero con el comercio SOCOPUR, crédito de consumo y vehicular, proyecto prioritario.
- Black Friday (noviembre, el mes de más ventas): estrategia comercial y de onboarding para comercios (Marcela Osorio) y cronograma de marketing (Yuly Chacon).

**Para contrastar:**
- «Wel»/«Willy» → Welli; «Mota» → Motai; «Credit Familia» → Credifamilia. «Alta Financiera» podría ser Alta Fleet (renting de motos): sin confirmar.
- Sin confirmar: «Sonría», «Cuchones» (segundo comercio para Finandina), «Rapid Crédit» y «SOCOPUR» quedan como vienen.

### 2026-10-21

**Fuentes:** Read AI

**Cifras (según la reunión):**
- A mitad de octubre: facturación cerca del 150 % de la meta; desembolsos cerca del 110 % en agregador y CreditopX.

**Decisiones:**
- El proceso de alta (auto onboarding de comercios) recibió aprobación para pasar a producción.

**Prioridades de producto y crédito:**
- MVP de auto onboarding: registro de comercios, verificación KYB y envío de contratos automatizados.
- Aplicación: una semana para corregir errores y recoger comentarios antes de ampliar la promoción (cuotas sin intereses desde la semana siguiente; Instagram, correo y WhatsApp).
- Se prioriza VTEX y se publicará el nuevo flujo de Refurbi tras más pruebas.
- CreditopX incorporará firmas digitales.
- Perú con BCP: integraciones de crédito de consumo y vehicular, con prioridad para consumo; tecnología arma una arquitectura más robusta para escalar.
- Ronda: se esperaba una propuesta de financiación en aproximadamente un mes.

**Tareas que tocan a tecnología o producto:**
- Reunir con Fabian los documentos de las entidades necesarios para las pruebas de auto onboarding (Manuela Romero).
- Probar la aplicación y reportar errores a Alejandra (el equipo).

**Para contrastar:**
- Nombres corregidos en esta tanda: «Crédito X» / «Crédito PX» → CreditopX; «Mutai» → Motai; «Pulman» → Pullman; «Vitex» → VTEX; «BSP en Perú» → BCP (Banco de Crédito del Perú).
- «Refurbi» (también «Refurb», «Refurby») se deja como viene: no se pudo confirmar el nombre exacto del comercio.

### 2026-10-14

**Fuentes:** Gemini · Read AI

**Cifras (según la reunión):**
- Electrobello: arrancaría con unos 1.000 millones de pesos en CreditopX y escalaría a 3.000–4.000 millones mensuales (unos 40.000 millones anuales en desembolsos y 100 millones de ingresos al mes).
- Anuncio de acuerdos de crédito por más de 100 millones de dólares con 11 entidades (Bancolombia, Nequi, Finandina, entre otras) para sumar más de 5.000 comercios.

**Decisiones:**
- Ir de lleno a la ronda; el cierre se adelanta a fin de mes en lugar del 8 de noviembre, sujeto a las métricas y al due diligence de los fondos.
- Priorizar la migración a una arquitectura escalable (Oscar y Laura, sumando a Yamid y José), sin contratar un CTO en la etapa previa a la ronda.
- Modelo product-led: registro gratis de comercios y cobro por volumen de desembolsos.
- Cada persona debe tener al menos cinco agentes de IA al cierre del trimestre; Duncan lidera la adopción.

**Prioridades de producto y crédito:**
- App: salida esta semana con CreditopX (venta asistida y tienda física), tres meses de salud financiera gratis y tres meses sin interés desde el 26 de octubre; segunda fase el 15 de noviembre con más entidades y redirección a Refurbi y Pullman.
- Esta semana sale el flujo oficial de renting con Alta (con revisión en el administrador); el producto de materiales de Credifamilia, a principios de noviembre, para reactivar comercios como Corona.

**Tareas que tocan a tecnología o producto:**
- Corregir el formulario de registro de comercios: la categoría «Automotriz» aparece fija en producción (Manuela Romero, con Customer).
- Todo el equipo: validar identidad y originar un crédito en producción con la app, y reportar en Slack (la validación falló por un documento cruzado entre cuentas).
- Juan Camilo Rodríguez: cerrar la firma de Electrobello; Cencosud tiene aprobación legal y falta compliance (unos 15 días).

**Para contrastar:**
- «Sencosud» / «Senkosud» se tomó como Cencosud; Electrobello viene también como «Electrovello». Gemini dice «Creditop Familia» y Read AI «crédito Pequis»: se tomó Credifamilia y CreditopX, sin confirmar.
- Oscar Rincón presentó «Centinela» (pruebas automatizadas con agentes que reportan por Slack); Read AI lo llama «Sentinela».

### 2026-10-07

**Fuentes:** Gemini · Read AI

**Cifras (según la reunión):**
- Se superó por primera vez 1 millón de dólares de facturación anualizada.
- Burn: subir a 500 millones de pesos mensuales (costos operativos de 600 millones, quema promedio de 250 millones), como si la ronda ya estuviera levantada.
- Narrativa para fondos: de 50 a 350 millones de dólares anualizados en desembolsos (x7) y 10 millones de dólares de ingresos; 200 comercios trajeron medio millón de usuarios.
- Metas de desembolsos: 15.000 millones de pesos en octubre, 17.000 en noviembre (Black Friday) y 18.000 en diciembre.
- Ingresos: 420 millones de pesos a diciembre (1,5 millones de dólares anualizados), contra unos 300 millones actuales.
- Línea de liquidez de 200.000 millones de pesos para que los comercios adelanten hasta el 50% de los pagarés originados (incubada con 4.500 millones propios).

**Decisiones:**
- Pasar de una estrategia liderada por ventas a una liderada por producto: ventas capta comercios con modelo transaccional sin cobro de software; Customer Success activa y profundiza.

**Prioridades de producto y crédito:**
- MVP de la app el 15 de octubre con todos los comercios de CreditopX (venta asistida y tienda física), con piloto previo en tienda (Pullman, Refurbi o Motai).
- Entidades: Finandina, Credifamilia (contrato de agregación por firmar) y 365; Brilla es la de mejor conversión y apoya el proyecto Costa Caribe (30 a 40 millones).

**Tareas que tocan a tecnología o producto:**
- Manuela Romero: piloto del flujo de autogestión de comercios y nuevo flujo de e-commerce para Refurbi; Juan Camilo: entidades plug and play con firma electrónica en el auto-onboarding.

**Para contrastar:**
- Gemini dice «52.000 millones de pesos mensuales» de desembolsos, pero el desglose (15.000 + 17.000 + 18.000) suma 50.000 en el trimestre.
- Read AI habla de unos 5.500 millones de pesos en caja; Gemini no da la cifra.
- Embudo citado: Cosud (¿Cencosud?), Electrobello y Flamingo por 10 millones de dólares. Read AI escribe «CrayFamilia» (Credifamilia) y «Paramil» (sin identificar).

### 2026-09-30

**Fuentes:** Gemini · Read AI

**Cifras (según la reunión):**
- Facturación: cierre del mes entre 290 y 310 millones de pesos contra una meta de 348 millones; meta de diciembre, 440 millones de pesos; faltan 140 millones adicionales.
- Desembolsos: cumplimiento del 76%, con 81% en comercios existentes y 7,9% en comercios nuevos.
- Ventas: 80% de cumplimiento del área; el premium subió la conversión de comercios; la pauta en Meta cerró unos 40 comercios, sólo 4 o 5 funcionales.
- Refurbi cierra el mes entre 130 y 140 millones de pesos, con pérdida operativa (mucho tráfico, pocos desembolsos).
- Tecnología: disponibilidad de 99,97%, seis semanas sobre 99,9%; entregas semanales de 5 a 7,8 iniciativas.

**Decisiones:**
- Motai canceló el renting con CreditOp (tomó la tecnología de otro fondeador); el producto se ofrecerá con Alta Financiera.
- Forzar a todos los comercios de punto de venta al refactor y dejar aliados.credito; después, e-commerce (primero VTEX, Shopify tarda más).
- Foco comercial en comercios medianos y en un premium simplificado, evaluando cobro transaccional en vez de SaaS.
- Producto se divide en producto técnico (básicos, app, soporte) y operaciones crediticias; nace un área de mercadeo de crédito.

**Prioridades de producto y crédito:**
- Nueva campaña «compra ahora y empieza a pagar en enero» desde el 20 de octubre; en Crédito Pullman, mejorar e-commerce e incentivar asesores; bajar la fricción de la cuota inicial en «Crédito Betis».

**Tareas que tocan a tecnología o producto:**
- Oscar Rincón, Marcela Osorio y Laura Cabra: definir el requerimiento de premium frente a gratuito en el nuevo administrador (su fecha de lanzamiento quedó sin confirmar).

**Para contrastar:**
- Meta del MVP de la app: 50.000 descargas y 500 compras (60.000 y 1.000 a diciembre), contra 30.000 descargas dichas el 2026-09-23.
- «Crédito Betis» viene así en las dos fuentes y en la transcripción: no se identificó el producto. Se corrigió «Pulman» → Pullman; «Deltics» / «Déntix» → Dentix y «Incodol» quedan sin confirmar.

### 2026-09-23

**Fuentes:** Gemini · Read AI

**Cifras (según la reunión):**
- Desembolsos: récord del mes proyectado entre 15.000 y 16.000 millones de pesos (+30%), con ingreso anualizado de 1,2 millones de dólares sin contar a Motai.
- Caja de 1,8 millones de dólares y quema promedio de 60.000 dólares mensuales; escalar sin ronda la subiría a unos 150.000 dólares.
- App: 25.000 usuarios en la app y 400.000 registros; ticket de 2 millones de pesos con 7% de comisión (140.000 pesos por compra); 500 compras al mes serían 250.000 dólares anuales.
- Más de 500 pagos de cuotas por la app tras corregir el botón de pago.

**Decisiones:**
- Escalar con recursos propios, sin depender de la ronda, aceptando un burn más alto.
- MVP del Club Creditop el 15 de octubre: meta de 30.000 descargas y 500 compras entre el 15 de octubre y el 30 de noviembre, por venta asistida y tienda física (Pullman entre los primeros), con código alfanumérico para rastrear la compra.
- Toda integración de entidad nueva debe funcionar en todos los canales, también en la app, desde el inicio; reutilizar la fluidez del flujo nativo de la app en el flujo de crédito.

**Prioridades de producto y crédito:**
- Lanzado Crédito 365 con Dentix como primer comercio; integración de Nequi; luego Brilla, Rapid Credit, Credifamilia y Finandina. Credibanco queda en pausa hasta renegociar condiciones.

**Tareas que tocan a tecnología o producto:**
- Retrospectiva de Producto y Tecnología para estandarizar procesos y asignar dueños por dominio (propuesta de Hans Castellar).
- Juan Camilo Rodríguez: definir los comercios para venta asistida y Experian.

**Para contrastar:**
- Read AI escribe «Aurilla», «Credit Familia» y «Credibanko»; se tomó Brilla, Credifamilia y Credibanco. «Dentics» → Dentix (no confirmado).

### 2026-09-16

**Fuentes:** Gemini · Read AI

**Cifras (según la reunión):**
- Ingresos: cerrar el mes con 1,2 millones de dólares anualizados; apuesta de 1 millón de dólares adicional profundizando cuentas actuales en 21 meses.
- Nuevos contratos: unos 150.000 dólares anuales en firma y meta de 3 millones de dólares anuales (Pep Ganga, Challenger, Colsanitas, Payless, Electrolux).
- App: al menos 80.000 dólares mensuales en comisiones; Perú apunta a 5 millones de dólares mensuales en desembolsos.
- Caja de 1,7 millones de dólares y quema de 100.000 dólares mensuales: 12 a 15 meses de vida; la ronda cuesta por las expectativas de múltiplos.
- Unos 100 millones de pesos perdidos en transferencias equivocadas a comercios.

**Decisiones:**
- Crecer a unas 45 personas fijas y consolidar orden y estructura durante seis meses antes de acelerar.
- Customer Success se parte en onboarding y account managers (CAMs); ventas automatiza comercios pequeños y atiende con asesores medianos, grandes y corporativos.
- Dos Product Owners bajo Manuela Romero: uno para el agregador y otro para CreditopX; ella ejecuta el 100% de las prioridades de los proyectos nuevos.
- Alianza con VTEX para un marketplace de unos 3.000 comercios en la app, con primera versión el 1 de octubre.

**Tareas que tocan a tecnología o producto:**
- Productizar el onboarding de comercios: bienvenida, capacitación, parametrización, vinculación de entidades y políticas de CreditopX.
- Miguel Ochoa presentó Canon (grafo de conocimiento técnico y de negocio leído del código, consumido por Credibot); el equipo debe validar qué conocimiento falta y mantenerlo al día.

**Para contrastar:**
- Se corrigió «Crédito PX» / «Credit PX» → CreditopX y «Vitex» → VTEX.

### 2026-09-09

**Fuentes:** Gemini · Read AI

**Cifras (según la reunión):**
- Meta: 1,2 millones de dólares de ingreso al cierre del trimestre y 2,5 millones anualizados en marzo de 2027.
- Caja de 1,7 a 1,8 millones de dólares con un gasto de unos 70.000 dólares al mes.
- 400.000 usuarios con 200 comercios; con 5.000 comercios se estima llegar a 3–4 millones de usuarios en Colombia (Read AI).

**Decisiones:**
- La expansión intencional a Centroamérica espera a cerrar acuerdos con la banca regional (BAC, como en Perú).
- Pendiente: hacer una ronda menor o esperar a marzo depende del cierre financiero del mes.

**Prioridades de producto y crédito:**
- Cerrar las brechas de tecnología y Customer Success que mostraron Refurb y Motai antes de la etapa del 1 de octubre.
- Ventas: entraron Arturo Calle, Mario Hernández y Odonto Family; mesas abiertas con grandes cuentas (Colsanitas, entre otras).

**Tareas que tocan a tecnología o producto:**
- Que el onboarding automático funcione, las entidades operen y los comercios entren y conviertan (producto y tecnología).
- Plan de seis meses por área hacia los 2,5 millones; un KPI norte y tres de seguimiento por persona.

**Para contrastar:**
- Ronda inicial: Gemini dice 3 millones de dólares; Read AI, entre 3 y 4.
- Retail 100: Gemini dice Cartagena; Read AI, Panamá. Cliente: «Coscerámicas» (Gemini) contra «Decor Cerámica» (Read AI).
- Read AI pone una meta comercial de «10 millones de pesos», que no cierra con el resto. «Creditable» y «CreditUp» son CreditOp.

### 2026-09-02

**Fuentes:** Gemini · Read AI

**Cifras (según la reunión):**
- 60 millones de dólares de volumen anualizado (unos 5 millones al mes en desembolsos), 500.000 transacciones, 200 comercios y 350.000 usuarios orgánicos.
- Ronda: arrancar por 6 millones de dólares con aspiración a 10, valoración objetivo de 40 millones (Read AI); 24 meses de caja.
- A 18 meses: 500 millones de dólares anualizados en volumen y 10 millones de ingreso, con 1.000 comercios (300 premium, 700 gratis).

**Decisiones:**
- Se pasa de un modelo 100% de venta SaaS a product-led growth; entra una Growth Strategist (Alejandra Schwarz) entre Revenue y Producto.
- Producto: Manuela hace los PRD y la relación con stakeholders; Viviana pasa a ser el contacto técnico y responde por las fechas con tecnología.
- Nequi se lanza con un simulador, sin esperar su API (prevista para diciembre); el pago deja elegir saldo Nequi o crédito.

**Prioridades de producto y crédito:**
- Defender 3 millones de dólares de ingreso accionable con contratos antes del 1 de octubre; reducir la dependencia de comercios y entidades puntuales (Motai, Cencosud).
- Perú: estabilizar 3 millones de dólares de desembolsos con 15 comercios y BCP.
- Fricción del registro (90 días): 5.337 de ~40.000 usuarios no terminaron el formulario y 1.748 fallaron el OTP; bajar la pérdida del 12% al 8% (contactar a 20 que abandonaron, mejorar el mensaje del OTP).

**Para contrastar:**
- «Neki», «NEI» y «Niki» se corrigieron a Nequi; «Sencosut» a Cencosud; «Cibot» es Credibot, que quedó como herramienta oficial de datos.
- Gemini atribuye la presentación a «Manuela Romero Santamaría», cuya cuenta es juanfelipe@: el orador puede estar mal atribuido.

### 2026-08-24

**Fuentes:** Gemini · Read AI

**Cifras (según la reunión):**
- Se alcanzó el primer millón de dólares de ingreso anualizado; meta de 10 millones de dólares en 18 meses (junio de 2028).
- Motai: línea de crédito aprobada, mínimo un millón de dólares anualizado. Credifamilia aceptó el modelo agregador con un mandato de 10.000 millones al mes.
- Varios frentes de ~1 millón de dólares cada uno: Experian (premium y comercios en Mi DataCrédito) y una unidad de celulares (Huawei, Xiaomi).

**Decisiones:**
- Giro a product-led growth: prospección y demanda automatizadas.
- Producto premium (y freemium) el 1 de octubre con las entidades disponibles; el MVP de esa fecha incluye mejor onboarding y escalar 10x la pauta.

**Prioridades de producto y crédito:**
- Desbloquear las integraciones nativas de VTEX y Shopify (prioridad máxima) y automatizar la conexión de entidades en e-commerce.
- Integrar Experian y pagos antes de lo premium; un agente de Customer Success para la adopción de comercios.
- Rappi: financiación sin intereses en tiendas físicas, cobrando comisión sobre el volumen conciliado por archivo plano; el contrato no está cerrado.

**Tareas que tocan a tecnología o producto:**
- Santi: despliegue plug-and-play de entidades en VTEX y Shopify y conectar el auto-onboarding de comercios (KYB por APIs, matriz de riesgo 0–10, hoy sobre una base espejo).
- Juan Camilo: que las entidades integradas operen plug-and-play en e-commerce y tienda física.

**Para contrastar:**
- Celulares: Gemini dice un millón de dólares en 18 meses; Read AI, en 12 meses.
- Read AI dice «cerca de» el millón anualizado; Gemini, que ya se alcanzó. «Rapi» se corrigió a Rappi.

### 2026-08-04

**Fuentes:** Read AI

**Cifras (según la reunión):**
- Desembolsos: 13.494 de una meta de 13.500 millones.
- Ingreso anualizado entre 805.000 y 820.000 (dólares, se entiende), sobre los 800.000 y camino a la meta de 1,2 millones.
- Conversión en entidades con preaprobado en 80%; cartera vencida en 60%.
- Ventas al 70% de cumplimiento en nuevas facturas SaaS; firmada la entidad «Neki» y dos cierres más en trámite.

**Decisiones:**
- No se firman más entidades sin un agregador estándar; se estandariza el protocolo de integración entre canales.
- Se contrata un especialista en cobranza para saldos de más de 90 días.
- Se sigue con la ronda aunque el asesor (Collide) aconseja posponerla por tener caja suficiente.

**Prioridades de producto y crédito:**
- 1) Producto gratis plug-and-play con al menos 15 entidades para escalar comercios; 2) e-commerce, con 40% del esfuerzo; 3) la app, con 10%.
- Perú es estratégico: memo mensual de reporting con recomendaciones replicables.

**Tareas que tocan a tecnología o producto:**
- Producto estandariza y documenta el protocolo de integración de entidades para todos los canales.

**Para contrastar:**
- No hay nota de Gemini de esta fecha. «Neki» puede ser Nequi: se dejó como viene.
- La cartera vencida «en 60%» suena alta para ser un índice de mora; puede ser otra medida.

### 2026-02-17

**Fuentes:** Gemini

**Cifras (según la reunión):**
- Desembolsos totales al 89% de cumplimiento; los de CreditopX, en sobrecumplimiento.
- Ventas: sólo el 40% del pipeline original se puede cerrar, un hueco de unos 1.000 millones recurrentes.
- Caja de unos 8.000 millones de pesos con un consumo de unos 500 millones al mes: vida de 10 a 12 meses.
- Para una Serie A ordenada se piden al menos 2 millones (de dólares) de facturación anual.

**Decisiones:**
- CreditOp se concentra en sus dos productos, CreditopX y el agregador; nada de tropicalizaciones profundas salvo que traigan ingresos para la ronda.
- El 30% del tiempo de Tech va a terminar el refactor desde el próximo sprint.
- Ventas deja de medirse por mandatos: se mide por el ingreso que genera cada crédito.
- Se congelan las contrataciones hasta el punto de equilibrio, con julio como fecha para evaluarlo.

**Prioridades de producto y crédito:**
- Que los clientes nuevos salgan a producción lo antes posible para cerrar el hueco de ingresos.
- La app se lanza el 2 de marzo: comercios CreditopX primero (quién presta y cuánto) y al resto los invita a la tienda; premium y consultas ilimitadas gratis por ahora, sin cobro del score.

**Tareas que tocan a tecnología o producto:**
- Dejar la app probable el viernes con un solo paquete, todos los comercios y las entidades de CreditopX (Mauricio Pacheco).

**Para contrastar:**
- Gemini escribe «crédito B X»: se corrigió a CreditopX. Credifamilia aceptó el modelo CreditopX con particularidades; Flamingo dio un «sí» sin firmar.

### 2026-02-10

**Fuentes:** Gemini

**Cifras (según la reunión):**
- Sonría, primer cliente, es cerca del 50% de los desembolsos y deja 250–300 millones de pesos al año; está en riesgo porque Addi, Meddipay y otra entidad se integraron a Dental Link.
- Operaciones: 144% en facturación de comercios de CreditopX, 112% en comercios CreditopX y 91% en desembolsos totales; el indicador de cartera mayor a 30 días está en 112%.
- Meta de «patch/PH» presupuestada en 3.100.000 (sin unidad clara) contaba con Addi y Sistecrédito, que ya no están; queda Bancolombia y quizá Banco de Bogotá.

**Decisiones:**
- Se cancela la ronda intermedia; hay que ir a la principal con números sólidos y rentabilidad en julio.
- Producto se reparte: Manuela Romero, nuevos negocios; Mafe y Vivi, estabilidad y product-market fit.
- Reenfocar en CreditopX: el squad de Yamid pasa a CreditopX tras el sprint de Bancolombia y se mueve la fecha de Smartlink.
- Visión: Creditop como «riel de crédito» para comercios y entidades no líderes, no como agregador de terceros; no cobrarles a las entidades por integrarse.

**Prioridades de producto y crédito:**
- Urgente: ajustar la política de score, que rechaza perfiles AAA (caso en Pullman), aunque se frene Finandina; tasas de bajo monto para comercios.
- Tecnología: validación del OTP, extracción de datos de usuario, refactor de Bancolombia y migración a microservicios.
- Free Spirit entró sólo con CreditopX; expansión exploratoria con Global 66 y un banco de Panamá.

**Para contrastar:**
- Cierres comerciales: «uno de 8.790.000 pesos» y «Alfa con 5 millones de pesos» al mes; montos y nombres dudosos («Alfa» podría ser Alta Financiera).
- «Credit Pullman»: se entiende el crédito en Pullman; «Fre Spirit» → Free Spirit, «ADI» → Addi, «Siste Crédito» → Sistecrédito.

### 2026-01-27

**Fuentes:** Gemini

**Cifras (según la reunión):**
- Semáforo de cumplimiento general al 92%, con sobrecumplimiento en facturación transaccional de lenders, CreditopX y recurrente total.
- Tecnología al 50% del sprint (medido de otra forma, 25%).
- Finandina: potencial de 100.000 millones de pesos de desembolsos al mes, tickets de más de un millón; contrato sin firmar.
- Aprobación: Finandina ~20% frente a ~50% de Welli y Meddipay.
- Ronda interna de US$3 millones más US$1,5 millones para extender la pista a 10–12 meses.

**Decisiones:**
- Los desembolsos pasan a ser métrica de Operaciones; Producto tendrá métricas nuevas.
- «Mis Créditos» premium en la app con datos de Experian (permitido, incluso para reventa), a 9.900 pesos por consulta mensual; operado a mano al inicio.

**Prioridades de producto y crédito:**
- CreditopX en tienda física: cupo visible en la app y código dinámico o de barras que el comercio usa en caja.
- Ofrecer a entidades aprobación, pagaré y cuotas sin que ellas validen identidad; la validación de identidad es el mayor dolor en punto de compra.
- Piloto con Tu Boleta (cuota inicial de 60%, buscando 50%); Cencosud presupuestado para el 1 de junio; primeros créditos de cupo rotativo con un comercio de Cali.

**Tareas que tocan a tecnología o producto:**
- Lógica de plan de usuario premium en backend; el front sólo pinta el botón (Mauricio Pacheco).

**Para contrastar:**
- Se corrigió «Wel» → Welli y «Medipay» → Meddipay; «Banco Gota», «Pay»/«Pello», «Wom» y el comercio de Cali «Josh» (mandato inicial de «30», sin unidad) quedan como vienen.

### 2025-12-30

**Fuentes:** Gemini

**Cifras (según la reunión):**
- Cierre del trimestre: desembolsos al 75% de la meta y facturación al 99,8%.
- Facturación dic-2024 vs dic-2025 creció 3,6 veces, contra una meta inicial de 7 veces.
- CreditopX creció 3.369% de enero a diciembre; la facturación recurrente SaaS creció 67% pero pesa menos en el total.
- El 80% de los ingresos sale de sólo 10 comercios.
- Mediarte aprobó un mandato que podría crecer a 500 millones de pesos al mes y dejar ~400 millones de pesos de ingresos al año.

**Decisiones:**
- Preparar una ronda Serie A de US$10–15 millones, demostrando escalabilidad con crecimiento predecible (meta de crecimiento 10x).
- Verticalizar en cuatro industrias foco: celulares, colchones, salud y electrodomésticos (~500.000 comercios ICP en Colombia).

**Prioridades de producto y crédito:**
- El agregador (entidades y comercios) como entrada para luego profundizar CreditopX en los comercios.
- Llevar el modelo Mediarte a todo el sector de cirugía estética y salud.
- Escalar la política de crédito y la validación de identidad (algunas aprobaciones siguen siendo manuales).

**Para contrastar:**
- Se espera el contrato de «Sencosut» (probablemente Cencosud).
- Mediarte: Gemini dice «6 millones de pesos al año» en financiamiento propio; con 500 millones al mes serían más bien 6.000 millones.
- Rumor de que «Caea» abriría en Colombia: nombre no identificado.

### 2025-12-23

**Fuentes:** Gemini

**Cifras (según la reunión):**
- Desembolsos de diciembre proyectados en 10.000–11.000 millones de pesos, ~2.000 millones menos que noviembre (Garzón estimó hasta 3.500–4.000 millones menos).
- La meta de facturación del trimestre podría cumplirse por el sobrecumplimiento de noviembre; la facturación recurrente de diciembre se ve baja.
- Cartera CreditopX: clientes en mora bajaron de 370 a 222 (~30%) al corte del día 16; mora de la célula 12,18%.
- Cierres comerciales pendientes con mandatos de ~1.700–1.800 millones de pesos en CreditopX.

**Decisiones:**
- La app sale el 30 de diciembre como web app y en Android, sujeta a pruebas internas (Mauricio Pacheco).
- Landing de preregistro de la app con un año de score gratis como gancho (Juliana Oyuela).

**Prioridades de producto y crédito:**
- Arranca el cliente de República Dominicana (opera como entidad; piloto con conexión a una pasarela).
- Firmó Alta Financiera: modelo tipo Motai para financiar motos del sector productivo, sólo originación (sin cobranza).
- Aprovechar la baja de operación de fin de año (salud y colchones caen) para resolver incidencias y planear 2026.

**Tareas que tocan a tecnología o producto:**
- Reporte de mora por rangos (0-30, 30-60…) porque el sistema clasifica mal a algunos clientes en las franjas (Andrés Camilo Moncada).

**Para contrastar:**
- La caída de diciembre se atribuye a no desplegar «Pash» / «grupo PAS» / «patch» (el nombre no es claro en la transcripción).
- «17 millones en firmas de contrato» (Daniel Rodríguez): la unidad no cierra; puede ser otra cifra.
- «costú» probablemente es Cencosud (en 2025-12-30 aparece como «Sencosut»); no confirmado.

### 2025-12-16

**Fuentes:** Gemini

**Cifras (según la reunión):**
- Base actual del agregador con comercios grandes: 15.000–20.000 millones de pesos de desembolsos al mes (~250.000 millones anualizados).
- Meta 2026: 500.000 millones de pesos en desembolsos, de ellos 100.000 millones de CreditopX; 500.000 transacciones y 500.000 usuarios nuevos (base actual: 250.000 usuarios).
- Ingresos mínimos 2026: 12.000 millones de pesos, sin contar versiones premium.
- Burn de caja limitado a máximo US$100.000 al mes desde enero; punto de equilibrio en julio, sin depender de la ronda.

**Decisiones:**
- Se corrigió un error en las metas de desembolsos, que habían quedado demasiado conservadoras.
- Cambio de foco hacia un producto B2C, con más exigencia en calidad de producto y mensaje de marca; contratar agencia de relaciones públicas.
- Nuevo organigrama (metodología EOS): Producto lo lideran María Fernanda Parra (agregador/app) y Viviana Rodríguez (CreditopX); datos y UX/UI dan servicio a Producto; Manuela Romero lidera operación con métrica norte de desembolsos.
- Tecnología, liderada por Yamid Viloria, se organiza en squads: Comercios, Onboarding, CreditopX, Entidades y Platform.
- Desde 2026 el weekly tendrá 10 min de datos, 10 de producto, 10 de reflexión y 30 de All-Hands.

**Para contrastar:**
- Gemini escribe «Crédito PX»; se corrigió a CreditopX en toda la tanda (también «Creditopex», «Crédito APX», «Crédito X»).
