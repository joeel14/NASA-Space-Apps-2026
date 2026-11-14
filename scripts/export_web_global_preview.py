#!/usr/bin/env python3
"""
Export temporal W4 (1440×720) de slope + suitability per a la web.

No substitueix G1K: és una vista ràpida equirectangular per provar la connexió
amb el front. Escriu a web/public/data/global/.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from scipy.ndimage import median_filter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data" / "global"

URL = (
    "https://planetarymaps.usgs.gov/mosaic/"
    "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
)
R = 1_737_400.0
COLS, ROWS = 1440, 720  # W4
VETO = 15.0


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    left, right = -np.pi * R, np.pi * R
    top, bottom = 0.5 * np.pi * R, -0.5 * np.pi * R
    res_x = (right - left) / COLS
    res_y = (top - bottom) / ROWS
    transform = from_origin(left, top, res_x, res_y)

    print(f"Warp LOLA → W4 {COLS}×{ROWS}…")
    dem = np.full((ROWS, COLS), np.nan, dtype="float32")
    with rasterio.open(f"/vsicurl/{URL}") as src:
        nodata = src.nodata if src.nodata is not None else -32768.0
        reproject(
            source=rasterio.band(src, 1),
            destination=dem,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=nodata,
            dst_transform=transform,
            dst_crs=src.crs,
            dst_nodata=np.nan,
            resampling=Resampling.average,
        )

    nans = ~np.isfinite(dem)
    dem = median_filter(np.nan_to_num(dem, nan=0.0), size=3).astype("float32")
    dem[nans] = np.nan

    rows = np.arange(ROWS, dtype="float64")
    northings = transform.f + (rows + 0.5) * transform.e
    cos_lat = np.clip(np.cos(northings / R), 1e-6, None)
    dz_dy, dz_dx_map = np.gradient(dem, res_y, res_x)
    dz_dx = dz_dx_map / cos_lat[:, None]
    slope = np.degrees(np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))).astype("float32")
    slope[nans] = np.nan

    s = np.nan_to_num(slope, nan=90.0)
    suit = np.clip(100.0 * (1.0 - s / VETO), 0.0, 100.0).astype("float32")
    suit[nans] = 0.0
    suit[s >= VETO] = 0.0

    slope.astype("<f4").tofile(OUT / "slope.f32")
    suit.astype("<f4").tofile(OUT / "suitability.f32")

    meta = {
        "temporary": True,
        "note": "Preview W4 from scripts/terrain_safety pipeline (Jan). Not G1K.",
        "grid": {
            "id": "W4",
            "cols": COLS,
            "rows": ROWS,
            "lon0": -180.0,
            "lat0": 90.0,
            "stepDeg": 360.0 / COLS,
            "order": "row-major, row 0 = north",
        },
        "layers": {
            "slope": {
                "file": "slope.f32",
                "dtype": "float32",
                "units": "deg",
                "min": float(np.nanmin(slope)),
                "max": float(np.nanmax(slope)),
            },
            "suitability": {
                "file": "suitability.f32",
                "dtype": "float32",
                "units": "score_0_100",
                "min": float(suit.min()),
                "max": float(suit.max()),
                "function": "100 * max(0, 1 - slope_deg / 15)",
            },
        },
        "source": URL,
    }
    (OUT / "manifest.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"OK → {OUT}")
    print(f"  slope [{meta['layers']['slope']['min']:.1f}, {meta['layers']['slope']['max']:.1f}]°")
    print(f"  suitability [{meta['layers']['suitability']['min']:.0f}, {meta['layers']['suitability']['max']:.0f}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
