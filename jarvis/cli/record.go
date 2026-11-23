package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// recordingInfo es lo que contesta /api/live/record (server/record.go).
type recordingInfo struct {
	ID       string  `json:"id"`
	Active   bool    `json:"active"`
	Frames   int     `json:"frames"`
	Seconds  float64 `json:"seconds"`
	Video    string  `json:"video"`
	Warnings string  `json:"warnings"`
}

// record graba la pestaña de la sesión: `record start`, `record status`, `record stop [video.mp4]`.
func record(args []string) error {
	if len(args) < 1 {
		usage()
	}
	var info recordingInfo
	switch args[0] {
	case "start":
		if err := call(http.MethodPost, "/api/live/record", map[string]string{"action": "start"}, &info); err != nil {
			return err
		}
		fmt.Printf("grabando (%s): lo que pase en la pestaña queda en el video. Termina con: bin/jarvis record stop [video.mp4]\n", info.ID)
	case "status":
		if err := call(http.MethodGet, "/api/live/record", nil, &info); err != nil {
			return err
		}
		fmt.Printf("grabando %s: %.0f s, %d cuadros\n", info.ID, info.Seconds, info.Frames)
	case "stop":
		if err := call(http.MethodPost, "/api/live/record", map[string]string{"action": "stop"}, &info); err != nil {
			return err
		}
		out := info.Video
		if len(args) > 1 {
			if err := copyFile(info.Video, args[1]); err != nil {
				return fmt.Errorf("el video quedó en %s, pero no se copió: %w", info.Video, err)
			}
			out, _ = filepath.Abs(args[1])
		}
		fmt.Printf("video listo: %s (%.0f s, %d cuadros)\n", out, info.Seconds, info.Frames)
	default:
		usage()
	}
	if info.Warnings != "" {
		fmt.Println("aviso:", info.Warnings)
	}
	return nil
}

func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
