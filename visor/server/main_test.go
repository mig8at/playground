package main

import (
	"bufio"
	"bytes"
	"context"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"creditop/playground/connectors/figma"
)

// La clave y el id terminan en una RUTA DE DISCO: cualquier cosa que no tenga su forma exacta se
// rechaza antes de tocar el sistema de archivos.
func TestScreenRejectsWhatIsNotAKeyAndANode(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.export = func(context.Context, string, []string) (map[string][]byte, error) {
		t.Fatal("no debería pedir nada a Figma")
		return nil, nil
	}
	for _, q := range []string{
		"key=../../etc&id=1:2", "key=SsvFsK5tLvR1jNT3Hh6znD&id=../x", "key=SsvFsK5tLvR1jNT3Hh6znD&id=1:2/../3",
		"key=corta&id=1:2", "key=SsvFsK5tLvR1jNT3Hh6znD&id=",
	} {
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/screen?"+q, nil))
		if rec.Code != 400 {
			t.Errorf("%s: HTTP %d, quería 400", q, rec.Code)
		}
	}
}

// Una imagen se baja UNA vez aunque la pidan varios a la vez (la UI y la tanda de fondo), y la
// segunda vez sale del disco.
func TestScreenDownloadsOnceAndServesFromDisk(t *testing.T) {
	s := newServer(nil, t.TempDir())
	var calls int32
	s.export = func(_ context.Context, key string, ids []string) (map[string][]byte, error) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(50 * time.Millisecond)
		out := map[string][]byte{}
		for _, id := range ids {
			out[id] = []byte("PNG-" + id)
		}
		return out, nil
	}
	s.versions["SsvFsK5tLvR1jNT3Hh6znD"] = "v1"
	get := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/screen?key=SsvFsK5tLvR1jNT3Hh6znD&id=334:2735", nil))
		return rec
	}
	done := make(chan *httptest.ResponseRecorder, 3)
	for i := 0; i < 3; i++ {
		go func() { done <- get() }()
	}
	for i := 0; i < 3; i++ {
		if rec := <-done; rec.Code != 200 || rec.Body.String() != "PNG-334:2735" {
			t.Fatalf("respuesta %d: %q", rec.Code, rec.Body.String())
		}
	}
	if calls != 1 {
		t.Errorf("tres pedidos a la vez tienen que bajar una sola vez; bajaron %d", calls)
	}
	if rec := get(); rec.Code != 200 || calls != 1 {
		t.Errorf("la cuarta sale del disco: HTTP %d, bajadas %d", rec.Code, calls)
	}
	if _, err := os.Stat(s.imagePath("SsvFsK5tLvR1jNT3Hh6znD", "v1", "334:2735")); err != nil {
		t.Errorf("no quedó en disco: %v", err)
	}
	if !strings.Contains(s.imagePath("SsvFsK5tLvR1jNT3Hh6znD", "v2", "334:2735"), "v2") {
		t.Error("otra versión del archivo va a otra ruta: la imagen vieja no se sirve después de un cambio")
	}
}

// Una pantalla que Figma no pudo exportar es un error visible, no una imagen vacía guardada.
func TestAnEmptyExportIsAnError(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.export = func(context.Context, string, []string) (map[string][]byte, error) {
		return map[string][]byte{}, nil
	}
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/screen?key=SsvFsK5tLvR1jNT3Hh6znD&id=1:2", nil))
	if rec.Code == http.StatusOK {
		t.Fatal("una exportación vacía no puede servirse como imagen")
	}
	if _, err := os.Stat(s.imagePath("SsvFsK5tLvR1jNT3Hh6znD", "", "1:2")); err == nil {
		t.Error("una exportación vacía no puede quedar en disco")
	}
}

