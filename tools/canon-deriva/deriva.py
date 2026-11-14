#!/usr/bin/env python3
"""canon-deriva: poner canon al día contra main con el método jerárquico, de lo barato a lo caro.

Los pasos MECÁNICOS los corre este comando; los de MODELO (triaje, código, segunda mirada) los arma como
paquetes chicos con sus instrucciones (`prompts/`) para que una sesión lance un agente por paquete. El
recorrido entero, con lo que costó cada lección, está en el CLAUDE.md de esta carpeta.

    foto        fetch de los clones (clona los que falten), ronda forzada y export del corpus, en el mismo minuto
    paquete     ronda → archivos → diffs → PRs → secciones; y la higiene del mapa. Sin modelo
    triaje      los paquetes del triaje SIN código (prosa + PRs + tamaño de cada diff)
    codigo      con el triaje hecho: los paquetes de código (diff bajo demanda) y los de la segunda mirada a ciegas
    final       junta los veredictos de código, segunda mirada y correcciones a mano (overrides.json)
    piezas      las piezas para canon-write, ordenadas, con los chequeos del lint de antemano; y lo que va aparte
    movidos     reapunta en un export fresco los archivos que main movió (canon-patch; APPLY=1 publica)
    estado      en qué paso está la corrida y qué falta

Todo vive en CANON_DERIVA_DIR (por defecto ~/Desktop/CREDITOP/canon): `repos/` (los clones, compartidos entre
corridas) y `runs/<fecha>/` (una corrida). `runs/ACTUAL` apunta a la última. Sólo lee repos y canon, salvo
`movidos APPLY=1`, que publica.
"""
import argparse, collections, datetime, json, os, re, subprocess, sys, unicodedata
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
MY_TOOLS = os.path.dirname(os.path.dirname(HERE))
WORK = os.path.expanduser(os.environ.get("CANON_DERIVA_DIR", "~/Desktop/CREDITOP/canon"))
REPOS = os.path.join(WORK, "repos")
REF = "refs/remotes/origin/main"
SHARED = os.path.expanduser("~/Desktop/CREDITOP/github/playground")
# Techos del lint de canon por clase de documento (tools/canon/internal/corpus/policy.go). Se leen de ahí;
# estos son el respaldo si el repo compartido no está.
CAPS_FALLBACK = {"context": (50000, 600), "operar": (50000, 500)}
MARGIN = 40          # canon cuenta palabras distinto que split(): se apunta por debajo del techo
HUB = 4              # un archivo que comparten más ítems no une paquetes de código (si no, sale uno gigante)
PR_BODY_CAP = 12000  # recortar fijo y corto fabricó dudas: 41 de 60 ítems quedaron «no se sabe» por un PR largo


def die(msg):
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(2)


def sh(args, cwd=None, check=True):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if check and r.returncode:
        raise RuntimeError(f"{' '.join(args[:4])}…: {r.stderr.strip()[:300]}")
    return r.stdout


def git(repo, *a, check=False):
    return sh(["git", "-C", os.path.join(REPOS, repo), *a], check=check)


def canon_cli():
    """El comando `canon` de my-tools, compilado una vez por corrida (go run por cada búsqueda es lento)."""
    out = os.path.join(WORK, ".bin", "canon")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sh(["go", "build", "-o", out, "./cmd/canon"], cwd=os.path.join(MY_TOOLS, "tablero", "server"))
    return out


def canon(*args, retries=3):
    cli = canon_cli()
    for i in range(retries):
        r = subprocess.run([cli, *args], capture_output=True, text=True)
        out = r.stdout + r.stderr
        if "504" in out and i < retries - 1:  # la ronda forzada a veces se pasa del gateway: reintentar
            continue
        return out
    return out


