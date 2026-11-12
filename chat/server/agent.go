package main

// DE FONDO: el servidor del chat como LaunchAgent (`lib/launchagent`), para que junte el historial, avise y conteste
// el llavero aunque Cockpit esté cerrado del todo (no sólo la ventana) o se esté reinstalando. Cockpit usa el servidor
// que ya contesta en :5185 y no levanta otro; si el de fondo no está, levanta el suyo como siempre.
//
// Corre `chat/bin/chat-server` (fuera de git): un cambio en el servidor pide `make chat-install` de nuevo (`make cockpit`
// lo hace solo si está instalado).

import (
	"fmt"
	"net/http"
	"os"
	"time"

	"creditop/playground/lib/launchagent"
)

func chatAgent(addr string) (launchagent.Agent, error) {
	root, err := playgroundRoot()
	if err != nil {
		return launchagent.Agent{}, err
	}
	return launchagent.Agent{Label: "com.creditop.playground.chat", Args: []string{"-serve", addr}, Root: root,
		Log: "creditop-playground-chat.log"}, nil
}

func agentCommand(addr string, install, uninstall bool) int {
	a, err := chatAgent(addr)
	if err == nil {
		switch {
		case install:
			err = a.Install()
		case uninstall:
			err = a.Uninstall()
		default:
			fmt.Println(a.Status())
			if chatAt(addr) {
				fmt.Printf("en %s contesta un servidor del chat\n", addr)
			}
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "chat:", err)
		return 1
	}
	return 0
}

// chatAt: ¿en esa dirección contesta un servidor del chat?
func chatAt(addr string) bool {
	res, err := (&http.Client{Timeout: 3 * time.Second}).Get("http://" + addr + "/api/state")
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode < 500
}
