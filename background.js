importScripts('content-scripts/matching.js');

const MSG_JOB_PAGE_DETECTED = 'JOB_PAGE_DETECTED';
const MSG_CHECK_JOB = 'CHECK_JOB';
const MSG_APPLY_INTENT = 'APPLY_INTENT';
const MSG_CLOSE_TAB = 'CLOSE_TAB';
const MSG_MUTE_MATCH = 'MUTE_MATCH';
const MSG_SET_SITE_TRUST = 'SET_SITE_TRUST'; // v1.3 — engine.js's tier-3 confirm popup answer
const MSG_GET_STATUS = 'GET_STATUS';
const MSG_CLEAR_RECORDS = 'CLEAR_RECORDS';
const MSG_GET_BACKUP = 'GET_BACKUP';
const MSG_GET_DASHBOARD_DATA = 'GET_DASHBOARD_DATA';   // v1.3 — dashboard page
const MSG_SET_ASK_ABOUT_SITES = 'SET_ASK_ABOUT_SITES'; // v1.3 — dashboard settings toggle
const MSG_APPLY_CONFIRMED = 'APPLY_CONFIRMED';         // v1.3 — engine.js reports a completed LinkedIn Easy Apply

const ENGINE_SCRIPT_FILES = [
  { file: 'content-scripts/matching.js' },
  { file: 'content-scripts/engine.js' }
];

const CONSENT_KEY = 'jds_consent_granted';     // storage.local
const RECORDS_KEY = 'jds_records_v1';          // storage.local
const MUTED_IDS_KEY = 'jds_muted_ids';         // storage.local
const HISTORY_KEY = 'jds_history';             // storage.local
const SITE_TRUST_KEY = 'jds_site_trust';       // storage.local — { hostname: true|false }, written only after a tier-3 confirm
const ASK_ABOUT_SITES_KEY = 'jds_ask_about_sites'; // storage.local — boolean, default true
const STATS_KEY = 'jds_stats_lifetime';        // storage.local — { seen, duplicates } — see note below
const APP_DAILY_KEY = 'jds_app_daily';         // storage.local — { "YYYY-MM-DD": { easy, advanced } }, see note below
const APP_PLATFORM_KEY = 'jds_app_platforms';  // storage.local — { hostname: count }, lifetime
const APPLICATION_HUB_HOSTS = new Set(['jobright.ai']); // hubs, not application source platforms
const INJECTED_TABS_KEY = 'jds_injected_tabs'; // storage.session
const OPENER_MAP_KEY = 'jds_tab_openers';      // storage.session
const TAB_STATE_KEY = 'jds_tab_state';         // storage.session — powers badge + popup
const PENDING_APPS_KEY = 'jds_pending_apps';   // storage.session — tabId -> { host }, see note below
const APPLICATION_FLOW_TABS_KEY = 'jds_application_flow_tabs'; // storage.session — tabs opened/navigated by an explicit Apply action

const RECORD_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const MAX_OPENER_CHAIN_HOPS = 20; // guard against any cyclical/bad data
const MAX_HISTORY_ENTRIES = 20;   // popup only ever shows the last few of these
const PENDING_APPLY_TTL_MS = 2 * 60 * 60 * 1000;

// Named ATS/job-board domains from the original userscript's @match list.
// Perf shortcut only (decision #2) — never a gate.
const KNOWN_JOB_HOSTS = [
  'caaclubgroup.ca',
  'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'workday.com',
  'jobright.ai', 'linkedin.com', 'indeed.com', 'glassdoor.com',
  'smartrecruiters.com', 'icims.com', 'ashbyhq.com', 'bamboohr.com',
  'workable.com', 'breezy.hr', 'jazz.co', 'jazzhr.com', 'applytojob.com',
  'jobvite.com', 'jobdiva.com', 'recruitee.com', 'personio.com',
  'personio.de', 'taleo.net', 'successfactors.com', 'avature.net',
  'oraclecloud.com', 'paylocity.com', 'paycomonline.net', 'ripplematch.com',
  'wellfound.com', 'angel.co', 'ziprecruiter.com', 'monster.com',
  'careerbuilder.com', 'dice.com', 'simplyhired.com', 'careers.google.com',
  'metacareers.com', 'amazon.jobs', 'csod.com', 'mydayforce.com', 'ukg.com',
  'jobs.gc.ca', 'jobbank.gc.ca', 'gojobs.gov.on.ca'
];

function isKnownJobHost(url) {
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }
  if (isApplicationHubHost(hostname)) return false;
  return KNOWN_JOB_HOSTS.some(host => hostname === host || hostname.endsWith('.' + host));
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

// v1.3 — tier-3 site trust list. Only ever written when a confirm popup
// was actually shown and actually answered (not auto-learned).
async function getSiteTrust() {
  const { [SITE_TRUST_KEY]: map } = await chrome.storage.local.get(SITE_TRUST_KEY);
  return map || {};
}

async function setSiteTrust(hostname, trusted) {
  const map = await getSiteTrust();
  map[hostname] = trusted;
  await chrome.storage.local.set({ [SITE_TRUST_KEY]: map });
}

// Default true — only an explicit `false` (user turned it off) disables asking.
async function getAskAboutSites() {
  const { [ASK_ABOUT_SITES_KEY]: enabled } = await chrome.storage.local.get(ASK_ABOUT_SITES_KEY);
  return enabled !== false;
}

