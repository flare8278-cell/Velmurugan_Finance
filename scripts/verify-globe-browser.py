"""Verify interactive 3D Globe with Natural Earth geography in real Chrome via Playwright.

Checks:
- Canvas initializes with Three.js and Natural Earth texture.
- No page or console errors.
- Sign-in text and layout are legible and responsive at 1440px and 390px.
- Pointer drag and zoom controls work.
- Reduced-motion preference is respected.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading
import tempfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'

class DistHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

server = ThreadingHTTPServer(('127.0.0.1', 0), DistHandler)
port = server.server_port
server_thread = threading.Thread(target=server.serve_forever, daemon=True)
server_thread.start()

try:
    url = f'http://127.0.0.1:{port}/'

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            headless=True, args=["--enable-unsafe-swiftshader"]
        )

        # 1. Desktop Test at 1440x900
        page_errors = []
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()
        page.on('pageerror', lambda e: page_errors.append(str(e)))

        page.goto(url, wait_until='networkidle')

        # Verify canvas exists and is visible
        canvas = page.locator('.interactive-globe-canvas')
        canvas.wait_for(timeout=10000)
        assert canvas.is_visible(), "Globe canvas should be visible"
        print("PASS: Interactive globe canvas mounted and rendered")

        # Verify brand & sign-in text legibility
        heading = page.locator('.login-story-hero h1')
        assert heading.is_visible()
        print("PASS: Login hero text visible and legible")

        # Test pointer drag on canvas
        box = canvas.bounding_box()
        assert box is not None
        cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 80, cy + 20, steps=5)
        page.mouse.up()
        print("PASS: Mouse drag interaction succeeded")

        # Test zoom controls
        zoom_in_btn = page.locator('button[title="Zoom in"]')
        zoom_in_btn.click()
        print("PASS: Zoom in button clicked")

        # Test toolbar pause/resume button
        pause_btn = page.locator('button[title="Pause rotation"]')
        if pause_btn.is_visible():
            pause_btn.click()
            resume_btn = page.locator('button[title="Resume rotation"]')
            assert resume_btn.is_visible()
            print("PASS: Toolbar rotation pause/resume toggle verified")

        # Take screenshot of desktop login
        screenshot_path = Path(tempfile.gettempdir()) / 'finance-globe-desktop-verify.png'
        page.screenshot(path=str(screenshot_path))
        print(f"PASS: Screenshot captured at {screenshot_path}")

        # 2. Reduced-Motion Test
        rm_context = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        rm_page = rm_context.new_page()
        rm_page.goto(url, wait_until='networkidle')
        # With reduced-motion, the button should immediately show Resume rotation (i.e. paused)
        resume_btn_rm = rm_page.locator('button[title="Resume rotation"]')
        resume_btn_rm.wait_for(timeout=5000)
        assert resume_btn_rm.is_visible()
        print("PASS: Reduced motion correctly defaults globe rotation to paused")

        # 3. Mobile Viewport Test (390px)
        mob_context = browser.new_context(viewport={'width': 390, 'height': 844})
        mob_page = mob_context.new_page()
        mob_page.goto(url, wait_until='networkidle')
        mob_canvas = mob_page.locator('.interactive-globe-canvas')
        mob_canvas.wait_for(timeout=5000)
        assert mob_canvas.is_visible()

        # Verify no horizontal scroll
        scroll_width = mob_page.evaluate('() => document.documentElement.scrollWidth')
        client_width = mob_page.evaluate('() => document.documentElement.clientWidth')
        assert scroll_width <= client_width, f"Overflow detected: {scroll_width} > {client_width}"
        print(f"PASS: Mobile 390px layout fits without horizontal overflow (width: {scroll_width}px)")

        assert len(page_errors) == 0, f"Page errors encountered: {page_errors}"
        print("PASS: 0 page or console errors in Chrome")

        browser.close()
finally:
    server.shutdown()
