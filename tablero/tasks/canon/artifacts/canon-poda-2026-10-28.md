# Canon: poda sección por sección (propuesta, sin aplicar)

Clasificadas 630 unidades (575 secciones + introducciones) con dos filtros: F1 se verifica en main · F2 sirve en el día a día.

| acción | unidades |
|---|---|
| mantener | 421 |
| reescribir | 131 |
| fundir | 41 |
| mover | 14 |
| sacar | 13 |
| dar-area | 10 |

F1: si 552, parcial 62, no 16 · F2: media 274, alta 324, baja 32

## Por tema

- **actores/context** — 3 unidades · mantener 3  
  _Dejar; corto y útil como mapa de niveles de configuración._
- **agregador/context** — 1 unidades · mantener 1  
  _Sólo trae la introducción en este lote; si no tiene secciones, es un índice: dejarlo como tal o fundirlo en entidad/context._
- **ambientes/operar** — 7 unidades · mantener 6, fundir 1  
  _Dejar; fundir la de producción por tag en la de cuatro ambientes._
- **arquitectura/context** — 15 unidades · mantener 8, fundir 2, reescribir 2, mover 2, sacar 1  
  _Dejar como mapa de los dos monolitos; sacar lo que es de ambientes (modo QA) y observabilidad; absorber la intro de plataforma._
- **arrendamiento/context** — 11 unidades · mantener 6, reescribir 2, fundir 2, mover 1  
  _Dejarlo; fundir las dos del recorrido y la del id por ambiente; mover los recordatorios semanales a cartera._
- **asesor/context** — 3 unidades · mantener 3  
  _Llenar: cómo se vincula a sucursales y qué ve, cómo se le inicia sesión, por qué no ve una solicitud, qué pasa al cambiarlo de sucursal._
- **backoffice/context** — 22 unidades · mantener 13, mover 4, reescribir 3, dar-area 2  
  _Partir: los tres de formularios van a formularios/context y el de Cognito a auth. Queda backoffice como editor de reglas, readiness, ficha de persona y admin viejo; sigue siendo grande pero coherente._
- **bancolombia/context** — 20 unidades · mantener 14, reescribir 6  
  _Dejar; reescribir títulos crípticos y separar la parte de Corbeta/caja (QR) si crece._
- **bcp/context** — 10 unidades · mantener 7, reescribir 2, fundir 1  
  _Dejar; fundir la sección de cifrado en la del sobre y quitar mediciones de prod de los títulos._
- **canales/context** — 3 unidades · mantener 3  
  _Dejar; dos secciones sólidas. Podría llenarse con: ¿cómo sé por qué canal entró esta solicitud?, QR de caja vs tienda._
- **cartera/context** — 39 unidades · mantener 26, reescribir 12, fundir 1  
  _Grande (39) y sana; partir en dos: deuda y ciclo (causación, corte, colilla, estados) y pagos y recaudo (aplicación, rotativo, reportes, pasarela). Recibir los recordatorios semanales de arrendamiento._
- **cliente/context** — 1 unidades · mantener 1  
  _Llenar o fundir: casi vacío. Preguntas: cómo se identifica (celular vs documento), qué pasa al cambiar celular, cliente desactivado y re-registro, dónde vive su ficha. Si no, fundir en datos/context._
- **codeudor/context** — 6 unidades · mantener 3, reescribir 2, fundir 1  
  _Dejar; fundir la sección corta de render en la de firma cruzada y quitar historia del estado 17._
- **comercio/context** — 9 unidades · mantener 5, fundir 3, reescribir 1  
  _Llenar la intro y consolidar: absorber deshabilitado en onboarding o al revés (una sola), fundir dos secciones en quitar-una-entidad. Preguntas: ¿cómo doy de alta un comercio?, ¿por qué no aparece una entidad?_
- **credenciales/context** — 8 unidades · mantener 8  
  _Dejar tal cual: secciones concretas, verificables y útiles al cargar o depurar accesos._
- **credifamilia/context** — 18 unidades · mantener 16, fundir 1, reescribir 1  
  _Dejar; sólo fundir la regla de ocupación y corregir el título de la espera. Bien anclado en código._
- **credito365/context** — 6 unidades · mantener 5, reescribir 1  
  _Dejar: denso, verificable y de alto valor; sólo una nota sin verificar para limpiar._
- **creditop/context** — 1 unidades · fundir 1  
  _Sólo intro: fundir en actores/context o llenar con preguntas reales del equipo (qué puede configurar el backoffice, qué hace soporte y con qué permisos)._
- **creditopx/context** — 23 unidades · mantener 17, reescribir 3, fundir 2, mover 1  
  _Partir: el bloque de cartera/cobro (subsidio, pagos, facturación, canales, historial) va a un tema propio o a cartera; dejar en creditopx motor, cupo, reglas y avisos._
- **cuota/context** — 13 unidades · mantener 10, reescribir 1, mover 1, dar-area 1  
  _Dejar; sacar la de edad a categorías. Las tres de cuota inicial se solapan: conviene una sección índice que las ordene (política, cobro, tarjeta)._
- **datos/context** — 16 unidades · mantener 14, sacar 1, reescribir 1  
  _Dejar; agrupa trampas de lectura de la base. Considerar mover «dos filas de unión» a comercio/context y partir la ficha en blanco._
- **documentos/context** — 14 unidades · reescribir 7, mantener 6, dar-area 1  
  _Dejar; títulos a conclusión, dar área al armador por producto y limpiar crónica de CrediPullman._
- **ecommerce/context** — 13 unidades · mantener 8, reescribir 5  
  _Dejar; partir las tres secciones largas (pedido-vínculo, cuota inicial en tienda, auto-onboarding) en piezas de una conclusión. Está bien cubierto._
- **entidad/context** — 3 unidades · mantener 3  
  _Casi vacío (3): llenar con ¿qué tipo de respuesta tiene esta entidad y dónde se ve?, ¿qué pasa al desactivarla?, ¿qué configuración es de la entidad vs del comercio o sucursal?_
- **finanzas/context** — 1 unidades · fundir 1  
  _Sólo intro sin contenido verificable: fundir con negocio/context salvo que se llene con conciliación y costos que el código implemente._
- **formalizacion/context** — 25 unidades · mantener 21, reescribir 3, fundir 1  
  _Partir: pagaré y depósito (8 secciones) a un subtema propio; el resto (cierre, estados, escritorio, fechas) queda. Fundir la sección genérica de validación/cancelación._
- **formularios/context** — 9 unidades · mantener 7, reescribir 2  
  _Dejar; partir «formulario dinámico son dos cosas» en paso vs canal, y reescribir el diagnóstico de ingreso fijo como tabla que enlace la condición exacta._
- **fronteras/context** — 9 unidades · mantener 4, reescribir 4, dar-area 1  
  _Dejar; partir la sección del sobre; las de Prami/alta de orden podrían ir al tema de la entidad o de webhooks._
- **imei/context** — 18 unidades · mantener 9, reescribir 6, fundir 3  
  _Dejar con limpieza: fundir resumen del desbloqueo y la sección «fuera de producción»; títulos crípticos a conclusión._
- **infraestructura/operar** — 8 unidades · reescribir 5, mantener 3  
  _Dejar; quitar crónica de la migración de cuentas y partir la de tmpfs (secretos, OTel)._
- **internacionalizacion/context** — 12 unidades · mantener 7, reescribir 2, sacar 1, fundir 1, dar-area 1  
  _Dejar; sacar la sección de alcance, fundir la de BCP en bcp/context y corregir la de columnas de código con nombres reales._
