package main

import (
	"context"
	"strings"
	"testing"
)

func TestBest(t *testing.T) {
	cs := []Contact{
		{Channel: "form", Value: "PQRS", Fit: "general"},
		{Channel: "whatsapp", Value: "+57 333", Fit: "commercial"},
		{Channel: "email", Value: "ventas@x.co", Fit: "commercial"},
		{Channel: "phone", Value: "604", Fit: "proposals"},
	}
	if b := best(cs); b.Value != "604" {
		t.Errorf("el área de propuestas gana aunque sea teléfono: %+v", b)
	}
	if b := best(cs[:3]); b.Value != "ventas@x.co" {
		t.Errorf("a igual área, el correo gana: %+v", b)
	}
	if best(nil) != nil {
		t.Error("sin contactos no hay mejor")
	}
}

func TestCleanWebsite(t *testing.T) {
	for in, want := range map[string]string{"no encontrado": "", "": "", "https://www.dismerca.com": "https://www.dismerca.com", "No tiene sitio": ""} {
		if got := cleanWebsite(in); got != want {
			t.Errorf("cleanWebsite(%q) = %q", in, got)
		}
	}
}

func TestApplyResearch(t *testing.T) {
	c := &Company{Name: "Dismerca"}
	applyResearch(c, &Research{Matched: true, Website: "https://dismerca.com", Summary: "Concesionario Auteco.",
		Contacts: []Contact{{Channel: "whatsapp", Value: "+57 333 033 4551", Area: "comercial", Fit: "commercial", Source: "https://dismerca.com/post-venta/"}}})
	if c.Website != "https://dismerca.com" || c.Phone != "+57 333 033 4551" || c.Research == nil {
		t.Fatalf("no guardó lo encontrado: %+v", c)
	}
	if last := c.Activities[len(c.Activities)-1]; last.Kind != "research" || !strings.Contains(last.Text, "whatsapp +57 333 033 4551") {
		t.Errorf("la bitácora dice el canal: %+v", last)
	}
	empty := &Company{Name: "Todomotos"}
	applyResearch(empty, &Research{Matched: true, Summary: "Sin sitio."})
	if !strings.HasPrefix(empty.Activities[0].Text, "Sin canal público") {
		t.Errorf("sin canal lo dice: %q", empty.Activities[0].Text)
	}
}

func TestContactRoute(t *testing.T) {
	dataDir, root = t.TempDir(), t.TempDir()
	research = func(_ context.Context, c *Company) (*Research, error) {
		return &Research{Matched: true, Summary: "ok", Contacts: []Contact{{Channel: "email", Value: "alianzas@x.co", Area: "alianzas", Fit: "proposals", Source: "https://x.co/contacto"}}}, nil
	}
	st := &State{Companies: []*Company{{ID: "co_1", Kind: KindMerchant, Name: "X", Stage: "prospect"}}}
	if err := saveState(st); err != nil {
		t.Fatal(err)
	}
	h := guard(routes())
	req := newReq("POST", "/api/companies/co_1/contact", nil)
	rec := do(h, req)
	if rec.Code != 200 {
		t.Fatalf("contacto: %d %s", rec.Code, rec.Body.String())
	}
	st, _ = loadState()
	if st.Companies[0].Email != "alianzas@x.co" || st.Companies[0].Research == nil {
		t.Errorf("no quedó guardado: %+v", st.Companies[0])
	}
}

func TestValidAndMerge(t *testing.T) {
	if validContact(Contact{Channel: "whatsapp", Value: "@autecodismerca (Instagram)", Source: "https://dismerca.com"}) {
		t.Error("un usuario de Instagram no es un WhatsApp")
	}
	if validContact(Contact{Channel: "email", Value: "ventas arroba x", Source: "https://x.co"}) {
		t.Error("un correo tiene que ser un correo")
	}
	if !validContact(Contact{Channel: "phone", Value: "604 444 8101", Source: "https://x.co"}) {
		t.Error("un teléfono con sus dígitos vale")
	}
	site := []Contact{{Channel: "whatsapp", Value: "+573330334551", Source: "https://dismerca.com"}}
	model := []Contact{{Channel: "whatsapp", Value: "333 033 4551", Source: "https://dismerca.com/post-venta/"}, {Channel: "phone", Value: "604 444 8101", Source: "https://dir.co"}}
	got := mergeContacts(site, model)
	if len(got) != 2 || got[0].Value != "+573330334551" {
		t.Errorf("lo del sitio va primero y no se repite el mismo número: %+v", got)
	}
	if f, _ := emailFit("alianzas@x.co"); f != "proposals" {
		t.Errorf("alianzas@ recibe propuestas: %s", f)
	}
	if f, _ := emailFit("info@x.co"); f != "general" {
		t.Errorf("info@ es general: %s", f)
	}
}

