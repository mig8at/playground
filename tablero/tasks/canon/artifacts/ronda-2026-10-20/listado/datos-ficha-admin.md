**El admin viejo no deja cargar a mano los datos personales de una ficha en blanco** ([[datos/context#la-ficha-en-blanco-alguien-que-ya-tiene-fila-y-todavia-no-tiene-nombre]]). Esos datos sólo los escribe el flujo de validación de identidad; si alguien los llenara desde el admin, la ficha dejaría de verse en blanco y el recorrido seguiría con nombres que nadie validó.

El admin la reconoce con un criterio más amplio que el resto del sistema: el marcador `TEMPORAL USER` en el primer nombre, el apellido **o** el nombre completo, o un número de documento que empieza por `TEMP-`. Con cualquiera de esas señales, editar el usuario, o el usuario desde una solicitud, contesta 403 aunque se tenga el permiso de edición, y la solicitud esconde su pestaña de usuario.

Esa amplitud cubre la ficha que el checkout de Corbeta crea con el marcador repetido en el nombre completo, que otras lecturas que comparan el nombre completo exacto no reconocen.
