---
id: 42
title: "Revisión de flujo ecommerce V1"
stage: tasks
created: "2026-08-03T18:38:47-05:00"
context_nodes: []
jira: [CORE-30]
jira_title: "Revisión de flujo ecommerce V1"
---

# Revisión de flujo ecommerce V1

> Traída de Jira el 2026-08-03 · **CORE-30** · `🧪 En pruebas` · creada 2026-06-01 · actualizada 2026-07-17
> · la reporta Manuela Romero
> · sprints: CORE Sprint 2, CORE Sprint 3, CORE Sprint 1, CORE Sprint 4, CORE Sprint 6, CORE Sprint 5
>
> Abajo está lo que hoy dice Jira, tal cual. **Lo que averigües va acá arriba**:
> decisiones, riesgos, preguntas abiertas. Si al mergear algo sigue siendo cierto del
> sistema, gradúa al nodo de contexto y esta tarea se archiva.

## Pregunta abierta: ¿es el mismo trabajo que `ecommerce-stateless`?

Se trajo como archivo aparte porque **no está confirmado**. Lo que sabemos: CORE-30 pide "pasar el flujo
de ecommerce al refactor y validar que funcione igual", y `ecommerce-stateless.md` (id 6) es la
migración de esa originación al wizard **sin cookie** — PR 795 en main / 551 en develop.

Si es el mismo trabajo, el arreglo es de un paso: poner `CORE-30` en el `jira:` de
`ecommerce-stateless.md` y borrar este archivo. Si son distintos (por ejemplo, CORE-30 es la validación
funcional del V1 y la otra es el cambio de arquitectura), esto se queda y conviene decirlo acá.

## Lo que dice Jira

Se debe pasar el flujo de ecommerce al refactor y validar que funcione de la misma forma e la que esta funcionando actualmente
