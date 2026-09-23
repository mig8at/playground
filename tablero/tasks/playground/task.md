---
id: 90
title: "Playground"
clase: proyecto
stage: evaluation
created: "2026-09-19T14:55:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local para mejoras transversales, exploraciones y trabajo todavía sin destino.
Una mejora de una herramienta concreta va a la tarea con su nombre. Un cambio del producto que se
decida hacer debe salir de aquí hacia Jira; `playground` no se convierte en un segundo backlog de
producto.

La consolidación absorbió diecinueve frentes locales abiertos. Ocho conservan una acción concreta y los
demás necesitan decidir si siguen vigentes, se cierran o se convierten en una tarea de Jira. También
se retiraron cuatro archivos ya archivados. Los archivos anteriores se eliminaron del estado actual;
su detalle permanece en Git.

**El próximo paso es:** revisar primero los ocho frentes con acción explícita y, para cada uno, elegir
una de tres salidas: Jira, herramienta canónica o cierre. Después hacer la misma decisión con los
once que no tenían próximo paso.

## Con acción vigente

- **Reglas vigentes en los CLAUDE.md:** decidir el destino de diez correcciones y dejar la regla
  actual sin el relato de cómo cambió.
- **País fuera del código:** revisar el cambio pendiente, ejecutar la matriz de QA y preparar lo que
  todavía no llegó a producción.
- **Logs con contexto de negocio:** definir la convención de campos y contrastarla con el mapa del
  trazador antes de cambiar mensajes que otras herramientas consumen.
- **OTP de pruebas:** decidir si la simulación vive en el servicio de mocks y cuál es su comportamiento
  seguro por defecto.
- **Internacionalización restante:** abrir el cambio de los filtros que aún suponen el país histórico.
- **Perfil de riesgo:** pedir la nueva prueba en dev y, si sigue bloqueado, verificar la caché de
  permisos.
- **Rastro del documento firmado:** decidir si se crea Jira; el arreglo local ya está probado y no
  existe fuera de esta máquina.
- **SDK del comercio:** medir cuántos comercios ecommerce mapean el documento antes de decidir si la
  experiencia propuesta es realista.

## Sin próximo paso vigente

Antes de retomar cualquiera, decidir si merece Jira o cierre: flujos paralelos; receta local de
Credifamilia; bypass de documento no encontrado; contador de TusDatos; errores legibles y testids;
`min_income`; tarjeta de lender desde backend; costo del perfilador; Motai local; plazo elegido por el
cliente y SmartPay local.

## Cerrados retirados

Los archivos ya archivados de PDF Mapper, catálogo de campos y tarjeta parametrizable no se reabren
en este contenedor. Su contenido permanece en Git.

## Regla de uso

- No crear otro archivo local para una mejora general: agregar o actualizar un frente aquí.
- Si aparece una mejora de `canon`, `context`, `harness`, `tablero`, `trazador` o `workers`, moverla a
  la tarea canónica correspondiente.
- Cuando el trabajo se compromete con el producto o el equipo, crear o vincular Jira y sacarlo de esta
  lista.
- Mantener arriba solo estado y siguiente acción; el hecho de un día va al Registro.

## Registro

### 2026-09-19

Se creó el contenedor general y se absorbieron las tareas locales que no eran mejoras de una sola
herramienta. La bitácora histórica se reasignó a esta tarea para no dejar tiempo huérfano.