def anchor(title):
    """Igual que AnchorOf de canon (internal/corpus/document.go): a-z0-9, el resto colapsa en un guion."""
    t = unicodedata.normalize("NFKD", title.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def caps():
    try:
        src = sh(["git", "-C", SHARED, "show", "origin/main:tools/canon/internal/corpus/policy.go"])
        out = {m[0]: (int(m[1]), int(m[2])) for m in re.findall(r'"(\w+)":\s*\{(\d+),\s*(\d+),', src)}
        return out or CAPS_FALLBACK
    except Exception:
        return CAPS_FALLBACK


def branch_exceptions():
    """Qué repo no se lee de `main` (tools/canon/internal/codebase/git.go). Se lee del código: una copia vence."""
    try:
        src = sh(["git", "-C", SHARED, "show", "origin/main:tools/canon/internal/codebase/git.go"])
        block = src.split("branchExceptions = map[string]string{", 1)[1].split("}", 1)[0]
        return {k.split("/")[-1]: v for k, v in re.findall(r'"([^"]+)":\s*"([^"]+)"', block)}
    except Exception:
        return {"creditop_mobile": "main-pro"}


# ── la corrida ──────────────────────────────────────────────────────────────────────────────────────

def run_dir(args, create=False):
    pointer = os.path.join(WORK, "runs", "ACTUAL")
    if create:
        d = os.path.join(WORK, "runs", datetime.datetime.now().strftime("%Y-%m-%d-%H%M"))
        os.makedirs(d, exist_ok=True)
        open(pointer, "w").write(d)
        return d
    if args.run:
        return args.run
    if not os.path.exists(pointer):
        die("no hay corrida: empezá con PASO=foto")
    return open(pointer).read().strip()


def load(d, name):
    p = os.path.join(d, name)
    if not os.path.exists(p):
        die(f"falta {name}: corré el paso anterior")
    return json.load(open(p))


def save(d, name, data):
    json.dump(data, open(os.path.join(d, name), "w"), ensure_ascii=False, indent=1)


# ── 1 · foto ────────────────────────────────────────────────────────────────────────────────────────

def step_foto(args):
    d = run_dir(args, create=True)
    os.makedirs(REPOS, exist_ok=True)
    out = canon("clones")
    server = dict(re.findall(r"^\s+Creditop-SAS/(\S+)\s+(\w+)", out, flags=re.M))
    if not server:
        die("canon no listó sus clones (¿VPN de prod?):\n" + out[:400])
    exc = branch_exceptions()

    def ensure(name):
        path = os.path.join(REPOS, name)
        br = exc.get(name, "main")
        if not os.path.isdir(os.path.join(path, ".git")):
            sh(["gh", "repo", "clone", f"Creditop-SAS/{name}", path, "--", "--filter=blob:none",
                "--single-branch", "--branch", br, "--no-tags", "-q"])
        if br != "main":  # canon lee siempre refs/remotes/origin/main: se espeja la rama vigente ahí
            spec = f"+refs/heads/{br}:refs/remotes/origin/main"
            if spec not in git(name, "config", "--get-all", "remote.origin.fetch"):
                git(name, "config", "--add", "remote.origin.fetch", spec)
        git(name, "fetch", "-q", "origin")
        return name, git(name, "rev-parse", REF).strip()[:12]

    with ThreadPoolExecutor(6) as ex:
        local = dict(ex.map(ensure, sorted(server)))
    differ = {r: (local[r], c) for r, c in server.items() if not local[r].startswith(c[:12]) and not c.startswith(local[r])}
    ronda = canon("round", "-force")
    open(os.path.join(d, "ronda.txt"), "w").write(ronda)
    exp = canon("export", "-out", os.path.join(d, "corpus"))
    rev = (re.findall(r"revisión del corpus (\w+)", exp) or ["?"])[0]
    save(d, "foto.json", dict(at=datetime.datetime.now().isoformat(timespec="seconds"), revision=rev,
                               commits=local, differ_from_server=differ))
    print(f"corrida {d}")
    print(f"  {len(local)} clones · revisión del corpus {rev} · {ronda.strip().splitlines()[0].strip()}")
    if differ:
        print(f"  ⚠ {len(differ)} clones no coinciden con el servidor (la ronda mide contra los suyos): "
              + ", ".join(f"{r} local {a} / servidor {b}" for r, (a, b) in differ.items()))


# ── 2-5 y 7 · paquete (sin modelo) ──────────────────────────────────────────────────────────────────

RONDA_LINE = re.compile(r"^\s+(\S+)\s+(\S+?):(\S+)\s+(\w+)\s+→\s*(\w*)\s*$")


def parse_ronda(text):
    """⚠ Una entrada sin hash nuevo (`viejo →`) es un archivo que main MOVIÓ o BORRÓ. Exigir hash a los dos
    lados las descartaba en silencio: 13 se perdieron así en la primera corrida."""
    out = []
    for line in text.splitlines():
        m = RONDA_LINE.match(line)
        if m:
            out.append(dict(topic=m[1], alias=m[2], path=m[3], old=m[4], new=m[5] or None))
    return out


def follow_move(repo, path):
    """A dónde fue un archivo que ya no está en main: el commit que lo sacó y, si fue un renombre, su ruta nueva."""
    sha = git(repo, "log", REF, "-1", "--format=%H", "--diff-filter=DR", "--", path).strip()
    if not sha:
        return dict(commit=None, to=None, added=[])
    st = git(repo, "diff", "-M", "--name-status", f"{sha}~1", sha)
    to = next((l.split("\t")[2] for l in st.splitlines() if l.startswith("R") and l.split("\t")[1] == path), None)
    added = [l.split("\t")[1] for l in st.splitlines() if l.startswith("A")]
    subj = git(repo, "log", "-1", "--format=%s", sha).strip()
    return dict(commit=sha[:10], subject=subj, to=to, added=added[:10] if not to else [])


def file_history(repo, path, olds):
    rows = [r[2:].split("\x1f", 2) for r in git(repo, "log", "--format=@@%H\x1f%ad\x1f%s", "--date=short",
                                               REF, "--", path).splitlines() if r.startswith("@@")]
    base, chain, kept = None, [], []
    for sha, date, subj in rows:
        blob = git(repo, "rev-parse", f"{sha}:{path}").strip()
        if any(blob.startswith(o) for o in olds):
            base, kept = sha, list(chain)  # seguimos: el declarado más viejo manda
        chain.append(dict(sha=sha[:10], date=date, subject=subj))
    return base, (kept if base else chain[:5])


def step_paquete(args):
    d = run_dir(args)
    entries = parse_ronda(open(os.path.join(d, "ronda.txt")).read())
    files = {}
    for e in entries:
        k = (e["alias"].split("/")[-1], e["path"])
        f = files.setdefault(k, dict(repo=k[0], path=k[1], olds=set(), topics=set(), aliases=set(), gone=False))
        f["olds"].add(e["old"]); f["topics"].add(e["topic"]); f["aliases"].add(e["alias"])
        f["gone"] |= e["new"] is None

    def build(f):
        repo, path = f["repo"], f["path"]
        if not os.path.isdir(os.path.join(REPOS, repo)):
            return dict(f, error=f"no hay clon de {repo}")
        base, commits = file_history(repo, path, f["olds"])
        exists = subprocess.run(["git", "-C", os.path.join(REPOS, repo), "cat-file", "-e", f"{REF}:{path}"],
                                capture_output=True).returncode == 0
        moved = None if exists else follow_move(repo, path)
        stat = git(repo, "diff", "--shortstat", base or "HEAD", REF, "--", path).strip() if base and exists else ""
        diff_lines = len(git(repo, "diff", "-M", base, REF, "--", path).splitlines()) if base and exists else 0
        return dict(repo=repo, path=path, topics=sorted(f["topics"]), aliases=sorted(f["aliases"]), base=base,
                    exists=exists, moved=moved, commits=commits, stat=stat, diff_lines=diff_lines)

    with ThreadPoolExecutor(6) as ex:
        out = list(ex.map(build, sorted(files.values(), key=lambda f: (f["repo"], f["path"]))))

    # PRs: el de cada commit, por la API (sólo lectura); los mensajes de merge no alcanzan (squash, ramas).
    def pulls(rc):
        repo, sha = rc
        full = git(repo, "rev-parse", sha).strip()
        r = subprocess.run(["gh", "api", f"repos/Creditop-SAS/{repo}/commits/{full}/pulls"], capture_output=True, text=True)
        data = json.loads(r.stdout) if r.returncode == 0 else []
        merged = [p["number"] for p in data if p.get("merged_at")]
        return rc, merged or [p["number"] for p in data]

    commits = sorted({(f["repo"], c["sha"]) for f in out for c in f["commits"]})
    with ThreadPoolExecutor(8) as ex:
        c2p = dict(ex.map(pulls, commits))
    want = sorted({(r, n) for (r, _), ns in c2p.items() for n in ns})

    def pr(rn):
        r, n = rn
        p = subprocess.run(["gh", "api", f"repos/Creditop-SAS/{r}/pulls/{n}"], capture_output=True, text=True)
        x = json.loads(p.stdout) if p.returncode == 0 else {}
        return f"{r}#{n}", dict(title=x.get("title"), merged_at=x.get("merged_at"), body=(x.get("body") or "").strip())

    with ThreadPoolExecutor(8) as ex:
        prs = dict(ex.map(pr, want))
    for f in out:
        f["prs"] = sorted({f"{f['repo']}#{n}" for c in f["commits"] for n in c2p.get((f["repo"], c["sha"]), [])})
    save(d, "files.json", out)
    save(d, "prs.json", prs)

    # sección → áreas → archivos → PRs, y la higiene del mapa
    byfile = {(f["repo"], f["path"]): f for f in out}
    secs, hygiene, classes = {}, [], {}
    for t in sorted({t for f in out for t in f["topics"]}):
        tdir = os.path.join(d, "corpus", "content", t)
        mds = sorted(n for n in os.listdir(tdir) if n.endswith(".md"))
        classes[t] = mds[0][:-3]  # la clase sale del archivo: context u operar (operar tiene otro techo)
        m = json.load(open(os.path.join(tdir, "map.json")))
        text = "".join(open(os.path.join(tdir, n)).read() for n in mds)
        sections, cur = {}, None
        for line in text.splitlines():
            if line.startswith("## "):
                cur = anchor(line[3:]); sections[cur] = [line]
            elif cur:
                sections[cur].append(line)
        sections = {k: "\n".join(v).strip() for k, v in sections.items()}
        for i, a in enumerate(m.get("areas", [])):
            hit = [((m.get("repos", {}).get(al, al)).split("/")[-1], p) for al, ps in a.get("fuentes", {}).items() for p in ps]
            hit = [k for k in hit if k in byfile and t in byfile[k]["topics"]]
            if not hit:
                continue
            if not a.get("secciones"):
                hygiene.append(dict(kind="área sin sección", topic=t, area=i, goal=a.get("objetivo")))
                secs[f"{t}#A{i}"] = dict(topic=t, kind="área", prose=f"OBJETIVO: {a.get('objetivo')}\nSE DEDUCE LEYENDO: {a.get('se_deduce_leyendo', '')}",
                                         files=[f"{r}:{p}" for r, p in hit], areas=[i])
            for s in a.get("secciones", []):
                if s not in sections:
                    hygiene.append(dict(kind="sección inexistente", topic=t, area=i, anchor=s)); continue
                e = secs.setdefault(f"{t}#{s}", dict(topic=t, kind="sección", prose=sections[s], files=[], areas=[]))
                e["areas"].append(i)
                e["files"] += [f"{r}:{p}" for r, p in hit if f"{r}:{p}" not in e["files"]]
    for e in secs.values():
        e["prs"] = sorted({p for k in e["files"] for p in byfile[tuple(k.split(":", 1))]["prs"]})
    save(d, "secciones.json", secs)
    save(d, "higiene.json", hygiene)
    save(d, "clases.json", classes)
    gone = [f for f in out if not f["exists"]]
    print(f"  {len(out)} archivos · {len(commits)} commits · {len(prs)} PRs · {len(secs)} ítems "
          f"({sum(e['kind'] == 'área' for e in secs.values())} áreas sin sección)")
    for f in gone:
        mv = f["moved"] or {}
        print(f"  ⚠ ya no está en main: {f['repo']}:{f['path']} → {mv.get('to') or 'borrado'} ({mv.get('subject', '')[:70]})")
    for h in hygiene:
        if h["kind"] == "sección inexistente":
            print(f"  ⚠ el mapa de {h['topic']} A{h['area']} respalda una sección que no existe: {h['anchor']}")
    if gone:
        print("  → los movidos no los arregla un `verificado`: van con PASO=movidos")


# ── 6 · triaje ──────────────────────────────────────────────────────────────────────────────────────

def bins(groups, n, size):
    buckets, load_ = [[] for _ in range(n)], [0] * n
    for g in sorted(groups, key=size, reverse=True):
        k = load_.index(min(load_)); buckets[k].append(g); load_[k] += size(g)
    return [b for b in buckets if b]


def body(prs, p):
    b = (prs.get(p) or {}).get("body") or "(sin descripción)"
    return b if len(b) <= PR_BODY_CAP else b[:PR_BODY_CAP] + " …[recortada]"


def step_triaje(args):
    d = run_dir(args)
    secs, prs, files = load(d, "secciones.json"), load(d, "prs.json"), load(d, "files.json")
    stat = {f"{f['repo']}:{f['path']}": f["stat"] or ("YA NO ESTÁ EN MAIN" if not f["exists"] else "s/d") for f in files}
    by_topic = collections.defaultdict(list)
    for k, v in secs.items():
        by_topic[v["topic"]].append(k)
    size = lambda t: sum(len(secs[k]["prose"]) for k in by_topic[t]) + sum(len(body(prs, p)) for k in by_topic[t] for p in secs[k]["prs"])
    os.makedirs(os.path.join(d, "triaje"), exist_ok=True)
    for g, topics in enumerate(bins(list(by_topic), args.grupos, size), 1):
        o, used = [], set()
        for t in sorted(topics):
            o.append(f"\n\n# TEMA {t}")
            for k in by_topic[t]:
                s = secs[k]
                o.append(f"\n## ÍTEM {k} ({s['kind']})\n{s['prose']}\n\narchivos que cambiaron:")
                o += [f"- {f} — {stat.get(f)}" for f in s["files"]]
                o.append("PRs: " + ", ".join(s["prs"]))
                used.update(s["prs"])
        o.append("\n\n# PRs (título y descripción)")
        o += [f"\n## {p} — {(prs.get(p) or {}).get('title')}\n{body(prs, p)}" for p in sorted(used)]
        path = os.path.join(d, "triaje", f"grupo-{g}.md")
        open(path, "w").write("\n".join(o))
        print(f"  {path} · {sum(len(by_topic[t]) for t in topics)} ítems · ~{len(chr(10).join(o)) // 4:,} tokens")
    print(f"  → un agente por grupo con {os.path.join(HERE, 'prompts', 'triaje.md')} (resultado: triaje/resultado-N.json)")


# ── 8-9 y 11 · paquetes de código y segunda mirada ──────────────────────────────────────────────────

def step_codigo(args):
    d = run_dir(args)
    secs, files = load(d, "secciones.json"), {f"{f['repo']}:{f['path']}": f for f in load(d, "files.json")}
    tri = [x for n in sorted(os.listdir(os.path.join(d, "triaje"))) if n.startswith("resultado-")
           for x in json.load(open(os.path.join(d, "triaje", n)))]
    missing = set(secs) - {x["id"] for x in tri}
    if missing:
        die(f"al triaje le faltan {len(missing)} ítems, p. ej. {sorted(missing)[:3]}")
    save(d, "triaje.json", tri)
    items = {x["id"]: dict(x, **secs[x["id"]]) for x in tri if x["veredicto"] != "no_toca"}
    use = collections.Counter(f for it in items.values() for f in it["files"])
    parent = {i: i for i in items}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    owner = {}
    for i, it in items.items():
        for f in it["files"]:
            if use[f] > HUB:
                continue
            if f in owner:
                parent[find(i)] = find(owner[f])
            else:
                owner[f] = i
    comps = collections.defaultdict(list)
    for i in items:
        comps[find(i)].append(i)
    size = lambda c: sum(len(items[i]["prose"]) for i in c) + sum(files[f]["diff_lines"] * 40 for f in {f for i in c for f in items[i]["files"]})
    os.makedirs(os.path.join(d, "codigo"), exist_ok=True)
    order = {"contradice": 0, "no_se_sabe": 1}
    for g, b in enumerate(bins(list(comps.values()), args.grupos, size), 1):
        ids = sorted([i for c in b for i in c], key=lambda i: (order.get(items[i]["veredicto"], 2), i))
        fs = sorted({f for i in ids for f in items[i]["files"]})
        o = [f"# Paquete de código {g}: {len(ids)} ítems, {len(fs)} archivos\n"]
        for i in ids:
            it = items[i]
            o.append(f"\n## ÍTEM {i} — triaje: {it['veredicto']}\n{it['prose']}\n\n> triaje: {it.get('por_que', '')}\n"
                     f"> mirar: {it.get('mirar', '')}\n> PRs: {', '.join(it.get('prs', []))}\narchivos: " + ", ".join(it["files"]))
        o.append("\n\n# ARCHIVOS (abrí el diff con el comando; la base es el último commit con el blob declarado)")
        for f in fs:
            x = files[f]
            if not x["exists"]:
                mv = x["moved"] or {}
                o.append(f"- {f} · YA NO ESTÁ EN MAIN → {mv.get('to') or 'borrado'} ({mv.get('subject', '')})")
                continue
            o.append(f"- {f} · {x['diff_lines']} líneas · PRs {', '.join(x['prs'])}\n  `git -C {REPOS}/{x['repo']} diff {x['base']} {REF} -- {x['path']}`")
        o.append(f"\nDescripciones enteras de los PRs: `{os.path.join(d, 'prs.json')}` (clave `repo#n`).")
        open(os.path.join(d, "codigo", f"paquete-{g}.md"), "w").write("\n".join(o))
        print(f"  codigo/paquete-{g}.md · {len(ids)} ítems · ~{len(chr(10).join(o)) // 4:,} tokens")
    # segunda mirada: lo que el triaje descartó, sin mostrarle el veredicto
    blind = sorted(x["id"] for x in tri if x["veredicto"] == "no_toca")
    os.makedirs(os.path.join(d, "segunda"), exist_ok=True)
    by_topic = collections.defaultdict(list)
    for i in blind:
        by_topic[secs[i]["topic"]].append(i)
    for g, topics in enumerate(bins(list(by_topic), max(1, args.grupos // 2), lambda t: len(by_topic[t])), 1):
        o = [f"# Segunda mirada {g}\n"]
        for t in topics:
            for i in by_topic[t]:
                o.append(f"\n## ÍTEM {i}\n{secs[i]['prose']}\n\narchivos que cambiaron (diff completo):")
                for f in secs[i]["files"]:
                    x = files[f]
                    o.append(f"- {f} · `git -C {REPOS}/{x['repo']} diff {x['base']} {REF} -- {x['path']}`" if x["exists"] else f"- {f} · YA NO ESTÁ EN MAIN")
        open(os.path.join(d, "segunda", f"grupo-{g}.md"), "w").write("\n".join(o))
        print(f"  segunda/grupo-{g}.md · {sum(len(by_topic[t]) for t in topics)} ítems")
    print(f"  → agentes con prompts/codigo.md y prompts/segunda.md (resultado-N.json en cada carpeta)")


# ── 10 · final ──────────────────────────────────────────────────────────────────────────────────────

def step_final(args):
    d = run_dir(args)
    secs, tri = load(d, "secciones.json"), {x["id"]: x for x in load(d, "triaje.json")}
    final = {}
    for sub in ("segunda", "codigo"):  # código pisa a segunda; overrides pisa a todo
        for n in sorted(os.listdir(os.path.join(d, sub))):
            if n.startswith("resultado-"):
                for x in json.load(open(os.path.join(d, sub, n))):
                    final[x["id"]] = dict(x, fuente=sub)
    ov = os.path.join(d, "overrides.json")
    if os.path.exists(ov):
        for k, x in json.load(open(ov)).items():
            final[k] = dict(x, id=k, fuente="a mano")
    missing = set(secs) - set(final)
    if missing:
        die(f"sin veredicto final: {sorted(missing)[:5]} (y {max(0, len(missing) - 5)} más)")
    save(d, "final.json", final)
    c = collections.Counter(x["veredicto"] for x in final.values())
    moves = collections.Counter((tri[i]["veredicto"], x["veredicto"]) for i, x in final.items() if i in tri)
    notext = [i for i, x in final.items() if x["veredicto"] in ("cambia", "nueva") and not x.get("texto_nuevo")]
    print(f"  final: {dict(c)} · triaje→final: {dict(moves)}")
    if notext:
        print(f"  ⚠ {len(notext)} cambian sin texto nuevo (redactar en overrides.json): {notext}")


# ── 12 · piezas ─────────────────────────────────────────────────────────────────────────────────────

MODULE_NAME = re.compile(r"\b[A-Z][a-z]+[A-Z][A-Za-z]*V\d+\b")  # MobileOnboardingV1 sí; un prefijo de código (SGV1) no


def body_of(t):
    t = (t or "").strip()
    return t.split("\n", 1)[1].strip() if t.startswith("## ") else t


def step_piezas(args):
    d = run_dir(args)
    final, secs, classes = load(d, "final.json"), load(d, "secciones.json"), load(d, "clases.json")
    cap = caps()
    out = os.path.join(d, "piezas")
    os.makedirs(out, exist_ok=True)
    today = datetime.date.today().isoformat()
    adds, cors, aparte, warn = [], [], dict(titulos=[], objetivos_de_area=[]), []

    def aliases(topic):
        m = json.load(open(os.path.join(d, "corpus", "content", topic, "map.json")))
        return {al for a in m.get("areas", []) for al in a.get("fuentes", {})} | set(m.get("repos", {}))

    def to_alias(topic, folder):
        al = aliases(topic)
        return folder if folder in al else next((a for a in al if a.split("/")[-1] == folder), f"Creditop-SAS/{folder}")

    def check(path_md, topic, label):
        text = open(path_md).read()
        lim = cap.get(classes[topic], (0, 600))[1] - MARGIN
        if len(text.split()) > lim:
            warn.append(f"{label}: {len(text.split())} palabras, techo {lim + MARGIN} en «{classes[topic]}»: partila en dos `##` por sujeto")
        bad = re.findall(r"\[\[([\w-]+)#", text)
        if bad:  # un enlace va como tema/clase#ancla
            text = re.sub(r"\[\[([\w-]+)#", lambda m_: f"[[{m_[1]}/{classes.get(m_[1], 'context')}#", text)
            open(path_md, "w").write(text)
        for nm in (set(MODULE_NAME.findall(text)) if classes[topic] == "context" else ()):  # en operar las direcciones son la respuesta
            warn.append(f"{label}: «{nm}» parece un nombre de módulo o clase: el lint pide la regla, no la implementación")

    n = 0
    for i, x in sorted(final.items()):
        if x["veredicto"] not in ("cambia", "nueva"):
            continue
        topic = i.split("#", 1)[0]
        if secs.get(i, {}).get("kind") == "área":
            aparte["objetivos_de_area"].append(dict(id=i, texto=body_of(x.get("texto_nuevo")), por_que=x.get("por_que"))); continue
        if not x.get("texto_nuevo"):
            warn.append(f"{i}: cambia sin texto nuevo"); continue
        n += 1
        dest = (x.get("tema_destino") or topic).split("/")[0] if x["veredicto"] == "nueva" else topic
        base = os.path.join(out, f"p{n:03d}-{dest}")
        open(base + ".md", "w").write(body_of(x["texto_nuevo"]) + "\n")
        node = f"{dest}/{classes.get(dest, 'context')}"
        if x["veredicto"] == "nueva":
            title = x.get("titulo") or x.get("titulo_nuevo") or x["texto_nuevo"].strip().split("\n", 1)[0].lstrip("# ")
            arch = collections.defaultdict(list)
            for f in x.get("archivos_fuente") or secs.get(i, {}).get("files", []):
                r, p = f.split(":", 1); arch[to_alias(dest, r)].append(p)
            if not arch:
                warn.append(f"{i}: sección nueva SIN archivos: va a envejecer sin vigilancia")
            p = dict(node=node, section=title, kind="addition", source="verified", verified=today,
                     as_asked=title, text_file=os.path.basename(base) + ".md", archivos=dict(arch))
            adds.append(base + ".json")
        else:
            title = secs[i]["prose"].split("\n", 1)[0][3:].strip()
            if x.get("titulo_nuevo"):
                aparte["titulos"].append(dict(id=i, actual=title, nuevo=x["titulo_nuevo"]))
            p = dict(node=node, section=title, kind="correction", source="verified", verified=today,
                     as_asked="¿esta sección sigue siendo cierta contra main?", text_file=os.path.basename(base) + ".md")
            cors.append(base + ".json")
        json.dump(p, open(base + ".json", "w"), ensure_ascii=False, indent=1)
        check(base + ".md", dest, f"{os.path.basename(base)} ({i})")
    files = load(d, "files.json")
    vs = []
    by = collections.defaultdict(lambda: collections.defaultdict(list))
    for f in files:
        if f["exists"]:
            for t in f["topics"]:
                by[t][f["repo"]].append(f["path"])
    for t, rs in sorted(by.items()):
        p = dict(node=f"{t}/{classes[t]}", operacion="verificado", source="verified", verified=today,
                 as_asked="revisión de deriva contra main (método jerárquico)",
                 archivos={to_alias(t, r): sorted(set(v)) for r, v in rs.items()})
        path = os.path.join(out, f"v-{t}.json"); json.dump(p, open(path, "w"), ensure_ascii=False, indent=1); vs.append(path)
    # adiciones primero: una corrección que enlaza a su otra mitad falla si esa mitad todavía no existe
    open(os.path.join(out, "LOTE.txt"), "w").write(" ".join(order_by_links(adds) + cors + vs))
    save(out, "APARTE.json", aparte)
    print(f"  {len(adds)} adiciones · {len(cors)} correcciones · {len(vs)} verificado · aparte: "
          f"{len(aparte['titulos'])} títulos, {len(aparte['objetivos_de_area'])} objetivos de área")
    for w in warn:
        print(f"  ⚠ {w}")
    big = len(adds) + len(cors) + len(vs)
    print(f"  → ensayo: CANON_TIMEOUT={max(5, big // 20 + 3)}m make canon-write DRY=1 PIECE=\"$(cat {out}/LOTE.txt)\"")


def order_by_links(paths):
    """Una adición que enlaza a otra del mismo lote va DESPUÉS: el lint valida pieza por pieza y un enlace a una
    sección que todavía no entró lo rechaza (pasó con la del usuario temporal y la del link de continuación)."""
    info = {}
    for p in paths:
        d = json.load(open(p))
        text = open(os.path.join(os.path.dirname(p), d["text_file"])).read()
        info[p] = (f"{d['node']}#{anchor(d['section'])}", set(re.findall(r"\[\[([^\]]+)\]\]", text)))
    out, done = [], set()
    def visit(p, stack=()):
        if p in stack:  # dos secciones nuevas que se enlazan entre sí: ningún orden pasa el lint pieza por pieza
            print(f"  ⚠ ciclo de enlaces entre piezas nuevas: {', '.join(os.path.basename(x) for x in stack + (p,))} — sacá uno de los dos enlaces")
            return
        if p in done:
            return
        for q in paths:
            if q != p and info[q][0] in info[p][1]:
                visit(q, stack + (p,))
        done.add(p); out.append(p)
    for p in paths:
        visit(p)
    return out


# ── movidos ─────────────────────────────────────────────────────────────────────────────────────────

def step_movidos(args):
    d = run_dir(args)
    gone = [f for f in load(d, "files.json") if not f["exists"]]
    if not gone:
        print("  no hay archivos movidos ni borrados"); return
    dst = os.path.join(d, "corpus-movidos")
    if os.path.exists(dst):
        die(f"{dst} ya existe: un export viejo va atrás, borralo y repetí")
    canon("export", "-out", dst)
    for f in gone:
        mv = f["moved"] or {}
        if not mv.get("to"):
            print(f"  ⚠ {f['repo']}:{f['path']} se borró sin renombre ({mv.get('subject', '')}): decidí a mano su reemplazo"
                  + (f"; el mismo commit agregó {mv['added'][:3]}" if mv.get("added") else "")); continue
        h = git(f["repo"], "rev-parse", f"{REF}:{mv['to']}").strip()[:12]
        for t in f["topics"]:
            p = os.path.join(dst, "content", t, "map.json")
            raw = open(p).read()
            # el mapa se edita como TEXTO: un json.dump reordena y vuelve ilegible el diff
            new = re.sub(r'"' + re.escape(f["path"]) + r'":\s*"\w+"', f'"{mv["to"]}": "{h}"', raw)
            if new != raw:
                open(p, "w").write(new); print(f"  {t}: {f['path'].split('/')[-1]} → {mv['to']} ({h})")
    reason = "Reapunta en el mapa los archivos que main movió"
    cmd = ["make", "-C", MY_TOOLS, "canon-patch", f"DIR={dst}", f"REASON={reason}"] + (["APPLY=1"] if args.apply else [])
    print(subprocess.run(cmd, capture_output=True, text=True).stdout[-1500:])


# ── estado ──────────────────────────────────────────────────────────────────────────────────────────

def step_estado(args):
    d = run_dir(args)
    has = lambda p: os.path.exists(os.path.join(d, p))
    count = lambda sub: len([n for n in os.listdir(os.path.join(d, sub)) if n.startswith("resultado-")]) if has(sub) else 0
    print(f"corrida {d}")
    if has("foto.json"):
        f = load(d, "foto.json"); print(f"  foto {f['at']} · revisión {f['revision']}")
    for name, ok in [("paquete", has("secciones.json")), ("triaje (agentes)", count("triaje")),
                     ("código y segunda (agentes)", count("codigo") and count("segunda")),
                     ("final", has("final.json")), ("piezas", has("piezas/LOTE.txt"))]:
        print(f"  {'✓' if ok else '·'} {name}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paso", choices=["foto", "paquete", "triaje", "codigo", "final", "piezas", "movidos", "estado"])
    ap.add_argument("--run", help="carpeta de la corrida (por defecto, runs/ACTUAL)")
    ap.add_argument("--grupos", type=int, default=8, help="cuántos paquetes para agentes")
    ap.add_argument("--apply", action="store_true", help="movidos: publicar el canon-patch")
    args = ap.parse_args()
    globals()[f"step_{args.paso}"](args)


if __name__ == "__main__":
    main()
