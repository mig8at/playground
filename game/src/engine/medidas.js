/* El catálogo de medidas (2026-10-15): todo lo que mide algo en la ciudad, en metros, en UN lugar. El plano
   (blueprint.js) calcula con esto y el validador (scripts/validar-ciudad.mjs) compara contra los MÍNIMOS. La idea:
   la ciudad sale exacta del cálculo, se valida sin abrir el 3D, y el 3D sólo dibuja lo que el plano ya resolvió.

   Primer paso: los valores son los que el código usa HOY (no cambia nada). Todavía hay copias que no leen de acá
   —el 3D tiene las suyas—; cada una se anota en «copias» para ir pasándolas al catálogo. */

// ======== NIVEL 1: EL CUERPO (2026-10-15) ========
// Todo lo demás se mide desde acá: cuerpo → muebles → cuartos → edificio → lote → mundo. En MILÍMETROS enteros (las
// comparaciones son exactas; los metros, con coma, daban fallas de 15 cm que eran redondeo). mm(x) pasa a metros.
export const mm=x=>x/1000;
// Medido en /demo (ciudad 83552) sobre los vértices ya deformados por el esqueleto, en la pose de parado y caminando:
// el muñeco del jugador 1.810 de alto; la gente de la calle de 1.392 a 1.782, de 522 a 677 de ancho de torso con los
// brazos y hasta 713 de fondo al caminar. El cuerpo de DISEÑO es el más grande: lo que le alcanza a él le alcanza a todos.
export const CUERPO={alto:1810,ancho:680,fondo:720,ojos:1750,
 radioChoque:260};// el círculo con que choca el juego (DemoView RADIUS): más chico que el cuerpo, los brazos asoman ~6 cm
// La ergonomía, derivada del cuerpo (las holguras son lo único que se elige):
const HOLGURA=60;// a cada lado, para no rozar
export const ERGO={
 holgura:HOLGURA,
 paso:CUERPO.ancho+2*HOLGURA,                // 800: pasar de frente entre dos cosas
 pasoDeCostado:CUERPO.fondo/2+HOLGURA*2,     // 480: pasar de costado (entre la cama y la pared, por ejemplo)
 alturaLibre:CUERPO.alto+290,                // 2.100: sobre la cabeza (escaleras, bajo losas, dinteles)
 usoFrente:CUERPO.fondo,                     // 720: delante de un armario, una nevera, un inodoro (pararse y abrir)
};
// El cuerpo de la prueba de movimiento de los cuartos (blueprint RB, minRoom y el amueblado): medio paso, 400 (decisión de
// Miguel, 2026-10-15: el cuerpo real con holgura). Antes 280 (= el radio de choque + 20), 12 cm más angosto que el muñeco.
ERGO.radioPrueba=ERGO.paso/2;

// ======== LA CIUDAD: estándares urbanos (2026-10-15, investigados; fuentes al lado de cada número) ========
// La calle (m). Vereda: paso libre 1,8 (6 ft: Minneapolis/Portland, siguiendo a NACTO), franja de fachada 0,6 (2 ft:
// Seattle) y franja de mobiliario —postes, faroles— 0,6; carril urbano 3 (10 ft: NACTO). Calle = 2 casillas = 12 m
// (vereda 3 + 2 carriles + vereda 3); avenida = 3 casillas = 18 m (vereda 3 + 4 carriles + vereda 3).
export const CALLE={paso:1.8,fachada:.6,mobiliario:.6,vereda:3,carril:3,calle:{casillas:2,carriles:2},avenida:{casillas:3,carriles:4}};
// El tramo recto máximo de un carril antes de un remate (glorieta, monumento, fuente): ~70 m, lo que pide el Manual for
// Streets (UK, 2007) para calles de 30 km/h (por fuentes secundarias: verificar con la publicación). Cierra la vista
// de punta a punta sin cortar el paso.
CALLE.tramoMax=72;
// El encierro de la calle: alto de los edificios / ancho entre fachadas. La mayoría de las guías pide entre 1:3 y 1:1
// (Ottawa, Surrey Healthy Streets, Urban Design Compendium; 1:1 en los centros); más ancho «parece una pista», más
// angosto, claustrofóbico. Acá: de 1/3 a 1, y hasta 1,5 en el centro.
export const ENCIERRO={min:1/3,max:1,centro:1.5};
// El centro de la ciudad (donde vale ENCIERRO.centro): los lotes a menos de esta fracción de la mitad del lado mayor del mapa.
ENCIERRO.radioCentro=.35;
// El perfil de altura de una manzana (fracción del tope de su calle que usan sus edificios: baja, media, alta) y el salto
// máximo de pisos entre dos vecinos (una transición de altura, no un acantilado).
ENCIERRO.perfiles=[.55,.8,1];ENCIERRO.salto=2;
// La manzana (lado, m): 80–90 ideal para caminar, entre 40 y 120 (Wakefield District Design Code B3.2.2).
export const MANZANA={min:40,ideal:[80,90],max:120};
// La manzana del monte (2026-10-15): dos mitades, cada una con casas armadas (vivienda.js) de frente a su calle. La mitad:
// retiro de la calle + el fondo de la casa más honda + patio de atrás, redondeado a casillas. casaFondo: medido con
// scripts/medir-casas.mjs (400 casas: mediana 11,05, máximo 12,5); si cambian las casas, se vuelve a medir.
MANZANA.monte={retiro:2.5,casaFondo:12.5,patio:3};
// ======== INTERIORES (UK Nationally Described Space Standard, 2015; cocina: triángulo de trabajo) ========
// Alcoba simple ≥ 7,5 m² y 2,15 de ancho; doble ≥ 11,5 m², la principal ≥ 2,75 de ancho y las otras dobles ≥ 2,55.
// Cocina: del lavaplatos a la estufa y a la nevera, cada lado 1,2–2,7 m y los tres juntos 3,7–7,9 (NKBA, por fuentes
// secundarias: verificar con la publicación).
export const INTERIOR={alcobaSimple:{m2:7.5,ancho:2.15},alcobaDoble:{m2:11.5,anchoPrincipal:2.75,ancho:2.55},triangulo:{lado:[1.2,2.7],total:[3.7,7.9]}};

// La grilla: casillas de 6 m; las fachadas, en módulos de 2 m desde la esquina del lote (ventanas, puertas de calle y
// vitrinas caen en un módulo entero; por eso los anchos de cuartos y del núcleo van en metros pares).
export const GRILLA={casilla:6,modulo:2};

// Alturas de un edificio de la ciudad.
export const ALTURA={piso:3,cieloRaso:2.9,losa:.12,vano:mm(ERGO.alturaLibre),libre:mm(ERGO.alturaLibre)};// libre: lo mínimo sobre la cabeza (escaleras, bajo losas)

// Paredes (grosor total). La fachada se come hacia adentro del lote; el tabique va centrado en su línea.
export const MURO={fachada:.25,tabique:.12,medianera:.12};

// Vanos de puerta (largo en la pared; la luz libre es el largo menos los marcos).
export const PUERTA={cuarto:1,calle:1.1,ascensor:1.4,marco:.08,
 // (la de la escalera va a lo ancho de sus dos tramos: el ancho de la escalera menos 20 cm)
 escalera:ancho=>ancho-.2,
 // (la puerta de calle doble, 2026-10-16, Miguel: «para los comercios y en algunos lugares puertas dobles o más grandes»: dos
 // hojas de 0,9 —pasan dos personajes a la vez, en la persecución—, en el módulo de 2 m de la fachada con 0,1 a cada lado;
 // en los lotes de tipos. Las viviendas y las casas, la sencilla, calle)
 // (y la de un local —una tienda— en cualquier edificio: los de la planta baja de las viviendas también)
 // (2026-10-16, Miguel: «todavía hay comercios con puertas pequeñas»: la entrada de todo edificio es doble —la del
 // vestíbulo de una vivienda, con vidriera, se leía como un local—; la sencilla, sólo las casas —excepto—)
 doble:{ancho:1.8,excepto:['casa']},
 // Qué puertas llevan hoja (2026-10-16, Miguel: «en baños y lugares privados como dormitorios vale la pena puertas, en
 // cocina, sala y comedor no»): la de un cuarto privado, la de una unidad (de la circulación común al departamento, la
 // oficina o el local) y la de calle; las demás —entre espacios sociales, la escalera, el núcleo, los cuartos abiertos al
 // pasillo— son un vano abierto.
 hoja:{privados:['dormitorio','habitacion','habitacion_h','bano','sanitario','vestuario','deposito','boveda','celda','interrogatorio','evidencia','oficina','reuniones','secretaria','archivo','consultorio','enfermeria','aula','sala_prof','ropas'],
  comunes:['pasillo','vestibulo','nucleo','escalera','calle'],abiertos:['abierta','recepcion','lectura','prestamo','estanteria','comedor','urgencias']},
 // Las hojas que quedan abiertas del todo (2026-10-16, Miguel: «dejemos abiertas puertas como las del cuarto y una que otra
 // del baño, para que sea más fácil movilizarse»): las de los dormitorios siempre y la de un baño de cada tres (por sorteo
 // fijo de la puerta), si al abrirse la hoja no da contra un mueble (el cuarto de giro: el ancho del vano de lado, hacia
 // adentro). Las demás se abren solas al acercarse, como antes.
 abierta:{siempre:['dormitorio','dormitorio_b','habitacion','habitacion_h'],aVeces:{bano:1/3}}};
export const VENTANA={largo:1.8};
// La columna de las esquinas (2026-10-16, Miguel: «la decoración de columna de los edificios oculta las ventanas»): un
// pilar cuadrado de lado m que sale hacia afuera de la esquina y se mete sólo dentro m en cada fachada —el vidrio más
// cercano a una esquina, el de la vidriera de piedra, empieza a 0,06 m de ella—. Lo comprueba
// validar-fachada3d contra el vidrio de cada ventana que puede tocar a cada estilo.
export const COLUMNA={lado:.42,dentro:.03};
// Las cortinas cerradas (2026-10-16, Miguel: «cortinas cerradas en algunas casas y negocios, como decoración, y que tapen
// los interiores vacíos que se ven de lejos» —los muebles sólo se dibujan a menos de 15 m—). Por unidad (un departamento,
// una oficina, un cuarto de hotel; una casa del monte): la parte que las tiene cerradas, según el tipo del edificio, en
// los cuartos de cuartos; las telas, de colores enteros que se lean de lejos contra la fachada. El paño cubre todo el
// vidrio posible de su ventana: hasta panio.ancho (el módulo de fachada) y de panio.bajo a panio.alto sobre el piso
// (el vidrio más alto del paquete va de 0,06 a 2,70: Metal_FullWindow).
export const CORTINA={cerradas:{vivienda:.3,hotel:.35,oficinas:.25,comercio:.2,casa:.3,monte:.3},
 cuartos:['sala','dormitorio','dormitorio_b','habitacion','habitacion_h','estudio','sala_cocina','comedor','infantil','consultorio','oficina','reuniones','secretaria'],
 telas:['#e9dcc3','#c2604a','#5d7fa6','#7f9c6c','#d8b04a','#8a5a7a','#3f4a5c'],panio:{ancho:2,bajo:.02,alto:2.78,margen:.1}};
// El vidrio de cada pieza de fachada (m²), MEDIDO en los glTF del paquete (partes con material MI_Glass, pieza a 2 m de
// módulo; 2026-10-15). En el 3D (town3d.js): planta baja, la vidriera de la familia; primer piso, ventana1; del segundo
// para arriba, ventana (fachada.js WINDOWS / FAMILIES). Las de 4 m (doble) se cuentan como dos simples.
export const VIDRIO={ventana:{ventanal:1.5*1.8,clave:.99*2.01,moldura:.45*1.30,cuadrada:.44*1.24,piedra:.99*1.07,vidrio:1.81*2.64,media:1.81*2.64},
 vidriera:{ladrillo:1.81*2.43,metal:1.81*2.43,piedra:1.89*2.23}};
