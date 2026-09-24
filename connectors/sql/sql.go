// Package sql contesta «estas filas, en este ambiente», y es el ÚNICO lugar del playground que sabe
// qué base atiende cada ambiente y cómo se le habla.
//
//	local · dev · qa · staging → MySQL directo
//	prod                       → Redash sobre HTTP: no hay acceso directo a la base de producción, y
//	                             cada consulta queda auditada a nombre del token
//
// Las herramientas (el tablero, el trazador) no abren conexiones ni llaman a Redash: piden una Source
// y le pasan SQL. Hasta el 2026-09-24 cada una tenía su copia de todo esto —la elección de fuente, el
// ciclo de Redash, el chequeo de sólo lectura— y ya no coincidían: una iba a producción si no le decían
// el ambiente y la otra lo exigía, y aceptaban ambientes distintos.
//
// ⚠ TRES REGLAS DEL CONTRATO, y cada una ya costó un error:
//
//  1. El ambiente es OBLIGATORIO y no hay default. Una herramienta puede tener el suyo en su línea de
//     comandos, pero acá no se adivina: una consulta sin ambiente es un error, no un viaje a producción.
//  2. SÓLO LECTURA, con un único chequeo para todas (`ValidateReadOnly`), que corre ANTES de salir a la
//     red. No confía en los permisos de la cuenta: `SELECT … INTO OUTFILE` empieza con SELECT, y hasta
//     el 2026-08-07 lo frenaba el servidor por permisos, no la guarda (F-109).
//  3. Sin fallback: si el ambiente no tiene fuente configurada, falla con el motivo. Leer OTRO ambiente
//     por accidente es peor que no leer.
package sql

import (
	stdsql "database/sql"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"creditop/playground/connectors/env"
)

// Targets son los ambientes que existen, en el orden en que se nombran.
var Targets = []string{"local", "dev", "qa", "staging", "prod"}

// ValidTarget: ¿es uno de los cinco? Evita abrir un archivo de entorno arbitrario desde un argumento.
func ValidTarget(target string) bool {
	for _, t := range Targets {
		if t == target {
			return true
		}
	}
	return false
}

// Row es una fila genérica: quien pregunta decide la consulta, y el conector no inventa un modelo
// intermedio. El texto y las fechas del driver de MySQL llegan como string, igual que desde Redash.
type Row map[string]any

// Source ejecuta lecturas contra la base de UN ambiente.
type Source interface {
	// Rows corre un SELECT. Los `?` se reemplazan por `args`, que tienen que ser dígitos (ver `validArgs`).
	Rows(query string, args ...any) ([]Row, error)
	// Name dice qué contestó: «mysql <host>» o «redash ds=<id>». Va en todo resultado citable, porque
	// `qa` y `staging` leen la misma base que `dev` y el ambiente solo no lo dice.
	Name() string
	// Zone dice en qué zona vienen los `datetime` de ESTA fuente. No es un detalle: equivocarla corre
	// cinco horas la ventana con que el trazador busca logs, y la traza sale sin una línea.
	//
	// MEDIDO el 2026-08-05: MySQL directo (dev) en UTC; Redash (prod) en hora de Bogotá.
	// ⚠ Y DEJÓ DE SER CIERTO PARA DEV el 2026-09-23 (F-241): desde la 502661 la base compartida escribe
	// en Bogotá, y las filas de antes siguen en UTC. Una zona fija por fuente no alcanza; el arreglo
	// (calibrar por solicitud) es del trazador y está sin hacer.
	Zone() *time.Location
	Close()
}

// Config es de dónde leer en un ambiente. Con `Host` se usa MySQL directo; si no, Redash.
type Config struct {
	Target                           string
	Host, Port, Name, User, Password string
	// MaxOpen es el tope de conexiones de MySQL: el tablero hace una consulta y el trazador varias.
	MaxOpen int

	RedashURL, RedashToken string
	RedashDataSource       int
	// RedashZone es la zona en que el servidor de Redash devuelve los datetime (default Bogotá).
	RedashZone string
}