- **kyc/context** — 32 unidades · mantener 21, reescribir 8, fundir 2, sacar 1  
  _Partir en dos: «buró y centrales» (disparador, pipeline, reuso, ingresos, egresos, TusDatos) e «identidad» (ADO, CrossCore, Evidente, respaldo, captura). 32 secciones mezclan dos preguntas distintas del día a día._
- **listado/context** — 30 unidades · mantener 19, reescribir 5, fundir 4, sacar 2  
  _Dejar pero podar: fundir las genéricas a intro/diagnóstico, sacar las vagas y nombrar ids/archivos en las que callan qué comercio o par. 30 secciones; tras la poda quedan unas 24._
- **local/operar** — 10 unidades · mantener 7, reescribir 1, fundir 1, sacar 1  
  _Dejar: muy útil. Quitar conteos nominales de archivos que vencen y la sección de workers de PHP (harness, no código)._
- **meddipay/context** — 8 unidades · mantener 6, reescribir 2  
  _Dejarlo; está completo. Sólo retitular dos secciones._
- **mobile/context** — 7 unidades · mantener 3, dar-area 3, reescribir 1  
  _Dejar y llenar áreas: cuatro secciones sin área. Faltan preguntas reales: qué endpoints usa cada pantalla, versionado/despliegue de la app, cómo se cachea el perfil._
- **negocio/context** — 3 unidades · mantener 1, sacar 1, reescribir 1  
  _Casi vacío y sin respaldo en código: fundir con actores/context o llenar con negocio implementado (quién pone capital por tipo de entidad, qué configura el comercio)._
- **nequi/context** — 18 unidades · mantener 17, fundir 1  
  _Dejar; fundir la sección de autorización con monto completo en la de monto final._
- **observabilidad/operar** — 16 unidades · mantener 7, reescribir 7, fundir 1, sacar 1  
  _Dejar, con limpieza: sacar el método genérico de Loki, partir la sección de prefijos y quitar mediciones. Los códigos de respuesta podrían ir a un tema propio de contrato de errores._
- **onboarding/context** — 23 unidades · mantener 16, reescribir 5, sacar 1, fundir 1  
  _Partir: el KYC/pipeline (secciones de pipeline, verificación, identidad) en un subtema propio; el resto (entradas, nacimiento, códigos de app, guardas) queda en onboarding._
- **perfilamiento/context** — 15 unidades · reescribir 7, mantener 6, fundir 1, dar-area 1  
  _Dejarlo; fundir las dos de categoría, concretar las secciones vagas (gemelos, pocos comercios, Dentix, celdas del rotativo) y recibir los logs de rechazo desde vocabulario._
- **plataforma/context** — 1 unidades · fundir 1  
  _Sólo índice: fundir en arquitectura/context._
- **preaprobado/context** — 13 unidades · reescribir 5, mantener 5, fundir 2, mover 1  
  _Reescribir: varias secciones abstractas y duplicadas (exclusiones, booleano). Fundir 83→84 y 90→89, mover Welli. Llenar con: qué tipo de respuesta usa el servicio y cómo leer su error por etapa._
- **producto/context** — 1 unidades · mantener 1  
  _Casi vacío (sólo intro índice): fundir con actores o llenar con ¿qué producto es esta solicitud y dónde se decide?, CreditopX vs externa._
- **redireccion/context** — 1 unidades · mantener 1  
  _Sólo introducción: fundirlo con entidad/context, o llenarlo con cómo se arma el enlace de campaña, qué estado queda la solicitud y si vuelve algún aviso._
- **renting/context** — 2 unidades · mantener 2  
  _Casi vacío: llenarlo con ¿cómo se calcula la tarifa?, ¿qué estados tiene?, ¿qué pasa al devolver el bien?, o fundir con arrendamiento/context._
- **repos/operar** — 8 unidades · reescribir 3, mantener 2, fundir 1, mover 1, sacar 1  
  _Adelgazar: una sola lista de repos y servicios; mover el perfilamiento del cliente a kyc, sacar lo interno de canon, y quitar conteos del registro de deuda._
- **rto/context** — 4 unidades · mantener 2, reescribir 2  
  _Dejar; pequeño y verificable. Podría fundirse con renting/context si éste cubre los mismos documentos._
- **salud-financiera/context** — 10 unidades · mantener 7, reescribir 2, mover 1  
  _Llenar la intro; mover lo de premium/RevenueCat a un tema nuevo de beneficios (entitlement-service) y dejar aquí cálculo, fuentes y CreditopX→financial_health.full._
- **servicios/context** — 21 unidades · mantener 15, reescribir 5, fundir 1  
  _Dejar; podría partirse en mensajería, códigos (OTP) y PDF, que son tres servicios con dueños distintos. Fundir la frase de configuración en canales._
- **solicitud/context** — 1 unidades · mantener 1  
  _Casi vacío (sólo intro): fundir con onboarding/formalizacion como índice o llenar con estados de la solicitud y cómo leer su recorrido._
- **soporte/context** — 4 unidades · mantener 3, reescribir 1  
  _Dejar; corregir tildes en las tres secciones y fundir con fronteras la capa conversacional externa o enlazarla._
- **sucursal/context** — 9 unidades · mantener 7, sacar 1, fundir 1  
  _Dejar; fundir la pantalla de otorgamiento en «no hay herencia viva» y sacar el selector de ciudad._
- **vocabulario/context** — 37 unidades · mantener 27, reescribir 4, fundir 3, mover 2, sacar 1  
  _Dejarlo como glosario de entradas cortas: sacar a perfilamiento los dos diagnósticos de logs largos, fundir las dos entradas que repiten perfilamiento y la de síntoma vs mecanismo en la intro._
- **welli/context** — 9 unidades · mantener 8, reescribir 1  
  _Dejar; bien acotado. Quitar configuración de prod por comercio._

## Sacar (13)

- `vocabulario/context` · [Triage] · las queries guardadas  
  Consultas guardadas de Redash: no es código de main; además habla del corpus.
- `repos/operar` · Dónde vive cada cosa en canon  
  Describe el funcionamiento interno de canon, no el sistema de CreditOp.
- `arquitectura/context` · Operar fuera de Colombia abre su propio tema  
  Sólo un puntero a internacionalizacion; no aporta conocimiento.
- `observabilidad/operar` · Contar logs no cuenta solicitudes ni rechazos  
  Método genérico de leer conteos de Loki; no depende del código ni tiene área. Va a la guía de herramientas, no a canon.
- `local/operar` · Correr varios casos a la vez en local: el servidor de PHP atiende de a uno  
  PHP_CLI_SERVER_WORKERS no está en main del backend; es preparación del harness local, no conocimiento del código.
- `kyc/context` · La alerta de «Experian no responde» dice más de lo que mide  
  Habla de una alerta y su consulta fuera del código de main; procedimiento manual de triage, no regla del sistema.
- `datos/context` · El registro del paso a estudio lo escribe un procedimiento de la base  
  Reparación de datos puntual (migrate.sql) que nada lee; título no coincide con el contenido; la lección general ya está en «parte de la lógica vive en la base».
- `negocio/context` · A la entidad también se le cobra, y lo que se le vende no es sólo el cliente  
  Modelo comercial que el código no implementa ni verifica; la propia sección lo declara.
- `listado/context` · Ver opciones no es elegirlas  
  Consejo de análisis de embudo; no depende del código.
- `listado/context` · El producto determina el cupo y el modo no filtra la oferta  
  Vaga; lo que dice ya está en las secciones de filtros y en Credifamilia.
- `sucursal/context` · El punto de venta se ubica por departamento y después por ciudad  
  Detalle de UI del selector de ciudad; no ayuda en tareas ni depuración.
- `onboarding/context` · Cómo medir dónde se detienen las solicitudes  
  Procedimiento de medición sin regla de código; no dice nada verificable en main.
