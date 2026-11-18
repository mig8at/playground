// Package notice manda un aviso de macOS por el avisador del chat («Chat de my-tools», que ya tiene permiso de avisos
// y abre un enlace `cockpit://` al tocarlo); sin él, o si macOS le quitó el permiso, por osascript, que avisa igual
// aunque tocarlo no abra nada. Es lo mismo que hacen Wally, Sentinel y Correo, cada uno con su copia; lo nuevo
// (la daily del tablero) usa éste.
package notice

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Notice: el aviso. URL es un `cockpit://<app>/<ruta>`; Group agrupa los avisos de una misma cosa.
type Notice struct {
	Title, Body, URL, Group string
	Sound                   bool
}

// Send lo manda. Devuelve por dónde salió («avisador» u «osascript»).
func Send(n Notice) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	home, _ := os.UserHomeDir()
	bin := filepath.Join(home, "Applications", "Chat de my-tools.app", "Contents", "MacOS", "ChatNotifier")
	var firstErr string
	if st, err := os.Stat(bin); err == nil && !st.IsDir() {
		args := []string{"--title", n.Title, "--body", n.Body}
		if n.URL != "" {
			args = append(args, "--url", n.URL)
		}
		if n.Group != "" {
			args = append(args, "--group", n.Group)
		}
		if n.Sound {
			args = append(args, "--sound")
		}
		out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput()
		if err == nil {
			return "avisador", nil
		}
		firstErr = fmt.Sprintf("el avisador del chat no pudo (%v %s)", err, strings.TrimSpace(string(out)))
	}
	script := fmt.Sprintf("display notification %q with title %q", n.Body, n.Title)
	if out, err := exec.CommandContext(ctx, "osascript", "-e", script).CombinedOutput(); err != nil {
		return "", fmt.Errorf("%s; osascript: %v %s", firstErr, err, strings.TrimSpace(string(out)))
	}
	return "osascript", nil
}
