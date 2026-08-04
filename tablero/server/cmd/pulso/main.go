// pulso — el programa de consola que registra CUÁNDO toco los repos de la compañía.
//
// Un tick cada 5 minutos contesta una sola cosa por repo: ¿hubo cambios, sí o no? De ahí sale el mapa de
// «Mi jornada»: 12 tramos por hora, y el total del día es tramos × 5' — tiempo con cambios reales, no una
// estimación. El porqué del diseño está en internal/pulso.
//
//	pulso                un tick y sale — ESTO es lo que corre el agente cada 5 minutos
//	pulso seed -days 20  siembra hacia atrás desde git (commits + reflog): llena el mapa el día uno
//	pulso report -days 7 la jornada en la terminal
//	pulso repos          qué repos está mirando (para verificar la config antes de instalar)
//	pulso install        deja el agente corriendo solo, y que arranque con la sesión
//	pulso status         ¿está vivo? último tick, cobertura y actividad de hoy
//	pulso uninstall      lo saca
package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"creditop/tablero/server/internal/env"
	"creditop/tablero/server/internal/pulso"
)

const (
	label      = "com.creditop.tablero.pulso"
	intervalo  = 300 // segundos entre ticks; tiene que ir de la mano con pulso.Slot (5 min)
	logRelPath = "Library/Logs/tablero-pulso.log"
)

func main() {
	// El mismo `.env` que lee el server, y por la misma ruta: `LoadDefaults` lo busca junto al binario y
	// en su carpeta padre, o sea `server/.env` cuando esto corre desde `server/bin/pulso`. Sin esto, un
	// `TABLERO_DATA` puesto ahí mandaría al server y al agente a carpetas distintas — el tablero mostraría
	// una jornada vacía mientras el pulso escribe en otro lado, y nada avisaría.
	//
	// No pisa lo que ya viene del entorno: lo que el `plist` inyecta al agente gana sobre el archivo.
	env.LoadDefaults()

	cmd := ""
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		cmd = os.Args[1]
		os.Args = append(os.Args[:1], os.Args[2:]...)
	}

	var err error
	switch cmd {
	case "", "tick":
		err = tick()
	case "seed":
		err = seed()
	case "report":
		err = report()
	case "repos":
		err = repos()
	case "install":
		err = install()
	case "uninstall":
		err = uninstall()
	case "status":
		err = status()
	default:
		fmt.Fprintf(os.Stderr, "pulso: no existe el comando %q\n\n", cmd)
		fmt.Fprint(os.Stderr, ayuda)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "pulso:", err)
		os.Exit(1)
	}
}

const ayuda = `uso:
  pulso                 un tick (lo que corre el agente cada 5 minutos)
  pulso seed [-days 20] siembra hacia atrás desde git: commits y reflog ya tienen fecha
  pulso report [-days 7] la jornada en la terminal
  pulso repos           qué repos mira
  pulso install         instala el agente (cada 5 min, arranca con la sesión)
  pulso status          ¿está vivo?
  pulso uninstall       lo saca
`

// ── el tick ─────────────────────────────────────────────────────────────────────────────────────

// tick corre una vez. La ventana arranca en el ÚLTIMO tick anotado, no "hace 5 minutos": así, si el Mac
// estuvo dormido o el agente detenido, la próxima corrida barre el hueco y reparte lo que encuentra en las
// horas reales (cada señal lleva su instante). El techo de 24h acota el costo tras un fin de semana.
func tick() error {
	flag.Parse()
	dir := pulso.DataDir()
	cfg := pulso.Load()

	ahora := time.Now()
	desde := ahora.Add(-pulso.Slot)
	if ult, ok := pulso.LastTick(dir); ok {
		desde = ult
	}
	if lim := ahora.Add(-cfg.MaxGap); desde.Before(lim) {
		desde = lim
	}

	t := pulso.Run(cfg, desde, ahora)
	if err := pulso.Append(dir, t); err != nil {
		return err
	}
	fmt.Println(resumenTick(t, desde, ahora))
	return nil
}

