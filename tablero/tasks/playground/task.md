---
id: 124
title: "Playground compartido"
clase: proyecto
nivel: playground
stage: work
created: "2026-11-13T12:30:00-05:00"
canon: []
jira: []
jira_title: ""
---

## Objetivo

Lo transversal del playground compartido: cómo se construyen y se despliegan sus herramientas, el home, el CLI `playground` y el acceso. Del playground COMPARTIDO de la compañía (`Creditop-SAS/playground`, clonado en `~/Desktop/CREDITOP/github/playground`): es de CreditOp, pero por ahora se trabaja en local y sin Jira. Cada herramienta de ese repo tiene su tarea (`canon`, `cuadrilla`, `tracer`, `forecast`…); lo del playground PERSONAL de Miguel está en `miguel`.

## Dónde se toca

El repo compartido: su `CLAUDE.md` raíz, `tools/home` y el CLI. Las decisiones de cómo se trabaja ahí: la memoria `playground-sesion-unica` y `push-en-tandas`.

## Pendientes

- **El home del playground compartido pierde su buzón en cada despliegue** (los mensajes pendientes, el padrón y los
  canales de avisos viven en una carpeta del contenedor). Los grupos del chat ya no: van en cuadrilla
  (Creditop-SAS/playground#434).
  - [ ] Darle al home un almacenamiento propio (Postgres, Mongo o S3, lo más simple) y un driver del buzón para él.
    Termina con un despliegue del home que no pierde un mensaje pendiente. Depende de: Miguel — verlo con infra.


- **Acceso a las herramientas del playground compartido** (mergeado en `Creditop-SAS/playground#316`;
  el código está en producción, falta la configuración):
  - [ ] Activar el login de GitHub del home: se sabe que terminó cuando la galería muestra «Entrar con
    GitHub» encendido en cuadrilla. Depende de: infra (Dani) — una OAuth App de la organización con
    callback `https://playground.creditop.com/api/github/callback`, `GITHUB_CLIENT_ID` y
    `GITHUB_CLIENT_SECRET` en `prod/home`, y redesplegar el home.
  - [ ] Destrabar `/api/*` desde la terminal: se sabe que terminó cuando un `curl` con VPN a
    `https://canon.playground.creditop.com/api/topics` contesta 200 en vez de 302. Depende de: infra
    (Dani) — una regla por subdominio con prioridad sobre la de Google: host + path `/api/*` + IP de
    origen de la VPN → forward sin autenticación. Falta que diga el CIDR de la VPN.
  - [ ] Decidir si se activa el token de la terminal (regla `jwt-validation`, `CONSOLA_LLAVE`): sólo
    hace falta para entrar sin VPN; mientras la regla de la VPN alcance, queda sin aplicar.
