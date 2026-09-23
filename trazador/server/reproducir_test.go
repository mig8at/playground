package main

import (
	"strings"
	"testing"
	"time"
)

// Lo que se prueba acá es lo que el usuario PEGA: si el comando sale mal entrecomillado o sin target,
// el error no aparece al correr esta herramienta sino tres semanas después, cuando alguien intenta
// repetir la medición y no le da lo mismo.

func TestCmdMakeLlevaSiempreElTarget(t *testing.T) {
	got := cmdMake("trazador-ureq", "prod", "UREQ", "519245")
	want := "make trazador-ureq UREQ=519245 TARGET=prod"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestCmdMakeOmiteLosVacios(t *testing.T) {
	// Un `TEL=` colgando se copia tal cual y falla; peor, se lee como si el dato no existiera.
	got := cmdMake("trazador-posthog", "qa", "UREQ", "", "TEL", "")
	if got != "make trazador-posthog TARGET=qa" {
		t.Fatalf("un par vacío se coló: %q", got)
	}
}

func TestCmdMakeEntrecomillaLoQueElShellPartiria(t *testing.T) {
	casos := []struct{ valor, quiere string }{
		{"SELECT id FROM countries LIMIT 3", `'SELECT id FROM countries LIMIT 3'`},
		{`{service_name="legacy-backend"}`, `'{service_name="legacy-backend"}'`},
		{"519245", "519245"},
		{"2026-09-18", "2026-09-18"},
		// La comilla simple adentro es el caso que rompe el pegado: se cierra, se escapa y se reabre.
		{"WHERE name = 'x'", `'WHERE name = '\''x'\'''`},
	}
	for _, c := range casos {
		got := cmdMake("trazador-sql", "prod", "SQL", c.valor)
		if !strings.Contains(got, "SQL="+c.quiere) {
			t.Errorf("valor %q → %q; esperaba SQL=%s", c.valor, got, c.quiere)
		}
	}
}

func TestAnotacionMDTieneLaFormaQueElTableroParsea(t *testing.T) {
	// El parser del tablero (store.Anotaciones) exige el marcador con tipo y fecha al principio de la
	// línea, dentro de una cita. Si esto cambia, la anotación se pega y la pestaña Hallazgos no la ve.
	md := anotacionMD("uReq 1 en `prod`: ROTA.", "make trazador-ureq UREQ=1 TARGET=prod", "✘ algo falló")
	hoy := time.Now().Format("2006-01-02")
	if !strings.HasPrefix(md, "> **MEDICIÓN · "+hoy+"** — ") {
		t.Fatalf("el marcador no arranca la primera línea:\n%s", md)
	}
	for _, l := range strings.Split(strings.TrimSpace(md), "\n") {
		if !strings.HasPrefix(l, ">") {
			t.Fatalf("una línea se salió de la cita y rompe el bloque: %q", l)
		}
	}
	if !strings.Contains(md, "**Cómo se vuelve a comprobar:** `make trazador-ureq UREQ=1 TARGET=prod`") {
		t.Fatalf("falta el comando que la reproduce:\n%s", md)
	}
}

func TestTablaMDEscapaElPipe(t *testing.T) {
	// Sin escapar, una celda con `|` corre todas las columnas una posición: un dato equivocado con cara
	// de dato bueno, que es el peor modo de fallar de una tabla que se pega en una tarea.
	got := tablaMD([]string{"a", "b"}, []Fila{{"a": "x|y", "b": 2}})
	if !strings.Contains(got, `x\|y`) {
		t.Fatalf("el pipe no se escapó:\n%s", got)
	}
	if lineas := strings.Count(strings.TrimSpace(got), "\n") + 1; lineas != 3 {
		t.Fatalf("esperaba encabezado, separador y una fila; salieron %d líneas:\n%s", lineas, got)
	}
}

func TestResumenTrazaNombraDondeSeRompio(t *testing.T) {
	s := &Solicitud{Estado: 3, EstadoN: "Seleccionó entidad", Comercio: "Amoblando", Lender: "CrediPullman", LenderRT: 2}
	got := resumenTraza(Traza{UReq: 502463, Target: "qa", Outcome: "roto", BrokeAt: "validación de identidad"}, s)
	for _, quiere := range []string{"502463", "`qa`", "ROTA", "validación de identidad", "estado 3", "CrediPullman"} {
		if !strings.Contains(got, quiere) {
			t.Errorf("el resumen no dice %q: %s", quiere, got)
		}
	}
}

func TestSiHayOmiteElCero(t *testing.T) {
	// `UREQ=0` se copia y se corre igual, y contesta por una solicitud que no existe.
	if siHay(0) != "" {
		t.Fatal("el cero tiene que desaparecer del comando")
	}
	if siHay(519245) != "519245" {
		t.Fatal("un uReq real no puede perderse")
	}
}

func TestVecinoNoSeOfreceContraProd(t *testing.T) {
	// `harness-loki` no mira producción: sugerirlo ahí manda a alguien que está depurando prod a una
	// herramienta que le va a contestar «no disponible para este target».
	if _, _, hay := vecinoDeTraza("prod", 519245); hay {
		t.Fatal("no se puede ofrecer el forense del harness contra prod")
	}
	for _, target := range []string{"local", "dev", "staging", "qa"} {
		cuando, cmd, hay := vecinoDeTraza(target, 519245)
		if !hay {
			t.Errorf("target %q: el vecino tendría que ofrecerse", target)
			continue
		}
		// El target VA en el comando: los defaults de las dos son opuestos (local vs prod), así que
		// cambiar de herramienta sin escribirlo cambia de ambiente en silencio.
		if !strings.Contains(cmd, "TARGET="+target) {
			t.Errorf("target %q: el comando no lo lleva puesto: %s", target, cmd)
		}
		if !strings.HasPrefix(cmd, "make harness-loki ") || cuando == "" {
			t.Errorf("target %q: comando o motivo mal armados: %q · %q", target, cmd, cuando)
		}
	}
}

// El bloque que emite con `-bloque`: título en una línea de hasta 120, el comando en su caja y lo que dio,
// sin lo que el validador del tablero rechazaría por forma (HTML, rutas de esta máquina).
func TestBloqueMDTieneLaFormaDeUnBloque(t *testing.T) {
	md := bloqueMD(strings.Repeat("x", 200)+".", "make trazador-ureq UREQ=1 TARGET=prod", "✘ falló <div> en /Users/yo/log")
	titulo, _, _ := strings.Cut(md, "\n")
	if !strings.HasPrefix(titulo, "# ") || len([]rune(strings.TrimPrefix(titulo, "# "))) > 120 {
		t.Fatalf("título = %q", titulo)
	}
	if want := "```trazador\nmake trazador-ureq UREQ=1 TARGET=prod\n```\nResultado: ✘ falló ‹div› en …/log\n"; !strings.HasSuffix(md, want) {
		t.Fatalf("md = %q", md)
	}
}

func TestResultadoFilasResumeEnUnaLinea(t *testing.T) {
	cols := []string{"n"}
	if got := resultadoFilas(cols, []Fila{{"n": 7}}); got != "n = 7." {
		t.Fatalf("una fila = %q", got)
	}
	if got := resultadoFilas(cols, nil); got != "cero filas." {
		t.Fatalf("cero = %q", got)
	}
	var muchas []Fila
	for i := 0; i < 7; i++ {
		muchas = append(muchas, Fila{"n": i})
	}
	if got := resultadoFilas(cols, muchas); !strings.HasPrefix(got, "7 filas: ") || !strings.Contains(got, "y 2 más") {
		t.Fatalf("muchas = %q", got)
	}
}

// ⚠ LA QUE IMPORTA: quien decide si el bloque entra es el validador del tablero, no este módulo. Se le
// pregunta al de verdad y en seco: si allá cambia una regla, acá se nota.
func TestElValidadorDelTableroAceptaElBloque(t *testing.T) {
	if _, err := raizPlayground(); err != nil {
		t.Skip("sin el tablero al lado:", err)
	}
	md := bloqueMD("uReq 1 en `prod`: aprobada.", cmdMake("trazador-ureq", "prod", "UREQ", "1"), "Fuentes: bd · loki.")
	if err := agregarBloque("tablero", md, true); err != nil {
		t.Fatal(err)
	}
}
