"""
eyecta.py — Modelo balístico de la eyecta que levanta el chorro del motor al alunizar.

Qué hace
  1. Reparte la masa expulsada por tamaños de grano (granulometría tipo Apolo).
  2. Asigna a cada tamaño una velocidad y un ángulo de salida (bajo, 1–3°).
  3. Calcula la trayectoria sobre una Luna ESFÉRICA (vale también para el polvo
     rápido que recorre decenas o cientos de km, y detecta el que entra en órbita
     o escapa).
  4. Para cada "activo" (rover, hábitat, otra nave) calcula cuántas partículas le
     golpean por m² de superficie expuesta y con cuánta energía.
  5. Exporta gráficos PNG y un JSON listo para la web del equipo.

Uso
  python3 eyecta.py                          # escenario por defecto
  python3 eyecta.py --masa 2000 --escala 1.5 # más masa expulsada / motor más potente
  python3 eyecta.py --activos activos.json   # tus propios activos

AVISO HONESTO (para el pitch): es un modelo de primer orden. Los parámetros marcados
con  # CALIBRAR  son órdenes de magnitud tomados de la literatura sobre interacción
chorro-superficie (Metzger, Lane, Immer et al.) y deben ajustarse y citarse.
"""
import argparse, json, math
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---------------- Constantes lunares ----------------
G_LUNA = 1.62          # m/s²
R_LUNA = 1_737_400.0   # m
RHO_GRANO = 3100.0     # kg/m³, densidad de grano típica del regolito
V_ORBITAL = math.sqrt(G_LUNA * R_LUNA)        # ≈1,68 km/s (órbita rasante)
V_ESCAPE = math.sqrt(2 * G_LUNA * R_LUNA)     # ≈2,38 km/s

# ---------------- Parámetros del modelo ----------------
PARAMS = dict(
    masa_expulsada_kg=2600.0,   # Apollo 12: 2,6 t (Lane y Metzger 2015); Metzger 2024 estima 11–26 t
    d50_um=70.0,                # mediana en masa; Carrier: 40–130 µm en suelos Apolo
    sigma_ln=1.3,               # anchura de la distribución log-normal  # CALIBRAR
    d_min_um=2.0, d_max_um=20_000.0,
    v_ref=1000.0,               # m/s para un grano de 10 µm  # CALIBRAR
    d_ref_um=10.0,
    exp_v=0.5,                  # v ∝ d^-exp_v (los granos grandes salen más lentos)  # CALIBRAR
    disp_v=0.35,                # dispersión log-normal de la velocidad
    ang_min=0.1, ang_max=3.0,   # cono plano de ~3° que rellena el espacio bajo él (Immer 2011, Metzger 2024)
    escala_motor=1.0,           # >1 = motor más potente (multiplica velocidades)
    n_paquetes=60_000,          # paquetes de Monte Carlo (cada uno = masa/N)
    semilla=7,
)

ACTIVOS_DEFECTO = [  # nombre, x (m, este), y (m, norte), altura expuesta (m)
    {"nombre": "Rover de otra misión", "x": 1200, "y": 300, "altura": 1.5},
    {"nombre": "Hábitat Artemis (plan.)", "x": -400, "y": -1800, "altura": 4.0},
    {"nombre": "Lander CLPS", "x": 2400, "y": -900, "altura": 3.0},
    {"nombre": "Surveyor 3 (validación)", "x": 160, "y": 0, "altura": 1.5},
]


def muestrear(p, rng):
    """Paquetes de masa: diámetro, velocidad, ángulo, acimut."""
    n = p["n_paquetes"]
    d = np.exp(rng.normal(math.log(p["d50_um"]), p["sigma_ln"], n))
    d = np.clip(d, p["d_min_um"], p["d_max_um"])
    v = p["v_ref"] * (d / p["d_ref_um"]) ** (-p["exp_v"])
    v *= np.exp(rng.normal(0, p["disp_v"], n)) * p["escala_motor"]
    th = np.radians(rng.uniform(p["ang_min"], p["ang_max"], n))
    az = rng.uniform(0, 2 * np.pi, n)
    masa_paquete = p["masa_expulsada_kg"] / n
    m_grano = RHO_GRANO * np.pi / 6 * (d * 1e-6) ** 3
    n_granos = masa_paquete / m_grano          # granos reales que representa cada paquete
    return d, v, th, az, n_granos, m_grano


def alcance_esferico(v, th):
    """Alcance sobre Luna esférica. Devuelve (alcance_m, destino)
    destino: 0 = cae, 1 = órbita (no vuelve en este modelo), 2 = escape."""
    nu = v**2 / (G_LUNA * R_LUNA)
    c2 = np.cos(th) ** 2
    denom = 1 - nu * c2
    psi = 2 * np.arctan2(nu * np.sin(th) * np.cos(th), denom)
    rango = R_LUNA * psi
    destino = np.zeros_like(v, dtype=int)
    destino[denom <= 0] = 1
    destino[v >= V_ESCAPE] = 2
    rango[destino > 0] = np.inf
    return rango, destino