- `internacionalizacion/context` · Que cubre este tema, y que todavia no  
  Repite la intro y declara un hueco («dos países no descrito»); no aporta regla.

## Fundir (41)

- `cartera/context` · La cuota del cambio de condiciones la resuelve el backend → `cartera/context#cambiar-el-plazo-el-chequeo-que-excluye-vive-en-el-listado-no-en-el-que-aplica`  
  Dos frases que ya están implícitas en la media barrera del plazo.
- `vocabulario/context` · Subir el ingreso no hace que salgan más entidades → `perfilamiento/context#el-ingreso-no-decide-quien-aparece`  
  Repite la sección de perfilamiento; título contradice su propio texto («depende»).
- `vocabulario/context` · Pasó el buró pero la entidad no apareció → `perfilamiento/context#la-categoria-corre-al-final-y-es-la-que-manda`  
  Repite la sección de categoría; dejar sólo como alias.
- `vocabulario/context` · Un reclamo llega por lo que se vio, y el corpus está escrito por mecanismo → `vocabulario/context#__intro`  
  Repite la introducción; no describe código.
- `perfilamiento/context` · La categoría es la primera que se cumple entera, en el orden de prioridad → `perfilamiento/context#la-categoria-corre-al-final-y-es-la-que-manda`  
  Las dos dicen lo mismo; conservar el ancla enlazada desde varios temas.
- `repos/operar` · Qué microservicios hay → `repos/operar#que-repos-hay-y-que-hace-cada-uno`  
  Repite la lista de repos; «canon todavía no lo cubre» es futuro.
- `arrendamiento/context` · El recorrido lo decide el backend paso a paso, y cada paso se prende por entidad → `arrendamiento/context#el-recorrido-de-punta-a-punta-con-cada-trampa-apuntada`  
  Repite el paso 2 del recorrido.
- `arrendamiento/context` · El mismo id no es la misma entidad en otro ambiente, y lo que cambia no son sólo los números → `arrendamiento/context#la-cuota-sale-de-una-calculadora-que-es-un-dato-y-su-config-no-viaja-con-el-codigo`  
  Misma idea: la config es del ambiente; una frase basta allí.
- `creditopx/context` · De quién es la plata, que es lo que explica todo lo demás → `creditopx/context#__intro`  
  Repite la intro (comercio pone capital, Creditop decide); sumar la línea del riesgo a la intro.
- `creditopx/context` · Una entidad que no consulta pre-aprobados no es un error: la diferencia entre «no aplica» y «se rompió» → `preaprobado/context#la-compuerta-de-preaprobacion-decide-si-se-consulta`  
  Repite la compuerta de preaprobación; dejar sólo el enlace desde la sección de rechazo.
- `imei/context` · El bloqueo evita repetir pedidos para un equipo en el mismo día → `imei/context#el-servicio-despues-del-desembolso-dos-motores-sus-crons-y-la-mora-la-produce-el-monolito-viejo`  
  Dos protecciones contra despachos repetidos; detalle del bloqueo programado.
- `imei/context` · El pago puede activar el desbloqueo, pero no lo garantiza → `imei/context#como-se-evalua-el-desbloqueo-despues-de-un-pago`  
  Resumen de la sección siguiente; dejar el primer párrafo como apertura de esa.
- `imei/context` · Fuera de producción → `imei/context#quien-decide-que-es-smartpay-nueve-sitios-tres-sabores`  
  Repite que los ids de SmartPay divergen fuera de prod; el mock del administrador cabe allí.
- `arquitectura/context` · Dos sistemas activos con responsabilidades distintas → `arquitectura/context#__intro`  
  Repite la intro (dos backends activos, viejo pantallas, nuevo APIs).
- `arquitectura/context` · Apagar el sistema viejo exige cubrir avisos y operación programada → `arquitectura/context#quien-atiende-que-hoy`  
  Habla de apagar el viejo (futuro); lo útil, tareas en ambos relojes y loan-servicing, cabe en el reparto.
- `bcp/context` · El cifrado del sobre: dos pares de resumenes, y ninguno confirmado → `bcp/context#que-viaja-en-el-sobre-y-que-se-cifra-en-cada-direccion`  
  Parámetros de relleno configurables; «ninguno confirmado» y la doc del banco no son de main.
- `codeudor/context` · La firma distingue al codeudor y sus documentos → `codeudor/context#la-sesion-del-codeudor-la-manda-el-token-y-la-firma-es-cruzada`  
  Detalle del render y correo del codeudor; complementa la firma cruzada.
- `finanzas/context` · (introducción del tema) → `negocio/context`  
  Nodo vacío: dice que no tiene tarifas ni márgenes; nada verificable en main.
- `plataforma/context` · (introducción del tema) → `arquitectura/context#__intro`  
  Sólo índice de otros temas; el reparto ya lo explica arquitectura.
- `observabilidad/operar` · Para el caso puntual: las consultas guardadas de Triage → `vocabulario/context#triage-las-queries-guardadas`  
  Sólo remite a las queries de triage de Redash; no es código y repite el destino.
- `servicios/context` · Su configuración no está en la base del monolito → `servicios/context#cada-canal-tiene-su-proveedor-y-cada-uno-falla-por-su-lado`  
  Una sola frase; agregarla como cierre de la sección de canales.
- `local/operar` · En dev y staging las centrales de riesgo no las atiende el proveedor → `kyc/context#en-los-entornos-de-prueba-al-buro-lo-atiende-un-impostor-pero-el-interruptor-no-es-el-ambiente`  
  Repite la sección de kyc y su título contradice el cuerpo.
- `preaprobado/context` · Cinco entidades excluidas del preaprobado a mano en el sistema nuevo, cuatro en el viejo → `preaprobado/context#y-dentro-del-sistema-nuevo-hay-dos-puntos-con-listas-distintas`  
  Las dos secciones describen la misma lista de exclusión; una sola con nuevo vs viejo y las dos copias.
- `preaprobado/context` · Dos límites del booleano del preaprobado, del lado del frente → `preaprobado/context#la-compuerta-de-preaprobacion-decide-si-se-consulta`  
  El null-se-consulta del frente es el complemento de la compuerta; título opaco.
- `kyc/context` · Las reglas de salto preceden a la ventana de frecuencia → `kyc/context#el-disparador-de-experian-decide-por-etapas-y-la-frecuencia-es-uno-de-cada-n`  
  El disparador ya dice que el bypass autoriza antes de la frecuencia, fuerza Acierta+Quanto y no toca el contador.
- `kyc/context` · Si a todos les sale el mismo score, el buró no está contestando de verdad → `kyc/context#en-los-entornos-de-prueba-al-buro-lo-atiende-un-impostor-pero-el-interruptor-no-es-el-ambiente`  
  El título contradice el texto (score repetido no prueba simulación); los orígenes posibles ya están en la sección del impostor.
- `ambientes/operar` · Producción no se despliega al mergear: se despliega al taguear → `ambientes/operar#cuatro-ambientes-y-la-rama-que-dispara-cada-uno`  
  Ya dice producción ← tag; sumar allí los workflows manuales y «main no es producción».
- `creditop/context` · (introducción del tema) → `actores/context`  
  Sólo enlaces a backoffice y soporte; repite lo que actores/context ubica.
- `listado/context` · Por dónde pasa todo → `listado/context#__intro`  
  Genérica; sólo aporta el puntero a Bancolombia, que cabe en la intro.
- `listado/context` · Y el vacío de verdad no dice por qué → `listado/context#no-le-salio-nada-son-dos-cosas-distintas-y-solo-una-es-de-verdad`  
  No se lee sola («y el vacío…»); es la continuación de la anterior.
