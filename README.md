# Food Check

Food Check is a mobile-first PWA for a shared household fridge list. It lets you:

- Track fridge, freezer, and pantry items.
- Add, edit, and remove items manually.
- Add optional use-by dates and see items that should be used soon.
- Search and filter the inventory by location or use-soon status.
- Upload a receipt photo, review extracted grocery items, adjust category/use-by details, then save selected items.
- Ask for meal recommendations based on the current inventory, cravings, and use-soon priority.

## Run Locally

```powershell
npm start
```

Then open:

```text
http://localhost:4179
```

By default, the app stores local household data in `data/store.json`.

## Test

With the server running, run:

```powershell
npm run smoke
```

If PowerShell blocks `npm.ps1`, run:

```powershell
node scripts\smoke-test.js
```

To test another deployed URL:

```powershell
$env:SMOKE_BASE_URL="https://your-app.example.com"
npm run smoke
```

## Shared Household Codes

The app starts on the `HOME` household. To share a list, enter the same household code on both devices, for example `ALEX-HOME`.

Every fridge item, receipt scan, edit, and recommendation is scoped to that code. Different codes keep separate lists.

## Gemini Receipt Scanning

Without an API key, receipt scanning uses demo extraction so the flow can be tested immediately.

To enable real AI scanning and recipe recommendations, get a free-tier Gemini API key from Google AI Studio and start the server with:

```powershell
$env:GEMINI_API_KEY="your_gemini_api_key_here"
npm start
```

Optional:

```powershell
$env:GEMINI_MODEL="gemini-3.1-flash-lite"
```

## Cloud Storage

For deployment, create a Supabase project and run [supabase-schema.sql](./supabase-schema.sql) in the SQL editor.

Then set these server environment variables:

```powershell
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
$env:SUPABASE_STATE_TABLE="food_check_state"
$env:SUPABASE_STATE_ID="default"
```

When both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present, the server stores all household data in Supabase instead of `data/store.json`.

## iPhone Use

For quick local testing, open the app in Safari. For proper iPhone home-screen use, deploy it to an HTTPS URL, then in Safari choose Share > Add to Home Screen.

For sharing between two phones, host the app and backend in one reachable HTTPS place, set the Supabase variables above, then use the same household code on both phones.

## Exact Phone Setup

1. Create a free Gemini API key in Google AI Studio.
2. Create a free Supabase project and run `supabase-schema.sql` in the SQL editor.
3. Deploy this app to a Node host such as Render.
4. Add these server environment variables on the host:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL=gemini-3.1-flash-lite`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_STATE_TABLE=food_check_state`
   - `SUPABASE_STATE_ID=default`
5. Open the deployed HTTPS app URL in Safari on each iPhone.
6. Tap Share, then Add to Home Screen.
7. Open the home-screen app on both phones and enter the same household code, for example `ALEX-HOME`.
8. Test the flow: scan a receipt, review the items, save them, edit the list on the other phone, then ask for a meal recommendation.

Gemini's free tier has rate limits and Google may use free-tier prompts to improve their products. Do not upload receipts with sensitive info you would not want processed by Google.

## Deploy

This app can run on any Node host that supports Node 18 or newer.

- `render.yaml` is included for Render-style deployment.
- `Dockerfile` is included for container deployment.
- `/api/health` is the health check endpoint.

For production sharing, set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` on the server host.
