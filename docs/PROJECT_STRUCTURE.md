# Project Structure — SeenDisJob (Chrome Extension)

This file is a contributor-facing map of the repository. The public product overview lives in the root README, while the deeper implementation history and engineering notes live in the `docs/` folder.

SeenDisJob is currently a source-only Chromium extension. Live Chrome testing is still required because the extension depends on `chrome.userScripts` and the browser must allow that permission for the detector to work.

```
SeenDisJob/
├── background.js                 Service worker — owns storage, duplicate decisions,
│                                tab lineage, recent activity, application totals,
│                                and extension messaging.
├── CHANGELOG.md                  Release notes and known limitations.
├── content-scripts/
│   ├── sniffer.js                Runs on most pages and does a lightweight
│   │                            "does this look like a job page?" check.
│   ├── engine.js                 Extracts job info from JSON-LD, meta tags, or DOM
│   │                            content and renders the in-page warning.
│   └── matching.js               Pure matching logic: normalization, tokenization,
│                                 abbreviation expansion, and similarity checks.
├── dashboard/
│   ├── dashboard.html            Dashboard UI for overview, applications, activity,
│   │                            postings, trust, and settings.
│   └── dashboard.js              Dashboard logic and data rendering.
├── docs/
│   ├── PROJECT_STRUCTURE.md      This file.
│   └── SEENDISJOB_CONTEXT.md     Internal design and implementation history.
├── graphify-out/                 Generated codebase knowledge-graph artifacts;
│                                not required at runtime.
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png               Extension icons.
├── LICENSE                       MIT license.
├── LICENSE-APACHE-2.0            Apache-2.0 license.
├── manifest.json                 Extension manifest, permissions, popup, and host
│                                access configuration.
├── onboarding/
│   ├── onboarding.html          First-run setup and consent UI.
│   └── onboarding.js            Writes consent, guides Chrome setup, and checks
│                                whether User Scripts is enabled.
├── popup/
│   ├── popup.html               Toolbar popup UI.
│   └── popup.js                 Current-tab status, history, and dashboard
│                                navigation. Data management lives in dashboard.
├── README.md                    Public-facing project description, install steps,
│                                use cases, and FAQ.
├── tests/
│   └── matching.test.js          Dependency-free tests for the matching engine.
└── .gitignore
```

## Execution contexts, at a glance

There are several Chrome execution contexts in play, and mixing them up is the easiest way to introduce a bug:

- **`background.js`** — service worker. No DOM. Owns `chrome.storage` and the duplicate decision logic. It is not always running, and Chrome may kill it after idle periods.
- **`sniffer.js`** — regular declared content script. Runs on many pages and performs a cheap “is this a job page?” check before anything heavier happens.
- **`engine.js` + `matching.js`** — injected into a `USER_SCRIPT` world via `chrome.userScripts.execute()`. These cannot touch `chrome.storage` directly and instead use message passing.
- **`onboarding.html` / `onboarding.js`** — normal extension page with full access to `chrome.storage` and `chrome.tabs`.
- **`popup.js` and `dashboard.js`** — normal extension pages with direct access to browser extension APIs and messaging.

## Current release notes

- Release: `1.4`
- Author: Wisdom Ekwugha
- Distribution: source-only; installed as an unpacked extension in Chrome
- Not currently published to the Chrome Web Store
- Includes popup status, recent history, dashboard summaries, and application counting
- Repository: `https://github.com/UprightCode-hub/SeenDisJob`
- LinkedIn: `https://www.linkedin.com/in/wisdom-ekwugha`
- Optional support: `https://flutterwave.com/donate/91lbt43tel7n`
- Update detection: the service worker compares the installed manifest version with the GitHub `main` branch manifest and links users back to the repository when a newer version exists.
- Real browser testing is still required because the extension depends on Chrome’s `chrome.userScripts` permission
- Some edge cases remain, especially around third-party Apply flows or external sites whose tab lineage is incomplete

## Notes for contributors

- The public-facing README is intentionally user-oriented and concise.
- The implementation notes and decision history live in `docs/SEENDISJOB_CONTEXT.md`.
- The matching logic is deliberately kept pure and testable in `content-scripts/matching.js`.
- The extension’s main value proposition is local duplicate detection for job seekers, not a general-purpose job tracker.
- The popup intentionally stays compact; backup and clearing controls are kept in dashboard Settings.
