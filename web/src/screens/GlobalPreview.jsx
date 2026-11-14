// Vista TEMPORAL: W4 equirectangular (Lluna sencera).
// Inclou slope/suitability (Jan) i capes T9 Lunar Prospector (Joel).
// No substitueix G1K ni el mapa polar PS1K.

import { useEffect, useMemo, useRef, useState } from "react";
import { Btn, IconBtn } from "../ui/kit.jsx";

const BASE = `${import.meta.env.BASE_URL}data/global/`;

const LAYER_ORDER = [
  "suitability",
  "slope",
  "ice.hydrogen_ppm",
  "regolith.feo_wt_pct",
  "regolith.tio2_wt_pct",
  "radiation.natural_gamma_dose",
  "radiation.thorium_ppm",
  "radiation.potassium_ppm",
  "radiation.uranium_ppm",
];

const SHORT = {
  suitability: "Suit 0–100",
  slope: "Slope °",
  "ice.hydrogen_ppm": "H ppm",
  "regolith.feo_wt_pct": "FeO %",
  "regolith.tio2_wt_pct": "TiO₂ %",
  "radiation.natural_gamma_dose": "γ dose",
  "radiation.thorium_ppm": "Th ppm",
  "radiation.potassium_ppm": "K ppm",
  "radiation.uranium_ppm": "U ppm",
};

async function loadGlobal() {
  const manifest = await fetch(BASE + "manifest.json").then((r) => {
    if (!r.ok) throw new Error(`global/manifest.json HTTP ${r.status}`);
    return r.json();
  });
  const keys = Object.keys(manifest.layers || {});
  const buffers = await Promise.all(
    keys.map((k) => fetch(BASE + manifest.layers[k].file).then((r) => {
      if (!r.ok) throw new Error(`${manifest.layers[k].file} HTTP ${r.status}`);
      return r.arrayBuffer();
    })),
  );
  const arrays = {};
  keys.forEach((k, i) => { arrays[k] = new Float32Array(buffers[i]); });
  return { manifest, arrays };
}

function paint(canvas, data, mode) {
  const { manifest, arrays } = data;
  const { cols, rows } = manifest.grid;
  const meta = manifest.layers[mode];
  const arr = arrays[mode];
  if (!meta || !arr) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 800;
  const cssH = Math.round((cssW * rows) / cols);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const img = ctx.createImageData(cols, rows);
  const px = img.data;

  const lo = Number.isFinite(meta.min) ? meta.min : 0;
  const hi = Number.isFinite(meta.max) && meta.max > lo ? meta.max : lo + 1;
  const isSlope = mode === "slope";
  const isSuit = mode === "suitability";
  const vmax = isSlope ? Math.min(30, hi) : isSuit ? 100 : hi;

  for (let i = 0; i < cols * rows; i++) {
    const v = arr[i];
    const o = i * 4;
    if (!Number.isFinite(v)) {
      px[o] = 14; px[o + 1] = 17; px[o + 2] = 22; px[o + 3] = 255;
      continue;
    }
    const t = Math.max(0, Math.min(1, isSlope || isSuit ? v / vmax : (v - lo) / (vmax - lo)));
    if (isSlope) {
      px[o] = Math.round(26 + t * 180);
      px[o + 1] = Math.round(40 + t * 90);
      px[o + 2] = Math.round(30 + (1 - t) * 40);
    } else if (isSuit) {
      px[o] = Math.round(26 + t * 210);
      px[o + 1] = Math.round(18 + t * 200);
      px[o + 2] = Math.round(16 + t * 160);
    } else {
      // Joel: fosc → ambre (recursos / dosi)
      px[o] = Math.round(20 + t * 220);
      px[o + 1] = Math.round(28 + t * 140);
      px[o + 2] = Math.round(36 + (1 - t) * 50);
    }
    px[o + 3] = 255;
  }

  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  off.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.drawImage(off, 0, 0, cssW, cssH);
}

function fmt(v, units) {
  if (!Number.isFinite(v)) return "—";
  if (units === "score_0_100") return v.toFixed(0);
  if (units === "deg") return `${v.toFixed(1)}°`;
  if (units === "ppm" && v >= 100) return v.toFixed(0);
  if (units === "ppm") return v.toFixed(2);
  if (units === "wt%") return v.toFixed(2);
  if (units === "nGy/h") return v.toFixed(2);
  return v.toFixed(2);
}