- `listado/context` · El historial del perfilamiento puede conservar reglas de una corrida anterior → `listado/context#el-ultimo-guardado-del-perfilamiento-es-lo-que-vio-el-cliente-una-entidad-oculta-desaparece-y-una-no-aprobada-queda-en-cero`  
  Las dos describen cómo se escribe profiling_reviews; juntar en una sola sección por camino.
- `listado/context` · Cambiarle el país a una entidad la saca del listado de todos los comercios del país viejo → `listado/context#el-pais-del-comercio-recorta-la-oferta-y-el-pais-1-pasa-siempre`  
  Consecuencia directa del filtro de país; sin área; un párrafo en la otra.
- `credifamilia/context` · La regla de ocupación clasifica — no excluye → `credifamilia/context#no-aparece-en-el-listado-primero-mira-que-puerta`  
  Repite clasificación vs contrato del proveedor, ya dicho en esa sección y en la del cupo.
- `sucursal/context` · La pantalla de otorgamiento escribe reglas de entidad y sucursal → `sucursal/context#no-hay-herencia-viva-las-reglas-se-copian`  
  Repite el segundo punto de esa sección; sumar su porqué (cupo vs listado divergen).
- `onboarding/context` · El formulario reemplaza el tipo de documento pendiente → `internacionalizacion/context#el-tipo-de-documento-con-que-nace-una-ficha-sale-del-catalogo-del-pais-no-del-de-la-sucursal`  
  Repite el tipo de documento centinela/principal del país; dejar sólo el enlace desde onboarding.
- `formalizacion/context` · «Validación exitosa» y «solicitud cancelada» a la vez → `formalizacion/context#el-estado-final-no-prueba-todo-lo-que-parece`  
  Genérica, sin mecanismo concreto; cabe como una frase en estado-final-no-prueba-todo.
- `internacionalizacion/context` · La primera entidad de afuera no reusa el camino de las demas → `bcp/context#__intro`  
  Sólo resume BCP y remite allá; dejar el enlace en la intro.
- `nequi/context` · Un pago aprobado deja la solicitud en «Autorizada» con el monto completo y sin cuota inicial → `nequi/context#el-monto-reportado-por-nequi-prevalece-el-solicitado-es-un-respaldo`  
  Repite intro y monto final; una sola sección sobre el efecto del pago aprobado.
- `comercio/context` · En qué orden se configura un comercio: habilitar no baja, quitar sí → `comercio/context#quitar-una-entidad-del-comercio-borra-garantias-de-la-entidad-y-permisos-creditopx-y-guardar-la-sucursal-exige-el-convenio-por-efecto-lateral`  
  Habilitar no baja / quitar sí está contenido en quitar-una-entidad; dejar ahí la frase resumen.
- `comercio/context` · La configuración comercial ya está en los dos sistemas, y eso es el riesgo → `comercio/context#quitar-una-entidad-del-comercio-borra-garantias-de-la-entidad-y-permisos-creditopx-y-guardar-la-sucursal-exige-el-convenio-por-efecto-lateral`  
  Dice que las dos pantallas difieren sin decir en qué; la diferencia concreta está en quitar-una-entidad.
- `comercio/context` · Un comercio deshabilitado no origina en el monolito nuevo, y sólo en algunas puertas → `onboarding/context#un-comercio-deshabilitado-no-origina-solicitudes-nuevas-en-el-monolito-nuevo-pero-las-que-estan-en-curso-terminan`  
  Misma regla que onboarding (comercio deshabilitado); trae crónica «hasta que existió esta regla».

## Mover (14)

- `vocabulario/context` · CATEGORY_RULE_REJECTED → `perfilamiento/context`  
  283 palabras de mecanismo; en vocabulario dejar dos líneas y el enlace.
- `vocabulario/context` · QUOTA_CHECK_REJECTED · REVOLVING_CREDIT_REJECTED → `perfilamiento/context`  
  Mecanismo de lectura de logs de cupo; dejar entrada corta en el glosario.
- `repos/operar` · El perfilamiento del cliente: seis centrales sobre Temporal, y el veredicto lo da el monolito NUEVO → `kyc/context`  
  Describe el estudio del cliente; lo buscaría quien depura KYC, no quien busca un repo.
- `arrendamiento/context` · El cobro semanal tiene su propio comando de recordatorios, y el sistema viejo no lo atiende → `cartera/context`  
  Recordatorios de cobranza por corte: lo busca quien depura cartera, no arrendamiento.
- `creditopx/context` · Facturación y recaudo compara cuotas cortadas con pagos del mes, no cuota por cuota → `cartera/context`  
  Pantalla de facturación y recaudo; un lector la buscaría junto a los reportes de recaudo de cartera.
- `arquitectura/context` · El volumen de registros NO mide importancia: mide latidos → `observabilidad/operar`  
  Consejo de lectura de logs (latidos del balanceador), no se deduce del código de main.
- `arquitectura/context` · En el ambiente de pruebas hay usuarios reales, y los mensajes se enrutan para no mezclarlos → `ambientes/operar`  
  Enrutamiento de mensajes en modo QA; se busca al probar en ambientes, no en arquitectura.
- `backoffice/context` · Los cuatro puntos donde puede aparecer un formulario, y quien resuelve cada uno → `formularios/context`  
  Los cuatro puntos de formulario son del formulario dinámico, no del backoffice; ahí lo busca quien depura un formulario.
- `backoffice/context` · Lo mas especifico gana, y gana ENTERO: los niveles no se mezclan → `formularios/context`  
  Precedencia sucursal/comercio de formularios: pertenece a formularios, junto a los cuatro puntos.
- `backoffice/context` · El flujo alterno se enciende en el comercio y los formularios se cuelgan de la sucursal → `formularios/context`  
  Mover con los puntos de formulario; quitar el «caso real» del comercio de pruebas (crónica) y dejar la regla y sus excepciones.
- `backoffice/context` · El pool de Cognito lo elige el pedido, y dos operaciones quedan fuera del límite estricto → `auth/context`  
  Pools de Cognito y rate limit de Modules/Auth no son del backoffice; van al tema de autenticación.
- `preaprobado/context` · Una sola consulta decide cual de las dos variantes de esa entidad aplica → `welli/context`  
  Riesgo compartido vs tasa plena por la comisión es de Welli.
- `cuota/context` · La edad tiene dos caminos de evaluación con límites distintos → `listado/context (o el tema de categorías de cliente)`  
  Trata de la regla de edad de categorías (LenderUserCategoryService), no de la cuota; el título no dice la conclusión.
- `salud-financiera/context` · El acceso premium sale de los grants vigentes que traen `premium.access`, y una suscripción sandbox no cuenta en producción → `beneficios/context (tema nuevo de entitlement-service)`  
  Es del servicio de beneficios (premium, RevenueCat, sandbox), no de salud financiera.

## Darle área (10)

- `perfilamiento/context` · Hay un criterio de perfil que cuenta cuentas embargadas, y su ausencia deja pasar → `legacy-backend:Modules/Loans/App/Services/LenderUserCategoryService.php; legacy-backend:Modules/Loans/App/Services/RiskPolicy/RiskPolicyRawData.php`  
  Verificado en main: sólo el monolito nuevo (seized_accounts); decirlo, no está en legacy-application.
- `documentos/context` · El producto determina cómo se arma el documento → `legacy-backend:Modules/Loans/App/Services/DocumentGeneration/CatalogDocumentPayloadResolver.php`  
  Describe la selección de armador por producto/entidad; sin área que la vigile.
