package cliflags

// Legacy: las opciones de antes de todos los CLI de my-tools en Go → las de ahora. Una sola tabla, porque cada nombre
// viejo tenía un solo sentido en todos los programas que lo usaban. Un programa traduce con
// `Translate(args, Legacy)` justo antes de `Parse`.
var Legacy = map[string]string{
	"tarea": "task", "titulo": "title", "cuerpo": "body", "seco": "dry", "nota": "note", "nota-archivo": "note-file",
	"lapso": "span", "pulso": "pulse", "fuente": "source", "dia": "day", "desde": "since", "bloque": "block",
	"todas": "all", "bitacora": "worklog", "contenido": "content", "anatomia": "anatomy", "sugerir": "suggest",
	"sin-prs": "no-prs", "sin-jira": "no-jira", "ver": "show", "dias": "days", "limite": "limit", "fallas": "failures",
	"en": "epic", "aplicar": "apply", "tanda": "batch", "solo": "only", "comparar": "compare", "barrido": "sweep",
	"tope": "cap", "tope-verificador": "verifier-cap", "capa": "layer", "modo": "mode",
}
