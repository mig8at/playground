#!/usr/bin/env python3
"""Barrido de .env: qué clave apunta a dónde, sin exponer el valor.

Muestra KEY = los 3 primeros caracteres del valor. Con 3 caracteres alcanza para
distinguir `loc`alhost de `ine`rtia-dev, y no alcanza para usar un secreto.

Clasifica cada línea por RIESGO, que es lo que se quiere ver de un vistazo:
  CRITICO  una credencial o un host de BD apuntando a infraestructura COMPARTIDA
  OJO      apunta afuera, pero no es una base de datos (APIs, colas, observabilidad)
  local    localhost / 127.0.0.1 / nombres de servicio de Docker
"""
import os, re, sys
from pathlib import Path

RAIZ = Path(sys.argv[1] if len(sys.argv) > 1 else "/Users/miguelochoa/Desktop/CREDITOP/playground")
SALTAR = {"node_modules", "vendor", ".git", "dist", "build", ".next", "playwright-report", "test-results"}

# Un valor es REMOTO si apunta a algo que no es la máquina de uno.
REMOTO = re.compile(r"rds\.amazonaws\.com|inertia-|\.creditop\.com|amazonaws\.com|grafana\.net|"
                    r"posthog\.com|atlassian\.net|redash|slack\.com|googleapis\.com", re.I)
LOCAL  = re.compile(r"^(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|mysql|redis|"
                    r"pg\.localhost|sail|::1)([:/]|$)", re.I)

# Claves que, si apuntan a un host remoto, son las que pueden DESTRUIR.
CLAVE_BD   = re.compile(r"(^|_)(DB|DATABASE|MYSQL|PG|POSTGRES)(_|$)|DATABASE_URL", re.I)
CLAVE_CRED = re.compile(r"PASS|PWD|SECRET|TOKEN|KEY|CREDENTIAL", re.I)
USUARIO_PODEROSO = re.compile(r"^(admin|root|master|sa|postgres)$", re.I)

# La guarda que, por diseño, NO debe vivir en ningún archivo (F-53).
PROHIBIDAS = {"I_KNOW_THIS_TOUCHES_SHARED_DEV"}


def clasificar(clave, valor):
    """Devuelve (riesgo, nota). El riesgo es lo que decide si hay que actuar."""
    if clave in PROHIBIDAS:
        return "CRITICO", "guarda destructiva EN ARCHIVO (debe exportarse a mano — F-53)"
    if not valor:
        return "vacio", ""
    remoto = bool(REMOTO.search(valor))
    local = bool(LOCAL.match(valor))
    es_bd = bool(CLAVE_BD.search(clave))
    if es_bd and remoto:
        return "CRITICO", "base de datos COMPARTIDA"
    if es_bd and USUARIO_PODEROSO.match(valor.strip()):
        return "CRITICO", f"usuario con privilegios totales ({valor.strip()})"
    if es_bd and not local and not remoto and CLAVE_CRED.search(clave):
        return "OJO", "credencial de BD"
    if remoto:
        return "OJO", "servicio externo"
    return "local", ""


def leer(p):
    try:
        return p.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception as e:
        return [f"# <ilegible: {e}>"]


def main():
    archivos = []
    for d, subs, files in os.walk(RAIZ):
        subs[:] = [s for s in subs if s not in SALTAR]
        for f in files:
            if f == ".env" or (f.startswith(".env.") and not f.endswith(".example")):
                archivos.append(Path(d) / f)

    if not archivos:
        print("no se encontró ningún .env")
        return

    resumen = {"CRITICO": 0, "OJO": 0, "local": 0, "vacio": 0}
    print(f"BARRIDO DE .env — raíz: {RAIZ}")
    print(f"{len(archivos)} archivos (se excluyen los .example: son plantillas sin secretos)\n")

    for p in sorted(archivos):
        filas = []
        for linea in leer(p):
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            clave, valor = linea.split("=", 1)
            clave, valor = clave.strip(), valor.strip().strip('"').strip("'")
            riesgo, nota = clasificar(clave, valor)
            resumen[riesgo] += 1
            if riesgo in ("CRITICO", "OJO"):
                filas.append((riesgo, clave, valor[:3], nota))

        rel = p.relative_to(RAIZ.parent)
        if not filas:
            print(f"  ✅ {rel}  — todo local")
            continue
        crit = sum(1 for f in filas if f[0] == "CRITICO")
        print(f"  {'🔴' if crit else '🟡'} {rel}")
        for riesgo, clave, tres, nota in filas:
            icono = "🔴" if riesgo == "CRITICO" else "🟡"
            print(f"       {icono} {clave:34} = {tres!r:8} {nota}")
        print()

    print("─" * 78)
    print(f"  CRITICO {resumen['CRITICO']}   ·   OJO {resumen['OJO']}   ·   "
          f"local {resumen['local']}   ·   vacías {resumen['vacio']}")


if __name__ == "__main__":
    main()
