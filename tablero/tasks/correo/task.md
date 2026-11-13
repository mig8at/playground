---
id: 130
title: "Correo"
clase: proyecto
nivel: miguel
stage: work
created: "2026-11-13T15:30:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Pendientes

- [x] ~~Entrar a Gmail con `bin/pg gmail login`~~ — 2026-11-13, como miguel@creditop.com, después de habilitar la Gmail
      API en el proyecto del cliente OAuth de Drive (800366725259).
- [x] ~~Dejarla de fondo con `make correo-install`~~ — 2026-11-13: `com.creditop.correo` activo.
- [x] ~~Reinstalar Cockpit (`make cockpit`) para que Correo aparezca en la barra~~ — 2026-11-13: en la barra, con los
      correos de Shopify a la vista (captura de la ventana con `make ui-shot COCKPIT=1`).
- [ ] Ver un aviso real: un correo nuevo de un remitente seguido que avisa en macOS y, al tocarlo, abre Correo en ese
      correo. Termina con el primero que llegue (la próxima respuesta del ticket 72090155 sirve).
- [ ] Afinar las búsquedas para que avisen sólo lo que importa: hoy «VTEX» trae también los avisos de pedidos de la
      tienda de pruebas (`ct.vtex.com.br`) y «Shopify» los de inicio de sesión y códigos (`mailer@shopify.com`).
      Termina con las búsquedas que Miguel decida, cambiadas desde la app.

## Objetivo

Correo: los correos de los remitentes que Miguel sigue (los trámites con Shopify y VTEX, para empezar), con aviso de
macOS cuando llega uno nuevo, sin tener que estar mirando Gmail. Una herramienta del playground personal de Miguel: no
es de CreditOp y no va a Jira. Esta tarea junta la historia de sus cambios (la pila) y lo que queda abierto; cómo
funciona está en su CLAUDE.md.

## Dónde se toca

`correo/` (servidor en Go e interfaz Vue), `connectors/gmail/` (la lectura de Gmail) y `cmd/pg/gmail.go`. Cómo
funciona: `correo/CLAUDE.md`.