// Las ventanas a las que puede subir cada familia de fachada si a un cuarto le falta luz (de menos a más vidrio), para
// no mezclar materiales: ladrillo y piedra con sus molduras; metal con vidrio.
export const VENTANAS_FAMILIA={ladrillo:['cuadrada','moldura','clave'],piedra:['cuadrada','piedra','clave'],metal:['media','vidrio']};
// Donde se vive (2026-10-18, FACHADAS.md A2: el muro cortina de «metal» dejaba ver cada cuarto de un edificio de vivienda
// u hotel): ventanas con antepecho opaco, a lo sumo VIDRIO_VIVIENDA del módulo de fachada (2 × 3 m); las de vidrio entero
// (vidrio, media) pasan a éstas y la luz que falte se busca entre ellas. El ventanal (fachada3d VENTANAL): 1,5 m de ancho
// con antepecho de 0,9 m y vidrio hasta 2,7 —el 45 % del módulo—, para la sala grande que con la de piedra clave no llega.
export const RESIDENCIAL=new Set(['vivienda','hotel','casa']);
// (FACHADAS.md A1) donde se vive en la planta baja: ahí la vidriera va sólo en un local (en las oficinas, el hospital o el
// lobby del hotel la planta baja vidriada es lo normal y es su luz). esVidriera: la ventana de planta baja que el 3D
// dibuja como vidriera.
export const VIVE_EN_PLANTA_BAJA=new Set(['vivienda','casa']);
export const esVidriera=(tipo,w)=>!!w.shop||!VIVE_EN_PLANTA_BAJA.has(tipo);
export const VENTANAS_VIVIENDA=['piedra','clave','ventanal'],VIDRIO_VIVIENDA=.45,VIDRIO_ENTERO=new Set(['vidrio','media']);
// Los cuartos donde se vive o se trabaja: necesitan luz natural (MINIMO.luz); los baños y cocinas pueden ventilar con
// extracción.
export const HABITABLE=new Set(['dormitorio','dormitorio_b','sala','sala_cocina','estudio','habitacion','habitacion_h','oficina','abierta','reuniones','aula','consultorio','sala_prof','lectura','comedor','recepcion','enfermeria','secretaria']);

// La escalera en U del núcleo (ver blueprint.js layoutFloor y town3d.js stairOf/stairBoxes).
export const ESCALERA={ancho:4,anchoAngosta:2,peldanos:9,huella:.28,umbral:.1,ascensor:2,fondoNucleo:4};
// Lo más lejos que puede quedar la escalera de una punta del pasillo (elegido: con 16 m, el recorrido más largo dentro de
// un departamento entra en los 45 de MINIMO.evacuacion; lo comprueba validar-ciudad).
ESCALERA.pasilloMax=16;

// Circulación. hall: el de las alcobas de un departamento (en la grilla de 0,5 m: 1,5 deja 1,38 libres). ancho: el
// pasillo de un edificio, derivado (2026-10-15): MINIMO.pasillo libre + un tabique, en la grilla de 0,5 → 1,5 (antes 2).
// (2026-10-16, Miguel: «los pasillos en algunos lugares son muy estrechos»: con la norma —1,2 libres— no alcanza para el
// juego: la cámara va detrás del personaje y un policía tiene que poder pasar a un ladrón. JUEGO_PASO: el ancho libre que
// pide el juego —dos personajes de 2·0,26 m que se cruzan con 0,35 de holgura por lado y al medio, en un edificio (1,8);
// en una casa, uno que camina con la cámara detrás (1,3)—. ancho: 1,8 libres + un tabique, en la grilla de 0,5 → 2.)
export const JUEGO_PASO={edificio:1.8,casa:1.3};
export const PASILLO={ancho:2,hall:1.5};
// Las franjas de un departamento, derivadas de los cuartos (scripts/derivar-edificio.mjs, 2026-10-15): la interior
// (junto al pasillo) lleva el baño completo (2,25) y el hall (1,2 libres) → 2,5; la de fachada, lo que piden de fondo
// alcobas y sala (≤ 3,25) → 3,5. Juntas, 6 m: una casilla (antes 4 + 2).
export const FRANJA={interior:2.5,fachada:3.5};

// Los mínimos contra los que se valida (normas de vivienda y de edificios públicos; redondeados).
export const MINIMO={
 luzPuerta:.8,       // luz libre de una puerta interior
 luzPuertaCalle:.9,  // de una puerta de calle
 pasillo:1.2,        // ancho libre de un pasillo
 hall:1.2,           // ancho libre del hall de un departamento
 cuarto:1.5,         // el lado menor de un cuarto habitable
 bano:1.2,           // el lado menor de un baño
 tramo:1,            // ancho libre de un tramo de escalera
 resto:.15,          // un tramo de pared más corto que esto es una astilla (sobra de un corte)
 proporcion:2,       // lo más alargado que puede ser un cuarto habitable (lado largo / lado corto, libres)
 luz:1/8,            // vidrio / piso de un cuarto habitable (iluminación natural)
 evacuacion:45,      // m: lo más lejos que puede quedar un punto de un cuarto de la escalera (o de la calle en planta
                     // baja), caminando por las puertas (normas de evacuación, sin rociadores: 30–45 m)
 aPuerta:.04,        // de la punta de un vano a la cara de una pared que le llega de costado: medio marco (si no, el
                     // marco se mete en la pared). El plano pone las puertas a 10 cm del eje: quedan justo en 4 cm.
};

// Dónde siguen copiadas estas medidas sin leer de acá (pendientes de pasar al catálogo).
export const copias={
 'MURO.tabique / MURO.fachada':'lib/town3d.js THIN, WALL_T, FACE',
 'ALTURA.piso / ALTURA.cieloRaso':'lib/world3d.js FLOOR, CEIL',
 'ALTURA.vano':'lib/town3d.js (yb+2.1, dinteles)',
 'PUERTA.*, VENTANA.largo':'engine/blueprint.js openings() (números sueltos)',
 'casas':'engine/vivienda.js y lib/island3d.js tienen su propio juego (piso 2,8 m, muro 0,2, puerta 2,2 m)',
};

// El fondo máximo de una franja que se puede iluminar (2026-10-15): con una ventana por módulo de 2 m, un cuarto recibe
// como mucho (vidrio de la ventana)/2 m² por metro de fachada y la luz pide fondo × MINIMO.luz: fondo ≤ vidrio/2/luz. Con
// la ventana más grande de ladrillo y piedra (1,99 m²): 7,96 → 7,5 en la grilla de 0,5. Más hondo, ninguna ventana alcanza.
FRANJA.maxLuz=Math.floor(Math.min(...Object.values(VENTANAS_FAMILIA).map(f=>Math.max(...f.map(k=>VIDRIO.ventana[k]))))/2/MINIMO.luz*2+1e-9)/2;

// ======== EL JUEGO: rangos que el generador garantiza (2026-10-15) ========
// robables: los edificios que se roban (plano.js); puertasRobable: las puertas de calle mínimas de cada uno —con una sola,
// robarlo es meterse en una trampa—.
// parques (2026-10-17): la ciudad que se juega lleva manzanas de parque repartidas (DemoView ?parques=0 las saca). Antes
// el 3D las ponía y el generador, por defecto, no: el probador medía otra ciudad que la que se camina (lo encontró
// validar-salto: los pisos de los lotes no coincidían con la misma semilla). Ahora es el defecto de generateBlueprint.
export const JUEGO={parques:true,robables:['objetivo','oficinas','comercio'],puertasRobable:2,
 // (2026-10-16) La escala del motor en metros: su velocidad de ladrón (game.js DEFAULTS.thiefSpeed) es la de caminar del
 // 3D (DemoView WALK, 5,2 m/s); las demás velocidades del motor se escalan igual. El equilibrio (scripts/medir-equilibrio.mjs)
 // compara la ventana de fuga del ladrón con la respuesta de la policía, a pie y en patrulla por la red de carriles.
 caminar:5.2};
// La ladera urbanizada (2026-10-15): la franja del monte junto a la ciudad, en terrazas por curvas de nivel. Las calles de
// ======== Las terrazas del monte (2026-10-16, Miguel: «que las manzanas de la montaña no desbasten tanto la montaña
// sino que la escalonen a un grado máximo, y las calles con un máximo, para mantener la estética del mundo») ========
// mover: lo más que se corta o se rellena la montaña natural en un punto (una terraza, una calle, el rebaje de alrededor);
// escalon: el muro de contención entre las dos mitades de una manzana (cada mitad va a la altura de su calle); acceso: lo más que una terraza queda por encima o por debajo de la calle a la que da (unos peldaños);
// pendiente: la de una calle (%). Validadas en validar-terrazas. De acá sale la ladera (LADERA): la manzana sube, de su calle
// de abajo a la de arriba, un acceso, un muro y otro acceso.
// (2026-10-16, segunda vuelta: escalon 6 —dos pisos, «escalones más empinados para no desbastar tanto»— y calles hasta
// 13 %. Medido contra la montaña sin pie de monte, 4 ciudades: con 1,5 m de muro la ladera iba al 8 %; con 4,5 —el de
// antes— a 9,4 % (diferencia mediana 11,6 m, 2,3 millones de m³ por ciudad); con 6, a 12,5 % (9,4 m, 2,0 millones), con las
// mismas 20 manzanas por ciudad; con 7,5 casi no quedan manzanas. mover 4: con 3, nueve manzanas perdían una mitad —el
// terreno de la mitad de abajo sube hasta 3,7 m sobre su calle— y validar-mundo las marcaba angostas.)
// pendiente 20 (2026-10-16, medido sin pantalla —validar-huecos—): la calle sube su muro de 6 m en lo que no es cruce —48 m
// menos el tramo plano de cada punta, medio ancho de la calle más ancha que llega: 36 m (16,7 %) entre calles, 30 m (20 %)
// junto a una avenida—; antes el 2D medía de cruce a cruce (12,5 %) y no lo veía. Con 17 % se caían la mitad de las
// manzanas (76 → 36). Con muros de 4,5 m —los de antes— alcanzaría 17 % (12,5–15 %, 77 manzanas).
export const TERRAZA={mover:4,escalon:6,acceso:1.2,pendiente:20};
// la ladera son anillos alrededor de la ciudad (líneas paralelas al muro) a nivel; entre dos anillos, una manzana de dos
// medias manzanas, cada una a la altura de su calle, con UN muro de contención entre las dos. De ahí todo:
//   mitad = retiro + casa + patio en casillas (18) · paso = calle + 2·mitad (48) · el primer anillo a 2·mitad + calle/2 del
//   muro (42: la primera fila de manzanas va pegada a la circunvalación) · muro = 1,5 pisos (4,5 m) · pendiente = muro/paso
//   (9,4 %: la natural junto a la ciudad es 9 %, así se corta lo menos; las calles que suben quedan en 9,4 %).
// Anillos: 3 (42, 90 y 138 m): más allá la ladera natural pasa del 30 % (medido: mediana 29 % a 68–92 m y 33–36 % después),
// y ahí no se construye. desde: dónde empieza a subir (la franja verde junto al muro); talud: en cuánto vuelve a la natural.
export const LADERA=(()=>{const M=MANZANA.monte,mitad=Math.ceil((M.retiro+M.casaFondo+M.patio)/6-1e-9)*6,calle=CALLE.calle.casillas*6,paso=calle+2*mitad,muro=1.5*ALTURA.piso;// (el de antes; ahora TERRAZA.escalon)
 const primero=2*mitad+calle/2,anillos=3;
 // (2026-10-16, Miguel: «escalonar la montaña»: cada mitad de manzana a la altura de su calle y entre las dos UN muro de
 // TERRAZA.escalon; la manzana sube eso de su calle de abajo a la de arriba. Probado y descartado el mismo día: cada mitad
 // a 1,2 m de su calle hacia la otra, con un muro de 1,5 —la de arriba quedaba hundida bajo su calle: «salen como huecos»—)
 const sube=TERRAZA.escalon;
 return {mitad,calle,paso,muro:TERRAZA.escalon,sube,pendiente:sube/paso,primero,anillos,fin:primero+(anillos-1)*paso+calle/2,desde:20,talud:60,ondula:.6};})();
