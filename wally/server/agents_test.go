package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

// El contexto precargado de un agente lleva quién es, el texto vigente de cada tema y el estado de sus fuentes.
func TestAgentContext(t *testing.T) {
	root, _ := filepath.Abs("../..")
	a := &app{root: root}
	ag := Agent{Name: "Pikachu", Intent: "tener al día KYC", Topics: []string{"identity-validation", "otp-source-and-bypass"}}
	got, err := a.agentContext(context.Background(), ag)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Sos **Pikachu**", "===== tema identity-validation =====", "----- sus fuentes -----", "===== fin de otp-source-and-bypass ====="} {
		if !strings.Contains(got, want) {
			t.Errorf("falta %q", want)
		}
	}
	t.Logf("%d caracteres precargados", len(got))
}

// El lote contra main da lo mismo que preguntar fuente por fuente.
func TestBlobsAtMain(t *testing.T) {
	root, _ := filepath.Abs("../..")
	a := &app{root: root}
	sources, err := a.topicSources("identity-validation")
	if err != nil {
		t.Fatal(err)
	}
	blobs := a.blobsAtMain(context.Background(), append(sources, source{Repo: sources[0].Repo, Path: "no/existe.php"}))
	for _, s := range sources {
		dir, ref, _ := a.repoDir(s.Repo)
		one, _ := git(context.Background(), dir, "rev-parse", ref+":"+s.Path)
		if blobs[s.Repo+":"+s.Path] != strings.TrimSpace(one) {
			t.Errorf("%s: lote %q, uno a uno %q", s.Path, blobs[s.Repo+":"+s.Path], strings.TrimSpace(one))
		}
	}
	if _, ok := blobs[sources[0].Repo+":no/existe.php"]; ok {
		t.Error("una ruta que no está en main no debería tener blob")
	}
}

// Un agente genérico (sin temas de knowledge) lleva su intención y lo que tiene que saber, y nada de knowledge.
func TestAgentContextGeneric(t *testing.T) {
	a := &app{root: t.TempDir()}
	got, err := a.agentContext(context.Background(), Agent{Name: "Eevee", Intent: "ayudarme con los correos a VTEX", Notes: "Escribo en español neutro."})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Sos **Eevee**", "Tu intención: ayudarme con los correos a VTEX", "Escribo en español neutro."} {
		if !strings.Contains(got, want) {
			t.Errorf("falta %q", want)
		}
	}
	if strings.Contains(got, "Temas de knowledge") {
		t.Error("un agente sin temas no debería hablar de knowledge")
	}
}
