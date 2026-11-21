---
id: 136
title: "Sabueso"
clase: proyecto
nivel: miguel
stage: evaluation
created: "2026-11-21T11:30:00-05:00"
knowledge: []
jira: []
jira_title: ""
---

## Pendientes

- [ ] Medir qué hace bueno a un comercio con los datos propios: sector, ticket, puntos de venta y originación de los comercios activos; termina cuando la pila tiene la consulta y su resultado.
- [ ] Revisar qué guarda `allied_pre_registrations` en prod (cuántas filas, sectores, ticket, % a crédito); termina cuando la pila tiene la medición.
- [ ] Confirmar el acceso a una fuente pública de comercios (RUES o datos abiertos por CIIU y ciudad) y su costo; termina cuando hay una descarga o una consulta de prueba en la pila.
- [ ] Armar el prototipo local (app de Cockpit en `sabueso/`, con la base de `tools/ui`) con las regiones de la maqueta; termina cuando se abre en Cockpit con datos reales de sectores y una lista de prospectos cargada a mano.
- [ ] Redactar los correos con las señales de cada comercio y dejarlos listos para enviar a mano; termina cuando un borrador sale de los datos de un prospecto real.
- [ ] Marcar a quién se le pasa un prospecto («lo retoma <persona>») y que quede en su bitácora; termina cuando un prospecto pasado muestra el dueño nuevo y la fecha.
- [ ] Evaluar si el envío de correos (y WhatsApp, sólo con aceptación previa) se puede conectar solo; termina cuando la pila dice qué canal se conecta, con qué y qué riesgo tiene.

## Objetivo

Sabueso es la herramienta de Miguel para **capturar clientes del negocio**: encontrar **comercios** que todavía no venden a crédito con CreditOp (y **entidades** que todavía no están integradas), decir por qué encajan y llevar la relación con cada uno hasta que entra, o hasta que se la pasa a alguien del equipo comercial para que la siga en persona.

Por ahora es **sólo de Miguel**, que orquesta todo desde Cockpit, como el resto de my-tools. No es una herramienta de la compañía, no tiene usuarios ni login, y no reemplaza el CRM del equipo comercial si lo hay.

## Dónde se toca

- `sabueso/` (carpeta nueva, todavía no existe): servidor Go y la interfaz en Vue con `tools/ui`, como las demás apps de Cockpit.
- Cockpit: su entrada en `APPS` (`cockpit/src-tauri/src/main.rs`) y su ícono (`cockpit/shell/index.html`).
- Datos de CreditOp, sólo leyendo: `bin/pg sql --target prod` (Redash). Las tablas que ya sirven: `allieds` (con `allied_industry_id`, `min_amount`, `max_amount`), `allied_industries`, `user_requests` (`amount`, `disbursed_at`, `allied_id`) y `allied_pre_registrations`.
- Avisos (un paso vencido, un prospecto que contestó): por `lib/notice`, como todas las herramientas.

## Cómo se ataca

**Lo que encuentra.** Prospectos con señales públicas y su **encaje**, un puntaje que se explica solo:

- se parece a los comercios que hoy originan (sector y ticket medidos en la base propia);
- vende, y no sólo presta un servicio;
- vende **en línea**, en cualquier plataforma (CreditOp da el soporte de la integración), o en puntos físicos, con enlace y QR;
- no ofrece pago a cuotas, o lo ofrece con una sola entidad;
- cuántos puntos de venta tiene y en qué ciudad está.

Se excluye a quien ya es comercio, cruzando por NIT. Para las entidades, las listas públicas de vigiladas (Superfinanciera, Supersolidaria).

**El encaje del ticket por sector** sale de lo medido en prod (pila del 2026-11-21): odontología, celulares, hogar y descanso y movilidad (motos) encajan. **Carros encaja con variación**: el monto que se presta hoy no cubre un carro entero (en movilidad casi todo va de 5 a 15 M y el máximo fue 24,8 M), así que sirve para usados económicos, accesorios, cuota inicial o con una entidad vehicular.

**Cómo se ve** (maqueta en `artifacts/`), con las regiones del workbench:

- **Sidebar:** dos vistas apiladas, Comercios y Entidades, agrupadas por etapa en el orden del embudo. Prospectos por encaje; en negociación, por próximo paso (lo vencido arriba); vendiendo, por originación; entidades, por días en su etapa. El menú filtra por sector, ciudad y dueño.
- **Editor:** la pestaña fija **Embudo** (conteos por etapa, dónde se traba, pasos vencidos) y una pestaña por empresa abierta, con su subbanda (sector, ciudad, barra de etapas), el próximo paso arriba, la bitácora y el campo para registrar una llamada o una nota en segundos.
- **Secundario:** Datos (dueño, encaje, puntos), Contactos por área, Señales y «En CreditOp» (lo real: cuánto origina, el caso de vinculación, o las pruebas de integración de una entidad).
- **Panel:** la actividad, en vivo, y los próximos pasos vencidos.
- **Pie:** totales, pasos vencidos y cuántos están vendiendo.

