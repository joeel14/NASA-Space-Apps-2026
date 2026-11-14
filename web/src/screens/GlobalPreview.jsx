// Vista TEMPORAL: capa global W4 (slope + suitability 0–100) des de Jan / terrain_safety.
// No substitueix el mapa polar PS1K; només permet previsualitzar la Lluna sencera.

import { useEffect, useMemo, useRef, useState } from "react";
import { Btn, IconBtn } from "../ui/kit.jsx";

const BASE = `${import.meta.env.BASE_URL}data/global/`;

async function loadGlobal() {
  const manifest = await fetch(BASE + "manifest.json").then((r) => {
    if (!r.ok) throw new Error(`global/manifest.json HTTP ${r.status}`);
    return r.json();
  });
  const [slopeBuf, suitBuf] = await Promise.all([
    fetch(BASE + manifest.layers.slope.file).then((r) => r.arrayBuffer()),
    fetch(BASE + manifest.layers.suitability.file).then((r) => r.arrayBuffer()),
  ]);
  return {
    manifest,
    slope: new Float32Array(slopeBuf),
    suitability: new Float32Array(suitBuf),
  };
}

function paint(canvas, data, mode) {
  const { manifest, slope, suitability } = data;
  const { cols, rows } = manifest.grid;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 800;
  const cssH = Math.round((cssW * rows) / cols);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const img = ctx.createImageData(cols, rows);
  const px = img.data;
  const arr = mode === "slope" ? slope : suitability;
  const vmax = mode === "slope" ? 30 : 100;

  for (let i = 0; i < cols * rows; i++) {
    const v = arr[i];
    const o = i * 4;
    if (!Number.isFinite(v)) {
      px[o] = 14; px[o + 1] = 17; px[o + 2] = 22; px[o + 3] = 255;
      continue;
    }
    const t = Math.max(0, Math.min(1, mode === "slope" ? v / vmax : v / vmax));
    // ramp: fosc → ambre → clar (sense porpra)
    if (mode === "slope") {
      px[o] = Math.round(26 + t * 180);
      px[o + 1] = Math.round(40 + t * 90);
      px[o + 2] = Math.round(30 + (1 - t) * 40);
    } else {
      px[o] = Math.round(26 + t * 210);
      px[o + 1] = Math.round(18 + t * 200);
      px[o + 2] = Math.round(16 + t * 160);
    }
    px[o + 3] = 255;
  }
  // dibuixa escalat a l'amplada del canvas CSS
  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  off.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.drawImage(off, 0, 0, cssW, cssH);
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
      .then((d) => { if (!cancelled) setData(d); })
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

  const stats = useMemo(() => {
    if (!data) return null;
    const a = mode === "slope" ? data.slope : data.suitability;
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
    setHover({
      lon, lat,
      slope: data.slope[i],
      suitability: data.suitability[i],
    });
  }

  return (
    <div className="global-prev">
      <header className="global-prev__head">
        <IconBtn icon="arrow-left" label="Back" onClick={onBack} />
        <div>
          <h1 className="h-lg" style={{ margin: 0 }}>Global slope preview (temporary)</h1>
          <p className="note-12" style={{ margin: "4px 0 0" }}>
            W4 1440×720 · <code>terrain.slope</code> + <code>suitability.slope</code> (contract §6) · same G1K orientation as T9 (Joel)
          </p>
        </div>
        <div className="grow" />
        <div className="row-10">
          <Btn variant={mode === "suitability" ? "primary" : "ghost"} onClick={() => setMode("suitability")}>Suitability 0–100</Btn>
          <Btn variant={mode === "slope" ? "primary" : "ghost"} onClick={() => setMode("slope")}>Slope °</Btn>
        </div>
      </header>

      {err ? (
        <div className="global-prev__err">
          <p><strong>No global data yet.</strong> {err}</p>
          <p className="note-12">Run: <code>python3 scripts/export_web_global_preview.py</code></p>
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
            {stats ? (
              <span className="note-12">
                {mode === "slope" ? "Slope" : "Suitability"} · min {stats.lo.toFixed(1)} · mean {stats.mean.toFixed(1)} · max {stats.hi.toFixed(1)}
                {mode === "suitability" ? " (0–100)" : "°"}
              </span>
            ) : null}
            <div className="grow" />
            {hover ? (
              <span className="note-12 mono">
                {hover.lat.toFixed(2)}°, {hover.lon.toFixed(2)}° · slope {Number.isFinite(hover.slope) ? `${hover.slope.toFixed(1)}°` : "—"}
                {" · "}suit {Number.isFinite(hover.suitability) ? hover.suitability.toFixed(0) : "—"}
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
