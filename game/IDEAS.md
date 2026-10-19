# FUGA · ideas de diseño

Ideas conversadas el 2026-10-06 y 2026-10-07. Ninguna está programada. Las que tienen números se pueden medir con el
calibrador antes de decidir.

Principio que se repitió en todas: **simple como un juego de patio** (escondidas, policías y ladrones). Si una regla no
se puede decir en una frase, probablemente sobra.

---

## 000. MODO «BOTÍN»: IDEAS GUARDADAS (2026-10-17) — sin programar

El modo «Botín» (GENERADOR.md: guaridas, viviendas, motor engine/juego) reemplazó la dinámica del Profesor. Miguel
pidió dejar como ideas, y no hacer por ahora, lo que venía de esa época o agrega mucho:

- **La pista de la guarida que da el preso.** Venía del Profesor (cada ladrón arrestado daba una pista de dónde estaba
  el hangar). Con guaridas privadas y rotativas quizás no hace falta.
- **Hackear a la policía.** Los ladrones leen la placa de una patrulla (la clave rota y siempre es la placa de alguna
  patrulla), se sientan en un computador de oficina y ven las cámaras de la policía y manejan uno de sus drones mientras
  dure la clave; la policía lo nota y la cambia. Necesita patrullas estacionadas con placa (el juego no las tiene) y bots
  que sólo sepan lo que ven, para que se pueda medir lo que gana el ladrón con la información.

---

## 00. LA DIRECCIÓN NUEVA: TRES GOLPES Y EL HANGAR DEL PROFESOR (2026-10-10) — idea de Miguel, sin programar

Inspirada en La Casa de Papel. Reemplaza al «un solo objetivo» del núcleo de abajo.

- **Se roban edificios, no un lugar fijo**: «robaron el edificio Buenavista», no «el banco». Los ladrones ganan si
  completan **tres** golpes (cada uno = robar y llevar el botín al hangar). La policía gana si los captura.
- **El hangar del Profesor**: al empezar, el Profesor elige dónde se esconde (un hospital, un edificio, una casa de la
  isla, en la montaña o en la playa). Ahí se entrega el botín. Por la trama trabaja en una computadora: por eso **casi
  todos los edificios y casas tienen un rincón con computador**, gente sentada, caminando, entrando, saliendo, dormida
  frente a la pantalla: que la policía no lo encuentre sólo mirando desde el dron quién está frente a un computador.
- **La alarma**: cuando roban un edificio, el edificio avisa a la policía.
- **El líder de la policía va en el dron**: sigue al ladrón desde arriba y le dice a sus compañeros por dónde va («va por
  tal vía, está al lado de tal edificio»).
- **Esconderse y las cajas**: el ladrón puede meterse en los edificios y **dejar la bolsa en una caja** (estilo
  Minecraft) y salir corriendo sin ella. Hay muchas cajas en todos lados, para distraer. Si la policía no lo agarra,
  después vuelve por la bolsa y la lleva al hangar.
- **El interrogatorio**: si la policía agarra a un ladrón, lo interroga y saca pistas **progresivas** sobre el Profesor
  (dónde está; la última casi da la dirección exacta).
- **Cómo se ve el Profesor**: tiene rasgos (pelo amarillo, bigote, …) que también son pistas al capturar ladrones.
- Más adelante: el Profesor puede **rescatar** ladrones de la policía.

**Por dónde se empieza (decisión del 2026-10-10)**: se vuelve al 2D, pero no a las reglas todavía: primero la
**generación de la ciudad por etapas**, bien especificada (ciudad → manzanas → edificios por manzana → pisos →
ascensores → cuartos → puertas y ventanas → muebles), para que la ciudad quede definida en los datos y el 3D sólo la
dibuje.

### Primera versión en el motor (2026-10-10): modo «Golpes»

En `/` (botón **Golpes**, `?modo=golpes`), sobre la ciudad por etapas (`src/engine/plano.js` la pasa al motor: cada
lote es un interior, con paredes en su borde y abierto sólo en sus puertas de calle; planta baja).
- Se roban oficinas, comercio y los objetivos del plano: un botín por edificio, en su caja fuerte. Abrirla toma 8 s y
  **la alarma suena al empezar**: la central avisa a toda la policía.
- Ganan los ladrones con el botín de **tres edificios distintos** en el hangar. La policía, si arresta al Profesor, si
  encarcela a todos los que roban o si se acaba el tiempo.
- **El Profesor** (el primer ladrón) elige un edificio con computador, lejos de la comisaría, y se queda sentado ahí.
  En cada edificio con computador hay alguien sentado; todos tienen rasgos (pelo, bigote, gafas).
- **El jefe de policía** (el primer policía) vuela el dron toda la ronda: sigue la bolsa que vieron hace poco, la
  alarma o la zona de las pistas, y marca a quien se delata al aire libre.
- **Cajas**: con policía detrás hace poco, el que lleva la bolsa la deja en una caja cercana y vuelve por ella cuando
  no sabe de policía cerca. La policía revisa las cajas cerca de donde vio la bolsa por última vez.
- **Interrogatorio progresivo**: cada preso da la pista siguiente (mitad → calle o cuadrante → manzana) y un rasgo
  del Profesor. Desde la segunda pista la policía revisa a la gente sentada que coincide; arrestar a un inocente la
  suspende 5 s. Si un policía ve entregar el botín, sabe cuál es el hangar.

% de victorias de ladrones (48 rondas por tamaño en 12 ciudades):

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| **Así quedó** | 27 | 52 | 50 | 44 |
| Duración media | 79 s | 83 s | 51 s | 41 s |

En 3 contra 3: con la alarma al terminar de abrir, 63 %; revisando gente desde la primera pista, 65 %.
Lo que falta mirar: en 2 contra 2 roba uno solo (el otro es el Profesor) y casi siempre cae; en las ciudades grandes
las rondas duran menos de un minuto porque siete ladrones roban a la vez. Ninguna ronda llega al reloj.

#### Un robo a la vez (2026-10-10), en las ciudades grandes

Prueba (`tuning.serial`, apagada por defecto): mientras el botín de un edificio no llega al hangar, no se puede empezar
otro. % de victorias de ladrones (48 rondas por tamaño):

| | 5 vs 5 | 8 vs 8 |
|---|---|---|
| Robos en paralelo (como quedó) | 50 | 44 |
| Un robo a la vez | 4 | 0 |
| … y los que sobran esperan entre la gente (`tuning.lurk`) | 0 | 0–2 |
| … y duermen policías sólo cerca del robo (`tuning.cover`) | 0 | 0 |
| … y la alarma suena al terminar de abrir | 2 | 2 |

**Con un robo a la vez la policía gana casi siempre**, haga lo que haga la banda. Con un solo edificio en juego, la
alarma lleva a toda la policía al mismo lugar: el primer botín casi nunca llega (0,2–0,5 entregas por ronda), caen 2
ladrones por ronda y con esas dos pistas la policía encuentra al Profesor (47 de 48 rondas terminan así). En paralelo,
la policía se reparte entre varias alarmas.

Lo que sí mostró: **el Profesor cae con sólo dos pistas** (la calle o el cuadrante y dos rasgos), también en el modo en
paralelo. Si se quiere que las rondas grandes duren más, antes de limitar los robos conviene que encontrar al Profesor
cueste más: más gente sentada por edificio, la revisión desde la tercera pista, o que el Profesor se mude al oír
que cayó un compañero.

### La ciudad por capas (2026-10-10) — paso 1 de 3, en `/capas`

Un simulador APARTE del juego (`src/engine/capas.js`): no toca el motor, ni `/`, ni lo medido. La gente vive en la
ciudad del plano con sus pisos: cada cuarto, tramo de pasillo, escalera, ascensor y casilla de calle es un espacio; las
puertas son portales, y los recorridos son el camino más corto en segundos (caminar 1,3 m/s; escalera 6 s por piso;
ascensor: esperar 3–12 s y 2 s por piso; cada persona prefiere un poco más la escalera o el ascensor). Cada persona
tiene casa (una cama) y trabajo (una silla), y elige al azar qué hacer: trabajar sentada, volver a casa (dormir o el
sofá), ir a un local, pasear o visitar otro edificio. La pantalla: el plano del piso activo, la gente de los otros
pisos visibles como sombras, y un panel de capas con cuánta gente hay en cada una; se puede seguir a una persona.
**Paso 2 (hecho): la policía.** Tantos policías como jugadores por equipo. Cada uno sale de la comisaría a patrullar 3–6
tramos de calle cerca de donde está; en uno de cada cuatro entra a revisar un edificio cercano (70 % la planta baja).
Patrullando, si pasa a menos de 6 m de alguien en la calle, a veces lo para (12 % por segundo; después espera 20–60 s):
se le acerca, lo revisa 4–10 s y sigue. Nadie es parado dos veces en 2 minutos. Al terminar vuelve a la comisaría y se
sienta 20–90 s. Medido en 10 minutos: ~30 % del tiempo en la comisaría, ~45 % patrullando, ~20 % revisando edificios,
~5 % parando gente; una parada cada ~3 minutos por policía (2, 3 y 8 policías).
Falta: 3) los ladrones y las métricas (ruido de la ciudad, paradas que tocan a un ladrón, cuánto se tarda en encontrar
a alguien según el piso).

**Paso 3a (hecho): rasgos y cámaras.** Idea de Miguel: cámaras en los lugares que se roban, cuyas fotos le dan a la
policía rasgos de quien entró (y más adelante, el retrato hablado en los paneles de publicidad). Se va de a poco; si el
ladrón puede cambiarse de ropa se decide después.
- Cada persona tiene rasgos: ropa (6 colores), gorra, pelo (4), gafas, mochila: 192 combinaciones. La policía va de
  uniforme y no queda grabada.
- Cada edificio robable tiene una cámara en cada puerta de calle (ve de frente a quien entra y de espaldas a quien sale)
  y otra en el cuarto de la caja fuerte (una foto cada 4 s de quien esté, de frente o no). De espaldas no se ven las
  gafas; la gorra tapa el pelo; el 15 % de las fotos sale movida y sólo deja ver la ropa.
- En `/capas`: las cámaras son triángulos (se encienden al sacar una foto); tocando una se ven sus últimas 4 fotos como
  retratos, con lo que se vio y cuánta gente de la ciudad coincide.

Medido en 10 minutos, sin ladrones (cuánta gente de la ciudad coincide con una foto, contando a quien sale en ella):

| | 2 vs 2 | 3 vs 3 | 8 vs 8 |
|---|---|---|---|
| Gente / cámaras | 143 / 94 | 200 / 123 | 546 / 401 |
| Fotos por cámara por minuto | 0,4 | 0,3 | 0,4 |
| Parecidos, foto de frente (mediana) | 2 | 3 | 8 |
| De espaldas | 4 | 6 | 19 |
| Movida | 24 | 34 | 91 |

Casi la mitad de las cámaras no ve a nadie en 10 minutos. Una foto de frente casi identifica a la persona en las
ciudades chicas (2–3 parecidos); en las grandes deja 8.

**La tabla de rasgos (2026-10-10, `src/engine/rasgos.js`).** El catálogo de ropa pasó a `src/engine/vestuario.js`
(puros datos). Cada persona de `/capas` se viste con el mismo catálogo del probador (`randomLook`, sobre el cuerpo base,
con frecuencias de población como perillas: `FRECUENCIAS`), y sus rasgos salen de lo que lleva puesto. Cada rasgo dice
desde dónde se ve (lejos, que incluye el dron; cámara; cerca), si sólo de frente (ojos, gafas, barba), qué lo tapa (el
sombrero tapa el peinado) y si se cambia rápido (gorra, gafas, mochila, lo de encima).
Combinaciones del catálogo de ciudad: ≈ 414 millones de formas sin colores; ≈ 155 billones con colores.
Medido: una foto de cámara con todos los rasgos deja a cualquiera único (100 % en 143, 200 y 546 personas); de lejos
quedan 7–17 parecidos. Por eso una pista (`pista`) parte de lo que se ve de lejos y suma rasgos al azar hasta dejar
entre `OBJETIVO` = [5, 15] parecidos en la población real: en las cámaras de `/capas`, mediana 6–9. Una ropa rara
(un vestido, un casco) deja menos parecidos: vestirse llamativo te hace fácil de encontrar.
Ideas de Miguel para lo que sigue: a quien para la policía puede ser testigo (con cierta probabilidad informa que vio a
alguien con esas características, según lo que vio de verdad); el parado puede obedecer o correr (correr lo delata);
en la revisión no debe llevar el botín: lo esconde antes en una caneca, un departamento o una casa.

**Paso 3b (hecho): los ladrones en `/capas`.** Tantos ladrones como jugadores por equipo; viven como cualquiera hasta
que dan un golpe: van a la caja fuerte de un edificio robable (12–20 s), salen con la bolsa, la esconden en una caneca
(hay una en una de cada cuatro casillas de calle) o en un cuarto cercano, se mezclan 60–150 s, vuelven por ella y la
llevan a su casa (golpe completo). Al robar suena la alarma: el cartel es la pista dosificada de la cámara de la caja
fuerte, y la policía para sobre todo a quien coincide con él en lo que se ve a unos metros (desde 15 m, con más ganas)
y patrulla hacia el robo o el último aviso. Parado, el ladrón corre con la bolsa encima el 75 % de las veces y sin ella
el 10 %; corriendo hay persecución (2,2 m/s contra 2,5; se pierde a 18 m o a los 25 s); si obedece con la bolsa, lo
arrestan. La gente que ve de cerca (8 m) a alguien con una bolsa lo recuerda 5 min; si la paran, lo cuenta el 80 % de
las veces, y el 20 % se equivoca de lugar. Todo eso son perillas (`P_HUIR_BOTIN`, `P_TESTIGO`, `P_ERROR_TESTIGO`…).
Medido en 20 min, 5 ciudades: 3–14 robos y 2–3 golpes completos; 0–2 paradas a ladrones; ningún arresto. Los ladrones
esconden la bolsa enseguida y la policía los para sin ella: falta calibrar (más policía hacia la alarma, revisar
canecas cerca del robo, que el ladrón tarde en esconderla). Trampa encontrada: el ascensor usa el campo `phase` de la
persona y pisaba la fase del golpe (ahora `fase`).

**Paso 3c (hecho, idea de Miguel): preguntar, requisar, detener, validar.** La policía muestra el cartel a quien para.
Un ciudadano puede ser testigo; el ladrón dice que no vio nada. Si quien paró coincide al 100 % con el cartel (de cerca
se ve todo), lo requisa: con la bolsa encima, condena; sin ella, queda **detenido** y la policía sale a buscar la bolsa
cerca del robo (canecas sin revisar y cuartos a menos de 40 m). Si la encuentra, compara a los detenidos con la
**grabación completa** de la caja fuerte (no el cartel dosificado): quien coincide en todo queda condenado y lo
interrogan por el Profesor. Sin prueba, el detenido sale a los 10 min. Alcanzado tras huir: requisa (huir lo delata).
Como el cartel deja 5–15 parecidos a propósito, se detiene a inocentes: se cuenta.
Medido en 8 ciudades × 20 min: 50 robos, 21 golpes completos, 11 requisas, 11 detenciones (10 inocentes), 4 bolsas
encontradas buscando, 1 condena (el ladrón, confirmada por la cámara), 0 condenas de inocentes, 8 liberados sin prueba.
La policía todavía es débil: es lo próximo a calibrar.

**Equilibrio, primera vuelta (lotes de 16 ciudades × 30 min).** Todas las cifras de policía y ladrones son perillas
por corrida (`makeTown({tuning})`, `TUNING` en capas.js). Medida: de cada robo, si la policía recupera la bolsa
(requisa con la bolsa o la encuentra buscando) o si llega a la casa del ladrón.

| | recuperado | golpe completo | condenas | inocentes detenidos |
|---|---|---|---|---|
| Como estaba | 7 % | 39 % | 6 | 37 |
| **Responder a la alarma (la mitad de la policía va al robo)** — queda por defecto | 15 % | 37 % | 15 | 36 |
| Buscar la bolsa desde el robo (la mitad busca) | 14 % | 29 % | 8 | 17 |
| Las dos | 13 % | 31 % | 3 | 24 |
| Responder + parar más a quien coincide | 16 % | 33 % | 17 | 59 |
| Responder + buscar con un cuarto | 14 % | 32 % | 14 | 43 |
| Responder con toda la policía | 13 % | 30 % | 15 | 41 |
| Responder + el doble de policías | 16 % | 27 % | 17 | 67 |

Ninguna condena de inocentes en ninguna variante (la grabación completa deja a cualquiera único). Si la policía encuentra
la bolsa sin tener a quién comparar, la grabación completa pasa a ser el cartel. Lo aprendido: del lado de la policía
todo se estanca en 13–16 % (ni con el doble de policías pasa de 16 %): una vez escondida la bolsa, al ladrón le basta
esperar y volver. Los próximos pasos son del lado del ladrón: que esconder la bolsa sea visible o arriesgado, que volver
por ella lo sea (la policía puede vigilar una bolsa encontrada en vez de llevársela), o que la bolsa se vea en las
cámaras de las puertas. Trampa: con la búsqueda, al principio buscaba TODA la policía y nadie patrullaba (0 detenciones).

**Cámaras de calle y persecución en equipo (ideas de Miguel).**
- Cámaras de calle: el 40 % de las canecas tiene una cámara (`streetCamShare`). Graba; la policía no la mira en vivo.
  Al encontrar una bolsa, si la caneca tenía cámara, la foto de quién la escondió valida al culpable (condena e
  interrogatorio); si no, se usa la grabación de la caja fuerte. Sin detenido que coincida, la foto pasa a ser el cartel.
- Persecución: cuando un ladrón corre, se suman los policías en la calle a menos de 40 m; son algo más lentos (2,3 m/s
  contra 2,6) pero van a donde va a estar el ladrón, así lo rodean; lo atrapan si lo tocan (1 m). El dron sigue al
  ladrón al aire libre (ve 22 m) y le pasa la posición a todos. El ladrón busca cortar la vista metiéndose en un
  edificio (nunca el suyo: delataría el hangar) y sube a esconderse; si nadie lo ve en 20 s, escapó y la policía sigue
  buscando por ahí. Un ladrón visto entrando a su casa con la bolsa o perseguido delata el hangar (se cuenta).
- Medido con el ladrón corriendo siempre (8 ciudades × 20 min): 13 persecuciones, 10 atrapados, 3 escapes; se metió en
  un edificio 9 veces (varias lo alcanzaron en la puerta). El dron no cambió nada todavía: los policías casi siempre
  están a menos de 25 m y ya lo ven. Con los valores normales hay pocas persecuciones (5–8 en 16 ciudades × 30 min),
  porque casi nunca paran a un ladrón con la bolsa encima.

**Equilibrio, segunda vuelta (16 ciudades × 30 min).** Perillas nuevas: la policía mira en el momento las cámaras de las
puertas del edificio robado (`doorCamLive`: el ladrón sale con la bolsa en ~60 % de los robos y queda el aviso de por
dónde y cuándo); una bolsa de botín en la calle llama la atención (`bagVisible`); una bolsa encontrada en una caneca se
deja y un policía la vigila 3 min (`stakeout`; el ladrón lo nota el 35 %: `pNotice`); la policía corre hacia una alarma o
un aviso (`rush`); la alarma suena al empezar a abrir la caja fuerte (`alarmAtStart`).

| | recuperado | golpe completo | condenas | inocentes detenidos | persecuciones (atrapados) |
|---|---|---|---|---|---|
| Sin las de esta vuelta | 11 % | 36 % | 9 | 30 | 5 (5) |
| Cámaras de puerta + bolsa visible | 11 % | 35 % | 11 | 42 | 7 (6) |
| Vigilar la bolsa | 14 % | 38 % | 12 | 29 | 4 (4) — 3 emboscadas |
| Las tres + la policía corre | 14 % | 34 % | 13 | 40 | 11 (6) |
| **+ alarma al empezar** — queda por defecto | **15 %** | 35 % | **17** | 30 | 14 (13) |
| + alarma al empezar, sin correr | 12 % | 33 % | 12 | 42 | 10 (8) |

Ninguna condena de inocentes. Contando sólo los robos que terminaron (golpe o recuperado), los ladrones ganan ~70 %.
La policía se estanca en 11–16 % recuperado con cualquier combinación: 3 policías (en 3 contra 3) para unas 200
personas y ~90 edificios no alcanzan a llegar antes de que la bolsa desaparezca. Decisión pendiente (de diseño, no de
bots): qué proporción se busca, y si se logra con más policía, menos lugares donde esconder, o achicando la zona.

**Equilibrio, tercera vuelta: oficiales + bots de apoyo (decisión de Miguel).** Los ladrones son pocos; la policía la
forman oficiales que manejarán jugadores reales más bots de apoyo. La perilla es cuántos bots por oficial (`apoyo`).
Con las mejoras de la segunda vuelta, sumar policía rinde mucho más que antes (antes, el doble sólo llegaba a 16 %):

| Policía (16 ciudades × 30 min) | recupera | golpe completo | la policía gana, de los robos terminados | condenas |
|---|---|---|---|---|
| Sólo oficiales | 15 % | 35 % | 30 % | 17 |
| **1 bot de apoyo por oficial** — queda por defecto | 27 % | 26 % | **51 %** | 24 |
| 2 bots por oficial | 46 % | 22 % | 68 % | 39 |

Por tamaño, con 1 bot por oficial: 47 % en 2 contra 2, 58 % en 5 contra 5, 40 % en 8 contra 8 (muestras chicas, 27–49
robos). Ninguna condena de inocentes. Ojo: en la simulación todos son bots; un jugador real decide mejor que un bot,
así que con personas puede hacer falta menos apoyo. Se ve en el mapa: rombo oscuro = oficial, celeste = apoyo.

**La partida: 3 golpes (idea de Miguel).** Ganan los ladrones al completar 3 golpes entre todos (3 bolsas llevadas a
casa); gana la policía si condena a todos los ladrones o si pasan 30 min (`metaGolpes`, `duracion`). % de partidas que
ganan los ladrones (24 partidas por fila, ±10; en 8 contra 8, 8 partidas):

| | sin apoyo | 1 bot por oficial | 2 bots | 4 bots |
|---|---|---|---|---|
| 2 contra 2 | **42 %** | 8 % | — | — |
| 3 contra 3 | 71 % | **42 %** | 17 % | — |
| 5 contra 5 | — | **50 %** | — | — |
| 8 contra 8 | — | 88 % | 75 % | 75 % |

Queda por defecto el apoyo por tamaño (`APOYO_POR_EQUIPO`: 0 / 1 / 1 / 2). Los ladrones que ganan tardan ~23 min (de
30). En 8 contra 8 ningún apoyo empareja: ocho ladrones robando en paralelo juntan 3 golpes aunque la policía frene
muchos (ni con 4 bots por oficial baja de 75 %). Para ese tamaño haría falta otra meta (más golpes, o que un golpe
cuente sólo si lo hace la banda junta) o limitar los robos simultáneos. En `/capas`: «Golpes x / 3 · quedan mm:ss» y un
cartel al terminar (la simulación sigue).

**Cuántos ladrones por mapa (2026-10-10).** La cantidad de ladrones ya no está atada a los jugadores
(`makeTown({ladrones})`). Para cada mapa, con su policía fija (oficiales + el apoyo de la tabla), % de partidas que
ganan los ladrones (meta 3 golpes, 30 min; 16 partidas en los mapas de 2 y 3, 10 en el de 5, 6 en el de 8: mucho ruido):

| Mapa (policía) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| 2 contra 2 (2 + 0) | 0 % | **44 %** | 69 % | 94 % | | | | |
| 3 contra 3 (3 + 3) | | 0 % | **31 %** | **31 %** | 88 % | | | |
| 5 contra 5 (5 + 5) | | | 10 % | 10 % | 80 % | 80 % | 90 % | |
| 8 contra 8 (8 + 16) | | | | 0 % | | **50 %** | | 100 % |

Lo que dice: el paso es brusco (un ladrón más pasa de perder casi siempre a ganar casi siempre), así que el ajuste fino
conviene hacerlo con los bots de apoyo, no con los ladrones. Rangos razonables: mapa de 2 → 2–3 ladrones; de 3 → 3–4;
de 5 → 4–5; de 8 → ~6. Policías por ladrón en el punto parejo: ~1 (mapa de 2), ~1,7 (de 3), ~2,2 (de 5), ~4 (de 8): los
mapas grandes necesitan más policía por ladrón (más lugares donde esconderse y más camino).

**El Profesor en `/capas` y los mínimos y máximos (2026-10-10, ideas de Miguel).** La policía también gana si atrapa al
Profesor, aunque no tenga a toda la banda. El Profesor elige un hangar (un edificio que no se roba ni es la comisaría, de
la mitad más lejana a la comisaría) y se queda en un cuarto de algún piso; los ladrones llevan ahí las bolsas. Cada
ladrón condenado da una pista más precisa (mitad del mapa → cuadrante → manzana); con 15 edificios candidatos o menos, la
parte de la policía que busca los allana piso por piso, y si entra al piso del Profesor lo atrapa. Si alguien ve a un
ladrón entrar al hangar con la bolsa o perseguido, ya se sabe cuál es.

Barrido en paralelo (meta 3 golpes, 30 min; mapa = tamaño de ciudad de 2, 3, 5 u 8 jugadores por equipo; oficiales =
ese número; % de partidas que ganan los ladrones; 40 partidas por casilla en el mapa de 2, 30 en el de 3, 16 en el de 5,
8 en el de 8):

| Mapa | ladrones | bots de apoyo → ganan los ladrones |
|---|---|---|
| 2 | 2 | 0 → 35 % · 1 → 25 % · 3 → 10 % |
| 2 | 3 | 0 → 80 % · 1 → 58 % · **2 → 40 %** · 3 → 40 % |
| 2 | 4 | 0 → 93 % · 2 → 70 % · 3 → 65 % · **4 → 35 %** |
| 3 | 2 | 0 → 13 % · 1 → 20 % (ni sin apoyo llegan: mínimo 3) |
| 3 | 3 | 0 → 40 % · **2 → 50 %** · 3 → 20 % · 4 → 37 % · 6 → 33 % |
| 3 | 4 | 2 → 57 % · 3 → 60 % · **4 → 50 %** · 6 → 33 % |
| 3 | 5 | 3 → 57 % · 4 → 73 % · 6 → 63 % · **8 → 43 %** |
| 5 | 3 | 0 → 38 % · **2 → 44 %** · 5 → 19 % |
| 5 | 4 | 2 → 63 % · **5 → 50 %** · 8 → 44 % |
| 5 | 5 | 2 → 75 % · 5 → 69 % · **8 → 44 %** · 12 → 31 % |
| 5 | 6 | 5 → 56 % · **8 → 50 %** · 12 → 44 % |
| 5 | 7 | 5 → 94 % · 8 → 81 % · 12 → 69 % · **16 → 44 %** |
| 8 | 5 | **8 → 50 %** · 16 → 38 % |
| 8 | 6 | 8 → 63 % · **16 → 50 %** · 24 → 50 % |
| 8 | 8 | 16 → 88 % · **24 → 50 %** · 32 → 25 % |

Quedó como tabla (`RANGO_LADRONES`, `BOTS_PAREJO` en capas.js): mapa de 2 → 2–4 ladrones; de 3 → 3–5; de 5 → 3–7; de 8 →
5–8. Con más ladrones hacen falta muchos más bots (en el mapa de 5, de 3 a 7 ladrones el apoyo pasa de 1 a 16). Con más
bots crece la captura del Profesor (en el mapa de 2 con 4 ladrones y 4 bots, 21 de 40 partidas terminan así). Ruido: ±8
puntos en el mapa de 2, ±9 en el de 3, ±12 en el de 5, ±17 en el de 8.

**Cómo entrar a jugar (propuesta para el multijugador, de Miguel y mía):** no elegir rol. Entrar a un mapa es entrar a una
sala; la partida empieza cuando se junta el mínimo, y el sistema reparte los roles para quedar dentro del rango de
ladrones del mapa; los bots de apoyo salen de la tabla según cuántos ladrones quedaron. Los que entran por invitación
caen en el mismo equipo (como en Age of Empires). Quien quiera ser ladrón lo marca como preferencia, no como derecho, y
si sobran ladrones rota quien lo fue la vez anterior: casi todos van a querer ser ladrón, por eso el rango tiene que
estar bien medido.

**Patrulleros (idea de Miguel).** La policía que va a una alarma, a un aviso o a una persecución lejana (a más de 50 m)
va en auto por la calle a 8 m/s (el tráfico se orilla); a menos de 20 m se baja y sigue a pie. Patrullar sigue siendo a
pie (`car` en capas.js; prendido por defecto desde la medición de abajo). % de partidas que ganan los ladrones (30 partidas en 3 contra 3, 16 en 5
contra 5, 8 en 8 contra 8):

| | bots | a pie | con patrullero |
|---|---|---|---|
| 3 contra 3 | 0 | 43 % | 47 % |
| 3 contra 3 | 2 | 23 % | 37 % |
| 5 contra 5 | 0 | 81 % | 81 % |
| 5 contra 5 | 2 | 81 % | 63 % |
| 5 contra 5 | 8 | 50 % | 31 % |
| 8 contra 8 | 0 | 88 % | 75 % |
| 8 contra 8 | 16 | 100 % | 63 % |
| 8 contra 8 | 24 | 50 % | 25 % |

El patrullero ayuda cuando hay bastante policía (en 5 contra 5 con 8 bots baja de 50 % a 31 %; en 8 contra 8 con 24, de
50 % a 25 %), pero con números iguales casi no cambia nada (5 contra 5: 81 % y 81 %): llegar rápido sirve si alguien
puede aprovecharlo (allanar, revisar canecas, cortar la huida). Con patrulleros hacen falta menos bots: la tabla re-medida
está abajo. (Ruido: 3 contra 3 con 2 bots a pie da 23 % acá y dio 50 % en el
barrido anterior con la misma regla y otras semillas; con 30 partidas el margen es grande.)

**Bots parejos con patrulleros (re-medido 2026-10-10).** Bots de apoyo (en total) que dejan la partida cerca del 50 %;
entre paréntesis, el % que ganan los ladrones con esa cantidad. 40 partidas por casilla en el mapa 2, 30 en el 3, 16–32
en el 5 y 8–16 en el 8 (margen ±8, ±9, ±9–12, ±12–17):

| mapa | ladrones | a pie | con patrullero |
|---|---|---|---|
| 2 contra 2 | 2 | 0 | 0 (35 %: aun sin bots pierden los ladrones) |
| 2 contra 2 | 3 | 2 | 2 (53 %) |
| 2 contra 2 | 4 | 4 | 3 (53 %) |
| 3 contra 3 | 3 | 2 | 0 (40 %; con 1 bot ya 23 %) |
| 3 contra 3 | 4 | 4 | 2 (53 %) |
| 3 contra 3 | 5 | 8 | 6 (53 %) |
| 5 contra 5 | 3 | 1 | 0 (44 %) |
| 5 contra 5 | 4 | 5 | 2 (56 %) |
| 5 contra 5 | 5 | 8 | 5 (4 → 47 %, 6 → 59 %) |
| 5 contra 5 | 6 | 8 | 8 (47 %) |
| 5 contra 5 | 7 | 16 | 13 (12 → 56 %, 16 → 31 %) |
| 8 contra 8 | 5 | 8 | 8 (50 %) |
| 8 contra 8 | 6 | 16 | 13 (12 → 56 %, 16 → 38 %) |
| 8 contra 8 | 7 | 20 | 15 (interpolado, sin medir) |
| 8 contra 8 | 8 | 24 | 16 (50 %; 24 → 38 %) |

El patrullero ahorra bots, y más cuanto más grande el mapa: casi nada en el 2, unos 2 en el 3, hasta 3 en el 5 y hasta 8
en el 8. Los rangos de ladrones no cambian: el mínimo de cada mapa sigue siendo donde, sin bots, los ladrones ya ganan
cerca de la mitad (2 contra 2 queda corto: 35 %). Va en `BOTS_PAREJO` (capas.js).

**Cansancio (idea de Miguel, 2026-10-10).** Correr a fondo (huir, perseguir, ir corriendo a una alarma) gasta el aire en
30 s; sin aire se trota a 1,6 m/s hasta recuperar el 40 %. Caminar, quedarse o ir en patrullero lo recupera (60 s de
0 a 1). `cansancio` en capas.js, **apagado por defecto**: medido, no cambia el balance. % que ganan los ladrones con los
bots parejos de la tabla de arriba, sin y con cansancio:

| | sin | con |
|---|---|---|
| 2 contra 2 · 2, 3, 4 ladrones | 35 · 53 · 53 % | 35 · 48 · 58 % |
| 3 contra 3 · 3, 4, 5 ladrones | 40 · 53 · 53 % | 50 · 57 · 50 % |
| 5 contra 5 · 4, 5, 6 ladrones | 56 · 53 · 47 % | 44 · 53 · 50 % |
| 8 contra 8 · 6, 8 ladrones (8–16 partidas) | 13 · 50 % | 38 · 13 % |

Todo dentro del ruido salvo quizás el mapa 8, que con 8–16 partidas no se puede leer. Por qué no ayuda: en la
simulación hay ~1 persecución por partida y casi siempre termina en captura en los primeros segundos (1,0 de 1,1 en 3
contra 3), antes de que nadie se canse. Los que se quedan sin aire son los policías que van corriendo a pie a una
alarma (28–48 veces por partida): llegan más lento y los ladrones roban un poco más (7,2 → 8,0 en 3 contra 3), lo que
compensa. Con jugadores reales, que esquivan mejor que los bots, las persecuciones serían más largas y ahí el aire sí
pesaría: vale volver a medirlo cuando haya persecuciones de verdad.

**Balines (idea de Miguel, 2026-10-10).** Arma no letal: el policía a pie que ve al que huye en la calle le dispara si
está a menos de 12 m, uno cada 3 s y hasta 6 por partida. Acierta 70 % pegado y menos con la distancia (a 12 m, nunca);
el resto lo esquiva. Un acierto lo deja 4 s sin moverse y la policía lo alcanza. `balines` en capas.js, **apagado por
defecto**. % que ganan los ladrones con los bots parejos, sin y con balines:

| | sin | con |
|---|---|---|
| 2 contra 2 · 2, 3, 4 ladrones | 35 · 53 · 53 % | 35 · 48 · 55 % |
| 3 contra 3 · 3, 4, 5 ladrones | 40 · 53 · 53 % | 43 · 47 · 70 % |
| 5 contra 5 · 4, 5, 6 ladrones | 56 · 53 · 47 % | 25 · 66 · 56 % |
| 8 contra 8 · 8 ladrones | 50 % | 44 % |

Sube y baja sin dirección: ruido. Lo que sí cambia es la persecución por dentro: ~1,4–2,3 disparos y ~0,7–1,1
aciertos por partida, y el ladrón casi no llega a esconderse en un edificio (refugios 0,9 → 0,2 en 3 contra 3; 1,0 →
0,3 en 5 contra 5). Pero la persecución ya terminaba en captura casi siempre (1,0 de 1,1), así que no mueve el
resultado. Igual que el cansancio: **la partida no se decide en la persecución sino en la investigación** (pistas,
detenciones, interrogatorios, allanamientos). Para ayudar a la policía en los números, la perilla está ahí; los
balines y el cansancio son para cuando los jugadores reales hagan persecuciones más largas.

**La vara de la tensión (2026-10-10, `src/engine/tension.js`).** No quién gana sino si la partida estuvo buena. Se mira
una vez por segundo: el avance de los ladrones (golpes / 3) y el de la policía (pistas del Profesor / 4, atraparlo es
4/4, o la parte de la banda condenada). Por partida: **apretada** (el que perdió estaba a un paso: 2 de 3 golpes, o la
policía con 2 pistas o media banda presa), **cambio de líder** (la resta de avances cambia de signo), **hueco** (el tramo
más largo sin un hito: robo, golpe, persecución, detención, condena, pista o allanamiento), **tiempo muerto** (la parte
de la partida en huecos de más de 3 min) y **por tiempo** (terminó porque se acabaron los 30 min). Con los bots parejos y
patrulleros, 290 partidas:

| | ganan ladrones | apretadas | por tiempo | con cambio de líder | min | hueco máx | tiempo muerto |
|---|---|---|---|---|---|---|---|
| 2 contra 2 · 2, 3, 4 ladrones | 35 · 53 · 53 % | 40 · 30 · 28 % | 55 · 23 · 15 % | 15 · 25 · 48 % | 28 · 23 · 19 | 7,6 · 5,7 · 5,1 | 34 · 20 · 13 % |
| 3 contra 3 · 3, 4, 5 | 40 · 50 · 53 % | 50 · 30 · 27 % | 53 · 10 · 7 % | 40 · 50 · 43 % | 26 · 22 · 19 | 7,2 · 5,6 · 4,6 | 30 · 19 · 11 % |
| 5 contra 5 · 4, 5, 6 | 56 · 53 · 25 % | 25 · 38 · 25 % | 25 · 9 · 0 % | 56 · 56 · 13 % | 24 · 20 · 18 | 6,6 · 5,0 · 4,6 | 25 · 15 · 12 % |
| 8 contra 8 · 6, 8 (8 partidas) | 13 · 63 % | 13 · 38 % | 13 · 0 % | 13 · 63 % | 18 · 19 | 4,1 · 4,5 | 8 · 11 % |
| **todo** | **47 %** | **33 %** | **23 %** | **38 %** | **22** | **5,7** | **20 %** |

Lo que dice: (1) **parejo no es lo mismo que bueno**: sólo una de cada tres partidas termina apretada. (2) **Pocas
remontadas**: en el 62 % nadie pasa adelante del otro nunca. (3) **Cuando ganan los ladrones, la policía casi nunca
avanzó**: en la mitad (66 de 135) terminó con 0 pistas del Profesor; las dos carreras (golpes y Profesor) casi no se
tocan. (4) **Con el mínimo de ladrones la partida se aburre**: 2 contra 2 y 3 contra 3 con 2 o 3 ladrones terminan por
tiempo más de la mitad de las veces, con un tercio del tiempo muerto y huecos de más de 7 min. Con más ladrones pasa más
(1,8–2,4 hitos por minuto contra 0,4–0,6).

**Disfraz (idea de Miguel, 2026-10-10).** Después de esconder la bolsa, el ladrón va a un cuarto cercano (a menos de
40 m), tarda 20 s y se cambia dos de las cosas que se cambian rápido (gorra o sombrero, lo de encima, mochila, gafas:
lo que lleva se lo saca, lo que no lleva se lo pone; `disfrazar` en rasgos.js). Desde ahí lo ven así la policía, los
testigos y las cámaras, y el cartel viejo deja de coincidir; las grabaciones lo siguen probando (al validar una bolsa
se compara con cómo estaba vestido en cualquier momento). `disfraz` en capas.js (80 % de las veces), **apagado por
defecto**. Sin → con, en las mismas 290 partidas: ganan los ladrones 47 → 48 %, apretadas 33 → 38 %, con cambio de
líder 38 → 41 %, por tiempo 23 → 26 %, tiempo muerto 20 → 22 %. Todo dentro del ruido: el disfraz no rompe el
equilibrio (no hay que tocar los bots) y quizás aprieta un poco, pero tampoco arregla el aburrimiento. Le da al ladrón
algo que hacer y a la policía carteles que se vuelven viejos: vale para jugadores reales, no para los números.

**Cuerpo y vestimenta; la ficha (idea de Miguel, 2026-10-11).** Los rasgos se separan en **cuerpo** (altura —nueva: baja,
media o alta, 25/50/25 %, se ve de lejos—, piel, peinado, color de pelo, barba, ojos: `cuerpo` en rasgos.js) y
**vestimenta** (todo lo demás). El disfraz cambia sólo vestimenta, ahora también la ropa de arriba (otra prenda de otro
color) y el color del pantalón. **La ficha** (`ficha` en capas.js, apagada por defecto): cada robo le deja a la policía
un rasgo nuevo del cuerpo del ladrón, de los que vio la cámara de la caja fuerte (`fichaPorRobo`), y la ficha no vence.
Con 2 rasgos visibles que coinciden y ninguno que contradiga (`fichaMin`), la policía lo para como a quien coincide con
el cartel; de cerca, si el cuerpo coincide, lo requisa (sin la bolsa, detenido). Tres rasgos ya dejan a 1–3 personas en
la ciudad. Base → ficha → ficha y disfraz, 290 partidas cada una:

| | base | ficha | ficha y disfraz |
|---|---|---|---|
| ganan los ladrones | 47 % | 43 % | 44 % |
| apretadas | 33 % | 34 % | 37 % |
| con cambio de líder | 38 % | 41 % | 41 % |
| por tiempo | 23 % | 28 % | 30 % |
| atraparon al Profesor | 84 | 79 | 66 |
| ganan los ladrones con la policía en 0 | 66 de 135 (49 %) | 45 de 124 (36 %) | 51 de 129 (40 %) |

La ficha hace que la policía no empiece de cero (menos partidas sin ninguna pista) y le da una ayuda leve, y el disfraz
casi no la esquiva (el cuerpo no se cambia). Pero no cruza las carreras: la ficha DETIENE más y CONDENA igual, porque
condenar sigue pidiendo encontrar la bolsa. El detenido pierde tiempo, la partida se alarga y termina más por tiempo, y
al Profesor se llega menos. El cuello de botella es detenido → bolsa → condena → interrogatorio.

**Parecidos (idea de Miguel, 2026-10-11).** Elija lo que elija cada ladrón, una parte de la ciudad se le parece:
`parecidos` (qué parte de la gente toma a un ladrón de modelo) y `parecidoFiel` (.8: con qué probabilidad copia cada
rasgo); `parecidoRasgos` 'todo' o 'cuerpo'. Apagado por defecto. `makeTown` acepta `looks` (los looks que elijan los
jugadores para sus ladrones). Parecidos con la ficha del cuerpo (191 personas, 4 ladrones):

| rasgos del cuerpo en la ficha | 1 | 2 | 3 | 4 | 6 | cartel de lejos |
|---|---|---|---|---|---|---|
| sin parecidos | 76 | 2,0 | 0,3 | 0 | 0 | 2,8 |
| 20 % parecidos | 76 | 7,3 | 5,3 | 4,8 | 3,3 | 7,0 |
| 30 % parecidos | 79 | 10,8 | 8,3 | 7,3 | 5,3 | 9,8 |

Con la ficha prendida, 102 partidas por variante (2 contra 2 con 3 ladrones, 3 contra 3 con 4, 5 contra 5 con 5):

| | sin parecidos | 20 % | 30 % |
|---|---|---|---|
| ganan los ladrones | 44 % | 50 % | 66 % |
| apretadas | 33 % | 34 % | 28 % |
| con cambio de líder | 39 % | **52 %** | 49 % |
| por tiempo | 25 % | 24 % | 22 % |
| tiempo muerto | 16 % | 13 % | 14 % |
| atraparon al Profesor | 31 | 24 | 10 |
| detenidos por partida (inocentes) | 5,7 (5,0) | 9,4 (8,8) | 10,7 (10,1) |
| condenados inocentes por partida | 0 | 0,24 | 0,33 |

El 20 % es el punto: deja el balance como estaba (50 %, sin tocar los bots), sube las remontadas (39 → 52 %) y baja un poco
el tiempo muerto. Con 30 % la policía se ahoga en falsos positivos y casi no llega al Profesor (66 % para los ladrones:
habría que recalibrar los bots). Ya sin parecidos casi 9 de cada 10 detenidos son inocentes; con parecidos aparecen
condenas de inocentes (la grabación coincide con un parecido): hoy no le cuestan nada a la policía.

**La orden y la cacería (diseño de Miguel, 2026-10-11).** `orden` en capas.js (apagada por defecto; en `/capas`, el
interruptor «Regla de la orden»). Reglas:
- La policía sólo gana atrapando al Profesor. Los ladrones ganan con 3 golpes o si se acaba el tiempo sin orden.
- Sin orden, la policía sólo entra a lugares públicos (lo que se puede robar): no revisa cuartos de casas ni
  apartamentos (una bolsa escondida ahí está a salvo).
- Cada ladrón condenado entrega una pieza: la zona (cuadrante), el edificio (el Profesor queda marcado en el mapa) y la
  habitación exacta (causa probable: orden de allanamiento). Con dos ladrones hacen falta el edificio y la habitación;
  con uno, la habitación. Ver a un ladrón entrar al hangar da el edificio.
- Con la orden se cortan las persecuciones y toda la policía va al hangar. La cacería empieza cuando un policía llega a la
  puerta (a las afueras, cuando está a menos de 60 m: el Profesor los ve venir) y dura 5 min; el reloj de la partida se
  detiene. El rastreo da la posición del Profesor cada 12 s (pulso); entre pulsos, la policía va al último (la mitad
  cerca la manzana desde la calle). La banda puede completar el tercer golpe durante la cacería.
- Azoteas: cada edificio tiene una, encima del último piso, por la escalera; las de la misma manzana que se tocan se
  unen. Sólo las usan el Profesor y la policía en la cacería. El Profesor huye al punto (azotea de la manzana, planta baja
  vecina o calle) más lejos de la policía y cuyo camino no pase cerca de un policía; rehace el plan cada 5 s.
- Hangar `ciudad` (un edificio de la mitad lejos de la comisaría), `afueras` (una casa en el borde del mapa; el Profesor
  huye en carro a 7,5 m/s) o `mixto`. Todavía no hay un anillo de afueras de verdad: es el borde de la ciudad.
- `carSoloOficiales`: el patrullero es de los oficiales (los jugadores); los bots van a pie.

Primera medición (2026-10-11; 30 partidas por casilla en el mapa 2 y 3, 16 en el 5, 8 en el 8):

| | hangar | bots | ganan ladrones | apretadas | cambio de líder | tiempo muerto | llegan a la cacería | piezas (prom.) |
|---|---|---|---|---|---|---|---|---|
| 2 vs 2 · 3 ladrones | ciudad | 2 · 5 | 90 · 83 % | 50 · 57 % | 53 · 37 % | 32 % | 13 · 20 % | 1,6 · 1,8 |
| | afueras | 2 · 5 | 83 · 70 % | 47 · 57 % | 40 · 43 % | 31 % | 20 · 33 % | 1,6 · 2,1 |
| 3 vs 3 · 4 ladrones | ciudad | 2 · 6 | 80 · 77 % | 27 · 47 % | 40 · 67 % | 21 % | 23 · 37 % | 1,3 · 1,9 |
| | afueras | 2 · 6 | 77 · 57 % | 43 · 43 % | 50 · 67 % | 20 % | 37 · 50 % | 1,6 · 2,1 |
| 5 vs 5 · 5 ladrones | ciudad | 5 · 10 | 50 · 63 % | 25 · 25 % | 25 · 38 % | 19 % | 56 · 44 % | 1,9 · 1,9 |
| | afueras | 5 · 10 | 56 · 38 % | 38 · 50 % | 50 · 44 % | 22 % | 50 · 69 % | 2,0 · 2,6 |
| 8 vs 8 · 8 ladrones | ciudad | 16 · 24 | 100 · 75 % | 63 · 50 % | 75 · 50 % | 14 % | 38 · 38 % | 2,0 · 2,0 |
| | afueras | 16 · 24 | 75 · 50 % | 63 · 25 % | 88 · 25 % | 15 % | 25 · 63 % | 1,8 · 2,3 |

Lo que dice: (1) **la tensión sube**: apretadas 25–63 % (antes 33 % en promedio) y cambio de líder hasta 67–88 %. (2)
**Llegar a la orden es el cuello de botella**: en 2 vs 2 con 3 ladrones hay que condenar a los tres, y la mitad de las
partidas termina por tiempo sin orden (13–15 de 30); en los mapas grandes la banda junta 3 golpes antes. (3) **La cacería
es fácil para la policía**: de 118 cacerías, el Profesor cayó en 92 (78 %), escapó en 19 (16 %) y en 7 la banda completó
el tercer golpe. Con pulsos cada 12 s y toda la policía encima, 5 minutos sobran. (4) **El hangar a las afueras le
cuesta más a la banda** (más bolsa por camino abierto) de lo que la ayuda la huida en carro: los ladrones ganan
7–25 puntos menos. Perillas para lo que sigue: cuántas piezas pide la orden según el mapa, el pulso, los 5 min, y de
dónde más salen piezas (la ficha, ver entrar al hangar).

**Ajuste (2026-10-11).** (1) Piezas según el mapa (`PIEZAS_ORDEN`: 2 en los mapas 2 y 3 —el edificio y la habitación—,
3 en el 5 y el 8). (2) Cacería: pulso cada 20 s y 45 s de ventaja (lo que tarda la policía en entrar: el primer pulso
llega recién entonces). (3) Con el hangar a las afueras, la banda entrega en un **buzón**: una vivienda de la ciudad a
60–200 m del hangar, del lado del centro; ver a un ladrón entrar con la bolsa al buzón da la zona. (4) El Profesor
mantiene el rumbo hasta llegar o hasta que un policía queda a menos de 12 m de él o de su destino (antes rehacía el plan
cada 5 s y zigzagueaba), y huyendo no toma el ascensor. Probado sólo la cacería (orden forzada a los 2 min, 3 vs 3 con 4
ladrones y 6 bots, 16 cacerías): el Profesor escapa 2 de 16 con 20 s de ventaja, 4–7 con 45 s, 5–7 con 90 s; más
ventaja no ayuda pareja: el límite es cómo huye el bot.

Las tres rondas, en las mismas 336 partidas (mismas semillas y casillas que la tabla de arriba):

| | diseño | piezas por mapa + pulso 20 s + 20 s de ventaja + buzón | + 45 s de ventaja y rumbo firme |
|---|---|---|---|
| ganan los ladrones | 72 % | 59 % | 69 % |
| apretadas | 44 % | 49 % | **57 %** |
| por tiempo | 22 % | **5 %** | 5 % |
| tiempo muerto | 24 % | 20 % | 20 % |
| llegan a la cacería | 118 (35 %) | 178 (53 %) | 178 (53 %) |
| cacería: cae el Profesor / escapa / 3.er golpe | 94 / 19 / 5 | 138 / 32 / 8 | **104 / 62 / 12** |

Con la regla de la orden la partida es otra: más de la mitad termina apretada (era 33 % con las reglas viejas), casi
ninguna por tiempo, y la cacería quedó en 58 % para la policía. Lo que falta: la banda gana el 69 %, así que la tabla de
bots (`BOTS_PAREJO`) hay que medirla de nuevo para esta regla.

**Bots parejos con la regla de la orden (2026-10-11).** Hangar al azar, patrullero sólo para los oficiales (los bots a
pie); 30 partidas por casilla en el mapa 2, 24 en el 3, 12 en el 5 y 6 en el 8 (el 5 y el 8, con mucho ruido). Va en
`BOTS_ORDEN` y `RANGO_LADRONES_ORDEN` (capas.js; `botsParejos(team, ladrones, orden)`):

| mapa | ladrones | bots (orden) | bots (reglas viejas) |
|---|---|---|---|
| 2 vs 2 | 3 · 4 | 6 · 9 | 2 · 3 |
| 3 vs 3 | 3 · 4 · 5 | 7 · 9 · 12 | 0 · 2 · 6 |
| 5 vs 5 | 4 · 5 · 6 · 7 | 12 · 14 · 17 · 24 | 2 · 5 · 8 · 13 |
| 8 vs 8 | 5 · 6 · (7) · 8 | 16 · 20 · (28) · 36 | 8 · 13 · 15 · 16 |

El mínimo de ladrones sube: con tantos ladrones como piezas pide la orden (2 en el mapa 2, 3 en el 5), la policía tiene
que condenarlos a todos y la partida termina por tiempo (2 ladrones en el mapa 2: ganan 63–87 % aun con 4 bots; 3 en el
5: 67–92 % aun con 10). Rangos: 2 → 3–4, 3 → 3–5, 5 → 4–7, 8 → 5–8. Verificado con la tabla (192 partidas, interrogatorio
de 90 s): ganan los ladrones 51 %, apretadas 55 %, por tiempo 7 %.

**Mudanza del Profesor (2026-10-11).** Dos escondites de reserva del mismo tipo que el hangar (elegidos con su propio
azar). El interrogatorio tarda 90 s (`interrogaTime`); el Profesor se entera de la captura en el momento y, si todavía
no lo identificaron, puede mudarse (`mudanzas`, `pMudanza` .6): camina hasta el escondite nuevo y desde que sale las
bolsas van allá. El ladrón sólo sabe dónde estaba el hangar cuando lo agarraron: si el Profesor ya se fue, su pieza no
sirve («el escondite está vacío»); si se mudó de zona, la pieza de la zona tampoco. Con la tabla, sin → con mudanza:
ganan los ladrones 51 → 56 % (en los mapas 5 y 8, de 33–67 % a 67–92 %), apretadas 55 → 38 %, por tiempo 7 → 21 %.
Con 3 piezas, perder una casi no deja llegar a la orden. **Apagada por defecto** (`mudanzas: 0`) hasta suavizarla:
por ejemplo, que el escondite vacío deje un rastro (la zona del nuevo) en vez de nada.

**Órdenes a los bots (2026-10-11).** `mandar(t, {tipo, x, y})`: el oficial manda a los 4 bots libres más cercanos
(`mandoBots`) a ir a un punto, cercar un edificio (se reparten las puertas), revisar canecas o subir a la azotea (sólo
lugar público o con orden de allanamiento). Dura 2 min (`mandoDur`), 30 s entre órdenes (`mandoEspera`). En `/capas`,
el panel «Órdenes a los bots»: elegís la orden y hacés clic en el mapa. Órdenes automáticas (`mandosAuto`: cercar al
sonar una alarma, revisar canecas con un aviso, cercar el edificio del último pulso en la cacería), con mudanza: ganan los
ladrones 56 → **81 %**. Las órdenes ingenuas **empeoran** a la policía: los 4 bots se quedan 2 min en las puertas de un
edificio del que el ladrón ya salió y dejan de parar gente; en la cacería quedan pegados a un edificio cuando el Profesor
ya se fue. Una orden es una herramienta de habilidad: bien dada ayuda, mal dada cuesta. Para un bot que mande bien
haría falta otra lógica (órdenes cortas, soltar el cerco cuando el pulso sale del edificio).

**El Profesor prófugo (idea de Miguel, 2026-10-11).** `profugo` en capas.js (apagado por defecto; en `/capas`, el
interruptor «Profesor prófugo»). Reemplaza a la mudanza:
- El interrogatorio empieza al llegar a la comisaría: lo que tarda la patrulla desde donde agarraron al ladrón (línea
  recta ×1,3 a 8 m/s) más 30 s de trámite. Capturar cerca de la comisaría deja poco tiempo.
- El Profesor se entera cuando la policía va a tener su ubicación (una confesión que trae el edificio o la habitación, o
  un ladrón visto entrando al hangar). Si a la banda le falta más de un golpe, huye; si le falta uno, se queda y apuesta.
- Huir: se disfraza (3 prendas), camina al escondite de reserva más lejos de la comisaría, descansa 60 s y da **un solo
  golpe final** (40 s en la caja fuerte; suena la alarma) y lleva el botín a su escondite nuevo. La banda queda
  desarmada: sus bolsas ya no cuentan (siguen robando: distraen). La policía tiene su retrato: lo para si lo reconoce de
  lejos (o lleva la bolsa a la vista) y de cerca lo reconoce siempre por la cara.
- Gana la banda si el golpe final llega; gana la policía si lo atrapa o si se acaba el tiempo sin el golpe final.

Con la tabla de bots, 192 partidas, sin → con prófugo: ganan los ladrones 51 → 51 %, por tiempo 7 → 1 %, minutos 19 →
16. En 165 de 192 partidas (86 %) el Profesor huye; de esas, el golpe final llega en 64 (39 %), lo atrapan en 91 (55 %).
La vara de tensión marca apretadas 55 → 27 % y cambio de líder 34 → 10 %, pero no mide bien este final: mide la carrera
de golpes contra piezas, y el prófugo la reemplaza por un todo o nada. Lo que sí preocupa: **casi todas las partidas
terminan en el final del prófugo**, y temprano (en los mapas 2 y 3 la primera confesión ya trae el edificio). La banda
juega poco. Para que sea la excepción: que huya sólo ante la habitación exacta (la pieza de la orden), no ante el
edificio.

**Ajuste: huye sólo ante la habitación (`huyeCon: 3`, 2026-10-11).** Mismas 192 partidas; base (sin prófugo) → huye
con el edificio → huye con la habitación:

| | base | edificio | habitación |
|---|---|---|---|
| ganan los ladrones | 51 % | 51 % | 59 % |
| apretadas | 55 % | 27 % | **54 %** |
| cambio de líder | 34 % | 10 % | 31 % |
| por tiempo | 7 % | 1 % | 7 % |
| minutos | 19 | 16 | 20 |
| el Profesor huye | — | 165 (86 %) | 118 (61 %) |
| golpe final logrado (de las huidas) | — | 64 (39 %) | 39 (33 %) |

La banda vuelve a jugar la partida entera (20 min, apretadas como sin prófugo) y el prófugo aparece al final, cuando la
policía está por tener la orden. Todavía es lo más común (61 %): casi toda partida que llega a la orden termina en el
prófugo en vez de la cacería, porque el bot huye siempre que a la banda le falta más de un golpe. Con un jugador de
Profesor es su decisión. Para el bot, una regla con riesgo: huir sólo si el viaje a la comisaría le da tiempo
(capturar cerca de la comisaría lo deja sin salida). Los ladrones ganan 8 puntos más: con el prófugo prendido, la tabla
de bots necesitaría un poco más.

**La regla de riesgo (2026-10-11).** El bot huye sólo si le da el tiempo: disfrazarse (20 s), bajar los pisos hasta la
calle (6 s por piso) y `ventanaHuida` (45 s) de margen, contra lo que tarda la confesión (el viaje a la comisaría más
`tramite`, 60 s: con 30 s las ventanas eran de 33–48 s y nunca alcanzaba). Capturar a un ladrón cerca de la comisaría,
o tener al Profesor en un piso alto, lo deja sin salida: se queda y viene la orden. Mismas 192 partidas:

| | sin prófugo | huye con la habitación | + regla de riesgo |
|---|---|---|---|
| ganan los ladrones | 51 % | 59 % | **51 %** |
| apretadas | 55 % | 54 % | 47 % |
| cambio de líder | 34 % | 31 % | 32 % |
| por tiempo | 7 % | 7 % | 7 % |
| el Profesor huye | — | 118 (61 %) | **55 (29 %)** |
| golpe final logrado | — | 39 (33 %) | 19 (35 %) |

Finales con la regla de riesgo: 3 golpes 46 · Profesor atrapado (cacería o prófugo) 90 · escapa de la cacería 20 · golpe
final 19 · por tiempo sin orden 13 · prófugo sin golpe a tiempo 4. El balance vuelve al de la tabla (no hacen falta más
bots) y el prófugo queda como uno de varios finales. **Prendido por defecto** con la regla de la orden (`profugo: true`).

**Montaña y playa (idea de Miguel, 2026-10-11).** `terreno` en capas.js (en `/capas` va prendido con la regla de la
orden; el selector de hangar suma montaña y playa, y «al azar» elige entre los cuatro). Sin tocar el generador de la
ciudad (lo comparte el 3D): `addTerreno` agrega al este una franja de monte de 14 casillas con tres cabañas y un sendero
que sale del mapa por el norte, y al sur una franja de arena de 6 casillas con tres casas de playa, el mar y un muelle con
lancha. El borde de la ciudad es un muro con una circunvalación adentro: se abren salidas (carreteras) cada ~6 casillas.
Monte y arena se caminan más lento (monte ×0,65, el Profesor ×0,9: conoce los senderos; arena ×0,8), sin patrullero y
sin cámaras; por la arena pasea gente. Cabañas y casas son lotes de un piso agregados al final de `bp.lots`
(`town.cityLots` marca dónde termina la ciudad; el dibujo de la ciudad no los ve). Con el hangar ahí, la banda entrega en
un buzón de la ciudad y el Profesor ve venir a la policía (vigía, como en las afueras). En la cacería, si el Profesor
llega al muelle o al sendero y pasa `salidaTime` (25 s) ahí sin un policía a menos de 10 m, se escapa; en terreno
abierto el rastreo lo marca cada `pulsoAbierto` (10 s). Con la orden firmada, un tercio de la policía va derecho a
cubrir la salida.

Por tipo de hangar (2 vs 2 con 3 ladrones, 3 vs 3 con 4, 5 vs 5 con 5, 8 vs 8 con 8; bots de la tabla; 78 partidas por
tipo), ganan los ladrones:

| | ciudad | afueras | montaña | playa |
|---|---|---|---|---|
| primera versión | 58 % | 50 % | 77 % | 78 % |
| + 25 s para salir y pulso cada 10 s | | | 73 % | 71 % |
| + la policía cubre la salida desde la orden | | | **62 %** | **60 %** |
| apretadas (última) | 45 % | 49 % | 56 % | 53 % |
| escapes por la salida (última) | | | 6 | 6 |
| golpes finales del prófugo (última) | 2 | 7 | 12 | 13 |

Las cuatro ubicaciones quedan cerca (50–62 %). La montaña y la playa dan partidas más apretadas y el prófugo sale más
seguido y le va mejor ahí: el hangar lejos de la comisaría le da ventanas de huida más largas. En el primer intento la
salida era casi segura: la policía llegaba al muelle tan tarde como el Profesor.

**La isla del plano (2026-10-11).** La montaña y la playa de arriba eran franjas inventadas en capas.js; ahora la isla es
la del 3D, como datos (`src/engine/isla.js`) y como etapa 9 del plano (`GENERADOR.md`): pueblos con plaza, casas de playa,
fincas, cabañas, un refugio, puestos de policía en los pueblos de montaña, tiendas en los de costa, globo, parapente,
salidas del muro y senderos. En `/generador` es la etapa 9; en `/capas` va con la regla de la orden (perilla `isla`).
La simulación camina cada casilla de la isla (sendero ×1, pradera ×0,9, arena ×0,8, agua baja ×0,5, monte ×0,65; el
Profesor ×0,9 en el monte); el patrullero va por calles y senderos. Las camas de la isla se ocupan primero (unas 25–30
personas viven en los pueblos); los isleños trabajan, compran, visitan y pasean cerca de su casa (8 de cada 10 veces) y
la gente de la ciudad también baja a la arena y los senderos. Dos bots por puesto de policía tienen ahí su base (si
alcanzan los bots), y el interrogatorio se hace en la comisaría o el puesto más cercano. El hangar: playa → una casa de
playa, montaña → una cabaña o el refugio, afueras → una finca; el Profesor escapa en **globo** o en **parapente**.
**En el 3D (2026-10-11):** `/demo` le pasa el plano a la isla (`buildIsland(city,{plan})`) y las casas son las del plano
—mismo lugar, tamaño y lado de la puerta, con el armado de casas de island3d.js (cabaña de playa para las de playa y las
tiendas, finca para el resto; el puesto en azul, la tienda en naranja)—; sin plano, las de siempre al azar. Se dibujan
también las plazas (una loseta clara por casilla), los senderos (losetas de tierra cada 1,2 m), el globo (inflado y atado
en la arena) y el parapente (el ala tendida al borde del acantilado). Árboles, rocas y huertas no crecen sobre plazas,
senderos, salidas, el globo ni el parapente. Las losetas de senderos y plazas y el parapente se inclinan con la
pendiente del lugar. Sin zócalo: cada casa del plano se asienta al nivel del suelo frente a su
puerta y el terreno se rebaja o se rellena alrededor (plano en la casa más 2,5 m, empalma con la ladera en 6 m), así se
camina alrededor y se entra a todas; todo lo que mira la altura (terreno, árboles, senderos, gente) ve el desbaste. Pendiente: las casas del 3D tienen su propio interior, no el del plano.

**Terrazas y carreteras de montaña (idea de Miguel, 2026-10-11).** Los pueblos van en terrazas: en el plano, cada casilla
del pueblo toma un nivel (escalones de 3 m desde la plaza); en el 3D, un bloque de piedra por casilla (sus costados son el
muro de contención) con la meseta encima —pasto, plaza o sendero— y una escalera donde el sendero baja a otra meseta; la
malla del terreno queda por debajo de los bloques y alrededor empalma en 6 m. Carreteras de dos carriles desde las
salidas hasta cada pueblo de montaña y el refugio (no al parapente: ahí se llega a pie), con pendiente de hasta 12 % por
tramo: la ladera obliga al zigzag (medido en tres ciudades: pendiente media 8–12 %, de 4 a 98 curvas según el largo; quedan
picos sueltos que el 3D alisa). En el 3D el trazado se suaviza, la altura es el terreno promediado a lo largo (~30 m), el
terreno se corta o se rellena a lo ancho y empalma en 5 m; asfalto con la línea amarilla y baranda del lado del barranco.
En la simulación la carretera es de tipo `carretera` (patrulleros y el carro del Profesor), y la ruta ahora cuenta lo rápido
que se camina en cada suelo (`vel`), así prefiere senderos y carreteras. Pendiente: en la simulación los muros de las
terrazas todavía no frenan el paso (se cruza de una meseta a otra por cualquier lado).

**Carreteras conducibles (2026-10-11).** Por ahora sin casas en la montaña (`SIN_MONTAÑA` en blueprint.js). La montaña es
más tendida: sube hasta el acantilado (`MONTE.subida:'borde'` en isla.js; la mediana de su pendiente baja de 55–71 % a
42–53 %). Las carreteras salen de 3–4 puertas que miran a la montaña (separadas) y cada una sube su lado en
**serpentina** (`CARRETERA.modo`), como se construye una de verdad: tramos en diagonal por la ladera con el rumbo que
sube ~9 % (corregido para seguir pegado al terreno), no más de 10° de giro cada 3 m; la altura de la carretera nunca
cambia más de 12 % y donde el terreno se aparta se corta o se rellena (hasta 6 m). Al final de cada tramo, una horquilla
de 9 o 12 m de radio (subiendo hasta 10 %) en el lugar de los últimos 60 m que pida menos corte (un lomo); si no hay, el
tramo sigue hasta 3×45 m más. Una carretera no pasa a menos de 10 m de otra (empalma) ni de un tramo propio. Termina
cerca de la cima de su lado o donde no se puede seguir sin forzar. Guarda su trazado y su perfil (`puntos`): el 2D lo
dibuja como cinta de asfalto y el 3D lo usa tal cual.

Lo que se probó y no alcanzó: buscar el camino en la grilla con pendiente máxima (8 direcciones: llega a 8–36 m; con 24,
a la cima pero con curvas de 0,5–1,7 m de radio, imposibles para un carro; limitando el giro a 46° por tramo, curvas de
6 m pero sólo llega a 20–44 m: dar media vuelta en una ladera de 45 % necesita construir la horquilla). Alisar el
terreno no cambió nada.

Medido en 5 ciudades: pendiente máxima 12,0 %; corte en el eje 2,6 m en el 90 % (máx. 7,2 m) y de costado 4,8 m; radio
mínimo de curva 8,2 m (una horquilla real, 10–15 m; un carro necesita 6–8); la carretera más alta de cada ciudad llega a
46–75 m de cimas de 81–111 m. Arriba de eso la montaña es demasiado empinada y no se fuerza. La etapa tarda ~0,16 s.

**Ajuste (pedido de Miguel, 2026-10-11).** Las carreteras salen de calles reales: donde una calle llega a la
circunvalación (perpendicular al muro), el muro se abre en su línea y la carretera la sigue (`gates[].calle`, `dir`).
A cada costado, una franja de terreno aplanado de 8 m (`banquina`) para las casas; un lado queda sin franja si es más
empinado que 40° (`banquinaMax`), y la carretera puede seguir hasta 30 m sin franja a ningún lado (`sinFranjaMax`).
Horquillas de 10 o 13,5 m de radio; dos carreteras no pasan a menos de 22 m (`separa`), dos tramos de la misma a menos
de 16 (`separaPropia`). Nada de caracoles: si después de la última horquilla quedan menos de 45 m (`cola`), se corta
antes de ella. Medido en 5 ciudades: pendiente máx. 12 %, radio mínimo 8,7 m, corte en el eje 1,6 m (p90) y de costado
3,2 m; franja a los dos lados en el 81–100 % del recorrido (a uno, en casi todo); la más alta de cada ciudad llega a
29–43 m (antes, sin franjas ni separación, 46–75): con lugar para casas, la montaña deja menos por dónde subir.
Miguel: no hace falta llegar a la cima (más arriba se camina; lejos de la ciudad aleja a los ladrones); lo que importa
es que se vean como parte de la ciudad. En el 2D se dibujan como las calles (claras, con borde suave, sin línea amarilla),
empezando en la calle de adentro y cruzando la salida del muro, con la franja de cada lado como una banda continua en el
tono de los patios.
**En el 3D (2026-10-11):** la carretera y la franja de cada lado quedan planas a la altura de la carretera (el ancho de
cada lado sale de los `puntos`) y empalman con la ladera en 6 m; del lado de arriba queda el corte como pared de tierra.
Malla del terreno más fina (2,6 m). Árboles, rocas y arbustos no caen sobre la carretera ni las franjas; en el borde de
afuera de cada franja, una alameda (un árbol cada ~13 m, pinos arriba de 12 m y árboles de copa abajo). Baranda sólo
donde ese lado no tiene franja. En el plano, el corredor (carretera y franjas) queda reservado: ni las casas de los pueblos
ni las sueltas caen ahí.
Después (pedido de Miguel): la carretera empieza en la calle de la ciudad —el centro de la calle de adentro y el de la
salida del muro, al nivel de la calle— y cruza el paseo sin un pedazo de arena en el medio; el asfalto es el de las calles
(la misma textura, una cada 12 m) con la línea del medio blanca; faroles como los de la ciudad (poste de 4,6 m, brazo hacia
la calle) cada ~22 m alternando el lado, que de noche entran en el reparto de luces del demo (`island.lights`).

**El probador (2026-10-10), en `/probador`**: vestir a un personaje del paquete con los rasgos del retrato hablado
(`src/lib/outfit3d.js`). El paquete no trae accesorios sueltos (Chef_Hat, Cowboy_Hair, VikingHelmet son personajes
enteros); cada modelo es una malla con una parte por material, sin texturas. Se pinta: piel (viene casi negra de fábrica:
4 tonos), ropa de arriba, pantalón y pelo; se esconden el pelo (queda pelado, se ve bien) y el sombrero propio de los
mayores y la obrera. Gorra, gafas y mochila se hacen en código y se pegan a los huesos Head y Torso (se miden con los
vértices que mueve cada hueso). Vistas: de cerca, cámara de seguridad, dron y una fila de seis parecidos (misma ropa,
gorra y mochila). En el traje, la «ropa de arriba» pinta también el pantalón (es una sola parte).
Segunda vuelta (pedido de Miguel): gafas con un lente sobre cada ojo (marco redondeado, vidrio tintado, puente y
patillas), mochila de cantos redondeados pegada a la espalda (tapa, bolsillo, correas sobre los hombros), color de ojos
(pinta también las cejas: son la misma parte), pelirrojo, y un color libre en cada fila además de los tonos de la
lista; la gorra, las gafas y la mochila con su color.
Tercera vuelta: **zonas**. Los 52 modelos comparten el esqueleto, así que cada triángulo de cada parte va a una zona
según el hueso que más lo mueve (`splitZones`, una vez por geometría): la piel en cara, cuello, manos, pies, tobillos,
muslos, pantorrillas, brazos y antebrazos; la ropa de arriba en torso, hombros y mangas (arriba y abajo); el pantalón en
arriba y abajo; la cara en ojos y cejas. Con eso, sin tocar la forma: zapatos (hasta el tobillo; las piernas del paquete
terminan en punta), guantes, mangas sin / cortas / largas y de otro color, pantalón corto o largo, camisa de abajo,
cinturón y detalle (corbata, tirantes, banda) aparte, cejas aparte de los ojos. El probador muestra sólo las zonas que
tiene cada modelo. Con los tonos de la lista (sin el color libre) salen más de cien mil millones de combinaciones.
Corrección de paso: en el doctor el pantalón es la parte «Brown», no «Black».
Cuarta vuelta: **piezas de otros modelos**. Los 52 modelos atan sus piezas al mismo esqueleto en la misma pose (las 23
matrices de atado son idénticas, medido), así que una pieza de cualquiera se pone en cualquier otro y se mueve con él
(probado caminando). En el probador: 34 peinados (algunos con barba, como el del vikingo), 12 sombreros y cascos,
bigote, bufanda, 4 prendas para encima (chaqueta y top de vaquero, chaleco de obra, bata) y 7 pantalones. Cada modelo de
donde sale una pieza (~2 MB, casi todo animaciones) se carga recién al elegirla; para el juego convendría juntar las
piezas en un solo archivo sin animaciones. Límite visto: una prenda de encima no esconde la de abajo y en algunos
puntos la camisa propia asoma a través (la bata sobre una camisa).
Quinta vuelta (refinamiento con la **galería** del probador: 12 al azar, numerados, con lo que lleva cada uno):
- Al prestar una pieza se pueden filtrar sus triángulos por hueso: el sombrero vaquero comparte material con un cinturón
  (sólo se toma la cabeza); la faja del kimono y el cinturón de la bruja pasan por la cabeza (se toma sólo el cuerpo).
- Cada prenda de encima dice qué zonas propias tapa (`hides`) y esas no se dibujan: la bata y el abrigo tapan la ropa
  de arriba; la camisa de vaquero sólo las mangas (no llega a la cintura); la túnica y el chaleco no tapan nada (son
  abiertos); el vestido tapa arriba y deja el pantalón como calza; el kimono tapa todo.
- Prendas nuevas: vestido de bruja (con falda), kimono, abrigo de pirata, túnica.
- Un pantalón prestado corto sobre un modelo de pantalón largo pinta de piel la parte de abajo (antes quedaba un hueco).
Pendiente: cada pieza prestada es una malla más (más dibujos por cuadro); para multitudes conviene fundir las piezas de
cada persona en una sola malla y juntar todas las piezas en un archivo sin animaciones.
Sexta vuelta: **cuerpo base + piezas** (idea de Miguel: «debería haber una base, el cuerpo desnudo»). Los modelos con
ropa no tienen piel debajo de la ropa (el traje casi no tiene piernas de piel; el casual no tiene muslos): al esconder o
pintar una prenda quedaban huecos. El paquete trae `BaseCharacter`, la piel completa con el mismo esqueleto. Ahora el
personaje por defecto es ese cuerpo, y se viste con piezas de cualquier modelo: pelo, ropa de arriba (camiseta, sin
mangas, blusa, camisa con tirantes, camisa y chaleco de obra, saco y corbata, bata, chaqueta de chef, vaquero; cada una
con el papel de sus partes, así se pinta por zonas igual que la propia) y pantalón (con su cinturón). Debajo de la ropa
pegada la piel del cuerpo asoma: se recorta midiendo, para cada hueso que la prenda cubre, hasta dónde llega a lo largo
del hueso (la manga corta deja el brazo de abajo; el short, la rodilla); en el tronco se recorta entero. Dos trampas de
Three.js en el camino: `clone()` comparte `userData` con la geometría original, y el hueso «Body» llega como «Body_1».
Los modelos con ropa siguen disponibles, con sus límites (pintar de piel una prenda puede dejar huecos).
Séptima vuelta: **sombreros y pelo** (Miguel: el pelo salía por el sombrero). El sombrero (o casco, o la gorra) se
mide en las coordenadas de la cabeza: dónde empieza el ala y el ancho de la copa. Se recorta el pelo que queda por encima
del ala y dentro de la copa; el que cae por debajo del ala, a los lados o atrás, queda. La gorra ya no esconde el pelo: lo
recorta igual (asoma por debajo). Un sombrero prestado hecho para un pelo más abultado (el bombín) quedaba flotando:
antes de recortar, baja hasta apoyarse en lo más alto de la cabeza o del pelo debajo de la copa.
Octava vuelta: **barridos** (cada tipo de pieza contra sus peores compañeras, y tandas de estrés todo al azar sobre el
cuerpo base). Lo que salió y se arregló:
- Lo de encima cerrado (bata, abrigo, vestido, kimono) también esconde la ropa prestada de abajo y recorta la piel del
  cuerpo; lo abierto (chaqueta, chaleco, túnica) no.
- La mochila no aparecía en el cuerpo base (se medía sobre la ropa propia): ahora se apoya en lo de más afuera.
- **Barba aparte del pelo**: el vikingo y el mago traen la barba en la misma parte que el pelo. En las coordenadas de la
  cabeza (y arriba, z adelante, ojos entre y 0,30 y 0,59) la barba es lo de debajo de la boca, adelante y al centro.
  Cada peinado se toma sin barba, y hay barba o bigote aparte: bigote, barba corta, barba vikinga, barba de mago.
- Mangas cortas o sin mangas sobre una prenda de manga larga (saco, chaqueta de chef, bata) quedaban como brazos
  gruesos pintados de piel: en el cuerpo base la manga se esconde y la piel del brazo no se recorta (el saco sin mangas
  queda chaleco). Igual el pantalón corto sobre uno largo. Los puños de la camisa del saco son su propia zona y se van
  con las mangas.
Novena vuelta: el **dobladillo** del pantalón acortado ya sale derecho (el límite va por el anillo de vértices más
cercano a la rodilla). **Una malla por persona** (`bake`): todas las piezas, zonas y accesorios de una persona se funden
en una sola malla con el color en cada vértice, atada al mismo esqueleto, con un material compartido por todos. Medido
en la galería con 12 personas al azar: de 283 a 14 dibujos por cuadro (12 personas, piso y grilla); se ve igual (sin las
manchitas de capas que se pisan) y camina con el esqueleto. Décima vuelta (Miguel: «retira lo difícil de cuadrar o arregla todos los gorros»): **catálogo de ciudad**. Los
sombreros de mago, bruja, elfo, el casco vikingo y la túnica quedan marcados como disfraz (`CITY_PIECES` no los ofrece
ni salen al azar; siguen existiendo). El «sombrero de señora» era el mismo de copa que el bombín: fuera. La barba de mago
pasa a «barba larga». Los 33 peinados se ven bien como pelo de calle. Cada sombrero de ciudad (bombín, cascos de obra,
gorro de chef, vaquero, casco militar, casco de policía) y la gorra, probados con los 12 peinados más voluminosos: el
recorte ahora saca todo el pelo por encima del ala dentro del ancho del sombrero, adelante o atrás (el flequillo caía
hacia adelante sobre el casco de obra). Queda: dos o tres puntas finitas de pelo junto a la visera
de la gorra; juntar todas las piezas en un archivo liviano sin animaciones (hoy cada pieza baja con su modelo entero,
~2 MB).

---

## 0. EL NÚCLEO DEL JUEGO (2026-10-07)

**Hay más puertas que policías. Los ladrones distraen; la policía adivina.**

*(Ajuste del 2026-10-07: la primera versión decía «más bancos que policías». Lo que importa no es cuántos bancos hay,
sino cuántas entradas hay que cuidar. Puede ser un solo banco con muchas entradas.)*

- Los dos equipos tienen **dron** para armar el plan (ver «Drones y vista satelital», en la idea 1).
- La policía **no puede cuidar todas las entradas**: tiene que decidir cuáles. Los ladrones tienen que **hacer que decida
  mal**: alguno llama la atención lejos y otro roba donde quedó vacío.
- **Los ladrones pueden dormir a un policía** (lo sacan de juego un rato). **La policía puede noquear a un ladrón y
  mandarlo a la cárcel** (lo saca del todo). La asimetría tiene sentido: la policía defiende y le alcanza con
  aguantar; los ladrones atacan y necesitan abrir ventanas.
- Los ladrones se mezclan con los ciudadanos (NPC, idea 1). Las demás ideas (2 a 6) se pueden sumar después, encima.

### Reglas a cuidar

1. **Dormir a un policía no puede ser fácil:**
   - sólo por la espalda y sin ser visto (si el policía te ve, no puedes);
   - toma un momento (1–2 s sujetándolo); si alguien te ve mientras tanto, la policía tiene causa probable sobre ti;
   - el policía duerme unos 10–15 s, o menos si un compañero lo despierta;
   - un policía dormido es una pista: la central lo ve caído y sabe que hay ladrones cerca.
2. **La distracción tiene que costar algo.** Un señuelo gratis se ignora y el juego se vuelve adivinar. Lo interesante
   es que distraer arriesgue a alguien (un compañero que se deja ver lejos del robo y puede caer) o que el señuelo
   tenga una recarga larga.
3. **Cuántas entradas por policía** es el número más importante: muy pocas y la policía las cuida todas; demasiadas
   y no hace falta distraer. Punto de partida: policías + 1 o + 2. Medible con bots, como la cuota y el reloj.
   - Las entradas tienen que estar **lejos entre sí**, en lados distintos del edificio: si un policía cubre dos
     corriendo antes de que un ladrón abra una, cuentan como una. Medible en el generador: pasos entre puertas
     rodeando el edificio, contra el tiempo de abrir una puerta.
   - **Nada de un cuello de botella adentro.** Si todas las puertas llevan a una sola bóveda, un policía parado en la
     bóveda cuida todo. El botín tiene que estar repartido (varias cajas en cuartos distintos) o la bóveda se abre
     desde afuera, o el policía no puede entrar a la bóveda.
   - Las entradas no tienen que ser todas puertas: ventana (lenta, de a uno), techo, alcantarilla. Cada una con su
     costo (rápida y ruidosa, o lenta y silenciosa) da material para distraer: forzar una puerta con ruido para que la
     policía vaya, y entrar callado por otra.
4. **Vigilar no puede ser aburrido:** el tiempo del policía va en patrullar, revisar las marcas de la central, mover
   su dron y despertar compañeros, no en quedarse parado en una puerta.
5. **Los presos:** sin rescate, cada arresto deja a la banda en desventaja. Formas de suavizarlo ya anotadas: la banda
   necesita menos bolsas si pierde gente, o «¡por mí y por todos!» (entregar una bolsa libera a un compañero).

### Encaje con el motor actual

Ya existe: los objetivos con interior tienen varias puertas a la calle y la bóveda con dos pasos; varios objetivos en
la ciudad, alarmas, el oído, noqueo y cárcel, y bots de policía que deciden qué objetivo cuidar. Falta: dormir a un
policía (el noqueo al revés, con sus condiciones), el señuelo o el compañero que distrae, los NPC, la cantidad de
entradas según los policías, el botín repartido dentro del banco y los bots de policía que cuidan puertas.

**Pregunta para el calibrador:** ¿cuántas veces gana una banda que distrae frente a una que no? Si distraer no cambia
el resultado, el núcleo no está funcionando.

### Primera prueba con bots (2026-10-07) — programada en temp/game

Dos cosas nuevas, que se pueden prender y apagar: **puertas por objetivo** (2, 3 o 4) y la regla **«la policía entra sólo
con alarma»** (lockdown). Con esa regla, la policía cuida el banco desde la calle, frente a las puertas, y sólo puede
entrar mientras suena la alarma: suena al abrir la bóveda y cada vez que se saca una bolsa, y dura 10 s después. Un
policía que ya está adentro puede salir, pero no volver a entrar.

% de rondas que ganan los ladrones (240 rondas en 24 ciudades por tamaño, ±6):

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| 2 puertas, como hasta hoy | 46 | 45 | 50 | 49 |
| 3 puertas | 61 | 53 | 73 | 66 |
| 2 puertas + policía sólo con alarma | 38 | 26 | 19 | 16 |
| 3 puertas + policía sólo con alarma | 55 | 40 | 35 | 40 |

Lo que dicen los números:
- **Más puertas ayuda a los ladrones, en todos los tamaños.** El núcleo hace lo que tiene que hacer.
- **La regla de la alarma deja muchas rondas trabadas:** con ella, entre el 38 % y el 83 % de las rondas terminan por
  tiempo (sin ella, entre el 15 % y el 45 %), y hay pocas capturas. Los ladrones entran, abren la bóveda, suena la
  alarma, entra toda la policía y los ladrones quedan adentro huyendo de un lado a otro, sin salir.
- Una parte es de los bots: su reflejo de huida es de corto alcance y no planea salir por la puerta libre. Otra parte
  puede ser de la regla: la bóveda con policía en todas las puertas es una trampa.
- Si la alarma sonaba **mientras** se trabaja la bóveda (y no al abrirla), los ladrones ganaban el 3 % en 3 contra 3. Si
  entraba toda la policía a la vez, el 16 %. Por eso quedó: suena al abrir, y los bots de policía no entran todos.

#### Segunda vuelta (2026-10-07): los bots eligen puerta, y la policía tarda en entrar

Lo que trababa las rondas **no era la salida, era la entrada**: los ladrones caminaban hacia la puerta más cercana, veían
al policía que la cuidaba, huían y volvían a intentar, una y otra vez. Ahora:
- un ladrón bot que va a un objetivo **entra por la puerta con menos policía cerca** (de lo que vio u oyó), y si está
  adentro con botín, o con la alarma sonando y policía adentro, **sale por la puerta menos cuidada**;
- regla nueva **«Demora de la policía tras la alarma»** (lockdownDelay): la alarma suena y la policía puede entrar
  recién unos segundos después. En el plano, el aviso cuenta los segundos.

% de victorias de ladrones (240 rondas en 24 ciudades por tamaño, ±6; entre paréntesis, % de rondas que terminan por tiempo):

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| Como hasta hoy (2 puertas, sin la regla) | 46 (20) | 45 (30) | 50 (45) | 49 (41) |
| 2 puertas + alarma, sin demora | — | 22 (73) | — | — |
| 3 puertas + alarma, sin demora | — | 47 (47) | — | — |
| **2 puertas + alarma + 3 s de demora** | **56 (33)** | **43 (50)** | **57 (43)** | **59 (40)** |
| 3 puertas + alarma + 3 s de demora | 61 (30) | 65 (31) | 83 (16) | 89 (10) |

- **La versión que queda pareja: 2 puertas por objetivo, la policía entra sólo con alarma y tarda 3 s.** Con 6 s de
  demora en 3 contra 3 da casi lo mismo que con 3 (44 % y 67 %).
- Con 3 puertas y la demora, los ladrones ganan de más en las ciudades grandes: cuenta el total de puertas de la
  ciudad (objetivos × puertas) contra los policías.
- Sigue habiendo menos capturas que sin la regla (en 3 contra 3, unas 2,5 por ronda contra 4,9): hay menos persecución
  y más juego de puertas.

#### Tercera vuelta (2026-10-07): la distracción

Regla nueva **«Hacer ruido en una puerta»** (decoy, en segundos; 0 = no se puede): un ladrón fuerza la puerta de un
objetivo y hace ruido. La central avisa a toda la policía, cada policía decide si va a revisarlo (según qué tan lejos le
queda y cuántos compañeros ya van), y la policía cercana sabe dónde está quien lo hizo. Cada ladrón lo puede hacer
una vez cada 15 s. En el plano aparece «RUIDO EN …». Una persona que juega de ladrón lo hace cuando quiere (E en la
puerta).

Los bots: el ladrón de rol 1 se ubica en la puerta de OTRO objetivo y hace el ruido cuando sus compañeros abren la
bóveda o sacan bolsas. Antes probé otros dos momentos (cuando hay policía en la puerta del que quieren robar, y recién
cuando suena la alarma) y tampoco sirvieron.

% de victorias de ladrones en 3 contra 3 (240 rondas, ±6), con alarma 10 s y demora 3 s:

| | sin ruido | con ruido (2 s) |
|---|---|---|
| 2 puertas | 43 | 32 |
| 2 puertas, la policía SIEMPRE va al ruido | — | 38 |
| 2 puertas, la policía NUNCA va al ruido | — | 33 |
| 3 puertas | 65 | 61 |
| Sin la regla de la alarma (2 puertas) | 45 | 32 |

**Con estos bots, distraer no paga, ni siquiera si la policía siempre muerde el anzuelo.** Por qué:
- **Con más puertas que policías, entrar ya es gratis.** Hay siempre una puerta libre, y con la regla de la alarma, una
  vez adentro, nadie te puede seguir. Distraer en la entrada no hace falta.
- **El que distrae es un ladrón menos robando.** En 3 contra 3 es un tercio de la banda; pasa casi un cuarto de la ronda
  esperando en otra puerta, y el ruido sale menos de una vez por ronda.
- **Los policías que deciden la ronda son los que ya están en la puerta del banco cuando suena la alarma.** El ruido en
  otro banco mueve a los que andaban lejos, no a esos.

Qué haría falta para que distraer valga (ideas, sin programar):
- **Que entrar no sea gratis:** abrir una puerta hace ruido o la policía de la puerta de al lado ve entrar. Entonces sí
  conviene llevarse a ese policía antes.
- **Que distraer sea barato y rápido:** un señuelo que se deja (un petardo, una alarma de auto) en vez de un ladrón
  parado en una puerta.
- **Probarlo con personas.** Si un policía va o no al ruido es justo la decisión humana que los bots no saben imitar;
  los números de arriba dicen que con bots no alcanza, no que la idea esté mal.

#### Cuarta vuelta (2026-10-07): entrar no es gratis

Regla nueva **«Forzar una puerta para entrar»** (force, en segundos; 0 = puertas abiertas): las puertas de los objetivos
están cerradas para los ladrones. Forzar una toma esos segundos, parado en la calle frente a ella, y al abrirse hace
ruido que oye la policía cercana. La puerta queda abierta el resto de la ronda. La policía tiene llave. En el plano, las
puertas sin forzar tienen un cuadrado oscuro. Los bots fuerzan la puerta con menos policía cerca.

% de victorias de ladrones en 3 contra 3 (240 rondas, ±6; alarma 10 s, demora 3 s, 2 puertas; entre paréntesis, % de
rondas que terminan por tiempo):

| | sin señuelo | con señuelo |
|---|---|---|
| Puertas abiertas | 43 (50) | 32 |
| Forzar 2 s, en silencio | 25 (67) | — |
| **Forzar 2 s, lo oye la policía cercana** (quedó así) | **26 (65)** | **26** |
| Forzar 2 s, avisa a toda la policía por la central | 16 (77) | 12 · 9 sincronizado con el forzado |
| Forzar 1 s, avisa por la central | 13 | 14 |

- **Ahora sí la entrada se disputa:** forzar cuesta unos 17 puntos a los ladrones. Lo que pesa es tener que quedarse
  2 s en la puerta, no el ruido (en silencio da casi lo mismo que oído de cerca). Con aviso a toda la policía, los
  ladrones casi no ganan.
- **El señuelo dejó de restar, pero no suma** (26 y 26). El bot que distrae sigue siendo un ladrón menos, y su ruido
  todavía no se lleva a los policías que importan.
- Con las puertas cerradas, las rondas se traban más (65 % terminan por tiempo). Para dejarlo parejo habría que
  devolverles algo a los ladrones (menos bolsas, más reloj o 3 puertas por objetivo).

**Parejo con puertas cerradas (2026-10-07):** devolviéndoles a los ladrones una o dos bolsas. Con 2 puertas, alarma 10 s,
demora 3 s y forzar 2 s (240 rondas por tamaño, ±6; entre paréntesis, % por tiempo):

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| **Bolsas 4 / 5 / 8 / 10 (quedó así)** | **46 (37)** | **44 (48)** | **44 (55)** | **44 (55)** |
| 3 puertas, bolsas de siempre (4 / 6 / 9 / 12) | 66 (25) | 43 (53) | 53 (47) | 45 (55) |

Con «Forzar» encendido, el motor usa esas bolsas solo (LOCKED_QUOTA). En /jugar, con una ciudad elegida, el botón
**«Modo puertas cerradas»** carga todo: alarma 10, demora 3, forzar 2 y ruido 2 (para que una persona que juega de
ladrón pueda hacer ruido con E en la puerta de otro banco). «Como siempre» lo apaga. Es la configuración para la prueba
con personas.

#### Quinta vuelta (2026-10-07): dormir a un policía

Regla nueva **«Policía dormido»** (sleep, en segundos; 0 = no se puede) y **«Sujetar para dormir»** (sleepHold, 1,5 s):
- el ladrón se acerca **por la espalda** (fuera del frente del policía: más de 100° de hacia dónde mira) y lo sujeta
  1,5 s; si el policía se da vuelta o se aleja, se empieza de nuevo;
- el policía duerme esos segundos, o menos si un compañero lo despierta (1 s, con E);
- **un policía dormido es una pista:** la central avisa a los demás dónde está el ladrón;
- con la regla encendida, **la policía no ve a su espalda** (sí lo oye si corre o carga botín). Sin eso no se puede: los
  bots lo intentaban 9 veces por ronda y lo lograban en 4 de 228 intentos, porque el policía veía al ladrón llegar y
  se daba vuelta. Con el punto ciego, 76 de 165.

% de victorias de ladrones (240 rondas por tamaño, ±6; entre paréntesis, % por tiempo; dormidos por ronda):

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| Ciudades de siempre | 46 (20) | 45 (30) | 50 (45) | 49 (41) |
| Ciudades de siempre + dormir 12 s | — | 48 (13) · 2,5 | — | — |
| Ciudades de siempre + dormir 6 s | — | 38 (16) · 2,8 | — | — |
| Puertas cerradas | 46 (37) | 44 (48) | 44 (55) | 44 (55) |
| **Puertas cerradas + dormir 10 s (quedó así)** | **57 (32)** · 0,7 | **50 (41)** · 1,7 | **52 (47)** · 3,5 | **57 (43)** · 7,5 |

- **Dormir destraba las rondas.** En las ciudades de siempre, las que terminan por tiempo bajan de 30 % a 13 %; en el
  modo puertas cerradas, unos 7 puntos en cada tamaño. Es la primera regla que ataca lo que dejaron la alarma y las
  puertas cerradas.
- **Lo que vale es cuánto duerme.** 6 s no alcanza (el ladrón gasta su tiempo y el policía vuelve enseguida); 10–12 s
  sí. El modo puertas cerradas quedó con 10 (con 8 daba 47 % en 3 contra 3, con 12, 55 %).
- Casi no despiertan a nadie (0,2 a 1,2 por ronda): un compañero dormido rara vez está a la vista de otro.

El botón «Modo puertas cerradas» ya trae dormir 10 s.

#### Sexta vuelta (2026-10-07): ladrones entre la gente (NPC) y la central

Regla nueva **«Ciudadanos por jugador»** (crowd; 0 = sin gente). Lo que hace:
- **Ciudadanos** que caminan por la calle entre puntos al azar (y frentes de bancos, escondites y la comisaría), a la
  velocidad de un ladrón caminando, con pausas.
- **Mezclarse:** la policía no distingue a un ladrón que camina tranquilo con algún ciudadano a menos de 4 casillas.
  Lo identifica si lo ve **correr, llevar una bolsa o trabajar** (forzar, abrir, recoger, dormir, hacer ruido, rescatar,
  esconder), o si anda **solo**; y lo sigue reconociendo mientras no lo pierda de vista (3 s).
- **La central** ve la ciudad desde arriba: cada 2 s marca a toda la policía **dónde** hay alguien delatándose (no
  quién). Los policías van a buscar ahí; al llegar tienen que identificarlo.
- **Causa probable:** los bots policía sólo actúan sobre ladrones identificados. Una persona que juega de policía y
  golpea a un ciudadano queda suspendida 5 s.
- **Los ladrones bots actúan natural:** si están camuflados (sin delatarse y con gente cerca) no corren ni huyen hasta
  que un policía los persigue. Sin eso, se delataban solos: a la vista de un policía, el 98 % del tiempo estaban
  trabajando, corriendo o con bolsa.
- En el plano: ciudadanos color arena. **Si una persona juega de policía, los ladrones que no identificó se ven igual
  que los ciudadanos** (sin nombre); al identificarlos, toman su color.

% de victorias de ladrones (240 rondas por tamaño, ±6; entre paréntesis, % por tiempo), con puertas cerradas, alarma
10 s + 3 s, forzar 2 s y dormir 10 s:

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| Sin gente (bolsas 4 / 5 / 8 / 10) | 57 (32) | 50 (41) | 52 (47) | 57 (43) |
| Gente 3, sin la central (bolsas 4 / 6 / 9 / 12) | 61 | 53 | 78 | 92 |
| Gente 3 + la central (bolsas 4 / 6 / 9 / 12) | 55 | 50 | 74 | 85 |
| **Gente 3 + la central, bolsas 4 / 6 / 11 / 16 (quedó así)** | **55 (26)** | **50 (35)** | **55 (43)** | **48 (48)** |

- **La gente ayuda a los ladrones, y más cuanto más grande la ciudad**: con más policías repartidos, perder a un ladrón
  entre la gente cuesta más. La central lo compensa en las ciudades chicas; en las grandes hizo falta pedir más bolsas
  (CROWD_QUOTA).
- En las ciudades de siempre (sin puertas cerradas ni dormir), la gente les cuesta a los ladrones: 35 % con 2
  ciudadanos por jugador y 41 % con 4 (sin gente, 45 %). El ladrón que actúa natural se acerca caminando a un policía
  y, cuando empieza a trabajar, ya lo tiene encima.
- Lo que los bots no miden: si a una persona le resulta divertido esconderse y buscar entre la gente, y si se notan
  los ciudadanos (caminan al azar, sin rutinas: casa → tienda → plaza).

El botón «Modo puertas cerradas» ya trae 3 ciudadanos por jugador.

#### Séptima vuelta (2026-10-07): el dron de los ladrones

Regla nueva **«Batería del dron de los ladrones»** (drone, en segundos; 0 = sin dron). La policía ya tiene su vista
desde arriba (la central, sexta vuelta).
- Un ladrón lanza el dron sobre un banco a menos de 16 casillas y **se queda quieto** mientras vuela.
- El dron **ve a los policías que están en la calle** a menos de 6 casillas del banco (nunca dentro de un edificio) y
  se lo pasa a toda la banda.
- **Se puede detectar:** un policía en la calle a menos de 6 casillas lo ve (está en el aire: no hace falta línea de
  vista) y marca el punto a toda la policía.
- **Recarga en 25 s.** Persona: mantener **F** (vuela sobre el banco de la banda o el más cercano); lo que ve el dron
  se suma a lo que ve el personaje. En el plano: un dron con su radio punteado (rojo si lo vieron).
- Los bots lo lanzan sobre un banco que nadie miró en 20 s (primero el de la banda), uno a la vez, y **la banda elige
  el banco con menos policías conocidos** cerca. Sin eso, el dron no cambiaba nada: miraba y la banda seguía igual.

% de victorias de ladrones con el modo completo (240 rondas por tamaño, ±6):

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| Sin dron | 55 | 50 | 55 | 48 |
| **Con dron de 8 s** | **61** | **55** | **60** | **54** |

- **El dron vale unos 5 puntos para los ladrones, en los cuatro tamaños.** Cada tamaño por separado está dentro del
  margen, pero que los cuatro suban lo mismo dice que es real.
- **Ve poco:** en cada vuelo hay, en promedio, medio policía en la zona. Casi siempre confirma «no hay nadie», y eso ya
  sirve para elegir el banco.
- **La policía lo ve en 4 de cada 10 vuelos** (23 de 58). Al principio pedía línea de vista desde la calle hasta el
  centro del banco, que las paredes tapan, y no lo veía nunca; con el arreglo, 3 contra 3 sigue en 55 %. Los otros
  tres tamaños de la tabla se midieron antes del arreglo.
- En las ciudades de siempre no se nota (42 % con 4 s; sin dron, 45 %): el que lo vuela queda quieto, y eso cuesta lo
  que gana.
- Falta la **fase de plan** del inicio (30–45 s recorriendo la ciudad con el dron antes de salir) y el **tablero de
  plan compartido**: son para personas, los bots no los necesitan.

**Compensado con bolsas (2026-10-07):** con dron, una bolsa más en 2 y 5 contra 5 (DRONE_EXTRA_BAGS). Una bolsa más
en los cuatro tamaños corregía de más en 3 y 8 contra 8, donde una bolsa pesa unos 15 puntos:

| Modo completo con dron de 8 s | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| Bolsas 4 / 6 / 11 / 16 | 61 | 55 | 60 | 54 → 55 con la detección arreglada |
| Bolsas 5 / 7 / 12 / 17 | 52 | 39 | 48 | 37 |
| **Bolsas 5 / 6 / 12 / 16 (quedó así)** | **52** | **55** | **48** | **55** |

El botón «Modo puertas cerradas» ya trae el dron (8 s) con esas bolsas.

#### Octava vuelta (2026-10-07): el dron como círculo de visión, para los dos equipos

Idea de Miguel: el dron es **un círculo de visión** que deja ver sólo una parte de la ciudad, el resto nublado, **para
los dos equipos**: así cobra sentido planear con información escasa.
- **Cada jugador tiene un dron** (la opción más simple; la otra era uno por equipo que se pasan). Mantener **F**: el
  personaje queda quieto y las teclas de mover mueven el dron, hasta 16 casillas de donde estás. Batería 8 s; al
  soltar vuelve y la recarga es proporcional a lo usado (25 s la batería entera).
- **Ve un círculo de 6 casillas, sólo al aire libre.** Lo que ve lo sabe todo el equipo, y en pantalla ves los círculos
  de tus compañeros.
- **El de los ladrones** ve a los policías (uniforme); un policía en la calle dentro del círculo lo ve y avisa a todos.
  **El de la policía** ve gente: sólo distingue a los ladrones que se están delatando (corren, llevan bolsa, trabajan).
- **Ya no hay central:** la policía ve sólo lo que alcanzan sus drones.
- En pantalla: un ladrón que se delata se ve como ladrón para cualquiera que lo vea; el dron del otro equipo aparece
  sólo si lo ves (sin su círculo).
- Bots: uno por equipo a la vez (al principio despegaban los tres policías juntos). La policía lo vuela sobre el banco
  o escondite al alcance más lejos de sus compañeros; los ladrones, como antes, sobre el banco que van a robar.

% de victorias de ladrones con el modo completo (240 rondas por tamaño, ±6):

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| Dron sólo de los ladrones + central (antes) | 52 | 55 | 48 | 55 |
| Dron para los dos, sin central, bolsas 5 / 6 / 12 / 16 | 57 | 52 | 38 | 48 |
| **Dron para los dos, sin central, bolsas 5 / 6 / 11 / 16 (quedó así)** | **57** | **52** | **50** | **48** |

- Cambiar la central por drones casi no movió el equilibrio, salvo 5 contra 5, que se arregló con una bolsa menos.
- Los bots vuelan mucho: en 3 contra 3, unos 15 vuelos por ronda entre los dos equipos (casi todos de la policía).

#### Novena vuelta (2026-10-07): no es un dron, es una vista satelital

Miguel aclaró: no quiere que nadie vea drones. El concepto es **información acotada**: una **vista satelital** para ver
cómo va todo y planear el robo; la policía la usa para ver irregularidades o sospechosos.
- **Nadie la ve ni la detecta:** se fue el dibujo del dron y el «un policía vio un dron».
- **Un círculo de 6 casillas que se mueve por toda la ciudad** (ya no depende de dónde estás parado), con **F** y las
  teclas de mover. Sigue acotada: ve sólo al aire libre, dura 8 s (recarga proporcional, 25 s la entera) y tu
  personaje queda quieto mientras mirás.
- Lo que ve lo sabe tu equipo, y ves los círculos de tus compañeros (sólo el borde). El del otro equipo no se ve.
- La niebla quedó **difuminada**: el borde entre lo que se ve y lo que no se esfuma.

% de victorias de ladrones con el modo completo (240 rondas por tamaño, ±6):

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| Dron (alcance 16, detectable), bolsas 5 / 6 / 11 / 16 | 57 | 52 | 50 | 48 |
| Vista satelital, bolsas 5 / 6 / 11 / 16 | 55 | 56 | 50 | 42 |
| **Vista satelital, bolsas 5 / 6 / 11 / 15 (quedó así)** | **55** | **56** | **50** | **54** |

**La policía bot busca bolsas (2026-10-08):** cuando hay un robo en curso (una bóveda abierta con bolsas, o una alarma
en los últimos 20 s), su vista satelital arranca sobre ese banco y barre hacia el escondite más cercano que no miró en
10 s, por donde pasan los que cargan. Si no hay robo, mira el banco o escondite más lejos de sus compañeros. Los
ladrones con bolsa quedan bajo su vista el 5,0 % del tiempo que cargan (antes, 4,1 %; 36 rondas de 3 contra 3). El
equilibrio casi no se movió: 54 / 55 / 49 / 58 % (240 rondas por tamaño, ±6; antes 55 / 56 / 50 / 54).
Lo que la vista no hace: entrar a los edificios. Un ladrón con bolsa que cruza por adentro de las casas no aparece.

**Marca de «visto acá» (2026-10-08):** donde tu equipo vio (u oyó) por última vez a un rival que ahora no ve, queda un
círculo punteado tenue con los segundos que pasaron (azul un policía, rojo un ladrón, con un cuadrito si llevaba bolsa);
se borra en 18 s. Sale de una memoria por equipo en el motor (g.memory) que sólo usa la pantalla: no cambia a los bots.

Hasta acá llegan los bots con la distracción: tres versiones del momento del ruido y tres del forzado, y en ninguna
distraer gana. **La pregunta del núcleo («¿gana más una banda que distrae?») hay que contestarla jugando con
personas**: si el policía muerde el anzuelo, y si la banda coordina «yo hago ruido, ustedes fuerzan», es justo lo que
los bots no imitan.

---

## 0a. Parques repartidos (2026-10-09) — medido, sin efecto en el equilibrio

Idea de Miguel: más parques, repartidos, para darle aire a la ciudad. En el generador es la opción `parks` (en el motor,
`city:3:12:parques`). La ciudad se divide en zonas (2, 4, 6 u 8 según el tamaño) y cada zona recibe un parque en la
manzana más lejos de los otros parques, de los objetivos y de la comisaría, con un tope de 9 % de la ciudad. Sin la
opción, las ciudades son idénticas a las de antes (1.800 comparadas).

En 200 ciudades por tamaño: las ciudades sin plaza pasan de 61 / 28 / 7 / 0,5 % a 2 / 0 / 0 / 0 %, la superficie de
plaza de 4,0–7,3 % a 6,6–8,9 %, y los parques quedan más separados en 2 y 3 contra 3. Pasan los controles del generador
tantas ciudades como antes o más.

Bots, reglas del prototipo, 240 rondas por tamaño en las mismas 24 ciudades (±6 por variante):

| | 2 vs 2 | 3 vs 3 | 5 vs 5 | 8 vs 8 |
|---|---|---|---|---|
| sin parques (hoy) | 55 | 57 | 48 | 57 |
| con parques | 47 | 57 | 52 | 57 |

No mueve el equilibrio: en 3, 5 y 8 contra 8 la diferencia es de 0 a 4 puntos, y en 2 contra 2 los 8 puntos están
dentro del margen de una diferencia entre dos lotes de 240 (±9). Las rondas por tiempo, las capturas y la duración
quedan iguales. Los bots no aprovechan la forma del mapa, así que esto dice que no rompe las reglas, no si es más
divertido. La demo 3D ya usa parques; el prototipo todavía no (decide Miguel).

## 0b. LOS JEFES (2026-10-09) — idea de Miguel, en prueba con bots

**La policía gana si atrapa al jefe. Los ladrones ganan si roban el botín. Cada ladrón atrapado da una pista.**

- Cada equipo tiene un **jefe**, y sólo los jefes tienen dron. El jefe de los ladrones ve a la policía y le pasa la voz
  a su banda; el jefe de policía organiza a los suyos.
- El jefe de los ladrones **no roba**: se esconde y vuela el dron. Si lo atrapan (noqueado y llevado a la cárcel, como a
  cualquiera), gana la policía en ese momento.
- **Interrogatorio:** cada ladrón que cae preso da una pista sobre dónde está su jefe. **No puede mentir ni callar,
  pero elige cuál** entre tres verdaderas: una vaga («en la mitad norte»), una media («en el cuadrante noreste») y
  una precisa («a menos de 7 casillas de la Joyería»). Si no elige a tiempo, sale una al azar. La pista es de dónde
  estaba el jefe en ese momento: si se mueve, envejece.

Decisiones tomadas (Miguel, 2026-10-09):
1. **El cuerpo del jefe está en la ciudad.** Mientras vuela el dron se queda quieto e indefenso; cuando camina, se
   mezcla con la gente como cualquier ladrón. Cada vuelo es información a cambio de exponerse.
2. **Si se acaba el tiempo, gana la policía**: a los ladrones les conviene apurarse; el jefe no gana escondiéndose.
3. **El jefe de policía no se puede atacar** (por ahora). Dormirlo para dejar a la policía sin dron queda para después.
4. **Sin voz, el jefe se comunica con marcas del dron** («vengan acá», «policía acá», «roben éste»). Con bots, lo que
   ve el dron lo sabe todo el equipo (como ya pasa con la vista satelital).

En el motor es la regla `boss` (0 = como siempre). Lo medido, más abajo de esta sección cuando esté.

**Nombres (2026-10-09).** El generador nombra la ciudad con un sorteo propio (las ciudades no cambian): calles (de oeste
a este, numeradas de norte a sur), carreras (de norte a sur, numeradas de oeste a este), avenidas con nombre propio,
parques, plazas y edificios («Edificio Los Andes», «Torre Santa Fe», «Casa Monserrate»; los objetivos y la comisaría
como ya se llaman). Las pistas los usan: vaga «en la mitad norte»; media «sobre la Carrera 30» o «entre la Calle 33 y la
Calle 36»; precisa «en la Plaza de Mercado», «frente al Edificio Primavera» o «en la Calle 29 con Carrera 20». Se ven en
el plano 2D (calles y parques) y en la demo 3D (letreros de esquina, placas de los edificios, cartel de cada parque, y
arriba el lugar donde se está). La isla todavía no tiene nombres: cuando entre al juego.

## 1. Ladrones entre la gente (NPC) — la idea más reciente, la que más convence

- La ciudad tiene **ciudadanos (NPC)** que caminan con rutinas: de su casa a una tienda, a la plaza, al trabajo.
- Los **ladrones se ven igual que los ciudadanos** y salen de sus **guaridas** (un edificio cada una). Entre ellos se
  reconocen; la policía no.
- Los **policías** se distinguen (uniforme) y salen de la comisaría.
- La policía tiene una **vista desde arriba** (satelital o cámaras): ve a la gente moverse y nota **actividad
  sospechosa**, pero **no puede actuar sin causa probable**. Marca el punto y los policías de calle van a verificar.
- La marca **puede ser una trampa**: un ladrón provoca algo sospechoso lejos para alejar a la policía del robo de verdad.

Ver el análisis en la sección «Por qué esta idea funciona» al final.

### Drones y vista satelital para los dos equipos (2026-10-07)

- **Regla de diseño: cada vista deja algo sin ver.** Los policías llevan uniforme: si el dron de los ladrones mostrara
  toda la ciudad, sabrían siempre dónde está cada policía y se acabaría el esconderse.
- **Fase de plan al inicio de cada ronda (30–45 s):** los dos equipos recorren la ciudad con el dron mientras los
  personajes siguen en la guarida y en la comisaría; los ladrones eligen objetivo y ruta, la policía decide dónde
  patrullar (como el reconocimiento con drones de Rainbow Six Siege).
- **Durante la ronda, el dron es un dispositivo con límites:**
  - lo maneja un jugador y su personaje queda quieto en la calle (con NPC, quedarse quieto mucho rato es sospechoso);
  - tiene alcance (cerca de quien lo maneja) y batería (segundos, luego recarga);
  - no ve dentro de los edificios: los interiores siguen siendo el escondite;
  - se puede detectar: hace ruido y se ve desde la calle; si la policía lo ve, sabe que hay un ladrón cerca.
- **Cada equipo ve cosas distintas:**

  | | Dron de los ladrones | Vista de la policía (central) |
  |---|---|---|
  | Qué ve | una zona chica con detalle: policías de esa zona, puertas, rutas | toda la ciudad desde lejos: puntos de gente, sin distinguir quién es quién |
  | Qué no ve | el resto de la ciudad | quién es ladrón; sólo nota lo raro (alguien corriendo, una alarma, una puerta forzada) |
  | Para qué sirve | planear el robo y la huida, avisar al equipo | marcar puntos sospechosos para los policías de calle |

- **Tablero de plan compartido:** cada equipo marca rutas, objetivos y puntos de encuentro sobre el mapa y su equipo
  los ve. Planear sin verlo todo, y jugar en equipo sin chat de voz.
- **Qué medir con bots:** cuánto mejora a los ladrones saber dónde están los policías de una zona, y cuánto mejora a
  la policía la vista de la central frente a no tenerla. Los bots tendrían que usar el dron de forma simple (por
  ejemplo, mirar el objetivo antes de entrar).

## 2. Objetos en el mapa (propuesta, 2026-10-06)

- Cada personaje lleva **un objeto a la vez**, de un solo uso o de pocos segundos. **Ningún objeto gana solo:** todo
  tiene respuesta.
- Ladrones: bomba de humo, zapatillas silenciosas, señuelo de ruido, taladro, llave de celda, bolsa ligera. Aparecen
  dentro de los edificios.
- Policía: linterna, radio (el equipo ve lo que se oye), cámara en una puerta, barrera, esposas rápidas. Aparecen en
  avenidas y plazas.
- Empezar con 2 o 3 por equipo; los bots tienen que aprender a usarlos para que el calibrador los mida.

## 3. Economía (propuesta, 2026-10-06)

- **Mercado negro para ladrones:** vender una bolsa al perista da dinero para mejoras, pero no suma a la cuota. La
  decisión «¿me hago fuerte o voy a ganar?» es el valor de la idea.
- **Alerta para la policía:** sube con cada robo y la central manda recursos (radio, linternas, barreras, cámaras…).
  Compensa sola la ventaja de los ladrones que van ganando. Sin autos ni helicópteros: en un mapa chico no tienen sentido.
- **Riesgo:** la «bola de nieve». Un arresto que quita un ladrón Y le paga a la policía la premia dos veces.
- **Equilibrio propuesto:** que nadie cobre dos veces por lo mismo y que el que pierde reciba algo.
  1. «Se busca»: el arresto paga lo que robó ese ladrón (al principio, casi nada).
  2. La cuota baja si la banda pierde a alguien («somos menos, nos falta menos»).
  3. «¡Por mí y por todos!» (de las escondidas): entregar una bolsa libera a un compañero.
- Medición clave: si la policía hace el primer arresto antes de la primera bolsa, ¿cuántas veces ganan igual los
  ladrones? Si es casi nunca, el primer arresto decide la ronda.

## 4. Modo «El gran golpe», inspirado en La Casa de Papel (2026-10-06)

- Un solo objetivo grande, por fases: entrar → perforar o imprimir (los ladrones defienden, la policía ataca) → sacar
  el botín → escapar por un túnel.
- Policía cobra por arresto (dinero para equipo de calle: escudo, gas, linterna, radio, refuerzo).
- Ladrones llegan con un plan preparado (equipo elegido antes de la ronda). Rol opcional: el Profesor, que juega desde
  afuera con las cámaras.
- Se descartó por ahora: demasiadas reglas para lo que se busca.

## 5. Recompensas y rangos (estilo One Piece, 2026-10-07)

- **Recompensa por ladrón:** crece con lo que roba; atrapar al más buscado paga mucho, a uno chico casi nada. Cartel de
  «Se busca» con el precio. Esto sí gustó.
- **Rangos de ladrón:** Ratero → Ladrón → Atracador → Leyenda. Más poder, pero también más exposición (se le oye más
  lejos; «avistamientos» de las Leyendas).
- **Objetivos por zona:** afueras (kiosco, poco y fácil) → barrio (joyería) → centro (banco, mucho y peligroso). Sin
  prohibir: lo grande es arriesgado, no cerrado. La meta pasa a ser dinero, no bolsas.
- **Rangos de policía:** se asciende con la recompensa cobrada (no con la cantidad de arrestos). Cuando aparece una
  Leyenda, la central asciende a «Almirante» al mejor policía: un duelo natural entre los mejores de cada lado.
- Si algún día va a Steam: inspiración sí, copia no (nombres, ropa y personajes propios).

## 6. Progreso que se guarda entre partidas (2026-10-07) — anotado, no convence del todo

- Idea: que el rango, la fuerza y la velocidad se mantengan de una partida a otra; partidas emparejadas por rango.
  Sin armas: solo fuerza y rapidez como «poderes». Captura por forcejeo («¡te tengo!» / «¡me solté!»).
- **Riesgo principal:** si los números crecen sin techo, un veterano es inalcanzable o imposible de escapar. Al
  calibrar, centésimas de velocidad movieron a los ladrones del 20 % al 95 %.
- Cómo tener las dos cosas:
  - Separar **nombre** (para siempre: rango, cartel, récords, apariencia) de **poder** (con techo, ~5–8 %).
  - Los rangos dan **poderes nuevos con recarga** (impulso, salto, escabullirse; embestida, agarre firme, olfato),
    no números más grandes.
  - Emparejar por rango y pagar según la diferencia.
  - Primeras partidas entre principiantes o con bots.
- Implica servidor propio (para que no se pueda hacer trampa con el progreso) y mucha gente conectada. Lo que se
  venda, si algo, que sea apariencia: nunca poder.

## 7. Técnicas (para cuando se programe)

- Muros delgados (en los bordes entre casillas): mejor para el 3D y para cuartos con espacio. Se dejó para después
  porque los muros gruesos mantienen rápidas las pruebas.
- Multijugador: el motor es determinista, buena base. Salas de Steam sin servidor propio alcanzan para jugar; el
  progreso persistente pide servidor.

---

## Por qué la idea de los NPC funciona (análisis del 2026-10-07)

- **Es el juego de patio más simple de todos:** «¿quién es el ladrón?». Se explica en una frase: *los ladrones se
  esconden entre la gente; la policía tiene que descubrirlos.*
- **Cada lado tiene una habilidad distinta:** los ladrones **actúan** (caminar como cualquiera, no correr, no mirar
  raro); la policía **observa** (ver qué no encaja). No depende de quién es más rápido.
- **Un ciclo natural, sin reglas extra:** escondido → robar (llama la atención) → huir → romper el contacto visual →
  volver a caminar como uno más. La persecución sigue existiendo, pero empieza y termina sola.
- **Es un género probado:** juegos como Hidden in Plain Sight, SpyParty o Deceive Inc. viven de esta idea.

### Reglas que hacen falta

- **Qué es sospechoso:** correr, entrar por la puerta de atrás, quedarse mucho frente a la bóveda, llevar una bolsa
  a la vista, ir contra la corriente. Robar es ruidoso: la alarma revela la zona, no a la persona.
- **Causa probable:** un policía sólo puede atrapar a quien vio hacer algo, o a quien la central marcó con un motivo.
  **Atrapar a un ciudadano inocente tiene costo:** el policía queda suspendido unos segundos y los ladrones ganan
  tiempo.
- **Dos papeles en la policía:** la **central** (vista desde arriba, marca puntos) y los **policías de calle** (van,
  verifican, atrapan). Con 2 policías o más.
- **Trampas:** un señuelo o un compañero que llama la atención a propósito lejos del robo de verdad.

### Riesgos

- **Si los NPC se mueven raro, se distinguen de las personas** (o al revés). Necesitan rutinas variadas y creíbles, y
  los jugadores tienen que poder imitarlas: misma velocidad al caminar, detenerse, entrar a tiendas.
- **Equilibrio entre esconderse y descubrir:** si mezclarse es perfecto, la policía no encuentra a nadie; si es
  imposible, no tiene gracia. El robo (que siempre delata) es el contrapeso natural. Medible con bots: cuánto tarda la
  policía en identificar a un ladrón y cuántas veces atrapa a un inocente.
- **Rendimiento:** muchos NPC caminando; con rutas simples por la grilla es manejable.

### Encaje con lo que ya existe

Las ciudades, los edificios con habitaciones (se entra y se sale como cualquiera), las guaridas como escondites, la
comisaría, el oído y el calibrador sirven tal cual. Lo nuevo: los NPC, el modelo de sospecha, la vista de la central y
la regla de causa probable. Las ideas 2 a 6 se pueden sumar después encima de ésta.

**Las vías de afuera, planeadas como en la vida real (pedido de Miguel, 2026-10-11).** Afuera de la ciudad no queda nada
generado salvo el terreno y las vías: sin casas, pueblos, puestos, tiendas, terrazas ni senderos (`ISLA_GEN` en
blueprint.js, apagado), sin las carreteras que subían a la montaña (`CARRETERA.modo:'anillo'`; 'serpentina' y
'busqueda' siguen ahí) y el 3D sin casas ni hitos al azar cuando hay plano. La red, con la semilla de la ciudad:
- **Un anillo de circunvalación** a 22–58 m del muro (la distancia varía suave con la semilla), con arcos en las esquinas
  y curvas amplias (promedio de ±6 puntos); por la pradera y la playa y al pie de la montaña. Donde no hay tierra firme
  busca más cerca (hasta 8 m) o más lejos; un corte de menos de 45 m sobre agua se cruza con un **puente**. Altura: el
  terreno promediado en ±20 m y nunca más de 7 % de pendiente (corte y relleno). Con franjas para casas a los costados.
- **Avenidas de salida**: las carreras rectas de la ciudad (la calle entra derecha desde el muro al menos el 60 % del
  largo), las más largas primero, hasta 3 y separadas; siguen derechas desde el muro hasta el anillo y empalman en T.
Medido en 6 ciudades: el anillo queda cerrado en todas (929–1.589 m, con 114–186 m de puentes) y las 3 salidas de cada
una llegan al anillo. En el 2D, las barandas de los puentes; en el 3D el puente todavía es un terraplén.

**Las salidas siguen la calle y terminan en una mini rotonda (pedido de Miguel, 2026-10-11).** Sin anillo
(`conAnillo:false`), cada avenida sale de la carrera derecha hasta el agua, el borde o donde haría falta cortar más de 3 m.
La casilla del muro por donde sale es **calle** en el 3D (world3d.js): la carrera sigue con sus andenes y su cebra, sin
un andén atravesado, y la avenida de afuera arranca al nivel de la calle. Al final, una **mini rotonda**
(`CARRETERA.rotonda`: 8 m de radio, asfalto hasta 7 m, isla de 2,5 m con un árbol, andén y tres faroles) que cabe entera
en tierra; si no cabe, se corre hacia la ciudad. El tráfico de la ciudad la usa (traffic3d.js): un carro que llega a la
puerta sale por su carril, da la vuelta a la rotonda dejando la isla a la izquierda y vuelve por el otro carril (uno por
salida a la vez; los buses no salen). Medido en la ciudad 31337, 5 min simulados: 16 de 18 vehículos salieron, 15 dieron
la vuelta y 14 ya habían vuelto. Además: bajo la ciudad el terreno queda justo debajo del paseo (antes −0,6 m: el agua
asomaba en dientes de sierra en la orilla) y del lado del agua la arena empieza en la orilla de la ciudad.
**Sólo hacia la montaña.** Las avenidas salen únicamente por las puertas que miran a un macizo (`monteMin`: la montaña
pesa más de 0,35 a 40 m del muro), se cortan si se van hacia el lado de la playa y la rotonda no se apoya en arena; si no
cabe la rotonda, esa salida no se hace. Medido en 8 ciudades: 21 salidas, todas con rotonda y lejos de la playa
(la montaña pesa al menos 0,42 alrededor de cada rotonda; la arena empieza bajo 0,25).
**Del medio de los lados, no sólo de las esquinas.** Las puertas se ordenan por lo centradas que están en su lado (más la
mitad de lo larga que es su carrera) y la carrera pide al menos el 30 % del largo (`carreraMin:.3`, antes .6). Una puerta
que no da rotonda no gasta cupo. Medido en 8 ciudades: 3 salidas en todas, la mayoría del medio de un lado.
**Todas las calles del mismo ancho (2026-10-11).** `CIUDAD.avenidas` (engine/ciudad.js) apagado: los cortes largos ya
no son avenidas de dos casillas con kioscos; todas las calles son de una casilla y doble sentido. Las salidas sólo salen
de calles de verdad (no de una puerta ni un callejón que da al borde) y prefieren las que cruzan la ciudad por el medio.
Ojo: cambia el trazado de todas las ciudades; lo medido antes con avenidas (tablas de bots, líneas de vista por los
kioscos) hay que volver a medirlo. Sin avenidas tampoco hay buses (en 3D sólo andaban por avenidas). Si se vuelven a
prender, la salida de una avenida sale con su ancho (12 m, doble amarilla y rotonda grande).

**La grilla de la montaña, estilo circuito (pedido de Miguel, 2026-10-11).** `CARRETERA.modo:'grilla'` (blueprint.js):
las calles de la ciudad que llegan al muro siguen afuera como una grilla de manzanas sin casas, sólo del lado de la
montaña (`monteMin`). Líneas: las de esas calles y, fuera del ancho de la ciudad, una cada `grilla.paso` (42 m). Cada
tramo entre dos cruces se construye si su pendiente no pasa de `gradoMax` (30°) y el terreno a lo largo no se aparta más
de `corte` (5 m) de la recta; si no, queda en `isla.grilla.rechazos` (en el 2D, punteado: rojo por pendiente, naranja
por corte). Sólo queda lo que se alcanza desde la ciudad. En cada giro sin cruce, la esquina es un chaflán a 45°
(`chaflan`, 8 m), como una pista de circuito impreso. Medido en 4 ciudades:

| gradoMax | tramos | cruces | sin construir: pendiente | corte |
|---|---|---|---|---|
| 30° | 806 | 488 | 19 | 68 |
| 20° | 698 | 471 | 133 | 52 |
| 15° | 455 | 322 | 256 | 44 |
| 10° | 207 | 156 | 405 | 34 |

A 30° casi todo se construye (30° es 58 % de pendiente: un carro de verdad no sube eso; las calles más empinadas del
mundo rondan 19°). Falta el 3D: los cruces (hoy cada cadena es una cinta con andenes, que se pisan en los cruces) y el
tráfico por la grilla.
**Ajustes de la grilla (pedido de Miguel).** Sin calles pegadas: sólo dan línea las calles que salen hacia la montaña y
dos líneas a menos de 0,6·paso se funden. **Las transversales a la pendiente van a nivel**: un tramo que va más de través
que a lo largo de la pendiente (en su punto medio) es transversal; los transversales seguidos de una línea forman una
terraza de una sola altura mientras el terreno no se aparte más de `corte` m (si no, rechazo 'nivel'); un cruce en dos
terrazas les impone la misma altura. Sólo las que suben la ladera llevan pendiente. Medido en 4 ciudades: 57–83
transversales a nivel por ciudad, 70–106 subidas (mediana 14–16°, máximo 29,8°), 23–30 tramos sin hacer por no poder
quedar a nivel; 13–24 piezas inclinadas de través por ciudad, que son los chaflanes entre una terraza y una subida y
las entradas desde el muro.
**La grilla en 3D.** Los cruces se arman como en la ciudad (island3d.js): un cuadro de asfalto a nivel en cada punta de
cadena que no es el muro, andenes de 1×1 m en las esquinas y, del lado donde no llega calle, un andén que lo cierra;
cebras en las calles que llegan (inclinadas con la calle). Cada calle se recorta hasta el borde del cruce. En los
chaflanes el andén va con inglete (no se pisa ni cambia de ancho) y los andenes llevan la cara de afuera hasta el
terreno. Pendiente máxima: 12° (21 %). En 4 ciudades: 158 tramos y 108 cruces (a 30° eran 806 y 488). Falta: tráfico
por la grilla.
**Sin calles pegadas al muro.** Las líneas de la grilla de afuera se medían desde la primera calle de la ciudad; si esa
calle no estaba en la esquina, la siguiente quedaba a 9 m del muro, paralela a la circunvalación (en 5 de 40 ciudades;
por ejemplo 42 con 3 jugadores). Ahora se miden desde el muro: la primera a `paso` m (42). En 40 ciudades ningún tramo
corre a menos de 30 m del muro.
**Pendiente 14° (25 %).** Para que suba un poco más: en 4 ciudades, a 12° la grilla llegaba en promedio a 9 m de altura
(121 tramos), a 13° a 17 m (151), a 14° a 26 m (209) y a 15° a 36 m (250). Queda en 14°.
**Lotes aplanados y esquinas rectas.** Cada casilla a menos de `grilla.lote` (21 m) de una calle de la grilla se aplana o
se rellena a la altura de la calle en el punto de enfrente (`c.terraza`, `c.lote`): junto a una calle a nivel queda una
terraza; junto a una que sube, escalones de una casilla. Si habría que mover más de `rellenoMax` (8 m), se deja el
terreno. El 3D las dibuja como las terrazas (muro de contención entre niveles) y no pone árboles, rocas ni arbustos en
los lotes. Las esquinas son rectas (`chaflan:0`): cada giro corta la cadena y se arma como un cruce de la ciudad (andén
en L). Las líneas de la grilla van en el centro de una casilla (la calle ocupa su casilla). En 4 ciudades: 5.288
casillas de lote, 186 tramos, 124 cruces; la grilla llega en promedio a 19 m (antes 26 m: al correr las líneas al
centro de las casillas cambió qué tramos pasan la pendiente).
**Manzanas en dos escalones (sin casas todavía).** Cada manzana de la grilla con sus cuatro cruces y alguna calle hecha
alrededor se parte en dos mitades de través a la pendiente, cada una plana: una para casas arriba y otra para casas
abajo. Cada mitad va a la altura que tiene la calle que sube en la mitad de esa mitad (a 1/4 y 3/4 de la manzana): contra
cada calle a nivel queda un escalón de Δ/4 y entre las dos mitades uno de Δ/2 (con Δ la diferencia entre las dos calles a
nivel; a 14° y 42 m, unos 2,5 y 5 m). Si una mitad pediría mover más de `rellenoMax` (10 m), no se hace. Se quitó el
aplanado casilla por casilla junto a las calles (levantaba muros largos en el borde de la grilla). En la ciudad 31337: 24
manzanas, 798 casillas de lote, sin árboles.
**Escalones sólo en manzanas cerradas, al nivel de sus calles.** Sólo se aplana una manzana con calle en sus cuatro
lados (afuera, la montaña sigue natural, sin escalón) y cada mitad queda al nivel exacto de su calle (la de abajo y la de
arriba): el escalón va entre las dos mitades, de la diferencia entre las dos calles (en 31337, 8,8–9,7 m). En 31337: 8
manzanas cerradas.
**Tierra bajo las calles y rampa a la manzana.** Donde al costado de una calle hay un lote más bajo que ella (la mitad de
abajo junto a una calle que sube), un talud con pasto baja desde el borde del andén hasta el lote: tierra bajo la calle
y una rampa corta para entrar o salir de la manzana (de 1,2 a 5,5 m de ancho según lo que baje, 1:1,2). Donde el lote
queda más alto que la calle, sigue el muro de contención.
**Rampa para subir al escalón de arriba.** Donde el lote queda más alto que la calle (la mitad de arriba junto a una
calle que sube), la casilla del borde es una rampa con pasto que sube desde el andén hasta el nivel del lote (6 m, la
casilla entera); el bloque de esa casilla se dibuja más bajo (a la altura más baja de la calle a lo largo de ella) para
que la rampa se vea. Las rampas siguen hasta la esquina de la manzana (junto al cruce). Las calles de la grilla ya no
llevan baranda.
**La rampa de subida, triangular.** Como la de bajar: su ancho va con lo que sube (1,2 m por metro, de 0,4 a 5,5 m),
angosta junto a la esquina y más ancha donde la calle queda más abajo; el resto de la casilla del borde queda plano al
nivel del lote. El pasto de las rampas usa el mismo verde que los escalones (antes el color iba sin pasar a lineal y
salía más claro).
**Dos rampas limpias.** La de arriba ya no baja el bloque de la casilla (dejaba un escalón raro donde terminaba): esa
casilla no lleva bloque y la calle dibuja el filo cortado en rampa (desde el andén hasta el nivel del lote, triangular)
más el resto plano al nivel del lote; el terreno de debajo se baja. La de abajo sigue siendo un relleno. Se decide por
tramo (por la casilla del punto medio) con muestras en los bordes de casilla, así cada rampa termina justo donde
termina su casilla, y en cada punta se cierra con la cara de tierra hasta el vecino (la mitad de abajo o la calle).
**Sin planos en las esquinas.** La casilla de la esquina de la mitad de arriba toca dos calles: la que sube y la de
nivel del cruce. La de nivel también dibujaba la parte plana de la rampa de subida (a la altura del lote) y tapaba la
rampa de la otra calle. Ahora la rampa de subida sólo la dibuja la calle que queda más baja que el lote.
**Todas las manzanas en dos escalones, y sin árboles por ahora.** Una manzana de la grilla ya no tiene que estar cerrada
por calle en sus cuatro lados: basta con sus cuatro esquinas en la grilla y alguna calle hecha. También las pegadas a
la ciudad (entre el muro y la primera línea de afuera): del lado de la ciudad la esquina es la entrada desde el muro o,
si esa línea no llega al muro, el muro mismo al nivel de la ciudad (y la franja de esa línea queda dentro de la
manzana, sin zanja). Medido: 20, 7, 24 y 26 manzanas en las ciudades 31337, 1, 7 y 42 (antes 8, 0, 15 y 14). El mar se
decide por el terreno natural (bajo una rampa el terreno se hunde y asomaba agua). `ISLA3D.arboles:false`
(island3d.js) quita pinos, árboles de copa, palmeras y la alameda para validar el terreno.
**Rebaje de la montaña.** `MONTE.rebaje` (isla.js): el pie de la montaña, del lado de la ciudad, se rebaja como si se
retirara tierra: desde 20 m del muro y por 110 m la ladera pierde 7° de inclinación, y ahí termina en un barranco de unos
13 m (110·tan 7°) contra la montaña natural. Nunca baja más del 60 % de lo que el terreno sube sobre la pradera (no cava
por debajo de la pradera). Medido en 4 ciudades (node):

| rebaje | tramos | manzanas |
|---|---|---|
| sin | 186 | 77 |
| 5° | 291 | 125 |
| 7° (queda) | 296 | 129 |
| 10° | 342 | 147 |
| 7°, 160 m | 358 | 158 |
| 7°, 220 m | 425 | 197 |

En 31337 pasan de 20 a 34 manzanas.
**Rebaje a 3°.** A 7° el barranco (13 m) se comía la estética de la montaña. Queda en 3°: barranco de unos 6 m
(110·tan 3°), casi no se nota desde lejos. En 4 ciudades: 247 tramos y 104 manzanas (sin rebaje 186 y 77; por ciudad
29, 12, 30 y 33).
**Sólo calles que cierran manzanas.** Una manzana está completa con calle en sus cuatro lados; pegada a la ciudad, de una
entrada desde el muro a la siguiente del mismo lado, con la calle de afuera entera entre ellas (puede haber líneas de la
grilla en el medio que no llegan al muro). Las calles que no son lado de ninguna manzana completa se descartan, y lo que
queda sin llegar a la ciudad también; se repite hasta que no cambia. Medido (rebaje 3°): ninguna punta suelta en 6
ciudades; manzanas 25, 8, 19, 21, 11 y 14 en 31337, 1, 7, 42, 99 y 5. Sólo las manzanas completas se aplanan en dos
escalones.
**Muro de contención de piedra.** Los costados de las terrazas (el escalón entre las dos mitades de una manzana y sus
bordes) llevan piedra en hiladas irregulares con juntas de mortero (`muroDePiedra`, island3d.js: textura de lienzo). La
textura va en metros del mundo (3 m por repetición, por las coordenadas del lugar en el sombreador), así no se estira en
un muro alto. Las caras de las puntas de las rampas también son de piedra: el muro sigue sin corte.
**El rebaje sólo junto a la grilla.** La grilla se calcula con el rebaje en todo el pie de la montaña (así no pierde
calles), pero después el rebaje queda sólo sobre su huella (calles y lotes, `isla.huella`) y baja suave a cero en unas 5
casillas (~30 m) alrededor (`mascaraRebaje`, isla.js; el 3D la arma desde el plano). El resto de la montaña vuelve a su
forma natural: sin la franja rebajada ni su barranco; alrededor de la grilla queda una pendiente suave.
**Calles con tierra debajo.** El talud de relleno ahora va con cualquier diferencia entre la calle y el lote de al lado
(antes sólo si pasaba de 0,3 m: con menos se veía la calle suspendida, con una sombra debajo). Y la malla del terreno se
baja sólo debajo de la calle (hasta 0,5 m más allá del andén; antes 1,5 m): ya no queda una zanja de 35 cm al lado del
andén que hacía ver la calle elevada.
**Puntas de rampa a ras.** Las rampas tenían un ancho mínimo (1,2 m la de bajar, 0,4 m la de subir) y empezaban a la
altura del andén: junto al cruce, donde la calle y el lote casi coinciden, quedaba una cuña con su cara de piedra. Ahora
el ancho va con la diferencia entre la calzada y el lote, desde cero (1,2 m por metro, hasta 5,5 m), y la de subir
arranca al nivel de la calzada: en la punta la rampa termina en nada, a ras de la calle.
**Las rampas, con la altura de la calle que se dibuja.** Las rampas tomaban la altura de la calle como si subiera desde
el centro del cruce, pero el cruce es plano y la calle dibujada empieza a subir en su borde: a 3 m del centro la rampa
creía la calle ~0,75 m más alta y quedaba hundida, con su cara de piedra, junto a la esquina. Ahora usan la calle tal
como se dibuja (recortada en los cruces) más el tramo plano hasta el centro de cada cruce: nacen en cero en la esquina.
**La rampa de arriba de vuelta, y limpieza de lo que quedaba bajo el terreno.**
- La rampa de subir arrancaba en la altura mayor entre la calle y el lote (debía ser la menor): quedaba plana arriba y
  se cerraba con caras de piedra verticales a lo largo de la calle.
- Cada calle de la grilla guarda ahora un punto en el borde de cada cruce a la altura del cruce: el terreno, la calle
  dibujada, las rampas y las cebras usan el mismo perfil (plano dentro del cruce, sube desde su borde). Antes el
  terreno se calculaba con la calle subiendo desde el centro del cruce y quedaba hasta 0,6 m por encima de la calle
  dibujada: tapaba el arranque de las calles que suben y 126 de 720 rayas de cebra.
- Los bloques de las terrazas bajaban 2,5 m bajo su vecino más bajo; ahora 0,8 m.
Medido en 31337: ningún objeto de la isla queda entero bajo el terreno (antes, 126 rayas de cebra).
**Sin geometría escondida bajo los lotes.** La malla del terreno ya no se arma debajo de un lote (si las cuatro esquinas
del cuadro de malla caen en casillas de lote, ese cuadro no va: lo tapan el bloque o la rampa): en 31337, de 62.341 a
58.039 triángulos. El dron no baja por debajo de lo más alto del lugar (`island.techo`: el lote, también sobre una
rampa) más 3 m, así no entra en los escalones. La casilla con rampa de subida la dibuja siempre la calle que sube
(aunque la rampa tenga ancho cero junto al cruce) y nunca la calle plana del cruce: sin ranuras ni planos en las
esquinas.
**La física del suelo sale de lo que se dibuja.** `island.ground` / `island.height` (lo que usan la gente, el jugador y
el dron) ya no leen sólo la función del terreno: primero buscan en los triángulos que miran hacia arriba de lo que se
dibuja sobre el terreno (asfalto, cima de los andenes, rampas y rellenos), en una grilla de 4 m —cada consulta mira sólo
los triángulos de su cuadro— y, si no hay ninguno, el terreno. En las rampas la gente ya no se hunde: la altura sube con
la rampa (en 31337, de 8,8 m en el borde del andén a 10,31 en el lote). 4.416 triángulos caminables; 1,6 µs por
consulta.
**La gente de la isla no salta muros: usa las rampas.** (citizens3d.js) Un paso no puede cambiar la altura del suelo
más de 0,35 m (un cordón sí; un muro de contención no). Y cada destino se busca con A* en una grilla de 2 m alrededor
del camino, donde un tramo vale si se camina entero sin saltos (muestras cada 0,3 m); después se acorta al punto más
lejano que se ve sin saltos. Para llegar al escalón de arriba se da la vuelta por la calle y la rampa. Medido en 31337
(20 personas, 15 min simulados): ningún cambio de altura mayor a 0,34 m entre dos pasos; 18 veces alguien pasó de un
escalón al otro de la misma manzana, siempre por las rampas; 0,8 ms por paso de simulación para las 20.
**Faroles en las calles de la montaña.** Los faroles se ponían en las puntas de los tramos a partir del tercer punto, y
una calle de la grilla entre dos cruces tiene dos: no tenían ninguno. Ahora van cada 18 m a lo largo de cada calle (el
primero a 9 m), alternando el lado, en el andén y a la altura de la calle en ese punto; ninguno a menos de 2 m de un
cruce. En 31337, 122 faroles. Debajo de cada uno, de noche, un charco de luz (malla chica de 10 m que sigue la calle, el
andén o el lote, con un degradé aditivo): toda la calle se ve iluminada aunque el demo sólo ponga luces reales en los
faroles cercanos a la cámara.
**Manzanas optimizadas: de ~920 a 42 triángulos.** Cada casilla de lote eran dos cajas (piedra y pasto, 12 triángulos
cada una): en 31337, 810 casillas = 19.440 triángulos, más 3.592 de rampas con muestras cada 1,5 m (~920 por manzana).
Ahora cada escalón es un rectángulo de pasto (las casillas del mismo escalón se juntan en rectángulos: 2 triángulos
cada uno) y el muro va sólo donde el vecino queda más bajo, juntando las aristas seguidas con la misma altura arriba y
abajo (el muro del medio de una manzana: 2 triángulos). Las rampas se muestrean en los bordes de casilla (cada 6 m: entre
dos la rampa es plana). En 31337: 100 de pasto, 50 de muros y 900 de rampas para 25 manzanas, 42 por manzana. Se ve igual.
**Optimización del demo, 1 y 2.** (1) Resolución interna 1,5 en vez de 2 en pantallas retina (DemoView). (2) Las piezas
de las fachadas del paquete downtown (molduras, marcos, cornisas: ~1,5 M de triángulos en 2 mallas que cubren toda la
ciudad) ya no proyectan sombra; cada edificio la proyecta con una caja invisible por parte de su planta, de su alto (121
cajas en 31337, que no escriben color ni profundidad pero entran al mapa de sombras) (world3d.js). Medido en 31337, misma
vista, en esta Mac: de 9,4 a 7,9 ms por cuadro y de 5,47 M a 3,29 M triángulos por cuadro (813 → 778 llamadas). Las
sombras de los edificios se ven igual.
Pendientes (orden recomendado): 3. partir las mallas grandes de la ciudad por manzana para que el motor deje de dibujar
lo que no está a la vista; 4. molduras sólo de cerca (a más de ~120 m, la fachada como un plano con su textura); 5. gente
lejana más simple e instanciada.
**Optimización 3: partir la ciudad no sirvió; lo que pesaba eran los contornos.** Partir las mallas de las fachadas por
zonas (para que el motor descarte lo que no se ve) hizo el cuadro MÁS lento en esta Mac (31337, cuatro vistas): sin
zonas 38 mallas, 13,5–17,5 ms; zonas de 60 m, 251 mallas, 13,9–17,8 ms; de 30 m, 667 mallas, 15,6–21,9 ms. Desde la calle
se ve casi toda la ciudad a lo largo de las calles y las llamadas de dibujo de más cuestan más que los triángulos que se
ahorran. Queda la perilla `DOWNTOWN.zona` (downtown3d.js) apagada.
Al medir qué costaba de verdad: el paso de contornos (edges3d.js: vuelve a dibujar la escena entera con normales para
delinear las paredes interiores) era más de la mitad del cuadro (7,2 de 13,8 ms), y desde afuera no se ve nada de lo que
delinea. Ahora se prende sólo con la cámara adentro de un edificio (`world.dentro`) o de una casa de la isla. Medido: en
la calle, de 11,6 a 6,0 ms; desde arriba, de 17,5 a 7,1; mirando la isla, de 7,9 a 4,9. Lo siguiente que más pesa: la
gente y el tráfico (ocultarlos ahorra ~4,8 ms): personajes lejanos más simples.

**Barrios residenciales en las manzanas de la montaña (2026-10-11).**
- Plano (blueprint.js, `ISLA_GEN.residencial`): tipo nuevo `residencial` (3 a 5 pisos, vestíbulo abajo y departamentos
  arriba, el programa de vivienda). Un edificio por mitad de manzana, de frente a su calle, 2 casillas de fondo y una
  casilla libre a cada costado y atrás; al nivel de la mitad (`L.nivel`). El resto de la mitad es parque (`c.parque`).
  En 31337: 50 edificios.
- `isla.barrios`: los edificios de un mismo nivel, con su marco local (origen en casillas, ancho y alto), sus lotes
  copiados a coordenadas locales con su plano rehecho ahí (ids 0..n) y un rectángulo de parque por mitad. En 31337, 8.
- 3D (barrios3d.js): cada barrio se arma con el mismo `buildWorld` de la ciudad (fachadas del paquete downtown, pisos,
  cuartos, muebles, escaleras, ascensores), en su marco local, y se corre a (ox, nivel + 0,06, oy). Opciones nuevas de
  buildWorld: `vacio` (casillas donde no se dibuja nada: calles y otros escalones del marco) y `barrio` (los parques
  son jardines: pasto entero con árboles, arbustos, alguna banca y un farol cada tres casillas, sin senderos ni fuente;
  las fachadas sin publicidad). Las casillas con rampa quedan para la isla (`ocultar: island.rampaEn`).
- Demo: el piso, los choques, el «adentro» (contornos), las puertas, los interiores, la noche y las luces de los
  barrios pasan del mundo al marco local del barrio que toque. La gente de la isla rodea los edificios y no aparece ni
  va adentro de uno (`island.bloqueo`). Medido en 31337 (20 personas, 5 min): nadie adentro de un edificio, sin saltos.
  Render: 6,8–7,5 ms por cuadro en calle, barrio e isla.
**Casas en vez de edificios en las manzanas de la montaña.** Los edificios residenciales (parecían parte de la ciudad)
quedan apagados (`ISLA_GEN.residencial:false`; el código de barrios sigue). Casas nuevas de public/models/Casa (copiadas
de dist/): revisadas las 9; se usan Building1_Small/Large (techo rojo con buhardillas, la que mejor se ve) y
Building2_Small/Large (gris angosta, liviana), escala 2,6 (un piso de unos 3 m). House1/House2 son lindas pero pesan
20–28 mil triángulos por casita; Building3/4 parecen de centro. `ISLA_GEN.casasMonte` + `CASAS_MONTE` (blueprint.js):
de 1 a 3 casas por mitad de manzana a lo largo de su calle, frente a 2,5 m del borde, 4 m entre casas, sin tocar las
casillas de los costados (rampas); `isla.casas` (modelo, centro, giro, nivel, medidas). casas3d.js: una InstancedMesh
por pieza de cada modelo, jardín con árboles del paquete de naturaleza (1–2 por casilla, a 3 m de las casas, no en
rampas), choques (una caja girada por casa y los troncos) para el jugador y la gente. En 31337: 72 casas; nadie de la
isla entra a una (5 min simulados); 3,6–4,2 ms por cuadro. Falta: entrar (el modelo es sólo la cáscara).
**Se puede entrar a las casas de la montaña.** Cada casa de `isla.casas` lleva adentro una casa armada de la isla
(island3d: paredes con puerta y ventanas, dos pisos, escalera, muebles, puerta que se abre, choques con hueco en la
puerta), 0,4 m más adentro que el modelo por lado y con la puerta al medio del frente (`casaIdx`). Con la cámara
adentro (`island.casaDentro`), el modelo de esa casa se oculta (casas3d `adentro()`) y se ve el interior. Las paredes
chocan como las de la casa armada (casas3d ya no pone una caja por casa: sólo los troncos). Probado en 31337: el
jugador camina desde la vereda, cruza la puerta (casa 22) y queda adentro («Dentro: Casa»), con cocina, mesa y sillas;
el piso de arriba con su ventana y cómoda. Costo: de 3,6–4,2 a 5,5–6,2 ms por cuadro (los interiores de 72 casas, 1,1 M
de triángulos en la isla): siguiente optimización, armar o mostrar el interior sólo cerca.
**Granja (public/models/Granja, copiada de dist/):** 13 piezas del mismo autor que la naturaleza y los animales (granero
grande, mediano, chico y abierto, silo, silo con casa, gallinero, pozo, tanque de agua, dos molinos, dos cercas), entre 200
y 8.000 triángulos, en metros. Encajan con el estilo. Recomendación: granjas en la pradera del pie de la montaña, afuera
de la grilla (no en las manzanas): granero + silo + cercas + cultivos (public/models/Cultivos) + animales
(public/models/Animales); un molino de torre como hito en alguna loma.

- **Casas habitables y el resto del pack (2026-10-11).** Se entra caminando por la puerta a los ocho modelos del «Simple
  Buildings Pack» que van en las manzanas de la montaña (House, House2–5, Shop, Flat, Flat2; el templo —Bank— y el
  hospital, no). La casa armada de adentro (island3d, casaIdx) está a ras del jardín: el escalón de la casa armada
  frenaba al jugador en la puerta. House3 sólo en planta baja: su piso de arriba es más chico y retirado (4,3 × 4,65 m) y
  la escalera caería en el techo de abajo; para subir hace falta que la casa armada acepte un piso de arriba con otra
  planta. Shop, Flat y Flat2 pesan 1 contra 3 de cada casa y va uno por mitad como mucho (31337: 15 de 100). Los
  edificios usan los muebles de una casa: una tienda con estanterías y un hall con escalera quedan para después.

- **Casas armadas (2026-10-11).** Las casas de las manzanas de la montaña ya no son modelos del pack con una casa
  procedural escondida adentro: cada una se arma desde unas pocas opciones, como un personaje con su vestuario.
  - `src/engine/vivienda.js` (datos puros): opciones (ancho 2–5 módulos de 3 m, fondo 2–3, 1 o 2 pisos, arriba igual o
    retirado con terraza, garaje izq/der, porche, techo dos aguas / cuatro aguas / plano y su pendiente, chimenea,
    puerta y su módulo, ventanas de abajo y de arriba, postigos, tablas o liso, seis colores) y seis estilos de partida
    (cabaña, clásica, moderna, familiar, chalet, casita). `planHouse` da el plano exacto en metros: paredes con sus
    vanos, losas, escalera (14 peldaños de 20 × 25 cm contra la pared izquierda, sube hacia el fondo, descanso de 1,2 m:
    entra en 6 m de fondo), baño, dormitorios, techos, muebles, pisos para caminar y zonas que quedan libres (el paso de
    cada puerta y el pie de la escalera: un mueble que estorba prueba otro lugar o no va).
  - `src/lib/vivienda3d.js`: todas las casas fundidas en una malla por material (8); puertas y ventanas del paquete de
    la casa estiradas a su vano, con vidrio transparente (de noche se encienden); la puerta se abre sola y el portón del
    garaje sube; floorAt / collide / dentro / houseAt para caminar. Los muebles, por zonas de 48 m: sólo se dibujan
    los de las zonas a menos de 40 m de la cámara.
  - `/casas` (CasasView.vue): el editor, con vistas afuera, corte de cada piso, adentro, caminar (WASD) y un barrio de
    nueve al azar.
  - En el demo (ISLA_GEN.casasArmadas): 81 casas en 31337. Medido: se entra caminando en las 81 y se sube al piso de
    arriba en las 46 de dos pisos. 1,1 M de triángulos en total, pero ~250 mil a la vez: lo fijo ~180 mil y los
    muebles cercanos ~65 mil (antes de las zonas eran ~780 mil).
  - Falta: lo de adentro de la tienda (no hay tiendas armadas todavía), una cocina con isla o un comedor aparte en las
    anchas, luces de adentro de noche (hoy sólo brilla el vidrio), y Naturaleza2 para los jardines.

- **Jardines con Naturaleza2 y tejados (2026-10-11).**
  - Jardín (casas3d.js): árboles de Naturaleza2 (comunes, abedules y uno de cada ocho de otoño) con nivel de detalle
    (lod3d.js: una InstancedMesh por pieza y modelo; update() reparte cuáles van detallados a < 40 m y cuáles livianos
    —los de Naturaleza— más lejos, sin sumar llamadas de dibujo). Abajo arbustos, plantas, rocas con musgo y tocones
    (< 30 m); canteros de flores frente a cada casa armada y un caminito de piedras hasta la calle. Medido en 31337: 29
    llamadas; ~180 mil triángulos de los 337 árboles de lejos (igual que antes) + 25 a 60 mil de lo cercano.
  - Tejados (vivienda.js, opción `tejado`: barro, madera o liso): cada agua en hileras de ~40 cm con un labio de 4,5 cm
    (las líneas se ven por la geometría, caras planas) y una textura en grises de tonos planos teñida con el color del
    techo: canales de barro o tejuelas de madera corridas por hilera. Tapacanes y fascia del color de los marcos,
    alero claro por debajo, caballete en la cumbrera y en las limatesas. Suma ~18 mil triángulos en las 81 casas.
  - Más ideas para las casas, sin hacer: maceteros bajo las ventanas, un ojo de buey o rejilla en el hastial,
    farol junto a la puerta encendido de noche, canaletas y bajantes, cercas bajas de madera entre lotes, buzón.

- **Faroles, focos y maceteros (2026-10-12).** Todo en cajas dentro de la malla fundida de las casas (sin llamadas de
  dibujo nuevas). Farol junto a la puerta (en la pared, o colgado del techo del porche) y un foco bajo cada lámpara
  de techo: van en el material `farol`, que de noche se enciende (y sus luces entran en la lista de luces cercanas
  del demo). Maceteros bajo las ventanas del frente, en los dos pisos: la caja del color de los postigos, la mata y
  flores en dos tonos (opciones `maceteros` y `flores`: rojas, rosadas, amarillas, blancas, moradas, naranjas; la
  moderna viene sin).

- **Hastiales, canaletas, cercas y buzones (2026-10-12).**
  - Hastial (opción `hastial`: ojo, rejilla o nada): en cada hastial de dos aguas (también el del garaje, que da al
    frente) un ojo de buey octogonal con vidrio y cruz, o una rejilla con marco y cuatro tablillas. Caras planas.
  - Canaletas (opción `canaletas`; la moderna sin): una canaleta bajo cada alero y bajantes cerca de las esquinas,
    hasta el suelo, la terraza (retirado) o el techo del porche; en el garaje, no del lado de la casa. Gris de chapa si
    el marco es claro (en blanco se perdían contra los esquineros), o el marco oscurecido.
  - Lotes (casas3d.js, una InstancedMesh de cajas): cerca baja de madera (postes cada 1,6 m y dos travesaños) a 2 m
    del frente, con paso frente a la puerta y frente al garaje, y entre vecinos; buzón del color de la puerta a la
    derecha del paso; entrada de autos del portón a la calle. Las cercas son sólidas (2026-10-12): cada tramo es un
    segmento que choca (jugador y gente de la isla), con troncos y cercas por casillas de 8 m. Para que la gente use el
    paso, casas3d.portal(from, to) da los puntos de afuera y de adentro del paso de la puerta cuando from y to están en
    lotes distintos, y la ruta de citizens3d.js se arma tramo a tramo pasando por ellos (la grilla de 2 m del A* no
    encuentra sola un paso de 1,4 m). Medido en 31337: 7 rutas de la vereda al patio, todas por el paso y sin cruzar
    cercas (43 ms las 7); el jugador frena contra la cerca y entra por el paso; 20 vecinos simulados 60 s: ninguno en una
    cerca ni quieto.

- **Los vecinos visitan los jardines (2026-10-12).** En el plan de la gente de la isla, un 20 % de las veces el destino
  es el patio de adelante de un lote a menos de 140 m (casas3d.jardin: un punto libre entre los canteros y la cerca,
  fuera del caminito); entra por el paso y se queda de 4 a 12 s. Medido en 31337, 20 vecinos, 2 min simulados: 4
  visitaron un jardín, hasta 3 a la vez, ninguno en una cerca ni quieto. Costo: la gente pasa de 3,95 a 4,07 ms por
  paso. Esos ~4 ms ya estaban: cada consulta de bloqueo cuesta 4,3 µs y casi todo es el terreno de la isla
  (island.ground 2,8 µs, island.walkable 3,5 µs); las cercas 0,2 µs y las casas armadas 1,3 µs. Si hace falta,
  ahí hay para optimizar (una caché del suelo por casilla).

- **Fachadas de edificios por barrio (2026-10-12).** Como las casas, pero con las piezas del Downtown MegaKit:
  - `src/engine/fachada.js` (datos): pared (ladrillo, piedra, metal y concreto) y su pintura, ventana del primer piso y
    de los de arriba (6, todas de 2 m), cornisa, esquinas (columna de piedra, de metal, fina o esquina de ladrillo, con
    pieza de abajo, del medio y de arriba), marco y hoja de la puerta, banda sobre la planta baja, columnas en la
    vidriera, techo plano o mansarda de pizarra (con buhardillas y su pieza de esquina), equipos de aire en la azotea.
    12 estilos de partida y 3 familias de barrio: histórico (casona, molduras, almacén, brownstone), elegante (parisino,
    hotel, victoriano, clásico) y centro moderno (moderno, oficinas, industrial, concreto y vidrio).
  - El plano (blueprint.js, facadeLots): la ciudad en una grilla de zonas de ~14 casillas; cada zona, una familia (dos
    vecinas en línea recta nunca igual); cada lote, un estilo de su familia con una de sus pinturas. Los públicos
    (comisaría, hospital, colegio…) siguen con el suyo. Termina la decisión «ladrillo en todos» (2026-10-10).
  - town3d.js arma la fachada desde la ficha (L.fs). La pieza de esquina de la mansarda ocupa el cuadro de 2 × 2 m del
    módulo de la punta y cae hacia su −x (medido en su geometría): tal cual en la punta izquierda, girada 90° en la
    derecha, una sola vez por esquina. Al pintar el metal se usa su textura en grises (si no, quedaba casi negro).
  - `/edificios` (EdificiosView.vue, con blueprint.buildingRow: edificios en fila con su plano completo): el editor,
    con vistas afuera, desde la calle, corte por piso, caminar y una cuadra de seis al azar de un barrio.
  - Costo medido en 31337: 2,28 M de triángulos contra 2,10 M con ladrillo en todos (+8 %); el tiempo de armado, igual.
    Con las ventanas de moldura en todos los pisos y la banda en más estilos eran 2,95 M (+40 %): las ventanas de
    arriba son lo que más pesa (moldura 424 triángulos, cuadrada 188), por eso la moldura queda para el primer piso.
  - Pendiente: las piezas de 4 m (ventana doble roja y blanca, de arco doble, en recuadro) piden juntar dos módulos;
    escalinata y maceteros de vereda; los públicos de metal (mercado, cine) siguen oscuros.

- **Ventanas de 4 m, balcones y toldos (2026-10-12).** Opciones nuevas de fachada (fachada.js) que arma town3d.js:
  - `doble`: en cada piso de arriba, si dos módulos seguidos son ventana, una pieza de 4 m centrada entre los dos (roja
    y blanca, de arco, en recuadro, en recuadro con arco, de arco chico, de fábrica de metal). Brownstone, victoriano,
    industrial y el estilo nuevo «rojo y blanco» (familia histórica) la usan.
  - `balcones`: frente a la ventana del medio de cada casilla, del segundo piso para arriba y sólo hacia afuera: la
    losa de concreto del paquete (Entrance_Concrete_2x1 a 15 cm), las barandas de los costados (las de una escalera
    recta: Stairs_Rails_Metal_Straight_1, que traen justo las dos barandas de 2 × 1 m) y adelante la baranda baja
    (Trim_Wall_Guard). Parisino, hotel y victoriano.
  - `toldos`: sobre cada vidriera de la planta baja, una lona inclinada con faldón, a rayas del color elegido (7).
  - buildDowntown acepta `sy` (escala vertical) en las piezas.
  - Medido en 31337 (contando instancias): 2,73 M de triángulos contra 2,44 M con ladrillo en todos (+12 %).
  - Escalinata: NO hecha. La del paquete mide 1 m de alto y la vereda está 15 cm por encima del piso de los
    edificios: sólo tiene sentido levantando la planta baja del edificio (pisos, choques, escalera, ascensor, muebles y
    gente de adentro con un desnivel por lote). Es un cambio en world3d/town3d/indoor3d aparte.
  - Otros modelos: public/models/edificios/*Story*_Mat (22 edificios de pueblo low poly, de 1 a 6 pisos, con toldos,
    balcones y escaleras de afuera; el color va por material —Main, Bricks, Light, Dark, Wood, Glass—, así que se
    pintan). Son cáscaras sin interior y de otro estilo que el MegaKit: van mejor en un pueblo de la isla que en las
    manzanas de la ciudad.

- **Escalinata: la planta baja levantada (2026-10-12).** Opción `escalinata` (fachada.js; brownstone, parisino,
  hotel, victoriano y clásico): el edificio entero sube RAISE = 0,6 m (L.raise). Dónde se suma:
  - town3d.js: las piezas, hojas de puerta, toldos, tabiques, muebles, asientos, camas y placas del lote (se arman a
    nivel y al final suben); los choques de altura finita (wallLift en wallAny); las cabinas y puertas del ascensor.
    Lo que no sube: el zócalo bajo la planta baja (la pared ciega del estilo a 0,6 m), la escalinata en cada puerta de
    calle (Stairs_Entrance_Concrete a 0,6 m de alto y 1 m de fondo, lo que mide la vereda, con sus barandas) y el muro
    que asoma entre el techo de un vecino más bajo y lo nuestro.
  - world3d.js: floorAt (el piso del lote, la escalera y, afuera, la escalinata como rampa de 0 a 0,6 m), elevatorAt
    y updateElevators (piso = (pies − R)/3), dentro, las placas; DemoView.ride (al subir en ascensor, pies = piso·3 + R).
  - indoor3d.js: la gente de adentro camina y se sienta a la altura del lote.
  - Medido: en /edificios se sube la escalinata a 0,6 m y se entra; el ascensor da 0,6 / 3,6 / … / 12,6 m. En 31337,
    36 edificios levantados y 97 puertas con escalinata; el jugador del demo entra por 8 de 8 probadas (5,5 a 7 m
    adentro, pies a 0,6 m).
  - La gente de la vereda atraviesa las escalinatas (ocupan la vereda entera de 1 m).

- **Gente que rodea las escalinatas, toldos sobre las vidrieras y ascensor a la azotea (2026-10-12).**
  - Peatones (world3d.js, grilla de 1 m de la vereda): las dos casillas de cada escalinata salen de la grilla y entran
    cuatro de la franja de calle pegada al cordón (el desvío). Medido en 31337: las 97 escalinatas fuera y con desvío;
    18 peatones 60 s: 0 de 2.160 muestras sobre una escalinata (251 a menos de 3 m de una).
  - Toldos: el vidrio de las vidrieras llega a 2,94 m; los toldos de los locales (world3d.js) y los de la fachada
    (town3d.js) arrancan a 2,97 m, más la planta baja levantada; los letreros de los locales también suben con ella.
  - Ascensor: una parada más, la azotea (el techo plano, o el de arriba de la mansarda: L.h + 2,8 m), donde la
    cabina asoma como una caseta. floorAt da la azotea a quien llega ahí; elevatorAt da las paradas y su altura (y(n));
    DemoView.ride la usa y el letrero dice «azotea». Las paredes de afuera son de altura infinita para los choques:
    desde la azotea no se cae. Medido: 40 ascensores; las paradas cuadran (común: 0…18 y azotea 21; levantado con
    mansarda: 0,6…15,6 y azotea 21,4); el jugador sale de la cabina y camina 7,8 m por la azotea.

- **Ventanas sin tabique en el medio y puertas a los balcones (2026-10-12).**
  - Medido antes de tocar (blueprint de 31337, 7 y 42): de 26.364 módulos con ventana de 2 m, ninguno tiene un
    tabique que llegue a la fachada dentro de su vano; el problema eran las ventanas de 4 m, que juntan dos módulos y
    el tabique entre dos cuartos cae justo en su borde común. Ahora (town3d.js) dos módulos se juntan sólo si ningún
    tabique, pasillo o núcleo llega a la fachada a menos de 35 cm de ese borde (partsAt / freeEdge, con los cuartos del
    plano de ese piso).
  - Balcones: el módulo del balcón pasa a ser una puerta (el marco y la hoja de la de calle; en ese piso no hay ventana
    doble). La hoja se abre sólo con alguien a su altura (cy: buildDowntown mira los pies). La fachada deja libre ese
    vano a esa altura (los vanos de un módulo —puerta de calle y de balcones— se juntan y la pared va en lo que queda).
    El balcón se pisa (world3d.balconyAt: el más alto a menos de 45 cm de los pies; los de la calle pasan por debajo) y
    sus barandas frenan (paredes de 1,1 m al frente y a los costados). Medido en /edificios (hotel, 3 casillas, 5
    pisos): piso del balcón 6,6 / 9,6 / 12,6 m en los tres de cada piso; de adentro al balcón no hay choque hasta la
    baranda (frena a 24,75 m, la baranda está en 25).

- **Retoque de color: pared, molduras y carpintería (2026-10-12).**
  - Antes se pintaba sólo la pared; molduras y marcos quedaban con su textura (beige y gris oscuro): poco contraste.
    Ahora tres zonas por edificio (fachada.js: PAINTS, TRIMS, JOINERY; downtown3d.tintOf con {zones}): pared;
    molduras (MI_Trim: cornisas, contornos, columnas; en la familia de piedra la pared es ese mismo material, así que
    ahí no hay zona de molduras); carpintería (MI_Trim_MetalConcrete, MI_Trim_Green, MI_Trim_Dark: marcos, puertas,
    vidrieras, barandas de escalinata y balcón). Las hojas de las puertas se pintan por edificio (instancias por pieza
    y color). Escalinatas y losas de balcón no se pintan (concreto).
  - Cada estilo trae combinaciones curadas [pared, molduras, carpintería] (combos) y cada edificio toma una al azar:
    p. ej. brownstone chocolate/crema/negro, victoriano lila/blanco/vino, parisino crema/—/grafito, hotel salmón/—/vino,
    industrial natural/grafito/negro. Puertas por estilo: el hotel pasa a puerta de vidrio.
  - Las texturas que se pintan (ladrillo, molduras, metal) usan su versión en grises normalizada a un brillo medio de
    82 % (con su dibujo): el color pintado sale como es.
  - Editor: «Combinaciones del estilo» (tres colores por botón) y filas de pared, molduras y carpintería.

- **Avisos en la azotea, no en la fachada (2026-10-12).** Los avisos de los edificios (planFacadeAds, en tramos de
  dos casillas o más) iban pegados a la fachada entre el primer y el tercer piso y dejaban esa parte sin ventanas
  (blankOut). Ahora van al frente de la azotea de ese mismo edificio, sobre dos postes y mirando a la calle; la
  fachada conserva todas sus ventanas. El techo cuenta la mansarda y la planta baja levantada (topOf), también para
  las vallas de azotea por manzana (que no se ponen a menos de 6–8 m de otra). 31337: 59 vallas en azoteas.

- **Interiores según el tipo de edificio (2026-10-12).**
  - Tabiques (town3d.js): cada tramo toma un estilo según los cuartos que separa —abierto (la planta de oficinas, el
    lobby y la sala de lectura hacia el pasillo: sin tabique), de vidrio (oficinas privadas, reuniones, sala de
    profesores, consultorios, enfermería: zócalo y remate oscuros, paño transparente y un parante cada ~1,2 m) o macizo
    (el resto)—; en un tramo compartido gana el más cerrado. Los paños van en una lista aparte (glass) que world3d
    dibuja de cerca con un material transparente. Los choques son los mismos.
  - Suites (blueprint.js, suites()): los pisos de hotel y de hospital se parten en habitaciones de 4 m con su entrada
    desde el pasillo (2 × 2 m, con armario) y su baño al lado, la habitación hacia la fachada; el hospital pone una
    enfermería por piso. Con menos de 5 m de fondo, habitaciones simples. La cama de hotel ya no sale camarote.
  - 31337, piso 2: hotel 7 habitaciones (4 en suite), hospital 13 habitaciones + 2 enfermerías; las oficinas, planta
    abierta con filas de escritorios y oficinas de vidrio.
  - Suites también con fondo corto (2026-10-12): con menos de 5 m de fondo, suites de 6 m de frente (habitación de 4 m
    que entra directo del pasillo y baño de 2 m que ocupa todo el fondo a un costado); en los lotes de 6 m sin pasillo,
    habitación de 4 m + baño de 2 m, una tras otra (la cadena de puertas se salta los baños). Donde no cabe una suite
    (p. ej. los rincones de 4 × 4 m junto al núcleo en un lote de 12 × 12) va un cuarto de servicio (depósito), no una
    habitación sin baño. Medido en 31337, 7, 42, 5 y 99: todas las habitaciones de hotel y de hospital con baño propio
    (31337: 170 de 170; 99: 321 de 321, con 113 cuartos de servicio).

- **Interiores de colegio, biblioteca, policía y bomberos (2026-10-12).** Programas nuevos (blueprint.js) y estilos de
  tabique (town3d.js):
  - Colegio: abajo secretaría (vidrio), comedor (mesas, mesón y nevera; abierto al pasillo), baños escolares
    (sanitario: dos inodoros y dos lavamanos) y enfermería; arriba aulas con pupitres, sala de profesores y baños.
  - Biblioteca: abajo mesón de préstamo (abierto), sala de lectura, estanterías y sala infantil; arriba sala de
    lectura (4 libreros contra las paredes y mesas) y salas de estanterías (filas de libreros con pasillos de 1,2 m:
    receta especial «estantes»).
  - Comisaría: arriba oficinas de vidrio, sala abierta, celdas con REJAS hacia el pasillo (rango 1,5: riel abajo, al
    medio y arriba y un barrote cada 15 cm; entre celdas, pared), sala de interrogatorio (vidrio) y evidencias.
    Puesto de policía: oficina, sala abierta, celda, baño y dormitorio.
  - Bomberos: vestuario con casilleros abajo (junto al garaje) y arriba.
  - El editor de edificios ofrece esos usos (hospital, colegio, biblioteca, comisaría, bomberos).

- **Muebles de Casa2 (2026-10-12).** dist/models/Casa2 → public/models/Casa2 (23 modelos: camas, libreros vacíos y con
  libros, sillas, sillones de 1, 2 y en L, mesas de centro, mesa, armarios, lámparas de pie, planta, floreros,
  banqueta; 108 a 3.500 triángulos). Validación:
  - Vienen SIN colores: el .mtl trae el mismo gris (Kd 0,64) en todo y no hay texturas; pero los nombres de material
    dicen qué es cada parte (Wood, DarkWood, Sheets, Green, Red, Metal, Top, Pages, Cover2-4, Sofa, Vase): loadCasa2
    (nature3d.js) pinta por nombre.
  - Miran hacia +x (respaldo y cabecera en −x, medido en la geometría); el resto de los paquetes mira hacia +z: se giran
    −90° al cargar. Y vienen en proporciones chicas: escala por modelo (cama 2,0 m de largo, silla 0,94 m de alto,
    librero 1,99 m, lámpara 1,56 m).
  - Se guardan como C2_<nombre> (Oficina tiene nombres iguales) y van con los muebles de oficina en el demo y en
    /edificios. Usados: el librero con libros (estante, antes del de Oficina: bibliotecas, oficinas, archivo), la
    mesa de centro (mesa_centro) y una lámpara de pie nueva (lampara: salas, dormitorios, habitaciones de hotel,
    oficinas, recepción, lectura). Biblioteca de prueba: 74 libreros con libros y 3 lámparas.
  - Sin mirar todavía en 3D (el panel del navegador estaba oculto): revisar colores y que nada quede de espaldas.
  - Sin usar todavía: sillones (Sofa, SofaDouble, SofaLong), sillas (ChairCushioned para comedores), camas, armarios,
    floreros, banqueta.
  - Sillones y sillas de Casa2 (2026-10-12): el sofá (sofa) pasa a ser el sillón doble de Casa2 (1,77 m); mueble
    nuevo «sillon» (el individual, 1,09 m) en salas, habitaciones de hotel, recepción, sala infantil y sala-cocina;
    las sillas que no son de escritorio: acolchadas (ChairCushioned) en comedores, cocinas, reuniones, sala de
    profesores, estudio y sala infantil, y de madera (Chair) en el resto (aulas…). El plano guarda el tipo de cuarto de
    cada mueble (rt) para elegir. Medido en /edificios (3 casillas, 4 pisos): vivienda 12 sillones dobles, 8
    individuales, 5 sillas acolchadas; hotel 10 sillones; colegio 61 sillas de madera; siguen siendo asientos para la
    gente (colegio: 88). Sin mirar en 3D (el panel del navegador se veía en miniatura).

## 2026-10-12 · Camas y armarios de Casa2, escaleras por material, paredes de colores
- Muebles: `cama` → C2_Bed (escala 1,47: 1,31 × 2,10 m), `armario` → C2_Closet, y un mueble nuevo `comoda` (C2_Closet2)
  opcional en dormitorios y habitaciones de hotel.
- Escaleras (town3d `STAIRS`/`stairKind`): cada peldaño con macizo, huella y nariz; pasamanos inclinados (cajas con
  rx/rz, world3d ya las gira) en los dos carriles, con ménsulas; arriba, baranda con barrotes cada 12 cm. Material por
  edificio: madera (viviendas, casonas), mármol con bronce (hotel, fachadas de piedra), granito con cinta (públicos),
  concreto con acero (oficinas, metal, vidrio) y chapa con nariz amarilla (industrial).
- Paredes (`ROOM_PAL`, `HALL`): cada tabique macizo son dos caras, cada una del color de su cuarto (baños blanco o
  celeste, cocinas cálidas, dormitorios pastel, aulas menta, hospital verde agua, comisaría gris azulado…). Pasillo,
  núcleo y la cara de adentro de la fachada (MI_InteriorWall, por tinte del lote), del color del edificio. El revoque liso
  ahora toma el tinte tal cual (antes se multiplicaba y ensuciaba).
- Casas armadas (vivienda.js), lo mismo: peldaños con macizo pintado, huella y nariz (una de tres maderas por casa);
  del lado abierto, un barrote por peldaño, pasamanos inclinado (prisma de quads) y poste de arranque; contra la pared,
  pasamanos con ménsulas; arriba, baranda con barrotes (el pasamanos sigue estorbando al caminar). Colores por cuarto:
  sala y pasillo = s.interior; la pared de atrás (cocina) cálida; el baño en baldosa blanca o celeste; cada dormitorio
  un pastel distinto. Los tabiques son dos caras; la cara de adentro de la fachada se parte donde cambia el cuarto.

## 2026-10-12 · Muebles de Casa2 en las casas armadas
- vivienda.js: la cama doble es C2_Bed; arriba, armario C2_Closet contra el tabique (en los dos dormitorios) y la cómoda
  C2_Closet2 al frente, en un lugar que no tape una ventana (si no hay, el Drawer_1 bajo); el chico, con biblioteca
  C2_BookCaseBooks. Sala: C2_SofaDouble (o C2_Sofa si no cabe), mesa de centro C2_CoffeeTable delante y lámpara de pie
  C2_Lamp al lado; sillas del comedor C2_ChairCushioned. `fur` devuelve dónde quedó y lo que estorba ocupa su lugar
  (keep), así nada se encima (357 muebles en 6 estilos × 7 formas: 0 solapes, 0 contra tabiques).
- vivienda3d.js: FALLBACK a los del paquete de la casa si Casa2 no está cargado. CasasView y DemoView cargan Casa2.
- El sofá busca pared: primero la derecha donde iba siempre; si no cabe, recorre la derecha (hasta el tabique del baño),
  después la del frente (mira hacia atrás, bajo la ventana: el sofá es más bajo que el antepecho) y, en las de una planta,
  la izquierda; el doble deja lugar al individual. La mesa de centro va delante según su giro y la lámpara al costado
  libre. 66/66 formas con sofá (antes la casita de 4–5 módulos con garaje quedaba sin), 0 solapes.

## 2026-10-12 · Los vecinos se sientan en el sofá
- vivienda3d: cada casa sabe su entrada (afuera, el vano, adentro), los asientos del sofá (dos en el doble, uno en el
  individual: mirando hacia donde mira el sofá, lift .17, se llega por delante) y `sofa(r,p,lejos)` da una visita con
  `walk` (el piso de la planta baja y sus muebles, cuerpo de 16 cm). La mesa de centro quedó a 1,3 m: deja el paso.
- citizens3d (gente de la isla): 15 % de los planes, entrar a una casa armada cercana con asiento libre: ruta hasta la
  puerta por el paso de la cerca, adentro con `casa: walk` (no con lo de la isla, que ahí ve pared), gridPath hasta el
  asiento, seatStep, y sale por donde entró. `island.sueloCasa` (demo) da el piso de adentro para el cuerpo.
- Medido en /demo (simulado 250 s, 6 vecinos): los 6 entran, se sientan (cuerpo +0,17 m sobre el piso) y salen.

## 2026-10-12 · …y se acuestan en las camas
- vivienda3d `visita(r,p,lejos,cama)`: sofá o cama (40 %). Camas con centro, alto del colchón, hacia dónde los pies y un
  punto a cada costado (el que se alcance). Si la cama está arriba, `pathIn` arma el camino: planta baja hasta el pie de
  la escalera, cuatro puntos por la rampa, el descanso y la planta de arriba (cada punto con su `walk` por planta).
  `entra`: la entrada acepta también el suelo de afuera (antes se trababan a 40 cm del escalón y saltaban).
- citizens3d: `p.feet` (en qué planta está) para el piso del cuerpo; seatStep/lieStep con ese piso.
- Medido en /demo (400 s simulados, 12 vecinos; 3 a camas de arriba): 12/12 se sientan o se acuestan, 0 saltos.
- Tienda (dist/models/Tienda → public/models/Tienda): 103 comidas y utensilios OBJ con MTL, 50–500 caras cada uno, a
  escalas muy distintas (la pizza mide 3,4 unidades; el rollo de sushi 0,3): cada uno necesita su escala, como Casa2.

## 2026-10-12 · Escaleras sin meterse en paredes ni titilar
- Medido en /demo (94 edificios, 7.308 huellas): 1.872 huellas entraban 4 cm en el muro del medio, 53 pasamanos rozaban
  la pared de afuera, el descanso entraba en la pared del fondo y la nariz titilaba (misma cara de arriba que la huella).
- town3d: el ancho libre de cada carril se mide: la pared de afuera es tabique (6 cm), medianera (12) o fachada (25)
  según qué hay del otro lado; huellas, descanso, pasamanos (a 4 cm de la pared), ménsulas y la baranda de arriba van
  dentro. La nariz va al lado de la huella, no encima. Después: 0 en pared, 0 bajo losa, 0 titileo, 0 pasamanos.
- vivienda.js: la misma nariz. 1.352 piezas de escalera en 24 casas de dos pisos: 0 en paredes, 0 titileo.

## 2026-10-12 · Pizzerías y hamburgueserías
- nature3d `loadTienda`: 42 piezas de public/models/Tienda como «F_<nombre>», cada una a su medida real (TIENDA_SIZE:
  el lado más largo en m) y con los colores de su .mtl. Demo y /edificios las suman al kit de muebles.
- blueprint: cada lote con locales en la planta baja toma un giro (30 % pizzería, 30 % hamburguesería, el resto tienda)
  con su propio azar (no cambia nada más del lote) y un nombre inventado para el letrero (SHOP_NAMES). Recetas
  local_pizzeria (horno de leña, mostrador, mesas) y local_hamburgueseria (plancha, mostrador, nevera, mesas). Los
  muebles llevan `giro`. El editor tiene «Locales: Tienda · Pizzería · Hamburguesería» (giroWant).
- town3d `dress`: en el mostrador, la fila de pizzas o de hamburguesas, papas, salsas y gaseosas; en cada mesa, un
  plato por silla con lo suyo y en el medio la pizza o las salsas; el horno con su boca, el fuego y la cúpula; la
  plancha con carnes, pan y queso. El letrero (rojo la pizzería, amarillo la hamburguesería) va sobre la vidriera más
  cerca de la puerta de calle, encima del toldo (world3d: las placas aceptan bg, fg, w, h, dy).
- En el demo (ciudad 51753): 16 pizzerías y 15 hamburgueserías de 95 edificios.
- Siguiente: panadería, heladería, frutería y sushi; que la gente se siente a comer (las sillas ya son asientos).

## 2026-10-12 · Panadería, heladería, frutería y sushi
- Giros: pizzería 15 %, hamburguesería 15 %, panadería 12 %, heladería 10 %, frutería 10 %, sushi 8 %; el resto,
  tienda. Nombres y colores de letrero para cada uno; el editor los ofrece todos.
- Muebles nuevos: repisa (fondo, costados y cuatro tablas, con una fila de pan por tabla), vitrina fría (el hueco de
  arriba con los potes de helado, o el pescado en hielo) y cajón de frutería (listones y una capa de una fruta —14
  posibles—, con algunas encima). `SHOP` en town3d dice qué va en el mostrador («A:B:C»: A con B y C encima), en cada
  mesa (plato, lo de encima —todo con `all`—, lo del lado) y en el medio. 30 piezas más de Tienda en TIENDA_SIZE.
- En el demo (ciudad 80665, 104 edificios): 10 pizzerías, 9 hamburgueserías, 4 panaderías, 3 heladerías, 6 fruterías y
  4 de sushi; 4.395 piezas de comida (sólo se dibujan las de los edificios cerca de la cámara). Sin errores en consola.
- Pendiente: que la gente se siente a comer; algunas piezas a su medida real se pierden de lejos (helados, sushi).

## 2026-10-12 · El taller de objetos (/objetos) y la primera tanda
- lib/objetos3d.js: el catálogo de lo hecho a mano. Cada objeto da piezas en su marco (origen al centro de la base,
  frente +z), su versión `antes` (para comparar) y `alto` (dónde va lo de encima); `placeParts` las pone en el mundo.
  Lo usan town3d (los muebles sin modelo, el computador del escritorio) y buildCabins (la cabina del ascensor).
  world3d dibuja las cajas con giro YXZ (la inclinación de la pieza y después hacia dónde mira el objeto).
- Primera tanda: mostrador (zócalo, paneles con marco, cubierta de piedra y caja registradora), televisor (mueble con
  puertas y pantalla en su pie), caja de madera (esquineros y listones con luz), buzones (grilla de puertitas con
  ranura, cerradura y etiqueta), caja fuerte (patas, puerta con contramarco, bisagras, perilla y manija), computador
  (monitor, teclado y mouse) y la cabina del ascensor (zócalo, espejo, pasamanos, botonera de dos columnas, luz con
  marco; afuera contramarco, indicador de piso y botón de llamada). Las esquinas de la cabina ya no titilan.
- town3d `stairBoxes`: la escalera sacada de buildTown (la usa el taller con cada material); STAIRS y stairKind se
  exportan. Medido en el demo después: 87 escaleras, 5.775 huellas, 0 en pared; 44 ascensores; sin errores.
- /objetos: todos los objetos en pedestales por grupo (hechos a mano, escaleras, modelos de sillas, mesas, camas y
  sofás), clic o lista para verlo de cerca, triángulos, cajas, medida y lugar en el plano, «Antes / Después».
- Pendiente: la cabina vieja duplicada en world3d (la ciudad sin plano), banca, papelera, kiosco, contenedor.

## 2026-10-12 · Segunda tanda: la calle
- objetos3d: banca (costados de fundición con apoyabrazos, tres tablones de asiento y dos de respaldo echados atrás,
  travesaño), papelera (pie, tacho con dos zunchos, borde, boca y calcomanía; su color del mapa), kiosco (base, cuerpo,
  ventanilla con mostrador y vidrio, franja del letrero y toldito del color del kiosco, techo escalonado, esquineros) y
  contenedor (ruedas, refuerzos, borde, dos tapas, manija, ganchos y etiqueta). 168–292 triángulos cada uno.
- Piezas cilíndricas (cyl: true, 10 lados) y `partsMesh`: las piezas en tres InstancedMesh (cajas, cilindros, luz);
  lo usan la calle (world3d: todas las bancas, papeleras, kioscos y contenedores de la ciudad juntos) y el taller.

## 2026-10-12 · Tercera tanda: faroles, hidrante, fuente
- objetos3d: farol de calle (base, poste con anillos, remate, brazo con riostra, luminaria y difusor que brilla),
  farol de parque (base, poste, bandeja, cuatro parantes, vidrio que brilla y techito escalonado), hidrante (brida,
  cuerpo con anillo, cabeza con tuerca, dos bocas de costado y la grande con tapa; su color del mapa) y fuente
  (escalón, pileta con borde y agua al ras, columna, taza con agua y surtidor). 268–520 triángulos.
- partsMesh acepta `light` (el material de lo que brilla): los faroles usan headMat de world3d, que de noche se prende
  (medido: 207 difusores y 46 faroles de parque encendidos). El farol mira hacia donde sale su brazo.
- La cabina vieja de world3d (ciudad sin plano) usa la del catálogo. OJO: hoy ninguna vista llega a ese camino (demo y
  /edificios pasan plano): sólo comprobado que compila.
- /objetos: las escaleras al final (tapaban la vista de la fila de adelante).

## 2026-10-12 · Alfombras y cuadros
- objetos3d: alfombra (persa con borde, campo, medallón y esquinas; de rayas; moderna; redonda) con flecos, en capas
  finas cada una apenas más alta (sin titileo), cinco paletas (RUGS); cuadro (marco de madera, dorado, negro o
  plateado y una escena en bloques: paisaje con montañas en escalones y sol, mar con velero, abstracto tipo Mondrian,
  flores en un florero). `variantes` en el catálogo: el taller muestra una de cada. `partsBoxes`: las piezas como cajas
  min/max para las casas armadas.
- town3d: alfombra centrada en salas, dormitorios, habitaciones, oficinas, recepción… (DECO_RUG) y un cuadro en la
  pared libre más larga del cuarto (DECO_ART): pared de verdad (no vidrio ni abierta al pasillo), sin ventanas,
  puertas ni muebles altos (TALL) delante, centro a 1,55 m. Medido en el demo: 1.711 cuadros, 1.589 alfombras, 0
  cuadros sobre una ventana o una puerta.
- vivienda.js: alfombra entre el sofá y la mesa de centro y al pie de la cama (reemplaza Carpet_1), cuadro sobre el
  sofá y sobre la cabecera (se corre a lo largo de la pared si hay ventana; si no hay lugar, no va). 42 casas: 0
  cuadros sobre ventana, 0 muebles encimados.
- Ojo (mío, tres veces hoy): un comentario // en medio de una línea se come el código que sigue. Después de editar el
  catálogo, correr todas sus piezas en node (cada objeto y variante) antes de abrir la página.

## 2026-10-12 · A comer en los locales
- town3d: las sillas de las mesas de un local con giro son `meal`; `staff` (por lote): el cocinero frente al horno o
  la plancha (mirándolos) y el cajero junto al mostrador (mirando al salón).
- indoor3d: en un piso con sillas de comer, más gente (90 % de los asientos), el 80 % arranca sentada a comer
  (40–110 s), y al decidir va casi siempre (80 %) a una mesa libre aunque esté lejos; el personal se queda en su puesto
  y mira de vez en cuando al salón. Medido (demo, una pizzería): 8 personas, 3 de personal, 3 comiendo al llegar.

## 2026-10-12 · Auditoría de triángulos (para la tanda de reemplazos)
- Mediana por paquete: Oficina 2.928, Casa 352, Casa2 256, Tienda 368. Lo más pesado: Bookcase_Books 10.948,
  BedDouble 4.712, ShortCloset 4.040, HospitalBed 3.684, Desk 2.640, OfficeChair 2.116, NightStand 2.016.
- Lo que más pesa en la ciudad (cantidad × triángulos, demo 68162; 21,4 M en total si se dibujara todo): Desk 4,1 M
  (1.553), OfficeChair 3,3 M (1.568), Light_Ceiling3 1,85 M (2.260 × 820), ShortCloset 1,7 M, NightStand 1,4 M,
  C2_BookCaseBooks 0,9 M; en las fruterías, F_Pepper_Green 808 y F_Turnip 976 triángulos cada uno.

## 2026-10-12 · Tanda 1 de reemplazos: lo pesado, al catálogo
- objetos3d: escritorio (costado de metal, faldón y cajonera de tres), silla de oficina (estrella de cinco con
  ruedas, pistón, asiento, respaldo echado y apoyabrazos), archivador (cuatro cajones con manija y etiqueta), mesa de
  noche (patas, dos cajones con perilla), cama de hospital (ruedas, chasis, cabecera levantada con almohada, barandas)
  y plafón. 120–396 triángulos (antes 820–4.040).
- `kitModel(id)`: un objeto del catálogo como modelo de paquete (una geometría con colores por vértice: una llamada de
  dibujo); `REEMPLAZOS` (modelo → id, por `modelo:` en el catálogo). nature3d no carga esos OBJ (ni BedTwin) y pone en
  su lugar el del catálogo con el mismo nombre (Desk, OfficeChair, ShortCloset, NightStand, HospitalBed,
  Light_Ceiling3): todo lo que los usaba (town3d, world3d, island3d, las casas, el taller) cambia solo.
- Fruterías: sólo las frutas livianas (82–368 triángulos) y a lo sumo ~30 por cajón.
- Medido en el demo (ciudad 68162): los muebles de toda la ciudad pasaron de 21,4 M a 8,2 M triángulos (−62 %); ningún
  modelo faltante; sin errores. Lo que más pesa ahora: C2_BookCaseBooks (1.456 c/u, 0,93 M).

## 2026-10-12 · Tanda 2: decoración
- objetos3d: florero (tres colores de flores), reloj de pared (marco, esfera, marcas y agujas), teléfono, espejo de baño
  (repisa con frascos, marco, luna y luz), mampara de ducha (vidrio de verdad —`vidrio: true`—, marco, manija, caño
  y regadera) y cortinas (barral con remates y dos paños con tres pliegues; crema, azul, verde, terracota). La lámpara
  de techo cuelga hacia abajo desde su origen, como las del paquete (si no, quedaba dentro de la losa).
- town3d: espejo sobre cada lavamanos (reemplaza a Bathroom_Mirror1), mampara en cada ducha (el vidrio va con los
  paños de vidrio), teléfono en ~45 % de los escritorios y en los de recepción y secretaría, florero en mesas de casa,
  de centro, de reunión y de lectura (no en los locales), olla y sartén en cada estufa, reloj en otra pared libre
  (CLOCK: cocinas, oficinas, aulas, recepción…) y cortinas en las ventanas de fachada de los cuartos donde se vive
  (CURTAIN). Los cuadros dejan 45 cm a los lados de las ventanas (ahí cuelgan las cortinas). Demo 68162: ~2.400
  ventanas con cortina, 300 relojes, 678 teléfonos, 420 floreros, 1.173 espejos, 1.252 mamparas, 242 ollas; sin
  errores.
- vivienda.js: cortinas en todas las ventanas menos las del baño (no van si un tabique llega a la ventana), florero en
  la mesa del comedor y en la de centro, olla y sartén en la estufa, espejo sobre el lavamanos si no hay ventana ahí
  (pocos: la mayoría de los baños tiene la ventana sobre el lavamanos) y reloj en el tabique del baño hacia la sala.
  `partsBoxes` aproxima lo que no sabe girar (el reloj de canto: un octógono de dos cajas). Las piezas F_* se apoyan
  bien en las casas (vivienda3d resta su min.y); /casas y el demo les pasan Tienda.

## 2026-10-12 · La biblioteca
- objetos3d `biblioteca`: costados, techo, fondo, zócalo y tres tablas; en cada tabla una fila de libros (cada uno una
  caja, de 5–10 cm de lomo y 20–33 de alto, ocho colores), a veces un hueco o uno acostado; sin libros o ancha (1,6 m).
  Reemplaza a seis modelos: C2_BookCaseBooks (1.456 → 540), C2_BookCaseLargeBooks (3.500 → 840), Bookcase_Books de
  Oficina (10.948 → 540) y las tres vacías (→ 96). `modelo` del catálogo acepta {nombre: opciones} para reemplazar
  varios con el mismo objeto; loadCasa2 ya no carga las bibliotecas.
- Demo 68162: los muebles de la ciudad, de 8,2 M a 7,7 M triángulos (las bibliotecas, de 0,93 M a 0,35 M); nada
  faltante, sin errores.

## 2026-10-12 · La lámpara colgante
- objetos3d `colgante` (florón, cable, pantalla verde en dos escalones, foco; cuelga 43 cm desde su origen) reemplaza
  a Light_Ceiling1 (269 → 124 triángulos). kitModel arma lo redondo y chico (< 20 cm) con 6 lados: la silla de oficina
  bajó a 300 y la cama de hospital a 288 de paso. /objetos sube lo que cuelga hasta el pedestal.
- Demo 68162: muebles de la ciudad 7,7 M → 7,2 M (las 2.280 colgantes, 0,61 M → 0,28 M). Desde la tanda 1: 21,4 M →
  7,2 M (−66 %). Sin errores, nada faltante.

## 2026-10-12 · Inodoro y lavamanos
- objetos3d `inodoro` (pie, taza, asiento con su hueco, tapa levantada, tanque con tapa y botón) reemplaza a
  Bathroom_Toilet (402 → 192); `lavamanos` (mueble con zócalo, dos puertas con tirador, cubierta, poceta, llave, pico y
  manija) reemplaza a Bathroom_Sink (350 → 156). El espejo de la tanda 2 queda justo encima de la llave.
- Demo 68162: muebles de la ciudad 7,2 M → 6,7 M (inodoros y lavamanos, 0,89 M → 0,41 M). Desde la tanda 1: 21,4 M →
  6,7 M (−69 %). Sin errores, nada faltante.

## 2026-10-12 · Lo que más pesaba después
- objetos3d, a la medida de cada modelo: nevera (Kitchen_Fridge 404 → 96), lavaplatos con los colores de las cocinas
  del paquete (Kitchen_Sink 444 → 108), ducha (plato y baldosas de atrás; Bathroom_Shower1 652 → 72), planta en
  maceta (Houseplant_8 310 → 168), mesa de reunión (Table 1.108 → 84), cama doble con cobija, almohadas y cabecera de
  tres paneles (C2_Bed 528 → 180) y cómoda (C2_Closet2 516 → 216). Adelgazados: silla de oficina 300 → 240 (ruedas
  en cubitos), biblioteca 540 → 420 (libros más gruesos).
- town3d: con un modelo del catálogo, la cara de arriba es su `alto` (la cama: el colchón, no la cabecera; si no, la
  gente se acostaba en el aire). Camas: 0,52–0,64 m.
- Demo 68162: muebles de la ciudad 6,7 M → 5,3 M. Desde la tanda 1: 21,4 M → 5,3 M (−75 %). Nada faltante; casas: 0
  muebles encimados.

## 2026-10-12 · Distribución: ventanas libres, pasos y escaleras
- Escaleras: caminadas con la física del jugador (cuerpo de 26 cm) en el demo (90 + 93 escaleras) y con W de verdad en
  /edificios (todos los tipos, tres tramos): se suben enteras; los pisos tienen la escalera en el mismo lugar.
- Lo que no se alcanzaba (inundando cada piso desde la llegada de la escalera): hoteles y hospitales de 6 m de fondo
  ponían habitación | baño | habitación… en fila, sin pasillo, y el baño de en medio dejaba habitaciones sin salida
  (30 por ciudad). blueprint: pasillo de 2 m a lo largo del frente (con ventanas) que sigue en el descanso, y detrás
  habitación + baño, cada una con su puerta al pasillo (`hall`). Después: 4.540 y 4.502 cuartos, 0 sin llegar.
- Ventanas (las de los edificios bajan a 6–61 cm del piso: cualquier mueble las tapa): furnishRoom no pone nada a menos
  de 45 cm de una ventana, de frente o de costado (`nearWin`; antes sólo lo alto y sólo con la espalda); las filas de
  escritorios y estanterías tampoco. Lo esencial (cama, lavamanos, inodoro, estufa, mesón) va igual si no hay otro
  lugar; la cama prueba antes de costado (cuartos angostos: antes 176 dormitorios sin cama, ahora 0). El espejo no se
  cuelga si hay ventana detrás. 4 ciudades: muebles frente a una ventana 15.798 de 63.798 → 1.675 de 59.293 (casi
  todos mesones de cocina); en las puertas, 0 antes y después; cocinas con estufa 93 % igual que antes.
- Casas (vivienda.js): las ventanas de arriba se corren si un tabique caía en medio (antes los dos tabiques de arriba
  cortaban ventanas); lo alto (nevera, armarios, bibliotecas, cómoda) no va contra una ventana; la cama prueba lugares
  sin ventana y si no, va igual; la cabecera de la cama del catálogo baja a 84 cm (el alféizar más bajo es 85).
  48 casas: 0 muebles tapando ventanas, 0 en puertas, 0 ventanas cortadas, todas con cama, 0 encimados.
- Medidores (scratchpad): cuartos.mjs (ventanas, puertas, camas, lavamanos), claves.mjs (lo que no puede faltar por
  cuarto), casas.mjs; y en el demo, la inundación desde la escalera.

## 2026-10-12 · Repetir hasta la mejor distribución, y el mundo entero en el mapa 2D
- Prueba de movimiento en furnishRoom (`flow`): un cuerpo de 25 cm inunda el cuarto desde sus puertas (grilla que se
  adapta al tamaño, ≥ 15 cm) y mira qué puertas quedan conectadas y qué muebles se pueden usar (`USE_AT`: la cama de
  los costados, lo demás de frente). Un mueble entra sólo si no empeora eso (`fits`). Niveles: 0 respeta ventanas y la
  prueba; 1 puede tapar una ventana; 2 sólo lo esencial, va igual.
- Reintentos: cada cuarto se amuebla hasta 12 veces y queda el mejor (`quality`: puertas, muebles usables, ventanas);
  corta en cuanto puertas y uso quedan bien. Los lugares de pared incluyen los extremos, cada 25 cm y pegado a lo que
  ya está en esa pared (así la estufa no queda frente a la nevera en las cocinas angostas, ni el lavamanos tapando el
  inodoro en baños de 2×2).
- 4 ciudades (~15,5 k cuartos): puertas conectadas 98,5 → 99,9 %; muebles usables 74,9 → 99,5 %; piso libre
  caminable 61,6 → 66,1 %; frente a ventanas 15.798 → ~1.030 (casi todo mesones); en las puertas 0. Generar una
  ciudad: 171 ms → 641 ms (memo del flujo, obstáculos rasterizados, grilla adaptable).
- Mapa 2D (/generador): todas las etapas muestran la isla entera (`drawWorldStage`): 1 terreno; 2 calles, carreteras
  del monte y manzanas en terraza; 3 lotes y casas del monte; 5–8 adentro de todo, también las casas armadas (su plano
  de vivienda.js: cuartos, puertas, ventanas y muebles). Las carreteras del monte siguen la grilla de la ciudad, así
  que se ven como continuación de sus calles.
- Demo: el minimapa es el mundo entero (2 px por casilla), con el jugador, el tráfico y la gente corridos a la isla.

## 2026-10-12 · El catálogo de distribuciones (amueblar una vez por firma)
- Idea de Miguel: los pisos ya se repiten (planta baja + piso tipo por lote), así que los cuartos también; los muebles
  se precalculan por cuarto repetido. Medido: 4 ciudades, 16.990 cuartos, 885 firmas (tipo y giro, medidas, qué bordes
  son fachada, puertas y ventanas relativas a la esquina). blueprint: `roomSig` + `catalogFor` + `CATALOG`.
- Por firma, una tanda de intentos (corta con 3 sin problemas; si sólo tapan ventana, desde el sexto; hasta 40 si
  estorban) y quedan las 3 mejores igual de buenas como variantes; cada piso elige una con su azar. El azar sale de la
  firma: la misma semilla da la misma ciudad con el catálogo frío o lleno (comprobado), y el catálogo queda entre ciudades.
- Puntuación del intento: además de puertas/uso/ventanas, cuánto piso se camina (desempate).
- Uso alineado con el medidor: el lugar de uso cuenta si hay una casilla libre a ≤ 15 cm del punto exacto (antes, en
  casillas enteras: dejaba pasar duchas tapadas por el inodoro a 2 cm del borde); lo ancho (≥ 90 cm: ducha, mesón,
  sofá) se usa desde cualquier parte del frente (centro y cerca de cada punta), en el generador y en mov.mjs.
- Tiempos (node): la primera ciudad 760 → 640 ms; las siguientes 540–590 → 190–310 ms; la misma otra vez 630 → 200 ms.
  Calidad (mov.mjs, medidor nuevo): puertas 99,9 → 100 %, usables 99,8 = 99,8 %; frente a ventanas 1.027 → 1.102 (más
  inodoros junto a la ventana en baños de 2×2, donde el uso estricto deja menos lugares). Pisos altos idénticos seguidos:
  8 de 275.

## 2026-10-12 · Departamentos con zonificación de vivienda, y muebles a la medida
- Reglas de diseño de vivienda (zona social / privada / servicio; alcobas y baños detrás de un hall, nunca cruzar un
  cuarto para llegar a otro; baño que no abre a la cocina; la cocina da a la sala) medidas con zonas.mjs: lo básico ya
  se cumplía, pero todo depto tenía 1 alcoba como mucho y el 100 % de alcobas y baños abría a la sala.
- blueprint `apartments`, fondo de 6 m: la franja de fachada (4 m) para alcobas y sala, la de adentro (2 m) para el
  hall de alcobas y el baño. 16 m: 3 alcobas; 12–14: 2 alcobas (14: cocina en línea de 2×6 aparte); 10: 1 alcoba con
  cocina aparte; 8: 1 alcoba y sala con cocineta. Fondo de 4 m: sala con cocineta y baño de 2×4 (la cocina de 2×2 no
  tenía lugar para el mesón). Tipos nuevos: `hall` (y `ropas`, sin usar: la cocina de 2×4 con ropas aparte no
  entraba). En 4 ciudades: 685 de 1 alcoba (53 m²), 497 de 2 (72 m²), 11 de 3 (96 m²), 987 estudios; hall = 8 % del
  área; ninguna alcoba de 6 m de fondo da a la sala (quedan las de 4 m: 12,6 %).
- Muebles a la medida (idea de Miguel): `SIZES` (mesón 1,2–3 m, cama 1,2–1,6 m, escritorio, estante, nevera 0,6–0,9) y
  `TABLES` (mesa del comedor de la casa: 0,8 × 0,8 a 1,6 × 0,9, con 2, 4 o 6 sillas). Cada mueble prueba de la medida
  que le toca para abajo y se queda con la primera que entra sin estorbar; la puntuación premia lo que llena (Q.fill).
  `fit:true` va al 3D: town3d arma el objeto del catálogo con esa medida (kitModel, uno por medida, guardado con los
  demás modelos). En el catálogo, la nevera y la cama son a la medida y hay `mesa_comedor`.
- El cuerpo de la prueba de movimiento pasa a 28 cm (3 cm de holgura): con muebles más grandes quedaban pasos al filo
  que el medidor no daba por buenos.
- Medido (4 ciudades): puertas conectadas 100 %, muebles usables 100 %, muebles en el paso de una puerta 0, frente a
  ventanas 1.004 → 435 (el mesón se achica para no tapar). Faltan: las cocinas de 2×4 del lote «casa» (nevera 1 de 29)
  y las casas de vivienda.js, que tienen su propio sistema de muebles.

## 2026-10-12 · Todo a la medida: sofá, armario y el resto, para todas las medidas de cuartos
- Catálogo nuevo a la medida: `sofa` (cojines según el largo: 1 a 4), `armario` (puertas de ~50 cm, de a pares), y a la
  medida también la cómoda (dos columnas desde 1,2 m) y la ducha (0,8 a 1 m). town3d `FIT_CAT`: sofá, armario, cama
  sencilla (la misma cama, más angosta) y cómoda salen del catálogo con la medida del plano.
- `SIZES` para casi todo lo que va contra la pared o al centro: sofá 1,25–2,4; armario 0,9–2,4; cómoda; cama sencilla;
  mostrador 1,4–3; tv; ducha; tina; lavamanos (hasta 0,45, de esquina); camilla; tablero; y al centro mesa de reunión y
  de lectura (1,2–2,4), mesa de centro y la de los locales. Lo del centro va a lo largo del lado largo del cuarto.
- Medidor nuevo: cobertura.mjs (por tipo × medida de cuarto, qué obligatorio de la receta falta). Al empezar: 69 de 133
  combinaciones con algo faltante; ahora 22. Lo que lo destrabó, además de las medidas:
  · al centro, una grilla de lugares de 35 cm en todo el cuarto (antes 7 lugares junto al centro: los locales tenían
    UNA mesa de las tres de la receta, desde siempre);
  · el catálogo de distribuciones cuenta lo que falta de la receta (Q.missing) y no se conforma con un intento
    incompleto (hasta el intento 12; después acepta que el cuarto no da para más);
  · el inodoro reservaba 0,62 × 0,90 (el modelo mide 0,50 × 0,70): ahora 0,55 × 0,75;
  · baño: inodoro, ducha y lavamanos (en ese orden: el lavamanos se achica para lo que quede; con la ducha primero,
    el inodoro —esencial— la tapaba);
  · en paredes de 2,2 m o menos la puerta va a 10 cm de la esquina (a 40 cm partía el baño de 2×2 en dos).
- Quedan: baños de 2×2 sin ducha 40 % (79 % al empezar: los de ventana o puerta en el lado corto; serían medio baño),
  reuniones de 2×4 sin tv 46 %, cocinas de 2×4 del lote casa sin nevera 62 %, recepciones de 2×6.
- Puertas 100 %, usables 99,8 %, en paso 0, frente a ventanas 246. La primera ciudad: ~1,1 s (antes 0,65: más intentos
  por firma para completar la receta); las siguientes 0,2–0,6 s.

## 2026-10-12 · El núcleo como módulo cerrado
- Las paredes del núcleo salían sólo de su contorno: entre el hueco del ascensor y la escalera no había tabique (se
  veían uno al otro y el pasamanos de ese carril quedaba frente a la nada), aunque stairBoxes ya medía el carril
  contra "un tabique del núcleo". town3d: el contorno del núcleo y la caja del ascensor (sus 2 m por todo el fondo del
  núcleo) van siempre, en cada piso; la escalera queda cerrada entre ese tabique, el contorno y su pared del medio.
- Propuesta de Miguel (por decidir): construir de adentro hacia afuera —los muebles de cada persona dan el cuarto, los
  cuartos dan la casa— en vez de partir el lote y amueblar lo que quede.

## 2026-10-12 · De adentro hacia afuera, paso 1: la tabla de cuartos mínimos
- blueprint `PROGRAMS` (15 programas: dormitorios sencillo, con escritorio, doble, principal y de dos camas; medio
  baño, baño, baño amplio; cocina en línea y completa; sala, comedor de 4 y de 6, sala comedor y estudio) y
  `minRoom(prog,{ratio})`: el cuarto más chico, en pasos de 25 cm, donde todo entra, se usa, deja pasar, no tapa la
  ventana y (si hay mesa) caben sus sillas, con la puerta en un lado corto y la ventana en la fachada de enfrente.
  Las recetas aceptan medida fija ('cama:1.4x1.95'). Resultado en src/engine/cuartos-minimos.json (mínimo y con
  proporción ≤ 1:1,5); script: scratchpad/minimos.mjs.
- La cama con sus mesas de noche va como un bloque (cabecera contra la pared, una mesa a cada lado): antes las mesas
  caían en cualquier rincón, a veces a los pies. También en la ciudad (los medidores, sin cambios).
- Medidas compactas: sencillo 2,25 × 3 (6,75 m²), con escritorio 2,5 × 3,25, doble 2,75 × 4 (11), principal 3 × 4,25
  (12,75), dos camas 3 × 3,75; medio baño 1,75 × 2, baño 2 × 2,5, amplio 2,25 × 2,5; cocina en línea 2,25 × 2,75,
  completa 2,25 × 3,25; sala 2,75 × 3,25, comedor de 4 2,75 × 2,75, de 6 2,75 × 3,25, sala comedor 3 × 4; estudio
  1,75 × 2,5. Incluyen las paredes (8 cm por tabique, 24 la fachada).
- Siguiente: paso 2, las casas del monte armadas desde la familia (lista de programas → cuartos → zonas → casa).

## 2026-10-12 · De adentro hacia afuera, paso 2: la casa desde la familia (engine/hogar.js, /hogares)
- `HOGARES`: una persona, pareja, familia con un hijo, con tres hijos, tres estudiantes, abuelos; cada uno, su lista
  de programas (PROGRAMS). `planHogar(kind)`: franjas por zonas (social adelante con la puerta de calle en la sala,
  pasillo de 1,1 m, privado atrás; con más de ~55 m² de cuartos, dos pisos: lo social abajo, lo privado arriba, la
  escalera recta en la misma huella). Cada cuarto con su puerta al pasillo; vano de 1,2 m entre sala, comedor y cocina
  vecinos; una ventana por cuarto. Muebles con furnishProgram (el catálogo de distribuciones, firma + receta).
- Cada programa tiene dos mínimos (minRoom wide: la puerta en el lado largo, como queda en una franja); la franja prueba
  cada fondo y toma, para cada cuarto, el giro más angosto que entra. Lo que puede ir adelante o atrás (cocina, comedor,
  estudio, medio baño; en un piso, un dormitorio a la calle con penalidad) se reparte probando todas las combinaciones
  para que las dos franjas midan parecido; la cocina y el comedor, siempre juntos. Lo que falta para el ancho: los
  cuartos crecen hasta 30 % y después un depósito.
- Repetir hasta que entre todo: se arma, se revisa qué cuarto quedó sin algo de su receta (en la casa tienen más
  fachadas y la puerta en otro lado que en la prueba suelta) y ese programa crece 25 cm. Todas las familias cierran
  completas en 1–4 vueltas: una persona 6,5 × 7,25 (47 m²), pareja 9,5 × 8,25, familia 10,25 × 8,5 (87 m²), tres hijos
  7,75 × 8,75 en dos pisos (136 m²), estudiantes 10 × 7, abuelos 9,5 × 7,75.
- drawPlan `drawHogar` y la vista /hogares (familia, planos de cada piso, tabla de cuartos, vueltas y lo que creció).
- Siguiente: paso 2b, construirla en 3D (paredes de los cuartos, ventanas y puertas, escalera, techo sobre la huella
  rectangular) y ponerla en el monte en lugar de las casas de plantilla.

## 2026-10-12 · De adentro hacia afuera, paso 2b: la casa de la familia en 3D y en el monte
- vivienda.js `planHouse` acepta `spec.hogar` (un plan de hogar.js): medidas, ventanas y puerta de calle de cada piso,
  un tabique en cada borde entre cuartos (con sus vanos; la escalera abierta al pasillo; cada cara del color del cuarto
  de su lado), una lámpara por cuarto. Lo de afuera (capas de la pared, ventanas y puertas del paquete, techos, porche,
  cortinas, esquineros) y la escalera son los de siempre: la escalera de hogar.js (2,3 × 4,9 m, contra la pared
  izquierda, atrás) cae justo donde vivienda.js pone la suya.
- Muebles: los del catálogo en cajas y a la medida (cama, armario, sofá, cómoda, escritorio, biblioteca, nevera, mesa
  de comedor, mesa de centro —nueva en el catálogo—, mesa de noche, inodoro, lavamanos, ducha con su mampara, tv); los
  del paquete como modelos (estufa, sillón, sillas, lavadora, tina, plantas, lámpara); el mesón, módulos de cocina a lo
  largo. Cada uno estorba con su huella (plan.solids) y las camas y los sofás quedan para las visitas (bedSpots,
  seatSpots, que vivienda3d suma a los suyos).
- /casas: fila «Desde la familia» (la familia da la casa; el estilo, colores, techo y ventanas).
- El monte: blueprint sortea la familia de cada casa (HOGAR_PESO) y su casa sale de hogar.js (planHogar, uno por
  familia). Semilla 68162: 67 casas (familia 22, solo 17, pareja 13, abuelos 7, estudiantes 4, tres hijos 4).
- Pendiente: todas las casas de una misma familia son iguales por dentro (variar: espejo, orden de la franja, otra
  medida); el mapa 2D (drawHouse) no dibuja los muebles hechos en cajas.

## 2026-10-12 · Casas de la familia: versiones, mapa 2D y prueba caminando
- hogar.js: 4 versiones por familia (`planHogar(kind,{variant})`): bit 1, los cuartos de cada franja al revés; bit 2,
  un cuarto más (EXTRA: estudio, cuarto de huéspedes, medio baño). Las 24 cierran completas. El monte sortea la
  versión; /hogares y /casas tienen su selector.
- Mapa 2D (drawHouse, ahora exportado): las casas de la familia pintan cada cuarto con su color y sus muebles.
- Prueba caminando en el demo (semilla 68162, 65 casas), con el gridPath de sitting3d: pie de la escalera 22/22, camas
  de abajo 68/68, de arriba 64/64, asientos de sofá 173/206; visitas reales (V.visita().plan(), cama y sofá por casa)
  128/130. Lo que se arregló para llegar ahí:
  · las sillas no estorban (como en la prueba de los cuartos); los costados de la cama, a 35 cm del borde y sólo los
    que caen dentro de su cuarto (antes uno caía del otro lado del tabique, en el paso de la escalera);
  · el asiento del sofá: se llega desde 72 cm al frente o más allá (la mesa de centro); si no hay lugar libre, no se
    ofrece;
  · vivienda3d pathIn: gridPath con pad 10 (con 3 m no entraba el camino que baja al pasillo y vuelve a subir).
- Quedan 33 asientos de sofá sin camino: pasos de ~50 cm entre el sillón y la mesa de centro que la grilla de 25 cm
  no encuentra (la visita usa otro asiento).

## 2026-10-12 · Los cuartos de la ciudad eligen su programa; caminos más finos en las casas
- src/engine/cuartos-minimos.js (generado con scratchpad/gen-minimos.mjs): el mínimo de cada programa, hondo y ancho.
  hogar.js lo usa (la primera ciudad ya no mide nada).
- blueprint furnish: cada cuarto de departamento toma el programa más completo que le cabe (PROG_BY): el dormitorio más
  grande, principal / doble / sencillo; los otros, dos camas / con escritorio / sencillo; baño amplio / completo / la
  receta de siempre / medio baño; cocina completa / en línea; sala. La tabla sólo descarta lo que claramente no cabe;
  la prueba de verdad es el catálogo (si falta algo, el siguiente). A la receta se le suma lo opcional de siempre.
  4 ciudades: 682 principales, 519 de dos camas, 482 dobles, 29 sencillos; 1.202 baños amplios, 156 completos, 415 con
  la receta de siempre, 407 medios baños (los de 2×2 sin ducha: 40 % → 35 %, y ahora son medio baño de verdad).
  Usables 99,9 %, puertas 100 %; la misma semilla, la misma ciudad.
- sitting3d gridPath acepta el lado de la casilla (R); en las casas de la familia, 15 cm. Asientos de sofá con camino:
  173 → 197 de 206; visitas reales 129/130, 1,5 ms por visita.

## 2026-10-12 · Departamentos de 6 m de fondo en grilla de 0,5 m (de adentro hacia afuera, paso 3)
- blueprint `unitPlan`: el departamento prueba combinaciones de alcobas (principal + dos camas + con escritorio; principal
  + dos camas; principal; doble), con o sin cocina aparte, cada cuarto del ancho de su mínimo con el fondo de la franja
  (cuartos-minimos.js, en pasos de 0,5 m); toma la más completa que entra; lo que sobra va a la sala (hasta 5 m) y
  después a las alcobas. La fachada sigue en módulos de 2 m (piezas del paquete): el plano sólo pone ventana en los
  módulos enteros de cada cuarto y un tabique en medio de un módulo lo deja ciego; el reparto corre los tabiques
  (shift) hasta que cada alcoba y la sala tengan su módulo de ventana. El baño, bajo la primera alcoba (que mide por lo
  menos el baño + 1 m, para que el hall le llegue); el hall, hasta la sala.
- 4 ciudades: deptos de 1 alcoba 685 → 460, de 2 alcobas 497 → 704, de 3 alcobas 11 → 29; alcobas 1.712 → 1.955 (+14 %
  en la misma superficie). Alcobas sin ventana 0,1 %, nadie cruza un cuarto, puertas 100 %, usables 99,9 %; la misma
  semilla, la misma ciudad. Todos con la cocina abierta en la sala (una alcoba más gana a la cocina aparte).
- Los lavamanos junto a una ventana subieron a 296 (baños de la punta del edificio, con ventana al costado: el programa
  fijaba la medida del lavamanos); con el lavamanos flexible en los programas de baño, 37. Muebles frente a ventanas
  en total: 235 (el más bajo hasta ahora).

## 2026-10-12 · Cocina aparte en uno de cada cuatro departamentos; costo de los muebles a la medida
- unitPlan(…, sep): en uno de cada cuatro departamentos (su azar) la cocina aparte va primero aunque cueste una alcoba
  (con cocina aparte casi nunca caben las mismas alcobas: 2 alcobas + cocina piden 12,5 m). 4 ciudades: 161 cocinas
  completas aparte; deptos de 1 alcoba 612, de 2 alcobas 561, de 3 alcobas 20; alcobas 1.794 (eran 1.712 con la grilla
  de 2 m). Puertas 100 %, usables 99,9 %, frente a ventanas 227.
- Demo (68162, sin errores): adentro del Edificio Panorama, 52 cuadros por segundo; adentro de una casa del monte, 69;
  en la calle, 79. Los muebles a la medida (61 modelos por medida en la ciudad) suman ~76 llamadas de dibujo adentro de
  un edificio (3.821 → 3.897, +2 %) y 15 en la calle; los triángulos, igual (medido apagándolos un momento).

## 2026-10-12 · Puertas de los cuartos (con hoja que se abre)
- Catálogo: `puerta` (hoja de cuarto a la medida del vano, 4 cm): de tablero (dormitorios), lisa, con vidrio arriba
  (cocinas, oficinas) y con rejilla abajo (baños); manija de los dos lados. ~150 triángulos.
- Casas (vivienda.js `innerLeaf`): cada puerta de cuarto es un vano de 2,08 m con marco por las dos caras y una
  apertura {kind:'door', inner, m:'Leaf_<estilo>'}; vivienda3d suma las hojas del catálogo al kit y las abre con el
  mismo mecanismo de la puerta de calle (gira hacia el lado contrario de out: out es el pasillo). También las casas de
  plantilla: el baño de abajo, el dormitorio de arriba y entre los dos dormitorios. La entrada (visitas) salta las
  interiores.
- Edificios: town3d anota cada hoja (innerLeaves: bisagra, th0 a lo largo del vano, sgn hacia el cuarto, estilo) y
  world3d las dibuja con los muebles de los lotes cercanos (instancias por estilo, estiradas al vano) y las mueve en
  updateDoors (abren con alguien a menos de 1,6 m en ese piso; el demo pasa también la gente de adentro:
  indoor3d.positions). Sin hoja: calle, núcleo, portones, cuartos abiertos o de vidrio y el paso del hall a la sala
  (una hoja ahí, abriendo hacia el hall, tapaba la puerta del dormitorio).
- Demo 68162: 3.613 hojas en la ciudad; 52 cuadros por segundo adentro de un edificio y 69 en una casa (igual que antes).

## 2026-10-12 · Ventanas de cuarto (casas de la familia)
- Catálogo: `ventana` a la medida del vano (marco, travesaños, alféizar de adentro y de afuera; el vidrio sin color):
  dos hojas, tres paños, baño (un paño esmerilado), cocina (travesaño arriba), simple.
- vivienda.js `roomWin`/ROOM_WIN: en las casas de la familia, cada ventana es la de su cuarto: baño 0,6 × 0,6 alta
  (alféizar 1,5, sin postigos ni cortina), cocina ancha sobre el mesón (1,1), dormitorio de dos hojas (0,9), sala de
  tres paños y baja (0,6, hasta 2,1 m de ancho), oficina/estudio simple; el ancho, lo que da la pared del cuarto. Los
  postigos, media ventana cada uno y sólo hasta 1,5 m. El vidrio va en cajas 'vidrio' (vivienda3d: transparente, con
  la luz de adentro de noche, como el de las ventanas del paquete). Las casas de plantilla siguen con las del paquete.
- Demo 68162: sin errores; triángulos de las casas ~675 k → 740 k (marcos de ventanas y hojas de puertas); 120 cuadros
  por segundo frente a una casa.

## 2026-10-12 · Personajes armados: el prototipo (lib/persona3d.js)
- Hoy: el paquete de Quaternius (cabezón; ~13.000 triángulos, 7 mallas con piel y 3 llamadas de dibujo por persona;
  23 huesos; 17 animaciones: Idle, Walk, Run, SitDown, StandUp, PickUp, Punch, Jump, Death…). Todas las animaciones
  mueven todos los huesos (pistas de posición) y los pies son blancos de IK (FootL/FootR cuelgan de la raíz).
- Prototipo: una copia del esqueleto del cuerpo base y UNA malla con piel hecha de cajas, cada caja pegada entera a
  su hueso (rígida) y con su color por vértice: ~500 triángulos y 1 llamada por persona, con las mismas animaciones
  (makePersona devuelve lo mismo que makeCharacter). Piezas en la pose de origen (T, mirando a +z, 3,1 unidades ×
  0,52): piernas (muslo, canilla, zapato pegado al hueso del pie), cadera, cinturón, barriga, pecho, cuello, cabeza
  más chica que la del paquete (orejas, ojos con brillo, cejas, nariz, boca), peinados (corto, largo, cola, calvo),
  barba, mangas cortas/largas, pantalón corto, falda, gorra, gafas, mochila; colores del vestuario.
- Visto en el Probador: quietos y caminando sin desarmarse. A mejorar: los hombros (la punta de la manga asoma al
  bajar el brazo), rodillas y codos (las cajas se separan al doblar), más prendas y peinados, y leer el look del
  vestuario (pzPelo, pzArriba, pzPantalon, pzEncima, pzSombrero, pzBigote) para que el retrato hablado siga igual.

## 2026-10-12 · Personajes armados, versión 2: apoyados en los modelos del paquete
- Miguel: las cajas se veían cuadradas, «apoyate de los otros». makePersona2(look): el cuerpo y la ropa salen del
  modelo del paquete (look.modelo: Casual_Male, Suit_Female, Worker_Male…), todas sus partes juntas en UNA malla con
  piel pintada por parte (colores por vértice: piel, ropa, camisa, pantalón, cinturón, detalle, ojos) → 1 llamada.
- Lo pesado del paquete era el pelo (2.900 a 4.500 triángulos por peinado). El pelo propio: los triángulos de la
  cabeza del modelo (hueso Head) que caen en la zona del peinado, inflados 7 % desde el centro de la cabeza (sigue su
  forma); corto, rapado, largo (más un paño por la espalda), cola y moño (cajas redondeadas). Barba, gorra, gafas y
  mochila: cajas redondeadas (RoundedBoxGeometry), medidas sobre la cabeza y el torso del modelo.
- Zapatos: la piel bajo el tobillo (el triángulo entero: si el centro está bajo el tobillo y lo mueven el pie o la
  canilla), del color de los zapatos; pintado por vértice dejaba rayas.
- 2.400 a 4.200 triángulos por persona (el actual: ~13.000 y 3 llamadas). Visto en el Probador, quietos y caminando.
- (después) El pelo también del paquete: hairFrom(modelo) toma la parte Hair del modelo, la suelda y la simplifica
  con SimplifyModifier (meshoptimizer) a ~700 triángulos (eran 3.000 a 4.500), una vez por modelo; va pegada entera a
  la cabeza, del color del pelo, en la misma malla. look.peinado = 'pelo:Casual_Female' (o el nombre del modelo); los
  propios (corto, rapado, largo, cola, moño) quedan para lo que el paquete no trae. ~3.000 triángulos por persona;
  seis personas armadas (con la simplificación de cada peinado) en 200 ms.

## Personas: piezas del vestuario copiadas al modelo propio (2026-10-12)
- `pieceGeo(id)` en persona3d.js copia cualquier pieza del vestuario (pelo, bigote, sombrero, bufanda, encima) desde su modelo del pack: filtra por huesos/región, remapea el skin por NOMBRE de hueso al esqueleto base y la simplifica (≤900 tris).
- makePersona2 las usa con los mismos campos del look (pzPelo, pzBigote, pzSombrero, pzBufanda, pzEncima): la encima cerrada esconde camisa/pantalón, el pelo se recorta dentro de la copa y el sombrero se asienta sobre cabeza+pelo.
- Medido en el Probador: 2.8k–4.3k tris por persona, 1 dibujo cada una, 6 personas armadas en ~330 ms.

## Personas: el pelo bajo el sombrero y la ropa cambiada (2026-10-12)
- Sombrero: primero se asienta (baja hasta el cráneo más un colchón de pelo, sólo si quedó flotando) y DESPUÉS se recorta el pelo, con el sombrero ya en su lugar. Antes se recortaba con el sombrero en su altura original y al bajarlo quedaba una franja calva.
- El recorte usa un mapa de alturas de la cara de abajo del sombrero (celdas de 5 cm en x, z): se va el pelo que pasa por encima de esa cara (adentro de la copa o atravesando el ala) y, fuera de la huella del sombrero, el que sube más que el ala. El de abajo queda: no hay calva entre el ala y la cara. Vale para todo pelo (del catálogo, del paquete o los peinados propios).
- pzArriba / pzPantalon: con una prenda de otro modelo, la piel es la del BaseCharacter entero (la de cada modelo sólo llega hasta su ropa), recortada por hueso con el tramo que cubre la ropa puesta (como cutBase de outfit3d). Mismo esqueleto y misma cabeza (516 vértices), así que no hay costura.
- Medido: 2.3k–3.2k tris por persona.

## Cuerpos: alto, largos y contextura (2026-10-12)
- Página nueva `/cuerpos` (CuerposView): las cinco contexturas en fila, sin ropa o con ropa, con controles de sexo, proporciones (paquete · intermedio · realista), piernas, tronco, brazos, cabeza y el alto en metros (la escala sale sola para llegar a ese alto; vara de 1,70 m al lado).
- `desnudo` en el look: la piel entera del BaseCharacter, sin ropa ni piezas (pies del color de la piel).
- `shapeBody` (persona3d.js): deforma la malla ya juntada, así ropa, pelo y piezas siguen al cuerpo. Cada hueso engorda o adelgaza alrededor de su eje (ancho, fondo y barriga) y se estira a lo largo de él; cada vértice mezcla por sus pesos, sin escalones. La cabeza se escala entera desde el cuello. CONTEXTURAS: delgado, normal, atlético, robusto, gordo; mujer: hombros y cintura más angostos, cadera más ancha.
- `largeClips`: las animaciones se copian con los largos (cada hijo se corre por el eje de su padre; la cadera y los pies, que cuelgan de la raíz, suben y alargan el paso con las piernas). Se guardan por combinación. Con piernas 1.6 el pie sigue en el piso al caminar.
- Medido (pose quieta, escala .52): paquete 1,64 m · intermedio 1,75 m · realista 1,86 m antes de escalar al alto pedido. El borde del zapato se baja con las piernas largas para que no se estire como media.
- Falta: llevar sexo/contextura/largos al retrato hablado (rasgos.js) y a la demo; las sillas y camas están a la altura del cuerpo del paquete.

## Cuerpos: peinados, barbas, pies y articulaciones (2026-10-12)
- Peinados propios nuevos: afro, con entradas, melena, calvo de coronilla (además de corto, rapado, calvo, largo, cola, moño). Barbas propias: de tres días (pelo mezclado con piel, casi pegada), candado, chivera, bigote, patillas, completa. Salen de la piel de la cabeza inflada, como los peinados.
- `hairShell(keep, grow, color, sub)`: parte cada triángulo de la cabeza en 4^sub antes de elegir; sin eso las barbas salían en bloques (la cabeza tiene triángulos grandes). Medido: ojos y cejas entre u .38 y .65 → la barba va bajo u .3 y sube por los lados hasta .52.
- Pies: una caja redondeada por pie (zapato o piel); el paquete terminaba la pierna en punta.
- Articulaciones: una esfera en cada codo y rodilla, mitad de cada hueso (rellena lo que la mezcla lineal angosta al doblar). Radio: la mitad del grosor medido alrededor (×.9; con el 70 % hacía nudos con el brazo estirado); color: lo más externo ahí (manga, pantalón o piel).
- Antes de juntar se igualan los datos de todas las piezas (posición, color, piel): algunas combinaciones fallaban al juntar. Probadas 43 combinaciones de peinado y barba sin errores.
- Página /cuerpos: vista «Peinados y barbas», poses congeladas (sentado, agachado, golpe, salta…), «Variar» (peinado, barba y color al azar por persona), y los interruptores de codos/rodillas y pies.

## Muñecos: mechones, pesos limpios y orejas (2026-10-12)
- Pelo y barbas como los del paquete: una base pegada a la cabeza (más oscura) y encima MECHONES: cintas de sección triangular que nacen en el cuero (raíces separadas al menos `sp`), siguen la cabeza sin meterse (superelipse de exponente 3 como aproximación) y se afinan a la punta. Dirección: desde el remolino de la coronilla; el fleco cae hacia adelante; la gravedad `g` los dobla. Un mechón que entra en la cara (ojos y cejas, u .05–.7 de frente) termina ahí.
- Estilos: corto, entradas, coronilla, largo, melena, cola (peinado hacia atrás + manojo desde la nuca), moño (hacia arriba + bola), afro (base inflada + bultos redondos). Barbas: completa, candado, chivera, bigote (abre hacia los lados), patillas; la de tres días sigue siendo sólo base.
- Pesos: `cleanWeights` saca las fugas (un vértice sólo con huesos a ≤2 pasos del que más lo mueve) y concentra codo y rodilla en ±0,12 alrededor de la articulación (smoothstep); fuera de esa franja cada tramo es rígido (antes el brazo de arriba se doblaba con el antebrazo, «de goma»).
- Orejas: una elipse chata a cada lado.
- Costo: 4,6k–6,5k triángulos por persona con pelo y barba de mechones (antes ~3k). Para la ciudad hará falta menos mechones de lejos.

## Pelo v2: lo que dicen las guías de pelo low poly (2026-10-12)
- Fuentes: CG Cookie (formas grandes → medianas → chicas), Clip Studio (70/30, variación, asimetría), Polycount (una sola capa se ve barata; agrupar en mechones), Reallusion/C4D (degradado de la raíz a la punta).
- Aplicado: la base es la silueta; los mechones van en GRUPOS (uno ancho + uno o dos más finos encima que se abren: segunda capa) y unos pocos pelos sueltos más largos (12 %; en los cortos 4 %, y menos grupos: con muchos se veía desordenado).
- Raya corrida a un lado (al azar o `raya: 'izquierda'|'derecha'`): arriba el pelo se abre desde ella y el fleco barre al lado contrario. Las entradas se peinan hacia atrás (con el fleco adelante se veía el cuero entre mechones).
- Degradado por vértice: raíz ×.7, punta ×1.15, y cada mechón con su tono.
- Largos: los mechones no siguen la cabeza una vez lejos de ella (caían hacia el pecho), los de los lados y la nuca caen por detrás de los hombros, y la punta queda ancha (`tip` .4) en vez de hilo.
- Menos triángulos: la base bajo los mechones sin subdividir y la cara de abajo sólo en los que cuelgan (−10 a −15 %). Corto ≈4,2k por persona, largo ≈6,6k.

## Pelo «puntas» (por defecto), como los muñecos de Dragon Ball (2026-10-12)
- `L.pelos`: 'puntas' (por defecto) o 'fino' (el v2 de mechones). Puntas: raíces 2,3 veces más separadas, mechones el doble de anchos y casi tres veces más gruesos (la sección triangular se vuelve una punta), 2 tramos (3 si cuelgan), sin segunda capa ni pelos sueltos, base más inflada, degradado suave (.82 → 1.06). Barbas y afro igual: menos piezas, más grandes.
- Medido: con pelo largo 3,8k triángulos por persona (fino: 6,6k); con corto 3,4k.
- En /cuerpos: «Estilo del pelo: Puntas grandes / Mechones finos».

## Cortes de hombre desde los pelos de mujer del paquete (2026-10-12)
- Los peinados generados (mechones o puntas) se seguían viendo feos al lado de los del paquete. `L.corte` (u de la cabeza, .42 en la página) lleva un pelo largo del paquete a corte de hombre sin perder sus mechones: lo que colgaba entero bajo la pera se saca (si no quedaba como bolitas en el cuello), lo que queda bajo el corte se comprime hacia arriba (×.22) y hacia la cabeza, y el fleco que bajaba a los ojos sube hasta las cejas.
- 19 cortes (uno por cada pelo de mujer del paquete), ~900 triángulos de pelo cada uno (≈4,1k por persona). En /cuerpos van en la vista «Peinados y barbas» (filas de abajo) y en el selector como «Corte de …»; peinado 'corte:Modelo' = pzPelo + corte.

## Cortes por defecto, entradas y coronilla por mechón (2026-10-12)
- En /cuerpos los hombres arrancan con un corte (Corte de Casual 2) y «Variar» les da: corte 75 % (largo del corte al azar entre u .38 y .52; 18 % con entradas, 10 % con coronilla) o afro/rapado/calvo; mitad con barba. Las mujeres: pelos de mujer del paquete enteros (85 %) o afro, moño, cola, melena.
- Debajo de todo pelo del catálogo va una base oscura pegada, para que entre mechones no se vea el cuero.
- Entradas y coronilla sobre cualquier pelo del catálogo: el pelo del paquete son 17–25 mechones sueltos (`locksOf`: triángulos unidos por posición); se saca el mechón ENTERO si cae en la zona (entradas >35 %, coronilla >15 %). Sacar triángulos sueltos dejaba astillas flotando sobre las cejas.

## Peinados de corona, inspirados en los packs de pelo para juego (2026-10-12)
- Búsqueda: no apareció un pack de pelos low poly gratis y abierto (CC0): los de Fab, ArtStation, TurboSquid, CGTrader y Superhive son de pago; Quaternius ahora usa su licencia QAL; poly.pizza pide verificación anti-bots. Se usaron como inspiración las fotos que mandó Miguel (TurboSquid «Low Poly Hair Pack» 2413967, Cults3D).
- Lo que tienen en común: un casquete con volumen y una corona ORDENADA de mechones planos y anchos con punta, todos parecidos, en dos pisos; el flequillo es una fila de los mismos. Ordenados por ángulo y no al azar: eso da el aspecto limpio.
- `CORONAS` en persona3d.js: anime (anillo de puntas grandes alrededor de la coronilla + 4 arriba hacia atrás), pixie (fleco barrido al lado de la raya), bob (hasta la mandíbula), hongo, liso (largo). Cada piso: u donde nace [frente, lado, nuca], cantidad, largo [frente, lado, nuca] y gravedad; el ancho sale de la vuelta de la cabeza / cantidad × 1,35 (se solapan).
- Livianos: ≈3,5k–3,7k triángulos por persona en total. En /cuerpos como «… (corona)», y «Variar» los usa (hombres: anime, pixie; mujeres: bob, pixie, hongo, liso).

## Coronas sin calva y menos en fila (2026-10-12)
- Calva por debajo: el pelo nacía en u .5–.6 en los lados y la nuca, y la mitad de abajo de la cabeza quedaba pelada de lado y de espaldas. Ahora la línea baja hasta la nuca (u .2) y a los lados nace en .5 (la oreja va de .27 a .53); la base (`capMask`) cubre todo eso menos la oreja.
- En fila: los mechones ahora se curvan (`bend`: salen hacia afuera y vuelven hacia adentro en la punta; en las puntas «anime», al revés), alternan largo y corto, y cada uno tiene ancho y giro al azar.
- El flequillo era una fila de triangulitos iguales cortados a la misma altura (un serrucho): ahora son 4–5 mechones grandes, de anchos y largos distintos, barridos hacia el lado contrario de la raya.
- 3,8k–4,1k triángulos por persona.

## Pelo con volumen, como Goku (2026-10-12)
- «Muy aplanados»: los mechones eran placas de .06 de alto acostadas sobre la cabeza. Ahora cada mechón es una PUNTA con cuerpo: alto = vol × ancho (.45–.7), cerrada por abajo, con la cresta perpendicular al mechón (así una punta que sale derecho de la cabeza también tiene cuerpo). `hug:false`: las puntas hacia afuera ya no se acuestan sobre la cabeza.
- Encima de la cabeza salen puntas hacia afuera (`top`: separación, largo, cuánto hacia afuera, arriba y atrás); la base va más inflada (.11–.14).
- Estilos: anime («Goku corto»), goku_largo (la corona de atrás cae larga), pixie, bob, hongo, liso, todos con volumen. ≈4,0k–4,2k triángulos por persona.

## Mezclas: peinados nuevos con mechones del paquete (2026-10-12)
- Miguel: «guíate del pelo original de los muñecos, tenían buena contextura». Los mechones del paquete ya tienen buena forma, grosor y curva; los generados nunca quedan igual. Como todos los modelos comparten la cabeza, un mechón de un pelo cae bien sobre otro.
- `L.mezcla = {base, fleco, lados, nuca}` (nombres de modelo): cada mechón (`locksOf`) va a una zona por su centro (fleco: frente bajo u .92; nuca: atrás bajo .8; lados: x > .62 bajo .75; base: el resto) y cada zona sale del pelo indicado (lo que falte, de la base). Después se aplica el corte (`L.corte`), las entradas, la coronilla y la base oscura como a cualquier pelo del catálogo.
- «Variar» en /cuerpos: hombres 50 % mezcla de tres pelos cualquiera (con corte .38–.52), 25 % cortes, 25 % los generados (Goku, pixie, afro, rapado, calvo); mujeres 45 % mezcla de pelos de mujer (sin corte), 35 % pelos de mujer enteros, 20 % generados.

## Lados rapados y barbas talladas, de las cabezas low poly de JustCreate3D (2026-10-12)
- Referencia: «Low Poly Sci-Fi Characters» (justcreate3d.itch.io): cabezas facetadas como las nuestras. Tres ideas: volumen SÓLO arriba con lados rapados en degradado; barbas como capas talladas (no mechones); bigote y barba separados por una franja de piel.
- `DEGRADADOS`: copete (los de adelante suben y se curvan hacia atrás, anchos y poco puntudos; en la primera versión era una corona de puntas), raya (barrido desde la raya), atras (peinado hacia atrás). Lados y nuca: capa pegada (.025) del color del pelo mezclado 14 % con la piel (al 30 % se veía piel); arriba: base inflada (.08) + mechones gruesos.
- `hairShell(..., walls)`: la capa queda maciza: sus bordes (aristas de un solo triángulo) bajan en una pared hasta la piel, por las dos caras.
- Barbas talladas por defecto (`L.barbaMechones` vuelve a las de mechones): completa, corta (con el bigote aparte, franja de piel en la comisura), contorno (mandíbula y pera), candado (la pera afinada hacia abajo; antes salía un bloque cuadrado), chiva, bigote, patillas.
- «Variar» (hombres): el 25 % de los generados ahora son sobre todo copete, raya y hacia atrás.

## Bordes suaves en barbas y degradados (2026-10-12)
- El borde salía en escalones porque cada triángulo (partido) de la cabeza entraba o salía entero según su centro. Ahora las zonas pueden ser CONTINUAS (devuelven un número, >0 adentro) y `hairShell` recorta cada triángulo justo en el contorno (interpolando dónde cruza cero): el borde sigue la forma, sin escalones.
- Las zonas se arman con `smn`/`smx` (intersección y unión suaves): las esquinas salen redondeadas (radio ~.04). Pasadas a continuas: todas las barbas, la base de las coronas (`capMask`, con la línea del pelo que sube suave de la nuca al frente) y el arriba/lados de los degradados.
- `roots` acepta zonas continuas (adentro = >0). Cuesta ~+600 triángulos con barba (los recortes y las paredes).

## Moldes de mechón del paquete (2026-10-12)
- `lockTemplates()`: de 10 pelos del paquete salen 163 mechones-molde (24–140 triángulos cada uno). Cada uno en sus coordenadas: t (raíz→punta; la raíz es la punta más ancha), s (ancho) y h (grosor), normalizados. Se les quita la curva propia (el centro de cada octavo se lleva al eje): con la curva del paquete más la del recorrido salían enroscados, como rastas.
- `lock(..., {molde})`: el mechón del peinado toma un molde al azar y lo dobla a lo largo de su recorrido (centro, ancho y cresta de cada tramo interpolados); si el marco queda espejado se invierte el orden de los triángulos.
- Dónde sí: los mechones que se acuestan sobre la cabeza de los degradados (copete, raya, hacia atrás) y los peinados de mechones. Dónde no: las puntas que salen derecho (Goku: con molde parecían tallarines) y las coronas (bob, pixie… muchos mechones chicos: se arrugaban); ahí siguen las puntas macizas. `L.moldes=false` los apaga.
- Candado: la zona del bigote un poco más alta y ancha.

## Pelos y barbas del paquete, desacoplados (2026-10-12)
- Decisión de Miguel: no más peinados generados; usar los del paquete, separados de sus modelos para ponerlos en los muñecos propios.
- `scripts/extraer-pelos.mjs` (node, sólo lee los .gltf y escribe en public/models/pelos): lee cada modelo sin navegador (lector mínimo de glTF), toma la parte del pelo o la barba (con la zona: cuero o barba), la lleva a coordenadas de la CABEZA con la inversa de atado del hueso Head, la simplifica a ≤900 triángulos y la guarda como JSON con índices y su color. 37 piezas (33 pelos, 4 barbas), 840 KB en total; los modelos enteros pesan 99 MB.
- persona3d.js `catalogPiece`: `pieceGeo('pelo:…' | 'bigote:…')` lee primero el catálogo; lo lleva a la pose de atado del muñeco con la matriz de atado de SU cabeza y lo ata entero al hueso Head. Sirve para cualquier esqueleto con cabeza; sigue a la cabeza cuando cambia de tamaño (shapeBody) y funciona con corte, mezcla, entradas, coronilla y sombreros. Medido en /cuerpos: 59 cabezas con sólo 2 modelos enteros cargados (el cuerpo y el esqueleto base) y 38 archivos del catálogo.
- /cuerpos: el selector y «Variar» sólo ofrecen pelos del paquete (enteros, cortes a hombre, mezclas) más rapado y calvo; barbas: las 4 del paquete y la de tres días. La vista «Peinados y barbas» es una grilla con todo el catálogo. Los generados (coronas, Goku, degradados) quedan en el código pero no se ofrecen.
- Volver a extraer (si cambia el paquete o la simplificación): `node scripts/extraer-pelos.mjs`.

## Todo el vestuario desacoplado de los modelos (2026-10-12)
- `scripts/extraer-pelos.mjs` ahora también escribe public/models/partes/<Modelo>.json: cada parte (material) de los 52 modelos salvo la piel y el pelo, en la pose de atado, con pesos por NOMBRE de hueso y su color. 7,2 MB en total (los .gltf: 99 MB).
- persona3d.js `loadParts(modelo)`: arma «mallas livianas» con la misma forma que las del .gltf (material, geometría, esqueleto base), así el resto del código no cambia. `pieceGeo` (sombreros, bufandas, encima, arriba, pantalón) y `makePersona2` las usan; el muñeco se arma SIEMPRE sobre el cuerpo base (esqueleto, piel entera, animaciones) y del modelo elegido sólo toma ropa y cara. Sin archivo, cae al modelo entero como antes.
- Con la piel entera siempre, el recorte de piel bajo la ropa usa TODA la ropa propia puesta (el traje y la bata traen el pantalón en la misma parte: antes se veía la pierna atravesando).
- Modelos sin mapa de papeles (vaquero, bruja, vikingo, pirata…): sus sombreros y cascos se reconocen por nombre (Hat*, Helmet*, Horns) y van sólo con `sombreroPropio`; las partes sin papel conservan su color original (antes salían color piel).
- Medido: los 26 modelos arman sin error; en la página sólo se descarga BaseCharacter.gltf, el resto son los JSON. Pendientes: la cinta del sombrero de la bruja queda flotando sin el sombrero (va en la parte «Belt»); en el vikingo asoma piel bajo la túnica.

## La ropa encima del cuerpo desnudo, ajustada a él (2026-10-12)
- Miguel: la ropa debe ir ENCIMA del cuerpo desnudo y ajustarse a su forma (se veía el cuerpo a través). Antes la piel se recortaba bajo la ropa: por los huecos de la ropa se veía a través, y como la ropa se doblaba con sus propios pesos, al moverse la piel la atravesaba.
- Ahora el cuerpo va siempre entero y `fitCloth(skin, ropa, holgura)`: cada vértice de la ropa copia los pesos del punto más cercano de la piel (se dobla igual que el cuerpo y sigue la contextura de shapeBody) y lo que queda adentro o a menos de la holgura (.03; lo de encima .075) sale por la normal suave de la piel.
- Lo de encima (bata, chaqueta, vestido) ya no esconde la ropa de abajo: va sobre ella (una bata abierta dejaba el pecho desnudo). `L.recortarPiel` vuelve al recorte de antes; `L.ajustar=false` apaga el ajuste.
- Probado con traje, vikingo, mujer gorda, obrero atlético, bata sobre camisa, chaqueta de vaquero en gordo, pirata y chef, en carrera, agachado, golpe y sentado: sin piel atravesando. +500–800 triángulos por persona (la piel entera bajo la ropa).

## Calibrar la ropa: colores, combinaciones y estampados (2026-10-12)
- Sin pelo pedido, el muñeco lleva el pelo de SU modelo (del catálogo desacoplado); antes salía el peinado generado.
- vestuario.js COLORS: ropa +10 tonos de calle (vinotinto, naranja, morada, rosada, gris, café, oliva, azul_oscuro, celeste, turquesa); pantalón +3 (jean_claro, oliva, azul_oscuro). Sólo se agregan: los nombres de antes no cambian (el retrato hablado sigue igual).
- `L.estampado` ('rayas' | 'rayas_finas' | 'cuadros') y `L.estampadoColor` (si no, la misma prenda ×.55) en la prenda de arriba (papel top, y la de arriba prestada). Los triángulos se PARTEN en los bordes de cada raya o cuadro (planos y = k·W; cuadros también x = k·W, medido en la pose de atado): pintados enteros por su centro salían mosaicos de triángulos. +600–1.000 triángulos con estampado.
- /cuerpos vista «Ropa»: los 16 modelos de calle con combinaciones que combinan (una prenda de color; pantalón neutro el 85 % y nunca del mismo tono; camisa de abajo clara si la de arriba es oscura; zapatos y cinturón acordes al pantalón) y el estampado (liso, rayas, rayas finas, cuadros o al azar). «Variar combinaciones» cambia la semilla.
- Pendiente: los cuadros en camisetas de pocos triángulos todavía se ven algo irregulares.

## Ropa: estampados limpios, mangas, cuello y franja (2026-10-12)
- Los cuadros salían borrosos: al partir los triángulos, los vecinos compartían los mismos vértices (objetos) y pintar uno manchaba al de al lado. Ahora cada triángulo tiene sus propios vértices antes de pintar.
- `paintTrim`: `L.mangasColor` (los triángulos que mueve sobre todo el brazo: camiseta de dos tonos) y `L.cuelloColor` (una banda de 6 cm desde lo más alto de la prenda).
- Estampado 'franja': una banda ancha a la altura del pecho (y 1,6–1,74 en la pose de atado; la primera, en 1,82–1,95, caía en los hombros).
- «Variar combinaciones» en la vista Ropa: además de estampados (con franja), 15 % mangas y 20 % cuello de otro color (blanco, negro o gris).

## Pantalones: jean gastado, bota y bolsillos (2026-10-12)
- `cutAndPaint(g, cortes, pick)`: parte los triángulos en planos dados (f(v) = valor) y pinta cada pedazo según su centro y normal; base común para detalles con borde limpio.
- `paintPants` (papel pants y el pantalón prestado): `L.gastado` (frente de la rodilla y del muslo más claro, dos tonos), `L.bota` (banda de 8 cm abajo, más clara; sólo si el pantalón llega bajo la rodilla) y `L.bolsillos` (atrás, a la altura de la cadera, más oscuros). Rodilla y cadera: los orígenes de LowerLegL y Hips del esqueleto.
- Aclarar/oscurecer en sRGB hacia el blanco o el negro: el color de los vértices es lineal y multiplicarlo ×1,3 no se notaba en un jean oscuro.
- «Variar combinaciones»: jean gastado 55 % (sólo jean), bota 30 %, bolsillos 45 %.

## Zapatos: suela y cordones (2026-10-12)
- La caja de cada pie se parte (cutAndPaint) y lleva suela de 3,5 cm de otro color (`L.suela`, o clara si el zapato es oscuro y oscura si es claro) y, con `L.cordones`, una franja arriba al frente. Descalzo, nada.
- «Variar combinaciones»: 25 % tenis de color (rojos, azules, blancos) con cordones blancos; 30 % cordones blancos en los de siempre.

## Articulaciones en todas las animaciones (2026-10-12)
- Revisadas las 16 animaciones del paquete (Idle, Walk, Run, Jump, SitDown, StandUp, PickUp, Punch, Roll, RecieveHit, Death, Defeat, Run_Carry, Walk_Carry, Shoot_OneHanded, SwordSlash) con ropa, cuatro contexturas y proporciones del paquete, intermedias y realistas.
- Capas de ropa: la camisa de abajo con holgura .022 y la prenda de arriba .05 (con la misma, en el gordo la camisa atravesaba el saco: manchas blancas en la barriga).
- Pies con piernas largas: el pie del paquete es un hueso suelto (cuelga de la raíz) que la animación ubica por su cuenta. La canilla ahora se estira hacia el pie (antes «hacia arriba», porque no tiene hueso hijo) y en cada cuadro el pie va al final de la canilla estirada (su posición en el espacio de la canilla, ×piernas). Antes, al correr, la pierna de atrás se estiraba como un elástico.
- Relleno de codos y rodillas: el color es el de la prenda sólo si la prenda pasa la articulación de lado a lado (12 cm arriba y abajo); si no, el de la piel (el short que termina en la rodilla la pintaba de azul).
- Pendiente: con piernas largas el asiento queda más alto (las sillas están a la medida del cuerpo del paquete).

## Sentarse a la altura de la silla y trabajar en el computador (2026-10-12)
- Sentado con piernas largas el muñeco quedaba más alto. `largeClips`: en SitDown, StandUp y Typing la cadera sentada queda a la altura del asiento del paquete (la más baja de SitDown) y de ahí a la de pie se interpola según cuánto subió. Medido: cadera sentada 0,335 con piernas ×1, ×1,3 y ×1,6.
- Las canillas más largas dejaban el pie bajo el piso: en cada cuadro, sentado (`holder.userData.sentado`), si el pie queda bajo el piso y el muslo va más bien horizontal, el muslo gira hacia arriba (búsqueda por pasos que se achican) hasta que el pie apoya. El pie va siempre al final de la canilla estirada.
- `acts.trabajar` (clip «Typing», 1,2 s): armado desde el final de SitDown; el brazo de arriba cae hacia adelante, el antebrazo horizontal hacia el teclado, la cabeza un poco abajo; los antebrazos suben y bajan ±5° a destiempo (teclear) y la cabeza respira. En /cuerpos: pose «En el computador». Con silla de 30 cm y escritorio de 62 cm (escala del juego), las manos llegan al teclado.

## Los muñecos en la demo, limpieza de modelos y animales (2026-10-12)
- characters3d.js: `loadCharacters` ya no carga el paquete: arma una galería de 32 plantillas con makePersona2 (2 por modelo de calle, `lookFor`: colores que combinan, pelo del paquete entero/cortado/mezclado, barba, contextura, estampados) y 4 de policía (BlueSoldier). `makeCharacter` sigue igual (copia con su esqueleto, comparte la malla) y agrega `acts.trabajar` si hay Typing. ~60 ms por plantilla.
- Sillas de trabajo: town3d marca `seat.pc` si hay un computador a <1,1 m en el mismo piso; sitting3d, ya sentado ahí, pasa a Typing (y de Typing a StandUp al levantarse).
- Bug viejo arreglado: en DemoView dos comentarios `//` a mitad de línea se comían `loadingPeople.value=false` (el cartel decía «Cargando gente…» para siempre).
- Medido en la demo (ciudad 6105): sólo se descarga BaseCharacter.gltf; 87 fps dentro de una oficina con 36 personas (antes 52 dentro de un edificio), 113 en la calle, 121 en el prado con animales.
- Limpieza (reversible, el juego no está en git): los 51 .gltf del paquete pasaron de public/models/personajes (99 MB → 1,5 MB, sólo BaseCharacter) a fuentes/personajes; el extractor (scripts/extraer-pelos.mjs) lee de ahí. El Probador viejo (ProbadorView.vue + outfit3d.js, vestían los modelos enteros) quedó en fuentes/archivo y /probador redirige a /cuerpos.
- Animales (animals3d.js): 12 animados de Quaternius (public/models/Animales, glTF con Walk/Gallop/Eating/Idle…), granja OBJ (public/models/AnimalesGranja: cerdo, oveja, llama, pug…) y mar OBJ (public/models/AnimalesMar: 3 peces, delfín, ballena, tiburón, manta), los OBJ juntados en una malla con colores por vértice. Monte: venados y ciervos en manada, lobos en pareja, zorro solo (island.spot 'monte'); prado: vacas+toro, caballos+burros, alpacas+llamas, ovejas, cerdos (island.spot 'prado'); ciudad: perros (husky, shiba, pug) que siguen el rastro de su dueño ~1,1 m atrás (al costado se metían en las paredes); mar (island.agua: punto con hondura mínima): cardúmenes cerca de la orilla, delfines que saltan en arco, tiburón, manta y ballena más afuera. Sin animar a >90 m, ocultos a >220 m (la ballena 400).
- Pendiente: los OBJ de granja caminan con un rebote (sin patas animadas); la cebra, la vaca y el caballo OBJ no se usan (están los animados).

## Animales con esqueleto, hechos en Blender (2026-10-12)
- Blender 5.2.2 (brew), sin ventana: `blender -b --factory-startup -P script.py -- args`. Scripts en scripts/blender/.
- `rig.py donante.gltf objetivo.obj salida.glb vista.png`: presta el esqueleto y las 13 animaciones de un cuadrúpedo de Quaternius a un OBJ sin huesos. Ajusta la malla y los huesos del donante a la forma del objetivo por tramos (no sólo la caja): ancho; largo con los centros de las patas delanteras y traseras; alto con la línea de la barriga (lo más bajo donde el cuerpo ocupa ≥55 % del largo, buscando desde el 10 % de la altura); copia los pesos del más cercano (DATA_TRANSFER) y exporta glb. Llama←Alpaca, Cerdo←Vaca, Oveja←Vaca, Pug←Shiba.
- `mar.py objetivo.obj salida.glb modo vista.png`: cadena de 5 huesos cabeza→cola (o cuerpo + 3 por ala en la manta), pesos automáticos y una acción Swim de 1 s que ondula hacia la cola: modo lado (peces, tiburón), vertical (delfín, ballena), alas (manta).
- Salida en public/models/AnimalesRig (11 glb, 2,9 MB); animals3d.js los prefiere a los OBJ sin huesos. El agua de la isla tiene ~2 m de hondo como mucho: tiburón y manta piden 1,8 m (y si no hay, menos), la ballena quedó de 7 m nadando cerca de la superficie; el círculo de nado se achica hasta quedar entero en el agua (la ballena salía sobre la roca). Siempre hay una ballena, un tiburón y una manta.

## El cuerpo base rehecho en Blender (2026-10-12)
- `scripts/blender/cuerpo.py BaseCharacter.gltf salida.glb piernas tronco brazos partes_in partes_out vistas`:
  1) alarga piernas/tronco/brazos en el esqueleto y en la malla (cada vértice sigue a sus huesos con sus pesos; la misma cuenta de shapeBody, pero en la pose de reposo) y lo sube para que los pies sigan en el piso; el pie queda en la punta de la canilla;
  2) huesos de apoyo Elbow.L/R y Knee.L/R (hijos del brazo / muslo, giran la mitad que el antebrazo / canilla) que se llevan min(w_arriba, w_abajo) del peso de la articulación;
  3) las 16 animaciones pasan del esqueleto original al nuevo cuadro por cuadro (giros locales; pie en la punta de la canilla; la cadera, ×piernas, y sentado queda a la altura del asiento) y se hornean;
  4) recalcula las partes de ropa (public/models/partes → partes_<cuerpo>) con la misma deformación.
- Salidas: personajes/BaseIntermedio.glb (1,3/1,08/1,12) y BaseRealista.glb (1,6/1,15/1,25), 620 KB cada uno; partes_intermedio (10 MB) y partes_realista (8,9 MB). Blender 5: las curvas de una acción viven en layers→strips→channelbags (`fcurves(a)` en el script).
- Error encontrado: a la ropa se le sumaba dos veces la subida (los huesos nuevos ya la llevaban): la camisa quedaba junto a la cabeza y la piel de cada vértice más cercano era la de la cabeza (mangas como alas al moverse).
- persona3d.js: `L.cuerpo` ('intermedio' | 'realista'): esqueleto, animaciones y ropa de ese cuerpo; pieceGeo, loadParts, catalogPiece y loadSkeleton reciben el cuerpo. Con huesos de apoyo no van las esferas de codos y rodillas ni la franja rígida de cleanWeights. Con estos cuerpos no se estiran largos en el navegador (piernas/tronco/brazos = 1); la cabeza sí (.85 / .72).
- /cuerpos: «Cuerpo: Del paquete / Blender intermedio / Blender realista». Demo: characters3d.js `CUERPO='intermedio'` (una constante).
- Medido: sentado a la altura de la silla y tecleando en la oficina. Los fps en el mismo lugar variaron entre 68 y 120 de una carga a otra (con el mismo cuerpo): hace falta medir varias veces antes de concluir si el cuerpo nuevo cuesta más.

## Animaciones nuevas hechas en Blender (2026-10-12)
- `scripts/blender/animaciones.py entrada.glb salida.glb vistas`: parte de una animación del paquete (Idle, Walk o el final de SitDown) y APUNTA huesos a direcciones del mundo en el sistema del muñeco (x a su izquierda, y adelante —medido con los ojos respecto de la cabeza—, z arriba), de padre a hijo, cuadro por cuadro; se guarda como acción nueva y se exporta el glb con todas. Se puede correr de nuevo (rehace las suyas).
- Nuevas (en BaseIntermedio y BaseRealista; 23 animaciones cada uno): Arrest (esposar: brazos adelante, manos juntas a la altura de la cintura —la primera, con las manos en el pecho, parecía de brazos cruzados—), Cuffed y Walk_Cuffed (manos juntas atrás, cabeza gacha), Phone y Walk_Phone (mano derecha en la cabeza), Eat_Sitting (sentado: la izquierda en la mesa, la derecha del plato a la boca), Typing (ahora hecha en Blender; si el cuerpo no la trae, persona3d sigue armándola en el navegador). Cargar ya venía en el paquete (Walk_Carry, Run_Carry).
- Código: acts.trabajar / esposar / esposado / esposadoCamina / celular / celularCamina / comer (persona3d y characters3d). Demo: 1 de cada 7 peatones camina hablando por celular; en las sillas de mesas de locales de comida (seat.meal) se come; frente a un computador se teclea. /cuerpos: poses nuevas en el selector.

## Faldas y vestidos (2026-10-12)
- `scripts/blender/faldas.py cuerpo partes_dir vista`: mide la cintura, la cadera y los muslos del cuerpo y arma tres faldas (corta a medio muslo, a la rodilla, larga a media pierna) como un cono suave de 20×8: de la cintura se abre rápido hasta lo más ancho de cadera y muslos y después se ensancha de a poco (medir cada altura por separado la dejaba con forma de reloj de arena). Pesos de juego: arriba Body/Hips; hacia abajo cada lado toma de a poco su UpperLeg (hasta 0,5 en el ruedo; adelante y atrás menos). Sólo la cara de afuera (320 triángulos: con la de adentro pasaba de 900 y pieceGeo la simplificaba, arrugada). Salida: partes*/Prendas.json para los tres cuerpos.
- vestuario.js: `falda:corta|rodilla|larga` en PIECES.pantalon (m:'Prendas', falda:true). persona3d: las faldas conservan sus pesos y no se empujan (fitCloth `keep`: copiar los de la piel las partía en dos y empujarlas las dejaba dentadas) y no llevan los detalles de pantalón.
- Demo (characters3d lookFor): mujeres con falda 45 % y vestido 20 % (arriba de Casual_Female + falda del mismo color); nunca en modelos cuyo saco trae el pantalón (topPants: traje de mujer). /cuerpos vista Ropa: también.
- Pendiente: sentada, la falda larga cuelga por debajo del asiento (lleva sólo la mitad de la pierna).

## Huesos de falda: que no cuelgue al sentarse (2026-10-12)
- persona3d: con falda, dos huesos SkirtL/R hijos del cuerpo en la cadera (con la orientación del muslo; inversa de atado = la del muslo) reciben el peso de pierna de la falda. `followSkirt(root)` corre después de cada update del mezclador (en persona3d y en las copias de characters3d): cada hueso sigue al muslo con k = 0,5 de pie (se mece) a 0,95 con el muslo levantado (sale del ángulo del muslo con la vertical: no hace falta avisar que está sentada) y se acorta a lo largo (×0,65 sentada: la tela recogida).
- faldas.py: el peso de pierna crece hacia el ruedo (t^1,3, hasta 1) en toda la vuelta, y adelante y atrás se reparte de a poco entre las dos piernas (antes se cortaba en seco: al separarse las piernas la falda se abría; y adelante y atrás con poco peso de pierna, sentada colgaba por debajo del asiento).
- Pendiente: sentada con falda corta o a la rodilla todavía asoma una punta de tela bajo el muslo.

## Versión de lejos de los muñecos (2026-10-12)
- persona3d `lowGeo(geo, ratio, kinds)`: la malla del muñeco (piel, colores, pesos) simplificada (SimplifyModifier, ~12 ms). `kinds` por vértice (1 piel, 2 ropa, lo devuelve makePersona2): antes se saca la piel tapada por la ropa (un triángulo de piel cuyos tres vértices tienen ropa a <7,5 cm); sin eso, simplificadas juntas, la piel atravesaba el pantalón y las mangas.
- characters3d: cada plantilla guarda dos versiones (35 % y 13 %: ~5.700 → ~1.900 → ~700 triángulos). `updateLod` cambia la geometría de la misma malla (comparte esqueleto y animación) según la distancia a la cámara: entera a <14 m, media hasta 32 m, lejana más allá. Va enganchado al update del mezclador; la demo copia la cámara en `LOD_CAM` cada cuadro.
- Medido (ciudad 6105): desde la entrada los 18 peatones van en la versión lejana; un peatón cambia 0→1→2 a 3, 20 y 45 m; en la oficina llena 76–77 fps estables en tres mediciones (antes 68–73 con el cuerpo intermedio).

## Sin huecos invisibles (2026-10-12)
- Prueba: fondo magenta y, en una copia de cada malla, la cara de ADENTRO pintada de verde fosforescente: todo lo verde que se ve es un lugar por donde se mira el interior del muñeco (un hueco). Salieron: boca de las mangas, borde de chaquetas y bata, cuello, ruedo del pantalón, bordes del pelo junto a la oreja.
- Arreglo: el material de los muñecos (persona3d MAT) dibuja las dos caras; la de adentro un 35 % más oscura (shader: `if(!gl_FrontFacing)diffuseColor.rgb*=.65`), como un forro en sombra. Vale para la demo (las copias comparten el material).
- La cintura de las faldas sube a casi el abdomen (Hips + 95 % hasta Abdomen): más baja dejaba piel al aire entre la blusa y la falda.


## 2026-10-12 · Pelo, ropa y barriga redondeada (Blender)
- Dirección de Miguel: conservar la cara original, sin agregar nariz ni boca; mejorar el pelo, la ropa y el volumen del abdomen.
- Blender: `scripts/blender/pulir-personas.py` conserva huesos y animaciones y genera PielPulida_paquete/intermedio/realista.json, partes*_pulidas y pelos_pulidos. Sólo se usa la piel con soporte extra en robustos y gordos; los demás conservan la piel de antes. Las secciones del abdomen se llevan a óvalos y los bordes largos del tronco y la ropa reciben soporte con pesos interpolados.
- persona3d shapeBody: el volumen de gordos y robustos es una curva continua por altura, en lugar de multiplicadores distintos por hueso que daban una franja como platillo. La ropa sigue la misma deformación y conserva sus colores, estampados y piezas.
- Pelo: 33 pelos rehechos desde los mechones originales, simplificados en Blender a como máximo 1.150 triángulos. En la demo se usan peinados completos de calle; se evitan mezclas al azar de fleco, lados y nuca de modelos incompatibles.
- /cuerpos: Original / Pulido Blender compara las mismas piezas; Retrato congela la pose y los botones Completo, De cerca y Barriga fijan encuadres. Las galerías de ropa y pelos ahora respetan el cuerpo seleccionado.
- Validado: build de producción, 30 combinaciones (3 cuerpos × 2 sexos × 5 contexturas), 1.890 muestras de animación, 6 mallas LOD y las 32 plantillas de la demo. Las partes Face de los JSON permanecen idénticas. /demo con ciudad 21447 carga los modelos sin errores. El navegador de prueba rechaza Pointer Lock; no se verificó caminar con el ratón allí. Prueba reproducible: /scripts/validar-pulido.html en el servidor de desarrollo.
- Regenerar: `node scripts/extraer-pelos-fuente.mjs work/pelos-fuente`, luego `blender -b --factory-startup -P scripts/blender/pulir-personas.py -- "$PWD" "$PWD/work/pelos-fuente"`. Los catálogos anteriores permanecen en sus carpetas para la comparación.

## 2026-10-12 · Contacto de brazos con el cuerpo y la barriga
- Dirección de Miguel: conservar el acabado aprobado y evitar que brazos y manos se hundan en el torso, especialmente en los gordos.
- `src/lib/armContact3d.js` mide 15 secciones sobre los triángulos de la piel y la ropa ya ajustadas; los óvalos siguen la columna con sus pesos. Mide también grosor de mangas/antebrazos y el volumen de las manos. Es una aproximación ligera de contacto, no una simulación de toda la malla.
- Después de la animación, separa brazos y antebrazos del volumen por giros de UpperArm/LowerArm; conserva sus posiciones locales y largos. El antebrazo mantiene su dirección cuando se abre el brazo. Los apoyos Elbow de Blender acompañan la corrección del codo. La unión de la axila permanece pegada al hombro.
- Restaura la pose de animación antes de cada actualización: no acumula giros en poses congeladas ni en fundidos. En movimiento reutiliza la dirección de contacto anterior y suaviza la salida sólo si la postura interpolada sigue fuera del volumen.
- `makePersona2` y las copias de `makeCharacter` instalan la misma corrección. Las 3 versiones LOD comparten las medidas de la malla completa; se conserva una malla y una llamada de dibujo por persona. No cambian los modelos, la cara, el pelo, la ropa ni la forma de la barriga.
- /cuerpos tiene «Brazos: Sin contacto / Con contacto», activo por defecto, para comparar la misma pose y las mismas piezas.
- Validación reproducible: /scripts/validar-contacto.html. Pasaron 60 combinaciones (3 cuerpos × 2 sexos × 5 contexturas × piel/ropa), 11.088 muestras de animación, 36 plantillas (32 civiles + 4 policías) en las 3 versiones de distancia y con transformaciones del holder. Residuo máximo contra el volumen de contacto: 0,002 unidades del modelo; posiciones locales de brazos/manos idénticas con y sin corrección; sin acumulación de giros. Las muestras de superficie de antebrazos/manos también se comprueban: tolerancia 0,015 en la malla completa y 0,035 en las simplificadas. Los valores son del modelo antes de la escala del juego.
- Prueba de continuidad de Idle, Walk, Run, Typing, Eat_Sitting, SitDown, Arrest y Cuffed. Muestra de coste total del update con contacto de un gordo caminando: ~0,057 ms por cuadro en este equipo; no equivale a una medición de FPS de toda la demo. Build de producción correcto.
- Respaldo previo: `respaldo-antes-contacto-brazos.tar.gz` en los outputs de esta tarea; contiene fuentes, modelos y datos del estado aprobado, sin node_modules ni dist. Para restaurar dependencias se usa el package-lock del respaldo.

## 2026-10-12 · Dobladillos y terminaciones de la ropa
- Dirección de Miguel: añadir dobladillos para que la ropa se vea más terminada, manteniendo el acabado y el contacto de brazos aprobados.
- Blender: `scripts/blender/dobladillos.py` modela un prototipo de puño de 16 lados y un pliegue biselado de cuatro puntos. Exporta la sección a `public/models/dobladillos/perfil.json` (ancho 0,045 y grosor 0,016 en unidades del modelo); conserva un prototipo .blend en el directorio de trabajo indicado.
- `src/lib/dobladillos3d.js` extruye esa sección sobre los bordes cerrados de las prendas, después de fitCloth y antes de shapeBody. Sigue la forma real de mangas, cuello y bajos, puños de manga larga, pantalones y ruedo de faldas. Copia colores y pesos de la tela; los tres planos del bisel varían suavemente el tono del mismo color. La cara de fuera conserva su orientación para que el forro no oscurezca una terminación exterior por error.
- Se omiten la cintura del pantalón bajo el cinturón, la cintura de las faldas, solapas/frentes abiertos y huecos pequeños. En las camisas de abajo se terminan las mangas visibles. Los bordes de falda reciben los mismos SkirtL/R que la falda.
- Cada dobladillo se agrega a la misma malla del personaje y a kinds=ropa, para mantener las versiones LOD y una sola llamada de dibujo. Las medidas del contacto de brazos incluyen los nuevos bordes. Desnudo no agrega geometría.
- /cuerpos: «Terminaciones de la ropa: Sin dobladillos / Con dobladillos», activos por defecto también en la demo. Conservaron cara, pelo, cuerpo, colores y geometría de las prendas originales; sólo se añaden los pliegues.
- Validación: /scripts/validar-dobladillos.html, 180 combinaciones (3 cuerpos × 5 contexturas × 12 looks, incluyendo prendas intercambiadas, rayas, cuadros y falda), 3.060 muestras de animación, 36 plantillas de la demo y LOD. Comprueba el prefijo de posiciones/colores/pesos/índices original idéntico, pesos normalizados, datos finitos, clips intactos y contacto de brazos. En camiseta + short agrega 456 triángulos; el máximo probado, con cuadros, fue 1.224. Build de producción correcto.
- Pendiente previo: en robustos/gordos, los muslos pueden asomar en las faldas. Se comprobó que ocurre también sin dobladillos; estos bordes no cambian el ajuste de la falda.
- Regenerar el perfil: `blender -b --factory-startup -P scripts/blender/dobladillos.py -- "$PWD" "$PWD/work/dobladillos-prototipo.blend"`.
- Respaldo de fuentes y scripts previo a este cambio: `respaldo-antes-dobladillos.tar.gz` en los outputs de esta tarea. Los catálogos de modelos existentes no se modificaron; el único asset nuevo es el perfil del pliegue.

## 2026-10-12 · Accesorios con volumen y acabados low poly
- Dirección de Miguel: mejorar correa/cinturón, corbata, reloj y otros accesorios, conservando el cuerpo, la ropa y la cara aprobados.
- Blender: `scripts/blender/accesorios.py` genera piezas pequeñas reutilizables en `public/models/accesorios/pulidos.json`: hebilla abierta con lengüeta, pasadores, correa y eslabones, caja/dial/índices/agujas de reloj de 12 lados, montura abierta, nudo trapezoidal de corbata, clips y tirador de cierre. Las piezas llevan colores por papel y se unen a la malla del personaje.
- `src/lib/accesorios3d.js`: añade los detalles después de shapeBody, para que las piezas rígidas no se inflen con el abdomen. La hebilla y los pasadores se colocan sobre la superficie real del cinturón; sus bordes reciben un relieve leve. El rectángulo de hebilla anterior deja de compartir el color de la corbata y toma el cuero debajo del marco.
- Corbata: frente con pliegue central y variación leve del tono de la tela, más nudo con volumen. Tirantes: clips en el extremo de cada tira, medidos según la contextura.
- Reloj: cuero o brazalete metálico, esfera sencilla con bisel, cuatro índices y dos agujas. Rígido al antebrazo, colocado en la muñeca y orientado hacia el frente en Idle; luego sigue el hueso en todas las animaciones. No requiere actualizar geometría por cuadro.
- Gafas: montura abierta que deja ver los ojos originales, puente y patillas alrededor de la cabeza. La altura se mide sobre los componentes de los ojos existentes; no cambia Face ni añade nariz o boca.
- Mochila: conserva el cuerpo y bolsillo originales y añade asa, cierre con tirador y correas que pasan por los hombros. Las tiras toman los pesos de la superficie de la prenda.
- /cuerpos: Accesorios originales / Accesorios pulidos; selector de reloj, botones Gafas/Mochila y Prenda de prueba (camiseta, traje con corbata, tirantes, trabajo y bata). Activos por defecto en la demo. Una semilla separada para los accesorios conserva los mismos looks, colores, pelos y contexturas de las 32 plantillas aprobadas; 10 llevan reloj y 4 gafas en la semilla por defecto.
- Validación reproducible: /scripts/validar-accesorios.html. 90 combinaciones (3 cuerpos × 5 contexturas × 6 looks, con relojes de ambos tipos, lado derecho, gafas y mochila), 5.670 muestras de todas las animaciones y 36 plantillas con sus LOD. Verifica posiciones, colores y pesos de piel, cara, prendas y cuerpo de mochila idénticos, datos finitos, pesos normalizados, clips y material compartido, accesorios presentes y contacto de brazos. Residuo máximo de contacto medido: 0,002 unidades del modelo. Build de producción correcto. Comprobación adicional: lookFor conserva todos los campos de vestuario anteriores sin consumir más números de su generador.
- Respaldo previo de fuentes y scripts: `respaldo-antes-accesorios.tar.gz` en los outputs de esta tarea. Los catálogos anteriores de modelos no se modificaron.
- Regenerar: `blender -b --factory-startup -P scripts/blender/accesorios.py -- "$PWD" "$PWD/work/accesorios-prototipos.blend"`.

## 2026-10-12 · Ropa al sentarse, pelo suave y base del ropero

- `ropa3d.js` ajusta la ropa a la superficie del cuerpo con pesos interpolados. El bajo de la camisa sigue la pelvis en vez de dejarse arrastrar por los muslos; la cintura del pantalón sube ligeramente al sentarse. Un correctivo de posición se calcula una vez por combinación y se mezcla según la flexión de las piernas. Incluye faldas y sus dobladillos. Es un ajuste de poses, no una simulación de tela por cuadro.
- `pies3d.js` comparte el ajuste de pies entre el probador y las copias de la demo. Se hornea la tela usando esa misma postura. Las rotaciones de reposo de los huesos de falda se guardan como arrays: Three.js puede clonarlas sin perder sus componentes ni producir posiciones inválidas.
- Ropa interior inferior por defecto: bóxer corto con cintura, pieza independiente (`interior:boxer`). El botón «Ropa interior» quita las prendas exteriores; no hace falta añadir una prenda superior. `ropaInterior:false` queda disponible para herramientas técnicas.
- Catálogo independiente `WARDROBE` y `CLOTHING_SLOTS` en `engine/vestuario.js`: arriba, camisa interior, pantalón/falda, cinturón, corbata/tirantes y chaqueta/abrigo. El identificador no depende del cuerpo. `withGarment(look, slot, id)` devuelve otro look; `null` quita una pieza, omitir el slot hereda el conjunto. `/cuerpos` ofrece estos selectores en «Ropero · prendas independientes»; en escritorio el visor permanece visible al bajar por los controles.
- El saco y el pantalón del traje se separan por sus islas de geometría, aunque compartan material. La camisa del traje tiene una capa completa para quitar el saco y la corbata sin dejar huecos; el cinturón mezclado se coloca a la altura del pantalón elegido. Los zapatos son una capa separada de la piel.
- El resultado conserva una sola malla y material. `makePersona2` y los personajes de la demo exponen `parts` y `extractPart(id)`: cada pieza conserva posiciones, colores, pesos y el correctivo sentado. La geometría completa `partSource` permite separarla sin perder las caras ocultas; la malla que se dibuja descarta conservadoramente piel y ropa interior cubiertas. Cambiar la ropa reconstruye la combinación y restaura las zonas necesarias. Los LOD conservan el correctivo sentado.
- Pelo/barba: `scripts/blender/pelos-suaves.py` une los mechones solapados, suaviza extremos y simplifica manteniendo caras planas. Produce 37 piezas en `public/models/pelos_suaves/` (33 pelos y 4 barbas/bigote); el pelo pasa de 35.212 a 25.820 triángulos en el catálogo pulido, un 26,7 % menos. «Variar» elige peinados completos, sin mezclar mechones en chuzos. Entradas y coronilla se ajustan sobre la superficie continua. El total por personaje depende de la ropa: interiores completos y calzado separable pueden sumar geometría aunque se oculten caras cubiertas.
- Regeneración: `node scripts/extraer-pelos-fuente.mjs <carpeta_fuente>` (ver argumentos del extractor) y `blender -b --factory-startup -P scripts/blender/pelos-suaves.py -- <carpeta_game> <carpeta_fuente>`. Se conservan los catálogos originales y el acabado anterior.
- Validación: `/scripts/validar-ropero.html`: 90 combinaciones (3 cuerpos × 5 contexturas × 6 looks), 303 cargas de piezas de catálogo, 5.670 muestras de animación, 36 plantillas de ciudadanos/policía y 144 comprobaciones de LOD. Comprueba pesos normalizados, valores finitos, piezas extraíbles sin pérdida, ropa interior, ropa mezclada, clones sentados y contacto de brazos. Comparaciones visuales antes/después: camisa y pantalón, las tres faldas, pelo/barba; revisión adicional de bóxer y conjunto mezclado. Build de producción correcto.

Ejemplo para el futuro ropero (se puede usar con cualquiera de los tres cuerpos):

```js
const look = {
  modelo: 'Casual_Male', cuerpo: 'intermedio', contextura: 'gordo',
  prendas: {
    top: 'prenda:Suit_Male:Black:top',
    inner: 'prenda:Suit_Male:Shirt:inner',
    pants: 'prenda:Casual2_Male:Pants:pants',
    belt: 'prenda:OldClassy_Male:Belt:belt',
    detail: null,
  },
};
const persona = await makePersona2(look);
const camisa = persona.extractPart('prenda:Suit_Male:Shirt:inner');
// Es una BufferGeometry con pesos; se puede volver a enlazar al mismo esqueleto.
```

## 2026-10-12 · Pestaña Ropero y calzones adheridos al cuerpo

- Nueva ruta `/ropero` y enlace «Ropero» en la navegación. Un único personaje centrado, sin ropa exterior y con calzones. Selectores: estilo Clásico/Intermedio/Realista, las cinco contexturas y hombre/mujer. Primera etapa del ropero: sólo cuerpo base y prueba de movimiento.
- Animaciones completas y repetidas de quieto, caminar, correr y saltar; pausa/reanudar y cámara lenta. Se puede girar la cámara, acercar y volver a la vista frontal. Cambiar de cuerpo conserva el movimiento elegido. La vista libera geometrías, esqueleto, controles y renderizador al cambiar o salir; descarta cargas que terminen después de otro cambio.
- Los calzones ya no son una capa inflada con un correctivo propio. `underwear` en `ropa3d.js` divide la superficie del cuerpo en el borde del bóxer y la cintura; el calzón comparte exactamente esas posiciones y pesos. Es una región coloreada adherida a la piel, sin movimiento de tela independiente. Sigue la anatomía al doblar las piernas. El correctivo de ropa sentada no lo modifica.
- La piel completa se conserva en `partSource`, y el calzón sigue siendo identificable y extraíble como `interior:boxer`. Su mapa `skinVertices` enlaza cada vértice con la piel original; al dibujar se eliminan los triángulos coincidentes de piel para evitar parpadeos y penetraciones. Se aplica por defecto en todas las vistas y en la demo.
- Prueba `/scripts/validar-calzones.html`: 30 variantes (3 estilos × 5 contexturas × 2 personajes), 33.216 vértices y 2.730 muestras de quieto, caminar, correr, saltar, sentarse, agacharse y trabajar. Coincidencia exacta de posiciones/pesos con la piel, sin correctivo independiente ni caras coincidentes dibujadas; separación máxima medida: 0. Regresión de ropa: 90 combinaciones, 303 cargas de catálogo, 5.670 muestras de animación, 36 plantillas y 144 comprobaciones de LOD, sin fallos. Build de producción correcto.


## 2026-10-12 · Sólo cuerpo clásico y cintura del calzón más alta

- Cuerpo clásico fijo en `/cuerpos`, `/ropero` y la gente/policía de la demo. Se retiran los selectores de estilo y los presets intermedio/realista de las vistas; se mantienen sexo y contexturas. `/cuerpos` conserva sus ajustes manuales de medidas. Los recursos históricos siguen disponibles sin ofrecerse como estilos del juego.
- Cintura del bóxer elevada 0,08 unidades del modelo (aproximadamente 4 cm en el personaje del juego). Se conserva la altura de las perneras y el ancho de la banda: queda con mayor tiro, sin mover hacia arriba el borde inferior. Continúa adherido exactamente a la piel, con los mismos pesos y sin correctivo de tela propio.


## 2026-10-12 · Pantaloneta opcional en el Ropero

- `/ropero`: botón «Poner pantaloneta / Quitar pantaloneta». La pantaloneta es la pieza independiente `prenda:Casual_Male:Pants:pants`, con sus dobladillos, ajustada a todas las contexturas y a hombre/mujer. No añade camisa, cinturón ni zapatos. Los calzones permanecen debajo y reaparecen al quitarla.
- Empieza sin pantaloneta. Cambiar de contextura o personaje conserva la prenda elegida. Poner/quitar conserva la animación, su fase, la pausa y la cámara para comparar el ajuste en la misma postura.


## 2026-10-12 · Pantaloneta a la altura del calzoncillo

- La pantaloneta del Ropero usa la misma referencia de cintura que los calzones (`UNDERWEAR_TOP`). Se eleva progresivamente su parte superior antes de ajustar la tela al cuerpo y generar los dobladillos, conservando la altura del ruedo. `cinturaInterior:true` activa este ajuste para la prenda del Ropero.


## 2026-10-13 · Pantaloneta del Ropero: ajuste y validación de contacto

- Pantaloneta independiente con la misma cintura que el bóxer. Se adapta a la superficie de cada contextura, comparte sus divisiones y conserva el color de la prenda. Ruedo integrado con una franja de acabado; se adelanta 0,07 unidades del modelo respecto al borde anterior para liberar la articulación. La holgura se aplica después de formar el cuerpo y se reduce en cintura y ruedo.
- La cintura de piel, calzones y pantaloneta sigue la pelvis, con transiciones hacia muslo y abdomen. Evita que una sola pierna arrastre la barriga. El correctivo de sentado anterior no se aplica a esta pantaloneta.
- Se conserva la piel completa en `partSource`; al vestir se omiten únicamente las caras cubiertas identificadas sobre la prenda. También se oculta el bóxer cubierto. Quitar la pantaloneta reconstruye y muestra el cuerpo con sus calzones. La prenda continúa extraíble mediante `extractPart`.
- Contacto de manos con dos volúmenes medidos en los muslos vestidos. Flexión de rodilla limitada según contextura, con pies siguiendo la pierna; anticipación de salto menos comprimida, conservando despegue, altura y aterrizaje. Se activa con `cinturaInterior:true`, como usa el Ropero; no cambia las animaciones originales del catálogo ni las plantillas compartidas de la demo.
- No hay simulación de tela ni recorridos de sus triángulos por cuadro. Los ajustes de ropa se calculan al crear la combinación; durante la animación sólo se corrigen huesos. Se descartan triángulos degenerados y distancias no finitas al buscar superficies.
- Validación reproducible: `/scripts/validar-pantaloneta.html`. Diez variantes del cuerpo clásico (cinco contexturas × hombre/mujer), 25 muestras por clip en Idle, Walk, Run, Jump y SitDown: 1.250 poses, sin cruces detectados entre triángulos visibles de pantaloneta y piel/articulaciones/calzones. Tolerancia geométrica 0,00001; los contactos en bordes y coplanares no se cuentan como penetración. Es una comprobación discreta de las superficies dibujadas, no una garantía sobre cualquier postura o ropa futura.
- La prueba comprueba además coincidencia exacta de posiciones/pesos del bóxer con la piel y extracción de la pantaloneta. Las mediciones de update de estas poses estuvieron aproximadamente entre 0,12 y 0,17 ms por personaje en este equipo; no equivalen a FPS de la ciudad. Se guardaron capturas y resultados antes/después en los outputs de la tarea.
- Respaldo previo: `respaldo-antes-colision-pantaloneta.tar.gz` (fuentes, scripts e IDEAS). Los modelos de `public/models` no se modificaron.


## 2026-10-13 · Pantalón largo independiente en el Ropero

- Botones para poner/quitar pantaloneta y pantalón; ocupar el mismo slot cambia la prenda, conservando movimiento, fase, pausa y cámara. Se empieza con calzones. Pantalón `prenda:Casual2_Male:Pants:pants`, adaptado con el mismo sistema de superficie, cintura alta y ruedo integrado aprobado para la pantaloneta.
- Los rellenos de articulación se identifican en partSource y se omiten al dibujar cuando están completamente cubiertos por ropa ajustada. Reaparecen al quitar la prenda. Se evita la esfera de rodilla atravesando la tela sin inflar el pantalón.
- Sólo este pantalón del Ropero limita a 0,55 radianes la desviación del pie respecto a su orientación de reposo relativa a la pantorrilla. Conserva movimiento de tobillo y evita el empeine atravesando el ruedo al correr. Restaura la pose antes de actualizar la animación.
- `/scripts/validar-pantalon.html`: 10 variantes clásicas, 25 fases de Idle/Walk/Run/Jump/SitDown, 1.250 poses sin intersecciones detectadas entre pantalón y superficies visibles de piel/articulaciones/calzones (tolerancia 0,00001; no cuenta contactos coplanares). Comprueba calzones adheridos y pantalón extraíble. Es muestreo discreto, no garantía sobre cualquier pose futura.
- Regresión pantaloneta: otras 1.250 poses sin cruces; misma cantidad de triángulos visibles y de prenda que la versión aprobada. Sin cambios en su forma, cintura ni parámetros de movimiento. Build correcto. Respaldo: `respaldo-antes-pantalon-largo.tar.gz`. No se modifican modelos de public/models.


## 2026-10-13 · Falda corta independiente en el Ropero

- Se añade «Poner falda / Quitar falda», usando `falda:corta`. Ocupa el slot inferior y conserva calzones, sexo, contextura, movimiento, pausa y cámara al cambiar de prenda. Pantalón y pantaloneta permanecen disponibles.
- La falda no pasa por conformShorts: conserva su tubo independiente de 320 triángulos. Cintura alineada con el interior, ajuste al cuerpo después de formar la contextura, franja de acabado integrada y pequeña apertura del ruedo. Sus huesos acompañan los muslos sin el acortamiento antiguo; estos cambios se limitan al Ropero mediante cinturaInterior.
- Contacto de brazos ampliado al volumen de la falda. `skirtContact3d.js` ajusta vértices compartidos contra aproximaciones de cadera y muslos; restaura posiciones de reposo antes de cada actualización para evitar acumulación. Es contacto aproximado, no simulación de tela ni solución exacta de colisiones. La malla completa y la prenda extraíble se conservan en partSource. No se modifican modelos de public/models.
- Validación `/scripts/validar-falda.html`: 1.250 poses (10 variantes clásicas × 5 clips × 25 fases), geometría finita, calzones adheridos y falda extraíble. LIMITACIÓN ABIERTA: quedan 3.308 pares de triángulos en cruce acumulados: Walk 503, Run 1.131, Jump 34 y SitDown 1.640; Idle sin cruces. No equivale a ese número de defectos visuales únicos. No se declara la falda libre de penetraciones. Resultados guardados en falda-contacto.json en outputs de la tarea.
- Pantalón y pantaloneta: regresión de 1.250 poses cada uno, sin cruces detectados. Compilación correcta. Respaldo previo: respaldo-antes-falda.tar.gz.


## 2026-10-13 · Cinco prendas inferiores nuevas

- Ropero: bermuda, pantalón deportivo, leggings, falda hasta la rodilla y cargo, además de las tres prendas anteriores. Selector compacto «Prenda de abajo» y botón «Quitar prenda». Conserva animación, fase, pausa y cámara, mantiene calzones y permite cambiar sexo/contextura.
- Identidades independientes `ropero:bermuda`, `ropero:deportivo`, `ropero:leggings`, `ropero:cargo` añadidas al catálogo WARDROBE/withGarment. Falda usa `falda:rodilla`. Colores iniciales beige, gris, negro, ciruela y oliva; reutilizan patrones y recursos existentes, sin tocar public/models.
- Bermuda hasta cerca de la rodilla, con flexión máxima específica de 1,2 radianes para evitar contacto pantorrilla/ruedo. Deportivo con holgura gradual y puños/cintura oscuros; leggings con holgura de 0,009; cargo con 0,04 y dos bolsillos laterales con tapa (48 triángulos adicionales). Los bolsillos se adaptan a la superficie y pesos del pantalón, conservan su propietario al fusionar y salen junto a la prenda al extraerla.
- La cintura permanece a la altura del interior. Los parámetros aprobados de pantalón y pantaloneta no se modifican. Deportivo, leggings y cargo reutilizan el ajuste de tobillo del pantalón largo. No se añade simulación de tela a estos pantalones.
- Prueba reproducible `/scripts/validar-prendas-inferiores.html`, todas las prendas o sólo la seleccionada: 10 variantes clásicas × 25 fases × Idle/Walk/Run/Jump/SitDown. Bermuda, deportivo, leggings y cargo: 1.250 poses cada uno, sin cruces detectados entre ropa y piel/articulaciones/calzones visibles; geometría finita, interior adherido y extracción correcta. Cargo comprueba además sus cuatro piezas de bolsillo/tapa. Pantalón y pantaloneta anteriores: 1.250 poses cada uno sin cruces. Tolerancia 0,00001; es muestreo discreto, no garantía para cualquier pose.
- LIMITACIÓN: falda hasta la rodilla conserva contacto aproximado de falda; 1.250 poses verificadas, 8.362 pares de triángulos cruzados acumulados. Sigue pendiente resolver las penetraciones de faldas en movimiento; no se declara esta prenda calibrada sin cruces.
- Comparación visual: `/scripts/vista-prendas-inferiores.html`. Resultados agregados en `cinco-prendas-resultados-finales.json` en outputs de la tarea. Build correcto. Respaldo previo `respaldo-antes-cinco-prendas.tar.gz`.

## 2026-10-13 · Tenis bajos independientes en el Ropero

- Selector «Calzado»: Descalzo / Tenis bajos, con «Quitar calzado». Independiente de la prenda inferior; conserva contextura, sexo, movimiento, fase, pausa y cámara. El estado inicial sigue descalzo con calzones.
- `calzado:'tenis-bajos'` crea `calzado:tenis-bajos` en el slot shoes, extraíble como par. `tenis3d.js` construye el calzado sobre el pie ya adaptado: puntera biselada, suela clara en dos bandas, cuerpo azul, borde oscuro y tres cordones claros por pie. 184 triángulos por par, sin texturas ni llamadas de dibujo adicionales; se incorpora a la misma malla con piel. No se modifican los recursos Blender ni public/models.
- Suela y parte inferior sujetas al hueso del pie; borde superior al de la pantorrilla, para acompañar el tobillo. Los cordones toman posiciones y pesos de la superficie del empeine. La piel se divide a la altura del borde antes de construir ropa/interior; sólo se ocultan caras cubiertas y se conserva el cuerpo completo en partSource. Quitar el calzado recupera los pies completos.
- El Ropero con tenis reutiliza el límite de tobillo del pantalón largo (0,55 radianes). Sin tenis se mantienen los parámetros anteriores. La falda conserva su correctivo existente, con limitaciones conocidas.
- Validación `/scripts/validar-tenis.html`: 11.250 poses (9 combinaciones inferiores contando sólo calzones, 5 contexturas, 2 sexos, 5 movimientos, 25 fases). Sin errores de carga, vértices no finitos ni pérdida de adhesión de calzones; par extraíble completo. En 8.750 poses con calzones, pantaloneta, pantalón, bermuda, deportivo, leggings y cargo: cero cruces detectados de tenis contra piel/interior/prenda inferior visibles. Distancia de control de la suela: desviación máxima 0,000001114 unidades del modelo. Es muestreo discreto, no garantía continua.
- LIMITACIÓN: las 2.500 poses con faldas detectan 15 pares de triángulos cruzados con falda corta y 4.540 con falda hasta la rodilla. Son acumulaciones de muestras, no defectos únicos. Los problemas de contacto de faldas al levantar las piernas siguen pendientes; no se declaran esas combinaciones libres de cruces.
- Compilación de producción correcta. Respaldo previo `respaldo-antes-tenis.tar.gz`; resultados `tenis-contacto-final.json` y capturas de la misma carrera con/sin calzado en outputs de la tarea.

## 2026-10-13 · Camiseta básica independiente en el Ropero

- Selector «Prenda de arriba»: Sin camiseta / Camiseta básica, con «Quitar camiseta». Independiente del pantalón/falda y del calzado; conserva sexo, contextura, animación, fase, pausa y cámara. El estado inicial sigue sólo con calzones y descalzo.
- Pieza extraíble `prenda:Casual_Male:Shirt:top`, utilizable en hombre y mujer. En el Ropero (`cinturaInterior:true`), `camiseta3d.js` adapta su patrón a la superficie y pesos del cuerpo: manga corta, cuello abierto y terminaciones discretas de color en cuello, mangas y cintura. La cintura coincide con la referencia del interior y del pantalón; no se arrastra con el muslo.
- Piel y camiseta comparten cortes; la holgura del torso se aplica después de formar la contextura. Cuello/mangas se apoyan sobre la superficie para no cruzar las zonas vecinas. Se conservan piel completa y pieza de ropa en partSource, ocultando sólo las caras cubiertas al dibujar. La camiseta no recibe el correctivo anterior de ropa sentada ni añade simulación de tela.
- La camiseta activa una holgura adicional en el contacto de brazos: 0,065 unidades del modelo, 0,09 para robusto y 0,13 para gordo; se amplía 0,018 el volumen del tronco. No cambia las animaciones compartidas ni los parámetros de las combinaciones sin camiseta. El patrón anterior fuera del Ropero permanece disponible.
- La camiseta tiene 660 triángulos en delgado/normal/atlético y 1.530 en robusto/gordo, que usan una piel más subdividida. Se integra en la misma malla y material; no se añaden texturas ni llamadas de dibujo. No se modifican los modelos de public/models ni los recursos Blender.
- Validación reproducible `/scripts/validar-camiseta.html`: camiseta contra superficies visibles de piel/articulaciones/calzones, prendas inferiores y tenis. Comprueba geometría finita, interior adherido, extracción de ropa y calzado, bolsillos del cargo y rigidez de la suela. Usa celdas espaciales y comprueba en el primer cuadro de cada combinación que no se omita ningún par de AABB solapadas. Muestreo discreto con tolerancia 0,00001; no es una garantía continua.
- Resultado: 11.250 poses en 90 combinaciones, sin fallos de las comprobaciones estructurales. En 8.750 poses con calzones y seis tipos de pantalón: cero cruces detectados de camiseta. Las 2.500 poses con faldas acumulan 207 pares cruzados con falda hasta la rodilla y 311 con falda corta; esas combinaciones necesitan ajuste y no se declaran libres de penetraciones. Son pares acumulados de muestras, no defectos únicos.
- Compilación de producción correcta. Respaldo previo `respaldo-antes-camiseta.tar.gz`; resultados `camiseta-contacto-final.json` y comparación visual con/sin camiseta en outputs de la tarea.

## 2026-10-13 · Camiseta de manga larga en el Ropero

- Nueva opción «Camiseta de manga larga» en Prenda de arriba. Mantiene la básica y permite quitar ambas, sin cambiar la parte inferior, los tenis, el movimiento ni la pausa. El estado inicial sigue sólo con calzones.
- Identificador independiente `ropero:camiseta-manga-larga` en el catálogo y en `extractPart`. Reutiliza el patrón adaptado de `camiseta3d.js`, extendido hasta 0,025 unidades antes del hueso de la mano, con puños discretos y cinco cortes locales alrededor de cada codo. El resto del cuerpo no se subdivide por estos cortes.
- La manga comparte la superficie y los pesos de piel; se oculta la piel cubierta al dibujar, conservando la geometría completa para separación. Se ocultan los rellenos de piel de los codos mientras se lleva manga larga. Al quitarla, se recuperan. El patrón nuevo también se construye cuando se selecciona desde el catálogo fuera del Ropero.
- Corrección de metadatos compartidos al clonar geometrías: cada articulación conserva su nombre propio (antes las cuatro podían terminar con el nombre de la última rodilla), y cada prenda mantiene sus datos separados del patrón del catálogo. No se modifican modelos Blender ni archivos de public/models.
- Prueba reproducible `/scripts/validar-manga-larga.html`: cinco contexturas, hombre/mujer, Idle/Walk/Run/Jump/SitDown y 25 fases, con todas las prendas inferiores. Incluye extracción independiente, geometría finita, interior pegado, suelas rígidas, contactos contra otras piezas y autointersecciones de la camiseta. Los solapamientos geométricos no equivalen a defectos únicos visibles; no se declara simulación continua de tela ni contacto perfecto.
- Build de producción correcto. Copia previa `respaldo-antes-manga-larga.tar.gz`; comparación de manga corta/larga en la misma fase de carrera y capturas del Ropero en outputs de la tarea.
- Resultado: 11.250 poses, 90 combinaciones, sin fallos estructurales. En 8.750 poses con interior y seis tipos de pantalón: cero cruces detectados de camiseta contra otras piezas. Con falda hasta la rodilla: 122; con falda corta: 245 pares cruzados acumulados. La prueba de autointersección registra 702.595 pares acumulados en pliegues de la propia camiseta; no está resuelta la autocolisión de tela. No son defectos únicos ni una medición de visibilidad.
- Geometría de manga larga: 1.400 triángulos en delgado/normal/atlético y 2.274 en robusto/gordo. Resultados completos en `manga-larga-contacto-final.json`.

## 2026-10-13 · Pecho más redondo en la contextura gorda

- Corregida la transición superior pecho/barriga de `shapeBody`: la influencia de hombro cercana al tronco participa del volumen gordo. El efecto empieza encima de la cintura (Hips + 0,28), crece hasta Hips + 0,50 y se apaga hacia el brazo entre x 0,34 y 0,44. No se reasignan pesos ni se cambian animaciones.
- La curva superior conserva más volumen al acercarse al pecho. La anchura de las secciones altas del perfil se limita para evitar que las medidas contaminadas por los brazos compriman el torso. Sólo afecta a gordo; las otras cuatro contexturas permanecen iguales.
- La ropa usa la misma transformación del cuerpo. La camiseta básica sobre gordo aumenta la separación adicional del contacto de brazo de 0,13 a 0,20 unidades para acomodar el pecho nuevo. Manga larga conserva su ajuste anterior.
- No se añaden polígonos, texturas ni llamadas de dibujo; no se modifican modelos Blender. La geometría inferior hasta la cintura se compara exactamente con la versión anterior, incluida ropa interior adherida.
- Respaldo previo `respaldo-antes-torso-redondo.tar.gz`. La copia de trabajo de camiseta sin mangas se conserva aparte en `work/sin-mangas-pendiente`; no se publica en este cambio.
- Validación estructural: 30 combinaciones (cinco contexturas, dos sexos, tres opciones de camiseta), 1.950 muestras de animación; 222.969 vértices inferiores comparados exactamente. Las 24 combinaciones de otras contexturas son idénticas en posición; cero fallos y cero triángulos añadidos.
- Contactos: 4.500 poses del cuerpo gordo entre ambas camisetas y nueve opciones inferiores. En 3.500 poses con calzones/seis pantalones, cero cruces de camiseta contra otras piezas. Las 1.000 poses con faldas siguen pendientes: básica acumula 789 pares con falda rodilla y 687 con corta; manga larga 189 y 245. Se conservan autointersecciones de la propia tela, registradas aparte por la prueba de manga larga. No se afirma contacto perfecto ni simulación continua.
- Build correcto. Capturas comparativas frontal/perfil y JSON de validación guardados en outputs de la tarea. Sólo se aplican persona3d.js e IDEAS.md; las herramientas comparativas y la copia anterior quedan en la copia de trabajo.


## 2026-10-13 · Ajuste de flexión de la camiseta de manga larga

- `camiseta3d.js` concentra la flexión de los vértices casi enteramente asociados al brazo (peso conjunto de Shoulder/UpperArm/LowerArm >= 0,95). Conserva los otros pesos, el cuello y los vértices distales más allá de codo + 0,12. Piel y tela comparten el patrón; al quitar la camiseta se reconstruye el cuerpo base. La camiseta básica y el cuerpo sin camiseta mantienen su ajuste anterior.
- Tres cortes en cada codo (-0,12 / 0 / +0,12) sustituyen los cinco anteriores. Se quitan 192 triángulos de la prenda: 1.400 → 1.208 en delgado/normal/atlético y 2.274 → 2.082 en robusto/gordo. No se añaden texturas, materiales ni llamadas de dibujo; no se modifican modelos Blender.
- Margen adicional del contacto de brazo sólo para manga larga: 0,105 en delgado/normal/atlético, 0,13 en robusto y gordo. La mano de la contextura gorda con manga larga suma 0,04 al radio de contacto para impedir que roce la tela al pasar cerca del torso. La camiseta básica conserva sus valores anteriores. El solucionador global de brazos no cambia.
- Los ensayos de camiseta sin mangas siguen en la copia de trabajo: la sisa aún tiene cruces con piel y no se añade al catálogo del juego. También se descartaron cambios más amplios del control del hombro que forzaban la postura de los brazos.
- Copia previa: `respaldo-antes-ajuste-camisetas.tar.gz`. Comparación en la misma fase de animación: `camiseta-comparacion-carrera.png`. Sólo se aplican camiseta3d.js, persona3d.js y esta documentación.
- Validación final: 11.250 poses únicas (90 combinaciones, cinco movimientos, 25 fases). Se repitieron las 2.250 de gordo después del ajuste exclusivo de mano. Cero fallos estructurales y cero cruces externos en 8.750 poses con calzones y seis tipos de pantalón. Falda corta: 245; falda hasta rodilla: 189 pares acumulados. Autointersecciones de la tela: 511291 pares acumulados; siguen pendientes. Son cruces de triángulos en un muestreo discreto, no defectos únicos ni garantía de simulación continua.
- Regresión estructural: 30 combinaciones, 1.950 poses, 222.969 vértices inferiores comparados con posiciones y pesos idénticos. El cuerpo sin camiseta permanece idéntico en diez casos; interior adherido y prendas separables. Resultados en `camisetas-contactos-final.json`, `camisetas-gordo-contactos-final.json` y `camisetas-estructura-final.json`. Build correcto.


## 2026-10-13 · Camiseta sin mangas y camisa con botones en el Ropero
- Dos opciones independientes: `ropero:camiseta-sin-mangas` y `ropero:camisa-botones`. Se pueden poner/quitar sin cambiar pantalón, calzado, contextura, movimiento o pausa. Mantienen la camiseta básica y la manga larga.
- Sin mangas: patrón de sisa con corte por influencia de brazo 0,20 y ribete desde 0,08. Reutiliza la transición de pesos de brazo ya calibrada para manga larga; conserva cuello y zona distal. 512 triángulos en delgado/normal/atlético y 1.406 en robusto/gordo.
- Contacto de sisa: muestras adicionales del brazo alto con radio progresivo; anclaje lateral del brazo según contextura (delgado 0,075; normal 0,10; atlético 0,20; robusto 0,18; gordo 0,40 unidades del modelo). Evita compensar sólo levantando los brazos. Se restaura la posición original antes de cada actualización y al deshabilitar contacto; no hay acumulación al pausar o repetir una pose. Sólo lo activa la prenda sin mangas.
- Camisa de manga corta: cuello doblado de dos puntas, tira frontal y tres botones hexagonales, construidos sobre la superficie ya adaptada. `camisaDetalles3d.js` añade 38 triángulos a la base: 698 / 1.568 según el grupo de contexturas. Todos los detalles comparten el identificador de la camisa y se extraen juntos. En robusto/gordo desplaza el anclaje 0,06 / 0,18 para una postura menos rígida. No agrega texturas, materiales ni llamadas de dibujo; no modifica recursos Blender.
- Se descartó un ensayo de proyección de vértices en la axila porque arrugaba la tela. La versión aplicada usa el esqueleto y el volumen de contacto ligero, sin correctivo de vértices por cuadro.
- Sin mangas: 11.250 poses, 90 combinaciones (cinco contexturas, dos sexos, nueve opciones inferiores, cinco movimientos y 25 fases). Cero fallos estructurales y cero cruces externos en las 8.750 poses con interior/seis tipos de pantalón. Falda corta: 245; falda hasta rodilla: 189 pares cruzados acumulados. Autointersecciones de tela: 27102; siguen pendientes. Resultados `sin-mangas-contactos-final.json`. Son muestras discretas y pares acumulados, no defectos únicos ni garantía continua.
- Camisa con botones: 11.250 poses, 90 combinaciones (cinco contexturas, dos sexos, nueve opciones inferiores, cinco movimientos y 25 fases). Cero fallos estructurales y cero cruces externos en las 8.750 poses con interior/seis tipos de pantalón. Falda corta: 301; falda hasta rodilla: 191 pares cruzados acumulados. Autointersecciones de tela: 473401; siguen pendientes. Resultados `camisa-botones-contactos-final.json`. Son muestras discretas y pares acumulados, no defectos únicos ni garantía continua.
- Regresión: 50 combinaciones, 3250 poses, 230533 vértices inferiores con posiciones/pesos idénticos a su patrón anterior de referencia. Las 30 opciones existentes (sin camiseta, básica y manga larga) conservan su geometría. Interior adherido, prendas extraíbles y posiciones de huesos estables tras tres actualizaciones repetidas. `tops-nuevos-estructura-final.json`. Build correcto.
- Copias previas: `respaldo-antes-sin-mangas-y-camisa.tar.gz` y `respaldo-brazos-sin-mangas.tar.gz`. Capturas `nuevas-prendas-ropero.png` y `nuevas-prendas-gordo-carrera.png`. Pruebas reproducibles: scripts/validar-sin-mangas.html y scripts/validar-camisa-botones.html.


### 2026-10-13 · Chaqueta ligera abierta en Ropero

- Nueva prenda `ropero:chaqueta-abierta`, independiente en `outer`. Selector y botón para quitarla sin cambiar camiseta, pantalón ni zapatos. Azul grisáceo, mangas largas, ribetes de abertura, cuello, cintura y puños; sin capucha.
- Reutiliza el patrón articulado de manga larga. Primero estabiliza la pelvis una sola vez, prepara cortes de ambas capas y finalmente copia los pesos/tesselación definitivos a la chaqueta. Holgura de hasta .038 adicional, reducida en cuello y extremos para no levantarlos sobre piel/manos.
- La camisa bajo la chaqueta conserva geometría completa en `partSource`/`extractPart`; sólo se omiten sus triángulos completamente cubiertos del render. No añade material ni malla de dibujo. Se restaura al quitar chaqueta.
- Validación estructural: 50 combinaciones (5 contexturas × 2 sexos × sin camiseta/4 camisetas), 3250 poses de Idle, Walk, Run, Jump y SitDown. Interior adherido, extracción independiente, geometría finita y sin acumulación de desplazamiento de hombros.
- Contactos: prueba geométrica en 1250 poses de chaqueta + camisa + calzones, con tenis. Delgado/normal/atlético sin cruces externos detectados; robusto 6 pares acumulados en salto y gordo 240 en carrera/salto. Persisten pliegues/autointersecciones internas: esto no es simulación de tela ni una garantía de cero cruces en todas las combinaciones.
- Recursos Blender y prendas inferiores no regenerados. Copias previas en los entregables de la sesión; comprobaciones reproducibles en `scripts/validar-chaqueta.html` y `scripts/validar-chaqueta-estructura.html`.
- La prueba adicional con pantalón largo repite 1250 poses: no añadió contactos con el pantalón. Build de producción correcto.


### 2026-10-13 · Afinar contactos de la chaqueta

- Separación adicional localizada en el frente abierto (.060 en el borde, desvanecida hacia x=.30), conservando el ajuste del bajo. El cuello recibe .006 de separación gradual para evitar el cruce con la piel en salto.
- No cambian pesos, animaciones, mallas base, número de polígonos ni márgenes del corrector de brazos. El aumento general del margen de brazos y el borde aplanado se probaron y descartaron.
- Comprobación: 2500 poses, 5 contexturas × 2 sexos × 2 prendas inferiores (calzones/pantalón), camisa de botones y tenis, Idle/Walk/Run/Jump/SitDown con 25 fases. Cero cruces externos detectados, frente a 246 acumulados por cada combinación inferior anterior. Interior adherido, partes extraíbles, suelas y geometría finita correctos.
- Persisten autointersecciones/pliegues internos de la chaqueta; no se afirma ausencia total de colisiones ni se extrapola la medición a todas las prendas del catálogo. La prueba usa tolerancia 1e-5 y no equivale a simulación continua de tela.
- Copia anterior: respaldo-antes-afinar-chaqueta.tar.gz. Comparación visual en los entregables de la sesión.


### 2026-10-13 · Sudadera básica sin capucha

- Nueva `ropero:sudadera`, separable en slot `top`, disponible en Ropero junto a camisetas y camisa. Conserva la selección independiente de chaqueta, prendas inferiores y calzado.
- Reutiliza manga larga calibrada y pesos de la piel. Puños y cinturilla más anchos (.085), con una franja de costura interna (.065); cuello rematado. Un poco más de holgura (.016), reducida a .010 debajo de la chaqueta para evitar cruces entre capas.
- 1364 triángulos en delgado/normal/atlético y 2362 en robusto/gordo para la sudadera sola; colores por vértice, mismo material y una única malla final. No añade texturas ni materiales.
- Validación: 3750 poses (5 contexturas × 2 sexos × 5 animaciones × 25 fases × 3 combinaciones: sudadera/calzones, sudadera/pantalón y sudadera/chaqueta/calzones), con tenis. Sin cruces externos detectados en esas muestras. Interior adherido, prendas extraíbles, suelas rígidas y geometría finita verificados.
- Persisten pliegues/autointersecciones internos de las prendas. Esta medición discreta no garantiza ausencia total de colisiones ni cubre todas las faldas/prendas del catálogo.
- Pruebas reproducibles: `scripts/validar-sudadera.html` y `scripts/validar-sudadera-chaqueta.html`. Copia previa en `respaldo-antes-sudadera.tar.gz`, en los entregables de la sesión. Recursos Blender no regenerados.


### 2026-10-13 · Sudadera con capucha bajada

- Nueva `ropero:sudadera-capucha`, independiente en slot `top`. Comparte el patrón, puños y cinturilla de la sudadera sin capucha. Añade capucha bajada con borde doblado y cordones cortos apoyados en el pecho.
- `capucha3d.js` adapta los detalles a la superficie y pesos de la prenda. Si hay chaqueta, la capucha se apoya encima de ella, manteniendo su identidad de sudadera para `extractPart`. Los cordones conservan el ajuste de la capa interior.
- Sólo 66 triángulos adicionales (50 capucha, 16 cordones), sin material ni textura adicionales. Total de sudadera sola: 1430 triángulos en delgado/normal/atlético; 2428 en robusto/gordo. Recursos Blender no regenerados.
- Validación: 3750 poses (5 contexturas × 2 sexos × 5 animaciones × 25 fases × 3 combinaciones: calzones, pantalón y chaqueta/calzones), con tenis. Cero cruces externos detectados en estas muestras. Interior adherido, extracción de prendas, suelas rígidas y geometría finita verificados; build correcto.
- Persisten autointersecciones/pliegues internos de las prendas. La medición discreta no es una simulación de tela ni garantiza todas las combinaciones del catálogo.
- Pruebas: `scripts/validar-capucha.html` y `scripts/validar-capucha-chaqueta.html`. Copia previa: `respaldo-antes-capucha.tar.gz`; comparación visual y resultados JSON en los entregables de la sesión.


### 2026-10-13 · Chaleco abierto independiente

- Nueva prenda `ropero:chaleco-abierto` en slot `outer`, combinable con prendas de arriba. Ropero muestra «Prenda exterior» y permite quitarla sin tocar camiseta, pantalón ni calzado. Color tierra, cuello en V y ribetes en cintura, abertura y sisas.
- Reutiliza el patrón articulado compartido con piel. Sisa más abierta bajo axila y más cerrada sobre hombro; separación de hombros específica cuando se equipa chaleco. La capa interior conserva su geometría completa para extracción.
- La capucha se apoya sobre la sudadera con separación adicional al usar chaleco, evitando depender de una superficie inexistente en sus sisas.
- Validación: 5000 poses (5 contexturas × 2 sexos × 5 animaciones × 25 fases × 4 conjuntos: camisa/calzones, capucha/calzones, camiseta básica/pantalón y chaleco solo/calzones), todos con tenis. Cero cruces externos detectados en estas muestras, con geometría finita, extracción independiente, interior adherido y suelas rígidas verificados. Persisten autointersecciones de tela; no es simulación continua ni prueba de todo el catálogo.
- Compilación de producción correcta. Sin nuevos materiales ni texturas, conserva una malla de dibujo. Recursos Blender no regenerados.
- Prueba reproducible: `scripts/validar-chaleco.html`, con selector de prenda interior. Copia previa: `respaldo-antes-chaleco.tar.gz`. Comparación visual y resultados en los entregables de la sesión.


### 2026-10-13 · Hombros del chaleco y poses habituales

- Reparada la continuidad del chaleco sobre ambos hombros con bandas conformadas a la superficie exterior, ribetes y pesos interpolados. Añade 384 triángulos; conserva una malla, material e identidad separable del chaleco. No altera los paneles previamente calibrados ni la geometría del cuerpo. Módulo: `src/lib/chalecoHombros3d.js`.
- El cuerpo clásico carga siete acciones adicionales generadas en Blender: Phone, Walk_Phone, Eat_Sitting, Typing, Arrest, Cuffed y Walk_Cuffed. Exportación reproducible con `scripts/blender/animaciones_clasico.py` y `scripts/exportar-acciones-clasico.mjs`; asset `AccionesClasico.json`, sin duplicar cuerpos.
- Ropero permite sentado fijo, sentarse, levantarse, teléfono, caminar con teléfono, comer/trabajar sentado, recoger, cargar, esposar/esposado y apuntar, además de los movimientos básicos. Las acciones puntuales terminan y mantienen su última pose. No incluye todavía objetos de mano ni muebles.
- Validación ampliada: 4420 muestras = 5 contexturas × 2 sexos × 17 animaciones × 13 fases × 2 conjuntos (camisa/chaleco y capucha/chaleco, con calzones y tenis). Geometría finita, extracción, interior adherido y rigidez de suelas verificados; build correcto. Inspección visual frontal, espalda y perfil en teléfono y trabajo sentado.
- Resultado limitado: 9 de 10 combinaciones cuerpo/sexo sin cruces externos detectados en ambos conjuntos. Atlético masculino conserva contactos con la cabeza al caminar con teléfono (14 pares triángulo/fase con camisa; 18 con capucha). Persisten autointersecciones de tela; por tanto la prueba global NO pasa libre de cruces y no se garantiza todo el catálogo ni movimiento continuo. Los contadores son pares detectados, no personajes ni fotogramas defectuosos.
- Respaldo previo: `respaldo-antes-hombros-chaleco.tar.gz` y `respaldo-antes-poses-clasico.tar.gz`. JSON y capturas en entregables de esta sesión.


### 2026-10-13 · Tirantes más rectos (revisión estética)

- A petición del usuario se sustituye la apertura lateral de los tirantes por un recorrido frontal más vertical, permitiendo que solapen el cuello de la camisa. Ribete menos contrastado y menor relieve en la corona del hombro. Conserva 384 triángulos y la extracción independiente.
- Respaldo: `respaldo-antes-tirantes-rectos.tar.gz`. Build correcto. Comparación visual en ropero y prueba discreta de 2210 muestras con camisa, cinco contexturas, ambos sexos y 17 animaciones.
- REGRESIÓN CONOCIDA: la silueta nueva incrementa las intersecciones externas frente a la variante anterior. No está recalibrada para todas las poses; hay contactos con mangas/hombros y cabeza. Resultado global fallido, con detalle en `tirantes-rectos-contactos.json` de los entregables. No reutilizar el resultado de 4420 muestras anterior como validación de esta variante.


### 2026-10-13 · Continuidad del pecho del chaleco

- Corregido el recorte de sisa que retiraba tela del pecho y dejaba huecos y puntas entre los paneles y los tirantes. La compensación se limita al pecho y desaparece hacia la corona del hombro para conservar los tirantes rectos.
- Los tirantes toman como referencia piel/camisa, sin volver a proyectarse sobre los pliegues del propio chaleco. Prenda independiente conservada.
- Inspección frontal normal/gordo y poses de teléfono y trabajo sentado; compilación correcta. Prueba con camisa: 2210 muestras (5 contexturas × 2 sexos × 17 acciones × 13 fases). Sigue fallando el criterio global de colisiones: delgado sin cruces externos en estas muestras; demás cuerpos con contactos. Algunos mejoran respecto a la revisión anterior, gordo empeora. No presentar esta corrección estética como solución de colisiones.
- Respaldo previo `respaldo-antes-pecho-chaleco.tar.gz`; resultados detallados `chaleco-pecho-contactos.json` y comparación visual en entregables de la sesión.


### 2026-10-13 · Optimización conservadora y calibración reutilizable

- Respaldo previo del código en `respaldo-antes-optimizacion-ropero.tar.gz`; respaldo adicional del asset de acciones en `respaldo-antes-optimizar-animaciones.tar.gz`.
- `optimizarRopa3d.js` simplifica subdivisiones redundantes dentro de cada prenda, preservando contorno, color, pesos y productos peso × posición/morph. Tolerancia 0.000001. Piel, calzón adherido y falda dinámica protegidos. La fuente completa `partSource` queda intacta para extraer y cambiar prendas.
- La malla visible comparte índices de vértices idénticos por pieza. En 190 conjuntos: 2.614.446 → 541.728 referencias únicas (79,28 % menos). Es potencial de reutilización del trabajo de vértices en GPU, no reducción equivalente de memoria ni aumento medido de FPS; conserva buffers/rangos por compatibilidad y añade un índice.
- Triángulos acumulados: 871.482 → 869.878 (0,184 % menos). La reducción es pequeña porque se conservaron los vértices que definen la forma y la deformación. Con camisa/chaleco/pantalón normal masculino: 6971 → 6938 triángulos, 20913 → 4659 referencias únicas. Costo mediano de preparación: 23,25 ms, una vez al montar; no por fotograma.
- Caché de consultas exactas en `skinSurface`, local a cada superficie y limitada a 16384 entradas; resultados mutables aislados. Prueba de equivalencia contra la búsqueda sin caché.
- Acciones adicionales: 421809 → 416907 bytes, 4501 → 4450 claves, error medido de interpolación cero. Exportador aplica la misma limpieza; script de comprobación `scripts/optimizar-animaciones.mjs`.
- Catálogo y poses unificados en `roperoCatalogo.js`; familias de contacto reutilizables en `calibracionRopa3d.js`, contrastadas con los valores anteriores en 105 combinaciones válidas. Guía `docs/ROPA-3D.md`.
- Validación: 190 combinaciones (19 conjuntos × 5 contexturas × 2 sexos), 17 animaciones × 5 fases = 16150 muestras. Error máximo de superficie 0,000000986 unidades; diferencia cero en vértices conservados. Fuente extraíble y perfiles de contacto iguales. 24 LOD correctos, pruebas de regresión de geometría/caché/índices y build correctos. Comparaciones visuales frontal, carrera y sentado.
- Prueba reproducible `/scripts/validar-optimizacion.html`; referencia sin simplificar con `optimizarRopa:false`. Esta validación comprueba equivalencia, no ausencia de contactos existentes. Persisten los cruces del chaleco documentados en las revisiones anteriores; no se dan por resueltos ni se garantiza una prenda futura sin pasar sus pruebas.

### 2026-10-13 · Polo, camisa larga y chaqueta cerrada

- Primer bloque del orden propuesto: polo de manga corta, camisa de manga larga y chaqueta con cremallera, independientes en Ropero. Reutilizan torso/mangas, cuello/botones y calibración existentes. Sin nuevos materiales/texturas ni regeneración Blender.
- Calibración compartida: puños separados de la mano flexionada, máscara de codos por familia, separación de hombros largos y contacto con la cabeza. Inclinación de cabeza limitada a 0,30 radianes y extensión de cuello que compensa la barbilla, conservando la mirada sentada. Posición/rotación restauradas antes de cada actualización; sin acumulación en las pruebas.
- Chaqueta cerrada oculta la prenda interior al dibujar y la conserva completa para extraerla/restaurarla al quitar chaqueta. Capucha fuera y cordones debajo mediante rangos separados.
- Validación final: 17680 muestras, 80 combinaciones, cinco contexturas, ambos sexos, 17 acciones y 13 fases. Cero cruces externos detectados en ocho conjuntos con interior/pantalón largo y chaqueta sola/con camisa/con capucha. No cubre autointersecciones por defecto, todas las faldas ni movimiento continuo.
- 30 montajes comprueban extracción de cada pieza, camisa oculta conservada, material único y contacto dentro de cabeza. Pruebas de optimización y build correctos. Capturas frontal, carrera, teléfono y sentado de perfil.
- Regresión: otras 17680 muestras frente al código original. Cruces externos acumulados antes → después: básica 5943 → 598; manga larga 9017 → 0; sin mangas 7105 → 82; camisa 6736 → 0; sudadera 8386 → 0; capucha 8417 → 0; chaqueta abierta 6785 → 0; chaleco abierto 29191 → 23790. Son pares triángulo/fase, no fotogramas defectuosos. Persisten los fallos indicados.
- La geometría aprobada del chaleco se conserva. Ensayos de hombro/pecho y chaleco cerrado descartados por arrugas/cruces pendientes. Próximos: chaleco cerrado, vestido corto, abrigo corto, botas y zapatos formales.
- Copia: `respaldo-antes-continuar-prendas.tar.gz`. Pruebas en `scripts/validar-nuevas-prendas.mjs`, `scripts/validar-regresion-prendas.mjs` y `scripts/vista-prendas-nuevas.html`; guía en `docs/ROPA-3D.md`. Informes y capturas en los entregables de la sesión.

## 2026-10-13 · Vestier: la ropa es el cuerpo vestido

- Nueva ruta `/vestier` (pantalla completa, enlace «Vestier» junto a «Ropero»): el personaje en un cerrito al centro, el físico a la izquierda (sexo, contextura, piel, peinado, color de pelo, barba) y la ropa a la derecha por pestañas (Arriba, Encima, Abajo, Calzado, Interior) con paleta y color libre. Abajo, movimientos y cámara (cuerpo, torso, cara, pies, girar). «Aleatorio» y «Desvestir». En pantallas angostas los paneles pasan a una hoja inferior con pestañas Físico/Ropa.
- `src/lib/vestier3d.js`: la ropa NO va encima de la piel. Cada triángulo de la piel pasa a ser de la prenda de más afuera que lo cubre, inflado por la normal suave según la holgura de esa prenda; donde cambian las holguras (ruedo, puño, canto del chaleco) un escalón cierra la rendija y hace de borde. No hay piel debajo de la ropa ni capas superpuestas: no hay cruces piel/ropa ni ropa/ropa por construcción. Hereda pesos, contextura y animaciones del cuerpo.
- Los bordes son planos fijos en la pose de atado (cuello —una superficie que sube hacia los hombros—, cintura, mangas, ruedos) que parten los triángulos; antes se pegan al plano los vértices a menos de 2 cm (sólo donde el plano corta la superficie de costado). Detalles pintados por franjas: botonadura, cremallera, cuellos, puños, bolsillos, suela. Un «planchado» suave (sólo a lo largo de la normal) quita a la ropa las facetas de la piel.
- Cambiar de ropa no rearma el personaje: rehace sólo su malla (≈ 50–100 ms) y vuelve a medir el contacto de los brazos con el tronco vestido.
- Medido (`node scripts/validar-vestier.mjs`, sin pelo): 230 combinaciones (5 contexturas × 2 sexos × 23 conjuntos), sin valores no finitos ni pesos sin normalizar. Triángulos: mediana 4.410, máximo 6.810. Camisa + chaleco + pantalón, normal hombre: 4.979 frente a 6.938 del ropero (−28 %). Build correcto.
- Pendiente: el ruedo de arriba en gordo/robusto sale irregular bajo la panza (la piel pulida tiene esa zona casi horizontal y un plano la corta en una línea quebrada; hace falta un ruedo curvo que pase por debajo). Ninguna prenda de arriba baja de la entrepierna (≈ .97): faldas, capuchas, cuellos levantados y abrigos largos necesitan piezas sueltas. El ropero viejo (`/ropero`) y sus validadores no se tocaron.
- (seguimiento, mismo día) Ruedos de arriba subidos sobre el pliegue entrepierna-panza (camiseta 1.09, larga 1.07, chaqueta 1.06): ese pliegue es casi horizontal en la línea media (y 1.0–1.05) y un plano ahí salía en zigzag, sobre todo en el gordo. Lo que mueve el muslo es del pantalón a cualquier altura (cadera del gordo).
- Piezas sueltas: falda corta y falda a la rodilla (pretina y entrepierna como cuerpo vestido, con color de forro; la falda es un tubo de 14 gajos medido sobre el cuerpo formado, con forro: la espalda la lleva la cadera y el frente los muslos, así sentada no cuelga ni sale para atrás) y sudadera con capucha (capucha bajada en U detrás del cuello, de dos caras, y cordones pintados). Validación: 260 combinaciones sin fallos; mediana 4.412 triángulos, máximo 6.522. Pendiente: el pelo largo atraviesa la capucha (el pelo no sabe de la ropa).
- (seguimiento 2) Vestido (en «Arriba»: tirantes, escote adelante y atrás, cinta en la cintura; la falda es el mismo tubo) y abrigo largo (en «Encima»: cuerpo vestido hasta la cadera y el tubo de la falda por fuera de todo, abierto adelante). Los tubos nacen un poco por dentro de la superficie de su prenda y por encima de su borde: así no queda rendija entre la pretina o el abrigo y la falda. Con capucha, el pelo que cae por la espalda se mete adentro (se omiten sus triángulos bajo la nuca). Validación: 280 combinaciones sin fallos; mediana 4.486 triángulos, máximo 6.522. Build correcto.
- (pelo, 2026-10-13) Peinados «capa» en el vestier (`HAIRSTYLES_LAYER` en vestier3d.js, referencia: la lámina de 8 estilos de hombre que pasó Miguel): rapado, corto clásico, raya al lado, quiff, undercut, despeinado, rizado y moño. El pelo es la cabeza vestida (línea del pelo: frente 2.96, costados 2.64 con patillas, nuca 2.44), con volumen continuo hacia la coronilla (`swell`) y, donde hace falta, piezas de pocas caras pegadas a la cabeza (flequillo, copete, mechones, rulos, moño). 212–1.112 triángulos de pelo frente a ~1.200 de los del paquete. Hojas comparativas en `capturas/pelo-capa-v1…v6.png`; similitud estimada a ojo con la lámina: rapado y moño ≈ 75 %, rizado ≈ 70 %, despeinado ≈ 65 %, clásico y raya ≈ 60 %, undercut ≈ 55 %, quiff ≈ 45 % (el copete todavía se lee como un bloque encima).
- (pelo con IA, 2026-10-13) Llave de fal.ai en `temp/game/.env` (`FAL`; sin permiso de facturación: el gasto se ve en el panel de fal). Prueba con el quiff: Meshy 7.1 (una vista de 3/4, remallado a 1.500; `lowpoly` no existe en Meshy 7), Trellis 2 (una vista) y Hunyuan 3D v3.1 Pro (las 4 vistas de la lámina: frente, 3/4 izquierdo, atrás, arriba; mínimo 40.000 caras). `src/lib/pelosIA.js` hornea el pelo: separa por color de la textura (k-medias de 2 colores fuera de los rasgos negros), orienta por los ojos, escala por el ancho de cejas y ojos (las orejas son color piel y engañaban), centra en los rasgos, simplifica a ~900 triángulos y guarda el sombreado relativo para recolorear. JSON en `public/models/pelos-ia/`. Peinados «Quiff · IA Meshy» y «Quiff · IA Hunyuan» en el vestier, sobre una capa fina del color del pelo.
- Medición (superposición de la silueta del pelo con la lámina, render sin luz, 4 vistas, cámara a 2.0): capa a mano 65,6 %, IA Meshy 70,1 %, IA Hunyuan 69,9 % (Hunyuan es el que más se parece a ojo: copete en puntas). La cifra tiene un techo: en la lámina la sombra del mentón se cuenta como pelo (anillo rojo en las hojas `capturas/quiff-ia-vs-capa-*.png`). Pendiente: Hunyuan baja demasiado por la nuca (casco).
- (cuerpo con IA, 2026-10-13) Prueba con el hombre desnudo y calvo: renders del cuerpo actual en pose T (`capturas/cuerpo-ia/actual-*`), rediseño en imagen con Nano Banana Pro (`nb-h-v1`: salió en pose A; `nb-h-v2`: pose T, 4 vistas coherentes, sin bultos en rodillas/codos) y 3D con Hunyuan v3.1 Pro desde esas 4 vistas (`public/models/pelos-ia/cuerpo-h-hunyuan.glb`, 40.000 caras, sin esqueleto). Las vistas que genera son del lado DERECHO (right_front / right en Hunyuan). Falta: simplificar, ajustar cada parte a los huesos del esqueleto, pasar los pesos de la piel actual y probarlo con contexturas y animaciones.
- (cuerpo D, 2026-10-13) Miguel eligió la dirección D (juguete de vinilo). Hojas de 4 vistas en pose T: `capturas/cuerpo-ia/D-h-vistas.png` y `D-m-vistas.png` (la primera mujer salió igual al hombre; se repitió con sus figuras de referencia). 3D con Hunyuan: `public/models/pelos-ia/cuerpo-D-{h,m}.glb`. Medido: D tiene cabeza ≈ 44 % de la altura (nuestro esqueleto 35 %), tronco 16 % (33 %), entrepierna a 41 % (32 %) y brazos 30 % más cortos. Todo lo de ropa y pelo en capa está medido sobre nuestras proporciones (cortes en la pose de atado), así que montarlo tal cual exige rehacer esas medidas relativas a los huesos. Variante con nuestras proporciones: `D-h-proporciones-nuestras.png` (decisión pendiente de Miguel).
- (cuerpo IA a/b, 2026-10-13) Imagen con facetas marcadas con Nano Banana 2 ($0,08; `capturas/cuerpo-ia/facetas-h.png`, proporciones nuestras), Hunyuan 4 vistas (`cuerpo-F-h.glb`, 40.000 caras) y bajadas a ~2.000: simplificación propia, Tripo Remesh (2.150) y Hunyuan Smart Topology bajo (2.228); a ese tamaño se ven parecidas. `src/lib/cuerpoIA.js`: puntos clave en pose T, alineación por tramos al esqueleto, (a) `newSkin` (malla generada + pesos de nuestra piel por cercanía) y (b) `shrinkSkin` (nuestra piel encogida sobre la generada); la cara se proyecta (a) o sigue a la piel (b). En el vestier: «Cuerpo (prueba IA)». Comparación `capturas/cuerpo-ia/comparacion-a-b-1.png`: las dos animan. (a) da la cabeza y orejas más limpias, pero hay que aplanar los ojos en relieve que modeló Hunyuan, cerrar 70 aristas sueltas de Smart Topology y afinar la pretina del calzón; (b) conserva nuestra topología y el tronco sale arrugado: mejora poco.
- (16 pelos IA, 2026-10-13) Las dos láminas de Miguel (8 hombre, 8 mujer) en `public/models/pelos-ia/laminas/`; recortes automáticos de las 4 vistas por cabeza (`lote-ref/`), 16 generaciones de Hunyuan con las 4 vistas (`lote/*.glb`, 4 se rehicieron por recortes con cabezas vecinas) y horneado a 600–1.200 triángulos (`[hm][1-8].json`). Separación pelo/piel en `pelosIA.js`: crecimiento de regiones sobre la malla (pelo desde la coronilla —y la nuca alta en los recogidos, `backSeed`—; piel desde la mejilla y los rasgos), la frontera cae donde el color salta. Medición `src/lib/medirSilueta.js` (`sheet()` desde la consola). Superposición media: hombre 59,3 %, mujer 64,3 %; mejores: coleta 75,5, trenza 73,8, rizado H 73,7, ondulado M 72,4; peores: largo liso 47,8 (un mechón suelto lejos de la cabeza), moño H 52,9 (pedazos sueltos), moño M 53,7. Hojas `capturas/pelos-{hombre,mujer}-ia.png`. En el vestier: «Hombre · …» y «Mujer · …» en Peinado.
- (pelo HQ y tallado, 2026-10-13) Imagen por corte con Nano Banana 2 sobre NUESTRA cabeza calva (`capturas/pelos-hq/`): sale nítida y fiel; el 3D de Hunyuan con ella mejora quiff 61,5 → 64,7 % y largo liso 47,8 → 57,6 %, pero el detalle se sigue perdiendo en el paso a 3D (Hunyuan redondea) y al simplificar. Prueba de tallado por siluetas (`src/lib/talladoPelo.js`, visual hull de 4 vistas + Marching Cubes): quiff 57 %, peor que Hunyuan; el largo liso salió casi vacío. Las vistas generadas no tienen cámara conocida ni escala consistente entre sí, así que alinearlas a mano deja el pelo corrido (flotando sobre la cabeza). Sirve sólo con vistas de cámara conocida.
- (comparativa IA, 2026-10-14) Guía y resultados en `docs/PELO-IA.md`. Imagen: Nano Banana 2 (quiff 68 %) y Seedream (largo 67 %) los más fieles; Flux descartado. Vistas: los modelos de imagen no respetan perfiles; Qwen Multiple Angles sí (ángulos exactos, misma escala). 3D: Meshy 63,1 %, Hunyuan 3.1 / ReconViaGen ~60 %, Hunyuan 2 59,6 %, Trellis 44,9 %, Tripo girado y de 1,9 M caras. El modelo 3D ya no es el cuello de botella: lo es nuestro horneado. Hunyuan 3.1 cuesta ≈ $0,68 por generación con multivista y `face_count` (no $0,015).
- (pulido a ojo, 2026-10-14) Se dejan de lado los modelos de fal: los peinados «ia:» y el «Cuerpo (prueba IA)» salen del menú del vestier (el código y los JSON quedan). Hoja de contacto para revisar a ojo: `src/lib/hojaVestier.js` (`contact(rows, views)` desde la consola, `bind:true` para la pose de atado; capturas en `capturas/vestier-pulido/`). Arreglos:
  - Ruedos en escalera en gordo/robusto: la panza baja y el costado de la cadera los mueve más el muslo que el tronco, y la prenda de arriba sólo tomaba los de los costados; ahora toma todo triángulo del muslo con algo de tronco (> 4 %) sobre el ruedo. Sentado el regazo sigue siendo del pantalón.
  - Púas bajo la panza: la tela no se infla hacia abajo (la componente vertical de la normal, si apunta abajo, se reduce al 30 %): cuelga de costado.
  - Franjas del ruedo (sudadera, chaqueta con cremallera), botonadura y cremallera pintan también los triángulos del muslo; la cremallera pasa a .025 de ancho (más angosta que el pegado de vértices de 2 cm se partía en dientes).
  - Sisa: corte `atArmhole` (|x| .34, que se abre hacia afuera bajo la axila y 1.72 para no rebanar los flancos del gordo) en sin mangas, chaleco y vestido; antes terminaban donde la piel dejaba de ser tronco, en dientes. Sin mangas lleva tirantes (escote adelante y atrás entre |x| .18).
  - Validación: 280 combinaciones sin fallos; mediana 4.504 triángulos, máximo 6.450. Build correcto. 
  - (seguimiento) Púas bajo el ruedo y dientes que quedaban: dos cortes a menos de 2 cm (ruedo 1.07 y elástico del bóxer 1.06, cintura 1.13) se robaban los vértices al pegarlos al plano y el primero quedaba en dientes. Ahora un vértice que ya quedó sobre un corte no se mueve con los siguientes. Los cortes del bóxer no se hacen si hay pantalón, falda o vestido (está tapado entero), y la chaqueta baja a 1.07 como la sudadera: así no quedan tiras de 1 cm.
  - Falda, abrigo y capucha a manchas: el forro estaba en el mismo lugar que la cara de afuera y con el material de dos caras peleaban en la profundidad. El forro va 8 mm por dentro.
  - Pelo con capucha: además de la espalda, se recoge el pelo de los costados (a más de ~57° del frente, donde va el rollo); y los mechones de triángulos largos que quedaban colgando se suben hasta el borde de la capucha (y 2.02). Los mechones que enmarcan la cara quedan.
  - Validación: 280 combinaciones sin fallos; mediana 4.508, máximo 6.700 triángulos (invierno en robusto; antes 6.450). Build correcto. Capturas `capturas/vestier-pulido/ruedos-fijos.png`, `revision-4.png`, `pelo-capucha-3.png`, `invierno.png`.
- (ropa con la IA de imagen como director de arte, 2026-10-14) Se dejan los modelos imagen→3D. Nano Banana 2 recibe una captura del muñeco vestido y devuelve la misma escena con «la ropa mejor hecha» (mismo personaje, colores, pose y cámara); la comparación se pasa a código a mano. `capturas/ropa-ia/` (antes-*, ia-*-1/2, comp-*: antes · ahora · sugerencia). 6 imágenes, ≈ US$0,48. Lo que coincidió en todas: bordes con grosor, botamanga, chaleco cerrado en V, bolsillo canguro, suela marcada, cuello de camisa con puntas.
  - Bandas con grosor (`rim`, `hemBand`, `legBand` en vestier3d.js): puños y ruedo de camisetas, puños de camisa/polo/chaquetas/abrigo, pretina y puños de sudaderas, botamanga del jean (revés más claro), doblez de la bermuda, bolsillos del cargo y bolsillo canguro con relieve. La franja va un poco más afuera y el escalón de su borde hace de doblez. Falda con tablas (gajos alternados de tono).
  - Chaleco cerrado en V bajo el pecho (`vestV`), ribete en el escote y el ruedo y tres botones. Cortes locales (`plane(..., where)`): parten sólo la zona del botón y no pegan vértices; sin eso cada botón daba la vuelta al cuerpo (+1.000 triángulos).
  - Cortes iguales de prendas distintas se unen (`sameCut`, por texto de la función); la franja del ruedo de la camiseta llega a la cintura del pantalón (1.13) en lugar de quedar a 0,5 cm de ella.
  - Costo: «calle» normal/h 4.388 → 5.060 triángulos (los escalones de las bandas); mediana 4.486 → 4.644, máximo 7.760 (oficina, gordo). Sin relieve en el cuello de la camiseta ni en las suelas (casi no se ven). 280 combinaciones sin fallos; build correcto.
  - (ronda 2) Puntas del cuello de la camisa (`collarPoints`): dos solapas de dos caras que bajan del escote hacia el centro, apoyadas sobre la camisa inflada con la posición, normal y pesos del vértice de piel más cercano (sentado acompañan al pecho). Capucha 30 % más grande, más baja en las puntas para que no queden como hombreras. Faldas con más vuelo en el ruedo (corta .07 → .11, rodilla .10 → .13). La suela de los tenis ya se lee (franja blanca): no se tocó. 280 combinaciones sin fallos, mediana 4.644, máximo 7.764; build correcto. `capturas/ropa-ia/ronda2.png`.
  - (ronda 3: abrigo, vestido, chaquetas, deportivo, botas; 8 imágenes ≈ US$0,64) Solapas en la chaqueta abierta y el abrigo (`lapels`: un triángulo doblado hacia afuera sobre el borde de la abertura, de dos caras, con pesos del pecho). Puños y cuellos ya no salen negros en colores oscuros: `shade` oscurece relativo a la luminosidad. Dobladillo en faldas, vestido y faldón del abrigo (`skirtTube({lip})`: un anillo más, 3,5 cm sobre el ruedo, que sale 2 cm). Cuello alzado en la chaqueta con cremallera y canto en la suela de las botas. Sugerencias no hechas: botones en el abrigo, cinturón y pinzas, bolsillos de parche en la chaqueta. 280 combinaciones sin fallos; mediana 4.644, máximo 7.764; build correcto. `capturas/ropa-ia/comp-d…g.png`, `ronda3.png`.
  - (ronda 4: polo, sin mangas, manga larga, pantaloneta, leggings, zapatos; 6 imágenes ≈ US$0,48 — total de las rondas ≈ US$1,60) Parches en el frente con cortes locales (`patch`): botones del abrigo (lado izquierdo, junto a la abertura), dos botones en la tapeta del polo, bolsillos de parche en la chaqueta abierta, hebilla. Cinturón en el pantalón de tela (`belt`): con él, la camisa y el polo van metidos (`tuck`: el ruedo pasa a la cintura). Ribete en la sisa y los tirantes de la sin mangas; cuello acanalado con relieve en la manga larga. Sin hacer: franja lateral de la pantaloneta (la costura lateral cambia según el cuerpo). 280 combinaciones sin fallos; mediana 4.708, máximo 7.966; build correcto. `capturas/ropa-ia/detalles.png`, `comp-f,h,i,j.png`.
- (cuellos, 2026-10-14) El escote del robusto/gordo salía roto. Dos causas: (1) unos triángulos del hombro junto al cuello los mueve el brazo y el corte del cuello sólo partía tronco y cabeza (ahora también brazo, y la cobertura del brazo respeta el escote); (2) el borde era un plano que subía hacia los hombros con pendiente .7, casi la del trapecio de esos cuerpos: corría paralelo a la piel y salía en zigzag. Ahora `neckF` es la altura del cuello adelante y atrás, y un anillo de radio .21 alrededor del cuello a los costados (mezcla por el ángulo; sobre la base del cuello vuelve a la altura para no rebanar la mandíbula). `hojaVestier.js`: `hoja()` exportada, `noHead` (la cabeza encogida) y `clipY` para mirar el escote. 280 combinaciones sin fallos; mediana 4.714, máximo 7.898; build correcto. `capturas/vestier-pulido/cuellos-1.png` (antes, de cerca), `cuellos-nuevo.png`, `cuellos-con-cabeza.png`.
- (tirantes y hombros, 2026-10-14) En el vestido y la sin mangas el tirante salía mordido arriba del hombro: el anillo nuevo del cuello (`neckF`) cortaba el tirante. Las prendas con tirantes ya no llevan corte de cuello (`neck:Infinity`): el borde de adentro del tirante es el escote. Se probó también el anillo en la espalda: abría la espalda entera; descartado. Revisado en sentado/corriendo/teléfono/cargar sin bordes rotos. 280 combinaciones sin fallos; mediana 4.710, máximo 7.898; build correcto. `capturas/vestier-pulido/mangas-antes.png`, `mangas-2.png`, `mangas-movimiento.png`.
- (faldas sentadas, 2026-10-14) Revisión de bordes de abajo (botamangas, bermuda, pantaloneta, botas, zapatos, de pie): limpios. Sentadas, las faldas, el vestido y el faldón del abrigo salían rotos: el frente (que llevan los muslos) quedaba como un estante horizontal más allá de las rodillas y los costados (que lleva la cadera) colgaban como cortinas. Ahora el tubo de la falda trae deltas para el morph «Sentado» (el mismo que ya sube solo cuando los muslos van adelante): lo de los muslos pierde el 60 % del vuelo y no pasa de y .5; lo de la cadera sube hasta el asiento (entrepierna + .02). De pie no cambia nada. Los pesos de la falda alrededor de la cintura pasan a una mezcla suave por el ángulo (`SKIRT_W`). 280 combinaciones sin fallos; build correcto. `capturas/vestier-pulido/faldas-sentadas.png` (antes) y `faldas-sentadas-5.png`.
- (prioridades, 2026-10-14) 1) peinados: Miguel prefiere los del paquete. Los «capa:» quedan fuera del menú (código intacto; el ensayo de quiff nuevo se revirtió). El menú tenía nombres cambiados y repetidos: se fotografiaron los 19 del paquete (`capturas/vestier-pulido/peinados-0…3.png`) y quedan 10 distintos con su nombre (Corto, Despeinado con mechón, Ondulado, Cresta, Media melena, Melena de lado, Melena despeinada, Cola con flequillo, Cola con mechón largo, Cola peinada atrás). 2) pelo del paquete con la ropa: revisado (`pelo-ropa.png`), sin cruces que tapar más allá de la capucha. 3) ropa nueva: ranuras «Cabeza» (`hat`) y «Cuello» (`accessory`). Bufanda (`scarf`): rollo cerrado medido sobre el cuello vestido, holgado para pasar sobre abrigos, y una punta con flecos que se apoya en lo más adelante del pecho a cada altura. Gorro de lana: la cabeza vestida sobre `beanieF` (sobre las cejas, a la nuca), con domo (`swell`), doblez y pompón; el pelo que queda adentro se omite (`hideHairAbove`) y asoma el de abajo. 300 combinaciones sin fallos; build correcto. `bufanda-2.png`, `gorro-3.png`.
- (gorros, 2026-10-14) Pedido de Miguel: con gorro el pelo no debe dejar franjas calvas; se corta en el borde. Las prendas de cabeza declaran `hairCut(p)` (> 0 adentro): los triángulos del pelo que cruzan el borde se parten ahí (`splitBy`) y queda la parte de afuera, pegada al doblez; lo de adentro se omite. Gorra nueva (`capF`, más alta que el gorro de lana; visera `visor`: medio óvalo de dos caras con canto, inclinado, que sale de la frente; botón arriba). 310 combinaciones sin fallos; build correcto. `capturas/vestier-pulido/gorro-4.png`, `gorra-3.png`.
- (versión de lejos, 2026-10-14) `makeDressable` devuelve `lods(ratios)` y `showLod(k)`: el personaje YA vestido simplificado (`lowGeo` de persona3d) a 35 % y 15 %, como las plantillas de `characters3d.js` (la misma malla con otra geometría: comparte esqueleto, animación y el morph «Sentado»). La cara (ojos, cejas) se separa y no se simplifica: a 13 % se perdía un ojo. Medido: calle normal 6.272 → 2.400 / 1.209; oficina gordo 9.098 → 3.391 / 1.637; ~50 ms por personaje, una vez. Al cambiar de ropa se liberan las anteriores. En el vestier, botones Cerca/Media/Lejos para mirarlo. Lejos, las puntas de la capucha y las manos quedan facetadas (a esa distancia no se nota). PENDIENTE: el juego (DemoView, characters3d) todavía arma la gente con el ropero viejo, no con el vestier; para usarlo hay que pasar las plantillas a `makeDressable`. `capturas/vestier-pulido/lod.png`, `lod-2.png`.
- (rellenos fuera, 2026-10-14) Pedido de Miguel: los rellenos de codos y rodillas (esferas chicas en la articulación, persona3d.js) se veían como círculos en la piel desnuda de la rodilla y, en la versión de lejos, asomaban por el brazo simplificado. El vestier ya no los usa (`ranges.filter(r=>!r.joint)`); las versiones de lejos los sacan también por si vienen marcados (`jointTris`). Revisado doblado (teléfono, correr, sentado): sin pellizcos que se noten. 310 combinaciones sin fallos; mediana 4.326 (antes 4.692), máximo 7.578. `capturas/vestier-pulido/codos-cerca.png` (antes), `sin-rellenos.png`, `codos.png`.
- (la gente con el vestier, 2026-10-14) `characters3d.js`: las plantillas de la gente de la demo se arman con `makeDressable` (VESTIER=true; false vuelve al armado anterior). Del look salen cuerpo, piel, pelo y barba; la ropa la elige `outfitFor` (formal para Suit/OldClassy/Doctor; mujeres con faldas y vestido; abrigos ~28 %, bufanda 12 %, gorra o gorro 15 %; colores de PALETTE arriba y neutros abajo). Las versiones de lejos son las del vestier (35 % / 15 %, cara entera). 32 plantillas en ~5 s al cargar. Probado en node (caminar/correr) y en la demo: carga sin errores; foto de un grupo en `capturas/vestier-pulido/gente.png`. La policía sigue con su uniforme del armado anterior. Respaldo del archivo anterior en el scratchpad de la sesión.
- (rendimiento de la gente, 2026-10-14) `src/lib/rendimiento.js` → `bench({ns,frames,vestier,lod})` desde la consola del vestier: N personas caminando en una grilla que se aleja (cerca/media/lejos), 90 cuadros, GPU sincronizada con readPixels. `loadCharacters({vestier})` arma con el vestier o con el armado anterior (caché por opción). Mac (WebKit WebGL, lienzo 2048×1536), resultados en `capturas/vestier-pulido/rendimiento.json`:
  - vestier + LOD: 10 → 1,9 ms (539 fps) · 30 → 3,9 ms · 60 → 7,0 ms · 100 → 12,0 ms (83 fps; p95 14,4); 282 k triángulos a 100.
  - vestier sin LOD: 100 → 11,7 ms, 655 k triángulos. Anterior + LOD: 100 → 12,1 ms, 284 k. Carga de plantillas: vestier 3,9 s, anterior 5,9 s.
  - Lectura: en esta máquina cada persona cuesta ~0,12 ms por cuadro, ~55 % animación (mezclador, pies, contacto de brazos: CPU) y ~45 % dibujo (una llamada por persona). Los triángulos casi no pesan: el LOD corta 57 % de triángulos a 100 personas y el tiempo no cambia. El vestier rinde igual o un poco mejor que el armado anterior y carga 34 % más rápido. Presupuesto de 60 fps (16,7 ms) ≈ 130 personas sólo en gente, sin ciudad. NO medido: un teléfono o una GPU integrada débil, donde los triángulos sí suelen pesar (ahí el LOD sí ayudaría).
  - Lo que bajaría el costo de verdad: animar a los lejanos cada 2–3 cuadros (la mitad del tiempo es animación) y no dibujar a los que están fuera de cámara (hoy frustumCulled=false).
- (rendimiento: mejoras, 2026-10-14) `characters3d.js makeCharacter`: (1) se descarta lo que está fuera de cámara con una esfera fija y holgada en el espacio del muñeco (antes frustumCulled=false); (2) la animación se espacia: cerca cada cuadro, media cada 2, lejos cada 3 y fuera de cámara (no dibujado en 250 ms, `onBeforeRender`) cada 4, acumulando el tiempo y repartiendo el arranque (`ANIM_EVERY=[1,2,3,4]`). `bench({cull,throttle})` compara con antes, mismo lienzo 600×300 (`capturas/vestier-pulido/rendimiento-mejoras.json`): 100 personas de frente 11,1 → 7,6 ms (−32 %; animación 7,0 → 3,9); 100 personas con la cámara mirando a otro lado 10,4 → 3,2 ms (−69 %). En una calle real queda entre las dos. Riesgo aceptado: de lejos el paso se anima a 20–30 Hz; al entrar en cámara la pose se pone al día en el cuadro siguiente.
- (ropa nueva 2, 2026-10-14) Overol (`overol`, slot Abajo, layer 3.5: el pantalón, el peto y los tirantes van encima de lo de arriba; bolsillo del peto con relieve, hebillas, botamanga doblada), delantal (`delantal`, Encima: peto con cinta al cuello y cinta a la cintura; la falda del delantal es sólo el frente del tubo, `skirtTube({only})`) y camiseta a rayas (`rayas`: 6 franjas con cortes sólo en el tronco). `outfitFor`: rayas y overol en el sorteo; Chef y Worker con delantal la mitad de las veces y más overol. Costo (normal, sin pelo): jean +944 triángulos, overol +2.584 (846 de escalones en los bordes del peto y los tirantes), delantal +1.444, rayas como la camiseta. 340 combinaciones sin fallos; build correcto. `capturas/vestier-pulido/nuevas-1.png`, `nuevas-2.png`.
- (tercera persona, 2026-10-14) /demo: el jugador es un muñeco del vestier (una plantilla de la gente, al azar, sin versiones de lejos) y la cámara va detrás (CAM_DIST 4, a la altura de la cabeza + .55), mirando hacia donde apunta el mouse; el muñeco gira de a poco hacia donde camina y anima quieto/caminar/correr. Si una pared queda entre la cámara y el muñeco, la cámara se acerca (muestreo de 20 cm por la línea de mira contra los choques de la ciudad, barrios, casas); bajo techo no sube más de 2,3 m sobre los pies. T (y un botón) alterna con la primera persona; `?vista=primera` arranca en primera. Probado en la calle y dentro de un edificio (el cielorraso se ve: lo resuelve el paso 2, el corte de pisos de arriba).
- (vista desde arriba + corte, 2026-10-14) Pedido de Miguel con una referencia tipo maqueta. /demo arranca en «arriba»: la cámara a 8 m del muñeco mirando abajo en diagonal (−0,95 rad, el mouse la gira y la inclina entre −0,55 y −1,4). Adentro de un edificio se corta todo lo que pase de 2,55 m sobre los pies en un cilindro de 12 m alrededor del jugador (`src/lib/cutaway3d.js`: parche de materiales con onBeforeCompile —posición del mundo después de piel e instancias—, uniformes compartidos, también en el mapa de sombras con un MeshDepthMaterial parcheado y en el paso de contornos). Se aplica a la ciudad, barrios, casas y la gente; la isla (terreno) no. T cambia la vista: arriba → detrás → primera persona; `?vista=tercera|primera`. Probado en una casa de la isla (se ve el interior entero con muebles, como la referencia: `capturas/vestier-pulido/vista-arriba-casa.png`) y en un edificio de la ciudad. Pendiente: el canto de las paredes cortadas queda claro y hueco (una tapa oscura lo leería como la referencia).
- (canto oscuro y ver a través, 2026-10-14) `cutaway3d.js`: los materiales de edificios van de dos caras (sombra de una) y, dentro del cilindro del corte, la cara de atrás —lo que se ve por el corte, el interior de la pared— se pinta oscura (#3a3532): el borde de arriba de cada pared se lee como una franja sólida, como la referencia. Ver a través: lo que queda a menos de 1,5 m de la línea cámara→jugador (antes del 90 % del tramo) se dibuja tramado (se descartan 2 o 3 de cada 4 pixeles según la cercanía a la línea; sin transparencia real, nada que ordenar); la gente no se trama; el paso de contornos tampoco (sus líneas quedan). Con la cámara detrás también se aplica. Probado dentro de una casa (cantos oscuros y una ventana tramada en la pared de adelante del muñeco). En la calle no logré armar a mano una toma con un edificio tapando.
- (corte en la ciudad, 2026-10-14) Probado dentro de edificios de la ciudad, en planta baja y en el piso 3 (ascensor): el corte sigue el piso del jugador (2,55 m sobre los pies). Encontrado: piezas que se arman después de cargar (instancias que aparecen al acercarse) quedaban sin parchear y asomaban enteras por encima del corte (una pared alta en «Centro El Faro»). `patchCut()` vuelve a pasar por la ciudad una vez por segundo (lo ya parcheado se saltea). `window.__demo` expone THREE y la escena para revisar desde la consola.
- (canto en paredes finas, 2026-10-14) Las paredes de una sola cara no tienen interior que pintar oscuro: dentro del cilindro, toda superficie vertical (normal del mundo por derivadas, |n.y| < .35) en los 17 cm de abajo del corte se pinta del color del canto. Las paredes finas de la ciudad muestran su borde oscuro y en las casas el canto queda más grueso, como la referencia. Probado en el piso 3 de un edificio y en una casa de la isla.
- (corte: ajuste de Miguel, 2026-10-14) No le gustó el tramado. Ahora, en la vista desde arriba, el corte está siempre prendido (adentro y en la calle) en un radio de 24 m: sólo se ve el piso del jugador (los edificios de alrededor quedan a la altura de la planta baja, como una maqueta). Las paredes entre la cámara y el muñeco (superficies verticales a menos de 1,3 m de la línea, por encima de sus pies) no se dibujan, tampoco en el paso de contornos; el piso y la gente sí. El mouse: la inclinación se acotaba con un estado viejo (`euler`) que podía pisar el giro que hace el mouse capturado en cada cuadro; ahora se lee de la cámara misma. Probado girando la cámara por código (el giro se mantiene); con el mouse real no se pudo probar desde el navegador interno.
- (corte sólo adentro, 2026-10-14) Miguel: el corte de pisos sólo al entrar a un edificio o casa; afuera todo entero. Para que afuera la cámara no quede metida en un piso de arriba (pegado a una fachada alta), se acerca al muñeco hasta salir del edificio (`insideAny`: dentro de ciudad, barrios o casas, o chocando una pared a esa altura). Las paredes que tapan al muñeco se siguen ocultando adentro y afuera. Comprobado: en la casa el corte se prende; a 18 m de la casa, apagado.
- (sólo el piso del muñeco, 2026-10-14) Captura de Miguel: camas y roperos flotando sobre un local de planta baja. Causa: los muebles de los edificios (`world.updateInteriors`, también barrios, casas armadas y la cáscara de las casas) se eligen por la posición y la ALTURA DE LA CÁMARA; desde arriba la cámara queda dos pisos más alta y cargaba los de otro piso, que además se armaban nuevos (sin el corte hasta el siguiente repaso). Ahora en tercera persona y desde arriba se eligen por el muñeco (`eye` en el bucle de la demo) y el repaso del corte va cada 250 ms. Además, en un piso alto se oculta también lo que queda debajo de su piso (`uCutLow`, 35 cm bajo los pies): por los bordes de la losa se veían los muebles de abajo. Probado en el piso 2 de un edificio de oficinas: sólo su planta, con sus muebles.
- (corte sólo en el edificio del muñeco, 2026-10-14) Miguel: los demás edificios deben quedar enteros. El corte ya no es un círculo: es el rectángulo en planta del edificio donde está el muñeco (`uBoxMin/uBoxMax`). En la ciudad, el lote exacto (`world.lots`, sus casillas); fuera de la ciudad (barrios, casas), se recorre lo techado conectado desde los pies, de a medio metro, sin cruzar paredes (si no, se pasa al edificio pegado por la medianera). Se rehace al cambiar de piso o al salir del rectángulo. Probado: lote 89 (12 × 12 m), el edificio de al lado queda entero.
- (muebles del 2.º piso, 2026-10-14) Captura de Miguel: con el muñeco en planta baja se veían flotando los muebles del piso de arriba. Causa: los muebles de cada piso se arman con COPIAS de los materiales (clone()), que se llevan userData —donde marcaba «ya parcheado»— pero no el onBeforeCompile: quedaban marcados sin el corte. La marca pasó a un WeakSet, y si un shader ya trae el corte no se inyecta dos veces. Comprobado en planta baja de «Torre La Pradera»: sin muebles flotando, el muñeco visible, ningún programa de shader con error (renderer.info.programs). Visto y sin resolver: quedan unas sombras con forma de persona sobre el piso, probablemente de la gente del piso de arriba.
- (calle y vecinos, 2026-10-14) Captura de Miguel: medio cuadro blanco (cielo) donde iba la calle. Dos cosas: (1) el corte de abajo (pisos altos) nunca saca el suelo de la calle (`uGround`: 25 cm sobre el suelo del lugar); (2) como los vecinos ya no se cortan, la cámara de arriba podía quedar metida adentro del edificio de al lado: ahora también adentro se acerca al muñeco si cae en OTRO edificio (mínimo 4,5 m), y lo que queda entre la cámara y el muñeco fuera del edificio propio (también losas) no se dibuja. El edificio de al lado queda entero salvo ese hueco.
- (medianeras, 2026-10-14) Captura de Miguel: desde el local de planta baja se veía el dormitorio del piso de arriba del VECINO, porque el margen del rectángulo de corte (40 cm) se comía la pared del edificio de al lado. Ahora se detecta qué lados del lote tocan otro lote (`shared`) y de esos lados el rectángulo termina justo en el límite: la pared del vecino queda entera y tapa su interior. Además, en esos lados las paredes propias por encima del corte no se sacan y se pintan lisas (`uWall`, sólo en materiales de edificio; muebles y gente igual se cortan). Comprobado en el lote 89 mirando al 90: se ve un muro liso en lugar del cuarto del vecino.
- (vista a lo Sims, 2026-10-14) Tras repasar cómo lo resuelven Los Sims, Project Zomboid, BG3/XCOM y Diablo: (1) la cámara de arriba va en 4 ángulos fijos a 45° (inclinación fija); el mouse acumula giro y pasado un umbral salta al siguiente, con giro suave; Q/E también giran cuando no hay ascensor; (2) paredes del lado de la cámara bajas (muñón de 80 cm con canto oscuro: `uFront`/`uStub`, sólo materiales de edificio) y las del fondo enteras hasta el corte; (3) silueta del muñeco: una copia de su malla con color plano que se dibuja sólo donde algo lo tapa (prueba de profundidad al revés, después de lo opaco); se quitó el agujereado de paredes (ver a través) en esta vista; (4) el corte entra y sale en 0,3 s (baja desde arriba). Casas fuera de la ciudad: el rectángulo incluye el alero (1,4 m). Probado en una casa de la isla (dos ángulos) y en un edificio de la ciudad. Respaldos en el scratchpad de la sesión.
- (arranque lento, 2026-10-14) Consola: ~600 avisos «toNonIndexed: already non-indexed» por carga (persona3d llamaba toNonIndexed sobre icosaedros y cajas redondeadas que ya vienen sin índice; ahora `nonIdx`) y un error del modelo de la manta (`AnimalesMar/Manta.obj` tenía dos líneas `l`: OBJLoader lo devolvía como líneas y el mar quedaba sin mantas; se quitaron, copia en el scratchpad). Tiempos: armar la gente era casi todo el arranque (32 plantillas × ~260 ms; cargar autos, edificios, naturaleza, animales < 1 s en total). Ahora: una plantilla por modelo con el vestier (16), sin la optimización del ropero viejo (la persona va desnuda: `optimizarRopa:false`, ~20 ms menos) y las versiones de lejos se arman después de arrancar, de a una cada 40 ms, en el mismo arreglo que ya usan las personas creadas. Por persona al arrancar: ~170 ms (era ~260). Medido en el navegador: el muñeco listo en 4,5 s (antes 7,8 s); con el panel oculto los tiempos del navegador no son confiables (frena los temporizadores).
- (rendimiento del cuadro, 2026-10-14) Investigación (foros de three.js y docs) + medición en la demo. Lo medido en una vista desde arriba dentro de un edificio: la escena sola 4,8 ms; con la cadena de efectos 15–20 ms. Casi todo era el paso de contornos (`edges3d.js`): volvía a dibujar la escena cambiando el material objeto por objeto, y su material «otra cosa» era transparente (three.js ordena y cambia estado por objeto: 10 ms contra 3 para la misma escena). Ahora dibuja con `overrideMaterial` dos veces —todo como «otra cosa», opaco con alfa 0 escrito en el shader, y encima sólo la capa de paredes (capa 7, puesta una vez por segundo a lo que cuelga de userData.edges)—: el cuadro con contornos pasó de 19,6 a 8,6 ms (sin contornos, 4,4). Además: sombras del sol cada dos cuadros (~350 llamadas y 1,1 M de triángulos cada vez; ganancia chica, ~5 %) y `renderer.compileAsync` al cargar (que los shaders no se compilen la primera vez que algo aparece). Ya medido antes y descartado: partir la ciudad en zonas (más llamadas, más lento, 2026-10-11). Pendientes de la investigación: compartir materiales iguales (683 distintos en escena), animación horneada en texturas (VAT) para multitudes grandes, armar la gente en un worker.
- (materiales compartidos: descartado, 2026-10-14) De 638 materiales en escena, 214 son copias idénticas (101 grupos). Probado en vivo juntándolos (447 cambios): el cuadro pasó de ~5,5 a ~5,35 ms, dentro del ruido; y es riesgoso (la noche cambia materiales sueltos por referencia). No se aplica.
- (cámara libre, 2026-10-14) Pedido de Miguel: la vista de arriba deja de saltar a 4 ángulos. El mouse (capturado o arrastrando) gira a cualquier ángulo y la inclina entre −0,45 y −1,35 rad; Q/E giran 90° con un giro suave (si no hay ascensor); la rueda acerca y aleja entre 4 y 18 m, suave. El muñón de las paredes del frente sigue a la dirección real de la cámara. Alero de las casas: el rectángulo del corte se agranda a 2,2 m (a 18 m de distancia se veían tiras del techo a los costados). Probado simulando cuadros con `__demo.step`.
- (gente en workers, 2026-10-14) `src/lib/gente.worker.js`: viste cada persona (makeDressable + dress + versiones de lejos) fuera del hilo principal y devuelve sólo los arreglos de las geometrías (transferidos). Medido antes: el esqueleto, su pose de reposo y las 23 animaciones son idénticos para los dos sexos, las cinco contexturas y con o sin pelo; así que el hilo principal arma UNA persona base y cada plantilla es una copia de su escena con la geometría del worker (`workerTemplates` en characters3d.js; hasta 3 workers; el contacto de brazos se mide en el hilo principal). En node —pruebas— o si los workers fallan, se arma como antes. Policía: sin la optimización del ropero viejo y con las versiones de lejos diferidas. `__demo.tiempos` da los tiempos de carga y de cada parte de `load()`. Medido (panel visible): todo listo en ~4,5 s; la gente llega a los 2,3 s sin trabar la página; el siguiente cuello es armar la ciudad (`buildWorld`, ~85 % de `load()`, ~1,9 s), después las casas armadas (~7 %) y la isla (~4 %). Con el panel oculto el navegador frena todo y los tiempos se multiplican (una corrida dio 30 s): no son comparables.
- (ciudad más rápida al arrancar, 2026-10-14) Medido por secciones (`WORLD_TIMES` en world3d.js, `__demo.WORLD_TIMES.runs`): de los ~1,5 s de «ciudad», ~1,1–1,6 s eran el PLANO (`generateBlueprint`; en node 2,4 s en frío, 0,35 s caliente: lo caro es amueblar —`flow` en blueprint.js—) y ~340 ms juntar las piezas de los edificios (`buildDowntown`: clonaba y transformaba cada pieza y después las copiaba otra vez al unir). (1) El plano se arma en un worker (`src/engine/plano.worker.js`) mientras bajan los modelos; es datos puros y vuelve copiado (~0,1 s); verificado idéntico al del hilo principal (JSON con arreglos tipados, 5,4 MB). Si el worker falla, o para «Otra ciudad», `load()` lo arma como antes. (2) `bake()` en downtown3d.js escribe cada pieza ya transformada directo al arreglo final (las 142 piezas del paquete son posición/normal/uv indexadas; si alguna no, va por el camino viejo); idéntico bit a bit a clonar+`mergeGeometries` (300 piezas al azar con escala no uniforme y giro). Resultado (panel visible): unir 337 → 112 ms; ciudad 1,5 s → 0,39 s; todo listo ~4,5 s → ~3,6 s. Lo que queda tras los modelos (~1,2 s): ciudad 0,39, isla 0,33 (el terreno: grilla de alturas y triángulos con ruido, cálculo dentro de clausuras: poca ganancia para el riesgo), viviendas 0,29. El camino crítico ahora es la carga de modelos y gente (~2,4 s).
- (primera persona tipo shooter, 2026-10-14) Teclas: T alterna las dos vistas en tercera persona (arriba con las paredes del frente bajas ⇄ detrás del muñeco); F entra y sale de primera persona (vuelve a la última de tercera). En primera (`fps` en DemoView.vue), lo que usan los FPS: FOV propio de 75° que se abre a 83° al correr (suave); balanceo en ocho al caminar (vertical al paso, lateral a medio paso; la amplitud entra y sale con el movimiento); inclinación de 1,5° al moverse de costado; golpe con resorte al caer de un salto; plano cercano a 5 cm; la mira sólo en esta vista. Cuerpo visible («full body awareness»): el muñeco debajo de la cámara, mirando hacia donde se mira, con el hueso Head a escala ~0 (se lleva pelo y gorro) y sin la silueta amarilla; al mirar abajo el cuerpo se corre atrás (si no, se veía el cuello desde arriba): se ven el brazo, la mano y los pies caminando. Sin armas ni brazos aparte (viewmodel con FOV propio, como Source o CoD): el juego no tiene armas; si las tuviera, irían en una segunda pasada con su cámara.
- (brazos y arma en primera persona, 2026-10-14) `src/lib/viewmodel3d.js`: como los «view models» de Source/CoD, una escena aparte con su cámara (FOV 54°; 44° apuntando) que `ViewmodelPass` dibuja encima del mundo después de limpiar la profundidad (después de los contornos y antes del brillo): el arma no atraviesa paredes ni se deforma con el FOV del mundo. Pistola low-poly (corredera con estrías, armazón, empuñadura, guardamonte, miras con puntos amarillos) y dos brazos (manga con puño claro, muñeca y manos de cajas: la derecha en la empuñadura con el índice junto al gatillo, la izquierda envolviendo) con la piel y la manga del look del muñeco. La luz es la del mundo pasada al marco de la cámara (sol y cielo, también de noche); OJO: con metalness alto y sin mapa de entorno el metal sale negro. Movimiento: balanceo en fase con la cámara, retraso al girar el mouse, pose de correr (baja y gira; corriendo no dispara), apuntar con clic derecho (al centro, miras alineadas, el mundo a 60°, sin mira de pantalla), disparo con clic (semiautomática 0,15 s: retroceso con dos resortes, la corredera atrás, fogonazo aditivo de 50 ms y la cámara sube ~0,7°). Los brazos del cuerpo se esconden (huesos Shoulder a escala ~0) porque los reemplazan. El tiro todavía no pega en nada (sin rayo ni impactos).
- (el tiro pega: impactos y sonido, 2026-10-14) `src/lib/disparo3d.js`. DÓNDE PEGA: un rayo de three contra la escena costaba 40–50 ms por tiro (4,6 M de triángulos en mallas juntadas). En vez de eso se DIBUJA la dirección del tiro: una cámara de 0,1° sobre un blanco de 3×3 en punto flotante con un material que escribe la posición en el mundo (con huesos e instancias: pega en lo que se ve, incluidos muebles y autos); la normal sale de los píxeles vecinos; la lectura es asíncrona (`readRenderTargetPixelsAsync`, llega 1–2 cuadros después, como el viaje de la bala). Medido: ~5 ms en el hilo principal por tiro (three igual manda ~580 objetos: las mallas juntadas son tan grandes que su esfera entra en cualquier cono). Coincide con el rayo de three al milímetro (13,782 m en la prueba). Se esconden el cielo, el muñeco, los efectos y lo que no se ve (las cajas de sombra de los edificios —colorWrite false— eran un blanco invisible). Los sombreadores de la sonda se compilan al cargar (`warm`), si no el primer tiro trababa 670 ms. La gente: un cilindro por persona (28 cm × 1,75 m) contra el rayo; si está antes que la superficie, le pegó: marca de impacto en la mira (X blanca 140 ms), polvo del color de su ropa, y sale corriendo. Dispersión: apuntando 0,09°; desde la cadera 0,7° (+0,8° caminando). IMPACTO: agujero (disco oscuro, los últimos 64), polvo (gris tierra en el piso, revoque en paredes) y chispas, en un InstancedMesh con gravedad y arrastre. La pasada de color de verdad quedó descartada: dibujar la escena con sus materiales fuera del composer da INVALID_OPERATION. SONIDO (WebAudio, sintetizado): crujido + cuerpo + golpe grave, eco corto de calle, el impacto con la demora del sonido (343 m/s) y más bajo con la distancia, la vaina que rebota. LA GENTE: `scare(x, z, rad)` en citizens3d.js: a 22 m del tiro salen corriendo (animación de correr, 2,4× la velocidad, 4–8 s) hacia el más lejano de seis destinos.
- (BUG arreglado, 2026-10-14) La pasada principal (RenderPass) tiraba GL_INVALID_OPERATION «Mismatch between texture format and sampler type (shadow)» y los objetos que reciben sombra no se dibujaban. Causa: el sol todavía no tenía mapa de sombras (`sun.shadow.map === null`). Con `shadowMap.autoUpdate=false` el mapa sólo se crea en un cuadro con `needsUpdate`, y eso lo ponía únicamente el bucle (un cuadro de cada dos): el primer cuadro salía sin mapa y `__demo.render()` —que con la pestaña oculta es lo único que dibuja, porque requestAnimationFrame no corre— no lo pedía nunca, así que fallaba en CADA cuadro. Sin mapa, three r186 ata en `directionalShadowMap[0]` su textura de profundidad vacía, pero la ruta de ARREGLOS de samplers (setValueT1Array) no le pone `compareFunction` (la de un sampler suelto sí): queda sin modo de comparación en un sampler2DShadow y cada dibujo que recibe sombra falla y no se pinta. No era el corte (cutaway3d.js) ni el customDepthMaterial. Arreglo: `renderFrame()` en DemoView pide la sombra también cuando falta el mapa y lo usan el bucle y `__demo.render`. Medido (step+render, 60 cuadros por vista): antes 60/60 con error en arriba, detrás (T) y primera persona (F), con la ciudad casi vacía; después 0/60 y la ciudad entera.
- (BUG arreglado, 2026-10-15) Escaleras del núcleo (town3d.js), dos defectos. (1) A veces no había pared al fondo del descanso: se seguía derecho y se caía a la planta baja. El tabique del fondo cae en la misma línea que un borde de fachada (el del patio, donde termina el ala) y los dos se juntaban en un solo tramo; el chequeo «borde de afuera» miraba sólo su punto medio, que caía afuera, y descartaba el tramo entero. Ahora el tramo se parte donde empieza o termina cada parte del edificio. (2) En los núcleos de 4 × 4 con ascensor y los carriles a lo largo de z, la caja del ascensor salía girada (se elegía comparando anchos) y su tabique cruzaba el carril de subida a media escalera, en todos los pisos. Ahora se orienta con la escalera. Medido en la ciudad 94708 (choques simulados con `world.collide`, 1.920 pruebas): fugas por el fondo del descanso de 245 a 0; tabique cruzando el carril B de 230 a 2. Los 2 que quedan son puntos de prueba pegados a la fachada en un carril angosto, no tabiques cruzados.
- (BUG arreglado, 2026-10-15) El muñeco del jugador se veía «hueco», con manchas amarillas encima (la cabeza entera amarilla bajo el pelo). Era la silueta (DemoView `makeAvatar`): la prueba de profundidad al revés (`GreaterDepth`) daba «tapado» también contra el PROPIO muñeco —la piel bajo la ropa del vestier, el casco bajo el pelo, las caras de atrás—. Ahora el muñeco se dibuja después de lo opaco (renderOrder 998) y escribe 1 en el stencil donde se ve; la silueta se pinta sólo donde el stencil no es 1 (el target del composer pasó a `stencilBuffer:true`). Los materiales del muñeco son copias, porque los de la plantilla los comparte la gente de la calle. Probado en /demo (ciudad 83552): sin manchas en la vista de arriba, y con una caja delante la silueta sigue apareciendo sobre lo tapado; sin errores de GL.
- (DECISIÓN de Miguel, 2026-10-15) Se retira la vista desde arriba con los edificios cortados: «da muchas complicaciones». /demo vuelve a ser sólo shooter: detrás del muñeco (tipo Fortnite, la de por defecto) y primera persona (tipo Call of Duty); T y F alternan entre las dos. El corte (`cutaway3d.js`) ya no se crea ni parchea materiales, y en la vista detrás tampoco se borran las paredes entre la cámara y el muñeco (la cámara se acerca al chocar con una pared, como antes). El código de la vista de arriba queda en `thirdPerson` y `cutaway3d.js`, sin uso; respaldo de DemoView antes del cambio en el scratchpad de la sesión. Probado en la ciudad 83552: arranca detrás, adentro de una casa techo y paredes enteros, T/F alternan bien y sin errores de GL. La silueta amarilla del muñeco se mantiene (sólo aparece si algo lo tapa).
- (BUG arreglado, 2026-10-15) Escaleras: «paredes o pisos obstruyendo» (captura de Miguel: subiendo, un techo oscuro a ras de la cabeza y la silueta amarilla en el pelo). El plano estaba bien —en 20 ciudades, núcleo y escalera idénticos en todos los pisos y nada encima—; caminando las 98 escaleras de la ciudad 83552, ningún choque ni salto de altura. Era el 3D: cada peldaño era un bloque macizo desde la losa de su piso, así que el tramo del piso de arriba colgaba como un bloque plano a 1,5 m sobre los pies en el carril A y en el descanso. Ahora (`stairBoxes`, town3d.js), del primer piso para arriba cada peldaño baja sólo 18 cm por debajo de su contrahuella (losa inclinada en escalones) y el descanso es una losa; la planta baja sigue maciza. Y la baranda del último piso sobre la línea del muro del medio termina donde empieza el descanso (pasaba a la altura de la cabeza); el choque de ese borde sigue entero. Cálculo previo: `scripts/validar-nucleos.mjs` (ver GENERADOR.md) — antes 2.046 de 2.046 edificios con la cabeza dentro de la escalera de arriba (20 ciudades); después 0 de 8.017 (80 ciudades, semillas 1–40 y 1000–1039). En /demo, ciudad 83552: 192 rayos hacia arriba desde la cabeza en 16 tramos de 5 edificios, ninguno tapado (con el interior armado a la altura de cada tramo: los peldaños sólo existen cerca de la cámara y en su piso ±1). Respaldo de town3d.js antes del cambio en el scratchpad.
- (BUG arreglado, 2026-10-15) Cámara de tercera persona que pasaba al piso de arriba (captura de Miguel: al pie de la escalera, el muñeco entero amarillo, visto desde otro piso). Causa: la cámara iba a pies + 2,3 m y sólo probaba paredes a la altura de los PIES, nunca losas: subiendo, quedaba por encima de la losa del piso siguiente, atravesaba las paredes de ese piso y pasaba por encima de los vanos (los dinteles no chocaban). Ahora es un «spring arm» como el de Unreal / Fortnite: de la cabeza hacia atrás, de a 15 cm, se para 25 cm antes de lo primero que tocaría —una pared probada a la altura de ese punto, o una losa / un tramo de escalera que cruce o le quede encima o debajo— (`world.slabAt` en world3d.js: losas de cada piso menos el hueco, techo y el volumen de los tramos, `stairOf().solids` en town3d.js). Los dinteles de los vanos (de 2,1 m al techo) ahora chocan; a quien camina no lo tocan (los choques miran pies + 1 m). Medido en /demo, ciudad 83552, 576 posiciones de escalera (4 edificios, todos los tramos, 4 direcciones): rayo de la cabeza a la cámara tapado por algo dibujado, cámara vieja 98, nueva 0. En la calle la cámara sigue a 4 m; en la escalera queda a 0,5–0,8 m de la cabeza (el núcleo es de 2 m). Caminar por las escaleras sigue sin choques (7.266 puntos). Lo que hacen otros juegos y no se hizo: esconder los pisos de arriba (Los Sims, Zomboid: el corte, descartado por Miguel) y desvanecer al muñeco cuando la cámara queda muy cerca (pendiente si molesta).
- (cámara cerca, 2026-10-15, pedido de Miguel) Con la cámara de tercera persona a menos de 1 m de la cabeza (en la escalera queda a 0,5–0,8 m), el muñeco se desvanece, como en los juegos en tercera persona: entero desde 1 m, invisible a 45 cm, con transición suave (`fadeAvatar` en DemoView; sigue escribiendo profundidad para que sólo se mezcle la cara de afuera, y la silueta amarilla se desvanece con él). En primera persona vuelve a opaco. Medido en la ciudad 83552: calle 4,06 m → opaco; escalera 0,82 m → 70 %, 0,66 m → 30 %, 0,51 m → oculto; al volver a la calle, opaco otra vez; sin errores de GL.
- (escaleras anchas, 2026-10-15, decisión de Miguel: «4 m, cómoda») Las escaleras del núcleo pasan de 2 m (tramos de 0,88 m libres: al muñeco de 52 cm le quedaban 18 cm por lado) a 4 m: dos tramos de ~1,9 m, peldaños reales de 16,7 × 28 cm (9 por tramo, 18 por piso de 3 m), umbral de 10 cm y descanso de 1,38 m; cabe en el mismo fondo de núcleo de 4 m y respeta los módulos de 2 m. Plano: `STAIR_W`, `stairWidth`, `STAIR_STEPS/TREAD/FR` en blueprint.js; la ficha `lv.stair` lleva `w` y `steps`, y el vano de la escalera va a lo ancho de los dos tramos. 3D: `stairOf`/`stairBoxes` leen el ancho y los peldaños de la ficha (antes 2 m y 25 cm fijos); también el plano dibujado (drawPlan.js) y el taller /objetos. Lotes de 6 m de frente con una sola fila de cuartos: siguen con 2 m (no queda lugar para cuartos). Medido en 20 ciudades: 2.019 de 2.046 escaleras a 4 m, mismos ascensores (1.292), ningún piso sin cuartos; los cuartos pierden 5,5 % de superficie (1.407.892 → 1.330.048 m²). `validar-nucleos.mjs` en 40 ciudades: 0 fallas (ahora también avisa si un tramo deja menos de 30 cm de margen al cuerpo). En /demo (83552): caminando 23.828 puntos de las escaleras, sin choques ni saltos de altura. Quedan aparte, sin tocar: la escalera de las casas de la isla (island3d.js, recta de 0,95 m) y la de las casas de la familia (vivienda.js).
- (cámara en la escalera, 2026-10-15) Con la escalera ancha la cámara seguía a 0,3–0,7 m: atrás y arriba está el tramo del piso siguiente. Ahora prueba tres caminos —el normal (atrás y arriba), a la altura de la cabeza y un poco por debajo— y se queda con el que llega más lejos; la cámara se prueba con su propio alto (±20 cm, `collide(…, h)` en world3d.js; antes como una persona de 1 m, y el dintel de la puerta de atrás la frenaba aunque pasara por debajo); y adentro de un edificio no sale de él (`world.lotAt`, con 35 cm de margen: se escapaba por la fachada entre el remate de un piso y la losa del siguiente). Medido en 3 edificios × 2 pisos, 192 posiciones y 4 direcciones: 0 con algo entre la cámara y el muñeco; mediana 0,67 m (de costado, la pared del tramo está a ~1 m), el 25 % más lejano a más de 2,35 m; en la calle, 4,1 m.
- (escaleras de las casas, 2026-10-15, pedido de Miguel) Medidas reales también en las casas. **Casas armadas / de la familia** (vivienda.js + hogar.js; son las del monte de la isla en el juego): de 1 m y 14 peldaños de 20 × 25 cm a 1,2 m y 16 peldaños de 17,5 × 28 cm (4,48 m); el hueco de la losa empieza donde quedan 2,1 m libres sobre el peldaño. En una casa corta (6 m de fondo útil: las del configurador de fondo 2, o de fondo 3 con el piso de arriba retirado) el tramo se acorta para dejar 1 m al pie y la huella baja a 22 cm (`stairRun`): la misma inclinación que antes, con peldaños más bajos. El plano de la familia reserva 2,5 × 5,9 m para la escalera y su paso (antes 2,3 × 4,9), así que esas casas salen algo más hondas. `node scripts/validar-escaleras-casa.mjs`: 56 casas de dos pisos (configurador + las 8 de la familia), 0 fallas (huella ≥ 22 cm, ≥ 80 cm al pie, el cuerpo libre por toda la subida). En /demo (83552): las 13 casas armadas de dos pisos, 819 puntos de su escalera, sin choques ni saltos de altura. **Casas de island3d.js** (las fincas sueltas): de 0,95 m y 9 peldaños de 31 cm de alto a 1,2 m y 16 de 17,5 × 28 cm, con el mismo tramo adaptable y el hueco a 2,1 m libres; ⚠ en la configuración actual (`ISLA_GEN.casas:false`) esas casas no aparecen, así que ese cambio no se probó en el juego. Pendiente si molesta: una escalera en L o en U para las casas cortas, en vez de la huella de 22 cm.
- (DIRECCIÓN, 2026-10-15, decisión de Miguel) Antes de más visuales: la ciudad se calcula con medidas prefijadas y se valida con matemática, sin el 3D; el 3D sólo dibujará lo que el plano resolvió. Paso 1 hecho: `src/engine/medidas.js` (el catálogo: grilla, alturas, muros, puertas, ventanas, escalera, pasillo y los MÍNIMOS; con la lista de copias que todavía no leen de ahí —town3d, world3d, vivienda, island3d—), `src/engine/volumenes.js` (cada pared con su grosor real, cortada por sus vanos, piso por piso, como datos) y `scripts/validar-ciudad.mjs`. El plano ya lee la escalera del catálogo. Primera corrida, 20 ciudades (2.046 edificios, 106.178 vanos, 263.814 paredes), 1.649 edificios con algo: **vano metido en la fachada** 5.408 (1.266 edificios: la puerta va a 10 cm de la esquina del cuarto y el plano no sabe que la fachada tiene 25 cm; 1.768 son la puerta de la escalera en los núcleos pegados al borde del lote); **puerta entre cuartos que arranca sobre un tabique** 2.546 (374 edificios: `doorTo` en openings() llama a `near` con el ancho por defecto de 1 m pero la puerta mide 0,8, y queda en el eje del tabique de costado; son las mismas que salen como **puerta angosta**, luz 0,72); **hall de 1 m** 1.658 (0,88 libres; todos los cuartos angostos son halls); **astillas** 360 (trozos de 10 cm que no son jamba). Descartado al revisar: marcos a 4 cm de la cara de la pared (es la regla de 10 cm desde el eje: tocan, no se meten) y las jambas de 10–15 cm.
- (validación de la ciudad: a 0, 2026-10-15) Corregidos en el plano los cuatro hallazgos de `validar-ciudad.mjs`: (1) `near()` en openings() sabe el grosor de la fachada: si una punta del borde es el borde del lote, la puerta se separa MURO.fachada + 10 cm (35 cm) y no 10 cm del eje; lo mismo las puertas de la escalera y del ascensor; (2) la puerta entre cuartos se ubica con su ancho real (antes `near` suponía 1 m y la de 0,8 arrancaba en el eje del tabique de costado); (3) el hall de los departamentos: la primera alcoba pasa al baño en PASILLO.hall = 1,5 m (antes 1: hall de 0,88 libres; ahora 1,38), y con eso desaparecen las puertas de 0,72 de luz, que eran las de las alcobas a ese hall; (4) las «astillas» que quedaban eran cortes artificiales donde empieza un ala de la L (la pared sigue en su línea), no del plano. Resultado: 0 edificios con fallas en 60 ciudades (semillas 1–20 y 1000–1039; 5.992 edificios, 308.784 vanos, 770.341 paredes), antes 1.649 de 2.046. Mismos departamentos y cuartos (11.059 departamentos, 8.880 alcobas: el medio metro del hall sale del reparto de sala y alcobas). `validar-nucleos.mjs` sigue en 0. En /demo (83552) la ciudad arma sin errores; entrando a las escaleras por su vano sólo frena la baranda del último piso (lo esperado), salvo una escalera angosta de 2 m contra la fachada cuyo carril B tiene 0,7 m libres (el muñeco pasa corrido del centro).
- (cadena cuerpo → muebles → cuartos → edificio → lote → mundo, 2026-10-15, idea de Miguel) Las medidas nacen de abajo. **Nivel 1, el cuerpo** (`medidas.js` CUERPO/ERGO, en milímetros enteros): medido en /demo sobre los vértices deformados por el esqueleto: el muñeco del jugador 1.810 de alto; la gente de 1.392 a 1.782, de 522 a 677 de ancho de torso con brazos y hasta 713 de fondo caminando. Cuerpo de diseño: 1.810 × 680 × 720; el juego choca con un círculo de 520 (los brazos asoman ~6 cm). Ergonomía derivada (sólo se elige la holgura, 60): paso 800, de costado 480, altura libre 2.100, uso de frente 720; el radio de la prueba de movimiento del plano (280 = 260 + 20) ahora sale de acá (`RB=mm(ERGO.radioPrueba)`, mismo valor). **Nivel 2, los muebles** (`scripts/medir-muebles.mjs` → `src/engine/muebles-medidos.js`): los modelos que dibuja la ciudad, medidos en node con la misma elección y escala que town3d: 30 de 41 tipos caben en lo que el plano les reserva; la **cómoda** (Drawer_1, 1.453 × 582) no cabe en sus 950 × 650 y el 3D la achica al 65 %; 10 tipos son cajas a la medida (no pueden fallar). **Muebles contra el cuerpo** (validar-ciudad, sección Muebles: desde las puertas, ¿se llega al lugar de uso de cada mueble?, como el flow() del plano): 3 ciudades, 31.248 muebles con lugar de uso. Con el cuerpo del plano (560) fallan 21 (calibración: diferencia de grilla). Con el cuerpo real (680): 1.712 muebles en 224 de 315 edificios, y 15 cuartos donde ni se entra; 1.202 de esos 1.712 son de baños (ducha 550, inodoro 357, lavamanos 295), después sala_cocina (sofá, nevera, mesón) y dormitorios (armario, cómoda, escritorio). Con el paso con holgura (800): 5.173 muebles y 113 cuartos. Es decir: el plano está dimensionado para un cuerpo 12 cm más angosto que el muñeco. Pendiente decidir con qué cuerpo se recalculan los cuartos mínimos (cuartos-minimos.js) y, con eso, los cuartos y los edificios.
- (cuartos con el paso de 800, 2026-10-15, decisión de Miguel) La prueba de movimiento de los cuartos (blueprint RB, minRoom y el amueblado) usa ahora medio paso, 400 mm (`ERGO.radioPrueba=ERGO.paso/2`; antes 280). `scripts/gen-minimos.mjs` rehace el generador perdido de cuartos-minimos.js (con el cuerpo viejo reproducía 13 de 15 programas exactos; los dos baños ya estaban desactualizados: el código daba 2×2 y la tabla 2×2,5) y la reescribió: 13 de 15 programas crecen, casi siempre 25 cm por lado (dormitorio doble 2,75×4 → 3×4,25; principal 3×4,25 → 3,25×4,5; baño 2×2,5 → 2,25×2,25; sala comedor ancho 3,75×3 → 4,5×3). En 10 ciudades, lo que sale: mismos edificios, pisos y departamentos (993 / 4.553 / 5.380: los lotes los da el mundo); dormitorios 4.264 → 3.864 (−9 %) y 16 % más grandes (15,0 → 16,2 m²): los departamentos de 2 alcobas pasan de 1.319 a 901 y los de 1, de 1.388 a 1.797; sala_cocina 25,5 → 26,5 m²; halls 6,6 → 6,3; muebles con lugar de uso −4,3 %. Validación con el paso de 800 (3 ciudades): muebles sin uso 5.173 → 326, cuartos donde no se entra 113 → 102. Lo que queda es sobre todo lo que se SUMA al programa mínimo (el escritorio con computador de la trama en dormitorios de 4×4: con cama, mesas de noche, armario y cómoda, el paso junto a la puerta queda en ~50 cm). Respaldos de medidas.js, cuartos-minimos.js y blueprint.js de antes en el scratchpad.
- (el mínimo cuenta todo lo que se le pone, 2026-10-15, decisión de Miguel) `fullRecipe(k)` en blueprint.js: el mínimo de un programa se mide con el programa MÁS los opcionales que la ciudad le suma (`programExtras`: cómoda, lámpara y el escritorio de la trama —con computador— en los dormitorios; lavadora en la cocina en línea; lámpara y escritorio en la sala), como obligatorios. Sólo para los programas que la ciudad amuebla con extras (PROG_BY); las casas de la familia (hogar.js) usan el programa solo. Mínimos que cambian (7 de 15): dormitorio sencillo hondo 2,25×3,25 → 3,25×3,25; doble ancho 3,75×3 → 4,25×3,25; principal 3,25×4,5 → 3,75×4,25 (ancho 4×3,25 → 4,5×3,25); dos camas ancho 3,5×3,25 → 4,75×3,25; estudiante ancho 3×2,75 → 3,5×2,75; cocina en línea 2,5×2,75 → 2,5×3; sala 2,75×3,5 → 3×3,5. En 10 ciudades: mismos edificios y departamentos; dormitorios 3.864 → 3.803 y de 16,2 a 18,3 m²; departamentos de 3 alcobas 62 → 13 y de 2, 901 → 938; salas aparte 833 → 669 y cocinas aparte 649 → 485 (más sala_cocina: 2.265 → 2.429); halls 6,3 → 7,8 m². Validación con el paso de 800 (3 ciudades): muebles sin uso 326 → 278 (los que quedan: lavamanos 92, estantes de depósito 41, sala_cocina 45), cuartos donde no se entra 102 → 108 (86 dormitorios, 22 habitaciones de hotel). Los dormitorios que quedan tienen su programa y lo superan en tamaño: están en el límite (pasos de ~0,9 m en diagonal) y la prueba del plano (grilla de 15 cm) los acepta y la del validador (10 cm) no: hay DOS pruebas de movimiento; la siguiente tarea es que el validador use la del plano (una sola implementación). Las habitaciones de hotel no salen de la tabla de mínimos (medida fija en suites()). Respaldos en el scratchpad (blueprint.antes-minimo-completo.js, cuartos-minimos.antes-minimo-completo.js).
- (una sola prueba de movimiento y la ciudad en 0, 2026-10-15) La prueba de movimiento salió de furnishRoom a `makeMovement(q,open,box)` + `roomBox(q)` (exportadas; la usan el amueblado, minRoom y el resultado final); la ciudad sale idéntica (hash de cuartos, muebles y vanos de 3 ciudades). Al terminar cada edificio, el plano guarda en cada cuarto `mov` = {puertas, puertasN, uso, usoN, sinUso}, con todos sus muebles finales; validar-ciudad lo lee (se quitó su prueba propia, que con grilla de 10 cm daba otro resultado en los pasos justos). Correcciones: (1) baño de suite de hotel/hospital = el mínimo de la tabla en la grilla de 0,5 (2,5 m, antes 2 fijos; la franja de la entrada crece lo mismo); la «entrada» de la suite se valida como circulación (mínimo de hall); (2) `fill()`: si lo que sobra no llega al mínimo de un cuarto, lo suma el anterior; si no hay anterior, el primer tipo del programa que entra, o un depósito (antes salían celdas de 2 m y locales de 2–3 m); (3) si la distribución elegida no es completa, se prueba sin los opcionales («lo que no se puede usar no se pone»); (4) el BUG que causaba casi todo lo que quedaba: al agregar un mueble a un cuarto ya amueblado (el escritorio de la trama), la prueba no miraba los muebles que ya estaban (`existing`) y tapaba el paso a ellos. Resultado: validar-ciudad 0 de 2.046 (semillas 1–20) y 0 de 3.946 (1000–1039); núcleos y escaleras de casa en 0; los mínimos no cambian. Lo que cambia en la ciudad (10 ciudades): locales 1.183 → 693 y de 33,8 a 43,2 m² (ya no hay locales más chicos que su mínimo), recepciones 630 → 391, baños +288, depósitos +545, oficinas +145, cocinas aparte 485 → 381, salas 669 → 599; habitaciones de hotel 17,3 → 15,2 m² y de hospital 17,4 → 15,3 (el baño creció); cuartos sin muebles 2.627 → 3.088 (los depósitos nuevos). En /demo (83552): carga sin errores y los 3.580 cuartos con prueba están completos.
- (nivel 4–5: el edificio y el lote desde los cuartos, 2026-10-15) `scripts/derivar-edificio.mjs` (con unitPlan —exportada— y la tabla de mínimos). **Fondo**: la franja interior pide el baño completo (2,25) y el hall (1,2 libres) → 2,5 m (hoy 2); la de fachada, lo que piden de fondo alcobas y sala (2,75–3,25) → 3,5 m (hoy 4); la crujía de departamento = 6 m: EXACTAMENTE la casilla. El pasillo, 1,2 libres + tabique → 1,5 m (hoy 2). **Largo** de un departamento (unitPlan): 1 alcoba 8 m, 2 alcobas 12, 3 alcobas 15 (igual con fachada de 3,5 o 4). **Lo que pasa hoy** (10 ciudades): el 49 % de los departamentos son monoambientes (2.620 de 5.380): todos los de 6 m de largo (6×4: 1.747, 6×6: 708) y los de 8×4 (165); ninguno de 8 m o más con fondo de 6. El 9 % de los baños de departamento son medio baño sin ducha. **Conclusión**: la casilla de 6 m alcanza como módulo de FONDO (una crujía justa); como FRENTE no alcanza para un departamento con alcoba (pide 8 m), y menos con el núcleo (escalera de 4 m, con ascensor 6): un lote de una casilla de frente sólo da monoambientes, uno de dos casillas con ascensor deja 6 m (monoambiente) y sin ascensor 8 (1 alcoba). Y un lote de 12 m de fondo no aloja dos crujías (6 + 1,5 + 6 = 13,5): la de atrás queda de 4–4,5 m (monoambiente o 1 alcoba si tiene ≥10 m). Decisión pendiente con Miguel.
- (edificio y lote desde los cuartos, aplicado, 2026-10-15, decisión de Miguel) Casilla de 6 m sin cambios. (1) Lotes de UNA casilla de frente (`frenteDe(L)`: el lado que da a la calle): casa (60 %) o local (tipo nuevo `local`), de un piso y sin núcleo (`noCore` cuando L.floors<2; la fila única de cuartos va de punta a punta y el último no abre a un descanso). Los públicos y los especiales (comisaría, objetivos) se eligen entre lotes de 2+ casillas de frente. (2) Franjas derivadas en `medidas.js`: `FRANJA={interior:2.5,fachada:3.5}` (antes 2 + 4) y `PASILLO.ancho=1.5` (antes 2); `corridorAt(Lv)` es la única fuente de dónde va el pasillo (layoutFloor y la L). Arreglos que trajo: la ventana de la punta del pasillo se centra y mide lo que entra (se pasaba al cuarto de atrás); el resto de 0,5 m de la franja de atrás va al paso de la L y no al núcleo. Validaciones: ciudad 0 de 2.046 y 0 de 3.946; núcleos 0 (1.815 y 3.468 escaleras); casas 0; mínimos sin cambios. Lo que cambia (10 ciudades): edificios con núcleo 993 → 874; casas 133 → 85, locales 0 → 34, viviendas 370 → 409; departamentos 5.380 → 5.748, alcobas 3.724 → 3.859; baños de departamento con ducha o tina 91 % → 100 %; dormitorios 18,3 → 16,2 m² (la franja de fachada bajó a 3,5). Monoambientes 49 % → 50 %: NO venían de los lotes de una casilla sino del reparto de cada franja en departamentos (cortes de 8–12 m al azar; lo que sobra, a menudo 6 m, queda como departamento) y de la franja de atrás de 4,5 m, donde una alcoba pide ≥10 m de largo. Casi todos son 6×4,5 y 6×6 en lotes de 3–4 casillas con ascensor. Pendiente decidir el reparto con los largos derivados (1 alcoba 8 m, 2 alcobas 12, 3 alcobas 15).
- (reparto de las franjas con largos derivados, 2026-10-15, decisión de Miguel) `unitLengths(D,inner)`: los largos que dan 1, 2 y 3 alcobas en una franja de fondo D, desde unitPlan (fondo 6 → 8, 12, 15 m; fondo 8–8,5 → 7, 10,5, 13; fondo 4,5 → 10); cada franja se reparte al azar entre los que entran y lo que sobra se suma al último (antes, cortes de 8–12 al azar y el resto quedaba como monoambiente). Validaciones en 0 (ciudad 20 + 40 ciudades, núcleos, casas). 10 ciudades: alcobas 3.859 → 4.546 (+18 %), departamentos de 3 alcobas 13 → 594, departamentos 5.748 → 5.215 (los restos se sumaron), dormitorios 16,2 → 15,6 m², baños con ducha 100 %. Monoambientes 2.873 → 2.586, todavía 50 %: son FRANJAS ENTERAS más cortas que un departamento con alcoba (6×4,5, 6×6, 8×4,5), sin vecino al que sumarse: 1.656 están al lado del núcleo (centrado, parte la franja de atrás en dos de 6 m; casi todos en lotes de 3–4 casillas con núcleo de 6 m, escalera + ascensor) y 930 en edificios en L (el paso al ala lateral corta la franja de atrás). Pendiente decidir: llevar núcleo y paso a una punta de la franja.
- (núcleo a una punta, 2026-10-15, decisión de Miguel) layoutFloor ya no centra el núcleo: prueba cada lugar en metros pares (módulos de fachada) y se queda con el que deja más franja de atrás aprovechable (tramos ≥ el largo de un departamento con alcoba, `unitLengths`), sin chocar con el paso de la L; a igual resultado, una punta. Es determinístico (igual en todos los pisos). Validaciones en 0 (ciudad 20 + 40, núcleos, casas). 10 ciudades — pisos tipo: monoambientes 2.586 (50 %) → 1.700 (33 %), departamentos de 1 alcoba 1.306 → 2.169, alcobas 4.546 → 5.409 (+19 %; desde el comienzo de la cadena 3.724 → 5.409, +45 %), dormitorios 16,0 m². Planta baja: locales 766 → 994 (la franja de adelante también queda entera: el vestíbulo, frente al núcleo, va a una punta y la puerta de calle queda cerca de una esquina), depósitos 1.992 → 1.531, baños 2.022 → 1.880, recepciones 402 → 446, aulas 8 → 18; vestíbulos 761 igual. Los monoambientes que quedan son geometría: 864 en lotes de 2 casillas de frente con ascensor (12 − 6 de núcleo = 6 m de franja de atrás; una alcoba en 4,5 m de fondo pide 10) y ~770 en alas de 6 m de los edificios en L.
- (tope de 3 pisos en lotes de 2 casillas de frente, 2026-10-15, decisión de Miguel) typeLots: `if(frenteDe(L)===2)L.floors=Math.min(L.floors,3)` (sin ascensor: núcleo de 4 m, y al lado 8 m de franja en vez de 6). Validaciones en 0. 10 ciudades: en esos 394 lotes, pisos 1.969 → 1.150, departamentos 1.606 → 906, monoambientes 864 → 402. En toda la ciudad: pisos 4.416 → 3.606 (−18 %), edificios con ascensor 653 → 340, edificios de 3 pisos 151 → 457 (la ciudad queda más baja), departamentos 5.192 → 4.532, alcobas 5.409 → 4.896 (−9 %: menos pisos), monoambientes 33 % → 28 %. Los 402 que quedan en esos lotes son la franja de atrás de los de 2×2 casillas: 8 m de largo por 4,5 de fondo, y en 4,5 m de fondo un departamento con alcoba pide 10 (aun derivándolo: alcoba 3,5 + baño 2,5 + sala 3 = 9). Respaldo de antes: blueprint.antes-tope3.js en el scratchpad.
- (1. recorrido completo, 2026-10-15) validar-ciudad arma un grafo por edificio (calle, cuartos, tramos de pasillo, escalera y ascensor por piso; puertas, cuartos sin tabique hacia el pasillo, pasillos que se tocan —con un paso «virtual» para medir—, la escalera piso a piso y el ascensor) y revisa: (a) que desde la calle se llegue a todo; (b) evacuación: el punto más lejano de cada cuarto, de puerta en puerta, a ≤ MINIMO.evacuacion = 45 m de la escalera (en planta baja, de la calle). Resultado: ningún cuarto lejos; sí 312 cuartos sin entrada en 78 edificios: las casas de un piso nuevas usaban el programa de planta baja de «casa» pensado para una casa con núcleo (la sala sin puerta de calle; atrás, sólo baños: salían tres baños seguidos). Ahora la casa de un piso tiene su programa (layoutFloor `casa1`): adelante la sala-cocina, por donde se entra desde la calle; atrás dormitorio y baño; en 6 m de fondo, monoambiente y baño. Todo en 0 (60 ciudades, núcleos, casas).
- (2. luz natural, 2026-10-15) El vidrio de cada pieza de ventana del paquete, MEDIDO en sus glTF (partes MI_Glass, pieza a 2 m): clave 0,99×2,01 = 2,0 m²; moldura 0,45×1,30 = 0,59; cuadrada 0,44×1,24 = 0,55; piedra 0,99×1,07 = 1,06; vidrio entero y media 1,81×2,64 = 4,78; vidrieras de planta baja 1,81×2,43 (ladrillo/metal) y 1,89×2,23 (piedra). En `medidas.js` VIDRIO. En el 3D: planta baja vidriera; primer piso `ventana1`; del segundo para arriba `ventana`, que en casi todos los estilos es la «cuadrada». validar-ciudad (cuartos habitables: vidrio ≥ 1/8 del piso, MINIMO.luz): 10 ciudades, 8.327 cuartos con poca luz (casi todos del 2.º piso para arriba: dormitorios 2.049, sala_cocina 1.333, habitaciones de hotel 888, oficinas 708…) y 909 sin ninguna ventana (la mayoría tocan el borde del lote pero es medianera o no tienen un módulo entero; algunos son interiores). Baños sin ventana 4.255 (aviso: ventilan con extracción). Pendiente decidir con Miguel: ventanas según el cuarto (cambia cómo se ven las fachadas) y reacomodar los cuartos habitables hacia la fachada.
- (2. luz: ventana según el cuarto y servicios contra la medianera, 2026-10-15, decisión de Miguel) (a) openings(): en cada piso de arriba, si a un cuarto HABITABLE no le alcanza la ventana del estilo para 1/8 de su piso con el vidrio medido, todas sus ventanas suben a la pieza más chica de su familia que alcance (`VENTANAS_FAMILIA`: ladrillo y piedra cuadrada → moldura/piedra → clave; metal media → vidrio), o a la más grande; queda en `w.pieza`, y town3d.js la dibuja (primer paso de «el 3D dibuja lo que el plano resolvió»; las seis piezas ya estaban en FACADE_PIECES). (b) layoutFloor: un tramo de la franja de atrás sin ningún módulo con luz (da a la medianera del lote de atrás) lleva sus servicios (lo no habitable del programa) o depósitos y baños, no cuartos habitables ni departamentos. `HABITABLE` pasó al catálogo. 10 ciudades: cuartos con poca luz 8.327 → 869, sin ventana 909 → 595; el 38 % de las ventanas de los pisos altos cambia de pieza (clave 15.405, piedra 4.065, moldura 1.295 de 54.123); departamentos 4.532 → 4.269, alcobas −2 %, monoambientes 28 % → 26 %. Lo que queda es geometría: cuartos con poco frente para su superficie (una sala-cocina de 3,5 m de frente tiene un solo módulo de ventana entero y ni la clave —2 m²— alcanza para 26 m²) y cuartos que no tocan un módulo entero de fachada. Núcleos y casas en 0; la demo arma sin errores (1.806 de 5.923 ventanas con pieza elegida).
- (2. luz cerrada: módulos según la superficie, 2026-10-15, decisión de Miguel) unitPlan: cada alcoba y la sala tienen que contener los módulos de ventana ENTEROS que pide su superficie (1/8) con la ventana más grande de la familia del edificio (`gmax`, pasado de layoutFloor → apartments → unitPlan/unitLengths). Además: (a) la franja de atrás se parte en tramos con luz y sin luz (antes bastaba un módulo con luz en una punta para llenar el tramo entero de departamentos y la parte ciega quedaba con cuartos interiores —eran 482—); (b) la escalera no a más de `ESCALERA.pasilloMax` = 16 m de cada punta del pasillo (con el núcleo en la punta aparecieron 10 cuartos a 45,4 m en las L de 24 m); (c) hoteles y edificios públicos piden 2 casillas de fondo (`fondoDe`): en una sola, las habitaciones quedaban contra la medianera. Resultado: validar-ciudad en 0 en 60 ciudades CON la luz (cuartos con poca luz 869 → 0, sin ventana 595 → 0) y la evacuación; núcleos y casas en 0; la demo arma sin errores. COSTO (10 ciudades, contra el paso anterior): monoambientes 26 % → 39 %, alcobas 4.787 → 4.121 (−14 %), departamentos 4.269 → 3.894; dormitorios 16 → 17 m²; hoteles 62 → 56. Respaldo: blueprint.antes-modulos.js en el scratchpad.
- (3. proporciones, 2026-10-15) validar-ciudad: ningún cuarto habitable más alargado que MINIMO.proporcion = 2 (lados libres, sin tabiques) y la sala no más chica que la alcoba más grande del departamento. Primera corrida (10 ciudades): 658 cuartos alargados, casi todos alcobas de 7×3,5 (el sobrante del departamento iba a las alcobas sin tope) y salas-cocina de 3×6; algunas aulas y salas de lectura de 12×6. Arreglos en el plano: unitPlan — la sala mínima sale de la proporción (D/2: con 6 m de fondo, 3,5) y cada alcoba como mucho el doble de su fondo (lo que no entra va a la cocina o, sin cocina, a la sala); fill() con el fondo de la franja: un cuarto habitable más largo que el tope se parte en cuartos iguales del mismo tipo; los pupitres del aula con la prueba de movimiento (en las aulas angostas tapaban el pizarrón). Resultado: 0 en 60 ciudades.
- (BUG: la ciudad dependía del orden, 2026-10-15) La caché de distribuciones de muebles (CATALOG, por firma del cuarto) era compartida entre ciudades, y la firma no captura todo lo que importa: la misma semilla daba otra ciudad según qué se había generado antes (huella distinta de la ciudad 1027 sola y después de 27; en una biblioteca, una mesa corrida 35 cm tapaba un estante). Para el multijugador, cada jugador habría visto otra ciudad. Ahora: CATALOG se vacía al empezar cada ciudad (generateBlueprint) y, además, una distribución que viene de la caché se prueba EN ESTE cuarto con makeMovement y, si no anda, se calcula una para él. Comprobado: la misma huella sola o después de otras (1027, 1003). La demo arma en ~3 s (el plano 1,2 s en su worker, en paralelo con los modelos).
- (4. monoambientes, 2026-10-15) Causa medida (10 ciudades, pisos de departamentos): 1.079 en franjas de atrás de 4,5 m de fondo (una alcoba pide 10 m de largo), 403 de 12 m que no daban alcoba (error), 431 de 6 m. El error: unitPlan repartía el sobrante con una regla fija (sala hasta 5 m, después alcobas); con ladrillo/piedra (vidrio máximo 1,99 m²) daba alcoba en 10 y 14 m pero no en 12: la sala de 5,5 pedía 3 módulos y le caían 2. Ahora busca: anchos de sala (los más cerca de 5 m primero) × lo que va a la primera alcoba, el resto a las alcobas sin pasar su tope y a la cocina; gana la primera con luz en cada alcoba y la sala. Largos monótonos (ladrillo: 10–13 → 1 alcoba, 14–15 → 2, 16 → 3). Resultado: monoambientes 1.913 (49 %) → 1.510 (39 %), alcobas 3.644 → 3.815, dormitorios 17,1 m²; todo en 0 (60 ciudades, núcleos, casas, mínimos sin cambio) y la ciudad sigue saliendo igual sola o después de otras. Lo que queda es geometría: franjas de atrás de 8 × 4,5 m al lado de la escalera en lotes de 2 casillas (alcoba con luz 4 + baño 2,5 + sala-cocina 4 = 10,5 > 8) y franjas enteras de 6 m.
- (6. la forma del mapa, medida, 2026-10-15) `scripts/medir-forma.mjs [ciudades] [semilla0] [jugadores]` sobre el mapa que juega el motor (plano.js planMap: casillas de 6 m, paredes entre casillas, puertas de calle), sin bots, ~0,6 s por ciudad: calles, cruces (≥3 salidas), callejones sin salida, circuitos (aristas − casillas + 1), cuellos de botella (casillas de calle que, cerradas, parten la red: puntos de articulación), líneas de vista (lo más largo en línea recta por calle desde cada casilla), y por edificio robable: puertas, distancia a la comisaría por calle, rutas de escape independientes (desde la calle frente a sus puertas hasta 60 m, sin compartir casillas) y cajas. 12 ciudades, 3 vs 3: circuitos 38–251 y cuellos 12–54 (la ciudad 1 es casi un árbol; la 4 y la 8, una malla), vista media 74–92 m y 56–76 % de las calles ve a más de 48 m (la grilla deja pocos lugares fuera de vista), objetivos con una sola puerta 1–12, distancia mediana a la comisaría 72–114 m, rutas de escape 2–3. Pendiente: cruzar estas medidas con lotes de bots en dos ciudades opuestas (p. ej. 1 y 4; ~400 rondas cada una para que la diferencia sea real) para saber cuáles mueven el resultado, y después pedirle al generador rangos (p. ej. objetivos con ≥2 puertas, un tope de cuellos).
- (CIUDAD NUEVA POR CÁLCULO, 2026-10-15, decisión de Miguel: estética y variedad desde cálculos y semillas, sin bots por ahora, validación matemática + plano 2D en cada hito, 3D al final) Hecho: (1) respaldo `~/Desktop/CREDITOP/respaldo-fuga-2026-10-15.zip` y borrado lo obsoleto (páginas /capas /cuerpos /ropero /casas /edificios, engine capas/rasgos/tension, 84 capturas sueltas, build-check, ~/Desktop/CREDITOP/lab); quedan el juego (/, /jugar, /ciudades) y el calibrador. (2) La demo sin gente ni árboles en la ciudad (`CIUDAD_LIMPIA` en DemoView, opción `arboles` de buildWorld). (3) Estándares investigados en `medidas.js`: CALLE (vereda 3 = paso 1,8 + fachada 0,6 + mobiliario 0,6; carril 3; calle 12 m, avenida 18), ENCIERRO (alto/ancho 1/3–1, 1,5 en el centro), MANZANA (40–120, ideal 80–90), INTERIOR (NDSS, triángulo de cocina). (4) ciudad.js: calles de 2 casillas y avenidas de 3 (anillo incluido), mapa ~11 % más grande por lado, sin kioscos; nombres por calle (filas seguidas = una calle). (5) Franja iluminable máxima `FRANJA.maxLuz` = 7,5 m (con la ventana más grande de ladrillo/piedra ninguna franja más honda se ilumina): lotes hondos con franjas de 7,5 y pasillo ancho (`pasilloDe`); núcleo contra el fondo con vestíbulo delante. (6) Rangos: robables con ≥2 salidas en casillas distintas (`JUEGO.puertasRobable`), encierro (pisos ≤ ancho de calle × 1, ×1,5 en el centro: `maxPisos`). Todo en 0 (ciudad 20+40, núcleos, casas), determinista. medir-forma por calles: cruces 21–27, circuitos 11–17, rutas de escape 4, robables de una puerta 0; líneas de vista 108–136 m (largas: pendiente decidir). `scripts/plano-2d.mjs` dibuja el plano (capturas/plano). Vistos en el plano: manzanas en anillo con patio; hay interiores de manzana sin asignar (gris claro); alturas casi todas 3–4; el 3D todavía dibuja cada casilla de calle como calle de 6 m (pendiente).

## 2026-10-16 · Ideas de Miguel: equilibrio sin paridad, botín del mundo, tiendas de ropa (y el 2D como probador)
- **El 2D prueba todo (DECISIÓN de Miguel).** De ahora en adelante el 2D es el probador de todo: cualquier arreglo que
  aparezca en el 3D se corrige en el 2D, en las proporciones y distribuciones calculadas, para que todo sea medible.
  Probador único: `node scripts/probar.mjs [ciudades] [semilla0]` (todos los validadores en paralelo, un resumen).
- **Equilibrio, no paridad.** Con el mundo hecho, los equipos no tienen por qué ser iguales (8 vs 8, 5 vs 5): puede haber
  más policías que ladrones o al revés. El equilibrio se puede medir en el 2D sin bots, con lo que ya existe: con la
  grilla peatonal y la red de carriles, (a) cuánto tarda la policía en llegar a cada objetivo desde la comisaría o desde
  una patrulla, (b) cuántas rutas de escape independientes tiene cada objetivo hasta una salida al monte o la playa, y
  (c) cuánta ciudad cubre un policía (el área a ≤ t segundos de él). La proporción policías/ladrones sale de que la
  policía cubra los objetivos en el tiempo que el ladrón tarda en robar y salir: hoy, a pie, comisaría → objetivo
  92 m de mediana y objetivo → salida 47 m (validar-juego.mjs). Falta fijar velocidades y tiempos (correr, robar, auto)
  para convertir metros en segundos; después, una tabla «tamaño del mapa × relación de equipos → tiempo de respuesta y
  rutas de escape» decide la relación por ciudad. Los bots después, para confirmar.
- **El botín son cosas del mundo.** En vez de un panel abstracto: un cuadro (en la pared de una oficina o una galería),
  una escultura (en un vestíbulo), una caja fuerte (la bóveda ya la tiene: `caja_fuerte` en el plano), joyas en una
  vitrina. Cada uno con su tamaño y su peso (el que carga una escultura va más lento, se ve de lejos) y su lugar
  calculado como cualquier mueble (con la prueba de movimiento). Medible: cuántos hay por ciudad, su valor total, la
  distancia a la puerta y a la salida.
- **Tiendas de ropa.** Un giro de local más (como pizzería o panadería): percheros, estantes, mostrador y probadores,
  con sus medidas y la prueba de movimiento. Se une con el Vestier: lo que se vende es la ropa del Ropero (disfrazarse
  para escapar).
- (equilibrio, primera medida, 2026-10-16) `scripts/medir-equilibrio.mjs [ciudades] [semilla0] [jugadores]`: por objetivo,
  la ventana de fuga desde la alarma (abrir 8 s + levantar 1,6 s + botín→puerta→salida al monte cargando, 4,06 m/s) contra
  la respuesta del policía más cercano (4,96 m/s; escala: thiefSpeed del motor = caminar del 3D, 5,2 m/s). Con C policías
  repartidos para cubrir lo peor (el primero en la comisaría), L*(C) = cuántos objetivos le ganan a la policía: los
  ladrones que equilibran a C policías. Resultado (a pie): 2v2 → 3 policías ↔ 0–1 ladrón; 3v3 → 4–5 ↔ 3; 5v5 → 5–6 ↔
  2–4; 8v8 → 8–9 ↔ 4–6. Con estas reglas la paridad favorece a los ladrones en mapas grandes: el equilibrio pide más
  policías que ladrones (≈ 1,3–2 : 1). En patrulla por los carriles casi no mejora (ciudad chica: el último tramo es a
  pie). Límites: la policía ya está repartida (no sale a buscar), llegar a la puerta cuenta como cortar la fuga (no hay
  persecución ni golpe), y no cuenta la cuota de botines ni la hora. Palancas para mover el equilibrio sin cambiar el
  mapa: el tiempo de abrir (vault), la velocidad cargando, la cantidad de objetivos robables (JUEGO.robables) o
  patrullas más rápidas. Los bots, después, para confirmar.

### Botín del mundo: primera medición (2026-10-16)
- Implementado en el 2D: `botin.js` y `validar-botin.mjs`.
- Con el botín, la relación de equilibrio a pie es de unos N/2 policías para tantos o menos ladrones, con N el número de objetos (ver GENERADOR.md).
- Desde la comisaría sola, el cuadro del monte es el más fácil: le gana a la policía en 80–100% de los casos. En 3 por equipo, el riesgo crece con el valor: margen del cuadro +39 s, escultura +12, joyas +4, caja −3. En 5 por equipo el orden se mezcla.
- Pendiente:
  - que el motor (`plano.js planMap`) juegue con `bp.botines` en vez de sus objetivos (los recuadros amarillos del plano);
  - la proporción de equipos por mapa (punto 2).
