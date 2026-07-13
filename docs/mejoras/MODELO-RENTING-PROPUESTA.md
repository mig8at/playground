# Modelo de Renting — del parche actual a un flujo reutilizable

> **Propósito:** explicar, de forma simple, qué tenemos hoy en el flujo de renting, cuáles son los cuellos de botella que lo frenan (empezando por el "modo"), y cómo —quitando unas cosas y creando otras— llegamos a un flujo que cualquier comercio pueda usar.
>
> **Para quién:** negocio y tecnología. El texto principal es para todos; las notas marcadas **🔧 Técnico** son detalle opcional para el equipo de desarrollo.
>
> **Estado:** propuesta para alinear antes de construir. Nada de esto está en producción todavía.

---

## 1. Resumen ejecutivo

Hoy el flujo de renting funciona, pero está **hecho a la medida de un solo comercio (Motai)**. Sirvió para arrancar, pero para poder ofrecerlo a **otros comercios** (Alta y los que vengan) y capturar el nuevo negocio (**~40M/mes**), necesitamos sacarle esa dependencia.

El principal cuello de botella es un **"modo" escondido**: un interruptor interno que decide cómo se comporta todo el flujo. Es frágil, está clavado a Motai y no escala.

**La propuesta**, en una frase: **quitar ese "modo" y convertir los productos (compra, renting, renting con compra) en opciones claras de un catálogo**, donde el comportamiento lo define el **tipo de producto** —no un interruptor oculto— y cada comercio se configura llenando una **ficha**, sin reprogramar.

Lo importante: **no se reconstruye el sistema**. Se reutiliza casi todo lo que ya existe; solo se ordena, se saca lo que estaba clavado y se agregan unas pocas piezas nuevas.

---

## 2. Qué tenemos hoy

El flujo de renting (primer MVP con Motai) está **construido y andando en el ambiente de pruebas** — todavía no en producción. Hoy:

- El cliente entra por el comercio, un asesor abre la solicitud, se cargan sus datos, se validan sus ingresos (por apps, con un servicio llamado **Ábaco**) y al final **una persona aprueba o rechaza a mano** — no hay política de crédito automática.
- Todo eso funciona porque el sistema **"sabe" que es Motai** y activa un camino especial para él.

> **🔧 Técnico:** ese "camino especial" es la variable `isMotaiRenting` + un registro de "modo" del comercio, más comparaciones contra el identificador del comercio/producto (`158`) repartidas por el frontend y el backend. El producto "renting" ya existe como un producto de crédito in-platform (familia CreditopX); lo anómalo es que su comportamiento se dispara por identificadores y banderas clavadas, no por el tipo de producto.

---

## 3. Los cuellos de botella

Son las cosas que hoy frenan que el renting se ofrezca a más comercios. El primero es el central.

### 3.1 El "modo" del comercio — el cuello de botella principal

**Qué es:** un interruptor interno que decide si la solicitud sigue el camino de renting o el normal. Viaja escondido a lo largo del flujo.

**Por qué frena:**
- Es **frágil**: si el interruptor no viaja bien, el flujo se comporta mal.
- Está **atado a Motai** por identificadores fijos. Para otro comercio, hay que volver a tocar código.
- **Confunde**: la pantalla inicial muestra 3 opciones, pero solo una (renting) tiene comportamiento real detrás.

> **🔧 Técnico:** el "modo" vive tanto en el frontend (pantalla de modos + bandera `isMotaiRenting`) como en el backend (tablas de modos por comercio, una constante de id de modo fija, y la bandera propagada por medio onboarding). No es solo un cambio de frontend: sacarlo toca ambos lados.

### 3.2 Todo escrito a mano y disperso

**Qué es:** el nombre, los colores, los precios, los documentos y las reglas de Motai están **escritos directamente en el código**, en muchos lugares distintos.

**Por qué frena:** sumar un comercio nuevo obliga a editar código en decenas de puntos. No es "dar de alta", es "desarrollar".

### 3.3 La calculadora de precios vive en la pantalla (y duplicada)

**Qué es:** la fórmula que arma el precio (costo + alistamiento + margen + IVA) está **quemada en el frontend**, y además repetida en dos lugares.

**Por qué frena:** es difícil de auditar y de mantener, y cada comercio necesitaría la suya. Debería vivir en un solo lugar, como un dato configurable.

### 3.4 Hoy el renting NO consulta el historial de crédito (a propósito)

**Qué es:** el camino de renting **saltea el buró** (Datacrédito) de forma intencional, porque apunta a gente sin historial.

**Por qué frena:** el nuevo negocio (MVP2) pide **consultar el buró al 100%**. O sea, hay que **revertir** ese salto — no es un simple "prender un botón".

### 3.5 "Motai X" no existe y el codeudor tampoco

**Qué es:** de los 3 productos de la pantalla, "Motai X" (préstamo normal) **no está construido** en el sistema; solo el renting. Y el **codeudor** no existe en ningún lado.

**Por qué frena:** son piezas que el MVP2 da por hechas, pero hay que construirlas.

### 3.6 La decisión no tiene dueño ni pantalla propia

**Qué es:** hoy la aprobación entra por un atajo interno, sin un rol, sin permisos y sin registro de quién decidió.

**Por qué frena:** si una persona del comercio va a aprobar créditos, necesita su acceso, su pantalla y auditoría. Es el tramo más pesado y menos definido.

---

## 4. El cambio: quitar el modo, crear el catálogo

La idea es simple: **en vez de un "modo" escondido, los productos son opciones de un catálogo, y su comportamiento lo define el tipo de producto.** El comercio se configura con una **ficha**.

