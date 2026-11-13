---
id: 74
title: "Canon"
nivel: playground
clase: proyecto
stage: work
created: "2026-09-07T08:30:00-05:00"
canon: []
jira: []
jira_title: ""
ramas: feat/canon-clones-encendido, feat/canon-corrector-busca-en-todos, feat/canon-sonda-clone, feat/canon-api-diff
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
- [ ] Confirmar que los guardianes de Credibot leen sólo por canon: `/api/round`, `/api/clones/history`, `/api/file` y `/api/clones/grep`, sin token de GitHub. Termina cuando el PR de Duncan que los cambia está mergeado y una ronda de la fábrica corre sin `CREDIBOT_GITHUB_TOKEN`. Depende de: Duncan — el PR de los guardianes.
- [ ] Confirmar que Credibot llega a canon desde la fábrica por la red interna, sin la puerta de login de la URL pública. Termina cuando una llamada de la fábrica a `/api/clones/history` contesta 200. Depende de: Dani — la red entre la fábrica y canon.
- [ ] Decidir si los clones del servidor dejan de ser `--depth 1` para que `/api/clones/history` salga de git local (sin cupo de la app y con el filtro de ancestros). Termina con la decisión tomada: o se mide el disco y el tiempo de sincronización de un clon completo de los monolitos y se cambia, o se descarta con su motivo.
- [ ] Escribir los seis huecos del corpus que dejaron preguntas sin contestar (sus turnos se borraron de la cola; el código de `main` alcanza para cada uno). Termina cuando `make canon-search` devuelve una sección que contesta cada pregunta:
  - [ ] **Celucambio:** cómo es su flujo (sucursales, entidades, si fuerza CreditopX).
  - [ ] **Preaprobados:** qué es uno, dónde persiste el resultado por entidad, cómo se reconoce un cliente preaprobado con un comercio, y en qué pantalla los ve el asesor o el cliente.
  - [ ] **Roles para bloquear y desbloquear equipos:** qué perfil o permiso del admin lo habilita, incluido si la vista del crédito esconde los botones por rol.
  - [ ] **Pago retenido:** cuántas cuotas retiene, qué pasa con los abonos adicionales y qué separa la rama de pago mínimo de la de retención.
  - [ ] **Acuerdo de pago con un cliente en mora:** si existe ese flujo (o es refinanciación u otro), qué condiciones pide y por qué el admin no deja gestionarlo.
  - [ ] **Asignar o aplicar un pago a una entidad:** qué significa en el admin y qué lo bloquea para una entidad de un comercio.
