# Jev con context, en el trabajo diario

El comando propone **qué nodo leer primero** para investigar una pregunta. Después se leen su
`doc.md`, su `map.json` y las fuentes en `main`. La sugerencia no certifica la documentación, no
responde la pregunta ni ejecuta acciones. Canon conserva su funcionamiento actual.

El script corre en esta máquina; **la inferencia usa la API de TypeSafe**. Con `--live` envía la
pregunta y el catálogo de nodos registrados (`name`, `when`, `sintomas`). No envía los documentos,
archivos de código, chats, tablas, registros de clientes ni credenciales del entorno. La pregunta
es texto libre: usá una descripción del problema sin datos personales ni secretos.

## Empezar

Desde la raíz del playground:

```sh
make context-jev ARGS='route "No llega el OTP para registrar el celular"'
make context-jev ARGS='route "No llega el OTP para registrar el celular" --live'
```

Sin `--live` se obtiene una referencia léxica local sin red ni lectura de credenciales. Con `--live`
aparece también la sugerencia de Jev, sus primeras alternativas, confianza, latencia y uso. La
distribución completa queda en el reporte. Esta referencia
léxica se usa para comparar el experimento; no pretende replicar el buscador de la interfaz.

Por defecto, la referencia local reduce el catálogo antes de llamar a Jev: toma hasta cuatro
coincidencias, sus padres y los hijos cercanos, con un máximo de doce entradas. Si no encuentra
ninguna coincidencia envía el catálogo completo. `--full-catalog` conserva ese modo para comparar
corridas; no es la opción diaria.

La clave se toma de `JEV_TOKEN` o `TYPESAFE_API_KEY`, en el entorno o en `context/.env` (ignorado
por Git). También se puede pasar `--env-file /ruta/al/.env` para reutilizar una configuración.
Solo se leen esas dos variables; el archivo no se ejecuta como shell. El entorno gana.

Cada ejecución imprime un `report` en `context/.runs/jev/`. Es local, ignorado por Git, y contiene
la pregunta, las decisiones y las medidas; no contiene el token ni los documentos. Los experimentos
no se agregan al corpus como historial. No hay servidor nuevo ni clave en el navegador.

## Aprender del uso

Tras investigar la pregunta, registrá el nodo que realmente sirvió:

```sh
make context-jev ARGS='label context/.runs/jev/REPORTE.json --expected onboarding'
make context-jev ARGS='stats'
```

Si había varias entradas razonables, `--expected onboarding kyc` acepta cualquiera. Si faltaba
información o era ajena al catálogo, usá `--expected ninguno`. La etiqueta se decide **después de
leer las fuentes**, no copiando la sugerencia. Se puede corregir con el mismo comando.

`stats` cuenta solo consultas diarias revisadas y separa versiones del modelo, catálogo,
instrucciones y umbrales mediante huellas calculadas al ejecutar. Los casos sin revisión no cuentan
como aciertos. Las etiquetas son evaluación:
no entrenan automáticamente el modelo ni modifican los nodos.

## Medir antes de ajustar

```sh
make context-jev-test
make context-jev ARGS='bench'
make context-jev ARGS='bench --live --repeat 2'
make context-jev ARGS='bench --live --repeat 2 --full-catalog'
```

La batería sintética distingue OTP de registro/firma, cuota inicial/cartera, permisos, biometría,
formularios, consultas ajenas y ambiguas. Sus etiquetas son iniciales y revisables. No es un conjunto
independiente para certificar producción; sirve para detectar errores y comparar versiones.
Los reportes muestran aciertos, sugerencias equivocadas, abstenciones, latencia y tokens. El costo
monetario depende de la tarifa del proveedor: no se inventa a partir del número de llamadas.

La versión queda fijada a `jev-1.13.0`. Choice elige un primer nodo o `ninguno`; Noul identifica si
la pregunta necesita datos de un caso o mediciones actuales. Son juicios separados contra el mismo
estado. Un nodo solo se sugiere con probabilidad ≥0,70, confianza ≥0,60 y margen ≥0,20 sobre la
segunda opción. Son umbrales exploratorios, no garantías de exactitud. Ante incertidumbre,
`ninguno`, timeout o fallo, siguen visibles los candidatos locales para lectura manual.

