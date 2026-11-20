"""Generate high-resolution Paty-themed Natural Earth equirectangular map texture.

Fetches official Natural Earth 50m land vector polygons and renders a crisp,
anti-aliased 2048x1024 equirectangular texture for Three.js SphereGeometry.
Palette matches Paty: deep navy oceans (#03080e), muted cyan/blue land (#0a2a42),
crisp sky-blue coastlines (#38bdf8), and subtle graticule grid lines (#081728).
"""
import json
import os
import urllib.request
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson'

def generate():
    print(f'Fetching Natural Earth 50m land dataset from {URL}...')
    req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        geojson = json.loads(resp.read().decode('utf-8'))

    # Super-sampled canvas for anti-aliased coastlines
    W, H = 4096, 2048
    img = Image.new('RGB', (W, H), color='#03080e')  # Deep navy ocean
    draw = ImageDraw.Draw(img)

    # Subtle graticule grid lines
    grid_color = '#081728'
    for lat in [-60, -30, 0, 30, 60]:
        y = int((90 - lat) / 180.0 * H)
        draw.line([(0, y), (W, y)], fill=grid_color, width=2)

    for lon in range(-150, 180, 30):
        x = int((lon + 180) / 360.0 * W)
        draw.line([(x, 0), (x, H)], fill=grid_color, width=2)

    # Equator line
    eq_y = int(90 / 180.0 * H)
    draw.line([(0, eq_y), (W, eq_y)], fill='#0c2136', width=3)

    def to_screen(coords):
        return [((lon + 180) / 360.0 * W, (90 - lat) / 180.0 * H) for lon, lat in coords]

    land_fill = '#0a2a42'      # Muted cyan/blue land
    coast_color = '#38bdf8'    # Crisp Paty sky-blue coastline
    lake_fill = '#03080e'      # Deep navy ocean
    lake_coast = '#0e4166'     # Subtle lake boundary

    print('Rendering filled continents...')
    for f in geojson['features']:
        geom = f['geometry']
        gtype = geom['type']
        polys = [geom['coordinates']] if gtype == 'Polygon' else geom['coordinates']
        for p in polys:
            if not p or len(p[0]) < 3:
                continue
            draw.polygon(to_screen(p[0]), fill=land_fill)

    print('Rendering inland lakes...')
    for f in geojson['features']:
        geom = f['geometry']
        gtype = geom['type']
        polys = [geom['coordinates']] if gtype == 'Polygon' else geom['coordinates']
        for p in polys:
            for hole in p[1:]:
                if len(hole) < 3:
                    continue
                draw.polygon(to_screen(hole), fill=lake_fill)

    print('Rendering crisp coastlines...')
    for f in geojson['features']:
        geom = f['geometry']
        gtype = geom['type']
        polys = [geom['coordinates']] if gtype == 'Polygon' else geom['coordinates']
        for p in polys:
            if not p or len(p[0]) < 2:
                continue
            draw.line(to_screen(p[0]), fill=coast_color, width=4)
            for hole in p[1:]:
                if len(hole) >= 2:
                    draw.line(to_screen(hole), fill=lake_coast, width=2)

    print('Downsampling with Lanczos filter to 2048x1024...')
    final = img.resize((2048, 1024), Image.Resampling.LANCZOS)

    out_assets = ROOT / 'src/assets/earth-natural-paty.png'
    out_assets.parent.mkdir(parents=True, exist_ok=True)

    final.save(out_assets, optimize=True)
    print(f'Done! Saved {out_assets} ({os.path.getsize(out_assets)} bytes)')

if __name__ == '__main__':
    generate()