// La escalinata del eje (2026-10-15): la calle peatonal que sigue al eje más arriba de la ladera urbanizada, por la montaña
// natural, hasta un mirador. Peldaño exterior: contrahuella 15 cm y huella 33 (2C+H = 63, la regla de Blondel), un descanso
// de 1,2 m cada 12 peldaños: sube 1,8 m en 5,16 m → pendiente media 35 % (19°); donde el monte es más empinado, termina.
// ancho: una casilla. El mirador: una plaza de 3×3 casillas a nivel, donde termina.
export const ESCALINATA=(()=>{const c=.15,h=.33,n=12,descanso=1.2;return {contrahuella:c,huella:h,peldanos:n,descanso,blondel:2*c+h,pendiente:n*c/(n*h+descanso),ancho:6,mirador:3};})();
// ======== VEGETACIÓN (2026-10-15) ========
// Árbol de calle: en un alcorque de 1,2 m junto al cordón (la vereda de CALLE.vereda deja 1,8 de paso libre detrás);
// cada 8 m en las calles y cada 12 m —árboles grandes— en las avenidas (6–12 m según el tamaño del árbol: Stamford CT,
// NC Forest Service), a ≥ 9 m de la esquina (20–40 pies: Lexington MA, NC, Nueva York) y a ≥ 1,5 m de una puerta.
// Alameda (el borde verde): dos filas, cada 8 m. Parques: 30 % de copa (la regla 3-30-300, Konijnendijk 2023: 3 árboles a
// la vista de cada vivienda, 30 % de copa por barrio, ≤ 300 m a un espacio verde). Monte natural: bosque disperso.
// Palmeras: cada 10 m en el paseo de la playa (Honolulu: 3 cada 100 pies) y en grupos sobre la arena.
// Sombrillas: a 4 m entre sí (Grecia 2020), filas paralelas al muro, ≥ 5 m libres desde el agua (Cerdeña) y un paso de
// 10 m cada 100 m (Pattaya).
export const VEGETACION={
 alcorque:1.2,esquina:9,puerta:1.5,vidriera:.15,
 // (las copas contra las fachadas, 2026-10-16, Miguel: «cortar la intersección entre casas y edificios con los árboles»:
 // ninguna copa a menos de holgura m de un edificio o una casa. En calles y avenidas la copa se poda del lado de la fachada
 // —como se hace en las calles de verdad—: queda un óvalo, angosto hacia el edificio y como mucho poda veces más largo a lo
 // largo de la calle; en lo demás se achica hasta copaMin, y si ni así cabe, no se planta)
 poda:{holgura:.5,largo:2,copaMin:1.5},
 // (la copa de un árbol de calle, igual al espaciado: dosel continuo sobre la vereda —un árbol mediano maduro, 8 m; uno
 // grande en las avenidas, 12—; con copas menores la ciudad quedaba en 10 % de copa)
 calle:{espaciado:8,copa:4},avenida:{espaciado:12,copa:6},alameda:{espaciado:8,copa:4,filas:2},jardin:{copa:[2,3],cobertura:.3,separacion:5,casa:1},
 // (armonía, 2026-10-16: el monte natural no es una plantación —crece en manchones con claros— y un parque alterna
 // arboledas con prado abierto. bosque.manchon: un campo suave de escala m que decide dónde hay bosque; donde pasa de
 // umbral, la densidad crece hasta denso veces la de base y los árboles se juntan hasta separacion[0]. parque.arboledas:
 // una cada m2 de parque, con los árboles alrededor de su centro a radio m (normal).)
 parque:{copa:[3,4.5],cobertura:.3,separacion:6,arboledas:{m2:350,radio:4.5,separacion:4}},
 bosque:{copa:[2.5,4],separacion:[5,8],densidad:.55,manchon:{escala:36,umbral:.35,ancho:.35,denso:2},
  // los pisos del monte (2026-10-16, a la manera de los pisos térmicos andinos, pero por altura RELATIVA: la isla sube
  // decenas de metros, no miles): abajo los de tierra templada y los pioneros (cedro, yarumo), en el medio el robledal
  // (roble andino, pino colombiano), arriba el bosque alto (encenillo, pino colombiano). hasta: la fracción de la altura
  // del bosque; borroso: lo que se corre el límite (al azar suave), para que no sea una raya. Cada manchón, una especie
  // dominante de su piso (otro campo suave, de escala m).
  pisos:{bandas:[{hasta:.33,especies:['cedro','yarumo']},{hasta:.66,especies:['roble','pino_colombiano']},{hasta:1,especies:['encenillo','pino_colombiano']}],borroso:.08,escala:30,dominio:.7}},
 // (la armonía medida —el validador de vegetación—: el bosque en manchones —dispersión por cuadrantes de cuadrante m ≥
 // dispersion: 1 es al azar, < 1 una plantación— con claros entre claros[0] y claros[1]; las sombrillas vecinas —a ≤
 // vecinas m— de otra tela, ≤ telas)
 // (sombrillas alineadas: de los pares de vecinas a ≤ 6 m, las que comparten x o z —±0,2 m—: en filas eran todas)
 armonia:{cuadrante:24,dispersion:1.5,claros:[.1,.4],vecinas:4.5,telas:.1,alineadas:.15,
  // los parques: arboledas (grupos de ≥ 3 árboles a ≤ grupo veces el radio de una arboleda, parque.arboledas.radio) con al
  // menos arboleda de sus árboles, y prado abierto (sin copa encima) entre prado[0] y prado[1] del parque
  parque:{grupo:2,arboleda:.7,prado:[.5,.85]}},
 palmera:{espaciado:10,copa:2.5,grupo:[2,4],separacionGrupos:18},
 // (arena: dónde es playa de verdad, por el TERRENO —el mismo que dibuja el 3D—, no sólo por la casilla: entre 0,1 y 2 m
 // sobre el agua y a ≥ 2 m del borde de la isla. Sin esto, el 3D ponía sombrillas en el vacío y en lomas de 15 m.)
 // (las telas: un color por concesión —cada tramo de .cada m entre dos pasos libres—, como en una playa de verdad)
 // (el reparto, 2026-10-16, Miguel: «muy perfectamente alineadas»: al azar —Poisson: dardos por casilla de arena, con
 // espaciado mínimo entre mástiles—, más densas cerca del agua: hasta lleno m del agua todas, y de ahí la probabilidad
 // baja hasta minimo a vacio m)
 sombrilla:{espaciado:4,radio:1.1,agua:5,paso:10,cada:100,telas:['#e46a4a','#2e86de','#f2c81f','#27ae60','#e84393','#ffffff'],
  reparto:{dardos:30,lleno:30,vacio:80,minimo:.15}},arena:{alto:[.1,2],borde:2},
 // el tronco (diámetro a 1,3 m, el DAP): en un árbol urbano maduro la copa mide unas 20 veces el DAP (una copa de 8 m, un
 // tronco de 40 cm); las palmas, el suyo: coco 30 cm, palma real 50.
 tronco:{copaPorDap:20,palma:{coco:.3,palma_real:.5},alto:1.3},
 regla3_30_300:{vista:3,radioVista:30,cobertura:.3,verde:300}};
// Las especies (2026-10-15): árboles de arbolado urbano de Colombia, con el color del follaje y el de la flor (null: sin
// flor vistosa). usos: dónde va cada una. Diversidad: la regla 10-20-30 (Santamour 1990): en el arbolado de la ciudad
// —todo menos el bosque—, ninguna especie pasa del 10 %, ningún género del 20 % y ninguna familia del 30 %. Cada calle,
// una especie (la calle se lee como una unidad); se elige la que menos empuja esos topes. El flamboyán sólo en parques:
// sus raíces rompen veredas y redes (Revista Nodo, 2010).
VEGETACION.diversidad={especie:.1,genero:.2,familia:.3};
VEGETACION.especies=[
 {id:'guayacan_amarillo',nombre:'Guayacán amarillo',genero:'Handroanthus',familia:'Bignoniaceae',follaje:'#5c8a3a',flor:'#f2c81f',usos:['avenida','calle','parque']},
 {id:'guayacan_rosado',nombre:'Guayacán rosado (ocobo)',genero:'Tabebuia',familia:'Bignoniaceae',follaje:'#5a8a3c',flor:'#ee8fbd',usos:['avenida','calle','alameda','parque','jardin']},
 {id:'jacaranda',nombre:'Jacarandá',genero:'Jacaranda',familia:'Bignoniaceae',follaje:'#5b8f45',flor:'#8f6fd0',usos:['avenida','calle','alameda','parque','jardin']},
 {id:'sietecueros',nombre:'Sietecueros',genero:'Tibouchina',familia:'Melastomataceae',follaje:'#4f7d3a',flor:'#7a3fb8',usos:['calle','jardin','parque']},
 {id:'guayacan_manizales',nombre:'Guayacán de Manizales',genero:'Lafoensia',familia:'Lythraceae',follaje:'#6a9a48',flor:null,usos:['calle','alameda']},
 {id:'almendro',nombre:'Almendro',genero:'Terminalia',familia:'Combretaceae',follaje:'#5f9142',flor:null,usos:['avenida','calle','alameda']},
 {id:'arrayan',nombre:'Arrayán',genero:'Myrcianthes',familia:'Myrtaceae',follaje:'#4f7d3a',flor:'#f4f1e2',usos:['calle','jardin']},
 // (2026-10-15: tres más para las calles —calles, avenidas y alameda son el 70 % del arbolado de la ciudad: con 7
 // especies de calle, cada una tenía que estar justo en el 10 % y una calle larga lo pasaba—)
 {id:'mamoncillo',nombre:'Mamoncillo',genero:'Melicoccus',familia:'Sapindaceae',follaje:'#4a7f37',flor:null,usos:['calle','alameda','jardin']},
 {id:'oiti',nombre:'Oití',genero:'Licania',familia:'Chrysobalanaceae',follaje:'#557f3a',flor:null,usos:['avenida','calle','alameda']},
 {id:'matarraton',nombre:'Matarratón',genero:'Gliricidia',familia:'Fabaceae',follaje:'#5c8f40',flor:'#e79ac4',usos:['calle','jardin']},
 {id:'camburo',nombre:'Cámbulo',genero:'Erythrina',familia:'Fabaceae',follaje:'#5a8c3e',flor:'#ec6a2c',usos:['alameda','parque']},
 {id:'flamboyan',nombre:'Flamboyán',genero:'Delonix',familia:'Fabaceae',follaje:'#5d9440',flor:'#d8322a',usos:['parque']},
 {id:'saman',nombre:'Samán',genero:'Samanea',familia:'Fabaceae',follaje:'#557f34',flor:null,usos:['parque','alameda']},
 {id:'caucho',nombre:'Caucho sabanero',genero:'Ficus',familia:'Moraceae',follaje:'#3e6a30',flor:null,usos:['parque']},
 {id:'naranjo',nombre:'Naranjo',genero:'Citrus',familia:'Rutaceae',follaje:'#4f8a3c',flor:'#f39c12',usos:['jardin']},
 {id:'mango',nombre:'Mango',genero:'Mangifera',familia:'Anacardiaceae',follaje:'#3f6e2f',flor:null,usos:['jardin']},
 {id:'aguacate',nombre:'Aguacate',genero:'Persea',familia:'Lauraceae',follaje:'#3d6a33',flor:null,usos:['jardin']},
 {id:'guayabo',nombre:'Guayabo',genero:'Psidium',familia:'Myrtaceae',follaje:'#5b8b40',flor:null,usos:['jardin']},
 {id:'limonero',nombre:'Limonero',genero:'Citrus',familia:'Rutaceae',follaje:'#5a9442',flor:'#f6ec8a',usos:['jardin']},
 {id:'roble',nombre:'Roble andino',genero:'Quercus',familia:'Fagaceae',follaje:'#4a7a3c',flor:null,usos:['bosque']},
 {id:'yarumo',nombre:'Yarumo',genero:'Cecropia',familia:'Urticaceae',follaje:'#9db39a',flor:null,usos:['bosque']},
 {id:'encenillo',nombre:'Encenillo',genero:'Weinmannia',familia:'Cunoniaceae',follaje:'#5f8b45',flor:'#b5523b',usos:['bosque']},
 {id:'pino_colombiano',nombre:'Pino colombiano',genero:'Podocarpus',familia:'Podocarpaceae',follaje:'#3a5d33',flor:null,usos:['bosque']},
 {id:'cedro',nombre:'Cedro',genero:'Cedrela',familia:'Meliaceae',follaje:'#557f3b',flor:null,usos:['bosque']},
 {id:'coco',nombre:'Palma de coco',genero:'Cocos',familia:'Arecaceae',follaje:'#2f7d4a',flor:null,usos:['palmera']},
 {id:'palma_real',nombre:'Palma real',genero:'Roystonea',familia:'Arecaceae',follaje:'#3a8a52',flor:null,usos:['palmera']}];
