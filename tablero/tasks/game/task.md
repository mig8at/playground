---
id: 136
title: "Game"
clase: proyecto
nivel: miguel
stage: work
created: "2026-11-21T12:00:00-05:00"
jira: []
jira_title: ""
---

## Pendientes

- [x] Sacar policías y ladrones a `game/fuga/`: la pantalla de la ciudad no pide ningún archivo de esa carpeta y el probador (48 pruebas) pasa sin el juego viejo.
- [ ] Limpiar de `DemoView.vue` el código dormido del juego viejo: termina cuando el archivo no nombra la ronda ni la persecución fuera de `cargarFuga`.
- [x] Llevar la vivienda vacía y el punto de aparición al 3D: el paseo dibuja 3.033 muebles menos que el juego viejo en la ciudad chica (los que saca el plano) y la persona aparece en el sitio que da el plano.
- [ ] Sacar de las cocinas vacías lo que el 3D pone encima del mesón (ollas, comida): termina cuando una cocina entregada sólo tiene mesón, estufa, nevera y lavaplatos.
- [x] Caminar Colombia (720 m) en 3D con la primera imagen en menos de 15 s: abre en 14 s y rinde 60–74 cuadros por segundo, sin cargar por zonas.
- [ ] Decidir si hace falta cargar el 3D por zonas. Depende de: Miguel — hoy no hace falta para 720 m; haría falta para una ciudad bastante más grande o para una máquina más lenta que este PC.
- [ ] Aplicar las texturas de fachada y techo en el 3D: termina cuando el paseo muestra el paquete elegido en el visor.
- [x] Listar las propiedades de una ciudad (departamentos, locales, casas) con área y precio base: la misma semilla da el mismo listado y se ve en el visor.
- [ ] Revisar la fórmula del precio base. Depende de: Miguel — los factores (clase, centro, piso, parque) son propuesta de Claude.
- [ ] Dar dueño a una propiedad: termina cuando una propiedad se puede marcar como comprada por alguien y el listado lo muestra.
- [ ] Listar los paños de muro pintables de la planta baja, para los grafitis: termina cuando cada paño sale con edificio, lado, tramo y alto.
- [ ] Permitir colocar objetos en las casas del monte y verlos en el 3D: termina cuando un cuadro colgado en el plano aparece en el paseo.
- [ ] Bajar las carreteras del monte a menos de 15 % de pendiente (hoy hasta 32 %): termina cuando la auditoría lo mide y no lo lista.
- [ ] Decidir el gancho inicial para las primeras personas. Depende de: Miguel — elegir entre las ideas de «Cómo se propone armarlo».
- [ ] Decidir cómo se cobra (alquiler, suscripción o compra). Depende de: Miguel — es una decisión de negocio.

## Objetivo

Game: la ciudad generada de `game/` y el juego que va a salir de ella. Es de my-tools, lo personal de Miguel: no es de CreditOp y no va a Jira. Esta tarea junta el rumbo, las decisiones y los frentes; el cómo se usa cada pieza vive en `game/LEEME.txt`.

**El rumbo cambió el 2026-11-21.** El juego deja de ser policías y ladrones («esa dinámica no me gusta»). Pasa a ser una **ciudad social donde la gente compra propiedades**: cada quien entra, compra un lugar, lo amuebla, lo puede revender, y lo que retiene es encontrarse con personas reales, no con bots.

Antes de pasar al juego, Miguel quiere **seguir refinando la ciudad**: la estética y, sobre todo, que todo esté calculado en el plano 2D, «porque eso permite tener control del juego».

## Lo que dijo Miguel (2026-11-21, tal cual se entendió)

- **Todo se compra y todo se vende**, con una moneda propia: el departamento, el mobiliario, la ropa, el carro, un viaje en taxi.
- **La propiedad se revende**: el dueño de un departamento se lo puede vender a otro.
- **Dinámicas que muevan plata**: ser conductor (un «Uber» dentro de la ciudad), conseguir un empleo. Con la duda propia: un negocio sin gente no sirve de nada.
- **El primer mundo es Colombia**, en el tamaño más grande (720 × 492 m). Las ciudades chicas quedan para más adelante, como barrios o ciudades puntuales.
- **Pocos mundos, no cientos de ciudades**: por idioma (habla hispana, habla inglesa) o por país (Colombia, Argentina, Chile), no una por ciudad real. «Si no, se pierde la lógica».
- **Grafitis en las fachadas**, estilo pixel art: cada quien pone punticos y deja algo escrito o dibujado. Para eso la planta baja necesita paredes, no sólo vidrieras.
- **Colocar lo comprado con exactitud**: un cuadro en un lugar específico de la casa, «que encaje».
- **Lo de policías y ladrones se saca** del juego; si se guarda, en una carpeta chica aparte (`fuga`).
- **La vivienda se entrega vacía**: sin sofás ni televisor, «limpia, para que el usuario la modifique a su gusto»; el baño y la cocina sí vienen.
- **Quien entra aparece donde hay menos gente**: por ahora sin personajes, sólo puntos; la ciudad tiene un límite de población.
- **Falta el gancho inicial**: qué hace que las primeras personas quieran entrar. Sin resolver.

