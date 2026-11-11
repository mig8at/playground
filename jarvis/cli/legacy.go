package main

/*
LOS NOMBRES DE ANTES, EN CASTELLANO: los comandos, opciones y recetas de antes del 2026-11-07 siguen andando, porque las

	tareas y los flujos guardan el comando EXACTO con que se hizo algo. Se traducen al entrar y todo lo demás habla en
	inglés. Son el único español a propósito del código de Jarvis, y por eso viven solos en este archivo: el chequeo de
	nombres (`make tablero-naming`) los acepta sólo acá (tablero/tools/naming-allow.txt).
*/

var legacyCommands = map[string]string{
	"empezar": "start", "pienso": "think", "terminar": "finish", "pestanas": "tabs", "pestañas": "tabs",
	"proyecto": "project", "cambios": "changes",
}
var legacyFlags = map[string]string{
	"--sesion": "--session", "--pestana": "--session", "--todo": "--all", "--buscar": "--search", "--desde": "--from",
	"--pasos": "--steps", "-pasos": "--steps", "--modelo": "--model", "-modelo": "--model", "--respuesta": "--answer",
	"-respuesta": "--answer", "--guia": "--guide", "-guia": "--guide", "--sin-flujo": "--no-flow", "-sin-flujo": "--no-flow",
	"--dispositivo": "--device", "-dispositivo": "--device",
}
var legacySubcommands = map[string]string{"nueva": "new", "cerrar": "close"}

func translateLegacy(argv []string) []string {
	out := make([]string, len(argv))
	for i, a := range argv {
		out[i] = a
		if i == 1 {
			if n, ok := legacyCommands[a]; ok {
				out[i] = n
			}
		} else if i == 2 && out[1] == "tabs" {
			if n, ok := legacySubcommands[a]; ok {
				out[i] = n
			}
		}
		if n, ok := legacyFlags[a]; ok {
			out[i] = n
		}
	}
	return out
}

// legacyRecipes: los nombres de las recetas de antes del 2026-11-07 (los mismos que JARVIS_OLD_RECIPES del Makefile).
var legacyRecipes = map[string]string{
	"crear-producto": "create-product", "crear-producto-pantalla": "create-product-screen", "coleccion": "collection",
	"coleccion-pantalla": "collection-screen", "sinonimo": "synonym", "sinonimo-pantalla": "synonym-screen",
	"cupon": "coupon", "cupon-pantalla": "coupon-screen", "pedido": "order", "pago-creditop": "creditop-payment",
	"compra-con-descuento": "discount-purchase",
}
