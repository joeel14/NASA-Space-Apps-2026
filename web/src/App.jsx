import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadData } from "./data/loadData.js";
import { MissionEngine } from "./engine/missionEngine.js";
import { DEFAULT_LIMITS, DEFAULT_WEIGHTS, exclusionAt, factorsAt, reliefLayer, scoreGrid } from "./engine/score.js";
import { findHotspots, nearestSite } from "./engine/hotspots.js";
import { formatLatLon, latLonToXY, pixelXY, xyToLatLon, xyToPixel } from "./engine/geometry.js";
import { landingWindows, runs, siteTimeline } from "./engine/timeline.js";
import { Rail, TimeBar } from "./ui/Shell.jsx";
import SetupWhen from "./screens/SetupWhen.jsx";
import SetupPriorities from "./screens/SetupPriorities.jsx";
import Explore from "./screens/Explore.jsx";
import Site from "./screens/Site.jsx";
import Compare from "./screens/Compare.jsx";
import { ExportDialog, SettingsDrawer } from "./screens/Overlays.jsx";
import LearnPage from "./components/LearnPage.jsx";

const DAY_MS = 86400000;
const H = 3600e3;
const REGION_HALF_PX = 7; // regiones Artemis III de ~15 × 15 km -> 15 × 15 píxeles de 1 km

// Capas del mapa.
const LAYERS = {
  score: { label: "Score", ramp: "score", legend: ["Lower", "Higher"] },
  sun: { label: "Sunlight", ramp: "sun", legend: ["0%", "100%"] },
  earth: { label: "Earth view", ramp: "earth", legend: ["0%", "100%"] },
  slope: { label: "Slope", ramp: "slope", legend: ["0°", "30°+"] },
  relief: { label: "Relief", ramp: "relief", legend: ["0 m", "600 m+"] },
  shadow: { label: "Water ice", ramp: "shadow", legend: ["Far", "Near"] },
};

const todayMs = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** Periodos posibles según el rango de efemérides. */
function computePeriods(ephem) {
  const t = todayMs();
  const r0 = ephem ? Math.ceil(ephem.startUnixMs / DAY_MS) * DAY_MS : t;
  const r1 = ephem ? Math.floor((ephem.startUnixMs + (ephem.count - 2) * ephem.stepSeconds * 1000) / DAY_MS) * DAY_MS : t + 4 * 365 * DAY_MS;
  const from = Math.min(Math.max(t, r0), r1 - 30 * DAY_MS);
  return {
    range: [r0, r1],
    next12: [from, Math.min(r1, from + 365 * DAY_MS)],
    nofixed: [from, r1],
  };
}

const DEFAULT_OPTS = { durationDays: 14, sunMode: "any", earthMode: "centre", observerM: 2 };

function missionProblem(m, range) {
  if (!(m.toMs > m.fromMs)) return "The end date must be after the start date.";
  if (m.fromMs < range[0]) return `Ephemeris starts on ${new Date(range[0]).toISOString().slice(0, 10)}.`;
  if (m.toMs > range[1]) return `Ephemeris ends on ${new Date(range[1]).toISOString().slice(0, 10)}.`;
  if (m.toMs - m.fromMs < m.durationDays * DAY_MS) return `A ${m.durationDays}-day mission does not fit in this period.`;
  return null;
}

/** Nombre corto de un lugar: "NR1", "PCB"… */
function shortNames(names) {
  const used = {};
  return names.map((name) => {
    const words = name.split(/\s+/);
    const last = words[words.length - 1];
    const digit = /^\d+$/.test(last) ? last : "";
    let base = words.filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join("").slice(0, 3);
    if (base.length < 2) base = name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
    if (digit) return base + digit;
    if (base.length >= 3) return base;
    used[base] = (used[base] || 0) + 1;
    return base + used[base];
  });
}

