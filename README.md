# Phasely

<p align="center">
  <img src="src/assets/phasely-logo.svg" alt="Phasely logo" width="520" />
</p>

Phasely is a Chrome extension that autofills job application forms from a single encrypted markdown profile.

## Why Phasely

- One profile, reused across many job portals
- Heuristic field detection with confidence scoring
- One-click fill and optional submit flow
- Local-first encrypted storage (AES-GCM)
- Zero telemetry and no Phasely backend servers

## Features

- Import profile data from markdown front-matter
- Detect input, textarea, select, file, and contenteditable fields
- Fill all high-confidence fields or fill per-field
- Resume file upload + auto-attach on file inputs
- Job context extraction (title/company/location)
- Settings for model choice and submit behavior

## Tech Stack

- React 18 + TypeScript
- Vite + CRXJS (Manifest V3)
- Tailwind CSS
- Vitest + ESLint

## Project Structure

```text
src/
  background/sw.ts        # Service worker message router
  content/                # Field detection, filling, submit
  lib/                    # Profile parsing, storage, mapping, shared types
  popup/                  # Extension popup UI
  options/                # Settings/options page UI
```

## Local Development

```bash
npm ci
npm run dev
```

## Build

```bash
npm run build
```

Build output is generated in `dist/`.

## Load in Chrome (User Testing)

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select `dist/`.
5. Open extension **Options**, import your `profile.md`, then test scan/fill/submit from the popup on target forms.

## Quality Checks

```bash
npm run lint
npm run test
```

## Release

1. Ensure `manifest.json` and `package.json` version values match.
2. Build on clean `main`: `npm ci && npm run build`.
3. Zip the contents of `dist/` (not the folder itself).
4. Upload ZIP to Chrome Web Store dashboard and submit for review.

## Security

- Profile and resume data are encrypted before persistence.
- Content scripts do not perform direct remote API calls.
- No analytics or telemetry is collected.
