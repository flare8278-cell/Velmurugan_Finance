"""Smoke test the login background served from the production build."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


dist = Path(__file__).resolve().parents[1] / 'dist'
handler = partial(SimpleHTTPRequestHandler, directory=dist)
with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel='chrome')
            for width in (1440, 390):
                page = browser.new_page(viewport={'width': width, 'height': 900})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(url, wait_until='domcontentloaded')
                page.wait_for_function(
                    """() => {
                        const video = document.querySelector('video.login-earth-video');
                        return video?.videoWidth === 3392 && video.videoHeight === 2160
                            && video.currentTime > 0.1 && video.muted && video.loop
                            && !video.controls;
                    }""",
                    timeout=15000,
                )
                assert not page.locator('.globe-toolbar').count()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                assert not errors, errors
                page.close()
                print(f'PASS: silent, control-free Earth video at {width}px')
            browser.close()
    finally:
        server.shutdown()
