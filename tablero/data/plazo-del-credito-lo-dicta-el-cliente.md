---
id: 66
title: "El plazo del crédito lo dicta el cliente: confirmar el plan no valida contra lo simulado"
stage: work
created: "2026-08-23T16:30:00-05:00"
context_nodes: [findings, credifamilia]
jira: []
jira_title: "Validar el número de cuotas contra el plan simulado al confirmarlo"
---

**ESTADO 2026-08-23.** Salió de perseguir el estado 11 con Credifamilia (tarea 65). El hallazgo del
sistema es **F-167**.

## Qué se verificó

El endpoint que confirma el plan de pagos recibe **dos** campos con el número de cuotas y trata a los
dos mal:

- `selected_cycle.fee_number` **se valida** con `required|integer|min:1` — o sea cualquier entero
  positivo, no uno de los plazos que la simulación devolvió para esa solicitud.
- `fee_number` de primer nivel **no aparece en las reglas**, y es **el que el controlador usa**
  (`PaymentScheduleController:138` → `feeNumber: $request->fee_number`).

**Reproducido:** con la entidad simulando 6, 12, 18 y 24, se confirmó con **36**. La solicitud cerró en
estado 11 y quedó con `user_requests.fee_number = 36`. Nada lo objetó.

## Por qué importa

El número de cuotas no es cosmético: determina el valor de la cuota, el plan de pagos y lo que dice el
pagaré. Si lo elige el cliente y no la entidad, el título puede quedar emitido por un plazo que nadie
aprobó.

## Lo que NO se puede afirmar todavía

**Que haya pasado en producción.** En 180 días Credifamilia muestra 36 (409), 24 (321), 6 (123),
12 (52), 18 (43), 9 (12), y una cola de **4 (6) y 3 (4)**. Los 35 en `0` son solicitudes que nunca
eligieron plazo, no un plazo raro. Esas diez filas de la cola **podrían** ser el hueco ejercido o un
catálogo que en su momento las ofrecía — no se sabe qué plazos estaban vigentes al crearlas.

**Lo primero de esta tarea es contestar eso**, porque cambia la urgencia: si son legítimas, esto es
endurecer una validación; si no, hay créditos emitidos por plazos no aprobados. Se contesta cruzando la
fecha de cada una contra el catálogo de plazos vigente entonces.

## Bitácora

- **2026-08-23** — encontrado arreglando el runner de casos, que tenía el mismo hueco al revés: pedía
  un plazo y cerraba con otro sin decirlo.

## Tarea (publicable)

**En una línea.** Al confirmar el plan de pagos, el número de cuotas que llega desde el navegador se
guarda tal cual, sin comprobar que sea uno de los que se le ofrecieron al cliente.

**Por qué.** El número de cuotas determina el valor de la cuota, el plan de pagos y el contenido del
título valor. Hoy se acepta cualquier número positivo, así que un crédito puede quedar registrado con
un plazo que la entidad no aprobó. Además la petición trae el dato dos veces: se comprueba una copia y
se usa la otra.

**Qué cambia.** El plazo se valida contra los plazos que la simulación devolvió para esa misma
solicitud, y se pasa a usar un único campo.

**Alcance.** El paso de confirmación del plan de pagos. No cambia qué plazos se ofrecen ni cómo se
calculan.

**Dónde probar.** Local o staging.

**Cómo validar.** Confirmar el plan con un número de cuotas que no esté entre los ofrecidos y comprobar
que se rechaza. Confirmar con uno ofrecido y comprobar que sigue funcionando igual.

**Criterios de aceptación.** Un plazo fuera de los ofrecidos se rechaza con un mensaje claro. Los
plazos ofrecidos siguen funcionando sin cambios.

**Dependencias.** Antes de decidir la urgencia hace falta revisar si ya hay créditos con plazos fuera
de catálogo.
