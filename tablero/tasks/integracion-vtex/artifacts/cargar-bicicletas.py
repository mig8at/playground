"""Carga las 6 bicicletas de prueba en el catálogo de la cuenta VTEX creditop: categorías «Bicicletas > Adultos» e
«Infantiles y juveniles», marca «Creditop Pruebas», y por bicicleta su SKU, imagen, precio (COP) y 10 unidades en el
almacén 1_1. Idempotente por RefId: lo que ya existe no se duplica. Son los mismos productos que en la tienda de
Shopify (shopping/productos.txt).

⚠ El catálogo, los precios y el inventario son de TODA la cuenta creditop (también master), no del workspace.

Uso (con la sesión de VTEX abierta: `vtex login creditop` y `vtex use migueldev`):
    python3 tablero/tasks/integracion-vtex/artifacts/cargar-bicicletas.py
Deja los ids creados en cargar-bicicletas.log.json, al lado del script (fuera de git)."""
import json, os, subprocess, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
# El token de la sesión del toolbelt de VTEX; vence con la sesión.
TOKEN = subprocess.run(["vtex", "local", "token"], capture_output=True, text=True).stdout.strip().splitlines()[-1]
# Las imágenes salen del CDN de Shopify (las mismas de la tienda de pruebas); el catálogo de VTEX sólo acepta una URL.
IMAGES = {
    "BICI-MTB29-AZ": "https://cdn.shopify.com/s/files/1/0965/8512/2095/files/BICI-MTB29-AZ.webp?v=1793035344",
    "BICI-URB-NG": "https://cdn.shopify.com/s/files/1/0965/8512/2095/files/BICI-URB-NG.webp?v=1793035348",
    "BICI-PAS-RS": "https://cdn.shopify.com/s/files/1/0965/8512/2095/files/BICI-PAS-RS.webp?v=1793035352",
    "BICI-URB-TQ": "https://cdn.shopify.com/s/files/1/0965/8512/2095/files/BICI-URB-TQ.webp?v=1793035356",
    "BICI-MTB20-NR": "https://cdn.shopify.com/s/files/1/0965/8512/2095/files/BICI-MTB20-NR.webp?v=1793035360",
    "BICI-BMX18-VO": "https://cdn.shopify.com/s/files/1/0965/8512/2095/files/BICI-BMX18-VO.webp?v=1793035365"
}
BASE = "https://creditop.vtexcommercestable.com.br"
PRICING = "https://api.vtex.com/creditop/pricing"
WAREHOUSE, POLICY = "1_1", 1
LOG = os.path.join(HERE, "cargar-bicicletas.log.json")

BIKES = [
    ("BICI-MTB29-AZ", "Bicicleta de Montaña Doble Suspensión Rin 29", 4000000, "Adultos",
     "Color: azul y negro. Doble suspensión, cambios traseros, frenos de disco hidráulicos, rin 29."),
    ("BICI-URB-NG", "Bicicleta Urbana Negra con Parrilla", 3200000, "Adultos",
     "Color: negro. Parrilla trasera, guardabarros, suspensión delantera, frenos de disco."),
    ("BICI-PAS-RS", "Bicicleta de Paseo Rosa Cuadro Bajo", 2800000, "Adultos",
     "Color: rosa. Cuadro bajo de fácil acceso, cambios, frenos de disco."),
    ("BICI-URB-TQ", "Bicicleta Urbana Turquesa", 2400000, "Adultos",
     "Color: turquesa. Liviana, cuadro de aluminio, cambios, frenos de disco."),
    ("BICI-MTB20-NR", "Bicicleta de Montaña Juvenil Rin 20 Negra y Roja", 1100000, "Infantiles y juveniles",
     "Color: negro y rojo. Rin 20, suspensión delantera, cambios, frenos de disco."),
    ("BICI-BMX18-VO", "Bicicleta BMX Infantil Rin 18 Verde Oliva", 800000, "Infantiles y juveniles",
     "Color: verde oliva. Rin 18, manubrio BMX, pata de apoyo."),
]


def call(method, url, body=None, ok404=False):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"VtexIdclientAutCookie": TOKEN, "Content-Type": "application/json",
                                          "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode() or "null"
            try:
                return json.loads(raw)
            except ValueError:
                return raw
    except urllib.error.HTTPError as e:
        if ok404 and e.code == 404:
            return None
        sys.exit(f"{method} {url} → {e.code}: {e.read().decode()[:500]}")


