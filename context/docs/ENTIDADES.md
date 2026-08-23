# CreditOp — Ficha de negocio de cada entidad

> **GENERADO — no editar a mano.** Se regenera con `make context-entidades`.
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
| **Addi** | rt=0 | 47 | 12577 | 28% | $4.2 M | 23 |
| **Welli** | rt=1 | 16 | 3541 | 63% | $4.9 M | 35 |
| **Bancolombia - Crédito de consumo** | rt=1 | 44 | 2805 | 0% | $3.6 M | 60 |
| **Meddipay** | rt=1 | 19 | 2565 | 60% | $3.5 M | 14 |
| **Bancolombia - Compra y paga después** | rt=1 | 35 | 1677 | 31% | $634.658 | 4 |
| **CREDIMOVIL** | rt=2 | 1 | 1549 | 72% | $1.3 M | 15 |
| **Refurbicredit ecommerce** | rt=2 | 1 | 1356 | 6% | $2.0 M | 8 |
| **CrediPullman** | rt=2 | 1 | 940 | 59% | $2.0 M | 10 |
| **Sistecrédito** | rt=0 | 32 | 684 | 16% | $1.6 M | 6 |
| **Crédito Directo X** | rt=2 | 1 | 657 | 74% | $1.6 M | 15 |
| **Credifamilia** | rt=4 | 3 | 549 | 54% | $4.4 M | 23 |
| **Welli Risk** | rt=1 | 1 | 541 | 74% | $4.6 M | 35 |
| **PayJoy** | rt=0 | 1 | 536 | 42% | $960.576 | 16 |
| **Prami** | rt=1 | 9 | 360 | 63% | $1.9 M | 10 |
| **Su+pay** | rt=0 | 6 | 358 | 10% | $2.0 M | 30 |
| **DENTIX FINANCIAL SERVICES** | rt=2 | 1 | 327 | 66% | $2.9 M | 14 |
| **Crediemo** | rt=2 | 1 | 249 | 74% | $1.5 M | 10 |
| **Brilla** | rt=0 | 5 | 234 | 82% | $4.6 M | 56 |
| **Fincomercio** | rt=0 | 1 | 214 | 2% | $3.9 M | 16 |
| **Motai X** | rt=2 | 1 | 214 | 71% | $6.4 M | 23 |
| **Banco de Bogotá** | rt=0 | 8 | 212 | 0% | $4.4 M | 69 |

## Ficha por entidad

### Addi

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 47 comercio(s) · 12577 solicitudes en 90 días
- **Aprueba el 28%** (3529 de 12577)
- **Ticket medio:** $4.2 M · **plazo medio:** 23 cuotas
- **Principales comercios:** Sonría (4446) · Tripleten (3199) · Amoblando Pullman (2625) · Smart Academia de Idiomas (681)
- **Dónde terminan:** Negada 46% · Autorizada 28% · Seleccionó entidad 22% · No terminó proceso 3% · Aprobada no desembolsada 1%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 80% · Independiente 13% · Desempleado 4% · Pensionado 4%

### Welli

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 16 comercio(s) · 3541 solicitudes en 90 días
- **Aprueba el 63%** (2214 de 3541)
- **Ticket medio:** $4.9 M · **plazo medio:** 35 cuotas
- **Principales comercios:** Sonría (2931) · DENTIX (341) · GAES (104) · Boston Medical (60)
- **Dónde terminan:** Autorizada 63% · Pendiente de autorización 23% · Negada 5% · Aprobada no desembolsada 3% · Seleccionó entidad 2%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 84% · Independiente 9% · Pensionado 4% · Desempleado 3%

### Bancolombia - Crédito de consumo

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 44 comercio(s) · 2805 solicitudes en 90 días
- **Aprueba el 0%** (13 de 2805)
- **Ticket medio:** $3.6 M · **plazo medio:** 60 cuotas
- **Principales comercios:** Tripleten (809) · Alkosto (618) · Alkomprar (385) · K-TRONIX (365)
- **Dónde terminan:** Seleccionó entidad 36% · Formulario de perfil 34% · Negada 17% · Cancelado 12% · No terminó proceso 1%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 92% · Independiente 8%

### Meddipay

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 19 comercio(s) · 2565 solicitudes en 90 días
- **Aprueba el 60%** (1536 de 2565)
- **Ticket medio:** $3.5 M · **plazo medio:** 14 cuotas
- **Principales comercios:** Sonría (1633) · Amoblando Pullman (464) · GAES (137) · Boston Medical (116)
- **Dónde terminan:** Autorizada 60% · Seleccionó entidad 24% · Negada 11% · Aprobada no desembolsada 2% · No terminó proceso 2%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 72% · Independiente 17% · Pensionado 7% · Desempleado 3%

### Bancolombia - Compra y paga después

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 35 comercio(s) · 1677 solicitudes en 90 días
- **Aprueba el 31%** (523 de 1677)
- **Ticket medio:** $634.658 · **plazo medio:** 4 cuotas
- **Principales comercios:** Alkosto (768) · K-TRONIX (330) · Alkomprar (206) · Amoblando Pullman (110)
- **Dónde terminan:** Autorizada 31% · Formulario de perfil 28% · Cancelado 26% · Seleccionó entidad 11% · Pendiente de facturación 2%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 99% · Independiente 1% · Desempleado 1%

