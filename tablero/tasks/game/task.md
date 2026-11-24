---
id: 137
title: "Game"
stage: work
created: "2026-11-21T12:00:00-05:00"
knowledge: []
jira: []
jira_title: ""
---

## Pendientes

- [x] Sacar policías y ladrones a `game/fuga/`: la pantalla de la ciudad no pide ningún archivo de esa carpeta y el probador (48 pruebas) pasa sin el juego viejo.
- [ ] Limpiar de `DemoView.vue` el código dormido del juego viejo: termina cuando el archivo no nombra la ronda ni la persecución fuera de `cargarFuga`.
- [x] Llevar la vivienda vacía y el punto de aparición al 3D: el paseo dibuja 3.033 muebles menos que el juego viejo en la ciudad chica (los que saca el plano) y la persona aparece en el sitio que da el plano.
- [x] Sacar de las cocinas vacías lo que el 3D ponía encima de la estufa (una olla y una sartén): en la ciudad chica salieron 236 y 236; la comida que queda es la de los locales.
- [x] Hacer hermética la puerta de calle (el hueco del marco es la hoja): `validar-fachada3d` da 8 de 8 marcos sin rendija.
- [x] Dibujar desde la calle sólo lo que se ve, más 35° a cada lado (occlusion culling de los lotes y las plantas del plano): `validar-calle` sin lotes visibles fuera de la lista; de 36 a 61 % menos triángulos en ocho vistas de la ciudad 1.
- [ ] Llevar la oclusión a lo que está fuera de la grilla del plano —las casas del monte (~390 mil triángulos en una vista de calle), los árboles del mundo, los barrios—: termina cuando una prueba como `validar-calle` los cubre y una vista de calle deja de dibujar los que tapa la ciudad.
- [ ] Hacer herméticos también los marcos sin hoja (balcón y paso de la terraza del dúplex). Depende de: Miguel — hoy son pasos abiertos a propósito («se sale caminando»); para la oclusión cuentan como una abertura siempre abierta.
- [ ] Medir los cuadros por segundo y el peor cuadro con y sin oclusión en la Mac, caminando (`?oclusion=0` la apaga): termina cuando se mide con el panel del navegador visible; oculto, los cuadros no corren y los números no sirven.
- [x] Caminar Colombia (720 m) en 3D con la primera imagen en menos de 15 s: abre en 14 s y rinde 60–74 cuadros por segundo, sin cargar por zonas.
- [ ] Decidir si hace falta cargar el 3D por zonas. Depende de: Miguel — hoy no hace falta para 720 m; haría falta para una ciudad bastante más grande o para una máquina más lenta que este PC.
- [x] Dar textura a las fachadas en el 3D: siete texturas dibujadas (ladrillo, ladrillo pintado, sillar, estuco, panel, hormigón, tablilla), la misma en el alzado 2D y en el 3D.
- [x] Dar textura también a los techos y al zócalo en el 3D: mansardas de pizarra, azotea con membrana y gravilla, zócalo de piedra.
- [ ] Pintar grafitis desde adentro del 3D y guardarlos en un servidor: termina cuando lo que pinta una persona lo ve otra.
- [x] Hacer que el plano decida la pieza exacta de cada módulo de fachada y que el 3D la lea de ahí: una prueba compara lo que arma el 3D con el plano, módulo por módulo, sin diferencias.
- [x] Medir el vano exacto de cada puerta de calle: la vista de fachadas muestra cada puerta con su medida, comprobada contra la pieza del 3D.
- [x] Medir las fachadas de los edificios que no son un rectángulo simple: cada tramo del contorno tiene su dibujo y sus paredes (un edificio en L, seis tramos).
- [x] Pasar el alzado de la ficha del plano a tramos: en un edificio en L el alzado y el editor de pixel art muestran el mismo tramo.
- [x] Calibrar las franjas de los departamentos a 4 y 2 m (módulos enteros): hecho; el baño de 3 × 2 m funciona sin ventana en su pared corta.
- [x] Dejar en 0 las dos pruebas que quedaron fuera de margen con la calibración: corregidas en su causa, sin tocar los topes; el probador entero pasa.
- [ ] Bajar la gente encimada a la salida del colegio (5,2 % por cuadro, a menos de medio metro): termina cuando la prueba de sociedad la mide por debajo de 3 %, como a las 11.
- [x] Calibrar las suites de hotel y hospital: 6 m de frente, baño de 3 × 2 m; probador en 0.
- [ ] Decidir si las fachadas de calle deben tener más pared pintable. Depende de: Miguel — hoy 20 de 132 fachadas de la ciudad chica tienen alguna; se podría pintar el muro entre ventanas, o hacer que el generador deje paños ciegos.
- [x] Guardar con cada pared pintada su huella y la versión de la ciudad, en SQLite: lo pintado sigue a su pared si cambia de número y queda apartado si la pared cambió (`validar-guardado`).
- [ ] Validar en el servidor, contra el plano, que la huella que manda el navegador es la de esa pared: termina cuando un pedido con un número y una huella que no se corresponden se rechaza. Hoy la base sólo revisa la forma.
- [x] Achicar el baño de 2 × 6 m de las casas de la ciudad de 720 m: ahora baño de 2 × 3 m y zona de ropas; la auditoría da 4 casos.
- [ ] Hacer que las pruebas de usos y de ciudad acepten el tamaño de la ciudad: termina cuando corren con la de 720 m.
- [ ] Decidir si se BORRA del repo el código de colores, texturas y muebles (hoy sólo no se muestra). Depende de: Miguel — los muebles del generador son lo que mide que cada cuarto sirve; borrarlos deja sin base las pruebas de usos, interiores y muebles.
- [x] Pasar el plano de cada piso a plano técnico: cuartos en blanco, medidas y cotas, lo fuera del metro en rojo.
- [x] Llevar a metro entero los cuartos que quedan en medio metro: 0 en cuatro ciudades, probador en 0.
- [ ] Llevar a línea de módulo de 2 m los 650 tabiques que llegan a la mitad de un módulo de fachada sin perder dormitorios: termina cuando la vista de fachadas no muestra cortes naranjas. Con el paso de 2 m se pierde el 17 % de los dormitorios.
- [x] Viviendas sin dueño cerradas: persianas lisas, puerta trancada y sin interior armado (engine/propiedad.js).
- [ ] Comprar una vivienda: termina cuando al comprarla se abre su puerta, se suben sus persianas y se arma su interior. Depende de: Miguel — cómo se compra (precio, dinero del jugador, servidor). Ojo: el id de un apartamento (`L<lote>:<unidad>`) se repite en cada piso; hay que sumarle el piso antes de guardar dueños.
- [ ] La escalera de mano como objeto del juego, para pintar desde afuera hasta 8 m: termina cuando en el 3D se puede apoyar, subir y pintar una pared de fachada del primer piso.
- [ ] Darle vidriera al local de esquina del lote 593 de la ciudad de 720 m (armado desde el otro frente): termina cuando `auditar-plano.mjs 1 1 --equipo=16` no tiene renglones de coherencia.
- [ ] Decidir si se quita también el dron (V). Depende de: Miguel — hoy queda como primera persona en el aire, útil para mirar fachadas altas.
- [ ] Mostrar y recuperar las paredes huérfanas: termina cuando desde el plano se ve qué quedó apartado y se puede volver a poner en una pared de la misma medida.
- [ ] Numerar también las casas del monte (sus manzanas, después de las de la ciudad): termina cuando una pared de una casa del monte tiene su número de 10 cifras.
- [ ] Unir las dos caras de un tabique en una sola pared con dos caras. Depende de: Miguel — hoy cada cara es una pared aparte (una por cuarto); decidir si la base de datos las quiere así o como una pared con dos lados.
- [ ] Decidir quién puede pintar un muro. Depende de: Miguel — adentro, el dueño; afuera, el dueño del edificio, cualquiera, o pagando con la moneda.
- [ ] Permitir pintar las paredes de las casas del monte: termina cuando una pared de una casa del monte se pinta en el plano y se ve en el 3D.
- [ ] Decidir si se usan texturas de foto bajadas de internet. Depende de: Miguel — hoy todas están dibujadas en el código, del mismo estilo; las de foto (libres, de Poly Haven o ambientCG) se verían más reales y menos «de dibujo», y pesan más.
- [x] Listar las propiedades de una ciudad (departamentos, locales, casas) con área y precio base: la misma semilla da el mismo listado y se ve en el visor.
- [ ] Revisar la fórmula del precio base. Depende de: Miguel — los factores (clase, centro, piso, parque) son propuesta de Claude.
- [ ] Dar dueño a una propiedad: termina cuando una propiedad se puede marcar como comprada por alguien y el listado lo muestra.
- [x] Listar los paños de muro pintables de la planta baja, para los grafitis: cada paño sale con edificio, lado, tramo, alto y dónde queda en el plano (233 en dos ciudades chicas).
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
- **Las fachadas, con textura y de color parejo**: «están muy planas», y después «hay fachadas con colores diferentes; que queden uniformes». Y que sus espacios salgan medidos del 2D.
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
| la fachada medida: vanos, paños, textura y paños pintables | `game/src/engine/fachada-medida.js` |
| las texturas de muro del 3D | `game/src/lib/texturas3d.js` |
| qué pieza va en cada módulo de cada fachada (lo lee el 3D) | `game/src/engine/fachada-piezas.js` |
| la vista técnica de fachadas | `/fachadas` · `game/src/lib/drawFachada.js` |
| el grafiti: la grilla de pixel art de un muro · los muros pintables · su capa 3D | `game/src/engine/grafiti.js` · `game/src/engine/muros.js` · `game/src/lib/grafitis3d.js` |
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
**Hecho el 2026-11-21**: textura en las fachadas del 3D y color parejo por barrio (cada barrio usa sólo tradiciones de pared pareja: piedra crema, encalado, ladrillo oscuro, concreto; las de muchos colores quedan guardadas en `tradicionesVariadas`).
**Falta**: la azotea plana casi no se nota desde lejos; costa con contorno curvo; puentes y muelle; carreteras del monte de menos de 15 % (hoy hasta 32 %).
**Cierre**: Miguel mira el catálogo de fachadas y el paseo y dice que la ciudad «se vende sola».

