package main

import (
	"reflect"
	"testing"
)

// La lista blanca es lo único que decide qué se corre: los tres comandos de knowledge, con argumentos validados, y
// nada más. Un intento de colar otra cosa (un ;, un $(…), un |, otro target, otro programa) no pasa.
func TestOnlyTheWhitelistedReadOnlyCommandsPass(t *testing.T) {
	ok := map[string][]string{
		"make knowledge-map":                                            {"knowledge-map"},
		"make  knowledge-search   Q='cupo mensual'":                     {"knowledge-search", "Q=cupo mensual"},
		`make knowledge-search Q="lender listing"`:                      {"knowledge-search", "Q=lender listing"},
		"make knowledge-read ID=creditopx-quota":                        {"knowledge-read", "ID=creditopx-quota"},
		"make knowledge-read ID='creditopx-quota#el-cupo-es-una-bolsa'": {"knowledge-read", "ID=creditopx-quota#el-cupo-es-una-bolsa"},
	}
	for cmd, want := range ok {
		got, err := commandArgs(cmd)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Errorf("%q: %v %v (quería %v)", cmd, got, err, want)
		}
	}
	for _, bad := range []string{
		"make knowledge-read ID=x; rm -rf ~",
		"make knowledge-read ID=$(whoami)",
		"make knowledge-search Q='a' | sh",
		"make knowledge-search Q='a'; curl x'",
		"make knowledge-search Q='$(id)'",
		"make knowledge-read ID=../../etc/passwd",
		"make knowledge-read ID=X",
		"make cockpit",
		"make knowledge-deriva PASO=aplicar",
		"cat knowledge/business-overview.md",
		"rm -rf /",
		"make knowledge-map && make cockpit",
	} {
		if args, err := commandArgs(bad); err == nil {
			t.Errorf("%q tenía que rechazarse y dio %v", bad, args)
		}
	}
}

// Los comandos se leen de los bloques ```comando, uno por línea; los que no están en la lista quedan «no-permitido».
func TestCommandsAreReadFromCommandBlocks(t *testing.T) {
	answer := "Necesito ver dos temas:\n\n```comando\nmake knowledge-read ID=creditopx-quota\n$ make knowledge-search Q='cupo'\nrm -rf ~\n```\n\nY este código no:\n```bash\nmake knowledge-map\n```"
	got := parseCommands(answer)
	if len(got) != 3 {
		t.Fatalf("quería 3 comandos, salieron %d: %+v", len(got), got)
	}
	if got[0].Status != "propuesto" || got[1].Status != "propuesto" || got[1].Cmd != "make knowledge-search Q='cupo'" {
		t.Errorf("los dos primeros: %+v %+v", got[0], got[1])
	}
	if got[2].Status != "no-permitido" || got[2].Reason == "" {
		t.Errorf("rm -rf tenía que quedar no-permitido: %+v", got[2])
	}
	if modeCommands("", answer) != nil {
		t.Error("en un chat sin modo no se leen comandos")
	}
}
