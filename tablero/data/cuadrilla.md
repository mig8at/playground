---
id: 93
title: "Cuadrilla"
clase: proyecto
stage: work
created: "2026-09-21T09:40:00-05:00"
context_nodes: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local de **cuadrilla**, la herramienta del repo compartido
(`github/playground/tools/cuadrilla`): el tablero de épicas rama por rama, y la sección `games` que
cuelga de él. Las mejoras de la herramienta van acá; lo que sea del repo compartido en sí va a la
tarea de playground.

Lo último: el segundo juego, un **dictado de inglés con tres niveles**, mergeado en la rama
`cuadrilla/ingles-en-los-games` y **sin PR todavía**.

**El próximo paso es:** decidir si ese trabajo sale como PR al repo compartido, y con eso mirar si el
banco de 150 palabras es el correcto — se escribió de una sentada y todavía nadie lo usó de verdad.

## El dictado de inglés (2026-09-21)

Salió de mudar la herramienta personal `playground/ingles` a los games de cuadrilla, y en el camino se
podó: **quedó sólo el dictado**, sin lector, sin glosario y sin historias. La razón está en el código
y vale repetirla: leer con el glosario al lado se puede hacer copiando letra por letra sin aprender a
escribir nada; el dictado saca el modelo de la pantalla y deja sólo el sonido.

Lo que hay hoy, todo verificado corriendo:

- **Tres niveles de 50 palabras** (`games/english/bank.go`). El eje es la **ortografía**, no el
  significado: `island` es intermedio por su `s` muda y `house` es de principiante. El nivel avanzado
  mezcla las clásicas (`accommodate`, `queue`, `colonel`) con las del oficio (`underwriting`,
  `delinquency`, `disbursement`).
- **Aprendida a las tres veces bien**, y ahí **deja de salir**. Medido por el navegador: tres vueltas
  de 20 palabras dejaron `aprendidas=20` y la tanda siguiente ya no las ofrece.
- **El banco vive en el tablero**, o sea en Postgres cuando el despliegue lo trae. El código es la
  migración y **reemplaza** lo guardado en vez de completarlo — es la lección que ya pagó el impostor,
  donde sumar sin reemplazar dejó quince palabras que nadie podía borrar.
- **La interfaz del juego está en inglés**; los comentarios y las notas de cada palabra, en español.
- **El cuadro de todos muestra números, nunca palabras**: cuántas aprendió cada quien y por nivel. Qué
  se le escapa a alguien es diagnóstico suyo.

### Decisiones que conviene no re-litigar

- **Practicar no pide sesión, guardar sí**, y la pantalla lo dice *antes* de empezar. Un 401 al
  guardar después de veinte palabras es el peor final posible.
- **El umbral de las tres lo decide el servidor** y viaja en cada respuesta. Si el navegador lo
  dedujera, subirlo a cuatro dejaría dos respuestas a la misma pregunta.
- **El banco SÍ viaja al navegador**, al revés que el catálogo del impostor: el sintetizador que
  pronuncia es el del navegador. Allá leer el catálogo gana el juego; acá sólo se lo arruina uno mismo.
- Se manda **un POST al terminar la vuelta**, con incrementos y no con el estado. Con el estado, dos
  pestañas se pisan y el contador baja solo.

### Preguntas abiertas

- ¿El banco sirve? 150 palabras escritas de una sentada, sin que nadie las haya practicado. Lo que va
  a decirlo es el uso: si una palabra nunca se falla, sobra del nivel; si todos la fallan tres veces,
  está en el nivel equivocado. Hoy eso **no se mide** — el tablero guarda aciertos y fallos por
  persona, no por palabra agregada.
- ¿Hace falta un cuarto nivel, o alcanza con agregar palabras a los tres?
- El progreso es por persona y por palabra, pero **no guarda cuándo**. Sin fecha no se puede hacer
  repaso espaciado, que es lo que haría que una palabra aprendida hace un mes vuelva a salir.

### Dos cosas que se arreglaron de paso

- `dev/plantillas.mjs` no entendía un `v-for` desestructurado (`v-for="[a, b] in pares"`) y reportaba
  como rotas expresiones que andaban. Un falso positivo enseña a ignorar la salida, que es la única
  forma de que ese chequeo deje de servir. Probado al revés: con una expresión inventada sigue
  saliendo ✗ y con 1.
- El oráculo del dictado (`dev/ingles.mjs`) corre en `npm run build`, así que una corrección rota no
  llega a la imagen. Probado al revés reimplementando la comparación de la forma obvia y equivocada
  —posición por posición—: sale ✗ diciendo que señala 4 columnas donde debería señalar 1.

## Cómo se comprueba

```
task check TOOL=cuadrilla      # construye la imagen: gofmt, vet, tests con -race, y los dos oráculos
task conforme TOOL=cuadrilla   # el contrato del repo, por HTTP contra la imagen
```

Y el ciclo completo por el navegador, que es lo único que prueba la regla de las tres: levantar la
herramienta en un puerto, sembrar una sesión a mano en el JSON del tablero, y jugar tres vueltas del
mismo nivel.

## Registro

**2026-09-21** — Mudado el inglés a los games de cuadrilla y podado a sólo dictado, con niveles,
banco en el tablero y la regla de las tres veces. Commit `dd72da3` en `cuadrilla/ingles-en-los-games`,
sin push. `task check` y `task conforme` en verde.
