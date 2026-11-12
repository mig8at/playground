package main

// DE FONDO: la API como LaunchAgent (`lib/launchagent`), para que mida aunque Cockpit esté cerrado. Corre el binario
// compilado (`sentinel/bin/sentinel`, fuera de git): un cambio en el servidor pide `make sentinel-install` de nuevo.
// Con el Mac dormido o sin la VPN de producción no mide; la pasada siguiente pide el hueco entero.

import (
	"fmt"
	"os"
	"time"

	"creditop/playground/lib/launchagent"
)

func agent(root, serve string) launchagent.Agent {
	return launchagent.Agent{Label: "com.creditop.sentinel", Args: []string{"-serve", serve}, Root: root, Log: "sentinel.log"}
}

func exitOn(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "sentinel:", err)
		os.Exit(1)
	}
}

func agentStatus(a launchagent.Agent, st *store) {
	fmt.Println(a.Status())
	if reach := st.reach(); !reach.IsZero() {
		fmt.Printf("guardado hasta %s (hace %s) · %s\n", reach.In(bogota).Format("2006-01-02 15:04"), time.Since(reach).Round(time.Minute), st)
	}
}
