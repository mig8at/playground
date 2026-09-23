---
id: 86
title: "Harness"
clase: proyecto
stage: work
created: "2026-09-15T17:00:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local del harness. La selección de entidades lee la realidad de la base del
ambiente y las escrituras críticas tienen guardas estructurales. El panel ya agrupa destino,
recorrido y persona, muestra el resumen del caso y hace visible la actividad de una corrida.

La migración de llamadores a las funciones seguras puede hacerse cuando se toque cada archivo; ya no
es una deuda de seguridad. Falta validar el panel durante una corrida habitual completa, porque la
prueba visual aislada no cubre el stack real. También quedan specs que todavía inyectan escenarios
de burós con el mecanismo retirado; deben usar la lambda canónica descrita en `findings`, F-139.

**El próximo paso es:** observar la siguiente corrida habitual con el panel actualizado y anotar aquí
únicamente los problemas de la herramienta que aparezcan; un hallazgo del producto pasa a Jira o a
la tarea general de `playground` mientras se decide.

## Pendientes

- [ ] Validar preparación, ejecución, progreso y resultado durante una corrida real.
- [ ] Migrar un llamador a la vez a las funciones de escritura seguras cuando se modifique.
- [ ] Migrar los specs de burós al lambda y conservar `source=lambda` como evidencia de participación.
- [ ] Mantener asserts, transiciones y veredicto como reglas determinísticas.

## Registro

### 2026-09-19

Se consolidaron `harness-db-realidad-y-escrituras-seguras` y
`harness-panel-preparar-y-observar`. Desde hoy toda mejora local del harness se registra aquí.