export default function GlobalPreview({ onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState("suitability");
  const [hover, setHover] = useState(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadGlobal()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const keys = Object.keys(d.manifest.layers || {});
        if (!keys.includes("suitability") && keys.length) setMode(keys[0]);
      })
      .catch((e) => { if (!cancelled) setErr(e.message || String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const draw = () => paint(canvasRef.current, data, mode);
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [data, mode]);

  const layerKeys = useMemo(() => {
    if (!data) return [];
    const present = new Set(Object.keys(data.manifest.layers || {}));
    const ordered = LAYER_ORDER.filter((k) => present.has(k));
    for (const k of present) if (!ordered.includes(k)) ordered.push(k);
    return ordered;
  }, [data]);

  const janKeys = layerKeys.filter((k) => (data?.manifest.layers[k]?.group || (k === "slope" || k === "suitability" ? "jan" : "joel")) === "jan");
  const joelKeys = layerKeys.filter((k) => !janKeys.includes(k));

  const stats = useMemo(() => {
    if (!data || !data.arrays[mode]) return null;
    const a = data.arrays[mode];
    let n = 0, sum = 0, hi = -Infinity, lo = Infinity;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) continue;
      n += 1; sum += v;
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    return { n, mean: n ? sum / n : 0, lo, hi };
  }, [data, mode]);

  function onMove(e) {
    if (!data || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { cols, rows, stepDeg, lon0, lat0 } = data.manifest.grid;
    const x = ((e.clientX - rect.left) / rect.width) * cols;
    const y = ((e.clientY - rect.top) / rect.height) * rows;
    const c = Math.min(cols - 1, Math.max(0, Math.floor(x)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(y)));
    const lon = lon0 + (c + 0.5) * stepDeg;
    const lat = lat0 - (r + 0.5) * stepDeg;
    const i = r * cols + c;
    const meta = data.manifest.layers[mode];
    setHover({
      lon, lat,
      value: data.arrays[mode]?.[i],
      units: meta?.units,
      label: meta?.label || mode,
    });
  }

  const activeMeta = data?.manifest.layers[mode];

  return (
    <div className="global-prev">
      <header className="global-prev__head">
        <IconBtn icon="arrow-left" label="Back" onClick={onBack} />
        <div>
          <h1 className="h-lg" style={{ margin: 0 }}>Global preview (temporary)</h1>
          <p className="note-12" style={{ margin: "4px 0 0" }}>
            Rejilla W4 igual per a totes (1440×720). Joel T9: resolució nativa LP ~15–150 km (no es pot igualar al LOLA del slope).
          </p>
        </div>
      </header>

      {data ? (
        <div className="global-prev__tabs">
          <div className="global-prev__group">
            <span className="lbl">Jan · T1</span>
            <div className="row-10" style={{ flexWrap: "wrap" }}>
              {janKeys.map((k) => (
                <Btn key={k} variant={mode === k ? "primary" : "ghost"} size="sm" onClick={() => setMode(k)}>
                  {SHORT[k] || data.manifest.layers[k]?.label || k}
                </Btn>
              ))}
            </div>
          </div>
          <div className="global-prev__group">
            <span className="lbl">Joel · T9</span>
            <div className="row-10" style={{ flexWrap: "wrap" }}>
              {joelKeys.map((k) => (
                <Btn key={k} variant={mode === k ? "primary" : "ghost"} size="sm" onClick={() => setMode(k)}>
                  {SHORT[k] || data.manifest.layers[k]?.label || k}
                </Btn>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="global-prev__err">
          <p><strong>No global data yet.</strong> {err}</p>
          <p className="note-12">
            Run: <code>python3 scripts/export_web_global_preview.py</code>
            {" · "}
            <code>python3 scripts/export_web_global_joel_preview.py</code>
          </p>
        </div>
      ) : !data ? (
        <p className="note-12" style={{ padding: 24 }}>Loading global W4 layers…</p>
      ) : (
        <>
          <div className="global-prev__canvas-wrap">
            <canvas
              ref={canvasRef}
              className="global-prev__canvas"
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            />
          </div>
          <footer className="global-prev__foot">
            {stats && activeMeta ? (
              <span className="note-12">
                {activeMeta.label || mode} · min {fmt(stats.lo, activeMeta.units)} · mean {fmt(stats.mean, activeMeta.units)} · max {fmt(stats.hi, activeMeta.units)}
                {activeMeta.units && activeMeta.units !== "deg" && activeMeta.units !== "score_0_100" ? ` ${activeMeta.units}` : ""}
                {activeMeta.sourceResolution ? ` · natiu: ${activeMeta.sourceResolution}` : ""}
              </span>
            ) : null}
            <div className="grow" />
            {hover ? (
              <span className="note-12 mono">
                {hover.lat.toFixed(2)}°, {hover.lon.toFixed(2)}° · {hover.label} {fmt(hover.value, hover.units)}
                {hover.units && hover.units !== "deg" && hover.units !== "score_0_100" ? ` ${hover.units}` : ""}
              </span>
            ) : (
              <span className="note-12">Move the cursor over the map</span>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
