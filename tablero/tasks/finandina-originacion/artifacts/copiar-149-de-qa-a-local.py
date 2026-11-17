# Copia la configuración de la entidad 149 de qa (solo lectura) a la base LOCAL.
import json, subprocess, sys
PG = "/Users/miguelochoa/Desktop/CREDITOP/my-tools/bin/pg"
L = 149
def qa(q):
    out = subprocess.run([PG, "sql", "--target", "qa", "--json", "--query", q], capture_output=True, text=True, check=True).stdout
    return json.loads(out)["rows"]
def local_cols(t):
    out = mysql(f"SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='creditop' AND TABLE_NAME='{t}'", capture=True)
    return [l for l in out.split("\n") if l]
def mysql(sql, capture=False):
    r = subprocess.run(["docker", "exec", "-i", "legacy-backend-mysql-1", "sh", "-c", 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" creditop -N -B'], input=sql, capture_output=True, text=True)
    if r.returncode: sys.exit(r.stderr)
    return r.stdout
def lit(v):
    if v is None: return "NULL"
    if isinstance(v, bool): return "1" if v else "0"
    if isinstance(v, (int, float)): return repr(v)
    if isinstance(v, (dict, list)): v = json.dumps(v, ensure_ascii=False)
    s = str(v)
    if s.endswith(" +0000 UTC"): s = s[:-10]
    import re
    m = re.fullmatch(r"(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(\.\d+)?Z", s)
    if m: s = m.group(1) + " " + m.group(2)
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"
def insert(t, row, cols, drop_id=True):
    ks = [k for k in row if k in cols and not (drop_id and k == "id")]
    return f"INSERT INTO `{t}` ({','.join('`'+k+'`' for k in ks)}) VALUES ({','.join(lit(row[k]) for k in ks)});"
stmts = ["SET FOREIGN_KEY_CHECKS=0;", "START TRANSACTION;"]
# la fila de la entidad
lr = qa(f"SELECT * FROM lenders WHERE id={L}")[0]; lc = local_cols("lenders")
stmts.append(f"UPDATE lenders SET " + ",".join(f"`{k}`={lit(v)}" for k, v in lr.items() if k in lc and k != "id") + f" WHERE id={L};")
# perfiles y sus reglas, con ids nuevos
cats = qa(f"SELECT * FROM lender_users_categories WHERE lender_id={L}"); cc = local_cols("lender_users_categories")
rules = qa(f"SELECT * FROM lender_users_category_rules WHERE lender_id={L}"); rc = local_cols("lender_users_category_rules")
stmts.append(f"DELETE r FROM lender_users_category_rules r JOIN lender_users_categories c ON c.id=r.lender_users_category_id WHERE c.lender_id={L};")
stmts.append(f"DELETE FROM lender_users_category_rules WHERE lender_id={L};")
stmts.append(f"DELETE FROM lender_users_categories WHERE lender_id={L};")
for c in cats:
    stmts.append(insert("lender_users_categories", c, cc)); stmts.append(f"SET @c{c['id']} = LAST_INSERT_ID();")
for r in rules:
    s = insert("lender_users_category_rules", r, rc)
    ks = [k for k in r if k in rc and k != "id"]
    vals = [f"@c{r[k]}" if k == "lender_users_category_id" else lit(r[k]) for k in ks]
    stmts.append(f"INSERT INTO lender_users_category_rules ({','.join('`'+k+'`' for k in ks)}) VALUES ({','.join(vals)});")
# tablas que cuelgan sólo de la entidad
for t in ["lender_rules", "lender_datacredito_rules", "lender_requirements", "credit_line_by_lenders", "lender_identity_validation_types"]:
    w = " AND group_rule_id IS NULL" if t == "lender_rules" else (" AND allied_branch_id IS NULL" if t == "lender_datacredito_rules" else ""); rows = qa(f"SELECT * FROM {t} WHERE lender_id={L}{w}"); cols = local_cols(t)
    stmts.append(f"DELETE FROM {t} WHERE lender_id={L}" + (" AND group_rule_id IS NULL" if t == "lender_rules" else "") + ";")
    stmts += [insert(t, r, cols) for r in rows]
    print(t, len(rows), file=sys.stderr)
print("categorías", len(cats), "reglas de perfil", len(rules), file=sys.stderr)
stmts.append("COMMIT;")
sql = "\n".join(stmts)
open(sys.argv[1], "w").write(sql)
if len(sys.argv) > 2 and sys.argv[2] == "apply": mysql(sql); print("aplicado", file=sys.stderr)
