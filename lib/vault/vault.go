// Package vault es EL LLAVERO PERSONAL de Miguel (Cockpit → engranaje → «Llavero», y `bin/pg vault`): llaves que no
// se comparten, agrupadas en llaveros con nombre.
//
// Cada valor se guarda CIFRADO con la llave personal (`~/.config/creditop/personal-key`), no con la del equipo: la del
// equipo la tiene todo el equipo y cualquiera que viera un valor cifrado lo podría abrir (decisión de Miguel,
// 2026-11-18). El formato es el de `openssl enc` —el mismo del llavero del chat—, así que se abre a mano con:
//
//	echo '<cifrado>' | openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -a -A -pass file:$HOME/.config/creditop/personal-key
//
// ⚠ El cifrado no esconde nada de un agente con consola: la llave está en el mismo disco. Lo que hace que Claude no vea
// el valor es que ningún comando lo imprime sin `--reveal`, y que el hook `vault-guard` niega `--reveal` y la llave
// personal en las sesiones de Claude. Para usar una llave sin verla: `bin/pg vault run <llavero> -- <comando>`.
//
// El archivo (`~/.config/creditop-cockpit/vault.json`, 600) se reescribe entero bajo un candado entre procesos: la
// bitácora perdía entradas sin uno (medido el 2026-11-18).
package vault

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

const iterations = 100000

// Key es una llave: su nombre (el de la variable de entorno) y su valor cifrado. Print es la huella del valor (un HMAC
// con la llave personal: sirve para ver si dos llaves son la misma sin mostrar ninguna, y no le dice nada a quien no
// tiene la llave).
type Key struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Sealed  string `json:"sealed"`
	Print   string `json:"print"`
	Updated string `json:"updated"`
}

// Ring es un llavero: un nombre y sus llaves.
type Ring struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Keys []Key  `json:"keys"`
}

// Data es todo el archivo.
type Data struct {
	Version int    `json:"version"`
	Rings   []Ring `json:"rings"`
}

// Paths: dónde están el archivo y la llave. Los de las pruebas los cambian.
type Paths struct {
	File string
	Key  string
}

// DefaultPaths: CREDITOP_VAULT_FILE y CREDITOP_PERSONAL_KEY_FILE ganan (las pruebas); si no, los de siempre.
func DefaultPaths() (Paths, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Paths{}, err
	}
	p := Paths{
		File: filepath.Join(home, ".config", "creditop-cockpit", "vault.json"),
		Key:  filepath.Join(home, ".config", "creditop", "personal-key"),
	}
	if v := os.Getenv("CREDITOP_VAULT_FILE"); v != "" {
		p.File = v
	}
	if v := os.Getenv("CREDITOP_PERSONAL_KEY_FILE"); v != "" {
		p.Key = v
	}
	return p, nil
}

// ── la llave personal y el cifrado ────────────────────────────────────────────────────────────────────

// PersonalKey lee la llave personal (la primera línea del archivo, como la lee openssl con -pass file:). Con create, si
// no existe la crea: 32 bytes al azar en base64 sin «=», como la del equipo.
func (p Paths) PersonalKey(create bool) (string, error) {
	raw, err := os.ReadFile(p.Key)
	if err == nil {
		k := strings.TrimSpace(strings.SplitN(string(raw), "\n", 2)[0])
		if k == "" {
			return "", fmt.Errorf("la llave personal (%s) está vacía", p.Key)
		}
		return k, nil
	}
	if !os.IsNotExist(err) || !create {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("todavía no hay llave personal (%s): se crea al guardar la primera llave", p.Key)
		}
		return "", err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	k := strings.TrimRight(base64.StdEncoding.EncodeToString(b), "=")
	if err := os.MkdirAll(filepath.Dir(p.Key), 0o700); err != nil {
		return "", err
	}
	// O_EXCL: si otro proceso la creó en el mismo instante, gana la suya y se lee ésa.
	f, err := os.OpenFile(p.Key, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) {
			return p.PersonalKey(false)
		}
		return "", err
	}
	defer f.Close()
	if _, err := f.WriteString(k + "\n"); err != nil {
		return "", err
	}
	return k, nil
}

