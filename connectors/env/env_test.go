package env

import (
	"os"
	"path/filepath"
	"testing"
)

func myTools(t *testing.T, dotenv string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "connectors", "env"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "connectors", ".env"), []byte(dotenv), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

// Un servidor MCP lo lanza Claude desde un directorio que no elegimos: si connectors/ no está subiendo
// desde ahí, MY_TOOLS_ROOT lo encuentra. Y si sí está, gana el de donde se corre.
func TestDirSearchesFromWhereItRunsThenMyToolsRoot(t *testing.T) {
	here := myTools(t, "")
	other := myTools(t, "")
	t.Chdir(t.TempDir())
	t.Setenv("MY_TOOLS_ROOT", other)
	if got, err := Dir(); err != nil || got != filepath.Join(other, "connectors") {
		t.Errorf("Dir() = %q, %v; quería el de MY_TOOLS_ROOT", got, err)
	}
	t.Chdir(filepath.Join(here, "connectors", "env"))
	real, _ := filepath.EvalSymlinks(filepath.Join(here, "connectors"))
	if got, _ := Dir(); got != filepath.Join(here, "connectors") && got != real {
		t.Errorf("Dir() = %q; quería el de donde se corre", got)
	}
}

// El proceso gana sobre el archivo, y un valor vacío en el proceso no tapa el del archivo.
func TestTheProcessWinsAndAnEmptyValueDoesNotHideTheFile(t *testing.T) {
	root := myTools(t, "A=del-archivo\nB=\"con comillas\"\nexport C=exportada\n# D=comentada\n")
	t.Chdir(root)
	t.Setenv("A", "")
	v, err := LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	if v.Get("A") != "del-archivo" || v.Get("B") != "con comillas" || v.Get("C") != "exportada" || v.Get("D") != "" {
		t.Errorf("A=%q B=%q C=%q D=%q", v.Get("A"), v.Get("B"), v.Get("C"), v.Get("D"))
	}
	t.Setenv("A", "del-proceso")
	if v.Get("A") != "del-proceso" {
		t.Errorf("el proceso tenía que ganar: %q", v.Get("A"))
	}
}
