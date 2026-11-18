package main

// pg vault: EL LLAVERO PERSONAL (lib/vault). Lo mismo que el engranaje → «Llavero» de Cockpit, que corre estos
// comandos. Ninguno imprime un valor salvo `get` y `env` con --reveal, que el hook `vault-guard` niega en las sesiones
// de Claude: un agente usa las llaves con `run`, que las pasa al comando como variables de entorno sin mostrarlas.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"creditop/my-tools/lib/vault"
)

func vaultPaths() (vault.Paths, int) {
	p, err := vault.DefaultPaths()
	if err != nil {
		return p, fail(2, "%v", err)
	}
	return p, 0
}

func vaultFlags(name string) *flag.FlagSet {
	return flag.NewFlagSet("vault "+name, flag.ContinueOnError)
}

func runVaultList(args []string) int {
	fs := vaultFlags("list")
	ring := fs.String("ring", "", "sólo ese llavero")
	asJSON := fs.Bool("json", false, "en JSON (lo lee Cockpit)")
	if fs.Parse(args) != nil {
		return 2
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	d, err := p.Load()
	if err != nil {
		return fail(1, "%v", err)
	}
	type keyOut struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Print   string `json:"print"`
		Updated string `json:"updated"`
	}
	type ringOut struct {
		ID   string   `json:"id"`
		Name string   `json:"name"`
		Slug string   `json:"slug"`
		Keys []keyOut `json:"keys"`
	}
	out := []ringOut{}
	for _, r := range d.Rings {
		if *ring != "" && r.ID != *ring && !strings.EqualFold(r.Name, *ring) && vault.Slug(r.Name) != vault.Slug(*ring) {
			continue
		}
		ro := ringOut{ID: r.ID, Name: r.Name, Slug: vault.Slug(r.Name), Keys: []keyOut{}}
		for _, k := range r.Keys {
			ro.Keys = append(ro.Keys, keyOut{ID: k.ID, Name: k.Name, Print: k.Print, Updated: k.Updated})
		}
		out = append(out, ro)
	}
	if *ring != "" && len(out) == 0 {
		return fail(1, "no hay llavero %q", *ring)
	}
	if *asJSON {
		_, keyErr := p.PersonalKey(false)
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"rings": out, "file": p.File, "keyFile": p.Key, "hasKey": keyErr == nil})
		return 0
	}
	if len(out) == 0 {
		fmt.Println("no hay llaveros todavía: pg vault ring-create --name '…'")
		return 0
	}
	for _, r := range out {
		fmt.Printf("%s  (%s · %d)\n", r.Name, r.Slug, len(r.Keys))
		for _, k := range r.Keys {
			fmt.Printf("  %-32s huella %s\n", k.Name, k.Print)
		}
	}
	fmt.Println("\nlos valores no se muestran: `pg vault run <llavero> -- <comando>` los pasa como variables de entorno")
	return 0
}