/* ---------------------------------------------------------------------
 * Storage helpers
 * ------------------------------------------------------------------- */
async function hasConsent() {
  const { [CONSENT_KEY]: granted } = await chrome.storage.local.get(CONSENT_KEY);
  return granted; // true | false | undefined (never asked yet)
}

async function getInjectedTabs() {
  const { [INJECTED_TABS_KEY]: map } = await chrome.storage.session.get(INJECTED_TABS_KEY);
  return map || {};
}

async function clearInjectedFlag(tabId) {
  const map = await getInjectedTabs();
  if (!(tabId in map)) return;
  delete map[tabId];
  await chrome.storage.session.set({ [INJECTED_TABS_KEY]: map });
}

async function getOpenerMap() {
  const { [OPENER_MAP_KEY]: map } = await chrome.storage.session.get(OPENER_MAP_KEY);
  return map || {};
}

async function recordOpener(tabId, openerTabId) {
  const map = await getOpenerMap();
  map[tabId] = openerTabId;
  await chrome.storage.session.set({ [OPENER_MAP_KEY]: map });
}

async function clearOpenerEntry(tabId) {
  const map = await getOpenerMap();
  if (!(tabId in map)) return;
  delete map[tabId];
  await chrome.storage.session.set({ [OPENER_MAP_KEY]: map });
}

/* ---------------------------------------------------------------------
 * Per-tab visible status: badge + what the popup shows.
 * States: 'idle' (nothing to show) | 'watching' (page matched, scanning —
 * tracked for the popup, but intentionally NOT badged, see v1.2.0 note
 * above) | 'recorded' (new job, tracked) | 'duplicate' (matched an
 * earlier one). Purely presentational — never affects duplicate logic.
 * ------------------------------------------------------------------- */
const BADGE_STYLE = {
  idle:      { text: '', color: '#8A8D93' },
  watching:  { text: '', color: '#8A8D93' }, // deliberately no badge — see v1.2.0 note
  recorded:  { text: '\u2713', color: '#1E8E3E' }, // check mark: "tracked as new"
  duplicate: { text: '!', color: '#B8860B' }       // amber-ish, calmer than alarm-red — matches the toned-down HUD
};

async function getTabStates() {
  const { [TAB_STATE_KEY]: map } = await chrome.storage.session.get(TAB_STATE_KEY);
  return map || {};
}

async function setTabState(tabId, state, details) {
  if (typeof tabId !== 'number') return;
  const map = await getTabStates();
  map[tabId] = { state, details: details || null, updatedAt: Date.now() };
  await chrome.storage.session.set({ [TAB_STATE_KEY]: map });

  const style = BADGE_STYLE[state] || BADGE_STYLE.idle;
  try {
    await chrome.action.setBadgeText({ tabId, text: style.text });
    if (style.text) await chrome.action.setBadgeBackgroundColor({ tabId, color: style.color });
  } catch (err) {
    // Tab likely closed mid-update — harmless.
  }
}

async function clearTabState(tabId) {
  const map = await getTabStates();
  if (tabId in map) {
    delete map[tabId];
    await chrome.storage.session.set({ [TAB_STATE_KEY]: map });
  }
  try { await chrome.action.setBadgeText({ tabId, text: '' }); } catch (err) { /* closed */ }
}

/* ---------------------------------------------------------------------
 * Recent-activity history — capped log for the popup's "last few events"
 * view. Independent of the job records themselves (which only ever hold
 * the CURRENT state of a listing) so a duplicate you already closed the
 * tab on is still visible afterward.
 * ------------------------------------------------------------------- */
async function getHistory() {
  const { [HISTORY_KEY]: list } = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(list) ? list : [];
}

async function appendHistory(entry) {
  const list = await getHistory();
  list.unshift({ ...entry, timestamp: Date.now() });
  if (list.length > MAX_HISTORY_ENTRIES) list.length = MAX_HISTORY_ENTRIES;
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
}

/* ---------------------------------------------------------------------
 * Muted listings — "don't warn me about this one again", keyed by the
 * same id a job record uses (normalized company+title). Stored
 * separately from RECORDS_KEY so muting survives the record itself
 * being overwritten by a later re-visit to the same normalized listing.
 * ------------------------------------------------------------------- */
async function getMutedIds() {
  const { [MUTED_IDS_KEY]: map } = await chrome.storage.local.get(MUTED_IDS_KEY);
  return map || {};
}

async function muteId(id) {
  if (!id) return;
  const map = await getMutedIds();
  map[id] = true;
  await chrome.storage.local.set({ [MUTED_IDS_KEY]: map });
}

/* ---------------------------------------------------------------------
 * Lifetime stats — v1.3 dashboard "Overview" needs a genuine running
 * total for "job postings seen" / "duplicates caught". Neither RECORDS_KEY
 * nor HISTORY_KEY can honestly answer that:
 *   - records are pruned by RECORD_TTL_MS (60 days), so their count is
 *     "currently tracked in the live window", not a lifetime total.
 *   - history is capped at MAX_HISTORY_ENTRIES (20) and mixes recorded/
 *     duplicate/muted events together, so counting 'duplicate' entries in
 *     it undercounts as soon as more than ~20 events of any kind happen.
 * This is a small, separate, monotonically-increasing counter instead.
 * Reset alongside everything else on "Clear all tracked job data" so the
 * dashboard doesn't show a stale total after a user-initiated wipe.
 * ------------------------------------------------------------------- */
