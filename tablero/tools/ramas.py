#!/usr/bin/env python3
"""Genera el snapshot local que alimenta la consola de ramas de context.

No hace fetch ni escribe en los repos. La fuente de repos es `citas.ROOTS`, la misma contra la que se validan las citas;
los aliases que comparten un checkout (harness y trazador) se agrupan en un solo repositorio.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from citas import ROOTS

ROOT = Path(__file__).resolve().parents[1]


def git(repo: str, *args: str) -> tuple[int, str]:
    try:
        result = subprocess.run(
            ["git", "-C", repo, *args], capture_output=True, text=True, timeout=20, check=False
        )
        return result.returncode, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return 1, ""


def existe_ref(repo: str, ref: str) -> bool:
    return git(repo, "rev-parse", "--verify", "--quiet", ref)[0] == 0


def diferencia(repo: str, izquierda: str, derecha: str) -> tuple[int, int]:
    """Devuelve (sólo izquierda, sólo derecha) para dos refs."""
    code, out = git(repo, "rev-list", "--left-right", "--count", f"{izquierda}...{derecha}")
    if code != 0:
        return 0, 0
    try:
        left, right = out.replace("\t", " ").split()
        return int(left), int(right)
    except (ValueError, TypeError):
        return 0, 0


def rama_base(repo: str) -> tuple[str, str]:
    _, simbolica = git(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    candidatos = [simbolica.removeprefix("origin/")] if simbolica else []
    candidatos += ["main", "master"]
    for nombre in dict.fromkeys(candidatos):
        if existe_ref(repo, f"refs/heads/{nombre}"):
            return nombre, nombre
        if existe_ref(repo, f"refs/remotes/origin/{nombre}"):
            return nombre, f"origin/{nombre}"
    _, actual = git(repo, "branch", "--show-current")
    return actual or "main", actual or "main"


def estado_rama(rama: dict, base: str) -> str:
    if rama["actual"] and rama["cambios"]:
        return "con-cambios"
    if rama["nombre"] != base and rama["fusionada"]:
        return "fusionada"
    if rama["remoto"] and not rama["remotoExiste"]:
        return "remoto-ausente"
    if rama["nombre"] == base:
        if rama["adelanteRemoto"] and rama["atrasRemoto"]:
            return "divergida"
        if rama["adelanteRemoto"]:
            return "adelantada"
        if rama["atrasRemoto"]:
            return "atrasada"
        return "al-dia"
    if rama["adelanteMain"] and rama["atrasMain"]:
        return "divergida"
    if rama["adelanteMain"]:
        return "activa"
    if rama["atrasMain"]:
        return "sin-cambios"
    return "al-dia"


def medir_repo(repo: str, aliases: list[str]) -> dict:
    _, actual = git(repo, "branch", "--show-current")
    base, base_ref = rama_base(repo)
    cambios = len(git(repo, "status", "--porcelain")[1].splitlines())
    formato = "%00".join(
        [
            "%(refname:short)", "%(upstream:short)", "%(committerdate:short)",
            "%(authorname)", "%(objectname:short)", "%(subject)",
        ]
    )
    _, refs = git(repo, "for-each-ref", f"--format={formato}", "refs/heads")
    ramas = []
    for linea in refs.splitlines():
        partes = linea.split("\0")
        if len(partes) != 6:
            continue
        nombre, remoto, fecha, autor, sha, asunto = partes
        atras_main, adelante_main = diferencia(repo, base_ref, nombre)
        remoto_existe = bool(remoto) and existe_ref(repo, remoto)
        atras_remoto, adelante_remoto = diferencia(repo, remoto, nombre) if remoto_existe else (0, 0)
        fusionada = nombre != base and git(repo, "merge-base", "--is-ancestor", nombre, base_ref)[0] == 0
        rama = {
            "nombre": nombre,
            "actual": nombre == actual,
            "cambios": cambios if nombre == actual else 0,
            "fusionada": fusionada,
            "adelanteMain": adelante_main,
            "atrasMain": atras_main,
            "remoto": remoto,
            "remotoExiste": remoto_existe,
            "adelanteRemoto": adelante_remoto,
            "atrasRemoto": atras_remoto,
            "ultimoCambio": fecha,
            "autor": autor,
            "sha": sha,
            "asunto": asunto,
        }
        rama["estado"] = estado_rama(rama, base)
        ramas.append(rama)
    ramas.sort(key=lambda r: (not r["actual"], r["fusionada"], r["nombre"] == base, r["nombre"]))
    activas = sum(1 for r in ramas if r["nombre"] != base and not r["fusionada"])
    return {
        "id": os.path.basename(repo),
        "nombre": os.path.basename(repo),
        "aliases": sorted(aliases),
        "ramaBase": base,
        "ramaActual": actual,
        "cambios": cambios,
        "resumen": {"ramas": len(ramas), "activas": activas, "fusionadas": sum(r["fusionada"] for r in ramas)},
        "ramas": ramas,
    }


def construir_snapshot(roots: dict[str, str] | None = None, generado: str | None = None) -> dict:
    roots = roots or ROOTS
    checkouts: dict[str, list[str]] = {}
    for alias, ruta in roots.items():
        code, top = git(ruta, "rev-parse", "--show-toplevel")
        if code == 0 and top:
            checkouts.setdefault(top, []).append(alias)
    repos = [medir_repo(repo, aliases) for repo, aliases in sorted(checkouts.items(), key=lambda x: os.path.basename(x[0]))]
    return {
        "schemaVersion": "tablero.repos.v1",
        "generado": generado or dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "fuente": "git local; no hace fetch",
        "repos": repos,
        "resumen": {
            "repos": len(repos),
            "ramas": sum(r["resumen"]["ramas"] for r in repos),
            "activas": sum(r["resumen"]["activas"] for r in repos),
            "conCambios": sum(bool(r["cambios"]) for r in repos),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Mide las ramas locales de los repos que indexa context")
    parser.add_argument("--json", action="store_true", help="imprime también el snapshot")
    parser.add_argument("--output", default=str(ROOT / "data" / "cache" / "repos.json"),
                        help="archivo de salida")
    args = parser.parse_args()
    snapshot = construir_snapshot()
    salida = Path(args.output)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    resumen = snapshot["resumen"]
    print(f"  {resumen['repos']} repos · {resumen['ramas']} ramas · {resumen['activas']} activas · {resumen['conCambios']} con cambios")
    print(f"  snapshot → {salida}")
    if args.json:
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
