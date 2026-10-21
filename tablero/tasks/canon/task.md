---
id: 74
title: "Canon"
clase: proyecto
stage: work
created: "2026-09-07T08:30:00-05:00"
canon: []
jira: []
jira_title: ""
ramas: feat/canon-clones-encendido, feat/canon-corrector-busca-en-todos, feat/canon-sonda-clone
---

## Frentes activos

- **Corpus vigente:** mantener sincronía con `main` y separar conocimiento actual de antecedentes.
- **Preguntas sin respuesta:** distinguir huecos de conocimiento de consultas que requieren datos,
  permisos o una herramienta distinta.
- **Bucle de agentes:** medir cada mejora con casos reales y conservar recuperación cuando un agente
  o una fuente no alcance.

## Pendientes

- [ ] Elegir la siguiente pregunta real de la cola y clasificar su causa antes de escribir contexto.
- [ ] Verificar cualquier cambio del corpus contra `main` y los documentos de negocio vigentes.
- [ ] Mantener un solo estado vigente arriba; los hechos del día van al Registro.
- [ ] Escribir los seis huecos del corpus que dejaron preguntas sin contestar (sus turnos se borraron de la cola; el código de `main` alcanza para cada uno). Termina cuando `make canon-search` devuelve una sección que contesta cada pregunta:
  - [ ] **Celucambio:** cómo es su flujo (sucursales, entidades, si fuerza CreditopX).
  - [ ] **Preaprobados:** qué es uno, dónde persiste el resultado por entidad, cómo se reconoce un cliente preaprobado con un comercio, y en qué pantalla los ve el asesor o el cliente.
  - [ ] **Roles para bloquear y desbloquear equipos:** qué perfil o permiso del admin lo habilita, incluido si la vista del crédito esconde los botones por rol.
  - [ ] **Pago retenido:** cuántas cuotas retiene, qué pasa con los abonos adicionales y qué separa la rama de pago mínimo de la de retención.
  - [ ] **Acuerdo de pago con un cliente en mora:** si existe ese flujo (o es refinanciación u otro), qué condiciones pide y por qué el admin no deja gestionarlo.
  - [ ] **Asignar o aplicar un pago a una entidad:** qué significa en el admin y qué lo bloquea para una entidad de un comercio.
