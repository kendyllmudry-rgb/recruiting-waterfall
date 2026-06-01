require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;
const ASHBY_API_KEY = process.env.ASHBY_API_KEY;
const ASHBY_BASE = 'https://api.ashbyhq.com';

app.use(cors());
app.use(express.json());

// ── In-memory cache ──────────────────────────────────────────────────────────
let cache = { data: null, loading: false, error: null, lastUpdated: null };

// ── Ashby helper ─────────────────────────────────────────────────────────────
async function ashbyPost(endpoint, body = {}) {
  const credentials = Buffer.from(`${ASHBY_API_KEY}:`).toString('base64');
  const res = await fetch(`${ASHBY_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ashby ${endpoint} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchAllPages(endpoint, body = {}, maxPages = 200) {
  let all = [], cursor = null, page = 0;
  while (page < maxPages) {
    const req = { ...body, limit: 100 };
    if (cursor) req.cursor = cursor;
    const data = await ashbyPost(endpoint, req);
    const results = data.results || [];
    all = all.concat(results);
    page++;
    if (page % 5 === 0) process.stdout.write(`\r  ${endpoint}: page ${page}, ${all.length} records...`);
    if (!data.moreDataAvailable || !data.nextCursor || results.length === 0) break;
    cursor = data.nextCursor;
  }
  console.log(`\n  ${endpoint}: DONE — ${all.length} records (${page} pages)`);
  return all;
}

async function fetchAppInfoBatch(ids, concurrency = 15) {
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(id => ashbyPost('/application.info', { applicationId: id }))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.results) results.push(r.value.results);
    }
    if (i % 150 === 0 && i > 0) console.log(`  application.info: fetched ${results.length} so far...`);
  }
  return results;
}

// ── Stage mapping ─────────────────────────────────────────────────────────────
// Updated based on actual Ashby stage names — edit STAGE_MAP to match yours
const STAGE_MAP = {
  // RPS — recruiter/application review
  'application review': 'RPS',
  'recruiter screen': 'RPS',
  'recruiter phone screen': 'RPS',
  'sourced': 'RPS',
  'applied': 'RPS',
  'rps': 'RPS',
  'intro call': 'RPS',
  'initial screen': 'RPS',
  'secondary review': 'RPS',
  'phone screen': 'RPS',
  'pre-screen': 'RPS',
  'sell call': 'RPS',        // Phantom: pre-HMS sell call
  'replied': 'RPS',
  // HMS — hiring manager screen
  'hiring manager screen': 'HMS',
  'hm screen': 'HMS',
  'hiring manager interview': 'HMS',
  'hms': 'HMS',
  'manager screen': 'HMS',
  'engineering leadership': 'HMS',
  // Onsite — technical / full interview
  'onsite': 'Onsite',
  'on-site': 'Onsite',
  'on site': 'Onsite',
  'virtual onsite': 'Onsite',   // Phantom
  'technical interview': 'Onsite',
  'technical screen': 'Onsite',
  'take home': 'Onsite',
  'take home assignment': 'Onsite',
  'assessment': 'Onsite',
  'interview': 'Onsite',
  'final round': 'Onsite',
  'loop': 'Onsite',
  'panel': 'Onsite',
  'full loop': 'Onsite',
  'debrief': 'Onsite',          // Phantom: post-onsite debrief
  // Offer
  'offer': 'Offer',
  'offer extended': 'Offer',
  'verbal offer': 'Offer',
  'reference check': 'Offer',   // Phantom: pre-offer reference check
  // Offer Accepted / Hired
  'offer accepted': 'Offer Accepted',
  'hired': 'Offer Accepted',
  'accepted': 'Offer Accepted',
};

function normalizeStage(title, status) {
  if (!title) return null;
  const t = title.toLowerCase().trim();
  if (t === 'archived') return null;
  if (status === 'Hired' || t === 'hired') return 'Offer Accepted';
  // Exact match first
  if (STAGE_MAP[t]) return STAGE_MAP[t];
  // Partial match
  for (const [key, val] of Object.entries(STAGE_MAP)) {
    if (t.includes(key)) return val;
  }
  return null;
}

// ── Dept classification ───────────────────────────────────────────────────────
let deptHierarchy = {}; // built during load

function isDeptTech(deptId) {
  const visited = new Set();
  let id = deptId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const d = deptHierarchy[id];
    if (!d) break;
    if (!d.parentId) {
      // Top-level — classify by name
      const n = d.name.toLowerCase();
      const techWords = ['engineer', 'tech', 'design', 'data', 'research',
        'security', 'platform', 'infra', 'science', 'analytics', 'sdet', 'developer', 'software'];
      return techWords.some(k => n.includes(k));
    }
    id = d.parentId;
  }
  return false; // default Non-Tech if unknown
}

// ── Fetch scheduled interviews from /interviewSchedule.list ───────────────────
async function fetchInterviewSchedules(sprintStart, numWeeks, fullApps, jobMap) {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const sprintEnd = new Date(sprintStart.getTime() + numWeeks * msPerWeek);
  const empty = () => ({ RPS: 0, HMS: 0, Onsite: 0, Offer: 0, 'Offer Accepted': 0 });
  const scheduledByWeek = {};
  for (let w = 1; w <= numWeeks; w++) scheduledByWeek[w] = { Tech: empty(), 'Non-Tech': empty() };

  // Build maps from fullApps data
  const appMap = {};      // applicationId → { category, stageTitle }
  const stageIdMap = {};  // interviewStageId → normalized stage

  for (const app of fullApps) {
    const jobInfo = jobMap[app.job?.id] || {};
    const deptId = app.job?.departmentId || jobInfo.deptId || '';
    const jobTitle = app.job?.title || jobInfo.title || '';
    const category = deptId ? (isDeptTech(deptId) ? 'Tech' : 'Non-Tech')
      : (jobTitle.toLowerCase().match(/engineer|software|developer|data|infra|security|design|sdet/) ? 'Tech' : 'Non-Tech');
    appMap[app.id] = { category };

    if (app.currentInterviewStage?.id && app.currentInterviewStage?.title) {
      const stageTitle = app.currentInterviewStage.title;
      const normalized = normalizeStage(stageTitle, app.status);
      if (normalized) stageIdMap[app.currentInterviewStage.id] = normalized;
    }
    // Also map from applicationHistory
    for (const h of (app.applicationHistory || [])) {
      if (h.interviewStageId && h.title) {
        const normalized = normalizeStage(h.title, '');
        if (normalized) stageIdMap[h.interviewStageId] = normalized;
      }
    }
  }

  // Fetch interview schedules updated in last 60 days — covers all sprint weeks without timeout
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const schedules = await fetchAllPages('/interviewSchedule.list', {
    updatedAfter: sixtyDaysAgo.toISOString(),
  }, 20).catch(e => {
    console.warn('  interviewSchedule.list failed:', e.message);
    return [];
  });
  console.log(`  interviewSchedule.list: ${schedules.length} schedules fetched`);
  const withEvents = schedules.filter(s => s.interviewEvents?.length > 0);
  console.log(`  Schedules with events: ${withEvents.length}`);
  if (withEvents[0]) {
    console.log('  Sample event keys:', Object.keys(withEvents[0].interviewEvents[0]).join(', '));
    console.log('  Sample event:', JSON.stringify(withEvents[0].interviewEvents[0]).slice(0, 400));
  }

  let counted = 0, sampleWithEvents = false;
  for (const sched of schedules) {
    const events = sched.interviewEvents || [];
    if (!sampleWithEvents && events.length > 0) {
      console.log('  Sample event:', JSON.stringify(events[0]).slice(0, 300));
      sampleWithEvents = true;
    }

    for (const ev of events) {
      const startRaw = ev.startTime || ev.start || ev.scheduledAt || ev.date || ev.startAt;
      if (!startRaw) continue;
      const start = new Date(startRaw);
      // Count any interview scheduled within the sprint window
      if (start < sprintStart || start >= sprintEnd) continue;

      const msIn = start - sprintStart;
      const w = Math.min(Math.ceil(msIn / msPerWeek) || 1, numWeeks);

      // Get stage from stageIdMap or from sched.interviewStageId
      const stage = stageIdMap[sched.interviewStageId] || null;
      if (!stage) continue;

      // Get category from appMap
      const appData = appMap[sched.applicationId] || null;
      const category = appData?.category || 'Tech'; // default Tech if unknown

      scheduledByWeek[w][category][stage]++;
      counted++;
    }
  }

  console.log(`  Scheduled interviews counted from events: ${counted}`);
  if (!sampleWithEvents) console.log('  NOTE: No interviewEvents found in any schedule — interviews may not have event times yet');

  return scheduledByWeek;
}

// ── Build scheduled-by-week from fullApps scheduledInterviews ─────────────────
function buildScheduledByWeek(fullApps, sprintStart, numWeeks, jobMap) {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const sprintEnd = new Date(sprintStart.getTime() + numWeeks * msPerWeek);
  const empty = () => ({ RPS: 0, HMS: 0, Onsite: 0, Offer: 0, 'Offer Accepted': 0 });

  const scheduledByWeek = {};
  for (let w = 1; w <= numWeeks; w++) scheduledByWeek[w] = { Tech: empty(), 'Non-Tech': empty() };

  let totalScheduled = 0;
  let sampleLogged = false;

  for (const app of fullApps) {
    const jobInfo = jobMap[app.job?.id] || {};
    const deptId = app.job?.departmentId || jobInfo.deptId || '';
    const jobTitle = app.job?.title || jobInfo.title || '';
    const category = deptId ? (isDeptTech(deptId) ? 'Tech' : 'Non-Tech')
      : (jobTitle.toLowerCase().match(/engineer|software|developer|data|infra|security|design|sdet/) ? 'Tech' : 'Non-Tech');

    // Try scheduledInterviews array on app (returned by application.info)
    const scheduled = app.scheduledInterviews || app.interviews || [];
    if (!sampleLogged && scheduled.length > 0) {
      console.log('  Sample scheduledInterview entry:', JSON.stringify(scheduled[0]).slice(0, 400));
      sampleLogged = true;
    }

    for (const iv of scheduled) {
      const startRaw = iv.startTime || iv.scheduledAt || iv.startAt || iv.start || iv.date;
      if (!startRaw) continue;
      const start = new Date(startRaw);
      if (start < sprintStart || start >= sprintEnd) continue;

      const msIn = start - sprintStart;
      const w = Math.min(Math.ceil(msIn / msPerWeek) || 1, numWeeks);

      const stageName = iv.interviewStageName || iv.interviewStage?.title
        || iv.stageName || iv.stage?.title || iv.name || '';
      const stage = normalizeStage(stageName, '');
      if (!stage) continue;

      scheduledByWeek[w][category][stage]++;
      totalScheduled++;
    }
  }

  console.log(`  Scheduled interviews extracted from app.info: ${totalScheduled}`);
  if (totalScheduled === 0) {
    // Log sample app to see what fields are available
    const sampleApp = fullApps[0];
    if (sampleApp) console.log('  Sample app keys:', Object.keys(sampleApp).join(', '));
  }

  return scheduledByWeek;
}

// ── Build pipeline data ───────────────────────────────────────────────────────
async function buildPipelineData() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoff = sixMonthsAgo.toISOString();

  console.log('Building pipeline data...');

  // Jobs
  const jobsRaw = await fetchAllPages('/job.list', {}).catch(() => []);
  const jobMap = {};
  for (const j of jobsRaw) {
    jobMap[j.id] = { title: j.title || '', deptId: j.departmentId || '' };
  }

  // Departments
  const deptsRaw = await fetchAllPages('/department.list', {}).catch(() => []);
  deptHierarchy = {};
  for (const d of deptsRaw) deptHierarchy[d.id] = { name: d.name || '', parentId: d.parentId };

  // Only fetch applications for OPEN jobs — skips thousands of records from closed roles
  const openJobs = jobsRaw.filter(j => j.status === 'Open' || j.status === 'open' || !j.status);
  console.log(`  Open jobs: ${openJobs.length} of ${jobsRaw.length} total`);
  const jobIds = openJobs.map(j => j.id);

  // Fetch apps per job — cap at 5 pages (500 records) per job
  // Active pipeline candidates are recent; we don't need thousands of old archived apps
  const allAppsByJob = [];
  const JOB_CONCURRENCY = 10;
  for (let i = 0; i < jobIds.length; i += JOB_CONCURRENCY) {
    const batch = jobIds.slice(i, i + JOB_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(jobId => fetchAllPages('/application.list', { jobId }, 5))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') allAppsByJob.push(...r.value);
    }
    if (i % 50 === 0 && i > 0) console.log(`  Job apps: processed ${i} jobs, ${allAppsByJob.length} apps so far...`);
  }

  // Dedupe by id (candidates can apply to multiple jobs)
  const seenIds = new Set();
  const uniqueApps = allAppsByJob.filter(a => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });
  console.log(`  Total unique apps across all jobs: ${uniqueApps.length}`);

  // Status breakdown
  const statusBreakdown = {};
  for (const a of uniqueApps) statusBreakdown[a.status] = (statusBreakdown[a.status] || 0) + 1;
  console.log('  Status breakdown:', JSON.stringify(statusBreakdown));

  // Only fetch full app.info for active pipeline + recent hires
  // Use a 45-day window — all 275 active candidates were moved to a stage recently
  const fortyFiveDaysAgo = new Date();
  fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);
  const recentCutoff = fortyFiveDaysAgo.toISOString();

  const idsToFetch = uniqueApps.filter(a =>
    a.status === 'Hired' ||
    (a.status === 'Active' && (a.updatedAt || '') >= recentCutoff)
  ).map(a => a.id);
  console.log(`  Fetching app.info for ${idsToFetch.length} non-archived apps...`);
  const fullApps = await fetchAppInfoBatch(idsToFetch, 20);
  console.log(`  Full app info fetched: ${fullApps.length}`);

  // Aggregate
  const empty = () => ({ RPS: 0, HMS: 0, Onsite: 0, Offer: 0, 'Offer Accepted': 0 });
  const pipeline = { Tech: empty(), 'Non-Tech': empty() };
  const weeklyPipeline = { Tech: empty(), 'Non-Tech': empty() };

  const now = new Date();
  // Use sprint-week boundaries instead of calendar Monday
  // Sprint started 2026-05-28; each week is 7 days
  const SPRINT_START = new Date('2026-05-28T00:00:00.000Z');
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekNum = Math.min(Math.max(Math.ceil((now - SPRINT_START) / msPerWeek), 1), 7);
  const weekStart = new Date(SPRINT_START.getTime() + (weekNum - 1) * msPerWeek);
  const monday = weekStart; // "this week" = current sprint week
  console.log(`  Sprint week ${weekNum}, starts ${weekStart.toISOString()}`);

  const stagesSeen = {};
  const categorySeen = {};

  for (const app of fullApps) {
    const status = app.status || '';

    // Log current stage for debugging
    const stageTitle = app.currentInterviewStage?.title || '';
    const stageKey = `${stageTitle} [${status}]`;
    stagesSeen[stageKey] = (stagesSeen[stageKey] || 0) + 1;

    const jobInfo = jobMap[app.job?.id] || {};
    const deptId = app.job?.departmentId || jobInfo.deptId || '';
    const jobTitle = app.job?.title || jobInfo.title || '';
    const category = deptId ? (isDeptTech(deptId) ? 'Tech' : 'Non-Tech')
      : (jobTitle.toLowerCase().match(/engineer|software|developer|data|infra|security|design/) ? 'Tech' : 'Non-Tech');
    const catKey = `${category}: ${jobTitle || deptId || 'unknown'}`;
    categorySeen[catKey] = (categorySeen[catKey] || 0) + 1;

    // Count from applicationHistory — each stage the candidate passed through
    const history = app.applicationHistory || [];
    const countedStages6m = new Set(); // dedupe per app for 6-month funnel

    for (const h of history) {
      const enteredAt = h.enteredStageAt ? new Date(h.enteredStageAt) : null;
      if (!enteredAt || enteredAt < sixMonthsAgo) continue;

      const hStageTitle = h.title || h.stageName || h.interviewStageName || '';
      const stage = normalizeStage(hStageTitle, status);
      if (!stage) continue;

      // 6-month pipeline: count each stage once per app
      if (!countedStages6m.has(stage)) {
        pipeline[category][stage]++;
        countedStages6m.add(stage);
      }

      // Weekly pipeline: count each entry this week
      if (enteredAt >= monday) {
        weeklyPipeline[category][stage]++;
      }
    }

    // Ensure Hired apps count as Offer Accepted even if history entry is missing/old
    if (status === 'Hired' && !countedStages6m.has('Offer Accepted')) {
      pipeline[category]['Offer Accepted']++;
    }
  }

  console.log('Stages seen:', JSON.stringify(stagesSeen));
  console.log('Category breakdown:', JSON.stringify(categorySeen));

  // Fetch scheduled interviews from Ashby interviewSchedule.list
  const SPRINT_START_DATE = new Date('2026-05-28T00:00:00.000Z');
  const scheduledByWeek = await fetchInterviewSchedules(SPRINT_START_DATE, 7, fullApps, jobMap);
  console.log('Scheduled by week:', JSON.stringify(scheduledByWeek));

  return {
    pipeline, weeklyPipeline,
    scheduledByWeek,
    weekStart: monday.toISOString(),
    currentWeekNum: weekNum,
    totalApplications: fullApps.length,
    stagesSeen,
  };
}

// ── Load cache in background ──────────────────────────────────────────────────
async function refreshCache() {
  if (cache.loading) return;
  cache.loading = true;
  cache.error = null;
  console.log('Cache refresh started...');
  try {
    const data = await buildPipelineData();
    cache.data = data;
    cache.lastUpdated = new Date().toISOString();
    console.log('Cache updated:', cache.lastUpdated);
  } catch (err) {
    cache.error = err.message;
    console.error('Cache build error:', err.message);
  } finally {
    cache.loading = false;
  }
}

// Start loading on boot
refreshCache();
// Refresh every 30 minutes
setInterval(refreshCache, 30 * 60 * 1000);

// ── API endpoints ─────────────────────────────────────────────────────────────
app.get('/api/pipeline', (req, res) => {
  if (cache.data) {
    return res.json({ ...cache.data, lastUpdated: cache.lastUpdated, loading: false });
  }
  if (cache.loading) {
    return res.status(202).json({ loading: true, message: 'Pipeline data is loading, check back in ~30s' });
  }
  if (cache.error) {
    return res.status(500).json({ error: cache.error });
  }
  res.status(503).json({ loading: true });
});

app.post('/api/refresh', (req, res) => {
  refreshCache();
  res.json({ ok: true, message: 'Refresh started — check /api/pipeline in ~30s' });
});

app.get('/api/status', (req, res) => {
  res.json({
    loading: cache.loading,
    hasData: !!cache.data,
    lastUpdated: cache.lastUpdated,
    error: cache.error,
    stagesSeen: cache.data?.stagesSeen,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasKey: !!ASHBY_API_KEY && ASHBY_API_KEY !== 'your_ashby_api_key_here' });
});

// Serve React build in production
const path = require('path');
const fs = require('fs');
const buildPath = path.join(__dirname, '../client/build');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
