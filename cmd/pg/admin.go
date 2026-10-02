package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"creditop/playground/connectors/admin"
)

// El admin de legacy-application por su conector (`connectors/admin`): la sesión, el token CSRF y las páginas de Inertia por
// HTTP, sin navegador. Las credenciales salen de `connectors/.env.<ambiente>` (ADMIN_USER y ADMIN_PASS), una cuenta por persona.
//
// ⚠ ENTRAR (`admin login`) TECLEA UNA CONTRASEÑA, así que lo corre una persona y NO se ofrece como herramienta del modelo.
// Lo guardado después lo usan los demás comandos. Lo que escribe (`admin allied-create`) no escribe sin `--apply`.

func adminTargetParam(required bool) param {
	return param{Name: "target", Type: "string", Desc: "el ambiente del admin (qa no tiene admin propio: usá dev; producción es sólo lectura)", Required: required, Enum: admin.Targets}
}

func adminTargets(arg string) ([]string, int) {
	if arg == "" {
		return admin.Targets, 0
	}
	if _, err := admin.BaseFor(arg); err != nil {
		return nil, fail(2, "%v", err)
	}
	return []string{strings.ToLower(arg)}, 0
}

func runAdminLogin(args []string) int {
	fs := flag.NewFlagSet("admin login", flag.ContinueOnError)
	target := fs.String("target", "", "dev | staging | local")
	if fs.Parse(args) != nil {
		return 2
	}
	if *target == "" {
		return fail(2, "falta --target (%s)", strings.Join(admin.Targets, " | "))
	}
	if _, err := admin.BaseFor(*target); err != nil {
		return fail(2, "%v", err)
	}
	t := strings.ToLower(*target)
	var s *admin.StoredSession
	var err error
	if t == "local" {
		_, s, err = admin.LoginLocal(context.Background())
	} else {
		user, pass, cerr := admin.Credentials(t)
		if cerr != nil {
			return fail(2, "%v", cerr)
		}
		fmt.Printf("  credencial: %s (de connectors/.env.%s)\n", user, t)
		_, s, err = admin.Login(context.Background(), t, user, pass)
	}
	if err != nil {
		return fail(1, "no se pudo entrar: %v", err)
	}
	path, err := admin.WriteSession(s)
	if err != nil {
		return fail(1, "entró pero no pude guardar la sesión: %v", err)
	}
	who := ""
	if s.Who != nil {
		who = " (" + *s.Who + ")"
	}
	fmt.Printf("  ✔ admin en %s: entró %s%s → %s\n    la sesión quedó guardada (su contenido no se muestra)\n", t, s.User, who, path)
	return 0
}

func runAdminLogout(args []string) int {
	fs := flag.NewFlagSet("admin logout", flag.ContinueOnError)
	target := fs.String("target", "", "dev | staging | local")
	if fs.Parse(args) != nil {
		return 2
	}
	if _, err := admin.BaseFor(*target); err != nil {
		return fail(2, "%v", err)
	}
	removed, err := admin.RemoveSession(strings.ToLower(*target))
	if err != nil {
		return fail(1, "%v", err)
	}
	if removed {
		fmt.Printf("  ✔ sesión de admin en %s borrada\n", *target)
	} else {
		fmt.Printf("  · no había sesión de admin en %s\n", *target)
	}
	return 0
}

