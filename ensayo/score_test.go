package main

import "testing"

func TestGradeReadsNumbersWithThousandsSeparators(t *testing.T) {
	if m := Grade("Se desembolsaron 1.234 solicitudes.", []string{"1234"}); len(m) != 0 {
		t.Errorf("1.234 es 1234: faltó %v", m)
	}
	if m := Grade("Se desembolsaron 12.340", []string{"1234"}); len(m) != 1 {
		t.Errorf("12340 no es 1234")
	}
}

func TestGradeTextIgnoresCaseAndSpacing(t *testing.T) {
	m := Grade("Sale de `Modules/Loans/.../devicecontroller.php`", []string{"DeviceController.php"})
	if len(m) != 0 {
		t.Errorf("faltó %v", m)
	}
}

func TestRouteCatchesTheMissingTarget(t *testing.T) {
	q := Question{ID: "x", Must: []string{"E2E_TARGET=local.*harness-listing"}}
	c := []string{"Bash make harness-listing MERCHANT=pullman"}
	bad, _ := Route(q, c, c)
	if len(bad) != 1 {
		t.Fatalf("sin E2E_TARGET=local la ruta tiene que fallar: %v", bad)
	}
	c = []string{"Bash E2E_TARGET=local make harness-listing MERCHANT=pullman"}
	bad, _ = Route(q, c, c)
	if len(bad) != 0 {
		t.Errorf("con E2E_TARGET=local la ruta está bien: %v", bad)
	}
}

func TestRouteForbidsCountingByStatus11(t *testing.T) {
	q := Question{ID: "x", MustNot: []string{`user_request_status_id\s*(=|IN)\s*\(?\s*11`}}
	tried := []string{"Bash bin/pg sql --target prod --query 'SELECT COUNT(*) FROM user_requests WHERE user_request_status_id in (11)'"}
	bad, _ := Route(q, nil, tried)
	if len(bad) != 1 {
		t.Errorf("contar por el estado 11 está prohibido: %v", bad)
	}
}

// Un juez caído no puede leerse como acierto: menos se lee igual que «no existe».
func TestNoJudgeIsNotGraded(t *testing.T) {
	r := Run{Answer: "cualquier cosa"}
	_ = Score(&r, Question{ID: "x"}, Verdict{Error: "500"}, nil, nil)
	if r.Graded || r.Correct {
		t.Errorf("sin juez no se califica: %+v", r)
	}
}

func run(q string, graded, correct, route bool, friction int, cost float64) Run {
	return Run{Question: q, Graded: graded, Correct: correct, RouteOK: route, Friction: friction, CostUSD: cost}
}

func TestCompareSameBatchIsNotAdopted(t *testing.T) {
	a := []Run{run("p", true, true, true, 0, 1), run("p", true, false, true, 1, 1)}
	rows, adopt := Compare(a, a)
	if adopt || rows[0].Status != "igual" {
		t.Errorf("una tanda contra sí misma es «igual» y no se adopta: %+v %v", rows, adopt)
	}
}

func TestCompareRejectsWhenOneQuestionDrops(t *testing.T) {
	a := []Run{run("p", true, true, true, 0, 1), run("q", true, false, true, 0, 1)}
	b := []Run{run("p", true, false, true, 0, 1), run("q", true, true, true, 0, 1)}
	_, adopt := Compare(a, b)
	if adopt {
		t.Error("si una pregunta baja su acierto, B no se adopta aunque otra suba")
	}
}

func TestCompareAdoptsBetterRouteAtSameAccuracy(t *testing.T) {
	a := []Run{run("p", true, true, false, 2, 1)}
	b := []Run{run("p", true, true, true, 0, 1.1)}
	rows, adopt := Compare(a, b)
	if !adopt || rows[0].Status != "mejor" {
		t.Errorf("mismo acierto y mejor ruta: %+v", rows)
	}
}

func TestCompareRejectsMuchCostlierTie(t *testing.T) {
	a := []Run{run("p", true, true, true, 0, 1)}
	b := []Run{run("p", true, true, true, 0, 2)}
	rows, _ := Compare(a, b)
	if rows[0].Status != "peor" {
		t.Errorf("mismo resultado al doble de costo es peor: %+v", rows)
	}
}

func TestCompareSaysWhenThereIsNoJudge(t *testing.T) {
	a := []Run{run("p", false, false, true, 0, 1)}
	b := []Run{run("p", true, true, true, 0, 1)}
	rows, adopt := Compare(a, b)
	if rows[0].Status != "sin juez" || adopt {
		t.Errorf("sin juez en A no se puede decir que B mejoró: %+v", rows)
	}
}

// El caso que destapó la primera corrida real: el permiso frenó los `git grep` contra main y el modelo
// terminó leyendo el working tree. Un intento frenado no cumple la ruta.
func TestRouteIgnoresCallsThatFailed(t *testing.T) {
	q := Question{ID: "x", Must: []string{"origin/main"}}
	all := []string{"Bash git -C legacy-backend grep -F 'x' origin/main", `Grep {"pattern":"x"}`}
	bad, _ := Route(q, all[1:], all)
	if len(bad) != 1 {
		t.Errorf("el git grep frenado no cuenta como haber mirado main: %v", bad)
	}
}