Cada consulta hace un solo intento de hasta 15 segundos, sin redirecciones. Se valida el contrato
completo antes de usarlo. Un error termina la batería y devuelve salida no cero; no multiplica
llamadas con una credencial rechazada. El estado enviado se limita a 64 KB y la pregunta a 2000
caracteres. El catálogo se deriva de `tree.json` y los mapas, sin una copia manual de los nodos.

## Probarlo en la fila de workers

La integración está apagada por defecto. Para una pregunta general, sin identificadores de cliente,
teléfonos, correos, secretos ni datos de una solicitud:

```sh
make agente-plan JEV=1 PREGUNTA='¿Cómo funciona el OTP de registro?'
make agente-analisis JEV=1 PREGUNTA='¿Cómo funciona el OTP de registro?'
```

Si Jev supera los umbrales, `plan.py` recibe solo dos a cuatro entradas del árbol y cada
`seleccion.py` empieza abriendo esos nodos directamente. El ROUTE-MAP sigue disponible como
recuperación si la pista no corresponde o no alcanza. Si Jev se abstiene, falla o la opción no se
activa, el planificador usa el mapa completo y funciona como antes. La pregunta enviada a TypeSafe es
exactamente `PREGUNTA`; la salida local `_plan.json` deja el ruteo a la vista para revisar qué ocurrió.

En la batería sintética de 36 consultas, la preselección mantuvo el nodo esperado entre sus
candidatos en 36/36 casos. Frente al catálogo completo redujo la entrada de Jev de 309.264 a 93.796
tokens (69,7%), la mediana de 732 a 538 ms y conservó cero sugerencias incorrectas después de los
umbrales. Hubo una abstención adicional: 11 en vez de 10. Es una medición del router, no del costo
total de una investigación ni una garantía sobre preguntas reales.

En una consulta sintética posterior —«¿Cómo funciona el OTP de registro del celular?»— Jev eligió
`onboarding` con probabilidad y confianza de 0,99. Su entrada fue de 1.824 tokens. La superficie que
recibiría `plan.py` pasó de 43.134 a 10.560 caracteres: aproximadamente 10.783 a 2.640 tokens usando
la regla simple de cuatro caracteres por token, 75,5% menos para el LLM generativo. Sumando ambas
entradas, el ruteo usaría unas 4.464 unidades frente a 10.783, cerca de 59% menos. Esa segunda cifra
mezcla el conteo real de Jev con una estimación para Gemini; no es una medida de facturación ni del
pipeline completo.

## Qué capacidades usamos y cuáles no

| Capacidad | Estado | Decisión |
|---|---|---|
| `Choice` | usada | Elige un nodo entre candidatos y `ninguno`; se conserva la distribución completa. |
| `Noul` | usada | Decide por separado si hacen falta datos de un caso o mediciones actuales. No se le inventa una confianza: Noul devuelve una probabilidad. |
| Preguntas paralelas | usada | `node` y `needs_case_data` viajan en una llamada contra el mismo estado. |
| Confianza + probabilidades | usada | La política combina probabilidad del ganador, confianza y margen; ninguno de esos valores garantiza corrección. |
| Filtrado antes del modelo | usada | El ranking local baja 39 nodos a 8,8 candidatos en promedio; Jev 1.13 pierde precisión con estado irrelevante. |
| `Score` | no usada aquí | Elegir nodos no es una escala ordenada. Agregar un score de “relevancia” duplicaría el juicio sin una política nueva que lo consuma. |
| Noul absoluto por candidato | por evaluar | Puede comprobar si el ganador de un Choice realmente encaja, como segunda etapa sobre dos o tres candidatos. Se añade solo si consultas reales muestran falsos positivos: hoy el banco tuvo cero sugerencias incorrectas tras los umbrales. |
| Fan-out especulativo | por evaluar | Caben preguntas atómicas como “¿es una sola investigación?” o “¿la petición tiene detalle suficiente?”, pero primero necesitan etiquetas y una decisión concreta en código. |
| Verificador de respuesta | fuera de este router | Jev podría comprobar evidencia o citas después del LLM; exige un banco distinto, porque ya no decide dónde leer sino si la respuesta está respaldada. |

