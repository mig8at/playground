# Connectors

Cada servicio tiene un dueño aquí. Las herramientas llaman al conector; no mantienen clientes ni copias de credenciales o sesiones.

## Login y sesiones

- `admin/`: HTTP, CSRF y sesión de Laravel. `local-session` y `local-session.php` emiten sesión sólo con `APP_ENV=local`.
- `advisor/`: login clásico o de dos pasos de Cognito, persistencia de navegador, salud por cookies y renovación por `/merchant`.
- `auth/`: lector de credenciales, formato y rutas de sesión, cookies aplicables y runtime de navegador.
- `connectors/.env.<ambiente>`: `ADMIN_USER/PASS` (una cuenta por persona) y `ALLIED_TEST_ADVISOR_PASSWORD`, la clave compartida de los asesores de prueba de ese ambiente. Prioridad del lector TS: proceso no vacío > ambiente > compartido. Los valores antiguos sólo producen avisos, nunca se usan para entrar.
- **El asesor es el de prueba de cada comercio** (`c<hash>-fake@creditop.com`, lo crea el alta del comercio; tarea #98), no una cuenta de persona: `advisorSession(target, origin, cuenta)` entra con esa cuenta y la clave compartida del pool del front, y guarda una sesión **por cuenta** (`--account` en `pg advisor status|login|logout`). Sin cuenta no hay login: no existe una cuenta de persona para el asesor.
- `connectors/.auth/sessions/`: único estado privado. Directorio 700 y archivos 600, fuera de git. Guarda identidad, ambiente, origen, fecha, cookies y `origins` de Playwright; los campos adicionales son compatibles con su `storageState`.

```sh
bin/pg admin status --target local --json
bin/pg advisor status --target local --json
bin/pg advisor login --target local --account c<hash>-fake@creditop.com
bin/pg advisor logout --target local --account c<hash>-fake@creditop.com
```

`login` lo corre una persona; ni admin ni asesor lo ofrecen por MCP. `status` no imprime secretos. `make harness-login`, `harness-session`, `harness-signin` y `harness-signout` conservan sus nombres y delegan al conector. El panel conserva el pre-login y los adapters de `harness/pkg/`; no hay un segundo almacén.

El ambiente de autenticación lo decide el front, independientemente del backend. El front conocido `localhost:5174`/`127.0.0.1:5174` usa dev; si se configura otro pool allí se declara `ADVISOR_AUTH_TARGET=qa|staging|dev`. Los demás orígenes usan el target. La ruta de asesor incluye esquema, host y puerto; no compartir sesiones sólo por hostname. Cada cuenta tiene su archivo: la sesión de un comercio no sirve para otro. Cambiar el pool del front exige cerrar su sesión y entrar de nuevo.

## El CLI del playground compartido NO es un conector

`playground` (en `~/.local/bin`, del repo `Creditop-SAS/playground`, `cli/playground.js`) es el cliente del equipo: su
propio login por navegador (Google + GitHub) y su sesión en `~/.config/creditop-playground/`, no en `.auth/`. Se llama
directo —`playground whoami`, `playground canon search …`, `playground online`, `playground send @persona "…"`— y no
se envuelve en `bin/pg`: sería un segundo cliente del mismo servicio. Todo pasa por el home (`/api/t/<herramienta>/api/…`),
que llega a cada herramienta por la red interna.

**`canon/` usa la misma sesión.** Desde el 2026-10-21 llama a canon de producción por ese gateway
(`https://playground.creditop.com/api/t/canon`) con el token que deja `playground login` en
`~/.config/creditop-playground/token.json`, en `Authorization: Bearer`; la llave de escritura va en `x-canon-key`. Ya no
hay cookies del navegador que copiar: `AUTH_GOOGLE` y `PLAYGROUND_SESION` se sacaron de `.env.prod`. Sin sesión vigente,
`make canon-*` y `pg canon yo` dicen «corré `playground login`».

## Google Drive: con la cuenta de quien entra, sólo lectura

`drive/` lee Drive con el OAuth de escritorio de una persona (PKCE, redirección a `127.0.0.1`) y el alcance
`drive.readonly`: ve lo mismo que esa cuenta en drive.google.com y Google no lo deja escribir. El cliente OAuth
(`DRIVE_CLIENT_ID`, `DRIVE_CLIENT_SECRET`) va en `connectors/.env`; el refresh token, en `connectors/.auth/drive.json`
(600). `login` y `logout` los corre una persona y no están en el MCP.

Para crear el cliente, una vez: en Google Cloud, un proyecto con la **Google Drive API** habilitada, la pantalla de
consentimiento como **Interna** (sólo cuentas de creditop.com) y una credencial OAuth de tipo **App de escritorio**.

```sh
bin/pg drive login                                   # abre el navegador
bin/pg drive ls 'https://drive.google.com/drive/folders/<id>'
bin/pg drive search --q 'Finandina' [--folder <URL>]
bin/pg drive read <URL|id>                           # Doc → Markdown · Sheet → CSV (1.ª hoja) · Slides → texto
bin/pg drive read <URL|id> --out /ruta/              # PDF, xlsx, docx… se bajan
```

⚠ Hay carpetas compartidas con credenciales de terceros (la de Finandina tiene dos archivos así): lo que se lee de
Drive no se copia a tareas, `knowledge/` ni Canon sin mirar qué es.

## Dar de baja un cliente de prueba

`pg admin client-disable --target local|dev|staging --document <cédula> [--apply]` hace lo mismo que la papelera de
**Usuarios** del admin (`UserController::disableUser`): `status 0`, la cédula con `-t<n>` y sin correo, celular ni
`cognito_id`. Sirve para repetir un registro con la misma cédula y que las centrales se consulten otra vez. ⚠ La lista
de Usuarios NO filtra por rol y su búsqueda es una regexp: `1031138508` también trae al Administrador `2-1031138508`.
Por eso sólo actúa sobre la cuenta ACTIVA con la cédula EXACTA y `user_profile_id = 1`. Sin `--apply` muestra con
quién actuaría. Producción la rechaza `BaseFor`, como todo el conector; qa se corre contra dev.

## Migración y runtime

Admin importa una vez su archivo anterior con identidad y metadatos válidos, sin borrar el respaldo. Un marcador impide resucitarlo después de logout. El asesor no tiene archivo anterior: su sesión nace con el primer login del asesor de prueba. A partir de ahí, consola, casos, caminador y panel leen el mismo archivo.

Node ejecuta TS (runtime local actual: Node 25). El navegador usa `playwright-core` de la instalación existente en `harness/node_modules`, resuelta por `auth/browser.ts`; no importa configuración, DB ni lógica del harness. No se instala una segunda copia de Playwright. Los wrappers antiguos siguen disponibles.

La renovación sólo actualiza la sesión de la misma cuenta; conserva localStorage. Una respuesta que vuelve al login no sobrescribe el archivo. `repin` omite `_at` de la petición para releer sucursal; no borra el token guardado si el servidor no entrega reemplazo. La fecha del refresh token permite intentar renovar, no garantiza su validez. Un HTTP 500 da estado indeterminado, no sesión vencida.

## Validación

```sh
GOCACHE=/private/tmp/creditop-knowledge-go-cache go test ./connectors/admin ./cmd/pg
cd harness && npm run typecheck
cd harness && E2E_TARGET=local npx playwright test pkg/connector-auth.spec.ts pkg/cognito.spec.ts pkg/sessions.spec.ts pkg/login-probe.spec.ts bin/preflight.spec.ts --workers=2 --reporter=list
```

Fixtures en loopback, identidad ficticia y servidores efímeros; no usar contraseñas reales para validar el refactor. Las sondas de asesores de prueba no persisten estado en la sesión de trabajo. Los tests restauran las variables de entorno y cierran sus servidores y contextos.
