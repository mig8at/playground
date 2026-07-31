---
title: "Renting: la tarjeta muestra plan y pago semanal, y el precio de la semana cambia según el plazo"
---

## En una línea
La tarjeta de la entidad de renting ahora muestra el plan de alquiler y el pago semanal que le corresponde, y deja de mostrar información de cupo que no aplica a ese producto.

## Por qué
Renting no es un crédito: el cliente alquila por un tiempo y paga semanalmente. La tarjeta mostraba solo un monto y, encima, dos etiquetas de crédito ("Pre aprobado" y "Cupo disponible") que prometen algo que el producto no entrega. Y al cambiar el monto aparecía un aviso de texto mientras la tarjeta seguía mostrando el valor anterior, sin señal de que ese número estaba desactualizado.

## Qué cambia
- La tarjeta de renting muestra **Pago semanal** y un selector de **Plan**: Semana, Mes o Trimestre.
- **El precio de la semana cambia según el plazo**, igual que en la calculadora oficial de Motai: alquilar una sola semana sale **25% más caro** y comprometer un trimestre trae **6% de descuento**. Se paga siempre semanal; el plan es cuánto tiempo se alquila.
- En renting ya **no** se muestran "Pre aprobado" ni "Cupo disponible": ese cupo es un techo interno, no plata disponible para el cliente.
- Al cambiar el monto, el aviso de texto se reemplaza por **tres puntos de carga en el número mismo** (monto y pago), que aparecen desde que se escribe y desaparecen cuando llegan los valores nuevos.

## Alcance
- Aplica al comercio de renting y a las entidades configuradas con ese producto.
- **No** cambia las entidades de crédito: siguen mostrando sus etiquetas y su cuota como hoy.
- Las tarifas son configuración de la entidad: cambiarlas no requiere despliegue.
- Si el recálculo del monto falla, la tarjeta vuelve a mostrar el número (desactualizado) en lugar de quedarse cargando.

## Dónde probar
- Ambiente de pruebas · comercio de renting · marketplace de entidades.
- **Precondición:** comercio habilitado con la entidad de renting y un usuario que llegue al marketplace. La configuración de tarifas ya está cargada en el ambiente.

## Cómo validar
1. Con monto solicitado **$2.000.000**, la tarjeta muestra **Monto pre aprobado $8.330.000**, **Pago semanal $100.450** y el plan **Mes** preseleccionado.
2. Cambiar el plan a **Semana** → el pago semanal sube a **$125.563**. Cambiarlo a **Trimestre** → baja a **$94.423**. El monto pre aprobado no cambia.
3. Cambiar el monto → mientras se recalcula, aparecen **tres puntos** en el monto y en el pago (y **no** un texto debajo del campo); al terminar se ven los valores nuevos.
4. Regresión: una entidad de **crédito** sigue mostrando "Pre aprobado" y "Cupo disponible"; la de renting no.

## Criterios de aceptación
- [ ] La tarjeta de renting muestra pago semanal y selector de plan (Semana · Mes · Trimestre).
- [ ] Los tres planes dan los pagos esperados para un mismo monto (25% más caro por semana, 6% menos por trimestre).
- [ ] En renting no aparecen "Pre aprobado" ni "Cupo disponible".
- [ ] Al cambiar el monto se ven los tres puntos en el número, sin el aviso de texto.
- [ ] Las entidades de crédito no cambiaron su comportamiento.

## Dependencias / contraparte
Las tarifas salen de la calculadora oficial de Motai (pestaña Renting) y se reprodujeron con diferencia menor a un peso. Si negocio ajusta los factores por plazo, es un cambio de configuración de la entidad, sin despliegue.

**Estado del despliegue al crear la tarea:** las etiquetas de cupo ya están publicadas en el ambiente de pruebas. Los planes con su pago semanal y los puntos de carga **están pendientes de despliegue**: hasta que salgan, los puntos 1, 2 y 3 de la validación no se pueden verificar todavía.
