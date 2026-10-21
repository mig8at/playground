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
		{Name: "tareas", Summary: "las tareas del tablero: las abiertas con su etapa, Jira y ramas; o UNA, por id o slug. Sólo lectura",
			Usage: "pg tareas [--n <id|slug>] [--todas] [--json]", run: runTasks,
			Params: []param{str("n", "una tarea, por id o slug"), boolean("todas", "también las archivadas"), boolean("json", "en JSON")}},
		{Name: "tarea pila", Summary: "la pila de una tarea: sus últimos bloques (qué se hizo y con qué se sostiene). Sólo lectura",
			Usage: "pg tarea pila --tarea <id|slug>", run: runTaskStack,
			Params: []param{req("tarea", "id o slug de la tarea")}},
		{Name: "tarea ramas", Summary: "en qué ramas vive UNA tarea (los patrones de su `ramas:`) y hasta dónde llegó cada una: en qué ambientes ya está y su PR. Mide git en el momento, en segundos. Sólo lectura de los repos",
			Usage: "pg tarea ramas --tarea <id|slug> [--json]", run: runTaskBranches,
			Params: []param{req("tarea", "id o slug de la tarea"), boolean("json", "en JSON")}},
		{Name: "tarea bloque", Summary: "agrega un bloque a la pila de una tarea: el título es la conclusión y el cuerpo lo que la sostiene (cada comando, en su caja, seguido de «Resultado: …»; los archivos como [nombre](repo:<repo>/<ruta>); un tema local como [nombre](knowledge:<tema>#<ancla>)). Con seco=true valida y muestra sin escribir. Escribe en el tablero local",
			Usage: "pg tarea bloque --tarea <id|slug> --titulo '…' --cuerpo '…' [--seco]", run: runTaskBlock,
			Params: []param{req("tarea", "id o slug de la tarea"), req("titulo", "la conclusión, en una línea"),
				req("cuerpo", "lo que la sostiene, en Markdown"), boolean("seco", "valida y muestra el bloque sin escribirlo")}},
		{Name: "cierre", Summary: "propone el cierre de UNA tarea hoy: el lapso desde donde terminó la última bitácora del día, los commits de la tarea en ese lapso y los dos comandos listos (tarea bloque y bitacora add) para completar y correr. Sólo lectura: no escribe nada",
			Usage: "pg cierre --tarea <id|slug> [--json]", run: runCloseout,
			Params: []param{req("tarea", "id o slug de la tarea"), boolean("json", "en JSON")}},
		{Name: "bitacora add", Summary: "registra tiempo en la bitácora de una tarea, con los minutos MEDIDOS: --lapso HH:MM-HH:MM, --pulso HH:MM o --min N con --fuente. La nota sube a Jira como worklog: sin repos, rutas ni herramientas internas. Con seco=true valida sin escribir. Escribe en el tablero local",
			Usage: "pg bitacora add --tarea <id|slug> --titulo '…' [--nota '…'] (--lapso HH:MM-HH:MM | --pulso HH:MM | --min N --fuente '…') [--dia AAAA-MM-DD] [--desde HH:MM] [--seco]", run: runWorklogAdd,
			Params: []param{req("tarea", "id o slug de la tarea"), req("titulo", "qué se hizo, corto"), str("nota", "realizada → resultado → validación"),
				str("lapso", "HH:MM-HH:MM"), str("pulso", "HH:MM: desde esa hora, medido por el pulso"), str("min", "minutos, con fuente"),
				str("fuente", "de dónde salen los minutos de min"), str("dia", "AAAA-MM-DD, para un día anterior"),
				str("desde", "HH:MM, con min en un día anterior"), boolean("seco", "valida y muestra sin escribir")}},
		{Name: "client state", Summary: "qué hay de una CÉDULA en la base del ambiente: el cliente activo y sus bajas (-t<n>), sus últimas solicitudes, qué centrales se le consultaron y cuándo, y qué central decidió su nombre. Sólo lectura (también prod)",
			Usage: "pg client state --target T --document 1031138508 [--json]", run: runClientState,
			Params: []param{target(), req("document", "la cédula, sólo dígitos"), boolean("json", "el resultado en JSON")}},
		{Name: "experian check", Summary: "si una SUCURSAL va a consultar Experian y por qué: los atajos que obligan (comercio o entidad en experian_trigger_bypass_rules, entidad CreditopX) y, si ninguno aplica, la periodicidad del comercio con su contador. Sólo lectura (también prod)",
			Usage: "pg experian check --target T (--hash <sucursal> | --branch <id>) [--json]", run: runExperianCheck,
			Params: []param{target(), str("hash", "el hash de la sucursal (hexadecimal)"), num("branch", "o el id de la sucursal (allied_branches.id)"), boolean("json", "el resultado en JSON")}},
		{Name: "jev ask", Summary: "manda un pedido a Jev (TypeSafe) por el cliente único y devuelve la respuesta: el pedido va en JSON por la entrada estándar. Para herramientas que lo usan como servicio (p. ej. el juego)",
			Usage: "echo '{\"model\":\"jev-latest\",…}' | pg jev ask", run: runJevAsk, NoTool: true},
		{Name: "settings diff", Summary: "en qué difieren las settings de legacy-backend entre ambientes (por defecto local, dev y prod). Las credenciales se comparan por huella y nunca se muestran. Sólo lectura",
			Usage: "pg settings diff [--targets local,dev,prod] [--key texto] [--all] [--json]", run: runSettingsDiff,
			Params: []param{str("targets", "ambientes separados por coma (default local,dev,prod)"), str("key", "sólo claves que contienen este texto"), boolean("all", "también las iguales"), boolean("json", "el resultado en JSON")}},
		{Name: "request timeline", Summary: "los estados por los que pasó una solicitud, cuándo y quién la movió (user_request_records), con su comercio, entidad y flujo. Sólo lectura (también prod)",
			Usage: "pg request timeline --target T --ureq N [--json]", run: runRequestTimeline,
			Params: []param{target(), num("ureq", "el id de la solicitud"), boolean("json", "el resultado en JSON")}},
		{Name: "client fields", Summary: "los campos guardados de un cliente con su nombre (user_field_values + fields): situación laboral, ingreso, central que los dio. Sólo lectura (también prod)",
			Usage: "pg client fields --target T (--document N | --ureq N) [--fields 29,87,160] [--json]", run: runClientFields,
			Params: []param{target(), str("document", "la cédula del cliente activo"), num("ureq", "o el id de una solicitud"), str("fields", "ids de campo separados por coma"), boolean("json", "el resultado en JSON")}},
		{Name: "jobs failed", Summary: "los trabajos en cola de legacy-backend que fallaron en una ventana, agrupados por clase y primera línea del error (sin el contenido del trabajo). Sólo lectura (también prod)",
			Usage: "pg jobs failed --target T [--hours 24] [--limit 20] [--json]", run: runJobsFailed,
			Params: []param{target(), num("hours", "la ventana en horas (default 24)"), num("limit", "cuántos grupos (default 20)"), boolean("json", "el resultado en JSON")}},
		{Name: "otp last", Summary: "los últimos OTP de un celular: cuándo se mandaron, si se validaron y si entraron por el bypass de QA (el código va cifrado y no se muestra). Nunca en producción. Sólo lectura",
			Usage: "pg otp last --target local|dev|qa|staging --phone 3001234567 [--limit 3] [--json]", run: runOtpLast,
			Params: []param{{Name: "target", Type: "string", Desc: "el ambiente (nunca prod)", Required: true, Enum: []string{"local", "dev", "qa", "staging"}}, req("phone", "el celular, sólo dígitos"), num("limit", "cuántos códigos (default 3)"), boolean("json", "el resultado en JSON")}},
		{Name: "sql", Summary: "SQL de sólo lectura contra la base del ambiente (MySQL directo; Redash en prod)",
			Usage: "pg sql --target T --query 'SELECT …' [--json | --csv | --md] [--bloque TAREA [--titulo '…']]", run: runSQL,
			Params: []param{target(), req("query", "SELECT o WITH, una sola sentencia"), boolean("json", "filas en JSON, con el ambiente y la fuente"),
				boolean("md", "la consulta como evidencia (sql + resultado) y la tabla en markdown"),
				str("bloque", "agrega la consulta y su resultado como bloque a la pila de esa tarea (slug o id)"),
				str("titulo", "título del bloque (por defecto, el ambiente y el resultado)")}},
		{Name: "canon sql", Summary: "SQL de sólo lectura contra la base de Postgres de canon (local = el laboratorio; prod): corpus, galaxias, mantenedores, revisiones",
			Usage: "pg canon sql --target local|prod --query 'SELECT …' [--json]", run: runCanonSQL,
			Params: []param{canonTarget(), req("query", "SELECT o WITH, una sola sentencia, ej. SELECT id, author, reason FROM canon_revision ORDER BY id DESC LIMIT 5"),
				boolean("json", "filas completas en JSON, con el ambiente y la fuente")}},
		{Name: "canon tables", Summary: "las tablas de la base de canon: esquema, nombre y filas estimadas (incluye los esquemas de las galaxias)",
			Usage: "pg canon tables --target local|prod [--json]", run: runCanonTables,
			Params: []param{canonTarget(), boolean("json", "las tablas en JSON")}},
		{Name: "canon yo", Summary: "con qué identidad te ve canon de prod: la sesión del CLI del playground (`playground login`); sin ella no abren las rutas de dueño",
			Usage: "pg canon yo [--json]", run: runCanonWhoami, Params: []param{boolean("json", "la identidad en JSON")}},
		{Name: "canon config", Summary: "qué base de canon atiende el ambiente y qué credenciales faltan, sin la contraseña ni abrir conexión",
			Usage: "pg canon config --target local|prod", run: runCanonConfig, Params: []param{canonTarget()}},
		{Name: "logs", Summary: "líneas de Loki del ambiente, legibles o en JSON",
			Usage: "pg logs --target T --query '{…}' [--since 1h|16d|2w | --start … --end …] [--limit N] [--direction forward|backward] [--json]", run: runLogs,
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
		{Name: "events request", Summary: "qué vio el cliente de UNA solicitud: eventos, bitácora del front y replay",
			Usage: "pg events request --target T --ureq N [--tel CEL] [--since 1d] [--limit 200]", run: runEventsRequest,
			Params: []param{target(), req("ureq", "la solicitud (user_request_id)"), str("tel", "el celular: sin él no se ve la fase de AUTH"),
				str("since", "ventana: 6h, 1d, 7d (por defecto 1d)"), num("limit", "tope de eventos (por defecto 200)")}},
		{Name: "events errors", Summary: "ranking de errores del front en el ambiente: dónde (pantalla) y qué (patrón)",
			Usage: "pg events errors --target T [--days 7]", run: runEventsErrors,
			Params: []param{target(), num("days", "días hacia atrás (por defecto 7)")}},
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
		{Name: "advisor status", Summary: "las sesiones guardadas del asesor: cuenta, origen y validez; no imprime secretos",
			Usage: "pg advisor status [--target local|dev|qa|staging] [--origin URL] [--account c<hash>-fake@creditop.com] [--json]", run: runAdvisorStatus,
			Params: []param{param{Name: "target", Type: "string", Desc: "ambiente de autenticación", Enum: []string{"local", "dev", "qa", "staging"}}, str("origin", "origen del wizard"), str("account", "el asesor de prueba de un comercio, ej. c036610aa-fake@creditop.com"), boolean("json", "estado en JSON")}},
		{Name: "advisor login", Summary: "entra como el asesor de prueba de un comercio (--account, obligatorio) con ALLIED_TEST_ADVISOR_PASSWORD; abre una ventana y guarda una sesión reutilizable de esa cuenta",
			Usage: "pg advisor login --target local|dev|qa|staging --account c<hash>-fake@creditop.com [--origin URL] [--headless]", run: runAdvisorLogin, NoTool: true},
		{Name: "advisor logout", Summary: "borra la sesión del asesor de prueba para ese ambiente, origen y cuenta",
			Usage: "pg advisor logout --target local|dev|qa|staging --account c<hash>-fake@creditop.com [--origin URL]", run: runAdvisorLogout, NoTool: true},
		{Name: "admin status", Summary: "las sesiones guardadas del admin de legacy-application (local, dev, staging): de quién son y si siguen sirviendo. No imprime la sesión",
			Usage: "pg admin status [--target dev|staging|local] [--json]", run: runAdminStatus,
			Params: []param{adminTargetParam(false), boolean("json", "el estado en JSON")}},
		{Name: "admin login", Summary: "ENTRA al admin con ADMIN_USER y ADMIN_PASS de connectors/.env.<ambiente> y guarda la sesión. Teclea una contraseña: lo corre una persona",
			Usage: "pg admin login --target dev|staging|local", run: runAdminLogin, NoTool: true},
		{Name: "admin logout", Summary: "borra la sesión guardada del admin de un ambiente",
			Usage: "pg admin logout --target dev|staging|local", run: runAdminLogout, NoTool: true},
		{Name: "admin get", Summary: "una página del admin con la sesión guardada: su componente y sus props (leer páginas del admin puede traer datos de personas, así que va sólo por consola)",
			Usage: "pg admin get --target dev|staging|local [--path /aliados] [--json]", run: runAdminGet, NoTool: true},
		{Name: "admin allied-create", Summary: "crea un COMERCIO de prueba por el formulario real del admin (el alta crea sola su sucursal, su asesor de prueba y su cuenta de Cognito). Dice con quién actúa. Sin --apply sólo muestra lo que mandaría",
			Usage: "pg admin allied-create --target dev|staging|local [--name 'PRUEBA AUTO x'] [--type N] [--industry N] [--country N] [--price N] [--json] [--apply]", Write: true, run: runAdminAlliedCreate,
			Params: []param{adminTargetParam(true), str("name", "el nombre; tiene que empezar por PRUEBA AUTO (lo único que el borrado reconoce)"),
				num("type", "allied_type_id (default: el primero del formulario)"), num("industry", "allied_industry_id (default: el primero)"),
				num("country", "country_id (default: Colombia, 47)"), num("price", "precio (default 1000000)"), boolean("json", "el resultado en JSON")}},
		{Name: "admin test-advisor", Summary: "crea el ASESOR DE PRUEBA (c<hash>-fake@, su sucursal y su cuenta de Cognito) de un comercio que ya existe, con el botón de la ficha del comercio en el admin. Idempotente. Para qa se corre contra dev: comparten base y pool. Sin --apply sólo muestra",
			Usage: "pg admin test-advisor --target dev|staging|local --allied N [--json] [--apply]", Write: true, run: runAdminTestAdvisor,
			Params: []param{adminTargetParam(true), num("allied", "el id del comercio (allieds.id)"), boolean("json", "el resultado en JSON")}},
		{Name: "admin client-disable", Summary: "da de BAJA a un CLIENTE de prueba por su cédula, como la papelera de Usuarios del admin: status 0, la cédula con -t<n> y sin correo ni celular, así el próximo registro con esa cédula crea un cliente nuevo y vuelve a consultar las centrales. Sólo la cuenta activa con la cédula EXACTA y perfil de cliente. Para qa se corre contra dev. Sin --apply sólo muestra",
			Usage: "pg admin client-disable --target dev|staging|local --document 1031138508 [--json] [--apply]", Write: true, run: runAdminClientDisable,
			Params: []param{adminTargetParam(true), str("document", "la cédula del cliente, sólo dígitos"), boolean("json", "el resultado en JSON")}},
		{Name: "admin branch-lenders", Summary: "asigna entidades a una SUCURSAL por el formulario del admin: copia las de otra sucursal o las que se pidan. El admin reescribe la sucursal entera y le copia las reglas de cada entidad, así que se leen sus datos y se reenvían igual. Para qa se corre contra dev. Sin --apply sólo muestra qué cambia",
			Usage: "pg admin branch-lenders --target dev|staging|local --allied N --branch <hash> (--copy-from <hash> | --lenders 1,2) [--json] [--apply]", Write: true, run: runAdminBranchLenders,
			Params: []param{adminTargetParam(true), num("allied", "el id del comercio (allieds.id)"), str("branch", "el hash de la sucursal a la que se le asignan"),
				str("copy-from", "el hash de otra sucursal: se le copian sus entidades"), str("lenders", "o los ids de las entidades, separados por coma"), boolean("json", "el resultado en JSON")}},
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
		{Name: "figma me", Summary: "de quién es el token de Figma (valida la credencial)",
			Usage: "pg figma me", run: runFigmaMe},
		{Name: "figma projects", Summary: "los proyectos de un equipo de Figma y los archivos de cada uno",
			Usage: "pg figma projects --team <id o URL de figma.com/files/team/<id>/…>", run: runFigmaProjects,
			Params: []param{req("team", "el id del equipo, o la URL de su página en Figma")}},
		{Name: "figma file", Summary: "un archivo de Figma: sus páginas y los frames de primer nivel, con id y tamaño",
			Usage: "pg figma file <URL|clave> [--json]", run: runFigmaFile,
			Params: []param{pos("ref", "la URL de Figma o la clave del archivo"), boolean("json", "la estructura en JSON")}},
		{Name: "figma node", Summary: "el árbol de un nodo de Figma con sus textos: para LEER una pantalla",
			Usage: "pg figma node <URL con node-id> [--id 1:2] [--depth 3] [--text] [--all] [--json]", run: runFigmaNode,
			Params: []param{pos("ref", "la URL de Figma (con node-id) o la clave del archivo"), str("id", "el id del nodo, ej. 1:2, si la URL no lo trae"),
				num("depth", "cuántos niveles de hijos mostrar (default 3)"), boolean("text", "sólo los textos, en orden: el copy de la pantalla"),
				boolean("all", "sin colapsar íconos y trazos"), boolean("json", "el árbol en JSON")}},
		{Name: "figma map", Summary: "cómo está ARMADO un diseño de Figma: carriles, pantallas en orden con su título y botones, decisiones, flechas, prototipo, variantes y componentes",
			Usage: "pg figma map <URL con node-id de una sección o página> [--id 1:2] [--no-comments] [--json]", run: runFigmaMap,
			Params: []param{pos("ref", "la URL de Figma (con node-id de una sección o página) o la clave del archivo"),
				str("id", "el nodo a leer, si la URL no lo trae"), boolean("no-comments", "sin contar comentarios abiertos"), boolean("json", "la estructura en JSON")}},
		{Name: "figma tokens", Summary: "los TOKENS de un diseño: colores y estilos de texto con su nombre de Figma, su valor y sus usos; radios y espaciados; los colores que se salen del sistema",
			Usage: "pg figma tokens <URL con node-id de una sección o página> [--id 1:2] [--css | --tailwind | --json]", run: runFigmaTokens,
			Params: []param{pos("ref", "la URL de Figma (con node-id de una sección o página) o la clave del archivo"),
				str("id", "el nodo a leer, si la URL no lo trae"), boolean("css", "como variables y clases CSS"),
				boolean("tailwind", "como tema de Tailwind v4 (@theme)"), boolean("json", "la hoja en JSON")}},
		{Name: "figma images", Summary: "enlaces para descargar nodos de Figma como imagen (png, jpg, svg o pdf)",
			Usage: "pg figma images <URL|clave> [--ids 1:2,3:4] [--format png] [--scale 2]", run: runFigmaImages,
			Params: []param{pos("ref", "la URL de Figma o la clave del archivo"), str("ids", "ids separados por coma; default el node-id de la URL"),
				str("format", "png, jpg, svg o pdf"), num("scale", "escala entera 1-4")}},
		{Name: "figma comments", Summary: "los comentarios de un archivo de Figma, con autor, fecha y nodo",
			Usage: "pg figma comments <URL|clave> [--open]", run: runFigmaComments,
			Params: []param{pos("ref", "la URL de Figma o la clave del archivo"), boolean("open", "sólo los no resueltos")}},
		{Name: "mcp", Summary: "sirve estos mismos comandos como herramientas MCP, por stdio", NoTool: true,
			Usage: "pg mcp", run: runMCP},
	}
}