async function getStats() {
  const { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
  return stats || { seen: 0, duplicates: 0 };
}

async function bumpStat(field) {
  const stats = await getStats();
  stats[field] = (stats[field] || 0) + 1;
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

/* ---------------------------------------------------------------------
 * Application-count tracking — v1.3 (background/storage half only; the
 * in-page Easy Apply detection this depends on is engine.js's job, not
 * yet built — see CONTEXT.md's "v1.3 — application-count tracking"
 * section for the full decision).
 *
 * Storage shape is a daily map, not a raw event log — { "YYYY-MM-DD":
 * { easy, advanced } }, one small entry per calendar day, forever. Day/
 * week/month/lifetime totals are all just filters/sums over this map's
 * keys against "today", computed on read — this is what makes the
 * calendar resets automatic (per the user's "it strictly works with
 * time" requirement) without needing chrome.alarms or any scheduled
 * reset job, which a non-persistent service worker can't reliably run
 * anyway. A raw per-application log was considered and rejected here —
 * it grows unboundedly and this extension has no unlimitedStorage
 * permission, whereas one entry/day is a few KB even after years of use.
 * Most-visited-platform is a separate small lifetime map, same reasoning.
 * ------------------------------------------------------------------- */
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getAppDaily() {
  const { [APP_DAILY_KEY]: map } = await chrome.storage.local.get(APP_DAILY_KEY);
  return map || {};
}

async function getAppPlatforms() {
  const { [APP_PLATFORM_KEY]: map } = await chrome.storage.local.get(APP_PLATFORM_KEY);
  const platforms = Object.fromEntries(Object.entries(map || {}).filter(([host]) => !isApplicationHubHost(host)));
  if (Object.keys(platforms).length !== Object.keys(map || {}).length) {
    await chrome.storage.local.set({ [APP_PLATFORM_KEY]: platforms });
  }
  return platforms;
}

function isApplicationHubHost(host) {
  return APPLICATION_HUB_HOSTS.has(host) ||
    Array.from(APPLICATION_HUB_HOSTS).some(hub => host.endsWith('.' + hub));
}

// type is 'easy' | 'advanced'. host is whatever hostnameOf(payload.url)
// returned when the posting was first seen — may be null on a malformed
// URL, in which case the platform stat just skips that one entry.
async function recordApplication(type, host) {
  const daily = await getAppDaily();
  const key = localDateKey(new Date());
  const entry = daily[key] || { easy: 0, advanced: 0 };
  entry[type] = (entry[type] || 0) + 1;
  daily[key] = entry;
  await chrome.storage.local.set({ [APP_DAILY_KEY]: daily });

  if (host && !isApplicationHubHost(host)) {
    const platforms = await getAppPlatforms();
    platforms[host] = (platforms[host] || 0) + 1;
    await chrome.storage.local.set({ [APP_PLATFORM_KEY]: platforms });
  }
}

// Sunday-start week boundary, per the user's decision (not Monday-start).
function weekStartKey(today) {
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay()); // getDay(): 0 = Sunday
  return localDateKey(start);
}

function monthPrefix(today) {
  return localDateKey(today).slice(0, 7); // "YYYY-MM"
}

// Everything the dashboard needs for the application stats: day/week/
// month/lifetime totals (easy + advanced broken out), the single most-
// active calendar day so far, and the most-visited platform so far.
async function getApplicationStats() {
  const [daily, platforms] = await Promise.all([getAppDaily(), getAppPlatforms()]);
  const today = new Date();
  const todayKey = localDateKey(today);
  const weekStart = weekStartKey(today);
  const monthPfx = monthPrefix(today);

  const totals = { day: { easy: 0, advanced: 0 }, week: { easy: 0, advanced: 0 },
                    month: { easy: 0, advanced: 0 }, lifetime: { easy: 0, advanced: 0 } };
  let mostActiveDay = null; // { date, total }

  for (const dateKey in daily) {
    const entry = daily[dateKey];
    const dayTotal = (entry.easy || 0) + (entry.advanced || 0);

    totals.lifetime.easy += entry.easy || 0;
    totals.lifetime.advanced += entry.advanced || 0;
    if (dateKey >= monthPfx && dateKey.slice(0, 7) === monthPfx) {
      totals.month.easy += entry.easy || 0;
      totals.month.advanced += entry.advanced || 0;
    }
    if (dateKey >= weekStart && dateKey <= todayKey) {
      totals.week.easy += entry.easy || 0;
      totals.week.advanced += entry.advanced || 0;
    }
    if (dateKey === todayKey) {
      totals.day.easy = entry.easy || 0;
      totals.day.advanced = entry.advanced || 0;
    }
    if (!mostActiveDay || dayTotal > mostActiveDay.total) {
      mostActiveDay = { date: dateKey, total: dayTotal };
    }
  }

  let mostVisitedPlatform = null; // { host, count }
  for (const host in platforms) {
    if (!mostVisitedPlatform || platforms[host] > mostVisitedPlatform.count) {
      mostVisitedPlatform = { host, count: platforms[host] };
    }
  }

  return { totals, mostActiveDay, mostVisitedPlatform };
}

/* ---------------------------------------------------------------------
 * Pending applications — v1.3. A posting tab is marked "pending" only
 * after engine.js observes an apply-shaped click. Two things can resolve it,
 * mutually exclusively:
 *  1. A child tab opens from it (chrome.tabs.onCreated, reusing the same
 *     openerTabId lineage the duplicate-suppression logic already
 *     tracks) — finalized as Advanced Apply, works for any site.
 *  2. engine.js sends APPLY_CONFIRMED from that same tab when the LinkedIn
 *     Easy Apply modal reaches its "Application sent" state — finalized as
 *     Easy Apply.
 * Whichever happens first wins and clears the pending entry, so a posting
 * is never counted twice. The explicit click-intent gate prevents ordinary
 * browsing from being counted as an Advanced Apply while supporting
 * external ATS and employer sites.
 * ------------------------------------------------------------------- */
async function getPendingApps() {
  const { [PENDING_APPS_KEY]: map } = await chrome.storage.session.get(PENDING_APPS_KEY);
  return map || {};
}

async function markPending(tabId, host) {
  if (typeof tabId !== 'number') return;
  const map = await getPendingApps();
  map[tabId] = { host, startedAt: Date.now() };
  await chrome.storage.session.set({ [PENDING_APPS_KEY]: map });
}

async function clearPendingApp(tabId) {
  const map = await getPendingApps();
  if (!(tabId in map)) return;
  delete map[tabId];
  await chrome.storage.session.set({ [PENDING_APPS_KEY]: map });
}

async function getApplicationFlowTabs() {
  const { [APPLICATION_FLOW_TABS_KEY]: map } = await chrome.storage.session.get(APPLICATION_FLOW_TABS_KEY);
  return map || {};
}

async function markApplicationFlowTab(tabId, awaitingInitialNavigation) {
  if (typeof tabId !== 'number') return;
  const map = await getApplicationFlowTabs();
  map[tabId] = { startedAt: Date.now(), awaitingInitialNavigation: awaitingInitialNavigation === true };
  await chrome.storage.session.set({ [APPLICATION_FLOW_TABS_KEY]: map });
}

async function isApplicationFlowTab(tabId) {
  const map = await getApplicationFlowTabs();
  const entry = map[tabId];
  if (!entry) return false;
  if (!entry.startedAt || Date.now() - entry.startedAt > PENDING_APPLY_TTL_MS) {
    delete map[tabId];
    await chrome.storage.session.set({ [APPLICATION_FLOW_TABS_KEY]: map });
    return false;
  }
  return true;
}

async function advanceApplicationFlowTab(tabId) {
  const map = await getApplicationFlowTabs();
  const entry = map[tabId];
  if (!entry) return;
  if (entry.awaitingInitialNavigation) {
    entry.awaitingInitialNavigation = false;
    await chrome.storage.session.set({ [APPLICATION_FLOW_TABS_KEY]: map });
    return;
  }
  delete map[tabId];
  await chrome.storage.session.set({ [APPLICATION_FLOW_TABS_KEY]: map });
}

async function clearApplicationFlowTab(tabId) {
  const map = await getApplicationFlowTabs();
  if (!(tabId in map)) return;
  delete map[tabId];
  await chrome.storage.session.set({ [APPLICATION_FLOW_TABS_KEY]: map });
}

// Called when a pending posting opens a child tab or navigates to an
// external application site in the same tab.
async function finalizeAdvancedApply(pendingTabId) {
  const map = await getPendingApps();
  const pending = map[pendingTabId];
  if (!pending) return;
  if (!pending.startedAt || Date.now() - pending.startedAt > PENDING_APPLY_TTL_MS) {
    delete map[pendingTabId];
    await chrome.storage.session.set({ [PENDING_APPS_KEY]: map });
    return;
  }
  await recordApplication('advanced', pending.host);
  delete map[pendingTabId];
  await chrome.storage.session.set({ [PENDING_APPS_KEY]: map });
}

async function finalizeAdvancedApplyOnNavigation(tabId, destinationUrl) {
  const pending = (await getPendingApps())[tabId];
  if (!pending) return false;

  const destinationHost = hostnameOf(destinationUrl);
  if (!destinationHost) return false;

  await finalizeAdvancedApply(tabId);
  return true;
}

// Called on APPLY_CONFIRMED from engine.js after a completed Easy Apply.
async function handleApplyConfirmed(sender) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') return { ok: false };
  const map = await getPendingApps();
  const pending = map[tabId];
  if (!pending) return { ok: false }; // already resolved as advanced, or was never marked
  if (!pending.startedAt || Date.now() - pending.startedAt > PENDING_APPLY_TTL_MS) {
    delete map[tabId];
    await chrome.storage.session.set({ [PENDING_APPS_KEY]: map });
    return { ok: false };
  }
  await recordApplication('easy', pending.host);
  delete map[tabId];
  await chrome.storage.session.set({ [PENDING_APPS_KEY]: map });
  return { ok: true };
}