- `backoffice/context` · Guardar la política de una entidad por primera vez tiene que crear también los clones de sus sucursales → `legacy-backend:Modules/Backoffice/App/Services/LenderRulesWriterService.php; legacy-backend:Modules/Backoffice/App/Services/LenderConfigService.php`  
  Plantilla + clones al primer guardado; el writer documenta clones por sucursal en la transacción.
- `backoffice/context` · Listo para operar son cinco chequeos, y dos no bloquean a propósito → `legacy-backend:Modules/Backoffice/App/Services/LenderReadinessService.php`  
  Los cinco chequeos de readiness viven en LenderReadinessService (y su test de rotativo).
- `mobile/context` · Arquitectura y frontera entre paquetes e infraestructura → `creditop_mobile:app/lib/config/dependency_injection.dart; creditop_mobile:packages/`  
  Frontera hexagonal y Riverpod; sin área.
- `mobile/context` · Entrada, OTP y vida de la sesión → `creditop_mobile:app/lib/infrastructure/onboarding/gateways/onboarding_gateway_impl.dart; legacy-backend:Modules/MobileOnboardingV1/routes/api.php`  
  Arranque, OTP y renovación de sesión; sin área.
- `mobile/context` · Qué backend usa mobile y dónde investigar un síntoma → `creditop_mobile:app/lib/config/environment_config.dart; creditop_mobile:app/lib/infrastructure/`  
  Dónde investigar un síntoma móvil; quitar «todavía depende».
- `fronteras/context` · Dos rutas que niegan una solicitud y le fijan el monto, con la puerta abierta hasta que alguien ponga la llave → `legacy-backend:Modules/Onboarding/routes/webhooks.php`  
  Respaldada por el comentario de webhooks.php (internal.bff); acortar el título.
- `cuota/context` · Hay una entidad cuyo costo de financiación vive en un factor por plazo, y sin él sale a costo cero → `legacy-backend:Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService.php`  
  Respaldo en PaymentCalculationService (factor por plazo, test de Asyco); nombrar la entidad y la tabla del factor.
- `internacionalizacion/context` · El tipo de documento con que nace una ficha sale del catálogo del PAÍS, no del de la sucursal → `alta del usuario temporal en legacy-backend (Modules/Onboarding / UserRequestV1) donde se resuelve el tipo principal del país`  
  Sin área; absorbe la sección gemela de onboarding.

## Reescribir (131)

- `cartera/context` · El reverso de un pago retenido depende del catálogo  
  Quitar «este fallo concreto…» (alude a un incidente); dejar la dependencia del tipo «PAGO REVERSADO» y qué rama la usa.
- `cartera/context` · Los procesos nocturnos: si uno no corre, el crédito se queda como estaba  
  Título no dice la conclusión (worker lanza en secuencia, fallo no frena); sacar el párrafo del recordatorio dominicano a su sección.
- `cartera/context` · El tipo de movimiento está vacío en casi todas las filas  
  Título con cuantificación («casi todas»): decir «la causación diaria no lleva tipo de movimiento».
- `cartera/context` · «Paz y salvo» con saldo, y pagos que no desbloquean  
  Título no coincide con el contenido (registrar vs aplicar, orden de retenidos); recortar el párrafo IMEI a un enlace.
- `cartera/context` · Cambiarle la fecha de pago a un crédito vivo no siempre queda  
  Quitar «llega varias veces por mes»; ordenar: mecanismo corte-fecha primero, luego los tres rechazos y días por periodicidad; sin ⚠⚠.
- `cartera/context` · El rotativo tiene reparaciones, umbral residual y corte semanal  
  Junta cuatro cosas; dejar reparaciones y botón del portal, llevar corte semanal a la sección de la deuda diaria.
- `cartera/context` · Cambiar el plazo: el chequeo que excluye vive en el LISTADO, no en el que aplica  
  Falta tildes, frase cortada («excluye cuatro cosas —…—» sin cierre); tono coloquial; dejar las tres puertas en tabla.
- `cartera/context` · La condonación conserva la fianza y el pago mínimo acumula sus cuotas  
  Mezcla copia de fila, acumulación en mínimo y auditoría Slack; partir o enfocar en qué arrastra la condonación.
- `cartera/context` · Reglas contables para actualizar el estado  
  Título genérico: decir la conclusión (al día exige exigible en cero exacto, sin seguro de garantía ni cobranza).
- `cartera/context` · El cliente paga solo en la pantalla pública de pago, buscando su crédito por documento  
  Quitar el «ya no muestran nada propio» (crónica); describir sólo que esas rutas del viejo redirigen.
- `cartera/context` · Un mínimo ya pagado que quedó en mora se regulariza esa noche  
  Quitar «sin ese redondeo… dejaba un residuo» (historia del bug); dejar redondeo a 4 decimales y las dos corridas.
- `cartera/context` · La cuota inicial queda en el registro de pagos, en línea o en caja, y no es un abono al crédito  
  510 palabras: el relleno de cuotas «anteriores a esta regla» es crónica; la tarjeta del panel podría ir a la sección de reportes.
- `vocabulario/context` · Llamadas de cobro / cobranza  
  Afirma que las llamadas las dispara el estado del sistema; no se ve en el código quién llama: citar la fuente o suavizar.
- `vocabulario/context` · Sonría  
  Primera frase sobre contar volumen sobra; corregir la sintaxis del override de Welli (no-elegible mostrado como aprobado).
- `vocabulario/context` · Nequi  
  Quitar el id 192 (varía por ambiente) y el detalle que ya está en nequi/context; dejar definición y enlace.
- `vocabulario/context` · Solicitud, por dentro: la tabla user_requests y su estado  
  «los treinta estados de este glosario»: el glosario no los lista; corregir la referencia o enlazar al tema que sí.
- `perfilamiento/context` · La categoría corre al final, y es la que manda  
  Recibir la de orden de prioridad; título debería decir «gana la primera categoría que cumple todas sus reglas; sin ella no hay oferta».
- `perfilamiento/context` · El piso de ingreso filtra la categoría  
  El párrafo de excepciones de buró es vago: nombrar qué configuración y país, o sacarlo.
- `perfilamiento/context` · El ingreso no decide quién aparece  
  El título contradice el texto (el ingreso sí puede hacer aparecer); retitular.
- `perfilamiento/context` · En unos pocos comercios, fallar las reglas duras no saca a la entidad de la casa  
  No nombra la configuración que lo permite; «unos pocos» es medición. Título con el mecanismo.
- `perfilamiento/context` · Hay dos gemelos corriendo, y el que leés no siempre es el que corre  
  Metáfora sin contenido operativo: decir cómo saber qué monolito atendió la solicitud.
- `perfilamiento/context` · El puntaje del rotativo tiene celdas que rompen su propio piso  
  El título promete celdas que rompen el piso y el texto no las muestra; concretar o retitular.
- `perfilamiento/context` · El otorgamiento especial de DENTIX reemplaza el cupo de la categoría, y sus topes por score están en el código  
  No se lee sola: «las bandas están en el mapa de esta sección»; poner las bandas o el archivo.
- `repos/operar` · Qué repos hay y qué hace cada uno  
  Absorber la lista de microservicios; quitar las menciones al alcance de canon.
- `repos/operar` · La API de comercios lee la base heredada y orquesta el codeudor  
  Primera frase meta («la portada describe…»); título y apertura con lo que hace merchant-api.
- `repos/operar` · Cada módulo del sistema nuevo lleva escrito lo que está mal a propósito  
  Conteos (tres, diecisiete, catorce) envejecen: dejar la regla deuda vs desviación y dónde se lee.
- `arrendamiento/context` · El ciclo se espeja hacia el servicio del proveedor, sin que el embudo dependa de él  
  «reemplaza la selección por un id fijo de entidad» no se entiende; explicar qué marcador y dónde.