| Quitar | Reutilizar (ya existe) | Crear (nuevo) |
|---|---|---|
| El "modo" escondido (front y back) | El motor del flujo: registro, identidad, firma, desembolso | La **ficha por comercio** (qué ofrece, precios, reglas, documentos) |
| Los datos clavados a Motai | El **catálogo de productos** (los productos ya son entidades del sistema) | El **tipo/categoría** de producto que dispara el comportamiento |
| La fórmula de precio en la pantalla | El **motor de reglas** (ya tiene pantalla de administración) | El **codeudor** |
| La pantalla de "modos" confusa | La validación de ingresos por apps (Ábaco), ya construida | La **pantalla de decisión** del administrador del comercio |

> **🔧 Técnico:** "el comportamiento lo dispara el tipo de producto" significa reemplazar los `if id == 158` / `if isMotaiRenting` por una **categoría del producto** (p. ej. `arrendamiento` vs `crédito`). El sistema **ya funciona así con otros productos** (el crédito rotativo, por ejemplo, se distingue por su tipo) — Motai es la excepción que lo hace por un atajo. Por eso este cambio es *más fiel* a cómo está armado el sistema, no menos.

---

## 5. Cómo queda el flujo

Un solo recorrido, ordenado, igual para todos los comercios. Lo que cambia entre productos se acomoda solo, según el producto que el cliente elige:

```
Comercio  →  Datos base del cliente  →  Elige producto  →  Datos extra  →  Decisión  →  Desembolso
              (lo mínimo para              (del catálogo)     (según el       (el comercio
               mostrar opciones)                              producto)        aprueba)
```

Los **3 productos** del catálogo:

| Producto | Qué es | Validación de ingresos | Documentos |
|---|---|---|---|
| **Motai X** | Préstamo normal (crédito) | Buró + ingreso formal | Contrato + pagaré |
| **Renting** | Arrienda y devuelve el bien | Ingresos por apps (Ábaco) | Contrato + pagaré |
| **Renting con compra** | Arrienda y al final se queda con el bien | Ingresos por apps (Ábaco) | + garantía mobiliaria |

**Dos principios del flujo:**
- **Datos base antes / datos extra después.** Primero se pide lo mínimo para mostrar opciones; lo específico y pesado (como Ábaco) se pide **después** de elegir el producto — así no se le pide a quien no lo necesita.
- **Cada producto trae su comportamiento.** Renting y "renting con compra" comparten la misma evaluación (mismo Ábaco); solo cambian los documentos. Motai X usa el camino estándar.

---

## 6. Por qué el cambio es válido y de bajo riesgo

- **Reutiliza casi todo.** No se reconstruye el sistema; se ordena y se saca lo clavado a Motai.
- **Elimina la confusión.** Desaparece el "modo" frágil; los productos son opciones visibles.
- **Escala.** Sumar un comercio pasa a ser "llenar una ficha", no "desarrollar". Es lo que habilita crecer y capturar el revenue.
- **Es más fiel al sistema.** El resto de los productos ya se comportan según su tipo; esto alinea al renting con esa forma, en vez de mantener la excepción.
- **Es honesto sobre el esfuerzo.** La mayoría ya está. Lo verdaderamente nuevo es puntual: la categoría de producto, el codeudor, la pantalla de decisión y conectar la validación de ingresos a la decisión.

---

## 7. Cómo responde a lo que pide negocio (MVP2)

| Necesidad del MVP2 | Cómo la cubre este modelo |
|---|---|
| Los 3 productos (Motai X / Renting / Renting con compra) | Son opciones claras del catálogo |
| Simulador / calculadora de cuotas | Vive en la ficha (configurable), no quemada en pantalla |
| Evaluación de viabilidad (reglas de aprobación) | Configurable en el motor de reglas que ya existe |
| Modelo con codeudor | Contemplado (pieza nueva) |
| Documentos de formalización por producto | Contemplado (renting con compra suma garantía mobiliaria) |
| Cobranza, reporte a Motai | **Fase siguiente** (es operación, no parte de este flujo) |

---

## 8. Qué queda para fases siguientes

Para no vender de más, esto **no** entra en este cambio:

- La **cobranza semanal** y la mensajería (es operación posterior al desembolso).
- El **reporte automático** a Motai.
- La **tabla de amortización** detallada del simulador de "renting con compra".
- El **acceso/rol del administrador** (login, permisos) — es el tramo más pesado y hay que diseñarlo aparte.

---

## 9. Decisiones pendientes (de negocio, no técnicas)

Necesitamos que negocio defina:

1. Los **nombres finales** de los 3 productos.
2. Las **reglas de aprobación** (montos, puntaje mínimo). *Hay un punto a aclarar: el documento de negocio menciona un puntaje mínimo de 400 en un lado y de 0 en otro.*
3. Si se **consulta el historial de crédito** y para quién (esto define si se revierte el salto de buró de hoy).
4. Si "renting" y "renting con compra" se muestran como **dos opciones separadas** o como **una con casilla de "opción de compra"**.

---

## 10. Prototipos de referencia

Para ver el modelo funcionando (no es el producto final, es para alinear):

- **La ficha** — cómo se configura un comercio.
- **El flujo** — los 3 productos, paso a paso, sin "modo".
- **La decisión** — cómo el administrador del comercio aprueba / pide codeudor / rechaza.

> Disponibles como prototipos navegables en el repositorio (`playground/merchant-config/`). El detalle técnico completo y la verificación contra el código real están en el documento de plan de evolución del equipo.

---

**En una línea:** tomamos el inventario de deuda técnica que ya levantamos, pero en vez de robustecer el "modo" lo eliminamos y hacemos los productos opciones del catálogo — que es lo que el MVP2 necesita para escalar, y lo que el propio sistema ya hace con los demás productos.
