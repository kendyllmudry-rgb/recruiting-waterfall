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

const NON_TECH_DEPTS = ['marketing', 'sales', 'finance', 'legal', 'hr', 'people', 'operations',
  'recruiting', 'communications', 'brand', 'business', 'product management', 'product manager',
  'product', 'growth', 'partnerships', 'customer', 'strategy', 'compliance', 'risk'];

// Job title patterns — checked BEFORE dept hierarchy so "Senior Product Manager" is never Tech
const NON_TECH_TITLE = /product manager|program manager|project manager|chief of staff|scrum|agile|operations manager|marketing|sales|recruiter|sourcer|talent|finance|legal|counsel|hr |people ops|communications|brand|growth|partnerships|customer success|customer support|bizdev|business development|strategy|compliance|risk manager/i;
const TECH_TITLE = /engineer|software|developer|data scientist|machine learning|ml engineer|ai engineer|infrastructure|devops|sre |sdet|security engineer|product designer|ux designer|ui designer|researcher/i;

function classifyJob(deptId, jobTitle) {
  const t = (jobTitle || '').toLowerCase();
  // Title override — runs first; most reliable signal
  if (NON_TECH_TITLE.test(t)) return 'Non-Tech';
  if (TECH_TITLE.test(t)) return 'Tech';
  // Fall back to dept hierarchy
  if (deptId) return isDeptTech(deptId) ? 'Tech' : 'Non-Tech';
  return 'Non-Tech';
}

function isDeptTech(deptId) {
  const visited = new Set();
  let id = deptId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const d = deptHierarchy[id];
    if (!d) break;
    if (!d.parentId) {
      const n = d.name.toLowerCase();
      if (NON_TECH_DEPTS.some(k => n.includes(k))) return false;
      const techWords = ['engineer', 'tech', 'design', 'data', 'research',
        'security', 'platform', 'infra', 'science', 'analytics', 'sdet', 'developer', 'software'];
      return techWords.some(k => n.includes(k));
    }
    id = d.parentId;
  }
  return false;
}

// Log all top-level dept classifications once
function logDeptClassifications() {
  const topLevel = Object.entries(deptHierarchy).filter(([,d]) => !d.parentId);
  const classified = topLevel.map(([id, d]) => `${isDeptTech(id) ? 'Tech' : 'Non-Tech'}: ${d.name}`);
  console.log('  Dept classifications:', classified.join(' | '));
}

