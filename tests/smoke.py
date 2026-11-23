"""Headless-browser smoke test (Phase 0 perf spike).

Serves dist/index.html (run `npm run build` first), loads it in Chrome with software WebGL and checks:
no console errors, the canvas renders non-blank pixels, the HUD shows vehicles and draw calls, and the
automatic benchmark (?bench=1) completes. Software GL is slow, so this checks correctness, not speed.

Usage: python3 tests/smoke.py [screenshot_path]
Needs: pip install playwright, and Chrome (CHROME env var or google-chrome).
"""
import http.server, os, socketserver, sys, threading
from io import BytesIO
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "dist"
SHOT = Path(sys.argv[1]) if len(sys.argv) > 1 else None


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(
        executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"),
        args=["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    )
    page = b.new_page(viewport={"width": 844, "height": 390})
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url + "?n=40&bench=1&benchSeconds=1")
    page.wait_for_function("window.__bench && window.__bench.done", timeout=120000)
    bench = page.evaluate("window.__bench")
    hud = page.inner_text("#hud")
    png = page.screenshot()
    b.close()

img = Image.open(BytesIO(png)).convert("RGB")
if SHOT:
    SHOT.write_bytes(png)
colors = len(set(img.resize((64, 32)).tobytes()[i:i + 3] for i in range(0, 64 * 32 * 3, 3)))
print("hud:", hud)
print("bench:", bench["results"])
assert not errors, f"console errors: {errors}"
assert not bench.get("error"), bench
assert len(bench["results"]) == 5, "benchmark did not finish all steps"
assert [r["n"] for r in bench["results"]] == [20, 40, 60, 80, 100], "vehicle counts"
assert all(r["calls"] > 5 and r["tris"] > 10000 for r in bench["results"]), "nothing drawn"
assert colors > 40, f"canvas looks blank ({colors} colours)"
assert "vehicles" in hud and "calls" in hud
print("SMOKE OK")
