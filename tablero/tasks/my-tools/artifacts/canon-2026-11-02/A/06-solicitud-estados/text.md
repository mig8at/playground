**El estado de una solicitud se lee por nombre, y los estados se agrupan en cerrados sin crédito, cerrados con crédito, abiertos en la decisión y de entrada.** El catálogo vive sólo en la base de cada ambiente ([[datos/context#el-catalogo-de-estados-de-la-solicitud-depende-del-ambiente]]), así que los números de abajo son los que anotan los dos monolitos y una consulta debería resolver el estado por su nombre.

| grupo | estados |
|---|---|
| cerrada sin crédito | 6 Negada · 8 Cancelado · 12 Autorización negada · 24 Rechazado por validación de identidad · 7 No terminó proceso, que se puede retomar |
| con crédito | 5 Desembolsada · 11 Autorizada · 26 Facturado · 27 Paz y salvo · Autorizado pendiente desembolso |
| abierta en la decisión | 10 Pendiente de autorización · 17 Solicita codeudor · 18 Solicita documentación · 19 Cuota inicial · 20 Aprobada no desembolsada · 21 a 23 revisiones · 25 Pendiente de facturación · Pendiente firma codeudor · Pendiente aprobación manual · Pendiente de formalización |
| de entrada | 1 Validación OTP · 2 Cédula cargada · 3 Seleccionó entidad · 9 Formulario de perfil |

**«Autorizado pendiente desembolso» no tiene un número confiable.** El monolito viejo lo anota como 30 y deja el 28 para «Pendiente desembolso»; el portal del comercio del nuevo lo anota como 28. Un filtro por número para ese estado es una apuesta.

**Tres constantes del portal del comercio dicen lo que no son:** la que se llama «aprobada» es el 10, Pendiente de autorización; la que se llama «desembolsada» es el 11, Autorizada (Desembolsada es el 5); y la que se llama «no desembolsada» es el 20, Aprobada no desembolsada (No desembolsada es el 4).

**11, Autorizada, es el éxito de la originación y no retrocede.** Los reportes y los avisos de las entidades lo tratan como desembolsada, y es el que llena la fecha de desembolso: [[datos/context#cuando-se-desembolso-lo-escribe-un-disparador-de-la-base-y-por-eso-es-confiable]]. La cancelación en cascada no toca una solicitud en 11 ([[datos/context#que-cancela-una-solicitud-y-donde-queda-el-motivo]]). La única salida es la de Nequi: si el cobro aprobado se reversa y no queda otra vía aprobada, pasa a Cancelado ([[nequi/context]]).

**Retomar desde el portal del asesor se niega en los estados cerrados**: 5, 6, 8, 11, 12, 24, 26, 27 y 28. Quedan abiertos a propósito el 7, que es el caso para el que existe el botón, y los desembolsos a medias (4 y 20), donde puede haber razón para reintentar.

**Dar de baja a un usuario desde el admin viejo se bloquea** si tiene un crédito CreditopX, un pagaré firmado, una transacción de entidad abierta o una solicitud pasada la decisión (5, 10, 11, 17 a 23, 25, 26, 28 y los cuatro estados nuevos de autorización, codeudor, aprobación manual y formalización), porque la baja libera el documento: el cliente volvería como usuario nuevo y el crédito y su cobranza quedarían colgados del viejo.