**Las etapas.** Comercio, de días o semanas: prospecto → contactado → demo → prerregistro → KYB y contrato → vinculación con entidades → vendiendo. Entidad, de meses: prospecto → interés → riesgo y legal → convenio → integración técnica → piloto → en producción. Una entidad tiene contactos por área (comercial, riesgo, legal, tecnología) y la integración es parte del trato.

**El contacto.** Una secuencia mixta, que es como se vende B2B: correo corto y personalizado (día 1), llamada (día 3), segundo correo con un caso del sector (día 6), demo y el enlace al prerregistro. Sabueso **redacta**; el envío lo hace Miguel, a mano. WhatsApp entra **sólo después** de que el comercio acepta hablar por ahí. Cuando hay llamadas o visitas, Miguel **le pasa el prospecto a una persona** y queda marcado «lo retoma <persona>», con la fecha, en su bitácora: desde ahí la conversación sigue en persona y fuera de la herramienta.

**Dónde termina.** Cuando el comercio acepta, sigue el flujo de vinculación que ya existe: el prerregistro (`POST /legacy-api/allied/pre-registrations`) y el caso de `merchant-api` (KYB, contrato, vinculación con entidades), que según Confluence sólo está en la rama `develop`.

## Lo que se evaluó y NO se eligió

- **Captar personas** (quienes se quedaron a mitad de una solicitud, rechazos con otra opción, cupos sin usar): se descartó por ahora. Lo legal pesa (Ley 1581 de 2012 y Ley 1266 de 2008: la consulta a las centrales se autoriza para evaluar esa solicitud, no para mercadeo) y no se sabe si la autorización de contacto comercial está guardada como dato. La maqueta no se guardó: se descartó antes.
- **Sesgar las tiendas en línea a Shopify y VTEX**: no. La señal es «vende en línea», en cualquier plataforma.
- **Mandar correos en masa solos**: no. Daña el dominio de creditop.com (listas de spam) y la Ley 1581 pide cuidado con los correos de personas. Redacta Sabueso, envía una persona.
- **WhatsApp en frío**: no. WhatsApp Business exige que la persona haya aceptado recibir mensajes; escribirle a un comercio que nunca habló con CreditOp viola su política.
- **El correo de notificación judicial del registro mercantil**: no. Es público, pero es para notificaciones legales.
- **Hacerla para toda la compañía ahora** (login, base compartida, en el playground compartido): no. Primero, sólo de Miguel.
- **Un CRM propio que reemplace al del equipo comercial**: no. Si el equipo usa uno, Sabueso le pasa las señales y los datos reales, no lo reemplaza.

## Lo que NO entra

- Escribirle a nadie sin que Miguel lo vea y lo mande.
- Guardar datos personales en masa: el correo y el teléfono de una persona se guardan sólo si los dio o los publicó para contacto comercial.
- Escribir en ninguna base de CreditOp: prod se lee.

## Cómo se comprueba

La medición de montos por sector, la que decide el encaje del ticket (sólo lectura):

```sh
bin/pg sql --target prod --query "SELECT ai.name AS industria, COUNT(*) AS solicitudes, SUM(ur.disbursed_at IS NOT NULL) AS desembolsadas, ROUND(AVG(CASE WHEN ur.disbursed_at IS NOT NULL THEN ur.amount END)) AS monto_prom, COUNT(DISTINCT ur.allied_id) AS comercios FROM user_requests ur JOIN allieds a ON a.id=ur.allied_id LEFT JOIN allied_industries ai ON ai.id=a.allied_industry_id WHERE ur.created_at >= NOW() - INTERVAL 180 DAY GROUP BY ai.name ORDER BY desembolsadas DESC"
```

## Referencias

- Confluence, «6.5 · Red comercial» (id 712769537): la prospección de comercios como subdominio, que empieza en el prerregistro.
- Confluence, «3.4 · Partner Management» (id 712638485): qué hay hoy del prerregistro y de `merchant-api`.
- Confluence: un espacio por entidad (Bancolombia, Credifamilia, Meddipay, Sistecrédito, Banco de Bogotá…), lo más parecido a una historia por entidad.