func runAdminStatus(args []string) int {
	fs := flag.NewFlagSet("admin status", flag.ContinueOnError)
	target := fs.String("target", "", "dev | staging | local (default: todos)")
	asJSON := fs.Bool("json", false, "el estado en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	targets, code := adminTargets(*target)
	if targets == nil {
		return code
	}
	type row struct {
		Target string `json:"target"`
		Exists bool   `json:"exists"`
		Valid  *bool  `json:"valid"`
		User   string `json:"user,omitempty"`
		Who    string `json:"who,omitempty"`
		Since  string `json:"since,omitempty"`
		Detail string `json:"detail"`
	}
	var rows []row
	for _, t := range targets {
		r := row{Target: t}
		s, err := admin.ReadSession(t)
		if err != nil {
			r.Detail = err.Error()
		} else if s == nil {
			r.Detail = "no hay sesión guardada"
		} else {
			r.Exists, r.User, r.Since = true, s.User, s.CreatedAt
			if s.Who != nil {
				r.Who = *s.Who
			}
			c, ferr := admin.FromSession(s)
			if ferr != nil {
				r.Detail = ferr.Error()
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
				who, perr := c.Probe(ctx)
				cancel()
				switch {
				case errors.Is(perr, admin.ErrNoSession):
					f := false
					r.Valid, r.Detail = &f, "el admin manda al login: la sesión venció"
				case perr != nil:
					r.Detail = "no se pudo saber: " + perr.Error()
				default:
					v := true
					r.Valid, r.Detail = &v, "sirve"
					if who != "" {
						r.Who = who
					}
				}
			}
		}
		rows = append(rows, r)
	}
	if *asJSON {
		return printJSON(rows)
	}
	for _, r := range rows {
		state := "—  no hay"
		if r.Exists {
			switch {
			case r.Valid == nil:
				state = "?  sin saber"
			case *r.Valid:
				state = "✅ sirve"
			default:
				state = "✖  vencida"
			}
		}
		who := r.Who
		if who == "" {
			who = r.User
		}
		fmt.Printf("  %-8s %-14s %-44s %s\n", r.Target, state, who, r.Detail)
	}
	return 0
}

func runAdminGet(args []string) int {
	fs := flag.NewFlagSet("admin get", flag.ContinueOnError)
	target := fs.String("target", "", "dev | staging | local")
	path := fs.String("path", "/aliados", "la ruta del admin")
	asJSON := fs.Bool("json", false, "las props de la página en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	if _, err := admin.BaseFor(*target); err != nil {
		return fail(2, "%v", err)
	}
	c, err := admin.Open(context.Background(), strings.ToLower(*target))
	if err != nil {
		return fail(2, "%v", err)
	}
	r, err := c.Get(context.Background(), *path)
	if err != nil {
		return fail(1, "%v", err)
	}
	if *asJSON && r.Page != nil {
		return printJSON(r.Page.Props)
	}
	fmt.Printf("  actúa como %s\n  GET %s → HTTP %d\n", c.ActingAs(), *path, r.Status)
	if r.Page != nil {
		keys := make([]string, 0, len(r.Page.Props))
		for k := range r.Page.Props {
			keys = append(keys, k)
		}
		fmt.Printf("  página %s · props: %s\n", r.Page.Component, strings.Join(keys, ", "))
	}
	return 0
}

func runAdminAlliedCreate(args []string) int {
	fs := flag.NewFlagSet("admin allied-create", flag.ContinueOnError)
	target := fs.String("target", "", "dev | staging | local")
	name := fs.String("name", "", "el nombre; tiene que empezar por «"+admin.AutoPrefix+"» (default: PRUEBA AUTO + la hora)")
	typeID := fs.Int("type", 0, "allied_type_id (default: el primero del formulario)")
	industry := fs.Int("industry", 0, "allied_industry_id (default: el primero del formulario)")
	country := fs.Int("country", 0, "country_id (default: Colombia, 47)")
	price := fs.Int("price", 0, "precio (default 1000000)")
	asJSON := fs.Bool("json", false, "el resultado en JSON")
	apply := applyFlag(fs)
	if fs.Parse(args) != nil {
		return 2
	}
	if _, err := admin.BaseFor(*target); err != nil {
		return fail(2, "%v", err)
	}
	t := strings.ToLower(*target)
	ctx := context.Background()
	c, err := admin.Open(ctx, t)
	if err != nil {
		return fail(2, "%v", err)
	}
	plan, err := c.PlanAllied(ctx, admin.AlliedOptions{Name: *name, TypeID: *typeID, IndustryID: *industry, CountryID: *country, Price: *price})
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("  Va a CREARSE en el admin de %s el comercio %q\n", t, plan.Name)
	fmt.Printf("    actúa como %s\n", plan.ActingAs)
	fmt.Printf("    tipo %d · industria %d · país %d · precio %d\n", plan.TypeID, plan.IndustryID, plan.CountryID, plan.Price)
	if t != "local" {
		fmt.Printf("    ⚠ escribe en la base COMPARTIDA y sube una imagen al bucket del admin; y se crean su sucursal, su asesor de prueba y su cuenta de Cognito\n")
	}
	if !*apply {
		return dryRun()
	}
	got, err := c.CreateAllied(ctx, plan)
	if err != nil {
		return fail(1, "no se pudo crear el comercio: %v", err)
	}
	if *asJSON {
		return printJSON(got)
	}
	fmt.Printf("\n  comercio %d · %s   (alta en %.1f s)\n", got.ID, got.Name, got.Elapsed.Seconds())
	if got.Flash == nil {
		fmt.Println("  el admin no mostró nada del asesor de prueba (¿versión sin la función?)")
		return 0
	}
	fmt.Printf("  asesor     %s · sucursal %s\n  cognito    %s\n", got.Flash.Email, got.Flash.BranchName, got.Flash.Cognito)
	for _, n := range got.Flash.Notes {
		fmt.Printf("  · %s\n", n)
	}
	return 0
}

var _ = os.Stdout
