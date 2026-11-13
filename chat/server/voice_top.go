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
// con estas, y cada especie tiene su voz de mujer y su voz de hombre. Son FLUIDAS, no chillonas: el 2026-11-13 se
// midieron (la misma frase con cada una, su tono medio y cuánto salta, en semitonos) y quedaron sólo las de tono normal
// —mujeres de 188 a 242 Hz, hombres de 94 a 174 Hz— que saltan poco. Se descartaron las de caricatura de antes
// (Thorthugo 348 Hz, Betty 305, Carito 302, Granny 258, Iván 224 para un hombre) y las que saltan mucho (Martin
// Osborne 11 semitonos). Las graves van a los animales grandes, las livianas a los chicos; especies parecidas comparten.
// Dos animales de la misma especie suenan igual: el carácter lo pone la voz, no la exclusividad.
var characterVoices = []topVoice{
	{"Melanie", "bN1bDXgDIGX5lw0rtY2B", "female", "argentine", "warm, clear and professional, 188 Hz", 0},
	{"Malena", "p7AwDmKvTdoHTBuueGvP", "female", "argentine", "warm, dynamic and confident, 198 Hz", 0},
	{"Ana María", "m7yTemJqdIqrcNleANfX", "female", "mexican", "calm, natural and clear, 211 Hz", 0},
	{"Sara Martin", "gD1IexrzCvsXPHUuT0s3", "female", "peninsular", "young and reflective, 211 Hz", 0},
	{"Isabela", "1BxAZWANeDIxeyHKSJF2", "female", "latin american", "pleasant, calm and melodic, 213 Hz", 0},
	{"Gaby", "5vkxOzoz40FrElmLP4P7", "female", "peruvian", "friendly, expressive and vibrant, 216 Hz", 0},
	{"Isabel", "rixsIpPlTphvsJd2mI03", "female", "mexican", "neutral, balanced and calm, 219 Hz", 0},
	{"Gabriela González", "gxSxrhNNXvdHpOH0EHjV", "female", "latin american", "bubbly, clear, warm, 221 Hz", 0},
	{"Lydia", "SDVJaMLoJa7wc3s2sn7d", "female", "peninsular", "warm, energetic and confident, 222 Hz", 0},
	{"Fran", "crQgCQuWgUucmYHEPsrB", "female", "latin american", "vibrant, energetic and neutral, 242 Hz", 0},
	{"Alejandro Duràn", "sKgg4MPUDBy69X7iv3fA", "male", "latin american", "warm, deep and hoarse, 94 Hz", 0},
	{"Santiago", "15bJsujCI3tcDWeoZsQP", "male", "", "clear, playful, warm, 103 Hz", 0},
	{"Brian Latino", "jBlmi27XRORxjPquUeCh", "male", "latin american", "warm, smooth, confident, 106 Hz", 0},
	{"Martin Alvarez", "Wl3O9lmFSMgGFTTwuS6f", "male", "latin american", "soothing and hopeful, 119 Hz", 0},
	{"Aaron Abad", "t9LRTh3y1ioN00e9wsNh", "male", "peninsular", "native castilian, 126 Hz", 0},
	{"Gabo", "o0SveC0zgHFuCsEO3vHR", "male", "peninsular", "deep, evocative and resonant, 130 Hz", 0},
	{"Enrique M. Nieto", "gbTn1bmCvNgk0QEAVyfM", "male", "mexican", "credible and rich, 139 Hz", 0},
	{"Emilio", "ZCh4e9eZSUf41K4cmCEL", "male", "peninsular", "warm, solid and convincing, 150 Hz", 0},
	{"David", "qRUgOhnxGASxirG4fKjv", "male", "mexican", "energetic, deep and pleasant, 165 Hz", 0},
	{"Rada", "HJmys3t5KLr6DUWl0kSe", "male", "latin american", "relaxed, confident, calm, 174 Hz", 0},
}

// speciesVoices: por especie (las de office/personajes.js), su voz de mujer y su voz de hombre.
var speciesVoices = map[string][2]string{
	"leon":     {"Malena", "Gabo"},
	"panda":    {"Gabriela González", "Santiago"},
	"zorro":    {"Gaby", "David"},
	"oso":      {"Melanie", "Alejandro Duràn"},
	"buho":     {"Isabela", "Enrique M. Nieto"},
	"tucan":    {"Fran", "Rada"},
	"loro":     {"Fran", "David"},
	"rana":     {"Gaby", "Santiago"},
	"pato":     {"Gabriela González", "Santiago"},
	"mico":     {"Lydia", "David"},
	"conejo":   {"Sara Martin", "Rada"},
	"gorila":   {"Malena", "Alejandro Duràn"},
	"jaguar":   {"Lydia", "Brian Latino"},
	"gato":     {"Isabel", "Brian Latino"},
	"perro":    {"Gaby", "Emilio"},
	"cerdito":  {"Gabriela González", "Emilio"},
	"raton":    {"Sara Martin", "Santiago"},
	"capibara": {"Ana María", "Martin Alvarez"},
	"perezoso": {"Ana María", "Martin Alvarez"},
	"koala":    {"Isabel", "Martin Alvarez"},
	"oveja":    {"Isabela", "Aaron Abad"},
	"pinguino": {"Melanie", "Aaron Abad"},
	"mapache":  {"Lydia", "Gabo"},
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
