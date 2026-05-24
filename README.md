# FitLog AI

A lightweight Codex-built fitness app prototype for tracking weight, exercise, meals, and calorie estimates.

## Run it

Open `index.html` in a browser, or serve the folder with any static file server.

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## What works now

- Log meals and estimate calories.
- Take or upload meal photos, save them with food entries, and include the photo in the calorie estimate workflow.
- Log exercises with minutes, intensity, workout links, and estimated calories burned.
- Log weight and height, calculate BMI, and see BMI change over time.
- Save data in the browser with `localStorage`.
- Sign in with Supabase to sync food, exercise, weight, BMI, and meal photos across devices.
- Export and import data as JSON.

## Cloud sync

This prototype is configured for Supabase:

- Auth for sign-in.
- Postgres tables: `food_entries`, `exercise_entries`, `weight_entries`.
- Storage bucket: `meal-photos`.
- Row-level security so each user only reads and writes their own records.

Signed-out data stays in the browser. Signed-in data loads from Supabase and new entries are saved to Supabase.

## AI calorie estimation

Do not call OpenAI directly from browser JavaScript because that exposes your private API key. Use a backend endpoint and send the meal text plus a saved photo URL or image payload:

```txt
POST /api/estimate-calories
Body: { "meal": "chicken salad with rice and avocado", "photo": "..." }
Returns: { "calories": 620, "confidence": "medium", "notes": "..." }
```

The current app has a local heuristic estimator so the workflow is usable immediately. Replace `estimateCalories()` in `app.js` with a call to your backend once the API exists.
