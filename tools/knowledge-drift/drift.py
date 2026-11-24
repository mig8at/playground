#!/usr/bin/env python3
"""knowledge-drift: poner knowledge/ al día contra main, de lo barato a lo caro.

knowledge/ es la biblioteca LOCAL del día a día. Cada fuente guarda el COMMIT y el blob con que se leyó y qué
secciones respalda, así que el diff sale exacto, sin buscar el blob en la historia. El modelo lee código sólo
donde la prosa probablemente quedó mal.

    paquete     make knowledge-check (con las refs que ya resuelve) → fuentes cambiadas o perdidas → el diff NETO
                de cada archivo (del commit revisado a main) y secciones; y los paquetes del triaje (prompts/triage.md)
    codigo      con el triaje hecho: paquetes de código (diff bajo demanda) y de segunda mirada a ciegas
    final       junta código, segunda mirada y overrides.json
    aplicar     escribe rules.md y sources.json: el texto nuevo de cada sección, el título si cambió (y su ancla en
                las fuentes), y commit + blob al día de cada fuente releída; reapunta las movidas. Después:
                make knowledge-check y make knowledge-test

⚠ Antes de `paquete`, los clones tienen que tener su origin al día (`make knowledge-check FETCH=1`):
knowledge-check no hace fetch, y un clon atrasado devuelve MENOS deriva sin avisar.

Las corridas quedan fuera de git, en KNOWLEDGE_DRIFT_DIR (por defecto `.runs/`, en esta carpeta).
"""
import argparse, collections, datetime, json, os, re, subprocess, sys, unicodedata
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
MY_TOOLS = os.path.dirname(os.path.dirname(HERE))
KN = os.path.join(MY_TOOLS, "knowledge")
WORK = os.path.expanduser(os.environ.get("KNOWLEDGE_DRIFT_DIR", os.path.join(HERE, ".runs")))
TRIAGE_SIZE_CAP = 80000  # caracteres por grupo del triaje (prosa + diffs): una pregunta que el modelo no corte
TRIAGE_DIFF_CAP = 8000  # diff neto de un archivo en el triaje: más que eso es «cambio grande», y lo mira el paso de código
TRIAGE_ITEMS_CAP = 60  # ítems por grupo del triaje: cada uno vuelve con su veredicto y su porqué
CODE_PROSE_CAP = 15000  # prosa por paquete de código: lo que vuelve reescrito tiene que caber en la respuesta del modelo


def die(msg):
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(2)


