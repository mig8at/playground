---
id: 84
title: "Tablero"
clase: proyecto
stage: work
created: "2026-09-14T21:40:00-05:00"
context_nodes: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local del tablero. La agenda, la retoma en frío y el cierre diario ya se
derivan de los archivos, Git, ramas y bitácora. La organización local cambia a siete contenedores
permanentes: una tarea por herramienta y `playground` para asuntos transversales o todavía sin Jira.

La consola inferior de ramas pertenece a la tarea enfocada: muestra una tabla y, a la derecha, sólo
los repos asociados a sus ramas medidas. Conserva **Ramas** en el pie al cerrarse. Cada tarea tiene
una ruta copiable (`#/tareas/context`, `#/tareas/core-543`) que restaura la tarea al recargar y
responde a atrás/adelante.

La cabecera de la tarea concentra sprint, puntos, tiempo en Jira y los enlaces de contexto local. El
sidebar derecho ya no repite una ficha de detalle: usa pestañas para Jira, pendientes, hallazgos,
registro, bitácora y prototipos. Jira abre primero, ocupa todo el alto y muestra la descripción sin
marco de tarjeta. En ventanas medianas el sidebar se pliega y se recupera desde el pie.

La pulida visual comparte una sola gramática entre regiones: filas activas de superficie suave,
pestañas compactas con el mismo estado seleccionado, controles agrupados y tablas con seguimiento al
pasar el cursor. La consola evita repetir el conteo de ramas y conserva toda la información operativa.

La recarga ahora pinta el último snapshot correcto del sprint y restaura la ruta inmediatamente. Jira
se revalida por `fetch` en segundo plano, las fuentes locales cargan en paralelo y el pie muestra el
estado de sincronización; una respuesta remota lenta ya no desmonta el editor ni la consola.

Cada tarea de Jira muestra en su fila un icono para avanzar. Al abrirlo consulta las transiciones
reales y ofrece sólo el paso siguiente del flujo normal, sin mezclar bloqueos, invalidaciones ni
retrocesos. La tabla de ramas fija Rama y PR durante el desplazamiento, explica los estados de
ambientes y usa una fecha de medición relativa. Una tarea sin ramas conserva una franja compacta.

El laboratorio Jev de tablero está apagado por defecto. Sobre una retoma mínima pregunta en paralelo
el siguiente tipo de acción, el bloqueo externo y la urgencia. El banco sintético repetido dio 16/16
en las tres etiquetas, con 15 sugerencias y una revisión manual; una retoma real quedó etiquetada en
preview y no se envió.

`make retomar N=<id> BRIEF=1` suma al final la ficha de cada nodo de `context` que la tarea declara
(`context/tools/jev.py brief --text`), hasta cuatro; `BRIEF=a,b` elige. Es un apoyo: la ficha decide
qué `doc.md` se abre y no lo reemplaza, y sin `BRIEF=` la retoma sólo dice en una fila que existe. Sin
nodos declarados, la sección remite al `route` de context, que es de tareas nuevas.

**El próximo paso es:** usar la nueva estructura durante una jornada completa, corregir cualquier
fricción, probar la proyección JSON con workers y reunir varias etiquetas reales antes de considerar
Jev dentro de la agenda.

> **MEDICIÓN · 2026-09-19** — sobre la tarea KYC #47, el Markdown completo pesa 64.571 bytes; la proyección compacta pesa 6.243 bytes (**90,3 % menos**) y la variante con borrador 11.856 bytes.
> make tarea-json N=47; make tarea-json N=47 CONTENIDO=1; wc -c

> **MEDICIÓN · 2026-09-21** — sobre la tarea KYC #47: la retoma pesa 3.832 bytes; con `BRIEF=1` 18.540 bytes (sus tres fichas) contra 96.313 de sus tres `doc.md` (**80,8 % menos** que abrirlos). La ficha de `kyc` sola: 5.074 bytes contra 55.302 de su doc. Las 24 tareas vivas declaran `context_nodes`: al retomar no hay nodo que elegir, así que Jev `route` ahí no ahorra nada.
> make retomar N=47; make retomar N=47 BRIEF=1; cat context/server/data/flows/{kyc,credifamilia,deceval}/doc.md | wc -c

## Pendientes

- [ ] **El cierre pide bitácora por una tarea que sólo recibió un barrido de rutas.** Medido el
      2026-09-21: mudar las trampas del sistema cambió UNA línea en `#46` y `#47` —la ruta del
      archivo, nada del trabajo— y el cierre exigió bitácora del día en las dos. Anotar minutos ahí
      sería inventar tiempo, y ese dato sube a Jira. El caso análogo ya está resuelto para el
      frontmatter (`soloMetadatos`, que no reclama cuando lo único que cambió es un metadato);
      falta el equivalente para un cambio que **no toca ninguna afirmación** de la tarea. Una pista
      barata: si el diff del cuerpo son sólo rutas o enlaces, no es trabajo.

- [ ] Comprobar que ninguna tarea local nueva nazca fuera de los siete nombres canónicos.
- [ ] Confirmar que bitácora y retoma siguen agrupadas bajo la herramienta correcta.
- [ ] Medir cuántos archivos y tokens evita `make tarea-json` en una retoma real con workers.
- [ ] Reunir una muestra representativa de etiquetas antes de comparar Jev con trabajo real.
- [ ] Medir, en una semana de retomas reales, cuántas veces la ficha de `BRIEF=1` alcanzó y cuántas se abrió el doc igual — si es siempre, la ficha no está decidiendo nada.

## Cómo se comprueba

`make tareas TODAS=1`, `make tarea-json N=tablero`, `make tablero-jev-test`, los tests del servidor
(`go test ./cmd/hoy/` cubre el tope y los errores de `BRIEF=`), `make retomar N=47 BRIEF=1` y
`make cierre JSON=1`.

## Registro

### 2026-09-21

`make retomar` acepta `BRIEF=`: al final imprime la ficha de cada nodo de context declarado, corriendo
`context/tools/jev.py brief --text`, con tope de cuatro y `BRIEF=a,b` para elegir. Salió de medir el
arranque de una tarea: Jev no tenía nada que elegir —las 24 tareas vivas ya declaran nodos— y el gasto
estaba en abrir los `doc.md` (mediana 27 KB; `kyc` 55 KB). Un brief que falla queda como error en su
ficha; un nodo pedido que la tarea no declara se marca. Con `JSON=1` el brief viaja como JSON bajo
`context`. La regla de corte quedó en los tres `CLAUDE.md`: si la ficha no contesta, la pregunta va a
`workers/`, no a otro nodo.

### 2026-09-19

Se absorbió `tablero-retomar-en-frio` y se aplicó la consolidación de todas las tareas locales. La
API ya no crea tareas locales sueltas; el CLI también las detecta y hace fallar el lint.

La tarea ahora tiene una proyección JSON tipada y generada desde el Markdown. Expone el estado
operativo sin copiar todo el cuerpo privado y deja el texto largo como evidencia consultable.

La consola de ramas pasó al panel inferior del Tablero, abierta por defecto y recuperable desde el
pie. Después se retiró la vista duplicada del sidebar derecho y se acotó el selector a los repos de
la tarea enfocada. Las tareas locales y de Jira recibieron rutas hash estables que sobreviven a la
recarga. La pulida responsive prioriza la lectura, fija la identidad de cada rama al desplazar la
tabla y vuelve explícitos los pendientes, la antigüedad de la medición y los estados de ambientes.