async function handleApplyIntent(sender) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') return { ok: false };
  const host = hostnameOf(sender.tab.url);
  if (!host) return { ok: false };
  await markPending(tabId, host);
  return { ok: true };
}

/* ---------------------------------------------------------------------
 * Engine injection (on-demand, one-shot — see CONTEXT.md decision #4)
 * ------------------------------------------------------------------- */
// In-memory guard — closes a check-then-act race: the sniffer's
// JOB_PAGE_DETECTED handler and the known-host onUpdated shortcut can both
// call injectEngine() for the same tab before either one finishes writing
// the storage.session "injected" flag, so both proceed to inject and the
// engine's top-level consts get declared twice in the same persistent
// USER_SCRIPT world. This Set closes that window synchronously, before any
// await runs. Not persisted — irrelevant across a service-worker restart,
// since a restart means nothing is "currently injecting" anyway.
const injectionInFlight = new Set();

async function injectEngine(tabId) {
  if (typeof tabId !== 'number') return;
  if (injectionInFlight.has(tabId)) return;
  injectionInFlight.add(tabId);

  try {
    const [injected, consented] = await Promise.all([getInjectedTabs(), hasConsent()]);
    if (injected[tabId] || consented !== true) return;

    await setTabState(tabId, 'watching');

    // Must resolve before execute() creates the tab's USER_SCRIPT world —
    // otherwise that world can come up without messaging enabled, and
    // engine.js's chrome.runtime.sendMessage silently isn't a function.
    await configureUserScriptWorld();

    await chrome.userScripts.execute({
      target: { tabId },
      js: ENGINE_SCRIPT_FILES,
      world: 'USER_SCRIPT',
      injectImmediately: true
    });
    injected[tabId] = true;
    await chrome.storage.session.set({ [INJECTED_TABS_KEY]: injected });
  } catch (err) {
    // Most likely cause: the user hasn't flipped "Allow User Scripts" yet.
    console.warn('[SeenDisJob] engine injection failed:', err);
    await setTabState(tabId, 'idle', { reason: 'injection-failed' });
  } finally {
    injectionInFlight.delete(tabId);
  }
}

