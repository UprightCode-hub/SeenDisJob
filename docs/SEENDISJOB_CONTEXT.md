# SeenDisJob — Chrome Extension — Handoff v2

This file is internal project context for contributors and maintainers. It documents the engineering decisions and design history behind the current implementation. It is not intended to be the public-facing product description.

## Current release: v1.4

The repository currently ships source release `1.4`. The manifest version is the update signal for unpacked installations: `background.js` fetches the `main` branch `manifest.json` from GitHub every 12 hours at most, compares it with the installed version, and exposes an informational update link through the popup and dashboard. It never downloads or installs source automatically. Users must download the repository and reload the unpacked extension from `chrome://extensions`.

## Who's building this
Python developer, <2yrs pro experience. Reads JS fine, can't confidently write it from scratch. Uses VS Code + a "Codex" agent in-editor as an alternative/complement. Wants: minimal-but-real comments (not line-by-line), production-ready code, incremental builds (one file at a time, don't generate everything at once), and to be told plainly whenever something isn't fully understood or something newly-found conflicts with an earlier decision.

## The problem / product
During high-volume job search (30+ tabs normal), same job posting often reappears (repost, staffing-agency mirror, new req code). Tool silently warns when the current tab is a duplicate of one already seen. Single purpose only — NOT a userscript-manager, NOT a job-tracker/CRM (manual application-stage tracking is still explicitly rejected, see original reasoning below). UPDATE: a dashboard showing the tool's own passive data (jobs seen, duplicates caught, site trust list) is implemented — see the v1.3 implementation history. This is narrower than the job-tracker concept that was rejected: no manual status/notes/stages, just a fuller view of data the tool already collects. The job-tracker/CRM rejection itself still stands.

## Reference implementation
Original Tampermonkey userscript "SeenDisJob" v2.5 (~500 lines,
full source has been read in full by the assistant). Its logic (extraction,
normalization, fuzzy matching) is the source of truth for that layer and
has already been ported almost verbatim into `content-scripts/matching.js`.

## Architecture (final, in order reasoned through)
1. ~~No permanent "learned site" list — always re-check page content
   live, every load.~~ **SUPERSEDED, see "v1.3 planning" section below.**
   The reasoning here (an auto-learned list is "a way to be wrong") only
   applied to the extension guessing and remembering on its own. A
   user-confirmed yes/no list (only written when the user is actually
   asked, and only for the ambiguous cases that reach that point) is a
  different thing and is implemented in the current workspace.
2. Hardcoded named-domain list (ported from original @match list) kept
   ONLY as a perf shortcut — on these domains, skip the sniffer and inject
   the engine immediately. Never a gate; unlisted sites work fully via the
   sniffer. Implemented in `background.js` as `KNOWN_JOB_HOSTS`.
3. Sniffer + on-demand injection: a tiny content script runs on ~all pages,
   does a plain substring check for `JobPosting` inside any
   `<script type="application/ld+json">` block BEFORE attempting
   `JSON.parse`. On a hit, sends
   `chrome.runtime.sendMessage({ type: 'JOB_PAGE_DETECTED' })` and stops —
   no extraction, no storage, single responsibility. Background worker
   injects the full engine into that tab on demand, tracking "already
   injected" per tab ID to avoid double-injection.
4. Injection API: `chrome.userScripts` (NOT `chrome.scripting.executeScript`) —
   this is the API Chrome built for on-demand userscript-manager-style
   execution. Confirmed against official Chrome docs (Chrome 120+, MV3):
   - Real gotcha, must be documented for the end user, cannot be automated
     away: they must manually flip a toggle before `chrome.userScripts`
     works at all.
   - Chrome < 138: the global "Developer mode" toggle at `chrome://extensions`.
   - Chrome 138+: a separate, per-extension "Allow User Scripts" toggle on the
     extension's own details page — in addition to Developer mode.
   - Detect availability with a try/catch probe (`chrome.userScripts.getScripts()`
     throws if unavailable) rather than assuming a Chrome version.
   - The `USER_SCRIPT` execution world cannot call `chrome.storage` or most
     other extension APIs directly. It can only use messaging.
   - Background.js must own all storage operations and duplicate logic.
5. Storage: `chrome.storage.local` for anything that must survive browser
   restarts; `chrome.storage.session` for tab-ID-keyed data. This is a
   refinement over the earlier “just use storage.local for everything” plan.
6. Duplicate-warning suppression is tab-lineage based, not timer-based.
   If a title+company match belongs to the same tab or a tab opened by that
   tab, never warn. Only warn on a genuinely different, unrelated tab.
7. Timestamp display in the HUD is information only, orthogonal to the
   warn/don't-warn decision.
8. Consent: single one-time prompt at install (`onboarding.html`), asking
   permission to check page content. Not framed as "building a site list."
   Background.js gates injection on the `jds_consent_granted` flag.
9. Fuzzy matching (Jaccard + containment, 60/40 title/company weighting,
   abbreviation expansion, requisition-code stripping, confidential-company
   handling) ports from the original script essentially unchanged.

## Explicitly rejected
- Forking Tampermonkey/Violentmonkey wholesale.
- Forking existing job-tracker extensions.
- A persistent auto-learned site list.
- Timer-based duplicate-warning suppression.
- A general-purpose userscript manager.

## Distribution & licensing
MIT, open source. NOT published to the Chrome Web Store — distributed as
source via "Load unpacked." Explicitly not a commercial product ever.
Attribution matters for portfolio/resume purposes — the project is authored by
Wisdom Ekwugha. GitHub: `https://github.com/UprightCode-hub/SeenDisJob`.
LinkedIn: `https://www.linkedin.com/in/wisdom-ekwugha`.

## Deferred to later
Offline snapshot backup of listing text; CSV/JSON export of seen-jobs list;
`chrome.storage.sync` for cross-device sync; tracking which applications got a
reply. All explicitly parked to avoid drifting toward a broader job-tracker
product.

## Build status
- `content-scripts/matching.js` — complete.
- `manifest.json` — complete.
- `background.js` — complete for current scope.
- `content-scripts/sniffer.js` — complete.
- `content-scripts/engine.js` — complete.
- `onboarding` pages — complete.
- `dashboard` and popup — complete.
- Tests — present for the pure matching logic.

## Notes
This file is intentionally not part of the public-facing product story. The public README is the user-facing entry point; this document exists to preserve implementation context for maintainers and future contributors.