// ======== EQUIPAMIENTO URBANO (2026-10-15) ========
// Faroles: 6 m en las calles, alternados de vereda a vereda, cada 5,5 alturas por lado (33 m: Eugene OR, 20 pies → ~110);
// 9 m en las avenidas, 60 m por lado (Phoenix: 200–250 pies); 4 m en la alameda y el paseo, cada 20 m. A 0,5 m del cordón
// y a ≥ 3 m del tronco de un árbol (se corren hasta 5 m para lograrlo).
// Pasos de cebra: 3 m de ancho (Arizona: 10 pies) en cada brazo de cada cruce, con la línea de pare 1,25 m atrás
// (Massachusetts). Semáforos en los cruces con avenida: uno por brazo, en la vereda a su derecha.
// Paradas de bus: toda vivienda a ≤ 400 m de una (Hong Kong, NZTA, Dublín), a ≥ 250 m entre sí; refugio de 3 × 1,5 m.
// Hidrantes: en los cruces y donde haga falta para que ningún edificio quede a más de 75 m (St. Albert AB: 75 m; 120 m
// entre hidrantes en zonas densas).
// Bancas: cada 100 m en la alameda (100–125 m para personas mayores) y cada 50 m en el paseo de la playa; en parques y
// plazas, una cada 300 m²; con 0,9 m libres en una punta (Helsinki) y una papelera al lado.
// apoyo: lo más que el suelo puede subir o bajar bajo una esquina de un objeto de base plana (banca, kiosco…) respecto de su
// centro: más, una esquina flota o se hunde (2026-10-16, validar-oclusion)
export const EQUIPAMIENTO={apoyo:.05,
 farol:{alto:6,separacion:33,cordon:.5,arbol:3,corre:5},farolAvenida:{alto:9,separacion:60},farolPeatonal:{alto:4,separacion:20},
 cebra:{ancho:3,pare:1.25},semaforo:{},
 // (radio 200: el de las zonas densas —Dublín, 200 m ≈ 2,5 min a pie, paradas a ~400 m—; con 400 m una sola parada en
 // el medio cubría todo el mundo)
 // (separación ≥ radio: dos zonas de 200 m que se tocan; con 250 quedaban viviendas en el hueco entre dos paradas)
 // (el fondo del refugio: el que deja el paso libre en una vereda de 3 m —3 − CALLE.paso 1,8 − 0,1 al cordón = 1,1—; va
 // junto al cordón, de espaldas a la fachada)
 parada:{radio:200,separacion:200,largo:3,fondo:1.1,esquina:15},
 hidrante:{edificio:75,separacion:120},
 banca:{largo:1.8,fondo:.6,libre:.9,alameda:100,paseo:50,area:300},papelera:{lado:1.2},
 // La playa: torre de salvavidas en cada paso libre entre sombrillas (cada 100 m; Nevada pide una cada 183 m de playa,
 // Cancún ≤ 300), en la arena más cercana al agua fuera de la franja libre; 2 × 2 m, plataforma a 2 m (Cancún 1,8–3).
 // Kiosco de playa a la entrada de uno de cada dos pasos (cada 200 m), sobre el paseo: 3 × 3 m.
 salvavidas:{lado:2,alto:2,agua:[3,9]},kiosco:{lado:3,cada:2}};
// ======== CIRCULACIÓN (2026-10-15) ========
// Peatón (el personaje): radio 0,3 m; sube un escalón de 0,3 m (Unity: 0,1–0,4 para una persona de 2 m) y pendientes de
// hasta 45°; se camina por todas partes —calzada, pasto, playa, monte—, no sólo por las veredas. La grilla de navegación,
// de 0,5 m. Rodeo: a pie, el camino no pasa de 2 veces la recta (el índice de rodeo de WSDOT).
// Vehículo: carriles de 3 m (calzada 6 en las calles: uno por sentido; 12 en las avenidas: dos), circulación por la
// derecha, 30 km/h en las calles y 50 en las avenidas; radio de giro de un auto 6,4 m por el eje (TxDOT, el auto de diseño
// de AASHTO); pendiente ≤ CARRETERA.grilla.gradoMax.
export const CIRCULACION={
 // (salto: la velocidad con que despega y la gravedad del juego —DemoView las usa de acá—; sube v²/2g = 0,71 m)
 peaton:{radio:.3,escalon:.3,pendiente:45,celda:.5,rodeo:2,salto:{velocidad:4.3,gravedad:13},velocidad:{camina:5.2,corre:9.2}},// (velocidad: m/s del jugador en el 3D, caminando y corriendo con Shift; antes sólo en DemoView)
 vehiculo:{carril:3,velocidad:{calle:30,avenida:50},radioGiro:6.4,esquina:3}};
// ======== EL TRÁNSITO (2026-10-18, Miguel: «mejorá el tránsito: que giren orgánicamente, que paren en los semáforos») ========
// Lo usa el tráfico del 3D (lib/traffic3d.js) por engine/transito.js; lo prueba validar-transito en el 2D. Números de la
// ingeniería de tránsito (ITE / AASHTO), punto de partida:
//  · semaforo: s de verde, amarillo y todo rojo de cada eje (el amarillo del ITE: 1 s de reacción + v/(2·3,4) a 40 km/h
//    ≈ 2,6 → 3 s; el todo rojo, lo que tarda en despejar un cruce de 12 m: ≈ 1,5 s). Todos los cruces con semáforo de la
//    ciudad van en el mismo ciclo (coordinados): primero el eje este–oeste, después el norte–sur;
//  · frena: m/s² de la frenada cómoda (con la que se planea: un semáforo, una curva) y la máxima (un susto: el de
//    adelante, alguien que cruza); acelera: m/s²; reaccion: s que tarda en decidir ante el amarillo;
//  · lateral: m/s² de lo que se acepta de costado en una curva (2,5: un giro urbano tranquilo) → la velocidad de un giro
//    de radio R es √(lateral·R); curvaMin: m/s, lo más lento que se dobla (no se arrastra; 1,5 ≈ 5 km/h: la esquina
//    cerrada de una calle angosta, de radio 1,5 m —con 2,2 daba 3,2 m/s² de costado, validar-transito3d—);
//  · ceda: m/s al entrar a un cruce sin semáforo (se mira antes de entrar);
//  · linea: m de la línea de pare al borde del cruce (la cebra, EQUIPAMIENTO.cebra.ancho, y la línea, .pare, atrás).
export const TRANSITO={semaforo:{verde:15,amarillo:3,todoRojo:1.5},frena:{comoda:3,maxima:7},acelera:2.2,reaccion:1,lateral:2.5,curvaMin:1.5,ceda:4.5,
 linea:3+1.25};
// ======== El choque de los muebles (2026-10-16, Miguel: «cuáles merecen colisionadores, para que se pueda subir a las
// mesas, sofás, estufas, cajas») ========
// Lo que alcanza el personaje: lo que sube saltando (v²/2g) más un escalón. Cada tipo de mueble del plano:
//  · pisable: choca y se sube encima; alto, la superficie donde se para (el asiento del sofá, la tapa del mesón);
//  · solido: choca y no se sube —más alto que el alcance, o que no se pisa (la planta, la ducha con su mampara)—;
//  · ninguno: no choca —las sillas se corren (así lo prueba el 2D al caminar los cuartos), la lámpara de pie, lo que
//    va en la pared—.
// alto: la superficie (pisable) o hasta dónde estorba (sólido); nunca más que lo que mide su modelo (MUEBLES_MEDIDOS).
// Lo comprueba validar-muebles.
export const ALCANCE=(()=>{const S=CIRCULACION.peaton.salto;return +(S.velocidad**2/(2*S.gravedad)+CIRCULACION.peaton.escalon).toFixed(2);})();
const P=(alto)=>({choque:'pisable',alto}),SOL=(alto,razon)=>({choque:'solido',alto,...(razon?{razon}:{})}),NO=razon=>({choque:'ninguno',razon});
export const CHOQUE_MUEBLE={
 // para subirse
 caja:P(.8),cajon:P(.62),mostrador:P(1),vitrina:P(.92),escritorio:P(.76),pupitre:P(.72),mesa:P(.6),mesa_centro:P(.45),mesa_reunion:P(.74),
 mesa_lectura:P(.74),mesa_noche:P(.55),comoda:P(.7),tv:P(.45),meson:P(.84),estufa:P(.84),horno:P(1),plancha:P(.9),lavadora:P(.77),
 sofa:P(.45),sillon:P(.45),cama:P(.55),cama_s:P(.55),catre:P(.45),cama_h:P(.6),camilla:P(.8),inodoro:P(.42),tina:P(.6),lavamanos:P(.85),
 // chocan y no se suben
 armario:SOL(2),estante:SOL(1.95),nevera:SOL(1.7),archivador:SOL(1.32),casillero:SOL(1.8),
 caminadora:SOL(1.35,'la consola y las barandas'),bicicleta:SOL(1.1,'una máquina no se pisa'),banco:SOL(1.45,'el rack de la barra'),mancuernas:SOL(.85,'las mancuernas no se pisan'),
 perchero:SOL(1.5,'la ropa colgada no se pisa'),maniqui:SOL(1.72,'un maniquí no se pisa'),estanteria_ropa:SOL(2),probador:SOL(2.1),buzones:SOL(1.6),caja_fuerte:SOL(1.1),litera:SOL(1.6),
 planta:SOL(.81,'una planta no se pisa'),ducha:SOL(1.88,'la mampara de vidrio, de 2 m'),
 // no chocan
 silla:NO('se corre: el 2D camina los cuartos sin las sillas'),lampara:NO('la lámpara de pie, un poste delgado'),
 repisa:NO('en la pared, arriba'),tablero:NO('colgado en la pared'),alfombra:NO('en el piso'),colchoneta:NO('en el piso, 4 cm'),espejo_pared:NO('en la pared')};
