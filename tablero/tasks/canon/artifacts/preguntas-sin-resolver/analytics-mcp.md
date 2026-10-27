**`creditop-analytics-mcp` es el servidor MCP de la empresa para consultar Google Analytics 4 desde un asistente de IA.** Lo usan producto, marketing u operaciones sin instalar nada: se conecta el conector «Creditop Analytics» de la organización, o se agrega su dirección en un agente de terminal, y se entra con la cuenta de Google `@creditop.com`.

**Es de sólo lectura y consulta como la persona que entró.** Cada llamada usa el token de Google de esa persona, armado sólo para esa solicitud: cada uno ve exactamente las propiedades de GA a las que ya tiene acceso. El asistente nunca recibe el token de Google, sino uno propio del servidor.

**Tiene dos grupos de herramientas:**
- las de Google Analytics del MCP oficial: resumen de cuentas, informes, tiempo real, embudos y conversiones;
- las del catálogo de analítica de la app móvil, que no consultan nada afuera: dicen qué eventos existen, sus parámetros, las pantallas, los embudos y las reglas para analizarlos. El catálogo sale de `creditop_mobile` en `main-pro` y entra al servidor por un pull request de sincronización que revisa una persona.

Corre en Google Cloud (Cloud Run, detrás de un balanceador con Cloud Armor), no en la cuenta de AWS de los monolitos. No toca las bases de CreditOp: para datos de solicitudes o créditos está la base; para lo que hizo el cliente en pantalla, PostHog.
