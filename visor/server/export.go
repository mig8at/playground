package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// exportFromFigma pide a Figma los enlaces de las imágenes (a 2×, para que el texto se lea en una
// pantalla retina) y las baja. ⚠ El enlace es de S3 y se baja SIN el token: el token es para la API de
// Figma y a otro host no se le manda nunca.
func (s *server) exportFromFigma(ctx context.Context, key string, ids []string) (map[string][]byte, error) {
	links, err := s.figma.Images(ctx, key, ids, "png", 2)
	if err != nil {
		return nil, err
	}
	plain := &http.Client{Timeout: 60 * time.Second}
	out := map[string][]byte{}
	for id, link := range links {
		if link == "" {
			continue
		}
		u, err := url.Parse(link)
		if err != nil || u.Scheme != "https" {
			return nil, fmt.Errorf("Figma devolvió un enlace de imagen que no es https para %s", id)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
		if err != nil {
			return nil, err
		}
		resp, err := plain.Do(req)
		if err != nil {
			return nil, fmt.Errorf("bajando la imagen de %s: %v", id, err)
		}
		img, err := io.ReadAll(io.LimitReader(resp.Body, 30_000_000))
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("la imagen de %s dio HTTP %d", id, resp.StatusCode)
		}
		out[id] = img
	}
	return out, nil
}
