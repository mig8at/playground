---
id: 93
title: "Cuadrilla"
clase: proyecto
ramas: cuadrilla/
stage: work
created: "2026-09-21T09:40:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Esta es la única tarea local de **cuadrilla**, la herramienta del repo compartido
(`github/playground/tools/cuadrilla`): el tablero de épicas rama por rama, y la sección `games` que
cuelga de él. Las mejoras de la herramienta van acá; lo que sea del repo compartido en sí va a la
tarea de playground.

Lo último: el segundo juego, un **dictado de inglés con tres niveles**, **mergeado y en producción**
desde el 2026-09-21 (PR #260).

El banco es **el definitivo: 450 palabras, 150 por nivel** (PR #261, mergeado y en producción), y
desde el PR #263 una palabra se aprende **en tres días distintos**, no en tres veces.

**El próximo paso es:** decidir si hace falta **progresión entre niveles**, que es lo único que quedó
sin hacer del pedido original. Hoy los tres están abiertos desde el primer día y terminar uno no desbloquea ni
sugiere nada: sólo se marca Completed y se le apaga el botón. Hay dos formas y son distintas —
bloquear los siguientes hasta terminar el anterior, o dejarlos abiertos y sólo empujar al siguiente al
completar uno— y la segunda es menos frustrante para quien ya sabe inglés y quiere ir directo al
avanzado.

## Días, no veces (2026-09-21, PR #263)

Salió de la misma conversación: Miguel preguntó si el juego sirve de verdad para mejorar el inglés, y
la respuesta honesta fue que mueve una sola aguja —el paso de sonido a escritura— y que además tenía
un defecto que la anulaba: **no había espaciado**. Medido: tres vueltas seguidas, diez minutos, y
veinte palabras quedaban aprendidas para siempre. La herramienta no las volvía a preguntar nunca,
porque para ella ya estaban.

Ahora una palabra se aprende **acertándola en tres días distintos**. Diez aciertos de la misma tarde
son un día. El piso de un nivel pasó a ser tres días, pase lo que pase.

### Las tres decisiones que lo sostienen

- **El día lo decide el servidor, y es el de Colombia con offset fijo.** En UTC, practicar a las 7 de
  la tarde en Bogotá ya es el día siguiente, así que dos vueltas de la misma noche contarían como dos
  días y la regla se cae. Y va fijo en −5 porque **alpine no trae la base de zonas horarias**:
  `LoadLocation` anda en tu máquina y falla en el cluster.
- **Lo acertado hoy va al FONDO de la tanda.** Sin esto la segunda vuelta del día devuelve las mismas
  veinte palabras, ninguna avanza, y la herramienta parece rota estando perfecta. Al fondo y no
  afuera, y marcadas, para que la pantalla explique por qué no suman.
- **La regla se ve en pantalla** (`day 2 of 3`). Una regla invisible es una rareza.

### Y lo que se decidió NO hacer

La **cola de repaso** —que una palabra aprendida vuelva a los 7, 30 y 90 días— quedó afuera a
propósito, porque cambia el producto y no sólo la medición: el repaso espaciado de verdad no termina
nunca, y eso choca con querer que un nivel se pueda terminar. Si se hace, la salida es separar dos
números: «aprendidas», que sólo sube y completa el nivel, y «para repasar hoy», que es una cola aparte
que no toca la barra.

⚠ **Y el riesgo de lo que ya se hizo, para tenerlo a la vista:** esto convierte el juego en una
herramienta de hábito diario. Si el equipo lo abre una vez al mes, **nadie completa un nivel nunca**, y
eso se va a sentir peor que antes. Vale medirlo antes de agregar nada más.

## El banco definitivo (2026-09-21, PR #261)

Salió de una pregunta de Miguel: si se puede seguir agregando palabras, y si terminar un nivel sube
al siguiente. Lo primero sí; lo segundo no existe. Y de ahí salió el problema real: **un nivel que
crece deja de ser una meta**. Quien lo termina y al mes siguiente lo ve otra vez con «20 nuevas» no
terminó nada, y a la segunda vez que le pasa deja de valer la pena terminar ninguno.

Así que el banco se cargó entero de una: **450 palabras, 150 por nivel**, un archivo por nivel porque
es contenido y no lógica. Y el tamaño **quedó clavado con una prueba**, para que crecerlo sea
deliberado y no algo que se cuela en un commit que iba a otra cosa.

Cuánto es un nivel, en números: 150 palabras × 3 aciertos = **450 respuestas correctas**, y una vuelta
son 20 palabras. O sea **23 vueltas por nivel en el mejor caso** y 68 para el banco entero. Eso es una
meta; 50 palabras no lo eran.

**Se fijó el inglés americano** —`color`, `neighbor`, `favorite`, `center`, `installment`— y se hizo
AHORA por un motivo concreto: cambiarle la ortografía a una palabra ya cargada **no es gratis**. La
clave del progreso es la palabra, así que corregir `neighbour` a `neighbor` no la corrige: crea otra,
y la vieja queda aprendida por gente que ya no la va a ver. El tablero de prod estaba vacío, así que
era el único momento libre.

### Lo que se aprendió armándolo

- **Una prueba que depende del CONTENIDO se pone roja sin que la regla cambie.** «Pedí una tanda de 60
  y miro si está `house`» funcionaba con 50 palabras por nivel; con 150, la tanda tiene techo y la
  palabra dejó de salir por azar. Las pruebas de la regla pasaron a un banco de juguete de seis
  palabras, y el banco de verdad tiene las suyas.
- **El error del impostor volvió con otra cara.** Allá fue `tijera` junto a `tijeras`; acá, `threshold`
  junto a `threshold amount`. El chequeo de duplicados no lo caza porque como texto son distintas, así
  que ahora hay uno que sí.
- **Medido:** el documento del tablero pasa de 28 a 57 KB, la mitad el banco. Cuadrilla lo relee
  entero en cada pedido con base compartida. Si alguna vez pesa, el banco es lo único del documento
  que no cambia entre despliegues y se puede quedar en memoria.

## El dictado de inglés (2026-09-21)

Salió de mudar la herramienta personal `playground/ingles` a los games de cuadrilla, y en el camino se
podó: **quedó sólo el dictado**, sin lector, sin glosario y sin historias. La razón está en el código
y vale repetirla: leer con el glosario al lado se puede hacer copiando letra por letra sin aprender a
escribir nada; el dictado saca el modelo de la pantalla y deja sólo el sonido.

Lo que hay hoy, todo verificado corriendo:

- **Tres niveles** (`games/english/bank_*.go`, uno por nivel). El eje es la **ortografía**, no el
  significado: `island` es intermedio por su `s` muda y `house` es de principiante. El nivel avanzado
  mezcla las clásicas (`accommodate`, `queue`, `colonel`) con las del oficio (`underwriting`,
  `delinquency`, `disbursement`).
- **Aprendida a los tres DÍAS distintos**, y ahí **deja de salir** (PR #263; al principio eran tres
  veces, y eso resultó ser memoria corta).
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

## Lo que quedó SIN verificar en producción, y por qué

**Si el banco de palabras llegó de verdad a Postgres.** No se puede saber desde afuera, y es culpa
del diseño: si la escritura falla, `bank()` cae en silencio a la lista que trae el binario y la
herramienta se ve **idéntica**. Los 150 palabras que contesta prod prueban que el juego anda, no que
el documento se guardó.

El arreglo es una línea —que `seedBank` registre en el log cuando escribe y cuando falla, en vez del
`_ =` de hoy— y hace falta porque hoy el único síntoma sería que un cambio del banco no se refleje
después de desplegar, que es justo el momento en que nadie lo va a mirar.

**Guardar progreso en prod.** Exige sesión de GitHub en el navegador, y el juego saca quién sos de la
cookie y nunca del cuerpo (igual que el impostor). Se comprobó que **niega sin sesión** con el
mensaje correcto; el camino de guardado quedó probado en local y por las pruebas, no contra prod.

## Registro

### 2026-09-21

**El día en que esta tarea nació y el segundo juego llegó a producción.** Hasta hoy cuadrilla no
tenía archivo propio: sus mejoras se escribían en la tarea de `playground`, donde se mezclaban con
las del repo compartido. Se abrió este contenedor y se le movió lo que era suyo.

Lo que se hizo, según los commits del día (`60c6b91e`, `a56d96be`, `13a12edd`, `c41f762f`,
`24bf7045`):

- el **dictado de inglés** se mudó a la sección `games` y quedó **mergeado y en producción**
  (PR `Creditop-SAS/playground#260`);
- el **banco definitivo** del dictado: 450 palabras, y lo que quedó fuera del pedido
  (PR `#261`);
- la **regla de los tres días** —el inglés cuenta DÍAS distintos, no veces— (PR `#263`);
- y quedó escrito lo que se decidió NO hacer, que es lo que evita re-litigarlo.

> **MEDICIÓN · 2026-09-21** — los minutos de la bitácora salen del **lapso de commits**
> (10:46 → 11:17), no del pulso: hoy corrieron varias sesiones en paralelo sobre el mismo worktree y
> los tramos de 5′ del pulso no se pueden atribuir a una tarea sin contarlos dos veces. El lapso de
> commits mide de menos y se declara así a propósito. Reproducible:
> `git log --since=midnight --format='%ad %s' --date=format:'%H:%M' -- tablero/data/cuadrilla.md`

**2026-09-21** — La regla pasó a contar días distintos (PR #263). Reloj inyectable para poder
probarla, y comprobado también contra la herramienta corriendo, moviendo la fecha del documento entre
arranques: tres aciertos seguidos dejan `dias: 1`; uno al día siguiente la lleva a 2; al tercero queda
aprendida y desaparece de la tanda.

**2026-09-21** — Mudado el inglés a los games de cuadrilla y podado a sólo dictado, con niveles,
banco en el tablero y la regla de las tres veces. **PR #260 mergeado por Miguel** y desplegado; el
workflow de despliegue salió en verde a los segundos del merge.

Validado contra **producción** (`cuadrilla.playground.creditop.com`): el despliegue se detectó con
`/api/ingles/niveles` pasando de 404 a 200, exigiendo **10 sondas seguidas** por el despliegue
rodante. Los tres niveles contestan 50 palabras cada uno, una tanda del avanzado trae palabras reales
con sus notas, un nivel inventado da 404 y guardar sin sesión da 401 con el mensaje que explica cómo
entrar.

Y mirado de verdad, no sólo por API: el panel del navegador deniega `*.playground.creditop.com`, así
que va por un proxy inverso local (`FlushInterval = -1` y reescribir el `Host`, o el balanceador no
sabe a qué herramienta mandarlo). Contra producción se jugó una vuelta del nivel avanzado: la
corrección letra por letra salió bien —«mortgage» contra lo que escribí, con la nota «la t no suena»—
y al escribirla bien aparece el ✓ sin corrección.