// Abrir un archivo lo anota una vez (y actualiza cuándo), y se puede sacar: la biblioteca es una
// preferencia de esta máquina y no crece con cada apertura.
func TestLibraryRemembersOpenedFilesOnce(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.library.opened("SsvFsK5tLvR1jNT3Hh6znD", "flujo ecommerce", "PRODUCTO")
	s.library.opened("SsvFsK5tLvR1jNT3Hh6znD", "flujo ecommerce v2", "")
	s.library.opened("AbCdEf1234567", "alta", "")
	lib := s.library.read()
	if len(lib.Opened) != 2 || lib.Opened[0].Name != "flujo ecommerce v2" || lib.Opened[0].Folder != "PRODUCTO" {
		t.Fatalf("abiertos: %+v", lib.Opened)
	}
	// El nombre de antes queda como alias, una vez: la ruta vieja del proyecto sigue abriendo.
	s.library.opened("SsvFsK5tLvR1jNT3Hh6znD", "flujo ecommerce v2", "")
	if a := s.library.read().Opened[0].Aliases; len(a) != 1 || a[0] != "flujo ecommerce" {
		t.Errorf("alias del renombre: %v", a)
	}
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest("DELETE", "/api/library?file=AbCdEf1234567", nil))
	if rec.Code != 200 || len(s.library.read().Opened) != 1 {
		t.Errorf("sacar un archivo: HTTP %d, quedan %+v", rec.Code, s.library.read().Opened)
	}
	rec = httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest("POST", "/api/library", strings.NewReader(`{}`)))
	if rec.Code != 400 {
		t.Errorf("sin url no se suma nada: HTTP %d", rec.Code)
	}
}

// Un enlace con huella dice si la pantalla sigue siendo la que se enlazó, si el diseñador la cambió o si
// la borró; sin huella, sólo que existe.
func TestTrackTellsSameChangedDeletedAndUnsigned(t *testing.T) {
	s := newServer(nil, t.TempDir())
	content := map[string]string{"1:2": `{"id":"1:2","name":"Pago"}`}
	s.nodeJSON = func(_ context.Context, key, id string) ([]byte, error) {
		if c, ok := content[id]; ok {
			return []byte(c), nil
		}
		return nil, &figma.Error{Status: 404, Message: "el nodo " + id + " no está en el archivo"}
	}
	print, _ := figma.Fingerprint([]byte(content["1:2"]))
	ctx := context.Background()
	for _, c := range []struct{ id, linked, want string }{
		{"1:2", print, linkSame}, {"1:2", "", linkUnsigned}, {"9:9", print, linkDeleted},
	} {
		if res, err := s.track(ctx, "SsvFsK5tLvR1jNT3Hh6znD", c.id, c.linked); err != nil || res.Status != c.want {
			t.Errorf("%s con huella %q: %+v %v, quería %s", c.id, c.linked, res, err, c.want)
		}
	}
	content["1:2"] = `{"id":"1:2","name":"Pago, con otro texto"}`
	if res, _ := s.track(ctx, "SsvFsK5tLvR1jNT3Hh6znD", "1:2", print); res.Status != linkChanged || res.Print == print {
		t.Errorf("el diseñador la cambió: %+v", res)
	}
}

// `make visor-enlaces`: encuentra los enlaces del visor en las tareas, resuelve el proyecto por su nombre
// (también uno viejo) y sale con 1 si alguno se rompió.
func TestCheckLinksFindsBrokenLinksInTasks(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.library.opened("SsvFsK5tLvR1jNT3Hh6znD", "Crédito Ñandú", "PRODUCTO")
	s.library.opened("SsvFsK5tLvR1jNT3Hh6znD", "Crédito Ñandú v2", "")
	s.nodeJSON = func(_ context.Context, key, id string) ([]byte, error) {
		if id == "1:2" {
			return []byte(`{"id":"1:2"}`), nil
		}
		return nil, &figma.Error{Status: 404}
	}
	print, _ := figma.Fingerprint([]byte(`{"id":"1:2"}`))
	dir := t.TempDir()
	task := "Pantalla: http://localhost:5193/credito-nandu/1-2?huella=" + print + " y otra " +
		"(http://localhost:5193/credito-nandu-v2/9-9?huella=" + print + ")\nuna de otro: http://localhost:5193/no-existe/1-2\n" +
		"en un bloque: [Pago](visor:credito-nandu/1-2@000000000000)\n"
	if err := os.WriteFile(dir+"/task.md", []byte(task), 0o644); err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	w := bufio.NewWriter(&out)
	code := s.checkLinks(context.Background(), dir, w)
	w.Flush()
	got := out.String()
	for _, want := range []string{"igual", "task.md:1", "credito-nandu/1-2", "BORRADA", "credito-nandu-v2/9-9", "¿PROYECTO?", "no-existe/1-2",
		"CAMBIÓ      task.md:3", "4 enlace(s) · 1 igual · 1 cambió · 1 borrada"} {
		if !strings.Contains(got, want) {
			t.Errorf("falta %q en:\n%s", want, got)
		}
	}
	if code != 1 {
		t.Errorf("con un enlace roto sale con 1, salió con %d", code)
	}
}

