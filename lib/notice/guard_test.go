package notice

// LA CENTRALIZACIÓN, CABLEADA: falla si un archivo de my-tools llama a un avisador por su cuenta (el de Cockpit, el
// viejo del chat, osascript con `display notification`, terminal-notifier o notify-send) en vez de pasar por
// notice.Send. Hasta el 2026-11-21 había cuatro copias (Sentinel, Correo, Wally, chat) y cada una decidía sola.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNoOtherNotifier(t *testing.T) {
	root, _ := filepath.Abs("../..")
	needles := []string{"ChatNotifier", "CockpitNotifier", "display notification", "terminal-notifier", "notify-send"}
	allowed := map[string]bool{ // el paquete mismo, los avisadores y lo que los compila
		"lib/notice": true, "cockpit/notifier": true,
	}
	skipDir := map[string]bool{"node_modules": true, ".git": true, "dist": true, "target": true, "vendor": true}
	var bad []string
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		if d.IsDir() {
			if skipDir[d.Name()] || allowed[rel] || strings.HasPrefix(d.Name(), ".") && rel != "." {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(p) != ".go" || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(string(b), "\n") { // los comentarios pueden nombrarlos; el código, no
			if t := strings.TrimSpace(line); strings.HasPrefix(t, "//") || strings.HasPrefix(t, "*") {
				continue
			}
			for _, n := range needles {
				if strings.Contains(line, n) {
					bad = append(bad, rel+" («"+n+"»)")
				}
			}
		}
		return nil
	})
	if len(bad) > 0 {
		t.Fatalf("estos archivos avisan por su cuenta; tienen que usar notice.Send:\n  %s", strings.Join(bad, "\n  "))
	}
}