// Open valida el ambiente y abre su fuente. No hay fallback entre fuentes (regla 3).
func Open(c Config) (Source, error) {
	if !ValidTarget(c.Target) {
		return nil, fmt.Errorf("ambiente %q no permitido (%s)", c.Target, strings.Join(Targets, " · "))
	}
	if c.Host != "" {
		for key, value := range map[string]string{"nombre de la base": c.Name, "usuario": c.User, "contraseña": c.Password} {
			if value == "" {
				return nil, fmt.Errorf("falta el %s para MySQL en %s", key, c.Target)
			}
		}
		port := c.Port
		if port == "" {
			port = "3306"
		}
		// El parseo queda en UTC (el default del driver) A PROPÓSITO: la columna vuelve como reloj de pared
		// y marcarla Local correría el instante. Lo que se convierte es la presentación, no el dato.
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&timeout=10s&readTimeout=30s",
			c.User, c.Password, c.Host, port, c.Name)
		db, err := stdsql.Open("mysql", dsn)
		if err != nil {
			return nil, err
		}
		maxOpen := c.MaxOpen
		if maxOpen == 0 {
			maxOpen = 1
		}
		db.SetMaxOpenConns(maxOpen)
		if err := db.Ping(); err != nil {
			db.Close()
			return nil, err
		}
		return &mysqlSource{db: db, name: "mysql " + c.Host}, nil
	}
	if c.RedashURL != "" && c.RedashToken != "" {
		ds := c.RedashDataSource
		if ds == 0 {
			ds = 1 // la fuente «Live» (rds_mysql) de producción
		}
		zoneName := c.RedashZone
		if strings.TrimSpace(zoneName) == "" {
			zoneName = "America/Bogota"
		}
		zone, err := time.LoadLocation(zoneName)
		if err != nil {
			return nil, fmt.Errorf("la zona de Redash %q no es válida: %w", zoneName, err)
		}
		return &redashSource{
			zone: zone, base: strings.TrimRight(c.RedashURL, "/"), token: c.RedashToken, ds: ds,
			http: &http.Client{Timeout: 90 * time.Second}, name: fmt.Sprintf("redash ds=%d", ds),
		}, nil
	}
	return nil, fmt.Errorf("no hay fuente para %s: configurá MySQL directo (host) o Redash (url y token)", c.Target)
}

// Query es el camino corto de una sola consulta: valida, abre, corre y cierra.
func Query(c Config, query string) ([]Row, string, error) {
	if err := ValidateReadOnly(query); err != nil {
		return nil, "", err
	}
	src, err := Open(c)
	if err != nil {
		return nil, "", err
	}
	defer src.Close()
	rows, err := src.Rows(query)
	return rows, src.Name(), err
}

/* validArgs es la guarda de inyección del camino Redash, que no tiene placeholders: `POST
 * /api/query_results` recibe SQL como texto y los `?` hay que interpolarlos. La defensa no es escapar
 * mejor sino rechazar cualquier argumento que no sea de dígitos — todo lo que se consulta por argumento
 * (solicitud, usuario, teléfono, documento) lo es. Se aplica también a MySQL, donde no hace falta, a
 * propósito: si la regla vale sólo en una fuente, alguien la viola en la otra y el error aparece al
 * cambiar de ambiente. */
var digitsOnly = regexp.MustCompile(`^\d{1,20}$`)

func validArgs(args []any) error {
	for i, a := range args {
		if !digitsOnly.MatchString(fmt.Sprint(a)) {
			return fmt.Errorf("argumento %d (%q) no es de dígitos: sólo se consulta por id, teléfono o "+
				"documento, y esa restricción es lo que hace segura la interpolación en Redash", i+1, a)
		}
	}
	return nil
}

// Columns ordena las claves de manera estable: una fila es un mapa, y sin esto dos salidas de la misma
// consulta no se podrían comparar.
func Columns(rows []Row) []string {
	seen := map[string]bool{}
	var columns []string
	for _, row := range rows {
		for column := range row {
			if !seen[column] {
				seen[column] = true
				columns = append(columns, column)
			}
		}
	}
	sort.Strings(columns)
	return columns
}

// LoadConfig arma la configuración de un ambiente desde `connectors/.env.<target>` (ver connectors/env).
//
// ⚠ LA BASE SE LEE SÓLO CON EL PREFIJO `E2E_DB_`, NUNCA COMO `DB_HOST`. `DB_HOST` y `DB_PORT` son los
// nombres que lee Laravel: con ellos en un `.env`, un `set -a; . archivo` deja cualquier `artisan` de
// legacy-backend apuntando a la base compartida (medido el 19/8 en la tarea de la base borrada, CORE-431,
// y por eso el trazador y el harness ya usaban el prefijo). Y al revés: aceptar `DB_HOST` del PROCESO
// haría que una terminal preparada para `artisan` le cambie la base al conector sin decir nada.
func LoadConfig(target string) (Config, string, error) {
	if !ValidTarget(target) {
		return Config{}, "", fmt.Errorf("ambiente %q no permitido (%s)", target, strings.Join(Targets, " · "))
	}
	v, err := env.Load(target)
	if err != nil {
		return Config{}, "", err
	}
	ds, _ := strconv.Atoi(v.Get("REDASH_DATA_SOURCE_ID"))
	return Config{
		Target: target,
		Host:   v.Get("E2E_DB_HOST"), Port: v.Get("E2E_DB_PORT"),
		Name: v.Get("E2E_DB_NAME"), User: v.Get("E2E_DB_USER"),
		Password:  v.Get("E2E_DB_PASS"),
		RedashURL: v.Get("REDASH_URL"), RedashToken: v.Get("REDASH_TOKEN"),
		RedashDataSource: ds, RedashZone: v.Get("REDASH_TZ"),
	}, v.File, nil
}
