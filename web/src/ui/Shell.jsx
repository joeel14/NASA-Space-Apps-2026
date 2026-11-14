// Chasis común de las pantallas: carril de navegación, chip de misión,
// chip de perfil y la TimeBar (el reloj compartido).

import { useEffect, useRef, useState } from "react";
import { Icon, cx } from "./kit.jsx";
import { FACTORS, presetOf } from "../engine/score.js";

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtDay = (ms) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
};
export const fmtShort = (ms) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
export const fmtIso = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
export const fmtHM = (ms) => new Date(ms).toISOString().slice(11, 16);

export function durationLabel(days) {
  if (days < 30) return `${days}-day mission`;
  if (days < 365) return `${Math.round(days / 30)}-month mission`;
  return `${Math.round((days / 365) * 2) / 2}-year mission`;
}

/* ------------------------------------------------------------------ carril */

export function Rail({ screen, go, siteName, onMission, onExport }) {
  const item = (id, icon, label, target = id) => {
    const on = screen === id;
    return (
      <button type="button" className={cx("rail__item", on && "is-on")} aria-current={on ? "page" : undefined} onClick={() => go(target)} key={id}>
        <span className="rail__dot"><Icon name={icon} size={20} /></span>
        <span className="rail__label">{label}</span>
      </button>
    );
  };
  return (
    <nav aria-label="Main" className="rail">
      {item("explore", "orbit", "Explore")}
      {item("site", "map-pin", "Mare")}
      {item("compare", "compare", "Compare")}
      <div className="grow rail__gap" />
      <button type="button" className="rail__item rail__item--tool" onClick={onMission} title={siteName ? undefined : "Mission settings"}>
        <span className="rail__dot rail__dot--tool"><Icon name="sliders" size={18} /></span>
        <span className="rail__label">Mission</span>
      </button>
      <button type="button" className="rail__item rail__item--tool" onClick={onExport}>
        <span className="rail__dot rail__dot--tool"><Icon name="share" size={18} /></span>
        <span className="rail__label">Export</span>
      </button>
    </nav>
  );
}

/* --------------------------------------------------------------- chips */

export function MissionChip({ mission, onClick }) {
  return (
    <button type="button" className="mchip" aria-label="Mission settings" onClick={onClick}>
      <Icon name="calendar" size={16} />
      <span className="mchip__main">{fmtDay(mission.fromMs)} → {fmtDay(mission.toMs)}</span>
      <span className="mchip__sep" />
      <span className="mchip__sub">{durationLabel(mission.durationDays)}</span>
      <span className="mchip__sep mchip__hide" />
      <span className="mchip__sub mchip__hide">Lander {mission.observerM} m · UTC</span>
      <span className="mchip__btn"><Icon name="sliders" size={14} /></span>
    </button>
  );
}

