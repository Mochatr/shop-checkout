import { useEffect, useRef, useState } from 'react';
import { fmt } from '../storage';

// Bar chart: number of sales per day over the last 7 days. One series, so no legend;
// hovering (or focusing) a day shows its count and revenue.
export default function SalesChart({ days }) {
  const [hover, setHover] = useState(null);
  // Draw at the real on-screen width so text stays readable on phones.
  const boxRef = useRef(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 480 ? 180 : 220;
  const pad = { top: 16, right: 8, bottom: 28, left: 28 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const max = Math.max(1, ...days.map((d) => d.count));
  const niceMax = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const ticks = niceMax <= 4 ? Array.from({ length: niceMax + 1 }, (_, i) => i) : [0, niceMax / 2, niceMax];
  const slot = innerW / days.length;
  const barW = Math.min(36, slot - 2 * Math.max(2, slot * 0.2));
  const y = (v) => pad.top + innerH - (v / niceMax) * innerH;
  const peak = days.reduce((best, d, i) => (d.count > (days[best]?.count ?? -1) ? i : best), 0);

  // Bar with a 4px rounded top, square bottom anchored on the baseline.
  function barPath(x, top, w, bottom) {
    const r = Math.min(4, w / 2, bottom - top);
    return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bottom} Z`;
  }

  const h = hover !== null ? days[hover] : null;

  return (
    <div className="chart" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={days.map((d) => `${d.label}: ${d.count} sales`).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={pad.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const top = y(d.count);
          const bottom = pad.top + innerH;
          return (
            <g key={d.key}>
              {d.count > 0 && (
                <path
                  d={barPath(cx - barW / 2, top, barW, bottom)}
                  className={hover === null || hover === i ? 'bar' : 'bar dim'}
                />
              )}
              {i === peak && d.count > 0 && (
                <text x={cx} y={top - 6} textAnchor="middle" className="bar-label">
                  {d.count}
                </text>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className={d.isToday ? 'tick today' : 'tick'}>
                {d.label}
              </text>
              {/* Generous invisible hit area for hover / keyboard focus */}
              <rect
                x={pad.left + slot * i}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {h && (
        <div
          className="tooltip"
          style={{ left: `${((pad.left + slot * hover + slot / 2) / W) * 100}%` }}
          role="status"
        >
          <strong>{h.fullLabel}</strong>
          <span>
            {h.count} {h.count === 1 ? 'sale' : 'sales'}
          </span>
          {Object.entries(h.revenue).map(([c, v]) => (
            <span key={c}>
              {fmt(v, c)} {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
