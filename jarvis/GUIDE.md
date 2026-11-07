# Guía · aprender una herramienta y automatizarla con Jarvis

Para las herramientas del día a día (VTEX, Shopify, el admin de Creditop…). La meta: que cualquier tarea frecuente
se haga de una vez, con una receta, y que se entienda lo que la herramienta hace por debajo. Es el modelo del
harness: **la API es el camino rápido; la pantalla automatizada, el camino visual** (para ver, enseñar o probar la
pantalla misma).

## Los cuatro niveles

**1 · Entender la herramienta por encima.** Qué tiene y para qué sirve cada cosa, tal como se organiza: sus
secciones, qué se hace en cada una y cómo se relacionan (en VTEX, un producto no se vende sin política comercial,
precio y stock). Sale de un **barrido de secciones** (`jarvis/dev/sweep.ts`): recorre el menú en el Chrome de la
persona sólo mirando y anota de cada pantalla su título, sus encabezados, si vive en un iframe y qué APIs llama al
cargar. Se escribe en `jarvis/maps/<app>/README.md`, en lenguaje simple, separando lo que se vio de lo que se supone.

**2 · El mapa de pantallas.** Cada formulario con sus campos y botones, con el localizador que Jarvis verificó
(`make jarvis-map APP=<app> A=save SCREEN=…`), y `A=verify` para saber cuándo la herramienta cambió.

**3 · Casos de uso reversibles.** Una tarea concreta, con su ida y su vuelta probadas (crear y borrar, prender y
apagar), para practicar sin ensuciar la cuenta. Cada caso deja:
- el **paso a paso manual**: la receta por pantalla, que usa el mapa;
- las **llamadas de red** que hizo la herramienta mientras tanto: de ahí sale la API, con sus endpoints y en orden;
- la **receta por API**, derivada de esas llamadas;
- una **comprobación de punta a punta** que no depende del camino (en VTEX, la simulación del carrito dice si el
  producto se vende de verdad; un 200 de la API no lo dice).

**4 · El catálogo.** Todo junto y buscable: `jarvis/recipes/README.md` (qué se puede hacer, por pantalla y por API,
con sus trampas) y los mapas.

## Reglas

- **Partir de algo que ya funciona** y copiar su forma (en VTEX, la BMX fue el molde del producto nuevo).
- **Una receta no duplica** si se corre dos veces, **dice qué falló y en qué paso**, y **comprueba el resultado**.
- **Lo que afecta a toda la cuenta** (en VTEX: afiliaciones, condiciones de pago) va marcado y con el OK de Miguel
  antes de correrlo, aunque tenga vuelta.
- **«Reversible» se prueba**: hay cosas que no se borran, se desactivan, y eso se anota por caso.
- **Lo que no se vio no se escribe como cierto**: el nivel 1 distingue lo medido en el barrido de lo que se sabe de
  la documentación.