export function ProfileChip({ weights, onClick }) {
  const name = presetOf(weights) || "Custom";
  return (
    <button type="button" className="mchip mchip--profile" aria-label="Mission profile" onClick={onClick}>
      <span className="pspark" aria-hidden="true">
        {FACTORS.map((f) => (
          <span key={f.key} style={{ height: `${Math.max(2, Math.min(16, (weights[f.key] || 0) / 2.4))}px`, background: weights[f.key] ? f.color : "var(--line)" }} />
        ))}
      </span>
      <span className="mchip__main">Profile · {name}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- TimeBar */

function ticks(startMs, endMs) {
  const span = endMs - startMs;
  const out = [];
  const d = new Date(startMs);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const yearly = span > 500 * DAY_MS;
  for (;;) {
    if (m > 11) { m = 0; y += 1; }
    const t = Date.UTC(y, m, 1);
    if (t >= endMs) break;
    const major = !yearly || m === 0;
    if (!yearly || m % 3 === 0) out.push({ pct: ((t - startMs) / span) * 100, label: major ? (yearly ? String(y) : MONTHS[m]) : "", major });
    m += 1;
  }
  return out;
}

/**
 * La TimeBar: reproducir, día ±1, fecha elegida, pista con meses, ventanas
 * (relleno suave) y la ventana de la misión (recuadro). Expandida muestra los
 * carriles de Sol y Tierra del lugar seleccionado.
 */
export function TimeBar({ startMs, endMs, timeMs, setTimeMs, windows = [], missionWin, lanes, emptyNote }) {
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const trackRef = useRef(null);
  const dateRef = useRef(null);
  const timeRef = useRef(null);
  const span = Math.max(HOUR_MS, endMs - startMs);
  const clamp = (t) => Math.max(startMs, Math.min(endMs, t));
  const pct = (t) => `${(((clamp(t) - startMs) / span) * 100).toFixed(3)}%`;
  const live = useRef(timeMs);
  live.current = timeMs;

  // Reproducción: 1 día por segundo, en pasos de 1 h.
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      const next = live.current + HOUR_MS;
      setTimeMs(next > endMs ? startMs : next);
    }, 1000 / 24);
    return () => clearInterval(id);
  }, [playing, startMs, endMs, setTimeMs]);

  const fromPointer = (e) => {
    const r = trackRef.current.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setTimeMs(Math.round((startMs + f * span) / HOUR_MS) * HOUR_MS);
  };
  const drag = useRef(false);
  const onKey = (e) => {
    const step = { ArrowRight: DAY_MS, ArrowUp: DAY_MS, ArrowLeft: -DAY_MS, ArrowDown: -DAY_MS, PageUp: 7 * DAY_MS, PageDown: -7 * DAY_MS }[e.key];
    if (step) { e.preventDefault(); setTimeMs(clamp(timeMs + step)); }
    if (e.key === "Home") { e.preventDefault(); setTimeMs(startMs); }
    if (e.key === "End") { e.preventDefault(); setTimeMs(endMs); }
  };
  const nextWin = () => {
    const w = windows.find((x) => x[0] > timeMs + HOUR_MS) || windows[0];
    if (w) setTimeMs(w[0]);
  };
  const pick = (ref) => {
    const el = ref.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); }
  };
  const iso = new Date(clamp(timeMs)).toISOString();

  return (
    <section aria-label="Time controls" className="card timebar">
      <div className="timebar__row">
        <div className="timebar__btns">
          <button type="button" className="ibtn ibtn--ink" style={{ width: 48, height: 48 }} aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}>
            <Icon name={playing ? "pause" : "play"} size={20} />
          </button>
          <button type="button" className="ibtn ibtn--raised" style={{ width: 40, height: 40 }} aria-label="Back one day" onClick={() => setTimeMs(clamp(timeMs - DAY_MS))}>
            <Icon name="chevron-left" size={20} />
          </button>
          <button type="button" className="ibtn ibtn--raised" style={{ width: 40, height: 40 }} aria-label="Forward one day" onClick={() => setTimeMs(clamp(timeMs + DAY_MS))}>
            <Icon name="chevron-right" size={20} />
          </button>
        </div>
        <div className="timebar__date">
          <div className="timebar__datetext">
            <span className="lbl">Selected · UTC</span>
            <span className="num-15">{iso.slice(0, 10)} {iso.slice(11, 16)}</span>
          </div>
          <button type="button" className="ibtn ibtn--ghost" style={{ width: 36, height: 36 }} aria-label="Pick date" onClick={() => pick(dateRef)}>
            <Icon name="calendar" size={16} />
          </button>
          <button type="button" className="ibtn ibtn--ghost" style={{ width: 36, height: 36 }} aria-label="Pick UTC time" onClick={() => pick(timeRef)}>
            <Icon name="clock" size={16} />
          </button>
          <input
            ref={dateRef}
            className="sr-input"
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            value={iso.slice(0, 10)}
            min={new Date(startMs).toISOString().slice(0, 10)}
            max={new Date(endMs).toISOString().slice(0, 10)}
            onChange={(e) => e.target.value && setTimeMs(clamp(Date.parse(`${e.target.value}T${iso.slice(11, 16)}:00Z`)))}
          />
          <input
            ref={timeRef}
            className="sr-input"
            type="time"
            tabIndex={-1}
            aria-hidden="true"
            value={iso.slice(11, 16)}
            onChange={(e) => e.target.value && setTimeMs(clamp(Date.parse(`${iso.slice(0, 10)}T${e.target.value}:00Z`)))}
          />
        </div>
        <div className="timebar__trackwrap">
          <div className="timebar__months" aria-hidden="true">
            {ticks(startMs, endMs).map((t) => (t.label ? <span key={t.pct} style={{ left: `${t.pct}%` }}>{t.label}</span> : null))}
          </div>
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Selected instant"
            aria-valuemin={startMs}
            aria-valuemax={endMs}
            aria-valuenow={timeMs}
            aria-valuetext={`${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`}
            className="timebar__track"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = true; fromPointer(e); }}
            onPointerMove={(e) => { if (drag.current) fromPointer(e); }}
            onPointerUp={() => { drag.current = false; }}
            onPointerCancel={() => { drag.current = false; }}
            onKeyDown={onKey}
          >
            <div className="timebar__clip">
              {ticks(startMs, endMs).map((t) => <span key={t.pct} className="timebar__tick" style={{ left: `${t.pct}%` }} />)}
              {windows.map(([a, b]) => (
                <span key={a} className="timebar__win" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} />
              ))}
            </div>
            {missionWin ? (
              <span className="timebar__mission" title="Best mission window" style={{ left: pct(missionWin[0]), width: `max(4px, calc(${pct(missionWin[1])} - ${pct(missionWin[0])}))` }} />
            ) : null}
            <div className="timebar__fill" style={{ width: pct(timeMs) }} />
            <div className="timebar__line" style={{ left: pct(timeMs) }} />
            <div className="timebar__thumb" style={{ left: pct(timeMs) }} />
          </div>
        </div>
        <div className="timebar__btns">
          <button type="button" className="btn btn--secondary btn--md" onClick={nextWin} disabled={!windows.length}>
            <Icon name="skip-forward" size={16} />
            <span>Next window</span>
          </button>
          <span className="rate">1 d/s</span>
          <button type="button" className="ibtn ibtn--raised" style={{ width: 40, height: 40 }} aria-label="Expand or collapse time controls" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            <Icon name={expanded ? "chevron-down" : "chevron-up"} size={20} />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="timebar__lanes">
          {lanes ? (
            [["sun", "Sun", lanes.sun], ["earth", "Earth", lanes.earth]].map(([k, name, rr]) => (
              <div key={k} className="lane">
                <div className="lane__name"><Icon name={k} size={14} style={{ color: `var(--${k})` }} /><span>{name}</span></div>
                <div className="lane__track" role="img" aria-label={`${name} in view intervals`}>
                  {rr.map(([a, b]) => <span key={a} style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, background: `var(--${k})` }} />)}
                  <span className="lane__now" style={{ left: pct(timeMs) }} />
                </div>
              </div>
            ))
          ) : (
            <p className="muted-12">{emptyNote || "Pick a site to see when it has Sun and Earth."}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
