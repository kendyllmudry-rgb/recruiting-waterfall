// Sprint configuration
export const SPRINT_END = new Date('2026-07-15');
export const SPRINT_START = new Date('2026-05-28');
export const HIRE_GOALS = { Tech: 13, 'Non-Tech': 5 };

export const STAGES = ['RPS', 'HMS', 'Onsite', 'Offer', 'Offer Accepted'];

// Historical conversion rates (passthrough from one stage to next)
export const BASELINE_RATES = {
  Tech: {
    'RPS→HMS': 0.67,
    'HMS→Onsite': 0.39,
    'Onsite→Offer': 0.33,
    'Offer→Offer Accepted': 0.81,
  },
  'Non-Tech': {
    'RPS→HMS': 0.59,
    'HMS→Onsite': 0.33,
    'Onsite→Offer': 0.49,
    'Offer→Offer Accepted': 0.84,
  },
};

// Weekly pacing targets by week number (1-indexed, 7 weeks)
export const WEEKLY_TARGETS = {
  Tech: {
    1: { RPS: 31, HMS: 21, Onsite: 8, Offer: 3, 'Offer Accepted': 2 },
    2: { RPS: 31, HMS: 21, Onsite: 8, Offer: 3, 'Offer Accepted': 2 },
    3: { RPS: 31, HMS: 20, Onsite: 8, Offer: 2, 'Offer Accepted': 2 },
    4: { RPS: 29, HMS: 19, Onsite: 7, Offer: 2, 'Offer Accepted': 2 },
    5: { RPS: 23, HMS: 15, Onsite: 6, Offer: 2, 'Offer Accepted': 2 },
    6: { RPS: 23, HMS: 15, Onsite: 6, Offer: 2, 'Offer Accepted': 1 },
    7: { RPS: 23, HMS: 15, Onsite: 6, Offer: 2, 'Offer Accepted': 1 },
  },
  'Non-Tech': {
    1: { RPS: 12, HMS: 7, Onsite: 2, Offer: 1, 'Offer Accepted': 1 },
    2: { RPS: 12, HMS: 7, Onsite: 2, Offer: 1, 'Offer Accepted': 1 },
    3: { RPS: 12, HMS: 7, Onsite: 2, Offer: 1, 'Offer Accepted': 1 },
    4: { RPS: 12, HMS: 7, Onsite: 2, Offer: 1, 'Offer Accepted': 1 },
    5: { RPS: 7, HMS: 4, Onsite: 2, Offer: 1, 'Offer Accepted': 1 },
    6: { RPS: 6, HMS: 4, Onsite: 1, Offer: 1, 'Offer Accepted': 1 },
    7: { RPS: 6, HMS: 4, Onsite: 1, Offer: 1, 'Offer Accepted': 1 },
  },
};

// Current sprint week (1–7)
export function getCurrentWeek() {
  const now = new Date();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const week = Math.ceil((now - SPRINT_START) / msPerWeek);
  return Math.min(Math.max(week, 1), 7);
}

// Mock data for when Ashby API key isn't configured
export const MOCK_PIPELINE = {
  pipeline: {
    Tech: { RPS: 142, HMS: 89, Onsite: 31, Offer: 9, 'Offer Accepted': 7 },
    'Non-Tech': { RPS: 58, HMS: 31, Onsite: 11, Offer: 5, 'Offer Accepted': 4 },
  },
  weeklyPipeline: {
    Tech: { RPS: 28, HMS: 17, Onsite: 6, Offer: 2, 'Offer Accepted': 1 },
    'Non-Tech': { RPS: 10, HMS: 5, Onsite: 1, Offer: 1, 'Offer Accepted': 1 },
  },
  isMock: true,
};