// ── Fetch scheduled interviews from /interviewSchedule.list ───────────────────
async function fetchInterviewSchedules(sprintStart, numWeeks, fullApps, jobMap, appStageMap = {}) {
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
    const category = classifyJob(deptId, jobTitle);
    const currentStage = normalizeStage(app.currentInterviewStage?.title || '', app.status || '');
    appMap[app.id] = { category, stage: currentStage };

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

  // Fetch schedules updated in last 45 days — wide enough to catch interviews
  // scheduled well in advance (3-4 weeks out) without blowing the 2000-record cap
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);
  const schedules = await fetchAllPages('/interviewSchedule.list', {
    updatedAfter: cutoff.toISOString(),
  }, 30).catch(e => {
    console.warn('  interviewSchedule.list failed:', e.message);
    return [];
  });
  console.log(`  interviewSchedule.list: ${schedules.length} schedules fetched`);
  // Log full structure of first few schedules to understand available fields
  if (schedules[0]) {
    console.log('  Sample schedule keys:', Object.keys(schedules[0]).join(', '));
    console.log('  Sample schedule:', JSON.stringify(schedules[0]).slice(0, 600));
  }
  if (schedules[1]) console.log('  Sample schedule 2:', JSON.stringify(schedules[1]).slice(0, 600));
  const withEvents = schedules.filter(s => s.interviewEvents?.length > 0);
  console.log(`  Schedules with events: ${withEvents.length}`);
  if (withEvents[0]) {
    console.log('  Sample event keys:', Object.keys(withEvents[0].interviewEvents[0]).join(', '));
    console.log('  Sample event:', JSON.stringify(withEvents[0].interviewEvents[0]).slice(0, 400));
  }

  // Log sample schedule to debug stageId mapping
  if (withEvents[0]) {
    console.log('  Sample sched keys:', Object.keys(withEvents[0]).join(', '));
    console.log('  Sample sched stageId:', withEvents[0].interviewStageId);
    console.log('  Sample sched appId:', withEvents[0].applicationId);
    console.log('  stageIdMap size:', Object.keys(stageIdMap).length);
    console.log('  stageIdMap sample:', JSON.stringify(Object.entries(stageIdMap).slice(0, 3)));
    const ev0 = withEvents[0].interviewEvents[0];
    console.log('  Sample event startTime:', ev0?.startTime, 'sprintStart:', sprintStart.toISOString());
  }

  let counted = 0, noStage = 0, outOfRange = 0;
  for (const sched of schedules) {
    const events = sched.interviewEvents || [];

    for (const ev of events) {
      const startRaw = ev.startTime || ev.start || ev.scheduledAt || ev.date || ev.startAt;
      if (!startRaw) continue;
      const start = new Date(startRaw);
      if (start < sprintStart || start >= sprintEnd) { outOfRange++; continue; }

      const msIn = start - sprintStart;
      const w = Math.min(Math.floor(msIn / msPerWeek) + 1, numWeeks);

      // Look up stage: stageIdMap → appMap (fullApps) → appStageMap (all active apps)
      let stage = stageIdMap[sched.interviewStageId] || null;
      const appData = appMap[sched.applicationId] || appStageMap[sched.applicationId] || null;
      if (!stage) stage = appData?.stage || null;
      if (!stage) { noStage++; continue; }

      const category = appData?.category || 'Tech';

      scheduledByWeek[w][category][stage]++;
      counted++;
    }
  }

  console.log(`  Scheduled interviews counted: ${counted} (skipped: ${outOfRange} out-of-range, ${noStage} no-stage)`);
  if (withEvents.length === 0) console.log('  NOTE: No interviewEvents found in any schedule — interviews may not have event times yet');

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
    const category = classifyJob(deptId, jobTitle);

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
      const w = Math.min(Math.floor(msIn / msPerWeek) + 1, numWeeks);

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

  // Build a broad appStageMap from ALL active apps in the list (covers interviewSchedule lookups)
  // application.list returns currentInterviewStage so we can map appId → stage without fetching full info
  const appStageMap = {};
  for (const a of uniqueApps) {
    if (a.status === 'Active' || a.status === 'Hired') {
      const jobInfo = jobMap[a.job?.id] || {};
      const deptId = a.job?.departmentId || jobInfo.deptId || '';
      const jobTitle = a.job?.title || jobInfo.title || '';
      const category = classifyJob(deptId, jobTitle);
      const stageTitle = a.currentInterviewStage?.title || '';
      const stage = normalizeStage(stageTitle, a.status || '');
      appStageMap[a.id] = { category, stage };
    }
  }
  console.log(`  appStageMap built: ${Object.keys(appStageMap).length} apps`);

  // Only fetch full app.info for active pipeline + recent hires (for history/conversion data)
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
  const sprintPipeline = { Tech: empty(), 'Non-Tech': empty() };
  const weeklyPipeline = { Tech: empty(), 'Non-Tech': empty() };
  const prevWeekPipeline = { Tech: empty(), 'Non-Tech': empty() };
  const activePipeline = { Tech: empty(), 'Non-Tech': empty() };

  // Monthly funnels — trailing 3 calendar months
  const now = new Date();
  const monthlyFunnels = {};
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyFunnels[key] = { Tech: empty(), 'Non-Tech': empty() };
  }

  // Calendar Mon–Fri weeks
  const dayOfWeek = now.getUTCDay(); // 0=Sun,1=Mon...5=Fri,6=Sat
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysToMonday));
  const friday = new Date(monday.getTime() + 4 * 24 * 60 * 60 * 1000);
  const prevWeekStart = new Date(monday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevWeekEnd = monday;
  const nextWeekStart = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextWeekFriday = new Date(nextWeekStart.getTime() + 4 * 24 * 60 * 60 * 1000);

  // Sprint week number based on Mon–Fri calendar weeks
  // First Monday of sprint = Jun 1, 2026
  const SPRINT_FIRST_MONDAY = new Date('2026-06-01T00:00:00.000Z');
  const SPRINT_START = new Date('2026-05-28T00:00:00.000Z');
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekNum = Math.min(Math.max(Math.floor((monday - SPRINT_FIRST_MONDAY) / msPerWeek) + 1, 1), 7);
  console.log(`  Calendar week: ${monday.toISOString().slice(0,10)} – ${friday.toISOString().slice(0,10)}, sprint week ${weekNum}`);
  logDeptClassifications();

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
    const category = classifyJob(deptId, jobTitle);
    const catKey = `${category}: ${jobTitle || deptId || 'unknown'}`;
    categorySeen[catKey] = (categorySeen[catKey] || 0) + 1;

    // Active pipeline: count by current stage right now (excludes Application Review)
    if (status === 'Active') {
      const curStage = normalizeStage(stageTitle, status);
      const curTitleLower = stageTitle.toLowerCase().trim();
      if (curStage && curTitleLower !== 'application review') {
        activePipeline[category][curStage]++;
      }
    }

    // Count from applicationHistory — each stage the candidate passed through
    const history = app.applicationHistory || [];
    const countedStages6m = new Set();   // dedupe per app for 6-month funnel
    const countedStagesWeekly = new Set(); // dedupe per app for weekly tracker

    // Auto-assigned stages that fire on every application — exclude from all counts
    const EXCLUDE_STAGES = ['application review', 'applied', 'sourced'];
    const countedStagesMonthly = {}; // monthKey → Set of "stage" strings already counted for this app

    for (const h of history) {
      const enteredAt = h.enteredStageAt ? new Date(h.enteredStageAt) : null;
      if (!enteredAt || enteredAt < sixMonthsAgo) continue;

      const hStageTitle = (h.title || h.stageName || h.interviewStageName || '').toLowerCase().trim();
      if (EXCLUDE_STAGES.includes(hStageTitle)) continue; // skip auto-stages everywhere

      const stage = normalizeStage(hStageTitle, status);
      if (!stage) continue;

      // 6-month pipeline: count each stage once per app
      if (!countedStages6m.has(stage)) {
        pipeline[category][stage]++;
        countedStages6m.add(stage);
      }

      // Monthly funnels: bucket by calendar month, count each stage once per app per month
      const monthKey = `${enteredAt.getFullYear()}-${String(enteredAt.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyFunnels[monthKey]) {
        const monthCounted = countedStagesMonthly[monthKey] || (countedStagesMonthly[monthKey] = new Set());
        const mk = `${monthKey}-${stage}`;
        if (!monthCounted.has(mk)) {
          monthlyFunnels[monthKey][category][stage]++;
          monthCounted.add(mk);
        }
      }

      // Sprint pipeline: only Offer Accepted since sprint start (for Hire Goals progress)
      if (stage === 'Offer Accepted' && enteredAt >= SPRINT_START) {
        sprintPipeline[category]['Offer Accepted']++;
      }

      // Weekly pipeline: count each stage once per app
      if (enteredAt >= monday && !countedStagesWeekly.has(stage)) {
        weeklyPipeline[category][stage]++;
        countedStagesWeekly.add(stage);
      }

      // Previous week pipeline
      if (prevWeekStart && enteredAt >= prevWeekStart && enteredAt < prevWeekEnd) {
        prevWeekPipeline[category][stage]++;
      }
    }

    // Ensure Hired apps count as Offer Accepted if their hire date is within 6 months
    // (guards against cases where applicationHistory is missing the final OA entry)
    if (status === 'Hired' && !countedStages6m.has('Offer Accepted')) {
      const hiredAt = app.hiredAt || app.archivedAt || app.updatedAt || null;
      if (!hiredAt || new Date(hiredAt) >= sixMonthsAgo) {
        pipeline[category]['Offer Accepted']++;
      }
    }
  }

  console.log('Stages seen:', JSON.stringify(stagesSeen));
  console.log('Category breakdown:', JSON.stringify(categorySeen));

  // Return pipeline data immediately — fetch schedules in background
  const SPRINT_START_DATE = new Date('2026-05-28T00:00:00.000Z');
  console.log('Active pipeline:', JSON.stringify(activePipeline));
  console.log('Monthly funnels:', JSON.stringify(monthlyFunnels));
  const result = {
    pipeline, sprintPipeline, weeklyPipeline, prevWeekPipeline, activePipeline, monthlyFunnels,
    scheduledByWeek: null,
    weekStart: monday.toISOString(),
    weekEnd: friday.toISOString(),
    prevWeekStartISO: prevWeekStart.toISOString(),
    nextWeekStartISO: nextWeekStart.toISOString(),
    nextWeekEndISO: nextWeekFriday.toISOString(),
    currentWeekNum: weekNum,
    totalApplications: fullApps.length,
    stagesSeen,
  };

  // Fetch schedules async — updates cache.data when done without blocking initial load
  // Use SPRINT_FIRST_MONDAY (Jun 1) as anchor so week numbers match the frontend calendar weeks
  fetchInterviewSchedules(SPRINT_FIRST_MONDAY, 7, fullApps, jobMap, appStageMap).then(scheduledByWeek => {
    if (cache.data) cache.data.scheduledByWeek = scheduledByWeek;
    console.log('Scheduled by week updated:', JSON.stringify(scheduledByWeek['1']));
  }).catch(e => console.warn('Schedule fetch failed:', e.message));

  return result;
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
