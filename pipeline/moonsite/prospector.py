"""Capas globales de composición del regolito y radiactividad natural (Lunar Prospector).

Fuente: NASA Lunar Prospector, espectrómetros de rayos gamma (GRS) y de neutrones (NS),
"special products" del PDS Geosciences Node (torio: Lawrence et al. 2003; ver también
Prettyman et al. 2006). Rejilla original: cilíndrica simple de 0,5° (720 × 360), primera fila en
el polo sur, primera columna en 180° O, enteros de 2 bytes big-endian (valor = 10 × dato,
salvo el potasio, 1 ×). Resolución real de las medidas: ~60–150 km.

Las capas guardan valores físicos (ppm, % en peso, nGy/h), nunca puntuaciones, y se
entregan en la malla oficial ``G1K`` del contrato de datos v0.2 (10 916 × 5 458, columna 0
en −180°, fila 0 en +90°, coordenadas en el centro de la celda). Como UInt16 con
``scale``/``offset`` (119 MB por capa) para compartir la mitad que en Float32 sin perder
precisión frente a la incertidumbre del dato. Los binarios no van a git (contrato §3.3):
se comparten en una release o en la carpeta del equipo; ``layer.json`` sí va a git.

La malla G1K es mucho más fina que el dato (huella real de ~60–150 km): el remuestreo
bilineal solo suaviza, no añade detalle.

Uso (desde pipeline/):
    python -m moonsite.prospector fetch          # descarga los 6 .dat (≈3 MB) a .cache/
    python -m moonsite.prospector build          # escribe layers/<id>/layer.json y G1K/static.u16
"""

from __future__ import annotations

import hashlib
import json
import sys

import numpy as np

from . import config as C

URL = "https://pds-geosciences.wustl.edu/missions/lunarp/reduced"
RAW = C.CACHE / "raw" / "lunar_prospector"
OUT = C.REPO / "layers"
OWNER = "Joel (T9 · composición y radiactividad)"
# Paso del UInt16 por capa (valor = entero × scale); 65 535 = sin dato
U16_SCALE = {"ice.hydrogen_ppm": 0.01, "regolith.feo_wt_pct": 0.001, "regolith.tio2_wt_pct": 0.001,
             "radiation.thorium_ppm": 0.001, "radiation.potassium_ppm": 0.1, "radiation.uranium_ppm": 0.0001,
             "radiation.natural_gamma_dose": 0.01}
COLS, ROWS = 10916, 5458
STEP = 360.0 / COLS

LP_SOURCE = {
    "name": "Lunar Prospector GRS/NS special products (0.5°)",
    "url": "https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html",
    "citation": "Lunar Prospector Spectrometer Team, NASA PDS Geosciences Node",
}
NOTE = ("Bilinear resampling of the 0.5° simple-cylindrical product (longitude wraps at ±180°). "
        "True footprint ~60–150 km: finer grids add no detail.")

# id → (fichero, divisor del binario, factor físico, título, unidades, validRange, método, cita extra)
LAYERS = {
    "ice.hydrogen_ppm": ("hydrogenhd", 10, 1.0, "Hydrogen abundance", "ppm", [0, 1000],
                         "Lunar Prospector neutron spectrometer hydrogen map (half-degree). Negative values "
                         "(counting noise) are set to 0.", "Lunar Prospector Spectrometer Team, PDS special products (hydrogenhd)"),
    "regolith.feo_wt_pct": ("ironhd", 10, 1.0, "Iron oxide (FeO)", "wt%", [0, 40],
                            "Lunar Prospector GRS FeO abundance (half-degree).", "Lunar Prospector Spectrometer Team, PDS special products (ironhd)"),
    "regolith.tio2_wt_pct": ("titanium2d", 10, 1.6683, "Titanium dioxide (TiO2)", "wt%", [0, 25],
                             "Lunar Prospector GRS Ti abundance (2° bins on the 0.5° grid) converted to TiO2 "
                             "with the molar-mass ratio 1.6683.", "Lunar Prospector Spectrometer Team, PDS special products (titanium2d)"),
    "radiation.thorium_ppm": ("thoriumhd", 10, 1.0, "Thorium abundance", "ppm", [0, 100],
                              "Lunar Prospector GRS thorium map (half-degree).", "Lawrence et al. (2003), JGR 108"),
    "radiation.potassium_ppm": ("potassium2d", 1, 1.0, "Potassium abundance", "ppm", [0, 20000],
                                "Lunar Prospector GRS potassium (2° bins).", "Prettyman et al. (2006), JGR 111"),
    "radiation.uranium_ppm": ("uranium5d", 10, 1.0, "Uranium abundance", "ppm", [0, 20],
                              "Lunar Prospector GRS uranium (5° bins, 150 km).", "Prettyman et al. (2006), JGR 111"),
}
#: Capa derivada: tasa de dosis gamma natural (factores de conversión estándar para un
#: semiespacio de suelo; ver UNSCEAR 2000). Indica la radiactividad del suelo, no la dosis
#: total de un astronauta (dominada por rayos cósmicos y eventos solares).
DOSE = ("radiation.natural_gamma_dose", "Natural gamma dose rate from soil K, U and Th", "nGy/h", [0, 500],
        "D = 13.078·K[%] + 5.675·U[ppm] + 2.494·Th[ppm] (standard soil-to-dose factors, UNSCEAR 2000) "
        "applied to the Lunar Prospector K, U and Th layers. Relative indicator of soil radioactivity; "
        "excludes galactic cosmic rays and solar particle events, which dominate the total lunar dose.")


