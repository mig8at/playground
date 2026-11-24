"""Documentos de referencia de prueba para el asistente de plantillas (tarea pdf-mapper-plantillas).

Imitan lo que manda una entidad: un formulario por recuadros, un plan de pagos en tabla, un pagaré con blancos y una
autorización en Word. Cada uno junta los casos difíciles a propósito. La entidad es ficticia («Banco Ejemplo»).

Convenciones de marcado que usan (las que el asistente tiene que reconocer):
- `[Marcador]`             un dato de texto.
- `____` con un rótulo     un dato de texto sin marcador: el rótulo de al lado dice cuál es.
- `[ ] Opción`, `( ) Opción` una casilla; las del mismo renglón son UNA pregunta con varias opciones.
- `[Plan.Columna]`         la fila modelo de una tabla: las filas de abajo repiten las columnas.
- `[Firma…]`, `[Huella]`   la zona de la firma: no es un dato.

Uso: python build_references.py <carpeta de salida>
"""
import sys
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT.mkdir(parents=True, exist_ok=True)
W, H = letter
M = 18 * mm
BRAND = (0.11, 0.30, 0.55)


def header(c, title, code):
    c.setFillColorRGB(*BRAND)
    c.rect(M, H - M - 12 * mm, 12 * mm, 12 * mm, fill=1, stroke=0)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(M + 15 * mm, H - M - 5 * mm, "Banco Ejemplo S.A.")
    c.setFont("Helvetica", 8)
    c.setFillColorRGB(0.35, 0.35, 0.35)
    c.drawString(M + 15 * mm, H - M - 10 * mm, "Entidad ficticia para pruebas · NIT 900.000.000-0")
    c.drawRightString(W - M, H - M - 5 * mm, code)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W / 2, H - M - 22 * mm, title)
    return H - M - 30 * mm


def footer(c, code, page, total):
    c.setFont("Helvetica", 7)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawString(M, 10 * mm, code)
    c.drawRightString(W - M, 10 * mm, f"Página {page} de {total}")
    c.setFillColorRGB(0, 0, 0)


def section(c, y, text):
    c.setFillColorRGB(*BRAND)
    c.rect(M, y - 5 * mm, W - 2 * M, 6 * mm, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(M + 2 * mm, y - 3.2 * mm, text)
    c.setFillColorRGB(0, 0, 0)
    return y - 8 * mm


def box(c, x, y, w, label, value, h=10 * mm):
    """Un recuadro con el rótulo arriba (chico) y el marcador adentro."""
    c.setLineWidth(0.5)
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.rect(x, y - h, w, h)
    c.setFont("Helvetica", 6.5)
    c.setFillColorRGB(0.35, 0.35, 0.35)
    c.drawString(x + 1.5 * mm, y - 3 * mm, label)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 9)
    c.drawString(x + 1.5 * mm, y - h + 2.5 * mm, value)


def row_boxes(c, y, items, h=10 * mm):
    """Recuadros en un renglón: items = [(ancho relativo, rótulo, marcador)]."""
    total = sum(i[0] for i in items)
    x = M
    for rel, label, value in items:
        w = (W - 2 * M) * rel / total
        box(c, x, y, w, label, value, h)
        x += w
    return y - h


def checks(c, x, y, question, options, size=9):
    c.setFont("Helvetica", size)
    c.drawString(x, y, question)
    x += c.stringWidth(question, "Helvetica", size) + 3 * mm
    for opt in options:
        c.drawString(x, y, opt)
        x += c.stringWidth(opt, "Helvetica", size) + 5 * mm
    return y - 6 * mm