func resumenTick(t pulso.Tick, desde, ahora time.Time) string {
	if len(t.Signals) == 0 {
		return fmt.Sprintf("%s · sin cambios (ventana %s)", ahora.Format("15:04"), ahora.Sub(desde).Round(time.Second))
	}
	porRepo := map[string][]string{}
	orden := []string{}
	for _, s := range t.Signals {
		if _, ok := porRepo[s.Repo]; !ok {
			orden = append(orden, s.Repo)
		}
		if !contiene(porRepo[s.Repo], s.Why) {
			porRepo[s.Repo] = append(porRepo[s.Repo], s.Why)
		}
	}
	partes := make([]string, 0, len(orden))
	for _, r := range orden {
		partes = append(partes, fmt.Sprintf("%s(%s)", r, strings.Join(porRepo[r], "+")))
	}
	return fmt.Sprintf("%s · %d señales en %d repos: %s", ahora.Format("15:04"), len(t.Signals), len(orden), strings.Join(partes, " "))
}

func contiene(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

// seed siembra el pasado. Los commits y el reflog YA tienen fecha en git, así que el mapa no tiene por qué
// nacer vacío ni esperar semanas a llenarse. Lo que no puede recuperar es la edición sin commitear: el
// mtime del working tree es de AHORA, y sólo el muestreo lo captura en el momento.
func seed() error {
	fs := flag.NewFlagSet("seed", flag.ExitOnError)
	days := fs.Int("days", 20, "cuántos días hacia atrás sembrar")
	fs.Parse(os.Args[1:])

	dir := pulso.DataDir()
	cfg := pulso.Load()
	ahora := time.Now()
	desde := ahora.AddDate(0, 0, -*days)

	t := pulso.Run(cfg, desde, ahora)
	// La siembra se anota con su ventana real: la agregación la ve, sabe que NO es cadencia normal y por
	// eso no le cree la cobertura. Sin ese dato, sembrar pintaría 20 días de "equipo prendido".
	if err := pulso.Append(dir, t); err != nil {
		return err
	}
	dias := map[string]bool{}
	for _, s := range t.Signals {
		if len(s.At) >= 10 {
			dias[s.At[:10]] = true
		}
	}
	fmt.Printf("sembrado: %d señales en %d días (desde %s)\n", len(t.Signals), len(dias), desde.Format("2006-01-02"))
	fmt.Println("el pulso ya tiene historia; el muestreo en vivo lo empieza a llenar con `pulso install`")
	return nil
}

// ── la jornada en consola ───────────────────────────────────────────────────────────────────────

const (
	hIni = 8
	hFin = 18
)

// bloques: el color/relleno crece con los tramos de 5' que tuvieron cambios en esa hora (de 0 a 12).
var bloques = []string{"·", "▂", "▄", "▆", "█"}

func nivel(slots int) int {
	switch {
	case slots <= 0:
		return 0
	case slots <= 2:
		return 1
	case slots <= 5:
		return 2
	case slots <= 9:
		return 3
	default:
		return 4
	}
}

func report() error {
	fs := flag.NewFlagSet("report", flag.ExitOnError)
	days := fs.Int("days", 7, "cuántos días mostrar")
	fs.Parse(os.Args[1:])

	dir := pulso.DataDir()
	ticks, err := pulso.Read(dir, *days)
	if err != nil {
		return err
	}
	celdas := pulso.Aggregate(ticks, *days)
	if len(celdas) == 0 {
		fmt.Println("todavía no hay pulso. Sembrá el pasado con `pulso seed` y dejalo corriendo con `pulso install`.")
		return nil
	}

	porDia := map[string]map[int]pulso.Hour{}
	for _, c := range celdas {
		if porDia[c.Day] == nil {
			porDia[c.Day] = map[int]pulso.Hour{}
		}
		porDia[c.Day][c.Hour] = c
	}

	var dias []string
	for i := *days - 1; i >= 0; i-- {
		dias = append(dias, time.Now().AddDate(0, 0, -i).Format("2006-01-02"))
	}
	nombreDia := []string{"do", "lu", "ma", "mi", "ju", "vi", "sá"}

	// El canal izquierdo mide 7 y cada columna de día mide 7: la grilla se desalinea en cuanto uno de
	// los dos se toca por separado, y con 14 columnas el corrimiento se acumula hasta ser ilegible.
	fmt.Printf("\n  \033[1mMi jornada\033[0m · repos de la compañía · últimos %d días\n\n", *days)
	fmt.Print("       ")
	for _, d := range dias {
		t, _ := time.Parse("2006-01-02", d)
		fmt.Printf(" %s %02d ", nombreDia[t.Weekday()], t.Day())
	}
	fmt.Println()

	for h := hIni; h < hFin; h++ {
		fmt.Printf("  %4s ", etiquetaHora(h))
		for _, d := range dias {
			c, hay := porDia[d][h]
			switch {
			case !hay || (c.Slots == 0 && c.Covered == 0):
				fmt.Print("       ") // sin registro: ni el agente miró
			case c.Slots == 0:
				fmt.Print("   \033[2m·\033[0m   ") // miró y no había nada
			default:
				fmt.Printf("   \033[32m%s\033[0m   ", bloques[nivel(c.Slots)])
			}
		}
		fmt.Println()
	}

	fmt.Print("       ")
	for range dias {
		fmt.Print("───────")
	}
	fmt.Println()
	fmt.Print("  \033[2mtot\033[0m  ")
	for _, d := range dias {
		total := 0
		for _, c := range porDia[d] {
			total += c.Slots
		}
		if total == 0 {
			fmt.Print("   \033[2m—\033[0m   ")
			continue
		}
		fmt.Printf(" %5s ", hhmm(total*int(pulso.Slot/time.Minute)))
	}
	fmt.Println()

	fmt.Printf("\n  \033[2m·\033[0m sin cambios   \033[32m▂▄▆█\033[0m 1→12 tramos de 5'   ␣ sin registro (equipo apagado o agente detenido)\n")
	// Sin esta línea, un día reconstruido se lee como "trabajé 20 minutos". Un commit marca el INSTANTE en
	// que pasó, no el rato que costó: sin muestreo en vivo, el número es un piso, no una medición.
	if sembrados := diasSinCobertura(porDia, dias); len(sembrados) > 0 {
		fmt.Printf("  \033[2m%d de esos días no tienen muestreo (␣): están reconstruidos desde git, así que el total es un PISO —\n"+
			"  marca el instante del commit, no el rato que costó. El muestreo en vivo llena el resto.\033[0m\n", len(sembrados))
	}

	// El desglose por repo contesta la otra mitad de la pregunta: no sólo cuánto, en qué.
	tot := map[string]int{}
	commits := map[string]int{}
	for _, c := range celdas {
		for _, r := range c.Repos {
			tot[r.Repo] += r.Slots
			commits[r.Repo] += r.Commits
		}
	}
	if len(tot) > 0 {
		nombres := make([]string, 0, len(tot))
		for r := range tot {
			nombres = append(nombres, r)
		}
		sort.Slice(nombres, func(i, j int) bool { return tot[nombres[i]] > tot[nombres[j]] })
		fmt.Println("\n  \033[1men qué\033[0m")
		for _, r := range nombres {
			fmt.Printf("    %-34s %6s   \033[2m%d %s\033[0m\n", r, hhmm(tot[r]*int(pulso.Slot/time.Minute)),
				commits[r], plural(commits[r], "commit", "commits"))
		}
		// Sin esta línea, la suma no cierra contra los totales de arriba y parece un error de cuentas.
		fmt.Println("    \033[2mestos suman más que el total: dos repos pueden caer en el mismo tramo de 5'\033[0m")
	}
	fmt.Println()
	return nil
}

// diasSinCobertura son los días con actividad pero sin un solo tick del agente: reconstruidos desde git.
func diasSinCobertura(porDia map[string]map[int]pulso.Hour, dias []string) []string {
	var out []string
	for _, d := range dias {
		slots, cubiertos := 0, 0
		for _, c := range porDia[d] {
			slots += c.Slots
			cubiertos += c.Covered
		}
		if slots > 0 && cubiertos == 0 {
			out = append(out, d)
		}
	}
	return out
}

func plural(n int, uno, varios string) string {
	if n == 1 {
		return uno
	}
	return varios
}

func etiquetaHora(h int) string {
	switch {
	case h == 12:
		return "12p"
	case h < 12:
		return fmt.Sprintf("%da", h)
	default:
		return fmt.Sprintf("%dp", h-12)
	}
}

func hhmm(min int) string {
	if min < 60 {
		return fmt.Sprintf("%dm", min)
	}
	return fmt.Sprintf("%dh%02d", min/60, min%60)
}

func repos() error {
	flag.Parse()
	cfg := pulso.Load()
	rs := pulso.Repos(cfg.Root)
	fmt.Printf("\n  raíz: %s\n  yo:   %s\n  datos: %s\n\n", cfg.Root, strings.Join(cfg.Emails, ", "), pulso.DataDir())
	if len(rs) == 0 {
		fmt.Println("  ⚠ no se encontró ningún repo git ahí. Revisá PULSO_ROOT.")
		return nil
	}
	for _, r := range rs {
		fmt.Printf("    %s\n", r)
	}
	fmt.Printf("\n  %d repos\n\n", len(rs))
	return nil
}

// ── el agente de launchd ────────────────────────────────────────────────────────────────────────

// install deja el pulso corriendo solo. Es un LaunchAgent (no un cron): arranca con la sesión y vuelve a
// correr cada 5 minutos mientras el equipo esté prendido, sin tener que acordarse de nada. Si el Mac está
// dormido no corre — y está bien: dormido no estabas trabajando.
func install() error {
	flag.Parse()
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	// `go run` compila a un temporal que se borra al salir: el agente quedaría apuntando a un binario que
	// ya no existe y fallaría en silencio cada 5 minutos.
	if strings.Contains(exe, "/go-build") || strings.Contains(exe, os.TempDir()) {
		return fmt.Errorf("estás corriendo con `go run` y el binario es temporal.\n" +
			"  Compilalo primero y instalá ese:  cd tablero && npm run server:build && server/bin/pulso install")
	}

	dir, err := filepath.Abs(pulso.DataDir())
	if err != nil {
		return err
	}
	cfg := pulso.Load()
	home, _ := os.UserHomeDir()
	plist := filepath.Join(home, "Library", "LaunchAgents", label+".plist")
	logPath := filepath.Join(home, logRelPath)

	if err := os.MkdirAll(filepath.Dir(plist), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(plist, []byte(plistXML(exe, dir, cfg, logPath)), 0o644); err != nil {
		return err
	}

	dominio := "gui/" + uid()
	// bootout antes de bootstrap: si ya estaba cargado (una versión anterior del plist), bootstrap falla
	// con "service already loaded" y uno cree que instaló algo que no cambió.
	_ = exec.Command("launchctl", "bootout", dominio+"/"+label).Run()
	if out, err := exec.Command("launchctl", "bootstrap", dominio, plist).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl bootstrap: %v\n%s", err, out)
	}
	_ = exec.Command("launchctl", "kickstart", "-k", dominio+"/"+label).Run()

	fmt.Printf("\n  ✓ pulso instalado\n\n")
	fmt.Printf("    agente   %s\n", plist)
	fmt.Printf("    binario  %s\n", exe)
	fmt.Printf("    cada     %d segundos, y al iniciar sesión\n", intervalo)
	fmt.Printf("    datos    %s/pulse/\n", dir)
	fmt.Printf("    log      %s\n\n", logPath)
	fmt.Printf("  Si es la primera vez, sembrá el pasado:  %s seed\n", exe)
	fmt.Printf("  Para ver la jornada:                     %s report\n\n", exe)
	return nil
}

func uninstall() error {
	flag.Parse()
	home, _ := os.UserHomeDir()
	plist := filepath.Join(home, "Library", "LaunchAgents", label+".plist")
	_ = exec.Command("launchctl", "bootout", "gui/"+uid()+"/"+label).Run()
	if err := os.Remove(plist); err != nil && !os.IsNotExist(err) {
		return err
	}
	fmt.Println("  ✓ pulso desinstalado (los datos ya registrados quedan en data/pulse/)")
	return nil
}

func status() error {
	flag.Parse()
	dominio := "gui/" + uid()
	out, err := exec.Command("launchctl", "print", dominio+"/"+label).CombinedOutput()
	fmt.Println()
	if err != nil {
		fmt.Println("  agente: NO instalado   (instalalo con `pulso install`)")
	} else {
		estado := "cargado"
		for _, l := range strings.Split(string(out), "\n") {
			if s := strings.TrimSpace(l); strings.HasPrefix(s, "state = ") {
				estado = strings.TrimPrefix(s, "state = ")
			}
		}
		fmt.Printf("  agente: instalado · %s · cada %ds\n", estado, intervalo)
	}

	dir := pulso.DataDir()
	if ult, ok := pulso.LastTick(dir); ok {
		fmt.Printf("  último tick: %s (hace %s)\n", ult.Format("2006-01-02 15:04"), time.Since(ult).Round(time.Minute))
	} else {
		fmt.Println("  último tick: nunca — corré `pulso seed` para sembrar el pasado")
	}

	ticks, err := pulso.Read(dir, 1)
	if err != nil {
		return err
	}
	hoy := time.Now().Format("2006-01-02")
	slots, cubiertos := 0, 0
	for _, c := range pulso.Aggregate(ticks, 1) {
		if c.Day == hoy {
			slots += c.Slots
			cubiertos += c.Covered
		}
	}
	m := int(pulso.Slot / time.Minute)
	fmt.Printf("  hoy: %s con cambios · %s registrados\n\n", hhmm(slots*m), hhmm(cubiertos*m))
	return nil
}

func uid() string {
	if u, err := user.Current(); err == nil {
		return u.Uid
	}
	return fmt.Sprint(os.Getuid())
}

// plistXML arma el agente. Los dos detalles que importan:
//
//   - PATH explícito: launchd NO hereda tu shell, así que sin esto `git` puede no existir para el agente
//     y el pulso "no hace nada" en silencio, que es el peor modo de fallar.
//   - TABLERO_DATA absoluto: el agente corre con cwd `/`, y un default relativo escribiría en cualquier lado.
func plistXML(exe, data string, cfg pulso.Config, logPath string) string {
	env := [][2]string{
		{"PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin"},
		{"TABLERO_DATA", data},
		{"PULSO_ROOT", cfg.Root},
		{"PULSO_EMAILS", strings.Join(cfg.Emails, ",")},
	}
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">` + "\n")
	b.WriteString("<plist version=\"1.0\">\n<dict>\n")
	fmt.Fprintf(&b, "  <key>Label</key><string>%s</string>\n", esc(label))
	fmt.Fprintf(&b, "  <key>ProgramArguments</key>\n  <array>\n    <string>%s</string>\n  </array>\n", esc(exe))
	fmt.Fprintf(&b, "  <key>StartInterval</key><integer>%d</integer>\n", intervalo)
	b.WriteString("  <key>RunAtLoad</key><true/>\n")
	b.WriteString("  <key>EnvironmentVariables</key>\n  <dict>\n")
	for _, kv := range env {
		fmt.Fprintf(&b, "    <key>%s</key><string>%s</string>\n", esc(kv[0]), esc(kv[1]))
	}
	b.WriteString("  </dict>\n")
	fmt.Fprintf(&b, "  <key>StandardOutPath</key><string>%s</string>\n", esc(logPath))
	fmt.Fprintf(&b, "  <key>StandardErrorPath</key><string>%s</string>\n", esc(logPath))
	// Cortesía con la máquina: esto corre mientras trabajás, no puede competir por CPU ni disco.
	b.WriteString("  <key>ProcessType</key><string>Background</string>\n")
	b.WriteString("  <key>LowPriorityIO</key><true/>\n")
	b.WriteString("  <key>Nice</key><integer>5</integer>\n")
	b.WriteString("</dict>\n</plist>\n")
	return b.String()
}

var escapador = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

func esc(s string) string { return escapador.Replace(s) }
