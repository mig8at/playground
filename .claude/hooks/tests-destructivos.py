#!/usr/bin/env python3
"""PreToolUse · frena los comandos que pueden recrear una base de datos desde `legacy-backend`.

EL 2026-08-19 LA BASE COMPARTIDA DE DEV+STAGING QUEDÓ VACÍA. `phpunit.xml` fija `DB_DATABASE=testing`
pero nunca fijó `DB_HOST`, así que los tests se conectan al servidor que diga el `.env` — y las
credenciales que circulan son las del usuario maestro del RDS. Dos tests usaban `RefreshDatabase`
(`migrate:fresh`: borra todas las tablas). La guarda de CORE-431 ya contiene la suite a los hosts de
esta máquina, pero `make fresh` no pasa por ella, y correr una carpeta con el trait recrea TU base
local sin avisar. La regla completa: CLAUDE.md §«La suite de PHPUnit de legacy-backend NO se corre entera».

Esa regla era texto. Esto la vuelve un `PreToolUse` sobre Bash, que corre ANTES y de verdad impide:

  1. `artisan test` / `phpunit` / `pest` SIN ruta                      → siempre (corre los 140 archivos)
  2. `migrate:fresh` · `migrate:refresh` · `db:wipe` · `make fresh`     → siempre
  3. `make test` desde legacy-backend                                  → siempre (es `artisan test` pelado)
  4. `artisan test <ruta>` cuya ruta arrastra `RefreshDatabase`        → salvo que el comando lleve
     (el trait en la clase, `uses(RefreshDatabase::class)` por archivo,   I_KNOW_THIS_RECREATES_MY_LOCAL_DB=1
     o un `Pest.php` que lo ata al directorio)

SÓLO CUENTA LO QUE ESTÁ EN POSICIÓN DE COMANDO. La primera versión miraba el texto entero y frenó un
`git commit` cuya descripción decía «make test»: un comando que NOMBRA la palabra no la ejecuta. Por
eso el comando se parte en segmentos (`&&`, `||`, `;`, `|`, salto de línea), se descartan los cuerpos
de heredoc, y de cada segmento se mira el ejecutable y sus argumentos.

Sólo mira comandos que hablen de legacy-backend (por el cwd o por la ruta en el comando): un
`make test` en otro repo no es asunto de este hook. Exit 2 = bloquea y el motivo vuelve al modelo.
Cualquier error interno sale 0: un hook roto no puede impedir trabajar.
"""
import json
import pathlib
import re
import shlex
import sys

LB = "legacy-backend"
DEFAULT_LB = pathlib.Path.home() / "Desktop" / "CREDITOP" / "github" / LB

RE_HEREDOC = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n.*?\n\1\s*$", re.S | re.M)
RE_SEGMENTO = re.compile(r"&&|\|\||;|\||\n")
RE_ENV = re.compile(r"^(?:\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*")
PREFIJOS = {"sudo", "time", "nohup", "env", "exec"}
EJECUTABLES_ARTISAN = {"php", "sail", "docker", "docker-compose", "artisan"}
RE_ARTISAN = re.compile(r"artisan\s+(?P<sub>test|migrate:fresh|migrate:refresh|db:wipe)\b(?P<resto>.*)$")
RE_RUNNER = re.compile(r"(?P<sub>phpunit|pest)\b(?P<resto>.*)$")
RE_TRAIT = re.compile(r"^\s*use RefreshDatabase;|uses\(.*RefreshDatabase::class", re.M)
OVERRIDE = "I_KNOW_THIS_RECREATES_MY_LOCAL_DB=1"


def es_parseable(texto: str) -> bool:
    try:
        shlex.split(texto, posix=True)
        return True
    except ValueError:
        return False


def tokens(texto: str) -> list[str]:
    return shlex.split(texto, posix=True) if es_parseable(texto) else texto.split()


def habla_de_lb(cmd: str, cwd: str) -> bool:
    return LB in cmd or LB in (cwd or "")


def raiz_lb(cmd: str, cwd: str) -> pathlib.Path:
    for tok in tokens(cmd):
        if LB in tok:
            partes = pathlib.Path(tok.strip("'\"")).parts
            if LB in partes:
                return pathlib.Path(*partes[: partes.index(LB) + 1])
    if cwd and LB in cwd:
        partes = pathlib.Path(cwd).parts
        return pathlib.Path(*partes[: partes.index(LB) + 1])
    return DEFAULT_LB


def segmentos(cmd: str) -> list[str]:
    sin_heredoc = RE_HEREDOC.sub("", cmd)
    return [s.strip() for s in RE_SEGMENTO.split(sin_heredoc) if s.strip()]


