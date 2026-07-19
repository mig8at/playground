# backend-mcp

Qué es y cómo se usa está en `backend-mcp/README.md`. Acá va solo lo que tenés que saber **antes de correrlo**.

## Mirá contra qué BD apuntás (es lo primero)

- El target por defecto es **`dev`** (`main.go:54`) y `.env.dev` apunta al **RDS compartido**. Sin `--target local`, cada write pega en dev.
- **La guarda no protege nada en esta máquina**: `guardOK()` (`env.go:80`) exige `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`, pero `.env.dev:7` ya la trae y el arranque la exporta (`main.go:33` + `env.go:42`) → siempre da true. Ningún write te va a frenar; verificá el target vos.
- `--target local` apaga la guarda **por etiqueta, no por host** (`env.go:80`): nunca mira `E2E_DB_HOST`.
- Antes de `synth`/`synth-fill` corré `cryptocheck`: si `mac_valid=false`, el APP_KEY no es el del target y la fila Experian forjada no la lee nadie (`ops.go:28`).

## Qué escribe cada comando

Solo leen: `list · ecommerce · ecommerce-url · summary · cryptocheck · inplatform · offers · lenderconf · lendersbytype · branchdiag · modediag · reqdiag · grouprules · dcrules · rules · whois · bypassphones · userreqs`.

Reversibles (devuelven id o snapshot para deshacer): `seedpreapproval` (`ops.go:356`) · `branchrule-add`/`-del` (`ops.go:379`) · `create` (`db.go:98`, idempotente) · `assign`/`revoke` (`asesor.go:267`/`324`; el snapshot es UN archivo, solo revertís el último assign).

**IRREVERSIBLES** — hard delete con `FOREIGN_KEY_CHECKS=0` sobre 14 tablas hijas (`db.go:351`):

- `clean --identity`: borra por teléfono **OR** doc **OR** email de `E2E_SCRUB_*` (`db.go:334`). Si esas vars apuntan a alguien real en dev, se lo lleva puesto. Sin `--identity` solo mata el namespace `{seed}-%-test`.
- `scrubphone <tel>`: borra los users CLIENTE del teléfono (`asesor.go:160`; nunca asesores).
- `synth` sin `--keep`: borra el sintético al terminar (`ops.go:789`).
- `synth-fill <uReqID>`: **pisa la identidad** del user (doc/nombre/email/dob/age, `db.go:188`) y borra su fila Experian previa (`db.go:315`). Pasale un uReqID real y lo arruinás.

No confíes en el conteo que devuelven: `deleteUsers` ignora el error de cada DELETE y reporta `len(userIDs)`, no filas borradas (`db.go:367`) — un borrado parcial te informa éxito.

`notify` sin url postea al loopback del propio MCP, no al comercio (`ecommerce.go:32`); con url postea de verdad y marca `processed=1` (`ecommerce.go:76`).

## Sintéticos: todo el buró es forjado

`synth`/`synth-fill` no llaman a ninguna central: inyectan identidad+`age`, `user_summaries`, fields 87/29/160 y la fila `risk_central_user_data` encriptada con el APP_KEY. El perfil de buró es **fijo e ideal** (`db.go:251`: 0 negativos, vector de TC limpio); `--income`/`--score` es lo único parametrizable. No hay KYC real, ni Experian, ni firma de documentos.

- El doc sale del **SEED**, no del caso (`db.go:162`): dos `synth` con el mismo `SEED` chocan y el segundo borra al primero (`ops.go:706`). `synth-fill` sí da un doc único por request (`ops.go:835`).
- `synth` usa el teléfono fijo `3131010101` (`ops.go:696`): tiene que estar en `qa_otp_bypass_phones`.

## No inyectes perfil para mover un rt=1

Inyectar KYC solo decide en lenders **in-platform rt=2/3** (`ops.go:220`). En rt=1 decide la API externa: el synth solo siembra la credencial para que el lender aparezca (`ops.go:745`, `db.go:230`), y lo único que finge la respuesta es `seedpreapproval` (`ops.go:353`).

## Correlo así

- **No uses el binario `creditop-mcp`**: es de Jun 12 y el fuente de Jun 22 — le faltan `seedpreapproval`, `branchrule-add` y `lendersbytype`. Usá `bash scripts/dev.sh <cmd>` (sourcea `.env.<target>` + `go run .`) o recompilá con `go build -o creditop-mcp .`.
- **No está registrado como MCP** en ningún `.mcp.json` ni en `~/.claude.json`: hoy es CLI. Los tools existen en `main.go` pero nadie los expone — no los invoques.