### CREDIMOVIL

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 1549 solicitudes en 90 días
- **Aprueba el 72%** (1118 de 1549)
- **Ticket medio:** $1.3 M · **plazo medio:** 15 cuotas
- **Principales comercios:** CREDIMOVIL (1549)
- **Dónde terminan:** Autorizada 72% · Seleccionó entidad 13% · Cancelado 11% · Pendiente de autorización 2% · Autorizado pendiente desembolso 1%
- **Ocupación — declarada:** Empleado + Pensionado 14% · Empleado + Independiente + Pensionado 86% · **real (aprobados):** Empleado 90% · Independiente 9% · Pensionado 1% · Desempleado 0%
  - ⚠ **Otorgó 1 crédito(s) a ocupaciones que su regla NO declara:** Desempleado — la regla clasifica, no excluye (F-162)

### Refurbicredit ecommerce

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 1356 solicitudes en 90 días
- **Aprueba el 6%** (88 de 1356)
- **Ticket medio:** $2.0 M · **plazo medio:** 8 cuotas
- **Principales comercios:** Refurbi (1356)
- **Dónde terminan:** Seleccionó entidad 76% · Cancelado 17% · Autorizada 6% · Pendiente de autorización 1% · No terminó proceso 0%
- **Ocupación — declarada:** Empleado + Pensionado 43% · Empleado + Independiente + Pensionado 57% · **real (aprobados):** Empleado 93% · Independiente 5% · Pensionado 2%

### CrediPullman

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 940 solicitudes en 90 días
- **Aprueba el 59%** (553 de 940)
- **Ticket medio:** $2.0 M · **plazo medio:** 10 cuotas
- **Principales comercios:** Amoblando Pullman (940)
- **Dónde terminan:** Autorizada 59% · Seleccionó entidad 22% · Cancelado 11% · Pendiente de autorización 4% · No terminó proceso 2%
- **Ocupación — declarada:** Empleado 20% · Empleado + Independiente + Pensionado 60% · Empleado + Pensionado 20% · **real (aprobados):** Empleado 92% · Pensionado 4% · Independiente 3% · Desempleado 0%
  - ⚠ **Otorgó 1 crédito(s) a ocupaciones que su regla NO declara:** Desempleado — la regla clasifica, no excluye (F-162)

### Sistecrédito

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 32 comercio(s) · 684 solicitudes en 90 días
- **Aprueba el 16%** (108 de 684)
- **Ticket medio:** $1.6 M · **plazo medio:** 6 cuotas
- **Principales comercios:** Emo materiales (180) · Asyco (129) · DENTIX (127) · Crédito Directo (50)
- **Dónde terminan:** Seleccionó entidad 67% · Autorizada 16% · Negada 15% · No terminó proceso 2% · Aprobada no desembolsada 0%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 78% · Independiente 15% · Pensionado 6% · Desempleado 2%

### Crédito Directo X

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 657 solicitudes en 90 días
- **Aprueba el 74%** (485 de 657)
- **Ticket medio:** $1.6 M · **plazo medio:** 15 cuotas
- **Principales comercios:** Crédito Directo (657)
- **Dónde terminan:** Autorizada 74% · Seleccionó entidad 13% · Cancelado 8% · Pendiente de autorización 2% · Negada 2%
- **Ocupación — declarada:** Empleado + Independiente + Pensionado 67% · Desempleado + Empleado + Independiente + Pensionado 33% · **real (aprobados):** Empleado 92% · Independiente 7% · Pensionado 0% · Desempleado 0%

### Credifamilia

- **Familia:** rt=4 — Credifamilia
- **Alcance:** 3 comercio(s) · 549 solicitudes en 90 días
- **Aprueba el 54%** (297 de 549)
- **Ticket medio:** $4.4 M · **plazo medio:** 23 cuotas
- **Principales comercios:** Sonría (430) · DENTIX (74) · GAES (45)
- **Dónde terminan:** Autorizada 54% · Seleccionó entidad 30% · Cancelado 6% · Pendiente de autorización 3% · Negada 3%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 85% · Independiente 8% · Pensionado 7% · Empleado + Pensionado 0%

### Welli Risk

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 1 comercio(s) · 541 solicitudes en 90 días
- **Aprueba el 74%** (402 de 541)
- **Ticket medio:** $4.6 M · **plazo medio:** 35 cuotas
- **Principales comercios:** Sonría (541)
- **Dónde terminan:** Autorizada 74% · Pendiente de autorización 15% · Negada 5% · Aprobada no desembolsada 3% · No terminó proceso 1%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 93% · Desempleado 3% · Pensionado 2% · Independiente 1%