- `arrendamiento/context` · El recorrido de punta a punta, con cada trampa apuntada  
  El título promete trampas que no hay; retitular «el backend decide cada paso» y absorber la sección paso a paso.
- `meddipay/context` · Qué es, y en qué comercios vive  
  El título promete comercios y no los nombra; el id 39 es por ambiente, decirlo.
- `meddipay/context` · Lo que está quemado, y lo que sólo aplica a un comercio  
  Título no dice la conclusión y junta tres cosas (horario Pullman, 401, estado no registrado).
- `creditopx/context` · Los avisos de CreditopX salen al terminar la petición, en orden por persona  
  Quitar «ya no tiene tarea programada»: decir que no hay reintento agendado y que la guía del repo lo describe mal.
- `creditopx/context` · El subsidio se paga cuota por cuota de madrugada y no cuenta como recaudo  
  Quitar «ya no lo agenda»; afirmar quién lo lanza hoy (worker de loan-servicing) y el modo sombra sin crónica.
- `creditopx/context` · Un crédito CreditopX se busca por cédula dentro del comercio, y la lista de solicitudes del asesor sólo muestra las que él creó  
  Aclarar qué «estado 8» (solicitud vs historial CreditopX); sacar el párrafo final de cobranza, ajeno al título.
- `imei/context` · Quién decide que es SmartPay: nueve sitios, tres sabores  
  Título con la conclusión (ids de SmartPay difieren fuera de prod); quitar «el corpus documenta» y nombres de entidades de prod.
- `imei/context` · El servicio después del desembolso: dos motores, sus crons, y la mora la produce el monolito viejo  
  Título sin «sus crons»: decir que la mora la fija el cierre del viejo y el nuevo bloquea a horarios fijos.
- `imei/context` · Y el reporte inverso: figura en mora con el equipo libre  
  Título no se lee solo («y el reporte inverso…»); decir: equipo libre con crédito en mora tras pago es esperado.
- `imei/context` · Cómo leer la tabla de bloqueos  
  Quitar la referencia a filas anteriores a septiembre de 2026 (medición/historia).
- `imei/context` · Lo que sigue quemado  
  Título «lo que sigue quemado» es crónica; nombrar qué está fijo (destinatarios, enlaces de términos, id de recorrido 2).
- `imei/context` · El monolito nuevo desbloquea por pago sin predecir, y arranca apagado  
  Quitar «pensado para reemplazar» y la justificación de no predecir (futuro/opinión); dejar el traspaso de interruptores.
- `arquitectura/context` · Quién atiende qué, hoy  
  Título y listas sin «ya/todavía/hoy»: qué atiende cada monolito; mover el detalle de recordatorios a cartera.
- `arquitectura/context` · El sistema nuevo habilita KYC por comercio y ejecuta tareas de cartera  
  Mezcla dos temas: partir KYC por comercio (a onboarding/context) y tareas de cartera del nuevo; corregir área (apunta al Kernel viejo).
- `bancolombia/context` · Lo primero que hay que saber, y lo que más se malinterpreta  
  Título sin conclusión («lo primero que hay que saber»); quitar lo que repite la intro.
- `bancolombia/context` · Después de las 20:30 no le sale, y no es un error  
  Título fija 20:30, un valor de configuración; decir «el corte horario configurable retira el producto del listado».
- `bancolombia/context` · Medir sobre el histórico engaña, y el canal de ecommerce engaña distinto  
  Quitar «el corpus registra desde finales de 2025» (medición); título: qué es order_id según producto.
- `bancolombia/context` · Dos verdes que nunca se cruzan  
  Título críptico («dos verdes»); decir que la pantalla valida el contrato y una prueba del endpoint no basta.
- `bancolombia/context` · El error del banco ya viaja entero en el BNPL  
  Título con «ya» y contradice el cuerpo; separar el párrafo del NIT de Corbeta a su propia sección.
- `bancolombia/context` · En el canal de la caja, «cerró» es estado 25 más código — y el canal casi entero es tramo ciego  
  Título críptico («tramo ciego»); destacar la trampa: estado 10 asignado y no guardado en BNPL fuera de la lista.
- `documentos/context` · El pagaré es un PDF, pero apunta a una persona viva  
  Título críptico («apunta a una persona viva»); decir que el PDF firmado no se actualiza al editar el cliente.
- `documentos/context` · El voucher: por qué no se puede generar, y el sistema ya lo dice  
  Quitar «y el sistema ya lo dice» del título; dejar las tres condiciones y la regla de regeneración.
- `documentos/context` · No hay UN generador de comprobantes: hay once, uno por canal  
  Título cuenta «once» generadores (medición frágil); decir que la emisión depende del canal y el archivo es público.
- `documentos/context` · Comprobantes de a uno: no hay camino masivo  
  Quitar «marcado para retiro» (futuro); dejar que sólo hay operación por solicitud.
- `documentos/context` · Los tres estados ante «falta el slug del proyecto», y qué NO rescata el clásico  
  Título garbled («los tres estados ante falta…»); depende de «la sección anterior»: enlazarla y decir que el clásico no rescata.
- `documentos/context` · Los documentos de CrediPullman ya no prometen condonar la última cuota, y ningún proceso de cartera la condona  
  Quitar la crónica de la promoción; dejar: lo firmado manda y ningún proceso condona la última cuota automáticamente.
- `documentos/context` · El plan de pagos de un cupo rotativo imprime la cuota de todo el cupo, no la de la compra  
  «Debe proyectar» es prescriptivo; decir qué hace hoy el código y si el plan excluye la compra.
- `bcp/context` · El identificador de la entidad de consumo estuvo quemado, y en producción apuntaba a una fila que no existe  
  Título es crónica («estuvo quemado»); decir que los ids se leen de configuración. Sin área: ubicar config de BCP en legacy-backend.
- `bcp/context` · El link de continuación puede vencer, pero sólo en la entrega por POST, y en producción está apagado  
  Título afirma «en producción está apagado» (medición de ambiente); dejar sólo el mecanismo de vencimiento.
- `codeudor/context` · El codeudor entra a la MISMA solicitud, y su evaluación lee — nunca dispara  
  Quitar «se eligió justamente porque ningún otro código lo leía» (historia); resto vale.
- `codeudor/context` · Por qué el codeudor: el bien sale por la puerta, y la plata es del comercio  
  Título «por qué…»; quitar «configuración documentada de Motai» (dato de ambiente); dejar el riesgo de plantilla RTO sin codeudor.
- `backoffice/context` · Es el unico lugar del repo con control de version, y contesta 409  
  Título que diga la conclusión: «Guardar reglas contesta 409 si otro guardó antes». Quitar la referencia a la documentación de arquitectura.
- `backoffice/context` · La pantalla de una persona: sus solicitudes, su perfilamiento y su validacion  
  Quitar las tres pestañas «Todavía no está construido» (futuro); dejar pestañas reales, permisos y las dos acciones que escriben.
- `backoffice/context` · En el admin viejo el permiso casi nunca está en la ruta, y una parte grande de las acciones sólo pide sesión  
  Quitar los conteos (144 rutas, 24, 197 acciones, «la mitad»): son medición; dejar la regla «el permiso no está en la ruta, verificá la acción».
- `observabilidad/operar` · Los logs del backend van a Loki con dos etiquetas  
  Título que diga la conclusión: «Loki, DynamoDB y líneas instrumentadas tienen subconjuntos distintos; environment mezcla dev/qa/staging». Los dos stacks de Grafana no salen del código: marcarlo.
- `observabilidad/operar` · El log a tabla NO lo reemplazó Loki: los dos conviven  
  Título en crónica («no lo reemplazó»): «Qué tabla de negocio guarda cada evidencia y en qué difiere de Loki».
