#!/usr/bin/env bash
# Corre el backfill de país EN LOCAL (Docker, base propia — NO la compartida de dev/qa/staging) y
# revierte exactamente lo que movió. Sirve para validar el plan antes de mandar el PR.
#
# ⚠ La reversa guarda los IDS que movió, no «todo lo que esté en 47 vuelve a 1»: si mañana hay
# entidades legítimamente colombianas, una reversa en bloque se las llevaría puestas.
set -uo pipefail
APP=~/Desktop/CREDITOP/github/legacy-application
RESP=/tmp/backfill-respaldo.json
COLOMBIA=47

case "${1:-}" in
  aplicar)
    (cd "$APP" && php artisan tinker --execute='
      $ids = App\Models\Lender::where("country_id", 1)->pluck("id")->all();
      $com = App\Models\Allied::where("country_id", 1)->pluck("id")->all();
      file_put_contents("'"$RESP"'", json_encode(["lenders" => $ids, "allieds" => $com]));
      App\Models\Lender::whereIn("id", $ids)->update(["country_id" => '"$COLOMBIA"']);
      App\Models\Allied::whereIn("id", $com)->update(["country_id" => '"$COLOMBIA"']);
      printf("  movidas %d entidades y %d comercios al pais %d (respaldo con sus ids)\n", count($ids), count($com), '"$COLOMBIA"');
    ' 2>&1 | grep movidas)
    ;;
  revertir)
    (cd "$APP" && php artisan tinker --execute='
      $r = json_decode(file_get_contents("'"$RESP"'"), true);
      App\Models\Lender::whereIn("id", $r["lenders"])->update(["country_id" => 1]);
      App\Models\Allied::whereIn("id", $r["allieds"])->update(["country_id" => 1]);
      printf("  revertidas %d entidades y %d comercios al pais 1\n", count($r["lenders"]), count($r["allieds"]));
    ' 2>&1 | grep revertidas)
    ;;
  estado)
    (cd "$APP" && php artisan tinker --execute='
      foreach (["lenders" => App\Models\Lender::class, "allieds" => App\Models\Allied::class] as $n => $m) {
        printf("  %-9s pais 1: %-4d pais 47: %-4d otros: %d\n", $n,
          $m::where("country_id",1)->count(), $m::where("country_id",47)->count(),
          $m::whereNotIn("country_id",[1,47])->count());
      }
      // lo que VERÍA el codigo viejo, que filtra `where(country_id, 1)` a mano
      printf("  ⚠ entidades activas que ve el CÓDIGO VIEJO (filtra = 1): %d\n",
        App\Models\Lender::where("status",1)->where("country_id",1)->count());
    ' 2>&1 | grep -E "pais 1:|CÓDIGO VIEJO")
    ;;
  *) echo "uso: $0 aplicar|revertir|estado"; exit 1;;
esac
