const MSG_GET_DASHBOARD_DATA  = 'GET_DASHBOARD_DATA';
const MSG_SET_ASK_ABOUT_SITES = 'SET_ASK_ABOUT_SITES';
const MSG_SET_SITE_TRUST      = 'SET_SITE_TRUST';
const MSG_CLEAR_RECORDS       = 'CLEAR_RECORDS';
const MSG_GET_BACKUP          = 'GET_BACKUP';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function formatDateShort(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

let dashboardData = null;
let postingsSort = { key: 'timestamp', dir: 'desc' };
let refreshInFlight = false;
const TAB_IDS = ['overview', 'applications', 'activity', 'postings', 'trust', 'settings'];

function activateTab(name) {
  TAB_IDS.forEach(id => {
    const tabBtn = document.getElementById(`tab-${id}`);
    const panel = document.getElementById(`panel-${id}`);
    const active = id === name;
    tabBtn.setAttribute('aria-selected', active ? 'true' : 'false');
    panel.hidden = !active;
  });
}

TAB_IDS.forEach(id => {
  document.getElementById(`tab-${id}`).addEventListener('click', () => activateTab(id));
});

function renderConsent(consent) {
  const banner = document.getElementById('consent-banner');
  if (consent === true) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'block';
  banner.innerHTML = consent === false
    ? 'Content checks are turned off. <a href="../onboarding/onboarding.html" target="_blank">Reopen setup</a> to turn them back on.'
    : 'Setup was never finished. <a href="../onboarding/onboarding.html" target="_blank">Open setup</a> to get started.';
}

// status comes from response.updateStatus in the GET_DASHBOARD_DATA
// reply — background.js's checkForUpdate() throttles the actual network
// check internally, so this just renders whatever it was last told.
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
  banner.innerHTML = `${text} <a href="${escapeHtml(status.repoUrl)}" target="_blank" rel="noopener">Update on GitHub</a>`;
}

function renderOverview(data) {
  const stats = data.stats || { seen: 0, duplicates: 0 };
  document.getElementById('stat-seen').textContent = stats.seen;
  document.getElementById('stat-duplicates').textContent = stats.duplicates;
  document.getElementById('stat-muted').textContent = data.mutedCount;
  const liveCount = Object.keys(data.records || {}).length;
  document.getElementById('stat-footnote').textContent =
    `${liveCount} of those are still inside the 60-day tracking window right now — older ones age out automatically.`;
}

function formatDateKey(dateKey) {
  if (!dateKey) return '—';
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

function renderApplicationPeriod(prefix, period) {
  const easy = period?.easy || 0;
  const advanced = period?.advanced || 0;
  document.getElementById(`app-total-${prefix}`).textContent = easy + advanced;
  document.getElementById(`app-breakdown-${prefix}`).innerHTML =
    `<span class="easy-num">${easy}</span> Easy Apply` +
    `<span class="dot">·</span>` +
    `<span class="adv-num">${advanced}</span> Advanced Apply`;
}

function renderApplications(data) {
  const applications = data.applications || {};
  const totals = applications.totals || {};
  const empty = { easy: 0, advanced: 0 };
  renderApplicationPeriod('day', totals.day || empty);
  renderApplicationPeriod('week', totals.week || empty);
  renderApplicationPeriod('month', totals.month || empty);
  renderApplicationPeriod('lifetime', totals.lifetime || empty);

  const mostActiveDay = applications.mostActiveDay;
  document.getElementById('app-most-active-day').innerHTML = mostActiveDay
    ? `${escapeHtml(formatDateKey(mostActiveDay.date))}<span class="sub">${mostActiveDay.total} application${mostActiveDay.total === 1 ? '' : 's'}</span>`
    : 'Not enough data yet';

  const mostVisitedPlatform = applications.mostVisitedPlatform;
  document.getElementById('app-most-visited-platform').innerHTML = mostVisitedPlatform
    ? `${escapeHtml(mostVisitedPlatform.host)}<span class="sub">${mostVisitedPlatform.count} visit${mostVisitedPlatform.count === 1 ? '' : 's'}</span>`
    : 'Not enough data yet';
}

const ACTIVITY_META = {
  recorded: { dotClass: 'ok', label: 'Tracked' },
  duplicate: { dotClass: 'alert', label: 'Flagged' },
  muted: { dotClass: 'muted', label: 'Muted' }
};

function renderActivity(data) {
  const card = document.getElementById('activity-card');
  const history = data.history || [];
  if (history.length === 0) {
    card.innerHTML = '<div class="empty-state">No activity yet.</div>';
    return;
  }
  card.innerHTML = history.map(entry => {
    const meta = ACTIVITY_META[entry.type] || ACTIVITY_META.recorded;
    const title = entry.title || 'Unknown listing';
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
    return `<div class="activity-item"><div class="act-dot ${meta.dotClass}" aria-hidden="true"></div><div class="act-body"><div class="act-title">${escapeHtml(title)}</div>${detail ? `<div class="act-detail">${detail}</div>` : ''}<div class="act-time">${meta.label} · ${escapeHtml(formatTimestamp(entry.timestamp))}</div></div></div>`;
  }).join('');
}

function recordsToArray(records) {
  return Object.entries(records || {}).map(([id, record]) => ({ id, ...record }));
}

function sortPostings(list) {
  const { key, dir } = postingsSort;
  const multiplier = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    let av = a[key], bv = b[key];
    if (key === 'timestamp') {
      av = av || 0;
      bv = bv || 0;
    } else {
      av = (av || '').toLowerCase();
      bv = (bv || '').toLowerCase();
    }
    if (av < bv) return -1 * multiplier;
    if (av > bv) return 1 * multiplier;
    return 0;
  });
}