async function configureUserScriptWorld() {
  try {
    await chrome.userScripts.configureWorld({ messaging: true });
  } catch (err) {
    console.warn('[SeenDisJob] userScripts world not available yet:', err);
  }
}

/* ---------------------------------------------------------------------
 * Job records: lookup, tab-lineage decision, recording
 * ------------------------------------------------------------------- */
async function getRecords() {
  const { [RECORDS_KEY]: records } = await chrome.storage.local.get(RECORDS_KEY);
  return records || {};
}

async function saveRecords(records) {
  await chrome.storage.local.set({ [RECORDS_KEY]: records });
}

function pruneStale(records) {
  const cutoff = Date.now() - RECORD_TTL_MS;
  let changed = false;
  for (const key in records) {
    if (records[key].timestamp < cutoff) { delete records[key]; changed = true; }
  }
  return changed;
}

// Ported from the original userscript's findDuplicate, adapted to plain
// arrays (message payloads can't carry Sets) and JDSMatching's functions.
// Now also carries the record's own key forward as `id` (needed so the
// HUD's "don't warn me about this again" button can target the exact
// listing) and skips any record the user has muted.
function findMatch(records, companyTokens, titleTokens, mutedIds) {
  let best = null;
  for (const key in records) {
    if (mutedIds[key]) continue;
    const rec = records[key];
    const recCompanyTokens = new Set(rec.companyTokens || []);
    const recTitleTokens = new Set(rec.titleTokens);
    const titleSim = JDSMatching.jaccard(titleTokens, recTitleTokens);
    const bothCompaniesKnown = companyTokens.size > 0 && recCompanyTokens.size > 0;

    let passes, score;
    if (bothCompaniesKnown) {
      const companySim = JDSMatching.bestSimilarity(companyTokens, recCompanyTokens);
      score = JDSMatching.COMPANY_WEIGHT * companySim + JDSMatching.TITLE_WEIGHT * titleSim;
      passes = companySim >= JDSMatching.COMPANY_MATCH_MIN &&
               titleSim >= JDSMatching.TITLE_MATCH_MIN &&
               score >= JDSMatching.COMBINED_THRESHOLD;
      if (passes && (!best || score > best.similarity)) {
        best = { ...rec, id: key, similarity: score, companySim, titleSim };
      }
    } else {
      score = titleSim;
      passes = score >= JDSMatching.TITLE_ONLY_THRESHOLD;
      if (passes && (!best || score > best.similarity)) {
        best = { ...rec, id: key, similarity: score, companySim: null, titleSim };
      }
    }
  }
  return best;
}

// Walks the current tab's opener chain looking for matchTabId — implements
// decision #6: never warn if the match belongs to the same tab, or to a
// tab that is an ancestor of (i.e. opened, directly or indirectly) the
// current tab.
async function isSameLineage(matchTabId, currentTabId) {
  if (matchTabId === currentTabId) return true;
  const openerMap = await getOpenerMap();
  let cursor = currentTabId;
  for (let hops = 0; hops < MAX_OPENER_CHAIN_HOPS; hops++) {
    const opener = openerMap[cursor];
    if (opener == null) return false;
    if (opener === matchTabId) return true;
    cursor = opener;
  }
  return false;
}

