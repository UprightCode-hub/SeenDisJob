# SeenDisJob

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-red.svg)](LICENSE-APACHE-2.0)

SeenDisJob is a privacy-first Chrome extension for detecting duplicate job postings, reposted jobs, and repeated job listings while searching across job boards, ATS platforms, and company career pages.

It helps job seekers avoid wasting time on the same role shown again under a slightly different title, company name, or reposted posting. The extension runs locally in the browser, records previously seen listings, and warns you only when a current tab appears to match an earlier opportunity.

Built by [Wisdom Ekwugha](https://www.linkedin.com/in/wisdom-ekwugha).

[GitHub repository](https://github.com/UprightCode-hub/SeenDisJob) | [Issues](https://github.com/UprightCode-hub/SeenDisJob/issues) | [Project structure](docs/PROJECT_STRUCTURE.md)

SeenDisJob is free to use. If it has helped make your job search less repetitive, you can optionally [support its development through Flutterwave](https://flutterwave.com/donate/91lbt43tel7n). Support is voluntary and does not unlock features or change how the extension works.

## Current release

The current source release is `1.4`. For unpacked installations, SeenDisJob checks GitHub for a newer manifest version and shows an update link in the popup and dashboard. It does not install updates automatically: download the latest repository source and reload the extension from `chrome://extensions`.

> SeenDisJob is dual-licensed under the MIT License or Apache License 2.0. You may choose either license for use, modification, distribution, or commercial use. See [LICENSE](LICENSE) and [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0).

## Duplicate job postings are a real problem

High-volume job searching often means opening many tabs and revisiting the same role across multiple sites. A job can appear again on LinkedIn, an ATS, a company careers page, an agency mirror, or a reposted listing with minor wording differences.

That creates a frustrating cycle:

- wasted time reviewing the same job twice
- repeated applications to the same position
- difficulty remembering whether a posting was already seen or applied to
- fragmented searches across multiple job boards and company sites
- missed time to focus on genuinely new opportunities

SeenDisJob is built to help with that exact issue: it quietly detects when a job page looks like a duplicate or repost of something you have already encountered.

## What SeenDisJob does

- detects duplicate job postings and reposted job listings across job boards, ATS pages, and company career pages
- normalizes titles and company names before comparing listings
- catches similar roles even when names, wording, abbreviations, or formatting differ
- reduces false positives by ignoring the same tab or the same application flow
- shows a small in-page warning only when a genuinely separate tab appears to match an earlier posting
- tracks recent activity and repeated job listings in a local dashboard
- counts observed application activity separately for LinkedIn Easy Apply and external Advanced Apply flow

## How it works

SeenDisJob uses a simple local detection pipeline:

1. A lightweight content script checks whether a page looks like a job posting.
2. If it appears relevant, the background service injects the full detector for that tab.
3. The extension extracts the job title and company from structured data or page content.
4. It normalizes those values to reduce noise and handle common title abbreviations.
5. It compares the new listing to previously seen postings stored in browser local storage.
6. If the similarity is high enough, the user sees a duplicate or repost warning in the current page.

This stays local to the browser and does not depend on a remote job database or a backend service to decide whether a listing is a duplicate.

## Privacy by design

SeenDisJob is intentionally local-first.

- No user account, no remote job database, and no backend is required for the core duplicate detection workflow.
- Listing data, history, muted entries, and site trust decisions are stored in Chrome local storage.
- The extension asks for consent before checking page content.
- It does not track offers, interviews, messages, or application outcomes.
- It does not require cloud processing to identify repeated or reposted job listings.

This keeps the feature focused on job-search productivity without turning the browser extension into a centralized tracking platform.

## Installation

SeenDisJob is currently distributed as source code and is installed as an unpacked extension in Chromium-based browsers. It is not published to the Chrome Web Store in this repository.

### Prerequisites

- Chrome, Edge, Brave, Vivaldi, or another Chromium-based browser
- a local copy of this repository on your machine
- Developer mode enabled in the browser’s extensions page
- the Chrome User Scripts permission enabled for the extension

### Install from source

#### Option 1: Clone with Git

```bash
git clone https://github.com/UprightCode-hub/SeenDisJob.git
```

#### If the ZIP download is blocked

Some browsers, antivirus tools, or company security policies block ZIP files downloaded from the web. In that case, use Git to copy the repository over HTTPS instead of downloading an archive:

1. Install [Git for Windows](https://git-scm.com/download/win), if Git is not already installed.
2. Open PowerShell.
3. Move to the folder where you want to keep the extension:

```powershell
cd "$HOME\Downloads"
```

4. Clone the repository:

```powershell
git clone https://github.com/UprightCode-hub/SeenDisJob.git
```

5. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the cloned `SeenDisJob` folder.

If Git itself is blocked or you are using a work-managed computer, ask your IT administrator to approve Git for Windows and the SeenDisJob repository. Do not disable antivirus or browser security protections to force the download.

#### Option 2: Download and extract the ZIP

1. Open the [GitHub repository](https://github.com/UprightCode-hub/SeenDisJob).
2. Select Code, then Download ZIP.
3. Extract the archive to a folder on your computer.
4. Make sure the folder contains files such as `manifest.json`, `background.js`, `content-scripts`, `popup`, and `dashboard`.

### Load the extension in Chrome

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select the SeenDisJob folder that contains `manifest.json`.
5. Pin the extension from the puzzle-piece menu if you want faster access to the popup.

### Enable User Scripts

This is required for SeenDisJob to inject its job-page detector.

- On older Chrome versions, Developer mode is typically enough.
- On Chrome 138 and newer, you may also need to open SeenDisJob’s extension details page and enable Allow User Scripts.

The onboarding flow in this project explains the setup and can be reopened if needed.

## How to use it

1. Search for jobs as usual.
2. Open job listings, ATS pages, or company career pages.
3. SeenDisJob monitors the page and records the role if it looks like a new posting.
4. If a new tab appears to match a previously seen listing, a small warning is shown.
5. Open the popup to see the current tab status and recent activity.
6. Open the dashboard to review tracked postings, history, site trust, and application totals.

The popup is intentionally compact for quick status checks. Backup and data-clearing controls are available in the dashboard's Settings section rather than taking space in the toolbar popup.

## Architecture

SeenDisJob is composed of a few clear runtime layers:

- background service worker: manages storage, duplicate decisions, tab lineage, and summary counts
- sniffer content script: runs on many pages and does a cheap “does this look like a job page?” check
- matching engine: normalizes and compares title and company text to reduce duplicate false negatives
- injected page script: extracts job data and renders the in-page warning
- popup and dashboard: show current status, tracked postings, and local history
- onboarding flow: helps the user complete consent and Chrome setup requirements

## Project structure

```text
SeenDisJob/
├── background.js
├── CHANGELOG.md
├── content-scripts/
│   ├── engine.js
│   ├── matching.js
│   └── sniffer.js
├── dashboard/
│   ├── dashboard.html
│   └── dashboard.js
├── docs/
│   ├── PROJECT_STRUCTURE.md
│   └── SEENDISJOB_CONTEXT.md
├── graphify-out/                  Generated codebase knowledge-graph artifacts.
├── icons/
├── LICENSE
├── LICENSE-APACHE-2.0
├── manifest.json
├── onboarding/
│   ├── onboarding.html
│   └── onboarding.js
├── popup/
│   ├── popup.html
│   └── popup.js
├── README.md
├── tests/
│   └── matching.test.js
```

## Use cases

SeenDisJob is useful when you want to:

- detect the same job posted on multiple job boards or ATS sites
- recognize a reposted role with slightly different wording
- avoid re-opening the same opportunity while searching across multiple tabs
- keep a local record of postings you have already seen
- reduce time wasted on duplicate job applications or repeated listings

## Testing

The project includes a dependency-free test for the core matching logic:

```bash
node tests/matching.test.js
```

This checks normalization, abbreviation handling, requisition-code stripping, and similarity behavior without requiring a full Chrome runtime.

Live browser behavior still needs real Chrome testing because the extension depends on the User Scripts permission and Chromium-specific APIs.

## Frequently asked questions

### How can I detect duplicate job postings?

Use SeenDisJob while browsing job listings. The extension compares the current job page to previously seen postings and warns when it looks like a duplicate or repost.

### How can I tell if a job has been reposted?

If a job page appears similar to one you already saw, SeenDisJob surfaces a warning and records the match locally so you can decide whether it is the same role showing up again.

### Is there a Chrome extension for detecting duplicate jobs?

Yes — SeenDisJob is a Chrome extension built for this use case. It is currently source-only and installed as an unpacked extension rather than from the Chrome Web Store.

### How can I avoid seeing the same job listing repeatedly?

SeenDisJob helps by remembering which jobs you have already encountered and alerting you when a new tab appears to match an earlier listing.

## Contributing

Contributions are welcome if they improve compatibility, detection quality, or the user experience without expanding the project beyond its current scope.

Ways to contribute:

- report an issue on a job site or ATS page
- improve the matching logic for real-world job listings
- suggest a clearer privacy or setup flow
- improve the dashboard or popup experience
- add test coverage for edge cases

Open an issue or submit a pull request in the repository.

## Roadmap and limitations

This project is intentionally focused on a single problem: duplicate and reposted job detection.

Known limitations in the current implementation:

- live behavior depends on Chrome permissions such as User Scripts
- LinkedIn and other pages can change structure over time
- some third-party application popups may not expose enough tab lineage to distinguish them from ordinary child links
- the tool tracks observed application volume; it does not manage manual job-tracking stages or outcomes
- CSV or Excel export is not part of the current codebase

## Star this project

If SeenDisJob is useful to your workflow, consider giving the repository a star. It helps more people discover the project, supports continued development, and makes it easier for other job seekers to find a tool for duplicate job postings and reposted jobs.

You are not required to star the project, and there is no obligation to do so. It is simply a way to support the work if it helps you in your job search.

## External links

- [GitHub repository](https://github.com/UprightCode-hub/SeenDisJob)
- [Issues](https://github.com/UprightCode-hub/SeenDisJob/issues)
- [Wisdom Ekwugha on LinkedIn](https://www.linkedin.com/in/wisdom-ekwugha)
- [Support SeenDisJob through Flutterwave](https://flutterwave.com/donate/91lbt43tel7n)
- [Project structure](docs/PROJECT_STRUCTURE.md)
- [Change log](CHANGELOG.md)

## License

SeenDisJob is dual-licensed under the MIT License and the Apache License 2.0. Choose the license that fits your use:

- [MIT](LICENSE)
- [Apache License 2.0](LICENSE-APACHE-2.0)

