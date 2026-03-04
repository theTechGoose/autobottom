#!/usr/bin/env bash
# Hot-reload dev server for mock.html
set -euo pipefail

PORT="${1:-3000}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Serving $DIR/mock.html on http://localhost:$PORT"
echo "Press Ctrl+C to stop"

# Write a tiny Python server to a temp file so we can pass args cleanly
TMPPY=$(mktemp /tmp/serve_mock.XXXXXXXX)
trap "rm -f '$TMPPY'; kill 0 2>/dev/null" EXIT INT TERM

cat > "$TMPPY" << 'PYEOF'
import http.server, os, json, sys

os.chdir(sys.argv[1])
PORT = int(sys.argv[2])

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/__poll":
            try:
                mt = os.path.getmtime("mock.html")
                b = json.dumps({"mtime": mt}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)
            except Exception:
                self.send_response(500)
                self.end_headers()
            return
        try:
            with open("mock.html", "rb") as f:
                b = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(b)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *a):
        try:
            s = str(a[0]) if a else ""
            if "/__poll" not in s:
                print(f"  {s}", file=sys.stderr)
        except Exception:
            pass

print(f"http://localhost:{PORT}", flush=True)
http.server.HTTPServer(("", PORT), H).serve_forever()
PYEOF

python3 "$TMPPY" "$DIR" "$PORT" &
SERVER_PID=$!

sleep 0.5
if command -v open &>/dev/null; then
    open "http://localhost:$PORT"
elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"
fi

wait $SERVER_PID