# ── 1 · Formulario de vinculación (recuadros, casillas, fechas partidas, dos páginas) ─────────────────────────────
def vinculacion():
    code = "BE-VIN-001 · Versión 03-2026"
    c = canvas.Canvas(str(OUT / "vinculacion-ejemplo.pdf"), pagesize=letter)
    y = header(c, "FORMULARIO DE VINCULACIÓN PERSONA NATURAL", code)
    y = row_boxes(c, y, [(1, "Fecha de diligenciamiento (DD/MM/AAAA)", "[DiaSolicitud] / [MesSolicitud] / [AnioSolicitud]"), (1, "Ciudad", "[CiudadSolicitud]"), (1, "Código de cliente", "[CodigoCliente]")])
    y -= 4 * mm
    y = section(c, y, "1. DATOS PERSONALES")
    y = row_boxes(c, y, [(1, "Primer nombre", "[PrimerNombre]"), (1, "Segundo nombre", "[SegundoNombre]"), (1, "Primer apellido", "[PrimerApellido]"), (1, "Segundo apellido", "[SegundoApellido]")])
    y -= 3 * mm
    y = checks(c, M, y - 3 * mm, "Tipo de documento:", ["[ ] C.C.", "[ ] T.I.", "[ ] C.E.", "[ ] Pasaporte"])
    y = row_boxes(c, y, [(1, "Número de documento", "[NumeroDocumento]"), (1, "Fecha de expedición", "[FechaExpedicion]"), (1, "Lugar de expedición", "[LugarExpedicion]")])
    y = row_boxes(c, y, [(1, "Fecha de nacimiento (DD MM AAAA)", "[DiaNacimiento]   [MesNacimiento]   [AnioNacimiento]"), (1, "Lugar de nacimiento", "[LugarNacimiento]"), (1, "Nacionalidad", "[Nacionalidad]")])
    y -= 3 * mm
    y = checks(c, M, y - 3 * mm, "Género:", ["( ) Femenino", "( ) Masculino", "( ) Otro"])
    y = row_boxes(c, y, [(3, "Dirección de residencia", "[DireccionResidencia]"), (1, "Ciudad", "[CiudadResidencia]"), (1, "Departamento", "[DepartamentoResidencia]")])
    y = row_boxes(c, y, [(1, "Celular", "[Celular]"), (1, "Teléfono fijo", "[Telefono]"), (2, "Correo electrónico", "[Correo]")])
    y -= 4 * mm
    y = section(c, y, "2. ACTIVIDAD ECONÓMICA E INGRESOS")
    y = checks(c, M, y - 3 * mm, "Ocupación:", ["[ ] Empleado", "[ ] Independiente", "[ ] Pensionado", "[ ] Rentista", "[ ] Estudiante", "[ ] Otro"])
    y = row_boxes(c, y, [(2, "Empresa donde trabaja", "[EmpresaEmpleador]"), (1, "Cargo", "[Cargo]"), (1, "Código CIIU", "[CodigoCIIU]")])
    y = row_boxes(c, y, [(1, "Ingresos mensuales", "$ [IngresosMensuales]"), (1, "Egresos mensuales", "$ [EgresosMensuales]"), (1, "Otros ingresos", "$ [OtrosIngresos]"), (1, "Total activos", "$ [TotalActivos]")])
    footer(c, code, 1, 2)
    c.showPage()

    y = header(c, "FORMULARIO DE VINCULACIÓN PERSONA NATURAL", code)
    y = section(c, y, "3. PERSONAS EXPUESTAS POLÍTICAMENTE (PEP)")
    y = checks(c, M, y - 3 * mm, "¿Ejerce o ha ejercido un cargo público de alto nivel?", ["[ ] Sí", "[ ] No"])
    y = checks(c, M, y, "¿Goza de reconocimiento público?", ["[ ] Sí", "[ ] No"])
    y = checks(c, M, y, "¿Administra o maneja recursos públicos?", ["[ ] Sí", "[ ] No"])
    y = checks(c, M, y, "¿Tiene vínculo familiar con una persona PEP?", ["[ ] Sí", "[ ] No"])
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(M, y - 1 * mm, "Si respondió «Sí» a alguna de las anteriores, indique el cargo y la entidad:")
    y -= 4 * mm
    y = row_boxes(c, y, [(1, "Cargo o vínculo", "[CargoPEP]"), (1, "Entidad", "[EntidadPEP]")])
    y -= 4 * mm
    y = section(c, y, "4. AUTORIZACIONES")
    c.setFont("Helvetica", 8.5)
    text = c.beginText(M, y - 2 * mm)
    text.setLeading(11)
    for line in [
        "Autorizo a BANCO EJEMPLO S.A. para consultar, reportar y procesar mi información en las centrales de riesgo, y para",
        "tratar mis datos personales según su política de tratamiento de datos, que declaro conocer.",
    ]:
        text.textLine(line)
    c.drawText(text)
    y -= 13 * mm
    y = checks(c, M, y, "Autorizo el tratamiento de mis datos personales:", ["[ ] Acepto"])
    y = checks(c, M, y, "Acepto recibir publicidad e información comercial:", ["[ ] Sí", "[ ] No"])
    y -= 6 * mm
    y = section(c, y, "5. FIRMA")
    y -= 22 * mm
    c.setLineWidth(0.6)
    c.setStrokeColorRGB(0, 0, 0)
    c.line(M, y, M + 80 * mm, y)
    c.setFont("Helvetica", 7)
    c.drawString(M, y + 2 * mm, "[FirmaCliente]")
    c.setFont("Helvetica", 9)
    c.drawString(M, y - 5 * mm, "Nombre: [NombreCompleto]")
    c.drawString(M, y - 10 * mm, "C.C. [NumeroDocumento]")
    c.rect(W - M - 25 * mm, y - 12 * mm, 25 * mm, 30 * mm)
    c.setFont("Helvetica", 7)
    c.drawCentredString(W - M - 12.5 * mm, y - 15 * mm, "[Huella]")
    footer(c, code, 2, 2)
    c.save()