function renderPostings() {
  if (!dashboardData) return;
  const card = document.getElementById('postings-card');
  const countEl = document.getElementById('postings-count');
  const query = document.getElementById('postings-search').value.trim().toLowerCase();
  let list = recordsToArray(dashboardData.records);
  if (query) {
    list = list.filter(record =>
      (record.title || '').toLowerCase().includes(query) ||
      (record.company || '').toLowerCase().includes(query));
  }
  countEl.textContent = `${list.length} of ${Object.keys(dashboardData.records || {}).length}`;
  if (list.length === 0) {
    card.innerHTML = '<div class="empty-state">No tracked postings match.</div>';
    return;
  }
  list = sortPostings(list);
  const arrow = key => postingsSort.key === key ? (postingsSort.dir === 'asc' ? '▲' : '▼') : '';
  card.innerHTML = `<table><thead><tr><th data-key="title">Title <span class="sort-arrow">${arrow('title')}</span></th><th data-key="company">Company <span class="sort-arrow">${arrow('company')}</span></th><th data-key="timestamp">First seen <span class="sort-arrow">${arrow('timestamp')}</span></th></tr></thead><tbody>${list.map(record => `<tr><td class="title-cell">${record.url ? `<a class="src-link" href="${escapeHtml(record.url)}" target="_blank" rel="noopener">${escapeHtml(record.title || 'Untitled')}</a>` : escapeHtml(record.title || 'Untitled')}</td><td class="company-cell">${escapeHtml(record.company || '—')}</td><td class="date-cell">${escapeHtml(formatDateShort(record.timestamp))}</td></tr>`).join('')}</tbody></table>`;
  card.querySelectorAll('thead th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      postingsSort = postingsSort.key === key
        ? { key, dir: postingsSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'timestamp' ? 'desc' : 'asc' };
      renderPostings();
    });
  });
}

document.getElementById('postings-search').addEventListener('input', renderPostings);

function renderTrust(data) {
  const card = document.getElementById('trust-card');
  const entries = Object.entries(data.siteTrust || {});
  if (entries.length === 0) {
    card.innerHTML = '<div class="empty-state">No sites asked about yet.</div>';
    return;
  }
  card.innerHTML = entries.map(([hostname, trusted]) => `<div class="trust-row" data-hostname="${escapeHtml(hostname)}"><div class="trust-host">${escapeHtml(hostname)}</div><span class="pill ${trusted ? 'yes' : 'no'}">${trusted ? 'Watching' : 'Not watching'}</span><button class="btn-flip" data-trusted="${trusted ? 'false' : 'true'}">${trusted ? 'Turn off' : 'Turn on'}</button></div>`).join('');
  card.querySelectorAll('.btn-flip').forEach(button => {
    button.addEventListener('click', () => {
      const row = button.closest('.trust-row');
      button.disabled = true;
      chrome.runtime.sendMessage({
        type: MSG_SET_SITE_TRUST,
        hostname: row.dataset.hostname,
        trusted: button.dataset.trusted === 'true'
      }, response => {
        if (chrome.runtime.lastError || !response?.ok) {
          button.disabled = false;
          document.getElementById('settings-feedback').textContent = 'Could not update that site. Try again.';
          return;
        }
        loadDashboard();
      });
    });
  });
}