## Cómo se propone armarlo (propuesta de Claude, sin decidir)

Es interpretación mía de lo que pidió, para discutir; nada de esto está construido salvo lo que dice «Hecho».

- **Un mundo es un servidor con cupo.** El inventario es la cantidad de propiedades: la ciudad chica tiene 75 edificios y ~100 casas; la enorme, 743 edificios. Cuando se llena, se abre otro mundo del mismo idioma o país.
- **Qué es una propiedad**: un departamento (una unidad del plano, ya numerada), un local, una casa del monte. El plano ya las tiene medidas, con dirección.
- **Cobrar como alquiler o suscripción, no como inversión.** Los mundos que vendieron terrenos virtuales con plata real como inversión se vaciaron y dejaron compradores sin nada. La reventa entre jugadores, con la moneda del juego.
- **Los locales son la propiedad social**: un lugar que alguien atiende da motivo para encontrarse. Conviene que sean los primeros en tener dueño.
- **El gancho inicial** (ideas, sin elegir): entrar y pasear gratis; un departamento chico de regalo para amueblar; trabajos simples que pagan en moneda (repartir, manejar); el grafiti como forma barata de dejar marca.
- **Riesgo principal**: una ciudad vacía no retiene. Mejor una ciudad chica y llena que una enorme y desierta.

## Dónde se toca

`game/` entero. Lo que importa para este rumbo:

| qué | dónde |
|---|---|
| el generador de la ciudad (manzanas, lotes, pisos, muebles) | `game/src/engine/blueprint.js`, `ciudad.js`, `hogar.js` |
| las medidas, con su fuente | `game/src/engine/medidas.js` |
| colocar un objeto a mano (pared y piso) | `game/src/engine/colocar.js` |
| la vivienda vacía (sólo baño y cocina) | `game/src/engine/entrega.js` |
| dónde aparece quien entra, y el cupo | `game/src/engine/aparecer.js` |
| el listado de lo que se vende, con área y precio | `game/src/engine/propiedades.js` |
| dónde va cada contenedor de basura | `game/src/engine/contenedores.js` |
| el dibujo del plano 2D, el alzado y las texturas | `game/src/lib/drawPlan.js`, `texturas2d.js` |
| el visor del plano · el catálogo · el paseo en 3D | `/plano` · `/catalogo` · `/juego?paseo=1` |
| las pruebas y la auditoría | `game/harness/pruebas/probar.mjs`, `auditar-plano.mjs` |

## Frentes

Cada uno con su condición de cierre. Los hechos pasan a la pila como bloque.

### 1. Sacar policías y ladrones a `game/fuga/` — hecho, falta limpiar

**Hecho**: la ronda, la partida, los bots, la persecución, las patrullas, las armas, el menú con su mapa y ocho pruebas viven en `game/fuga/`. La pantalla de la ciudad los carga sólo con `?fuga=1` o en `/demo`.
**Lo que se quedó**, porque la ciudad lo usa: `guaridas` (los transeúntes), `botin` (el generador del plano), `mapa`, `transeuntes` e `identidad`.
**Falta**: `DemoView.vue` todavía tiene el código del juego viejo, dormido; el título conserva las pantallas de salas.
**Cierre**: el del pendiente de arriba.

### 1b. Colombia en 3D — hecho sin cargar por zonas

**Lo que se creía y era falso**: que el 3D no podía con las ciudades grandes («la de 444 m no terminó en 2 minutos, la de 720 m en 4»). Era un error de medición de Claude: se probaba en una pestaña de fondo, y ahí el navegador pausa el paso que arranca el armado. Con la pestaña al frente la de 720 m abría en 35 s.
**Lo que sí tardaba**: de los 22 s de armar la ciudad, 21 eran una sola función, la que corrige caras superpuestas (`engine/titileo.js`), por cómo anotaba los pares ya vistos. Acelerada, con resultado idéntico al de antes.
**Cómo quedó**: Colombia abre en 14 s y rinde 60–74 cuadros por segundo con 6,7 millones de triángulos, en el PC con Linux.
**Cargar por zonas** (la idea de Miguel, como GTA) queda como opción para una ciudad más grande o una máquina más lenta: hoy toda la ciudad está en memoria y se dibuja entera.

