import React, { useState, useEffect, useCallback } from 'react';
import {
  STAGES, BASELINE_RATES, WEEKLY_TARGETS, HIRE_GOALS,
  getCurrentWeek, MOCK_PIPELINE, SPRINT_END,
} from './data';
import './App.css';

const STAGE_LABELS = ['RPS', 'HMS', 'Onsite', 'Offer', 'Offer Accepted'];
const CONVERSION_KEYS = ['RPS→HMS', 'HMS→Onsite', 'Onsite→Offer', 'Offer→Offer Accepted'];

function computeConversions(funnel) {
  const stages = STAGE_LABELS;
  const result = {};
  for (let i = 0; i < stages.length - 1; i++) {
    const from = funnel[stages[i]] || 0;
    const to = funnel[stages[i + 1]] || 0;
    const key = `${stages[i]}→${stages[i + 1]}`;
    result[key] = from > 0 ? to / from : 0;
  }
  return result;
}

function riskLabel(actual, target) {
  if (target === 0) return 'on_track';
  const ratio = actual / target;
  if (ratio >= 0.85) return 'on_track';
  if (ratio >= 0.65) return 'at_risk';
  return 'off_track';
}

const RISK_CONFIG = {
  on_track: { label: 'On Track', color: '#4ade80', bg: '#052e16', icon: '✓' },
  at_risk:  { label: 'At Risk',  color: '#fbbf24', bg: '#451a03', icon: '⚠' },
  off_track: { label: 'Off Track', color: '#f87171', bg: '#2d1219', icon: '✗' },
};