// El nombre del proyecto en la ruta es el mismo que arma la UI (slugOf de App.vue).
func TestSlugMatchesTheUI(t *testing.T) {
	for in, want := range map[string]string{"flujo ecommerce": "flujo-ecommerce", "Motai Renting": "motai-renting",
		"Crédito Ñandú — v2": "credito-nandu-v2", "  CreditopX ": "creditopx"} {
		if got := slugOf(in); got != want {
			t.Errorf("slugOf(%q) = %q, quería %q", in, got, want)
		}
	}
}

// La hoja de tokens sale del mapa con más colores con nombre del archivo, lista para pegar; y el HTML los
// recibe por id de estilo.
func TestTokensComeFromTheMapWithMostColors(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.maps["SsvFsK5tLvR1jNT3Hh6znD|334:455"] = figma.Structure{FileName: "flujo ecommerce", Tokens: &figma.Tokens{
		Colors: []figma.ColorToken{{ID: "C1", Name: "Colors/morado/morado-500", Var: "--morado-500", Value: "#4c39ff", Uses: 3}}}}
	s.maps["SsvFsK5tLvR1jNT3Hh6znD|1:259"] = figma.Structure{FileName: "flujo ecommerce", Tokens: &figma.Tokens{
		Colors: []figma.ColorToken{{ID: "C1", Name: "Colors/morado/morado-500", Var: "--morado-500", Value: "#4c39ff", Uses: 9},
			{ID: "C2", Name: "Colors/neutral/neutral-0", Var: "--neutral-0", Value: "#ffffff", Uses: 4}},
		Texts: []figma.TextToken{{ID: "T1", Name: "text-small/medium", Class: "text-small-medium", Family: "Satoshi", Size: 14}}}}
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/tokens?key=SsvFsK5tLvR1jNT3Hh6znD&format=css", nil))
	if body := rec.Body.String(); rec.Code != 200 || !strings.Contains(body, "--neutral-0: #ffffff;") || !strings.Contains(body, "«flujo ecommerce»") {
		t.Errorf("HTTP %d:\n%s", rec.Code, body)
	}
	if st := s.styleTokens("SsvFsK5tLvR1jNT3Hh6znD"); st["C2"].Var != "--neutral-0" || st["T1"].Class != "text-small-medium" {
		t.Errorf("tokens para el HTML: %+v", st)
	}
	// Sin un mapa en memoria —el server recién arrancado— se lee la página de flujo del archivo.
	s.readFlow = func(_ context.Context, key string) (figma.Structure, string, error) {
		return figma.Structure{FileName: "Motai", Tokens: &figma.Tokens{Colors: []figma.ColorToken{{ID: "C9", Name: "colors/verde/500", Var: "--verde-500", Value: "#01a702"}}}}, "1:259", nil
	}
	rec = httptest.NewRecorder()
	s.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/api/tokens?key=AbCdEf1234567890&format=tailwind", nil))
	if body := rec.Body.String(); rec.Code != 200 || !strings.Contains(body, "--color-verde-500: #01a702;") {
		t.Errorf("sin mapa leído se lee la página de flujo: HTTP %d\n%s", rec.Code, body)
	}
	if _, ok := s.maps["AbCdEf1234567890|1:259"]; !ok {
		t.Error("el mapa leído queda en memoria: el HTML de sus pantallas usa los mismos tokens")
	}
}

