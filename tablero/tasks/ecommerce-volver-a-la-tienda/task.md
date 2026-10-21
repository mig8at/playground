---
id: 104
title: "Ecommerce: volver a la tienda cuando no hay opciones de financiamiento"
stage: work
created: "2026-10-21T10:33:00-05:00"
knowledge: [ecommerce-context, lender-listing]
canon: []
jira: []
jira_title: "Ecommerce: volver a la tienda cuando no hay opciones de financiamiento"
ramas: "fix/ecommerce-volver-a-la-tienda"
---

## Pendientes

- [x] ~~Pintar «Volver a la tienda» al final del listado en los dos vacíos~~ — en `frontend-monorepo#1188`.
- [x] ~~Llevar el link al `back_url` (respaldo: `return_url`), como pidió Oscar~~ — backend
      [#1707](https://github.com/Creditop-SAS/legacy-backend/pull/1707) acepta `b` y devuelve `backUrl`; #1188
      lo usa (`cc04ba21`). Probado en local de punta a punta.
- [ ] Responder la revisión de Oscar en #1188 y pedirle una nueva revisión de los dos PRs.
      Depende de: Miguel — revisar los PRs antes.
- [ ] Contraprueba por el canal de asesor sin entidades: el link no sale. Hasta hoy sólo Storybook y la prueba de
      `showsBackToStore`.
- [ ] Mergear `legacy-backend#1707` y `frontend-monorepo#1188` y taguear; termina cuando el link sale en producción
      en una compra de tienda sin opciones. Depende de: revisión del equipo.
- [ ] Crear el issue en Jira con la publicable.
      Depende de: Miguel — revisar la publicable.

## Objetivo

Un comprador que llega desde la tienda al listado y no tiene ninguna opción de financiamiento ve, debajo del
aviso, un link «Volver a la tienda» que lo devuelve al `back_url` de su pedido (o a su `return_url` si la tienda no
mandó `back_url`, como dice el contrato v1.0.2). En los otros canales, y cuando el pedido no trae ninguna, la
pantalla queda como está.

## Dónde se toca

**frontend-monorepo** (va directo a `main`)
- `apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx`: el loader ya resuelve
  `getEcommerceContextByLoanRequest(loanRequestId)` para saber si es tienda; de ese contexto sale también
  `returnUrl`. Se devuelve y se pasa a `AvailableLenders`.
- `modules/loan-request-wizard/lenders-marketplace/src/components/available-lenders/AvailableLenders.tsx`:
  los dos avisos naranjas —el de sin entidades (`!hasAvailableLenders`) y el vacío total (`isTrueEmpty`)—.
  El `isSoftEmpty` (ninguna pre-aprobada, pero hay tarjetas de probabilidad baja) NO lleva el link: tiene
  opciones.
- `apps/loan-request-wizard/app/server/services/ecommerce-context.server.ts`: `EcommerceContext.returnUrl`.
- Referencia del filtro de la URL: `routes/bancolombia/ecommerce/checkout-error.tsx` (`toSafeExitUrl`).

## Cómo se ataca

1. El loader devuelve `storeReturnUrl` sólo si es tienda y la URL es `http`/`https`; si no, `null`.
2. El componente recibe la prop y, si viene, pinta el link debajo del aviso en los dos vacíos.

## Lo que se evaluó y NO se eligió

- Ponerlo también en el `isSoftEmpty`: hay entidades con las que se puede solicitar, así que mandar al
  comprador de vuelta compite con esas opciones.

## Lo que NO entra

- Los canales de asesor, autogestión y QR.

## Cómo se comprueba

`pnpm turbo run build --filter=loan-request-wizard` en la rama, y una compra de tienda en local cuyo
comercio no tenga entidades que la atiendan.

## Referencias

- Tarea #6 (`ecommerce-stateless`): el «Regresar al comercio» de la pantalla de desembolsado.


## Tarea (publicable)

## En una línea

Cuando un comprador que viene de la tienda no tiene opciones de financiamiento, puede volver a la tienda con
un clic.

## Por qué

Hoy el comprador ve «No encontramos una opción para ti» y la pantalla no le ofrece salida: tiene que volver
atrás a mano para terminar su compra con otro medio de pago.

## Qué cambia

Debajo del aviso aparece el link «Volver a la tienda», que lleva a la dirección de «otros medios de pago»
que la tienda mandó con el pedido o, si no la mandó, a su dirección de retorno.

## Alcance

Sólo el canal de tienda. Los demás canales no cambian, y si la tienda no mandó dirección de retorno el link
no aparece.

## Dónde probar

QA, con un comercio de tienda sin entidades que atiendan al comprador.

## Criterios de aceptación

- Compra de tienda sin opciones: el link aparece y lleva a la tienda.
- Compra de tienda con opciones: el link no aparece.
- Solicitud del asesor sin opciones: el link no aparece.