La integración directa por HTTP es deliberada: evita otra dependencia y permite fijar versión, un
solo intento, timeout, redirecciones y validación completa. Los SDK oficiales son útiles, pero no
habilitan una capacidad del modelo que falte en este laboratorio.

La documentación de Jev 1.13 también obliga a mantener cuatro límites: no pedirle conteos, fechas ni
aritmética que resuelve el código; escribir condiciones literales y atómicas; filtrar el estado antes
de enviarlo; y tratar contenido adversarial como un riesgo medible. El caso
`instruccion-incrustada` cubre una forma básica de inyección, pero no certifica robustez.

## Dónde probarlo después

1. **Trazador — mejor siguiente experimento.** Su clasificador de reportes de Slack ya reconoce que
   las regex tienen techo. Sobre casos sintéticos y sanitizados, un solo request puede usar `Choice`
   para el tipo de incidente, `Noul` para si el trazador tiene evidencia suficiente y `Score` para
   severidad. No debe reemplazar el mapa determinista de etapas ni recibir mensajes reales, ids,
   teléfonos o logs sin una autorización separada.
2. **Harness — útil después de una corrida.** A partir de un resumen sin identidad, Jev puede elegir
   el área probable (`frontend`, `backend`, `configuración`, `proveedor`, `harness`), medir severidad y
   decidir si el veredicto necesita revisión. Las transiciones, asserts, exit code y evidencia de BD
   siguen en código; pasarle `.runs` crudo expondría ids y detalles innecesarios.
3. **Tablero — laboratorio implementado, todavía sin efecto en la agenda.**
   `make tablero-jev ARGS='bench [--live]'` evalúa ocho retomas sintéticas. En una sola llamada por
   caso, `Choice` clasifica el siguiente tipo de acción, `Noul` separa una dependencia externa de un
   bloqueo propio y `Score` ubica la urgencia operativa en cuatro niveles descriptivos. Una tarea real
   se previsualiza con `triage <id|slug>` sin red; el modo live exige `--allow-internal` en la misma
   invocación y envía solo título, etapa, próximo paso, días y conteos, nunca el cuerpo, registro,
   preguntas, pendientes, ramas ni bitácora. Las fechas, piezas faltantes, etapas, orden y cierre
   siguen siendo reglas exactas en Go. Hoy no hay un LLM dentro del tablero al que ahorrar tokens: el
   beneficio que se mide aquí es calidad de triage, y solo más adelante podría servir para darle a un
   agente una retoma compacta. En el primer banco de ocho casos sintéticos repetido dos veces,
   `Choice` acertó 16/16, `Noul` 16/16 y el `Score` redondeado 16/16; la política dio 15 sugerencias
   sin errores y una revisión manual. Mediana 528 ms, p95 689 ms, 11.944 tokens de entrada y 1.768 de
   salida. El resultado demuestra que el contrato funciona y amerita recolectar etiquetas reales; el
   banco pequeño no basta para activar Jev en `make hoy`. `label` registra después el juicio humano de
   una retoma y `stats` separa etiquetas, respuestas y aciertos; una preview no se cuenta como acierto.

En los tres casos Jev agrega valor solo delante de un juicio semántico o de un LLM posterior. Ponerlo
encima de una regla determinista suma costo y un nuevo modo de error.

Para decidir una integración futura, reunir consultas representativas revisadas, mantener un
conjunto de evaluación separado y medir especialmente las sugerencias equivocadas con confianza
alta. También comparar tiempo de investigación, latencia y costo. La aprobación y configuración
de producción siguen siendo una decisión posterior.

Contrato: [índice oficial](https://docs.typesafe.ai/llms.txt),
[API](https://docs.typesafe.ai/api), [confianza](https://docs.typesafe.ai/confidence),
[fan-out](https://docs.typesafe.ai/patterns/fan-out),
[sugerencia en dos etapas](https://docs.typesafe.ai/cookbooks/skill_suggestion) y
[límites de Jev 1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
