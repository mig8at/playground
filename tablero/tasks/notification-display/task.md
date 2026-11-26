---
id: 141
title: "Pantalla de notificaciones"
stage: evaluation
created: "2026-11-25T19:04:00-05:00"
knowledge: []
jira: []
jira_title: "Pantalla de notificaciones"
---

## Pendientes

- [ ] Elegir entre la opción 1 (4 paneles, 256×32) y la opción 2 (8 paneles, 256×64); termina cuando la elegida quede en «Cómo se ataca» y la descartada en «Lo que se evaluó y NO se eligió».
  Depende de: Miguel — si caben imágenes y el presupuesto.
- [ ] Medir la pared y fijar altura y punto de anclaje; termina cuando haya ancho útil, altura (2,2–2,5 m) y toma de corriente medidos en sitio.
- [ ] Cotizar y comprar el hardware de la lista; termina cuando todo esté en la oficina y un panel prenda con un patrón de prueba.
- [ ] Definir el contrato JSON de los cuatro tipos (texto, imagen, contador, sonido); termina cuando el controlador rechace cualquier otro tipo y un mensaje mal formado no lo cuelgue.
- [ ] Armar el servidor que junta los datos y empuja al tablero; termina cuando las cifras de negocio salgan agregadas de la base de producción (sólo lectura) y se refresquen solas.
- [ ] Prioridad de alertas críticas sobre la rotación; termina cuando una caída simulada interrumpa el ciclo, suene y vuelva a la rotación al resolverse.
- [ ] Revisar que nada de lo que se muestra identifique a un cliente; termina cuando cada fuente esté listada con su agregación y no haya nombres, cédulas ni montos individuales.

## Objetivo

Que en la oficina de desarrollo haya un tablero LED horizontal, en la parte alta de la pared (unos 4 m × 2 m)
sobre el área de los 4 desarrolladores, que muestre texto, números e imágenes que le manda una API propia y
haga un «pip» corto ante eventos. Muestra cifras de negocio y de desarrollo, y cultura cuando no hay nada más.
Todo lo de clientes, siempre agregado (Ley 1581 de 2012).

## Dónde se toca

No toca los repos de producto. Es un servicio nuevo más el firmware del controlador:

- **Hardware**: paneles LED RGB HUB75 P4 de 64×32 px (25,6 × 12,8 cm cada uno).
  - Opción 1: una fila de 4 → 1,02 m × 13 cm, 256×32 px. Una línea de texto y contadores.
  - Opción 2 (recomendada si caben imágenes): 2 filas de 4 → 1,02 m × 26 cm, 256×64 px. Texto más grande, íconos y pixel art.
  - Controlador: ESP32 con WiFi y adaptador HUB75 (`ESP32-HUB75-MatrixPanel-DMA`); alternativa, Raspberry Pi con `rpi-rgb-led-matrix`.
  - Fuente de 5 V: 20 A para 4 paneles, 40 A para 8. Bocina pequeña, cables HUB75, cables de poder, soportes.
  - Altura de 2,2 a 2,5 m, brillo medio.
- **Servidor**: junta los datos y le manda JSON al controlador por WiFi. Ajusta las imágenes al tamaño exacto del panel antes de mandarlas.
- **Fuentes de datos**: la base de producción (sólo lectura, agregados), los despliegues y PRs de GitHub, el monitoreo de la API, y un calendario de cumpleaños y aniversarios.

## Cómo se ataca

1. **Banco de prueba**: un panel, el controlador y la fuente; un patrón de prueba y un texto fijo.
2. **Contrato**: el JSON de los cuatro tipos (`text`, `image`, `counter`, `sound`), con prioridad y duración; el controlador rechaza lo demás.
3. **Servidor mínimo**: rotación en ciclo con hora y clima como relleno, y una alerta crítica que interrumpe.
4. **Contenido de desarrollo**: deploys exitosos o fallidos, caídas o errores de la API, PRs pendientes, uptime.
5. **Contenido de negocio**: descargas de la app, solicitudes, créditos aprobados y desembolsados, monto del mes con barra hacia la meta; un récord dispara un sonido especial.
6. **Cultura**: cumpleaños, aniversarios, bienvenidas y la mascota en pixel art.
7. **Montaje** en la pared, con los paneles definitivos.

