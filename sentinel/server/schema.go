package main

// LA DERIVA DE ESQUEMA: `bin/sentinel schema`. dev, qa y staging comparten UNA base, y una migración que corre ahí
// desde una rama que todavía no llegó a main (la de CORE-562, que renombró `countries.cell_phone_lenght` a
// `cell_phone_length` el 18/11/2026) rompe en esos ambientes a todo servicio que lea la columna vieja —el form-service—
// y va a romper igual en producción el día que corra allá, si nadie lo actualizó antes. Esto compara el esquema y las
// migraciones de dev contra los de producción y dice lo que producción tiene y dev ya NO (lo renombrado o borrado: lo
// que un servicio desplegado en producción puede estar leyendo), los cambios de tipo y las migraciones pendientes.
//
// Sólo lectura, por connectors/sql (dev: MySQL directo; prod: Redash), con su guarda de sólo lectura.

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	connsql "creditop/my-tools/connectors/sql"
)

const (
	schemaColumnsSQL = "SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ty FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
	schemaMigrations = "SELECT migration AS m FROM migrations"
)

// SchemaReport: lo que separa el esquema de dev del de producción.
type SchemaReport struct {
	// Gone: columnas que producción tiene y dev no, en tablas que dev sí tiene (renombradas o borradas en dev).
	Gone []SchemaColumn `json:"gone"`
	// GoneTables: tablas que producción tiene y dev no.
	GoneTables []string `json:"goneTables"`
	// TypeChanged: columnas con otro tipo en dev.
	TypeChanged []SchemaColumn `json:"typeChanged"`
	// Added: cuántas columnas tiene dev que producción no (lo nuevo: no rompe lo desplegado).
	Added int `json:"added"`
	// Pending: migraciones corridas en dev y no en producción; Destructive, las que por el nombre renombran o borran.
	Pending     []string `json:"pending"`
	Destructive []string `json:"destructive"`
	// Skipped: tablas que no se comparan (respaldos, temporales, vistas de reportes).
	Skipped int `json:"skipped"`
}

// noiseTable: respaldos (`bkp_…`, `…_backup_…`, `…_respaldo_…`), temporales y vistas de reportes (`VW_…`): difieren
// entre bases sin que nada desplegado dependa de ellas.
var noiseTable = regexp.MustCompile(`(?i)(bkp|backup|respaldo)|^(temp|tmp)_|^vw_`)

type SchemaColumn struct {
	Table  string `json:"table"`
	Column string `json:"column"`
	Prod   string `json:"prod"`
	Dev    string `json:"dev,omitempty"`
}

func schemaOf(target string) (map[string]map[string]string, map[string]bool, error) {
	cfg, _, err := connsql.LoadConfig(target)
	if err != nil {
		return nil, nil, err
	}
	src, err := connsql.Open(cfg)
	if err != nil {
		return nil, nil, err
	}
	defer src.Close()
	for _, q := range []string{schemaColumnsSQL, schemaMigrations} {
		if err := connsql.ValidateReadOnly(q); err != nil {
			return nil, nil, err
		}
	}
	rows, err := src.Rows(schemaColumnsSQL)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", target, err)
	}
	cols := map[string]map[string]string{}
	for _, r := range rows {
		t, c, ty := fmt.Sprint(r["t"]), fmt.Sprint(r["c"]), fmt.Sprint(r["ty"])
		if cols[t] == nil {
			cols[t] = map[string]string{}
		}
		cols[t][c] = ty
	}
	mrows, err := src.Rows(schemaMigrations)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", target, err)
	}
	migs := map[string]bool{}
	for _, r := range mrows {
		migs[fmt.Sprint(r["m"])] = true
	}
	return cols, migs, nil
}

// destructiveWords: lo que en el nombre de una migración sugiere que renombra o borra (los nombres son en inglés y a veces
// frases: «the_phone_length_column_loses_its_typo»).
var destructiveWords = []string{"rename", "drop", "remove", "delete", "loses", "typo", "move", "replace"}