function FunnelChart({ data, category }) {
  const colors = category === 'Tech'
    ? ['#1e3a8a', '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd']
    : ['#14532d', '#15803d', '#22c55e', '#4ade80', '#86efac'];

  const W = 130;
  const H = 24;
  const minW = W * 0.18;
  // Use actual max across all stages so funnel isn't broken when RPS=0
  const maxVal = Math.max(...STAGE_LABELS.map(s => data[s] || 0), 1);
  const getW = val => minW + (W - minW) * Math.max((val || 0) / maxVal, 0);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${STAGE_LABELS.length * H}`} style={{maxWidth:'220px', display:'block'}}>
      {STAGE_LABELS.map((stage, i) => {
        const val = data[stage] || 0;
        const nextStage = STAGE_LABELS[i + 1];
        const nextVal = nextStage ? (data[nextStage] || 0) : 0;
        const w = getW(val);
        const nw = nextStage ? getW(nextVal) : minW;
        const cx = W / 2;
        const y = i * H;
        const x1 = cx - w / 2, x2 = cx + w / 2;
        const x3 = cx + nw / 2, x4 = cx - nw / 2;
        const conv = i > 0 && (data[STAGE_LABELS[i-1]] || 0) > 0
          ? ((val / data[STAGE_LABELS[i-1]]) * 100).toFixed(0) + '%' : null;
        return (
          <g key={stage}>
            <polygon
              points={`${x1},${y} ${x2},${y} ${x3},${y+H} ${x4},${y+H}`}
              fill={colors[i]}
              stroke="#0a0e1a" strokeWidth="2"
            />
            <text x={cx} y={y + H/2 - 2} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.75)">{stage}</text>
            <text x={cx} y={y + H/2 + 8} textAnchor="middle" fontSize="10" fontWeight="bold" fill="white">{val}</text>
            {conv && <text x={x2 + 4} y={y + 7} fontSize="8" fill="#64748b">{conv}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function ProgressBar({ label, actual, goal, color }) {
  const pct = Math.min((actual / goal) * 100, 100);
  return (
    <div className="progress-block">
      <div className="progress-header">
        <span className="progress-label">{label}</span>
        <span className="progress-fraction" style={{ color }}>
          {actual} / {goal} hires
        </span>
      </div>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="progress-pct">{pct.toFixed(0)}% complete</div>
    </div>
  );
}

function WeeklyTable({ category, scheduled, weekNum }) {
  const targets = WEEKLY_TARGETS[category][weekNum] || {};
  const displayStages = ['RPS', 'HMS', 'Onsite', 'Offer', 'Offer Accepted'];

  return (
    <div className="weekly-table-wrap">
      <table className="weekly-table">
        <thead>
          <tr>
            <th>Stage</th>
            <th className="num">Target</th>
            <th className="num">Scheduled</th>
            <th className="num">Gap</th>
            <th className="num">Conv%</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {displayStages.map((stage, i) => {
            const target = targets[stage] || 0;
            const actual = (scheduled && scheduled[stage]) || 0;
            const gap = actual - target;
            const risk = riskLabel(actual, target);
            const rc = RISK_CONFIG[risk];
            const prevStage = displayStages[i - 1];
            const prevActual = prevStage ? ((scheduled && scheduled[prevStage]) || 0) : null;
            const conv = prevActual > 0 ? Math.round((actual / prevActual) * 100) + '%' : '—';
            return (
              <tr key={stage}>
                <td className="stage-name">{stage}</td>
                <td className="num">{target}</td>
                <td className="num">{actual}</td>
                <td className={`num gap ${gap >= 0 ? 'positive' : 'negative'}`}>
                  {gap >= 0 ? `+${gap}` : gap}
                </td>
                <td className="num" style={{color:'#94a3b8', fontSize:'12px'}}>{conv}</td>
                <td>
                  <span className="badge" style={{ background: rc.bg, color: rc.color }}>
                    {rc.icon} {rc.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConversionTable({ category, funnel }) {
  const actual = computeConversions(funnel);
  const baseline = BASELINE_RATES[category];

  return (
    <div className="conv-table-wrap">
      <table className="weekly-table">
        <thead>
          <tr>
            <th>Conversion</th>
            <th>This Week</th>
            <th>Historical</th>
            <th>Δ</th>
          </tr>
        </thead>
        <tbody>
          {CONVERSION_KEYS.map(key => {
            const a = actual[key] || 0;
            const b = baseline[key] || 0;
            const delta = a - b;
            const regression = delta < -0.05;
            return (
              <tr key={key} className={regression ? 'regression-row' : ''}>
                <td className="stage-name">{key}</td>
                <td className="num">{(a * 100).toFixed(0)}%</td>
                <td className="num">{(b * 100).toFixed(0)}%</td>
                <td className={`num ${delta >= 0 ? 'positive' : 'negative'} ${regression ? 'regression' : ''}`}>
                  {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(0)}pp
                  {regression && ' ⚠'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OverallRisk({ weekly, weekNum }) {
  const techTargets = WEEKLY_TARGETS.Tech[weekNum] || {};
  const ntTargets = WEEKLY_TARGETS['Non-Tech'][weekNum] || {};

  const allRisks = STAGE_LABELS.flatMap(stage => [
    riskLabel(weekly.Tech[stage] || 0, techTargets[stage] || 0),
    riskLabel(weekly['Non-Tech'][stage] || 0, ntTargets[stage] || 0),
  ]);

  const overall = allRisks.includes('off_track')
    ? 'off_track'
    : allRisks.includes('at_risk')
    ? 'at_risk'
    : 'on_track';

  const rc = RISK_CONFIG[overall];

  return (
    <div className="overall-risk" style={{ background: rc.bg, borderColor: rc.color }}>
      <span className="risk-icon" style={{ color: rc.color }}>{rc.icon}</span>
      <div>
        <div className="risk-title" style={{ color: rc.color }}>{rc.label}</div>
        <div className="risk-sub">Week {weekNum} hiring sprint status</div>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMock, setIsMock] = useState(false);
  const weekNum = getCurrentWeek();

  const load = useCallback(async (retry = 0) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/pipeline');
      const json = await res.json();

      // Server is still building cache — poll every 5s for up to 5 minutes
      if (json.loading) {
        if (retry < 60) {
          setTimeout(() => load(retry + 1), 5000);
        } else {
          setError('Data is taking too long to load. Try hitting Refresh.');
          setLoading(false);
        }
        return;
      }

      if (!res.ok) throw new Error(json.error || `Server error: ${res.status}`);
      setData(json);
      setIsMock(false);
      setLoading(false);
    } catch (e) {
      console.warn('Using mock data:', e.message);
      setData(MOCK_PIPELINE);
      setIsMock(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live countdown — recalculates every hour so it flips at midnight
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft());

  function getTimeLeft() {
    const now = new Date();
    const diff = SPRINT_END - now;
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return { days, hours, minutes, seconds, total: diff };
  }

  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(getTimeLeft()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading) return (
    <div className="center-screen">
      <div className="spinner" />
      <p>Loading pipeline data from Ashby…</p>
      <p style={{fontSize:'12px', color:'#94a3b8', marginTop:'8px'}}>First load takes ~30–60 seconds</p>
    </div>
  );

  const { pipeline, sprintPipeline, weeklyPipeline, prevWeekPipeline = {Tech:{},['Non-Tech']:{}}, activePipeline, monthlyFunnels, scheduledByWeek } = data;
  const rawScheduled = scheduledByWeek?.[weekNum] || { Tech: {}, 'Non-Tech': {} };
  const hasScheduledData = rawScheduled.Tech && Object.values(rawScheduled.Tech).some(v => v > 0);
  // Use scheduledByWeek if available, then activePipeline (current stage), then weeklyPipeline
  const currentWeekScheduled = hasScheduledData
    ? rawScheduled
    : (activePipeline || weeklyPipeline || { Tech: {}, 'Non-Tech': {} });

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div>
          <h1>Ricky Bobby 🏁</h1>
          <p className="subtitle">7-Week Sprint · Ends July 15, 2026 · Week {weekNum} of 7</p>
        </div>
        <div className="countdown-clock">
          <div className="countdown-label">Sprint ends in</div>
          <div className="countdown-digits">
            <div className="countdown-unit"><span className="countdown-num">{String(timeLeft.days).padStart(2,'0')}</span><span className="countdown-unit-label">days</span></div>
            <span className="countdown-sep">:</span>
            <div className="countdown-unit"><span className="countdown-num">{String(timeLeft.hours).padStart(2,'0')}</span><span className="countdown-unit-label">hrs</span></div>
            <span className="countdown-sep">:</span>
            <div className="countdown-unit"><span className="countdown-num">{String(timeLeft.minutes).padStart(2,'0')}</span><span className="countdown-unit-label">min</span></div>
            <span className="countdown-sep">:</span>
            <div className="countdown-unit"><span className="countdown-num">{String(timeLeft.seconds).padStart(2,'0')}</span><span className="countdown-unit-label">sec</span></div>
          </div>
        </div>
        <div className="header-right">
          {isMock && (
            <span className="mock-badge">⚠ Mock Data — Set ASHBY_API_KEY</span>
          )}
          <button className="refresh-btn" onClick={async () => { await fetch('/api/refresh', {method:'POST'}); load(); }}>
            ↻ Refresh
          </button>
        </div>
      </header>

      {/* Overall Risk */}
      <div className="section-row">
        <OverallRisk weekly={currentWeekScheduled} weekNum={weekNum} />
      </div>

      {/* Hire Progress */}
      <section className="card">
        <h2>Hire Goals Progress</h2>
        <div className="two-col">
          <ProgressBar
            label="Engineering Hires"
            actual={(sprintPipeline || pipeline).Tech['Offer Accepted']}
            goal={HIRE_GOALS.Tech}
            color="#3b82f6"
          />
          <ProgressBar
            label="PDOG Hires"
            actual={(sprintPipeline || pipeline)['Non-Tech']['Offer Accepted']}
            goal={HIRE_GOALS['Non-Tech']}
            color="#4ade80"
          />
        </div>
      </section>

      {/* Monthly Funnels */}
      {monthlyFunnels && Object.keys(monthlyFunnels).map(monthKey => {
        const [year, month] = monthKey.split('-');
        const label = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
        return (
          <section className="card" key={monthKey}>
            <h2>{label}</h2>
            <div className="two-col">
              <div>
                <h3 className="category-title tech">Engineering</h3>
                <FunnelChart data={monthlyFunnels[monthKey].Tech} category="Tech" />
              </div>
              <div>
                <h3 className="category-title nontech">PDOG</h3>
                <FunnelChart data={monthlyFunnels[monthKey]['Non-Tech']} category="Non-Tech" />
              </div>
            </div>
          </section>
        );
      })}

      {/* 3-Week Tracker: Last / This / Next (Mon–Fri calendar weeks) */}
      {(() => {
        const fmtD = iso => new Date(iso).toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
        const addDays = (iso, n) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString(); };
        const wsISO = data.weekStart; // this Monday
        const prevISO = addDays(wsISO, -7);
        const nextISO = addDays(wsISO, 7);

        const weeks = [
          {
            label: `Last Week  ${fmtD(prevISO)}–${fmtD(addDays(prevISO, 4))}`,
            tech: prevWeekPipeline?.Tech || {},
            nt: prevWeekPipeline?.['Non-Tech'] || {},
            wNum: Math.max(weekNum - 1, 1),
          },
          {
            label: `This Week  ${fmtD(wsISO)}–${fmtD(addDays(wsISO, 4))}`,
            tech: currentWeekScheduled.Tech,
            nt: currentWeekScheduled['Non-Tech'],
            wNum: weekNum,
          },
          {
            label: `Next Week  ${fmtD(nextISO)}–${fmtD(addDays(nextISO, 4))}`,
            tech: scheduledByWeek?.[weekNum + 1]?.Tech || {},
            nt: scheduledByWeek?.[weekNum + 1]?.['Non-Tech'] || {},
            wNum: Math.min(weekNum + 1, 7),
          },
        ];

        return weeks.map(({ label, tech, nt, wNum }) => (
          <section className="card" key={label}>
            <h2>{label}</h2>
            <div className="two-col">
              <div>
                <h3 className="category-title tech">Engineering</h3>
                <WeeklyTable category="Tech" scheduled={tech} weekNum={wNum} />
              </div>
              <div>
                <h3 className="category-title nontech">PDOG</h3>
                <WeeklyTable category="Non-Tech" scheduled={nt} weekNum={wNum} />
              </div>
            </div>
          </section>
        ));
      })()}

      {/* Conversion Rates */}
      <section className="card">
        <h2>Conversion Rates vs Historical Baseline</h2>
        <p className="conv-note">Rows in red indicate a regression of &gt;5pp below historical rate.</p>
        <div className="two-col">
          <div>
            <h3 className="category-title tech">Engineering</h3>
            <ConversionTable category="Tech" funnel={pipeline.Tech} />
          </div>
          <div>
            <h3 className="category-title nontech">P Dog</h3>
            <ConversionTable category="Non-Tech" funnel={pipeline['Non-Tech']} />
          </div>
        </div>
      </section>

      <footer className="app-footer">
        Data source: Ashby ATS · Last refreshed: {new Date().toLocaleTimeString()}
      </footer>
    </div>
  );
}
