#!/usr/bin/env python3
"""EL MAPA DE LO QUEMADO: dónde el código decide por identidad y no por configuración.

POR QUÉ ESTE MAPA EXISTE. El modelo de datos dice qué se GUARDA; éste dice por qué el mismo flujo se
comporta distinto para dos clientes. Cuando una conducta depende de un `id` escrito en un `if`, no
hay tabla que consultar ni pantalla de admin que la muestre: hay que leer el código. Eso es lo que
hace que CreditOp no sea predecible, y por eso el mapa no es una lista de «code smells» sino un
inventario de **decisiones invisibles desde afuera**.

⚠ LA REGLA QUE HACE QUE NO MIENTA: se indexa por (COLUMNA, id), nunca por el id solo. En esta base el
mismo número es cosas distintas según dónde se lea — medido en prod el 2026-08-17:

    24  como lender  → Credifamilia          24  como allied → Creditop
    154 como lender  → TuboletaTeCree        154 como allied → Mediarte Monteria

Un mapa que dijera «24 = Credifamilia» y se topara con `allied_id==24` estaría nombrando mal la
empresa entera. `creditop.json` ya avisaba de este choque para el 94; acá es estructural.

QUÉ ES DERIVADO Y QUÉ NO. El barrido corre `git grep` contra `main` cada vez: no hay lista guardada
de coincidencias que pueda quedar vieja. Lo único guardado es el DICCIONARIO de nombres
(`creditop.json`), porque un id no se puede traducir leyendo código.

⚠ Y UN CERO ACÁ NO ES «no hay»: es «mi patrón no lo vio». Los patrones son de PHP y TS escritos como
los escribe este equipo; una forma nueva de quemar un id no aparece hasta que alguien la agrega.
"""
from __future__ import annotations

import collections
import json
import pathlib
import re
import subprocess

AQUI = pathlib.Path(__file__).parent
GITHUB = pathlib.Path("~/Desktop/CREDITOP/github").expanduser()

# (categoría, repos, globs, patrón). El patrón lo consume `git grep -E` contra `main`.
PATRONES = [
    ("despacho", ["legacy-backend", "legacy-application"], ["*.php"],
     r"""['"][a-zA-Z_.]+_['"]\s*\.\s*\$[a-zA-Z_>()-]*([iI]d)""",
     "el nombre del archivo o vista se ARMA con un id, y si no existe hay fallback mudo"),
    ("id_quemado", ["legacy-backend", "legacy-application"], ["*.php"],
     r"(lender_id|allied_id|allied_branch_id|merchant_id|lender->id|allied->id)\s*(===?|!==?|<>)\s*[0-9]+",
     "una conducta atada a UNA entidad concreta, dentro de un if"),
    # ⚠ DOS lecciones acá, las dos aprendidas fallando el 2026-08-17.
    #
    # 1) `git grep -E` es ERE de POSIX y **`\s` no es un espacio**: los patrones que lo usan matchean
    #    por casualidad o no matchean, y no avisan. Va `[[:space:]]`, o un ` +` literal.
    # 2) La primera versión sólo miraba `in_array`/`whereIn` con DOS números, y se perdía la forma más
    #    común de todas: la CONSTANTE de clase. En legacy-backend hay 19, incluida
    #    `MANUAL_BIRTH_LENDER_IDS = [39, 23, 141, 142, 166]` y `SOCKET_CONFIRMATION_LENDERS = [39]`,
    #    esta última con el comentario «para sumar un lender agregá su id aquí (requiere deploy)»
    #    escrito al lado. Una lista de UNO es el caso más quemado, no el menos.
    ("lista_ids", ["legacy-backend", "legacy-application"], ["*.php"],
     r"(in_array|whereIn)[[:space:]]*\([^)]*[\[(][[:space:]]*[0-9]+[[:space:]]*,[[:space:]]*[0-9]+"
     r"|const +[A-Z][A-Z0-9_]* *= *\[ *[0-9]",
     "un conjunto de entidades escrito a mano, que nadie mantiene al agregar una"),
    ("ambiente", ["legacy-backend", "legacy-application"], ["*.php"],
     r"app\(\)->environment\(|config\('app\.env'\)",
     "el código cambia según el ambiente ⚠ y staging corre con APP_ENV=development"),
    ("id_quemado", ["frontend-monorepo"], ["*.ts", "*.tsx"],
     r"(lenderId|alliedId|merchantId|branchId)\s*(===?|!==?)\s*[0-9]+",
     "lo mismo, del lado del front"),
]

