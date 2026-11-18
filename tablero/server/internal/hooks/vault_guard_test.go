package hooks

import "testing"

func TestVaultGuard(t *testing.T) {
	cases := []struct {
		tool, field, value string
		blocked            bool
	}{
		{"Bash", "command", "bin/pg vault get --ring vtex --key APP_KEY --reveal", true},
		{"Bash", "command", "bin/pg vault get --ring vtex --key APP_KEY -reveal | pbcopy", true},
		{"Bash", "command", "bin/pg vault env --ring vtex --reveal > .env", true},
		{"Bash", "command", "openssl enc -d -aes-256-cbc -pass file:$HOME/.config/creditop/personal-key", true},
		{"Bash", "command", "cat ~/.config/creditop/personal-key", true},
		{"Read", "file_path", "/Users/x/.config/creditop/personal-key", true},
		{"Grep", "path", "/Users/x/.config/creditop/personal-key", true},
		{"Bash", "command", "printf '%s\\n' x | bin/pg vault export --out /tmp/l.zip", true},
		{"Bash", "command", "curl -s -X POST -H 'X-Vault: 1' http://127.0.0.1:5237/api/rings/slack/keys/SLACK_BOT_TOKEN/reveal", true},
		{"Bash", "command", "curl -s -H 'X-Vault: 1' -d '{}' localhost:5236/api/export", true},
		// Lo que sí pasa.
		{"Bash", "command", "curl -s -H 'X-Vault: 1' http://127.0.0.1:5237/api/rings", false},
		{"Bash", "command", "bin/pg vault import-env --ring VTEX --file connectors/.env --only VTEX_APP_KEY", false},
		{"Bash", "command", "printf '%s\\n' x | bin/pg vault import --file l.zip", false},
		{"Bash", "command", "bin/pg vault list", false},
		{"Bash", "command", "bin/pg vault get --ring vtex --key APP_KEY", false},
		{"Bash", "command", "bin/pg vault run --ring vtex -- sh -c 'curl -H \"k: $APP_KEY\" …'", false},
		{"Bash", "command", "printf '%s' x | bin/pg vault set --ring vtex --key K", false},
		{"Bash", "command", "git log --reveal-ish; echo vault", false},
		{"Read", "file_path", "/Users/x/.config/creditop-cockpit/vault.json", false},
		{"Bash", "command", "openssl enc -d -a -A -pass file:/Users/x/.config/creditop/personal-key < c.txt", true},
		{"Bash", "command", "K=$(</Users/x/.config/creditop/personal-key); echo $K", true},
		{"Bash", "command", "python3 - <<'EOF'\ns = 'tu llave personal (~/.config/creditop/personal-key)'\nEOF", false},
		{"Bash", "command", "git commit -m 'vault: la llave personal-key va aparte' -- lib/vault", false},
	}
	for _, c := range cases {
		why := VaultGuardIn(c.tool, map[string]any{c.field: c.value})
		if (why != "") != c.blocked {
			t.Errorf("%s %q: bloqueado=%v, quería %v", c.tool, c.value, why != "", c.blocked)
		}
	}
}