// ======== EL BOTÍN (2026-10-16, idea de Miguel: lo que se roba son cosas del mundo) ========
// Cada objeto: dónde va (tipos de lote y de cuarto, en la planta baja), su medida (largo × fondo, m; contra la pared o
// suelto), su valor, cuánto frena al que lo carga (factor de la velocidad cargando del motor) y cuánto tarda en tomarse
// (s). Pocos objetivos por ciudad (POR_CIUDAD, según el tamaño): que la elección pese. La caja fuerte, con el tiempo de
// abrir del motor (vault).
export const BOTIN={
 objetos:{
  // (2026-10-17, Miguel: «para no complejizar el juego, que no se ponga lento al cargar y que todo le quepa en la mochila,
  // una sola cosa o varias, acumulando dinero»: en el modo «Botín» todo va en la mochila y no frena; «carga» queda para los
  // modos anteriores del motor. El riesgo es lo que se lleva encima: en una requisa se pierde todo)
  caja_fuerte:{nombre:'Caja fuerte',lotes:['objetivo:Banco'],cuartos:['deposito','oficina','recepcion'],largo:.7,fondo:.6,pared:true,valor:5,carga:1,tiempo:8},
  joyas:{nombre:'Joyas',lotes:['objetivo:Joyería'],cuartos:['recepcion','oficina','deposito'],largo:1.2,fondo:.5,pared:true,valor:4,carga:1.25,tiempo:5},
  escultura:{nombre:'Escultura',lotes:['hotel','oficinas'],cuartos:['vestibulo','recepcion'],largo:.8,fondo:.8,pared:false,valor:3,carga:.6,tiempo:4},
  cuadro:{nombre:'Cuadro',lotes:['oficinas','biblioteca','casa_monte'],cuartos:['oficina','lectura','sala'],largo:1.2,fondo:.06,pared:true,valor:2,carga:1.1,tiempo:3}},
 porCiudad:{2:5,3:6,5:7,8:8},monte:{2:1,3:2,5:2,8:3},
 // la meta del motor: los ladrones ganan al entregar esta fracción del valor del botín que el motor juega (punto de
 // partida: obliga a tocar uno de los grandes; se calibra con los bots)
 meta:.5};
// ======== EL RASTRO (2026-10-18, Miguel: «que la policía tenga el punto del ladrón con signo de pregunta apenas roba, y
// un tiempo corto antes de perderlo; lo mismo si se le piden papeles y huye: ese tiempo para atraparlo antes de perder
// el rastro») ========
// Mientras dura, la policía ve en su mapa EN VIVO a ese ladrón (un «?», no su nombre). Al acabarse queda donde se lo vio
// por última vez y desde ahí crece la zona donde puede estar (m por minuto, con piso y tope). Punto de partida: se
// calibra jugando (con jugadores de verdad, no con los bots).
export const RASTRO={robo:20,huyePapeles:15,zona:{porMinuto:25,min:30,max:150}};
// ======== EL ALLANAMIENTO (2026-10-18, Miguel: «si la policía lo está persiguiendo, o está con el tiempo del rastro, no
// puede meter el botín a la guarida; si lo hace, la policía puede allanar la casa luego de un tiempo, y si encuentra
// botines los incauta y le descuenta a la banda, aunque no agarre al ladrón») ========
// Guardar con el rastro encendido (o perseguido) delata la guarida: la policía la ve en su mapa y, a los `espera` s (la
// orden del juez), puede entrar. Lo que encuentra adentro —todo lo guardado ahí, de cualquiera de la banda— se incauta y
// se descuenta de lo guardado por la banda; la guarida queda cerrada el resto de la ronda. Antes de que entren, la banda
// puede volver a sacar el botín (a la mochila: el riesgo vuelve a estar encima).
export const ALLANAMIENTO={espera:30};
// ======== LAS VIVIENDAS (2026-10-17, Miguel: «la policía no entra a las casas ni a los apartamentos; sí a las zonas
// comunes»; «forzar una chapa y entrar a un apartamento es para robar o guarecerse: guarecerse no activa alarma, la alarma
// sólo si roba un objeto»; «en cada puerta de casa o apartamento, mirar por el visor y saber si está llena o vacía») ========
// Una vivienda: cada apartamento (su puerta al pasillo) y cada casa del monte (sus puertas de afuera). Lo mide
// validar-viviendas.
//  · quién está en casa sale de las familias y sus horarios (SOCIEDAD, sociedad.js): lo que se ve por el visor es lo que
//    hay a esa hora;
//  · visor: dónde se para el que mira —a «antes» m de la puerta, afuera— y en cuánto tiempo (s) mira;
//  · forzar: lo que tarda (s) y a cuántos m se oye; entrar a esconderse no hace sonar nada;
//  · llamada: si se entra con gente adentro, a los «demora» s llaman a la policía (sabe en qué vivienda);
//  · robables: lo que se roba en una vivienda, de sus muebles —el televisor, el portátil del escritorio, el joyero de la
//    cómoda—; va a la mochila con el resto; al tomarlo suena la alarma. Poco valor: suma, pero no gana solo.
export const VIVIENDA={visor:{antes:.35,mira:1.2},forzar:{tiempo:4,ruido:12},llamada:{demora:5},
 robables:{tv:{nombre:'Televisor',valor:1,tiempo:4},escritorio:{nombre:'Portátil',valor:1,tiempo:3},comoda:{nombre:'Joyero',valor:1.5,tiempo:3}}};
// ======== LA VIDA Y LAS CAÍDAS (2026-10-17, Miguel: «los ladrones pueden saltar ciertas distancias y que tengan una
// barra de vida: si se bota del edificio, se mató y paila») ========
// La barra va de 0 a «max». Una caída de hasta «segura» m (un piso, con margen) no hace daño; de «mortal» m o más, mata;
// en el medio, el daño crece en línea recta. La vida vuelve de a «recupera» por segundo, «espera» s después del último
// golpe. Un ladrón que muere queda fuera de la ronda (y pierde lo que lleva); cuenta como preso para la policía.
// engine/juego/huida.js (alcanceSalto, danoDeCaida); lo mide validar-azoteas.
export const VIDA={max:100,segura:3.5,mortal:10,recupera:2,espera:6};
// El pretil de las azoteas: el muro de afuera de un edificio choca hasta el techo más «pretil» m (antes, sin tope: el
// muro seguía invisible hacia arriba y de un techo no se salía ni saltando —lo encontró validar-salto—). Caminando, el
// que está en la azotea choca con él (nadie se cae sin querer); saltando (el pie sube ~0,7 m y el choque deja pasar
// desde «pretil» − 0,3), se pasa por encima.
export const AZOTEA={pretil:.8,
 // lo que hay en las azoteas (engine/azoteas.js, 2026-10-18; FACHADAS.md mejora 3): borde, la pista libre junto al pretil
 // para tomar carrera y saltar; salida, la holgura alrededor del núcleo con ascensor; paso, el pasillo mínimo entre dos
 // objetos (más que el cuerpo: 2 × CIRCULACION.peaton.radio); ocupa, la parte del techo que pueden ocupar a lo sumo.
 // tipos: medidas en planta (w ancho, d fondo) y alto, en m —el tanque de 1.000 l, la antena, el tendedero de dos
 // postes, el equipo de aire, la matera (baja: se pasa por encima con un salto)—.
 objetos:{borde:1.5,salida:1,paso:.8,ocupa:.08,
  tipos:{tanque:{w:1.2,alto:1.5},antena:{w:.3,alto:2.6},tendedero:{w:3,d:.3,alto:1.7},aire:{w:1,d:.7,alto:.9},matera:{w:.5,alto:.45}}}};
// La mansarda (2026-10-18, FACHADAS.md B3: el techo plano se dibujaba sobre toda la planta, tapaba la pizarra y la
// mansarda se veía como un piso más de muro oscuro; la física pisaba a 2,8 m también sobre la pendiente). Su perfil es el
// de la pieza del paquete (Roof_SlateCornice, medido en el .gltf): desde cada fachada sube alto m en retiro m de
// pendiente y arriba queda plana; la cubierta de arriba (la losa gris) empieza a cubierta m de la fachada —antes de eso,
// el plano de pizarra de la pieza—. techos.js da la altura de cada punto; el muro de la fachada, a su pie, es el pretil.
export const MANSARDA={alto:3,retiro:1,cubierta:2};
// ======== EL MODO «BOTÍN» (2026-10-17, acordado con Miguel) ========
// Los ladrones juntan el botín en sus guaridas hasta la meta; la policía gana si los tiene a todos presos a la vez (o si
// se acaba el tiempo). Todo lo robado va en la mochila y no frena; lo que se lleva encima se pierde en una requisa. La
// policía entra a las zonas comunes, no a las viviendas; las cámaras de los edificios sacan el retrato de quien entra
// cargando algo. Sin botín encima, la requisa es una detención corta por sospecha; con botín, cárcel hasta que un
// compañero rescate. El motor: engine/juego/ (mapa.js, partida.js, bots.js); lo mide medir-botin.
//  · velocidad: m/s corriendo (la proporción ladrón/policía, la del laboratorio: 3,2/3,05);
//  · vista: m que ve un policía en línea recta (lo tapan los edificios y el monte); oido: m a que oye forzar una chapa
//    (VIVIENDA.forzar.ruido);
//  · requisa: m a que un policía alcanza a un ladrón reconocido; sospecha: s detenido sin botín encima; rescate: s en la
//    puerta de la comisaría para soltar a los presos; entrar: s para entrar o salir de una vivienda o un edificio;
//  · expuesto: s que un ladrón queda llamativo después de una alarma, un forzado o un robo (si lo ve un policía, lo
//    reconoce: su retrato); aviso: s que la policía va a un aviso (alarma, llamada, cámara);
//  · duracion: s de la ronda; meta: valor del botín para ganar, por ladrón (punto de partida: se calibra);
//  · (el dron de la policía se sacó el 2026-10-18: el mapa, el rastro y la zona de búsqueda lo reemplazan; before/dron/)
//  · gente: personas caminando por la ciudad y el monte, «porJugador» por cada jugador de la partida, a «velocidad» m/s;
//    la policía le pide papeles a cualquiera a «papelesA» m, en «papeles» s, cerca de un aviso (a «zona» m del aviso):
//    no sabe quién es ladrón; si es un ladrón con botín encima, a la cárcel.
export const MODO_BOTIN={gente:{porJugador:10,velocidad:1.3,papeles:3,papelesA:3,zona:30},velocidad:{ladron:4.8,policia:4.6},vista:40,requisa:1.2,sospecha:20,rescate:3,entrar:2,expuesto:8,aviso:40,
 duracion:300,meta:8,tick:.25};// (meta 8: medir-botin con el dron y la gente, 2 ciudades × 10 rondas: ladrones 50/45/50/45 % en 2/3/5/8; con 7,
// 60/65/55/45; con 6, 65/75/55/65. Antes del dron y la gente, 7 daba 35/50/55/60)
// ======== LAS GUARIDAS (2026-10-17, Miguel: «el sistema escoge las guaridas, que estén en lugares estratégicos y
// roten, que consuman varios lugares del mapa para que no sea preferible cuáles no»; «a los ladrones se les dice el lugar
// exacto: calle, carrera, casa o edificio, piso, apartamento, y ahí está la caja de guardar los objetos robados») ========
// Una guarida es un apartamento de un edificio de la ciudad o una casa del monte, con su caja. La policía no entra.
// Los números salen de medir-guaridas (4 ciudades): de las ~100–150 candidatas por ciudad casi todas tienen 2 entradas
// (calle y patio); los apartamentos quedan a ~80 m de la comisaría y ~200 m de acceso medio al botín, las casas del
// monte a ~240 m y ~280 m: por eso la equidad se mide entre las guaridas de una misma ronda, no contra todo el mapa.
//  · porPolicias: una guarida por cada tantos policías (redondeando arriba): con 2 entradas cada una, siempre hay más
//    puertas que policías para cuidarlas;
//  · entradas: puertas de afuera mínimas (calle o patio);
//  · comisaria: m caminando, como mínimo, desde la comisaría;
//  · entre: m caminando, como mínimo, entre dos guaridas de la misma ronda;
//  · equidad: el acceso medio al botín (camino desde las puertas de la guarida a las de cada objetivo) de las guaridas de
//    una ronda, dentro de ±equidad entre ellas: ninguna es «la buena»;
//  · rotacion: en «rondas» rondas de una misma ciudad, ningún lugar es guarida en más de «maxUso» de ellas;
//  · caja: el objeto donde se guarda lo robado, contra una pared libre de un cuarto de la guarida, alcanzable.
export const GUARIDA={porPolicias:2,entradas:2,comisaria:60,entre:120,equidad:.15,rotacion:{rondas:12,maxUso:.34},
 caja:{nombre:'Caja de la guarida',largo:.9,fondo:.5,pared:true,cuartos:['dormitorio','estudio','sala','sala_cocina','comedor_casa','cocina']}};
