## Apuntar las centrales de riesgo de dev y staging al lambda de mocks que acepta dictado

**Borrador, sin mandar.** Para quien maneja infra (secretos y despliegue de `legacy-backend` y `legacy-backend-stg`).

### Qué pasa hoy

En dev, qa y staging las centrales de riesgo (Agil Data, Mareigua, Experian, TusDatos) las contesta un lambda de mocks
de la empresa. Hay dos desplegados:

- `9b6r8ticg0…/development`: el que sale del repo `risk-services-mockery-lambda` (PR #55 y #56, desplegados el
  2026-10-07). Acepta que se le dicte qué contestar para una cédula (`POST /mockoon-admin/global-vars`, token
  `Bearer mock-admin`).
- `ub79ck0htd…/development`: uno viejo. No tiene el admin API (404) y contesta siempre lo mismo para cualquier cédula
  (`JUAN CARLOS PEREZ GOMEZ`, con períodos de cotización de hace diez meses).

**qa ya usa el nuevo** desde el 2026-10-08: en el secreto `dev/legacy-backend-qa` las claves de host de las centrales
pasaron de `ub79ck0htd` a `9b6r8ticg0` y se redesplegó `legacy-backend-qa`. Medido en la solicitud 503353: la llamada a
Agil Data fue a `9b6r8ticg0` y el flujo llegó a entidades sin pedir información laboral.

**dev y staging siguen en el viejo.** Ahí no se puede probar un caso con datos de buró elegidos: cualquier cédula
recibe la misma persona y el backend calcula que no tiene empleo vigente.

### Qué hay que cambiar

El mismo cambio que en qa, en dos secretos:

| secreto | backend que se redespliega |
|---|---|
| `dev/legacy-backend` | `legacy-backend` (rama `develop`) |
| `dev/legacy-backend-stg` | `legacy-backend-stg` (rama `staging`) |

En cada uno, las claves de host de las centrales que hoy apuntan a `ub79ck0htd…` pasan a
`https://9b6r8ticg0.execute-api.us-east-2.amazonaws.com/development`. En qa fueron 8: `AGILDATA_HOST`, `MAREIGUA_HOST`,
`EXPERIAN_HOST`, `EXPERIAN_OPEN_CUSTOMER_INFO_HOST` y las `*_MOCK_HOST`. Lo más seguro es reemplazar el host en todas las
claves que lo contengan, igual que se hizo en qa, y redesplegar.

### Cómo se comprueba

Después del redespliegue, en Loki, la llamada saliente a Agil Data de una solicitud nueva tiene que ir a `9b6r8ticg0`:

    {service_name=~".+"} |= "Llamada saliente" |= "agildata"

### Cómo se vuelve atrás

Invertir el reemplazo en los dos secretos y redesplegar.

### Lo que conviene saber

- Los tres ambientes compartirían el mismo lambda. Lo que se dicta es por cédula, así que dos personas sólo se pisan si
  usan la misma.
- Hoy lo dictado vive en la memoria del contenedor que recibió el pedido: con varios contenedores calientes se pierde (en
  qa, de 12 lecturas a la vez, 2 devolvieron lo dictado). La rama `feat/dictado-compartido` del lambda lo resuelve
  guardándolo en DynamoDB; está probada en local y sin publicar. Con tres ambientes sobre el mismo lambda, conviene
  publicarla antes o junto con este cambio.
