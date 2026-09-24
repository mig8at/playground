package main

// command es un verbo de pg. La lista es la ÚNICA fuente de la ayuda (`pg help`), del catálogo que el
// hook de inicio le muestra al agente y de las herramientas del servidor MCP (`pg mcp`): un comando que
// no está acá no existe, y uno que está existe igual en los tres lados.
type command struct {
	Name    string  `json:"name"`
	Summary string  `json:"summary"`
	Usage   string  `json:"usage"`
	Params  []param `json:"params,omitempty"`
	// Write: escribe HACIA AFUERA (Jira, Slack). Sin `--apply` sólo muestra lo que haría, y el texto que
	// sale pasa por el guard. En el MCP, la herramienta suma el parámetro `apply`.
	Write bool `json:"write,omitempty"`
	// NoTool: no se ofrece como herramienta MCP (plomería para otra herramienta, o un modelo detrás).
	NoTool bool `json:"no_tool,omitempty"`
	run    func(args []string) int
}

// param es un parámetro de un comando: una bandera (`--name valor`) o un posicional.
type param struct {
	Name       string `json:"name"`
	Type       string `json:"type"` // string · integer · boolean
	Desc       string `json:"description"`
	Required   bool   `json:"required,omitempty"`
	Positional bool   `json:"positional,omitempty"`
	// Enum restringe los valores (el ambiente, por ejemplo).
	Enum []string `json:"enum,omitempty"`
}

var targets = []string{"local", "dev", "qa", "staging", "prod"}

func target() param {
	return param{Name: "target", Type: "string", Desc: "el ambiente, siempre explícito", Required: true, Enum: targets}
}

func str(name, desc string) param { return param{Name: name, Type: "string", Desc: desc} }
func req(name, desc string) param {
	return param{Name: name, Type: "string", Desc: desc, Required: true}
}
func num(name, desc string) param     { return param{Name: name, Type: "integer", Desc: desc} }
func boolean(name, desc string) param { return param{Name: name, Type: "boolean", Desc: desc} }
func pos(name, desc string) param {
	return param{Name: name, Type: "string", Desc: desc, Required: true, Positional: true}
}

var windowParams = []param{
	str("since", "ventana hacia atrás desde el fin (ej. 30m, 6h, 3d); default 1h"),
	str("start", "inicio: RFC3339 o ms desde epoch (pisa since)"),
	str("end", "fin: RFC3339 o ms desde epoch (default: ahora)"),
}

var commands []command

