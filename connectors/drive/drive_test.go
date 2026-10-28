package drive

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParseID(t *testing.T) {
	cases := map[string]string{
		"https://drive.google.com/drive/folders/17AcO2PoM2U_5MCzpFtvA9bJDbbTwc0th":                 "17AcO2PoM2U_5MCzpFtvA9bJDbbTwc0th",
		"https://drive.google.com/drive/u/1/folders/17AcO2PoM2U_5MCzpFtvA9bJDbbTwc0th?usp=sharing": "17AcO2PoM2U_5MCzpFtvA9bJDbbTwc0th",
		"https://drive.google.com/file/d/1aGYXk-smtSOF_3zLWhdfvJqz724LQa9T/view?usp=drivesdk":      "1aGYXk-smtSOF_3zLWhdfvJqz724LQa9T",
		"https://docs.google.com/document/d/1cGMhArzS4WFNNm8gTcjUmc_k7khPpbXNz68WU23mQpc/edit":     "1cGMhArzS4WFNNm8gTcjUmc_k7khPpbXNz68WU23mQpc",
		"https://docs.google.com/spreadsheets/d/1t1cQM6o5UC75pR0uGiOm6HsfvKlXIVXs/edit#gid=0":      "1t1cQM6o5UC75pR0uGiOm6HsfvKlXIVXs",
		"https://drive.google.com/open?id=1t1cQM6o5UC75pR0uGiOm6HsfvKlXIVXs":                       "1t1cQM6o5UC75pR0uGiOm6HsfvKlXIVXs",
		"  1t1cQM6o5UC75pR0uGiOm6HsfvKlXIVXs ":                                                     "1t1cQM6o5UC75pR0uGiOm6HsfvKlXIVXs",
	}
	for in, want := range cases {
		got, err := ParseID(in)
		if err != nil || got != want {
			t.Errorf("ParseID(%q) = %q, %v; quería %q", in, got, err, want)
		}
	}
	if _, err := ParseID("https://example.com/nada"); err == nil {
		t.Error("una URL sin id debería fallar")
	}
}

func TestQuoteEscapes(t *testing.T) {
	if got := quote(`it's a \ test`); got != `it\'s a \\ test` {
		t.Errorf("quote = %q", got)
	}
}

// El cliente pide con Bearer, sigue el atajo hasta su destino y pagina la lista.
func TestClientAgainstFakeAPI(t *testing.T) {
	var auths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auths = append(auths, r.Header.Get("Authorization"))
		switch {
		case r.URL.Path == "/files/atajo":
			io.WriteString(w, `{"id":"atajo","mimeType":"`+Shortcut+`","shortcutDetails":{"targetId":"carpeta","targetMimeType":"`+Folder+`"}}`)
		case r.URL.Path == "/files/carpeta":
			io.WriteString(w, `{"id":"carpeta","name":"Finandina","mimeType":"`+Folder+`"}`)
		case r.URL.Path == "/files" && r.URL.Query().Get("pageToken") == "":
			if !strings.Contains(r.URL.Query().Get("q"), "'carpeta' in parents") {
				t.Errorf("q = %q", r.URL.Query().Get("q"))
			}
			io.WriteString(w, `{"nextPageToken":"p2","files":[{"id":"a","name":"uno"}]}`)
		case r.URL.Path == "/files":
			io.WriteString(w, `{"files":[{"id":"b","name":"dos"}]}`)
		default:
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"error":{"message":"File not found"}}`)
		}
	}))
	defer srv.Close()

	c := New(OAuthClient{ID: "x", Secret: "y"}, Session{RefreshToken: "r"})
	c.base, c.access, c.expires = srv.URL, "tok", time.Now().Add(time.Hour)
	ctx := context.Background()

	f, err := c.Get(ctx, "atajo")
	if err != nil || f.ID != "carpeta" || !f.IsFolder() {
		t.Fatalf("Get(atajo) = %+v, %v", f, err)
	}
	files, err := c.List(ctx, f.ID)
	if err != nil || len(files) != 2 || files[1].ID != "b" {
		t.Fatalf("List = %+v, %v", files, err)
	}
	if _, err := c.Get(ctx, "nada"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("un 404 debería decirlo: %v", err)
	}
	for _, a := range auths {
		if a != "Bearer tok" {
			t.Fatalf("Authorization = %q", a)
		}
	}
}
