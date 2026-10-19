# FUGA · el generador de la ciudad por etapas

Código: `src/engine/blueprint.js` (`generateBlueprint({seed, team})`). Se ve en **`/generador`**
(`?jugadores=3&semilla=12&etapa=6&edificio=14&piso=1`; las flechas ← → cambian de etapa).

La ciudad queda definida en los datos, de lo grande a lo chico. Cada etapa sale sólo de la semilla y de la anterior: la
misma semilla da la misma ciudad en cualquier navegador y en Node (nunca se usa el azar dentro de un `sort`). El motor
del juego (reglas y bots) todavía juega sobre `ciudad.js`; esto es la base sobre la que se van a pasar las reglas nuevas
(tres golpes, el hangar del Profesor, las cajas: `IDEAS.md` §00) y la que el 3D va a dibujar.

**Escala**: la ciudad en casillas de 6 m (las del motor); adentro de los edificios, metros, en una rejilla de 1 m. Las
paredes son líneas (el 3D les da grosor). Coordenadas: x a la derecha, y hacia abajo, en metros (el 3D usa z = y).

## Las etapas

| # | Etapa | Regla |
|---|---|---|
| 1 | Ciudad | El tamaño sale de los jugadores (~200 casillas por jugador): 33×25, 41×29, 53×37 o 67×47. |
| 2 | Manzanas | Las calles salen de cortar el mapa en dos una y otra vez; los cortes largos son avenidas (`ciudad.js`). Cada manzana recibe un uso: **edificios**, **parque**, **plaza**, **patio** o la **comisaría**. |
| 3 | Edificios | Cada manzana se parte en **lotes** que dan a la calle. Angosta (≤4 casillas): una fila de lotes de lado a lado, o dos filas espalda con espalda si tiene 4 de fondo. Ancha: un **anillo** de 2 casillas de fondo con un **patio de manzana** adentro; cada esquina del anillo es, el 70 % de las veces, un **lote en L** (el cuadro de la esquina más un brazo de 1–2 casillas hacia cada calle; nunca sobre un callejón). Los callejones quedan libres (cortan filas y anillos). Lotes de 1–3 casillas de frente. Cada lote: su **frente** (el lado más largo que da a la calle; avenida primero) y qué tiene de cada lado (calle, avenida, patio, medianera). Tipo: los públicos (hospital, colegio, biblioteca, bomberos) en los lotes grandes y separados; la comisaría y los objetivos del juego, en el lote más grande de su manzana; el resto vivienda, oficinas, comercio, hotel o casa (los lotes de una casilla). Un nombre sin repetir por edificio. |
| 4 | Pisos | Rango por tipo: vivienda 3–7, oficinas 4–9, comercio 2–4, hotel 5–8, hospital 4–5, colegio 2–3, biblioteca y bomberos 2, comisaría 3. +2 si da a una avenida (no los públicos, las casas ni los locales). Máximo 12. Por el frente (casillas que dan a la calle): con 1 casilla, casa o local de un piso y sin núcleo; con 2, como mucho 3 pisos (sin ascensor: al lado de la escalera quedan 8 m de franja). Los públicos y especiales van en lotes de 2+ casillas de frente. |
| 5 | Núcleo | Escalera en U de 4 m (`STAIR_W`: dos tramos de ~1,9 m libres, 4 m de fondo; 2 m sólo en lotes de 6 m de frente con una fila de cuartos) y, desde 4 pisos, ascensor de 2 m al lado; cada uno con su vano al pasillo. Va en la franja de atrás, nunca en la fachada, en el metro par que deja más franja aprovechable (tramos que llegan al largo de un departamento con alcoba): casi siempre en una punta. En una L, el núcleo va en el ala principal y el pasillo del ala del costado sigue por un **paso de 2 m** en la franja de atrás de la principal (el núcleo se corre si choca). Fondo ≤ 8 m: no hay pasillo; una fila de cuartos y el núcleo en una punta con un descanso. Fondo 9–14 m: pasillo de 2 m a 6 m del fondo (cuartos de 6 m adelante, de 4 m atrás). Fondo ≥ 15 m: pasillo al medio. |
| 6 | Cuartos | Cada franja (adelante y atrás, a los lados del núcleo) se parte en cuartos siguiendo el **programa** del tipo, con anchos reales. Anchos **pares** (2, 4, 6 m…): los tabiques caen en las juntas de los módulos de fachada de 2 m, así cada módulo es entero de un cuarto y lleva su ventana. Ninguno más chico que su mínimo (el sobrante se lo queda el anterior; si no hay, va otro tipo del programa que entre, o un depósito). Los departamentos: franja de fachada 3,5 + interior 2,5 (una casilla), pasillo de 1,5, y largos de 8, 12 o 15 m (1, 2 o 3 alcobas, `unitLengths`); el resto se suma al último. Los pisos de arriba repiten el plano (como un edificio de verdad); la planta baja tiene el suyo: el **vestíbulo** frente al núcleo con la puerta de calle, y a los lados locales, recepción, urgencias, aulas o garaje según el tipo. |
| 7 | Puertas y ventanas | Una puerta de 1 m por cuarto al pasillo, cerca de una punta (sin pasillo, al cuarto siguiente). La planta baja: puerta de calle en el vestíbulo y en los locales (con vitrinas), portón en el garaje. Ventanas donde el cuarto toca la calle, la avenida o el patio, una por módulo de 2 m, mirando qué hay afuera en las dos puntas de cada ventana; también en el muro que asoma por encima de un vecino más bajo (en los pisos que asoman), en la escalera donde el núcleo da a la fachada y en todos los baños (chica). Nunca en una medianera compartida ni donde se unen las dos alas de una L. El pasillo, con una ventana en cada punta que da afuera. |
| 8 | Muebles | Cada cuarto con su receta, contra las paredes (descontando su grosor: 24 cm en fachadas y medianeras, 8 cm en tabiques) y con 1 m libre delante de cada puerta; las medidas son las de los modelos que los dibujan en 3D; lo alto (armarios, estantes, neveras) no va bajo una ventana; las mesas al centro con sus sillas. Todo edificio tiene al menos un **escritorio con computador** (por la trama, el hangar puede estar en cualquiera): las oficinas, recepciones, aulas y locales lo tienen siempre, y salas y dormitorios a veces. **Cajas** en depósitos, archivos, locales, garajes y a veces en el vestíbulo, para esconder el botín. |
| 9 | Isla | La isla flotante alrededor de la ciudad (`src/engine/isla.js`, las mismas cuentas que dibuja el 3D): pradera, playa, agua baja y honda, y dos o tres macizos de montaña que terminan en acantilado. En casillas de 6 m, con su propio azar (la ciudad no cambia): **pueblos** —uno o dos en la costa y uno o dos en la montaña, en el lugar más parejo— con una **plaza** de 3×3 y hasta 10 casas de dos pisos y dos casillas alrededor mirando a la plaza; el de montaña con un **puesto de policía** (dos casillas: oficina, celda, dormitorio) y el de costa con una o dos **tiendas**. Después, casas sueltas: de playa (mirando al agua), fincas en la pradera y cabañas en la montaña, y un **refugio** de dos pisos en lo más alto. Cada casa es un lote con su plano (el mismo armado que los de la ciudad: `buildLot`). El **globo** en la arena más lejos de la ciudad y el **parapente** en lo más alto a menos de 14 m del acantilado. **Salidas** en el muro del borde (cada ~6 casillas) y **senderos**: el camino más barato por el terreno desde las salidas a cada plaza, casa, globo y parapente (pradera 1, arena 1,3, agua baja 3, montaña 1,5 más la subida; lo que ya es sendero o plaza 0,4, así se juntan). Los pueblos van en **terrazas**: cada casilla del pueblo (la plaza, las casas, sus puertas y una casilla alrededor) toma un nivel plano, la altura redondeada a escalones de 3 m desde la plaza (la plaza a su nivel; cada casa y su puerta, al de la casa). **Carreteras de montaña** (dos carriles, una casilla) desde las salidas hasta la plaza de cada pueblo de montaña y la puerta del refugio: camino en 8 direcciones con pendiente de hasta 12 % por tramo (más empinado cuesta 400 por cada unidad de exceso), cada giro cuesta (más cuanto más cerrado) y lo que ya es carretera cuesta poco; en la ladera el camino la cruza de lado y zigzaguea solo. En un paso en diagonal se suma la casilla de la esquina (la carretera queda unida por los lados). Los lotes de la isla van aparte (`bp.isla.lots`; su id sigue la numeración de la ciudad). |

### Departamentos (etapa 6, vivienda y los pisos de arriba del comercio)

Cada franja a los lados del pasillo se parte en departamentos de 5–12 m de frente (un sobrante de menos de 5 m es un
depósito con cajas). **Se entra por la sala**: es la única puerta al pasillo, y los demás cuartos se abren a ella. El baño
queda adentro, del lado del pasillo y sin ventana; la cocina y los dormitorios, del lado de la fachada.

| Frente | Departamento |
|---|---|
| 10–12 m | dormitorio (4) · sala (4–6) · cocina sobre baño (2) |
| 8 m | sala con cocineta (4) · dormitorio sobre baño (4) |
| 5–6 m | estudio · baño (2) |

En los lotes de 6 m de fondo (sin pasillo) hay un solo departamento por piso: sala con cocineta junto al descanso, y el
dormitorio con el baño detrás, los dos abiertos a la sala (o un estudio con su baño si no caben). En el plano, cada
departamento tiene el contorno más grueso y su número (Apto 201 = piso 2, el primero).

### Programas (etapa 6, el resto de los tipos)

| Tipo | Franja de adelante | Franja de atrás |
|---|---|---|
| Casa | sala 4–5, dormitorio 3–4 | cocina 3, baño 2 |
| Oficinas | oficina 3–4, oficina abierta 6–9, oficina 3–4 | reuniones 4–5, baño 2, cocineta 2–3 |
| Hotel | habitación 4 (la mitad con camarote) | baño 2, habitación 4, depósito 2–3 |
| Hospital | habitación 4–5 | enfermería 4–5, baño 2, habitación 4–5 |
| Colegio | aula 7–8 | baño 3, profesores 4–5 |
| Biblioteca | lectura 8–12 | baño 2, archivo 4–6 |
| Bomberos | dormitorio con camarotes 4–5, sala 4–5 | cocina 3–4, baño 2 |
| Comisaría | oficina 3–4, oficina abierta 6–8 | celda 3, celda 3, baño 2 |
| Objetivo | oficina 3–4 | bóveda 4–5, baño 2 |

## Los datos

```
{ seed, team, map,            // map: la ciudad de ciudad.js (casillas)
  blocks: [{id, x0,y0,x1,y1, use, site}],
  courts: [{x0,y0,x1,y1}],    // patios de manzana
  lots: [{ id, block, x0..y1 (casillas, la caja), rect:{x,y,w,h} (m, la caja), parts:[{x,y,w,h}] (m: 1 rectángulo, o 2 en L),
           shape ('L' o nada), wings:[{x0..y1, front, sides, role:'main'|'arm'}], front:'N|S|W|E', sides:{N,S,W,E},
           type, name, floors, pcs,
           levels: [{ level, rooms:[{id,type,x,y,w,h}], corridor:[…], core:{x,y,w,h,lift},
                      doors:[{x0,y0,x1,y1,a,b,street,core,wide}], windows:[{x0,y0,x1,y1,shop}],
                      furniture:[{kind,x,y,w,h,pc}] }] }],
  stats }
```

## El 3D (`/demo`)

`/demo` dibuja esta ciudad tal cual (`src/lib/town3d.js`, llamado desde `world3d.js` con `plan`): lo construido son las
casillas de los lotes y los patios de manzana quedan abiertos. Por fuera, **ladrillo en todos los edificios** (cada uno con su pintura o el ladrillo natural; los públicos con su color), con la ventana de marco claro (`Brick_Window_Trim`) sólo en el primer piso y la sencilla (`Brick_Window_Square_Single`, 188 triángulos contra 650) arriba y en los baños, en **módulos de 2 m**
(por eso el plano pone las ventanas, las puertas de calle y las vitrinas en módulos de 2 m desde la esquina del lote, y el
núcleo en un metro par); medianeras ciegas por encima del vecino más bajo; cornisa y columnas en las esquinas. Por dentro,
los tabiques del plano con sus vanos, dinteles y marcos, la escalera en U del núcleo (umbral de 10 cm, un tramo que sube 1,5 m hacia el fondo, descanso de 1,38 m, el otro tramo que
sube los otros 1,5 m volviendo; tramos de 2,52 m en 9 peldaños de 16,7 × 28 cm, medidas reales, unos 31°; de primer piso para arriba con losa inclinada debajo; pared al medio, hueco en la losa de cada piso y baranda en el último; la altura bajo los
pies sigue los peldaños) y el ascensor al lado desde 4 pisos y los muebles del plano (modelos de los paquetes de Casa y Oficina, o cajas de color
para lo que no tiene modelo; el computador sobre el escritorio). El minimapa es esta misma ciudad en la etapa de edificios (`drawCityStage`). Tabiques y muebles se dibujan sólo cerca de la cámara;
los choques están siempre. La gente de adentro (`indoor3d.js`) se sienta en las sillas y duerme en las camas del plano.

## La ciudad se valida con matemática, antes del 3D

Las medidas viven en `src/engine/medidas.js` (el catálogo: grilla, alturas, muros, puertas, escalera, pasillo y los
mínimos). `src/engine/volumenes.js` calcula del plano cada pared con su grosor real, cortada por sus vanos, piso por
piso. `node scripts/validar-ciudad.mjs [ciudades] [semilla0] [--todo]` revisa cada edificio: puertas (luz libre, que
unan lo que dicen, que no se metan en una pared ni en la fachada, que no se encimen), paredes (astillas, tabiques contra
una ventana), cuartos y halls (lado mínimo), superpuestos y planta sin dueño. Sale con código 1 si algo falla. Correrlo
después de tocar `blueprint.js`.

## El núcleo se valida antes del 3D

`node scripts/validar-nucleos.mjs [ciudades] [semilla0]` (2026-10-15) revisa, sobre el plano y sin navegador, cada
edificio de 2+ pisos: el núcleo y la escalera son los mismos en todos los pisos (el 3D arma la escalera y el hueco de la
losa con los de planta baja); ningún cuarto, pasillo, ascensor ni mueble se mete en el núcleo; el vano de la escalera da a
un pasillo o descanso; y el volumen de la escalera armada (las mismas cajas de `stairBoxes`, más la losa sobre el vano)
deja libre el cuerpo —radio 20 cm, de 0,4 a 1,85 m sobre la huella— por todo el camino de subida. Sale con código 1 si
algo falla. Correrlo después de tocar el núcleo en `blueprint.js` o la escalera en `town3d.js`.

## Rendimiento

El costo grande no es la geometría de adentro (tabiques, escaleras y muebles sólo existen cerca de la cámara) sino el
contorno gris (`edges3d.js`): vuelve a dibujar la escena para marcar las paredes de adentro. Va a media resolución, se
recalcula un cuadro sí y otro no, y sin recalcular las sombras. Medido en la ciudad 777: de 18 a 76 fps en la salida y de 15 a 64 en
el centro.

## Pendiente

- El modo «Golpes» ya juega sobre esta ciudad (`plano.js`, IDEAS.md §00), sólo en la planta baja: falta que use los pisos y
  los tabiques, y verlo en 3D.
- En 3D: portones con patrulla en la comisaría (el plano no le pone garaje).
- La isla (casas, playa, montaña) todavía no pasa por estas etapas.

## 2026-10-15 · patios, alturas, remates e interiores (por cálculo)
- **Patios**: el interior de cada manzana es patio entero (`generateBlueprint` normaliza `courts`: venían restos del generador viejo).
- **Alturas**: perfil por manzana y semilla (`ENCIERRO.perfiles` = .55/.8/1 del tope del encierro, más alto hacia el centro);
  esquinas +1 piso; piso mínimo = `ENCIERRO.min` de su calle; vecinos a ≤ `ENCIERRO.salto` (2) pisos, sin contar casas ni públicos.
  10 ciudades: 1:136 · 2:199 · 3:375 · 4:212 · 5:33 · 6:9 · 7:1 (antes 3:445 · 4:276 casi todo). Encierro bajo: 238 → 136 avisos (casas).
- **Remates** (`rematar`): en el cruce que cierra un tramo de carril > `CALLE.tramoMax` (72 m, Manual for Streets), una casilla
  del cruce es `K.kiosk` (glorieta/monumento), una por cruce. Vista media 105–128 m → 67–81 m; ~19 remates por ciudad.
  ⚠ En el 3D el kiosco es chico (colisión 1,05 m): falta dibujar el remate como volumen que corte la vista de verdad.
- **Interiores**: alcobas con la norma NDSS (validador: falla); estufa en `sala_cocina` y `estudio`; la cocina en línea
  (mesón + estufa + nevera) se ubica como bloque y se parte (`kitchenLine`), con la prueba de movimiento después de partir;
  triángulo de trabajo en la calidad. Triángulo abierto: 361 → 12 avisos en 20 ciudades; sin estufa: 1.216 → 0.
  Zonificación medida (alcoba de paso, baño sólo por alcoba, entrada por alcoba): 0 en 1.275 departamentos.
- Validadores: 0 fallas en 60 ciudades (3.848 edificios), núcleos 0/3.367, escaleras de casa 0/62; determinismo OK.

## 2026-10-15 · el mundo: manzanas del monte conectadas a la ciudad (por cálculo)
- **Se había roto con las calles anchas**: el detector de salidas miraba las casillas 1 y 2 del borde, que con la
  circunvalación de 2 casillas son la circunvalación misma; sólo salían las esquinas y el monte quedaba con 0 manzanas.
  Ahora una calle llega al muro donde hay calle a C+1 casillas; la salida trae `eje` (m), `ancho` (casillas), `cells`, `lado`.
- **Salidas de la circunvalación**: del lado de la montaña, cada línea de la grilla a lo largo de la ciudad sale de la
  circunvalación aunque ninguna calle de la ciudad llegue ahí (`anillo:true`).
- **Medidas**: `MANZANA.monte` = retiro 2,5 + casa más honda 12,5 (`scripts/medir-casas.mjs`) + patio 3 → media manzana de
  18 m (3 casillas); paso de la grilla = 12 + 2·18 = 48 m. Calles del monte del ancho de la calle de la que salen (12 o 18),
  en el borde de las casillas; dos ejes a ≥ dos medias manzanas + medio ancho de cada calle.
- **Piedemonte** (`isla.js MONTE.rebaje.pendiente` = 8°, talud 40 m): en la franja de las manzanas la ladera no pasa de 8°;
  el terreno se acomoda a la grilla. Con 12° las calles que suben quedaban en 15–18° (las terrazas suman al nivelarse).
- **Arreglos**: ningún tramo cruza la ciudad (antes uno unía el monte de arriba con el de abajo por encima); la poda
  conserva la entrada desde el muro hasta el primer cruce (antes se podaba y el monte entero quedaba desconectado).
- Resultado: semillas 1–12, de 2,9 manzanas de media y 4 sin monte → 12,1 de media (5–18) y 0 sin monte; 1–32: 376
  manzanas, 1.668 casas. `scripts/validar-mundo.mjs`: 0 fallas (ancho y pendiente de calles, conexión a la ciudad, casas en
  su lote sin pisar la calle ni encimarse, retiro, manzanas ≥ dos medias y ≤ MANZANA.max). `scripts/plano-mundo.mjs [semilla] [--grilla]`.
- Pendiente: el 3D de las carreteras del monte con 12 m (island3d usa `r.ancho`; el asfalto es ancho − 2); medir la
  carga del demo con el panel visible (con el panel oculto dio ~29 s, no confiable); escalinatas peatonales como opción.

## 2026-10-15 · la ladera en terrazas por curvas de nivel, unida a la ciudad
- **Una sola cuenta** (`medidas.js LADERA`): mitad 18 · paso 48 · primer anillo a 42 m del muro · muro de contención 4,5 m
  (1,5 pisos) · pendiente = muro/paso = 9,4 % (la natural junto a la ciudad es 9 %) · 3 anillos (42, 90, 138 m): más
  arriba la ladera natural pasa del 30 % (medido: 9 % → 21 → 29 → 33–36 % cada 24 m) y no se construye.
- **Terreno** (`isla.js`, `MONTE.ladera`): en la franja la altura depende sólo de la distancia al muro medida en
  paralelo a él (Chebyshev): cada línea paralela al muro —las de la grilla, que siguen las calles de la ciudad— es una
  curva de nivel exacta. Pasando la franja, un talud a la pendiente de la escalinata (35 %) hasta la montaña natural.
  `I.ladera(x,z)` da la altura de diseño; los cruces la llevan, y donde el terreno se aparta más de 5 m no hay cruce.
- **Curva de nivel por diseño**: un tramo es «a nivel» si sus dos cruces tienen la misma altura de diseño (antes, por
  la pendiente del terreno en el medio: en un valle, un tramo que sube pasaba por nivel y subía un anillo entero) y el
  anillo toma la altura de su primer cruce (antes el promedio del tramo: hasta 1,3 m de más).
- **El eje** (`grilla.eje`): de las calles que salen al monte, la que sube más anillos y después más por la escalinata;
  sigue como escalinata (`medidas.js ESCALINATA`: 15/33 cm, Blondel 63, descanso cada 12 → 35 %) hasta un mirador de
  3×3 casillas a nivel. 32 de 32 ciudades; sube 28–40 m.
- **La circunvalación es la costura**: sin remates en sus cruces (eran justo las salidas al monte); los remates del
  anillo van en su carril de afuera, lejos de las salidas, después de calcular el mundo. Vista media 78–90 m (67–81 con
  remates en todo el anillo, 105–128 sin ninguno).
- **Medido**: semillas 1–32 → 603 manzanas del monte, 2.869 casas; tramos de calle: 855 a nivel, 695 subiendo a 9,4 %,
  166 entradas desde el muro, 0 de otra pendiente. `validar-mundo.mjs` (con muros ≤ 4,5, escalinata, mirador): 0 fallas.
  Ciudad, núcleos, escaleras: 0 fallas; determinista.
- Pendiente: el 3D de la escalinata (hoy la dibujaría como calle de 6 m en rampa), el mirador y los muros de las terrazas.

## 2026-10-15 · plano unificado y parques de barrio
- `node scripts/plano-unido.mjs [semilla]`: la ciudad y el monte en un solo plano: edificios por tipo, calles con su ancho
  y su eje coloreado por pendiente (blanco 0 % → naranja 9,4 % → rojo 25 % → granate 35 %), curvas de nivel cada 4,5 m,
  muros de contención con su alto, salidas del muro (azul: calle de la ciudad; violeta: de la circunvalación), remates,
  casas, escalinata con sus descansos y el mirador. Leyenda con los metros de calle a nivel, subiendo y escalinata.
- **Parques de barrio** (`grilla.parques`): el terreno libre encerrado entre calles, lotes y la ciudad (sin llegar al
  agua, la playa ni la montaña abierta; hasta 4 manzanas) es un parque; sobre todo la esquina de la ciudad, la manzana en
  L que contiene la esquina del muro. 13 parques en 32 ciudades. Entran en la huella (el terreno se acomoda ahí también).

