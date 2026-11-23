"""Headless-browser smoke test.

Serves dist/index.html (run `npm run build` first) in Chrome with software WebGL and checks:
  1. The ride: starts, accepts keyboard input, moves along the road, renders non-blank pixels, no console errors.
  2. The Phase 0 perf spike (?spike=1&bench=1): the automatic benchmark completes and draws vehicles.
Software GL is slow, so this checks correctness, not speed.

Usage: python3 tests/smoke.py [screenshot_prefix]   (e.g. /tmp/shot -> /tmp/shot-ride.png, /tmp/shot-spike.png)
Needs: pip install playwright pillow, and Chrome (CHROME env var or /usr/bin/google-chrome).
"""
import http.server, os, socketserver, sys, threading
from io import BytesIO
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "dist"
PREFIX = sys.argv[1] if len(sys.argv) > 1 else None


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}/index.html"


def colours(png):
    img = Image.open(BytesIO(png)).convert("RGB").resize((64, 32))
    raw = img.tobytes()
    return len({raw[i:i + 3] for i in range(0, len(raw), 3)})


errors = []
with sync_playwright() as p:
    b = p.chromium.launch(
        executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"),
        args=["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
    )

    # ---- 1. the ride
    page = b.new_page(viewport={"width": 844, "height": 390})
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base)
    assert page.is_visible("#start"), "start screen shown"
    page.click("#startBtn")
    page.wait_for_function("window.__game", timeout=20000)
    assert not page.is_visible("#start") and page.is_visible("#ride"), "ride UI after tap"
    s0 = page.evaluate("window.__game.bike.s")
    page.keyboard.down("ArrowUp")
    page.wait_for_function("window.__game.bike.v > 6", timeout=60000)
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(500)
    page.keyboard.up("ArrowRight")
    page.wait_for_timeout(1500)
    ride_png = page.screenshot()
    state = page.evaluate("({s: window.__game.bike.s, d: window.__game.bike.d, v: window.__game.bike.v, odo: window.__game.bike.odo, chunks: window.__game.info().chunks, calls: window.__game.renderer.info.render.calls, tris: window.__game.renderer.info.render.triangles})")
    hud = page.inner_text("#speedo")
    page.keyboard.up("ArrowUp")
    print("ride:", state, "| speedo:", hud.replace("\n", " "))
    if PREFIX:
        Path(f"{PREFIX}-ride.png").write_bytes(ride_png)
    assert state["odo"] > 3, "bike moved"
    assert state["s"] != s0, "advanced along the road"
    assert 5 <= state["chunks"] <= 9, "road chunks streamed"
    assert state["calls"] < 100, "draw call budget"
    assert colours(ride_png) > 40, "ride view is not blank"
    assert abs(state["d"]) < 8, "stayed on the road"

    # ---- 2. the perf spike
    page2 = b.new_page(viewport={"width": 844, "height": 390})
    page2.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page2.on("pageerror", lambda e: errors.append(str(e)))
    page2.goto(base + "?spike=1&n=40&bench=1&benchSeconds=1")
    page2.wait_for_function("window.__bench && window.__bench.done", timeout=120000)
    bench = page2.evaluate("window.__bench")
    spike_png = page2.screenshot()
    if PREFIX:
        Path(f"{PREFIX}-spike.png").write_bytes(spike_png)
    print("spike:", [(r["n"], r["calls"], r["tris"]) for r in bench["results"]])
    assert [r["n"] for r in bench["results"]] == [20, 40, 60, 80, 100]
    assert all(r["calls"] > 5 and r["tris"] > 10000 for r in bench["results"])
    assert colours(spike_png) > 40
    b.close()

assert not errors, f"console errors: {errors}"
print("SMOKE OK")