function useMedia(query) {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

export default function App() {
  const [screen, setScreen] = useState("when");
  const [tab, setTab] = useState("overview");
  const [dim, setDim] = useState("2D");
  const [overlay, setOverlay] = useState(null); // "settings" | "export"
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState({ done: 0, total: 1, error: null });
  const engineRef = useRef(null);
  useMedia("(max-width: 767px)");

  const [periods, setPeriods] = useState(() => computePeriods(null));
  const [mission, setMission] = useState(() => {
    const p = computePeriods(null);
    return { period: "next12", fromMs: p.next12[0], toMs: p.next12[1], ...DEFAULT_OPTS };
  });
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [runError, setRunError] = useState(null);
  const [layerKey, setLayerKey] = useState("sun");
  const [terrainLayer, setTerrainLayer] = useState("sun");
  const [selRef, setSelRef] = useState(null); // {type:"spot",rank} | {type:"site",id} | {type:"pick",p}
  const [group, setGroup] = useState("artemis");
  const [cmpRefs, setCmpRefs] = useState([]);
  const [timeMs, setTimeMs] = useState(() => todayMs());

  const go = useCallback((s) => {
    setScreen(s);
    window.scrollTo(0, 0);
  }, []);

  // --- Carga de datos y motor ---------------------------------------------
  useEffect(() => {
    loadData((done, total) => setLoadState((s) => ({ ...s, done, total })))
      .then((d) => {
        if (d.layers.elevation) d.layers.relief = reliefLayer(d.layers.elevation, d.manifest.grid.n);
        if (d.horizon && d.ephem) engineRef.current = new MissionEngine(d);
        const p = computePeriods(d.manifest.ephem);
        setPeriods(p);
        setMission((m) => (m.period === "custom" ? m : { ...m, fromMs: p[m.period][0], toMs: p[m.period][1] }));
        setData(d);
      })
      .catch((e) => setLoadState((s) => ({ ...s, error: e.message })));
    return () => engineRef.current?.dispose();
  }, []);

  const engineReady = !!engineRef.current;
  const problem = missionProblem(mission, periods.range);

  // --- Mission setters -------------------------------------------------------
  const setPeriod = (period) => setMission((m) => (period === "custom" ? { ...m, period } : { ...m, period, fromMs: periods[period][0], toMs: periods[period][1] }));
  const setCustom = (fromMs, toMs) => setMission((m) => ({ ...m, period: "custom", fromMs, toMs }));
  const setDuration = (durationDays) => setMission((m) => ({ ...m, durationDays }));
  const setMissionOpts = (o) => setMission((m) => ({ ...m, ...o }));
  const restoreDefaults = () => {
    setMission({ period: "next12", fromMs: periods.next12[0], toMs: periods.next12[1], ...DEFAULT_OPTS });
    setLimits(DEFAULT_LIMITS);
  };
  const dirty = mission.period !== "next12" || mission.sunMode !== DEFAULT_OPTS.sunMode || mission.earthMode !== DEFAULT_OPTS.earthMode
    || mission.durationDays !== DEFAULT_OPTS.durationDays || JSON.stringify(limits) !== JSON.stringify(DEFAULT_LIMITS);
  const landEndMs = Math.max(mission.fromMs + H, mission.toMs - mission.durationDays * DAY_MS);

  // --- Cálculo automático (con un pequeño retardo) -------------------------
  const inFlight = useRef(0);
  useEffect(() => {
    if (!data || !engineRef.current || problem) return undefined;
    const t = setTimeout(async () => {
      inFlight.current += 1;
      setRunning(true);
      setRunError(null);
      setProgress(0);
      try {
        const r = await engineRef.current.run({
          windowStartMs: mission.fromMs,
          windowEndMs: landEndMs,
          durationDays: mission.durationDays,
          weights: { sun: weights.sun, earth: weights.earth },
          sunMode: mission.sunMode,
          earthMode: mission.earthMode,
        }, setProgress);
        if (r) {
          setResult(r);
          setLayerKey((k) => (k === "sun" ? "score" : k));
        }
      } catch (e) {
        setRunError(e.message);
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setRunning(false);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mission.fromMs, mission.toMs, mission.durationDays, mission.sunMode, mission.earthMode, weights.sun, weights.earth, problem]);

  // --- Puntuación, puntos calientes y regiones -----------------------------
  const score = useMemo(() => (data && result ? scoreGrid(result, data.layers, weights, limits) : null), [data, result, weights, limits]);

  const metricsAt = (p) => (result ? { sun: result.sun[p], earth: result.earth[p], both: result.both[p], night: result.night[p], best: result.best[p] } : null);
  const factors100 = (p) => {
    const f = factorsAt(p, result, data.layers, limits);
    const o = {};
    for (const k of Object.keys(f)) o[k] = Number.isFinite(f[k]) ? f[k] * 100 : null;
    return o;
  };
  const placeBase = (p, extra) => {
    const grid = data.manifest.grid;
    const i = Math.floor(p / grid.n), j = p % grid.n;
    const [x, y] = pixelXY(grid, i, j);
    const [lat, lon] = xyToLatLon(grid, x, y);
    return { p, i, j, lat, lon, coords: formatLatLon(lat, lon), factors: factors100(p), metrics: metricsAt(p), ...extra };
  };

  const spots = useMemo(() => {
    if (!score || !data) return [];
    const grid = data.manifest.grid;
    const sites = data.manifest.sites?.sites || [];
    return findHotspots(score, grid).spots.map((s) => {
      const near = nearestSite(s, sites, grid, latLonToXY);
      return {
        ...placeBase(s.peak, {}),
        ...s,
        key: `spot-${s.rank}`,
        ref: { type: "spot", rank: s.rank },
        name: `Hotspot ${String(s.rank).padStart(2, "0")}`,
        short: `HS${s.rank}`,
        shape: "square",
        kindLabel: "Hotspot",
        score: s.peakScore,
        note: `${s.areaKm2.toFixed(0)} km² above the top-3 % score${near && near.km < 25 ? ` · ${near.km.toFixed(0)} km from ${near.site.name}` : ""}.`,
      };
    });
  }, [score, data, result, limits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Regiones Artemis III: mejor píxel de 1 km dentro de su recuadro de ~15 × 15 km.
  const sites = useMemo(() => {
    if (!data) return [];
    const grid = data.manifest.grid;
    const n = grid.n;
    const raw = data.manifest.sites?.sites || [];
    const shorts = shortNames(raw.map((s) => s.name));
    const list = raw.map((s, k) => {
      const [x, y] = latLonToXY(grid, s.lat, s.lon);
      const [fi, fj] = xyToPixel(grid, x, y);
      const i0 = Math.round(fi), j0 = Math.round(fj);
      let best = i0 * n + j0, bestScore = NaN, sum = 0, cnt = 0;
      if (score) {
        for (let i = i0 - REGION_HALF_PX; i <= i0 + REGION_HALF_PX; i++) {
          for (let j = j0 - REGION_HALF_PX; j <= j0 + REGION_HALF_PX; j++) {
            if (i < 0 || j < 0 || i >= n || j >= n) continue;
            const v = score[i * n + j];
            if (!Number.isFinite(v)) continue;
            sum += v; cnt += 1;
            if (!(v <= bestScore)) { bestScore = v; best = i * n + j; }
          }
        }
      }
      const mean = cnt ? sum / cnt : NaN;
      return {
        ...placeBase(best, {}),
        id: s.id, name: s.name, short: shorts[k], shape: "circle", kindLabel: "Artemis III region",
        key: `site-${s.id}`, ref: { type: "site", id: s.id }, score: bestScore, mean, centre: [s.lat, s.lon],
        excluded: score && !Number.isFinite(bestScore) ? "No 1 km pixel in this region passes your limits" : null,
        note: score && Number.isFinite(bestScore) ? `Best 1 km pixel inside the ~15 × 15 km region. Region mean ${Math.round(mean)} · ${cnt} of 225 km² pass the limits.` : null,
      };
    });
    const ranked = [...list].sort((a, b) => (Number.isFinite(b.score) ? b.score : -1) - (Number.isFinite(a.score) ? a.score : -1));
    ranked.forEach((s, k) => { s.rank = Number.isFinite(s.score) ? k + 1 : null; });
    return ranked;
  }, [data, score, result, limits]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const a = [...sites]; a.label = "Artemis III";
    const b = [...spots]; b.label = "Hotspots";
    return { artemis: a, spots: b };
  }, [sites, spots]);

  const resolve = useCallback((ref) => {
    if (!ref || !data) return null;
    if (ref.type === "spot") return spots.find((x) => x.rank === ref.rank) || null;
    if (ref.type === "site") return sites.find((x) => x.id === ref.id) || null;
    return {
      ...placeBase(ref.p, {}),
      type: "pick", key: `pick-${ref.p}`, ref, name: "Your spot", short: "YOU", shape: "diamond", kindLabel: "Your spot",
      score: score ? score[ref.p] : NaN,
      excluded: result ? exclusionAt(ref.p, result, data.layers, limits) : null,
    };
  }, [spots, sites, data, score, result, limits]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => {
    const s = resolve(selRef);
    return s ? { ...s, type: s.type || selRef.type } : null;
  }, [resolve, selRef]);

  // Primera vez que hay resultados: seleccionar la mejor región (como en el diseño).
  const autoSel = useRef(false);
  useEffect(() => {
    if (!autoSel.current && sites[0] && Number.isFinite(sites[0].score)) {
      autoSel.current = true;
      setSelRef((r) => r || sites[0].ref);
    }
  }, [sites]);

  // --- Comparar ----------------------------------------------------------------
  const refKey = (r) => (r.type === "spot" ? `spot-${r.rank}` : r.type === "site" ? `site-${r.id}` : `pick-${r.p}`);
  const inCmp = (place) => !!place && cmpRefs.some((r) => refKey(r) === place.key);
  const toggleCmp = (place) => setCmpRefs((list) => {
    if (list.some((r) => refKey(r) === place.key)) return list.filter((r) => refKey(r) !== place.key);
    return list.length >= 4 ? list : [...list, place.ref];
  });
  const cmpPlaces = useMemo(() => cmpRefs.map(resolve).filter(Boolean), [cmpRefs, resolve]);
  const ranked = (groups[group] || []).filter((p) => Number.isFinite(p.score));
  const addBest3 = () => setCmpRefs(ranked.slice(0, 3).map((p) => p.ref));

  // --- Serie temporal del lugar seleccionado ---------------------------------
  const modes = { sunMode: mission.sunMode, earthMode: mission.earthMode };
  const tl = useMemo(() => (selected && data?.ephem && data?.horizon ? siteTimeline(data, selected.p, mission.fromMs, mission.toMs, modes) : null),
    [selected?.p, data, mission.fromMs, mission.toMs, mission.sunMode, mission.earthMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const lw = useMemo(() => (tl ? landingWindows(tl, mission.durationDays * 24, { sun: weights.sun, earth: weights.earth }, landEndMs) : null),
    [tl, mission.durationDays, weights.sun, weights.earth, landEndMs]);
  const toMs = (rr) => rr.map(([a, b]) => [tl.startMs + a * H, tl.startMs + b * H]);
  const windowsMs = tl && lw ? toMs(lw.windows) : [];
  const missionWin = tl && lw && lw.best >= 0 ? [tl.startMs + lw.best * H, tl.startMs + (lw.best + lw.D) * H] : null;
  const lanes = useMemo(() => (tl ? { sun: runs(tl.sun).map(([a, b]) => [tl.startMs + a * H, tl.startMs + b * H]), earth: runs(tl.earth).map(([a, b]) => [tl.startMs + a * H, tl.startMs + b * H]) } : null), [tl]);

  // Serie de cualquier lugar (Compare), con caché.
  const tlCache = useRef(new Map());
  const timelineFor = useCallback((place) => {
    if (!place || !data?.ephem || !data?.horizon) return null;
    const k = `${place.p}|${mission.fromMs}|${mission.toMs}|${mission.sunMode}|${mission.earthMode}`;
    if (!tlCache.current.has(k)) {
      if (tlCache.current.size > 24) tlCache.current.clear();
      tlCache.current.set(k, siteTimeline(data, place.p, mission.fromMs, mission.toMs, modes));
    }
    return tlCache.current.get(k);
  }, [data, mission.fromMs, mission.toMs, mission.sunMode, mission.earthMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // El reloj compartido salta al inicio de la mejor ventana al cambiar de lugar.
  const winStart = missionWin?.[0];
  useEffect(() => { if (winStart != null) setTimeMs(winStart); }, [selected?.key, winStart]);
  useEffect(() => { setTimeMs((t) => Math.min(mission.toMs, Math.max(mission.fromMs, t))); }, [mission.fromMs, mission.toMs]);

  // --- Valores de las capas -------------------------------------------------
  const cache = useMemo(() => new Map(), [data, result, score, limits.iceReachKm]);
  const valuesFor = useCallback((key) => {
    if (!data) return null;
    if (cache.has(key)) return cache.get(key);
    const ly = data.layers;
    let v = null;
    switch (key) {
      case "score": v = score; break;
      case "sun": v = result ? result.sun : ly.avgSun || null; break;
      case "earth": v = result ? result.earth : null; break;
      case "slope": v = ly.slope || null; break;
      case "relief": v = ly.relief || null; break;
      case "shadow": {
        if (!ly.psrDistKm) break;
        v = new Float32Array(ly.psrDistKm.length);
        for (let p = 0; p < v.length; p++) v[p] = ly.psrShare?.[p] > 0.5 ? -1 : Math.max(0, 1 - ly.psrDistKm[p] / limits.iceReachKm);
        break;
      }
      default: break;
    }
    cache.set(key, v);
    return v;
  }, [cache, data, score, result, limits.iceReachKm]);
  const legendFor = (key, values) => {
    let lo = Infinity, hi = -Infinity;
    if (values) for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!values || !Number.isFinite(hi)) return ["–", "–"];
    if (key === "score") return [`${Math.round(lo)}`, `${Math.round(hi)}`];
    if (key === "sun" || key === "earth") return ["0%", `${Math.round(hi * 100)}%`];
    return LAYERS[key].legend;
  };
  const values = valuesFor(layerKey);

  // --- Lista de navegación de la ficha --------------------------------------
  const siteList = selected?.type === "spot" ? spots : sites;
  const stepSite = (d) => {
    if (!siteList.length) return;
    const k = siteList.findIndex((p) => p.key === selected?.key);
    const next = siteList[(k + d + siteList.length) % siteList.length];
    setSelRef(next.ref);
  };
  const rankInfo = selected && (selected.type === "site" || selected.type === "spot") && Number.isFinite(selected.score)
    ? { rank: siteList.findIndex((p) => p.key === selected.key) + 1, total: siteList.filter((p) => Number.isFinite(p.score)).length }
    : null;
  const v = data?.validation?.horizons?.maxArcmin;
  const validation = v ? `JPL Horizons · ≤ ${Math.max(v.sun, v.earth).toFixed(3)}′` : "JPL Horizons";

  const useDates = (a, b) => setCustom(Math.floor(a / DAY_MS) * DAY_MS, Math.ceil((b + DAY_MS) / DAY_MS) * DAY_MS);

  const RailEl = <Rail screen={screen} go={go} onMission={() => setOverlay("settings")} onExport={() => setOverlay("export")} />;
  const TimeBarEl = (
    <TimeBar startMs={mission.fromMs} endMs={mission.toMs} timeMs={timeMs} setTimeMs={setTimeMs} windows={windowsMs} missionWin={missionWin} lanes={lanes} />
  );

  const app = {
    data, result, running, progress, runError, problem, loadState, engineReady,
    places: [...sites, ...spots], groups, group, setGroup, selected, setSelRef, weights, setWeights, limits, setLimits,
    layerKey, setLayerKey, LAYERS, layer: LAYERS[layerKey], values, legendEnds: legendFor(layerKey, values), valuesFor, legendFor,
    terrainLayer, setTerrainLayer,
    dim, setDim, mission, periods, setPeriod, setCustom, setDuration, setMissionOpts, restoreDefaults, dirty,
    openSettings: () => setOverlay("settings"), go, tab, setTab,
    cmp: cmpRefs, toggleCmp, inCmp, cmpPlaces, addBest3, canAddBest: ranked.length > 0,
    timeMs, setTimeMs, Rail: RailEl, TimeBarEl,
    moonMission: { windowStartMs: mission.fromMs, windowEndMs: landEndMs, durationDays: mission.durationDays },
    sitesForMap: sites, spotsForMap: spots,
    tl, lw, siteList, stepSite, rankInfo, validation, useDates, timelineFor, region: "South Pole",
    exportPlaces: cmpPlaces.length ? cmpPlaces : ranked,
  };

  let page;
  if (screen === "when") {
    page = <SetupWhen mission={mission} setPeriod={setPeriod} setCustom={setCustom} setDuration={setDuration} periods={periods} problem={problem} go={go} openSettings={() => setOverlay("settings")} openLearn={() => go("learn")} />;
  } else if (screen === "priorities") {
    page = <SetupPriorities weights={weights} setWeights={setWeights} mission={mission} sitesCount={sites.length || 8} go={go} openSettings={() => setOverlay("settings")} />;
  } else if (screen === "site") {
    page = <Site app={app} />;
  } else if (screen === "compare") {
    page = <Compare app={app} />;
  } else if (screen === "learn") {
    page = (
      <div className="shell">
        {RailEl}
        <main className="shell__main">{data ? <div className="card card--flush"><LearnPage data={data} /></div> : null}</main>
      </div>
    );
  } else {
    page = <Explore app={app} />;
  }

  return (
    <>
      {page}
      {overlay === "settings" ? <SettingsDrawer app={app} onClose={() => setOverlay(null)} /> : null}
      {overlay === "export" ? <ExportDialog app={app} onClose={() => setOverlay(null)} /> : null}
    </>
  );
}
