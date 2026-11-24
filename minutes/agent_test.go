package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Un agente decide por el estado: lo que está trabajando otro proceso no es «sin resumen», y un busy.json de un
// proceso muerto quiere decir que se cortó a mitad (la grabación de las 05:49 del 2026-11-24).
func TestRecordingState(t *testing.T) {
	d := t.TempDir()
	writeJSON(filepath.Join(d, "recorder.json"), RecorderState{Pid: 1 << 30, Ended: "2026-11-24T10:51:29Z"})
	if s, _ := recordingState(d); s != "no_summary" {
		t.Errorf("sin resumen ni nadie trabajando: %s", s)
	}
	writeJSON(filepath.Join(d, "busy.json"), busyState{Pid: os.Getpid(), Step: "frenando"})
	if s, _ := recordingState(d); s != "finishing" {
		t.Errorf("frenando, con el proceso vivo: %s", s)
	}
	writeJSON(filepath.Join(d, "busy.json"), busyState{Pid: os.Getpid(), Step: "armando el resumen"})
	if s, _ := recordingState(d); s != "summarizing" {
		t.Errorf("resumiendo, con el proceso vivo: %s", s)
	}
	writeJSON(filepath.Join(d, "busy.json"), busyState{Pid: 1 << 30, Step: "frenando"})
	if s, cut := recordingState(d); s != "no_summary" || !cut {
		t.Errorf("con el proceso muerto tiene que decir que se cortó: %s %v", s, cut)
	}
	os.WriteFile(filepath.Join(d, "timeline.json"), []byte("{}"), 0o644)
	if s, _ := recordingState(d); s != "done" {
		t.Errorf("con el resumen: %s", s)
	}
}

// El candado: si otro proceso vivo ya está trabajando la grabación, se sale con 3 y no se le pisa nada.
func TestStepsLogLock(t *testing.T) {
	d := t.TempDir()
	writeJSON(filepath.Join(d, "busy.json"), busyState{Pid: os.Getppid(), Step: "armando el resumen"})
	if _, err := stepsLog(d, "frenando"); exitCode(err) != exitBusy {
		t.Fatalf("con otro proceso trabajando tenía que salir ocupado, salió %v", err)
	}
	os.Remove(filepath.Join(d, "busy.json"))
	done, err := stepsLog(d, "frenando")
	if err != nil {
		t.Fatal(err)
	}
	if b, ok := readBusy(d); !ok || b.Pid != os.Getpid() {
		t.Error("mientras trabaja tiene que dejar busy.json con su pid")
	}
	fail := errors.New("se cayó")
	done(&fail)
	if _, ok := readBusy(d); ok {
		t.Error("al terminar se tiene que llevar busy.json")
	}
	if b, _ := os.ReadFile(filepath.Join(d, "steps.log")); !strings.Contains(string(b), "✗ se cayó") {
		t.Errorf("el error tiene que quedar en steps.log: %q", b)
	}
}

// El texto para un modelo junta las frases seguidas de la misma persona y conserva a qué pantalla apuntan.
func TestMeetingContext(t *testing.T) {
	r := recordingJSON{ID: "x", Title: "Weekly", Seconds: 90, State: "done", Summary: "## Resumen\n- algo",
		Speakers:   []Speaker{{ID: 0, Name: "Laura", Seconds: 40}},
		ScreenList: []*Screen{{ID: "P1", Start: 0, End: 30, Seen: "el tablero", Refers: true, Evidence: "esto de acá"}},
		SegmentList: []agentSegment{
			{Start: 0, End: 4, Who: "Laura", Text: "Miren esto de acá.", Screen: "P1"},
			{Start: 5, End: 8, Who: "Laura", Text: "Es el tablero."},
			{Start: 9, End: 12, Who: "yo", Text: "Perfecto."},
			{Start: 40, End: 42, Who: "Laura", Text: "Otra cosa."},
		}}
	c := meetingContext(r, 0, true)
	for _, want := range []string{"Laura (00:40)", "## El resumen que escribió", "### Resumen", "[P1] 00:00–00:30: el tablero — se habló de ella: «esto de acá»",
		"[00:00] Laura (P1): Miren esto de acá. Es el tablero.", "[00:09] yo: Perfecto.", "[00:40] Laura: Otra cosa."} {
		if !strings.Contains(c, want) {
			t.Errorf("falta %q en:\n%s", want, c)
		}
	}
	if strings.Contains(meetingContext(r, 0, false), "Resumen") {
		t.Error("--no-summary no lleva el resumen del modelo")
	}
}

func TestFold(t *testing.T) {
	if fold("Sesión ÁGIL, Niño") != "sesion agil, nino" {
		t.Errorf("fold: %q", fold("Sesión ÁGIL, Niño"))
	}
}

func TestExitCode(t *testing.T) {
	if exitCode(errors.New("x")) != exitFailed || exitCode(withCode(exitTimeout, "y")) != exitTimeout {
		t.Error("los códigos de salida")
	}
}
