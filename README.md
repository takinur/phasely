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

Phasely fills job application forms automatically from a single encrypted markdown profile you write once and never touch again. It also generates tailored cover letters using Google Gemini, pulling the job description directly from the page.

No accounts. No servers. No subscription. No nonsense.

---

## Quick start

```bash
npm ci && npm run build
```

1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/`
2. Open the extension **Options** page, paste your `profile.md`, click **Save Profile**
3. Optionally upload your resume PDF — Phasely attaches it to file-upload fields automatically
4. Navigate to a job application → open the Phasely popup → click **Fill**

---

## Profile format

Your profile lives in a YAML front-matter markdown file. Only three fields are required — everything else improves fill accuracy but is optional.

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

> **Don't want to write this by hand?** Paste your CV into ChatGPT or Gemini and ask:
> *"Convert this CV into a Phasely profile.md. Use YAML front-matter (between --- delimiters). Required fields: firstName, lastName, email. Include if present: phone, location, currentTitle, currentCompany, yearsExperience, skills (YAML list), education (YAML list with degree / institution / year), workAuth, noticePeriod, salaryExpectation, willingToRelocate, remotePreference. After the closing ---, add a brief markdown summary and experience section."*
>
> Paste the result into the Options page and click **Save Profile**. The live preview flags any issues before you save.

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

Field detection is heuristic — each field is scored across ten signals (`label` text, `name`, `id`, `placeholder`, `aria-label`, `autocomplete`, and more) and matched against hundreds of profile key aliases. No hard-coded selectors. Adapts to form variations without breaking.

ATS-specific adapters (Greenhouse, Lever, Workday) run targeted fills on top of the generic pass, using each platform's known `name=` patterns and `data-automation-id` attributes. Workday's shadow DOM is traversed recursively.

---

## AI — cover letter generation

Phasely can generate a tailored cover letter from the popup using **Google Gemini**.

**How it works:**

1. Your profile markdown (work history, skills, summary) is used as the candidate background.
2. The job title, company, and description are scraped live from the active tab — JSON-LD, Open Graph meta, and ATS-specific DOM selectors are all tried.
3. Gemini generates a concise, human-sounding cover letter (three paragraphs, ~200 words) tailored to that specific role.
4. The result is injected into the cover letter field on the page and shown in the popup for copying.

**Setup:**

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) and create a free API key.
2. In Phasely **Options → AI Settings**, paste the key and click **Save**.
3. Choose your preferred Gemini model from the dropdown — the list is fetched live from your key.
4. Click **Generate Cover Letter** in the popup on any job posting.

Your API key is AES-GCM encrypted on-device and never leaves your browser. All Gemini calls go directly from your browser to Google's API — no Phasely backend involved.

---

## Privacy

- Profile, resume, API key, and settings are all AES-GCM encrypted before being written to `chrome.storage.local`.
- The encryption key is derived via PBKDF2 (310,000 iterations) with a random device-bound salt. No raw key material is ever stored.
- Content scripts make no outbound network calls — all external requests go through the service worker.
- Profile text is sanitised against known prompt injection patterns before any AI call.
- No analytics. No telemetry. No Phasely backend. Zero servers.

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
| Build | Vite (multi-entry: popup, options, content script, service worker) |
| Styling | Tailwind CSS 4 |
| Parsing | `gray-matter` (YAML front-matter) |
| Encryption | Web Crypto API — AES-GCM, PBKDF2 (310,000 iterations) |
| AI | Google Gemini REST API (direct from browser, user-supplied key) |

---

## Project structure

```
src/
  background/sw.ts        Service worker — message router, storage ops, Gemini API calls
  content/
    detector.ts           DOM scan → scored DetectedField[], job context scraping
    filler.ts             Write values + fire SPA-compatible events
    submitter.ts          Detect submit button, click, poll for success
    adapters/
      greenhouse.ts       Greenhouse-specific targeted fills
      lever.ts            Lever-specific targeted fills
      workday.ts          Workday shadow DOM traversal + targeted fills
  lib/
    fieldMap.ts           Canonical field keys + alias resolution (~24 keys, hundreds of aliases)
    fuzzyMatch.ts         Confidence scoring (exact → Levenshtein → token overlap)
    profile.ts            YAML parse + validation + prompt injection sanitisation
    prompts.ts            Cover letter + behavioural question prompt templates
    storage.ts            AES-GCM encrypt/decrypt + chrome.storage wrappers
    types.ts              Shared TypeScript interfaces
    defaults.ts           Extension defaults
  popup/                  Extension popup UI
  options/                Settings + profile management page
```

---

## Development

```bash
npm ci           # install dependencies
npm run dev      # Vite dev server — popup and options hot-reload
npm run build    # production build → dist/
npm run lint     # ESLint
```

Load unpacked from `dist/` in `chrome://extensions` with Developer mode on.

---

## Releasing

1. Bump version in both `manifest.json` and `package.json` to match.
2. `npm ci && npm run build`
3. Zip the **contents** of `dist/` (not the folder itself).
4. Upload to the Chrome Web Store dashboard.

---

## Contributing

PRs and issues are welcome. The codebase is intentionally straightforward to extend:

- **New field alias:** add to `src/lib/fieldMap.ts`
- **New ATS adapter:** add to `src/content/adapters/` — export `detect(): boolean` and `fill(profile): void`
- **New detection heuristic:** add a signal to `extractSignals()` in `src/content/detector.ts`

---

## License

MIT