func derive(pass string, salt []byte) (key, iv []byte, err error) {
	b, err := pbkdf2.Key(sha256.New, pass, salt, iterations, 48)
	if err != nil {
		return nil, nil, err
	}
	return b[:32], b[32:48], nil
}

// Seal cifra como `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -a -A`.
func Seal(pass, value string) (string, error) {
	salt := make([]byte, 8)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, iv, err := derive(pass, salt)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	pad := aes.BlockSize - len(value)%aes.BlockSize
	plain := append([]byte(value), bytes.Repeat([]byte{byte(pad)}, pad)...)
	out := make([]byte, 16+len(plain))
	copy(out, "Salted__")
	copy(out[8:], salt)
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out[16:], plain)
	return base64.StdEncoding.EncodeToString(out), nil
}

// Open descifra lo que hizo Seal (u openssl).
func Open(pass, sealed string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(sealed), ""))
	if err != nil || len(raw) < 32 || string(raw[:8]) != "Salted__" || (len(raw)-16)%aes.BlockSize != 0 {
		return "", errors.New("no es un cifrado del llavero")
	}
	key, iv, err := derive(pass, raw[8:16])
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	plain := make([]byte, len(raw)-16)
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plain, raw[16:])
	pad := int(plain[len(plain)-1])
	if pad < 1 || pad > aes.BlockSize || pad > len(plain) || !bytes.Equal(plain[len(plain)-pad:], bytes.Repeat([]byte{byte(pad)}, pad)) {
		return "", errors.New("no se pudo descifrar: ¿es de otra llave?")
	}
	return string(plain[:len(plain)-pad]), nil
}

// fingerprint: los primeros 6 caracteres del HMAC-SHA256 del valor con la llave personal.
func fingerprint(pass, value string) string {
	m := hmac.New(sha256.New, []byte(pass))
	m.Write([]byte(value))
	return hex.EncodeToString(m.Sum(nil))[:6]
}

// ── el archivo ────────────────────────────────────────────────────────────────────────────────────────

// Load lee el archivo; si no existe, un llavero vacío. No toma el candado: la escritura es un rename, así que nunca se
// lee un archivo a medias.
func (p Paths) Load() (Data, error) {
	d := Data{Version: 1, Rings: []Ring{}}
	raw, err := os.ReadFile(p.File)
	if os.IsNotExist(err) {
		return d, nil
	}
	if err != nil {
		return d, err
	}
	if err := json.Unmarshal(raw, &d); err != nil {
		return d, fmt.Errorf("%s no se puede leer: %w", p.File, err)
	}
	if d.Rings == nil {
		d.Rings = []Ring{}
	}
	for i := range d.Rings {
		if d.Rings[i].Keys == nil {
			d.Rings[i].Keys = []Key{}
		}
	}
	return d, nil
}

// update lee, cambia y escribe bajo el candado (flock sobre `<archivo>.lock`).
func (p Paths) update(change func(*Data) error) (Data, error) {
	if err := os.MkdirAll(filepath.Dir(p.File), 0o700); err != nil {
		return Data{}, err
	}
	lock, err := os.OpenFile(p.File+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return Data{}, err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return Data{}, err
	}
	d, err := p.Load()
	if err != nil {
		return d, err
	}
	if err := change(&d); err != nil {
		return d, err
	}
	raw, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return d, err
	}
	tmp := p.File + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return d, err
	}
	return d, os.Rename(tmp, p.File)
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func now() string { return time.Now().Format(time.RFC3339) }

// ── nombres ───────────────────────────────────────────────────────────────────────────────────────────

var envRe = regexp.MustCompile(`[^A-Z0-9_]+`)

// EnvName vuelve un nombre una variable de entorno: mayúsculas, sin tildes, guiones bajos, sin empezar en número.
func EnvName(name string) string {
	s := strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, norm.NFD.String(strings.TrimSpace(name)))
	s = strings.Trim(envRe.ReplaceAllString(strings.ToUpper(s), "_"), "_")
	if s != "" && s[0] >= '0' && s[0] <= '9' {
		s = "_" + s
	}
	return s
}

