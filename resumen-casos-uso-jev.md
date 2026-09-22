# Cómo funcionan los casos de uso más llamativos de Jev

> **Fecha de la revisión:** 21 de septiembre de 2026.  
> **Alcance:** síntesis de documentación pública de los proyectos enlazados. Los apartados “lectura arquitectónica” son una inferencia técnica basada en esa documentación, no una afirmación de que haya sido publicada por TypeSafe o validada de forma independiente.

## Idea base: qué papel cumple Jev

Jev no es el componente que escribe una respuesta ni el que ejecuta acciones. Se le entrega un **estado** —texto, controles visibles, historial, datos de mercado, etc.— y un conjunto muy reducido de preguntas con respuestas de tipo fijo:

- `Choice`: escoger una opción de una lista conocida.
- `Score`: estimar una puntuación o intensidad.
- `Noul`: decidir sí/no y devolver probabilidad/confianza.

El programa conserva el control: transforma datos a un estado legible, llama a Jev, aplica umbrales de confianza, ejecuta únicamente acciones permitidas y vuelve a verificar el resultado. Según la descripción oficial, ese es precisamente el modelo mental buscado: **estado + decisión tipada + código de control**, no un chatbot que recibe permiso implícito para hacer cualquier cosa. [Introducción oficial de Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

```text
Fuentes del mundo real
       │  (DOM, OCR, libro de órdenes, historial, package.json)
       ▼
Normalización determinista ──► estado + opciones cerradas
                                        │
                                        ▼
                                  Jev: elección / score / sí-no
                                        │
                             confianza + reglas del producto
                                        │
                                        ▼
                         acción limitada, registro y verificación
```

## 1. Agente de navegador que encuentra vuelos

**Qué hace.** El proyecto `jev-ultrafast` navega una web y muestra resultados de vuelos entre Zúrich y Londres. Reporta 7,1 segundos para su demostración; no selecciona ni compra un vuelo. [Repositorio y medición declarada](https://github.com/browser-use/jev-ultrafast)

**Flujo documentado.**

1. El navegador toma una instantánea atómica del DOM: texto visible, controles y referencias a nodos reales.
2. El código forma un espacio dinámico de acciones: por ejemplo, `click`, `scroll`, `type` y los elementos que son válidos en ese instante.
3. Jev escoge simultáneamente la operación y el elemento objetivo.
4. Si la operación es escribir, un LLM pequeño genera únicamente el texto del campo. Jev no genera la consulta ni la URL.
5. El ejecutor resuelve de nuevo el nodo, comprueba que la página no haya quedado obsoleta y que el control no esté tapado, y solo entonces actúa.
6. Se vuelve a leer la página y se repite hasta cumplir la condición de parada.

**Lectura arquitectónica.** La parte potente no es “pedirle a una IA que navegue”, sino limitar cada ciclo a una decisión con opciones visibles y verificables. Al separar la escritura de texto de la selección de controles, el bucle puede ser rápido y reduce el riesgo de que la salida del modelo se convierta directamente en selectores, JavaScript o coordenadas peligrosas.

## 2. Uso de computador en macOS con OCR

**Qué hace.** `typesafe-computer-use` intenta llevar un Mac hacia una meta escrita en lenguaje natural: combina OCR de la ventana y el árbol de accesibilidad para elegir el siguiente clic, desplazamiento o apertura. El autor reporta aproximadamente USD 0,0002 por decisión y 1,5 s por paso de extremo a extremo. [Repositorio, metodología y límites](https://github.com/awlevin/typesafe-computer-use)

**Flujo documentado.**

1. Una captura se procesa localmente con OCR y se combina con nombres, roles y posiciones de controles expuestos por macOS.
2. El código elimina ruido: elementos fuera de pantalla, cajas sin etiqueta, menús cerrados y regiones que no cambiaron.
3. Jev recibe el objetivo, la historia reciente y una lista acotada de acciones/elementos. Decide el tipo de acción, el elemento y, cuando procede, el sitio de navegación.
4. Solo cuando hay que llenar texto se invoca un modelo escritor; también hay validación posterior de que el campo recibió un valor sensato.
5. Credenciales no se escriben; las acciones se implementan en manejadores explícitos y se registra cada paso.

**Lectura arquitectónica.** Es un diseño híbrido: percepción y ejecución son deterministas; Jev decide entre alternativas; un LLM redacta solo donde la decisión no basta. El propio autor advierte que algunas capacidades que un modelo grande obtendría de una captura —por ejemplo, interpretar fechas— tuvieron que convertirse en datos estructurados antes de preguntar a Jev.

## 3. Market maker que decide en cada bloque de una cadena

**Qué hace.** `jev-trader` observa el libro de órdenes MON/USDC de Kuru en Monad y decide `buy` o `sell` en cada bloque, de aproximadamente 300 ms. Luego cancela/reemplaza una orden límite *post-only* a un tick del mejor precio. [Repositorio](https://github.com/jarrodwatts/jev-trader)

**Flujo documentado.**

1. Un feed de bloques dispara el ciclo; se consulta el libro de órdenes con `eth_call`.
2. Se construye el estado de mercado y se hace la pregunta binaria a Jev.
3. El controlador conserva una sola operación en vuelo; si llega tarde, mantiene la posición en vez de acumular decisiones atrasadas.
4. Para cada decisión a tiempo, el código prepara, firma y envía la orden; confirmaciones, balances, comisiones y P&L se procesan fuera de la ruta crítica.
5. Un panel por SSE muestra bloques, decisiones, órdenes y llenados.

**Lectura arquitectónica.** Es un buen ejemplo de una decisión de alta frecuencia pero muy estrecha. Jev no fija tamaño, límites de exposición, claves privadas ni gas: esas restricciones siguen en código. Importante: el repositorio indica que su despliegue enlazado está en *dry run* con modelo `mock` por defecto; la arquitectura permite usar Jev real, pero la demo pública no prueba que una estrategia con IA sea rentable ni que esté operando con dinero real.

## 4. Puerta de seguridad antes de instalar paquetes npm

**Qué hace.** `pkg-gate` revisa los scripts `preinstall`, `install` y `postinstall` de un paquete o de un `package.json`, y devuelve `allow`, `warn` o `block`. [Repositorio y playground](https://github.com/hemanth/pkg-gate)

**Flujo documentado.**

1. El programa obtiene el manifiesto o recibe un script sin ejecutar.
2. Extrae los hooks de ciclo de vida y los evalúa en paralelo.
3. Jev estima riesgo y confianza respecto de criterios de seguridad.
4. El controlador transforma la salida en una política: permitir, pedir confirmación o bloquear. Con confianza menor a 0,50 enruta a revisión humana.
5. La CLI usa códigos de salida distintos y presenta un informe; también existe un simulador local si no hay clave.

**Lectura arquitectónica.** Es una barrera previa, no un antivirus ni un sandbox: clasifica texto sospechoso antes de que se ejecute. La seguridad real procede de combinar el veredicto con umbrales conservadores, reglas deterministas y revisión humana en los casos ambiguos.

## 5. Compactación de contexto para un agente de programación

**Qué hace.** La extensión `pi-fast-jev-compaction` intenta reducir el contexto de una sesión sin resumirlo: elimina llamadas de herramientas y resultados obsoletos, pero deja literal todo lo que conserva. [Repositorio](https://github.com/joelhooks/pi-fast-jev-compaction)

**Flujo documentado.**

1. La extensión representa compactamente el historial y fija los mensajes iniciales y recientes que nunca deben eliminarse.
2. Para cada llamada de herramienta apta, hace dos decisiones `Noul`: conservar la llamada y conservar el resultado.
3. Jev clasifica en tres salidas prácticas: conservar todo, conservar la llamada y truncar el resultado, o quitar ambos.
4. Las decisiones se guardan en un registro anexo; el historial fuente no se reescribe.
5. Si no se libera contexto suficiente, el mecanismo normal de resumen del agente continúa como alternativa.

**Lectura arquitectónica.** Es una aplicación inteligente porque explota una propiedad concreta: muchos resultados de terminal o lecturas de archivos eran útiles hace 40 turnos y ya no lo son. Aun así, hay un coste: editar mensajes puede invalidar la caché de prompts del proveedor. Por eso el proyecto expone límites, intervalos y una reducción mínima antes de reemplazar la compactación habitual.

## Patrón reutilizable para construir con Jev

1. **Define una microdecisión.** “¿Qué botón visible debo pulsar?”, “¿este script pasa a revisión?” o “¿este resultado sigue siendo necesario?”, no “resuelve toda la tarea”.
2. **Haz que las opciones sean mutuamente excluyentes y ejecutables.** Si dos opciones significan casi lo mismo, la confianza pierde valor.
3. **Pasa hechos, no tareas vagas.** Extrae DOM, OCR, datos de mercado o llamadas de herramienta antes de llamar al modelo.
4. **Conserva las políticas críticas en código.** Permisos, presupuesto, límites de riesgo, formato, reintentos y parada no deben depender solo de una predicción.
5. **Usa la confianza para fallar de manera segura.** En baja confianza: no actuar, escalar a una persona, pedir más estado o delegar en un modelo más capaz.
6. **Verifica después de ejecutar.** La página cambió, una orden puede no haber entrado y un campo puede no haber aceptado texto.
7. **Evalúa con datos propios.** Jev se lanzó recientemente y las cifras de los repositorios son reportes de sus autores. No se debe trasladar una latencia o exactitud de demo a producción sin pruebas representativas.

## Conclusión

Los usos “increíbles” no son magia generalista: convierten una tarea amplia en cientos de decisiones pequeñas, rápidas y controladas. Jev funciona como una capa de selección o compuerta; el software tradicional observa, pone límites, actúa y valida. Los diseños más sólidos reservan los modelos generativos para texto o planificación y nunca conceden ejecución directa a una respuesta del modelo.
