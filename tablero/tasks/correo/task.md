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

- [ ] Entrar a Gmail una vez con `bin/pg gmail login` (la cuenta de Miguel, sólo lectura). Termina cuando
      `bin/pg gmail me` contesta con la cuenta. Si Google dice que la Gmail API no está habilitada, se habilita en el
      proyecto de Google Cloud del cliente OAuth de Drive.
      Depende de: Miguel — el login lo hace una persona.
- [ ] Dejarla de fondo con `make correo-install` y reinstalar Cockpit (`make cockpit`) para que aparezca en la barra.
      Termina con un correo de prueba de un remitente seguido que avisa en macOS y abre Correo al tocarlo.

## Objetivo

Correo: los correos de los remitentes que Miguel sigue (los trámites con Shopify y VTEX, para empezar), con aviso de
macOS cuando llega uno nuevo, sin tener que estar mirando Gmail. Una herramienta del playground personal de Miguel: no
es de CreditOp y no va a Jira. Esta tarea junta la historia de sus cambios (la pila) y lo que queda abierto; cómo
funciona está en su CLAUDE.md.

## Dónde se toca

`correo/` (servidor en Go e interfaz Vue), `connectors/gmail/` (la lectura de Gmail) y `cmd/pg/gmail.go`. Cómo
funciona: `correo/CLAUDE.md`.
