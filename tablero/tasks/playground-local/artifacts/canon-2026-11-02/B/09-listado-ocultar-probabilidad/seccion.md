**La etiqueta de probabilidad de una tarjeta se puede ocultar desde la configuración, por comercio o por par comercio–entidad**, sin tocar código. Son dos marcas distintas y una manda sobre la otra:

- **En el comercio**, `allieds.hide_non_integrated_probability`: con la marca encendida, el asistente oculta la probabilidad de **todas las entidades de redirección** (tipo de respuesta 0), las que no tienen integración que decida, y deja las demás como están.
- **En el par comercio–entidad**, `lenders_by_allieds.hide_probability`: con la marca del comercio apagada, cada entidad oculta o muestra su probabilidad según este campo de su convenio con ese comercio.

**La marca del comercio gana entera.** Si está encendida, el campo por entidad se ignora para todas: una entidad integrada con `hide_probability` encendido vuelve a mostrar su probabilidad, y una de redirección la oculta aunque su par diga lo contrario.

Ocultar la probabilidad sólo saca la etiqueta: en las de CreditopX también saca la etiqueta «Pre aprobado», pero el cupo disponible se sigue mostrando, y la entidad conserva su lugar en el orden y su clasificación en el perfilamiento ([[listado/context#la-probabilidad-clasifica-no-significa-que-se-paso-la-politica-dura]]).

La marca del par se edita en el administrador de los dos monolitos; la del comercio, sólo en la gestión de comercios del monolito nuevo. Sólo el listado del monolito nuevo las entrega al asistente: la del par viaja en cada entidad y la del comercio en los datos del comercio de la respuesta. Lo decide la pantalla con lo que recibe; el listado del monolito viejo no envía la marca del par.