func runVaultRingCreate(args []string) int {
	fs := vaultFlags("ring-create")
	name := fs.String("name", "", "el nombre del llavero")
	if fs.Parse(args) != nil {
		return 2
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	r, err := p.CreateRing(*name)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("llavero %q creado (%s)\n", r.Name, vault.Slug(r.Name))
	return 0
}

func runVaultRingRename(args []string) int {
	fs := vaultFlags("ring-rename")
	ring := fs.String("ring", "", "el llavero (nombre, slug o id)")
	name := fs.String("name", "", "el nombre nuevo")
	if fs.Parse(args) != nil {
		return 2
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	if err := p.RenameRing(*ring, *name); err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("llavero renombrado: %s\n", *name)
	return 0
}

func runVaultRingDelete(args []string) int {
	fs := vaultFlags("ring-delete")
	ring := fs.String("ring", "", "el llavero (nombre, slug o id)")
	force := fs.Bool("force", false, "borrarlo aunque tenga llaves (no se deshace)")
	if fs.Parse(args) != nil {
		return 2
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	if err := p.DeleteRing(*ring, *force); err != nil {
		return fail(1, "%v", err)
	}
	fmt.Println("llavero borrado")
	return 0
}

// runVaultSet: el valor llega por stdin (no por un argumento: quedaría en el historial y en `ps`).
func runVaultSet(args []string) int {
	fs := vaultFlags("set")
	ring := fs.String("ring", "", "el llavero (nombre, slug o id)")
	key := fs.String("key", "", "el nombre de la llave (queda como variable de entorno: MAYÚSCULAS_Y_GUIONES)")
	if fs.Parse(args) != nil {
		return 2
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 64<<10))
	if err != nil {
		return fail(2, "leyendo el valor: %v", err)
	}
	value := strings.TrimRight(string(raw), "\r\n")
	if value == "" {
		return fail(2, "el valor va por stdin: printf '%%s' '…' | pg vault set --ring R --key K (o pbpaste | …)")
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	k, err := p.SetKey(*ring, *key, value)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%s guardada, cifrada (huella %s)\n", k.Name, k.Print)
	return 0
}

func runVaultKeyRename(args []string) int {
	fs := vaultFlags("key-rename")
	ring := fs.String("ring", "", "el llavero")
	key := fs.String("key", "", "la llave")
	name := fs.String("name", "", "el nombre nuevo")
	if fs.Parse(args) != nil {
		return 2
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	k, err := p.RenameKey(*ring, *key, *name)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("llave renombrada: %s\n", k.Name)
	return 0
}

func runVaultKeyMove(args []string) int {
	fs := vaultFlags("key-move")
	ring := fs.String("ring", "", "el llavero donde está")
	key := fs.String("key", "", "la llave")
	to := fs.String("to", "", "el llavero adonde va")
	if fs.Parse(args) != nil {
		return 2
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	if err := p.MoveKey(*ring, *key, *to); err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%s pasó a %s\n", vault.EnvName(*key), *to)
	return 0
}

func runVaultKeyDelete(args []string) int {
	fs := vaultFlags("key-delete")
	ring := fs.String("ring", "", "el llavero")
	key := fs.String("key", "", "la llave")
	if fs.Parse(args) != nil {
		return 2
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	if err := p.DeleteKey(*ring, *key); err != nil {
		return fail(1, "%v", err)
	}
	fmt.Println("llave borrada")
	return 0
}

var errNoReveal = errors.New("el valor no se imprime sin --reveal (y una sesión de Claude no puede pedirlo: usá `pg vault run`)")

func runVaultGet(args []string) int {
	fs := vaultFlags("get")
	ring := fs.String("ring", "", "el llavero")
	key := fs.String("key", "", "la llave")
	reveal := fs.Bool("reveal", false, "imprimir el valor descifrado")
	if fs.Parse(args) != nil {
		return 2
	}
	if !*reveal {
		return fail(2, "%v", errNoReveal)
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	v, err := p.Reveal(*ring, *key)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Print(v)
	if fi, err := os.Stdout.Stat(); err == nil && fi.Mode()&os.ModeCharDevice != 0 {
		fmt.Println()
	}
	return 0
}

// runVaultEnv: el llavero como .env, descifrado.
func runVaultEnv(args []string) int {
	fs := vaultFlags("env")
	ring := fs.String("ring", "", "el llavero")
	reveal := fs.Bool("reveal", false, "imprimir los valores descifrados")
	if fs.Parse(args) != nil {
		return 2
	}
	if !*reveal {
		return fail(2, "%v", errNoReveal)
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	env, err := p.Env(*ring)
	if err != nil {
		return fail(1, "%v", err)
	}
	for _, kv := range env {
		fmt.Printf("%s=%s\n", kv[0], dotenvQuote(kv[1]))
	}
	return 0
}

func dotenvQuote(v string) string {
	if v != "" && !strings.ContainsAny(v, " \t\n\"'#$\\`") {
		return v
	}
	return "'" + strings.ReplaceAll(v, "'", `'\''`) + "'"
}

// runVaultRun: corre un comando con las llaves del llavero en su entorno. Sale con el código del comando.
//
//	pg vault run --ring vtex -- curl -H "X-VTEX-API-AppKey: $VTEX_APP_KEY" …   (el $ lo expande una shell: sh -c '…')
func runVaultRun(args []string) int {
	sep := -1
	for i, a := range args {
		if a == "--" {
			sep = i
			break
		}
	}
	if sep < 0 || sep == len(args)-1 {
		return fail(2, "pg vault run --ring R -- <comando> [args]")
	}
	fs := vaultFlags("run")
	ring := fs.String("ring", "", "el llavero")
	if fs.Parse(args[:sep]) != nil {
		return 2
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	env, err := p.Env(*ring)
	if err != nil {
		return fail(1, "%v", err)
	}
	cmd := exec.Command(args[sep+1], args[sep+2:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Env = os.Environ()
	for _, kv := range env {
		cmd.Env = append(cmd.Env, kv[0]+"="+kv[1])
	}
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return exit.ExitCode()
		}
		return fail(127, "%v", err)
	}
	return 0
}

// runVaultImportEnv: un .env al llavero, leído y cifrado acá adentro (nadie ve un valor). Imprime sólo nombres.
func runVaultImportEnv(args []string) int {
	fs := vaultFlags("import-env")
	ring := fs.String("ring", "", "el llavero (se crea si no existe)")
	file := fs.String("file", "", "el .env")
	only := fs.String("only", "", "sólo estas claves, separadas por coma")
	except := fs.String("except", "", "todas menos éstas, separadas por coma")
	if fs.Parse(args) != nil {
		return 2
	}
	if *ring == "" || *file == "" {
		return fail(2, "pg vault import-env --ring R --file .env [--only A,B | --except A,B]")
	}
	f, err := os.Open(*file)
	if err != nil {
		return fail(1, "%v", err)
	}
	pairs, err := vault.ParseEnv(f)
	f.Close()
	if err != nil {
		return fail(1, "%v", err)
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	split := func(s string) []string {
		if s == "" {
			return nil
		}
		return strings.Split(s, ",")
	}
	res, err := p.ImportEnv(*ring, pairs, split(*only), split(*except))
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%s ← %s: %d nuevas, %d actualizadas, %d iguales\n", *ring, *file, len(res.Added), len(res.Updated), len(res.Same))
	if len(res.Added) > 0 {
		fmt.Printf("  nuevas: %s\n", strings.Join(res.Added, " "))
	}
	if len(res.Updated) > 0 {
		fmt.Printf("  actualizadas: %s\n", strings.Join(res.Updated, " "))
	}
	return 0
}

// readPassphrase: la contraseña del zip, la primera línea de stdin.
func readPassphrase() (string, []byte, error) {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 48<<20))
	if err != nil {
		return "", nil, err
	}
	line, rest, _ := strings.Cut(string(raw), "\n")
	return strings.TrimRight(line, "\r"), []byte(rest), nil
}

// runVaultExport: el llavero a un zip, cada valor cifrado con una contraseña (la primera línea de stdin).
func runVaultExport(args []string) int {
	fs := vaultFlags("export")
	out := fs.String("out", "", "el zip (por defecto ~/Downloads/llavero-<fecha>.zip)")
	ring := fs.String("ring", "", "sólo estos llaveros, separados por coma")
	if fs.Parse(args) != nil {
		return 2
	}
	pass, _, err := readPassphrase()
	if err != nil || pass == "" {
		return fail(2, "la contraseña del zip va por stdin: printf '%%s\\n' '…' | pg vault export")
	}
	if *out == "" {
		home, _ := os.UserHomeDir()
		*out = filepath.Join(home, "Downloads", "llavero-"+time.Now().Format("2006-01-02")+".zip")
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	var rings []string
	if *ring != "" {
		rings = strings.Split(*ring, ",")
	}
	var buf bytes.Buffer
	n, keys, err := p.Export(&buf, pass, rings)
	if err != nil {
		return fail(1, "%v", err)
	}
	if err := os.WriteFile(*out, buf.Bytes(), 0o600); err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%d llaveros, %d llaves → %s (cada valor cifrado con la contraseña; sin ella el zip no sirve)\n", n, keys, *out)
	return 0
}

// runVaultImport: un zip de `export` (por --file, o en base64 por stdin después de la contraseña: así lo manda Cockpit).
func runVaultImport(args []string) int {
	fs := vaultFlags("import")
	file := fs.String("file", "", "el zip; sin --file, la segunda línea de stdin es el zip en base64")
	replace := fs.Bool("replace", false, "una llave que ya está con otro valor se reemplaza (si no, se deja y se avisa)")
	if fs.Parse(args) != nil {
		return 2
	}
	pass, rest, err := readPassphrase()
	if err != nil || pass == "" {
		return fail(2, "la contraseña del zip va por stdin: printf '%%s\\n' '…' | pg vault import --file llavero.zip")
	}
	var data []byte
	if *file != "" {
		if data, err = vault.ReadFileLimited(*file); err != nil {
			return fail(1, "%v", err)
		}
	} else if data, err = base64.StdEncoding.DecodeString(strings.TrimSpace(string(rest))); err != nil || len(data) == 0 {
		return fail(2, "falta el zip: --file llavero.zip")
	}
	p, code := vaultPaths()
	if code != 0 {
		return code
	}
	res, err := p.Import(data, pass, *replace)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%d llaveros: %d llaves nuevas, %d iguales, %d reemplazadas", res.Rings, res.Added, res.Same, res.Replaced)
	if len(res.Conflicts) > 0 {
		fmt.Printf(", %d con otro valor que no se tocaron (--replace): %s", len(res.Conflicts), strings.Join(res.Conflicts, ", "))
	}
	fmt.Println()
	return 0
}