### 2. La ciudad bonita — en curso

**Hecho**: veredas, cordones y asfalto; sombras; techos; nombres; texturas de fachada y techo en seis paquetes; alzado de cada edificio; paños de muro en la planta baja de los locales.
**Falta**: aplicar las texturas en el 3D (hoy sólo en el plano); costa con contorno curvo; puentes y muelle; carreteras del monte de menos de 15 % (hoy hasta 32 %).
**Cierre**: Miguel mira el catálogo de fachadas y el paseo y dice que la ciudad «se vende sola».

### 3. Todo calculado en el 2D — en curso

**Hecho**: auditoría repetible (de 635 casos a 22 en cuatro ciudades); contenedores sobre el andén; depósitos con muebles propios; estante con su medida; colocación de objetos con su prueba.
**Falta**: 14 baños de departamento sin ducha (la ventana no deja); la cómoda (su modelo no cabe: pide otro modelo); el archivador (el plano reserva el doble); regenerar las dos tablas de medidas, cuyos scripts no están en el repo.
**Cierre**: `node harness/pruebas/auditar-plano.mjs 4` no lista ningún renglón que sea un defecto.

### 4. Propiedades — empezado

**Hecho**: el listado sale del plano, sin azar. Cuatro clases: departamento (una unidad de un edificio), local (cada cuarto de comercio), casa (un lote de casa en la ciudad) y casa del monte. Cada una con identificador estable, dirección, área y precio base. En Colombia: 3.583 propiedades (2.373 departamentos, 957 locales, 55 casas, 198 casas del monte), 211.744 m².
**El precio base** (propuesta de Claude): área × 1.000 × clase × centro × piso × parque. Local ×1,6, casa ×1,25, casa del monte ×1,1; hasta +50 % en el centro; +3 % por piso hasta +24 %; +10 % a menos de 12 m de un parque.
**Falta**: dueño y compra; oficinas, hoteles y públicos no se venden por ahora; la moneda.
**Cierre**: una propiedad cambia de dueño y el listado lo muestra.

### 5. Comprar y colocar — empezado

**Hecho**: la vivienda se entrega vacía (sólo baño y cocina; en Colombia, 2.626 viviendas). Diez objetos (cinco de pared, cinco de piso) se colocan a mano en el plano de un piso, con sus reglas; se guardan en el navegador.
**Falta**: dueño y permiso (sólo en lo propio); tienda y moneda; verlo en el 3D; las casas del monte; mover o quitar lo que puso el generador.
**Cierre**: un jugador compra un cuadro, lo cuelga en su departamento y otro jugador lo ve.

### 6. Grafitis en las fachadas — sin empezar

**Qué**: pintar píxeles sobre los paños de muro de la planta baja.
**Primer paso**: del plano sale la lista de paños pintables (edificio, lado, de dónde a dónde, alto), que es lo que se venderá o se dejará pintar. El cambio de vidrieras del 2026-11-21 es lo que crea esos paños.
**Cierre**: en el alzado de un edificio se puede pintar sobre un paño y queda guardado.

### 7. Mundos por idioma o país — sin empezar

**Qué**: qué distingue un mundo de otro (paquete de texturas, nombres de calles, comercios) y cómo se elige el tamaño según la gente que entra.
**Cierre**: dos mundos generados que se ven distintos sin tocar el generador, sólo con su paquete.

### 8. Multijugador y dinámicas — empezado por el punto de aparición

**Hecho**: quien entra aparece en el sitio del andén con menos gente alrededor; el cupo es una persona por vivienda (propuesta de Claude: un número para cambiar). La gente es, por ahora, puntos de prueba en el plano.

Personas reales, chat, empleos, conductor. Depende de 4 y 5. Hoy todo el multijugador de la entrada está simulado.

## Estado de la rama

Todo el trabajo está en la rama `game/visual` de `mig8at/playground`, PR 6 (abierto al 2026-11-21). Hay commits locales sin subir: Miguel decide cuándo.

## Lo que no está verificado

- Nada de lo hecho se probó en la Mac: todo en el PC con Linux.
- Las ciudades grandes (576 m y 720 m) no pasan por el probador, que sólo mira la de 3 por equipo. La de 720 m se abrió en 3D y se miró una esquina; no se recorrió entera.
- Las texturas y los objetos colocados no se ven en el 3D: sólo en el plano. La vivienda vacía en el 3D se comprobó contando muebles, no entrando a mirar un departamento.
- Después de la vivienda vacía y el punto de aparición no se corrió el probador entero, sólo la prueba nueva (`validar-aparecer`).
- El probador que se corre es el rápido, de una ciudad; el completo de cuatro no se corrió.