### 3. Todo calculado en el 2D — en curso

**Hecho**: auditoría repetible (de 635 casos a 22 en cuatro ciudades); contenedores sobre el andén; depósitos con muebles propios; estante con su medida; colocación de objetos con su prueba.
**Falta**: 14 baños de departamento sin ducha (la ventana no deja); la cómoda (su modelo no cabe: pide otro modelo); el archivador (el plano reserva el doble); regenerar las dos tablas de medidas, cuyos scripts no están en el repo.
**Cierre**: `node harness/pruebas/auditar-plano.mjs 4` no lista ningún renglón que sea un defecto.

### 3b. Las fachadas, calculadas antes del 3D — empezado

**La idea de Miguel (2026-11-21)**: una vista de fachadas que funcione como el mapa 2D: los cálculos exactos de puertas y ventanas de toda una fachada, sin los adornos del edificio, para validar todo antes de verlo en 3D, incluso dónde las paredes internas cortan la fachada.
**Hecho**: la vista `/fachadas`, por cuadra: cada edificio con sus lados en dibujo técnico —muro, pisos, módulos de 2 m, cada hueco con la medida que ocupa, la línea roja donde corta una pared interna, y las paredes que se pintan en blanco con su número—, lo medido al lado y si cuadra.
**El plano decide la pieza de cada módulo** (2026-11-21): cada lado de casilla que da afuera tiene 3 módulos de 2 m y, en cada piso, cada módulo lleva una cosa —muro, ventana con su modelo, ventanal, vidriera, puerta, puerta doble, portón, balcón o media ventana doble—. Lo calcula `engine/fachada-piezas.js` con las reglas que antes estaban dentro del 3D, queda guardado en el plano (`L.modulos`) y el 3D lo lee. De la pieza sale su vidrio exacto, y de ahí los huecos de cada pared, sin adivinar.
**La grilla**: casilla de 6 m = 3 módulos de 2 m; piso de 3 m; píxel de 5 cm (un módulo son 40 × 60 píxeles). Todo en enteros.
**Afinado el 2026-11-21**: cada módulo mide lo que ocupa de verdad en una sola cuenta (`vanoDeModulo`): la ventana, su vidrio y su marco sin salirse del módulo; la puerta, el vano de su marco (la de piedra 1,36 × 2,96 m; la de metal 1,14 × 2,93; la de madera, el módulo); la puerta doble, hasta 2,60 m; la vidriera, su módulo y su piso. Se comprueba que ninguna pared interna corta un vano (5.118 cortes en dos ciudades, ninguno). El marco de la puerta de madera salía 15 cm de cada lado de su módulo en el 3D: se recortó a la grilla.
**Tramos (2026-11-21)**: la fachada ya no se mide por los cuatro lados del rectángulo que envuelve al edificio sino por TRAMOS: cada recta de su contorno, con código de lado y número (N0, E0, S0, S1…). Un edificio en L tiene seis. Antes, en una L, se daba por fachada un tramo donde no hay edificio y se salteaba el rincón. La vista dibuja cada tramo, y rayados los pisos que tapa el edificio de al lado.
El alzado con adornos de la ficha del plano y el editor de pixel art también van por tramo (un edificio en L ofrece sus seis).
**A escala completa (2026-11-21)**: las tres pruebas de fachada corren también en la ciudad de 720 m y pasan: 45.936 módulos iguales entre el plano y el 3D, 3.286 tramos, 32.723 paredes de fachada y 76.316 caras de cuarto, 24.487 paredes pintables. **La grilla, medida**: ninguna medida de cuarto ni corte de pared cae fuera de la grilla de 5 cm; el 88 % de los cortes de pared cae justo en una línea de módulo de 2 m y el 12 % adentro de un módulo (a 0,5, 1 o 1,5 m), por los baños y cuartos de 1,5, 2,5 y 3,5 m de ancho. La vista los marca en naranja.
**La ciudad entera de un vistazo**: `/fachadas` tiene «Ver la ciudad entera, por cuadra»: una fila por cuadra con edificios, tramos, módulos, paredes, las que se pintan, vanos, cortes y si cuadra. La misma cuenta (`medirFachada`, `resumenDeFachadas`) sirve al dibujo y a la prueba. En la de 720 m: 83 cuadras, 64.116 módulos, toda la ciudad cuadra, en menos de un segundo.
**Falta**: los barrios del monte calculan sus módulos al armarse, no los traen guardados.
**Cierre**: lo que muestra `/fachadas` es exactamente lo que arma el 3D, comprobado por una prueba. Para las piezas de cada módulo ya se cumple (`validar-fachada-piezas`).

