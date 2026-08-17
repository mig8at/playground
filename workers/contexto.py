"""La CAJA DE HERRAMIENTAS compartida de los workers: los índices y el código real, como funciones.

No es un agente: es lo que los agentes importan. `seleccion.py` toma de acá sus herramientas de
índice; `lector.py`, la lectura de código desde `main`. Las funciones viven UNA vez y acá — copiarlas
en cada agente es la divergencia que no falla en ningún lado, sólo contesta distinto según a quién le
preguntes.

⚠ Todo acá es sólo lectura, y contra `main` — no contra lo que tengas checkeado. Los repos reales
trabajan en ramas y stashes locales, así que leer el working tree daría respuestas sobre código que no
está corriendo.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

PLAYGROUND = Path(__file__).resolve().parents[1]
CONTEXT = PLAYGROUND / "context"
FLOWS = CONTEXT / "server" / "data" / "flows"

# La tabla alias→repo NO se copia acá: se importa de su fuente única. El propio `roots.py` explica por
# qué —tenerla dos veces es una divergencia que no falla, sólo da veredictos equivocados.
sys.path.insert(0, str(CONTEXT / "tools"))
from roots import ROOTS  # noqa: E402
import extraer as _extraer  # noqa: E402  — de acá sale el `h` con el que los agentes responden
import indice as _code_index  # noqa: E402  — el índice por repo, vecino de este archivo

MAX_LINEAS = 260  # tope por lectura: un archivo de 3.000 líneas no entra ni sirve entero


# ── herramientas ─────────────────────────────────────────────────────────────────────────────────
def _resolver(ruta):
    """`alias/relpath` → (root, relpath). Es también el sandbox: fuera de ROOTS no se lee nada."""
    if "/" not in ruta:
        raise ValueError(f"ruta sin alias: '{ruta}'. Va como 'alias/camino', p. ej. 'legacy-backend/app/…'")
    alias, rel = ruta.split("/", 1)
    if alias not in ROOTS:
        raise ValueError(f"alias desconocido '{alias}'. Los válidos son: {', '.join(sorted(ROOTS))}")
    return ROOTS[alias], rel


def mapa_de_rutas():
    """El índice del árbol de contexto: la tabla de síntomas y el «Cuándo:» de cada nodo. Empezá acá."""
    return (CONTEXT / "docs" / "ROUTE-MAP.md").read_text(encoding="utf-8")


def _subramas(alias):
    """Las unidades internas de un repo. Se delega a `indice.py`, que es su implementación
    única: duplicar acá el descubrimiento sería la divergencia que `roots.py` advierte."""
    return _code_index.subramas(alias)


def _con_hash(d):
    """Suma `h` a cada archivo de un resultado del buscador: el agente contesta con hashes, así que
    toda herramienta que le muestre archivos tiene que darle el identificador con el que responder."""
    for a in d.get("archivos", []):
        if "ruta" in a:
            a["h"] = _extraer.hash_de(a["ruta"])
    return d


def indice_de_repos():
    """El OTRO índice: por repo en vez de por pregunta. Qué es cada repositorio, con qué está hecho,
    cuándo nació y los pocos archivos que explican cómo se ensambla. Usalo cuando la pregunta sea de
    ARQUITECTURA («¿cómo está armado el monorepo?», «¿dónde arranca este servicio?») y no de negocio."""
    return json.loads((Path(__file__).resolve().parent / "repos.json").read_text(encoding="utf-8"))


def abrir_nodo(id):
    """El análisis de un nodo (doc.md) más la lista de archivos fuente que cita (map.json)."""
    d = FLOWS / id
    if not d.is_dir():
        disponibles = sorted(p.name for p in FLOWS.iterdir() if p.is_dir())
        return {"error": f"no existe el nodo '{id}'", "nodos": disponibles}
    m = json.loads((d / "map.json").read_text(encoding="utf-8"))
    # Cada archivo va con su tamaño: es lo que permite elegir SIN abrir. Un nodo puede citar un
    # archivo de 163 KB, y saberlo antes evita quemar la ventana en una sola lectura.
    # ⚠ Cada archivo va con su `h`. Sin esto, un agente al que se le pide devolver hashes NUNCA VIO
    # ninguno y devuelve lo único que tiene —la ruta—, que después no resuelve. La instrucción y los
    # datos tienen que coincidir: pedir un campo que las herramientas no entregan es un bug de diseño,
    # no del modelo.
    archivos = []
    for f in m.get("files", []):
        b = _code_index.peso(f)
        e = {"ruta": f, "h": _extraer.hash_de(f)}
        if b:
            e["kb"] = round(b / 1024, 1)
            if b > _code_index.GRANDE:
                e["leer_por_tramos"] = True
        archivos.append(e)
    return {
        "nodo": id,
        "cuando": m.get("when", ""),
        "sintomas": m.get("sintomas", []),
        "verificado": m.get("verified", {}),
        "archivos": archivos,
        "doc": (d / "doc.md").read_text(encoding="utf-8"),
    }


def leer_codigo(ruta, desde=1, hasta=0):
    """Un tramo de un archivo fuente, leído de `main` (no del working tree). `ruta` es 'alias/camino'.
    Devuelve las líneas numeradas, para poder citarlas."""
    root, rel = _resolver(ruta)
    r = subprocess.run(["git", "-C", root, "show", f"main:./{rel}"],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        return {"error": f"no está en main: {ruta}", "detalle": (r.stderr or "").strip()[:200]}
    lineas = r.stdout.splitlines()
    total = len(lineas)
    desde = max(1, int(desde))
    hasta = total if not hasta else min(int(hasta), total)
    if hasta - desde + 1 > MAX_LINEAS:
        hasta = desde + MAX_LINEAS - 1
    tramo = "\n".join(f"{i}: {lineas[i - 1]}" for i in range(desde, hasta + 1))
    r = {"ruta": ruta, "lineas_totales": total, "mostrando": f"{desde}-{hasta}", "codigo": tramo}
    if hasta < total:
        # Decirle cuánto QUEDA evita las dos fallas: pedir el resto de un archivo enorme sin darse
        # cuenta, y creer que lo leyó entero cuando vio el 8%.
        r["quedan_sin_leer"] = total - hasta
        r["aviso"] = (f"viste {hasta}/{total} líneas. Pedí otro tramo sólo si lo que buscabas no "
                      f"estaba acá — no leas el resto 'por las dudas'.")
    return r


def buscar_en_codigo(patron, alias, subruta=""):
    """Dónde aparece un texto dentro de un repo, en `main`. Para ubicar la línea antes de leerla.
    Usalo sólo si el nodo no te llevó directo — y después contá que lo usaste."""
    if alias not in ROOTS:
        return {"error": f"alias desconocido '{alias}'", "validos": sorted(ROOTS)}
    cmd = ["git", "-C", ROOTS[alias], "grep", "-n", "--no-color", "-F", patron, "main"]
    if subruta:
        cmd += ["--", subruta]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if r.returncode not in (0, 1):
        return {"error": (r.stderr or "").strip()[:200]}
    hits = [l.replace("main:", "", 1) for l in r.stdout.splitlines()[:40]]
    return {"patron": patron, "alias": alias, "coincidencias": len(hits), "donde": hits}


def archivos_por_tag(termino, cuantos=40):
    """Los archivos que TOCAN algo concreto, por tag estructural: una tabla, un lender, un comercio,
    un `response_type`, un estado, o los que bifurcan por ambiente.

    Es el complemento exacto de `buscar_archivos`: aquél entiende lo que describís en palabras y
    puntúa por parecido; éste no interpreta nada — responde con hechos del código. «¿qué toca
    `user_requests`?» son 209 archivos y son ESOS, no los que más se le parecen a la frase.
    """
    import archivos as _arch
    r = _arch.buscar(termino)
    lista = r.get("archivos", [])[:max(1, min(int(cuantos or 40), 120))]
    for a in lista:
        a["h"] = _extraer.hash_de(a["p"])
    return {"busque": r.get("busque", termino), "cuantos_hay": r.get("cuantos", 0),
            "devueltos": len(lista), "archivos": lista,
            "sintaxis": "tabla:x · lender:N · allied:N · rt:N · estado:N · gates · o texto libre"}


def gemelos(a="application", b="legacy-backend", filtro="", cuantos=40):
    """Qué archivos existen en LOS DOS repos, y cuáles **divergieron**.

    ⚠ Existe porque a los agentes se les pide explícitamente el ángulo «mirá el gemelo en el otro
    repo» —casi todo CreditOp vive dos veces, `application` (el monolito viejo, la ruta viva por
    defecto) y `legacy-backend` (el nuevo)— y no tenían NINGUNA forma de encontrarlo: adivinaban la
    ruta del otro lado. Pedir un ángulo sin dar la herramienta para recorrerlo es cómo se fabrica una
    respuesta inventada.

    `copiados` son idénticos (si leíste uno, leíste los dos). **`divergieron` es donde está el
    interés**: mismo archivo, distinto contenido — y cuando difieren, ESO suele ser la respuesta.
    """
    g = _extraer.gemelos(a, b)
    f = (filtro or "").lower()
    div = [r for r in g.get("divergieron", []) if not f or f in r.lower()]
    cop = [r for r in g.get("copiados", []) if not f or f in r.lower()]
    n = max(1, min(int(cuantos or 40), 120))
    return {
        "repos": [a, b], "filtro": filtro or "(todo)",
        "resumen": {"copiados_identicos": len(g.get("copiados", [])),
                    "DIVERGIERON": len(g.get("divergieron", []))},
        "divergieron": [{"ruta": r, "h_a": _extraer.hash_de(f"{a}/{r}"),
                         "h_b": _extraer.hash_de(f"{b}/{r}")} for r in div[:n]],
        "copiados": cop[:15],
        "nota": "los que DIVERGIERON son los que importan: mismo archivo, distinto código. "
                "Pedí los dos lados (h_a y h_b) y compará.",
    }


_DEFINE = re.compile(r"\b(class|interface|trait|abstract class|final class|function|def|const|type|enum)\s+$",
                     re.I)


def quien_usa(simbolo, repos=None, cuantos=40):
    """Dónde se usa un símbolo —una clase, un método, una constante— en TODOS los repos a la vez,
    separando **dónde se define** de **dónde se llama**.

    Es la pregunta central al seguir un flujo («¿quién invoca esto?») y hasta acá no se podía hacer:
    `buscar_en_codigo` exige elegir UN repo, así que había que saber de antemano dónde mirar — que es
    justo lo que no se sabe. Y en CreditOp la respuesta suele estar del otro lado: casi todo vive dos
    veces, y un método puede estar vivo en un monolito y muerto en el otro.

    ⚠ Va por `git grep` y no por el índice, medido: para `LenderUserCategoryService` el índice
    encuentra 11 archivos y el grep 22. El índice está acotado por presupuesto de extracción y su
    parseo de imports no cubre todas las formas — sirve para orientarse, no para afirmar «nadie lo
    usa». Una respuesta parcial a «¿quién llama a esto?» es peor que ninguna: se lee como código
    muerto.
    """
    alias = [a for a in (repos or list(ROOTS)) if a in ROOTS]
    # Acepta varios símbolos por la misma razón que `que_hay_en`: tantear nombres es de a tandas —
    # medido, un seleccionador quemó cuatro pasos probando cuatro candidatos de uno en uno.
    simbolos = [simbolo] if isinstance(simbolo, str) else list(simbolo or [])
    simbolos = [x.strip() for x in simbolos if x and len(x.strip()) >= 3][:6]
    if not simbolos:
        return {"error": "pasá al menos un símbolo de 3 caracteres o más"}
    if len(simbolos) > 1:
        return {"buscados": simbolos,
                "resultados": [quien_usa(s, repos, cuantos) for s in simbolos]}
    s = simbolos[0]
    define, usan, fallaron = [], [], []
    for a in alias:
        r = subprocess.run(["git", "-C", ROOTS[a], "grep", "-n", "--no-color", "-F", s, "main"],
                           capture_output=True, text=True, timeout=120)
        if r.returncode not in (0, 1):
            fallaron.append(a)
            continue
        for linea in r.stdout.splitlines():
            sin_ref = linea.replace("main:", "", 1)
            ruta, _, resto = sin_ref.partition(":")
            n, _, texto = resto.partition(":")
            item = {"ruta": f"{a}/{ruta}", "linea": n, "codigo": texto.strip()[:150]}
            # El texto ANTES del símbolo decide si es una declaración: `protected function <s>` sí,
            # `$this-><s>(` no. ⚠ Sin rstrip: la regex pide el espacio separador, y quitarlo antes
            # de buscarlo hacía que nada matchee nunca — `lo_definen` daba 0 siempre.
            antes = texto[:texto.find(s)] if s in texto else ""
            (define if _DEFINE.search(antes) else usan).append(item)
    n = max(1, min(int(cuantos or 40), 120))
    return {
        "simbolo": s, "repos_mirados": alias,
        "resumen": {"lo_definen": len(define), "lo_usan": len(usan)},
        "definido_en": [dict(d, h=_extraer.hash_de(d["ruta"])) for d in define[:12]],
        "usado_en": [dict(u, h=_extraer.hash_de(u["ruta"])) for u in usan[:n]],
        "no_se_pudo_mirar": fallaron,
        "nota": ("⚠ si `lo_definen` es más de 1, el símbolo vive en varios repos: mirá cuál de las "
                 "copias es la que corre. Y un 0 en `lo_usan` sólo prueba que no aparece por texto "
                 "exacto — puede invocarse dinámicamente."),
    }


def codigo_de_log(mensaje, repos=None):
    """De una línea de LOG al CÓDIGO que la emitió.

    La idea que lo motivó: pasar de un log al archivo y de ahí a su contenido e imports. El eslabón
    que faltaba no era el hash —ése ya existe— sino la LLAVE, porque **la línea de log no trae el
    archivo**. Medido en prod el 2026-08-17 sobre una solicitud real: el campo `extra_file` aparece
    en ~5% de las líneas y apunta a `vendor/laravel/framework`, o sea el logger registrando su propia
    línea, no la de quien llamó. Cero rutas de la app.

    Pero el MENSAJE es un literal del código, y por lo tanto resuelve a un archivo. Ésa es la llave.
    Devuelve el `h`, así que enganchado con `que_hay_en(h)` o `pedir_archivo(h)` la cadena queda
    completa: log → archivo → qué toca → el código.

    ⚠ Dos cosas que hay que leer bien en el resultado:
      · Los mensajes suelen llevar valores interpolados («… para entidad 24»), así que se busca el
        PREFIJO estático más largo que matchee. `prefijo_usado` dice con cuánto se resolvió.
      · Casi todo CreditOp vive DOS VECES, así que un mensaje suele aparecer en `application` y en
        `legacy-backend`. No es ambigüedad del método: es el parallel-run. El `service_name` de la
        línea de log dice cuál de los dos corrió.
    """
    if not mensaje or len(mensaje.strip()) < 12:
        return {"error": "pasá un fragmento de mensaje de al menos 12 caracteres"}
    # Si viene una LÍNEA entera se le saca el `message`. ⚠ El JSON puede venir TRUNCADO —las líneas
    # de log se recortan para mostrarlas, y ahí `json.loads` falla—, así que hay un segundo intento
    # por regex. Sin él, pegar una línea copiada de pantalla buscaba el JSON crudo como si fuera el
    # mensaje y no encontraba nada: el fallo silencioso de siempre.
    m = mensaje.strip()
    if '"message"' in m or m.startswith("{"):
        try:
            m = json.loads(m).get("message", m)
        except json.JSONDecodeError:
            g = re.search(r'"message"\s*:\s*"((?:[^"\\]|\\.)*)"', m)
            if g:
                m = g.group(1).encode().decode("unicode_escape", "replace")
    m = " ".join(m.split())
    alias = [a for a in (repos or list(ROOTS)) if a in ROOTS]

    # Se prueba el mensaje entero y después prefijos cada vez más cortos: la parte interpolada está
    # casi siempre al final, así que el prefijo es lo que sobrevive.
    for corte in (len(m), 80, 60, 45, 32, 22, 14):
        p = m[:corte].rstrip(" :.-,")
        if len(p) < 12:
            break
        hits = []
        for a in alias:
            r = subprocess.run(["git", "-C", ROOTS[a], "grep", "-n", "--no-color", "-F", p, "main"],
                               capture_output=True, text=True, timeout=120)
            if r.returncode not in (0, 1):
                continue
            for linea in r.stdout.splitlines()[:40]:
                sin = linea.replace("main:", "", 1)
                ruta, _, resto = sin.partition(":")
                n, _, texto = resto.partition(":")
                full = f"{a}/{ruta}"
                hits.append({"ruta": full, "linea": n, "h": _extraer.hash_de(full),
                             "es_test": "test" in ruta.lower(),
                             "codigo": texto.strip()[:150]})
        if hits:
            reales = [h for h in hits if not h["es_test"]]
            return {
                "busque": p, "prefijo_usado": f"{len(p)}/{len(m)} chars",
                "cuantos": len(hits),
                "candidatos": (reales or hits)[:12],
                "tests": len(hits) - len(reales),
                "nota": ("varios candidatos suele ser el PARALLEL-RUN, no ambigüedad: el mismo mensaje "
                         "vive en `application` y en `legacy-backend`. El `service_name` de la línea de "
                         "log dice cuál corrió. Con el `h` pedí el archivo o preguntá `que_hay_en`."),
            }
    return {"busque": m[:60], "cuantos": 0,
            "nota": "ningún literal matchea. Puede ser un mensaje armado por completo con variables, "
                    "venir de una librería (no del código de CreditOp), o de un repo fuera de ROOTS."}


def que_hay_en(ruta):
    """Qué significan uno o VARIOS archivos EN EL NEGOCIO, sin abrirlos: qué lenders, comercios,
    tablas, estados y `response_type` tocan, qué nodos los describen y si bifurcan por ambiente.

    Sirve para decidir si vale la pena abrirlos: un archivo de 60 KB cuesta ~15.000 tokens y esto
    cuesta veinte.

    ⚠ Acepta una LISTA, y no es un adorno. Medido el 2026-08-16: un seleccionador gastó los pasos 8,
    9, 10, 11 y 12 —los últimos que tenía— llamando a esto una vez por archivo, y se quedó sin
    presupuesto con la respuesta ya en la mano. Una herramienta que se llama cinco veces seguidas
    para cinco cosas del mismo tipo tiene que aceptar las cinco: el paso es el recurso escaso, no el
    dato.
    """
    import archivos as _arch
    rutas = [ruta] if isinstance(ruta, str) else list(ruta or [])
    fuera = []
    for r in rutas[:20]:
        d = _arch.de_ruta(r)
        fuera.append(dict(d, ruta=r, h=_extraer.hash_de(r)) if d else
                     {"ruta": r, "sin_datos": "no está en el índice de tags — puede ser un archivo "
                                              "que no toca vocabulario de negocio, o una ruta mal escrita"})
    return fuera[0] if len(fuera) == 1 else {"cuantos": len(fuera), "archivos": fuera}


HERRAMIENTAS = {
    "mapa_de_rutas": ({
        "name": "mapa_de_rutas",
        "description": "El índice del árbol de contexto: tabla «entrá por el síntoma» y el «Cuándo:» de cada nodo. Empezá SIEMPRE por acá.",
        "parameters": {"type": "object", "properties": {}},
    }, mapa_de_rutas),

    "indice_de_repos": ({
        "name": "indice_de_repos",
        "description": (
            "Índice POR REPO: qué es cada repositorio, con qué stack, cuándo nació y los pocos "
            "archivos que explican cómo se ensambla. Para preguntas de ARQUITECTURA («¿cómo está "
            "armado el monorepo?», «¿por dónde arranca este servicio?»). El mapa_de_rutas es para "
            "preguntas de NEGOCIO; éste, para entender los proyectos."
        ),
        "parameters": {"type": "object", "properties": {}},
    }, indice_de_repos),

    "subramas_del_repo": ({
        "name": "subramas_del_repo",
        "description": (
            "Las unidades con ensamblado propio DENTRO de un repo: los workspaces del monorepo "
            "(apps, packages, modules) o los módulos del backend, con su nombre, sus docs y sus "
            "rutas. Se descubren de main en el momento, no están escritas a mano. Usalo después de "
            "`indice_de_repos` cuando necesites bajar un nivel: «¿qué apps hay?», «¿en qué módulo "
            "vive esto?»."
        ),
        "parameters": {"type": "object", "properties": {
            "alias": {"type": "string", "description": "repo, p. ej. 'frontend-monorepo' o 'legacy-backend'"},
        }, "required": ["alias"]},
    }, lambda alias: _subramas(alias)),

    "mapa_de_negocio_del_repo": ({
        "name": "mapa_de_negocio_del_repo",
        "description": (
            "Qué parte del NEGOCIO vive en cada unidad de un repo: para cada carpeta con ensamblado "
            "propio, qué nodos de contexto la describen. Es el puente entre «dónde está el código» y "
            "«de qué se trata». Usalo cuando sepas el repo y necesites ubicar el área "
            "(«¿dónde está lo de Bancolombia en el monorepo?», «¿qué módulo hace la formalización?»)."
        ),
        "parameters": {"type": "object", "properties": {
            "alias": {"type": "string", "description": "repo, p. ej. 'frontend-monorepo' o 'legacy-backend'"},
        }, "required": ["alias"]},
    }, lambda alias: _code_index.mapa_de_negocio(alias)),

    "buscar_archivos": ({
        "name": "buscar_archivos",
        "description": (
            "Describí en palabras lo que necesitás y te devuelve ARCHIVOS candidatos, con el puntaje "
            "y por qué. No hace falta saber rutas ni qué nodo mirar. Entiende vocabulario de negocio "
            "en español (cupo, entidad, pagaré, perfilamiento) y lo cruza con el código, que está en "
            "inglés. Usalo cuando no sepas por dónde empezar, o para completar lo que un nodo no citó."
        ),
        "parameters": {"type": "object", "properties": {
            "que_necesito": {"type": "string", "description": "en palabras, p. ej. 'dónde se decide el cupo por categoría'"},
        }, "required": ["que_necesito"]},
    }, lambda que_necesito: _con_hash(_code_index.buscar(que_necesito))),

    "archivos_por_tag": ({
        "name": "archivos_por_tag",
        "description": (
            "Los archivos que TOCAN algo concreto, por hecho del código y no por parecido: "
            "`tabla:user_requests` · `lender:24` · `allied:94` · `rt:2` · `estado:11` · `gates` "
            "(los que bifurcan por AMBIENTE). Complementa a `buscar_archivos`: aquél interpreta lo "
            "que describís, éste no interpreta nada. Usalo cuando sepas EXACTAMENTE qué tabla, "
            "entidad o comercio está en juego."
        ),
        "parameters": {"type": "object", "properties": {
            "termino": {"type": "string", "description": "p. ej. 'tabla:user_requests', 'lender:24', 'gates'"},
            "cuantos": {"type": "integer", "description": "máximo a devolver (tope 120, por defecto 40)"},
        }, "required": ["termino"]},
    }, archivos_por_tag),

    "gemelos": ({
        "name": "gemelos",
        "description": (
            "Qué archivos existen en LOS DOS monolitos y cuáles DIVERGIERON. Casi todo CreditOp vive "
            "dos veces: `application` (el viejo, la ruta viva por defecto) y `legacy-backend` (el "
            "nuevo). Es la herramienta del ángulo «mirá el gemelo en el otro repo» — y cuando dos "
            "gemelos difieren, esa diferencia suele SER la respuesta. `filtro` acota por ruta "
            "(ej. 'lenders')."
        ),
        "parameters": {"type": "object", "properties": {
            "a": {"type": "string", "description": "repo A, por defecto 'application'"},
            "b": {"type": "string", "description": "repo B, por defecto 'legacy-backend'"},
            "filtro": {"type": "string", "description": "subcadena de la ruta, para acotar"},
            "cuantos": {"type": "integer", "description": "máximo a devolver (tope 120)"},
        }},
    }, gemelos),

    "quien_usa": ({
        "name": "quien_usa",
        "description": (
            "Dónde se DEFINE y dónde se USA un símbolo (clase, método, constante) en TODOS los repos "
            "a la vez, separando las dos cosas. Es la pregunta de seguir un flujo: «¿quién invoca "
            "esto?». Usala cuando tengas un nombre concreto — `buscar_en_codigo` te obliga a elegir "
            "un repo, y en CreditOp la respuesta suele estar del otro lado. ⚠ Si `lo_definen` es más "
            "de 1, el símbolo vive en varios repos: fijate cuál es el que corre."
        ),
        "parameters": {"type": "object", "properties": {
            "simbolo": {"type": "array", "items": {"type": "string"},
                        "description": "uno o VARIOS nombres exactos (hasta 6) — pedí todos los candidatos de una, no de a uno"},
            "repos": {"type": "array", "items": {"type": "string"},
                      "description": "acotar a estos alias; vacío = los 12"},
            "cuantos": {"type": "integer", "description": "máximo de usos a devolver (tope 120)"},
        }, "required": ["simbolo"]},
    }, quien_usa),

    "codigo_de_log": ({
        "name": "codigo_de_log",
        "description": (
            "De una línea de LOG al CÓDIGO que la emitió. Pasale el mensaje (o la línea entera, "
            "aunque venga truncada) y devuelve archivo:línea con su `h`, para pedir el archivo o "
            "preguntar `que_hay_en`. ⚠ Varios candidatos suele ser el parallel-run —el mismo mensaje "
            "vive en `application` y en `legacy-backend`—: el `service_name` del log dice cuál corrió."
        ),
        "parameters": {"type": "object", "properties": {
            "mensaje": {"type": "string", "description": "el mensaje del log, o la línea cruda"},
            "repos": {"type": "array", "items": {"type": "string"},
                      "description": "acotar a estos alias; vacío = los 12"},
        }, "required": ["mensaje"]},
    }, codigo_de_log),

    "que_hay_en": ({
        "name": "que_hay_en",
        "description": (
            "Qué significa un archivo en el NEGOCIO sin abrirlo: qué lenders, comercios, tablas, "
            "estados y response_type toca, qué nodos lo describen, si bifurca por ambiente. Cuesta "
            "veinte tokens contra los ~15.000 de abrir un archivo grande. Usalo para decidir si vale."
        ),
        "parameters": {"type": "object", "properties": {
            "ruta": {"type": "array", "items": {"type": "string"},
                     "description": "una o VARIAS rutas 'alias/camino' (hasta 20) — pedí todas de una, no de a una"},
        }, "required": ["ruta"]},
    }, que_hay_en),

    "abrir_nodo": ({
        "name": "abrir_nodo",
        "description": "El análisis de un nodo (doc.md) y la lista de archivos fuente que cita. Devuelve además su «cuándo», sus síntomas y cuándo se verificó.",
        "parameters": {"type": "object", "properties": {
            "id": {"type": "string", "description": "id del nodo, p. ej. 'profiling' o 'kyc'"},
        }, "required": ["id"]},
    }, abrir_nodo),

    "leer_codigo": ({
        "name": "leer_codigo",
        "description": f"Un tramo de un archivo fuente leído de main, con las líneas numeradas. Máximo {MAX_LINEAS} líneas por llamada: leé rangos, no archivos enteros.",
        "parameters": {"type": "object", "properties": {
            "ruta": {"type": "string", "description": "'alias/camino' tal cual figura en el map.json del nodo"},
            "desde": {"type": "integer", "description": "primera línea, por defecto 1"},
            "hasta": {"type": "integer", "description": "última línea, 0 = hasta donde entre"},
        }, "required": ["ruta"]},
    }, leer_codigo),

    "buscar_en_codigo": ({
        "name": "buscar_en_codigo",
        "description": "Dónde aparece un texto exacto dentro de un repo, en main. Para ubicar una línea antes de leerla, o cuando el nodo no te llevó directo.",
        "parameters": {"type": "object", "properties": {
            "patron": {"type": "string", "description": "texto exacto a buscar"},
            "alias": {"type": "string", "description": "repo donde buscar, p. ej. 'legacy-backend'"},
            "subruta": {"type": "string", "description": "acotar a una carpeta, opcional"},
        }, "required": ["patron", "alias"]},
    }, buscar_en_codigo),
}