function renderSettings(data) {
  const askSitesToggle = document.getElementById('toggle-ask-sites');
  const askSitesLabel = askSitesToggle.closest('.settings-row')?.querySelector('.settings-label');
  if (askSitesLabel && !askSitesLabel.id) askSitesLabel.id = 'ask-sites-label';
  if (askSitesLabel) askSitesToggle.setAttribute('aria-labelledby', askSitesLabel.id);
  askSitesToggle.checked = data.askAboutSites;
}

document.getElementById('toggle-ask-sites').addEventListener('change', event => {
  const toggle = event.target;
  const previousValue = !toggle.checked;
  chrome.runtime.sendMessage({ type: MSG_SET_ASK_ABOUT_SITES, enabled: toggle.checked }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      toggle.checked = previousValue;
      document.getElementById('settings-feedback').textContent = 'Could not save that setting. Try again.';
    }
  });
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear all tracked job postings, activity history, muted listings, application totals, and platform visit totals? This cannot be undone.')) return;
  chrome.runtime.sendMessage({ type: MSG_CLEAR_RECORDS }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      document.getElementById('settings-feedback').textContent = 'Could not clear the tracked data. Try again.';
      return;
    }
    document.getElementById('settings-feedback').textContent = 'Cleared.';
    loadDashboard();
  });
});

document.getElementById('btn-backup').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MSG_GET_BACKUP }, async response => {
    const feedback = document.getElementById('settings-feedback');
    if (chrome.runtime.lastError || !response) {
      feedback.textContent = 'Could not create a backup. Try again.';
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(response?.records ?? {}, null, 2));
      feedback.textContent = 'Backup JSON copied to clipboard.';
    } catch (error) {
      feedback.textContent = 'Could not access the clipboard.';
      console.warn('[SeenDisJob] clipboard write failed:', error);
    }
  });
});

// Privacy & permissions — reopen the setup/onboarding guide as its own
// tab. Dashboard is a normal extension page (same messaging/permissions
// tier as popup.js/onboarding.js), so chrome.tabs is available directly.
document.getElementById('btn-reopen-setup').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') }).catch(error => {
    document.getElementById('settings-feedback').textContent = 'Could not open the setup guide.';
    console.warn('[SeenDisJob] could not open setup guide:', error);
  });
});

// Privacy & permissions — on-demand probe of chrome.userScripts, same
// try/catch approach onboarding.js's probeUserScriptsEnabled() uses
// (getScripts() throws if the "Allow User Scripts" toggle is still off).
document.getElementById('btn-check-permission').addEventListener('click', async () => {
  const result = document.getElementById('check-permission-result');
  result.className = 'check-result';
  result.textContent = 'Checking…';
  try {
    await chrome.userScripts.getScripts();
    result.className = 'check-result ok';
    result.textContent = "User Scripts permission is enabled — SeenDisJob's detector can run.";
  } catch (err) {
    console.debug('[SeenDisJob] userScripts check failed:', err);
    result.className = 'check-result no';
    result.textContent = 'User Scripts permission is not enabled yet. Use "Reopen setup guide" for the steps.';
  }
});

// About — version is read from the extension's own manifest rather than
// hardcoded, so this line never drifts from manifest.json's "version".
// Pure presentation: does not touch storage, detection, or counting.
function renderAbout() {
  const versionEl = document.getElementById('about-version');
  if (!versionEl) return;
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = manifest.version;
}

function loadDashboard() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  chrome.runtime.sendMessage({ type: MSG_GET_DASHBOARD_DATA }, response => {
    refreshInFlight = false;
    if (chrome.runtime.lastError || !response) {
      document.getElementById('refresh-status').textContent = 'Could not refresh';
      return;
    }
    dashboardData = response;
    renderConsent(response.consent);
    renderUpdateBanner(response.updateStatus);
    renderOverview(response);
    renderApplications(response);
    renderActivity(response);
    renderPostings();
    renderTrust(response);
    renderSettings(response);
    document.getElementById('refresh-status').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  });
}

document.getElementById('btn-refresh').addEventListener('click', loadDashboard);
setInterval(() => {
  if (!document.hidden) loadDashboard();
}, 5000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadDashboard();
});

renderAbout();
loadDashboard();