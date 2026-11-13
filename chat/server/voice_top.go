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

// LAS VOCES DE LOS ANIMALES: las 20 de arriba son para las PERSONAS (Miguel, Duncan… los reales); los animales hablan
// con voces de personaje (la biblioteca de ElevenLabs con use_cases=characters_animation, en español, adultas, sin
// susurros, llantos ni monstruos), y cada especie tiene su voz de mujer y su voz de hombre. Dos animales de la misma
// especie suenan igual, y especies parecidas pueden compartir: el carácter lo pone la voz, no la exclusividad.
var characterVoices = []topVoice{
	{"Soraya", "TNI5EQSCUrYwvhb2wpzt", "female", "latin american", "segura, grave y de mando", 0},
	{"Betty", "iV6xDQ4wcM3ZcXDx30GB", "female", "latin american", "caricaturesca y cálida", 0},
	{"Kate", "U9tZtg3uJtVgXPkvosWR", "female", "latin american", "cuentacuentos juguetona", 0},
	{"Grandma Aurora", "aYQAm4rWuigkeuRA5i92", "female", "latin american", "grave y cariñosa", 0},
	{"Granny", "M9RTtrzRACmbUzsEMq8p", "female", "peninsular", "viejita de caricatura", 0},
	{"Carito", "WtRYgQbAJ4i0AckgdVbq", "female", "venezuelan", "chistosa y cómica", 0},
	{"Natalia", "zJtOCbdQjTZt7YZtkRDP", "female", "latin american", "versátil", 0},
	{"Emma", "tbfu7H6JPPlpF9clW89V", "female", "latin american", "feroz e intensa", 0},
	{"Mary", "Ugu6b5thG2v8TpHWKQhs", "female", "peninsular", "aterciopelada", 0},
	{"Claudia", "fXWh1uWJcqhsBnk5RY7Q", "female", "chilean", "alegre", 0},
	{"Denisse", "JLjbyFxQ9y50fnjDTvoD", "female", "latin american", "gentil", 0},
	{"Marcela Suave", "gXNPKp01Qauo3Uoh4uUG", "female", "colombian", "suave e íntima", 0},
	{"Leónidas", "YKrm0N1EAM9Bw27j8kuD", "male", "peninsular", "guerrero espartano", 0},
	{"Thorthugo", "WOY6pnQ1WCg0mrOZ54lM", "male", "latin american", "amigo juguetón, aguda", 0},
	{"Loren", "XjH5RKDOGNZertWZPiTJ", "male", "peninsular", "paródico y burlón", 0},
	{"Jack", "CE9m1PQE2E76CKUkNL7C", "male", "latin american", "voz grave", 0},
	{"Profesor Quirk", "pmbvTcigLSLJPZPWD6QD", "male", "latin american", "científico", 0},
	{"Ivan", "R2Pq3ERXfDMQB548iPNB", "male", "latin american", "escandaloso y dramático", 0},
	{"Charlee", "cQIBhnciTWugZAxX52uW", "male", "latin american", "personaje de fantasía", 0},
	{"Murdock", "OLmSqlYzB06EIKJRy5b0", "male", "latin american", "grave y de mando", 0},
	{"Martin Osborne", "z3kTTwYbQrmL7ckdGcJi", "male", "peninsular", "pulido e intenso", 0},
	{"Gaston", "Az8xj7Z0gQ5npNFesTsW", "male", "peninsular", "teatral", 0},
	{"Nelson", "zQZEXxkYK67Wxt8JAph5", "male", "latin american", "dinámico y claro", 0},
	{"El Nero", "ljWLDJb7OMkYo3VM9z8g", "male", "latin american", "relajado, del barrio", 0},
	{"Efrayn", "1MxuWc12WPRxDkgfT3kj", "male", "peninsular", "sereno y expresivo", 0},
	{"Johnny", "HMCmDsbKeaSZp5LMOYKR", "male", "peninsular", "burlón y sarcástico", 0},
	{"Kurry Caché", "zuKOnzM8OJyC1IQIhCHR", "male", "peninsular", "suave y cálido", 0},
	{"Mario", "hB5hCADt0EAxTSWmybdE", "male", "mexican", "serio y sincero", 0},
}

// speciesVoices: por especie (las de office/personajes.js), su voz de mujer y su voz de hombre.
var speciesVoices = map[string][2]string{
	"leon":     {"Soraya", "Leónidas"},
	"panda":    {"Betty", "Thorthugo"},
	"zorro":    {"Kate", "Loren"},
	"oso":      {"Grandma Aurora", "Jack"},
	"buho":     {"Granny", "Profesor Quirk"},
	"tucan":    {"Carito", "Ivan"},
	"loro":     {"Carito", "Ivan"},
	"rana":     {"Carito", "Ivan"},
	"pato":     {"Carito", "Johnny"},
	"mico":     {"Natalia", "Charlee"},
	"conejo":   {"Natalia", "Charlee"},
	"gorila":   {"Emma", "Murdock"},
	"jaguar":   {"Emma", "Martin Osborne"},
	"gato":     {"Mary", "Gaston"},
	"perro":    {"Claudia", "Nelson"},
	"cerdito":  {"Betty", "Nelson"},
	"raton":    {"Betty", "Thorthugo"},
	"capibara": {"Denisse", "El Nero"},
	"perezoso": {"Denisse", "El Nero"},
	"koala":    {"Marcela Suave", "Efrayn"},
	"oveja":    {"Denisse", "Kurry Caché"},
	"pinguino": {"Claudia", "Mario"},
	"mapache":  {"Kate", "Johnny"},
}

// voiceIDByName: el id de una voz de las dos listas (personas o personajes) por su nombre.
func voiceIDByName(name string) string {
	if id := topVoiceID(name); id != "" {
		return id
	}
	for _, v := range characterVoices {
		if v.Name == name {
			return v.ID
		}
	}
	return ""
}