// Slug: el nombre de un llavero como se escribe en la consola (`VTEX pruebas` → `vtex-pruebas`).
func Slug(name string) string {
	return strings.Trim(regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(strings.ToLower(strings.ReplaceAll(EnvName(name), "_", "-")), "-"), "-")
}

// ringIndex encuentra un llavero por su id, su nombre (sin importar mayúsculas) o su slug.
func ringIndex(d *Data, ref string) (int, error) {
	ref = strings.TrimSpace(ref)
	for i, r := range d.Rings {
		if r.ID == ref || strings.EqualFold(r.Name, ref) || Slug(r.Name) == Slug(ref) {
			return i, nil
		}
	}
	names := make([]string, 0, len(d.Rings))
	for _, r := range d.Rings {
		names = append(names, Slug(r.Name))
	}
	if len(names) == 0 {
		return -1, fmt.Errorf("no hay ningún llavero todavía (no existe %q)", ref)
	}
	return -1, fmt.Errorf("no hay llavero %q (hay: %s)", ref, strings.Join(names, ", "))
}

func keyIndex(r *Ring, ref string) (int, error) {
	for i, k := range r.Keys {
		if k.ID == ref || k.Name == EnvName(ref) {
			return i, nil
		}
	}
	return -1, fmt.Errorf("el llavero %q no tiene la llave %q", r.Name, ref)
}

func ringNameFree(d *Data, name string, except int) error {
	for i, r := range d.Rings {
		if i != except && (strings.EqualFold(r.Name, name) || Slug(r.Name) == Slug(name)) {
			return fmt.Errorf("ya hay un llavero %q", r.Name)
		}
	}
	return nil
}

// ── lo que se hace ────────────────────────────────────────────────────────────────────────────────────

// CreateRing crea un llavero vacío.
func (p Paths) CreateRing(name string) (Ring, error) {
	name = strings.TrimSpace(name)
	if Slug(name) == "" {
		return Ring{}, errors.New("el llavero necesita un nombre")
	}
	var out Ring
	_, err := p.update(func(d *Data) error {
		if err := ringNameFree(d, name, -1); err != nil {
			return err
		}
		out = Ring{ID: newID(), Name: name, Keys: []Key{}}
		d.Rings = append(d.Rings, out)
		return nil
	})
	return out, err
}

// RenameRing cambia el nombre de un llavero.
func (p Paths) RenameRing(ref, name string) error {
	name = strings.TrimSpace(name)
	if Slug(name) == "" {
		return errors.New("el llavero necesita un nombre")
	}
	_, err := p.update(func(d *Data) error {
		i, err := ringIndex(d, ref)
		if err != nil {
			return err
		}
		if err := ringNameFree(d, name, i); err != nil {
			return err
		}
		d.Rings[i].Name = name
		return nil
	})
	return err
}

// DeleteRing borra un llavero. Con llaves adentro pide force: borrar una llave no se deshace.
func (p Paths) DeleteRing(ref string, force bool) error {
	_, err := p.update(func(d *Data) error {
		i, err := ringIndex(d, ref)
		if err != nil {
			return err
		}
		if n := len(d.Rings[i].Keys); n > 0 && !force {
			return fmt.Errorf("el llavero %q tiene %d llave(s): borralas o movelas antes (o --force)", d.Rings[i].Name, n)
		}
		d.Rings = append(d.Rings[:i], d.Rings[i+1:]...)
		return nil
	})
	return err
}

// SetKey guarda una llave (nueva o con valor nuevo). Crea la llave personal la primera vez.
func (p Paths) SetKey(ref, name, value string) (Key, error) {
	env := EnvName(name)
	if env == "" {
		return Key{}, errors.New("la llave necesita un nombre")
	}
	if value == "" {
		return Key{}, errors.New("la llave necesita un valor")
	}
	pass, err := p.PersonalKey(true)
	if err != nil {
		return Key{}, err
	}
	sealed, err := Seal(pass, value)
	if err != nil {
		return Key{}, err
	}
	var out Key
	_, err = p.update(func(d *Data) error {
		i, err := ringIndex(d, ref)
		if err != nil {
			return err
		}
		r := &d.Rings[i]
		k := Key{ID: newID(), Name: env, Sealed: sealed, Print: fingerprint(pass, value), Updated: now()}
		if j, err := keyIndex(r, env); err == nil {
			k.ID = r.Keys[j].ID
			r.Keys[j] = k
		} else {
			r.Keys = append(r.Keys, k)
		}
		out = k
		return nil
	})
	return out, err
}

