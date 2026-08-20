---
id: 27
title: "OnVacation — campo \"Acepta política de Tratamiento de Datos Personales\" en el PDF de términos y condiciones"
stage: tasks
created: "2026-08-03T18:38:47-05:00"
archived: "2026-08-03T18:38:47-05:00"
context_nodes: []
jira: [CORE-309]
jira_title: "OnVacation: la aceptación de datos personales, en el PDF"
---

# OnVacation — campo "Acepta política de Tratamiento de Datos Personales" en el PDF de términos y condiciones

> Traída de Jira el 2026-08-03 · **CORE-309** · `✅ Terminada` · creada 2026-07-24 · actualizada 2026-07-30
> · la reporta Miguel Angel Ochoa
> · sprints: CORE Sprint 9
>
> Abajo está lo que hoy dice Jira, tal cual. **Lo que averigües va acá arriba**:
> decisiones, riesgos, preguntas abiertas. Si al mergear algo sigue siendo cierto del
> sistema, gradúa al nodo de contexto y esta tarea se archiva.

## Lo que dice Jira

En una línea
En el flujo de OnVacation, el documento de términos y condiciones ahora lleva el check "Acepta política de Tratamiento de Datos Personales", que debe quedar marcado al firmar.
Por qué
Cambiaron los T&C de OnVacation e incorporaron la aceptación de la política de tratamiento de datos personales (habeas data). El documento firmado debe dejar constancia del consentimiento.
Qué cambia
El documento de T&C de OnVacation suma el check "Acepta política de Tratamiento de Datos Personales". Al firmar, el check llega marcado (indica que el cliente aceptó).
Alcance
Aplica al documento de T&C dentro del flujo de OnVacation.

No cambia los T&C de otros comercios ni el resto del contenido del documento.

Dónde probar
Ambiente de pruebas, dentro del flujo de OnVacation (el T&C se genera en algún punto del flujo).

Precondición: acceso para ver los documentos firmados de OnVacation.

Cómo validar
Recorrer el flujo de OnVacation hasta firmar el documento de T&C.

En el documento firmado, verificar que el check "Acepta política de Tratamiento de Datos Personales" llega marcado/activo.

Criterios de aceptación
El documento de T&C de OnVacation incluye el check.Al firmar, el check llega marcado en el documento firmado.El resto del documento no cambió.Dependencias / contraparte
El campo está definido en el catálogo global (ya en pruebas). Duncan necesita acceso a los documentos firmados de OnVacation para poder validar.
