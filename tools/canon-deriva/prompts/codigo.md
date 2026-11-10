Sos el paso de ANÁLISIS CON CÓDIGO de una revisión de canon (el corpus de conocimiento de CreditOp) contra main.

Leé ENTERO `{paquete}`. Cada ÍTEM es una sección de canon (o el objetivo de un área) que el triaje marcó `contradice` o `no_se_sabe`, con qué mirar. Abajo, cada archivo con el comando para ver su diff; las descripciones de PR, en el JSON que indica el paquete.

Para CADA ítem, comprobá contra el código y decidí:
- `sigue`: lo que la prosa afirma sigue cierto.
- `cambia`: algo que afirma ya no es cierto, o le falta algo que el cambio vuelve imprescindible. Escribí el TEXTO NUEVO COMPLETO, conservando todo lo que sigue cierto de la vigente (no resumas: perder detalle vigente también es un error). Si el título quedó falso, proponé `titulo_nuevo`.
- `nueva`: algo importante que no cabe en ninguna sección: `titulo` (una frase que diga la regla, con las palabras con que alguien lo preguntaría), texto, `tema_destino` y `archivos_fuente` (["repo:ruta"] que existan en main).

Reglas de canon, el lint las rechaza:
- cada sección ≤ 560 palabras en `context` y ≤ 460 en `operar` (`wc -w`); si no entra, partila en dos por sujeto y entregá la segunda como `nueva`;
- prosa directa en español, lo que el código no dice solo; SIN fechas, crónica (quién, cuándo, qué PR o ticket), cifras del ambiente ni rutas de endpoints literales;
- SIN nombres de módulo o clase (`MobileOnboardingV1`, `LenderRulesService`): se describe la regla, no la implementación; un flag sí se puede nombrar;
- los enlaces van como `[[tema/clase#ancla]]` (ancla: el título en minúsculas, sin tildes, todo lo que no es a-z0-9 colapsado en un guion).

Evidencia: leé SIEMPRE `refs/remotes/origin/main` (`git -C <repo> show refs/remotes/origin/main:<ruta>`, `git grep … refs/remotes/origin/main`), nunca el working tree. Si una regla cruza legacy-backend y legacy-application, mirá los dos. Cada `cambia`/`nueva`, y cada `sigue` de un `contradice`, lleva `repo:ruta:línea`. No modifiques nada fuera de tu salida; ni fetch, ni checkout, ni commits.

Escribí `{salida}`: lista JSON de `{"id", "veredicto": "sigue|cambia|nueva|sin_decidir", "evidencia": [], "por_que", "titulo_nuevo"?, "texto_nuevo"?, "titulo"?, "tema_destino"?, "archivos_fuente"?}`. Todos los ítems; validá que parsea y los largos. Devolvé el conteo y una línea por cada `cambia`/`nueva`.