El prototipo visual de las dos opciones y la arquitectura: `artifacts/notification-display.html`.

## Lo que se evaluó y NO se eligió

Todavía nada: la elección entre la opción 1 y la 2 es el primer pendiente.

## Lo que NO entra

- Datos individuales de clientes: nombres, cédulas, montos de una solicitud. Sólo agregados.
- Interacción desde el tablero (no es táctil ni tiene botones).
- Mostrarlo fuera de la oficina de desarrollo o en otras sedes.
- Escribir en ninguna base: el servidor sólo lee.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Todavía no hay receta: se escribe cuando exista el banco de prueba (paso 1).

## Referencias

- Prototipo: `artifacts/notification-display.html`, publicado (privado) en https://claude.ai/artifact/17GA5vj5FABNGhmkZN7SSk.
- `ESP32-HUB75-MatrixPanel-DMA`: https://github.com/mrcodetastic/ESP32-HUB75-MatrixPanel-DMA
- `rpi-rgb-led-matrix`: https://github.com/hzeller/rpi-rgb-led-matrix

<!-- ─────────────────────────────────────────────────────────────────────────────────────────────
     DE ACÁ PARA ABAJO ES LO ÚNICO QUE SALE A JIRA.
     ───────────────────────────────────────────────────────────────────────────────────────────── -->


## Tarea (publicable)

## En una línea
Un tablero LED en la oficina de desarrollo que muestra, en vivo, cómo va CreditOp y cómo va el equipo.

## Por qué
Hoy las cifras del negocio y el estado de los despliegues están repartidos en varias herramientas que hay que ir a mirar. Tenerlos a la vista, en la pared, hace que el equipo se entere de un récord o de una caída en el momento en que pasa.

## Qué cambia
- Un tablero LED horizontal de interior, en la parte alta de la pared sobre el área de desarrollo, de 1,02 m de ancho (13 o 26 cm de alto según la opción).
- Muestra texto, números con barra hacia la meta, íconos y pixel art, y hace un sonido corto ante eventos.
- **Negocio**: descargas de la app, solicitudes, créditos aprobados y desembolsados, monto del mes contra la meta y récords con sonido especial.
- **Desarrollo**: despliegues exitosos o fallidos, caídas o errores de la API, PRs pendientes y disponibilidad.
- **Cultura**: cumpleaños, aniversarios, bienvenidas, una mascota en pixel art, y hora o clima cuando no hay nada más.
- Las alertas críticas interrumpen lo que se está mostrando; el resto rota en ciclo.

## Alcance
- Sólo cifras agregadas: nunca nombres, cédulas ni montos individuales de clientes (Ley 1581 de 2012).
- Sólo lectura de los datos; el tablero no cambia nada en la plataforma.
- Sólo la oficina de desarrollo.

## Dónde probar
En la oficina de desarrollo, con el tablero montado y conectado a la red WiFi de la oficina.

## Cómo validar
1. Encender el tablero: muestra la hora y el clima.
2. Mandar un mensaje de texto, uno de contador con meta, una imagen y un sonido: cada uno se ve y suena como se definió.
3. Mandar un tipo de mensaje que no existe: se rechaza y el tablero sigue funcionando.
4. Simular una caída de la API: la alerta interrumpe la rotación, suena, y la rotación vuelve al resolverse.
5. Revisar cada cifra de negocio contra su reporte: coincide y ninguna identifica a un cliente.

## Criterios de aceptación
- El tablero está montado a 2,2–2,5 m, con brillo medio, y se lee desde los puestos de los 4 desarrolladores.
- Muestra los cuatro tipos de mensaje y rechaza cualquier otro.
- Las alertas críticas interrumpen la rotación; el resto rota en ciclo.
- Las cifras de negocio se actualizan solas y coinciden con los reportes.
- Ninguna pantalla muestra datos individuales de clientes.

## Dependencias / contraparte
- Compra del hardware (paneles, controlador, fuente, bocina, cables y soportes).
- Un punto de corriente y WiFi en la pared elegida.