def fetch() -> None:
    import requests
    RAW.mkdir(parents=True, exist_ok=True)
    for name in sorted({v[0] for v in LAYERS.values()}):
        p = RAW / f"{name}.dat"
        if p.exists() and p.stat().st_size == 720 * 360 * 2:
            print(f"   ya está {p.name}")
            continue
        r = requests.get(f"{URL}/{name}.dat", timeout=120)
        r.raise_for_status()
        p.write_bytes(r.content)
        print(f"   {p.name} ({len(r.content)} B)")


def read(name: str, div: float) -> np.ndarray:
    """Matriz 360 × 720 con fila 0 = norte (centros 89,75°N … 89,75°S), columna 0 = 179,75°O."""
    raw = np.fromfile(RAW / f"{name}.dat", dtype=">i2")
    if raw.size != 720 * 360:
        raise SystemExit(f"{name}.dat: {raw.size} valores, se esperaban 259200 (¿descarga incompleta?)")
    return np.flipud(raw.reshape(360, 720).astype(np.float64) / div)


def sample(m: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Interpolación bilineal en la rejilla de 0,5°, continua en longitud."""
    fy = np.clip((90.0 - lat) / 0.5 - 0.5, 0, 359)
    fx = ((lon + 180.0) % 360.0) / 0.5 - 0.5
    y0 = np.floor(fy).astype(int); y1 = np.minimum(y0 + 1, 359); wy = fy - y0
    x0 = np.floor(fx).astype(int); wx = fx - x0
    x0 %= 720; x1 = (x0 + 1) % 720
    top = m[y0, x0] * (1 - wx) + m[y0, x1] * wx
    bot = m[y1, x0] * (1 - wx) + m[y1, x1] * wx
    return top * (1 - wy) + bot * wy


def g1k(m: np.ndarray, scale: float) -> np.ndarray:
    """Remuestrea a G1K por bloques de filas y cuantiza a UInt16."""
    out = np.empty((ROWS, COLS), dtype="<u2")
    lon = -180.0 + (np.arange(COLS) + 0.5) * STEP
    for r0 in range(0, ROWS, 512):
        r1 = min(ROWS, r0 + 512)
        lat = 90.0 - (np.arange(r0, r1) + 0.5) * STEP
        la, lo = np.meshgrid(lat, lon, indexing="ij")
        v = sample(m, la, lo)
        q = np.rint(v / scale)
        out[r0:r1] = np.where(np.isfinite(q), np.clip(q, 0, 65534), 65535).astype("<u2")
    return out


def sha256_file(p) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write(lid: str, title: str, units: str, vrange, method: str, sources, m: np.ndarray) -> None:
    d = OUT / lid
    (d / "G1K").mkdir(parents=True, exist_ok=True)
    scale = U16_SCALE[lid]
    q = g1k(m, scale)
    f = d / "G1K" / "static.u16"
    q.tofile(f)
    valid = q[q != 65535]
    meta = {"id": lid, "version": "0.2.0", "title": title, "units": units, "validRange": vrange,
            "kind": "static", "owner": OWNER, "fidelity": "approximate", "method": f"{method} {NOTE}",
            "params": {"sourceResolutionDeg": 0.5, "resampling": "bilinear"}, "sources": sources,
            "files": [{"grid": "G1K", "period": "static", "path": "G1K/static.u16", "dtype": "uint16",
                       "scale": scale, "offset": 0, "nodata": 65535, "sha256": sha256_file(f),
                       "min": round(float(valid.min()) * scale, 6), "max": round(float(valid.max()) * scale, 6)}]}
    (d / "layer.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"   {lid}: {meta['files'][0]['min']:.4g} … {meta['files'][0]['max']:.4g} {units}")


def build() -> None:
    data = {}
    for lid, (name, div, fac, title, units, vr, method, cite) in LAYERS.items():
        m = read(name, div) * fac
        if lid == "ice.hydrogen_ppm":
            m = np.clip(m, 0, None)
        data[lid] = m
        write(lid, title, units, vr, method, [LP_SOURCE, {"name": "Reference", "citation": cite}], m)
    lid, title, units, vr, method = DOSE
    dose = 13.078 * data["radiation.potassium_ppm"] / 1e4 + 5.675 * data["radiation.uranium_ppm"] \
        + 2.494 * data["radiation.thorium_ppm"]
    write(lid, title, units, vr, method,
          [LP_SOURCE, {"name": "Dose conversion factors", "citation": "UNSCEAR (2000), Annex B"}], dose)
    print(f"Listo: {OUT} (binarios G1K fuera de git; comparte layers/<id>/G1K/)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "fetch":
        fetch()
    elif cmd == "build":
        build()
    else:
        raise SystemExit(__doc__)
