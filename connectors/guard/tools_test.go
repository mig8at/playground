package guard

import "testing"

// El guard no puede volverse una lista de palabras comunes: lo que se nombra afuera tiene que ser
// exactamente lo que nadie más puede correr. La mitad de este test son los casos que NO se frenan, y
// son los que importan — «panel» es el de administración del producto, «canon» es el pago mensual del
// renting, «suite» es la de PHPUnit del repo real y «plantillas» son las del contrato. Buscar esas
// palabras habría dado 7 falsos positivos sobre las 32 publicables reales (medido el 2026-09-15).
func TestGuardBlocksOwnToolsButNotBusinessVocabulary(t *testing.T) {
	blocks := []string{
		"Se corrió `make harness-caso` contra dev.",
		"Ver en localhost:5195 el resultado.",
		"Exportar E2E_TARGET=dev antes de correr.",
		"El trazador muestra el error del servicio.",
		"Se probó con la cuadrilla del equipo.",
	}
	passes := []string{
		"Se recorrió el flujo completo del asesor en dev.",
		"Probar en qa con el comercio Alta Fleet.",
		"Abrir el panel de administración y editar la sucursal.",
		"El canon mensual del renting se calcula sobre 52 semanas.",
		"Se corrió la migración y un backfill de 1.200 filas en producción.",
		"Las plantillas del contrato a nombre de Alta Fleet.",
		"La suite de pruebas del backend queda acotada por rutas.",
		"Se hicieron consultas sobre la tabla de solicitudes.",
	}
	for _, s := range blocks {
		if v := Violations(s); len(v) == 0 {
			t.Errorf("tenía que frenar y pasó: %q", s)
		}
	}
	for _, s := range passes {
		if v := Violations(s); len(v) > 0 {
			t.Errorf("tenía que pasar y lo frenó (%s): %q", v[0]["what"], s)
		}
	}
}

// Los patrones que ya existían tienen que seguir frenando: al reponer los `\b` de los nuevos se tocó
// la misma lista, y una lista de regex es justo donde un arreglo rompe lo de al lado sin avisar.
func TestGuardStillBlocksPreviousPatterns(t *testing.T) {
	for _, s := range []string{
		"El hallazgo es F-154.",
		"Vive en el playground de Miguel.",
		"Se tocó legacy-backend y frontend-monorepo.",
		"El archivo es app/routes.tsx.",
		"<!-- Qué se logra. Una oración -->",
	} {
		if v := Violations(s); len(v) == 0 {
			t.Errorf("tenía que frenar y pasó: %q", s)
		}
	}
}

// Los hosts de la compañía pasan; el nombre suelto no. Una tarea para infraestructura tiene que poder
// decir QUÉ host configurar, y esos hosts llevan el nombre de las herramientas.
func TestGuardLetsCompanyHostsThrough(t *testing.T) {
	for _, s := range []string{
		"Agregar la regla en `playground.creditop.com` y `cuadrilla.playground.creditop.com`.",
		"Abrir https://credibot.playground.creditop.com/api/yo con la cuenta de la compañía.",
	} {
		if v := Violations(s); len(v) > 0 {
			t.Errorf("tenía que pasar y lo frenó (%s → %s): %q", v[0]["what"], v[0]["found"], s)
		}
	}
	for _, s := range []string{
		"Se probó en el playground y en cuadrilla.",
		"Ver playground.creditop.example y la cuadrilla.",
	} {
		if v := Violations(s); len(v) == 0 {
			t.Errorf("tenía que frenar y pasó: %q", s)
		}
	}
}
