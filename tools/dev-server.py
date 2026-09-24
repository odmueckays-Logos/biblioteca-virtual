"""Servidor local de desarrollo (solo para probar la escena en un navegador).

Uso:  python tools/dev-server.py [puerto]
Sirve la carpeta del proyecto con los tipos MIME correctos para módulos ES,
modelos .glb y fuentes .woff2, y sin caché para ver los cambios al recargar.
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "tools", "shots")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".glb": "model/gltf-binary",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".png": "image/png",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # Desarrollo: POST /__shot?name=x guarda una captura; POST /__save?path=... guarda
    # un archivo dentro del proyecto (ambos con el contenido en base64 o data URL).
    def do_POST(self):
        from urllib.parse import parse_qs, urlparse
        import base64

        if self.path.startswith("/__save"):
            rel = parse_qs(urlparse(self.path).query).get("path", [""])[0]
            target = os.path.normpath(os.path.join(ROOT, rel))
            if not rel or not target.startswith(ROOT):
                self.send_error(400)
                return
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("ascii")
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(base64.b64decode(body.split(",", 1)[-1]))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(target.encode("utf-8"))
            return

        if not self.path.startswith("/__shot"):
            self.send_error(404)
            return
        name = parse_qs(urlparse(self.path).query).get("name", ["shot"])[0]
        name = "".join(c for c in name if c.isalnum() or c in "-_") or "shot"
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("ascii")
        data = base64.b64decode(body.split(",", 1)[-1])
        out_dir = SHOT_DIR
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{name}.png")
        with open(path, "wb") as f:
            f.write(data)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(path.encode("utf-8"))

    def log_message(self, format, *args):
        if len(args) > 1 and str(args[1]).startswith(("4", "5")):
            super().log_message(format, *args)


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", PORT), functools.partial(Handler, directory=ROOT)
    )
    print(f"Biblioteca virtual en http://localhost:{PORT}/", flush=True)
    server.serve_forever()
