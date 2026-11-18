package vault

// TRAER Y LLEVAR: un .env entero al llavero sin que nadie vea un valor (ImportEnv), y el llavero entero a un zip para
// otra máquina (Export / Import).
//
// El zip NO lleva la llave personal: cada valor va cifrado otra vez con una CONTRASEÑA que elige Miguel al exportar, en
// el mismo formato de openssl, así que también se abre a mano (LEEME.txt dice cómo). Llevar la llave personal adentro
// haría que quien tenga el zip tenga todo.

import (
	"archive/zip"
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// ── un .env ───────────────────────────────────────────────────────────────────────────────────────────

// ParseEnv lee un .env: `CLAVE=valor`, con `export` adelante o no, comillas simples o dobles, y un `# comentario` al
// final de un valor sin comillas. Las líneas sin valor no cuentan. Devuelve en el orden del archivo.
func ParseEnv(r io.Reader) ([][2]string, error) {
	var out [][2]string
	seen := map[string]int{}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		eq := strings.IndexByte(line, '=')
		if eq <= 0 {
			continue
		}
		name := strings.TrimSpace(line[:eq])
		if !envNameRe.MatchString(name) {
			continue
		}
		v := strings.TrimSpace(line[eq+1:])
		switch {
		case len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && strings.LastIndexByte(v, v[0]) > 0:
			v = v[1:strings.LastIndexByte(v, v[0])]
		default:
			if i := strings.Index(v, " #"); i >= 0 {
				v = strings.TrimSpace(v[:i])
			}
		}
		if v == "" {
			continue
		}
		if i, ok := seen[name]; ok { // la última gana, como en una shell
			out[i][1] = v
			continue
		}
		seen[name] = len(out)
		out = append(out, [2]string{name, v})
	}
	return out, sc.Err()
}

// ImportResult dice qué pasó con cada llave, sin valores.
type ImportResult struct {
	Added, Updated, Same []string
}

// ImportEnv guarda en el llavero `ring` (lo crea si no existe) cada par. Con only, sólo esas claves; con except, todas
// menos ésas. Una llave que ya está con el mismo valor no se toca; con otro valor, se actualiza.
func (p Paths) ImportEnv(ring string, pairs [][2]string, only, except []string) (ImportResult, error) {
	var res ImportResult
	pass, err := p.PersonalKey(true)
	if err != nil {
		return res, err
	}
	want := func(name string) bool {
		if len(only) > 0 {
			for _, o := range only {
				if EnvName(o) == name {
					return true
				}
			}
			return false
		}
		for _, x := range except {
			if EnvName(x) == name {
				return false
			}
		}
		return true
	}
	type sealedPair struct{ name, sealed, print string }
	var todo []sealedPair
	for _, kv := range pairs {
		name := EnvName(kv[0])
		if name == "" || !want(name) {
			continue
		}
		s, err := Seal(pass, kv[1])
		if err != nil {
			return res, err
		}
		todo = append(todo, sealedPair{name, s, fingerprint(pass, kv[1])})
	}
	_, err = p.update(func(d *Data) error {
		i, err := ringIndex(d, ring)
		if err != nil {
			if Slug(ring) == "" {
				return errors.New("el llavero necesita un nombre")
			}
			d.Rings = append(d.Rings, Ring{ID: newID(), Name: strings.TrimSpace(ring), Keys: []Key{}})
			i = len(d.Rings) - 1
		}
		r := &d.Rings[i]
		for _, t := range todo {
			k := Key{ID: newID(), Name: t.name, Sealed: t.sealed, Print: t.print, Updated: now()}
			if j, err := keyIndex(r, t.name); err == nil {
				if r.Keys[j].Print == t.print {
					res.Same = append(res.Same, t.name)
					continue
				}
				k.ID = r.Keys[j].ID
				r.Keys[j] = k
				res.Updated = append(res.Updated, t.name)
				continue
			}
			r.Keys = append(r.Keys, k)
			res.Added = append(res.Added, t.name)
		}
		return nil
	})
	return res, err
}

// ── el zip ────────────────────────────────────────────────────────────────────────────────────────────

const bundleFile = "llavero.json"

type bundle struct {
	Version  int          `json:"version"`
	Exported string       `json:"exported"`
	Format   string       `json:"format"`
	Rings    []bundleRing `json:"rings"`
}

type bundleRing struct {
	Name string      `json:"name"`
	Keys []bundleKey `json:"keys"`
}

type bundleKey struct {
	Name   string `json:"name"`
	Sealed string `json:"sealed"`
}

const readme = `EL LLAVERO DE COCKPIT, exportado el %s.

llavero.json tiene los llaveros y sus llaves. Cada valor está cifrado con la CONTRASEÑA que se eligió al exportar (no
con la llave personal de la máquina), en el formato de openssl.

Para traerlo a Cockpit en otra máquina: engranaje → Llavero → Importar, o
    printf '%%s\n' '<contraseña>' | bin/pg vault import --file %s

Para abrir un valor a mano, sin Cockpit:
    echo '<sealed>' | openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -a -A -pass pass:'<contraseña>'
`

