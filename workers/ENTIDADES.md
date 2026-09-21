# CreditOp — Ficha de negocio de cada entidad

> **GENERADO — no editar a mano.** Se regenera con `make entidades`.
> Medido contra **producción**, ventana de **90 días**, entidades con **200+ solicitudes**.

Lo que el árbol NO dice: **quién es cada entidad en términos de negocio** — a cuántos comercios
llega, qué ticket maneja, a qué plazo presta, cuánto aprueba y dónde se le cae la gente.

⚠ **Es lo que las entidades HACEN, no lo que son.** Acá no hay descripciones de empresa: nada de
esto sale de una fuente externa, todo sale de la base. Ante conflicto con el código, manda el código.

⚠ **Leé las dos columnas de ocupación juntas.** *Declarada* es la regla configurada; *real* es la de
los créditos que se otorgaron. Cuando difieren, la regla **no está excluyendo** — es el hallazgo
F-162, y leer sólo la declarada lleva a explicaciones falsas.

| entidad | familia | comercios | solicitudes | aprueba | ticket | plazo |
|---|---|---:|---:|---:|---:|---:|
| **Addi** | rt=0 | 46 | 12342 | 28% | $4.2 M | 23 |
| **Welli** | rt=1 | 17 | 3393 | 64% | $5.0 M | 34 |
| **Bancolombia - Crédito de consumo** | rt=1 | 37 | 2940 | 1% | $3.1 M | 60 |
| **Meddipay** | rt=1 | 19 | 2351 | 62% | $3.6 M | 16 |
| **Refurbicredit ecommerce** | rt=2 | 1 | 2121 | 6% | $2.1 M | 10 |
| **CREDIMOVIL** | rt=2 | 1 | 2093 | 77% | $1.4 M | 15 |
| **Bancolombia - Compra y paga después** | rt=1 | 37 | 2085 | 34% | $745.749 | 4 |
| **CrediPullman** | rt=2 | 1 | 895 | 58% | $2.0 M | 10 |
| **Credifamilia** | rt=4 | 4 | 801 | 61% | $4.4 M | 23 |
| **Sistecrédito** | rt=0 | 31 | 643 | 16% | $1.6 M | 6 |
| **Welli Risk** | rt=1 | 1 | 622 | 74% | $4.7 M | 34 |
| **Crédito Directo X** | rt=2 | 1 | 496 | 72% | $1.7 M | 15 |
| **Prami** | rt=1 | 10 | 481 | 57% | $1.9 M | 11 |
| **Credi Free** | rt=3 | 1 | 388 | 49% | $513.786 | 6 |
| **Su+pay** | rt=0 | 6 | 328 | 8% | $1.9 M | 28 |
| **DENTIX FINANCIAL SERVICES** | rt=2 | 1 | 309 | 67% | $2.8 M | 13 |
| **PayJoy** | rt=0 | 1 | 289 | 40% | $917.606 | 16 |
| **Crediemo** | rt=2 | 1 | 264 | 72% | $1.6 M | 10 |
| **Brilla** | rt=0 | 7 | 231 | 80% | $4.2 M | 55 |
| **Motai X** | rt=2 | 1 | 229 | 66% | $6.9 M | 24 |

## Ficha por entidad

### Addi

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 46 comercio(s) · 12342 solicitudes en 90 días
- **Aprueba el 28%** (3396 de 12342)
- **Ticket medio:** $4.2 M · **plazo medio:** 23 cuotas
- **Principales comercios:** Sonría (4056) · Tripleten (3269) · Amoblando Pullman (2510) · Smart Academia de Idiomas (687)
- **Dónde terminan:** Negada 42% · Autorizada 28% · Seleccionó entidad 26% · No terminó proceso 2% · Cancelado 1%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 84% · Independiente 10% · Pensionado 3% · Desempleado 2%

