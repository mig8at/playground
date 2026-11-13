/* QUÉ SE DICE DE UN MENSAJE EN LA VIDEOLLAMADA: lo conversado, hasta unos 40 segundos. Una explicación puede ser
   larga y se escucha entera mientras quepa (lo que cambió, qué se sugirió); lo que no es para el oído no se lee:
   títulos, tablas y código. Las listas sí: cada punto se dice como una frase. Si pasa de ~40 s, se dice hasta ahí, se
   cierra con «el resto se los dejo en el chat» y el personaje se queda leyendo.

   POR QUÉ 40 s: la regla del semáforo para hablar (los primeros 20 s en verde, de 20 a 40 en amarillo —el interés
   empieza a caer— y desde 40 en rojo). La guía pide ~55 palabras (~20 s) por mensaje; la llamada corta en el rojo.

   UN ADJUNTO lo muestra el personaje (una hoja, una foto) y, si el mensaje no trae texto que lo presente, se anuncia en
   una frase («les dejé un documento»). LOS MENSAJES DEL LLAVERO no se leen (son nombres de claves o valores
   encriptados): se anuncian. El texto completo queda siempre en el chat.

   La guía de cómo escribir para que esto casi no haga falta está en chat/CLAUDE.md §«Cómo habla un agente». */
import { forCall as forCallWith } from './voiceText.js'
import { speech } from './speech.js'

// La receta es voiceText.js (también la copia el servidor, para sincronizar). Acá sólo se le pone el tope de palabras
// del perfil (Voz, por defecto 150): un mensaje más largo no se dice, se silencia y la llamada lo avisa.
export const forCall = (message) => forCallWith(message, speech.maxWords)
