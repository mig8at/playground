package main

import "testing"

// Lo que producción tiene y dev no es lo que rompe; lo nuevo en dev, no. Los respaldos no se comparan.
func TestCompareSchemas(t *testing.T) {
	prod := map[string]map[string]string{
		"countries":                {"id": "int", "cell_phone_lenght": "varchar(255)"},
		"lenders":                  {"id": "int", "email": "varchar(255)"},
		"bkp_user_requests_202607": {"id": "int"},
		"old_table":                {"id": "int"},
	}
	dev := map[string]map[string]string{
		"countries": {"id": "bigint", "cell_phone_length": "varchar(255)"},
		"lenders":   {"id": "int", "email": "varchar(255)", "slug": "varchar(80)"},
	}
	r := compareSchemas(dev, prod,
		map[string]bool{"2026_10_14_090000_the_phone_length_column_loses_its_typo": true, "2026_01_01_000000_create_x": true, "base": true},
		map[string]bool{"base": true})
	if len(r.Gone) != 1 || r.Gone[0].Column != "cell_phone_lenght" {
		t.Fatalf("gone: %+v", r.Gone)
	}
	if len(r.GoneTables) != 1 || r.GoneTables[0] != "old_table" || r.Skipped != 1 {
		t.Fatalf("tablas: %v · sin comparar %d", r.GoneTables, r.Skipped)
	}
	if len(r.TypeChanged) != 1 || r.TypeChanged[0].Table != "countries" || r.Added != 2 {
		t.Fatalf("tipos %+v · nuevas %d", r.TypeChanged, r.Added)
	}
	if len(r.Pending) != 2 || len(r.Destructive) != 1 {
		t.Fatalf("migraciones: %v · riesgosas %v", r.Pending, r.Destructive)
	}
}