func init() {
	commands = []command{
		{Name: "sql", Summary: "SQL de sólo lectura contra la base del ambiente (MySQL directo; Redash en prod)",
			Usage: "pg sql --target T --query 'SELECT …' [--json | --csv]", run: runSQL,
			Params: []param{target(), req("query", "SELECT o WITH, una sola sentencia"), boolean("json", "filas en JSON, con el ambiente y la fuente")}},
		{Name: "logs", Summary: "líneas de Loki del ambiente, legibles o en JSON",
			Usage: "pg logs --target T --query '{…}' [--since 1h | --start … --end …] [--limit N] [--direction forward|backward] [--json]", run: runLogs,
			Params: append(append([]param{target(), req("query", "LogQL de líneas, ej. {service_name=\"legacy-backend\"} |= \"466897\"")}, windowParams...),
				num("limit", "tope de líneas (default 500)"), str("direction", "forward o backward"), boolean("json", "los streams en JSON"))},
		{Name: "logs labels", Summary: "los valores de una etiqueta de Loki en la ventana",
			Usage: "pg logs labels --target T --label L [--since 1h | --start … --end …]", run: runLabels,
			Params: append([]param{target(), req("label", "la etiqueta, ej. environment o service_name")}, windowParams...)},
		{Name: "logs config", Summary: "qué Loki atiende el ambiente y si se puede leer, sin secretos",
			Usage: "pg logs config --target T", run: runLogsConfig, Params: []param{target()}},
		{Name: "logs raw", Summary: "el cuerpo de Loki tal cual, para quien ya lo parsea (el harness)",
			Usage: "pg logs raw --target T --path query_range|query|labels|label/<x>/values --param k=v …", run: runLogsRaw, NoTool: true},
		{Name: "events config", Summary: "qué PostHog atiende el ambiente y si se puede consultar, sin secretos",
			Usage: "pg events config --target T", run: runEventsConfig, Params: []param{target()}},
		{Name: "events hogql", Summary: "una consulta HogQL de sólo lectura: columnas y filas en JSON",
			Usage: "pg events hogql --target T --query 'SELECT … FROM events …'", run: runHogQL,
			Params: []param{target(), req("query", "HogQL: SELECT … FROM events …")}},
		{Name: "gemini models", Summary: "los modelos de Gemini que la llave puede usar hoy (el configurado, marcado)",
			Usage: "pg gemini models", run: runGeminiModels, NoTool: true},
		{Name: "gemini ask", Summary: "una pregunta a Gemini, sin herramientas: la respuesta en texto",
			Usage: "pg gemini ask --prompt '…' [--system '…']", run: runGeminiAsk, NoTool: true},
		{Name: "confluence spaces", Summary: "los espacios de Confluence (sin los personales)",
			Usage: "pg confluence spaces", run: runConfluenceSpaces},
		{Name: "confluence pages", Summary: "las páginas de un espacio: id y título",
			Usage: "pg confluence pages <clave>", run: runConfluencePages, Params: []param{pos("space", "la clave del espacio, ej. Creditop")}},
		{Name: "confluence read", Summary: "una página, como texto: encabezados, listas y tablas legibles",
			Usage: "pg confluence read <id>", run: runConfluenceRead, Params: []param{pos("id", "el id de la página")}},
		{Name: "confluence search", Summary: "busca páginas por texto (CQL), hasta 40",
			Usage: "pg confluence search <texto …>", run: runConfluenceSearch, Params: []param{pos("text", "palabras del negocio, ej. cupo rotativo")}},
		{Name: "jira myself", Summary: "quién es la cuenta de Jira configurada (valida las credenciales)",
			Usage: "pg jira myself", run: runJiraMyself},
		{Name: "jira search", Summary: "issues de Jira por JQL: clave, estado y título",
			Usage: "pg jira search --jql '…' [--max N]", run: runJiraSearch,
			Params: []param{req("jql", "JQL con al menos una restricción, ej. project = CORE AND created >= -30d"), num("max", "máximo de resultados, 1-100 (default 25)")}},
		{Name: "jira create", Summary: "crea un issue en Jira y, con board, lo mete al sprint activo", Write: true,
			Usage: "pg jira create --summary '…' [--description '…'] [--project CORE] [--type Task | --type-id 10005] [--assignee ID] [--board 384] [--apply]", run: runJiraCreate,
			Params: []param{req("summary", "el título"), str("description", "la descripción, en Markdown (se manda como ADF)"),
				str("project", "la clave del proyecto (default CORE)"), str("type", "el nombre del tipo de issue (default Task)"),
				str("type-id", "el id del tipo, ej. 10005; gana sobre type"), str("assignee", "accountId del asignado"),
				num("board", "si se da, lo agrega al sprint ACTIVO de ese board, ej. 384")}},
		{Name: "jira delete", Summary: "borra un issue de Jira — IRREVERSIBLE", Write: true,
			Usage: "pg jira delete --key CORE-123 [--apply]", run: runJiraDelete, Params: []param{req("key", "la clave del issue, ej. CORE-210")}},
		{Name: "slack post", Summary: "manda un mensaje a un canal de Slack como el bot", Write: true,
			Usage: "pg slack post --channel C0123ABCD --text '…' [--apply]", run: runSlackPost,
			Params: []param{req("channel", "el id del canal (el bot tiene que ser miembro)"), req("text", "el mensaje")}},
		{Name: "slack channel-create", Summary: "crea un canal de Slack", Write: true,
			Usage: "pg slack channel-create --name nombre [--private] [--apply]", run: runSlackChannelCreate,
			Params: []param{req("name", "el nombre, en minúsculas y sin espacios"), boolean("private", "canal privado (default público)")}},
		{Name: "slack channel-archive", Summary: "archiva un canal de Slack (lo reversible: por API no se borra)", Write: true,
			Usage: "pg slack channel-archive --channel C0123ABCD [--apply]", run: runSlackChannelArchive,
			Params: []param{req("channel", "el id del canal, no el nombre")}},
		{Name: "twilio templates", Summary: "los templates de WhatsApp de la cuenta de Twilio y su aprobación de Meta",
			Usage: "pg twilio templates [--auth account|key]", run: runTwilioTemplates,
			Params: []param{str("auth", "account (default) o key")}},
		{Name: "twilio inventory", Summary: "la cuenta de Twilio y qué alcanza la credencial en cada producto (el 401 nombra el permiso que falta)",
			Usage: "pg twilio inventory [--auth account|key]", run: runTwilioInventory,
			Params: []param{str("auth", "account (default) o key")}},
		{Name: "twilio oauth", Summary: "la app OAuth de Twilio: su identidad y qué permiso pediría cada producto",
			Usage: "pg twilio oauth", run: runTwilioOAuth},
		{Name: "twilio get", Summary: "un GET puntual a Twilio con la credencial elegida, resumido",
			Usage: "pg twilio get --url https://….twilio.com/… [--auth account|key|oauth]", run: runTwilioGet, NoTool: true},
		{Name: "mcp", Summary: "sirve estos mismos comandos como herramientas MCP, por stdio", NoTool: true,
			Usage: "pg mcp", run: runMCP},
	}
}
