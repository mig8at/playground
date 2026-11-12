"""Office · el servidor de la llamada y el editor (:5220).

Es el servidor estático de Python, pero sin caché: después de cambiar personajes.js o personajes.css el navegador
servía la versión vieja (pasó varias veces) y había que recargar forzando. Con «Cache-Control: no-store» cada recarga
trae lo que está en disco.

    python3 office/serve.py [puerto]
"""
import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5220
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCache, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Office en http://localhost:{port} (sin caché)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
