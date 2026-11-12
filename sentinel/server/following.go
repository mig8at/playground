package main

// LO QUE MIGUEL SIGUE: los comercios (y, si quiere, entidades) que agrega a mano desde la interfaz. Viven en el servidor
// —`sentinel/.data/following.json`— y no en el navegador, porque deciden algo más que la lista de la izquierda: los
// avisos de macOS de un COMERCIO salen sólo si se sigue (`notify.merchants`, «following» por defecto). Son 115 comercios
// y la mayoría chicos: uno que se cae a las 3 de la tarde avisaba sin que importara.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

type following struct {
	mu   sync.Mutex
	path string
	list []Signal // en el orden en que se agregaron
}

type followingFile struct {
	Signals []Signal `json:"signals"`
}

func openFollowing(dir string) *following {
	f := &following{path: filepath.Join(dir, "following.json")}
	if raw, err := os.ReadFile(f.path); err == nil {
		var ff followingFile
		if json.Unmarshal(raw, &ff) == nil {
			f.list = ff.Signals
		}
	}
	return f
}

// followable: sólo entidades y comercios, con un id numérico. Lo demás (servicios, cola, toda la originación) ya está
// siempre a la vista.
func followable(sig Signal) error {
	kind, id, ok := strings.Cut(string(sig), ":")
	if !ok || (kind != "lender" && kind != "merchant") {
		return fmt.Errorf("sólo se siguen entidades y comercios («lender:<id>», «merchant:<id>»), no %q", sig)
	}
	if n, err := strconv.Atoi(id); err != nil || n <= 0 {
		return fmt.Errorf("%q no tiene un id válido", sig)
	}
	return nil
}

func (f *following) all() []Signal {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Signal{}, f.list...)
}

func (f *following) has(sig Signal) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, x := range f.list {
		if x == sig {
			return true
		}
	}
	return false
}

func (f *following) add(sig Signal) error {
	if err := followable(sig); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, x := range f.list {
		if x == sig {
			return nil
		}
	}
	f.list = append(f.list, sig)
	return f.save()
}

func (f *following) remove(sig Signal) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	kept := f.list[:0]
	for _, x := range f.list {
		if x != sig {
			kept = append(kept, x)
		}
	}
	f.list = kept
	return f.save()
}

// save: con f.mu tomado. Temporal y renombre, para no dejar el archivo a medias.
func (f *following) save() error {
	raw, err := json.MarshalIndent(followingFile{Signals: f.list}, "", "  ")
	if err != nil {
		return err
	}
	tmp := f.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, f.path)
}