def anchor(title):
    """El ancla de un título: a-z0-9, el resto colapsa en un guion."""
    t = unicodedata.normalize("NFKD", title.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def bins(groups, n, size):
    buckets, load_ = [[] for _ in range(n)], [0] * n
    for g in sorted(groups, key=size, reverse=True):
        k = load_.index(min(load_)); buckets[k].append(g); load_[k] += size(g)
    return [b for b in buckets if b]


def body_of(t):
    t = (t or "").strip()
    return t.split("\n", 1)[1].strip() if t.startswith("## ") else t


def repo_dirs():
    """Dónde leer el main de cada repo: el clon de `main_clones` si lo hay, por el alias o por el
    nombre de la carpeta de trabajo; si no, el clon de trabajo. Lo mismo que `MainRoot` en connectors/repos."""
    d = json.load(open(os.path.join(MY_TOOLS, "tools", "repos.json")))
    expand = lambda v: os.path.expanduser(v) if v.startswith("~") else os.path.join(MY_TOOLS, v)
    clones = expand(d["main_clones"]) if d.get("main_clones") else ""
    out = {}
    for group in ("indexed", "citable_only"):
        for k, v in (d.get(group) or {}).items():
            out[k] = expand(v)
            for name in (k, os.path.basename(out[k])) if clones else ():
                if os.path.isdir(os.path.join(clones, name, ".git")):
                    out[k] = os.path.join(clones, name)
                    break
    return out


def sh(args, cwd=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True).stdout


def run_dir(args, create=False):
    pointer = os.path.join(WORK, "ACTUAL")
    if create and not args.run:
        d = os.path.join(WORK, datetime.datetime.now().strftime("%Y-%m-%d-%H%M"))
        os.makedirs(d, exist_ok=True)
        os.makedirs(WORK, exist_ok=True)
        open(pointer, "w").write(d)
        return d
    if args.run:
        return args.run
    return open(pointer).read().strip()


def load(d, n):
    return json.load(open(os.path.join(d, n)))


def save(d, n, x):
    json.dump(x, open(os.path.join(d, n), "w"), ensure_ascii=False, indent=1)


def sections_of(topic):
    text = open(os.path.join(KN, topic, "rules.md")).read()
    out, cur = {}, None
    for line in text.splitlines():
        if line.startswith("## "):
            cur = anchor(line[3:]); out[cur] = [line]
        elif cur:
            out[cur].append(line)
    return {k: "\n".join(v).strip() for k, v in out.items()}


# ── paquete ─────────────────────────────────────────────────────────────────────────────────────────

def fetch_all():
    """Trae main a los clones sólo-main, lo mismo que la mirada de Knowledge (`cmd/knowledge fetch`, que entra por HTTPS
    con `gh` si SSH no tiene acceso). Antes hacía fetch de los ~38 clones de trabajo, uno por uno: minutos, y con SSH
    caído fallaba en silencio. Knowledge pasa --no-fetch porque su mirada ya lo hizo."""
    r = subprocess.run(["go", "run", "./cmd/knowledge", "fetch"], cwd=MY_TOOLS, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout + r.stderr)
        die("no se pudo traer main a los clones: sin eso, lo que se mide es main viejo")


RE_MERGE = re.compile(r"^Merge pull request #(\d+) from \S+?/(\S+)$")
SYNC_BRANCH = re.compile(r"^(qa|develop|staging|main|main-pro|lab)$|^(merge/|chore/sync|chore/merge)")
PR_BODY_CAP = 2000  # la descripción de un PR es contexto, no evidencia: lo que decide es el diff
PR_CACHE = os.path.expanduser("~/.cache/my-tools/knowledge-drift-prs.json")


def merged_prs(f):
    """Los PRs que cambiaron este archivo entre el commit revisado y main, sacados del git local: cada merge «Merge pull
    request #N from org/rama» cuyo resultado cambió el archivo respecto de su primer padre. Sin los de sincronización
    (qa, develop, lab… → otra rama), que repiten lo que trajeron los de feature. Es contexto para el triaje (qué se quiso
    hacer y cuándo); lo que decide es el diff neto."""
    out = []
    log = sh(["git", "-C", f["dir"], "log", "--full-history", "--merges", "--format=%H %cs %s",
              f"{f['base']}..{f['ref']}", "--", f["path"]])
    for line in log.splitlines():
        sha, date, subject = (line.split(" ", 2) + ["", ""])[:3]
        m = RE_MERGE.match(subject)
        if not m or SYNC_BRANCH.search(m.group(2)):
            continue
        if subprocess.run(["git", "-C", f["dir"], "diff", "--quiet", f"{sha}^1", sha, "--", f["path"]]).returncode == 0:
            continue  # ese merge no cambió el archivo
        out.append(dict(pr=f"{os.path.basename(f['dir'])}#{m.group(1)}", date=date, branch=m.group(2)))
    return out


def pr_bodies(keys):
    """Título y descripción de cada PR: lo único que no está en git. Un PR mergeado no cambia, así que queda en caché
    entre corridas y sólo se piden los nuevos, en paralelo."""
    try:
        cache = json.load(open(PR_CACHE))
    except (OSError, ValueError):
        cache = {}

    def one(k):
        slug, n = k.split("#")
        x = json.loads(sh(["gh", "api", f"repos/Creditop-SAS/{slug}/pulls/{n}"]) or "{}")
        return k, dict(title=x.get("title"), body=(x.get("body") or "").strip())

    missing = [k for k in keys if k not in cache]
    with ThreadPoolExecutor(8) as ex:
        for k, v in ex.map(one, missing):
            if v["title"] is not None:
                cache[k] = v
    os.makedirs(os.path.dirname(PR_CACHE), exist_ok=True)
    json.dump(cache, open(PR_CACHE, "w"))
    print(f"  PRs: {len(keys)} · {len(keys) - len(missing)} de la caché · {len(missing)} pedidos a GitHub")
    return {k: cache.get(k, {}) for k in keys}


def step_paquete(args):
    d = run_dir(args, create=True)
    if not args.no_fetch:
        fetch_all()
    check = json.loads(sh(["go", "run", "./cmd/knowledge", "check", "--json"], cwd=MY_TOOLS) or "[]")
    drift = [c for c in check if c["state"] != "unchanged"]
    dirs = repo_dirs()
    srcs = {}
    for t in sorted({c["topic"] for c in drift}):
        for s in json.load(open(os.path.join(KN, t, "sources.json")))["sources"]:
            srcs[(t, s["repo"], s["path"])] = s
    git = lambda repo, *a: sh(["git", "-C", dirs[repo], *a])

    def build(c):
        s = srcs[(c["topic"], c["repo"], c["path"])]
        repo, path, ref = c["repo"], c["path"], c["ref"]
        exists = c["state"] != "missing"
        diff_lines = len(git(repo, "diff", "-M", s["commit"], ref, "--", path).splitlines()) if exists else 0
        commits = [dict(sha=x[:10], subject=y) for x, y in (l.split(" ", 1) for l in git(repo, "log", "--format=%H %s", f"{s['commit']}..{ref}", "--", path).splitlines() if " " in l)]
        moved = None
        if not exists:
            sha = git(repo, "log", ref, "-1", "--format=%H", "--diff-filter=DR", "--", path).strip()
            if sha:
                st = git(repo, "diff", "-M", "--name-status", f"{sha}~1", sha)
                to = next((l.split("\t")[2] for l in st.splitlines() if l.startswith("R") and l.split("\t")[1] == path), None)
                moved = dict(commit=sha[:10], subject=git(repo, "log", "-1", "--format=%s", sha).strip(), to=to)
        return dict(topic=c["topic"], repo=repo, path=path, ref=ref, state=c["state"], base=s["commit"], blob=s["blob"],
                    sections=s.get("sections", []), exists=exists, diff_lines=diff_lines, commits=commits, moved=moved,
                    dir=dirs[repo])

    with ThreadPoolExecutor(6) as ex:
        files = list(ex.map(build, drift))

    with ThreadPoolExecutor(8) as ex:
        for f, prs_ in zip(files, ex.map(merged_prs, files)):
            f["prs"] = prs_
    bodies = pr_bodies(sorted({p["pr"] for f in files for p in f["prs"]}))
    save(d, "files.json", files)
    save(d, "prs.json", bodies)

    items = {}
    for t in sorted({f["topic"] for f in files}):
        secs = sections_of(t)
        for f in (f for f in files if f["topic"] == t):
            for a in f["sections"]:
                if a not in secs:
                    print(f"  ⚠ {t}: la fuente {f['path']} respalda «{a}», que no existe en rules.md"); continue
                it = items.setdefault(f"{t}#{a}", dict(topic=t, prose=secs[a], files=[]))
                key = f"{f['repo']}:{f['path']}"
                if key not in it["files"]:
                    it["files"].append(key)
    save(d, "secciones.json", items)
    # El triaje compara la prosa con el CAMBIO NETO de cada archivo: del commit con que se escribió la sección a main.
    # Si varios PRs encadenados tocaron lo mismo, el diff ya trae sólo el resultado; los PRs no se consultan (Miguel,
    # 2026-11-24: eran lo más pesado del paquete y una forma indirecta de mirar lo que el diff dice directo).
    def net(f):
        if not f["exists"]:
            return f"YA NO ESTÁ EN MAIN → {(f['moved'] or {}).get('to') or 'borrado'} ({(f['moved'] or {}).get('subject', '')})"
        diff = sh(["git", "-C", f["dir"], "diff", "-M", f["base"], f["ref"], "--", f["path"]])
        if len(diff) > TRIAGE_DIFF_CAP:
            return (f"CAMBIO GRANDE: {f['diff_lines']} líneas de diff; van las primeras.\n```diff\n{diff[:TRIAGE_DIFF_CAP]}\n```")
        return f"```diff\n{diff}\n```"
    by_key = {f"{f['repo']}:{f['path']}": f for f in files}
    with ThreadPoolExecutor(8) as ex:
        diffs = dict(zip(by_key, ex.map(net, by_key.values())))
    by_topic = collections.defaultdict(list)
    for k, v in items.items():
        by_topic[v["topic"]].append(k)
    # cada archivo una vez por tema: el grupo imprime su diff una sola vez, aunque lo citen varias secciones
    files_of = lambda t: {f for k in by_topic[t] for f in items[k]["files"]}
    pr_len = lambda p: min(len((bodies.get(p) or {}).get("body") or ""), PR_BODY_CAP) + 200
    size = lambda t: (sum(len(items[k]["prose"]) for k in by_topic[t]) + sum(len(diffs[f]) for f in files_of(t))
                      + sum(pr_len(p) for p in {p["pr"] for f in files_of(t) for p in by_key[f]["prs"]}))
    os.makedirs(os.path.join(d, "triaje"), exist_ok=True)
    # Con 4 grupos fijos, la corrida #20 de Knowledge (2026-11-24, 53 temas) armó grupos de 235 a 350 mil
    # caracteres y ~400 ítems, y Bedrock cortó la invocación: se arman los que hagan falta para los dos topes.
    groups = max(args.groups, -(-sum(size(t) for t in by_topic) // TRIAGE_SIZE_CAP), -(-len(items) // TRIAGE_ITEMS_CAP))
    for g, topics in enumerate(bins(list(by_topic), groups, size), 1):
        o, used = [], []
        for t in sorted(topics):
            o.append(f"\n\n# TEMA {t}")
            for k in by_topic[t]:
                s = items[k]
                o.append(f"\n## ÍTEM {k}\n{s['prose']}\n\narchivos que cambiaron (su diff, abajo):")
                o += [f"- {f}" for f in s["files"]]
                used += [f for f in s["files"] if f not in used]
        timeline = {}
        for f in used:
            for p in by_key[f]["prs"]:
                timeline.setdefault(p["pr"], dict(p, files=[]))["files"].append(f)
        if timeline:
            o.append("\n\n# CONTEXTO: los PRs que cambiaron estos archivos en este tiempo, por fecha (qué se quiso hacer; lo que decide es el diff)")
            for p in sorted(timeline.values(), key=lambda x: (x["date"], x["pr"])):
                b = bodies.get(p["pr"]) or {}
                body = (b.get("body") or "(sin descripción)")
                body = body if len(body) <= PR_BODY_CAP else body[:PR_BODY_CAP] + " …[recortada]"
                quoted = "\n".join("> " + line for line in body.splitlines())  # sus «##» no se confunden con el paquete
                o.append(f"\n## {p['date']} · {p['pr']} · {p['branch']} — {b.get('title')}\narchivos: {', '.join(p['files'])}\n{quoted}")
        o.append("\n\n# ARCHIVOS: el cambio neto de cada uno, del commit revisado a main")
        o += [f"\n## {f}\n{diffs[f]}" for f in used]
        open(os.path.join(d, "triaje", f"grupo-{g}.md"), "w").write("\n".join(o))
        print(f"  triaje/grupo-{g}.md · {sum(len(by_topic[t]) for t in topics)} ítems · ~{len(chr(10).join(o)) // 4:,} tokens")
    print(f"corrida {d}: {len(files)} fuentes · {len(items)} secciones")


# ── codigo ──────────────────────────────────────────────────────────────────────────────────────────

def step_codigo(args):
    d = run_dir(args)
    items, files = load(d, "secciones.json"), {f"{f['repo']}:{f['path']}": f for f in load(d, "files.json")}
    tri = [x for n in sorted(os.listdir(os.path.join(d, "triaje"))) if n.startswith("resultado-")
           for x in json.load(open(os.path.join(d, "triaje", n)))]
    missing = set(items) - {x["id"] for x in tri}
    if missing:
        die(f"al triaje le faltan {len(missing)} ítems: {sorted(missing)[:3]}")
    save(d, "triaje.json", tri)
    cmd = lambda f: (f"`git -C {f['dir']} diff {f['base']} {f['ref']} -- {f['path']}`" if f["exists"]
                     else f"YA NO ESTÁ EN MAIN → {(f['moved'] or {}).get('to') or 'borrado'} ({(f['moved'] or {}).get('subject', '')})")
    open_ = {x["id"]: x for x in tri if x["veredicto"] != "no_toca"}
    by_topic = collections.defaultdict(list)
    for i in open_:
        by_topic[items[i]["topic"]].append(i)
    os.makedirs(os.path.join(d, "codigo"), exist_ok=True)
    order = {"contradice": 0, "no_se_sabe": 1}
    prose = lambda t: sum(len(items[i]["prose"]) for i in by_topic[t])
    # Cada sección puede volver reescrita en la respuesta: con 4 paquetes fijos, la corrida #19 de Knowledge
    # (2026-11-23, 92 secciones, ~36 mil caracteres por paquete) pasó el tope de salida del modelo y su JSON
    # llegó cortado. Se arman los paquetes que hagan falta para no pasar CODE_PROSE_CAP de prosa por paquete.
    groups = max(args.groups, -(-sum(prose(t) for t in by_topic) // CODE_PROSE_CAP))
    for g, topics in enumerate(bins(list(by_topic), groups, prose), 1):
        ids = sorted([i for t in topics for i in by_topic[t]], key=lambda i: (order.get(open_[i]["veredicto"], 2), i))
        o = [f"# Paquete de código {g}: {len(ids)} ítems\n"]
        for i in ids:
            o.append(f"\n## ÍTEM {i} — triaje: {open_[i]['veredicto']}\n{items[i]['prose']}\n\n> triaje: {open_[i].get('por_que', '')}\n> mirar: {open_[i].get('mirar', '')}\narchivos:")
            o += [f"- {f}: {cmd(files[f])}" for f in items[i]["files"]]
        open(os.path.join(d, "codigo", f"paquete-{g}.md"), "w").write("\n".join(o))
        print(f"  codigo/paquete-{g}.md · {len(ids)} ítems")
    blind = sorted(x["id"] for x in tri if x["veredicto"] == "no_toca")
    os.makedirs(os.path.join(d, "segunda"), exist_ok=True)
    bt = collections.defaultdict(list)
    for i in blind:
        bt[items[i]["topic"]].append(i)
    for g, topics in enumerate(bins(list(bt), max(1, args.groups // 2), lambda t: len(bt[t])), 1):
        o = [f"# Segunda mirada {g}\n"]
        for t in topics:
            for i in bt[t]:
                o.append(f"\n## ÍTEM {i}\n{items[i]['prose']}\n\narchivos (diff completo):")
                o += [f"- {f}: {cmd(files[f])}" for f in items[i]["files"]]
        open(os.path.join(d, "segunda", f"grupo-{g}.md"), "w").write("\n".join(o))
        print(f"  segunda/grupo-{g}.md · {sum(len(bt[t]) for t in topics)} ítems")


# ── final ───────────────────────────────────────────────────────────────────────────────────────────

def step_final(args):
    d = run_dir(args)
    items = load(d, "secciones.json")
    final = {}
    for sub in ("segunda", "codigo"):
        for n in sorted(os.listdir(os.path.join(d, sub))):
            if n.startswith("resultado-"):
                for x in json.load(open(os.path.join(d, sub, n))):
                    final[x["id"]] = dict(x, fuente=sub)
    ov = os.path.join(d, "overrides.json")
    if os.path.exists(ov):
        for k, x in json.load(open(ov)).items():
            final[k] = dict(x, id=k, fuente="a mano")
    missing = set(items) - set(final)
    if missing:
        die(f"sin veredicto final: {sorted(missing)[:5]}")
    save(d, "final.json", final)
    print("  final:", dict(collections.Counter(x["veredicto"] for x in final.values())))
    for i, x in final.items():
        if x["veredicto"] in ("cambia", "nueva") and not x.get("texto_nuevo"):
            print(f"  ⚠ {i} cambia sin texto nuevo")


# ── aplicar ─────────────────────────────────────────────────────────────────────────────────────────

def step_aplicar(args):
    d = run_dir(args)
    final, files = load(d, "final.json"), load(d, "files.json")
    # reemplazos.json: {ruta_borrada: ruta_nueva} para los archivos que main borró sin renombre pero reemplazó
    swaps = load(d, "reemplazos.json") if os.path.exists(os.path.join(d, "reemplazos.json")) else {}
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    by_topic = collections.defaultdict(list)
    for f in files:
        by_topic[f["topic"]].append(f)
    for t, fs in sorted(by_topic.items()):
        rp, sp = os.path.join(KN, t, "rules.md"), os.path.join(KN, t, "sources.json")
        text, src = open(rp).read(), json.load(open(sp))
        renames = {}
        for i, x in final.items():
            if not i.startswith(t + "#") or x["veredicto"] not in ("cambia", "nueva"):
                continue
            a = i.split("#", 1)[1]
            lines = text.split("\n")
            start = next(n for n, l in enumerate(lines) if l.startswith("## ") and anchor(l[3:]) == a)
            end = next((n for n in range(start + 1, len(lines)) if lines[n].startswith("## ")), len(lines))
            title = x.get("titulo_nuevo") or lines[start][3:].strip()
            if x.get("titulo_nuevo"):
                renames[a] = anchor(title)
            body = body_of(x["texto_nuevo"])
            lines[start:end] = [f"## {title}", "", body, ""]
            text = "\n".join(lines)
        open(rp, "w").write(re.sub(r"\n{3,}", "\n\n", text).rstrip() + "\n")
        keep = []
        for s in src["sources"]:
            f = next((f for f in fs if f["repo"] == s["repo"] and f["path"] == s["path"]), None)
            s["sections"] = [renames.get(a, a) for a in s.get("sections", [])]
            if f is None:
                keep.append(s); continue
            dirp = f["dir"]
            if f["exists"]:
                path = s["path"]
            elif (f["moved"] or {}).get("to") or s["path"] in swaps:
                path = (f["moved"] or {}).get("to") or swaps[s["path"]]
                print(f"  {t}: {s['path']} → {path}")
            else:
                print(f"  ⚠ {t}: se quita la fuente borrada {s['path']} (respaldaba {s['sections']})"); continue
            s["path"] = path
            s["commit"] = sh(["git", "-C", dirp, "rev-parse", f["ref"]]).strip()
            s["blob"] = sh(["git", "-C", dirp, "rev-parse", f"{f['ref']}:{path}"]).strip()
            keep.append(s)
        src["sources"] = keep
        src["reviewedAt"] = now
        backed = {a for s in keep for a in s.get("sections", [])}
        orphan = [a for a in sections_of(t) if a not in backed]
        if orphan:
            print(f"  ⚠ {t}: secciones sin fuente (el lector lo rechaza): {orphan}")
        open(sp, "w").write(json.dumps(src, ensure_ascii=False, indent=2) + "\n")
    print("  → make knowledge-check && make knowledge-test")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paso", choices=["paquete", "codigo", "final", "aplicar"])
    ap.add_argument("--run")
    ap.add_argument("--no-fetch", action="store_true", help="no traer main: ya lo hizo quien llama (la mirada de Knowledge)")
    ap.add_argument("--groups", "--grupos", dest="groups", type=int, default=8)  # --grupos: el nombre de antes
    args = ap.parse_args()
    globals()[f"step_{args.paso}"](args)


if __name__ == "__main__":
    main()
