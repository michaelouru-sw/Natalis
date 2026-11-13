# Natalis — private period tracker (installable phone app)

Works on iPhone and Android as an installable web app (PWA). Offline, no account, data stays on the phone.

## Features
- Regular cycles: single-date prediction, recency-weighted, narrow window.
- Unpredictable cycles: range prediction, "not started yet" re-estimation, ovulation confirmation (temperature 3-over-6, LH test) that re-anchors the period date (ovulation + your learned luteal length).
- Google Calendar: separate "Natalis" calendar, minimal scope (calendar.app.created), discreet titles, reminders, diff-based sync, restore on a new phone. .ics export for any calendar app.
- Insights, clinician flags, doctor summary, JSON/CSV backup, PIN screen lock, pause/contraception modes.

## Deploy (5 min, free)
1. Push this folder to a GitHub repo, enable Pages (Settings → Pages → main / root).
2. Open the https URL on your phone → Share → Add to Home Screen (iOS) or ⋮ → Install app (Android).

## Google Calendar setup (one-time)
1. console.cloud.google.com → new project → enable Google Calendar API.
2. OAuth consent screen → External → add yourself as Test user → add scope .../auth/calendar.app.created.
3. Credentials → OAuth client ID → Web application → Authorized JavaScript origin = your Pages origin (e.g. https://USER.github.io).
4. In the app: Settings → Google Calendar → paste Client ID → Connect & sync.

## Develop
`node test/engine.test.js` (15 tests) · `node test/backtest.js` (simulated accuracy) · serve with `python3 -m http.server`.
Not medical advice; calendar fertile-window estimates must not be used for contraception.

## Wellness module
Phase-aware food, movement and self-care ideas (Kenyan-kitchen examples), symptom support, daily rings (move / sleep / water), energy check-in, weekly activity vs WHO targets, and personal energy/sleep by phase. Every tip shows an evidence level. No weight or calorie targets, by design.