// Export escribe el zip con todos los llaveros (o sólo los de rings), cada valor cifrado con passphrase.
func (p Paths) Export(w io.Writer, passphrase string, rings []string) (int, int, error) {
	if len(passphrase) < 8 {
		return 0, 0, errors.New("la contraseña del zip tiene que tener al menos 8 caracteres")
	}
	d, err := p.Load()
	if err != nil {
		return 0, 0, err
	}
	pass, err := p.PersonalKey(false)
	if err != nil {
		return 0, 0, err
	}
	b := bundle{Version: 1, Exported: time.Now().Format(time.RFC3339), Format: "openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -a -A, con la contraseña del zip"}
	keys := 0
	for _, r := range d.Rings {
		if len(rings) > 0 {
			match := false
			for _, ref := range rings {
				if r.ID == ref || strings.EqualFold(r.Name, ref) || Slug(r.Name) == Slug(ref) {
					match = true
				}
			}
			if !match {
				continue
			}
		}
		br := bundleRing{Name: r.Name, Keys: []bundleKey{}}
		for _, k := range r.Keys {
			v, err := Open(pass, k.Sealed)
			if err != nil {
				return 0, 0, fmt.Errorf("%s / %s: %w", r.Name, k.Name, err)
			}
			s, err := Seal(passphrase, v)
			if err != nil {
				return 0, 0, err
			}
			br.Keys = append(br.Keys, bundleKey{Name: k.Name, Sealed: s})
			keys++
		}
		b.Rings = append(b.Rings, br)
	}
	if len(rings) > 0 && len(b.Rings) == 0 {
		return 0, 0, fmt.Errorf("no hay llavero %s", strings.Join(rings, ", "))
	}
	zw := zip.NewWriter(w)
	f, err := zw.Create(bundleFile)
	if err != nil {
		return 0, 0, err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(b); err != nil {
		return 0, 0, err
	}
	rf, err := zw.Create("LEEME.txt")
	if err != nil {
		return 0, 0, err
	}
	fmt.Fprintf(rf, readme, time.Now().Format("2006-01-02 15:04"), "llavero.zip")
	return len(b.Rings), keys, zw.Close()
}

// ImportBundleResult: cuántas llaves entraron, cuáles ya estaban iguales y cuáles chocaron (mismo nombre, otro valor).
type ImportBundleResult struct {
	Rings     int
	Added     int
	Same      int
	Replaced  int
	Conflicts []string // «llavero / LLAVE»: no se tocaron (con replace, se reemplazan)
}

// Import trae un zip de Export: crea los llaveros que faltan y las llaves que faltan. Una llave que ya está con otro
// valor no se toca, salvo con replace.
func (p Paths) Import(zipData []byte, passphrase string, replace bool) (ImportBundleResult, error) {
	var res ImportBundleResult
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return res, errors.New("no es un zip del llavero")
	}
	var b bundle
	found := false
	for _, f := range zr.File {
		if f.Name != bundleFile {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return res, err
		}
		err = json.NewDecoder(io.LimitReader(rc, 32<<20)).Decode(&b)
		rc.Close()
		if err != nil {
			return res, fmt.Errorf("%s no se puede leer: %w", bundleFile, err)
		}
		found = true
	}
	if !found {
		return res, fmt.Errorf("el zip no tiene %s", bundleFile)
	}
	// Primero se abre todo con la contraseña: si está mal, no se escribe nada.
	type plain struct{ ring, name, value string }
	var all []plain
	for _, r := range b.Rings {
		for _, k := range r.Keys {
			v, err := Open(passphrase, k.Sealed)
			if err != nil {
				return res, errors.New("la contraseña no abre el zip")
			}
			all = append(all, plain{r.Name, EnvName(k.Name), v})
		}
	}
	pass, err := p.PersonalKey(true)
	if err != nil {
		return res, err
	}
	_, err = p.update(func(d *Data) error {
		for _, r := range b.Rings {
			if _, err := ringIndex(d, r.Name); err != nil {
				if err := ringNameFree(d, r.Name, -1); err != nil {
					return err
				}
				d.Rings = append(d.Rings, Ring{ID: newID(), Name: r.Name, Keys: []Key{}})
			}
			res.Rings++
		}
		for _, x := range all {
			i, _ := ringIndex(d, x.ring)
			rg := &d.Rings[i]
			print := fingerprint(pass, x.value)
			sealed, err := Seal(pass, x.value)
			if err != nil {
				return err
			}
			k := Key{ID: newID(), Name: x.name, Sealed: sealed, Print: print, Updated: now()}
			if j, err := keyIndex(rg, x.name); err == nil {
				switch {
				case rg.Keys[j].Print == print:
					res.Same++
				case replace:
					k.ID = rg.Keys[j].ID
					rg.Keys[j] = k
					res.Replaced++
				default:
					res.Conflicts = append(res.Conflicts, rg.Name+" / "+x.name)
				}
				continue
			}
			rg.Keys = append(rg.Keys, k)
			res.Added++
		}
		return nil
	})
	return res, err
}

// ReadFileLimited lee un archivo de hasta 32 MB (un zip del llavero).
func ReadFileLimited(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, 32<<20))
}