// La página de flujo, con la misma regla que la barra.
func TestFlowPageFollowsTheSidebarRule(t *testing.T) {
	pages := []figma.Project{{ID: "0:1", Name: "🟦 Cover"}, {ID: "1:258", Name: "🔍 Bechmarck"}, {ID: "1:259", Name: "✏️ Flujo"}, {ID: "614:1086", Name: "prototipo"}}
	if p, _ := flowPage(pages); p.ID != "1:259" {
		t.Errorf("la que se llama Flujo: %+v", p)
	}
	if p, _ := flowPage(pages[:2]); p.ID != "0:1" {
		t.Errorf("sin «Flujo» y todas saltables, la primera: %+v", p)
	}
	if p, _ := flowPage([]figma.Project{{ID: "0:1", Name: "Cover"}, {ID: "2:1", Name: "Pantallas"}}); p.ID != "2:1" {
		t.Errorf("la primera que no es portada: %+v", p)
	}
}

// El paquete para el modelo junta lo que se sabe de la pantalla: su enlace con huella, dónde está, sus
// textos en orden, a dónde lleva, los componentes y tokens que usa y el HTML.
func TestBriefGathersEverythingAboutAScreen(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.library.opened("SsvFsK5tLvR1jNT3Hh6znD", "flujo ecommerce", "PRODUCTO")
	screen := `{"id":"1:2","name":"Frame 9","type":"FRAME","absoluteBoundingBox":{"x":0,"y":0,"width":430,"height":932},"children":[
	  {"id":"1:3","type":"TEXT","characters":"Elige tu plan","styles":{"fill":"C1"},"absoluteBoundingBox":{"x":20,"y":80,"width":300,"height":30},
	   "fills":[{"type":"SOLID","color":{"r":0.145,"g":0.133,"b":0.337,"a":1}}]},
	  {"id":"1:4","type":"TEXT","characters":"Continuar","absoluteBoundingBox":{"x":20,"y":800,"width":100,"height":20}}]}`
	s.nodeJSON = func(context.Context, string, string) ([]byte, error) { return []byte(screen), nil }
	s.maps["SsvFsK5tLvR1jNT3Hh6znD|1:259"] = figma.Structure{FileName: "flujo ecommerce",
		Lanes: []figma.Lane{{Label: "No paga cuota inicial", Screens: []figma.Screen{
			{ID: "1:1", Title: "Inicio"}, {ID: "1:2", Title: "Elige tu plan", Kind: "mobile", W: 430, H: 932,
				Hotspots: []figma.Hotspot{{To: "1:5", ToName: "«Pago»", Via: "clic en «Continuar»"}}}}}},
		Tokens:    &figma.Tokens{Colors: []figma.ColorToken{{ID: "C1", Name: "Colors/violet/violet-500", Var: "--violet-500", Value: "#252256"}}},
		Inventory: []figma.ComponentUse{{Name: "Botones", Screens: []string{"1:2"}, Props: []figma.PropValues{{Name: "Estado", Type: "VARIANT", Values: []figma.ValueCount{{Value: "Primary button", Uses: 1}}}}}},
	}
	text, err := s.brief(context.Background(), "SsvFsK5tLvR1jNT3Hh6znD", "1:2")
	if err != nil {
		t.Fatal(err)
	}
	print, _ := figma.Fingerprint([]byte(screen))
	for _, want := range []string{"# «Elige tu plan» · flujo ecommerce", "(visor:flujo-ecommerce/1-2@" + print + ")",
		"carril «No paga cuota inicial», 2 de 2 · móvil 430×932", "1. Elige tu plan\n2. Continuar", "- clic en «Continuar» → «Pago»",
		"- Botones — variantes en el archivo: Estado: Primary button", "`--violet-500` #252256 — Colors/violet/violet-500 ×1", "```html\n<!doctype html>",
		"make visor-recursos R=SsvFsK5tLvR1jNT3Hh6znD/1-2 DIR=<carpeta>", "make visor-tokens P=SsvFsK5tLvR1jNT3Hh6znD"} {
		if !strings.Contains(text, want) {
			t.Errorf("falta %q en:\n%s", want, text)
		}
	}
}