- `observabilidad/operar` · Los prefijos de módulo en uso  
  Partir: la lista de prefijos queda; «HTTP 200 no es éxito» y «un fallo intermedio no se disfraza» van a secciones propias con su título.
- `observabilidad/operar` · El mismo bloqueo por dos caminos: dos codigos, dos estados, un solo contador  
  Quitar «se está encendiendo comercio por comercio, hoy conviven» y el párrafo de festivos (no es código). Dejar dos caminos, dos códigos, un contador.
- `observabilidad/operar` · El modelo de riesgo apunta a un entorno de pruebas personal, y hoy solo lo alcanza un admin  
  Condensar a dos líneas: URL quemada a entorno personal y dump al fallar; quitar el «el día que alguien enchufe» (futuro) y el «hoy».
- `observabilidad/operar` · Entre servicios el único hilo es la traza: no hay identificador de negocio que buscar  
  Quitar «en main de cuatro microservicios y la API de comercios» (medición puntual); dejar: sin id de negocio entre servicios, el hilo es la traza.
- `observabilidad/operar` · El filtro de ambiente puede esconder logs de preaprobación  
  Reducir al hecho de código: qué etiquetas pone preapprovals-service a sus logs (dar área en su logger); quitar «la cobertura observada tiene fecha».
- `servicios/context` · El pais de la plantilla sale del comercio, y le gana al del numero  
  Quitar «hoy vale +57» (valor de ambiente): decir que el indicativo por omisión es configuración. Título más corto con la conclusión.
- `servicios/context` · La difusión masiva no es idempotente, y reintentarla manda el mensaje dos veces  
  Quitar los tiempos calculados (300 ms, dos minutos y medio): son estimación. Dejar no-idempotente, sin reintento, timeout del cliente ≠ fin del envío.
- `servicios/context` · Sólo el último código emitido para un identificador vale, y un identificador sin códigos se rechaza igual que uno equivocado  
  Quitar «igual que cuando el código vivía en la memoria rápida» (crónica).
- `servicios/context` · Borrar plantillas pide la clave X-Delete-Key [título con el valor por defecto de la clave: REESCRIBIR PRIMERO]  
  No publicar el valor por defecto de la clave en la prosa; decir que hay un default escrito en el código y que las demás rutas no piden credencial.
- `servicios/context` · Cada código guarda su origen y si fue un salto de QA, y el backoffice deduce su resultado  
  Mezcla tres temas: partir en origen/qa_bypass de otps, el código del pagaré, y el resultado deducido en el historial del backoffice.
- `local/operar` · Lo que borra la base: make test y make fresh no se corren  
  Quitar la lista nominal de archivos y el «siete archivos activos» (conteo que vence); dejar las tres formas y remitir al chequeo contra main.
- `credito365/context` · Elegirla sólo registra lo que el listado ya abrió, y sus errores no llegan a la pantalla  
  Quitar «qué ve el cliente… no está verificado»; verificarlo en el front o callarlo. El resto pasa.
- `mobile/context` · Qué es y cómo encaja en el sistema  
  La configuración tiene varios ambientes (environment_config.dart); «la actual apunta a producción» no se sostiene así. Dar área a creditop_mobile.
- `preaprobado/context` · (introducción del tema)  
  «Todavía quedan por completar los requisitos del cierre» no se entiende; agregar enlaces a listado, credito365, welli.
- `preaprobado/context` · Y dentro del sistema nuevo hay dos puntos con listas distintas  
  Título que se lea solo («Prami y las variantes de Welli se excluyen en dos listas copiadas»); quitar «hoy»; absorber la 83.
- `preaprobado/context` · La llamada del preaprobado se hace en un servicio aparte  
  Título promete «servicio aparte» y el cuerpo es genérico: nombrar pre-approvals-service y qué tipos de respuesta lo usan.
- `preaprobado/context` · Un acceso sin flujo iniciado no dispara consultas pagadas  
  Título y cuerpo no coinciden; decir qué señales mira EnsureLoanFlowStarted y el 410 a bots, sin prosa abstracta.
- `preaprobado/context` · La auditoría del gate heredó una semántica vieja, y el bug que lo originó está en la central  
  Título con crónica («heredó», «el bug que lo originó»); partir en default true del booleano y la vista de central que no tiene migración.
- `rto/context` · La prenda sobre el bien sólo se firma con codeudor, y sale con quince datos en blanco  
  Quitar «pendientes de definición de producto» (futuro) y la nota de verificación; dejar catálogo con codeudor y variables vacías.
- `rto/context` · El rent to own sin codeudor firma los documentos del renting, sin opción de compra  
  Quitar «legal entregó sólo…» (crónica) y «resolverlo exige…» (opinión); dejar el hecho y su consecuencia.
- `kyc/context` · Sólo un proveedor trae el score  
  Título promete exclusividad que el texto no sostiene; nombrar qué productos de Experian traen score y qué aporta cada central.
- `kyc/context` · Una fila ausente no demuestra que falló una consulta  
  Quitar el párrafo de las ocho etapas de la traza: ya lo cubre la sección del disparador de Experian; enlazarla.
- `kyc/context` · El primer apellido es parte de la llave  
  Título: «El buró se consulta con documento y primera palabra del apellido». Quitar el párrafo de TusDatos/nómina, repetido en su sección.
- `kyc/context` · El reuso de un mes muerde en las pruebas  
  «En el camino documentado» es vago: decir en qué monolito y servicio se reutiliza y la ventana exacta; título sin «muerde».
- `kyc/context` · El ingreso declarado casi nunca es el que decide  
  «Casi nunca» es medición; título: «La política usa el ingreso de las centrales; el declarado es respaldo». Nombrar archivos de ambos motores.
- `kyc/context` · La otra puerta de identidad se bloquea tras un rechazo, y el reintento se factura  
  «La otra puerta» no se lee sola: nombrar Evidente en el título y el primer párrafo.
- `kyc/context` · En la arquitectura nueva los burós se consultan recorriendo un grafo, y el grafo lo trae quien lo arranca  
  Hay dos workflows en main (kyc y legacykycpipeline); el título debe decir que es el de perfilamiento y enlazar al del pipeline.
- `kyc/context` · La carga de fotos de identidad no es la generación de documentos  
  Sobra la defensa metodológica («no es un inventario…»); dejar qué pantalla envía qué y adónde. Título: «La captura propia envía frente, dorso y selfie juntos».
- `datos/context` · Los timestamps de la base están en hora Colombia, no en UTC  
  «Todos» no es verificable; anclar en el middleware UseColombiaTimezone y en qué servicios aplica.
- `fronteras/context` · Cuando falla el aviso de un proveedor de pagos, la solicitud queda a mitad  
  Quitar la cita del reporte y «el más frecuente» (medición); el título dice pagos pero trata avisos de entidades; nombrar EcommerceReplayController.
- `fronteras/context` · El aviso de Prami no se pierde: llega con un identificador que no existe  
  Quitar la cita del reporte inicial; dejar la regla (404 por order_id ausente) y la evidencia en registros.
- `fronteras/context` · Los módulos nuevos se hablan por un sobre, y ninguna de sus puertas pide credencial  
  563 palabras con tres temas: partir en contrato entre módulos, autenticación por red/codeudor y dueño de la solicitud por cabecera.
- `fronteras/context` · Cuando el alta no puede guardar el identificador de orden nuevo, queda registrado por qué  
  Quitar «Sin ese código… dejaban el mismo registro» (crónica); título que diga la regla: reuso de transacción y order_id ocupado.
- `cuota/context` · Los tramos por monto no son por comercio, y la originación todavía no los aplica  
  «Todavía» y «volver a incluirlo» son futuro; título: «Los tramos son de la entidad; el listado nuevo no envía el campo del tramo».