func compareSchemas(dev, prod map[string]map[string]string, devMigs, prodMigs map[string]bool) *SchemaReport {
	r := &SchemaReport{}
	skipped := map[string]bool{}
	for t := range prod {
		if noiseTable.MatchString(t) {
			skipped[t] = true
		}
	}
	for t := range dev {
		if noiseTable.MatchString(t) {
			skipped[t] = true
		}
	}
	r.Skipped = len(skipped)
	for t, prodCols := range prod {
		if skipped[t] {
			continue
		}
		devCols, ok := dev[t]
		if !ok {
			r.GoneTables = append(r.GoneTables, t)
			continue
		}
		for c, prodType := range prodCols {
			devType, ok := devCols[c]
			switch {
			case !ok:
				r.Gone = append(r.Gone, SchemaColumn{Table: t, Column: c, Prod: prodType})
			case devType != prodType:
				r.TypeChanged = append(r.TypeChanged, SchemaColumn{Table: t, Column: c, Prod: prodType, Dev: devType})
			}
		}
	}
	for t, devCols := range dev {
		if skipped[t] {
			continue
		}
		for c := range devCols {
			if _, ok := prod[t][c]; !ok {
				r.Added++
			}
		}
	}
	for m := range devMigs {
		if prodMigs[m] {
			continue
		}
		r.Pending = append(r.Pending, m)
		low := strings.ToLower(m)
		for _, w := range destructiveWords {
			if strings.Contains(low, w) {
				r.Destructive = append(r.Destructive, m)
				break
			}
		}
	}
	byCol := func(xs []SchemaColumn) {
		sort.Slice(xs, func(i, j int) bool { return xs[i].Table+"."+xs[i].Column < xs[j].Table+"."+xs[j].Column })
	}
	byCol(r.Gone)
	byCol(r.TypeChanged)
	sort.Strings(r.GoneTables)
	sort.Strings(r.Pending)
	sort.Strings(r.Destructive)
	return r
}

func (c *cli) schema() (*SchemaReport, error) {
	dev, devMigs, err := schemaOf("dev")
	if err != nil {
		return nil, err
	}
	prod, prodMigs, err := schemaOf("prod")
	if err != nil {
		return nil, err
	}
	return compareSchemas(dev, prod, devMigs, prodMigs), nil
}

func (r *SchemaReport) Text() string {
	var b strings.Builder
	b.WriteString("El esquema de dev (la base de dev, qa y staging) contra el de producción\n\n")
	if len(r.Gone)+len(r.GoneTables) == 0 {
		b.WriteString("Nada de lo que producción tiene falta en dev.\n\n")
	} else {
		fmt.Fprintf(&b, "⚠ Producción tiene y dev NO (%d): renombrado o borrado en dev (o agregado a mano en producción). Un servicio\n  que lo lea anda en producción y falla en dev; cuando la migración llegue a producción, va a fallar allá también\n  si no se actualizó antes.\n", len(r.Gone)+len(r.GoneTables))
		for _, t := range r.GoneTables {
			fmt.Fprintf(&b, "  tabla %s\n", t)
		}
		for _, c := range r.Gone {
			fmt.Fprintf(&b, "  %s.%s (%s)\n", c.Table, c.Column, c.Prod)
		}
		b.WriteString("\n")
	}
	if len(r.TypeChanged) > 0 {
		fmt.Fprintf(&b, "Con otro tipo en dev (%d):\n", len(r.TypeChanged))
		for _, c := range r.TypeChanged {
			fmt.Fprintf(&b, "  %s.%s: %s en producción, %s en dev\n", c.Table, c.Column, c.Prod, c.Dev)
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "Lo nuevo en dev (no rompe lo desplegado): %d columnas\n", r.Added)
	fmt.Fprintf(&b, "Sin comparar: %d tablas de respaldo, temporales o vistas de reportes\n\n", r.Skipped)
	fmt.Fprintf(&b, "Migraciones corridas en dev y no en producción: %d\n", len(r.Pending))
	if len(r.Destructive) > 0 {
		b.WriteString("  las que por el nombre renombran o borran:\n")
		for _, m := range r.Destructive {
			fmt.Fprintf(&b, "    %s\n", m)
		}
	}
	return b.String()
}
