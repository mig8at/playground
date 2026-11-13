package main

// LO QUE SE DICE DE UN MENSAJE, en Go: la copia de chat/src/voiceText.js que usa la sincronización (voice_sync.go)
// para generar las frases antes de que la videollamada las pida. Tienen que dar EXACTAMENTE lo mismo —cada frase se
// guarda por voz y texto, y una frase distinta es una que la llamada no encuentra y vuelve a pagar—: lo comprueba
// TestVoiceTextParity, que corre la versión de JS con node sobre los mismos mensajes. Si cambiás una, cambiá la otra.
//
// Las expresiones de JS ven como espacio también los de Unicode (el no separable, los anchos…) y las de Go no: por eso
// `\s` va acá como jsSpace.

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"creditop/playground/chat/cli"
)

const (
	voiceMaxChars     = 650
	voiceMaxWords     = 150
	voiceMaxSentences = 20
)

// los espacios de JS (\s): los de ASCII y los de Unicode
const jsSpace = `\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func jsTrim(s string) string      { return strings.TrimFunc(s, isJSSpace) }
func jsTrimStart(s string) string { return strings.TrimLeftFunc(s, isJSSpace) }

var (
	reImageName   = regexp.MustCompile(`(?i)\.(png|jpe?g|gif|webp)$`)
	reCodeBlock   = regexp.MustCompile("```[\\s\\S]*?```")
	reURL         = regexp.MustCompile(`https?://([^/` + jsSpace + `)]+)[^` + jsSpace + `)]*`)
	reInlineCode  = regexp.MustCompile("`([^`]+)`")
	reEmphasis    = regexp.MustCompile(`\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_`)
	reBullet      = regexp.MustCompile(`(?m)^[` + jsSpace + `]*[-*•][` + jsSpace + `]+`)
	reHeading     = regexp.MustCompile(`(?m)^[` + jsSpace + `]*#+[` + jsSpace + `]*`)
	reSpaces      = regexp.MustCompile(`[` + jsSpace + `]+`)
	reDroppedLine = regexp.MustCompile(`^[` + jsSpace + `]*(#{1,6}[` + jsSpace + `]|\|)`)
	reListItem    = regexp.MustCompile(`^[` + jsSpace + `]*([-*•]|\d+[.)])[` + jsSpace + `]+`)
	reEndsPunct   = regexp.MustCompile(`[.!?:]$`)
	reSentence    = regexp.MustCompile(`[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]`)
	reLetter      = regexp.MustCompile(`\p{L}`)
	reMention     = regexp.MustCompile(`(?i)(^|[^\w@./-])@([a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)?)`)
	reHandleTail  = regexp.MustCompile(`[._-]+$`)
	reKeyAsk      = regexp.MustCompile(`^🔑[` + jsSpace + `]*Pido`)
	reKeyList     = regexp.MustCompile(`^🔑[` + jsSpace + `]*Mi llavero`)
	reKeyBlock    = regexp.MustCompile(`=U2FsdGVkX1`)
	reWWW         = regexp.MustCompile(`^www\.`)
)

// replaceGroups: como el replace de JS con función: f recibe los grupos (los que no participaron, vacíos).
func replaceGroups(re *regexp.Regexp, s string, f func(g []string) string) string {
	var b strings.Builder
	last := 0
	for _, m := range re.FindAllStringSubmatchIndex(s, -1) {
		b.WriteString(s[last:m[0]])
		g := make([]string, len(m)/2)
		for i := range g {
			if m[2*i] >= 0 {
				g[i] = s[m[2*i]:m[2*i+1]]
			}
		}
		b.WriteString(f(g))
		last = m[1]
	}
	b.WriteString(s[last:])
	return b.String()
}

func isImageFile(f cli.File) bool {
	return reImageName.MatchString(f.Name) && (f.Type == "" || strings.HasPrefix(f.Type, "image/"))
}

func tooLongForVoice(text string, maxWords int) bool {
	if maxWords <= 0 {
		maxWords = voiceMaxWords
	}
	return len(strings.FieldsFunc(text, isJSSpace)) > maxWords
}

// forSpeech: el texto como se escucha.
func forSpeech(text string) string {
	s := reCodeBlock.ReplaceAllString(text, " (bloque de código) ")
	s = replaceGroups(reURL, s, func(g []string) string { return " un enlace de " + reWWW.ReplaceAllString(g[1], "") + " " })
	s = reInlineCode.ReplaceAllString(s, "$1")
	s = replaceGroups(reEmphasis, s, func(g []string) string {
		for _, x := range g[1:] {
			if x != "" {
				return x
			}
		}
		return ""
	})
	s = reBullet.ReplaceAllString(s, "")
	s = reHeading.ReplaceAllString(s, "")
	s = reSpaces.ReplaceAllString(s, " ")
	return jsTrim(s)
}

