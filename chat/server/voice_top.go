package main

// LAS MEJORES VOCES EN ESPAÑOL (las que se usan por defecto). Salen del ranking de la biblioteca de ElevenLabs
// (GET /v1/shared-voices?language=es&gender=…&sort=usage_character_count_1y, consultado el 2026-11-13): las más usadas
// del último año, sólo adultas y en español —sin voces de personajes animados, de anuncios ni de niños—, con acentos
// (latino neutro, colombiano, mexicano, argentino, de España) y tonos distintos. En este orden: arriba, la más usada.
// Se usan por su id, sin agregarlas a la cuenta (probado: la llave las acepta y cuestan lo mismo).
//
// Para refrescar el ranking: se repite esa consulta y se cambia esta lista. `uses` es para leerla, no se usa.

type topVoice struct {
	Name, ID, Gender, Accent, Tone string
	Uses                           int64 // caracteres generados con ella en el último año (al consultarla)
}

var topVoices = []topVoice{
	{"Cristina Campos", "CaJslL1xziwefCeTNzHv", "female", "latin american", "amigable y suave", 12280833433},
	{"Fernando Martínez", "dlGxemPxFMTY7iXagmOj", "male", "latin american", "rápido y persuasivo", 10096990460},
	{"Norah", "kcQkGnn0HAT2JRDQ4Ljp", "female", "latin american", "cálida, amigable y clara", 7177882395},
	{"Andrea", "qHkrJuifPpn95wK3rm2A", "female", "latin american", "amable, alegre y calmada", 4571234962},
	{"Alberto Rodríguez", "l1zE9xgNpUTaQCZzpNJa", "male", "latin american", "serio, de narrador", 4005694154},
	{"Tatiana Martin", "2rigMbVWLdqtBSCahJFX", "female", "latin american", "sabia y calmada", 2141165840},
	{"Carolina", "UOIqAnmS11Reiei1Ytkc", "female", "peninsular", "natural, neutra y clara", 2129905586},
	{"Valeria", "9oPKasc15pfAbMr7N6Gs", "female", "argentine", "alegre y pegajosa", 1852476618},
	{"Alejandro", "sDh3eviBhiuHKi0MjTNq", "male", "mexican", "corporativo y elegante", 1679147117},
	{"David Martin", "Nh2zY9kknu6z4pZy6FhD", "male", "peninsular", "seguro y equilibrado", 1630192680},
	{"Lumina", "x5IDPSl4ZUbhosMmVFTk", "female", "colombian", "neutra y clara", 1440893696},
	{"Enrique Mondragón", "iDEmt5MnqUotdwCIVplo", "male", "mexican", "elegante y dinámico", 1393627496},
	{"Antonio", "htFfPSZGJwjBv1CL0aMD", "male", "latin american", "seguro, gentil y claro", 1233795470},
	{"Sofía", "b2htR0pMe28pYwCY9gnP", "female", "colombian", "natural y conversadora", 1188810298},
	{"Marcela", "86V9x9hrQds83qf7zaGn", "female", "colombian", "suave y natural", 1021198625},
	{"Jhenny", "2Lb1en5ujrODDIqmp7F3", "female", "latin american", "suave, calmada y dulce", 986764898},
	{"Miguel", "k8cFOyAg7B9qwBlDDNTC", "male", "latin american", "grave, rica y de cine", 932004275},
	{"Mauricio", "94zOad0g7T7K4oa7zhDq", "male", "latin american", "calmado y conversador", 870249410},
	{"Juan Carlos", "YExhVa4bZONzeingloMX", "male", "latin american", "cálido y conversador", 532987454},
	{"El Faraon", "W1hAcdh0RNsPYUA7fkJh", "male", "colombian", "grave, potente y serena", 466541222},
}

// topVoiceID: el id de una de las mejores voces por su nombre ("" si no es de la lista).
func topVoiceID(name string) string {
	for _, v := range topVoices {
		if v.Name == name {
			return v.ID
		}
	}
	return ""
}