// ======== Las zonas prohibidas (2026-10-16, idea de Miguel: el validador sabe dónde NO puede ir cada cosa) ========
// Por objeto: las zonas (src/engine/zonas.js) en que no puede caer ninguna parte de su huella (radio r, o su rectángulo),
// y las que tiene que pisar su centro (solo). La franja de una puerta: lo ancho de la puerta más lado a cada lado y
// fondo hacia afuera (el portón y la gente que sale: ni un árbol, ni un farol, ni un hidrante ahí).
const DURO=['vacio','agua','edificio','calzada','cebra','puerta','escalinata','mirador','pasaje'],PLAZA=DURO.filter(z=>z!=='mirador');// (el mirador es para sentarse: bancas y papeleras sí)
export const ZONAS={
 puerta:{lado:.5,fondo:2.4},
 // el frente (hacia): lo que tiene que haber delante —a menos de ver m—, más cerca que detrás
 frentes:{parada:{delante:['calzada'],ver:5},salvavidas:{delante:['agua'],ver:200},kiosco:{delante:['agua'],ver:200}},
 // donde: por subtipo, las zonas que tiene que pisar el centro (dónde SÍ puede ir); '' es el que no tiene subtipo
 objetos:{
  arbol:{r:.3,prohibidas:DURO,donde:{calle:['vereda'],avenida:['vereda'],alameda:['borde'],parque:['parque'],plaza:['plaza'],patio:['patio'],jardin:['lote'],bosque:['monte','pradera']}},
  palmera:{r:.25,prohibidas:DURO,donde:{paseo:['playa','paseo'],grupo:['playa']}},
  sombrilla:{r:1.1,prohibidas:['vacio','agua','franja_agua','edificio','calzada','cebra','puerta'],solo:['playa']},
  farol:{r:.2,prohibidas:DURO,donde:{'':['vereda'],peatonal:['borde','paseo','playa']}},
  banca:{prohibidas:PLAZA,solo:['playa','parque','plaza','borde','mirador','vereda','paseo']},
  papelera:{r:.3,prohibidas:PLAZA,solo:['playa','parque','plaza','borde','mirador','vereda','paseo']},
  hidrante:{r:.2,prohibidas:DURO,solo:['vereda']},
  semaforo:{r:.15,prohibidas:DURO,solo:['vereda']},
  parada:{prohibidas:DURO,solo:['vereda']},
  kiosco:{prohibidas:DURO,solo:['playa','paseo']},
  salvavidas:{prohibidas:['vacio','agua','edificio','calzada','cebra','puerta'],solo:['playa','franja_agua']},
  // el botín: adentro de un edificio o una casa, y nunca en la calle
  botin:{prohibidas:['vacio','agua','calzada','vereda','cebra'],solo:['edificio']},
 cebra:{prohibidas:['vacio','agua','edificio'],solo:['calzada']}}};
// ======== Las colisiones (2026-10-16, idea de Miguel: no todo choca, pero lo que choca se calibra en el 2D) ========
// Por objeto, qué parte detiene a alguien (el resto se atraviesa: la copa de un árbol, la tela de una sombrilla, el techo
// de una parada, la pintura de una cebra). Las formas, en el marco del objeto: u a lo largo (su largo, o su ancho si tiene
// frente) y v hacia su frente (o su fondo); un círculo {r, u, v} o una caja {u, v, largo, fondo}, con su alto (lo que no
// se salta). Medidas en m; 'tronco' = la mitad del tronco del 2D (VEGETACION.tronco). w y d: el largo y el fondo del
// objeto en el plano (para lo que se acomoda a su medida). ninguna: no choca (y por qué).
export const COLISION={
 arbol:{partes:[{r:'tronco'}],alto:3},
 palmera:{partes:[{r:'tronco'}],alto:3},
 sombrilla:{partes:[{r:.04}],alto:2.3},// el mástil: la tela queda arriba de la cabeza y las asoleadoras se pisan
 farol:{partes:[{r:.17}],alto:4.5},
 farol_peatonal:{partes:[{r:.15}],alto:3.5},
 banca:{partes:[{u:0,v:0,largo:'w',fondo:'d'}],alto:.85},
 papelera:{partes:[{r:.28}],alto:.95},
 hidrante:{partes:[{r:.16}],alto:.78},
 semaforo:{partes:[{r:.15}],alto:3.1},
 // la parada: los cuatro postes, el vidrio de atrás y la banca; adentro se camina
 parada:{partes:[{r:.06,u:'-w/2+.08',v:'-d/2+.12'},{r:.06,u:'w/2-.08',v:'-d/2+.12'},{r:.06,u:'-w/2+.08',v:'d/2-.12'},{r:.06,u:'w/2-.08',v:'d/2-.12'},
  {u:0,v:'-d/2+.08',largo:'w-.2',fondo:.06},{u:0,v:'-d/2+.35',largo:'w*.7',fondo:.4}],alto:2.5},
 kiosco:{partes:[{u:0,v:0,largo:'w',fondo:'d'}],alto:2.5},
 // la torre: las cuatro patas; debajo se pasa
 salvavidas:{partes:[{r:.08,u:'-w/2+.1',v:'-d/2+.1'},{r:.08,u:'w/2-.1',v:'-d/2+.1'},{r:.08,u:'-w/2+.1',v:'d/2-.1'},{r:.08,u:'w/2-.1',v:'d/2-.1'}],alto:2},
 cebra:{ninguna:'pintura en el piso'},
 placa:{ninguna:'en la pared, encima de la puerta'},
 // el botín: la caja fuerte, la vitrina y el plinto de la escultura chocan; el cuadro va colgado en la pared
 botin_caja_fuerte:{partes:[{u:0,v:0,largo:'w',fondo:'d'}],alto:1.1},botin_joyas:{partes:[{u:0,v:0,largo:'w',fondo:'d'}],alto:1.0},
 botin_escultura:{partes:[{u:0,v:0,largo:'w',fondo:'d'}],alto:2.1},botin_cuadro:{ninguna:'colgado en la pared'}};
