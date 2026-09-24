package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"creditop/playground/connectors/repos"
)

// Un repo de juguete con las formas de log que usa CreditOp: el índice las encuentra, y un mensaje de
// runtime —el literal más lo que se interpola— se resuelve al archivo y la línea que lo emite. Constructor
// y lector usan la misma normalización, así que la clave que se escribe es la que se busca.
func TestTheIndexFindsEachFormAndResolvesRuntimeMessages(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "toy")
	os.MkdirAll(filepath.Join(repo, "app"), 0o755)
	os.MkdirAll(filepath.Join(repo, "tests"), 0o755)
	write := func(rel, body string) { os.WriteFile(filepath.Join(repo, rel), []byte(body), 0o644) }
	write("app/Validacion.php", "<?php\n$this->tracer->log('info', 'Iniciando validación de reglas de grupo', $ctx);\n"+
		"$obsTracer->LOG('error', 'Falló la consulta a Experian para ' . $id);\n"+
		"Log::warning(\"Cupo insuficiente para la entidad:\");\n")
	write("tests/ValidacionTest.php", "<?php\nLog::info('Iniciando validación de reglas de grupo');\n")
	write("app/corto.php", "<?php\nLog::info('muy corto');\n")
	for _, args := range [][]string{{"init", "-q", "-b", "main"}, {"add", "."}, {"-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"}} {
		if out, err := exec.Command("git", append([]string{"-C", repo}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	tools := filepath.Join(root, "tools")
	os.MkdirAll(tools, 0o755)
	os.WriteFile(filepath.Join(tools, "repos.json"), []byte(`{"indexed":{"toy":"`+repo+`"},"citable_only":{},"extensions":[".php"]}`), 0o644)

	claves, indice := indexarRepos(repos.New(tools))
	var b strings.Builder
	escribirIndice(&b, claves, indice)
	var crudo map[string][]destinoLog
	if err := json.Unmarshal([]byte(b.String()), &crudo); err != nil {
		t.Fatalf("el índice no es JSON: %v\n%s", err, b.String())
	}
	if _, ok := crudo["muy corto"]; ok || len(crudo) != 3 {
		t.Fatalf("claves = %v (un literal de menos de 12 no identifica)", claves)
	}
	if got := crudo["Cupo insuficiente para la entidad"]; len(got) != 1 {
		t.Errorf("la clave va sin el `:` final: %v", claves)
	}
	if got := crudo["Iniciando validación de reglas de grupo"]; len(got) != 2 || got[0].Ruta != "toy/app/Validacion.php" {
		t.Errorf("entradas = %+v", got)
	}

	m := &mapaLogs{porMensaje: crudo}
	for k := range crudo {
		m.orden = append(m.orden, k)
	}
	d, ok := m.resolverArchivo("Falló la consulta a Experian para 1827791")
	if !ok || d.Ruta != "toy/app/Validacion.php" || d.Linea != "3" || d.H != hashRuta("toy/app/Validacion.php") {
		t.Errorf("resolverArchivo = %+v %v", d, ok)
	}
	// y el archivo de test no gana si hay uno real
	if d, _ := m.resolverArchivo("Iniciando validación de reglas de grupo"); strings.Contains(d.Ruta, "tests/") {
		t.Errorf("ganó el test: %+v", d)
	}
}
