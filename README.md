# Phasely

<p align="center">
  <img src="src/assets/phasely-logo.svg" alt="Phasely logo" width="520" />
</p>

<p align="center">
  <strong>Stop re-typing your CV into every job form.</strong><br/>
  Free, open-source Chrome extension. One profile. Every application. One click.
</p>

---

Job applications are already exhausting. Pasting your email address into the 40th form shouldn't be part of it.

Phasely fills job application forms automatically — Workday, Greenhouse, Lever, iCIMS, LinkedIn Easy Apply, Ashby, and more — from a single encrypted markdown profile you write once and never touch again.

No accounts. No servers. No subscription. No nonsense.

---

## Quick start

```bash
npm ci && npm run build
```

1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/`
2. Open extension **Options**, paste your `profile.md`, click **Save Profile**
3. Upload your resume PDF
4. Navigate to a job application → open the Phasely popup → click **Fill**

---

## Profile format

Your profile lives in a YAML front-matter markdown file. Only three fields are required.

```yaml
---
firstName: Alex
lastName: Chen
email: alex@example.com

# Everything below is optional — skip what doesn't apply
phone: +1 415 555 0192
location: San Francisco, CA
currentTitle: Senior Software Engineer
currentCompany: Acme Corp
yearsExperience: 7
workAuth: US Citizen
noticePeriod: 2 weeks
salaryExpectation: "$160,000"
willingToRelocate: false
remotePreference: Remote
linkedin: https://linkedin.com/in/alexchen
github: https://github.com/alexchen
portfolio: https://alexchen.dev
skills:
  - TypeScript
  - React
  - Node.js
  - PostgreSQL
education:
  - degree: BSc Computer Science
    institution: UC Berkeley
    year: 2017
referencesAvailable: true
---

## Summary

Results-driven engineer with 7 years of experience building scalable web applications.

## Experience

**Senior Software Engineer — Acme Corp** (2021–present)
- Led migration from monolith to microservices, reducing p99 latency by 40%
```

> **Don't want to write this by hand?** Paste your CV into ChatGPT or Gemini and ask: *"Convert this into a Phasely profile using YAML front-matter. Required fields: firstName, lastName, email. Optional: phone, location, currentTitle, currentCompany, yearsExperience, skills (list), education (list with degree/institution/year), linkedin, github, portfolio, workAuth, noticePeriod, salaryExpectation, willingToRelocate, remotePreference, referencesAvailable."*

---

## How it works

```
profile.md  ──►  parse & validate      src/lib/profile.ts
            ──►  encrypt & store        src/lib/storage.ts       AES-GCM, device-bound key
                                                    │
                                              page load
                                                    │
            ──►  detect form fields     src/content/detector.ts  10 heuristic signals per field
            ──►  score against profile  src/lib/fuzzyMatch.ts    exact → Levenshtein → token overlap
            ──►  fill matched fields    src/content/filler.ts    native setter + SPA-aware events
            ──►  optional submit        src/content/submitter.ts
```

Field detection is heuristic — each field is scored across ten signals (label text, `name`, `id`, `placeholder`, `aria-label`, `autocomplete`, and more) and matched against hundreds of profile key aliases. No hard-coded selectors. Adapts to form variations without breaking.

---

## Why open source

- **You can read exactly what it does with your data.** (Short answer: encrypts it locally and never sends it anywhere.)
- **No lock-in.** Your profile is a plain text file you own completely.
- **Contributions welcome.** Adding a new ATS adapter, field alias, or detection heuristic takes maybe 20 lines.

---

## Tech stack

| Layer | Choice |
|-------|--------|
| UI | React 18 + TypeScript |
| Build | Vite + CRXJS (Manifest V3) |
| Styling | Tailwind CSS 4 |
| Parsing | `yaml` (front-matter) |
| Encryption | Web Crypto API — AES-GCM, PBKDF2 |
| Testing | Vitest |

---

## Project structure

```
src/
  background/sw.ts        Service worker — message router, storage ops
  content/
    detector.ts           DOM scan → scored DetectedField[]
    filler.ts             Write values + fire SPA-compatible events
    submitter.ts          Detect submit button, click, poll for success
    adapters/             ATS-specific helpers (Greenhouse, Lever, Workday)
  lib/
    fieldMap.ts           Canonical field keys + alias resolution (~24 keys, hundreds of aliases)
    fuzzyMatch.ts         Confidence scoring
    profile.ts            YAML parse + validation + prompt injection sanitisation
    storage.ts            AES-GCM encrypt/decrypt + chrome.storage wrappers
    types.ts              Shared TypeScript interfaces
    defaults.ts           Extension defaults
  popup/                  Extension popup UI
  options/                Settings + profile management page
  tests/                  Unit tests (fieldMap, fuzzyMatch, profile)
```

---

## Security

- Profile and resume data are AES-GCM encrypted before being written to `chrome.storage.local`.
- The encryption key is derived via PBKDF2 (310,000 iterations) with a random device-bound salt. No raw key material is ever stored.
- Content scripts make no outbound network calls — all external requests go through the service worker.
- Profile text is sanitised against known prompt injection patterns before any AI call.
- No analytics. No telemetry. No Phasely backend.

---

## Development

```bash
npm ci           # install dependencies
npm run dev      # Vite dev server — popup and options hot-reload
npm run build    # production build → dist/
npm run test     # Vitest unit tests
npm run lint     # ESLint
```

Load unpacked from `dist/` in `chrome://extensions` with Developer mode on.

---

## Releasing

1. Bump version in both `manifest.json` and `package.json` to match.
2. `npm ci && npm run build`
3. Zip the **contents** of `dist/` (not the folder itself).
4. Upload to Chrome Web Store dashboard.

---

## AI features (in progress)

Gemini-powered cover letter and open-question generation is in progress. The OAuth plumbing is already wired — it calls the Generative Language API directly from the browser using your Google account. No Phasely servers involved.

To enable during development:

1. Google Cloud Console → Enable **Generative Language API**
2. Configure OAuth consent screen → add your account as a test user
3. Create OAuth client credentials for the extension flow
4. Replace `oauth2.client_id` in `manifest.json`
5. Reload extension → **Sign in with Google** in Options

---

## Contributing

PRs and issues are welcome. The codebase is straightforward to extend:

- **New field alias:** add to `src/lib/fieldMap.ts`
- **New ATS adapter:** add to `src/content/adapters/`
- **New detection heuristic:** add to `extractSignals()` in `src/content/detector.ts`

---

## License

MIT