## 2026-10-15 · densidad de la ciudad al monte y borde verde
- **Borde verde**: en las manzanas pegadas a la ciudad, la mitad que mira al muro no tiene calle (el muro sólo se cruza
  por las salidas): es alameda (`c.borde`); antes llevaba casas de cara al muro, sin entrada (79 en 12 ciudades; el
  validador ahora pide que cada casa dé a una calle). Más la tierra libre a ≤ LADERA.mitad del muro. Del otro lado del
  muro (12 ciudades): playa 50 % · borde verde 42 % · calles 8 % · sin uso 0.
- El corte entre las dos mitades de una manzana va al medio de lo edificable (sin las calles): contra el muro dejaba
  mitades de 12 y 24 m.
- **Densidad**: en la primera fila del monte (entre el muro y el primer anillo) edificios residenciales de 18 m de frente
  (como los lotes de la ciudad; antes uno de punta a punta: salas de 12 × 4,5 y cuartos a 45 m de la escalera), con el
  perfil «bajo» de la ciudad: 2–3 pisos; más arriba, casas. Pisos medios (12 ciudades): centro 3,10 · resto de la ciudad
  2,82 · edificios del monte 2,53 · casas 1,65. `validar-ciudad.mjs` valida también los residenciales del monte.

## 2026-10-15 · vegetación y playa (`src/engine/vegetacion.js`, `bp.vegetacion`)
- Medidas en `medidas.js VEGETACION`, con sus fuentes: árbol de calle en alcorque de 1,2 m junto al cordón (deja 1,8 de
  paso), cada 8 m (avenidas 12), a ≥ 9 m de la esquina y ≥ 1,5 m del vano de una puerta (si cae delante, se corre hasta
  3 m); copa = espaciado (dosel continuo). Alameda de dos filas en el borde verde. Parques, plazas y patios: 30 % de
  copa. Jardines del monte: árboles chicos en lo libre de cada media manzana. Bosque en el monte natural. Palmeras: paseo
  cada 10 m a media casilla del muro y grupos de 2–4 en la arena. Sombrillas: filas paralelas al muro cada 4 m, ≥ 5 m
  del agua (distancia exacta al borde de la casilla de agua), paso libre de 10 m cada 100 m.
- Su propio azar (no cambia el resto del plano); determinista. Generar un mundo: ~0,8 s.
- `scripts/validar-vegetacion.mjs`: 0 fallas en 6 mundos (11.209 árboles, 909 palmeras, 4.982 sombrillas). 3-30-300:
  100 % de las viviendas ven ≥ 3 árboles a 30 m; 100 % tienen verde a ≤ 300 m; copa: monte urbanizado 52 %, ciudad 23 %
  (bajo la meta del 30 %: la ciudad es casi toda techo y calle; queda medido, no forzado).
- `plano-unido.mjs` dibuja copas por tipo, palmeras y sombrillas. El 3D todavía no lee `bp.vegetacion`.

## 2026-10-15 · especies y color de los árboles
- `medidas.js VEGETACION.especies`: 23 especies del arbolado colombiano con follaje y flor (guayacán amarillo y rosado,
  jacarandá, sietecueros, guayacán de Manizales, almendro, arrayán; en parques cámbulo, flamboyán —sólo parques: sus
  raíces rompen veredas, Revista Nodo 2010—, samán, caucho; jardines naranjo, limonero, mango, aguacate, guayabo; bosque
  roble andino, yarumo, encenillo, pino colombiano, cedro; palma real en el paseo y coco en la arena).
- Asignación (`vegetacion.js` paso 7): una especie por calle (por su nombre en la ciudad, por cadena en el monte) y por
  lado de la alameda; la que menos empuja los topes de la regla 10-20-30 (Santamour 1990: especie ≤ 10 %, género ≤ 20 %,
  familia ≤ 30 % del arbolado de la ciudad). Parques y jardines árbol por árbol; el bosque mezclado.
- `validar-vegetacion.mjs`: 0 fallas en 6 mundos; lo más alto: especie 9,8 %, género 12,1 %, familia 28,5 %.
  `plano-unido.mjs`: cada copa con su follaje y su flor, y la leyenda de especies con cuántos hay.

## 2026-10-15 · equipamiento urbano (`src/engine/equipamiento.js`, `bp.equipamiento`)
- Medidas en `medidas.js EQUIPAMIENTO` (con fuentes): faroles de 6 m cada 33 m por vereda, alternados (avenidas 9 m cada
  60), a 0,5 m del cordón y ≥ 3 m de un tronco (se corren hasta 5 m); peatonales de 4 m cada 20 en la alameda y el paseo.
  Pasos de cebra de 3 m en cada brazo de cada cruce (ciudad y monte, con línea de pare a 1,25). Semáforos en los cruces
  con avenida, uno por brazo. Paradas: toda vivienda a ≤ 200 m (zona densa, Dublín), elegidas por cobertura sobre la
  ruta (avenidas, circunvalación, calles del monte). Hidrantes en los cruces y donde falte: ningún edificio a > 75 m.
  Bancas cada 100 m en la alameda, cada 50 en el paseo y una cada 300 m² en parques y plazas, con 0,9 m libres en una
  punta y papelera al lado.
- `src/engine/veredas.js`: lo que comparten vegetación y equipamiento (veredas de la ciudad, ejes del monte, cruces).
  Un brazo de cruce existe si todo el borde del cruce sigue siendo calle (mirando una casilla salía una cebra dentro de
  un edificio en una T).
- `scripts/validar-equipamiento.mjs`: 0 fallas en 12 mundos (2.786 faroles, 1.806 cebras, 149 semáforos, 531
  hidrantes, 39 paradas, 356 bancas). Cobertura: veredas iluminadas 95,7 %, edificios a ≤ 75 m de un hidrante 100 %,
  viviendas a ≤ 200 m de una parada 100 %. Determinista.
- `plano-unido.mjs [semilla] [--detalle]`: el equipamiento dibujado; con --detalle, la ciudad grande para leerlo.

## 2026-10-15 · visor de pisos por capas y la playa equipada
- `node scripts/plano-pisos.mjs [semilla]` → `capturas/plano/pisos-<semilla>.html`: el mundo en 2D en el navegador, con un
  botón por piso. En cada piso, cada edificio con su planta (cuartos por tipo, muros, puertas —rojas las de calle—,
  ventanas, escalera con peldaños, ascensor, muebles) y los que no llegan, su techo con el número de pisos. Las casas del
  monte con su plano (hogar.js) llevado a su lugar según su frente. Interruptores: vegetación (se apaga sola arriba de la
  planta baja y vuelve al bajar), equipamiento, muebles. Rueda: zoom; arrastrar: mover.
- `scripts/plano-dibujo.mjs`: el dibujo del mundo por capas (terreno, calles, edificios, cebras, vegetación,
  equipamiento, marcas), compartido por `plano-unido.mjs` (sale igual: 23.945 piezas) y `plano-pisos.mjs`.
- La playa: torre de salvavidas en cada paso libre entre sombrillas (cada 100 m; Nevada pide ≤ 183), en la arena a 3–9 m
  del agua; kiosco a la entrada de uno de cada dos pasos. 12 mundos: 78 torres, 59 kioscos; orilla a ≤ 150 m de una torre
  99,9 %; `validar-equipamiento.mjs` 0 fallas.

## 2026-10-15 · circulación vehicular y peatonal (`src/engine/circulacion.js`, a pedido)
- `medidas.js CIRCULACION`: peatón radio 0,3, escalón 0,3 (Unity: 0,1–0,4), pendiente 45°, grilla de 0,5 m, rodeo ≤ 2
  (WSDOT); vehículo carril 3 m, por la derecha, 30/50 km/h, radio de giro de diseño 6,4 m (TxDOT/AASHTO).
- `redVehicular(bp)`: nodos (cruces en la intersección de los ejes, T, salidas del muro, cruces del monte), tramos de doble
  mano con su eje casilla por casilla y los carriles (1 o 2 por sentido) a la derecha. Lo que destapó: el nombrador junta
  calles corridas una casilla (quiebre de 6 m), pedazos que no se tocan y piezas paralelas que tocan la misma calle, y deja
  huecos en algunos cruces: la red trabaja por piezas conectadas, cubre huecos de ≤ 3 casillas y detecta las T.
- `grillaPeatonal(bp)` + `caminar(g,x,z)` (Dijkstra con montículo indexado): se camina por todas partes —calzada, pasto,
  playa, monte— salvo edificios, cuerpos de las casas (el porche se camina), el muro (salvo salidas), agua honda,
  acantilado, troncos y mobiliario; un paso vale si el desnivel cabe en un escalón o en 45°.
- Cambios del plano por la circulación: remates sólo como glorieta en el centro de los cruces de 3 × 3 casillas (en
  calles de 12 m una isla de 6 m tapaba carriles); sin remates en la circunvalación (tapaban su carril de afuera). Vista
  media 105–114 m (era 78–90): las copas de los árboles de calle la cortan en el 3D, no en el motor.
- Pasajes peatonales: en cada manzana del monte, uno cada ≤ 48 m de largo, de 3 m, con escalera que sube el muro a 35 %;
  las casas a sus lados (`grilla.pasajes`). El rodeo a pie entre casas espalda con espalda bajó de 4,2 a ≤ 2,8.
- `validar-circulacion.mjs` (12 mundos): 0 fallas. Peatones: 100 % de las puertas a pie, 94,6–99 % de lo caminable
  alcanzable (lo demás: patios de manzana y monte empinado), rodeo mediana 1,14 / p90 1,27 / máx 2,78. Vehículos: una
  sola red, 0 calles sin salida, 8 glorietas, rodeo mediana 1,34 / p90 1,41. Radio de giro que dejan las esquinas: 6,0 m
  → el auto del juego tiene que girar en ≤ 6 m.
- `plano-unido.mjs <semilla> [--detalle] --circulacion`: carriles con su sentido, glorietas y lo que no se alcanza a pie.

## 2026-10-16 · navegación dentro de los edificios y las casas (`src/engine/nav-interior.js`)
- Por piso, una grilla de 10 cm: los muros son los bordes entre espacios distintos (cuartos, pasillos, núcleo) y con la
  fachada, con su espesor + el radio del personaje (0,3); las puertas abren el borde (paso libre = ancho − 2 radios); los
  cuartos abiertos al pasillo no tienen borde; muebles (menos sillas) y ascensor estorban, inflados por el radio. Se
  entra por las puertas de calle y se sube por el núcleo (edificios) o el cuarto «escalera» (casas): peldaño de 16,7 cm.
- `navEdificio(L)`, `navCasa(h)`, `navHogar(P)`. Las casas armadas (hogar.js) ahora crecen hasta poder recorrerse: un
  cuarto al que no se llega crece 25 cm por vuelta como el que no lleva sus muebles; si no se entra, el de la puerta de
  calle (en las casas «solo» la mesa del comedor quedaba detrás de la puerta: 11 casas sin entrada en 4 mundos).
- `scripts/validar-interiores.mjs` (12 mundos: 1.205 edificios, 1.095 casas, 5.370 pisos, 50.108 espacios): se llega
  caminando al 100 % de los espacios y al 99,7 % de su piso libre; 0 fallas. Recorrido más largo desde la calle: mediana
  16 m, p90 27 m, máx 46. 88 espacios alcanzables en menos de la mitad (muebles que encierran rincones): aviso.
- El visor de pisos (`plano-pisos.mjs`) marca en magenta lo que no se alcanza caminando adentro.

## 2026-10-16 · el juego sobre el mundo nuevo y las fachadas activas
- `scripts/validar-juego.mjs`: las piezas que arma el motor (plano.js planMap) validadas con la navegación fina —por
  fuera la grilla peatonal, por dentro nav-interior—. 3 ciudades: 0 fallas; 100 objetivos con su botín alcanzable,
  celda de la comisaría alcanzable, policías y ladrones aparecen donde se camina, 1.454/1.454 cajas alcanzables.
  A pie: comisaría → objetivo mediana 92 m (16–189); objetivo → salida al monte 47 m (11–103); ladrón ↔ policía al
  aparecer 186 m (162–195); botín ↔ puerta 12 m (5–24). (El ladrón llega a una salida antes que la policía al objetivo:
  se calibra con velocidades y tiempos, no con el plano.)
- `scripts/medir-fachadas.mjs`: frente de planta baja con uso activo detrás —circunvalación 82 %, calles 79 %,
  avenidas 77 % (referencia 60–75 %: Northern Territory, Mercer Island, Inner West); comercio estricto (locales) 31–34 %.
- `plano-unido.mjs <semilla> [--detalle] --juego`: objetivos (botín, puertas vigiladas), comisaría (celda), apariciones,
  cajas y salidas al monte.

## 2026-10-16 · el probador del 2D (decisión de Miguel: el 2D prueba todo)
- `node scripts/probar.mjs [ciudades=4] [semilla0=1] [--rapido] [--solo=juego,mundo] [--todo]`: los 9 validadores del mundo
  (ciudad, núcleos, escaleras de casa, mundo, vegetación, equipamiento, circulación, interiores, juego) con las mismas
  semillas, en paralelo; tabla con fallas, tiempo y la línea clave; el detalle sólo de lo que falla; código 1 si algo
  falla. 4 ciudades: 18 s (antes, uno por uno, varios minutos). Cualquier arreglo que aparezca en el 3D se corrige en el
  2D y se agrega la regla que lo hubiera detectado.
- `caminarDesde(g, puntos)` (circulacion.js): distancias desde varios puntos en una sola pasada (validar-juego: la salida
  al monte más cercana de cada objetivo, de 48 a 14 s; ahora desde la puerta más conveniente: mediana 35 m).

## 2026-10-16 · el equilibrio de equipos (`scripts/medir-equilibrio.mjs`)
- Ventana de fuga por objetivo vs respuesta de C policías repartidos (a pie y en patrulla por los carriles), con las
  reglas del motor (game.js DEFAULTS) escaladas a metros con `JUEGO.caminar` (5,2 m/s, el de caminar del 3D). L*(C): los
  ladrones que le ganan a C policías. Equilibrio a pie: 3v3 → 4–5 policías ↔ 3 ladrones; 8v8 → 8–9 ↔ 4–6 (ver IDEAS.md).

## El botín del mundo (2026-10-16) — `src/engine/botin.js`, `BOTIN` en medidas.js
- **Qué se roba** son objetos que existen en el mundo: la caja fuerte del Banco (valor 5, se abre en 8 s), las joyas de la Joyería (valor 4, 5 s, livianas: ×1.25), una escultura en el vestíbulo de un hotel o de unas oficinas (valor 3, 4 s, pesada: ×0.6) y un cuadro en una sala de lectura o en una oficina o sala de una casa del monte (valor 2, 3 s).
- **Cuántos** según el equipo: 2→5, 3→6, 5→7, 8→8; de esos, 1/2/2/3 en el monte.
- **Dónde:** todos en planta baja. Los de pared, sin puerta a menos de 0.7 m, sin ventana y sin mueble. La escultura va suelta, con 1.1 m de holgura. En los objetos valiosos se elige la posición más adentro. El reparto es por punto más lejano desde la comisaría, y los objetivos del plano van primero.
- **Validado** (`validar-botin.mjs`, en el probador):
  - cantidad;
  - cuarto admitido;
  - con el objeto puesto como estorbo, se llega caminando a su frente y ningún cuarto queda sin alcanzarse;
  - la puerta del lugar se alcanza desde la calle;
  - mismo resultado por semilla.

  En 16 ciudades: 0 fallas.
- **Equilibrio** (`medir-equilibrio.mjs --botin`, 4 ciudades por tamaño, a pie): la fuga termina en la zona de fuga (monte natural o playa), no en la puerta de la muralla.

  | equipo | policías | ladrones |
  |---|---|---|
  | 2 | 2 | 1–2 |
  | 3 | 2–3 | 1–3 |
  | 5 | 3–4 | 2–3 |
  | 8 | 4 | 3–4 |

  Con tantos policías como objetos, cada uno cuida uno y no se gana nada: **hacen falta más objetos que policías**.
- **En el motor** (`plano.js planMap`, 2026-10-16):
  - Cada objeto del botín que cae en la ciudad es un objetivo, con su valor, su tiempo (`openTime`) y su carga, que multiplica `carrySpeed`.
  - Los bots prefieren lo que vale más.
  - Se gana por valor entregado al hangar: `map.valorQuota` = `BOTIN.meta` (0.5) del valor en juego, también en «Golpes».
  - El botín del monte queda en `map.botinFuera`, porque la grilla del motor es la de la ciudad.
  - Lo de antes (un botín por edificio robable) sigue con `plan:E:S:edificios`.
  - **Partidas con bots** en «Golpes» (`scripts/partidas-botin.mjs`, 15 partidas × 3 ciudades), ladrones ganan:

    | | botín | edificios |
    |---|---|---|
    | 2v2 | 49 % | 29 % |
    | 3v3 | 47 % | 42 % |
    | 5v5 | 24 % | 49 % |

    En 5v5 hay tantos policías como objetivos en la ciudad, como predijo la medición.

## El contrato del 2D con el 3D (2026-10-16) — `src/engine/contrato3d.js`, `src/lib/plano3d.js`
- **Qué es.** Lo que el 3D dibuja de la vegetación y el equipamiento sale de un solo lugar: `contrato(bp)`, que da una entrada por cada árbol, palmera, sombrilla y pieza del equipamiento del plano. Cada entrada lleva:
  - su lugar (los mismos x, z) y su giro: `ry = −ang`; el farol mira hacia la calzada (`hacia`, nuevo en equipamiento.js); el semáforo, a su brazo;
  - el modelo: según la forma de la especie (copa, esbelta, cónica, palma) o el objeto del catálogo;
  - la medida: copa = 2r; alto por forma (×1.25, ×1.6, ×2, ×3 la copa); la planta del plano para los objetos.
- **El 3D sólo lo dibuja.** `dibujarPlano` usa `ubicar()` (escala y posición desde la caja del modelo) y anota lo que puso, con la medida real. `window.__contrato.revisar()` lo compara en el navegador. Con el plano, la ciudad, la isla y los barrios ya no ponen su propio mobiliario (`mobiliario:false`, `ISLA3D.faroles`).
- **Validado** con `validar-contrato.mjs`, en el probador, que corre `ubicar()` en node con las cajas reales de los OBJ:
  - uno a uno;
  - cada modelo existe y el 3D lo carga;
  - lugar, giro, copa, alto, ancho y fondo, dentro del 2 %.

  Resultados: 4 ciudades, 11 767 entradas, 0 fallas. En el navegador (ciudad 1): 3042 de 3042 dibujadas, 0 fallas, y los 45 faroles de la ciudad con el brazo hacia la calzada.
- **Lo que encontró y se corrigió en el 2D:**
  - Había sombrillas en el vacío (−34 m) y en lomas de 15 m: la casilla decía playa, pero el terreno no. Ahora la arena exige el terreno de una playa, entre 0.1 y 2 m y a 2 m o más del borde (`VEGETACION.arena`), con su regla en el validador de vegetación.
  - Los objetos del catálogo no respetaban la planta del plano: ahora se llevan a ella.
- **Pendiente:**
  - Los troncos engordan con la copa, porque el modelo se escala parejo a lo ancho. Falta medir el diámetro del tronco.
  - Hacia dónde miran la parada y la torre de salvavidas: el 2D no lo dice.
  - Los carriles, la grilla peatonal y el botín todavía no están en el 3D.

## Zonas prohibidas, frentes, tronco y armonía (2026-10-16)
- **Zonas prohibidas.** `src/engine/zonas.js` es el clasificador único de qué hay en un punto: vacío, agua, franja junto al agua, playa, edificio, calzada, vereda, cebra, puerta, escalinata, mirador y pasaje. La tabla `ZONAS` de medidas.js dice, por objeto, en qué zonas no puede caer ninguna parte de su huella y qué zona tiene que pisar su centro.
  - Los generadores (`plantar`, `equipar`) la consultan al final y no ponen lo que cae mal.
  - `validar-zonas.mjs` (en el probador) la revisa de forma independiente.
  - En 4 mundos encontró 34 casos: árboles del monte delante de puertas de casas, faroles en el cordón, kioscos en el agua o en el vacío, una torre de salvavidas fuera de la playa y una papelera en la escalinata. Ahora los generadores descartan unos 21 objetos (árboles, faroles, kioscos, papelera, salvavidas). En el mirador se permiten bancas y papeleras.
- **Frentes (`hacia`).** La parada mira a la calzada; la torre de salvavidas y el kiosco, al agua más cercana. Regla `ZONAS.frentes`: lo que miran tiene que estar delante, y más cerca que detrás.
- **Tronco.** El DAP es copa/20; las palmas llevan el suyo: coco 0.30 m, palma real 0.50 m (`VEGETACION.tronco`). En el 3D, el modelo se afina sólo hasta donde abren las ramas, y el árbol se centra en su tronco. El contrato lo revisa al 10 %.
- **Armonía, medida** (`VEGETACION.armonia`, en el validador de vegetación):
  - **Bosque:** antes era una plantación, con dispersión de 0.27 a 0.44 y ningún claro. Ahora crece en manchones (`bosque.manchon`, ruido suave): dispersión de 2.3 a 3.2 y 18 a 30 % de claros. Reglas: dispersión ≥ 1.5 y claros entre 10 y 40 %.
  - **Parques:** arboledas (una cada 350 m²) alrededor de su centro, con prado abierto.
  - **Sombrillas:** antes el 82 % de las vecinas eran de otra tela; ahora cada concesión (cada 100 m) tiene una tela, y quedan entre 0 y 2 %. Regla: ≤ 10 %.
  - **Ya estaban bien:** una especie por tramo de calle (100 %), separación pareja, y el 76 % de los faroles a media distancia entre dos árboles.

## Dónde puede ir cada cosa y las colisiones, calibradas en el 2D (2026-10-16)
- **Dónde SÍ puede ir cada cosa.** `ZONAS.objetos[tipo].donde`, por subtipo:
  - árboles: el de calle, en la vereda; el de alameda, en el borde; el de parque, en el parque; el de jardín, en un lote; el de bosque, en el monte o la pradera;
  - el farol de calle, en la vereda, y el peatonal, en el borde, el paseo o la playa;
  - las bancas, en playa, parque, plaza, borde, mirador, vereda o paseo;
  - el kiosco, en la playa o el paseo.

  Zonas nuevas del clasificador: plaza, patio, parque, borde, lote, monte, pradera y paseo (la franja junto al muro, por fuera). Salieron de un censo: 105 faroles peatonales caían en una zona que no tenía nombre.
- **Colisiones** (`COLISION` en medidas.js y `src/engine/colisiones.js`). Por objeto, la parte que detiene a alguien:
  - el tronco: la mitad del DAP del 2D;
  - el mástil de la sombrilla;
  - el poste del farol;
  - la banca entera;
  - los postes, el vidrio y la banca de la parada (adentro se camina);
  - las patas de la torre de salvavidas (debajo se pasa).

  Cada una con su alto: por encima de él, se pasa por arriba. La cebra no choca, porque es pintura. El 3D (`plano3d.collide`) choca contra esto, y también los validadores.