### Welli

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 17 comercio(s) · 3393 solicitudes en 90 días
- **Aprueba el 64%** (2156 de 3393)
- **Ticket medio:** $5.0 M · **plazo medio:** 34 cuotas
- **Principales comercios:** Sonría (2781) · DENTIX (269) · GAES (112) · Boston Medical (75)
- **Dónde terminan:** Autorizada 64% · Pendiente de autorización 24% · Negada 3% · Aprobada no desembolsada 3% · Seleccionó entidad 2%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 89% · Independiente 6% · Pensionado 4% · Desempleado 2%

### Bancolombia - Crédito de consumo

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 37 comercio(s) · 2940 solicitudes en 90 días
- **Aprueba el 1%** (17 de 2940)
- **Ticket medio:** $3.1 M · **plazo medio:** 60 cuotas
- **Principales comercios:** Alkosto (944) · Tripleten (603) · K-TRONIX (447) · Alkomprar (401)
- **Dónde terminan:** Cancelado 32% · Formulario de perfil 28% · Seleccionó entidad 26% · Negada 12% · No terminó proceso 1%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 100%

### Meddipay

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 19 comercio(s) · 2351 solicitudes en 90 días
- **Aprueba el 62%** (1457 de 2351)
- **Ticket medio:** $3.6 M · **plazo medio:** 16 cuotas
- **Principales comercios:** Sonría (1397) · Amoblando Pullman (449) · GAES (141) · Boston Medical (118)
- **Dónde terminan:** Autorizada 62% · Seleccionó entidad 25% · Negada 8% · Aprobada no desembolsada 2% · No terminó proceso 2%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 79% · Independiente 13% · Pensionado 6% · Desempleado 2%

### Refurbicredit ecommerce

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 2121 solicitudes en 90 días
- **Aprueba el 6%** (117 de 2121)
- **Ticket medio:** $2.1 M · **plazo medio:** 10 cuotas
- **Principales comercios:** Refurbi (2121)
- **Dónde terminan:** Seleccionó entidad 79% · Cancelado 15% · Autorizada 6% · Pendiente de autorización 1% · No terminó proceso 0%
- **Ocupación — declarada:** Empleado + Pensionado 43% · Empleado + Independiente + Pensionado 57% · **real (aprobados):** Empleado 94% · Independiente 3% · Pensionado 3%

### CREDIMOVIL

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 2093 solicitudes en 90 días
- **Aprueba el 77%** (1605 de 2093)
- **Ticket medio:** $1.4 M · **plazo medio:** 15 cuotas
- **Principales comercios:** CREDIMOVIL (2093)
- **Dónde terminan:** Autorizada 77% · Seleccionó entidad 11% · Cancelado 10% · Pendiente de autorización 2% · Autorizado pendiente desembolso 1%
- **Ocupación — declarada:** Empleado + Pensionado 14% · Empleado + Independiente + Pensionado 86% · **real (aprobados):** Empleado 96% · Independiente 3% · Pensionado 1% · Desempleado 0%
  - ⚠ **Otorgó 1 crédito(s) a ocupaciones que su regla NO declara:** Desempleado — la regla clasifica, no excluye (F-162)

### Bancolombia - Compra y paga después

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 37 comercio(s) · 2085 solicitudes en 90 días
- **Aprueba el 34%** (713 de 2085)
- **Ticket medio:** $745.749 · **plazo medio:** 4 cuotas
- **Principales comercios:** Alkosto (1187) · K-TRONIX (343) · Alkomprar (292) · Smart Academia de Idiomas (79)
- **Dónde terminan:** Cancelado 42% · Autorizada 34% · Formulario de perfil 13% · Seleccionó entidad 8% · Pendiente de facturación 1%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 99% · Independiente 1% · Desempleado 0%