// forCallText: lo que la llamada dice de un mensaje (vacío: nada) y si se silencia por largo.
func forCallText(m cli.Message, maxWords int) (text string, muted bool) {
	raw := m.Text
	if k := keyringSpoken(raw); k != "" {
		return k, false
	}
	if tooLongForVoice(raw, maxWords) {
		return "", true
	}
	dropped := false
	text = reCodeBlock.ReplaceAllStringFunc(raw, func(string) string { dropped = true; return "\n" })
	var lines []string
	for _, line := range strings.Split(text, "\n") {
		if reDroppedLine.MatchString(line) {
			dropped = true
			continue
		}
		if reListItem.MatchString(line) {
			item := jsTrim(reListItem.ReplaceAllString(line, ""))
			if item == "" {
				continue
			}
			if !reEndsPunct.MatchString(item) {
				item += "."
			}
			lines = append(lines, item)
			continue
		}
		lines = append(lines, line)
	}
	text = strings.Join(lines, " ")
	var all []string
	for _, s := range reSentence.FindAllString(text, -1) {
		if s = jsTrim(s); reLetter.MatchString(s) {
			all = append(all, s)
		}
	}
	var said []string
	size := 0
	for _, s := range all {
		n := utf16Len(s)
		if size+n > voiceMaxChars && len(said) > 0 {
			dropped = true
			break
		}
		said = append(said, s)
		size += n + 1
	}
	if len(said) < len(all) {
		said = append(said, "El resto se los dejo en el chat.")
	}
	images := 0
	for _, f := range m.Files {
		if isImageFile(f) {
			images++
		}
	}
	docs := len(m.Files) - images
	if len(m.Files) > 0 && len(said) == 0 {
		said = append(said, attachmentSpoken(images, docs))
	} else if dropped && len(said) == 0 {
		said = append(said, "Les dejé algo para leer en el chat.")
	}
	return strings.Join(said, " "), false
}

// utf16Len: el largo como lo cuenta JS (.length), en unidades de UTF-16.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func attachmentSpoken(images, docs int) string {
	switch {
	case images > 0 && docs > 0:
		return "Les dejé unos archivos."
	case images == 1:
		return "Les dejé una imagen."
	case images > 1:
		return fmt.Sprintf("Les dejé %d imágenes.", images)
	case docs == 1:
		return "Les dejé un documento."
	default:
		return fmt.Sprintf("Les dejé %d documentos.", docs)
	}
}

func keyringSpoken(text string) string {
	t := jsTrimStart(text)
	switch {
	case reKeyAsk.MatchString(t):
		return "Les pedí unas claves del llavero."
	case reKeyList.MatchString(t):
		return "Les mostré qué claves tengo en el llavero."
	case strings.HasPrefix(t, "🔒") || reKeyBlock.MatchString(t):
		return "Les mandé unas claves del llavero, encriptadas."
	}
	return ""
}

// spokenNames: cada @mención por el nombre del personaje (names: clave en minúscula → nombre).
func spokenNames(text string, names map[string]string) string {
	return replaceGroups(reMention, text, func(g []string) string {
		pre, handle := g[1], g[2]
		h := strings.ToLower(reHandleTail.ReplaceAllString(handle, ""))
		tail := handle[len(h):]
		if h == "todos" {
			return pre + "todos" + tail
		}
		name := names[h]
		if name == "" {
			parts := strings.Split(h, "/")
			name = strings.Split(parts[len(parts)-1], ".")[0]
		}
		r, size := utf8.DecodeRuneInString(name)
		return pre + string(unicode.ToUpper(r)) + name[size:] + tail
	})
}

// voiceSentences: frases cortas, limpias para el oído, hasta voiceMaxSentences.
func voiceSentences(text string) []string {
	var out []string
	for _, s := range reSentence.FindAllString(forSpeech(text), -1) {
		if s = jsTrim(s); s != "" {
			out = append(out, s)
		}
		if len(out) == voiceMaxSentences {
			break
		}
	}
	return out
}

// callLines: las frases que la videollamada dice de un mensaje (nada si está silenciado o no dice nada).
func callLines(m cli.Message, names map[string]string, maxWords int) []string {
	text, muted := forCallText(m, maxWords)
	if muted || text == "" {
		return nil
	}
	return voiceSentences(spokenNames(text, names))
}
