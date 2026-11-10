#!/usr/bin/env python3
"""knowledge-deriva: poner knowledge/ al día contra main con el mismo método jerárquico que canon-deriva.

knowledge/ es la biblioteca LOCAL del día a día (canon es la del equipo). Sus fuentes son más precisas que las
de canon: cada una guarda el COMMIT y el blob con que se leyó y qué secciones respalda, así que el diff sale
exacto, sin buscar el blob en la historia.

    paquete     make knowledge-check (con las refs que ya resuelve) → fuentes cambiadas o perdidas → diffs, PRs y
                secciones; y los paquetes del triaje SIN código (prompts/k-triaje.md)
    codigo      con el triaje hecho: paquetes de código (diff bajo demanda) y de segunda mirada a ciegas
    final       junta código, segunda mirada y overrides.json
    aplicar     escribe rules.md y sources.json: el texto nuevo de cada sección, el título si cambió (y su ancla en
                las fuentes), y commit + blob al día de cada fuente releída; reapunta las movidas. Después:
                make knowledge-check y make knowledge-test

⚠ Antes de `paquete`, los clones de trabajo tienen que tener su origin al día (`git fetch`): knowledge-check no
hace fetch, y un clon atrasado devuelve MENOS deriva sin avisar.
"""
import argparse, collections, datetime, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import deriva  # noqa: E402  (anchor, bins, body_of, order helpers)

PLAYGROUND = deriva.PLAYGROUND
KN = os.path.join(PLAYGROUND, "knowledge")
WORK = os.path.join(deriva.WORK, "runs-knowledge")


def repo_dirs():
    d = json.load(open(os.path.join(PLAYGROUND, "tools", "repos.json")))
    out = {}
    for group in ("indexed", "citable_only"):
        for k, v in (d.get(group) or {}).items():
            out[k] = os.path.expanduser(v) if v.startswith("~") else os.path.join(PLAYGROUND, v)
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
            cur = deriva.anchor(line[3:]); out[cur] = [line]
        elif cur:
            out[cur].append(line)
    return {k: "\n".join(v).strip() for k, v in out.items()}


# ── paquete ─────────────────────────────────────────────────────────────────────────────────────────

def fetch_all():
    """Todos los clones de trabajo, no sólo los citados: un agente que mira un repo vecino (messaging-service)
    con su origin atrasado 18 días afirmó que una ruta no existía. El fetch sólo mueve refs remotas."""
    def one(item):
        k, p = item
        if os.path.isdir(os.path.join(p, ".git")):
            subprocess.run(["git", "-C", p, "fetch", "-q", "origin"], capture_output=True)
    gh = os.path.expanduser("~/Desktop/CREDITOP/github")
    extra = {n: os.path.join(gh, n) for n in os.listdir(gh)}
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(one, {**extra, **repo_dirs()}.items()))


def step_paquete(args):
    d = run_dir(args, create=True)
    fetch_all()
    check = json.loads(sh(["go", "run", "./cmd/knowledge", "check", "--json"], cwd=PLAYGROUND) or "[]")
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

    def pulls(rc):
        f, sha = rc
        full = sh(["git", "-C", f["dir"], "rev-parse", sha]).strip()
        slug = os.path.basename(f["dir"])
        r = subprocess.run(["gh", "api", f"repos/Creditop-SAS/{slug}/commits/{full}/pulls"], capture_output=True, text=True)
        data = json.loads(r.stdout) if r.returncode == 0 else []
        return (slug, sha), [p["number"] for p in data if p.get("merged_at")] or [p["number"] for p in data]

    keys = {(os.path.basename(f["dir"]), c["sha"]): f for f in files for c in f["commits"]}
    with ThreadPoolExecutor(8) as ex:
        c2p = dict(ex.map(pulls, [(f, k[1]) for k, f in keys.items()]))

    def pr(rn):
        slug, n = rn
        x = json.loads(sh(["gh", "api", f"repos/Creditop-SAS/{slug}/pulls/{n}"]) or "{}")
        return f"{slug}#{n}", dict(title=x.get("title"), body=(x.get("body") or "").strip())

    with ThreadPoolExecutor(8) as ex:
        prs = dict(ex.map(pr, sorted({(s, n) for (s, _), ns in c2p.items() for n in ns})))
    for f in files:
        slug = os.path.basename(f["dir"])
        f["prs"] = sorted({f"{slug}#{n}" for c in f["commits"] for n in c2p.get((slug, c["sha"]), [])})
    save(d, "files.json", files)
    save(d, "prs.json", prs)

    items = {}
    for t in sorted({f["topic"] for f in files}):
        secs = sections_of(t)
        for f in (f for f in files if f["topic"] == t):
            for a in f["sections"]:
                if a not in secs:
                    print(f"  ⚠ {t}: la fuente {f['path']} respalda «{a}», que no existe en rules.md"); continue
                it = items.setdefault(f"{t}#{a}", dict(topic=t, prose=secs[a], files=[], prs=[]))
                key = f"{f['repo']}:{f['path']}"
                if key not in it["files"]:
                    it["files"].append(key)
                it["prs"] = sorted(set(it["prs"]) | set(f["prs"]))
    save(d, "secciones.json", items)
    stat = {f"{f['repo']}:{f['path']}": (f"{f['diff_lines']} líneas de diff" if f["exists"] else
            f"YA NO ESTÁ EN MAIN → {(f['moved'] or {}).get('to') or 'borrado'}") for f in files}
    by_topic = collections.defaultdict(list)
    for k, v in items.items():
        by_topic[v["topic"]].append(k)
    size = lambda t: sum(len(items[k]["prose"]) for k in by_topic[t]) + sum(len(deriva.body(prs, p)) for k in by_topic[t] for p in items[k]["prs"])
    os.makedirs(os.path.join(d, "triaje"), exist_ok=True)
    for g, topics in enumerate(deriva.bins(list(by_topic), args.grupos, size), 1):
        o, used = [], set()
        for t in sorted(topics):
            o.append(f"\n\n# TEMA {t}")
            for k in by_topic[t]:
                s = items[k]
                o.append(f"\n## ÍTEM {k}\n{s['prose']}\n\narchivos que cambiaron:")
                o += [f"- {f} — {stat[f]}" for f in s["files"]]
                o.append("PRs: " + ", ".join(s["prs"]))
                used |= set(s["prs"])
        o.append("\n\n# PRs (título y descripción)")
        o += [f"\n## {p} — {(prs.get(p) or {}).get('title')}\n{deriva.body(prs, p)}" for p in sorted(used)]
        open(os.path.join(d, "triaje", f"grupo-{g}.md"), "w").write("\n".join(o))
        print(f"  triaje/grupo-{g}.md · {sum(len(by_topic[t]) for t in topics)} ítems · ~{len(chr(10).join(o)) // 4:,} tokens")
    print(f"corrida {d}: {len(files)} fuentes · {len(items)} secciones · {len(prs)} PRs")