### 3c. Calibrar las medidas a la grilla — hecho en los departamentos

**El pedido de Miguel (2026-11-21)**: calibrar las medidas para que faciliten los cálculos, sin que el mapa deje de ser agradable; números exactos para construir la ciudad a medida.
**Qué desalineaba**: no el ancho de los cuartos sino el FONDO de las dos franjas de un departamento, 3,5 m (fachada) y 2,5 m (interior): el tabique entre ellas llegaba a las fachadas laterales a 2,5 o 3,5 m de la esquina.
**Qué se calibró**: las franjas pasan a 4 y 2 m, módulos enteros de la grilla de 2 m. Para que entrara hubo que corregir dos cosas que salieron al medirlo: el baño cuyo borde a la fachada es un solo módulo va sin ventana (con ella, en la pared corta, no entraban la ducha ni el lavamanos), y en una sala con cocina de 4 m o menos no va el escritorio opcional (cerraba el paso al hall).
**Resultado** (tres ciudades chicas): los tabiques que llegan a la fachada en un metro entero pasan de 91 a 94 %, con las mismas 727 viviendas y 685 dormitorios; la auditoría del plano baja de 10 casos a 4 (desaparecen los 6 baños sin ducha). En la ciudad de 720 m: 91 % de los cortes en línea de módulo (antes 88 %), toda la ciudad cuadra y las paredes pintables de fachada pasan de 2.115 a 4.577.
**Lo que se evaluó y NO se eligió**: tabiques de los departamentos cada 1 m (casi no mejora, 2 % menos de viviendas y, junto con las franjas nuevas, 135 fallas de usos); cada 2 m (16 % menos de dormitorios).
**Las dos pruebas que habían quedado fuera de margen, corregidas en su causa** (sin tocar los topes): la pared que parpadeaba se apagaba y se prendía en 20 cm al pasar de un espacio a otro; ahora una pared recién apagada no vuelve a prenderse hasta 0,6 m, salvo que tape al jugador. La de la gente encimada contaba como encimados a un chico y quien lo lleva, que van juntos a propósito; se cuentan aparte (0,8 % a la salida del colegio) y lo demás queda en 5,2 % contra el tope de 6 %. El probador entero pasa: 53 pruebas en 0.
**Las suites de hotel y hospital, a medida** (`blueprint.js` `SUITE`): 6 m de frente; del lado del pasillo, 2 m de fondo con el baño de 3 × 2 m y una entrada de 3 × 2 m con armario; la habitación llega a la fachada en línea de módulo. En fondo corto, el baño a un costado de 2 m de ancho con la ducha de 80 cm. 97 % de los tabiques en metro entero, ningún baño de habitación sin ducha; quedan 261 habitaciones de 333 en tres ciudades. No entró: 4 m de frente con baño de 2,5 × 2 m (26 sin ducha) ni con pasillo de entrada de 1 m (0,88 m libres, el personaje no pasa por su puerta); 5 m de frente da las mismas 261.
**Cierre**: el probador entero en 0 con las franjas calibradas.

