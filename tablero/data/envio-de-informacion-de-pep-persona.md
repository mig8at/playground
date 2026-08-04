---
id: 33
title: "Envío de información de PEP (Persona Públicamente Expuesta)"
stage: tasks
created: "2026-08-03T18:38:47-05:00"
archived: "2026-08-03T18:38:47-05:00"
context_nodes: []
jira: [CORE-159]
jira_title: "Envío de información de PEP (Persona Públicamente Expuesta)"
---

# Envío de información de PEP (Persona Públicamente Expuesta)

> Traída de Jira el 2026-08-03 · **CORE-159** · `✅ Terminada` · creada 2026-07-01 · actualizada 2026-07-01
> · la reporta Oscar Rincon
> · sprints: CORE Sprint 5
>
> Abajo está lo que hoy dice Jira, tal cual. **Lo que averigües va acá arriba**:
> decisiones, riesgos, preguntas abiertas. Si al mergear algo sigue siendo cierto del
> sistema, gradúa al nodo de contexto y esta tarea se archiva.

## Lo que dice Jira

Actualmente el bloque de información PEP está comentado en el request de Credifamilia para poder hacer pruebas, pero necesitamos enviarlo.
Los datos ya están guardados en la base de datos — Jose es quien sabe dónde queda guardada esa información.
Regla importante para no romper la petición: si esos datos NO existen, no se debe enviar la etiqueta ni siquiera vacía. En el XML una etiqueta con valor vacío queda como <campo></campo> y hace fallar la petición. Por lo tanto, en el XML la etiqueta debe omitirse por completo cuando el campo no tiene valor.
Ubicación en código:
app/Actions/Lenders/CredifamiliaConsumo/TransactionRequest.php → método build() → bloque "Información PEP (Persona Públicamente Expuesta)" (aprox. líneas 168–173).
Campos PEP a enviar (hoy comentados / GAP: bloque PEP-persona no se captura):
numeroDocumentoPEP

nombrePEP

apellidoPEP

cargoPEP

vinculo

Criterios de aceptación:
Se pobla el bloque PEP desde la fuente real en BD (confirmar con Jose dónde está).

Si un campo PEP no tiene valor, la etiqueta correspondiente no se incluye en el XML (no enviar etiquetas vacías).

La petición transaccionConsumo no falla cuando no hay datos PEP.
