# FUGA · lo que es arquitectura, con su fuente (desde el 2026-11-23)

Para qué existe (Miguel, 2026-11-23): «buscar en internet, de forma progresiva, qué es arquitectura». El motor arma los
edificios con reglas propias; este archivo junta las reglas de verdad —la norma colombiana y el oficio—, cada una con su
fuente y su numeral, para contrastarlas con el motor y, cuando valga, volverlas una prueba del probador. Crece por tema.

La dirección que marcó Miguel: **la remodelación es interna**. El jugador pone los muebles; el motor entrega el cascarón
(estructura, núcleo, fachadas, baño y cocina: `engine/entrega.js`). Lo que el motor tiene que hacer bien es **dónde van
la escalera y el ascensor**, para aprovechar el espacio, y si pueden **tener vista afuera**.

Reglas de este archivo: cada cifra con su numeral y su fuente; lo que no se encontró se dice; una regla del oficio (no
de la norma) se marca como tal.

## 1. Los núcleos: escalera y ascensor

Fuente: **NSR-10, Título K** (Requisitos complementarios), capítulo K.3, «Requisitos para zonas comunes». Copia en el
sitio del IDRD: <https://www.idrd.gov.co/sites/default/files/documentos/Construcciones/11titulo-k-nsr-100.pdf>, leída el
2026-11-23. Un edificio de departamentos es del subgrupo **R-2, residencial multifamiliar** (K.2.10.3).

### La escalera

| qué | la norma | numeral |
|---|---|---|
| ancho, carga de ocupación menor a 50 | 0,90 m | K.3.8.3.3 |
| ancho, más de 50 o de uso público | 1,20 m | K.3.8.3.3 |
| ancho dentro de un apartamento o en una casa | 0,75 m | K.3.8.3.3 |
| huella | 280 mm o más | K.3.8.3.4 (a) |
| contrahuella | entre 100 y 180 mm | K.3.8.3.4 (b) |
| 2 contrahuellas + 1 huella | **entre 620 y 640 mm** | K.3.8.3.4 (c) |
| escalera de dos pisos dentro de un apartamento (carga < 10) | huella ≥ 210 mm, contrahuella ≤ 210 mm | K.3.18.2.6 |
| descanso, largo en el sentido de la marcha | el ancho de la escalera, sin pasar de 1,20 m | K.3.8.3.5 |
| altura entre descansos (vivienda) | menos de 3,50 m | K.3.8.3.5 |
| altura libre | 2 m | K.3.8.3.7 |
| iluminación en los escalones | 100 lux o más | K.3.9.1.3 |
| madera como medio de evacuación | no se permite | K.3.8.3.8 |

La carga de ocupación en vivienda es **18 m² de área neta por persona** (tabla K.3.3-1): un piso de 400 m² da ~22
personas, así que en vivienda casi siempre basta 0,90 m.

### Cuántas escaleras

- **Una sola escalera por piso** está permitida en un multifamiliar si cumple todo esto: materiales incombustibles,
  **altura menor a 15 m**, **400 m² por piso como mucho** y **15 m de recorrido como mucho** (K.3.18.2.1).
- Más alto, la regla general: hasta 100 ocupantes por piso, una salida (tabla K.3.4-1), y las salidas tan separadas como
  se pueda (K.3.4.1.1).
- **Desde 6 pisos, al menos una salida a prueba de humo**: escalera, **vestíbulo** y muros de cerramiento no
  combustibles, que descarga afuera (K.3.8.7.1 y K.3.8.7.2).
- Un apartamento puede tener una sola salida si da a la calle, a **una escalera exterior** o a una escalera interior a
  prueba de incendio que no sea parte del apartamento (K.3.18.2.3).

### Recorridos y pasillos

- De la puerta del apartamento a la salida más cercana: **35 m sin rociadores**, 45 m con rociadores (K.3.18.2.4).
- Desde el punto más alejado, en residencial: 60 m sin rociadores y 75 m con ellos (tabla K.3.6-1); se puede subir
  hasta un 30 % si el recorrido es recto, sin escaleras intermedias y sale a nivel (nota de la tabla).
- **Pasillo ciego**, cuando se exige más de una salida: 6 m como mucho (K.3.5.1.3).

### La escalera con vista afuera: sí se puede

- **K.3.8.4, escaleras exteriores**: «cualquier escalera exterior instalada permanentemente en una edificación puede
  servir como salida» si cumple lo de las escaleras interiores. En edificios de **3 o más pisos tiene que estar
  sólidamente integrada al edificio** (K.3.8.4.1).