### 4. Propiedades — empezado

**Hecho**: el listado sale del plano, sin azar. Cuatro clases: departamento (una unidad de un edificio), local (cada cuarto de comercio), casa (un lote de casa en la ciudad) y casa del monte. Cada una con identificador estable, dirección, área y precio base. En Colombia: 3.583 propiedades (2.373 departamentos, 957 locales, 55 casas, 198 casas del monte), 211.744 m².
**El precio base** (propuesta de Claude): área × 1.000 × clase × centro × piso × parque. Local ×1,6, casa ×1,25, casa del monte ×1,1; hasta +50 % en el centro; +3 % por piso hasta +24 %; +10 % a menos de 12 m de un parque.
**Falta**: dueño y compra; oficinas, hoteles y públicos no se venden por ahora; la moneda.
**Cierre**: una propiedad cambia de dueño y el listado lo muestra.

### 5. Comprar y colocar — empezado

**Hecho**: la vivienda se entrega vacía (sólo baño y cocina; en Colombia, 2.626 viviendas). Diez objetos (cinco de pared, cinco de piso) se colocan a mano en el plano de un piso, con sus reglas; se guardan en el navegador.
**Falta**: dueño y permiso (sólo en lo propio); tienda y moneda; verlo en el 3D; las casas del monte; mover o quitar lo que puso el generador.
**Cierre**: un jugador compra un cuadro, lo cuelga en su departamento y otro jugador lo ve.