async function handleCheckJob(payload, sender) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') return { duplicate: false };

  const hostname = hostnameOf(payload.url);
  if (isApplicationHubHost(hostname)) return { duplicate: false, applicationHub: true };

  if (await isApplicationFlowTab(tabId)) return { duplicate: false, applicationFlow: true };

  // v1.3 — tier-3 gate. Tier 1 (payload.source === 'jsonld') and tier 2
  // (KNOWN_JOB_HOSTS) are trusted by default and skip straight to
  // matching, same as before. Anything else needs either a prior "yes"
  // in the site trust list, or gets asked now — unless the user has
  // turned asking off.
  const isTrustedSource = payload.source === 'jsonld' || isKnownJobHost(payload.url);
  if (!isTrustedSource && hostname) {
    const askEnabled = await getAskAboutSites();
    if (!askEnabled) return { duplicate: false }; // asking is off — stay silent on ambiguous pages
    const trust = (await getSiteTrust())[hostname];
    if (trust === false) return { duplicate: false }; // user already said no for this site
    if (trust !== true) return { needsConfirm: true, hostname }; // never asked — engine.js shows the popup
    // trust === true: falls through, proceeds exactly like a trusted source
  }

  const companyTokens = new Set(payload.companyTokens || []);
  const titleTokens = new Set(payload.titleTokens || []);

  const [records, mutedIds] = await Promise.all([getRecords(), getMutedIds()]);
  const changedByPrune = pruneStale(records);
  const match = findMatch(records, companyTokens, titleTokens, mutedIds);

  if (match) {
    if (await isSameLineage(match.tabId, tabId)) {
      if (changedByPrune) await saveRecords(records);
      // Same job, still open in this tab/lineage — not a *new* duplicate,
      // but still worth showing "recorded" rather than leaving the badge
      // stuck on "watching" forever.
      await setTabState(tabId, 'recorded', { title: payload.title, company: payload.company });
      return { duplicate: false };
    }
    if (changedByPrune) await saveRecords(records);
    await setTabState(tabId, 'duplicate', {
      title: payload.title,
      company: payload.company,
      matchTitle: match.title,
      matchCompany: match.company,
      timestamp: match.timestamp,
      companySim: match.companySim,
      titleSim: match.titleSim
    });
    await appendHistory({
      type: 'duplicate',
      title: payload.title,
      company: payload.company,
      matchTitle: match.title,
      matchCompany: match.company
    });
    await bumpStat('duplicates');
    return {
      duplicate: true,
      match: {
        id: match.id,
        title: match.title,
        company: match.company,
        timestamp: match.timestamp,
        companySim: match.companySim,
        titleSim: match.titleSim
      }
    };
  }

  const id = `${payload.companyNorm}::${payload.titleNorm}`.slice(0, 200);
  records[id] = {
    companyNorm: payload.companyNorm,
    companyTokens: Array.from(companyTokens),
    titleNorm: payload.titleNorm,
    titleTokens: Array.from(titleTokens),
    title: payload.title,
    company: payload.company,
    url: payload.url,
    tabId,
    timestamp: Date.now()
  };
  await saveRecords(records);
  await setTabState(tabId, 'recorded', { title: payload.title, company: payload.company });
  await appendHistory({ type: 'recorded', title: payload.title, company: payload.company });
  await bumpStat('seen');
  return { duplicate: false };
}

// v1.3 — engine.js's tier-3 confirm popup answer lands here.
async function handleSetSiteTrust(hostname, trusted) {
  if (!hostname) return { ok: false };
  await setSiteTrust(hostname, trusted === true);
  return { ok: true };
}

async function handleMuteMatch(id) {
  if (!id) return { ok: false };
  await muteId(id);
  const records = await getRecords();
  const rec = records[id];
  await appendHistory({
    type: 'muted',
    title: rec?.title || null,
    company: rec?.company || null
  });
  return { ok: true };
}

/* ---------------------------------------------------------------------
 * Popup support: status for the active tab, recent history, clear-all,
 * backup export.
 * ------------------------------------------------------------------- */
async function handleGetStatus(tabId) {
  const [consent, states, records, history, mutedIds, updateStatus] = await Promise.all([
    hasConsent(), getTabStates(), getRecords(), getHistory(), getMutedIds(), checkForUpdate()
  ]);
  const tabState = (typeof tabId === 'number' && states[tabId]) || { state: 'idle', details: null };
  return {
    consent,                          // true | false | undefined
    recordCount: Object.keys(records).length,
    mutedCount: Object.keys(mutedIds).length,
    history: history.slice(0, 4), // v1.3 — dashboard has the full log now
    tabState,
    updateStatus                      // v1.3 — { updateAvailable, remoteVersion, repoUrl, ... }, throttled internally
  };
}

async function handleClearRecords() {
  await chrome.storage.local.set({
    [RECORDS_KEY]: {}, [MUTED_IDS_KEY]: {}, [HISTORY_KEY]: [],
    [STATS_KEY]: { seen: 0, duplicates: 0 },
    [APP_DAILY_KEY]: {}, [APP_PLATFORM_KEY]: {}
  });
  // Every currently-tracked tab's "recorded"/"duplicate" badge is now
  // stale information, so reset them all rather than leave false checkmarks.
  const states = await getTabStates();
  await Promise.all(Object.keys(states).map(tid => clearTabState(Number(tid))));
  return { ok: true };
}

async function handleGetBackup() {
  const records = await getRecords();
  return { records };
}

/* ---------------------------------------------------------------------
 * Dashboard support — v1.3. The dashboard is a normal extension page
 * (same messaging tier as popup.js/onboarding.js), so it reads more of
 * the same storage the popup already summarizes, plus the site trust
 * list and the ask-about-sites toggle the popup never needed.
 * ------------------------------------------------------------------- */
