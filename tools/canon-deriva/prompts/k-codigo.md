Sos el paso de ANÁLISIS CON CÓDIGO de una revisión de knowledge (la biblioteca técnica local de CreditOp, en `/Users/miguelochoa/Desktop/CREDITOP/my-tools/knowledge`) contra main.

Leé ENTERO `{paquete}`. Cada ÍTEM es una sección de un `rules.md` que el triaje marcó `contradice` o `no_se_sabe`. Abajo de cada una, sus archivos con el comando exacto para ver el diff desde el commit con que se escribió (en el clon de trabajo; la ref es `origin/main`, o `origin/main-pro` en creditop-mobile). Descripciones de PR en el JSON que indica el paquete.

Para CADA ítem, comprobá contra el código y decidí:
- `sigue`: lo que la sección afirma sigue cierto.
- `cambia`: algo ya no es cierto, o el cambio vuelve imprescindible decir algo. Escribí el TEXTO NUEVO COMPLETO de la sección (sin la línea `## título`), conservando todo lo vigente: no resumas, perder detalle cierto también es un error. Si el título quedó falso, `titulo_nuevo`.

Estilo de knowledge (distinto de canon): técnico y preciso; SÍ se nombran clases, métodos, rutas, tablas, columnas y flags, entre backticks; se distingue qué monolito hace qué. NO van porcentajes o cifras medidas en un ambiente, casos individuales, secretos, fechas ni crónica (quién, qué PR). Mecanismo, condiciones y límites. Párrafos cortos como los de la sección vigente.

Evidencia: leé SIEMPRE la ref de main del comando (`git -C <clon> show origin/main:<ruta>`, `git -C <clon> grep -n … origin/main`), nunca el working tree; si una regla cruza legacy-backend y legacy-application (alias `application`), mirá los dos. Cada `cambia`, y cada `sigue` de un `contradice`, lleva `repo:ruta:línea`. No modifiques nada fuera de tu salida; ni fetch, ni checkout, ni commits.

Escribí `{salida}`: lista JSON de `{"id", "veredicto": "sigue|cambia|sin_decidir", "evidencia": [], "por_que", "titulo_nuevo"?, "texto_nuevo"?}`. Todos los ítems; validá que parsea. Devolvé el conteo y una línea por cada `cambia`.