// La API por consola nombra la pantalla como la ruta, el enlace visor: de una tarea, la URL del visor o la
// de Figma: las cuatro llegan al mismo archivo y nodo.
func TestCLINamesAScreenLikeTheRouteDoes(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.library.opened("RkyauDfqEsFbJZBBoqChAV", "Altafinanciera", "PRODUCTO")
	for _, ref := range []string{"RkyauDfqEsFbJZBBoqChAV/266-1279", "altafinanciera/266-1279", "visor:altafinanciera/266-1279@53265587646d",
		"http://localhost:5193/altafinanciera/266-1279?modo=html", "https://www.figma.com/design/RkyauDfqEsFbJZBBoqChAV/x?node-id=266-1279"} {
		key, id, err := s.resolveScreen(ref)
		if err != nil || key != "RkyauDfqEsFbJZBBoqChAV" || id != "266:1279" {
			t.Errorf("%s → %s %s %v", ref, key, id, err)
		}
	}
	if _, _, err := s.resolveScreen("nada"); err == nil {
		t.Error("lo que no es una ruta es un error de uso")
	}
}

// `visor recursos` baja las imágenes ORIGINALES de la pantalla con el nombre de su capa, y dice cuál es
// el fondo y cuál va en círculo.
func TestCLIAssetsDownloadOriginalsNamedByLayer(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.library.opened("RkyauDfqEsFbJZBBoqChAV", "Altafinanciera", "PRODUCTO")
	s.readFlow = func(context.Context, string) (figma.Structure, string, error) { return figma.Structure{}, "0:1", nil }
	screen := `{"id":"266:1279","name":"home","type":"FRAME","absoluteBoundingBox":{"x":0,"y":0,"width":430,"height":903},
	  "fills":[{"type":"IMAGE","imageRef":"ed64224686598c2ab9c32603378aae637c8e8b84","scaleMode":"STRETCH"}],
	  "children":[{"id":"266:1300","name":"Logo","type":"FRAME","cornerRadius":100,"absoluteBoundingBox":{"x":171,"y":64,"width":88,"height":88},
	    "fills":[{"type":"IMAGE","imageRef":"e88a28145b5cce8ddf0f5aca0b7d1b73493abc05","scaleMode":"FILL"}]}]}`
	s.nodeJSON = func(context.Context, string, string) ([]byte, error) { return []byte(screen), nil }
	var buf bytes.Buffer
	_ = png.Encode(&buf, image.NewGray(image.Rect(0, 0, 1448, 1086)))
	pngBytes := buf.Bytes()
	jpg := []byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00")
	s.fills = func(_ context.Context, _ string, refs []string) (map[string][]byte, error) {
		out := map[string][]byte{}
		for _, r := range refs {
			out[r] = map[bool][]byte{true: pngBytes, false: jpg}[strings.HasPrefix(r, "ed64")]
		}
		return out, nil
	}
	dir := t.TempDir()
	var out strings.Builder
	if err := cliAssets(s, context.Background(), []string{"altafinanciera/266-1279", "--dir", dir}, &out); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	for _, want := range []string{"home.png", "1448×1086", "fondo de la pantalla «home»", "logo.jpg", "imagen en círculo (logo o avatar) «Logo»"} {
		if !strings.Contains(got, want) {
			t.Errorf("falta %q en:\n%s", want, got)
		}
	}
	for _, f := range []string{"home.png", "logo.jpg"} {
		if _, err := os.Stat(dir + "/" + f); err != nil {
			t.Errorf("no quedó %s: %v", f, err)
		}
	}
}
