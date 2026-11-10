package main

// Qué versión del conector (creditop.creditop) tiene cada workspace de la cuenta VTEX de pruebas. `master` corre
// siempre una versión publicada (`installation`); `develop` puede tener una instalada o una linkeada desde la máquina
// de alguien (`link`, con `+build…`). La lista de versiones publicadas del registro no se puede leer: VTEX la niega
// tanto a la llave de la cuenta como a un usuario Owner (403 en /registry/creditop.creditop, medido el 2026-11-05).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Los workspaces que se miran: la tienda (master) y el de pruebas contra qa (develop).
var connectorWorkspaces = []string{"master", "develop"}

const connectorApp = "creditop.creditop"

type ConnectorVersion struct {
	Workspace string `json:"workspace"`
	Version   string `json:"version,omitempty"` // 5.0.1, sin el +build del link
	Build     string `json:"build,omitempty"`   // el sufijo +build… de un link
	Source    string `json:"source,omitempty"`  // installation | link
	Error     string `json:"error,omitempty"`
}

type ConnectorVersions struct {
	Account    string             `json:"account"`
	Workspaces []ConnectorVersion `json:"workspaces"`
	ReadAt     time.Time          `json:"readAt"`
}

var (
	ioTokenMu      sync.Mutex
	ioToken        string
	ioTokenExpires time.Time

	connectorMu     sync.Mutex
	connectorCached *ConnectorVersions
)

// ioAuthToken cambia la llave de la cuenta por un token de VTEX ID: la API de apps de VTEX IO no acepta la llave en
// headers, sólo un token. Se guarda 20 minutos (el token dura más).
func (c *vtexClient) ioAuthToken() (string, error) {
	ioTokenMu.Lock()
	defer ioTokenMu.Unlock()
	if ioToken != "" && time.Now().Before(ioTokenExpires) {
		return ioToken, nil
	}
	body, _ := json.Marshal(map[string]string{"appkey": c.key, "apptoken": c.token})
	u := "https://" + c.account + ".vtexcommercestable.com.br/api/vtexid/apptoken/login"
	res, err := c.http.Post(u, "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("no se llegó a VTEX ID: %w", err)
	}
	defer res.Body.Close()
	var out struct {
		Token string `json:"token"`
	}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK || json.Unmarshal(raw, &out) != nil || out.Token == "" {
		return "", fmt.Errorf("VTEX ID no dio un token para la llave (%d)", res.StatusCode)
	}
	ioToken, ioTokenExpires = out.Token, time.Now().Add(20*time.Minute)
	return ioToken, nil
}

// splitAppID: "creditop.creditop@5.0.1+build1793901511" → 5.0.1, build1793901511.
func splitAppID(id string) (version, build string) {
	v := strings.TrimPrefix(id, connectorApp+"@")
	if i := strings.Index(v, "+"); i >= 0 {
		return v[:i], v[i+1:]
	}
	return v, ""
}

func (c *vtexClient) connectorIn(workspace, token string) ConnectorVersion {
	out := ConnectorVersion{Workspace: workspace}
	u := "https://infra.io.vtex.com/apps/v0/" + url.PathEscape(c.account) + "/" + url.PathEscape(workspace) + "/apps"
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		out.Error = "no se llegó a VTEX IO"
		return out
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		out.Error = fmt.Sprintf("VTEX IO contestó %d", res.StatusCode)
		return out
	}
	var apps struct {
		Data []struct {
			ID     string `json:"id"`
			Source string `json:"_source"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&apps); err != nil {
		out.Error = "respuesta de VTEX IO ilegible"
		return out
	}
	for _, a := range apps.Data {
		if strings.HasPrefix(a.ID, connectorApp+"@") {
			out.Version, out.Build = splitAppID(a.ID)
			out.Source = a.Source
			return out
		}
	}
	out.Error = "el conector no está en este workspace"
	return out
}

// ReadConnectorVersions lee los dos workspaces; el resultado se guarda un minuto.
func ReadConnectorVersions(target string) (*ConnectorVersions, error) {
	if err := vtexTarget(target); err != nil {
		return nil, err
	}
	connectorMu.Lock()
	defer connectorMu.Unlock()
	if connectorCached != nil && time.Since(connectorCached.ReadAt) < time.Minute {
		return connectorCached, nil
	}
	c, err := newVtexClient()
	if err != nil {
		return nil, err
	}
	token, err := c.ioAuthToken()
	if err != nil {
		return nil, err
	}
	out := &ConnectorVersions{Account: c.account, ReadAt: time.Now()}
	for _, ws := range connectorWorkspaces {
		out.Workspaces = append(out.Workspaces, c.connectorIn(ws, token))
	}
	connectorCached = out
	return out, nil
}
