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

// Cada frase del sistema se queda con quien más habló mientras se decía; el micrófono sigue siendo «yo».
func TestAssignSpeakers(t *testing.T) {
	segs := []TimedSegment{
		{Segment: Segment{Start: 0, End: 5, Source: "system"}},
		{Segment: Segment{Start: 5, End: 10, Source: "system"}},
		{Segment: Segment{Start: 12.5, End: 13, Source: "system"}}, // en un hueco del modelo, a 0,5 s del tramo de 1
		{Segment: Segment{Start: 20, End: 22, Source: "system"}},   // lejos de todo: queda «reunión»
		{Segment: Segment{Start: 1, End: 4, Source: "mic"}},
	}
	turns := []TurnSpan{{Speaker: 0, Start: 0, End: 6}, {Speaker: 1, Start: 6, End: 12}}
	assignSpeakers(segs, turns)
	names := map[string]string{"1": "Laura"}
	got := []string{}
	for _, g := range segs {
		got = append(got, who(g, names))
	}
	want := []string{"Persona 1", "Laura", "Laura", "reunión", "yo"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("quién = %v, quería %v", got, want)
		}
	}
	sp := speakersOf(segs, names)
	if len(sp) != 2 || sp[0].Name != "Persona 1" || sp[1].Name != "Laura" {
		t.Errorf("personas = %+v", sp)
	}
}

// Una frase de dos personas se corta donde cambia quién habla, sin partir palabras ni separar la puntuación.
func TestSplitBySpeaker(t *testing.T) {
	g := Segment{Start: 0, End: 4, Source: "system", Text: "It labels who spoke. Amazing.", Words: []Word{
		{0, 0.5, " It"}, {0.5, 1, " lab"}, {1, 1.3, "els"}, {1.3, 1.6, " who"}, {1.6, 2, " spoke"}, {2, 2.1, "."},
		{2.4, 3.2, " Amazing"}, {3.2, 3.3, "."},
	}}
	turns := []TurnSpan{{Speaker: 0, Start: 0, End: 2.2}, {Speaker: 1, Start: 2.3, End: 4}}
	got := splitBySpeaker([]Segment{g, {Start: 5, End: 6, Source: "mic", Text: "yo"}}, turns)
	if len(got) != 3 || got[0].Text != "It labels who spoke." || got[1].Text != "Amazing." || got[1].Start != 2.4 || got[2].Source != "mic" {
		t.Fatalf("cortes = %+v", got)
	}
	// un pedazo cortito de otra voz encima no parte la frase
	short := []TurnSpan{{Speaker: 0, Start: 0, End: 4}, {Speaker: 1, Start: 1.3, End: 1.6}}
	if n := len(splitBySpeaker([]Segment{g}, short)); n != 1 {
		t.Errorf("con un «ajá» de 0,3 s salieron %d pedazos", n)
	}
}

// El corte se corre a la pausa natural: el modelo de voces marca el cambio unas décimas antes o después.
func TestSnapCuts(t *testing.T) {
	g := Segment{Start: 0, End: 6, Source: "system", Words: []Word{
		{0, 0.4, " voices"}, {0.4, 0.6, " to"}, {0.6, 0.8, " the"}, {0.8, 1.1, " party"}, {1.1, 1.2, "."},
		{1.6, 1.8, " I"}, {1.8, 2.0, "'m"}, {2.0, 2.4, " Chris"}, {2.4, 2.5, "."},
	}}
	// el modelo dice que la segunda voz arranca en 0,7 s (antes de «the party.»)
	turns := []TurnSpan{{Speaker: 0, Start: 0, End: 0.7}, {Speaker: 1, Start: 0.7, End: 3}}
	got := splitBySpeaker([]Segment{g}, turns)
	if len(got) != 2 || got[0].Text != "voices to the party." || got[1].Text != "I'm Chris." {
		t.Fatalf("cortes = %q", []string{got[0].Text, got[len(got)-1].Text})
	}
}

// El corte de voz cruza el borde de frase de Whisper: «…voices to» | «the party.» es una sola voz.
func TestSplitAcrossSentences(t *testing.T) {
	a := Segment{Start: 0, End: 0.6, Source: "system", Chunk: "system/0.wav", Text: "voices to", Words: []Word{{0, 0.4, " voices"}, {0.4, 0.6, " to"}}}
	b := Segment{Start: 0.6, End: 2.5, Source: "system", Chunk: "system/0.wav", Text: "the party. I'm Chris.", Words: []Word{
		{0.6, 0.8, " the"}, {0.8, 1.1, " party"}, {1.1, 1.2, "."}, {1.6, 1.8, " I"}, {1.8, 2.0, "'m"}, {2.0, 2.4, " Chris"}, {2.4, 2.5, "."}}}
	turns := []TurnSpan{{Speaker: 0, Start: 0, End: 0.7}, {Speaker: 1, Start: 0.7, End: 3}}
	got := splitBySpeaker([]Segment{a, b}, turns)
	var texts []string
	for _, g := range got {
		texts = append(texts, g.Text)
	}
	if len(got) != 3 || texts[0] != "voices to" || texts[1] != "the party." || texts[2] != "I'm Chris." {
		t.Fatalf("frases = %q", texts)
	}
	ts := make([]TimedSegment, len(got))
	for i, g := range got {
		ts[i] = TimedSegment{Segment: g}
	}
	assignSpeakers(ts, turns)
	if *ts[1].Speaker != 0 || *ts[2].Speaker != 1 {
		t.Errorf("«the party.» es de la persona 1 y «I'm Chris.» de la 2: %d, %d", *ts[1].Speaker, *ts[2].Speaker)
	}
}