- La NSR-10 **no trae** qué parte de la escalera tiene que estar abierta ni a qué distancia de las ventanas: otras normas
  sí (en España, una escalera abierta al exterior no necesita vestíbulo; nota técnica NTP 46 del INSST:
  <https://www.insst.es/documentacion/colecciones-tecnicas/ntp-notas-tecnicas-de-prevencion/2-serie-ntp-numeros-036-a-085-ano-1983/ntp-46-evacuacion-de-edificios>).
  Sin verificar para Colombia: la curaduría o Bomberos lo deciden por proyecto.
- Lo que cuesta: los cuartos donde se duerme necesitan ventana. **Todo dormitorio a menos de cinco pisos debe tener al
  menos una ventana que abra** o una puerta exterior (K.3.18.2.2). Una escalera en la fachada le quita fachada a los
  departamentos. Entre medianeras, que es lo común en Bogotá, sólo hay frente y fondo.

### El ascensor

- **No hay norma nacional ni distrital que diga desde cuántos pisos se exige ascensor.** Lo dice la Secretaría Distrital
  de Planeación en un concepto jurídico: <https://www.sdp.gov.co/sites/default/files/conceptos-juridicos/2-2020-48322.pdf>.
- Si hay ascensor, tiene que caber **una persona en silla de ruedas** y cumplir la NTC 4349 (K.3.2.7.1). Los ascensores
  no cuentan como medio de evacuación (K.3.2.1.1).
- Un edificio de servicio al público con varios pisos y sin ascensor necesita rampas (K.3.2.7.3).

### Contra el motor (`src/engine/blueprint.js`, `src/engine/medidas.js` ESCALERA), al 2026-11-23

| regla del motor | la norma | qué hay |
|---|---|---|
| huella 0,28 m (`ESCALERA.huella`) | ≥ 280 mm | cumple, justo |
| 18 contrahuellas por piso de 3 m = 166,7 mm | 100 a 180 mm | cumple |
| 2C + H = 2 × 166,7 + 280 = **613 mm** | **620 a 640 mm** | **no cumple por 7 mm**. Con huella de 0,29 m da 623 mm (cada tramo de 9 peldaños se alarga 9 cm) |
| núcleo de 4 m: dos tramos de ~1,9 m | ≥ 0,90 m (1,20 de uso público) | cumple de sobra; se podría angostar y dar el resto a departamentos |
| núcleo angosto de 2 m (`anchoAngosta`): tramos de 0,88 m, según el comentario de `layoutFloor` | ≥ 0,90 m con carga < 50 | **no cumple por 2 cm**, si el comentario sigue vigente; medirlo en el 3D |
| descanso: fondo del núcleo (4 m) − 9 × 0,28 − umbral 0,1 ≈ 1,38 m | ≥ ancho del tramo, hasta 1,20 m | cumple |
| una escalera por edificio, vivienda de 3 a 7 pisos (+2 en avenida) | una sola, sólo bajo 15 m, ≤ 400 m² y ≤ 15 m de recorrido; desde 6 pisos, una a prueba de humo | **desde ~5–6 pisos falta**: vestíbulo y cerramiento (o una segunda salida) |
| ascensor desde 6 pisos (`ASCENSOR.desde`, decisión de Miguel 2026-11-22) | no hay umbral | es diseño, no norma; si lo hay, que quepa una silla de ruedas |
| núcleo «en el fondo, nunca en la fachada» | una escalera exterior está permitida | la regla del motor es de aprovechamiento, no de norma |
| pasillo ciego: hasta 2 m (`ALARGA_MAX`) o 4 m (`ENSANCHE_MAX`) | 6 m cuando se exigen dos salidas | cumple |

Las cuentas del motor salen de leer el código, no de una corrida: antes de volverlas prueba, medirlas sobre ciudades.

### Dónde una escalera con vista paga (oficio, sin fuente todavía)

- En un **lote de esquina**: dos fachadas, y una puede ceder un tramo al núcleo sin dejar cuartos ciegos.
- En la **fachada de atrás** o con **aislamiento lateral**: luz y vista sin quitarle frente a la calle.
- Entre medianeras con frente angosto, no: cada metro de fachada es un cuarto con ventana.

Falta una fuente del oficio para esto (manuales de diseño de vivienda colectiva: tipos de núcleo, cuánto del piso se
lleva cada uno). Lo que se encontró es de oficinas y de marketing (eficiencia del 80 al 88 %), sin valor para vivienda.

## Lo que falta buscar

1. **Iluminación y ventilación de los cuartos en Bogotá**: el Decreto 099 de 2024 (habitabilidad, reglamenta el artículo
   604 del Decreto 555 de 2021, el POT) y el anexo 5 del POT. Sin leer todavía.
2. **Aislamientos y patios** en Bogotá (anexo 5 del POT y el manual de normas comunes de la SDP).
3. **Tipos de núcleo en vivienda** y su eficiencia, de una fuente de diseño.
4. NTC 4349 (las medidas de un ascensor accesible) y NTC 4145 (escaleras), que la NSR-10 cita.
