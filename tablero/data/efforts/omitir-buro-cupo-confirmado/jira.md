---
title: "Confirmación de cupo: omitir la consulta al buró cuando el cliente ya tiene cupo aprobado"
---

Por qué

Cada consulta a la central de riesgo tiene un costo para la compañía. Cuando el cliente ya cuenta con cupo aprobado en otras entidades, esa consulta no aporta información nueva a la decisión: el cupo ya viene confirmado desde afuera.

Qué se resuelve

Al iniciar la solicitud, y solo en los comercios habilitados para esto, se le pregunta al asesor si el cliente ya tiene cupo disponible en las entidades correspondientes. Si responde que sí, la solicitud queda marcada con el flujo de cupo ya confirmado y, a partir de ese punto, no se consulta la central de riesgo en ninguna de sus variantes.

Como el supuesto de este flujo es que ese cupo proviene de una entidad sin integración directa, la lista de opciones que se le muestra al cliente se acota a ese tipo de entidades.

Alcance

- La pregunta aparece únicamente en comercios habilitados; en el resto el flujo continúa igual.
- La marca del flujo se aplica una vez validado el ingreso del cliente.
- Si por cualquier motivo la marca no se aplica, la solicitud sigue por el camino estándar (con consulta): el onboarding nunca se bloquea.

Contraparte de backend

El desarrollo de backend lo realizó Jose y ya está integrado. Además de la omisión por flujo, incorpora un control de frecuencia de consultas por comercio que limita cuántas veces se consulta la central de riesgo.

Cómo validar

Con un comercio habilitado, iniciar una solicitud y responder que el cliente sí tiene cupo: la solicitud debe quedar marcada con el flujo correspondiente, no debe registrarse consulta a la central, y la lista de opciones debe mostrar solo entidades sin integración directa. Respondiendo que no, el comportamiento debe ser el estándar.
