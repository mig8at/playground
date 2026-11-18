# vault — el Llavero

**Para qué existe:** guardar las llaves de Miguel que NO se comparten, ordenadas en llaveros, y que Claude las pueda
usar sin verlas (Miguel, 2026-11-18). Nació como una sección del engranaje de Cockpit y pasó a app propia el mismo día:
con 31 llaveros y 453 llaves, ahí se veía muy chico.

`make vault` (UI :5236 · API :5237) o la app **Llavero** de Cockpit. A la izquierda los **grupos** (Servicios,
Ambientes, Playground, Repos…: lo que va antes de « · » en el nombre, si lo comparten varios; un repo en minúscula va a
Repos); al centro los **llaveros como tarjetas**, con sus primeras llaves. Abrir una muestra sus llaves: «Ver» trae el
valor por 20 s, «Copiar» lo copia, y la papelera borra con dos toques (la de una tarjeta borra el llavero entero).
Doble clic renombra un llavero o una llave. Al pie de los grupos, **Exportar** e **Importar**. Rutas: `#/g/<grupo>`,
`#/r/<id del llavero>`, `#/export`, `#/import`.

## Por consola (lo que usa Claude; no necesita este servidor)

    bin/pg vault list                                   llaveros, nombres y huellas; nunca un valor
    bin/pg vault run --ring R -- <comando>              el comando recibe las llaves como variables de entorno
    bin/pg vault import-env --ring R --file .env [--only A,B | --except A,B]   un .env entero, sin mostrar valores
    pbpaste | bin/pg vault set --ring R --key NOMBRE
    printf '%s\n' '<contraseña>' | bin/pg vault import --file llavero.zip [--replace]

`get --reveal`, `env --reveal` y `export` son para Miguel en su terminal: el hook `vault-guard` se los niega a una
sesión de Claude, igual que pedirle a esta API un valor o el zip.

## Dónde se guarda

Fuera del repo, así que git no lo ve (no hace falta `.gitignore`): `~/.config/creditop-cockpit/vault.json` (600, cada
valor cifrado) y la llave personal `~/.config/creditop/personal-key` (600, se crea con la primera llave). Es la de
Miguel, no la del equipo: ésa la tiene todo el equipo (decisión de Miguel). El formato es el de `openssl enc`, como el
llavero del chat. La librería es `lib/vault`; el archivo se reescribe entero bajo un candado entre procesos.

**Qué hay** (2026-11-18, cargado con `import-env` desde los `.env` de my-tools y de los repos, sin repetir): un llavero
por servicio, uno por ambiente con lo de los conectores y el harness juntos (`Ambiente · local|dev|qa|staging|prod`),
uno por repo con su `.env` de trabajo y uno por herramienta del playground del equipo. Las copias viejas de los repos
(`.env.antes-*`, `.env.bak-*`) no se cargaron; los microservicios no tienen `.env` en esta máquina. **Los `.env` siguen
siendo de donde LEEN las herramientas**: el llavero es una copia cifrada para `vault run` y para otra máquina. Si una
llave cambia en su `.env`, se vuelve a correr `import-env` (deja igual lo igual y actualiza lo distinto).

**Otra máquina**: «Exportar» deja `~/Downloads/llavero-<fecha>.zip` con cada valor cifrado con una contraseña que se
elige ahí, NO con la llave personal (que no viaja); «Importar» lo trae con esa contraseña, crea lo que falta y no pisa
una llave con otro valor salvo que se marque. Una contraseña mala no escribe nada.

## Lo que hay que saber al cambiarlo

- ⚠ **La API devuelve valores** (ver, copiar, exportar), así que cada pedido lleva `X-Vault: 1` (un navegador no lo
  manda desde otro origen sin preguntar, y acá nadie contesta esa pregunta) y un Host de esta máquina (contra una página
  que se hace pasar por localhost). `server/main_test.go` lo comprueba. Vite hace de proxy con `changeOrigin: false`
  para que el Host siga siendo `localhost`.
- **El cifrado no esconde nada de un agente con consola**: la llave está en el mismo disco. Lo que hace que Claude no vea
  un valor es que nada lo imprime sin pedirlo y el hook `vault-guard` (`tablero/server/internal/hooks/vault_guard.go`).
  Es un freno para el descuido, no un muro. Y frena también un comando de shell que sólo NOMBRA esas cosas en una línea
  (un heredoc con esta documentación): eso se escribe con las herramientas de edición o desde un archivo.
- **«Copiar» dentro de Cockpit**: la app es un iframe y el portapapeles moderno puede no estar; cae al viejo
  (`execCommand`), que anda con el clic.
- **Exportar escribe en Descargas desde el servidor**: un iframe de Cockpit no descarga. `VAULT_EXPORT_DIR` lo cambia
  (las pruebas, para no dejar zips en Descargas).
- Para probar la interfaz sin el llavero de verdad: el servidor con `CREDITOP_VAULT_FILE`, `CREDITOP_PERSONAL_KEY_FILE`
  y `VAULT_EXPORT_DIR` apuntando a una carpeta de prueba.

| pieza | dónde |
|---|---|
| la API | `server/main.go` (pruebas en `server/main_test.go`) |
| la interfaz | `src/App.vue` · `src/style.css`, con la base de `tools/ui` (`make style-sync`) |
| el cifrado, los llaveros, importar `.env` y el zip | `lib/vault` |
| los comandos de consola | `cmd/pg/vault.go` |
