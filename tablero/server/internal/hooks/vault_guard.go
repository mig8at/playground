package hooks

/* vault_guard.go · PreToolUse sobre Bash, Read y Grep: que una sesión de Claude no vea los valores del llavero
 * personal (lib/vault, Cockpit → engranaje → «Llavero»).
 *
 * El llavero está cifrado, pero la llave personal está en el mismo disco: un agente con consola la puede usar. Lo que
 * hace que Claude no vea un valor es que nada lo imprime sin `--reveal`, y este hook, que niega:
 *   - `pg vault get|env … --reveal` (es para Miguel, en su terminal);
 *   - cualquier cosa que nombre la llave personal (`personal-key`): leerla, pasársela a openssl, buscar en ella.
 *
 * Para USAR una llave sin verla está `pg vault run --ring R -- <comando>`, que no se frena.
 *
 * ⚠ Es un freno para el descuido, no un muro: un agente decidido a saltarlo puede. Lo que se quiere es que ningún
 * camino normal muestre un valor y que el que lo intente reciba el camino bueno. */

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	vaultRevealRe = regexp.MustCompile(`\bvault\s+(get|env)\b[^|;&]*\s-{1,2}reveal\b`)
	// Exportar: quien elige la contraseña del zip puede abrirlo. Lo hace Miguel, desde Cockpit o su terminal.
	vaultExportRe = regexp.MustCompile(`\bvault\s+export\b`)
	// La API de la app Llavero (vault/server, :5236 por Vite y :5237 directo) también devuelve valores y el zip.
	vaultAPIRe    = regexp.MustCompile(`(127\.0\.0\.1|localhost):523[67]\S*/api/(export|rings/\S*/reveal)`)
	personalKeyRe = regexp.MustCompile(`personal-key\b`)
	// Usar la llave personal en una línea de shell: un lector antes de ella (en la misma línea), `file:` (openssl) o
	// una redirección. Nombrarla sin más (un texto, un comentario dentro de un archivo que se escribe) no frena: frenaba
	// escribir el código del propio llavero (2026-11-18).
	personalKeyUseRe = regexp.MustCompile(`(?m)(\b(cat|head|tail|less|more|bat|xxd|od|hexdump|base64|strings|cp|mv|scp|rsync|ln|grep|rg|awk|sed|cut|tr|openssl|security|pbcopy|nc|curl)\b[^\n|;&]*|file:\S*|<\s*\S*|\$\(<\s*\S*)personal-key\b`)
)

// VaultGuardIn devuelve por qué se niega, o "" si pasa.
func VaultGuardIn(tool string, input map[string]any) string {
	switch tool {
	case "Bash":
		cmd := str(input, "command")
		if vaultRevealRe.MatchString(cmd) {
			return "`pg vault get|env --reveal` imprime valores del llavero personal: es para Miguel, en su terminal. " +
				"Para usar las llaves sin verlas: `bin/pg vault run --ring <llavero> -- <comando>` (con $VAR: `-- sh -c '…'`)."
		}
		if vaultAPIRe.MatchString(cmd) {
			return "la API del Llavero devuelve valores (ver, copiar, el zip): es para la app, que la maneja Miguel. " +
				"Para usar las llaves sin verlas: `bin/pg vault run --ring <llavero> -- <comando>`."
		}
		if vaultExportRe.MatchString(cmd) {
			return "`pg vault export` cifra el llavero con una contraseña que elige quien lo corre, y con ella se abre: es para Miguel " +
				"(Cockpit → engranaje → Llavero → Exportar, o su terminal)."
		}
		if personalKeyUseRe.MatchString(cmd) {
			return "la llave personal (~/.config/creditop/personal-key) abre el llavero de Miguel: no se lee ni se usa desde una sesión. " +
				"Para usar las llaves: `bin/pg vault run --ring <llavero> -- <comando>`."
		}
	case "Read", "Grep":
		for _, field := range []string{"file_path", "path"} {
			if personalKeyRe.MatchString(str(input, field)) {
				return "la llave personal (~/.config/creditop/personal-key) abre el llavero de Miguel: no se lee desde una sesión."
			}
		}
	}
	return ""
}

// VaultGuard es el hook.
func VaultGuard(env Env) int {
	payload, ok := readPayload(env.Stdin)
	if !ok {
		return 0
	}
	tool, _ := payload["tool_name"].(string)
	why := VaultGuardIn(strings.TrimSpace(tool), toolInput(payload))
	if why == "" {
		return 0
	}
	fmt.Fprintf(env.Stderr, "⛔ Bloqueado por el hook vault-guard (tablero/server/internal/hooks/vault_guard.go): %s\n", why)
	return 2
}