# ── 2 · Plan de pagos (tabla con fila modelo) ─────────────────────────────────────────────────────────────────────
def plan_de_pagos():
    code = "BE-PLA-002 · Versión 01-2026"
    c = canvas.Canvas(str(OUT / "plan-de-pagos-ejemplo.pdf"), pagesize=letter)
    y = header(c, "PLAN DE PAGOS", code)
    c.setFont("Helvetica", 9)
    lines = [
        ("Cliente:", "[NombreCompleto]", "Documento:", "[NumeroDocumento]"),
        ("Valor del crédito:", "$ [MontoCredito]", "Plazo:", "[Plazo] meses"),
        ("Tasa nominal mes vencido:", "[TasaNMV] %", "Tasa efectiva anual:", "[TasaEA] %"),
        ("Fecha de desembolso:", "[FechaDesembolso]", "Día de pago:", "[DiaPago] de cada mes"),
    ]
    for a, b, d, e in lines:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(M, y, a)
        c.drawString(W / 2 + 5 * mm, y, d)
        c.setFont("Helvetica", 9)
        c.drawString(M + 45 * mm, y, b)
        c.drawString(W / 2 + 40 * mm, y, e)
        y -= 6 * mm
    y -= 4 * mm
    cols = [("N°", 0.6, "[Plan.Numero]"), ("Fecha", 1.1, "[Plan.Fecha]"), ("Saldo inicial", 1.3, "[Plan.SaldoInicial]"),
            ("Capital", 1.1, "[Plan.Capital]"), ("Interés", 1.0, "[Plan.Interes]"), ("Seguro", 0.9, "[Plan.Seguro]"),
            ("Fianza", 0.9, "[Plan.Fianza]"), ("Cuota", 1.1, "[Plan.Cuota]"), ("Saldo final", 1.3, "[Plan.SaldoFinal]")]
    total = sum(w for _, w, _ in cols)
    widths = [(W - 2 * M) * w / total for _, w, _ in cols]
    row_h = 6.5 * mm
    rows = 12
    c.setFillColorRGB(*BRAND)
    c.rect(M, y - row_h, W - 2 * M, row_h, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 7.5)
    x = M
    for (name, _, _), w in zip(cols, widths):
        c.drawCentredString(x + w / 2, y - row_h + 2.2 * mm, name)
        x += w
    c.setFillColorRGB(0, 0, 0)
    top = y - row_h
    c.setLineWidth(0.4)
    c.setStrokeColorRGB(0.65, 0.65, 0.65)
    for r in range(rows + 1):
        c.line(M, top - r * row_h, W - M, top - r * row_h)
    x = M
    for w in widths + [0]:
        c.line(x, top, x, top - rows * row_h)
        x += w
    c.setFont("Helvetica", 6.5)
    x = M
    for (_, _, marker), w in zip(cols, widths):
        c.drawString(x + 1 * mm, top - row_h + 2.2 * mm, marker)
        x += w
    y = top - rows * row_h - 8 * mm
    c.setFont("Helvetica", 8)
    c.drawString(M, y, "La primera fila es el modelo: las siguientes repiten sus columnas, una por cuota.")
    y -= 5 * mm
    c.setFont("Helvetica-Bold", 9)
    c.drawString(M, y, "Total a pagar: $ [TotalPagar]")
    footer(c, code, 1, 1)
    c.save()


