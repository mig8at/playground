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

- [x] Medir qué hace bueno a un comercio con los datos propios: sector, ticket, puntos de venta y originación de los comercios activos — en la pila: ser cadena (21+ puntos originan 855 desembolsos por comercio contra 10 a 21 los de 1 a 5) y la concentración (5 comercios, 74 %).
- [x] Revisar qué guarda `allied_pre_registrations` en prod (cuántas filas, sectores, ticket, % a crédito) — en la pila: unos 55 al mes, casi todos de 1 a 5 puntos, ninguno se volvió comercio.
- [x] Confirmar el acceso a una fuente pública de comercios (RUES o datos abiertos por CIIU y ciudad) y su costo — en la pila: el registro mercantil de Confecámaras en datos.gov.co, gratis (CC BY-SA 4.0) y sin llave; la consulta de prueba trajo 12 cadenas de motos de 33 a 112 establecimientos, ninguna cliente.
- [x] Armar el prototipo local (app de Cockpit en `sabueso/`, con la base de `tools/ui`) con las regiones de la maqueta — anda con lo medido en prod y 10 prospectos reales del registro (pila del 2026-11-21).
- [ ] Poder marcar a mano «ya es cliente» en el registro; termina cuando un cliente que el cruce no ve (Colombiana de Comercio, la sociedad de Alkosto) queda oculto en la próxima búsqueda.
- [x] Rescatar el canal por el que un comercio real recibe propuestas, con Claude por internet y por consola (`bin/sabueso hunt|contact`) — Dismerca: WhatsApp comercial +57 333 033 4551, verificado en su sitio (pila del 2026-11-21).
- [ ] Conseguir acceso a una fuente paga de contactos B2B antes de seguir buscando personas: una base de la Cámara de Comercio (con teléfono, correo y representante legal) o LinkedIn Sales Navigator (nombres fuera de la red); termina cuando se sabe si hay una cuenta activa y cuánto cuesta si no.
  Depende de: Dani o Juanca — si la empresa ya tiene alguna de esas cuentas.
- [ ] Redactar los correos con las señales de cada comercio y dejarlos listos para enviar a mano; termina cuando un borrador sale de los datos de un prospecto real.
- [ ] Marcar a quién se le pasa un prospecto («lo retoma <persona>») y que quede en su bitácora; termina cuando un prospecto pasado muestra el dueño nuevo y la fecha.
- [ ] Evaluar si el envío de correos (y WhatsApp, sólo con aceptación previa) se puede conectar solo; termina cuando la pila dice qué canal se conecta, con qué y qué riesgo tiene.

## Objetivo

Sabueso es la herramienta de Miguel para **capturar clientes del negocio**: encontrar **comercios** que todavía no venden a crédito con CreditOp (y **entidades** que todavía no están integradas), decir por qué encajan y llevar la relación con cada uno hasta que entra, o hasta que se la pasa a alguien del equipo comercial para que la siga en persona.

Por ahora es **sólo de Miguel**, que orquesta todo desde Cockpit, como el resto de my-tools. No es una herramienta de la compañía, no tiene usuarios ni login, y no reemplaza el CRM del equipo comercial si lo hay.

## Dónde se toca

- `sabueso/`: servidor Go (:5245) y la interfaz en Vue con `tools/ui` (:5244), como las demás apps de Cockpit; cómo funciona, en `sabueso/CLAUDE.md`.
- Cockpit: su entrada en `APPS` (`cockpit/src-tauri/src/main.rs`) y su ícono (`cockpit/shell/index.html`).
- **La fuente pública**: el registro mercantil de Confecámaras en datos.gov.co, por la API de Socrata, sin llave: [empresas](https://www.datos.gov.co/d/c82u-588k) (razón social, NIT, CIIU, estado) y [establecimientos](https://www.datos.gov.co/d/nb3d-v3n7) (cada uno con el NIT de su dueño: contarlos da los puntos de venta). Licencia CC BY-SA 4.0. No trae contacto ni municipio, sólo la cámara de comercio.
- Datos de CreditOp, sólo leyendo: `bin/pg sql --target prod` (Redash). Las tablas que ya sirven: `allieds` (con `allied_industry_id`, `min_amount`, `max_amount`), `allied_industries`, `user_requests` (`amount`, `disbursed_at`, `allied_id`) y `allied_pre_registrations`.
- Avisos (un paso vencido, un prospecto que contestó): por `lib/notice`, como todas las herramientas.

## Cómo se ataca

**Lo que encuentra.** Prospectos con señales públicas y su **encaje**, un puntaje que se explica solo:

- **cuántos puntos de venta tiene**: es lo que más pesa. En prod, un comercio con 21 o más puntos origina unas 40 veces más que uno de uno solo, y los de 1 a 5 puntos casi no originan (pila del 2026-11-21). Buscar tiendas chicas de un solo punto rinde poco; la excepción es la venta en línea de ticket alto (Tripleten, educación, con un punto);
- se parece a los comercios que hoy originan: odontología, celulares, hogar y descanso, salud y óptica, con ticket de 1,4 a 6 M;
- vende, y no sólo presta un servicio;
- vende **en línea**, en cualquier plataforma (CreditOp da el soporte de la integración), o en puntos físicos, con enlace y QR. En la base propia no se puede medir todavía: ningún punto de venta es de tipo en línea y el campo de tienda en línea del comercio está vacío en los que más originan;
- no ofrece pago a cuotas, o lo ofrece con una sola entidad;
- en qué ciudad está.

Se excluye a quien ya es comercio, cruzando por NIT **y por nombre**: 139 de los 213 comercios activos no tienen NIT en CreditOp, así que el NIT solo no alcanza; Miguel puede marcar a mano «ya es comercio». **Los prerregistros** (unos 55 al mes en prod) entran como una fuente más, en el segmento «Se prerregistró»: ya mostraron interés, pero casi todos tienen 1 a 5 puntos y ninguno se volvió comercio; los que más originan, las cadenas, no llegan solos. Para las entidades, las listas públicas de vigiladas (Superfinanciera, Supersolidaria).

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