def altura_en(x, v, th):
    """Altura de la partícula a la distancia horizontal x (aprox. plana: válida
    cerca del punto de alunizaje, que es donde están los activos)."""
    return x * np.tan(th) - G_LUNA * x**2 / (2 * v**2 * np.cos(th) ** 2)


def impacto_en_activo(dist, altura, v, th, rango, n_granos, m_grano):
    """Granos que cruzan la distancia `dist` por debajo de `altura` → golpean.
    Se reparten sobre el cilindro de radio dist y altura dada (todas las
    direcciones), así que es el flujo por m² de superficie vertical expuesta."""
    pasa = rango > dist
    h = np.where(pasa, altura_en(dist, v, th), np.inf)
    golpea = pasa & (h >= 0) & (h <= altura)
    area = 2 * np.pi * dist * altura
    granos_m2 = n_granos[golpea].sum() / area
    energia_m2 = (0.5 * m_grano * v**2 * n_granos)[golpea].sum() / area   # J/m²
    return granos_m2, energia_m2


def clasificar(energia_m2):
    # CALIBRAR: umbrales orientativos para la demo (abrasión de ópticas y paneles)
    if energia_m2 < 1:
        return "bajo"
    if energia_m2 < 100:
        return "medio"
    return "alto"


def simular(p=PARAMS, activos=ACTIVOS_DEFECTO):
    rng = np.random.default_rng(p["semilla"])
    d, v, th, az, n_granos, m_grano = muestrear(p, rng)
    rango, destino = alcance_esferico(v, th)
    res_activos = []
    for a in activos:
        dist = math.hypot(a["x"], a["y"])
        g, e = impacto_en_activo(dist, a["altura"], v, th, rango, n_granos, m_grano)
        res_activos.append({**a, "distancia_m": round(dist, 1),
                            "granos_por_m2": float(g), "energia_J_m2": float(e),
                            "riesgo": clasificar(e)})
    masa_paq = p["masa_expulsada_kg"] / p["n_paquetes"]
    resumen = {
        "masa_expulsada_kg": p["masa_expulsada_kg"],
        "pct_masa_cae_<100m": float((rango < 100).mean() * 100),
        "pct_masa_cae_<1km": float((rango < 1000).mean() * 100),
        "pct_masa_cae_>10km": float(((rango > 10_000) & (destino == 0)).mean() * 100),
        "kg_a_orbita_o_escape": float((destino > 0).sum() * masa_paq),
        "alcance_max_km": float(rango[destino == 0].max() / 1000),
    }
    return dict(d=d, v=v, th=th, az=az, rango=rango, destino=destino,
                n_granos=n_granos, m_grano=m_grano), res_activos, resumen


# ---------------- Gráficos ----------------
SURF, TXT, TXT2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#ecebe6"
SEQ = ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"]       # secuencial azul: fino → grueso
RIESGO_COL = {"bajo": "#0ca30c", "medio": "#fab219", "alto": "#d03b3b"}
CLASES = [("Polvo < 20 µm", 0, 20), ("Arena fina 20–100 µm", 20, 100),
          ("Arena 0,1–1 mm", 100, 1000), ("Grava > 1 mm", 1000, 1e9)]


def _estilo(ax):
    ax.set_facecolor(SURF)
    for s in ax.spines.values():
        s.set_color("#c3c2b7")
    ax.tick_params(colors=TXT2)
    ax.grid(color=GRID, lw=.6)


def grafico_mapa(sim, activos, ruta, lim=3000):
    fig, ax = plt.subplots(figsize=(7.5, 7.5), facecolor=SURF); _estilo(ax)
    r, az, d = sim["rango"], sim["az"], sim["d"]
    idx = np.random.default_rng(1).choice(len(r), 12000, replace=False)
    for (nom, lo, hi), col in zip(CLASES, SEQ):
        m = idx[(d[idx] >= lo) & (d[idx] < hi) & (r[idx] < lim)]
        ax.scatter(r[m] * np.cos(az[m]), r[m] * np.sin(az[m]), s=5, c=col,
                   alpha=.55, linewidths=0, label=nom)
    for a in activos:
        if a["distancia_m"] > lim:
            continue
        ax.scatter(a["x"], a["y"], s=150, marker="X" if a["riesgo"] != "bajo" else "o",
                   c=RIESGO_COL[a["riesgo"]], edgecolors=SURF, linewidths=2, zorder=5)
        ax.annotate(f"{a['nombre']}\n{a['distancia_m']/1000:.2f} km · riesgo {a['riesgo']}",
                    (a["x"], a["y"]), xytext=(8, -26) if a["distancia_m"] < 400 else (8, 6),
                    textcoords="offset points",
                    fontsize=8.5, color=TXT)
    ax.scatter([0], [0], marker="^", s=170, c=TXT, zorder=6)
    ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim); ax.set_aspect("equal")
    ax.set_xlabel("m (este)", color=TXT2); ax.set_ylabel("m (norte)", color=TXT2)
    ax.set_title("Dónde cae la eyecta (muestra de paquetes de masa)", loc="left", color=TXT)
    ax.legend(loc="upper left", fontsize=8, frameon=False)
    fig.tight_layout(); fig.savefig(ruta, dpi=150); plt.close(fig)