### CrediPullman

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 895 solicitudes en 90 días
- **Aprueba el 58%** (519 de 895)
- **Ticket medio:** $2.0 M · **plazo medio:** 10 cuotas
- **Principales comercios:** Amoblando Pullman (895)
- **Dónde terminan:** Autorizada 58% · Seleccionó entidad 24% · Cancelado 11% · Pendiente de autorización 4% · Negada 1%
- **Ocupación — declarada:** Empleado 20% · Empleado + Independiente + Pensionado 60% · Empleado + Pensionado 20% · **real (aprobados):** Empleado 90% · Pensionado 5% · Independiente 4% · Desempleado 0%
  - ⚠ **Otorgó 1 crédito(s) a ocupaciones que su regla NO declara:** Desempleado — la regla clasifica, no excluye (F-162)

### Credifamilia

- **Familia:** rt=4 — Credifamilia
- **Alcance:** 4 comercio(s) · 801 solicitudes en 90 días
- **Aprueba el 61%** (486 de 801)
- **Ticket medio:** $4.4 M · **plazo medio:** 23 cuotas
- **Principales comercios:** Sonría (621) · DENTIX (110) · GAES (54) · Odontofamily (16)
- **Dónde terminan:** Autorizada 61% · Seleccionó entidad 24% · Cancelado 8% · Pendiente de autorización 4% · Aprobada no desembolsada 2%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 83% · Independiente 9% · Pensionado 8% · Empleado + Pensionado 0%

### Sistecrédito

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 31 comercio(s) · 643 solicitudes en 90 días
- **Aprueba el 16%** (102 de 643)
- **Ticket medio:** $1.6 M · **plazo medio:** 6 cuotas
- **Principales comercios:** Emo materiales (171) · Asyco (121) · DENTIX (98) · Crédito Directo (51)
- **Dónde terminan:** Seleccionó entidad 64% · Negada 18% · Autorizada 16% · No terminó proceso 2% · Aprobada no desembolsada 0%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 85% · Independiente 8% · Pensionado 5% · Desempleado 2%

### Welli Risk

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 1 comercio(s) · 622 solicitudes en 90 días
- **Aprueba el 74%** (459 de 622)
- **Ticket medio:** $4.7 M · **plazo medio:** 34 cuotas
- **Principales comercios:** Sonría (622)
- **Dónde terminan:** Autorizada 74% · Pendiente de autorización 18% · Negada 4% · Aprobada no desembolsada 2% · Seleccionó entidad 1%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 93% · Pensionado 3% · Desempleado 2% · Independiente 2%

### Crédito Directo X

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 496 solicitudes en 90 días
- **Aprueba el 72%** (358 de 496)
- **Ticket medio:** $1.7 M · **plazo medio:** 15 cuotas
- **Principales comercios:** Crédito Directo (496)
- **Dónde terminan:** Autorizada 72% · Seleccionó entidad 13% · Cancelado 9% · Negada 2% · Pendiente de autorización 2%
- **Ocupación — declarada:** Empleado + Independiente + Pensionado 67% · Desempleado + Empleado + Independiente + Pensionado 33% · **real (aprobados):** Empleado 96% · Independiente 3% · Pensionado 0%

### Prami

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 10 comercio(s) · 481 solicitudes en 90 días
- **Aprueba el 57%** (272 de 481)
- **Ticket medio:** $1.9 M · **plazo medio:** 11 cuotas
- **Principales comercios:** Asyco (139) · Amoblando Pullman (128) · Smart Academia de Idiomas (89) · Almacenes La Ganga (83)
- **Dónde terminan:** Autorizada 57% · No terminó proceso 17% · Seleccionó entidad 16% · Aprobada no desembolsada 5% · Negada 4%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 96% · Independiente 2% · Pensionado 2% · Desempleado 1%

### Credi Free

- **Familia:** rt=3 — rotativo
- **Alcance:** 1 comercio(s) · 388 solicitudes en 90 días
- **Aprueba el 49%** (191 de 388)
- **Ticket medio:** $513.786 · **plazo medio:** 6 cuotas
- **Principales comercios:** Free Spirit (388)
- **Dónde terminan:** Autorizada 49% · Seleccionó entidad 40% · Pendiente de autorización 6% · Cancelado 3% · Negada 1%
- **Ocupación — declarada:** Empleado + Independiente + Pensionado 100% · **real (aprobados):** Empleado 97% · Independiente 2% · Desempleado 1% · Pensionado 1%
  - ⚠ **Otorgó 1 crédito(s) a ocupaciones que su regla NO declara:** Desempleado — la regla clasifica, no excluye (F-162)

