---
id: 91
title: "Trazador"
clase: proyecto
stage: evaluation
created: "2026-09-19T14:55:00-05:00"
context_nodes: [findings]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local del trazador. Sus etapas, cobertura y evidencia permanecen
determinísticas. Jev puede evaluarse como ayuda semántica para clasificar un reporte, decidir si hay
evidencia suficiente y puntuar severidad, sin sustituir el mapa de etapas.

No se han enviado mensajes de Slack, logs, identificadores ni trazas reales a TypeSafe. El siguiente
experimento debe usar casos sintéticos y estados sanitizados.

Antes de eso hay un paso que no necesita modelo ni red: **mirar lo que el clasificador descarta**.
`make trazador-slack DIAS=7 SIN=1` lista los reportes que ninguna regex reconoció, con su fecha y su
texto, en la terminal. Es lo que dice si el techo de las regex es real —faltan categorías— o si es
ruido; y si faltan pocas, la respuesta son tres regex y no un modelo. El veredicto ya no puede
esconderlo: «sin clasificar» es un cuarto renglón y entra al denominador.

**El próximo paso es:** correr `make trazador-slack DIAS=14 SIN=1` con el token en la shell y leer
esos reportes. Según cuántos y de qué hablen, o se agregan categorías, o recién ahí se construye el
banco sintético de incidentes con etiquetas para `Choice`, `Noul` y `Score`.

## Pendientes

- [ ] Leer los sin clasificar de 14 días y decidir: ¿faltan categorías, o es ruido?
- [ ] Definir categorías de incidente que produzcan una decisión concreta en código.
- [ ] Diseñar un estado derivado sin mensajes, ids, teléfonos ni payloads crudos.
- [ ] Conservar el clasificador actual como recuperación durante todo el experimento.

## Registro

### 2026-09-21

El barrido de #tech-ops contaba los reportes que ninguna regex reconoce y los tiraba: el veredicto se
calculaba sobre los clasificados, así que hablaba de las regex creyendo hablar del canal. Ahora «sin
clasificar» entra al denominador como cuarto renglón —**no** como «fuera de alcance», que es un juicio
que nadie hizo— y `SIN=1` los lista con fecha y texto para poder mirarlos. La clasificación se extrajo
a `clasificarReportes`, que es pura y tiene prueba; probada al revés, mutando el código. No se envió
nada a ningún servicio externo: esto es local y de sólo lectura, como todo el modo Slack.

### 2026-09-19

Se creó la tarea canónica de la herramienta. No absorbió datos reales ni activó una integración.
