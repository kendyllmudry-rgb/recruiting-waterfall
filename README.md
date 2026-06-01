# Recruiting Ops Dashboard

Real-time waterfall funnel dashboard for the 7-week hiring sprint (ends July 15, 2026).

## Setup

### 1. Add your Ashby API key
Edit `server/.env`:
```
ASHBY_API_KEY=your_real_key_here
```

### 2. Install dependencies
```bash
npm install
npm run install:all
```

### 3. Run both server + client
```bash
npm run dev
```
- Backend runs on http://localhost:3001
- Frontend opens at http://localhost:3000

## Without an API key
The dashboard falls back to mock data automatically and shows a yellow warning banner.

## What it shows
- **Hire Goals** — cumulative progress bars toward 13 Tech / 5 Non-Tech hires
- **Pipeline Funnels** — full-funnel volumes for last 6 months
- **Week N Tracker** — weekly actuals vs targets with gap + on track / at risk / off track badges
- **Conversion Rates** — this-week conversions vs historical baseline (red = regression > 5pp)
- **Overall Risk Indicator** — sprint-level status based on whether actuals are within 15% of targets
