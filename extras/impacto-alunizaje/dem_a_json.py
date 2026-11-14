"""
dem_a_json.py — Convierte un DEM real (GeoTIFF) en el .json que carga el simulador 3D.

Fuentes recomendadas (polo sur lunar, proyección estereográfica polar en metros):
  - NASA PGDA, productos LOLA de alta resolución del polo sur (p. ej. 5 m/píxel)
  - LOLA LDEM polar (20–60 m/píxel) en el PDS Geosciences Node
Descárgalos tú desde el navegador (desde aquí no hay acceso a esas webs).

Uso:
  pip install rasterio numpy
  python3 dem_a_json.py MI_DEM.tif                       # centro del ráster
  python3 dem_a_json.py MI_DEM.tif --x 12000 --y -34000  # centro en coordenadas del ráster (m)
  python3 dem_a_json.py MI_DEM.tif --semiancho 4500 --n 512 --salida relieve.json

El simulador cubre ±4,5 km alrededor del centro: elige como centro el sitio de alunizaje candidato.
"""
import argparse, base64, json
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

ap = argparse.ArgumentParser()
ap.add_argument("tif")
ap.add_argument("--x", type=float, help="centro X en unidades del ráster (m)")
ap.add_argument("--y", type=float, help="centro Y en unidades del ráster (m)")
ap.add_argument("--semiancho", type=float, default=4500.0, help="m desde el centro hasta el borde")
ap.add_argument("--n", type=int, default=512, help="tamaño de la rejilla de salida")
ap.add_argument("--salida", default="relieve.json")
a = ap.parse_args()

with rasterio.open(a.tif) as src:
    if src.crs and src.crs.is_geographic:
        raise SystemExit("El DEM está en grados. Usa un producto proyectado en metros (estereográfica polar).")
    cx = a.x if a.x is not None else (src.bounds.left + src.bounds.right) / 2
    cy = a.y if a.y is not None else (src.bounds.bottom + src.bounds.top) / 2
    e = min(a.semiancho, (src.bounds.right - src.bounds.left) / 2, (src.bounds.top - src.bounds.bottom) / 2)
    win = from_bounds(cx - e, cy - e, cx + e, cy + e, src.transform)
    z = src.read(1, window=win, out_shape=(a.n, a.n), resampling=Resampling.bilinear,
                 boundless=True, fill_value=np.nan).astype("float32")
    if src.nodata is not None:
        z[z == src.nodata] = np.nan
    escala = (src.scales[0] if src.scales else 1.0) or 1.0
    res = abs(src.res[0])
    z *= escala   # algunos productos guardan la altura escalada; revisa las unidades del tuyo

if np.isnan(z).mean() > 0.2:
    raise SystemExit("Más del 20 % sin datos: elige otro centro o un semiancho menor.")
z = np.where(np.isnan(z), np.nanmean(z), z)
# fila 0 = norte (borde superior del ráster), igual que el simulador
out = {"n": a.n, "semiancho_m": e, "centro_xy": [cx, cy], "res_m": res, "fuente": f"{a.tif} · centro ({cx:.0f}, {cy:.0f}) m",
       "z_min_m": float(z.min()), "z_max_m": float(z.max()),
       "z_b64": base64.b64encode(z.astype("<f4").tobytes()).decode()}
json.dump(out, open(a.salida, "w"))
print(f"OK → {a.salida}: {a.n}×{a.n}, {2*e/1000:.1f} km de lado, relieve {z.min():.0f}…{z.max():.0f} m")