async function handleGetDashboardData() {
  const [consent, records, history, mutedIds, siteTrust, askAboutSites, stats, applications, updateStatus] = await Promise.all([
    hasConsent(), getRecords(), getHistory(), getMutedIds(), getSiteTrust(), getAskAboutSites(), getStats(), getApplicationStats(), checkForUpdate()
  ]);
  return {
    consent,
    records,            // { id: { companyNorm, titleNorm, title, company, timestamp, ... } } — live 60-day window
    history,            // full capped list (up to MAX_HISTORY_ENTRIES), not sliced to 5
    mutedCount: Object.keys(mutedIds).length,
    siteTrust,          // { hostname: true|false }
    askAboutSites,
    stats,              // { seen, duplicates } — lifetime totals, independent of the 60-day TTL prune
    applications,       // { totals: {day,week,month,lifetime}, mostActiveDay, mostVisitedPlatform } — v1.3
    updateStatus         // v1.3 — { updateAvailable, remoteVersion, repoUrl, ... }, throttled internally
  };
}

async function handleSetAskAboutSites(enabled) {
  await chrome.storage.local.set({ [ASK_ABOUT_SITES_KEY]: enabled === true });
  return { ok: true };
}

/* ---------------------------------------------------------------------
 * Update checker — current release behavior. This is a Load-Unpacked extension with no
 * Chrome Web Store auto-update, so otherwise there is no signal a newer
 * version exists until the user happens to notice. Fetches the project's
 * raw manifest.json off GitHub, compares its "version" field against
 * chrome.runtime.getManifest().version (never hardcoded), and caches the
 * result so popup/dashboard can show a banner without either one
 * triggering its own network request on every open.
 *
 * The repository is now hosted at github.com/UprightCode-hub/SeenDisJob.
 * Keep the owner/name constants together so a future repository move only
 * requires changing these two values.
 *
 * Never throws and never surfaces a network/parse error to the user — a
 * failed check just stamps lastChecked (so a broken/offline endpoint
 * isn't hit again until the next throttle window) and leaves whatever
 * status was last known-good in place. This never downloads or installs
 * anything on its own — informational only, always links out to GitHub
 * for the person to update manually.
 * ------------------------------------------------------------------- */
const UPDATE_REPO_OWNER = 'UprightCode-hub';
const UPDATE_REPO_NAME = 'SeenDisJob';
const UPDATE_MANIFEST_URL = `https://raw.githubusercontent.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/main/manifest.json`;
const UPDATE_REPO_URL = `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}`;
const UPDATE_CHECK_KEY = 'jds_update_check'; // storage.local — { lastChecked, installedVersion, remoteVersion, updateAvailable, error }
const UPDATE_CHECK_ALARM = 'jds_update_check_alarm';
const UPDATE_CHECK_THROTTLE_MS = 12 * 60 * 60 * 1000; // 12 hours — also the alarm's period, see Event wiring below

function isUpdateCheckerConfigured() {
  return UPDATE_REPO_OWNER !== 'PLACEHOLDER_OWNER' && UPDATE_REPO_NAME !== 'PLACEHOLDER_REPOSITORY';
}

// Numeric, dot-separated comparison (e.g. "1.10" > "1.9", which a plain
// string compare would get backwards). Returns 1 if a>b, -1 if a<b, 0 if
// equal, or null if either string doesn't look like a dotted numeric
// version at all — the caller treats null as "can't tell, don't claim
// an update is available."
function parseVersionParts(version) {
  if (typeof version !== 'string' || version.trim() === '') return null;
  const parts = version.trim().split('.').map(part => parseInt(part, 10));
  return parts.some(Number.isNaN) ? null : parts;
}