### Su+pay

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 6 comercio(s) · 328 solicitudes en 90 días
- **Aprueba el 8%** (26 de 328)
- **Ticket medio:** $1.9 M · **plazo medio:** 28 cuotas
- **Principales comercios:** Asyco (294) · Tu Colchón (16) · Compuworking (7) · Celucambio (6)
- **Dónde terminan:** Negada 58% · Seleccionó entidad 31% · Autorizada 8% · No terminó proceso 3% · Aprobada no desembolsada 1%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 85% · Pensionado 8% · Independiente 8%

### DENTIX FINANCIAL SERVICES

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 309 solicitudes en 90 días
- **Aprueba el 67%** (207 de 309)
- **Ticket medio:** $2.8 M · **plazo medio:** 13 cuotas
- **Principales comercios:** DENTIX (309)
- **Dónde terminan:** Autorizada 67% · Seleccionó entidad 18% · Pendiente de autorización 8% · Cancelado 6%
- **Ocupación — declarada:** Empleado + Independiente + Pensionado 100% · **real (aprobados):** Empleado 94% · Independiente 4% · Pensionado 1% · Empleado + Pensionado 0%

### PayJoy

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 1 comercio(s) · 289 solicitudes en 90 días
- **Aprueba el 40%** (115 de 289)
- **Ticket medio:** $917.606 · **plazo medio:** 16 cuotas
- **Principales comercios:** Crédito Directo (289)
- **Dónde terminan:** Autorizada 40% · Negada 35% · Seleccionó entidad 12% · Aprobada no desembolsada 6% · Cancelado 6%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 91% · Independiente 4% · Pensionado 3% · Desempleado 2%

### Crediemo

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 264 solicitudes en 90 días
- **Aprueba el 72%** (191 de 264)
- **Ticket medio:** $1.6 M · **plazo medio:** 10 cuotas
- **Principales comercios:** Emo materiales (264)
- **Dónde terminan:** Autorizada 72% · Seleccionó entidad 21% · Cancelado 3% · Pendiente de autorización 3% · Paz y salvo 0%
- **Ocupación — declarada:** Empleado + Independiente + Pensionado 100% · **real (aprobados):** Empleado 91% · Pensionado 5% · Independiente 4%

### Brilla

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 7 comercio(s) · 231 solicitudes en 90 días
- **Aprueba el 80%** (184 de 231)
- **Ticket medio:** $4.2 M · **plazo medio:** 55 cuotas
- **Principales comercios:** Sonría (210) · Emo materiales (12) · Oralty (3) · Asyco (3)
- **Dónde terminan:** Autorizada 80% · Negada 10% · Seleccionó entidad 8% · No terminó proceso 1% · Aprobada no desembolsada 0%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 70% · Independiente 15% · Pensionado 14% · Desempleado 1%

### Motai X

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 229 solicitudes en 90 días
- **Aprueba el 66%** (152 de 229)
- **Ticket medio:** $6.9 M · **plazo medio:** 24 cuotas
- **Principales comercios:** Motai (229)
- **Dónde terminan:** Autorizada 66% · Seleccionó entidad 14% · Cancelado 14% · Pendiente de autorización 6%
- **Ocupación — declarada:** Empleado + Pensionado 25% · Empleado + Independiente + Pensionado 75% · **real (aprobados):** Empleado 96% · Independiente 3% · Desempleado 1% · Pensionado 1%
  - ⚠ **Otorgó 1 crédito(s) a ocupaciones que su regla NO declara:** Desempleado — la regla clasifica, no excluye (F-162)

