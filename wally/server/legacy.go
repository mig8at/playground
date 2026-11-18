package main

// LOS NOMBRES DE ANTES (2026-11-18). El protocolo de Wally —los comandos que pide un agente, los bloques, los estados,
// la carpeta y las habilidades— nació en español y pasó a inglés (regla de my-tools: el código en inglés, lo que se ve
// en español). Las conversaciones guardadas tienen los nombres viejos, y un modelo que lee su historia puede volver a
// escribirlos: acá se traducen. Lo guardado se migra una vez al cargar (migrateConversation); lo que pide el modelo,
// cada vez (normalizeCommand).

import "strings"

// legacyVerbs: la primera palabra de un comando de antes → la de ahora.
var legacyVerbs = map[string]string{
	"ayuda": "help", "comandos": "commands", "trampas": "traps", "trampa": "trap", "tarea": "task",
	"escribir": "write", "parchar": "patch", "compilar": "build", "testear": "test", "probar-api": "check-api",
	"consola": "console", "listar": "list", "leer": "read", "probar": "check", "cambios": "changes",
	"fuentes": "sources", "buscar": "grep", "codigo": "code", "guia": "guide",
}

var legacyStatuses = map[string]string{
	"propuesto": "proposed", "corriendo": "running", "corrido": "ran", "descartado": "dismissed", "no-permitido": "not-allowed",
}

var legacySkills = map[string]string{
	"codigo": "code", "herramientas": "tools", "knowledge-al-dia": "knowledge-sync", "pruebas": "sandbox",
	"tareas": "tasks", "trampas": "traps",
}

var legacyGuides = map[string]string{"conectores": "connectors", "estilo": "style", "herramientas": "tools"}

var legacyModes = map[string]string{"asistente": "assistant"}

// normalizeCommand traduce un comando escrito con los nombres de antes. Lo que ya está en inglés pasa igual.
func normalizeCommand(cmd string) string {
	f := strings.Fields(cmd)
	if len(f) == 0 {
		return cmd
	}
	if v, ok := legacyVerbs[f[0]]; ok {
		f[0] = v
	}
	for i := 1; i < len(f); i++ {
		if f[i] == "pruebas" || strings.HasPrefix(f[i], "pruebas/") {
			f[i] = "sandbox" + strings.TrimPrefix(f[i], "pruebas")
		}
		if strings.HasPrefix(f[i], "sandbox/") && strings.HasSuffix(f[i], "/criterios.json") {
			f[i] = strings.TrimSuffix(f[i], "criterios.json") + "criteria.json"
		}
	}
	switch {
	case f[0] == "help" && len(f) == 2:
		if s, ok := legacySkills[f[1]]; ok {
			f[1] = s
		}
	case f[0] == "guide" && len(f) == 2:
		if g, ok := legacyGuides[f[1]]; ok {
			f[1] = g
		}
	case f[0] == "console" && len(f) > 2 && f[2] == "con-api":
		f[2] = "with-api"
	}
	return strings.Join(f, " ")
}

// migrateConversation pasa una conversación guardada a los nombres de ahora; dice si cambió algo.
func migrateConversation(c *Conversation) bool {
	changed := false
	if m, ok := legacyModes[c.Mode]; ok {
		c.Mode, changed = m, true
	}
	if c.Agent != nil {
		for i, s := range c.Agent.Skills {
			if n, ok := legacySkills[s]; ok {
				c.Agent.Skills[i], changed = n, true
			}
		}
	}
	for i := range c.Messages {
		for j := range c.Messages[i].Commands {
			k := &c.Messages[i].Commands[j]
			if s, ok := legacyStatuses[k.Status]; ok {
				k.Status, changed = s, true
			}
			if n := normalizeCommand(k.Cmd); n != k.Cmd {
				k.Cmd, changed = n, true
			}
		}
	}
	return changed
}