- **Validado** (`validar-colisiones.mjs`, en el probador):
  - todo tiene regla;
  - nada que choca se encima;
  - el paso libre de cada sección de vereda (cada 0.5 m), sin contar los cruces, es de 1.8 m o más (`CALLE.paso`). En 4 mundos, 53 945 secciones: el ancho libre más angosto (p1) es 2.15 m y la mediana, 3 m;
  - las 1236 puertas siguen alcanzándose a pie con las colisiones.

  Lo que encontró y se corrigió en los generadores:
  - el hidrante del monte iba en el medio de la vereda; ahora va en la franja del mobiliario;
  - la parada (1.5 m de fondo, en el medio) no dejaba el paso; ahora mide 1.1 m (3 − 1.8 − 0.1) y va junto al cordón, de espaldas a la fachada;
  - las bancas de la alameda caían en las veredas del monte;
  - un kiosco quedaba encima de una sombrilla, porque los mástiles no contaban como estorbo;
  - el reparto de paradas, voraz, dejaba una vivienda sin cubrir; ahora vuelve a empezar desde otra primera parada, hasta 12 veces, sin juntar dos paradas.
- **Medido en el navegador:**
  - **Atravesar:** caminando derecho contra 38 objetos (árboles, faroles, bancas, papeleras, hidrantes, semáforos y paradas), en ningún paso el personaje se mete en un objeto; queda a la distancia de choque.
  - **Hundirse o flotar:** con un rayo, el suelo dibujado contra la altura con que el juego pone los pies. Antes: junto a las calles del monte, 5 de 41 puntos flotaban (hasta 1.55 m), y en el monte natural, 44 de 118 estaban fuera de tolerancia (±0.9 m). El suelo ahora es la malla misma (`terrenoEn` en island3d.js: los vértices de meshH, con la diagonal de cada cuadro). Después: 0 de 43 en las calles del monte, y en el monte natural 7 de 110 fuera de 8 cm, todos de menos de 0.25 m y junto al borde de la isla.

## Suelo, pisos del monte, parques y botín en el 3D (2026-10-16)
- **El suelo junto al borde de la isla** (`terrenoEn`, island3d.js): ahora usa los vértices de verdad, que junto al borde se corren al contorno, y busca el punto en los triángulos de su cuadro y de los vecinos. La revisión repetible es `window.__contrato.suelo(n)` (`revisarSuelo` en plano3d.js): un rayo contra las mallas sólidas, y lo que está a más de 2 m sobre los pies no cuenta (aleros, letreros, el globo). Ciudad 1: calles del monte 0/43, ciudad 0/37, playa 0/38, pradera 0/21 y monte 1/110 (0.43 m, bajo una construcción alta). Ningún punto se hunde.
- **Pisos del monte** (`VEGETACION.bosque.pisos`): por altura relativa, porque la isla sube decenas de metros y no miles. Abajo, cedro y yarumo; en el medio, roble andino y pino colombiano; arriba, encenillo y pino colombiano. El límite es borroso y cada manchón tiene una especie dominante (70 %). Validado: entre 93 y 99 % de los árboles del bosque están en su piso, con las bandas en orden.
- **Parques** (`VEGETACION.armonia.parque`): cada arboleda se planta entera, con 3 a 6 árboles; si no le caben 3, no se planta. Reglas: al menos 70 % de los árboles en arboleda (grupos a 2 veces el radio de la arboleda o menos) y prado abierto entre 50 y 85 %. Hoy: en arboleda 70–100 %, prado 66–71 %. Una semilla queda en el límite (70 %).
- **El botín en el 3D**, por el contrato (`OBJETO_BOTIN`): caja fuerte, vitrina de joyas (nueva), escultura sobre plinto (nueva) y cuadro colgado a 1.25 m. Su frente mira al cuarto. Tiene zona (`botin`: sólo adentro de un edificio o una casa) y colisiones (la caja, la vitrina y el plinto chocan; el cuadro no). Medido en el navegador: los 6 objetos de la ciudad 1 quedan apoyados en el piso de su cuarto (dentro de 2 cm) y bajo techo (2.56–2.9 m). Los cuadros de las casas del monte quedaban 0.55 m por debajo de la planta baja: el suelo del plano ahora es el piso que hay justo encima del terreno.

## Andenes del 3D con la medida del 2D, y sombrillas al azar (2026-10-16, lo vio Miguel)
- **Árboles en la calle.** El 2D pone los árboles de calle en un andén de 3 m (`CALLE.vereda`), en el alcorque a 2.4 m de la fachada. El 3D dibujaba:
  - en la ciudad, andenes de 1 m (`SW = CELL/6`);
  - en el monte, el asfalto de `ancho − 2` (andén de 1 m) y cruces con un cuadro fijo de 6 m;
  - andén sólo junto a lo construido, y no frente a plazas, patios y parques.

  Árboles y faroles quedaban sobre el asfalto. Ahora:
  - el andén de la ciudad mide `CALLE.vereda`, con NV = 3 subcasillas, y va junto a todo lo que no es calle, como en el 2D;
  - el asfalto del monte en las calles de la grilla mide `ancho − 2·CALLE.vereda`;
  - cada cruce del monte toma el ancho de sus calles.

  La revisión es `window.__contrato.andenes()`: en la ciudad, el piso del 3D en el punto es el del cordón; en el monte, la superficie queda 0.1 m o más sobre el asfalto del eje. Antes, con el andén de 3 m pero sin el de las plazas, quedaban 47 de 312 en el asfalto (árboles de calle 28/213, de avenida 4/14, faroles 11/57, hidrantes 2/18, semáforos 2/8). Después: 0 de 312.
- **Sombrillas en filas.** Iban en filas paralelas al muro cada 4 m: todas las vecinas compartían x o z. Ahora van por Poisson (`VEGETACION.sombrilla.reparto`): dardos al azar por casilla de arena, con 4 m entre mástiles, y más densas cerca del agua (todas hasta 30 m; de ahí la probabilidad baja hasta 0.15 a 80 m). Siguen los pasos libres cada 100 m, la franja libre del agua y una tela por concesión. Regla nueva (`armonia.alineadas`): alineadas ≤ 15 %. Hoy dan 5–6 % y las vecinas de otra tela, 0–2 %. Son unas 520 sombrillas por mundo, contra 650 en filas.

## Pasillos para el juego y cámara al estilo Fortnite (2026-10-16, lo vio Miguel)
- **Pasillos.** Medidos: en los edificios, 1.5 m (1.38 libres: cumplían la norma de 1.2, pero eran angostos para una cámara detrás y para que un policía pase a un ladrón). En las casas del monte, 1.1 m (0.98 libres: por debajo de `MINIMO.hall`).
  - Ahora `JUEGO_PASO` (medidas.js) dice lo que pide el juego: 1.8 m libres en los edificios (dos personajes de 0.52 m que se cruzan con holgura) y 1.3 m en una casa.
  - `PASILLO.ancho` pasa a 2 (grilla de 0.5).
  - `HALL` de hogar.js sale de `JUEGO_PASO.casa` + tabique, redondeado hacia arriba: 1.45.
  - Lo que esto movió y se corrigió: con 2 m de pasillo, el departamento de 4 m de fondo daba salas de 8×4 (proporción 2.03); la sala tiene ahora un tope de proporción y lo que sobra pasa al dormitorio. En un comedor de 4×4 las mesas le tapaban el frente al mesón; ahora el mesón y la nevera se ponen primero. Una planta opcional dejaba un hall en 0.88; ahora en un hall sólo entra lo opcional si deja `JUEGO_PASO.casa`.
  - Validado con `validar-pasillos.mjs` (en el probador): el ancho libre, el lado menor menos el tabique, menos lo que mete el mueble más ancho que lo pisa. Hoy: edificios, mínimo 1.88 (1859 pasillos); casas y departamentos, mínimo 1.33 (1060).
- **Cámara.** Que girar la cámara caminando cambie el rumbo es normal en tercera persona (W va hacia donde mira la cámara, como en Fortnite). Lo que incomodaba era otra cosa: el cuerpo giraba hacia donde caminaba, así que con A/D se ponía de costado y daba vueltas alrededor de la cámara. Ahora `ORIENTAR='camara'` (DemoView): el cuerpo mira hacia la cámara, de costado o en diagonal gira como mucho 45° y para atrás camina de espaldas. Medido en el navegador: W 0°, A +45°, D −45°, W+D −45° y S 0° respecto de la cámara (antes A/D ±90° y S 180°). `'movimiento'` vuelve a lo de antes.

## Colores en vez de texturas: la paleta low poly (2026-10-16, idea de Miguel)
- **El 2D pinta** (`src/engine/color.js`, `PALETA` y `FAMILIA_CUARTO` en medidas.js):
  - cada cuarto según su función: dormitorios fríos, salas cálidas, cocinas frescas, baños agua, trabajo neutro cálido, locales vivos, pasos y depósitos neutros;
  - la fachada, la moldura (la de más contraste) y el techo de cada lote y cada casa.

  Dos cuartos que se tocan van a ΔE ≥ 12, dos fachadas vecinas a ΔE ≥ 18, y todo es determinista. Se guarda en el lote o la casa (`colores`), no en el plano, porque los planos de las casas se comparten.
- **Validado** (`validar-color.mjs`, en el probador):
  - la paleta y la familia;
  - vecinos y fachadas;
  - el contraste de la moldura;
  - ningún color pasa del 25 %;
  - igual por semilla;
  - dentro de cada familia, colores a ΔE ≥ 15. La primera paleta tenía neutros casi iguales y dio 3577 pares de cuartos vecinos del mismo color.

  Hoy: 13 304 cuartos, ΔE entre vecinos p1 13.2 y mediana 32.7; 10 colores de fachada, el más usado 18 %.
- **El 3D sólo pinta:**
  - `LOWPOLY` (downtown3d.js): cada material del kit, un color plano con caras planas, sin foto, normalMap ni emissiveMap;
  - la fachada y la moldura, del lote (town3d.js); los tabiques, del color de su cuarto (`wallAt`);
  - el suelo de la ciudad y del monte y la piedra de los muros, en colores planos;
  - las casas (vivienda.js/vivienda3d.js): fachada, techo, moldura, puerta y cada cuarto, del 2D, con tablas y tejas lisas;
  - sin publicidad y sin los toldos dobles de world3d; los toldos de cada fachada, lisos.
- **Medido en el navegador:**
  - De los materiales con textura sólo quedan texto (placas de calle y de edificio, letreros de locales, portones y carteles de la isla), la bandera del colegio y el haz de los faros.
  - En 12 casas, el color de la pared de 60 cuartos, leído con un rayo desde su centro, es exactamente el del 2D (otros 2, sin pared al alcance).
- **Pendiente:**
  - las ventanas siguen siendo las piezas del kit, ahora lisas: falta rediseñarlas como piezas low poly propias;
  - algún edificio público sigue en rojo ladrillo (sin verificar cuál);
  - los muebles traen sus propios colores.

## Ventanas y acabados low poly propios (2026-10-16, Miguel)
- **Edificios** (`src/lib/fachada3d.js`): las piezas de fachada del kit se cambian al cargarlo (`LOWPOLY`, downtown3d.js) por piezas propias hechas de cajas, con la MISMA huella (2 m × 3 m, la cara de afuera en z = 0 y la de adentro en −0.2) y el MISMO vidrio. Hay 40 piezas:
  - muro con vano (dos capas: la pared y el revoque interior);
  - marco y, en las anchas, un parante;
  - alféizar y dintel (`ACABADO`);
  - vidriera con zócalo;
  - puerta con banderola;
  - cornisa con friso, saliente y tapa;
  - columna con base y capitel;
  - banda.

  `town3d` no cambió: pide las mismas piezas por nombre, y el tinte del lote (fachada y moldura del 2D) las pinta.
- **Casas** (vivienda.js): a las ventanas del catálogo se les suman alféizar y dintel del color de la moldura del 2D; las contraventanas, del de la puerta.
- **Validado** (`validar-fachada3d.mjs`, en el probador, con las medidas de los .gltf):
  - cada pieza de fachada tiene la suya;
  - el vidrio es el del original y, en las ventanas de `WINDOWS`, el de `VIDRIO.ventana` (el que el 2D usa para la luz de cada cuarto);
  - nada se sale de la huella;
  - ningún muro tapa el vano.

  Resultado: 40 piezas, 297 cajas, 17 vidrios, 0 fallas. En la primera corrida encontró 16 casos: marcos 2 cm fuera de la pieza en las vidrieras, puertas cuyo vano era más angosto que su banderola, alféizares bajo la pieza y cornisas más altas que la original.
- **Además:** sin las vallas de publicidad de azotea por manzana (con LOWPOLY), y sin el parche de shader del muro de piedra, que pedía la textura.
- **Pendiente:**
  - comprobar en el navegador que cada ventana del 2D (`lv.windows`) tiene su vidrio en el 3D (hoy se valida pieza por pieza, no fachada por fachada);
  - las piezas de mansarda y los accesores (escaleras, barandas, aire) siguen siendo los del kit, lisos.

## Copas que no se meten en los edificios y puertas dobles (2026-10-16, Miguel)
- **Copas** (`VEGETACION.poda`): ninguna copa a menos de 0.5 m de un edificio o una casa; las casas, con toda su planta, porche incluido.
  - En calles y avenidas la copa se poda en óvalo (`a.ra`, `a.eje`): angosta hacia la fachada y como mucho el doble de larga a lo largo de la calle, y se acorta si su borde alcanza el edificio de la esquina.
  - En parques, patios y jardines se planta ya con la copa que cabe (`cabe`), no menor que 1.5; si ni así entra, no se planta. Las arboledas se plantan encadenadas, cada árbol a 2 radios o menos de otro.
  - Antes: 619 de 2692 copas de calle se metían 1.6 m, y 74 de 78 de avenida 3.6 m (también patios, parques y jardines, hasta 3.7 m).
  - Validado en vegetación: el borde de cada copa (24 puntos) a ≥ la holgura de todo edificio. Hoy 0 fallas.
  - La copa de la ciudad bajó de 23 a 12 %: el 23 % contaba follaje dentro de los edificios. El 3-30-300 sigue al 100 % y el monte urbanizado, en 50 %.
  - En el 3D (contrato): el modelo escalado distinto a lo largo y a lo ancho, girado con el eje de la calle. En el navegador, 148 óvalos medidos en el modelo coinciden con el plano (7.6 × 3.78).
- **Puertas dobles** (`PUERTA.doble`): 1.8 m (dos hojas de 0.9) en comercio, local, objetivo, hotel, oficinas, biblioteca, colegio, hospital y comisaría, y en todo cuarto `local` (los de las viviendas también). Viviendas y casas, 1.1.
  - El plano (`openings`) las pone así; `validar-pasillos` revisa el ancho por tipo y que pasen dos a la vez: hoy 729 dobles y 162 sencillas.
  - En el 3D: una pieza propia (`puertaDobleLowPoly`, fachada3d.js: vano libre de 1.84, jambas, dintel y banderola) y dos hojas espejadas de 0.9; en las tiendas, de vidrio.
  - El hueco de los choques de ese módulo, del ancho de la puerta (antes fijo, ±0.6).
  - Medido caminando: se entra por el centro y a 0.55 m del centro (con el hueco viejo, como mucho a 0.34); a 1.25 m frena en la pared.
  - El motor (plano.js) juega por casillas: el equilibrio no cambia con esto.

## Entradas dobles en todo edificio, y hojas sólo donde hacen falta (2026-10-16, Miguel)
- **Entradas:** la de todo edificio es doble (`PUERTA.doble.excepto: ['casa']`); el vestíbulo de una vivienda, con vidriera, se leía como un local con puerta chica. Hoy: 852 dobles y 39 sencillas (las casas). En el navegador, en 5 vestíbulos de vivienda (1.8 m) se entra a 0.55 m del centro.
- **Hojas** (`PUERTA.hoja`, `engine/puertas.js` `conHoja`, marcado en cada puerta del plano como `d.hoja`), del barrido de puertas por par de cuartos:
  - **llevan hoja:** la de un cuarto privado (dormitorio, habitación, baño, depósito, bóveda, celda, oficina, consultorio, aula…), la de una unidad (de la circulación común —pasillo, vestíbulo— al departamento, la oficina o el local) y la de calle;
  - **son vano abierto:** las de entre espacios sociales (sala, cocina, comedor, sala-cocina, hall), la escalera, el núcleo y las de los cuartos abiertos al pasillo (recepción, sala de lectura…). En las casas el hall es interno: hall↔sala y cocina↔sala, abiertos.
  - Hoy: 8321 puertas interiores con hoja y 2828 vanos abiertos. En las casas: dormitorio 195, baño 175, oficina 62, depósito 56 y calle 105 con hoja; hall↔sala 190, cocina↔hall 105, cocina↔sala 103 y escalera 152 abiertos.
  - El 3D (town3d, vivienda.js) sólo pone hoja donde `d.hoja`.
  - Validado en `validar-pasillos`: cada puerta según la regla y ningún cuarto privado sin una puerta con hoja.

## Direcciones como en Bogotá y sin letreros de edificios (2026-10-16, Miguel)
- **Direcciones** (`src/engine/direcciones.js`):
  - cada puerta de calle (lotes de la ciudad y del monte) y cada casa recibe la suya, «Cl 11 # 24-37»: la vía donde da, «#», la cruzada anterior y los metros desde ella;
  - impares del lado de menor coordenada de la vía, pares del otro;
  - las vías de la ciudad, con su nombre; la avenida sin número, con el que le toca (Ak 28); las del monte, con el que les toca por posición siguiendo la ciudad, y con letra si se repite (6A); un callejón, la «Bis» de la anterior (Cl 10 Bis);
  - `validar-direcciones` (en el probador) revisa: todas tienen, el formato, ninguna repetida, la paridad del lado, la vía delante de la puerta, los metros (±3) y que los números crecen a lo largo de cada vía. Hoy: 1268 puertas en 4 ciudades, 62 vías, 0 fallas.
