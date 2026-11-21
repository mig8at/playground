// daily: LO QUE MIGUEL DICE EN LA DAILY, escrito por el modelo de segundo plano a partir de la bitácora
// (internal/daily). `make daily` la arma a mano; agendada (`make daily-install`), corre de lunes a viernes a las 7:30
// con `-auto`: toma el último día con registro de CreditOp, no la repite si ya está, y avisa por macOS al terminar.
//
//	daily [-day AAAA-MM-DD] [-print] [-force]   armarla (sin -day, el último día con registro antes de hoy)
//	daily -prompt [-day …]                       lo que se le manda al modelo, sin preguntarle
//	daily -auto                                  lo agendado: la del último día, si falta, y el aviso
//	daily -install | -uninstall | -status        agendarla (LaunchAgent) o sacarla
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"creditop/my-tools/lib/cliflags"
	"creditop/my-tools/lib/launchagent"
	"creditop/my-tools/lib/notice"
	"creditop/my-tools/tablero/server/internal/daily"
	"creditop/my-tools/tablero/server/internal/layout"
	"creditop/my-tools/tablero/server/internal/store"
)

// La hora de la daily agendada: antes de la reunión, con el día anterior ya cerrado.
const runHour, runMinute = 7, 30

func main() {
	var (
		day       = flag.String("day", "", "el día (AAAA-MM-DD); sin él, el último con registro de CreditOp antes de hoy")
		printOnly = flag.Bool("print", false, "mostrarla sin guardarla")
		force     = flag.Bool("force", false, "volver a armarla aunque ya exista")
		prompt    = flag.Bool("prompt", false, "mostrar lo que se le manda al modelo, sin preguntarle")
		auto      = flag.Bool("auto", false, "lo agendado: la del último día si falta, y el aviso de macOS")
		install   = flag.Bool("install", false, "agendarla de lunes a viernes a las 7:30 (LaunchAgent)")
		uninstall = flag.Bool("uninstall", false, "sacarla de lo agendado (lo guardado se queda)")
		status    = flag.Bool("status", false, "¿está agendada, y cuál es la última?")
	)
	flag.CommandLine.Parse(cliflags.Translate(os.Args[1:], cliflags.Legacy))

	lay := layout.Find()
	// Absoluta: layout.Find() la da relativa a donde se corre (`../data` desde tablero/server), y lo agendado corre
	// desde la raíz de my-tools; con la relativa, launchd miraba otra carpeta y no encontraba nada (2026-11-18).
	if abs, err := filepath.Abs(lay.Data); err == nil {
		lay = layout.At(abs)
	}
	root := filepath.Dir(lay.Tools()) // la raíz de my-tools
	agent := launchagent.Agent{Label: "com.creditop.my-tools.daily", Args: []string{"-auto"}, Root: root,
		Log: "my-tools-daily.log", Calendar: launchagent.Weekdays(runHour, runMinute),
		Env: map[string]string{"TABLERO_DATA": lay.Data}}
	switch {
	case *install:
		exit(agent.Install())
		return
	case *uninstall:
		exit(agent.Uninstall())
		return
	case *status:
		fmt.Println(agent.Status())
		if list := daily.List(lay, 1); len(list) > 0 {
			fmt.Printf("la última: la del %s (%s)\n", list[0].Day, list[0].Source)
		} else {
			fmt.Println("todavía no hay ninguna guardada")
		}
		return
	}

	st, err := store.Open(lay.Data)
	if err != nil {
		fail("no pude abrir el tablero: %v", err)
	}
	d := *day
	if d == "" {
		if d = daily.Previous(st, time.Now()); d == "" {
			msg := "no hay nada registrado de CreditOp en los últimos 10 días"
			if *auto {
				fmt.Printf("%s %s: no hay daily\n", time.Now().Format(time.RFC3339), msg)
				return
			}
			fail("%s", msg)
		}
	}
	// No se repite una que ya está COMPLETA: armada después del día que cuenta. Una armada ese mismo día (a mano, con el
	// día a medias) se vuelve a armar, con todo lo registrado.
	if *auto && !*force {
		if fi, err := os.Stat(filepath.Join(lay.DailyDir(), d+".md")); err == nil && fi.ModTime().Format("2006-01-02") > d {
			fmt.Printf("%s la del %s ya estaba\n", time.Now().Format(time.RFC3339), d)
			return
		}
	}
	in, err := daily.Gather(st, lay, d)
	if err != nil {
		fail("no pude leer la bitácora: %v", err)
	}
	if *prompt {
		fmt.Println(daily.Prompt(in))
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	out, err := daily.Make(ctx, root, in)
	if err != nil {
		if *auto {
			// Agendada, un error no se ve en ninguna terminal: se avisa.
			_, _ = notice.Send(notice.Notice{App: "tablero", Title: "La daily no salió", Body: err.Error(), URL: "cockpit://tablero/", Group: "creditop-daily", Replace: true, Important: true})
		}
		fail("%v", err)
	}
	if *printOnly {
		fmt.Println(out.Text)
		fmt.Fprintf(os.Stderr, "— la del %s · %s · %d min de %s\n", out.Day, out.Model, out.MinutesIn, strings.Join(out.Tasks, " · "))
		return
	}
	path, err := daily.Write(lay, out)
	if err != nil {
		fail("no pude guardarla: %v", err)
	}
	fmt.Println(out.Text)
	fmt.Fprintf(os.Stderr, "— guardada en %s (%s, %d min de %d tareas)\n", path, out.Model, out.MinutesIn, len(out.Tasks))
	if *auto {
		first := strings.SplitN(out.Text, "\n", 2)[0]
		via, err := notice.Send(notice.Notice{App: "tablero", Title: "Tu daily está lista", Body: first, URL: "cockpit://tablero/", Group: "creditop-daily", Replace: true})
		fmt.Printf("%s la del %s, guardada; aviso por %s %v\n", time.Now().Format(time.RFC3339), d, via, errOrEmpty(err))
	}
}

func errOrEmpty(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func exit(err error) {
	if err != nil {
		fail("%v", err)
	}
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "daily: "+format+"\n", args...)
	os.Exit(1)
}
