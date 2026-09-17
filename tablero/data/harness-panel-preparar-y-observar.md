---
id: 87
title: "Harness: preparar y observar una corrida"
clase: proyecto
stage: tasks
created: "2026-09-16T08:18:41-05:00"
context_nodes: [harness]
jira: []
jira_title: ""
ramas:
---

## Si retomás esto sin contexto, empezá acá

La mejora de UI está implementada. El panel agrupa destino, recorrido y persona; resume el caso
junto a Lanzar y muestra una tarjeta de actividad durante la ejecución. Se agregaron perfiles
financieros reutilizables en el navegador y comandos visibles para servicios faltantes.
La primera parte ya quedó en `c6d29ff`; esta sesión completa perfiles, avisos y verificación.
Se verificó la interfaz con respuestas HTTP simuladas, sin ejecutar solicitudes de crédito.

**El próximo paso es:** observar la siguiente corrida habitual de Miguel con el panel actualizado;
la prueba visual aislada no reemplaza una prueba del stack real.

## Objetivo

Preparar el caso sin buscar controles dispersos y ver qué está haciendo la corrida sin leer toda
la consola. Mantener al panel como herramienta para correr flujos, sin agregar veredictos de negocio.

## Dónde se toca

- `harness/panel/index.html`: distribución, resumen, actividad, perfiles y avisos.
- `harness/panel/server.ts`: estado y tiempos; el cierre espera la recolección de evidencia.
- `harness/README.md`: operación del panel actualizado.

## Registro

### 2026-09-17 · se commiteó lo del 16, y se sacó `ramas: main`

Nada del panel se movió hoy: los archivos pendientes —`panel/index.html`, la sección del panel en el
README y este mismo archivo, que estaba **sin commitear**— eran del 16 a las 08:17-08:19. Se
commitearon, que es lo que hacía falta para que dejaran de contar como trabajo del día.

⚠ **Y el motivo por el que el cierre la reclamaba todos los días eran DOS, ninguno trabajo de hoy.**
El primero: `tocadasPorGit` cuenta como tocada toda tarea cuyo `.md` esté modificado en el working
tree, y el propio código dice por qué —«lo sin commitear no tiene fecha»—, así que un archivo que
nunca se commitea se reclama para siempre. El segundo: `ramas: main` se compara **por subcadena**,
de modo que `playground-personal/main` y `playground/main` matcheaban, y **cualquier** commit del día
en cualquiera de los dos repos se le atribuía a esta tarea. Contradecía además a la regla que el
mismo cierre ya tiene escrita (`esRamaBase`): tocar `main` no es trabajo de una tarea, es un merge o
un pull. El campo queda vacío: el trabajo de esta tarea vive en commits locales del repo personal y
no tiene rama propia que declarar.

### 2026-09-16 · UI y verificación aislada

Se conservó la paleta y los controles existentes. El mapa y las opciones avanzadas se pliegan;
las entidades globales tienen una sección con el alcance explícito. Los perfiles guardan solo
parámetros financieros, hasta 20, con actualización por nombre y mensajes ante almacenamiento no
disponible. El aviso de dependencias lleva desde la barra fija al comando correspondiente.

Verificación con la página real servida por un servidor temporal de fixtures en 5196: guardar y
aplicar perfiles después de recargar; ingreso/score en el resumen; cambios de arranque y demora;
actividad, detención y cierre; configuración bloqueada durante ejecución y habilitada al terminar.
Se revisó a 1280 px y 390 px: sin desbordamiento horizontal en la vista angosta. Sin errores de
consola del navegador en esas pruebas. Una comprobación aislada de `renderActivity` cubrió además
la fase de recolección de evidencia, duración fija y finales con código cero, uno y señal.

No se probó el flujo de crédito real ni se consultaron bases o Cognito desde este servidor de revisión.
La duración anterior al reinicio no se puede medir de forma confiable; la bitácora solo registra
el tramo final con reloj disponible.
