---
id: 133
title: "Llavero: las llaves que no se comparten"
clase: proyecto
nivel: miguel
stage: work
created: "2026-11-18T17:30:00-05:00"
jira: []
jira_title: ""
---

## Pendientes

- [x] ~~El llavero cifrado con una llave propia, por consola y con el freno para Claude~~ — 2026-11-18.
- [x] ~~Cargar los `.env` de my-tools y de los repos, sin repetir~~ — 2026-11-18: 31 llaveros, 453 llaves, comprobadas
      contra cada archivo.
- [x] ~~Exportar e importar en un zip con contraseña~~ — 2026-11-18.
- [x] ~~La app propia, con tarjetas~~ — 2026-11-18.
- [x] ~~La app en la barra de Cockpit~~ — 2026-11-18: después de `make cockpit`, con los 31 llaveros y sus grupos.
- [ ] «Copiar» dentro del iframe de Cockpit; termina cuando copiar una llave pega el valor en otro lado.
- [ ] Traer el zip en otra máquina; termina con un import real que deje los llaveros y las llaves iguales.

## Objetivo

Que Miguel tenga sus llaves (las de los servicios, los ambientes y los repos) en un solo lugar, cifradas, ordenadas en
llaveros, que Claude las use sin verlas y que se lleven a otra máquina.

## Dónde se toca

`lib/vault` (cifrado, llaveros, importar `.env`, el zip), `cmd/pg/vault.go` (la consola), `vault/` (la app),
`tablero/server/internal/hooks/vault_guard.go` (el freno). Cómo se usa: `vault/CLAUDE.md`.

## Lo que se evaluó y NO se eligió

- **Cifrar con la llave del equipo**: la tiene todo el equipo; cualquiera que viera un valor cifrado lo abriría.
- **Que las herramientas lean del llavero en vez de su `.env`**: un cambio grande sobre los conectores, el harness y
  ecommerce. Por ahora el llavero es una copia cifrada y los `.env` siguen mandando.
- **Una sección en el engranaje de Cockpit**: fue la primera versión; con 31 llaveros se veía muy chico.
- **Mover una llave de llavero desde la interfaz**: Miguel no le vio uso; queda por consola.
