#!/usr/bin/env python3
"""Genera el snapshot local que alimenta la consola de ramas de context.

No hace fetch ni escribe en los repos. La fuente de repos es `citations.ROOTS`, la misma contra la que se validan las citas;
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

from citations import ROOTS

ROOT = Path(__file__).resolve().parents[1]


def git(repo: str, *args: str) -> tuple[int, str]:
    try:
        result = subprocess.run(
            ["git", "-C", repo, *args], capture_output=True, text=True, timeout=20, check=False
        )
        return result.returncode, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return 1, ""


def ref_exists(repo: str, ref: str) -> bool:
    return git(repo, "rev-parse", "--verify", "--quiet", ref)[0] == 0


def difference(repo: str, left_ref: str, right_ref: str) -> tuple[int, int]:
    """Devuelve (sólo izquierda, sólo derecha) para dos refs."""
    code, out = git(repo, "rev-list", "--left-right", "--count", f"{left_ref}...{right_ref}")
    if code != 0:
        return 0, 0
    try:
        left, right = out.replace("\t", " ").split()
        return int(left), int(right)
    except (ValueError, TypeError):
        return 0, 0


def base_branch(repo: str) -> tuple[str, str]:
    _, symbolic = git(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    candidates = [symbolic.removeprefix("origin/")] if symbolic else []
    candidates += ["main", "master"]
    for name in dict.fromkeys(candidates):
        if ref_exists(repo, f"refs/heads/{name}"):
            return name, name
        if ref_exists(repo, f"refs/remotes/origin/{name}"):
            return name, f"origin/{name}"
    _, current = git(repo, "branch", "--show-current")
    return current or "main", current or "main"


def branch_state(branch: dict, base: str) -> str:
    if branch["actual"] and branch["cambios"]:
        return "con-cambios"
    if branch["nombre"] != base and branch["fusionada"]:
        return "fusionada"
    if branch["remoto"] and not branch["remotoExiste"]:
        return "remoto-ausente"
    if branch["nombre"] == base:
        if branch["adelanteRemoto"] and branch["atrasRemoto"]:
            return "divergida"
        if branch["adelanteRemoto"]:
            return "adelantada"
        if branch["atrasRemoto"]:
            return "atrasada"
        return "al-dia"
    if branch["adelanteMain"] and branch["atrasMain"]:
        return "divergida"
    if branch["adelanteMain"]:
        return "activa"
    if branch["atrasMain"]:
        return "sin-cambios"
    return "al-dia"


def measure_repo(repo: str, aliases: list[str]) -> dict:
    _, current = git(repo, "branch", "--show-current")
    base, base_ref = base_branch(repo)
    changes = len(git(repo, "status", "--porcelain")[1].splitlines())
    log_format = "%00".join(
        [
            "%(refname:short)", "%(upstream:short)", "%(committerdate:short)",
            "%(authorname)", "%(objectname:short)", "%(subject)",
        ]
    )
    _, refs = git(repo, "for-each-ref", f"--format={log_format}", "refs/heads")
    branches = []
    for line in refs.splitlines():
        parts = line.split("\0")
        if len(parts) != 6:
            continue
        name, remote, date, author, sha, subject = parts
        behind_main, ahead_main = difference(repo, base_ref, name)
        remote_exists = bool(remote) and ref_exists(repo, remote)
        behind_remote, ahead_remote = difference(repo, remote, name) if remote_exists else (0, 0)
        merged = name != base and git(repo, "merge-base", "--is-ancestor", name, base_ref)[0] == 0
        branch = {
            "nombre": name,
            "actual": name == current,
            "cambios": changes if name == current else 0,
            "fusionada": merged,
            "adelanteMain": ahead_main,
            "atrasMain": behind_main,
            "remoto": remote,
            "remotoExiste": remote_exists,
            "adelanteRemoto": ahead_remote,
            "atrasRemoto": behind_remote,
            "ultimoCambio": date,
            "autor": author,
            "sha": sha,
            "asunto": subject,
        }
        branch["estado"] = branch_state(branch, base)
        branches.append(branch)
    branches.sort(key=lambda r: (not r["actual"], r["fusionada"], r["nombre"] == base, r["nombre"]))
    active = sum(1 for r in branches if r["nombre"] != base and not r["fusionada"])
    return {
        "id": os.path.basename(repo),
        "nombre": os.path.basename(repo),
        "aliases": sorted(aliases),
        "ramaBase": base,
        "ramaActual": current,
        "cambios": changes,
        "resumen": {"ramas": len(branches), "activas": active, "fusionadas": sum(r["fusionada"] for r in branches)},
        "ramas": branches,
    }


def build_snapshot(roots: dict[str, str] | None = None, generated: str | None = None) -> dict:
    roots = roots or ROOTS
    checkouts: dict[str, list[str]] = {}
    for alias, path in roots.items():
        code, top = git(path, "rev-parse", "--show-toplevel")
        if code == 0 and top:
            checkouts.setdefault(top, []).append(alias)
    repos = [measure_repo(repo, aliases) for repo, aliases in sorted(checkouts.items(), key=lambda x: os.path.basename(x[0]))]
    return {
        "schemaVersion": "tablero.repos.v1",
        "generado": generated or dt.datetime.now().astimezone().isoformat(timespec="seconds"),
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
    snapshot = build_snapshot()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = snapshot["resumen"]
    print(f"  {summary['repos']} repos · {summary['ramas']} ramas · {summary['activas']} activas · {summary['conCambios']} con cambios")
    print(f"  snapshot → {output}")
    if args.json:
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
