package store

import (
	"fmt"

	"creditop/playground/tablero/server/internal/taskcontext"
)

// TaskContext devuelve la pila de bloques de un esfuerzo. A diferencia de entries/, un bloque no es
// tiempo ni se publica en Jira: es documentación de la tarea que entra con su fecha.
func (s *Store) TaskContext(effortID int64) ([]taskcontext.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if slug, ok := s.slugs[effortID]; ok {
		return taskcontext.Read(s.dir, slug)
	}
	return nil, fmt.Errorf("no existe el esfuerzo %d", effortID)
}
