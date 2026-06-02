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

function FunnelChart({ data, color, category }) {
  const maxVal = data[STAGE_LABELS[0]] || 1;
  const colors = category === 'Tech'
    ? ['#1e3a8a', '#1d4ed8', '#3b82f6', '#93c5fd', '#bfdbfe']
    : ['#14532d', '#15803d', '#22c55e', '#86efac', '#bbf7d0'];

  return (
    <div className="funnel">
      {STAGE_LABELS.map((stage, i) => {
        const val = data[stage] || 0;
        const width = Math.max((val / maxVal) * 100, 8);
        const passthrough = i > 0
          ? (data[STAGE_LABELS[i - 1]] > 0
              ? ((val / data[STAGE_LABELS[i - 1]]) * 100).toFixed(0) + '%'
              : '—')
          : null;
        return (
          <div key={stage} className="funnel-row">
            <div className="funnel-label">{stage}</div>
            <div className="funnel-bar-wrap">
              {passthrough && (
                <div className="funnel-arrow">↓ {passthrough}</div>
              )}
              <div
                className="funnel-bar"
                style={{ width: `${width}%`, background: colors[i] }}
              >
                <span className="funnel-val">{val}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
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
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {displayStages.map(stage => {
            const target = targets[stage] || 0;
            const actual = (scheduled && scheduled[stage]) || 0;
            const gap = actual - target;
            const risk = riskLabel(actual, target);
            const rc = RISK_CONFIG[risk];
            return (
              <tr key={stage}>
                <td className="stage-name">{stage}</td>
                <td className="num">{target}</td>
                <td className="num">{actual}</td>
                <td className={`num gap ${gap >= 0 ? 'positive' : 'negative'}`}>
                  {gap >= 0 ? `+${gap}` : gap}
                </td>
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

  const { pipeline, sprintPipeline, weeklyPipeline, activePipeline, scheduledByWeek } = data;
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
            label="Tech Hires"
            actual={(sprintPipeline || pipeline).Tech['Offer Accepted']}
            goal={HIRE_GOALS.Tech}
            color="#3b82f6"
          />
          <ProgressBar
            label="Non-Tech Hires"
            actual={(sprintPipeline || pipeline)['Non-Tech']['Offer Accepted']}
            goal={HIRE_GOALS['Non-Tech']}
            color="#4ade80"
          />
        </div>
      </section>

      {/* Funnels */}
      <section className="card">
        <h2>Pipeline Funnels (Last 6 Months)</h2>
        <div className="two-col">
          <div>
            <h3 className="category-title tech">Tech</h3>
            <FunnelChart data={pipeline.Tech} category="Tech" />
          </div>
          <div>
            <h3 className="category-title nontech">Non-Tech</h3>
            <FunnelChart data={pipeline['Non-Tech']} category="Non-Tech" />
          </div>
        </div>
      </section>

      {/* Weekly Tracker */}
      <section className="card">
        <h2>Week {weekNum} Tracker — Interviews Scheduled</h2>
        <div className="two-col">
          <div>
            <h3 className="category-title tech">Tech</h3>
            <WeeklyTable category="Tech" scheduled={currentWeekScheduled.Tech} weekNum={weekNum} />
          </div>
          <div>
            <h3 className="category-title nontech">Non-Tech</h3>
            <WeeklyTable category="Non-Tech" scheduled={currentWeekScheduled['Non-Tech']} weekNum={weekNum} />
          </div>
        </div>
      </section>

      {/* Upcoming Weeks */}
      {scheduledByWeek && (
        <section className="card">
          <h2>Upcoming Weeks — Interviews Scheduled</h2>
          <div style={{overflowX:'auto'}}>
            <table className="weekly-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Dates</th>
                  <th className="num">Tech RPS</th>
                  <th className="num">Tech HMS</th>
                  <th className="num">Tech Onsite</th>
                  <th className="num">NT RPS</th>
                  <th className="num">NT HMS</th>
                  <th className="num">NT Onsite</th>
                </tr>
              </thead>
              <tbody>
                {[1,2,3,4,5,6,7].map(w => {
                  const wStart = new Date('2026-05-28T00:00:00.000Z');
                  wStart.setDate(wStart.getDate() + (w-1)*7);
                  const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate()+6);
                  const fmt = d => d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
                  const wd = scheduledByWeek[w] || {};
                  const t = wd.Tech || {};
                  const nt = wd['Non-Tech'] || {};
                  return (
                    <tr key={w} style={w === weekNum ? {fontWeight:700, background:'#1e3a5f'} : {}}>
                      <td>Wk {w}{w === weekNum ? ' ◀' : ''}</td>
                      <td style={{fontSize:'12px',color:'#475569'}}>{fmt(wStart)}–{fmt(wEnd)}</td>
                      <td className="num">{t.RPS||0}</td>
                      <td className="num">{t.HMS||0}</td>
                      <td className="num">{t.Onsite||0}</td>
                      <td className="num">{nt.RPS||0}</td>
                      <td className="num">{nt.HMS||0}</td>
                      <td className="num">{nt.Onsite||0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Conversion Rates */}
      <section className="card">
        <h2>Conversion Rates vs Historical Baseline</h2>
        <p className="conv-note">Rows in red indicate a regression of &gt;5pp below historical rate.</p>
        <div className="two-col">
          <div>
            <h3 className="category-title tech">Tech</h3>
            <ConversionTable category="Tech" funnel={pipeline.Tech} />
          </div>
          <div>
            <h3 className="category-title nontech">Non-Tech</h3>
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