def ejecutable_y_resto(seg: str) -> tuple[str, str]:
    """El nombre corto del programa que corre en este segmento, y el resto de la línea."""
    seg = RE_ENV.sub("", seg, count=1).strip()
    toks = tokens(seg)
    while toks and pathlib.Path(toks[0]).name in PREFIJOS:
        toks = toks[1:]
    if not toks:
        return "", ""
    return pathlib.Path(toks[0]).name, " ".join(toks[1:])


def invocaciones(cmd: str):
    """(tipo, resto) por cada segmento que de verdad EJECUTA algo de la lista."""
    for seg in segmentos(cmd):
        exe, resto = ejecutable_y_resto(seg)
        linea = exe + " " + resto
        if exe == "make":
            sub = resto.split()[0] if resto.split() else ""
            if sub in ("test", "fresh"):
                yield ("make " + sub, "")
            continue
        if exe in EJECUTABLES_ARTISAN or exe.endswith("artisan"):
            m = RE_ARTISAN.search(linea)
            if m:
                yield (m.group("sub"), m.group("resto"))
            continue
        if exe in ("phpunit", "pest"):
            m = RE_RUNNER.search(linea)
            if m:
                yield ("test", m.group("resto"))


def rutas_de(resto: str) -> list[str]:
    """Los argumentos de `artisan test …` que son rutas: lo que no empieza con `-`."""
    return [t for t in tokens(resto) if t and not t.startswith("-")]


def arrastra_trait(ruta: pathlib.Path) -> list[str]:
    """Qué archivos de esa ruta activan RefreshDatabase, en cualquiera de las TRES formas."""
    hallados = []
    archivos = [ruta] if ruta.is_file() else list(ruta.rglob("*.php")) if ruta.is_dir() else []
    for f in archivos:
        try:
            if RE_TRAIT.search(f.read_text(errors="ignore")):
                hallados.append(str(f.relative_to(ruta.parent if ruta.is_file() else ruta)))
        except OSError:
            pass
    # la forma por DIRECTORIO: un Pest.php en la ruta o en sus padres que lo ate con `->in(...)`
    base = ruta if ruta.is_dir() else ruta.parent
    for pest in (base / "Pest.php", base.parent / "Pest.php", base.parent.parent / "Pest.php"):
        try:
            if pest.exists() and "RefreshDatabase" in pest.read_text(errors="ignore"):
                hallados.append(f"{pest} (ata el trait al directorio con uses(...)->in(...))")
        except OSError:
            pass
    return hallados


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    if payload.get("tool_name") not in (None, "Bash"):
        return 0
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    cwd = payload.get("cwd") or ""
    if not cmd or not habla_de_lb(cmd, cwd):
        return 0

    motivos = []
    for tipo, resto in invocaciones(cmd):
        if tipo in ("migrate:fresh", "migrate:refresh", "db:wipe", "make fresh"):
            motivos.append("recrea la base (`migrate:fresh`/`refresh`, `db:wipe` o `make fresh`): apunta a donde diga "
                           "el `.env` + el entorno + `DATABASE_URL`, y así quedó vacía la BD compartida el 2026-08-19. "
                           "No se corre; si creés que hace falta, preguntá.")
            continue
        if tipo == "make test":
            motivos.append("`make test` en legacy-backend es `artisan test` pelado: corre los 140 archivos, incluido el "
                           "que lleva `RefreshDatabase`. Corré SOLO lo que valida la tarea, con ruta explícita.")
            continue
        # tipo == "test": artisan test · phpunit · pest
        rutas = rutas_de(resto)
        if not rutas:
            motivos.append("`artisan test`/`phpunit`/`pest` SIN ruta corre la suite entera. Siempre con ruta: "
                           "`./vendor/bin/sail artisan test <ruta/al/archivo o carpeta>` (y `--filter=` para acotar más).")
            continue
        if OVERRIDE in cmd:
            continue
        raiz = raiz_lb(cmd, cwd)
        for r in rutas:
            p = pathlib.Path(r)
            if not p.is_absolute():
                p = raiz / r
            hallados = arrastra_trait(p)
            if hallados:
                motivos.append(f"la ruta `{r}` arrastra `RefreshDatabase` — recrea TU base local (`migrate:fresh`) "
                               f"antes de correr. Archivos: {', '.join(hallados[:5])}"
                               f"{' …' if len(hallados) > 5 else ''}. Si es lo que querés, agregá "
                               f"{OVERRIDE} al comando.")

    if not motivos:
        return 0
    sys.stderr.write("⛔ Bloqueado por .claude/hooks/tests-destructivos.py (CLAUDE.md §«La suite de PHPUnit de "
                     "legacy-backend NO se corre entera»):\n")
    for mo in motivos:
        sys.stderr.write(f"  ✗ {mo}\n")
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — un hook roto no puede impedir trabajar
        sys.stderr.write(f"(tests-destructivos: error interno, no se bloquea: {e})\n")
        sys.exit(0)