- **Placas** (contrato, `tipo:'placa'`, `PLACA`): sobre cada puerta de calle, a 2.78 m del piso de adentro en los edificios y a 2.38 en las casas, pegadas a la fachada y mirando a la calle. En dos renglones, la vía («CARRERA 24») y el número («# 7-25»), azul sobre blanco hueso con marco, todas en una textura de texto. El contrato revisa su lugar, su giro, su medida y su texto; en el navegador, 311 placas en la ciudad 1, 0 fallas.
- **Sin letreros:** con `LOWPOLY` no hay placas de nombre de edificio, letreros de tienda, letreros ni portones con texto de los edificios públicos, ni placas de nombre en las casas de la isla. Quedan la cruz del hospital, la bandera, los vehículos de los portones, las placas de las esquinas (los nombres de las calles) y los carteles de playas y cerros.

## El corte entre pisos en la escalera y el rincón de abajo (2026-10-16)

- **El corte**: la losa del paquete (`Floor_4x4`) son dos planos —el piso en Y y el cielo raso en Y−0,1— y los muros de abajo
  llegan a Y−0,12. En el hueco de la escalera se veía, de canto, entre los dos planos hasta el cuarto de al lado. Ahora
  `stairBoxes` pone un canto (`STAIR_CANTO`: de Y−0,13 a Y+0,03, 4 cm detrás de la cara de cada pared) en los cuatro bordes del
  hueco, y la pared del medio va de losa a losa (antes le faltaban 7 cm y quedaba una ranura).
- **El rincón**: en planta baja el carril B era macizo hasta el suelo y desde el vano se veía una pared de 3 m. `stairOf`
  calcula `nook`: los peldaños del carril B con `ALTURA.libre` (2,1 m) por debajo pasan a ser losa en escalones; lo de atrás,
  más bajo, sigue macizo y su cara cierra el rincón, con un cuadro (a 1,2 m) y una planta en la esquina. El choque, en esa
  cara y alrededor de la planta; la cámara (`solids`) ve el rincón hueco.
- **Validador** (`validar-nucleos.mjs`): junto a cada pared y al borde del vano, algo cubre desde los muros de abajo
  (cieloRaso − 2 cm) hasta el piso de arriba; la pared del medio sin ranuras; el rincón con `ALTURA.libre` en todo su fondo
  y cerrado por detrás. Sin el canto da 1448 fallas en 2 ciudades; con él, 0.

## Puertas que quedan abiertas (2026-10-16)

- `PUERTA.abierta` (medidas.js): las de los dormitorios siempre y la de un baño de cada tres (sorteo fijo por puerta), si la
  hoja abierta no da contra un mueble (el cuadrado del ancho del vano, hacia adentro del cuarto). `marcarHojas` deja
  `d.abierta` en edificios y casas; town3d y vivienda3d la dibujan abierta del todo y no la animan.
- `validar-pasillos.mjs` comprueba que cada abierta lo pide su cuarto y no choca, y que la que lo pide y quedó cerrada es
  porque chocaría. En 4 ciudades: dormitorios de edificios 876/1168, de casas 651/651, baños de edificios 728/978 de los
  sorteados, de casas 225/566; 710 quedan cerradas por un mueble.
- Las cortinas no ahorran nada hoy: los interiores ya se dibujan sólo a menos de 15 m y en los pisos vecinos
  (`updateInteriors`); las casas, por zonas de 48 m.

## Cortinas cerradas (2026-10-16)

- `engine/cortinas.js` `cerrarCortinas(bp)` (al final de `generateBlueprint`): por unidad —departamento, oficina, cuarto de
  hotel; cada casa del monte— un sorteo fijo con `CORTINA.cerradas` según el tipo (vivienda 30 %, hotel 35 %, oficinas
  25 %, comercio 20 %, casas 30 %) cierra las cortinas de sus cuartos de `CORTINA.cuartos`, con una tela por unidad. En los
  edificios queda `w.cortina` en la ventana; en las casas, `h.cortinas` en la casa (su plano se comparte). Las vidrieras, nunca.
- 3D: `panioCerrado` (puro, el mismo en el validador) arma el paño de lado a lado, con barral y dos pliegues. En los
  edificios va en `T.cortinas` y world3d lo dibuja siempre, con la fachada, no con los muebles (que sólo se dibujan a menos
  de 15 m): de lejos tapa el cuarto vacío. En las casas, `OBJETOS.cortina` con `cerrada`, en la malla de la casa.
- `validar-cortinas.mjs` (en `probar`): el reparto por tipo (±8 puntos), sólo en cuartos que llevan, una tela por unidad,
  y que el paño tape el vidrio más ancho y más alto del paquete (medidos en los .gltf: ±0,90 m, de 0,06 a 2,70) sin salirse
  de la pared de su cuarto y por detrás del vidrio; en las casas, que la casa armada lleve la tela sobre toda la ventana.

## Sin caras que titilen en la fachada (2026-10-16)

- El parpadeo al moverse era z-fighting: en las piezas low poly (`fachada3d.js`) el zócalo, el alféizar, el dintel, las
  jambas y los remates tenían una cara en el mismo plano que el muro —sobre todo la de adentro, en z = −0,2, contra el
  revoque—, mirando al mismo lado, y la GPU alternaba cuál dibujar. `sinTitilar` retira esa cara del acabado 3 mm
  (`SIN_TITILAR`) hacia adentro de sí mismo: queda metida en el muro. `validar-fachada3d.mjs` busca pares de cajas de
  distinto material con caras coplanares que se pisan: eran 317, ahora 0.

## Sin caras que titilen en todo lo que se arma en cajas (2026-10-16)

- `engine/titileo.js`: `titilan(cajas)` encuentra pares de cajas de distinto color con una cara en el mismo plano, mirando
  al mismo lado y pisándose (más de 2 × 2 mm), salvo que la cara no se vea (apoyada en el suelo o en un piso —`suelos`—,
  o tapada por otra caja justo afuera). Compara por planos y con barrido, así que es rápido. `sinTitilar` corre 3 mm hacia
  adentro la cara de la caja más chica (un cuarto del espesor en las finas, como las capas de un cuadro).
- Se aplica al armar: los objetos del catálogo (envuelve cada `piezas`), las casas (`planHouse`) y las cajas de cada
  edificio (`town3d`, antes de subir la planta baja). Las piezas de fachada ya lo tenían (`fachada3d`).
- `validar-titileo.mjs` (en `probar`) revisa objetos con sus variantes, escaleras de cada material y casas. Antes del
  arreglo encontraba 149 pares en objetos y unos 3.100 visibles en 40 casas; ahora 0. En el navegador, los 78 edificios de
  la ciudad 1 (143.193 cajas) pasaron de unos 4.100 pares a 0. Armar los edificios tarda 0,4 s más (3,3 → 3,6 s).
- (2026-10-16, Miguel: «veo ruido también en las puertas») La puerta de vidrio era una hoja maciza con el vidrio adentro, al
  ras de su cara: ahora es un marco (abajo macizo, travesaño y largueros) con el vidrio en el hueco. Y `sinTitilar`, cuando
  la caja chica está entera dentro de la otra (un vidrio, un botón, una placa), corre su cara hacia AFUERA: hundirla la
  enterraba. `validar-titileo` busca además piezas enterradas en otra de otro color (salvo dentro de un vidrio): estaban el
  espejo del ascensor, metido en la pared de la cabina, y la tierra de la maceta, al ras del borde. Lo tapado se mira en
  cinco puntos, no en uno (el tallo de la planta «tapaba» toda la tierra).

## Columnas de esquina y el tráfico en su carril (2026-10-16)

- **Columnas** (Miguel: «la decoración de columna de los edificios oculta las ventanas»): la de ladrillo era una L de
  1,03 m por fachada y en low poly quedó como un bloque macizo de esa caja; tapaba media ventana de la esquina. Las otras
  (piedra ±0,36, metal ±0,28) tapaban la vidriera, cuyo vidrio empieza a 0,06–0,10 m de la esquina. Ahora todas son el
  pilar de `COLUMNA` (medidas.js): 0,42 m de lado, corrido hacia afuera de la esquina, metido sólo 0,03 m en cada fachada,
  con su choque. `validar-fachada3d` revisa, por estilo, que no llegue al vidrio de ninguna ventana que el estilo puede
  poner en el módulo de la esquina (abajo la vidriera; arriba las del estilo y las de su familia): mínimo 0,03 m.
- **Tráfico** (Miguel: «corregí el movimiento de los carros, están mal»). Medido en la ciudad 1: el 45 % del tiempo el
  centro del auto estaba sobre la vereda. Tres causas:
  1. iba por el centro de su casilla, a 3 m del eje de una calle de 12 m —el borde del asfalto, desde que la vereda es la
     del 2D, 3 m—;
  2. las avenidas (3 casillas) eran «cruce» en todo su largo: se cruzaban enteras de una vez, por el camino más corto,
     cambiando de fila y en contramano;
  3. la esquina de la vereda en 3D era cuadrada (el 2D la redondea: `CIRCULACION.vehiculo.esquina`, 3 m) y al doblar a la
     derecha la trompa la pisaba.
  `engine/carriles3d.js` (puro): calle o cruce con corte en `CALLE.avenida.casillas`, sentido por la derecha (en la
  avenida, filas de afuera con su sentido y la del medio con uno por lado), y el corrimiento al carril del 2D (a carril/2
  del eje; el de afuera de la avenida, a 1,5 carriles). traffic3d: el corrimiento es continuo entre tramos, el auto
  mira hacia donde va al cambiar de carril, los giros de 90° son un cuarto de círculo de carril a carril con su largo
  real, y el paseo de las salidas va a carril/2. world3d: la punta de la manzana redondeada con el radio del 2D.
  En la ciudad 1, ahora: centro sobre la vereda 0,5 %, algún borde del auto 1,2 % (antes 45 %), choques 0. Quedan
  casos sueltos en las salidas de la isla y los buses miran de cuerda en las curvas cerradas (son largos).
  `validar-trafico.mjs` (en `probar`): carril del 3D vs el del 2D (máx 0,14 m), que el auto quepa en la calzada
  (holgura mín 0,27 m, el bus en avenidas), sin contramano, y los giros a la derecha (172) sin pisar el cordón (holgura
  mín 0,27 m). Con el auto en el centro de la casilla, como antes, fallaban 494 de 494 casillas.

## Cortinas en su ventana (2026-10-16)

- Miguel: «reubicá y organizá las cortinas para que estén bien en las ventanas». Iban una por ventana del PLANO, medidas
  con su largo: donde el 3D dibuja una sola ventana doble para dos del plano quedaban dos juegos con los paños en el
  medio del vidrio, y en las ventanas angostas (cuadrada, moldura: ±0,22 m) o anchas (metal: ±0,90) no coincidían.
- Ahora van por ventana DIBUJADA: town3d anota cada pieza que pone (`vidrios`) con su vidrio de `VIDRIO_PIEZA`
  (fachada.js, medido en los .gltf; validar-fachada3d lo compara), y `cortinaAbierta` (cortinas.js) arma el juego a su
  medida: los paños a los costados del vidrio más el marco, el barral 18 cm sobre el vidrio (hasta 2,82), con 3, 2 o 1
  pliegues según la pared del cuarto. Si el vidrio casi llena la pared (el de metal entero), de pared a pared con los
  paños sobre los bordes (≤ 0,30 m). Dos juegos de la misma pared que se pisarían se juntan en uno (`juntarCortinas`).
- Medido en la ciudad 1 (lotFurniture.cortinas): 1.382 ventanas, 1.270 con cortina (antes 1.139); ninguna tapa el vidrio
  (las de pared a pared, máx 0,24 m), ningún barral bajo el vidrio, ninguna fuera de su pared, ningún par encimado
  (antes 7 en la primera versión). Las 112 sin cortina: el vidrio pasa de la pared del cuarto.

## Choque de los muebles: a qué se sube el personaje (2026-10-16)

- Miguel: «cuáles merecen colisionadores, para que se pueda subir a las mesas, sofás, estufas, cajas». Antes, en los
  edificios los muebles se atravesaban; en las casas chocaban con alturas a ojo y no se podía parar encima.
- `CHOQUE_MUEBLE` (medidas.js), fuente única: por tipo del plano, pisable (choca y se sube; alto = la superficie: el
  asiento del sofá, la tapa del mesón), sólido (choca, no se sube) o ninguno. `ALCANCE` = v²/2g del salto
  (`CIRCULACION.peaton.salto`, el que usa DemoView) + un escalón = 1,01 m.
  - pisables: caja, cajón, mostrador, vitrina, escritorio, pupitre, mesas (comedor, centro, reunión, lectura, noche),
    cómoda, mueble de TV, mesón, estufa, horno, plancha, lavadora, sofá, sillón, camas, catre, camilla, inodoro, tina,
    lavamanos;
  - sólidos: armario, estante, nevera, archivador, buzones, caja fuerte, litera, planta (no se pisa), ducha (la mampara);
  - sin choque: silla (se corre), lámpara de pie, repisa, tablero, alfombra.
- 2D: nav-interior estorba con la misma regla (validar-interiores: 100 % de los espacios alcanzables). validar-muebles
  (en `probar`): cada tipo de los planos con su regla, lo pisable alcanzable, lo sólido alcanzable con su razón, y el
  alto nunca más que su modelo (MUEBLES_MEDIDOS).
- 3D: town3d pone cada mueble que choca como pared hasta su alto (se pasa con los pies a un escalón de arriba) y los
  pisables como superficie (`T.superficies`; world3d floorAt se para encima). vivienda.js lo mismo en las casas
  (`plan.pisables`; vivienda3d floorAt). Probado en el navegador con la física: sin saltar choca con la caja; saltando
  cae encima (0,82 m).

## Paredes que se aclaran para ver adentro (2026-10-16)

- Miguel: «si entro a un cuarto, que se ponga semitransparente la pared que acabo de atravesar, para ver todo adentro».
- 2D, `engine/visibilidad.js` `paredesAClarar(bp, jugador, camara, previo)`: los bordes de los espacios del plano (cuartos,
  pasillos, núcleo) del piso del jugador que cruza la línea de la cámara a su cabeza o al centro de su cuarto; nunca una
  medianera, otro piso ni otro edificio; desde la calle, nada. Histéresis (`VISIBILIDAD.histeresis`, 0,6 m): una pared
  aclarada se queda mientras la línea pase cerca. Cada una, una caja del mundo con el grosor de la pared y lo que cuelga
  de ella. Máximo 12 (lo que acepta el sombreador).
- `validar-visibilidad.mjs` (en `probar`), con la cámara como la del juego (4 m atrás, sin salir del lote): (1) la línea
  a la cabeza sólo cruza paredes aclaradas; (2) ni medianeras ni otro piso; (3) al cruzar cada puerta se aclara su pared;
  (4) sin parpadeo, caminando y con la cámara que tiembla ±1°; (5) desde la calle, nada. 2 ciudades: 142.968 vistas
  (mediana 1 pared, máx 8), 11.466 cruces de puerta, 80.064 temblores. Sin la histéresis: 713 parpadeos; con un máximo
  de 1: 42.302 vistas tapadas.
- 3D, `lib/aclarado3d.js`: dentro de esas cajas, cada píxel se dibuja sólo en el 45 % (un ruido fijo de pantalla, no
  transparencia: no se ordena ni titila); no en la gente ni en las sombras. DemoView calcula la lista en tercera persona y
  la cámara atraviesa las paredes aclaradas (antes se pegaba a la nuca). Los interiores, que se arman al acercarse, se
  parchean una vez por segundo. La vista desde arriba con el corte (cutaway3d) sigue retirada.
- Falta: las casas del monte (su plano está en coordenadas propias de cada casa).
- (2026-10-16, Miguel: «que también se tornen semitransparentes las puertas») Las hojas: por cada puerta con hoja de una
  pared aclarada que quede a menos de su ancho + 0,5 m de la línea de la cámara (con la misma histéresis), la caja de
  su giro a los dos lados de la línea, hasta 2,15 m. Máximo 16. El validador revisa que cada hoja cercana de una pared
  aclarada se aclare (3.947 en 2 ciudades); sin la distancia, un pasillo largo pasaba del máximo y parpadeaba.
- Medido (ciudad 1, 2026-10-16) para la optimización: ~13 millones de triángulos por cuadro tanto en la calle como
  adentro de un dormitorio —adentro no se descarta nada de la ciudad—; 64 mallas fundidas del tamaño de media ciudad
  (radio > 120 m, 1,7 M triángulos) se dibujan siempre que una punta entra en la vista; 243 mallas sin descarte por
  cámara (345 mil triángulos, 245 mil de ellos fuera de la vista).

## Sólo dibujar lo que se ve: empezando por adentro (2026-10-16)

- Medido antes (ciudad 1, pasada principal con la de contornos): ~12,4 M triángulos por cuadro adentro de un dormitorio y
  ~12,9 M en la calle. Dos tercios eran los ÁRBOLES: una InstancedMesh por pieza de cada modelo, con la esfera que la
  envuelve del tamaño de la ciudad —el motor nunca descartaba ninguno— y ~3.000 triángulos por árbol, dibujados dos veces
  (la pasada normal y la de contornos). Las fachadas, en low poly, eran sólo el 3 % (379 mil).
- 2D, `engine/visibles.js` `visiblesDesde(bp, lote, nivel)`: rayos desde puntos de cada abertura del piso (ventanas,
  vidrieras, puertas de calle; 4 puntos a lo ancho y 4 alturas) a todo el medio espacio de afuera, por la grilla (DDA) hasta
  el primer edificio que tapa (alturas mínimas: tapan de menos). Donde dos rayos vecinos dan distinto, rayos en el medio
  hasta 0,75°; cada golpe se agranda por el hueco entre rayos; y entran los lotes que tocan una casilla que se ve (una
  rendija más angosta que la separación de los puntos de partida dejaba ver un lote a 92 m). Da los lotes, sus manzanas
  y las casillas (por debajo de 18 m, con una de margen: los árboles). Se cachea por piso (~40 ms).
- `validar-visibles.mjs` (en `probar`): rayos independientes desde puntos al azar adentro, en direcciones al azar, que no
  salen del piso y salen del edificio sólo por una abertura; lo primero que tocan afuera tiene que estar en la lista, y
  cada casilla que cruzan por debajo de 18 m también. 3 ciudades: 0 faltantes en 65 mil golpes y 10 M de pasos. (El
  validador avanzaba de a 25 cm y veía a través de las esquinas que el rayo roza: ahora revisa la casilla de la esquina.)
  La lista: 64 % de los lotes (por manzana sería el 77 %: por eso se parte por lote) y 58 % de las casillas.
- 3D: las fachadas (downtown3d) en una BatchedMesh por material con una pieza por lote (una sola llamada de dibujo por
  material, como antes: las zonas de mallas sueltas de 2026-10-11 eran más lentas); los árboles y palmeras (plano3d,
  nature3d `plantBatched`) en una BatchedMesh por pieza y material, una instancia por planta. three.js descarta por cámara
  cada lote y cada planta; adentro, DemoView apaga los lotes y las casillas que no están en la lista del piso (en la
  escalera, la de los dos pisos).
- Medido después, misma posición: adentro 4,8 M (sin la lista, 6,3 M; antes 12,4 M); en la calle 8,3 M (antes 12,9 M).
  Llamadas de dibujo: ~1.400 adentro y ~1.840 en la calle, apenas más que antes.
- Falta: el resto de lo que es de toda la ciudad en una malla (veredas, calles, el mobiliario —`partsMesh`—, la isla, las
  casas del monte) y la pasada de contornos, que vuelve a dibujar todo.

## La cámara que temblaba en escaleras y puertas (2026-10-16)

- Miguel: «cuando subo escaleras o paso por debajo de puertas la cámara tiembla». `__demo.probarCamara()` (DemoView, en
  desarrollo) camina con la física del juego por las escaleras y puertas de los primeros edificios y mide cuadro por
  cuadro: sacudones (segunda diferencia de la posición > 5 cm), idas y vueltas de la distancia, cambios de camino y el
  salto más grande.
- Medido antes, una escalera en 3 s: 36 sacudones, 13–16 idas y vueltas, 14 cambios de camino, salto de 7,4 m; una
  puerta en 1,4 s: 33 sacudones, 18 cambios de camino. Causas, encontradas con `camDbg.por` (por qué se frena el brazo):
  1. de los tres caminos de la cámara se elegía el mejor en cada cuadro —y cada uno tiene otra altura—;
  2. la distancia saltaba al valor de cada cuadro, sin suavizar;
  3. bajo techo, la altura máxima salía de los pies del jugador: subiendo, metía la cámara en la losa del pasillo de atrás;
  4. el dintel del núcleo de la escalera estaba aclarado, pero su choque es más grueso que la caja que se trama;
  5. a mitad del tramo, el tramo de arriba frenaba los tres caminos.
- Ahora: el camino se cambia si el otro llega 0,5 m más lejos durante 0,25 s (o en el acto si el actual se tapa de golpe y
  otro sigue libre); la distancia se acorta a 8 m/s (de una sólo si lo que tapa aparece a más de 1 m) y se alarga a 3 m/s;
  la altura de la cabeza y la de la cámara, suavizadas; el techo, el del piso que hay bajo la cámara y el de verdad
  (`world.techoEn`: la losa siguiente o el tramo de arriba, menos 40 cm); por una pared aclarada pasa con 20 cm de margen.
- Medido después, 8 escaleras y 12 puertas: un solo sacudón por caso (el arranque, 9 cm), ninguna ida y vuelta, ningún
  cambio de camino, salto máximo 0,09 m. Falta: las escaleras de las casas del monte (otro sistema, vivienda3d).

## Los usos de los objetos: la base para las acciones (2026-10-16)

- Miguel: «después quiero acciones: abrir una cortina, sentarse en una silla o acostarse en una cama al acercarse».
- `engine/usos.js` `usosDePiso(muebles, ventanas)`: por objeto, sus usos {accion, pose {x,z,yaw}, des: los puntos desde
  donde se hace}: sentarse (silla, sillón, sofá —una plaza cada 0,6 m—, inodoro; a la silla se llega también por detrás y
  por los costados: la del escritorio se corre), acostarse (las camas, por cualquier costado) y la cortina (una grilla
  delante de la ventana, desde donde el brazo —1,3 m— alcanza su borde; más allá de 0,6 m, sólo por encima de algo de
  hasta 0,75 m: la cama contra la ventana sí, el armario no).
- `validar-usos.mjs` (todavía NO en `probar`: tiene fallas abiertas): cada uso, desde un punto del mismo cuarto al que se
  llega caminando desde la calle (la grilla de nav-interior), con las rodillas libres al sentarse. 2 ciudades:
  sillas 5.595/5.619, inodoros, camas, sofás 100 %, sillones 405/411, cortinas 4.918/5.098 (96 %). Lo que falla es del
  plano: cuartos de hospital con la cama de hospital delante de la ventana, dormitorios chicos con la cama contra la
  ventana a todo el ancho, y 24 sillas y 6 sillones encerrados.
- (2026-10-16, Miguel: «corregí el reparto de muebles para que cada cortina, silla y sillón se pueda usar») En el
  generador (blueprint.js):
  - `makeMovement` cuenta las ventanas que se alcanzan (la misma regla que usos.js: brazo de 1,3 m, por encima sólo de lo
    que no pase de 0,75 m) y `fits` no acepta un mueble que deje una cortina sin alcanzar; la calidad de una distribución
    (`quality`, `full`) también lo mira, y la elegida que no lo cumple en ESTE cuarto se rehace;
  - `sinInusables`: al terminar un cuarto (edificios y casas), las sillas que no se alcanzan con el radio del juego —por
    cualquier lado: se corren— y los muebles opcionales («x?») que quedaron sin uso o dejan otro sin uso, se sacan. Lo
    imprescindible queda;
  - la segunda cama del cuarto de hospital pasa a opcional (estaba a 0,5 m de la primera: ninguna se usaba por ese lado);
  - una alcoba más chica que la doble de la norma, sin programa, lleva cama sencilla (la regla nueva dejaba alguna de
    8 m² sin programa y caía la cama de dos plazas).
  `validar-usos` entra en `probar`: 4 ciudades, 0 fallas. Costo: ~10 % menos sillas (las que quedaban encerradas) y 71
  camas de hospital en vez de 132 en 2 ciudades (los cuartos de 4 × 3,5 no dan para dos con acceso de costado).

## Las acciones del jugador: sentarse, acostarse, la cortina (2026-10-16)

- `lib/acciones3d.js` `createAcciones`: qué se puede hacer y desde dónde lo dice el 2D (usos.js, validado por validar-usos);
  el 3D sólo anima. Cada 0,15 s, el uso más cercano del piso del jugador (a 1 m de alguno de sus puntos; la cortina con
  0,5 m de desventaja: si no, junto al sofá se cerraba la cortina) y su tecla en pantalla («E Sentarse»). Con E:
  - sentarse: camina al punto, se da vuelta y baja al asiento con SitDown/StandUp (sitting3d makeSitter, las de la gente);
  - acostarse: del costado a la cama, girando hasta quedar boca arriba, a su alto (CHOQUE_MUEBLE), la cabeza a la cabecera;
  - la cortina: la abre o la cierra. town3d arma el paño en TODAS las ventanas de los cuartos con cortina, con su clave
    lote:piso:ventana; world3d `cortina(key)` muestra u oculta sus cajas (escala cero).
  Mientras dura, el jugador no camina; E o caminar lo levantan. Probado en el navegador con la física: sofá (llega,
  se sienta a 0,24 m, se para en 78 cuadros en el punto de llegada), cama (acostado a 0,57 m, se levanta en 1,1 s),
  cortina (abierta → cerrada). Lo que faltaba —las casas del monte, la animación de la cortina y que la gente no
  ocupe el mismo asiento que el jugador— va abajo.
- Lo que faltaba (2026-10-16):
  - las casas del monte: `usosDeCasa` corre la misma regla (usosDePiso) sobre el plano del hogar (u, v) y lo pasa al
    mundo con la posición y el giro de la casa (vivienda.js devuelve ox, oz, H1, FLOOR0 para eso); el piso lo da
    `houseAt` y el alto del jugador. Probado en la casa 0: cama (acostado a 0,57 m del piso) y sofá (0,24 m), y se
    levanta en los dos. Las casas no tienen cortina accionable todavía;
  - la gente no se sienta donde está el jugador: al empezar, el asiento o la cama de la gente que cae en la pose
    (world.lots seats/sleeps) se reserva con by='jugador' y se suelta al pararse; `cerca` no ofrece uno ocupado;
  - la cortina se corre en 0,5 s (CORTINA_T): cada caja del paño se escala y se acerca al centro (k de 0 a 1, medido
    0 → .3 → .57 → .83 → 1). Queda: al cerrar una cortina que arrancó abierta, sus pliegues de abierta siguen dibujados.

## Dónde estoy y bajar del dron cayendo (2026-10-16)

- `engine/direcciones.js` `ubicacionDe(vias, x, z)`: con las mismas vías de las placas, en un cruce «Calle 7 con Carrera
  21»; sobre una vía «Calle 7 · entre Kr 21 y Kr 24 · # 21-15»; fuera de las vías, la dirección sobre la más cercana
  (UBICACION.cerca, 60 m). Las cruzadas que se ven se deciden por el eje de la vía (no por el punto), y las placas
  pasaron a decidirlas igual: así la placa sobre la puerta y el letrero en pantalla dicen lo mismo.
- `engine/aterrizaje.js`: al soltar el dron se cae sobre la columna del dron si ahí se camina (grilla peatonal), se
  llega a pie a la calle y se está a ATERRIZAJE.fachada (1,2 m) de toda fachada —el balcón, que decide el 3D, sale 1 m—;
  si no, sobre el punto así más cercano. La caída, con tope de 32 m/s. El dron despega subiendo de a poco 28 m.
- `validar-ubicacion` (en probar): casillas de la ciudad con ubicación y con la calle o carrera de su casilla; frente a
  cada puerta, la ubicación de su placa; el número crece a lo largo de cada vía; las vías del monte se nombran; el
  aterrizaje siempre existe, sirve, no se corre si la columna sirve y es el más cercano (fuerza bruta). 4 ciudades: 0
  fallas; sobre la isla cae en el sitio el 91,6 %, si no se corre mediana 3,3 m.
- 3D: el letrero arriba a la izquierda (caminando, el punto del jugador; en el dron, el de abajo y la altura). Probado:
  300 columnas al azar caen a nivel de calle; desde 70 m sobre un edificio, a la vereda en 3,4 s.

## La pintura de la calle: una sola fuente, pegada al asfalto (2026-10-16)

- Las cebras repetidas eran dos fuentes: las del plano (equipamiento.js) y otras que island3d calculaba en cada cruce
  del monte; y las rayas del monte iban 10 cm sobre el asfalto y sin inclinarse en la pendiente.
- `engine/pintura.js` `pinturaDe(bp)` (bp.pintura): cada franja en planta —las de las cebras del equipamiento y la línea
  del medio de las calles del monte: discontinua blanca en las de 12 m, doble amarilla en las avenidas (PINTURA.amarilla
  .desde), desde el borde de cada cruce y de su cebra—. La escalinata, sin pintura. Las de la ciudad (planas) siguen en
  world3d.
- `lib/pintura3d.js`: el 3D la pega al asfalto: cada franja en trozos de ≤ 2 m, cada punta a la altura del suelo dibujado
  más PINTURA.alto (1,5 cm), sin sombra y con desplazamiento de polígono. island3d ya no dibuja cebras ni líneas.
- `validar-pintura` (en probar): ninguna cebra pisa a otra ni una franja a otra; todas sobre la calzada; las líneas fuera
  de cruces y cebras; cada cebra de lado a lado. 4 ciudades: 0 fallas. En el 3D: todos los vértices a 1,5 cm del suelo
  (desvío máximo 2,4 cm).

## Las terrazas del monte: el pie de monte suave (2026-10-16)

- Medido antes: la ladera de diseño (un plano al 9,4 %) reemplazaba una montaña de 30–50 % de pendiente: terrazas hasta
  75 m por debajo del natural (mediana 11,5 m), muros de 4,5 m entre las dos mitades de cada manzana, ~1,5 millones de m³
  movidos por ciudad. Siguiendo la montaña tal cual no cabía ninguna manzana con muros de 1,5 m (mediana 5–8 m).
- Decisión de Miguel: el pie de monte suave. `isla.js`: el pie de monte ES el terreno —sin la máscara que lo recortaba
  junto a las calles, con una ondulación de ±0,6 m— y pasando LADERA.fin la montaña natural vuelve en 60 m, sin talud
  cortado.
- `TERRAZA` (medidas.js): mover 3 m, escalon 1,5, acceso 1,2, pendiente 12 %. De ahí LADERA: la manzana sube un acceso,
  un muro y otro acceso (3,9 m en 48: 8,1 %). Cada mitad queda a TERRAZA.acceso de su calle y entre las dos un muro de
  ≤ 1,5 m; el mirador no se pone donde movería más de 3 m. Las celdas guardan frente y nivelCalle.
- `validar-terrazas` (en probar): terraza contra el terreno p50 0,4, máx 2,6 m; muros ≤ 1,5; acceso ≤ 1,2; calles ≤ 8,1 %;
  21 mil m³ movidos por ciudad. 83 manzanas del monte (antes 84). 0 fallas; el probador entero, 27 pruebas en 0.
- Segunda vuelta (2026-10-16, Miguel: «¿por qué en las manzanas salen como huecos?» y «la lógica de antes, con escalones
  más empinados para no desbastar tanto»): la mitad de arriba quedaba 1,2 m bajo su calle (el acceso hacia la otra) y se
  veía como un pozo con una barranca de pasto. Vuelve la lógica de antes: cada mitad a la altura de la calle a la que da
  y UN muro entre las dos, ahora de TERRAZA.escalon = 6 m (dos pisos); la ladera, al 12,5 %, y las calles hasta 13 %.
  Medido contra la montaña sin pie de monte (4 ciudades, `scratchpad` desb): muro 4,5 → diferencia mediana 11,6 m y 2,3
  millones de m³ por ciudad; 6 → 9,4 m y 2,0 millones, con las mismas 20 manzanas por ciudad; 7,5 → casi sin manzanas.
  validar-terrazas: 84 manzanas, terraza contra el terreno máx 3,0 m, muros 6 m, calles ≤ 12,5 %, 0 fallas.
- Tercera vuelta (2026-10-16, Miguel: «siguen habiendo huecos en los escalones de las manzanas del monte»): eran las
  rampas del 3D (island3d): una casilla de lote más alta que la calle de al lado no llevaba bloque y la dibujaba la calle
  como rampa; donde esa calle era plana (un cruce) nadie la dibujaba y se veía el terreno bajado o hasta abajo de la isla.
  Con cada mitad a la altura de su calle no hacen falta: sin rampas, el bloque baja con su muro hasta el andén, y donde
  la calle queda más alta que el lote el muro va del andén hasta el lote; el relleno de pasto, sólo hasta TERRAZA.acceso.
  (`SIN_HUECOS` en island3d: en false, el dibujo de antes.) Medido con `__demo.huecosTerrazas()` —rayos en 3×3 puntos de
  cada casilla de lote—: antes 70 huecos en 26 casillas de la ciudad 1, ahora 0 en 9045 muestras. TERRAZA.mover pasa a
  4 m (con 3, nueve manzanas perdían una mitad). El probador entero, 27 pruebas en 0.
- Cuarta vuelta (2026-10-16, Miguel: «la colisión de los pisos de los escalones se cae»): fuera de la ciudad la física
  pisaba la malla del terreno (island3d sueloEn → terrenoEn), y bajo las terrazas esa malla queda bajada hasta la terraza
  vecina más baja: con muros de 6 m el jugador caía y quedaba debajo del pasto. Ahora sobre una casilla de terraza se pisa
  su meseta (enTerraza). Y lo que queda más alto que ALCANCE (1,01 m: salto + escalón, la regla de los muebles del 2D) no
  se sube caminando (DemoView, alto(x,z)): el muro frena; antes se trepaba cualquier altura de a poco. Medido en la ciudad
  1: puntos de lote donde la física quedaba > 0,5 m bajo la terraza, 1671 de 9126 → 0 (los 300 por encima son pisos de
  casas). Caminando contra el muro de 3 m de la manzana 12,7 se frena en el muro; desde arriba se cae a la de abajo.

## El probador por niveles (2026-10-16)

- Miguel: «niveles de pruebas empezando por lo más grande hasta lo más chico». `scripts/probar.mjs` corre un nivel por
  vez (sus pruebas en paralelo) y, si uno falla, no corre los de abajo: un error grande se arrastra a todo lo chico, y así
  los números apuntan a la causa. `--seguir` corre todo igual; `--nivel=3` o `--nivel=2-5`, sólo esos; `--solo=` sigue.
- Los niveles: 0 Medidas · 1 Mundo (mundo, zonas) · 2 Vías y manzanas (circulación, terrazas, tráfico, direcciones,
  ubicación) · 3 Lotes y edificios (ciudad, núcleos, escaleras de casa, fachada 3D) · 4 Interiores (pasillos, interiores,
  muebles, usos, cortinas) · 5 Exterior (vegetación, equipamiento, pintura, color, botín) · 6 Geometría sin pantalla
  (titileo, contrato 3D) · 7 Física (colisiones) · 8 Visibilidad (visibilidad, visibles) · 9 Juego.
- Nivel 0, nuevo: `validar-medidas` cruza 41 reglas que salen de otras (ALCANCE del salto, muebles pisables alcanzables,
  la ladera de TERRAZA, el generador con las de TERRAZA, el paso de la grilla, el aterrizaje y los balcones, la pintura y
  el cordón). `PROBAR_FALLA_ADREDE=1` la hace fallar a propósito: así se comprobó que el probador corta en el nivel 0.
- La tabla final: por nivel, cada prueba con sus fallas, su línea de resumen y, si falla, el peor caso (el tipo de falla
  con más casos y su primer ejemplo, con coordenadas). Todo en 0: 10 niveles, 28 pruebas. Tarda 515 s (antes 203, todo en
  paralelo): el nivel 5 espera al botín (160 s).
- Lo que sigue (el plan): armar el 3D sin pantalla en node (three.js con un lienzo de mentira) para los niveles 6 y 7 —
  huecos con rayos sobre toda la isla, empalmes al milímetro entre piezas vecinas, el suelo de la física contra la
  superficie dibujada, triángulos que nunca se ven— y una prueba de oclusión en el 8.

## El 3D sin pantalla: huecos y suelo al milímetro (2026-10-16)

- `scripts/sin-pantalla.mjs`: lo mínimo para armar el 3D en node (un `document` con lienzos de mentira para las
  texturas); `armarIsla(semilla)` arma la isla de island3d como el demo, en ~7 s. `scripts/medir3d.mjs`
  `indiceTriangulos(grupo)`: todos los triángulos (también los de cada instancia) en una grilla de 4 m, para preguntar qué
  se ve desde arriba en un punto (la cara más alta y de qué malla) sin rayos contra la isla entera.
- island3d nombra sus mallas de suelo («suelo:terreno», «suelo:asfalto», «suelo:andenes», «suelo:lotes»,
  «suelo:mesetas», «suelo:rellenos», «suelo:peldaños», «suelo:caras») y sus muros («muro:lotes», «muro:bloques»).
- `validar-huecos` (nivel 6): lo que se ve contra lo que dice el 2D —terrazas, asfalto y andenes del monte; y que no se
  vea a través de la isla—. Comprobado contra el dibujo de antes (FUGA_CON_HUECOS=1): marca 1269 puntos hundidos en las
  terrazas, hasta 152 m. Ahora: 0 mm en terrazas, asfalto y andenes (2 ciudades).
- `validar-suelo` (nivel 7): el suelo de la física contra el suelo que se ve desde arriba. Encontró y quedó corregido:
  - el terreno asomaba hasta 63 cm sobre los andenes de las calles que suben y 37 cm dentro de los cruces (la malla, de
    2,6 m, cruzaba el borde): junto a la calle el terreno queda a la altura del andén un paso de malla y después sube
    como mucho a 45°; dentro del cuadro de un cruce, bajo el asfalto;
  - ahora 0 mm en terrazas, calles y tierra (fuera, una franja de 3 m en el borde de la isla, donde la malla se corre
    al contorno).
- Lo que la medición sin pantalla destapó del 2D: el 3D deja cada cruce plano y el 2D medía las pendientes de cruce a
  cruce. Ahora el plano lleva el tramo plano de cada cruce (medio ancho de su calle más ancha) y la pendiente se mide en
  lo que sube: 16,7 % entre calles y 20 % junto a una avenida, con muros de 6 m. TERRAZA.pendiente pasa a 20 (con 17 se
  caían la mitad de las manzanas; con muros de 4,5 alcanzaría 17). validar-mundo clasifica las subidas con eso.
- El probador: 10 niveles, 30 pruebas, todo en 0.

## Los triángulos que nunca se ven (2026-10-16)

- `validar-triangulos` (nivel 6): arma la isla sin pantalla y revisa cada triángulo de cada malla (también los de cada
  instancia): sin área, repetido (los mismos tres vértices, al milímetro) o enterrado (sus vértices y su centro más de
  5 cm bajo el suelo de otra malla; una cara parada se mira 10 cm hacia cada lado, porque lo que la tapa es el suelo de
  delante y no el de su borde). Falla con triángulos sin área, repetidos, o una malla de más de 200 con más de 5 %
  enterrados.
- Medido en la ciudad 1: 85 573 triángulos, 6638 enterrados (7,8 %) —5350 del terreno, debajo de terrazas y calles—,
  33 sin área (30 de las caras de piedra de los rellenos que terminan a ras). island3d ya no dibuja un triángulo del
  terreno que queda entero bajo una meseta, una calle o un cruce, ni los sin área: 80 510 triángulos, 1541 enterrados
  (1,9 %; ninguna malla pasa del 3 %), 0 repetidos, 0 sin área. Huecos y suelo siguen en 0 mm.
- Lo que queda enterrado son instancias (postes, bloques de piedra bajo el suelo: una instancia no se recorta por cara)
  y unas pocas caras de andenes y asfalto. El probador: 10 niveles, 31 pruebas, todo en 0.

## El mundo entero sin pantalla: la ciudad, sus pisos y sus triángulos (2026-10-16)

- `sin-pantalla.mjs armarMundo(semilla)`: arma todo como el demo —la ciudad con los modelos del centro, la isla, los
  barrios, las casas del monte, las viviendas por dentro y lo que pone el plano— leyendo los modelos de public/
  (node-model-env); las imágenes de las texturas «cargan» enseguida (si no, el centro se colgaba). ~12 s, 7,4 millones
  de triángulos. `medir3d` lee también las BatchedMesh y, con `arriba`, guarda sólo los pisos (entra en memoria).
- `validar-pisos` (nivel 7): en la ciudad, donde la física pone los pies tiene que haber un piso dibujado (≤ 2 cm) y
  ningún otro asomar hasta 30 cm encima (salvo un estorbo que frena). Encontró y quedó corregido: la planta baja se
  dibuja 2 cm arriba (para no titilar con el suelo) y la física la ponía en 0 —los pies 2 cm adentro en toda planta
  baja—; ahora floorAt la pone ahí. 2 ciudades: 27 302 puntos, 0 fallas.
- Destapó además que la ciudad 2 no se armaba: una casilla del muro con dos salidas (la de a pie, sin dirección, y la de
  la calle) y world3d tomaba la primera. Ahora toma la que tiene dirección. (Ninguna prueba armaba la ciudad del 3D.)
- `validar-triangulos --mundo` (el probador lo corre así): separa lo escondido a propósito (7504 instancias con escala
  cero: las cortinas abiertas), los defectos de los modelos (3623 caras sin área y 21 975 repetidas dentro de árboles y
  hojas, que se copian en cada instancia; se miden), las caras pegadas entre dos piezas que se tocan (896: el canto de
  las dos hojas de una puerta doble) y las de dos piezas en el mismo lugar mirando al mismo lado, que titilan: 162
  postes de cerca dobles en casas3d —donde se juntaban los tramos de dos casas— y ahora uno por lugar. El agua de la
  orilla ya no se dibuja donde queda entera bajo la arena (6,6 %). El tope de enterrados (5 %) vale para la geometría
  propia; los modelos, medidos.
- El probador: `--rapido` es ahora 1 ciudad y sin las pruebas lentas (botín, color, contrato 3D, visibles): 122 s,
  28 pruebas. Entero: 10 niveles, 32 pruebas, todo en 0, 512 s.

## Nivel 10: el 3D de verdad, en un navegador sin ventana (2026-10-16)

- `scripts/navegador.mjs`: el Chromium que ya bajó Playwright (el «headless shell»; en Chrome for Testing sin ventana no
  corría requestAnimationFrame) manejado por el protocolo de DevTools con el WebSocket de node, sin dependencias; en mac
  con Metal (`--use-angle=metal`): la placa de verdad (M4 Pro), no SwiftShader (1,7 cuadros/s).
- `validar-3d` (nivel 10, fuera de --rapido): abre el demo (el servidor de desarrollo si anda; si no, levanta uno en
  5199), y en cinco lugares fijos que salen del plano —la salida, el dron sobre el centro, una esquina del monte, adentro
  de un edificio, la playa— mide lo que dibuja un cuadro en promedio (triángulos y llamadas, renderer.info) contra su
  presupuesto (referencias/3d.json, +20 %), los cuadros por segundo (sólo se informan), la captura (no vacía, y cuánto
  cambió contra referencias/<lugar>.png: falla sobre 25 %) y los errores de consola. `--fijar` guarda las referencias.
- Aprendido midiendo: las sombras se rehacen un cuadro de cada dos y cómo se reparte el costo entre esos dos cuadros
  cambia de una carga a otra (4,0 + 4,4 o 2,2 + 6,2 millones; la suma, igual): se mide el promedio. Y cada lugar espera
  200 cuadros: la cámara de atrás trae la distancia del lugar anterior.
- Medido (semilla 1): salida 4,2 M triángulos y 424 llamadas (109 c/s) · dron 5,3 M, 952 (81) · monte 6,6 M, 1051 (69) ·
  adentro 4,2 M, 707 (120) · playa 6,7 M, 926 (70). Dos corridas: ±0,1 %. Adentro de un vestíbulo se siguen dibujando
  4,2 millones: ahí hay para recortar.
- El probador: 11 niveles, 33 pruebas, todo en 0 (543 s).

## Recortar lo que se dibuja (2026-10-16, medido con el nivel 10)

- Desglose de un cuadro por objeto (renderBufferDirect, en el navegador sin ventana): adentro de un vestíbulo de la
  ciudad, lo más caro eran las casas del monte (1,1 M de triángulos de vista y 0,36 M de sombra, fundidas en una malla por
  material para toda la isla: la cámara no podía descartar ninguna), las cortinas de toda la ciudad (240 mil, una sola
  InstancedMesh), el equipamiento del plano (350 mil, una malla por pieza y color) y los árboles de los jardines del monte
  (todos, cerca o lejos).
- Hecho: vivienda3d y plano3d, por baldosas de 144 m; niebla3d.js esconde la malla que queda entera detrás de la niebla
  (a pie, 240 m; el terreno no, su silueta lejana se ve); lod3d no pone los árboles más allá de la niebla; las cortinas
  se apagan con su lote (world3d setVisiblesCortinas: las que se ven, juntas al principio, y count). Para medir sin el
  despegue del dron en el medio, __demo.fijarDron(x, y, z).
- Medido (semilla 1, triángulos por cuadro en promedio): salida 4,18 → 3,17 M · dron 5,26 → 4,52 · monte 6,65 → 5,36 ·
  adentro 4,20 → 1,86 · playa 6,66 → 5,25. Las llamadas, algo más afuera por las baldosas (424 → 489 en la salida). Las
  capturas, iguales (cambian lo que cambia el ruido: 0,1–2 %). Referencias fijadas de nuevo.

## Empalmes al milímetro y objetos que no se tapan (2026-10-16)

- `validar-empalmes` (nivel 6): a lo largo de cada borde donde se tocan dos piezas —en la ciudad, las casillas de distinto
  tipo y el cordón de la vereda (cuadros de 1 m); en el monte, cada casilla de lote contra lo de al lado—, cada medio
  metro: a 1 cm de cada lado, el piso que se ve tiene que estar donde se pisa (rendija de arriba), y un escalón tiene que
  estar cubierto por caras paradas a ≤ medio tabique + 1 cm (rendija parada). No cuentan el terreno natural (sube en
  rampa) ni un punto adentro de una pared. Encontró y quedó corregido: el cordón de la vereda no se dibujaba hacia el
  muro de la ciudad (la vereda flotaba 15 cm: 1668 puntos; world3d) y el muro entre un lote y el andén que sube tenía el
  borde de arriba plano (franja sin cubrir de hasta 25 cm: island3d, ahora UNA cara que en cada punta va de lo más bajo
  a lo más alto). 2 ciudades: 59 304 puntos, 36 705 escalones, 0 fallas (lo más sin cubrir, 5 mm).
- `validar-oclusion` (nivel 6): los objetos del plano como los dibuja el 3D (plano3d registro). Ninguno metido en un
  edificio o una casa; ninguno pisando a otro (de árboles, palmeras y sombrillas, el tronco o el palo hasta 2,2 m); los de
  base plana apoyando cada esquina a ≤ 5 cm del suelo o sobre su losa. Encontró: un farol adentro de una parada, dos
  bancas una encima de otra (el 2D miraba la distancia entre centros) y 72 esquinas flotando o hundidas hasta 92 cm.
  Corregido en el 2D (equipamiento.js): un objeto no se pone donde su planta pisa la de otro, ni —si es de base plana—
  donde el suelo no está parejo (EQUIPAMIENTO.apoyo 5 cm, circulacion.js altoSuelo) o queda medio en el andén; la parada
  no se descarta (hace falta donde va) y saca el farol, la banca o la papelera que pisa. En el 3D: plataforma del
  terreno bajo cada objeto de base plana (island3d pads, un paso de malla de margen y juntas las que se tocan, encima del
  empalme con la calle; el talud junto a la calle, sólo dos pasos de malla) y, si el suelo igual queda desparejo, una
  losa de concreto (plano3d). 2 ciudades: 5273 objetos, 43 sobre su losa, esquinas a ±3 mm, 0 fallas.
- El probador: 11 niveles, 35 pruebas, todo en 0 (560 s).

## Azotea, aberturas de las casas, esquinas curvas y patios con acceso (2026-10-16)

- Azotea (Miguel: «subí a la terraza y salió esto»: sólo puertas y núcleos flotando): en la azotea los pies quedan 0,1
  mm bajo el techo y world.dentro() decía que se estaba adentro; se calculaba lo visible desde un piso que no existe y se
  apagaba todo. Ahora la azotea es afuera (DemoView) y visiblesDesde de un nivel que el edificio no tiene da null (no se
  recorta). El nivel 10 tiene un lugar «azotea» que falla si el juego cree que se está adentro.
- Ventana y puerta solapadas (casas del monte): la ventana de un cuarto se centraba en su pared con el ancho del cuarto
  (hasta 2,1 m la sala) sin mirar la puerta: 252 pares que se pisaban en 180 casas. Ahora toma el ancho que cabe entre
  las puertas (15 cm de marco) y las otras ventanas de su pared (vivienda.js cabe): 0 pares, las mismas 1444 ventanas.
  validar-oclusion lo revisa.
- Esquinas curvas: la punta de la vereda de la ciudad iba en cuadros de 1 m (escalonada); ahora es un cuarto de círculo
  de radio CIRCULACION.vehiculo.esquina con su cordón por el arco, y la física mira la distancia al centro (world3d
  puntas). En los cruces del monte, cada esquina del andén también es un cuarto de círculo (island3d). Pisos, empalmes,
  suelo y huecos siguen en 0.
- Patios con acceso: 24 de 26 patios de manzana quedaban encerrados por su anillo de lotes. El generador deja un zaguán
  (una casilla de callejón de lado a lado del anillo, en el medio de un lado que da a la calle) en cada anillo. Las casas
  del monte, una puerta al patio de atrás (hogar.js: la cocina, el comedor o la sala de la franja de atrás; el dormitorio
  al final), que vivienda.js dibuja como la de calle. validar-patios (nivel 3): 50 patios, todos a pie; 345/345 casas.
- Pendiente: la baranda del pasillo de la escalera de las casas — no quedó claro qué se ve mal (la escalera y el piso de
  arriba están donde dice el plano).

## Objetos del mundo: el colegio (2026-10-17)

- Miguel: «en las escuelas creo que falta buenas mesas». El pupitre y el pizarrón eran cajas de un color (town3d BOX).
  Ahora son objetos del catálogo (objetos3d, grupo Colegio): pupitre de tubo azul con cubierta laminada, parrilla para
  los cuadernos y ranura del lápiz; silla escolar de triplex (la silla del aula, town3d la cambia por esta); pizarrón
  verde o blanco con marco de aluminio, lo escrito y la bandeja con tizas y borrador; casilleros de lámina (azul, gris o
  rojo) en dos pisos, con rejillas, manija y número. La variante sale del lugar del mueble (town3d variante).
- Casillero, mueble nuevo del plano: ITEMS y SIZES (1,8 / 1,2 / 0,9 m × 0,45), opcional en el aula y la sala de
  profesores, sólido de 1,8 m (CHOQUE_MUEBLE), se usa de frente (USE_AT), alto (no va bajo una ventana).
- El aula como un salón de verdad: la grilla de pupitres miraba siempre a la misma pared y el pizarrón iba en
  cualquiera — 56 de 243 alumnos de espaldas al pizarrón —; y con 50 cm entre columnas la prueba de movimiento sacaba 2
  de cada 3 sillas (128 sillas para 356 pupitres). Ahora la grilla se arma desde la pared del pizarrón, con pasillos de
  0,8 m y filas cada 1,65 m, centrada; un pupitre cuya silla no se alcanza se va con ella.
- validar-aulas (nivel 4): cada aula con pizarrón, ningún pupitre de espaldas, cada pupitre con su silla delante. 4
  ciudades: 33 aulas, 249 pupitres, 249 con silla, 0 fallas. El titileo atrapó el fieltro del borrador enterrado en la
  madera (corregido).
- scripts/ver-cuarto.mjs <tipo> [semilla] [salida]: una captura sin pantalla dentro del primer cuarto de ese tipo.

## Objetos del mundo: el gimnasio (2026-10-17)

- Giro nuevo de los locales de la planta baja: gimnasio (8 % de los edificios con locales; nombres y letrero propios).
  Receta: espejo de pared, mostrador, banco de pesas, mancuernas, caminadora y bicicleta; y si caben, otra caminadora,
  colchonetas y otra bicicleta (lo grande primero: con las caminadoras antes, el banco no entraba en un local con dos
  puertas a la calle).
- Objetos del catálogo (grupo Gimnasio): caminadora (banda, consola con pantalla, barandas), bicicleta estática
  (volante, sillín, manubrio con consola, pedales), banco de pesas con su rack, barra y discos, repisa de mancuernas en
  dos pisos, colchonetas y espejo de pared. Las máquinas miran a la pared: uno se sube por el lado del cuarto.
- Reglas: medidas (ITEMS, SIZES), sólidos con su alto (CHOQUE_MUEBLE: la caminadora 1,35, el banco 1,45 —el rack—),
  las colchonetas y el espejo no chocan; el banco se usa para sentarse (una plaza: es ancho por el rack). El banco, la
  bicicleta y las colchonetas pueden ir sueltos en el medio si contra la pared no entran (blueprint SUELTO).
- validar-gimnasios (nivel 4; ahora validar-giros): cada local con espejo y mostrador, cada gimnasio con las cuatro máquinas, ninguna mirando
  a una pared (≥ 50 cm delante para subirse). 4 ciudades: 21 gimnasios, 0 fallas.
- Encontrado de paso, en el monte: dos casas espalda con espalda (una de cada mitad de la manzana) quedaban a 2,5 m: la
  regla «fondo − 3» dejaba 0,5 m hasta el medio de la manzana. Ahora el fondo máximo es la mitad menos el retiro de 2,5
  y media separación (1,5). Apareció al cambiar el gimnasio el azar compartido del catálogo de muebles.
- validar-cortinas: el reparto con 1 ciudad (98 casas) dio 41 % contra 30 por azar (con 4, 32 %); la tolerancia ahora
  crece con la muestra chica (3 desvíos de la binomial, mínimo 8 puntos). medir-muebles: el alto de un objeto del
  catálogo es lo más alto de sus piezas (antes, su cara de arriba: la caminadora medía 22 cm).

## Objetos del mundo: la tienda de ropa (2026-10-17)

- Giro nuevo de los locales: ropa (8 % de los edificios con locales; nombres y letrero propios). Receta: mostrador,
  probador y estantería contra las paredes; dos percheros y un maniquí (sueltos en el medio si no entran contra la
  pared); y si caben, otra estantería, otro perchero y otro maniquí.
- Objetos del catálogo (grupo Tienda de ropa): perchero de ruedas con camisas, abrigos o vestidos colgados (cada prenda
  en su percha, el color por su lugar en la fila, de la paleta ROPA); maniquí vestido (cuatro colores); estantería con
  tres pilas de ropa doblada por repisa; probador con cortina corrida, espejo, banquita y ganchos.
- Reglas: medidas (ITEMS, SIZES), sólidos con su alto, se usan de frente (el perchero, la estantería, el probador).
- validar-giros (nivel 4, antes validar-gimnasios): por giro, lo de cada local, lo del negocio y lo que no puede mirar
  a una pared (el probador, 70 cm delante para entrar; la estantería, 60). 4 ciudades: 21 gimnasios y 21 tiendas de
  ropa, 0 fallas. Probador entero y nivel 10 en 0; referencias del nivel 10 fijadas de nuevo (las casas del monte
  cambiaron con el arreglo de la separación).

## Asomarse por una ventana (2026-10-17)

- Miguel: «quiero poder asomarme a una ventana y poder ver a los lados… una acción como sentarme, otra que diga ver por
  la ventana». En el 2D (usos.js): cada ventana de afuera de un cuarto (no las vidrieras ni los baños) es un mirador;
  se usa desde una grilla delante del vidrio y a los costados, a ≤ 1,3 m del vidrio, inclinado sobre lo bajo (≤ 0,75 m:
  la cama bajo la ventana) como la cortina. miradoresDePiso y miradoresDeCasa los sacan del plano de edificios y casas.
- validar-usos: 9191 ventanas de 2 ciudades, todas se pueden asomar (sin los baños; con la grilla sólo a lo ancho del
  vidrio quedaban 341 sin llegar, casi todas por la cama bajo la ventana o la ducha).
- En el 3D (acciones3d + DemoView): E «Asomarse» (si la ventana tiene cortina, R la corre; con la cortina cerrada no se
  asoma). El muñeco va al lugar, se pone de cara a la ventana y la cámara va en 0,6 s al ojo, con la cabeza 35 cm afuera
  del vidrio (desde adentro, al mirar a un lado se veía el muro); se mira a los lados hasta 1,2 rad, arriba 0,6 y abajo
  0,8. E o caminar vuelve.
- validar-asomarse (nivel 10, navegador sin ventana): ofrece «Asomarse», queda asomado en ~0,6 s con el ojo donde dice
  mirada(), el giro no pasa del tope y al volver el muñeco se ve. Deja dos capturas.

## Un solo cuerpo (2026-10-17)

- Miguel: «agregar la contextura del personaje fue innecesario; solo con poder cambiarse la ropa y el pelo, barba… es
  suficiente para la primera versión; aprovechamos las buenas medidas de los muñecos iniciales». vestuario.js
  CUERPO_UNICO: la contextura «normal» (persona3d no deforma el muñeco) y escala 1. Se elige hombre o mujer (los dos
  muñecos del paquete), la piel, el peinado, el color de pelo, la barba y la ropa.
- La gente (characters3d lookFor y makeCharacter; citizens3d): sin contextura ni alto al azar; el número que se sacaba
  para cada uno se sigue sacando, así el resto del look —la ropa aprobada— no cambia. El vestier ya no ofrece contextura.
  Las otras contexturas siguen en persona3d (y sus ajustes de ropa), sin usarse.
- validar-cuerpo (nivel 9): la contextura única no deforma, la escala es 1 y 2000 looks de los 16 modelos salen con ella.
- La mujer también es su muñeco tal cual (Miguel): CUERPO_UNICO.ajusteMujer=false, persona3d ya no aplica MUJER (la
  tabla queda, sin usarse). Medido en el vestier: sin el ajuste, el cuerpo de mujer del paquete es el MISMO que el de
  hombre (5952 triángulos los dos, la misma silueta); los hombros angostos y la cadera ancha venían sólo de MUJER. Hoy
  hombre y mujer se distinguen por el pelo y la ropa. validar-cuerpo lo revisa (shapeBody no deforma a ninguno de los
  dos) y se probó que falla si el ajuste vuelve.
- Encontrado de paso (probador completo, ciudad 3): una parada elegida para cubrir viviendas caía en una zona prohibida
  y se descartaba al final, después de contar a quién cubría: 28 viviendas a más de 200 m de una parada. Ahora los
  lugares de parada se filtran por zona antes de elegir (equipamiento.js). 6 ciudades: 100 % cubiertas. Apareció cuando
  el arreglo de la separación de las casas del monte cambió el azar del resto de la isla.
- Probador completo (11 niveles, con validar-cuerpo y validar-asomarse): 0 fallas.

## Entrar a los edificios desde el patio de la manzana (2026-10-17)

- Miguel: «que uno pudiera entrar a los edificios desde el parque interior, es como si fueran tiendas también por ahí».
  En la planta baja (blueprint.js):
  · los edificios de locales cuya parte de atrás da mayormente al patio llevan, en la franja de atrás, otro local del
    mismo giro (y el baño y el depósito), con su puerta en el módulo del medio y vidriera en los demás, como el de la
    calle; el 3D les pone el toldo y la vitrina igual;
  · todo edificio que da al patio (atrás o, en un lote de esquina, a un costado) tiene al menos una puerta ahí: desde el
    pasillo si llega, si no desde un cuarto que no sea baño, bóveda ni celda (el núcleo no: ahí está la escalera).
  Son puertas de afuera (street, con patio:true): el 3D las corta en la fachada y les pone hoja, la navegación las toma
  como entrada.
- 4 ciudades: 402 puertas al patio, 156 de locales con vidriera; los 50 patios de manzana tienen puertas de edificios.
  Sin puerta quedan 22 de 337 edificios que tocan el patio: los de 12 m de fondo cuyo único tramo al patio es el de la
  escalera.
- validar-patios (nivel 3): cada puerta al patio da, afuera del edificio (no del rectángulo del lote: los lotes en L
  tienen patio adentro), a una casilla a la que se llega a pie desde la calle; cada patio con al menos una puerta.
  validar-ciudad: la puerta al patio une el cuarto con «afuera», como la de calle. scripts/ver-patio.mjs: captura.

## Sin género (2026-10-17)

- Miguel: «quitemos lo de hombre y mujer y que sea el pelo el que usen los jugadores y la ropa para armar el muñeco sin
  género». Medido antes: sin el ajuste MUJER, los dos muñecos del paquete son el mismo cuerpo. Ahora hay uno solo
  (vestuario.js CUERPO_UNICO.muneco: Casual_Male), y vestier3d lo arma siempre (sin sexo).
- El vestier ya no tiene Hombre/Mujer: piel, peinado, color de pelo, barba y ropa, todo para cualquiera; el aleatorio
  pone barba al 30 %.
- La gente de la ciudad (characters3d): una sola lista de peinados de calle (los completos de hombre y de mujer del
  paquete), o rapado/calvo al 10 %; barba al 22 % a cualquiera; una sola lista de prendas en outfitFor (vestidos,
  faldas, leggings, cargo, pantaloneta…). Los policías, pelo largo o corto a cualquiera. El modelo del paquete de cada
  persona sigue sirviendo de fuente de su ropa en el armado anterior (VESTIER=false), que ya no se usa.
- validar-cuerpo (nivel 9): ningún look lleva sexo; los de modelos de mujer llevan peinados de hombre y barba, y al
  revés; vestidos y faldas en los de hombre, cargo y pantaloneta en los de mujer.

## Las guaridas (2026-10-17)

- Miguel: el juego pasa a «policías y ladrones» simple. Los ladrones juntan un botín de tanto en sus guaridas; la policía
  gana si los tiene a todos presos. Las guaridas: «que el sistema las escoja, en lugares estratégicos, que roten y
  consuman varios lugares del mapa para que no sea preferible cuál; a los ladrones se les dice el lugar exacto —calle,
  carrera, casa o edificio, piso, apartamento— y ahí está la caja de guardar lo robado». La policía no entra.
- Medido antes de fijar las reglas (scripts/medir-guaridas.mjs, 4 ciudades): 106–150 candidatas por ciudad (~50
  edificios con apartamentos, ~80 casas del monte), casi todas con 2 entradas (calle y patio). Los apartamentos quedan a
  ~80 m de la comisaría y ~200 m de acceso medio al botín; las casas, a ~240 y ~280 m. Por eso la equidad se mide entre
  las guaridas de una ronda: así se mezclan edificios del borde de la ciudad con casas del pie del monte.
- Reglas (medidas.js GUARIDA): una guarida por cada 2 policías; ≥ 2 entradas; ≥ 60 m de la comisaría y ≥ 120 m entre
  ellas, caminando; su acceso al botín a ±15 % entre ellas; en 12 rondas de una ciudad, ningún lugar en más de un tercio.
- engine/guaridas.js: prepararGuaridas (candidatas y caminos, ~3 s por ciudad, una vez) y guaridasDe(bp, {policias,
  ronda}) (~0,5 s): la primera al azar de la ronda; las demás al azar entre las que cumplen (con «la más lejos» salían
  siempre las mismas esquinas: un lugar en 7 de 12 rondas). Cada una con su caja (botin.js colocar, en un cuarto del
  apartamento —pisoLote ahora toma piso y unidad— o de la casa; si no entra, el lugar no es candidato) y su texto:
  «Cl 13 # 21-39 · Edificio La Ceiba · piso 1 · apto 101» o «Cl 1 # 34-22 · casa».
- validar-guaridas (nivel 9), medido aparte del que elige: 2 ciudades × 2/3/5/8 policías × 12 rondas = 96 rondas, 240
  guaridas (65 en la ciudad, 175 en el monte), entre guaridas p10 142 m, de la comisaría p10 87 m, diferencia de acceso
  p50 21 % (máx 30 %), uso máximo de un lugar 25 %, hasta 42 lugares distintos en 12 rondas; 0 fallas.
- Ciudad y monte (2026-10-17): la primera guarida de la ronda, de un tipo al azar (apartamento o casa, mitad y mitad);
  la segunda, del otro. Antes salían 103 casas y 17 apartamentos en una ciudad; ahora, en 2 ciudades, 112 y 128.

## Las viviendas: privadas, con visor, forzables (2026-10-17)

- Reglas del juego acordadas con Miguel (primera versión): la policía entra a las zonas comunes de los edificios
  (vestíbulo, escalera, ascensor, pasillos, azotea) pero no a los apartamentos ni a las casas; las cámaras del edificio
  sacan foto de quien entra cargando algo (dicen el edificio, no el apartamento); arrestar de verdad necesita botín
  encima (requisa); sin nada, es una detención corta por sospecha; la policía gana con todos presos, los ladrones con
  la meta en sus guaridas; hay rescate. Forzar una chapa: para esconderse (no suena nada) o para robar (al tomar el
  objeto suena la alarma); si se entra con gente adentro, a los pocos segundos llaman a la policía. En cada puerta de
  vivienda, «mirar por el visor»: si hay gente o no.
- medidas.js VIVIENDA: ocupación (40 % del tiempo, en tramos de 45–120 s por ronda), visor (a 35 cm de la puerta,
  afuera), forzar (4 s, se oye a 12 m), llamada (5 s), robables de los muebles que ya hay: el televisor (a la vista), el
  portátil del escritorio y el joyero de la cómoda (en la mochila). BOTIN: aLaVista (la escultura y el cuadro, sí; la
  plata y las joyas, no).
- engine/viviendas.js: viviendasDe (cada apartamento con su puerta al pasillo, cada casa con la de calle y la del
  patio, el lugar del visor de cada una y lo robable adentro) y ocupacionDe / enCasa (quién está en casa, determinista
  por semilla y ronda; dura lo que la ronda del modo «Botín», MODO_BOTIN.duracion).
- validar-viviendas (nivel 9): 2 ciudades, 691 apartamentos y 172 casas, 1035 visores afuera y alcanzables, gente el
  40,8 % del tiempo, 47 % de las viviendas cambia de una ronda a otra, 81 % con algo para robar; 0 fallas.

## El motor del modo «Botín» (2026-10-17)

- Simplificación de Miguel: «que no se ponga lento al cargar el robo y que todo le quepa en la mochila, una sola cosa o
  varias, acumulando dinero». Todo va a la mochila y no frena; lo que se lleva encima se pierde en una requisa (el
  riesgo es cuánto juntar antes de ir a guardar).
- Motor nuevo sobre el mundo de verdad (decisión de Miguel; el laboratorio game.js sólo tenía la planta baja de la
  ciudad en casillas de 6 m, sin el monte, los apartamentos ni los pasillos). engine/juego/:
  · mapa.js: una grilla de RUTAS de 2 m sobre la peatonal fina (libre por mayoría; dos vecinas se unen si en su borde
    hay paso fino: escalones, pendientes, muros del monte). Se arma en ~1 s; un campo de distancias tarda ~15 ms; las
    rutas salen como en la fina (mediana +1 %, p90 +7 %). La vista: lo que tapan edificios y monte.
  · partida.js: el estado y las reglas, determinista. Los lugares (guaridas, objetivos, viviendas, comisaría) se usan
    desde sus puertas; adentro se cuenta el tiempo (al apartamento se sube: 3 s por piso). Forzar (4 s, se oye a 12 m),
    la llamada si hay gente (5 s), la alarma al robar una vivienda o un objetivo de mucho valor, la cámara de los
    edificios al entrar con algo en la mochila (retrato), reconocer (al que está llamativo 8 s tras robar o forzar, o ya
    tiene retrato), la requisa (con botín: cárcel y se pierde; sin nada: 20 s por sospecha), el rescate (3 s en la puerta
    de la comisaría), el fin (la meta, todos presos o el tiempo).
  · bots.js: ladrones (guardar con 3 encima, con policía cerca o al final; esconderse si los reconocen; rescatar; robar
    lo de más valor por segundo, mirando antes por el visor) y policías (perseguir al reconocido, ir al aviso más nuevo,
    cuidar la comisaría con presos, patrullar).
- medidas.js MODO_BOTIN: velocidades (ladrón 4,8 y policía 4,6 m/s, la proporción del laboratorio), vista 40 m, requisa
  1,2 m, sospecha 20 s, rescate 3 s, ronda 300 s, meta 7 por ladrón.
- medir-botin (calibración, 2 ciudades × 10 rondas por celda, ±11 puntos): con meta 4 ganan los ladrones el 70–90 %; con
  10, el 10–40 %; con 7, el 35 / 50 / 55 / 60 % en 2 / 3 / 5 / 8 por equipo. Por ronda (3 vs 3, meta 7): 6 requisas, 2
  presos, 4 detenidos por sospecha, 0,5 rescates, 4 guardadas, más valor perdido en requisas que guardado.
- validar-botin (nivel 9): determinista, nadie fuera del mapa, la policía nunca adentro de una vivienda, los presos
  quietos, el valor se conserva (guardado + perdido + mochilas = robado), la ronda termina a tiempo; 0 fallas.
- /botin (src/views/BotinView.vue): el motor jugado por los bots desde arriba —el mapa de rutas, las puertas de las
  guaridas, los objetivos, la comisaría, ladrones y policías (hueco: adentro; borde oscuro: con retrato; el número, lo
  que llevan), los avisos como anillos— con el reloj, el botín contra la meta, qué hace cada uno, los avisos y ciudad,
  jugadores por equipo y ronda (?ciudad=1&jugadores=3&ronda=0), a ×1, ×4 o ×16. scripts/ver-botin.mjs la abre sin
  pantalla, juega a ×16, mide los cuadros por segundo y captura: 114 cuadros/s, 192 s de ronda en 12 s.
- El dron y la gente (2026-10-17, Miguel: «dale con el dron de la policía y gente en la calle»): MODO_BOTIN.dron (lo
  pilota el primer policía, quieto mientras vuela; 12 m/s, 30 s de batería, 45 de recarga; ve a 35 m desde arriba, sólo
  afuera: reconoce al llamativo o al que tiene retrato) y MODO_BOTIN.gente (10 personas por jugador caminando por la
  grilla de rutas, sin rumbo; cerca de un aviso la policía le pide papeles a cualquiera, de a uno, 3 s quieta: no sabe
  quién es ladrón; si le toca uno con botín encima, a la cárcel). Bots: el piloto lanza y lleva el dron hacia el
  reconocido o el aviso más nuevo; el policía que llega a un aviso sin reconocer a nadie pide papeles alrededor.
  /botin dibuja la gente (puntos grises) y el dron (su círculo de vista) y dice si vuela, recarga o está listo.
  validar-botin: la gente sólo por donde se camina, el piloto y el que pide papeles quietos, el dron nunca reconoce a
  alguien adentro (contra el estado de antes del paso: en el mismo paso puede terminar de entrar); 0 fallas.
  Recalibrado: con el dron y la gente la meta pasa a 8 por ladrón (ladrones 50/45/50/45 % en 2/3/5/8 por equipo).
- Dos drones desde el PC de la comisaría (2026-10-17, Miguel: «que la policía tenga dos drones; para usarlos tiene que
  sentarse en un computador de la comisaría; cualquier policía puede usar el PC; que no se descarguen»). MODO_BOTIN.dron:
  2 drones sin batería; un policía va a la comisaría, se sienta (2 s), toma un dron libre y lo maneja mientras siga
  sentado (no anda en la calle); al levantarse, aterriza. partida.js sentarseAlPC / levantarse / dirigirDron; bots: los
  primeros BOT.operadores(equipo) policías se sientan y llevan su dron al reconocido o al aviso más nuevo; /botin dibuja
  los dos y dice quién maneja cada uno; validar-botin (con operadores forzados): el del PC quieto, un dron por
  operador, ningún dron en el aire sin su operador sentado, la policía sólo «adentro» en la comisaría; 0 fallas.
- Medido (medir-botin --operadores, meta 8, 2 ciudades × 10 rondas; % de rondas que ganan los ladrones en 3/5/8 por
  equipo): con nadie en el PC 35/40/45, con uno 45/65/55, con dos 75/75/70. Un dron vale menos que un policía en la calle:
  los bots no se sientan (BOT.operadores = 0) hasta decidir cómo hacer que el dron valga la silla.
- La pista de la guarida que da el preso y hackear a la policía quedaron como ideas (IDEAS.md §000), a pedido de Miguel.
- Falta: más rondas para afinar la meta y, en el 3D, la caja,
  «Guardar», «Forzar» y «Mirar por el visor».

## La ronda jugable en el 3D: el ladrón (2026-10-17, REGLAS.md paso 1)

- REGLAS.md: las reglas del juego en una página (acordadas con Miguel): lo central —robar, huir, atrapar— y las
  ayudas (el celular del policía, los drones desde la comisaría, las patrullas, el hackeo, la ropa en la mochila). Los
  bots ya cumplieron: el mapa da un juego parejo; ahora va lo jugable.
- engine/juego/ronda.js (puro): la ronda del 3D —sus guaridas con la caja, lo robable del mundo con su precio y su
  piso (los objetivos del botín y lo de las viviendas: televisor, portátil, joyero), la meta (8 por ladrón; un punto
  de valor, un millón de pesos)—; usosRonda (lo que se puede hacer al alcance, en el piso del jugador), robar (a la
  mochila, deja el punto del robo para la policía) y guardar (de la mochila a lo guardado).
- acciones3d: robar o guardar le gana a lo demás si está igual de cerca; casaPlan traduce la casa del 3D (que sólo arma
  las que tienen plano) a la del plano. objetos3d: el baúl de la guarida (caja con zunchos y candado).
- DemoView: la ronda se arma después de mostrar el mundo (elegir las guaridas toma unos segundos); el panel de arriba a
  la izquierda (mochila, guardado de la meta con su barra, las guaridas con su dirección), el mensaje de cada robo y
  cada guardada, el baúl dibujado en cada guarida, y en el minimapa las guaridas (verde) y el punto de cada robo (rojo).
- validar-ronda (nivel 10): junto a un robable de apartamento se ofrece «Robar … · precio»; robar suma a la mochila; en
  la caja de la guarida se ofrece «Guardar»; guardar pasa la mochila a lo guardado; el panel lo muestra; 0 fallas.
- Sin armas (REGLAS.md): DemoView ARMAS=false apaga el arma en la mano (viewmodel3d) y el disparo (disparo3d); en
  primera persona vuelven los brazos del muñeco y el clic no hace nada (el código queda, apagado).
- Las puertas de las viviendas (ronda.js): trancadas para el ladrón —la de cada apartamento al pasillo y las dos de cada
  casa— salvo las de sus guaridas y las que ya forzó (trancada() frena al jugador a la altura de cada puerta). En una
  trancada: E fuerza la chapa (VIVIENDA.forzar.tiempo, 4 s, quieto: si se aleja, se corta) y R mira por el visor
  (hay gente o está vacía, por quién está en casa a esa hora de la ronda). Forzar con gente adentro: llaman a la
  policía (un punto como el de un robo). Las de las casas se usan desde afuera (acciones3d pregunta a la ronda también
  sin piso).
- Dos errores de teclas, encontrados al hacer que validar-ronda apriete las teclas como el jugador (antes llamaba la
  acción directo): E sólo hacía las acciones con «.u» (sentarse, cortina…), no las de la ronda —en juego real E no
  robaba—; y R estaba adentro del «if» de E y Q: nunca llegaba (tampoco la cortina desde que se hizo asomarse).
- validar-ronda: robar, guardar, el visor y forzar, con E y R; la puerta trancada frena y forzada deja pasar; 0 fallas.
- La puerta trancada se ve cerrada: las hojas se abrían solas al acercarse (world3d updateLeaves, vivienda3d
  updateDoors). Ahora preguntan a la ronda (setTrancadas → ronda.js puertaTrancadaEn) y la trancada no se abre para
  nadie; forzada, se abre como siempre.
- Lo robado desaparece: el mundo pregunta a la ronda antes de dibujar los muebles de adentro (world3d setOcultos →
  ronda.js robadoEn) y al robar se rearman (refrescarInteriores). Por ahora el televisor (tv@…, en su punto y su piso):
  el computador del escritorio va con la geometría fija del piso y el joyero no se dibuja (es lo de adentro de la
  cómoda). Pendiente: los objetivos del botín (plano3d) y lo de las casas del monte (vivienda3d).
- Un validador que mentía: validar-ronda terminaba en un «finally» que cerraba el proceso, y un error del navegador se
  iba en silencio con «0 fallas» — así pasó por buena la prueba de forzar, que no corría (un comentario «//» dentro del
  código mandado a la página se comía el resto de la línea). Ahora un error es una falla (catch) en validar-ronda y
  validar-asomarse. Con eso, de verdad: forzar abre la puerta (con gente: llaman a la policía), la hoja trancada no se
  abre sola y el televisor robado deja de dibujarse; 0 fallas. validar-3d y validar-asomarse siguen en 0.

## La huida con el cuerpo: azoteas, vida y caídas (2026-10-17, REGLAS.md paso 2)

- medidas.js: CIRCULACION.peaton.velocidad (camina 5,2 y corre 9,2 m/s; antes sólo en DemoView) y VIDA (barra de 100;
  hasta 3,5 m una caída no duele, desde 10 m mata, en el medio en línea recta; vuelve de a 2 por segundo, 6 s después
  del último golpe; el ladrón que muere queda fuera de la ronda y pierde lo que lleva).
- engine/juego/huida.js (puro): alcanceSalto(desnivel) —la parábola del salto del 3D: 6,1 m a nivel, 10 m bajando un
  piso, 12,4 m bajando dos— y danoDeCaida(altura) —3 m: 0; 6 m: 38; 8 m: 69; 10 m: todo—.
- validar-azoteas (nivel 7): la fórmula contra la parábola paso a paso del 3D (±3 %); la red de techos de la ciudad
  (alto = pisos × 3): pegados (bajando lo que no mate, subiendo ≤ ALCANCE) o saltando un hueco. 2 ciudades: el 85 % de
  los techos con escalera tiene salida a otro sin morir (69 % sin daño); 232 pasos pegados, 80 saltos de callejón o calle,
  2 que matarían; la red más grande, 8 y 10 edificios. Falla si menos de la mitad tiene salida.
- DemoView: el jugador queda «en el aire» también al salir de un borde (antes seguía en el suelo mientras caía); se
  guarda lo más alto del salto y al aterrizar resta danoDeCaida (no al bajar del dron ni al salir del ascensor). La
  barra de vida en el panel, el aviso de cada golpe («Caída de 6.0 m · −38»), la pantalla de muerte (fuera de la ronda,
  la mochila perdida) y Enter para volver a la guarida con la vida llena (sólo para probar).
- validar-caidas (nivel 10, navegador sin ventana): soltar desde 3 m no duele, desde 6 m quita 38 como dice la regla, la
  vida vuelve (62 → 68 en 9 s), desde 12 m muere con la pantalla y pierde la mochila, Enter lo devuelve; 0 fallas.
- Sin verificar todavía en el 3D: saltar corriendo de un techo a otro de verdad (que los bordes de las azoteas dejen
  salir y que se aterrice en el techo de enfrente); el 2D dice que la red existe. El muerto queda parado (falta una pose).

## El salto real entre techos y la ciudad que se juega (2026-10-17)

- validar-salto (nivel 10): pares de techos enfrentados a través de un hueco vacío que la regla dice que se salta; el
  muñeco corre (Shift + W) y salta (Espacio) en el borde como el jugador. Probarlo destapó tres cosas:
  · la ciudad del 3D no era la del probador: DemoView genera con parques (?parques=0 los saca) y generateBlueprint, por
    defecto, sin ellos; con la misma semilla, los pisos de los lotes no coincidían desde el lote 8. Ahora el defecto es
    medidas.js JUEGO.parques (true) y todo el probador mide la ciudad que se camina. Eso destapó dos fallas ocultas
    —una pared que volvía a aclararse a menos de 0,6 m (VISIBILIDAD.histeresis pasa a 1 m: 0 fallas, las paredes
    aclaradas no aumentan) y la rotación de las guaridas con 4 por ronda (un lugar en 5 de 12)—: ahora cada ronda evita
    los lugares de las últimas K rondas (K de la regla: ceil(1/maxUso) − 1 = 2), y el acceso va con un decimal (el
    redondeo daba 30,04 % contra el tope de 30); 4 ciudades, 0 fallas;
  · los muros de afuera de los edificios chocaban a cualquier altura (town3d: fachadas y medianeras sin tope, −1000 a
    1000 m): de un techo no se salía ni saltando. Ahora chocan hasta el techo más el pretil (medidas.js AZOTEA, 0,8 m):
    caminando, el pretil frena (nadie se cae sin querer); saltando, se pasa;
  · los «huecos» entre techos de un lote en L eran su otra parte: validar-azoteas y validar-salto exigen el hueco vacío
    (2 ciudades: 41 saltos de verdad, no 80; 84 % de los techos con salida, red más grande 6 y 9 edificios).
- Resultado en el 3D: 3 de 4 saltos caen en el techo de enfrente (un piso más abajo: −3 de vida, desde lo alto del salto).
  El cuarto cae sobre la caseta de la escalera del techo de enfrente y se va por el hueco de la escalera hasta el piso 1
  (−49): error abierto, validar-salto lo marca.

## De policía contra los ladrones bots (2026-10-17, REGLAS.md paso 3)

- `/demo?papel=policia` (o el botón «Papel: policía», que recarga): el motor del modo «Botín» corre en la página sobre
  la misma ciudad (src/lib/persecucion3d.js). Sus ladrones y los otros policías son bots; el jugador es el policía P1
  del motor, marcado `humano`: bots.js no lo decide, partida.js no lo usa para ver ni requisar («ve con sus ojos»), y el
  3D le pasa su lugar en cada cuadro. El motor da pasos fijos de MODO_BOTIN.tick.
- Cada bot es un muñeco en el lugar del motor (ladrones con ropa de calle, policías de uniforme), en el suelo del 3D;
  adentro de algo, preso o detenido, no se dibuja. Sale de la comisaría.
- Los avisos del motor (alarma, llamada, cámara) llevan `quien`: son puntos rojos en el plano (grises si ya se revisó
  la cámara) y un cartel al aparecer. A menos de 8 m del aviso, E «Revisar la cámara del lugar»: el ladrón queda con
  retrato, sus rasgos (piel, pelo, barba: lo que no cambia con la ropa) van al panel, y cuando está a la vista (40 m y
  `mapa.ve`), lleva una marca roja sobre la cabeza.
- Junto a un ladrón (1,6 m): con retrato, E «Atrapar» = `requisa` (con botín, preso y lo pierde; sin nada, detenido
  MODO_BOTIN.sospecha s); sin retrato, E «Pedir papeles»: el policía queda quieto MODO_BOTIN.gente.papeles s y
  contesta («Papeles en orden» o a la cárcel si lleva botín).
- El panel: tiempo, vida, lo guardado por los ladrones contra la meta, presos y avisos; al final, el cartel de quién
  ganó.
- El uniforme (characters3d.js UNIFORME): desde el vestier, los policías salían vestidos de civil (outfitFor no
  distinguía el modelo). Ahora BlueSoldier lleva camisa y pantalón azul oscuro, chaleco reflectivo y gorra; también los
  de la comisaría y los que patrullan.
- Las viviendas trancadas (DemoView `cerraduras`, `trancar`): de policía, todas las puertas de apartamentos y casas
  están trancadas (sólo abre el dueño); entra a las zonas comunes. validar-policia camina con W contra 6 puertas: se
  frena a 0,26 m.
- Falta: entrar a una guarida persiguiendo.
- Validador: scripts/validar-policia.mjs (nivel 10): uniforme, un muñeco por bot, adelanta el motor hasta un robo,
  revisa la cámara, atrapa, pide papeles y fuerza el final, todo con E.

## El dron es sólo para mirar (2026-10-17)

- Miguel: el vuelo libre con V servía para validar el mapa; moverse con el dron no es una dinámica del juego. En el
  juego, los drones se manejan desde el PC de la comisaría (REGLAS.md).
- Al soltar el dron (V), la cámara vuelve al jugador, que sigue donde estaba: ya no se baja donde está el dron. La regla
  del aterrizaje (engine/aterrizaje.js, validar-ubicacion) queda en el motor, sin uso en el 3D.
- El dron no entra a los edificios ni a las casas (DemoView `dronAdentro`): el paso que lo metería se corta eje por eje,
  así resbala por la fachada y se posa en el techo. Si despega desde adentro de algo, arranca sobre el techo. Las casas
  armadas como modelo (casas3d) no dicen su alto: el dron no baja de 7 m sobre el suelo encima de ellas.
- Validador: scripts/validar-dron.mjs (nivel 10). Vuela con W hacia 6 edificios desde la calle a 5 m y baja con C
  sobre un techo: nunca queda adentro. Al soltarlo, el jugador no se movió.

## La sociedad, etapa 1: familias, trabajos y horarios (2026-10-17)

- Miguel: «que cada npc tenga un comportamiento predefinido: trabaja de tal hora a tal hora, va al gim, hace compras tal
  día, y los horarios de apertura y cierre de la ciudad; que todo lo podamos calibrar con el tester 2D pasando varios
  días»; familias; niños que van al colegio. Reglas en medidas.js RELOJ y SOCIEDAD; el motor, engine/sociedad.js (puro,
  determinista por ciudad: la misma en todas las rondas).
- El reloj: 1 minuto real = 1 hora de la ciudad (RELOJ.escala 60): la ronda de 5 min dura 5 h. Cada ronda empieza un día
  y una hora de la semana (inicioRonda, por semilla y ronda).
- Las familias: una por vivienda (apartamentos y casas del monte), de solo, pareja, familia, monoparental o con abuelos;
  nombres y apellidos. Los papeles: niños pequeños (< 5), estudiantes (< 18), jubilados (≥ 65), quien cuida a los chicos
  y los que buscan trabajo.
- Los lugares y sus horarios: por giro o tipo de lote (panadería 6-20, oficinas 8-18 de lunes a viernes, colegio con
  jornada extendida hasta las 18:30 y clases de 7 a 15, hospital y hotel las 24 h en turnos de 8 h, parques de 6 a
  21…). Los puestos de trabajo: por lugar y turno (los que abren más de 10 h, dos turnos), con francos repartidos para que
  nunca falte uno; se cubren primero uno por lugar y turno.
- El cuidado: un menor de 10 nunca queda solo. En cada hogar con chicos hay quien los cuida: el 65 % trabaja de lunes a
  viernes de día (oficina o colegio), los deja a las 7 —los pequeños, en el jardín— y los recoge al salir; los demás
  cuidan la casa o trabajan en ella y los recogen a las 15. Afuera del colegio, los chicos van con quien los cuida.
- Las rutinas: gimnasio (25 % de los adultos, 3 días), compras (3 por hogar a la semana), comer afuera (el hogar junto,
  más el fin de semana), el parque (los chicos con quien los cuida; los grandes solos), paseos de los que no salen a
  trabajar. Entre un lugar y otro caminan a 1,3 m/s (la calle); si da el tiempo, vuelven a casa entre medio.
- Quién está en casa en la ronda (visor, llamada de los vecinos) ya no es una tirada: sale de las familias
  (ocupacionSociedad; se quitaron VIVIENDA.ocupacion y ocupacionDe). ronda.js y partida.js guardan `inicio`.
- Medido (validar-sociedad, 2 ciudades, 14 días cada 10 min, 0 fallas): ~1.050 personas y 348 hogares por ciudad; 755
  puestos cubiertos, todos los lugares abiertos con alguien trabajando. Viviendas con gente: 100 % de 0 a 6 h, 66-82 %
  de 9 a 17 h entre semana, ~90 % el fin de semana. En la calle, de noche, nadie; picos a las 15 (salen del colegio) y a
  las 18 (salen de las oficinas). Se arma en ~15 ms.
- Equilibrio (medir-botin, 2 ciudades × 20 rondas): los ladrones ganan 40/57/50/63 % (2/3/5/8 por equipo; antes 45-50 %).
  Llamadas 0: los bots miran por el visor y sólo entran a las vacías.
- Para calibrar: `node scripts/ver-sociedad.mjs 1 L8:104` (una familia y la semana de cada uno) y
  `node scripts/ver-sociedad.mjs 1 martes 11` (dónde está la ciudad a esa hora).
- Falta (etapa 2): dibujarla en el 3D (cada uno en su lugar a la hora de la ronda; la hora en pantalla), que al cruzarse
  con alguien diga su nombre y su oficio (también los ladrones, con un oficio de pantalla, y los policías), y que sólo
  el dueño abra la puerta de su casa.

## La sociedad, etapa 2: en el 3D (2026-10-17)

- La hora de la ciudad: la ronda empieza el día y la hora de inicioRonda y corre a RELOJ.escala (un minuto real, una
  hora). Se ve en el panel («Hora») y junto al nombre de la ciudad. La noche es automática, de 19 a 6 (sólo cuando
  cambia: N la sigue cambiando a mano).
- La gente de la calle es la de las familias (src/lib/sociedad3d.js + engine/juego/transeuntes.js): reemplaza a la que
  caminaba sin rumbo (crowd queda en 0). Un rato «en la calle» de la semana empieza a su hora; desde ahí se ve caminar
  a esa persona de la puerta de donde sale a la de donde va, por las calles (el campo de distancias de la grilla de
  rutas), a paso de persona (1,4 m/s), o más rápido si el camino es largo: nadie tarda más de 90 s reales en llegar.
  Si caminara a la velocidad del reloj (×60) iría a 80 m/s; a paso de persona sin tope, los del monte se verían
  caminando horas. Los del parque, en el parque. Los chicos, al lado de quien los cuida y más bajos.
  Medido cerca del colegio (radio 150 m): lunes a las 11, 40; a las 15, ~350; a las 3 de la mañana, 0. Se dibujan los
  45 más cercanos a menos de 90 m. Los muñecos se reciclan, uno por persona según su id. Los caminos se calculan de a
  poco: 4 ms por cuadro, más 3 ms para adelantar los de cerca.
- Al lado de alguien (2,6 m), el cartel con su nombre, su oficio y su edad. Los ladrones bots dicen un nombre y un
  oficio de verdad de la ciudad (de incógnito: su nombre no es de ninguna familia). Los policías dicen «Agente
  Apellido · Policía».
- Sólo el dueño abre: las viviendas siguen trancadas (salvo las guaridas del ladrón y las que fuerza). Las casas de la
  ciudad (lotes «casa») no eran viviendas y su puerta se abría para cualquiera; ahora son viviendas (tipo casaLote: 9 en
  2 ciudades), con familia, visor y robables.
- Los locales cerrados (sociedad.js puertasDeLugares): la puerta de calle de cada local (el cuarto con giro) y, en un
  lote sin viviendas (oficinas, colegio, biblioteca, el objetivo), todas sus puertas de calle se trancan mientras el
  lugar está cerrado. El portal de un edificio con viviendas no se tranca nunca, y los de 24 h tampoco. El que está
  adentro del lote siempre puede salir.
- validar-3d fija el mediodía antes de las capturas (las referencias son de día). __demo.fijarHora(día, hora) lleva la
  ronda a esa hora (para probar).
- Validador: scripts/validar-gente.mjs (nivel 10): la hora corre un minuto por segundo; un lunes a las 15 hay gente
  junto al colegio y a las 3 nadie; el cartel coincide con una persona del motor; la puerta de un local frena de
  madrugada y deja pasar a mediodía.
- Falta: que la gente vaya por las veredas (hoy la grilla de rutas no distingue vereda de calzada), verla entrar y
  salir por las puertas y verla adentro de los lugares (en la tienda, en el colegio). También que la policía pida
  papeles y compare con el censo: el nombre del ladrón no es de ninguna familia.

## Veredas, papeles contra el censo y el salto a la mansarda (2026-10-17)

- La gente va por las veredas: la grilla de rutas tiene un costo por celda para la gente (mapa.js `veredas()`,
  `campo(puntos, costo)`). La calzada (la calle o la avenida de la ciudad a más de CALLE.vereda de la manzana) cuesta
  CALZADA = 4; la cebra y lo demás, 1. Así cruza por las cebras. Los bots del modo «Botín» siguen con su campo en
  metros. Medido (validar-sociedad): por la calzada iba el 13,2 % del largo de los caminos; ahora el 2,1 %, con caminos
  un 3 % más largos. Ninguno de los ~1.000 que se ven a las 7, 11, 15 y 18 queda fuera de lo caminable.
- Pedir papeles, de policía:
  - a cualquiera de la calle (14 años o más): los dos quedan quietos MODO_BOTIN.gente.papeles s y contesta «Papeles en
    orden: nombre, edad · oficio · vive en edificio, apto» (direccionHogar);
  - al ladrón: con botín, a la cárcel; sin botín, «Dice llamarse X (oficio): no aparece en el censo. Queda marcado»
    (retrato y marca roja). El nombre falso del ladrón nunca es de alguien del censo (enCenso).
  En el motor (partida.js), al que le piden papeles se queda quieto (`a.quieto`); antes el ladrón bot seguía caminando
  y la consulta no daba nada. Sin botín queda con retrato (`stats.censo`); vale también para los policías bots.
- El salto que caía adentro de un edificio (validar-salto, anotado como «la caja de la escalera») era la mansarda. El
  techo de mansarda está 2,8 m más arriba que el último piso (town3d: sus paredes y su techo plano). Al topar las
  fachadas en el pretil de la azotea, sus paredes también quedaron cortadas a 0,8 m: el que llegaba de un salto pasaba
  por encima y caía al último piso. Ahora la fachada y la medianera de una mansarda llegan a su techo (3 m), y
  validar-salto cuenta ese alto (la fachada del plano: techo «mansarda»). Además devuelve la vida entera antes de cada
  salto (`__demo.curar`). Medido: 4 de 4 saltos caen en el techo de enfrente.
- Equilibrio con los papeles nuevos (medir-botin, 2 ciudades × 20 rondas): los ladrones ganan 38/57/53/63 % (2/3/5/8 por
  equipo; antes 40/57/50/63). Los policías bots le piden papeles a un ladrón 0,1 veces por ronda: el censo pesa cuando
  juega una persona.

## Entrar persiguiendo, las patrullas, la gente adentro y la ocupación (2026-10-17)

- Entrar persiguiendo (persecucion3d.js, REGLAS.md paso 3): si un ladrón se mete a su guarida con el policía a menos de
  PERSECUCION.persigue (30 m), que lo vio hace menos de PERSECUCION.reciente (4 s), esa puerta queda abierta para la
  policía (cerraduras: R.abiertas) y el ladrón queda con retrato. Adentro, a PERSECUCION.caja (2,2 m) de la caja, E
  «Registrar la guarida» requisa a los que estén (partida.js registrar: con botín, a la cárcel; sin nada, detenidos).
  De policía se dibujan las cajas (dibujarCajas, la misma de la ronda del ladrón). Ojo: un ladrón bot que entra a
  guardar sale a los ~2,5 s; se lo agarra adentro si se esconde, y si no, a la salida.
- Las patrullas (src/lib/patrulla3d.js, medidas.js PATRULLA, REGLAS.md paso 4): PATRULLA.cuantas(equipo) =
  máx(2, ⌈equipo/2⌉), estacionadas en la calle frente a la comisaría (desde cada puerta, 5 m hacia la calle, alineadas
  con ella). Sólo la policía se sube (E). Se manejan como un auto:
  - W/S acelera, frena y da reversa; A/D dobla las ruedas;
  - giro de bicicleta con 2,6 m entre ejes; a más velocidad dobla menos;
  - 16 m/s (58 km/h) adelante y 5 en reversa.
  Choca en cinco puntos de su largo con lo mismo que el jugador, con los autos del tránsito y con las otras patrullas,
  y frena sola ante la gente. La cámara va detrás y arriba, con velocímetro. Con E se baja por la puerta del conductor
  y la patrulla queda estacionada donde se dejó. Las estacionadas frenan al que camina. En el plano, blancas (azul la
  que se maneja). Validador: validar-patrulla (nivel 10).
- La gente adentro de los lugares (sociedad3d.js ADENTRO): los que a esa hora están en un lugar se ven en sus cuartos.
  En un local, los cuartos con giro; si no, cualquiera que no sea de servicio ni de un apartamento. Cada uno en su piso
  y siempre en el mismo punto, a menos de 40 m del jugador: hasta 18 por lugar y 40 en total (primero los que trabajan
  y los lugares más cercanos). El que todavía se ve llegando no aparece adentro. validar-gente: un lunes a las 11, 40
  adentro cerca del colegio (18 en el colegio), todos en su lote y a la altura de un piso; a las 3, nadie.
- La ocupación (calibrada): con 20 % de adultos sin trabajo (los puestos son pocos), de día casi todas las viviendas
  tenían gente (66-82 %). Ahora, de los que no consiguen puesto, el 65 % vende en la calle (SOCIEDAD.informal:
  «Vendedor ambulante», de lunes a sábado de 8 a 16). Cada uno tiene su esquina: la vereda junto a una cebra, uno por
  esquina; son lugares «esquina» de sociedad.js. Medido (validar-sociedad, 2 ciudades × 14 días):
  - sin trabajo, del 20 % al 6,5 % de los adultos;
  - viviendas con gente entre semana de 9 a 16, del 66-82 % al 55-74 %; de noche ~100 %; el fin de semana, 86-97 %;
  - las 64 esquinas con vendedor quedan en la vereda.
  Para el ladrón: entre semana de día, una de cada tres o cuatro viviendas está vacía; de noche, casi ninguna, pero la
  calle está vacía.

## El menú del juego, prototipo (2026-10-17)

- Miguel: «más que celular es como si entrara a un menú: ahí se ve lo que roba, puede editar su vestimenta, puede ver el
  retrato que sale en las noticias». Primero el prototipo aparte, para iterar rápido; después se conecta al 3D.
- /menu (src/views/MenuView.vue): el menú encima de una captura del juego, con Tab para abrirlo y cerrarlo y un botón
  para cambiar de papel. Los datos son de mentira y reaccionan; el censo es el de verdad (ciudad 1, sociedad.js). Los
  dos papeles comparten el estado: lo que difunde la policía sale en las noticias del ladrón.
- src/components/MenuJuego.vue: el menú, para reutilizarlo en el juego (props papel, datos, abierto; eventos cerrar y
  accion). Pestañas:
  - del ladrón:
    - Botín: la mochila con lo robado (dónde y a qué hora), lo guardado del equipo contra la meta y las guaridas de la
      ronda (la suya marcada).
    - Ropa: el muñeco de verdad (MunecoVista.vue, el cuerpo único del vestier) y, por parte del cuerpo, lo puesto y lo
      que lleva en la mochila; tocar una prenda se la pone y guarda la otra. La piel, el pelo y la barba no cambian.
    - Noticias: el «Se busca», con los rasgos, la ropa con que lo grabó la cámara (el muñeco vestido así), dónde y cuándo
      lo vieron, y si ya lo difundieron; abajo, los titulares de la ronda.
    - Equipo: la banda (libre, preso o detenido) y lo que lleva cada uno.
  - del policía:
    - Avisos: los robos, con su tipo, hora y lugar, si se revisó la cámara, y «En el plano».
    - Retratos: los sospechosos (de una cámara o del censo); «Difundir» lo pone en las noticias.
    - Censo: buscar por nombre, con edad, oficio y dónde vive; si no hay nadie con ese nombre, «mintió».
    - Equipo: los compañeros, las patrullas (estacionada o manejando) y los drones libres.
- Falta conectarlo: la Tab en /demo, los datos del motor y de la ronda (la mochila de ronda.js, los avisos y retratos
  de persecucion3d.js, el censo de sociedad.js), cambiarse de ropa en el muñeco del jugador (y que la próxima cámara
  grabe la ropa nueva) y que «Difundir» llegue a las noticias del otro bando.

## La entrada al juego, prototipo (2026-10-17)

- Miguel: «cómo alguien se loguea —Google o Steam simulado—, cae en un Home con las salas abiertas, puede crear un mundo,
  verlo, ponerle nombre y esperar a que la gente se una». /inicio (src/views/InicioView.vue), todo simulado, para
  calibrar el diseño; ?paso=titulo|home|crear|sala vuelve directo a una pantalla.
- Decisión: Steam como principal, porque el juego va para Steam. Ahí no hay pantalla de login: Steam ya sabe quién es
  el jugador y FUGA pide permiso una vez (nombre y amigos). Google queda para la versión web. La ventana de permiso es
  simulada. La cuenta se recuerda en la pestaña (sessionStorage).
- Las pantallas:
  1. Título: FUGA, «Entrar» o «Seguir como…».
  2. Entrar: Steam (recomendado) o Google, y la ventana de permiso.
  3. Perfil, la primera vez: el nombre que ven los demás y el aspecto (piel, pelo, peinado, barba), con el muñeco de
     verdad (MunecoVista). Es lo que no cambia en la partida: lo que sale en un retrato.
  4. Home: «Jugar rápido» (a la sala que tiene más gente) y «Crear mundo». Las salas abiertas muestran el nombre, el
     anfitrión, el tamaño, la ciudad, la región y el ping, y los lugares de cada bando; las que están en partida o son
     privadas salen en gris.
  5. Crear mundo:
     - el nombre, los jugadores (2, 3, 5 u 8 por bando) y la ciudad, con el plano de verdad del generador
       (drawWorldStage) y «Otra ciudad»;
     - los datos de esa ciudad (habitantes, hogares, edificios, casas del monte, lugares y golpes grandes, de
       sociedad.js);
     - pública o con código.
  6. La sala de espera: el plano, los dos bandos con sus lugares, «Pasarme a…», «Estoy listo» y el chat. La gente se
     une sola (simulada), uno cada ~2 s, y dice cosas. Cuando están todos y listos, una cuenta atrás de 5 s lleva a
     /demo con esa ciudad, ese tamaño y ese bando. El anfitrión tiene «Empezar ya (prueba)».
- Hallazgo: el análisis de City (engine/index.js) no aprueba ninguna ciudad con parques (0 de 59). Por eso pickCity de
  /demo cae siempre en la ciudad 1 después de 200 intentos, y «Otra ciudad» siempre da la 1. En /inicio, si 12
  intentos no pasan, se elige una semilla al azar. En /demo queda igual: el probador sólo valida las ciudades 1 a 4.
  Medido: la 40135, elegida así, carga en /demo sin errores.
- Cómo se juega (/inicio, paso «reglas»):
  - Se abre desde el título, desde la barra de arriba, desde el aviso «¿Primera vez?» del Home y desde la sala.
  - Pestañas: El juego, Ladrones, Policía, La ciudad y Controles. Cada una tiene una frase y tarjetas de una idea; las
    teclas, en Controles.
  - El texto vive en src/lib/reglasJuego.js, sacado de REGLAS.md (la fuente). Los números salen de medidas.js (la
    duración, la meta, la vida, las patrullas), para que no se desfasen. Lo puede usar el menú del juego.
  - En la sala de espera, «Vas de ladrón / de policía» da lo básico de ese bando en tres pasos, con «Todas las reglas».
- REGLAS.md: «el celular» pasa a ser «el menú (Tab)», como decidió Miguel.

## El menú conectado al juego (2026-10-17)

- En /demo, Tab abre y cierra el menú (components/MenuJuego.vue, el del prototipo) y suelta el ratón. Escape también lo
  cierra; con el menú abierto el juego no recibe teclas y el mundo sigue. Al cerrar, vuelve a capturar el ratón si fue
  una tecla de verdad (navigator.userActivation); si no, aparece «Clic para caminar». Los datos se arman de la partida
  cada medio segundo mientras está abierto (DemoView datosMenu). En la barra de arriba: «Tab menú».
- Del ladrón (la ronda, ronda.js):
  - Botín: R.enMochila (nuevo: lo que lleva, una cosa por vez, con dónde y cuándo; guardar la vacía), lo guardado contra
    la meta y las guaridas con su distancia.
  - Ropa: la del muñeco del jugador. Las plantillas guardan ahora su ropa (characters3d: t.outfit, también las de los
    workers). En la mochila hay tres prendas de repuesto (de arriba, de encima y para la cabeza). Ponerse una vuelve a
    vestir al muñeco (vestirPlantilla: la misma persona con otra ropa) y deja quieto VESTIR_S = 4 s; la prenda vieja va
    a la mochila.
  - Noticias: robar en un edificio (lugar con lote) hace que su cámara lo grabe con la ropa que tiene puesta (el
    retrato: rasgos, ropa en palabras —src/lib/ropaTexto.js—, dónde y cuándo). A RETRATO_DIFUNDE = 45 s sale en las
    noticias («SE BUSCA», con aviso en pantalla). Los titulares salen de lo que pasa: robos, llamadas de los vecinos,
    cámaras y difusiones. De ladrón todavía no hay policías: el retrato se difunde solo.
  - Equipo: él (todavía no hay compañeros bots de ladrón).
- De la policía (persecucion3d.js info()):
  - Avisos: los del motor, con lugar y hora; «En el plano» los marca con un anillo que late 20 s.
  - Retratos: los ladrones con retrato, con sus rasgos, la ropa de su muñeco, cuándo se los vio, el nombre que dieron en
    los papeles y su estado.
  - «Difundir» (persec.difundir): desde ahí, si alguien de la calle lo tiene a menos de 12 m y a la vista, avisa (aviso
    «Un vecino lo vio», uno cada 20 s por ladrón; sin cámara que revisar).
  - Censo: la sociedad de verdad.
  - Equipo: los compañeros (el que está en el PC del dron), las patrullas y los drones libres.
- Validador: scripts/validar-menu.mjs (nivel 10).
  - De ladrón: Tab abre y cierra; robar en un apartamento llena el Botín y lo graba la cámara; el retrato sale en las
    noticias; ponerse una prenda cambia la ropa del muñeco, lo deja quieto, y el retrato guarda la ropa vieja.
  - De policía: Avisos igual al motor, Retratos, Difundir, el aviso del vecino y el Censo (real y falso).

## El muñeco de los dos bandos (2026-10-17)

- Miguel: «que en la edición de personaje también pueda editar su muñeco para ser policía: al final el juego lo puede
  colocar de policía o de ladrón».
- Perfil (/inicio): el cuerpo es uno solo (piel, pelo, peinado, barba) y «De civil (ladrón) / De policía» cambia la ropa
  del muñeco.
  - De civil: por parte del cuerpo (arriba, encima, abajo, calzado, cabeza), la prenda del vestier y su color (la
    paleta del vestier); encima y cabeza pueden ir sin nada.
  - De policía: el uniforme (characters3d UNIFORME: camisa y pantalón azul oscuro, chaleco reflectivo y botas), con o
    sin gorra (uniformeDe).
  - Se guarda solo al cambiarlo, en la cuenta (sessionStorage): cuerpo, ropa.calle y ropa.gorra.
- El juego (/demo) sale con ese muñeco: muñecoDelPerfil arma su plantilla (characters3d plantillaJugador: el cuerpo del
  perfil con la ropa de su bando) y reemplaza al de una plantilla al azar apenas está lista. Sin cuenta (el probador, o
  entrando directo a /demo), queda el de siempre. Medido en el navegador: de ladrón, Casual_Male con la sudadera roja
  del perfil; de policía, BlueSoldier_Male con el uniforme y gorra; los dos con la misma piel y el mismo peinado.
- Cambiar el color de lo puesto (el menú, pestaña Ropa, 2026-10-17): tocar la prenda puesta abre la paleta del vestier y
  elegir un color tiñe esa prenda del muñeco del jugador (los mismos VESTIR_S s quieto; el retrato guarda el color
  viejo). También en el prototipo /menu.
  - La mochila trae ahora también una prenda de abajo.
  - El vestido va solo: ponérselo guarda lo de abajo en la mochila; sacárselo sin nada abajo pone lo de abajo de la
    mochila, o un pantalón. Antes, cambiar un vestido por una sudadera dejaba al muñeco sin nada abajo.
  - validar-menu lo prueba: tocar la prenda de arriba, elegir otro color y que el muñeco quede con ese color.

## El caminar natural y el ladrón contra la policía bot (2026-10-17)

- Miguel: «el comportamiento de los npc se ve raro, corren de forma rara, no se chocan entre ellos (en la imagen hay dos
  unidos)». Medido en el 2D a la salida del colegio:
  - el 23,6 % caminaba a más de 2,5 m/s, con saltos de hasta 18 m/s. Para que nadie tardara más de 90 s en llegar, los
    caminos largos se recorrían hasta a 8 m/s;
  - ~934 pares a menos de 55 cm por instante: todos los que salían de un lugar a la vez iban apilados por el mismo
    camino, y el niño caminaba a 0,6 m de quien lo cuida, cuerpo contra cuerpo.
- Ahora (transeuntes.js CAMINAR):
  - el paso de cada uno por su edad y su id (niños 1,0-1,25 m/s, adultos 1,2-1,65, mayores 0,95-1,2); el chico va al paso
    de quien lo cuida, a su lado (0,75 m) y un poco atrás;
  - nadie corre: en un camino de más de 280 m se ve el primer tramo de 140 m y el último a pie, y el medio va en bus (25
    s, no se ve);
  - cada uno sale hasta 18 s después de su hora; del colegio, hasta 60 s;
  - un carril propio por la vereda (hasta 0,9 m a un costado), con el rumbo promediado en ±2 m para que en las esquinas
    gire de a poco;
  - separar: nadie a menos de 0,65 m de otro, ni del jugador. El desvío se guarda entre cuadros y cambia a lo sumo a 1,1
    m/s, como quien se hace a un lado caminando. Si lo saca de lo caminable, vuelve de a poco; en el vano de una puerta
    no se mira la pared, y se abren en abanico.
  - En el 3D (sociedad3d): siempre la animación de caminar al paso de cada uno, el giro suave hacia donde va, y adentro de
    los lugares cada uno en un lugar de una grilla de 0,9 m de su cuarto.
- Medido después (validar-sociedad, 30 s a 30 cuadros por segundo junto al colegio):
  - a las 11: paso mediano 1,26 m/s, el 99 % a menos de 1,81, el más rápido 3,0; encimados 1,7 % de la gente por cuadro;
  - a las 15: paso mediano 1,31 m/s, el 99 % a menos de 2,27, el más rápido 3,0; encimados 3,4 %.
  En el 3D (validar-gente), 9 pares encimados en 1.641 personas medidas (antes 1.110).
- De ladrón contra la policía bot (persecucion3d papel «ladrón»): el jugador es un ladrón del motor y la policía y los
  otros ladrones son bots (5 muñecos en 3 vs 3).
  - Robar en el 3D lo deja a la vista y suena la alarma (el motor), la cámara da su retrato, los vecinos llaman y guardar
    suma al botín del equipo (el panel muestra lo del equipo).
  - Adentro de un edificio está escondido.
  - Si un policía bot lo alcanza con botín: preso, pierde la mochila, con cartel, en la comisaría, y un compañero bot
    puede rescatarlo. Sin botín: detenido un rato. Si le piden los papeles: quieto.
- El final de la ronda, en los dos papeles: «¡Ganaste! / Perdiste», por qué y cómo quedó, con «Otra ronda» y «Volver al
  inicio» (/inicio?paso=home). El recorrido queda entero: /inicio → sala → /demo → final → /inicio.
- Validadores nuevos o ampliados: validar-sociedad (el caminar), validar-gente (encimados en el 3D) y validar-ladron
  (nivel 10: robar, preso, rescate, detenido, final y volver).

## La rutina: agenda, necesidades, buses y eventos; el calibrador (2026-10-18)

- Miguel: «que tengan agenda y necesidades; si hay un trancón o un robo y el tiempo se descuadró, priorizar y descartar
  unas cosas por otras para ponerse al día; que el juego se estabilice; calibrarlo milimétricamente en el 2D», y «un
  calibrador debajo del 2D que acelere las pruebas». Regla de trabajo: toda dinámica se calibra en el 2D, con metas
  medibles y el calibrador.
- engine/rutina.js (puro, determinista). Reemplaza las salidas al azar de sociedad.js; lo obligatorio (trabajo,
  colegio, llevar y recoger, vender) sigue saliendo de sociedad.js.
  - Cada persona vive su día decidiendo en el momento. Lo obligatorio tiene hora. En los ratos libres elige, entre los
    lugares abiertos que le quedan a tiempo, el que mejor cubre sus necesidades:
    - hambre: comer en casa o afuera; en un turno largo almuerza en el trabajo, y los de oficina a veces salen a
      almorzar cerca;
    - despensa del hogar: hacer mercado;
    - físico: sólo los socios del gimnasio;
    - ocio: pasear, el parque, la biblioteca, vitrinas, un helado.
    Cada lugar dice qué necesidad cubre, cuánto la baja, cuánto dura y lo mínimo si hay apuro (RUTINA.lugares).
  - Si algo atrasa: lo que ya no cabe no se hace (lo opcional primero), lo flexible se acorta hasta su mínimo y lo
    obligatorio se hace aunque sea tarde. Al planear se usa el tiempo esperado del viaje: nadie sabe del trancón antes
    de salir. Con hambre a la hora de dormir, come igual.
  - El viaje: a pie hasta 450 m; más lejos, el bus si no tarda más de 1,4 veces lo que a pie. Para eso se camina al
    paradero, se espera el próximo (cada 12 min, de 5 a 23) y se camina desde el paradero. Los paraderos son los 4 de la
    ciudad (equipamiento «parada») y uno cada 180 m en las carreteras del monte; son lugares «parada» de sociedad.js.
  - Los eventos (para probar; después, desde el juego): trancón (los buses tardan), robo (el que pasa cerca corre o da la
    vuelta) y cierre (el lugar no abre).
  - Se estabiliza:
    - el hambre de cada mañana es la de siempre de cada uno (el desayuno reinicia);
    - las necesidades que pasan de un día a otro se redondean cada noche a 0,1;
    - el ruido de cada decisión depende de la persona, el día, el lugar y el cuarto de hora, no del orden en que se
      sacan los números. Antes, una diferencia mínima cambiaba decisiones días después: sólo el 65 % volvía a ser igual.
- engine/medirRutina.js: las curvas por hora (casa, trabajo, estudio, comer, compras, ejercicio, ocio, calle, bus; por
  grupo y para entre semana y fin de semana), los indicadores (comidas por día, idas al gimnasio, llegadas tarde,
  perdidas, pendientes), la pérdida contra las metas y la estabilidad.
- Las metas, en scripts/datos/objetivos-rutina.json. PROVISORIAS: hipótesis de cómo vive una ciudad colombiana, a
  reemplazar por las tablas de la ENUT del DANE.
- scripts/validar-rutina.mjs (nivel 9):
  - la semana contra las metas: las de peso 3 son reglas; las otras se muestran para calibrar;
  - un martes con trancón (6:30-9, +30 min en bus), un robo frente al colegio a la salida (15 min a 120 m) y una
    panadería cerrada. Mide: lo obligatorio casi no se pierde, los eventos atrasan, lo opcional se cae antes que comer,
    nadie va al lugar cerrado, el miércoles a las 3 todos en casa, y la gente que hace lo mismo que en la semana normal
    no baja de un día a otro y el domingo es al menos el 90 %;
  - mismos eventos, misma semana.
  Medido: ~210 personas atrasadas, 1 de ~4.000 obligaciones perdida; iguales a la semana normal de miércoles a
  domingo: 90 → 93 % y 89 → 94 %.
- scripts/calibrar.mjs: el calibrador genérico. Un experimento (scripts/experimentos/<nombre>.mjs) dice sus perillas
  (rutas de medidas.js con su rango) y su evaluación (la pérdida contra sus metas). Hace tres cosas:
  1. mide cómo está hoy;
  2. explora con combinaciones repartidas por el rango;
  3. refina alrededor de la mejor, con pasos que se achican.
  Corre en paralelo (11 trabajadores) y deja el informe meta por meta en scripts/datos/calibracion-<nombre>.json. No toca
  medidas.js. Experimentos:
  - «rutina»: 11 perillas, con la estabilidad como meta de peso 3. Sin ella, el calibrador ganaba curvas rompiendo la
    estabilidad: optimiza sólo lo que está en las metas. 220 pruebas en ~80 s: pérdida 0,38 → 0,014, 14 de 15 metas.
    Valores pasados a medidas.js.
  - «botin»: la meta por ladrón para que los ladrones ganen ~50 % en cada tamaño (lento).
  `node scripts/calibrar.mjs rutina --iter=220 --semillas=1,2`
- Falta:
  - el mercado del fin de semana en la mañana (1,4 % contra 2-8 %: la tienda no abre el domingo);
  - las metas de verdad (ENUT);
  - los eventos desde el juego: hoy la semana se arma antes y un robo en el 3D todavía no la cambia; hay que volver a
    planear desde la hora del evento a los que alcanza;
  - el bus en el 3D: ver a la gente esperando en el paradero y subiendo al bus.

## La revisión de fachadas (2026-10-18)

- scripts/ver-fachadas.mjs: fotos a mediodía de un edificio por cada combinación (tipo, familia, techo, toldos) y de
  casas del monte y de la ciudad, de frente, en diagonal y desde arriba. La cámara nunca queda dentro de un lote: se
  acerca hasta quedar en la calle. Revisadas en las ciudades 1 y 2 (46 edificios y casas, 138 fotos).
- La lista de correcciones y mejoras, con evidencia, dónde tocar y prioridad: FACHADAS.md.
- El esquema de color de afuera (2026-10-18; color.js esquemaDe, PALETA.esquemas): pared, moldura, acento (puertas,
  barandas y, en paredes claras, los marcos de las ventanas) y zócalo de 0,8 m. Los marcos y el zócalo tienen material
  propio en el 3D (fachada3d.js: MI_Marco y MI_Zocalo). Lo prueba validar-color.mjs y el porqué está en FACHADAS.md.

## La gente: caminar natural y descansar (2026-10-18)

- **Caminar sin tirones** (Miguel: «saltos bruscos de movimiento»). validar-caminar midió aceleraciones de 12 a 26 m/s²
  y giros de hasta 800°/s. En transeuntes.js:
  - las esquinas del camino de la grilla se redondean;
  - cada uno sigue su punto con un resorte (aceleración tope 2,8 m/s²) y los vecinos se empujan como una fuerza;
  - mira hacia donde camina y la animación va a lo que avanza (`ANIM` en medidas.js);
  - la pose de los muñecos a media distancia se anima en cada cuadro (characters3d `ANIM_EVERY`).
- **Descansar** (Miguel: «que paren, se sienten o se queden parados y eso los recargue»). El cansancio es una necesidad
  más de la rutina (`RUTINA.necesidades.energia`):
  - sube afuera y caminando, baja en casa y al dormir;
  - pasado el umbral, cada uno busca una banca (2 asientos), una esquina donde quedarse parado (4) o su casa;
  - los cupos se respetan y los niños que acompañan se quedan de pie junto a la banca;
  - en el 3D, el de la banca se sienta con la pose de las sillas y los de la esquina quedan en corrillo.
- **La calibración** (calibrar descanso, sólo las perillas del cansancio): de 15 a 19, la gente quieta es el 22–24 % de
  la que está en la calle (meta 15–30 %, nueva en objetivos-rutina), sin mover las demás metas.
- **Las pruebas:** validar-caminar y validar-descanso, en el nivel 9 del probador.

## Sin el dron (2026-10-18)

- Miguel: «el drone sobra con este nuevo estilo de juego, con el mapa y los puntos de ayuda». Se sacó el dron de la
  policía (MODO_BOTIN.dron, los PC de la comisaría, sentarseAlPC/levantarse/dirigirDron, el operador de los bots, la
  sección «Drones» del menú y su regla). Por qué: el rastro (RASTRO) le da a la policía al ladrón sólo unos segundos y
  después una zona que crece; un dron que reconoce desde arriba lo volvía permanente. Y ya estaba medido que un dron
  valía menos que un policía en la calle (los bots no se sentaban).
- La cámara libre del 3D (V, «Dron · 28 m») no es del juego: queda sólo en el laboratorio (?lab=1) y para las pruebas que
  miden la ciudad desde arriba (validar-3d). validar-dron salió del probador.
- Lo viejo, en before/dron/ (partida.js y bots.js con el dron, y validar-dron.mjs). engine/game.js (el motor anterior,
  «Golpes») no se tocó: no es el del juego.

## La gente, pareja de policía (2026-10-18)

- Miguel: «los npc siguen moviéndose entrecortado, como si se teletransportaran» (ciudad 95728, de policía). Medido en el
  3D: de policía, la gente se ubicaba con el reloj del motor de los bots (persec.P.t), que avanza de a MODO_BOTIN.tick
  (0,25 s): el 92 % de los cuadros quieta y el resto a 5–20 m/s. De ladrón el reloj es continuo y andaba bien.
- Arreglo: el reloj de policía es continuo (persec.tiempo = P.t + lo que va del paso); los bots del motor se dibujan entre
  su paso anterior y el actual (antes los seguía un resorte y su animación salía de lo que les faltaba: tirones y a veces
  «corriendo»). Después: p50 1,3 m/s, p99 2,1, saltos 0 % (igual que de ladrón).
- No hizo falta bajar la población. Validador: scripts/validar-fluidez.mjs (nivel 10, los dos papeles); con el reloj viejo
  da 4 fallas (11,7 m/s de p50, 10 % de saltos).