// ======== La paleta del mundo (2026-10-16, Miguel: «quitar las texturas y usar colores; cuartos de diferentes colores,
// acorde al estilo low poly») ========
// Colores planos, de saturación media y luminosos (el low poly vive de caras planas con color, sin textura). Cada familia
// es una lista de hex; el pintado (color.js) elige de acá y nada más. Interiores por función: dormitorios fríos y
// tranquilos, salas y comedores cálidos, cocinas frescas, baños agua, trabajo neutro cálido; los pasos (pasillo, hall,
// núcleo) neutros claros. Afuera: fachadas en pasteles vivos de pueblo caribeño, molduras claras (contrastan), techos
// en tierra y teja.
export const PALETA={
 // (cada familia, con colores a ΔE ≥ 15 entre sí —medido: con los neutros casi iguales, dos depósitos vecinos o un
 // depósito y su pasillo quedaban del mismo color—)
 cuarto:{
  dormitorio:['#9fb8e6','#b79fe0','#7fcfc6','#e3b0d6','#a8dcf2'],
  sala:['#f4c27a','#f29f86','#f7e08a','#e8a7b8','#d8b48a'],
  cocina:['#a8dba8','#f4e19c','#7fd0b8','#f2b7a0','#cde59a'],
  bano:['#8fd3e2','#d6eff5','#9fdcc0','#b3c6ee'],
  trabajo:['#dccaa8','#a9cfae','#b7cbe6','#d4b6ea'],
  local:['#f7a8a8','#ffd27f','#9ee0c5','#a9c8f7','#f5b5e0','#c8e89a'],
  publico:['#bfe3d0','#f3e3a6','#c9d9f2','#f1cfc1'],
  paso:['#f4ead6','#c9dcea','#efc8b2','#d3e6b6'],
  deposito:['#b9b0a2','#97adbf','#b8ad7f']},
 fachada:['#f28c7a','#f6c25b','#5fc3b5','#7fa8e0','#e98fb5','#9ed27a','#f4a15d','#b39ddb','#f3e0b0','#7cc7e8'],
 moldura:['#fbf7ef','#f4efe4','#ffffff'],
 techo:['#b5523b','#8f4a36','#c9763f','#6e5a4e','#9a6b4f'],
 // ---- El esquema de afuera (2026-10-18, Miguel: «más bonitos los edificios con mezcla de 2, 3 o 4 colores»; lo que se
 // buscó en FACHADAS.md) ----
 // Cada edificio, cuatro zonas como en la pintura de fachadas (la regla 60-30-10): la PARED (~60 %, la de arriba), la
 // MOLDURA (cornisa, alféizar, dintel, banda: ~25 %), el ACENTO (~10 %: puertas, marcos, barandas; oscuro y saturado,
 // como los balcones de Cartagena y las puertas de La Candelaria) y el ZÓCALO (la franja de abajo de la planta baja,
 // como en Guatapé). La moldura: clara (lo clásico), crema, tonal (la misma pared más oscura) u oscura; los marcos de
 // las ventanas: del acento (lo colombiano: marcos verdes, azules o vino sobre pared clara) o de la moldura; el zócalo:
 // del acento, tonal o de piedra. esquemas: la parte de los edificios con cada opción.
 acento:['#2f6b4f','#2d4f8f','#7a2e3a','#b07a22','#1f7480','#5a3a2a','#a8322d','#3d4146','#5e4a8a'],
 molduraCrema:['#efe3c8','#e9dcc0'],molduraOscura:['#3d4146','#4a3b33'],
 // (la culata —el muro ciego que asoma sobre el vecino más bajo—: ladrillo a la vista, como en Bogotá y Medellín; en el
 // encalado y Guatapé, la pared; FACHADAS.md mejora 2)
 culata:['#a0573f','#9a5a3e','#8e4b36','#b0664a'],
 zocalo:['#8a8a86','#6e5a4e','#5b636b'],
 // (medido en las fotos del 2026-10-18: la moldura tonal y los marcos oscuros apagan una pared oscura —azul, rojo,
 // morado—; el acento luce sobre pared clara. En una pared de luminancia < reglas.paredClara, la tonal pasa a crema, la
 // oscura a clara y los marcos van de la moldura)
 esquemas:{moldura:{clara:.4,crema:.2,tonal:.25,oscura:.15},marco:{acento:.8,moldura:.2},zocalo:{acento:.45,tonal:.3,piedra:.25}},
 // ---- Las tradiciones (2026-10-18, Miguel: «no sólo arquitectura colombiana: también de otros países que se pueda
 // plasmar en low poly»; las fuentes, en FACHADAS.md) ----
 // Cada una, la receta de las cuatro zonas de un lugar: de qué colores es la pared, qué moldura lleva (clara, crema,
 // tonal, oscura; «contraste»: otra pared de la misma lista, como las victorianas; «pared»: sin moldura, como el
 // encalado; «acento»: la moldura del color del acento, como Guatapé), con qué acento, si los marcos van del acento y qué
 // zócalo (acento, tonal, piedra —la suya o la de PALETA.zocalo—, vivo —otro de sus vivos—, azulejo, ninguno). vecinos:
 // lo mínimo que se separan dos fachadas vecinas; uniforme: la pared se repite a propósito (el encalado, la piedra de
 // París, el blanco de Guatapé, el concreto) y dos vecinas se distinguen por el acento y el zócalo; acentoClaro: el acento puede
 // ser más claro que la pared (lo moderno: un color fuerte sobre gris); techo: su techo, si no el de PALETA.
 tradiciones:{
  caribe:{t:'Caribe (Cartagena)',pared:['#f28c7a','#f6c25b','#5fc3b5','#7fa8e0','#e98fb5','#9ed27a','#f4a15d','#b39ddb','#f3e0b0','#7cc7e8'],moldura:{clara:.5,crema:.3,tonal:.2},
   acento:['#2f6b4f','#2d4f8f','#7a2e3a','#b07a22','#5a3a2a'],marco:{acento:.8,moldura:.2},zocalo:{acento:.5,tonal:.3,piedra:.2}},
  antioqueno:{t:'Antioqueño (Guatapé)',pared:['#f6f3ea','#f4eedc','#eef2ee','#f8e7b0'],moldura:{acento:1},uniforme:true,
   acento:['#c8362f','#2f6fbf','#2f8f5f','#c2408a','#e07a1f','#1f8f9c','#6a3fa0'],marco:{acento:1},zocalo:{vivo:.7,acento:.3},vivos:['#e2433b','#f2b531','#2f9e6b','#2f6fbf','#c2408a','#f07f2c','#3fb6c4']},
  mediterraneo:{t:'Mediterráneo (Santorini, Sidi Bou Saïd, Chefchaouen)',pared:['#f7f6f1','#f3efe6','#f7f6f1','#8fbbe0'],moldura:{pared:1},uniforme:true,
   acento:['#1f4fa3','#2b6cb0','#1a7f9c'],marco:{acento:1},zocalo:{ninguno:.6,acento:.4}},
  burano:{t:'Burano y Bo-Kaap',pared:['#f2d13c','#e8578f','#36b3a8','#f08a3c','#8fc94a','#7a6fd0','#e8453c','#3d8fd9'],moldura:{clara:1},
   acento:['#2f6b4f','#3e5f3a','#5a3a2a'],marco:{moldura:.6,acento:.4},zocalo:{ninguno:.5,tonal:.5}},
  nordico:{t:'Nórdico (Nyhavn)',pared:['#d9a441','#b5523b','#e3c46a','#7c9cb0','#c97a4a','#e8dcc0','#9fb39a','#d98c7c'],moldura:{clara:.8,crema:.2},
   acento:['#2c2e30','#2f4a3a','#3d4146'],marco:{moldura:1},zocalo:{piedra:.7,tonal:.3},techo:['#5c6066','#8f4a36','#4a4f57']},
  holandes:{t:'Holandés (Ámsterdam)',pared:['#7a3b2e','#6b4a3a','#9a5a3e','#8a3a2a'],moldura:{clara:1},vecinos:8,
   acento:['#1f3a2c','#2c2e30','#4a1c22'],marco:{moldura:1},zocalo:{piedra:1},piedra:['#3a3d40','#55575a'],techo:['#3d4146','#5c6066']},
  haussmann:{t:'Haussmann (París)',pared:['#e6d8bc','#ead9b8','#dccbb0','#efe4cc'],moldura:{clara:.5,tonal:.5},uniforme:true,
   acento:['#2c2e30','#3d4146','#2f3a45'],marco:{moldura:.5,acento:.5},zocalo:{tonal:.6,piedra:.4},techo:['#5c6066','#4a4f57','#6e7378']},
  victoriano:{t:'Victoriano (las Painted Ladies)',pared:['#7fa8e0','#9ed27a','#e98fb5','#b39ddb','#f6c25b','#5fc3b5','#f28c7a','#f3e0b0'],moldura:{contraste:.7,clara:.3},
   acento:['#a8322d','#2d4f8f','#5e4a8a','#b07a22','#2f6b4f'],marco:{acento:.7,moldura:.3},zocalo:{acento:.5,tonal:.5}},
  charleston:{t:'Charleston (Rainbow Row)',pared:['#f4c7c3','#cfe6d2','#cfe0ef','#f6e7a6','#f3d9b1','#e3d4ee'],moldura:{clara:1},vecinos:12,
   acento:['#2a3b2e','#2c2e30'],marco:{acento:.5,moldura:.5},zocalo:{piedra:.5,tonal:.5}},
  lisboa:{t:'Lisboa (azulejo)',pared:['#f2c84b','#e9a87c','#f2d0c4','#efe6d0','#9fc3dd','#d97a5a'],moldura:{clara:1},
   acento:['#2f5f8f','#2f6b4f','#5a3a2a'],marco:{moldura:.6,acento:.4},zocalo:{azulejo:.6,piedra:.4},azulejo:['#3f73b5','#2f5f9a']},
  laboca:{t:'La Boca y Valparaíso',pared:['#2d63b5','#d6332e','#f2c230','#5fb54a','#e0712c','#3fb6c4'],moldura:{contraste:1},
   acento:['#2c2e30','#5a3a2a'],marco:{moldura:.5,acento:.5},zocalo:{piedra:1},piedra:['#7d8084']},
  moderno:{t:'Moderno (concreto)',pared:['#ecebe6','#cfcfcb','#9ea3a8','#4a4f57','#e5dccb'],moldura:{oscura:.5,clara:.5},uniforme:true,acentoClaro:true,
   acento:['#e0712c','#f2c230','#d6332e','#2d63b5','#2f9e6b'],marco:{moldura:1},zocalo:{piedra:.5,ninguno:.5}}},
 // qué tradiciones caben en cada familia de barrio de la ciudad (fachada.js BARRIOS) y en las manzanas del monte
 tradicionesDe:{historico:['caribe','nordico','holandes','lisboa','laboca'],elegante:['haussmann','victoriano','charleston','lisboa'],moderno:['moderno','nordico','caribe'],
  monte:['antioqueno','mediterraneo','burano','caribe','charleston','victoriano']},
 // (la diferencia mínima entre vecinos —ΔE de CIE76—: dos cuartos que se tocan, dos fachadas de lotes vecinos; la
 // moldura contra la pared, en contraste de luminancia WCAG)
 // (acento: lo mínimo que se separa de la pared y de la moldura —y es más oscuro que la pared—; zócalo: de la pared, y más
 // oscuro; tonal: cuánto se oscurece la pared para la moldura y el zócalo tonales)
 reglas:{vecinos:12,fachadas:18,contraste:1.25,familia:15,acento:30,acentoMoldura:20,zocalo:12,tonal:.82,tonalZocalo:.6,paredClara:.45}};
// la familia de cada tipo de cuarto (los del plano y los de las casas)
export const FAMILIA_CUARTO={dormitorio:'dormitorio',habitacion:'dormitorio',habitacion_h:'dormitorio',celda:'deposito',
 sala:'sala',sala_cocina:'sala',comedor:'sala',estudio:'sala',sala_prof:'sala',
 cocina:'cocina',cocineta:'cocina',
 bano:'bano',sanitario:'bano',
 oficina:'trabajo',reuniones:'trabajo',secretaria:'trabajo',archivo:'trabajo',interrogatorio:'trabajo',abierta:'trabajo',consultorio:'publico',urgencias:'publico',enfermeria:'publico',
 local:'local',recepcion:'publico',vestibulo:'publico',entrada:'paso',prestamo:'publico',estanteria:'publico',infantil:'local',lectura:'publico',aula:'publico',
 hall:'paso',pasillo:'paso',escalera:'paso',nucleo:'paso',
 deposito:'deposito',boveda:'deposito'};
// ======== Dónde estoy (2026-10-16, Miguel: «que me diga en qué calle y en qué carrera estoy mientras camino o vuelo») ========
// banda: cuánto más allá del borde de la vía (su ancho, de paramento a paramento) todavía se está «sobre» ella;
// cerca: hasta dónde se busca la vía más cercana cuando no se está sobre ninguna (adentro de una manzana, en el monte).
export const UBICACION={banda:1,cerca:60};
// ======== Bajar del dron (2026-10-16, Miguel: «que caiga de la altura donde esté») ========
// Al soltar el dron el jugador cae desde la altura del dron sobre la columna donde está, si ahí se camina y desde ahí
// se llega a pie a la calle; si no (un techo, el agua honda, el vacío), sobre el punto así más cercano (busca: hasta
// dónde se busca alrededor). fachada: a cuánto de la fachada de un edificio como mínimo (lo que sale un balcón, 1 m, y
// algo: si no, el que cae junto a la pared se queda en el balcón de un piso alto). caida: la velocidad tope al caer
// (m/s), para que la caída se vea.
export const ATERRIZAJE={busca:40,fachada:1.2,caida:32};
// ======== La pintura de la calle (2026-10-16, Miguel: «las cebras repetidas y las rayas de la calle despegadas,
// flotando») ========
// Una sola fuente: el plano (pintura.js) dice cada franja —las de las cebras del equipamiento y las líneas de las calles
// del monte— y el 3D sólo la pega al asfalto (su alto: alto sobre la superficie dibujada, sin sombra propia).
// cebra: franjas de .franja m cada .paso m a lo largo del paso; discontinua: la línea blanca de las calles angostas
// (.largo m cada .cada m), como las calles de la ciudad; amarilla: la doble de las anchas —las avenidas, de más de .desde m—, dos líneas de .ancho a .separa entre ejes.
export const PINTURA={alto:.015,cebra:{franja:.5,paso:1},discontinua:{largo:2.4,ancho:.18,cada:6},amarilla:{desde:12,ancho:.11,separa:.22},margen:.5};
// ======== LA SOCIEDAD (2026-10-17, Miguel: «que cada npc tenga un comportamiento predefinido: trabaja de tal hora a tal
// hora, va al gim a tal hora, hace compras tal día, y los horarios de apertura y cierre de la ciudad; que todo lo
// podamos calibrar con el tester 2D pasando varios días»; «familias»; «niños que jueguen o vayan a la escuela») ========
// Lo arma engine/sociedad.js y lo mide validar-sociedad. Etapa 1: el motor (quién vive dónde, en qué trabaja, su
// semana); el 3D todavía no lo dibuja.
//  · reloj: «escala» s del juego por s real (60: un minuto real es una hora de la ciudad; la ronda de MODO_BOTIN.duracion
//    s dura 5 h). Cada ronda empieza un día y una hora de la semana (determinista por semilla y ronda). El día 0 es lunes.
//  · hogares: cómo son las familias (parte de cada tipo; las casas del monte, más familias); edades.
//  · horarios: cuándo abre cada lugar, [abre, cierra] en horas, de lunes a viernes (lv), sábado y domingo (null: cerrado);
//    «siempre»: abierto las 24 h, en turnos de «turnos» horas.
//  · oficios: quién trabaja en cada lugar y cuántos por turno (por piso en las oficinas). El resto de los adultos:
//    independientes (trabajan en casa), cuidan a los niños, jubilados (desde «jubilacion») o sin trabajo; de los que no
//    consiguen puesto, «informal.parte» vende en la calle (en una esquina, junto a una cebra, «informal.dias» por semana; 2026-10-17:
//    con 20 % de adultos sin trabajo, de día casi todas las viviendas tenían gente).
//  · rutinas: el gimnasio (parte de los adultos, días por semana, duración en h), las compras (salidas por hogar a la
//    semana), comer afuera, el parque de los niños, los paseos de los que no salen a trabajar (al parque, la biblioteca,
//    las tiendas); caminan a «paso» m/s entre un lugar y otro.
//  · cuidado: menores de «solos» años nunca quedan sin un adulto: en cada hogar con niños chicos hay quien los cuida. Una
//    parte («trabaja») trabaja de lunes a viernes de día (en «lugares»): deja a los chicos en el colegio a las «dejar» h
//    —los pequeños, en el jardín— y los recoge al salir (el colegio tiene jornada extendida: abre hasta las 18:30; las
//    clases, horarios.clases). Los demás cuidan la casa (o trabajan en ella) y los recogen al terminar las clases.
export const RELOJ={escala:60,dia:86400};
// La animación de caminar de los muñecos (characters3d moveCharacter): a ritmo 1 avanza paso m/s; el ritmo va de min a
// max (fuera de eso, los pies patinan).
export const ANIM={paso:1.35,min:.6,max:1.6};
// El caminar natural (2026-10-18, Miguel: «saltos bruscos de movimiento»; lo mide validar-caminar): por cuadro, la
// velocidad contra el paso de cada uno (p99 rapido, nunca más de salto), la aceleración p99 (m/s²: una persona arranca y
// dobla a 1–2), el giro de la marcha p99 (°/s), lo que patinan los pies p95 (parte del avance) y hacia dónde mira contra
// hacia dónde camina p95 (°).
export const CAMINAR_NATURAL={rapido:1.25,salto:1.6,acel:3,giro:150,patina:.15,mira:25};
export const SOCIEDAD={
 hogares:{tipos:{solo:.24,pareja:.2,familia:.38,monoparental:.12,abuelos:.06},casaFamilia:.75,hijos:[1,3],edadAdulto:[22,62],edadMayor:[65,86]},
 horarios:{
  panaderia:{lv:[6,20],sab:[6,20],dom:[7,13]},fruteria:{lv:[7,19],sab:[7,19],dom:[7,13]},heladeria:{lv:[11,21],sab:[11,22],dom:[11,22]},
  pizzeria:{lv:[12,23],sab:[12,23],dom:[12,22]},hamburgueseria:{lv:[12,23],sab:[12,23],dom:[12,22]},sushi:{lv:[12,22],sab:[12,22],dom:null},
  ropa:{lv:[10,20],sab:[10,20],dom:[11,18]},gimnasio:{lv:[5,22],sab:[7,18],dom:[8,13]},tienda:{lv:[8,20],sab:[8,20],dom:null},
  oficinas:{lv:[8,18],sab:null,dom:null},colegio:{lv:[7,18.5],sab:null,dom:null},clases:[7,15],biblioteca:{lv:[9,18],sab:[9,13],dom:null},
  objetivo:{lv:[9,17],sab:[9,12],dom:null},parque:{lv:[6,21],sab:[6,21],dom:[6,21]},esquina:{lv:[6,21],sab:[6,21],dom:[6,21]},parada:{lv:[5,23.5],sab:[5,23.5],dom:[5,23.5]},banca:{lv:[6,21],sab:[6,21],dom:[6,21]},hospital:{siempre:true},hotel:{siempre:true},turnos:8},
 oficios:{panaderia:['Panadero',2],fruteria:['Vendedor de frutas',2],heladeria:['Heladero',2],pizzeria:['Pizzero',2],hamburgueseria:['Cocinero',2],
  sushi:['Cocinero de sushi',2],ropa:['Vendedor de ropa',2],gimnasio:['Entrenador',2],tienda:['Tendero',2],oficinas:['Oficinista',3],colegio:['Profesor',8],
  biblioteca:['Bibliotecario',2],objetivo:['Vigilante',2],hospital:['Enfermero',3],hotel:['Recepcionista',2]},
 turnoLargo:10,// h: un lugar que abre más que esto parte el día en dos turnos (mañana y tarde)
 jubilacion:65,trabajan:.9,informal:{parte:.65,oficio:'Vendedor ambulante',horas:[8,16],dias:6,vereda:1.6},// (de los que no consiguen puesto, la parte que vende en una esquina —en la vereda, a «vereda» m de la cebra—, de lunes a sábado)
// (parte de los adultos que buscan trabajo; el resto, independientes en casa)
 rutinas:{gimnasio:{parte:.25,dias:3,horas:1.25},compras:{porSemana:3,horas:.75},comerAfuera:{porSemana:1,horas:1.5},parque:{parte:.5,horas:2},paseos:{porSemana:4,horas:[1,3]},paso:1.3},
 cuidado:{solos:10,trabaja:.65,dejar:7,lugares:['oficinas','colegio']}};
