/**
 * FILE: popup/popup.js
 * v1.3 — adds: history panel, empty state, muted-count sub-label, and
 * dashboard navigation.
 * Talks to background.js over chrome.runtime.sendMessage (normal
 * extension page — full chrome.* access, no USER_SCRIPT restrictions).
 *
 * Unchanged by the v1.4 visual redesign (popup.html). Every ID and the
 * two dynamic class contracts this file relies on — statusCard's
 * 'ok'/'alert' classes and the hist-dot 'ok'/'alert'/'muted' classes it
 * generates — are preserved in the new markup, so no logic here needed
 * to change.
 */

const MSG_GET_STATUS   = 'GET_STATUS';

const headerSub     = document.getElementById('header-sub');
const consentBanner = document.getElementById('consent-banner');
const statusCard    = document.getElementById('status-card');
const statusTitle   = document.getElementById('status-title');
const statusDetail  = document.getElementById('status-detail');
const recordCountEl = document.getElementById('record-count');
const mutedNoteEl   = document.getElementById('muted-note');
const emptyState    = document.getElementById('empty-state');
const historyPanel  = document.getElementById('history-panel');
const historyList   = document.getElementById('history-list');
/* ── Helpers ──────────────────────────────────────────────────────── */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatTimestamp(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

/* ── Consent banner ───────────────────────────────────────────────── */
function renderConsent(consent) {
  if (consent === true) { consentBanner.style.display = 'none'; return; }
  consentBanner.style.display = 'block';
  if (consent === false) {
    consentBanner.innerHTML =
      'Content checks are turned off. ' +
      '<a href="../onboarding/onboarding.html" target="_blank">Reopen setup</a>' +
      ' to turn them back on.';
  } else {
    consentBanner.innerHTML =
      'Setup was never finished. ' +
      '<a href="../onboarding/onboarding.html" target="_blank">Open setup</a>' +
      ' to get started.';
  }
}

/* ── Update banner ────────────────────────────────────────────────── */
// status comes from response.updateStatus in the GET_STATUS reply —
// background.js's checkForUpdate() throttles the actual network check
// internally, so this just renders whatever it was last told, harmless
// to call on every popup open.
function renderUpdateBanner(status) {
  const banner = document.getElementById('update-banner');
  if (!status || !status.updateAvailable) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'block';
  const text = status.remoteVersion
    ? `SeenDisJob ${escapeHtml(status.remoteVersion)} is available.`
    : 'A newer version of SeenDisJob is available.';
  banner.innerHTML = `${text} <a href="${escapeHtml(status.repoUrl)}" target="_blank" rel="noopener">View on GitHub</a>`;
}

/* ── Current-tab status card ──────────────────────────────────────── */
function renderStatus(tabState, consent) {
  statusCard.classList.remove('ok', 'alert');
  const details = tabState.details || {};

  if (consent !== true) {
    statusTitle.textContent = 'Inactive';
    statusDetail.textContent = "Won't watch any page until setup is finished.";
    return;
  }

  switch (tabState.state) {
    case 'watching':
      statusTitle.textContent = 'Watching this page';
      statusDetail.textContent = 'Scanning for a job title and company…';
      break;
    case 'recorded':
      statusCard.classList.add('ok');
      statusTitle.textContent = 'Recorded';
      statusDetail.innerHTML = details.title
        ? `Tracked <b>${escapeHtml(details.title)}</b>${details.company ? ` at <b>${escapeHtml(details.company)}</b>` : ''} as a new listing.`
        : 'Tracked as a new listing.';
      break;
    case 'duplicate':
      statusCard.classList.add('alert');
      statusTitle.textContent = 'You\'ve seen this listing';
      statusDetail.innerHTML = details.matchTitle
        ? `Matches <b>${escapeHtml(details.matchTitle)}</b>${details.matchCompany ? ` at <b>${escapeHtml(details.matchCompany)}</b>` : ''}, first seen ${escapeHtml(formatTimestamp(details.timestamp))}.`
        : 'Matches an earlier listing.';
      break;
    default:
      statusTitle.textContent = 'Not watching this page';
      statusDetail.textContent = "This page didn't look like a job posting URL.";
  }
}

/* ── History panel ────────────────────────────────────────────────── */
const HIST_TYPE_META = {
  recorded: { dotClass: 'ok',    label: 'Tracked'  },
  duplicate: { dotClass: 'alert', label: 'Flagged'  },
  muted:    { dotClass: 'muted', label: 'Muted'    }
};

function renderHistory(history) {
  if (!history || history.length === 0) {
    historyPanel.style.display = 'none';
    return;
  }
  historyPanel.style.display = 'block';
  historyList.innerHTML = history.map(entry => {
    const meta    = HIST_TYPE_META[entry.type] || HIST_TYPE_META.recorded;
    const title   = entry.title   || 'Unknown listing';
    const company = entry.company || '';
    let detail = '';
    if (entry.type === 'duplicate' && entry.matchTitle) {
      detail = `Matched <em>${escapeHtml(entry.matchTitle)}</em>` +
        (entry.matchCompany ? ` at <em>${escapeHtml(entry.matchCompany)}</em>` : '');
    } else if (entry.type === 'muted') {
      detail = 'Ignored — won\'t warn again';
    } else if (company) {
      detail = escapeHtml(company);
    }
    return `
      <div class="hist-item">
        <div class="hist-dot ${meta.dotClass}"></div>
        <div class="hist-body">
          <div class="hist-label" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          ${detail ? `<div class="hist-detail">${detail}</div>` : ''}
          <div class="hist-time">${meta.label} · ${escapeHtml(formatTimestamp(entry.timestamp))}</div>
        </div>
      </div>`;
  }).join('');
}

/* ── Main refresh ─────────────────────────────────────────────────── */
async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;

  chrome.runtime.sendMessage({ type: MSG_GET_STATUS, tabId }, (response) => {
    if (!response) {
      headerSub.textContent = 'Could not reach the background service.';
      return;
    }

    headerSub.textContent = response.consent === true ? 'Active' : 'Setup needed';

    renderConsent(response.consent);
    renderUpdateBanner(response.updateStatus);
    renderStatus(response.tabState, response.consent);

    // Stat row
    const count = response.recordCount ?? 0;
    recordCountEl.textContent = count;

    // Empty state
    if (count === 0 && response.consent === true) {
      emptyState.style.display = 'block';
    } else {
      emptyState.style.display = 'none';
    }

    // Muted sub-label
    const muted = response.mutedCount ?? 0;
    if (muted > 0) {
      mutedNoteEl.textContent = `${muted} ignored`;
      mutedNoteEl.style.display = 'block';
    } else {
      mutedNoteEl.style.display = 'none';
    }

    renderHistory(response.history);
  });
}

document.getElementById('btn-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

refresh();