### PayJoy

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 1 comercio(s) · 536 solicitudes en 90 días
- **Aprueba el 42%** (224 de 536)
- **Ticket medio:** $960.576 · **plazo medio:** 16 cuotas
- **Principales comercios:** Crédito Directo (536)
- **Dónde terminan:** Autorizada 42% · Negada 34% · Seleccionó entidad 11% · No terminó proceso 8% · Aprobada no desembolsada 5%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 83% · Independiente 9% · Desempleado 5% · Pensionado 2%

### Prami

- **Familia:** rt=1 — integración (API de la entidad)
- **Alcance:** 9 comercio(s) · 360 solicitudes en 90 días
- **Aprueba el 63%** (227 de 360)
- **Ticket medio:** $1.9 M · **plazo medio:** 10 cuotas
- **Principales comercios:** Asyco (104) · Almacenes La Ganga (84) · Smart Academia de Idiomas (74) · Amoblando Pullman (58)
- **Dónde terminan:** Autorizada 63% · Seleccionó entidad 12% · No terminó proceso 11% · Aprobada no desembolsada 8% · Negada 4%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 97% · Pensionado 2% · Independiente 1%

### Su+pay

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 6 comercio(s) · 358 solicitudes en 90 días
- **Aprueba el 10%** (36 de 358)
- **Ticket medio:** $2.0 M · **plazo medio:** 30 cuotas
- **Principales comercios:** Asyco (318) · Tu Colchón (25) · Compuworking (6) · Celucambio (5)
- **Dónde terminan:** Negada 51% · Seleccionó entidad 34% · Autorizada 10% · No terminó proceso 4% · Aprobada no desembolsada 1%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 58% · Independiente 28% · Pensionado 8% · Desempleado 6%

### DENTIX FINANCIAL SERVICES

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 327 solicitudes en 90 días
- **Aprueba el 66%** (217 de 327)
- **Ticket medio:** $2.9 M · **plazo medio:** 14 cuotas
- **Principales comercios:** DENTIX (327)
- **Dónde terminan:** Autorizada 66% · Seleccionó entidad 18% · Pendiente de autorización 11% · Cancelado 4%
- **Ocupación — declarada:** Empleado + Independiente + Pensionado 100% · **real (aprobados):** Empleado 91% · Independiente 6% · Pensionado 2% · Empleado + Pensionado 0%

### Crediemo

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 249 solicitudes en 90 días
- **Aprueba el 74%** (185 de 249)
- **Ticket medio:** $1.5 M · **plazo medio:** 10 cuotas
- **Principales comercios:** Emo materiales (249)
- **Dónde terminan:** Autorizada 74% · Seleccionó entidad 22% · Pendiente de autorización 2% · Cancelado 1% · Paz y salvo 0%
- **Ocupación — declarada:** Empleado + Independiente + Pensionado 100% · **real (aprobados):** Empleado 81% · Independiente 14% · Pensionado 5%

### Brilla

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 5 comercio(s) · 234 solicitudes en 90 días
- **Aprueba el 82%** (192 de 234)
- **Ticket medio:** $4.6 M · **plazo medio:** 56 cuotas
- **Principales comercios:** Sonría (218) · Emo materiales (9) · Asyco (3) · Oralty (3)
- **Dónde terminan:** Autorizada 82% · Negada 11% · Seleccionó entidad 5% · No terminó proceso 2% · Aprobada no desembolsada 0%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 57% · Independiente 26% · Pensionado 16% · Desempleado 1%

### Fincomercio

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 1 comercio(s) · 214 solicitudes en 90 días
- **Aprueba el 2%** (5 de 214)
- **Ticket medio:** $3.9 M · **plazo medio:** 16 cuotas
- **Principales comercios:** Smart Academia de Idiomas (214)
- **Dónde terminan:** Seleccionó entidad 81% · Negada 15% · Autorizada 2% · No terminó proceso 2%
- **Ocupación — declarada:** — · **real (aprobados):** Empleado 80% · Pensionado 20%

### Motai X

- **Familia:** rt=2 — CreditopX (decide CreditOp)
- **Alcance:** 1 comercio(s) · 214 solicitudes en 90 días
- **Aprueba el 71%** (151 de 214)
- **Ticket medio:** $6.4 M · **plazo medio:** 23 cuotas
- **Principales comercios:** Motai (214)
- **Dónde terminan:** Autorizada 71% · Cancelado 12% · Seleccionó entidad 9% · Pendiente de autorización 8% · Negada 0%
- **Ocupación — declarada:** Empleado + Pensionado 25% · Empleado + Independiente + Pensionado 75% · **real (aprobados):** Empleado 89% · Independiente 9% · Pensionado 1%

### Banco de Bogotá

- **Familia:** rt=0 — redirección (decide afuera)
- **Alcance:** 8 comercio(s) · 212 solicitudes en 90 días
- **Aprueba el 0%** (0 de 212)
- **Ticket medio:** $4.4 M · **plazo medio:** 69 cuotas
- **Principales comercios:** Sonría (190) · Motai (11) · Tu Colchón (3) · Colchones ensueño (3)
- **Dónde terminan:** Negada 66% · Seleccionó entidad 30% · Cancelado 3% · No terminó proceso 1%

