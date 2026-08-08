"""Los repos que el árbol indexa y qué cuenta como archivo fuente. FUENTE ÚNICA.

La importan `build-index.py` (que camina el working tree) y `oracle.py` (que le pregunta a git por
una rama). Tenerlo dos veces era una divergencia esperando a pasar: un repo agregado en un solo lado
hace que el oráculo valide contra un universo distinto del que se indexó, y eso no falla — da un
veredicto equivocado.

⚠ `harness` y `trazador` no son repos propios: son SUBDIRECTORIOS de `playground`. `git ls-tree` desde
ahí (sin `--full-name`) devuelve rutas relativas a ese directorio, que es justo el `relpath` que usa el
índice — por eso funcionan igual que los otros cinco sin caso especial.

⚠ **EL CRITERIO PARA AGREGAR UN ROOT es que el servicio esté VIVO EN PRODUCCIÓN**, no que el repo exista
en el disco. Se comprueba preguntándole a Loki qué `service_name` emitió en los últimos 7 días (ver el
nodo `microservicios`, que trae la receta y el censo). Hasta el 2026-08-07 esto indexaba 5 repos mientras
producción corría **14 servicios**: los 9 que faltaban eran invisibles para el árbol, así que ninguna
tarea sobre ellos podía rutear y cualquier cita a sus archivos dropeaba en silencio. Ver **F-123**.

Los `microservices/*` son clones anidados dentro de `~/Desktop/CREDITOP/github/microservices/`; cada uno
tiene su propio `.git`, así que `git ls-tree` funciona igual. El nombre del root es el del SERVICIO —el
mismo que sale en Loki y en el deploy—, no la ruta.
"""
import os

ROOTS = {
    "application": os.path.expanduser("~/Desktop/CREDITOP/github/legacy-application"),
    "frontend-monorepo": os.path.expanduser("~/Desktop/CREDITOP/github/frontend-monorepo"),
    "legacy-backend": os.path.expanduser("~/Desktop/CREDITOP/github/legacy-backend"),
    "pre-approvals-service": os.path.expanduser("~/Desktop/CREDITOP/github/pre-approvals-service"),
    "form-service": os.path.expanduser("~/Desktop/CREDITOP/github/form-service"),
    # Vivos en prod y clonados — agregados el 2026-08-07 (F-123).
    "customer-profiling-service": os.path.expanduser("~/Desktop/CREDITOP/github/customer-profiling-service"),
    "onboarding-forms-service": os.path.expanduser("~/Desktop/CREDITOP/github/onboarding-forms-service"),
    "customer-service": os.path.expanduser("~/Desktop/CREDITOP/github/microservices/customer-service"),
    "financial-health-service": os.path.expanduser("~/Desktop/CREDITOP/github/microservices/financial-health-service"),
    "pdf-mapper-service": os.path.expanduser("~/Desktop/CREDITOP/github/microservices/pdf-mapper-service"),
    # Herramientas propias (subdirectorios de playground, no repos).
    "harness": os.path.expanduser("~/Desktop/CREDITOP/playground/harness"),
    "trazador": os.path.expanduser("~/Desktop/CREDITOP/playground/trazador"),
}

# Solo código. Un `.md`, `.sql` o `.yaml` SIEMPRE dropea: no va en `files[]`, se menciona en el doc.md.
EXTS = {".php", ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"}

EXCLUDE = {"node_modules", "vendor", ".git", ".next", "coverage", ".turbo", ".idea", ".vscode"}