### 6. Grafitis en las fachadas — empezado

**Qué**: pintar píxeles sobre los paños de muro de la planta baja.
**Hecho**: del plano sale la lista de paños pintables (edificio, lado, tramo, alto, y sus dos puntas en la ciudad): el muro de la planta baja entre vano y vano, del zócalo (0,8 m) al dintel (2,6 m), de 1 m de ancho o más. El alzado de cada edificio los marca en verde.
**Hecho también**: pintar. Lo que se pinta es el **muro entero** (decisión de Miguel, 2026-11-21): una fachada completa o una pared de un cuarto, sin sus ventanas ni sus puertas; afuera y adentro, para decorar la casa. La grilla es de píxeles de 5 cm (una fachada de 12 × 6 m son 240 × 120), con 15 colores, pincel de 1 a 8 píxeles y acercar. Se pinta en el plano, queda guardado en el navegador y el paseo en 3D lo muestra en esa pared.
**Las paredes son independientes** (decisión de Miguel, 2026-11-21): una fachada no es un solo muro. Cada lado se parte en paredes de un piso de alto y, a lo ancho, de un tabique al siguiente; cada una tiene su identificador (`L<lote>-<lado>-P<piso>-T<tramo>` afuera, `L<lote>-P<piso>-C<cuarto>-<lado>` adentro). La fachada se sigue pintando de corrido, pero se guarda y se carga por pared: es lo que después lista una base de datos. Un edificio enumera todas las suyas.
**Sólo sobre pared** (Miguel, 2026-11-21: «el pixel art está sobre puertas y ventanas; las paredes ya deben saber dónde están»): los huecos de cada muro salen de lo que de verdad ocupa cada pieza del 3D —el vidrio de su modelo de ventana con marco, alféizar y dintel; el módulo entero de una puerta o de una vidriera con su toldo; el balcón; la ventana doble— y de la franja del zócalo. Donde el 3D elige entre varias piezas se toma la mayor, así que hay muro liso que hoy no se deja pintar.
**Sólo se pintan las paredes lisas, y cada una tiene un número** (decisión de Miguel, 2026-11-21): pintable es la pared sin ninguna puerta ni ventana, que no es de un baño ni una medianera tapada por el vecino. Su identificador es un número de 10 cifras: cuadra (3) · edificio (2) · piso (2) · pared (3); por ejemplo `0020501001`. Colombia tiene 24.740 (2.368 de fachada); lo más alto de cada parte: cuadra 83, edificio 22, piso 7, pared 35. El número sale del orden del plano: si cambia el generador, las paredes se renumeran.
**Para verlo**: en el alzado, «Ver qué se pinta: blanco sí, gris no»; en el 3D, `/ciudad?pintables=1`; y un enlace abre un edificio directo (`/plano?lote=33&lado=N&mapa=1`). **Lo que muestra**: con la regla de «sólo paredes sin vanos», en la ciudad chica sólo 20 de 132 fachadas de calle tienen alguna pared pintable; casi todo lo pintable queda adentro.
**Falta**: las casas del monte (su plano está en otras coordenadas); pintar desde adentro del 3D; guardarlo en un servidor para que lo vean otros; quién puede pintar cada muro (el dueño adentro; afuera, por decidir).
**Cierre**: una persona pinta un muro y otra lo ve al pasar.

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