func TestDropRoute(t *testing.T) {
	dataDir, root = t.TempDir(), t.TempDir()
	st := &State{Companies: []*Company{{ID: "co_1", Kind: KindMerchant, Name: "Todomotos VS", NIT: "830506750", Stage: "prospect",
		Research: &Research{Matched: true, Summary: "Sin sitio ni canal."}}}}
	if err := saveState(st); err != nil {
		t.Fatal(err)
	}
	if rec := do(guard(routes()), newReq("POST", "/api/companies/co_1/drop", strings.NewReader("{}"))); rec.Code != 200 {
		t.Fatalf("drop: %d %s", rec.Code, rec.Body.String())
	}
	st, _ = loadState()
	if len(st.Companies) != 0 || len(st.NoChannel) != 1 || st.NoChannel[0].NIT != "830506750" || st.NoChannel[0].Summary != "Sin sitio ni canal." {
		t.Errorf("sale de la lista y queda anotada: %+v", st)
	}
}

func TestCountry(t *testing.T) {
	co, _ := computeFit(&Company{Kind: KindMerchant, Country: "CO", Points: 30, Sector: "cars"})
	pe, _ := computeFit(&Company{Kind: KindMerchant, Country: "PE", Points: 30, Sector: "cars"})
	if pe <= co {
		t.Errorf("en Perú (BCP Vehicular) carros encaja del todo: PE %d, CO %d", pe, co)
	}
	m := &Measured{Clients: []Client{{Name: "Ferronor SAC"}}}
	m.index()
	st := &State{Companies: []*Company{{ID: "co_1", Name: "Autos del Pacífico"}}, NoChannel: []Dropped{{Name: "Motor Sur SAC"}}}
	list := []WebCandidate{{Name: "Ferronor", LegalName: "FERRONOR SAC", Country: "PE", Sector: "home"}, {Name: "Autos del Pacífico", Country: "PE", Sector: "cars"},
		{Name: "Motor Sur", LegalName: "Motor Sur SAC", Country: "PE", Sector: "cars"}, {Name: "Nueva", Country: "PE", Sector: "cars", Points: 12}}
	markWeb(list, st, m)
	if list[0].Client == "" || list[1].Tracked == "" || !list[2].NoChannel || list[3].Client != "" || list[3].Fit == 0 {
		t.Errorf("marcas: %+v", list)
	}
	c := &Company{Name: "X", Kind: KindMerchant, Country: "AR"}
	if validateCompany(c) == nil {
		t.Error("un país que no está se rechaza")
	}
}

func TestRankLenders(t *testing.T) {
	m := &Measured{Countries: []string{"Colombia", "Perú", "República Dominicana"}, Lenders: []string{"Cuotealo BCP", "PayJoy"}}
	list := rankLenders([]Lender{
		{Name: "Credicorp (BCP)", Aliases: []string{"BCP"}, Countries: []LenderCountry{{Country: "Perú"}, {Country: "Colombia"}, {Country: "Bolivia"}, {Country: "Chile"}}},
		{Name: "Promerica", Aliases: []string{"Promerica"}, Countries: []LenderCountry{{Country: "Guatemala"}, {Country: "Honduras"}, {Country: "República Dominicana"}}},
		{Name: "PayJoy", Aliases: []string{"PayJoy"}, Countries: []LenderCountry{{Country: "México"}}},
	}, m)
	if list[0].Name != "Credicorp (BCP)" || len(list[0].Activates) != 2 || !list[0].Have {
		t.Errorf("Credicorp activa Bolivia y Chile y ya la tenemos: %+v", list[0])
	}
	if list[1].Name != "Promerica" || len(list[1].Activates) != 2 || list[1].Have {
		t.Errorf("Promerica: República Dominicana ya está, no la tenemos: %+v", list[1])
	}
	if !list[2].Have || len(list[2].Activates) != 1 {
		t.Errorf("PayJoy: %+v", list[2])
	}
}
