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
	return s.downloadAll(ctx, links)
}

// downloadAll baja cada enlace, sin el token. Un enlace vacío (lo que Figma no pudo exportar) se deja
// afuera, y quien pidió ese id lo reporta como error.
func (s *server) downloadAll(ctx context.Context, links map[string]string) (map[string][]byte, error) {
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

// svgFromFigma exporta dibujos como SVG. Mismo camino que las pantallas: la API da el enlace y el
// enlace se baja sin el token.
func (s *server) svgFromFigma(ctx context.Context, key string, ids []string) (map[string][]byte, error) {
	links, err := s.figma.Images(ctx, key, ids, "svg", 0)
	if err != nil {
		return nil, err
	}
	return s.downloadAll(ctx, links)
}

// fillsFromFigma baja imágenes de relleno por su referencia. La lista de enlaces es del archivo entero
// y sale en un solo pedido.
func (s *server) fillsFromFigma(ctx context.Context, key string, refs []string) (map[string][]byte, error) {
	all, err := s.figma.ImageFills(ctx, key)
	if err != nil {
		return nil, err
	}
	links := map[string]string{}
	for _, ref := range refs {
		links[ref] = all[ref]
	}
	return s.downloadAll(ctx, links)
}
