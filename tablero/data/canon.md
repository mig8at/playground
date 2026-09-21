---
id: 74
title: "Canon"
clase: proyecto
stage: work
created: "2026-09-07T08:30:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local de Canon. Reúne las mejoras del corpus, la cola de preguntas que Canon
no pudo contestar y el bucle de agentes. El corpus debe mostrar únicamente conocimiento técnico, de
negocio y de producto vigente; el estado observado en `main` se conserva aunque esté bien o mal y la
historia no se mezcla con la respuesta actual.

La limpieza grande quedó mergeada en un único PR. Las tareas locales anteriores de corpus, cola y
bucle se absorbieron aquí; sus detalles siguen disponibles en Git y no se copian como diario.

**El próximo paso es:** registrar aquí la siguiente mejora concreta de Canon, con su criterio de
terminación, y validar que la cola real de preguntas mejore sin volver a introducir historia en el
corpus.

## Frentes activos

- **Corpus vigente:** mantener sincronía con `main` y separar conocimiento actual de antecedentes.
- **Preguntas sin respuesta:** distinguir huecos de conocimiento de consultas que requieren datos,
  permisos o una herramienta distinta.
- **Bucle de agentes:** medir cada mejora con casos reales y conservar recuperación cuando un agente
  o una fuente no alcance.

## Pendientes

- [ ] Elegir la siguiente pregunta real de la cola y clasificar su causa antes de escribir contexto.
- [ ] Verificar cualquier cambio del corpus contra `main` y los documentos de negocio vigentes.
- [ ] Mantener un solo estado vigente arriba; los hechos del día van al Registro.

## Registro

### 2026-09-19

Se consolidaron `canon-corpus-al-dia`, `canon-la-cola-de-lo-que-no-pudo`,
`canon-mejoras-del-bucle` y la tarea cerrada de Confluence. Desde hoy toda mejora local de Canon se
registra en esta tarea.