# ── 3 · Pagaré (blancos con rótulo, montos en letras, nombre repetido, casilla condicional) ───────────────────────
def pagare():
    code = "BE-PAG-003 · Versión 02-2026"
    c = canvas.Canvas(str(OUT / "pagare-ejemplo.pdf"), pagesize=letter)
    y = header(c, "PAGARÉ N° ______________", code)
    c.setFont("Helvetica", 9.5)
    paras = [
        "Yo, ______________________________________, mayor de edad, identificado con cédula de ciudadanía",
        "N° ____________________ expedida en ____________________, domiciliado en la ciudad de __________________,",
        "me obligo a pagar incondicionalmente a la orden de BANCO EJEMPLO S.A. la suma de",
        "_____________________________________________________________________ pesos ($ __________________),",
        "en _______ cuotas mensuales de $ ________________ cada una, a partir del ____ de ______________ de ________.",
        "",
        "Sobre el capital adeudado reconoceré intereses a la tasa de ______ % efectiva anual. En caso de mora, pagaré",
        "intereses a la tasa máxima legal permitida.",
        "",
        "El presente pagaré se otorga:   ( ) Con codeudor    ( ) Sin codeudor",
        "",
        "Si se otorga con codeudor: Nombre del codeudor ______________________________ C.C. N° _______________",
        "Dirección del codeudor __________________________________________________________________",
        "",
        "Para constancia se firma en la ciudad de __________________ a los ____ días del mes de ______________",
        "de ________.",
    ]
    text = c.beginText(M, y)
    text.setLeading(15)
    for line in paras:
        text.textLine(line)
    c.drawText(text)
    y -= len(paras) * 15 + 30 * mm
    for i, who in enumerate(["EL DEUDOR", "EL CODEUDOR"]):
        x = M + i * 90 * mm
        c.line(x, y, x + 70 * mm, y)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x, y - 4 * mm, who)
        c.setFont("Helvetica", 8)
        c.drawString(x, y - 9 * mm, "Nombre: ______________________________")
        c.drawString(x, y - 14 * mm, "C.C. N° ____________________")
    footer(c, code, 1, 1)
    c.save()


# ── 4 · Autorización de descuento en Word (para el paso de conversión) ─────────────────────────────────────────────
def autorizacion_word():
    from docx import Document
    from docx.shared import Pt

    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(10)
    doc.add_heading("AUTORIZACIÓN DE DESCUENTO POR LIBRANZA", level=1)
    doc.add_paragraph("Banco Ejemplo S.A. · Entidad ficticia para pruebas · BE-LIB-004")
    doc.add_paragraph(
        "Yo, [NombreCompleto], identificado con [TipoDocumento] N° [NumeroDocumento], autorizo de forma libre, "
        "voluntaria e irrevocable a mi empleador [EmpresaEmpleador], NIT [NitEmpleador], para que descuente de mi "
        "salario la suma de $ [ValorCuota] ([ValorCuotaLetras] pesos) mensuales, durante [Plazo] meses, y la gire a "
        "BANCO EJEMPLO S.A."
    )
    doc.add_paragraph("Tipo de vinculación con el empleador:   [ ] Término indefinido   [ ] Término fijo   [ ] Prestación de servicios")
    table = doc.add_table(rows=3, cols=2)
    table.style = "Table Grid"
    for r, (a, b) in enumerate([("Cargo", "[Cargo]"), ("Salario básico", "$ [IngresosMensuales]"), ("Fecha de ingreso", "[FechaIngreso]")]):
        table.cell(r, 0).text = a
        table.cell(r, 1).text = b
    doc.add_paragraph("")
    doc.add_paragraph("Firmado en [CiudadFirma], el [DiaFirma] de [MesFirma] de [AnioFirma].")
    doc.add_paragraph("\n\n______________________________\n[FirmaCliente]\n[NombreCompleto]\nC.C. [NumeroDocumento]")
    doc.save(str(OUT / "autorizacion-libranza-ejemplo.docx"))


if __name__ == "__main__":
    vinculacion()
    plan_de_pagos()
    pagare()
    autorizacion_word()
    print("\n".join(sorted(p.name for p in OUT.iterdir() if p.suffix in (".pdf", ".docx"))))
