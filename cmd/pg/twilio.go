package main

import (
	"context"
	"flag"
	"fmt"
	"strings"
	"time"

	"creditop/playground/connectors/twilio"
)

// Twilio por su conector, y sólo lectura: lo que hacía `twilio/probe.py`. Crear un template o mandar un
// mensaje no está acá a propósito (cuesta plata y le llega a una persona); la receta a mano vive en
// connectors/twilio/README.md.

func twilioClient(auth string) (*twilio.Client, int) {
	cfg, err := twilio.LoadConfig()
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	var cl *twilio.Client
	switch auth {
	case "", "account":
		cl, err = cfg.Account()
	case "key":
		cl, err = cfg.Key()
	case "oauth":
		cl, _, err = cfg.OAuth(context.Background())
	default:
		return nil, fail(2, "--auth es account, key u oauth (no %q)", auth)
	}
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	return cl, 0
}

func probeRows(rows []twilio.Probe) {
	for _, r := range rows {
		fmt.Printf("  %-4d %-40s %s\n", r.Status, r.Label, r.Result)
	}
}

func runTwilioTemplates(args []string) int {
	fs := flag.NewFlagSet("twilio templates", flag.ContinueOnError)
	auth := fs.String("auth", "account", "account o key")
	if fs.Parse(args) != nil {
		return 2
	}
	cl, code := twilioClient(*auth)
	if cl == nil {
		return code
	}
	items, err := cl.Templates(context.Background())
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%d templates en la cuenta (⚠ son POR CUENTA: los de otra no se ven)\n", len(items))
	fmt.Println("  unsubmitted = creado, sin mandar a Meta · received/pending = en revisión")
	fmt.Println("  approved = sirve para INICIAR una conversación · rejected = mirar el motivo")
	fmt.Println()
	for _, t := range items {
		mark := map[string]string{"approved": "✅", "rejected": "❌", "unsubmitted": "·"}[t.Status]
		if mark == "" {
			mark = "⏳"
		}
		cat := t.Category
		if cat == "" {
			cat = "-"
		}
		fmt.Printf("%s %s  %-12s %-14s %s\n    types: %s\n", mark, t.SID, t.Status, cat, t.Name, strings.Join(t.Types, ", "))
		if t.RejectionReason != "" {
			fmt.Printf("    RECHAZO: %s\n", t.RejectionReason)
		}
	}
	return 0
}

func runTwilioInventory(args []string) int {
	fs := flag.NewFlagSet("twilio inventory", flag.ContinueOnError)
	auth := fs.String("auth", "account", "account o key")
	if fs.Parse(args) != nil {
		return 2
	}
	cl, code := twilioClient(*auth)
	if cl == nil {
		return code
	}
	ctx := context.Background()
	accts, err := cl.Accounts(ctx)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Println("la cuenta de la credencial")
	for _, a := range accts {
		owner := ""
		if a.Owner != "" && a.Owner != a.SID {
			owner = "  ⚠ subcuenta de " + a.Owner
		}
		fmt.Printf("  %s  %-9s %-8s %s%s\n", a.SID, a.Status, a.Type, a.FriendlyName, owner)
	}
	if len(accts) == 0 {
		return fail(1, "la credencial no ve ninguna cuenta")
	}
	fmt.Println("\nqué alcanza (⚠ de los mensajes sólo el conteo: sus cuerpos traen OTPs y teléfonos)")
	probeRows(cl.Inventory(ctx, accts[0].SID))
	return 0
}

func runTwilioOAuth(args []string) int {
	cfg, err := twilio.LoadConfig()
	if err != nil {
		return fail(2, "%v", err)
	}
	ctx := context.Background()
	cl, tok, err := cfg.OAuth(ctx)
	if err != nil {
		return fail(1, "%v", err)
	}
	id, err := twilio.IdentityOf(tok)
	if err != nil {
		return fail(1, "%v", err)
	}
	scope := id.Scope
	if scope == "" {
		scope = "(ninguno en el JWT: los resuelve el server)"
	}
	fmt.Println("identidad del token (el payload del JWT, sin el token)")
	fmt.Printf("  app OAuth    %s\n  organización %s\n  audiencia    %s · región %s\n  vence        %s (%ds de vida, sin refresh token)\n  scopes       %s\n",
		id.App, id.Organization, id.Audience, id.Region, id.Expires.Format(time.RFC3339), id.LifetimeSeconds, scope)
	fmt.Println("\nIAM de la organización")
	probeRows(cl.IAMChecks(ctx, id.Organization))
	fmt.Println("\nproductos — el 401 dice el nombre del permiso que pediría cada uno")
	probeRows(cl.Products(ctx))
	return 0
}

func runTwilioGet(args []string) int {
	fs := flag.NewFlagSet("twilio get", flag.ContinueOnError)
	u := fs.String("url", "", "la URL de Twilio")
	auth := fs.String("auth", "account", "account, key u oauth")
	if fs.Parse(args) != nil {
		return 2
	}
	if *u == "" {
		return fail(2, "falta --url")
	}
	cl, code := twilioClient(*auth)
	if cl == nil {
		return code
	}
	status, body, err := cl.Get(context.Background(), *u)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%d  %s\n", status, twilio.Why(status, body))
	if status != 200 {
		return 1
	}
	return 0
}
