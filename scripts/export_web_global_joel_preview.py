#!/usr/bin/env python3
"""
Export temporal W4 (1440×720) de les capes T9 de Joel (Lunar Prospector)
per a la pestanya Global de la web.

Mateixa orientació que el contracte / Jan: lon0=−180°, fila 0 = nord.
Fusiona les entrades al manifest existent a web/public/data/global/
(sense recalcular slope/suitability).
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data" / "global"
RAW = ROOT / ".cache" / "raw" / "lunar_prospector"
URL = "https://pds-geosciences.wustl.edu/missions/lunarp/reduced"

COLS, ROWS = 1440, 720  # W4
STEP = 360.0 / COLS

# id → (fitxer PDS, divisor, factor físic, etiqueta, unitats, res_deg, res_note)
LAYERS = {
    "ice.hydrogen_ppm": ("hydrogenhd", 10, 1.0, "Hydrogen", "ppm", 0.5, "0.5° Lunar Prospector NS (~15 km grid; footprint ~60–150 km)"),
    "regolith.feo_wt_pct": ("ironhd", 10, 1.0, "FeO", "wt%", 0.5, "0.5° Lunar Prospector GRS"),
    "regolith.tio2_wt_pct": ("titanium2d", 10, 1.6683, "TiO2", "wt%", 2.0, "2° bins on 0.5° LP grid"),
    "radiation.thorium_ppm": ("thoriumhd", 10, 1.0, "Thorium", "ppm", 0.5, "0.5° Lunar Prospector GRS"),
    "radiation.potassium_ppm": ("potassium2d", 1, 1.0, "Potassium", "ppm", 2.0, "2° bins Lunar Prospector GRS"),
    "radiation.uranium_ppm": ("uranium5d", 10, 1.0, "Uranium", "ppm", 5.0, "5° bins Lunar Prospector GRS (~150 km)"),
}


def fetch_all() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for name in sorted({v[0] for v in LAYERS.values()}):
        p = RAW / f"{name}.dat"
        if p.exists() and p.stat().st_size == 720 * 360 * 2:
            print(f"   ja està {p.name}")
            continue
        print(f"   baixant {name}.dat…")
        with urllib.request.urlopen(f"{URL}/{name}.dat", timeout=120) as resp:
            data = resp.read()
        p.write_bytes(data)
        print(f"   {p.name} ({len(data)} B)")


def read_lp(name: str, div: float) -> np.ndarray:
    """360×720, fila 0 = nord, columna 0 ≈ 180°O."""
    raw = np.fromfile(RAW / f"{name}.dat", dtype=">i2")
    if raw.size != 720 * 360:
        raise SystemExit(f"{name}.dat: {raw.size} valors (esperats 259200)")
    return np.flipud(raw.reshape(360, 720).astype(np.float64) / div)


def sample(m: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    fy = np.clip((90.0 - lat) / 0.5 - 0.5, 0, 359)
    fx = ((lon + 180.0) % 360.0) / 0.5 - 0.5
    y0 = np.floor(fy).astype(int)
    y1 = np.minimum(y0 + 1, 359)
    wy = fy - y0
    x0 = np.floor(fx).astype(int)
    wx = fx - x0
    x0 %= 720
    x1 = (x0 + 1) % 720
    top = m[y0, x0] * (1 - wx) + m[y0, x1] * wx
    bot = m[y1, x0] * (1 - wx) + m[y1, x1] * wx
    return top * (1 - wy) + bot * wy


def to_w4(m: np.ndarray) -> np.ndarray:
    lon = -180.0 + (np.arange(COLS) + 0.5) * STEP
    lat = 90.0 - (np.arange(ROWS) + 0.5) * STEP
    la, lo = np.meshgrid(lat, lon, indexing="ij")
    return sample(m, la, lo).astype("<f4")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print("Fetch Lunar Prospector special products…")
    fetch_all()

    data = {}
    layer_meta = {}
    for lid, (name, div, fac, label, units, res_deg, res_note) in LAYERS.items():
        print(f"  W4 ← {lid}")
        m = read_lp(name, div) * fac
        if lid == "ice.hydrogen_ppm":
            m = np.clip(m, 0, None)
        data[lid] = m
        arr = to_w4(m)
        fname = lid.replace(".", "_") + ".f32"
        arr.tofile(OUT / fname)
        finite = arr[np.isfinite(arr)]
        layer_meta[lid] = {
            "file": fname,
            "dtype": "float32",
            "units": units,
            "label": label,
            "group": "joel",
            "min": float(finite.min()) if finite.size else None,
            "max": float(finite.max()) if finite.size else None,
            "sourceResolution": res_note,
            "sourceResolutionDeg": res_deg,
            "sourceResolutionKm": round(res_deg * 30.0, 1),  # ≈ km a l'equador (1° ≈ 30 km)
        }

    # Dosis gamma natural (UNSCEAR 2000), mateixa fórmula que prospector.py
    print("  W4 ← radiation.natural_gamma_dose")
    dose = (
        13.078 * data["radiation.potassium_ppm"] / 1e4
        + 5.675 * data["radiation.uranium_ppm"]
        + 2.494 * data["radiation.thorium_ppm"]
    )
    arr = to_w4(dose)
    fname = "radiation_natural_gamma_dose.f32"
    arr.tofile(OUT / fname)
    finite = arr[np.isfinite(arr)]
    layer_meta["radiation.natural_gamma_dose"] = {
        "file": fname,
        "dtype": "float32",
        "units": "nGy/h",
        "label": "Gamma dose",
        "group": "joel",
        "min": float(finite.min()) if finite.size else None,
        "max": float(finite.max()) if finite.size else None,
        "function": "13.078*K[%] + 5.675*U[ppm] + 2.494*Th[ppm]",
        "sourceResolution": "derived from K/U/Th (coarsest driver ~5° U)",
        "sourceResolutionDeg": 5.0,
        "sourceResolutionKm": 150,
    }

    man_path = OUT / "manifest.json"
    if man_path.exists():
        meta = json.loads(man_path.read_text(encoding="utf-8"))
    else:
        meta = {
            "temporary": True,
            "grid": {
                "id": "W4",
                "cols": COLS,
                "rows": ROWS,
                "lon0": -180.0,
                "lat0": 90.0,
                "stepDeg": STEP,
                "order": "row-major, row 0 = north",
            },
            "layers": {},
        }

    meta["temporary"] = True
    meta["note"] = (
        "Preview W4 storage grid is the same for all layers (1440×720, 0.25°). "
        "Joel T9 native resolution is Lunar Prospector (~0.5–5° / 15–150 km): "
        "bilinear to W4/G1K does not add detail. Jan slope comes from LOLA (~100 m)."
    )
    meta.setdefault("layers", {})
    # Manté slope/suitability si ja hi són; marca grup
    for k in ("slope", "suitability"):
        if k in meta["layers"]:
            meta["layers"][k]["group"] = "jan"
            if k == "slope":
                meta["layers"][k].setdefault("label", "Slope")
            if k == "suitability":
                meta["layers"][k].setdefault("label", "Suitability")
    meta["layers"].update(layer_meta)
    meta["sources"] = {
        "jan": "scripts/export_web_global_preview.py (LOLA LDEM)",
        "joel": "Lunar Prospector GRS/NS special products (PDS) via export_web_global_joel_preview.py",
    }
    man_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"OK → {OUT}")
    for lid, info in layer_meta.items():
        print(f"  {lid}: [{info['min']:.4g}, {info['max']:.4g}] {info['units']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
