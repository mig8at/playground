# backend-e2e — reglas de operación

Qué es y cómo se usa vive en `README.md` + `docs/`. Acá va solo lo que puede romper algo.

## Antes de correr

- Corré desde `backend-e2e/` con `go run .` (Go 1.25.5, `go.mod:3`); no hay binario compilado.
- Si un flujo rt=2 falla en local, revisá los bypasses del legacy-backend antes de depurar: `doctor` los chequea por stash/working tree (`doctor.go:181-206`) y `docs/SUITE.md` los lista.
- **No le creas a `docs/DEV-TARGET.md` §1.** Dice que dev solo habilita `create`/`clean`/`kyc`; hoy `main.go:59` habilita además `list/get/doctor/login/scenarios` y `main.go:63` abre el **flujo completo** (`web/vtex/asesor/flow/aggregator/scenario/offer/perfilador`) con el guard. `kyc.go` ya no existe. Verificá contra el código.

## Target

- El default es `local` (`main.go:46`) — al revés que `frontend-e2e`. Acá no se usa `E2E_TARGET`: es `--target=dev` o `TARGET=dev` en `make`.
- `--target=dev` apunta al **RDS compartido del equipo** (`.env.dev`: `inertia-dev…rds.amazonaws.com`, user `admin`). No lo pases sin que te lo pidan.
- Nunca corras `--target=dev` sin sourcear `.env.dev`: sin esas env, `config.go:40-44` cae a la BD **local** y `config.go:45` a la API de **dev** → escribís mitad y mitad. Usá `scripts/dev.sh`.

## El guard `I_KNOW_THIS_TOUCHES_SHARED_DEV` está pre-armado — no te apoyes en él

`.env.dev:10` **y** `.env.local:11` lo exportan en `1`, y `Makefile:46` sourcea el `.env` del target en cada comando. Los checks de `clean.go:52`, `create.go:104` y `main.go:64` ya están satisfechos antes de que preguntes: `make dev …` y `make clean TARGET=dev` pegan al RDS compartido sin fricción. Tratá `--target=dev` como la única barrera real y escribilo a mano.

## Qué destruye cada cosa

- **El peligro es `database.Clean`, no el subcomando `clean`.** Corre incondicionalmente antes de cada flujo (`main.go:366,434,531,679,775,844` · `flow.go:266`), **no** consulta `IsShared()`, y borra `users WHERE cell_phone=? OR document_number=? OR email=?` + 20 tablas hijas (`pkg/database/database.go:31-72`) matcheando valores sintéticos **hardcodeados** (`config.go:21-22`, `main.go:441-443`). Contra dev se lleva puesto a cualquier usuario real que tenga ese teléfono/documento/email. No corras flujos contra dev salvo pedido explícito.
- **`clean` está acotado por seed pero se expande**: matchea por `SEED` (`clean.go:62-66`), toma las `user_requests` del asesor (`clean.go:69`) y borra también a sus **clientes**, que no llevan el marcador (`clean.go:130-132`). Va con `FOREIGN_KEY_CHECKS=0` y se traga los errores (`clean.go:123,125`).
- **Mutaciones de config globales que NO se revierten**: `UPDATE lenders SET response_type=3` (`lender/closes.go:20`, cualquier lender rt=3) · `UPDATE lenders SET available_until=NULL` (`lender/closes.go:169`, cualquier rt=1) · append al setting `qa_otp_bypass_phones` (`pkg/mocks/mocks.go:112-116`). Después de un flujo, asumí que la fila del lender quedó tocada.
- **`setup` pisa config**: `REPLACE INTO` sobre `allieds`/`allied_branches`/`lenders`/`settings` con ids fijos (`pkg/database/database.go:133-143`). No lo corras sobre el dump local que estés usando para investigar.
- **`doctor` no es read-only**: `doctor.go:166-178` POSTea `/onboarding/phone/register` con un teléfono random → crea registro en el backend apuntado.
- Read-only de verdad: `get`, `list`, `login`. `--explain` solo evita los pasos, igual resuelve contra la BD.

## Docker

`SeedApprovedProfile`/`SeedRiskProfile` hacen `docker exec … legacy-backend-laravel.test-1` (`pkg/mocks/mocks.go:37,100`) **ignorando `--target`**: con `--target=dev` sembrás el perfil en la BD local mientras el resto escribe en dev.
