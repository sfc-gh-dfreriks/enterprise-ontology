#!/usr/bin/env python3
"""Convert a TopoJSON world land outline into plain GeoJSON for the ripple map.

The map is hand-rolled SVG, so shipping GeoJSON means the client needs no
topojson decoder at runtime — one fewer dependency for one static asset that
never changes.

Fetches once and commits the result. Re-run only to change the source or the
simplification threshold.

Run:  python3 tools/build_land_geojson.py
Out:  client/public/land.geo.json
"""
import json
import pathlib
import sys
import urllib.request

SOURCES = [
    "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json",
    "https://unpkg.com/world-atlas@2/land-110m.json",
]
OUT = pathlib.Path(__file__).resolve().parent.parent / "client" / "public" / "land.geo.json"

# Minimum ring area in square degrees. At 110m resolution anything below this is
# a single pixel on screen but still costs bytes; dropping them roughly halves
# the payload with no visible difference at world scale.
MIN_AREA_SQ_DEG = 2.0
# Coordinate precision. Three decimals is ~100 m, far finer than a world map needs.
PRECISION = 2


def fetch() -> dict:
    last = None
    for url in SOURCES:
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
                return json.load(r)
        except Exception as e:              # noqa: BLE001 — try the next mirror
            last = e
            print(f"  {url} failed: {e}")
    sys.exit(f"could not fetch a land outline: {last}")


def main() -> None:
    src = fetch()
    tr = src["transform"]
    sx, sy = tr["scale"]
    tx, ty = tr["translate"]

    def decode(arc):
        """TopoJSON arcs are delta-encoded on a quantized integer grid."""
        x = y = 0
        out = []
        for dx, dy in arc:
            x += dx
            y += dy
            out.append([round(x * sx + tx, PRECISION), round(y * sy + ty, PRECISION)])
        return out

    arcs = [decode(a) for a in src["arcs"]]

    def ring(idxs):
        """A negative index means traverse that arc backwards (one's complement)."""
        pts = []
        for i in idxs:
            a = arcs[~i][::-1] if i < 0 else arcs[i]
            pts.extend(a if not pts else a[1:])
        return pts

    # world-atlas wraps the MultiPolygon in a GeometryCollection, so the polygons
    # are one level deeper than a bare geometry object would put them.
    land = src["objects"]["land"]
    geoms = land.get("geometries", [land]) if land.get("type") == "GeometryCollection" else [land]

    polys = []
    for g in geoms:
        if g["type"] == "MultiPolygon":
            for poly in g["arcs"]:
                polys.append([ring(r) for r in poly])
        elif g["type"] == "Polygon":
            polys.append([ring(r) for r in g["arcs"]])

    def area(r):
        return abs(sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
                       for i in range(len(r) - 1)) / 2)

    kept = [p for p in polys if p and len(p[0]) > 3 and area(p[0]) >= MIN_AREA_SQ_DEG]
    if not kept:
        sys.exit("every polygon was filtered out — MIN_AREA_SQ_DEG is too high")

    geo = {"type": "FeatureCollection", "features": [{
        "type": "Feature", "properties": {"name": "land"},
        "geometry": {"type": "MultiPolygon", "coordinates": kept},
    }]}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(geo, separators=(",", ":")))

    xs = [c[0] for p in kept for r in p for c in r]
    ys = [c[1] for p in kept for r in p for c in r]
    print(f"wrote {OUT}")
    print(f"  polygons {len(polys)} -> {len(kept)} kept  (>= {MIN_AREA_SQ_DEG} sq deg)")
    print(f"  points   {len(xs):,}")
    print(f"  size     {OUT.stat().st_size / 1024:.0f} KB")
    print(f"  lon      {min(xs):.1f} .. {max(xs):.1f}")
    print(f"  lat      {min(ys):.1f} .. {max(ys):.1f}")


if __name__ == "__main__":
    main()