def slug(s):
    import unicodedata, re
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def category(name, father=None):
    tree = call("GET", f"{BASE}/api/catalog_system/pub/category/tree/3")
    nodes = tree if father is None else next((c["children"] for c in tree if c["id"] == father), [])
    for c in nodes:
        if c["name"] == name:
            return c["id"]
    created = call("POST", f"{BASE}/api/catalog/pvt/category", {
        "Name": name, "FatherCategoryId": father, "Title": name, "Description": name, "Keywords": name,
        "IsActive": True, "ShowInStoreFront": True, "ShowBrandFilter": True, "ActiveStoreFrontLink": True,
        # Categoría global = taxonomía de Google; 1026 es «Cycling > Bicycles». 0 no existe y VTEX lo rechaza.
        "GlobalCategoryId": 1026, "Score": None, "LinkId": slug(name)})
    print(f"  categoría creada: {name} ({created['Id']})")
    return created["Id"]


def brand(name):
    for b in call("GET", f"{BASE}/api/catalog_system/pvt/brand/list"):
        if b["name"] == name:
            return b["id"]
    created = call("POST", f"{BASE}/api/catalog/pvt/brand", {"Name": name, "Text": name, "Keywords": name,
                                                               "SiteTitle": name, "Active": True, "LinkId": slug(name)})
    print(f"  marca creada: {name} ({created['Id']})")
    return created["Id"]


def main():
    root = category("Bicicletas")
    cats = {"Adultos": category("Adultos", root), "Infantiles y juveniles": category("Infantiles y juveniles", root)}
    brand_id = brand("Creditop Pruebas")
    log = []
    for ref, name, price, cat, desc in BIKES:
        prod = call("GET", f"{BASE}/api/catalog_system/pvt/products/productgetbyrefid/{ref}", ok404=True)
        if prod and prod.get("Id"):
            pid = prod["Id"]
        else:
            pid = call("POST", f"{BASE}/api/catalog/pvt/product", {
                "Name": name, "CategoryId": cats[cat], "BrandId": brand_id, "RefId": ref, "LinkId": slug(name),
                "Title": name, "Description": desc, "DescriptionShort": desc, "IsVisible": True, "IsActive": True,
                "ShowWithoutStock": True, "KeyWords": "bicicleta"})["Id"]
        call("POST", f"{BASE}/api/catalog/pvt/product/{pid}/salespolicy/{POLICY}")
        sku = call("GET", f"{BASE}/api/catalog/pvt/stockkeepingunit?refId={ref}", ok404=True)
        if sku and sku.get("Id"):
            sid = sku["Id"]
        else:
            sid = call("POST", f"{BASE}/api/catalog/pvt/stockkeepingunit", {
                "ProductId": pid, "IsActive": False, "ActivateIfPossible": True, "Name": name, "RefId": ref,
                "PackagedHeight": 100, "PackagedLength": 170, "PackagedWidth": 25, "PackagedWeightKg": 15,
                "Height": 100, "Length": 170, "Width": 25, "WeightKg": 15})["Id"]
        files = call("GET", f"{BASE}/api/catalog/pvt/stockkeepingunit/{sid}/file", ok404=True) or []
        if not files:
            call("POST", f"{BASE}/api/catalog/pvt/stockkeepingunit/{sid}/file", {
                "IsMain": True, "Label": ref, "Name": ref.lower(), "Text": name, "Url": IMAGES[ref] + "&format=jpg"})
        call("PUT", f"{PRICING}/prices/{sid}", {"basePrice": price, "listPrice": price, "costPrice": price})
        call("PUT", f"{BASE}/api/logistics/pvt/inventory/skus/{sid}/warehouses/{WAREHOUSE}",
             {"quantity": 10, "unlimitedQuantity": False})
        cur = call("GET", f"{BASE}/api/catalog/pvt/stockkeepingunit/{sid}")
        if not cur.get("IsActive"):
            cur["IsActive"] = True
            call("PUT", f"{BASE}/api/catalog/pvt/stockkeepingunit/{sid}", cur)
        print(f"  {ref}: producto {pid} · sku {sid} · ${price:,} · stock 10")
        log.append({"ref": ref, "product": pid, "sku": sid, "price": price})
    json.dump({"categories": {"root": root, **cats}, "brand": brand_id, "bikes": log}, open(LOG, "w"), indent=1)


main()
