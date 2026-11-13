package review

// Las respuestas de los agentes, como JSON Schema (claude -p --json-schema): así se leen sin adivinar.

const findingProps = `"title": {"type": "string", "description": "corto, una línea"},
"detail": {"type": "string", "description": "qué se vio, en qué condición falla o confunde y por qué importa"},
"file": {"type": "string", "description": "la ruta en el repo, o vacío"},
"line": {"type": "integer", "description": "la línea, o 0"},
"severity": {"type": "string", "enum": ["alta", "media", "baja"]}`

const schemaFindings = `{"type": "object", "additionalProperties": false, "required": ["findings"], "properties": {
"findings": {"type": "array", "items": {"type": "object", "additionalProperties": false,
  "required": ["title", "detail", "file", "line", "severity"], "properties": {` + findingProps + `}}}}}`

const schemaVerdict = `{"type": "object", "additionalProperties": false, "required": ["verdicts", "extra"], "properties": {
"verdicts": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["n", "verdict", "reason"], "properties": {
  "n": {"type": "integer", "description": "el número del hallazgo en findings.json"},
  "verdict": {"type": "string", "enum": ["confirmado", "plausible", "descartado", "fuera de alcance"]},
  "reason": {"type": "string", "description": "por qué, con archivo:línea"}}}},
"extra": {"type": "array", "items": {"type": "object", "additionalProperties": false,
  "required": ["title", "detail", "file", "line", "severity", "verdict", "reason"], "properties": {` + findingProps + `,
  "verdict": {"type": "string", "enum": ["confirmado", "plausible", "descartado", "fuera de alcance"]},
  "reason": {"type": "string"}}}}}}`

const schemaProve = `{"type": "object", "additionalProperties": false, "required": ["proofs"], "properties": {
"proofs": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["n", "status", "command", "result"], "properties": {
  "n": {"type": "integer", "description": "el número del hallazgo"},
  "status": {"type": "string", "enum": ["comprobado", "refutado", "sin probar"]},
  "command": {"type": "string", "description": "lo que se corrió, para repetirlo (vacío si no se corrió)"},
  "result": {"type": "string", "description": "lo que dio, o por qué no se pudo probar"}}}}}}`