function compareVersions(a, b) {
  const partsA = parseVersionParts(a);
  const partsB = parseVersionParts(b);
  if (!partsA || !partsB) return null;
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const na = partsA[i] || 0;
    const nb = partsB[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function getUpdateStatus() {
  const { [UPDATE_CHECK_KEY]: status } = await chrome.storage.local.get(UPDATE_CHECK_KEY);
  return status || { lastChecked: null, remoteVersion: null, updateAvailable: false, error: null };
}

async function saveUpdateStatus(status) {
  await chrome.storage.local.set({ [UPDATE_CHECK_KEY]: status });
}

// Called both by the periodic alarm and by popup/dashboard reads (via
// handleGetStatus/handleGetDashboardData) — the lastChecked throttle
// below, not a separate "read-only" code path, is what keeps the latter
// from firing a real fetch on every popup/dashboard open.
async function checkForUpdate({ force = false } = {}) {
  const cached = await getUpdateStatus();

  if (!isUpdateCheckerConfigured()) {
    return { ...cached, repoUrl: UPDATE_REPO_URL };
  }

  const installedVersion = chrome.runtime.getManifest().version;
  const cachedVersionMatches = cached.installedVersion === installedVersion;
  const now = Date.now();
  if (!force && cachedVersionMatches && cached.lastChecked && (now - cached.lastChecked) < UPDATE_CHECK_THROTTLE_MS) {
    return { ...cached, repoUrl: UPDATE_REPO_URL };
  }

  let status;
  try {
    const response = await fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remoteManifest = await response.json();
    const remoteVersion = remoteManifest && remoteManifest.version;
    const comparison = compareVersions(remoteVersion, installedVersion);
    status = {
      lastChecked: now,
      installedVersion,
      remoteVersion: remoteVersion || null,
      updateAvailable: comparison === 1,
      error: comparison === null ? 'unparsable-version' : null
    };
  } catch (err) {
    // Offline, DNS failure, GitHub down, invalid URL, bad JSON — all land
    // here and are swallowed rather than shown to the user. Keep the
    // last known-good status rather than flipping updateAvailable to
    // false on what may be a purely transient failure.
    console.debug('[SeenDisJob] update check failed (non-fatal):', err);
    status = {
      ...cached,
      lastChecked: now,
      installedVersion,
      remoteVersion: cachedVersionMatches ? cached.remoteVersion : null,
      updateAvailable: cachedVersionMatches ? cached.updateAvailable : false,
      error: 'check-failed'
    };
  }

  await saveUpdateStatus(status);
  return { ...status, repoUrl: UPDATE_REPO_URL };
}

/* ---------------------------------------------------------------------
 * Event wiring
 * ------------------------------------------------------------------- */
configureUserScriptWorld();

// chrome.alarms, not setInterval — this service worker gets killed after
// ~30s idle and a setInterval wouldn't survive that. create() with an
// existing alarm name just resets its schedule, so this is safe to call
// on every service-worker wake, not just once.
chrome.alarms.create(UPDATE_CHECK_ALARM, { periodInMinutes: UPDATE_CHECK_THROTTLE_MS / 60000 });

chrome.runtime.onInstalled.addListener((details) => {
  configureUserScriptWorld();
  checkForUpdate({ force: true }); // fire-and-forget — don't make install/update wait on GitHub
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_CHECK_ALARM) checkForUpdate();
});

// Ordinary messaging — from the sniffer, a normal declared content script,
// and from the popup (a normal extension page, also regular messaging).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MSG_JOB_PAGE_DETECTED && sender.tab?.id != null) {
    if (isApplicationHubHost(hostnameOf(sender.tab.url))) return false;
    injectEngine(sender.tab.id);
    return false;
  }
  if (message?.type === MSG_GET_STATUS) {
    handleGetStatus(message.tabId).then(sendResponse);
    return true;
  }
  if (message?.type === MSG_CLEAR_RECORDS) {
    handleClearRecords().then(sendResponse);
    return true;
  }
  if (message?.type === MSG_GET_BACKUP) {
    handleGetBackup().then(sendResponse);
    return true;
  }
  if (message?.type === MSG_GET_DASHBOARD_DATA) {
    handleGetDashboardData().then(sendResponse);
    return true;
  }
  if (message?.type === MSG_SET_ASK_ABOUT_SITES) {
    handleSetAskAboutSites(message.enabled).then(sendResponse);
    return true;
  }
  if (message?.type === MSG_SET_SITE_TRUST) {
    // Dashboard page can also flip a site's trust entry directly (e.g.
    // undoing an accidental "no") — same handler engine.js's popup uses.
    handleSetSiteTrust(message.hostname, message.trusted).then(sendResponse);
    return true;
  }
  return false;
});

// Dedicated messaging channel for the injected USER_SCRIPT-world engine —
// it cannot use the regular onMessage/chrome.storage APIs at all.
chrome.runtime.onUserScriptMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MSG_CHECK_JOB) {
    handleCheckJob(message.payload, sender).then(sendResponse);
    return true; // keep the channel open for the async response
  }
  if (message?.type === MSG_MUTE_MATCH) {
    handleMuteMatch(message.id).then(sendResponse);
    return true;
  }
  if (message?.type === MSG_SET_SITE_TRUST) {
    handleSetSiteTrust(message.hostname, message.trusted).then(sendResponse);
    return true;
  }
  if (message?.type === MSG_APPLY_CONFIRMED) {
    handleApplyConfirmed(sender).then(sendResponse);
    return true;
  }
  if (message?.type === MSG_APPLY_INTENT) {
    handleApplyIntent(sender).then(sendResponse);
    return true;
  }
  if (message?.type === MSG_CLOSE_TAB && sender.tab?.id != null) {
    chrome.tabs.remove(sender.tab.id);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    clearInjectedFlag(tabId);
    clearTabState(tabId); // new page — old status/badge no longer applies
    const pending = (await getPendingApps())[tabId];
    if (pending) {
      await markApplicationFlowTab(tabId, false);
      await finalizeAdvancedApplyOnNavigation(tabId, changeInfo.url);
    } else {
      await advanceApplicationFlowTab(tabId);
      clearPendingApp(tabId); // navigation without a valid application candidate
    }
  }
  if (changeInfo.status === 'complete' && tab.url && isKnownJobHost(tab.url)) {
    injectEngine(tabId);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId != null) {
    recordOpener(tab.id, tab.openerTabId);
    getPendingApps().then((pendingApps) => {
      if (!(tab.openerTabId in pendingApps)) return;
      markApplicationFlowTab(tab.id, true);
      finalizeAdvancedApply(tab.openerTabId);
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearInjectedFlag(tabId);
  clearOpenerEntry(tabId);
  clearTabState(tabId);
  clearPendingApp(tabId);
  clearApplicationFlowTab(tabId);
});