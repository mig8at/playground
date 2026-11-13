package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTheProposalNamesTheTasksMailOfTheWindow(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CORREO_DATA", dir)
	now := time.Date(2026, 11, 13, 15, 0, 0, 0, time.Local)
	at := func(h, m int) string { return time.Date(2026, 11, 13, h, m, 0, 0, time.Local).Format(time.RFC3339) }
	state := `{"messages":{"vtex":[
	  {"id":"m1","threadId":"t1","from":"\"Juan Alzate (VTEX)\" <support@vtexhelp.zendesk.com>","subject":"[VTEX] Re: Homologation","date":"` + at(13, 20) + `"},
	  {"id":"m0","threadId":"t1","from":"VTEX Support <support@vtexhelp.zendesk.com>","subject":"[VTEX] Re: Homologation","date":"` + at(9, 49) + `"}],
	  "shopify":[{"id":"s1","threadId":"t2","from":"Shopify <support@shopify.com>","subject":"ajeno","date":"` + at(14, 0) + `"}]},
	 "threads":{"t1":{"lastMine":"` + at(13, 42) + `"},"t2":{"lastMine":"` + at(14, 2) + `"}}}`
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte(state), 0o600); err != nil {
		t.Fatal(err)
	}
	got := mailEvents("", []string{"vtex"}, now.Add(-2*time.Hour), now)
	if len(got) != 2 || got[0].What != "Juan Alzate (VTEX) escribió" || got[1].What != "respondiste" {
		t.Fatalf("en el lapso, lo de VTEX (no lo de antes ni el de otro seguimiento): %+v", got)
	}
	sec := mailSection([]string{"vtex"}, got)
	for _, want := range []string{"Correo (vtex):", "13:20 · Juan Alzate (VTEX) escribió: [(VTEX) Re: Homologation](https://mail.google.com/mail/#all/t1)", "13:42 · respondiste:"} {
		if !strings.Contains(sec, want) {
			t.Errorf("falta %q en:\n%s", want, sec)
		}
	}
	if mailEvents("", nil, now.Add(-2*time.Hour), now) != nil || mailSection(nil, nil) != "" {
		t.Error("sin `correo:` la propuesta no nombra correo")
	}
}