- `infraestructura/operar` · (introducción del tema)  
  Quitar «mientras dura la migración» y «las secciones conservan rutas…»; describir el estado actual de las dos cuentas.
- `infraestructura/operar` · Dev caía en la cuenta de producción, y el guardrail que lo cerró está en el root.hcl  
  Título es crónica: «Sólo development fija su cuenta de AWS en root.hcl; prod la decide el rol». Quitar «environments/dev ya no existe».
- `infraestructura/operar` · «Read-only file system» en una tarea de ECS es un tmpfs que falta, no un permiso  
  Partir: secretos vacíos (copy-secrets) y el collector OTel son secciones propias; aquí sólo readonly y tmpfs.
- `infraestructura/operar` · Canon corre en internal-tools, en la cuenta legacy, y el workflow no dice qué revisión corre  
  Generalizar a internal-tools (Redash, Metabase, playground); el detalle de canon interesa a pocos y la imagen fija cambia.
- `infraestructura/operar` · En producción se despliegan los permisos del backoffice y el worker de cartera, y el worker sólo puede lanzar una familia de tareas  
  Título largo y doble; la trampa útil es task_family: titular «loan-servicing sólo puede lanzar la familia del worker viejo».
- `soporte/context` · Dos confirmaciones, y las dos las da el cliente  
  Quitar «hoy el asesor escribe directo» (crónica) y «si producto quiere…» (futuro); arreglar tildes.
- `negocio/context` · El que decide es el comercio, y eso ordena casi todas las prioridades  
  Anclar en lo que el código implementa (configuración por comercio y sucursal, CreditopX con capital del comercio); quitar «casi todas las prioridades».
- `ecommerce/context` · El pedido viaja en la dirección y se ancla al validar el código; si se pierde, la tienda nunca se entera  
  Partir: errores al crear la orden y plataforma según puerta van en secciones propias; el título sólo cubre el vínculo.
- `ecommerce/context` · El aviso a la tienda tiene dos implementaciones, y en el monolito nuevo gana el primer desenlace  
  Quitar «en producción esa fila trae además al 24» (medición de config); decir que la lista sale de configuración.
- `ecommerce/context` · Un pedido abandonado no se cancela nunca, y tres puertas del canal no piden credencial  
  Dos temas en una: partir pedido abandonado (comando fuera del Kernel) y puertas sin credencial.
- `ecommerce/context` · En tienda la cuota inicial la cobra la pasarela, y la firma espera a que se pague  
  579 palabras; abre con fuera de tienda. Mover la debilidad de vista previa de pagos a sección propia; empezar por la compuerta.
- `ecommerce/context` · Una sucursal del auto-onboarding sólo pide el código, y con el pedido verificado por la tienda ni eso  
  581 palabras: partir pedido firmado/token, pedido por API y corrección del celular en el pagaré.
- `listado/context` · Hay dos listados conviviendo  
  Nombrar las dos puertas (LenderListingController vs ListLenderController), qué entrada usa cada una y en qué difieren.
- `listado/context` · Un comercio grande está decidido por identidad en el código, no por configuración  
  No nombra comercio, id ni archivo; decir cuál y dónde están los cinco comportamientos.
- `listado/context` · A un comercio se le reescriben plazo, cupo y tasa de una entidad en memoria, por encima de la base  
  Nombrar el par comercio–entidad y el método de LenderRetrievalService; sin eso no se puede buscar.
- `listado/context` · Al elegir una entidad, no todas las señales de la respuesta deciden  
  Dejar sólo señales showModal/openProcessModal; el último párrafo (canal tienda/mostrador) repite la sección del vínculo con el pedido.
- `listado/context` · Una entidad se cae del listado en muchos puntos distintos, y el más denso descarta sin consultar  
  El título promete cuál es el punto más denso y el texto no lo dice; listar las etapas en orden con su archivo.
- `credifamilia/context` · La espera es normal: es la única entidad con sondeo  
  El texto no dice que sea la única con sondeo; título debe decir que agotar la espera es error técnico, no rechazo.
- `salud-financiera/context` · (introducción del tema)  
  Sólo un título; escribir 2-3 frases: qué servicio, para la app móvil, de qué depende (beneficios, monolito).
- `salud-financiera/context` · La salud financiera se arma al momento con lo del monolito y nunca habla con la central de riesgo  
  Partir: superficies y fuentes por un lado; caché y aviso de cambio de suscripción (carrera) en sección propia.
- `formularios/context` · En el canal retail, el ingreso puede venir de fábrica  
  Confusa y gritada; convertir en tabla de las tres fuentes del par fijo (comercio, ajuste, documento de migrante) y cómo distinguirlas.
- `formularios/context` · «Formulario dinámico» son dos cosas, y conviene saber cuál te reportaron  
  479 palabras: partir formulario de paso (dos fuentes, omisión silenciosa) y canal del formulario dinámico (documentos legales en bucket de dev).
- `onboarding/context` · Probar en local tiene dos trampas propias  
  Título dice dos trampas y lista cuatro; titular con la conclusión: el bypass QA depende de bandera, no del nombre del ambiente.
- `onboarding/context` · El identificador del tramite es secuencial, y el candado esta apagado  
  Verificado: LOAN_REQUEST_OWNERSHIP_ENFORCED apagada por defecto. Sacar «provisorio/versión duradera es columna» (futuro) y la cifra de cookie.
- `onboarding/context` · El cliente que vuelve entra directo a la oferta, y «falta registro» sólo lo dice el flujo viejo  
  Título ilegible; titular: el flujo viejo dice qué falta al validar el código, el nuevo lo decide el pipeline.
- `onboarding/context` · Una solicitud cuya cuenta fue dada de baja se rechaza con OBV21013 antes de contar intentos  
  Quitar «sin esa guarda chocaba… ahora» (crónica); dejar regla y salida (solicitud nueva). Solapa con el orden en documento-se-escribe-una-vez.
- `onboarding/context` · Qué cambia cuando un comercio va por el pipeline de KYC  
  572 palabras: partir en «qué decide pipeline vs cascada» y «grafo por tipo y país»; sacar la nota sobre la siembra inicial (historia).
- `formalizacion/context` · Hay un estado intermedio que no es un desenlace  
  No nombra el estado intermedio ni su id; decir cuál es y qué paso falta.
- `formalizacion/context` · El tramo más frágil, y los tiempos que lo delatan  
  Vago; titular con los límites del frente (2 y 3 min) y qué servicios esperan; quitar «el tramo más frágil» (opinión).
- `formalizacion/context` · Dos cobros invisibles en el recorrido nuevo  
  Título no dice la conclusión; separar cuota inicial y garantía y aclarar «expresión almacenada ejecutada como código».
- `internacionalizacion/context` · La columna del codigo de dos letras es la 1, no la 2  
  Nombrar columnas: iso_code_1 = 2 letras, iso_code_2 = 3 letras; la migración add_phone_code filtra iso_code_2='CO' (no matchea).
- `internacionalizacion/context` · Un país sin tipos de documento cargados devuelve vacío  
  Quitar «hoy… 100 % de las filas» (medición) y «hay que comprobar su esquema» genérico; dejar regla vacío vs ausente y diferencia viejo/nuevo.
- `welli/context` · Qué es, y por qué son varias entidades  
  Quitar «en producción TS y T0 en Dentix, Risk en Sonría» (configuración medida); mantener ids, nombres cruzados y Welli 0.
- `comercio/context` · El pre-registro de la landing guarda un prospecto, no un comercio  
  Quitar «reemplazó al formulario externo que se usaba antes» y «hoy nadie lo llena» (crónica).
