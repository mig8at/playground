package store

import (
	"fmt"

	"creditop/tablero/server/internal/taskcontext"
)

// TaskContext devuelve el historial estructurado de un esfuerzo. A diferencia de entries/, estos
// eventos no son tiempo ni se publican en Jira: son el mínimo de decisiones y pruebas que permite
// retomar sin reabrir toda la investigación.
func (s *Store) TaskContext(effortID int64) ([]taskcontext.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if slug, ok := s.slugs[effortID]; ok {
		return taskcontext.Read(s.dir, slug)
	}
	return nil, fmt.Errorf("no existe el esfuerzo %d", effortID)
}
