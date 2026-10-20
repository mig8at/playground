El backend corre con Sail sobre `docker-compose.yml`: la aplicación (`laravel.test`), `mysql`, `redis`,
`soketi` y `localstack`. `make up` levanta los contenedores, espera a MySQL, genera la `APP_KEY` si falta y
**no toca el esquema**. `make setup` migra y seedea, y es sólo para la primera vez con la base vacía: sobre una base
poblada no se usa. Después: `make logs` sigue los logs de la aplicación, `make shell` abre una consola,
`make down` apaga. Las variables van en `.env` a partir de `.env.example` (`DB_HOST`, `DB_DATABASE`,
`APP_ENV`, `APP_URL`…).

`localstack` emula S3 en el puerto 4566. Al arrancar corre `docker/localstack/init-s3.sh`, que crea el
bucket de `AWS_BUCKET` (`local` si no se fija), le da lectura pública a sus objetos y le abre CORS para
`GET`: sin eso, el front pide los PDF desde otro puerto y el visor falla con «Error al cargar el documento».
⚠ **Que el contenedor esté arriba no hace que la aplicación lo use.** El disco `s3` lee `AWS_ENDPOINT` y
`AWS_URL`, y `.env.example` no trae ninguno de los dos: lo que la aplicación guarde en `s3` va al S3 de AWS
que digan sus credenciales, no al contenedor, hasta que esas dos variables apunten a `localstack`.
