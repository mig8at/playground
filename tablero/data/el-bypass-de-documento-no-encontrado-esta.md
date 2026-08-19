---
id: 52
title: "El bypass de «documento no encontrado» está prendido para TODOS los comercios en producción"
stage: evaluation
created: "2026-08-18T20:15:00-05:00"
context_nodes: [kyc]
jira: []
jira_title: "Originación: revisar si la excepción global de documento no encontrado sigue siendo la política deseada"
---

**ESTADO 2026-08-18 · MEDIDO, sin tocar nada.** Salió de pasarle el flujo de KYC completo a un agente
de Gemini; el hallazgo es suyo, la verificación y la medición son a mano. **No es un bug: es una
configuración que alguien puso.** Lo que hay que decidir es si sigue siendo la política que se quiere.

## Qué dice el código

`OnboardingService.php:484-490` — cuando TusDatos responde con el desenlace `DOCUMENT_NOT_FOUND`, en
vez de rechazar consulta `shouldBypassKycDocumentNotFound($user_request)` y, si da `true`, ejecuta
`applyFormProvidedIdentity(...)` y **la solicitud continúa con el nombre que tecleó el asesor**.

El guard (`:1132-1159`) tiene tres formas de decir que sí: `all`, una lista de `allied`, o una de
`allied_branch_hash`.

## Qué está configurado en PRODUCCIÓN (leído el 2026-08-18)

```json
kyc_document_not_found_bypass = { "allied_branch_hash": [], "allied": [], "all": true }
```

Las dos listas están vacías, pero **`all` está en `true`**: el bypass aplica a **todos los comercios**.

⚠ La fila no tiene `created_at` ni `updated_at`, así que **no se puede saber cuándo se prendió ni
quién**. Si fue una medida temporal —por ejemplo, un bache de datos de la Registraduría— no quedó
rastro de la fecha para revisarla.

## Cuánto pasa

Contado en Loki sobre prod, expresión métrica (no muestra), ventana de 24h:

```
«TusDatos DOCUMENT_NOT_FOUND bypassed by config»  ....  4
(denominador: todos los warning de legacy-backend)  ....  1.365
```

**Cuatro solicitudes por día** —del orden de 120 al mes— avanzan con una cédula que TusDatos reporta
como inexistente ante la Registraduría, y se guardan con el nombre del formulario.

## Qué NO es

- **No** cubre el «el nombre no coincide»: eso sigue rechazando con `ONB005`. El bypass es sólo para
  el desenlace `DOCUMENT_NOT_FOUND`.
- **No** es silencioso: deja un `warning` con `allied.id` y `allied_branch.id`, que es justamente lo
  que permitió contarlo. Eso está bien hecho.

## La pregunta para el equipo

¿`all: true` sigue siendo lo que se quiere? Hay lecturas razonables para tenerlo prendido —la fuente
registral tiene huecos y rechazar a todos podría costar más de lo que evita— pero conviene que sea una
decisión con fecha, no una que nadie recuerda haber tomado. Si la respuesta es «sí pero sólo para
algunos», el mecanismo ya soporta listas por comercio y por sucursal.

**Antes de cambiarlo**: los 4/día tienen nombre y comercio en el log; conviene mirar quiénes son antes
de apagarlo, no después.
