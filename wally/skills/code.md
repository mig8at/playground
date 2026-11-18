# code: leer el código de los repos de CreditOp como está hoy en main

| comando | para qué |
|---|---|
| `grep repo:ruta 'texto'` | las líneas donde aparece el texto, con su número. La ruta puede ser un archivo o una carpeta (`legacy-backend:Modules`) |
| `code repo:ruta:desde-hasta` | sólo esas líneas del archivo: **preferilo** |
| `code repo:ruta` | el archivo entero, con números de línea: sólo si es chico (uno de 1.500 líneas son ~80 mil caracteres) |

```command
grep legacy-backend:Modules 'makeAdvisorPhoneUnique'
code legacy-backend:Modules/CommonsV1/App/Utils/PhoneUtils.php:255-282
```

- Los repos: `legacy-backend` (el backend nuevo, Laravel con `Modules/`), `legacy-application` (el admin y el backend
  viejo) y `frontend-monorepo`. **Una regla puede vivir en los dos monolitos: buscá en los dos** antes de afirmar.
- Primero `grep` para tener el número de línea; después `code` con un rango de 20 a 60 líneas.
- Una búsqueda vacía no prueba que algo no exista: probá otra palabra u otro repo. Una palabra muy general
  (`document_number`) devuelve cientos de líneas: buscá algo distintivo.
- Citá siempre `repo:archivo:línea`.