def grafico_alcance(sim, ruta):
    fig, ax = plt.subplots(figsize=(9, 5), facecolor=SURF); _estilo(ax)
    d, r, dest = sim["d"], sim["rango"], sim["destino"]
    idx = np.random.default_rng(2).choice(len(d), 15000, replace=False)
    cae = idx[dest[idx] == 0]
    col = np.select([d[cae] < 20, d[cae] < 100, d[cae] < 1000], SEQ[:3], SEQ[3])
    ax.scatter(d[cae], r[cae], s=4, c=col, alpha=.45, linewidths=0)
    ax.set_xscale("log"); ax.set_yscale("log")
    for y, txt in [(160, "Surveyor 3 (160 m)"), (1000, "1 km"), (100_000, "100 km")]:
        ax.axhline(y, color=TXT2, lw=.8, ls="--")
        ax.text(d.min() * 1.1, y * 1.15, txt, fontsize=8, color=TXT2)
    ax.set_xlabel("Diámetro del grano (µm)", color=TXT2)
    ax.set_ylabel("Distancia a la que cae (m)", color=TXT2)
    ax.set_title("Cuanto más fino el grano, más lejos llega", loc="left", color=TXT)
    fig.tight_layout(); fig.savefig(ruta, dpi=150); plt.close(fig)


def grafico_flujo(sim, activos, ruta, altura=2.0):
    fig, ax = plt.subplots(figsize=(9, 5), facecolor=SURF); _estilo(ax)
    dists = np.logspace(1.3, 4.3, 60)
    e = [impacto_en_activo(x, altura, sim["v"], sim["th"], sim["rango"],
                           sim["n_granos"], sim["m_grano"])[1] for x in dists]
    ax.plot(dists, e, color=SEQ[2], lw=2)
    ax.axhspan(100, max(max(e), 101) * 10, color="#d03b3b", alpha=.07)
    ax.axhspan(1, 100, color="#fab219", alpha=.07)
    for a in activos:
        ax.axvline(a["distancia_m"], color=RIESGO_COL[a["riesgo"]], lw=1.2)
        ax.text(a["distancia_m"] * 1.05, ax.get_ylim()[0] if False else 1e-3,
                a["nombre"].split(" (")[0], rotation=90, fontsize=8, color=TXT, va="bottom")
    ax.set_xscale("log"); ax.set_yscale("log"); ax.set_ylim(1e-3, None)
    ax.set_xlabel("Distancia al punto de alunizaje (m)", color=TXT2)
    ax.set_ylabel("Energía de impacto (J/m² de superficie vertical)", color=TXT2)
    ax.set_title(f"Chorreado de un objeto de {altura:.0f} m de alto según la distancia",
                 loc="left", color=TXT)
    fig.tight_layout(); fig.savefig(ruta, dpi=150); plt.close(fig)


def exportar_json(sim, activos, resumen, ruta, n=3000):
    """Para el frontend: puntos de caída (muestra), activos y resumen."""
    idx = np.random.default_rng(3).choice(len(sim["d"]), n, replace=False)
    idx = idx[sim["destino"][idx] == 0]
    pts = [{"x": round(float(sim["rango"][i] * math.cos(sim["az"][i])), 1),
            "y": round(float(sim["rango"][i] * math.sin(sim["az"][i])), 1),
            "d_um": round(float(sim["d"][i]), 1),
            "v_ms": round(float(sim["v"][i]), 1),
            "ang_deg": round(math.degrees(sim["th"][i]), 2)} for i in idx]
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump({"resumen": resumen, "activos": activos, "particulas": pts},
                  f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--masa", type=float, help="kg de regolito expulsado")
    ap.add_argument("--escala", type=float, help="escala de potencia del motor")
    ap.add_argument("--activos", help="JSON con lista de activos")
    a = ap.parse_args()
    p = dict(PARAMS)
    if a.masa: p["masa_expulsada_kg"] = a.masa
    if a.escala: p["escala_motor"] = a.escala
    act = json.load(open(a.activos, encoding="utf-8")) if a.activos else ACTIVOS_DEFECTO
    sim, res, resumen = simular(p, act)
    grafico_mapa(sim, res, "mapa_caida.png")
    grafico_alcance(sim, "alcance_vs_tamano.png")
    grafico_flujo(sim, res, "chorreado_vs_distancia.png")
    exportar_json(sim, res, resumen, "eyecta.json")
    print(json.dumps(resumen, ensure_ascii=False, indent=1))
    for r_ in res:
        print(f"{r_['nombre']:<48} {r_['distancia_m']:>8.0f} m  "
              f"{r_['granos_por_m2']:>10.3g} granos/m²  {r_['energia_J_m2']:>9.3g} J/m²  {r_['riesgo']}")
