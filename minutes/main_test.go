package main

import "testing"

// Sin audífonos el micrófono repite lo que suena en la reunión: esa frase no tiene que aparecer dos veces.
func TestMarkEcho(t *testing.T) {
	all := []Segment{{Start: 0.3, End: 9.3, Source: "system", Text: "Hola, esto que les muestro en pantalla es el tablero de tareas."}}
	mic := []Segment{
		{Start: 0.5, End: 5, Source: "mic", Text: "Hola, esto que les muestro en pantalla."},
		{Start: 20, End: 24, Source: "mic", Text: "Yo creo que hay que moverlo al viernes."},
	}
	markEcho(mic, all)
	if !mic[0].Echo {
		t.Error("la frase repetida por los parlantes tenía que quedar como eco")
	}
	if mic[1].Echo {
		t.Error("lo que dice quien graba no es eco")
	}
}

func TestHallucination(t *testing.T) {
	for _, s := range []string{"Gracias.", "¡Gracias por ver!", "Subtítulos realizados por la comunidad de Amara.org", "[Música]", "..."} {
		if !hallucination(s) {
			t.Errorf("%q es lo que Whisper inventa sobre silencio", s)
		}
	}
	for _, s := range []string{"Gracias a todos por venir, arrancamos.", "Decidimos usar example.com"} {
		if hallucination(s) {
			t.Errorf("%q es habla de verdad", s)
		}
	}
}

// Una pantalla que se vio un rato, o mientras alguien decía «esto», es candidata; un parpadeo sin nada dicho, no.
func TestBuildScreens(t *testing.T) {
	frames := []Frame{{T: 0, File: "a"}, {T: 10, File: "b"}, {T: 11, File: "c"}, {T: 13, File: "d"}}
	segs := []Segment{{Start: 11.2, End: 12.5, Source: "system", Text: "Acá ven la tabla de cupos"}}
	got := buildScreens(frames, segs, 30, 10)
	files := ""
	for _, s := range got {
		files += s.File
	}
	if files != "acd" {
		t.Fatalf("pantallas = %q, quería «acd» (b es un parpadeo; c se señaló)", files)
	}
	if len(got[1].Deictic) == 0 || got[1].ID != "P2" {
		t.Errorf("c tenía que llevar lo señalado y el id P2: %+v", got[1])
	}
	if n := len(buildScreens(frames, segs, 30, 1)); n != 1 {
		t.Errorf("con max 1 quedan %d", n)
	}
}

func TestMdToHTML(t *testing.T) {
	got := mdToHTML("## Decisiones\n- Usar **example.com** [P4]")
	want := "<h3>Decisiones</h3>\n<ul>\n<li>Usar <strong>example.com</strong> <a class=\"ref\" href=\"#P4\">P4</a></li>\n</ul>\n"
	if got != want {
		t.Errorf("mdToHTML =\n%s\nquería\n%s", got, want)
	}
}
