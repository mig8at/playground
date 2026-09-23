# Plantilla de tarea de Jira (orientada a evaluación / QA)

Estándar para redactar la descripción de una tarea de Jira de forma que **el que la
prueba** (ej. Duncan) tenga contexto suficiente para validar **en ambiente de pruebas**:
nivel de negocio/funcional, **no** a nivel de código, enfocada en **cómo y dónde validar**.

> **Se escribe en Markdown.** La API v3 de Jira no acepta Markdown ni HTML: guarda ADF
> (Atlassian Document Format). El tablero renderiza este subconjunto de Markdown a ADF
> (`internal/atlassian/jira.go` → `mdToADF`): `## encabezados`, `**negrita**`, `- viñetas`,
> `- [ ] checklist` (checkboxes reales), `1.` numeradas y `[texto](url)` / URLs → links.

> **Guard:** esto va a Jira. No mencionar repos, rutas de archivo, el playground ni
> hallazgos internos (F-xx). Lenguaje de negocio.

## Esqueleto (copiar y completar)

```markdown
## En una línea
<qué cambia, en una frase, desde la mirada del negocio/usuario>

## Por qué
<el problema o la razón de negocio>

## Qué cambia
<descripción funcional de lo nuevo; sin código>

## Alcance
- <dónde aplica / qué entra>
- <qué NO cambia (regresión)>
- <fallbacks y límites: ej. si algo falla, el flujo no se bloquea>

## Dónde probar
- Ambiente · comercio/entidad/producto · pantalla/documento/flujo.
- **Precondición:** datos o usuario de prueba, y accesos que necesita el evaluador.

## Cómo validar
1. Camino feliz — precondición → acción → resultado esperado.
2. Caso alterno/negativo — …
3. Fallback/borde (si aplica) — …

## Criterios de aceptación
- [ ] …
- [ ] …

## Dependencias / contraparte
<backend u otros equipos, estado de integración, config previa (flags, comercio habilitado)>
```

## Guía rápida por sección

- **En una línea / Por qué / Qué cambia** — contexto, corto. Que el evaluador entienda *qué* y *para qué* sin leer código.
- **Alcance** — límites y regresión: qué NO debe cambiar, y los fallbacks (nunca romper el onboarding, etc.).
- **Dónde probar** — el *setup* antes de los pasos: ambiente, comercio, y los datos/usuario/accesos que hacen falta. Es lo primero que necesita el QA.
- **Cómo validar** — en **escenarios** con resultado esperado (feliz + negativo + borde), no en un párrafo.
- **Criterios de aceptación** — checklist tildable (`- [ ]`) para firmar la evaluación.
- **Dependencias / contraparte** — quién más está involucrado, qué config previa, y **qué accesos necesita el evaluador**.

> No todas las secciones son obligatorias en tareas chicas; el esqueleto es la guía máxima.

## Ejemplo (CORE-309)

```markdown
## En una línea
En el flujo de OnVacation, el documento de términos y condiciones ahora lleva el check
**"Acepta política de Tratamiento de Datos Personales"**, que debe quedar marcado al firmar.

## Por qué
Cambiaron los T&C de OnVacation e incorporaron la aceptación de la política de tratamiento de
datos personales (habeas data). El documento firmado debe dejar constancia del consentimiento.

## Qué cambia
El documento de T&C de OnVacation suma el check **"Acepta política de Tratamiento de Datos
Personales"**. Al firmar, el check llega marcado (indica que el cliente aceptó).

## Alcance
- Aplica al documento de T&C dentro del flujo de OnVacation.
- No cambia los T&C de otros comercios ni el resto del contenido del documento.

## Dónde probar
- Ambiente de pruebas, dentro del flujo de OnVacation (el T&C se genera en algún punto del flujo).
- **Precondición:** acceso para ver los documentos firmados de OnVacation.

## Cómo validar
1. Recorrer el flujo de OnVacation hasta firmar el documento de T&C.
2. En el documento firmado, verificar que el check "Acepta política de Tratamiento de Datos
   Personales" llega marcado/activo.

## Criterios de aceptación
- [ ] El documento de T&C de OnVacation incluye el check.
- [ ] Al firmar, el check llega marcado en el documento firmado.
- [ ] El resto del documento no cambió.

## Dependencias / contraparte
El campo está definido en el catálogo global (ya en pruebas). Duncan necesita acceso a los
documentos firmados de OnVacation para poder validar.
```
