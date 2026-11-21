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

- [ ] Sacar policías y ladrones a `game/fuga/`: termina cuando el paseo no importa nada de esa carpeta y el probador pasa sin el nivel del juego viejo.
- [ ] Aplicar las texturas de fachada y techo en el 3D: termina cuando el paseo muestra el paquete elegido en el visor.
- [ ] Listar las propiedades de una ciudad (departamentos, locales, casas) con área y precio base: termina cuando la misma semilla da siempre el mismo listado y se ve en el visor.
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
- **Pocos mundos, no cientos de ciudades**: por idioma (habla hispana, habla inglesa) o por país (Colombia, Argentina, Chile), no una por ciudad real. «Si no, se pierde la lógica».
- **Grafitis en las fachadas**, estilo pixel art: cada quien pone punticos y deja algo escrito o dibujado. Para eso la planta baja necesita paredes, no sólo vidrieras.
- **Colocar lo comprado con exactitud**: un cuadro en un lugar específico de la casa, «que encaje».
- **Lo de policías y ladrones se saca** del juego; si se guarda, en una carpeta chica aparte (`fuga`).
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
| dónde va cada contenedor de basura | `game/src/engine/contenedores.js` |
| el dibujo del plano 2D, el alzado y las texturas | `game/src/lib/drawPlan.js`, `texturas2d.js` |
| el visor del plano · el catálogo · el paseo en 3D | `/plano` · `/catalogo` · `/juego?paseo=1` |
| las pruebas y la auditoría | `game/harness/pruebas/probar.mjs`, `auditar-plano.mjs` |

## Frentes

Cada uno con su condición de cierre. Los hechos pasan a la pila como bloque.

### 1. Sacar policías y ladrones a `game/fuga/` — pendiente

**Qué**: la ronda, la persecución, los bots, las guaridas, el botín, el allanamiento, el menú del juego y sus pruebas.
**Por qué no se hizo todavía**: `DemoView.vue` (1.100 líneas) mezcla el paseo con la partida, y el nivel 9 del probador (12 pruebas) es casi todo de ese juego. Sacarlo es un cambio grande que conviene hacer solo, con el probador antes y después.
**Cierre**: el paseo (`/juego?paseo=1`) funciona sin importar nada de `fuga/`; el probador pasa sin el nivel del juego viejo; lo viejo corre desde su carpeta o queda archivado.

### 2. La ciudad bonita — en curso

**Hecho**: veredas, cordones y asfalto; sombras; techos; nombres; texturas de fachada y techo en seis paquetes; alzado de cada edificio; paños de muro en la planta baja de los locales.
**Falta**: aplicar las texturas en el 3D (hoy sólo en el plano); costa con contorno curvo; puentes y muelle; carreteras del monte de menos de 15 % (hoy hasta 32 %).
**Cierre**: Miguel mira el catálogo de fachadas y el paseo y dice que la ciudad «se vende sola».

### 3. Todo calculado en el 2D — en curso

**Hecho**: auditoría repetible (de 635 casos a 22 en cuatro ciudades); contenedores sobre el andén; depósitos con muebles propios; estante con su medida; colocación de objetos con su prueba.
**Falta**: 14 baños de departamento sin ducha (la ventana no deja); la cómoda (su modelo no cabe: pide otro modelo); el archivador (el plano reserva el doble); regenerar las dos tablas de medidas, cuyos scripts no están en el repo.
**Cierre**: `node harness/pruebas/auditar-plano.mjs 4` no lista ningún renglón que sea un defecto.

### 4. Propiedades — sin empezar

**Qué**: que cada unidad del plano (departamento, local, casa) sea una propiedad con identificador estable, área, precio base calculado y dueño.
**Primer paso que no depende de nada**: el listado de propiedades de una ciudad, con su área y un precio por m² según zona y piso, visible en el visor.
**Cierre**: un listado de propiedades por ciudad, estable entre corridas (la misma semilla da las mismas propiedades).

### 5. Comprar y colocar — empezado

**Hecho**: diez objetos (cinco de pared, cinco de piso) se colocan a mano en el plano de un piso, con sus reglas; se guardan en el navegador.
**Falta**: dueño y permiso (sólo en lo propio); tienda y moneda; verlo en el 3D; las casas del monte; mover o quitar lo que puso el generador.
**Cierre**: un jugador compra un cuadro, lo cuelga en su departamento y otro jugador lo ve.

### 6. Grafitis en las fachadas — sin empezar

**Qué**: pintar píxeles sobre los paños de muro de la planta baja.
**Primer paso**: del plano sale la lista de paños pintables (edificio, lado, de dónde a dónde, alto), que es lo que se venderá o se dejará pintar. El cambio de vidrieras del 2026-11-21 es lo que crea esos paños.
**Cierre**: en el alzado de un edificio se puede pintar sobre un paño y queda guardado.

### 7. Mundos por idioma o país — sin empezar

**Qué**: qué distingue un mundo de otro (paquete de texturas, nombres de calles, comercios) y cómo se elige el tamaño según la gente que entra.
**Cierre**: dos mundos generados que se ven distintos sin tocar el generador, sólo con su paquete.

### 8. Multijugador y dinámicas — sin empezar

Personas reales, chat, empleos, conductor. Depende de 4 y 5. Hoy todo el multijugador de la entrada está simulado.

## Estado de la rama

Todo el trabajo está en la rama `game/visual` de `mig8at/playground`, PR 6 (abierto al 2026-11-21). Hay commits locales sin subir: Miguel decide cuándo.

## Lo que no está verificado

- Nada de lo hecho se probó en la Mac: todo en el PC con Linux.
- Las ciudades grandes (576 m y 720 m) no se abrieron en 3D ni pasaron por el probador, que sólo mira la de 3 por equipo.
- Las texturas y los objetos colocados no se ven en el 3D.
- El probador que se corre es el rápido, de una ciudad; el completo de cuatro no se corrió.