# ── codigo ──────────────────────────────────────────────────────────────────────────────────────────

def step_codigo(args):
    d = run_dir(args)
    items, files = load(d, "secciones.json"), {f"{f['repo']}:{f['path']}": f for f in load(d, "files.json")}
    tri = [x for n in sorted(os.listdir(os.path.join(d, "triaje"))) if n.startswith("resultado-")
           for x in json.load(open(os.path.join(d, "triaje", n)))]
    missing = set(items) - {x["id"] for x in tri}
    if missing:
        deriva.die(f"al triaje le faltan {len(missing)} ítems: {sorted(missing)[:3]}")
    save(d, "triaje.json", tri)
    cmd = lambda f: (f"`git -C {f['dir']} diff {f['base']} {f['ref']} -- {f['path']}`" if f["exists"]
                     else f"YA NO ESTÁ EN MAIN → {(f['moved'] or {}).get('to') or 'borrado'} ({(f['moved'] or {}).get('subject', '')})")
    open_ = {x["id"]: x for x in tri if x["veredicto"] != "no_toca"}
    by_topic = collections.defaultdict(list)
    for i in open_:
        by_topic[items[i]["topic"]].append(i)
    os.makedirs(os.path.join(d, "codigo"), exist_ok=True)
    order = {"contradice": 0, "no_se_sabe": 1}
    for g, topics in enumerate(deriva.bins(list(by_topic), args.grupos, lambda t: sum(len(items[i]["prose"]) for i in by_topic[t])), 1):
        ids = sorted([i for t in topics for i in by_topic[t]], key=lambda i: (order.get(open_[i]["veredicto"], 2), i))
        o = [f"# Paquete de código {g}: {len(ids)} ítems\n"]
        for i in ids:
            o.append(f"\n## ÍTEM {i} — triaje: {open_[i]['veredicto']}\n{items[i]['prose']}\n\n> triaje: {open_[i].get('por_que', '')}\n> mirar: {open_[i].get('mirar', '')}\narchivos:")
            o += [f"- {f}: {cmd(files[f])}" for f in items[i]["files"]]
        o.append(f"\nDescripciones de PR: `{os.path.join(d, 'prs.json')}`.")
        open(os.path.join(d, "codigo", f"paquete-{g}.md"), "w").write("\n".join(o))
        print(f"  codigo/paquete-{g}.md · {len(ids)} ítems")
    blind = sorted(x["id"] for x in tri if x["veredicto"] == "no_toca")
    os.makedirs(os.path.join(d, "segunda"), exist_ok=True)
    bt = collections.defaultdict(list)
    for i in blind:
        bt[items[i]["topic"]].append(i)
    for g, topics in enumerate(deriva.bins(list(bt), max(1, args.grupos // 2), lambda t: len(bt[t])), 1):
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
        deriva.die(f"sin veredicto final: {sorted(missing)[:5]}")
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
            start = next(n for n, l in enumerate(lines) if l.startswith("## ") and deriva.anchor(l[3:]) == a)
            end = next((n for n in range(start + 1, len(lines)) if lines[n].startswith("## ")), len(lines))
            title = x.get("titulo_nuevo") or lines[start][3:].strip()
            if x.get("titulo_nuevo"):
                renames[a] = deriva.anchor(title)
            body = deriva.body_of(x["texto_nuevo"])
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
    ap.add_argument("--grupos", type=int, default=8)
    args = ap.parse_args()
    globals()[f"step_{args.paso}"](args)


if __name__ == "__main__":
    main()
