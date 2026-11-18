package main

// LOS FESTIVOS DE COLOMBIA. Lo normal se arma con los días del mismo tipo: hábiles con hábiles, y fines de semana con
// fines de semana. Un festivo en lunes se comparaba con días hábiles y se veía como una caída de todo el día: el lunes
// 16/11/2026 (el traslado del 11 de noviembre) entraron 739 solicitudes contra 1.341 de lo normal y el día dio 39
// tramos fuera de lo normal, casi todos por eso. Un festivo es un día de descanso, como un sábado o un domingo.
//
// Se calculan (no se escriben a mano por año): los de fecha fija, los que la Ley 51 de 1983 («Emiliani») mueve al lunes
// siguiente, y los que dependen de la Pascua.

import "time"

// restDay: un sábado, un domingo o un festivo de Colombia.
func restDay(t time.Time) bool {
	t = t.In(bogota)
	if wd := t.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return true
	}
	return dayOff(t)
}

var dayOffCache = map[int]map[string]bool{}

// dayOff: si la fecha (en Bogotá) es festivo en Colombia.
func dayOff(t time.Time) bool {
	t = t.In(bogota)
	y := t.Year()
	days, ok := dayOffCache[y]
	if !ok {
		days = colombianDaysOff(y)
		dayOffCache[y] = days
	}
	return days[t.Format("2006-01-02")]
}

func colombianDaysOff(y int) map[string]bool {
	out := map[string]bool{}
	date := func(m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, bogota) }
	add := func(t time.Time) { out[t.Format("2006-01-02")] = true }
	// El lunes siguiente (o el mismo día, si ya es lunes).
	monday := func(t time.Time) time.Time {
		for t.Weekday() != time.Monday {
			t = t.AddDate(0, 0, 1)
		}
		return t
	}
	// Fijos.
	for _, md := range [][2]int{{1, 1}, {5, 1}, {7, 20}, {8, 7}, {12, 8}, {12, 25}} {
		add(date(time.Month(md[0]), md[1]))
	}
	// Los que se trasladan al lunes.
	for _, md := range [][2]int{{1, 6}, {3, 19}, {6, 29}, {8, 15}, {10, 12}, {11, 1}, {11, 11}} {
		add(monday(date(time.Month(md[0]), md[1])))
	}
	// Los de la Pascua: Jueves y Viernes Santo, y la Ascensión, Corpus Christi y el Sagrado Corazón, trasladados.
	e := easter(y)
	add(e.AddDate(0, 0, -3))
	add(e.AddDate(0, 0, -2))
	add(monday(e.AddDate(0, 0, 39)))
	add(monday(e.AddDate(0, 0, 60)))
	add(monday(e.AddDate(0, 0, 68)))
	return out
}

// easter: el domingo de Pascua (el algoritmo gregoriano anónimo, de Meeus/Jones/Butcher).
func easter(y int) time.Time {
	a := y % 19
	b, c := y/100, y%100
	d, e := b/4, b%4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i, k := c/4, c%4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	month := (h + l - 7*m + 114) / 31
	day := (h+l-7*m+114)%31 + 1
	return time.Date(y, time.Month(month), day, 0, 0, 0, 0, bogota)
}
