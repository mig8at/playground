package main

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

// TestMapaCoincideConPython es la GUARDA contra la divergencia que este repo ya pagó dos veces.
//
// El mapa de logs lo construye Python (`workers/logs.py`) y acá se consume; la búsqueda y la
// normalización están reimplementadas en Go porque son mecánicas. «Mecánicas» no es «seguras»: un
// `rstrip` distinto o un espacio de más hacen que las dos herramientas atribuyan la misma línea a
// archivos distintos — y eso no falla, sólo miente.
//
// Por eso la coincidencia se COMPRUEBA en vez de confiarse: se toman mensajes reales del mapa, se
// resuelven con las dos implementaciones y se exige el mismo archivo.
func TestMapaCoincideConPython(t *testing.T) {
	m := cargarMapaLogs()
	if m == nil {
		t.Skip("no hay workers/logs.json construido (./cli.py logs --construir)")
	}

	// Mensajes de runtime SIMULADOS a partir de las claves: se les agrega cola, que es justo lo que
	// pasa de verdad (el literal del código es un prefijo del mensaje real).
	var casos []string
	for i, k := range m.orden {
		if i%97 != 0 || len(casos) >= 25 { // muestreo disperso, no los 25 más largos
			continue
		}
		casos = append(casos, k+" 12345")
	}
	if len(casos) < 5 {
		t.Skip("mapa demasiado chico para muestrear")
	}

	entrada, _ := json.Marshal(casos)
	py := exec.Command("python3", "-c", `
import json, sys
sys.path.insert(0, "../../workers")
import logs
mapa = logs.cargar()
casos = json.load(sys.stdin)
print(json.dumps([ (logs.resolver(c, mapa) or {}).get("archivos", [{}])[0].get("ruta", "") for c in casos ]))
`)
	py.Stdin = strings.NewReader(string(entrada))
	salida, err := py.Output()
	if err != nil {
		t.Skipf("no se pudo correr la referencia en Python: %v", err)
	}
	var esperado []string
	if err := json.Unmarshal(salida, &esperado); err != nil {
		t.Fatalf("la referencia no devolvió JSON: %v", err)
	}

	distintos := 0
	for i, c := range casos {
		d, _ := m.resolverArchivo(c)
		if d.Ruta != esperado[i] {
			distintos++
			if distintos <= 3 {
				t.Errorf("difieren para %q:\n  go     = %s\n  python = %s", trim(c, 60), d.Ruta, esperado[i])
			}
		}
	}
	if distintos > 0 {
		t.Fatalf("%d de %d mensajes se resuelven distinto entre Go y Python", distintos, len(casos))
	}
	t.Logf("✓ %d mensajes: Go y Python resuelven al mismo archivo", len(casos))
}