# De qué columna habla cada número. Se capturan PARES (columna, id) EN UNA SOLA PASADA, y no una
# columna por un lado y un número por el otro: la línea real
#     if($userRequest->allied_id==24 && $userRequest->allied_branch_id!=17 && ...)
# tiene DOS comparaciones, y aparear «la primera columna que aparezca» con «el primer número que
# aparezca» daba `allied_branch 24` — una sucursal que no existe, con el id del comercio. El orden de
# la alternancia también importa: `allied_branch_id` va ANTES que `allied_id`, que es prefijo suyo.
PAR = re.compile(
    r"(allied_branch_id|branchId|allied_id|allied->id|alliedId|lender_id|lender->id|lenderId"
    r"|user_profile_id|user_request_status_id|response_type)"
    r"\s*(?:===?|!==?|<>)\s*([0-9]+)", re.I)
CAJA = {"allied_branch_id": "allied_branch", "branchid": "allied_branch",
        "allied_id": "allied", "allied->id": "allied", "alliedid": "allied",
        "lender_id": "lender", "lender->id": "lender", "lenderid": "lender",
        "user_profile_id": "user_profile", "user_request_status_id": "estado",
        "response_type": "response_type"}


def pares(texto: str) -> list[tuple[str, str]]:
    return [(CAJA[c.lower()], i) for c, i in PAR.findall(texto)]


def diccionario() -> dict:
    d = json.loads((AQUI / "creditop.json").read_text(encoding="utf-8"))
    return {k: {i: v for i, v in d.get(k, {}).items() if not i.startswith("_")}
            for k in ("lenders", "allieds", "allied_branches", "estados", "response_type")}


def _nombre(dic: dict, columna: str, ident: str) -> str | None:
    caja = {"lender": "lenders", "allied": "allieds", "estado": "estados",
            "allied_branch": "allied_branches", "response_type": "response_type"}.get(columna)
    v = dic.get(caja, {}).get(ident) if caja else None
    if isinstance(v, dict):
        return v.get("nombre") or v.get("n") or json.dumps(v, ensure_ascii=False)[:60]
    return v


# Sobre QUÉ es una lista quemada. Sin esto el conteo miente: `whereIn('user_request_status_id',
# [10,12])` y `in_array($alliedId, [209,210,211])` matchean el mismo patrón y no son lo mismo — el
# primero es una máquina de estados escrita en SQL (normal), el segundo es tres comercios concretos
# con conducta propia (lo que hace que CreditOp no sea predecible). Contarlos juntos dio 181 y
# escondió que sólo una parte es lo que se está buscando.
SOBRE = [
    (re.compile(r"allied|lender|merchant|branch|partner", re.I), "entidad"),
    (re.compile(r"status|estado|response_type|risk_central|profile|field", re.I), "estado/enum"),
]


def _sobre(texto: str) -> str:
    for rx, n in SOBRE:
        if rx.search(texto):
            return n
    return "otro"


def barrer() -> list[dict]:
    dic = diccionario()
    out = []
    for cat, repos, globs, patron, _ in PATRONES:
        for repo in repos:
            ruta = GITHUB / repo
            if not ruta.is_dir():
                continue
            cmd = ["git", "-C", str(ruta), "grep", "-nIE", patron, "main", "--", *globs]
            r = subprocess.run(cmd, capture_output=True, text=True)
            # ⚠ git grep sale 1 cuando NO hay coincidencias: es normal, no un fallo. Pero un 2 SÍ es
            # un error (patrón inválido, rama ausente) y callarlo daría un mapa vacío que se lee
            # igual que «acá no hay nada quemado».
            if r.returncode > 1:
                out.append({"categoria": cat, "repo": repo, "error": r.stderr.strip()[:160]})
                continue
            for linea in r.stdout.splitlines():
                try:
                    _, resto = linea.split(":", 1)
                    arch, nlin, texto = resto.split(":", 2)
                except ValueError:
                    continue
                base = {"categoria": cat, "repo": repo, "archivo": arch,
                        "linea": int(nlin), "texto": texto.strip()[:150],
                        "sobre": _sobre(texto) if cat == "lista_ids" else None}
                ps = pares(texto)
                if not ps:
                    out.append({**base, "columna": None, "id": None, "quien": None})
                    continue
                # una línea con dos ids quemados son DOS decisiones, y se cuentan como dos
                for col, ident in ps:
                    out.append({**base, "columna": col, "id": ident,
                                "quien": _nombre(dic, col, ident)})
    return out


def plantillas_por_entidad() -> dict[str, list[str]]:
    """Los archivos BAUTIZADOS con un id. Es la otra mitad del `despacho`: el patrón dice que se
    arma el nombre, esto dice para quiénes existe — y por lo tanto quiénes caen al genérico."""
    out = collections.defaultdict(list)
    for repo in ("legacy-backend", "legacy-application"):
        ruta = GITHUB / repo
        if not ruta.is_dir():
            continue
        r = subprocess.run(["git", "-C", str(ruta), "ls-tree", "-r", "--name-only", "main"],
                           capture_output=True, text=True)
        for f in r.stdout.splitlines():
            m = re.search(r"_(\d{2,4})\.(?:blade\.)?php$", f)
            if m:
                out[m.group(1)].append(f"{repo}/{f}")
    return dict(out)
