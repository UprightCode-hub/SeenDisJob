# Changelog

## 1.4 - Update-aware source release

### Changed

- Refined the GitHub-backed update check for unpacked installations.
- Popup and dashboard now link users to the repository when a newer version is available.
- Kept update checks informational and local: the extension never downloads or installs code automatically.
- Refined the compact popup hierarchy and moved backup/clear-data controls to dashboard Settings.
- Added an optional Flutterwave support link.

### Upgrade note

After downloading the updated source, reload SeenDisJob from `chrome://extensions` using **Load unpacked** or the extension's reload button. Chrome Web Store-style automatic updates are not available for this source installation.

## 1.3 - Release candidate

### Added

- Cross-site duplicate detection across job boards, ATS platforms, and custom career pages.
- Fuzzy title and company matching with abbreviation expansion and requisition-code handling.
- Tab-lineage awareness to reduce false duplicate warnings during application flows.
- LinkedIn Easy Apply confirmation tracking.
- Advanced Apply tracking for external application pages, including same-tab handoffs and child tabs.
- Popup status, recent activity, and compact dashboard navigation.
- Backup and clear-data actions in dashboard Settings.
- Dashboard views for overview totals, applications, activity, postings, site trust, and settings.
- First-launch onboarding with consent, User Scripts setup, and a product usage guide.
- In-extension update notifications sourced from the GitHub repository.
- Dependency-free tests for the pure matching logic.

### Known limitations

- Live behavior depends on Chrome's `chrome.userScripts` permission and must be verified in a real unpacked installation.
- LinkedIn's page markup can change without notice.
- Some third-party Apply popups cannot be distinguished from ordinary child links.
- CSV/Excel export is planned for a future release.