// RenameKey cambia el nombre de una llave (su valor no se toca).
func (p Paths) RenameKey(ref, key, name string) (Key, error) {
	env := EnvName(name)
	if env == "" {
		return Key{}, errors.New("la llave necesita un nombre")
	}
	var out Key
	_, err := p.update(func(d *Data) error {
		i, err := ringIndex(d, ref)
		if err != nil {
			return err
		}
		r := &d.Rings[i]
		j, err := keyIndex(r, key)
		if err != nil {
			return err
		}
		if k, err := keyIndex(r, env); err == nil && k != j {
			return fmt.Errorf("el llavero %q ya tiene una llave %s", r.Name, env)
		}
		r.Keys[j].Name = env
		out = r.Keys[j]
		return nil
	})
	return out, err
}

// MoveKey pasa una llave a otro llavero.
func (p Paths) MoveKey(ref, key, to string) error {
	_, err := p.update(func(d *Data) error {
		i, err := ringIndex(d, ref)
		if err != nil {
			return err
		}
		t, err := ringIndex(d, to)
		if err != nil {
			return err
		}
		if i == t {
			return nil
		}
		j, err := keyIndex(&d.Rings[i], key)
		if err != nil {
			return err
		}
		k := d.Rings[i].Keys[j]
		if _, err := keyIndex(&d.Rings[t], k.Name); err == nil {
			return fmt.Errorf("el llavero %q ya tiene una llave %s", d.Rings[t].Name, k.Name)
		}
		d.Rings[i].Keys = append(d.Rings[i].Keys[:j], d.Rings[i].Keys[j+1:]...)
		d.Rings[t].Keys = append(d.Rings[t].Keys, k)
		return nil
	})
	return err
}

// DeleteKey borra una llave.
func (p Paths) DeleteKey(ref, key string) error {
	_, err := p.update(func(d *Data) error {
		i, err := ringIndex(d, ref)
		if err != nil {
			return err
		}
		j, err := keyIndex(&d.Rings[i], key)
		if err != nil {
			return err
		}
		d.Rings[i].Keys = append(d.Rings[i].Keys[:j], d.Rings[i].Keys[j+1:]...)
		return nil
	})
	return err
}

// Reveal descifra UNA llave.
func (p Paths) Reveal(ref, key string) (string, error) {
	d, err := p.Load()
	if err != nil {
		return "", err
	}
	i, err := ringIndex(&d, ref)
	if err != nil {
		return "", err
	}
	j, err := keyIndex(&d.Rings[i], key)
	if err != nil {
		return "", err
	}
	pass, err := p.PersonalKey(false)
	if err != nil {
		return "", err
	}
	return Open(pass, d.Rings[i].Keys[j].Sealed)
}

// Env descifra todas las llaves de un llavero, como variables de entorno (ordenadas por nombre).
func (p Paths) Env(ref string) ([][2]string, error) {
	d, err := p.Load()
	if err != nil {
		return nil, err
	}
	i, err := ringIndex(&d, ref)
	if err != nil {
		return nil, err
	}
	if len(d.Rings[i].Keys) == 0 {
		return nil, nil
	}
	pass, err := p.PersonalKey(false)
	if err != nil {
		return nil, err
	}
	out := make([][2]string, 0, len(d.Rings[i].Keys))
	for _, k := range d.Rings[i].Keys {
		v, err := Open(pass, k.Sealed)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", k.Name, err)
		}
		out = append(out, [2]string{k.Name, v})
	}
	sort.Slice(out, func(a, b int) bool { return out[a][0] < out[b][0] })
	return out, nil
}
