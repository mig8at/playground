---
id: 92
title: "Workers"
clase: proyecto
stage: evaluation
created: "2026-09-19T14:55:00-05:00"
canon: [arquitectura]
jira: []
jira_title: ""
archived: "2026-09-24T07:00:00-05:00"
---

## Estado

Retirada el 2026-09-24: la carpeta `workers/` se borró entera. La conexión a Gemini quedó en
`connectors/gemini` (`bin/pg gemini models` · `gemini ask`); el árbol de negocio y el índice de logs
se mudaron al trazador, que era su único lector (`trazador/server/mapa/negocio.json` y
`make trazador-indexar-logs`). Los pendientes de abajo quedan sin hacer: eran del planificador que se
retiró.

## Pendientes

- [ ] Reapuntar `plan.py` y `contexto.py` a canon y retirar el ruteo Jev (`JEV=1`); termina cuando
      `make agente-analisis PREGUNTA='…'` vuelve a planificar, buscar y leer.
- [ ] Probar el recorrido completo con preguntas generales y sin datos sensibles.
- [ ] Etiquetar el nodo que realmente sirvió después de leer las fuentes.
- [ ] Mantener recuperación al mapa completo y comportamiento idéntico cuando Jev esté apagado.