// ======== LAS PATRULLAS (2026-10-17, REGLAS.md paso 4: «sólo para la policía, se sacan de la comisaría —cuántas, según el
// mapa—, se manejan y se dejan estacionadas donde sea; los ladrones no usan carros») ========
// Lo arma src/lib/patrulla3d.js y lo mide validar-patrulla.
//  · cuantas(equipo): cuántas hay, estacionadas en la calle frente a la comisaría, a «separa» m una de otra;
//  · manejo (m/s, m/s², rad): velocidad máxima y en reversa, aceleración, freno, roce (al soltar), el giro de las ruedas
//    (menos a más velocidad) y la distancia entre ejes (el radio de giro);
//  · subir: a cuántos m de la patrulla se ofrece «Subir»; radio: el ancho que choca (medio auto);
//  · frena sola ante la gente (a «gente» m adelante): no se atropella a nadie.
export const PATRULLA={cuantas:e=>Math.max(2,Math.ceil(e/2)),separa:7,vmax:16,reversa:5,acel:5,freno:11,roce:1.6,giro:.55,ejes:2.6,subir:2.8,radio:.95,gente:2.2};
// ======== LA RUTINA: AGENDA Y NECESIDADES (2026-10-18, Miguel: «que tengan agenda y necesidades; si hay un trancón o un
// robo y el tiempo se descuadró, la necesidad debe priorizar: descartar unas cosas por otras para ponerse al día, y que
// el juego no se comporte raro después de un tiempo sino que se estabilice; calibrarlo milimétricamente en el 2D») ========
// Lo arma engine/rutina.js; lo mide validar-rutina; lo calibra scripts/calibrar.mjs (experimento «rutina»).
// Cada persona vive su día decidiendo en el momento: lo obligatorio (trabajo, colegio, llevar y recoger a los chicos,
// dormir) tiene hora; en los ratos libres elige, entre los lugares abiertos que le quedan a tiempo, el que mejor cubre
// sus necesidades. Si algo lo atrasa, el resto del día se acomoda solo: lo opcional se cae primero, lo flexible se
// acorta, lo obligatorio se hace aunque sea tarde. Dormir es el punto de reinicio.
//  · necesidades (de 0 a 1+; sube: por hora despierto; umbral: desde ahí busca cubrirla; peso: cuánto importa):
//    hambre (comer en casa o afuera; en un turno largo almuerza en el trabajo), despensa (del hogar: hacer compras),
//    fisico (sólo los socios del gimnasio), ocio (pasear, el parque, mirar vitrinas, un helado);
//  · lugares: qué necesidad cubre cada tipo, cuánto la baja, cuánto dura (h) y lo mínimo si hay apuro (acortar);
//  · sueño: a qué hora se acuesta (por persona) y cuántas horas duerme; se levanta antes si lo obligatorio lo pide;
//  · viaje: hasta «caminaHasta» m camina; más lejos, el bus si no tarda más de «aceptar» veces lo que a pie (paraderos, cada «frecuencia» h, de «desde»
//    a «hasta», a «velocidad» m/s con «parada» h por paradero);
//  · prioridad: el orden de lo que se cae primero cuando no alcanza el tiempo.
export const RUTINA={
 // (calibrado el 2026-10-18 con scripts/calibrar.mjs rutina —220 pruebas, ciudades 1 y 2, con la estabilidad como meta—:
 // pérdida 0,18 → 0,014, 14 de 15 metas y la ciudad vuelve a lo normal; falta el mercado del fin de semana en la mañana)
 necesidades:{hambre:{sube:.211,umbral:.866,peso:1.4,inicio:[.2,.5]},despensa:{sube:.0134,umbral:.508,peso:1.1,inicio:[.1,.6]},
  fisico:{sube:.0219,umbral:.8,peso:.8,inicio:[.2,.9],socios:.25},ocio:{sube:.0604,umbral:.739,peso:.6,inicio:[.1,.6]},
  // (2026-10-18, Miguel: «cada uno con libertad de caminar y cumplir sus tareas; que paren, se sienten o se queden parados
  // y eso los recargue»): el cansancio. Sube afuera (sube por hora) y caminando (camina por hora de camino); baja en casa
  // (casa por hora) y al dormir (cada mañana, en 0); sentado en una banca, banca.baja. Pasado el umbral busca dónde
  // descansar: una banca cerca o su casa)
  energia:{sube:.111,camina:2.1,casa:.5,umbral:.356,peso:1.3,inicio:[0,.1]}},// (calibrado el 2026-10-18 —calibrar descanso, ciudades 1 y 2: sólo las perillas del cansancio; la calle de 15 a 19, 24 % quieta—)
 lugares:{
  comerCasa:{cubre:'hambre',baja:1,horas:.5,minimo:.33,que:'come en casa'},
  pizzeria:{cubre:'hambre',baja:1,horas:1,minimo:.6,que:'come pizza',ocio:.35},hamburgueseria:{cubre:'hambre',baja:1,horas:.9,minimo:.5,que:'come hamburguesa',ocio:.3},
  sushi:{cubre:'hambre',baja:1,horas:1,minimo:.6,que:'come sushi',ocio:.35},panaderia:{cubre:'hambre',baja:.45,horas:.4,minimo:.25,que:'toma algo en la panadería',despensa:.25},
  heladeria:{cubre:'ocio',baja:.45,horas:.6,minimo:.3,que:'se toma un helado',hambre:.15},
  fruteria:{cubre:'despensa',baja:.6,horas:.6,minimo:.3,que:'hace mercado'},tienda:{cubre:'despensa',baja:.9,horas:.8,minimo:.4,que:'hace mercado'},
  gimnasio:{cubre:'fisico',baja:1,horas:1.25,minimo:.75,que:'hace ejercicio'},
  parque:{cubre:'ocio',baja:.9,horas:1.5,minimo:.5,que:'pasea por el parque'},biblioteca:{cubre:'ocio',baja:.8,horas:1.5,minimo:.75,que:'lee en la biblioteca'},
  ropa:{cubre:'ocio',baja:.6,horas:.75,minimo:.4,que:'mira vitrinas'},
  // (descansar: en una banca de la calle o del parque —de a asientos personas a la vez— o en casa)
  banca:{cubre:'energia',baja:.8,horas:.385,minimo:.15,que:'descansa en una banca',asientos:2},esquina:{cubre:'energia',baja:.358,horas:.334,minimo:.1,que:'se queda parado en la esquina',asientos:4},descansaCasa:{cubre:'energia',baja:.9,horas:.5,minimo:.25,que:'descansa en casa'}},
 afuera:.151,// (las ganas de comer afuera en vez de en casa —el fin de semana, el doble—)
 finde:{despensa:1.99,ocio:1.78,fisico:.8},// (cuánto más pesa cada necesidad el sábado y el domingo: el mercado y el paseo)
 almuerzo:5,// h: un turno de al menos esto incluye almorzar en el trabajo (el colegio, en el comedor)
 almuerzoAfuera:{parte:.47,lugares:['oficinas'],tipos:['pizzeria','hamburgueseria','sushi','panaderia'],hasta:450,horas:.75},// (algunos días el de la oficina sale a almorzar cerca: la parte de los días, adónde y a cuántos m)
 sueño:{acostarse:[21.5,24],horas:[7,8.5],preparar:.75,findeMas:1.5},
 viaje:{camina:1.3,caminaHasta:450,bus:{frecuencia:.2,desde:5,hasta:23,velocidad:8,parada:.01,entreParadasMonte:180,aceptar:1.4}},// (aceptar: más allá de caminaHasta toma el bus aunque tarde hasta esto más que a pie)
 prioridad:['ocio','fisico','despensa','hambre'],// (lo que se cae primero —la hambre, lo último—; lo obligatorio no se cae)
 margen:.1,// h de llegar antes a lo obligatorio
 redondeo:.1,// (cada noche las necesidades que pasan de un día a otro se redondean a esto: la ciudad se estabiliza)
 espera:.5};// h: en casa sin nada que hacer, vuelve a mirar cada tanto
