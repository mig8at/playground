"""Los repos que el árbol indexa y qué cuenta como archivo fuente. FUENTE ÚNICA.

La importan `build-index.py` (que camina el working tree) y `oracle.py` (que le pregunta a git por
una rama). Tenerlo dos veces era una divergencia esperando a pasar: un repo agregado en un solo lado
hace que el oráculo valide contra un universo distinto del que se indexó, y eso no falla — da un
veredicto equivocado.

⚠ `frontend-e2e` no es un repo propio: es un SUBDIRECTORIO de `playground`. `git ls-tree` desde ahí
(sin `--full-name`) devuelve rutas relativas a ese directorio, que es justo el `relpath` que usa el
índice — por eso funciona igual que los otros cinco sin caso especial.
"""
import os

ROOTS = {
    "application": os.path.expanduser("~/Desktop/CREDITOP/github/legacy-application"),
    "frontend-monorepo": os.path.expanduser("~/Desktop/CREDITOP/github/frontend-monorepo"),
    "legacy-backend": os.path.expanduser("~/Desktop/CREDITOP/github/legacy-backend"),
    "pre-approvals-service": os.path.expanduser("~/Desktop/CREDITOP/github/pre-approvals-service"),
    "form-service": os.path.expanduser("~/Desktop/CREDITOP/github/form-service"),
    "frontend-e2e": os.path.expanduser("~/Desktop/CREDITOP/playground/frontend-e2e"),
}

# Solo código. Un `.md`, `.sql` o `.yaml` SIEMPRE dropea: no va en `files[]`, se menciona en el doc.md.
EXTS = {".php", ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"}

EXCLUDE = {"node_modules", "vendor", ".git", ".next", "coverage", ".turbo", ".idea", ".vscode"}
