# Connectors

Cada servicio tiene un dueño aquí. Las herramientas llaman al conector; no mantienen clientes ni copias de credenciales o sesiones.

## Login y sesiones

- `admin/`: HTTP, CSRF y sesión de Laravel. `local-session` y `local-session.php` emiten sesión sólo con `APP_ENV=local`.
- `advisor/`: login clásico o de dos pasos de Cognito, persistencia de navegador, salud por cookies y renovación por `/merchant`.
- `auth/`: lector de credenciales, formato y rutas de sesión, cookies aplicables y runtime de navegador.
- `connectors/.env.<ambiente>`: `ADMIN_USER/PASS` (una cuenta por persona) y `ALLIED_TEST_ADVISOR_PASSWORD`, la clave compartida de los asesores de prueba de ese ambiente. Prioridad del lector TS: proceso no vacío > ambiente > compartido. Los valores antiguos sólo producen avisos, nunca se usan para entrar.
- **El asesor es el de prueba de cada comercio** (`c<hash>-fake@creditop.com`, lo crea el alta del comercio; tarea #98), no una cuenta de persona: `advisorSession(target, origin, cuenta)` entra con esa cuenta y la clave compartida del pool del front, y guarda una sesión **por cuenta** (`--account` en `pg advisor status|login|logout`). `ADVISOR_USER/PASS` quedó como respaldo sin cuenta; se retiró de los `.env` el 2026-10-06.
- `connectors/.auth/sessions/`: único estado privado. Directorio 700 y archivos 600, fuera de git. Guarda identidad, ambiente, origen, fecha, cookies y `origins` de Playwright; los campos adicionales son compatibles con su `storageState`.

```sh
bin/pg admin status --target local --json
bin/pg advisor status --target local --json
bin/pg advisor login --target local
bin/pg advisor logout --target local
```

`login` lo corre una persona; ni admin ni asesor lo ofrecen por MCP. `status` no imprime secretos. `make harness-login`, `harness-session`, `harness-signin` y `harness-signout` conservan sus nombres y delegan al conector. El panel conserva el pre-login y los adapters de `harness/pkg/`; no hay un segundo almacén.

El ambiente de autenticación lo decide el front, independientemente del backend. El front conocido `localhost:5174`/`127.0.0.1:5174` usa dev; si se configura otro pool allí se declara `ADVISOR_AUTH_TARGET=qa|staging|dev`. Los demás orígenes usan el target. La ruta de asesor incluye esquema, host y puerto; no compartir sesiones sólo por hostname. Cambiar la cuenta configurada impide reutilizar la sesión anterior. Cambiar el pool del front exige cerrar su sesión y entrar de nuevo.

## Migración y runtime

Admin importa una vez su archivo anterior con identidad y metadatos válidos, sin borrar el respaldo. Un marcador impide resucitarlo después de logout. Las cachés Cognito antiguas sin identidad no se importan ni se borran: hace falta un primer login con las credenciales elegidas en connectors. A partir de ahí, consola, casos, caminador y panel leen el mismo archivo.

Node ejecuta TS (runtime local actual: Node 25). El navegador usa `playwright-core` de la instalación existente en `harness/node_modules`, resuelta por `auth/browser.ts`; no importa configuración, DB ni lógica del harness. No se instala una segunda copia de Playwright. Los wrappers antiguos siguen disponibles.

La renovación sólo actualiza la sesión de la misma cuenta; conserva localStorage. Una respuesta que vuelve al login no sobrescribe el archivo. `repin` omite `_at` de la petición para releer sucursal; no borra el token guardado si el servidor no entrega reemplazo. La fecha del refresh token permite intentar renovar, no garantiza su validez. Un HTTP 500 da estado indeterminado, no sesión vencida.

## Validación

```sh
GOCACHE=/private/tmp/creditop-knowledge-go-cache go test ./connectors/admin ./cmd/pg
cd harness && npm run typecheck
cd harness && E2E_TARGET=local npx playwright test pkg/connector-auth.spec.ts pkg/cognito.spec.ts pkg/sessions.spec.ts pkg/login-probe.spec.ts bin/preflight.spec.ts --workers=2 --reporter=list
```

Fixtures en loopback, identidad ficticia y servidores efímeros; no usar contraseñas reales para validar el refactor. Las sondas de asesores de prueba no persisten estado en la sesión de trabajo. Los tests restauran las variables de entorno y cierran sus servidores y contextos.
