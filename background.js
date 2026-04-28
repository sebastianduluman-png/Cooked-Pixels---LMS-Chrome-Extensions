/**
 * Background Service Worker
 *
 * Intercepts GA4 collect requests via chrome.webRequest, parses the
 * Measurement Protocol payload, and stores ecommerce events in
 * chrome.storage.local so they survive service-worker restarts and
 * page navigations.
 *
 * Captures GA4 requests sent to:
 *  - Standard:  www.google-analytics.com/g/collect
 *  - Alt:       analytics.google.com/g/collect
 *  - Regional:  region{1-9}.google-analytics.com/g/collect
 *  - GTM:       www.googletagmanager.com/g/collect
 *  - sGTM:      any first-party domain proxying /g/collect or /j/collect
 *  - Debug:     any domain /debug/mp/collect
 *
 * Storage schema:
 *   "tab_{tabId}" → { origin: string, events: ParsedEvent[] }
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path patterns that indicate a GA4 Measurement Protocol collect endpoint. */
const GA4_PATH_RE = /\/(g|j)\/collect\b/;
const GA4_DEBUG_PATH_RE = /\/debug\/mp\/collect\b/;

const ECOMMERCE_EVENTS = new Set([
  "page_view",
  "view_item",
  "view_item_list",
  "select_item",
  "add_to_cart",
  "remove_from_cart",
  "view_cart",
  "begin_checkout",
  "add_shipping_info",
  "add_payment_info",
  "purchase",
]);

const MAX_EVENTS_PER_TAB = 500;
const DEDUP_WINDOW_MS = 15000;

/** Google Ads conversion endpoint detection.
 *  Matches /pagead/conversion/, /pagead/1p-conversion/, /pagead/viewthroughconversion/ */
const GADS_PATH_RE = /\/pagead\/(?:1p-)?(?:viewthrough)?conversion\//;

/** Broader Google Ads /pagead/ path — catches config/remarketing/landing pings. */
const GADS_PAGEAD_RE = /\/pagead\//;

const GADS_HOSTS = new Set([
  "www.googleadservices.com",
  "googleads.g.doubleclick.net",
  "www.google.com",
  "pagead2.googlesyndication.com",
  "ade.googlesyndication.com",
]);

const ITEM_FIELD_MAP = {
  id: "item_id",
  nm: "item_name",
  br: "item_brand",
  ca: "item_category",
  c2: "item_category2",
  c3: "item_category3",
  c4: "item_category4",
  c5: "item_category5",
  va: "item_variant",
  pr: "price",
  qt: "quantity",
  cp: "coupon",
  ds: "discount",
  af: "affiliation",
  ln: "item_list_name",
  li: "item_list_id",
  lp: "index",
  ps: "promotion_id",
  pn: "promotion_name",
  cr: "creative_name",
  cs: "creative_slot",
  lo: "location_id",
};

// ---------------------------------------------------------------------------
// Consent Mode decoding  (gcd / gcs parameters)
// ---------------------------------------------------------------------------

/**
 * GCD letter-code lookup.
 * Each letter encodes the consent state for one category.
 * Lowercase = set directly; uppercase = inherited from another category.
 */
const GCD_CODE_MAP = {
  l: { state: "not_set",  meaning: "No consent mode signals" },
  p: { state: "denied",   meaning: "Denied (default, no update)" },
  q: { state: "denied",   meaning: "Denied (default + update)" },
  t: { state: "granted",  meaning: "Granted (default, no update)" },
  r: { state: "granted",  meaning: "Default denied → updated to granted" },
  m: { state: "denied",   meaning: "Denied (update only)" },
  n: { state: "granted",  meaning: "Granted (update only)" },
  u: { state: "denied",   meaning: "Default granted → updated to denied" },
  v: { state: "granted",  meaning: "Granted (default + update)" },
};

const GCD_CATEGORIES = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"];

/**
 * Decode a GCD string like "11t1t1t1t5" into per-category consent states.
 *
 * Format: <2-char prefix><sep><letter><sep><letter><sep><letter><sep><letter><suffix>
 *   Prefix: "11" or "13"  (determines separator digit: 1 or 3)
 *   Suffix: typically "5" or "7"
 *   Letters: see GCD_CODE_MAP
 */
function decodeGCD(raw) {
  if (!raw || raw.length < 7) return null;

  try {
    // Strip 2-char prefix; remainder is like "t1t1t1t5"
    const body = raw.slice(2);
    // Extract all letter characters (consent codes) from the body, ignoring digit separators and suffix
    const letters = [];
    for (const ch of body) {
      if (/[a-zA-Z]/.test(ch) && letters.length < 4) letters.push(ch);
    }

    const result = { raw };
    for (let i = 0; i < GCD_CATEGORIES.length; i++) {
      const code = letters[i] || null;
      if (!code) {
        result[GCD_CATEGORIES[i]] = { state: "unknown", code: null, meaning: "Not present", inherited: false };
        continue;
      }
      const lower = code.toLowerCase();
      const entry = GCD_CODE_MAP[lower];
      const inherited = code !== lower; // uppercase = inherited
      result[GCD_CATEGORIES[i]] = entry
        ? { state: entry.state, code, meaning: entry.meaning, inherited }
        : { state: "unknown", code, meaning: "Unknown code", inherited };
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Decode a GCS string like "G111" into ad_storage + analytics_storage.
 *
 * Format: G1<ad_storage><analytics_storage>
 *   "1" = granted, "0" = denied, other = unknown
 */
function decodeGCS(raw) {
  if (!raw || raw.length < 4 || !raw.startsWith("G1")) return null;

  const adChar = raw[2];
  const anChar = raw[3];
  const map = { "1": "granted", "0": "denied" };

  return {
    raw,
    ad_storage: map[adChar] || "unknown",
    analytics_storage: map[anChar] || "unknown",
  };
}

/**
 * Extract consent signals (gcd + gcs) from request params.
 * Returns null if neither parameter is present.
 */
function extractConsent(params) {
  const gcdRaw = params.get("gcd");
  const gcsRaw = params.get("gcs");
  if (!gcdRaw && !gcsRaw) return null;

  return {
    gcd: gcdRaw ? decodeGCD(gcdRaw) : null,
    gcs: gcsRaw ? decodeGCS(gcsRaw) : null,
  };
}

// ---------------------------------------------------------------------------
// Storage helpers  (chrome.storage.local — survives SW restarts + nav)
// ---------------------------------------------------------------------------

function storageKey(tabId) {
  return "tab_" + tabId;
}

async function loadTab(tabId) {
  const key = storageKey(tabId);
  const result = await chrome.storage.local.get(key);
  return result[key] || { origin: "", events: [] };
}

async function saveTab(tabId, data) {
  await chrome.storage.local.set({ [storageKey(tabId)]: data });
}

async function clearTab(tabId) {
  await chrome.storage.local.remove(storageKey(tabId));
}

// Serialised per-tab write queues to prevent race conditions on rapid events
const _writeQueues = {};

function enqueueWrite(tabId, event) {
  if (!_writeQueues[tabId]) _writeQueues[tabId] = Promise.resolve();
  _writeQueues[tabId] = _writeQueues[tabId]
    .then(() => _appendEvent(tabId, event))
    .catch(() => {});
}

async function _appendEvent(tabId, event) {
  const data = await loadTab(tabId);
  if (!data.origin && event.origin) data.origin = event.origin;

  // If this event replaces a sparser duplicate, swap it in-place
  if (event._replaces) {
    const fp = event._replaces;
    const idx = data.events.findIndex(e => identityFingerprint(e) === fp && eventScore(e) < eventScore(event));
    if (idx >= 0) {
      data.events[idx] = event;
      delete event._replaces;
      await saveTab(tabId, data);
      return;
    }
    delete event._replaces;
  }

  data.events.push(event);
  if (data.events.length > MAX_EVENTS_PER_TAB) {
    data.events = data.events.slice(-MAX_EVENTS_PER_TAB);
  }
  await saveTab(tabId, data);
}

// ---------------------------------------------------------------------------
// Event deduplication
// ---------------------------------------------------------------------------

const _dedupCache = {};

/**
 * Identity fingerprint — matches the same logical event regardless of data
 * richness.  Uses only source + tracking ID + event name so that sparse
 * beacons (e.g. Meta fires a /tr GET with just pixel_id + event_name)
 * collide with the full-data request for the same event.
 */
function identityFingerprint(event) {
  const p = event.payload;
  if (event.source === "ga4")  return `ga4|${p.measurement_id}|${p.event_name}`;
  if (event.source === "gads") return `gads|${p.conversion_id}|${p.conversion_label}|${p.event_name}`;
  if (event.source === "fb")   return `fb|${p.pixel_id}|${p.event_name}`;
  return event.url;
}

/**
 * Score an event by data completeness — more filled fields = higher score.
 * Used to decide which version to keep when duplicates collide.
 */
function eventScore(event) {
  let score = 0;
  const p = event.payload;
  const ep = p.event_params || {};
  for (const k in ep) if (ep[k] !== "" && ep[k] != null) score++;
  if (p.items && p.items.length) {
    score += p.items.length;
    for (const item of p.items) {
      for (const k in item) if (item[k] !== "" && item[k] != null) score++;
    }
  }
  if (p.user_data) {
    for (const k in p.user_data) if (p.user_data[k]) score++;
  }
  return score;
}

/**
 * Check whether `event` is a duplicate of a recently seen event for the
 * same tab.  Two layers:
 *
 *   1. Rapid duplicates (≤ 2 s): same identity → keep richest, drop rest.
 *      Catches protocol retries, duplicate GTM tags, gtag+GTM overlap.
 *
 *   2. Sparse-beacon removal (≤ 15 s): if one side has almost no data
 *      (score ≤ SPARSE_THRESHOLD) while the other is data-rich → drop the
 *      sparse one.  Catches Meta's lightweight /tr GET beacons.
 *
 * When both events carry real data and arrive > 2 s apart they are treated
 * as separate logical events (e.g. two add_to_cart for different products).
 *
 * When a richer event replaces a sparser one, `event._replaces` is set so
 * that _appendEvent can swap the old event out of storage.
 */
const SPARSE_THRESHOLD = 2;
const RAPID_WINDOW_MS = 2000;

function isDuplicate(tabId, event) {
  if (!_dedupCache[tabId]) _dedupCache[tabId] = new Map();
  const cache = _dedupCache[tabId];
  const now = Date.now();

  // Prune stale entries
  for (const [fp, entry] of cache) {
    if (now - entry.ts > DEDUP_WINDOW_MS) cache.delete(fp);
  }

  const fp = identityFingerprint(event);
  const score = eventScore(event);

  if (cache.has(fp)) {
    const cached = cache.get(fp);
    const gap = now - cached.ts;

    // Layer 1 — rapid duplicate (≤ 2 s): keep richer, drop sparser
    if (gap <= RAPID_WINDOW_MS) {
      if (score <= cached.score) return true;
      cache.set(fp, { ts: now, score });
      event._replaces = fp;
      return false;
    }

    // Layer 2 — sparse-beacon removal (> 2 s, ≤ 15 s)
    if (score <= SPARSE_THRESHOLD && cached.score > SPARSE_THRESHOLD) {
      return true;                           // late sparse beacon → drop
    }
    if (cached.score <= SPARSE_THRESHOLD && score > SPARSE_THRESHOLD) {
      cache.set(fp, { ts: now, score });     // cached was sparse → replace
      event._replaces = fp;
      return false;
    }

    // Both have real data and gap > 2 s → different logical events, keep both
    if (score >= cached.score) cache.set(fp, { ts: now, score });
    return false;
  }

  cache.set(fp, { ts: now, score });
  return false;
}

function clearDedupCache(tabId) {
  delete _dedupCache[tabId];
}

// ---------------------------------------------------------------------------
// GA4 request detection
// ---------------------------------------------------------------------------

/**
 * Determines whether a request URL points to a GA4 collect endpoint.
 *
 * Two-stage check:
 *  1. Fast path match — /g/collect, /j/collect, /debug/mp/collect
 *  2. Parameter sniff — must have GA4-specific query params (v=2, tid)
 *     to avoid false positives on random URLs that happen to contain
 *     /g/collect in their path (e.g. /api/g/collect-feedback).
 */
function isGA4Collect(url) {
  try {
    const u = new URL(url);

    // Stage 1: path must match a known GA4 collect pattern
    const pathOk = GA4_PATH_RE.test(u.pathname) || GA4_DEBUG_PATH_RE.test(u.pathname);
    if (!pathOk) return false;

    // Stage 2: must carry at least one GA4-specific param
    // v=2 is the GA4 protocol version; tid (measurement ID) is always present
    const p = u.searchParams;
    const hasVersion = p.get("v") === "2";
    const hasTid = p.has("tid");
    return hasVersion || hasTid;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * GA4 can batch events in one HTTP request:
 *  - URL query string carries shared params (v, tid, cid, sid …)
 *  - POST body carries zero or more newline-separated param strings,
 *    each with its own `en` (event name) that supplements/overrides URL params.
 *  - For GET requests everything including `en` is in the URL.
 *
 * Returns only ecommerce ParsedEvent[].
 */
function parseGA4Request(details) {
  const url = new URL(details.url);
  const urlParams = url.searchParams;
  const bodyLines = extractBodyLines(details);

  const paramSets = [];
  if (bodyLines.length === 0) {
    // GET or POST with no body — all params in URL
    paramSets.push(urlParams);
  } else {
    // Each body line is a separate event; merge with shared URL params
    for (const line of bodyLines) {
      const lineP = new URLSearchParams(line);
      const merged = new URLSearchParams(urlParams);
      for (const [k, v] of lineP) merged.set(k, v);
      paramSets.push(merged);
    }
  }

  const out = [];
  for (const params of paramSets) {
    const evt = buildEvent(params, details);
    if (evt && ECOMMERCE_EVENTS.has(evt.eventName)) out.push(evt);
  }
  return out;
}

/**
 * Extract the POST body as an array of param-string lines.
 * Handles requestBody.raw (sendBeacon, fetch, XHR) and
 * requestBody.formData (rare fallback).
 */
function extractBodyLines(details) {
  const lines = [];
  if (!details.requestBody) return lines;

  if (details.requestBody.raw && details.requestBody.raw.length) {
    try {
      const dec = new TextDecoder("utf-8");
      const text = details.requestBody.raw
        .map((chunk) => (chunk.bytes ? dec.decode(chunk.bytes) : ""))
        .join("");
      if (text.trim()) {
        for (const l of text.split("\n")) {
          const t = l.trim();
          if (t) lines.push(t);
        }
      }
    } catch { /* ignore decode errors */ }
  }

  if (lines.length === 0 && details.requestBody.formData) {
    const parts = [];
    for (const [key, vals] of Object.entries(details.requestBody.formData)) {
      for (const v of vals) {
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
      }
    }
    if (parts.length) lines.push(parts.join("&"));
  }

  return lines;
}

function buildEvent(params, details) {
  const eventName = params.get("en");
  if (!eventName) return null;

  const payload = {
    event_name: eventName,
    measurement_id: params.get("tid") || "",
    client_id: params.get("cid") || "",
    session_id: params.get("sid") || params.get("ep.ga_session_id") || "",
    page_location: params.get("dl") || "",
    page_title: params.get("dt") || "",
    page_referrer: params.get("dr") || "",
    user_properties: {},
    event_params: {},
    items: [],
  };

  for (const [key, val] of params) {
    if (key.startsWith("ep."))       payload.event_params[key.slice(3)] = val;
    else if (key.startsWith("epn.")) payload.event_params[key.slice(4)] = toNum(val);
    else if (key.startsWith("up."))  payload.user_properties[key.slice(3)] = val;
    else if (key.startsWith("upn.")) payload.user_properties[key.slice(4)] = toNum(val);
  }

  const cu = params.get("cu");
  if (cu) payload.event_params.currency = cu;

  payload.items = extractItems(params);

  // Determine which site originated this request
  let origin = details.initiator || "";
  if (!origin) {
    try { origin = new URL(payload.page_location).origin; } catch { /* ignore */ }
  }

  // Which GA4 endpoint received this request
  let collectHost = "";
  try { collectHost = new URL(details.url).hostname; } catch { /* ignore */ }

  return {
    eventName,
    source: "ga4",
    payload,
    timestamp: details.timeStamp || Date.now(),
    url: details.url,
    tabId: details.tabId,
    method: details.method || "GET",
    origin,
    collectHost,
    consent: extractConsent(params),
  };
}

function extractItems(params) {
  const map = {};
  for (const [key, val] of params) {
    let m = key.match(/^pr(\d+)$/);
    if (m) { map[m[1]] = parseItemString(val); continue; }
    m = key.match(/^pr(\d+)([a-z]{2})$/);
    if (m) {
      if (!map[m[1]]) map[m[1]] = {};
      map[m[1]][ITEM_FIELD_MAP[m[2]] || m[2]] = val;
    }
  }
  return Object.keys(map).map(Number).sort((a, b) => a - b).map((i) => map[i]);
}

/**
 * Parse a compact item string from a GA4 pr{n} parameter.
 *
 * Two formats exist depending on gtag.js / GTM version:
 *   Old: key~value~key~value    (e.g. "id~SKU123~nm~Product~pr~29.99")
 *   New: keyvalue~keyvalue      (e.g. "idSKU123~nmProduct~pr29.99~qt1")
 *
 * Detection: if the first segment is exactly a known 2-char code, use old format.
 * Otherwise treat each segment as {2-char-code}{value}.
 *
 * Custom dimensions use k{n}/v{n} pairs: k0currency~v0RON → { currency: "RON" }
 */
function parseItemString(str) {
  const item = {};
  const parts = str.split("~");
  if (!parts.length) return item;

  // Detect format by checking if first segment is a bare 2-char key
  const first = parts[0];
  const isOldFormat = first.length <= 2 &&
    (ITEM_FIELD_MAP.hasOwnProperty(first) || /^[kv]\d$/.test(first));

  if (isOldFormat) {
    // Old format: key~value~key~value
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const key = ITEM_FIELD_MAP[parts[i]] || parts[i];
      item[key] = toNum(decodeURIComponent(parts[i + 1]));
    }
  } else {
    // New format: {2-char-code}{value} per segment
    for (const part of parts) {
      if (part.length < 2) continue;
      const code = part.slice(0, 2);
      const val = part.slice(2);
      const key = ITEM_FIELD_MAP[code] || code;
      item[key] = toNum(decodeURIComponent(val));
    }
  }

  // Resolve k{n}/v{n} custom dimension pairs → named fields
  const customs = {};
  for (const k of Object.keys(item)) {
    const km = k.match(/^k(\d+)$/);
    if (km) customs[km[1]] = { nameKey: k, name: String(item[k]) };
  }
  for (const [n, info] of Object.entries(customs)) {
    const vKey = "v" + n;
    if (item.hasOwnProperty(vKey)) {
      item[info.name] = item[vKey];
      delete item[info.nameKey];
      delete item[vKey];
    }
  }

  return item;
}

function toNum(val) {
  const n = Number(val);
  return !isNaN(n) && String(n) === String(val).trim() ? n : val;
}

// ---------------------------------------------------------------------------
// Google Ads detection & parsing
// ---------------------------------------------------------------------------

function isGAdsConversion(url) {
  try {
    const u = new URL(url);
    if (!GADS_PATH_RE.test(u.pathname)) return false;
    // Known host OR any Google-affiliated host
    if (GADS_HOSTS.has(u.hostname)) return true;
    const h = u.hostname;
    return h.includes("google") || h.includes("doubleclick") || h.includes("googlesyndication");
  } catch {
    return false;
  }
}

/**
 * Detects non-conversion Google Ads /pagead/ requests (config, remarketing,
 * landing page pings). These are the requests fired by gtag('config', 'AW-xxx')
 * that DON'T go to /pagead/conversion/ but still indicate a GAds page view.
 *
 * Only matches known Google Ads hosts to avoid false positives.
 */
function isGAdsPageview(url) {
  try {
    const u = new URL(url);
    if (!GADS_PAGEAD_RE.test(u.pathname)) return false;
    // Already handled by isGAdsConversion — skip
    if (GADS_PATH_RE.test(u.pathname)) return false;
    // Skip JS/CSS resource loads (e.g. conversion_async.js)
    if (/\.(js|css|json|woff2?|png|gif|jpg|ico)(\?|$)/.test(u.pathname)) return false;
    // Must be a known Google Ads host (strict — no wildcard fallback)
    return GADS_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Parse a Google Ads pageview/remarketing request (non-conversion /pagead/ endpoint).
 * Creates a basic page_view event.
 */
function parseGAdsPageview(details) {
  const url = new URL(details.url);
  const p = collectGAdsParams(details);

  // Try to get conversion ID from path (some paths include it)
  const pathMatch = url.pathname.match(/\/pagead\/[^/]*\/([^/?]+)/);
  const conversionId = pathMatch ? pathMatch[1] : "";

  const pageUrl = p.get("url") || p.get("dl") || "";
  const pageTitle = p.get("tiba") || p.get("dt") || "";

  let origin = details.initiator || "";
  if (!origin && pageUrl) {
    try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
  }

  const payload = {
    event_name: "page_view",
    conversion_id: conversionId ? "AW-" + conversionId : "",
    conversion_label: p.get("label") || "",
    measurement_id: "",
    client_id: "",
    session_id: "",
    page_location: pageUrl,
    page_title: pageTitle,
    page_referrer: "",
    user_properties: {},
    event_params: {},
    items: [],
  };

  return [{
    eventName: "page_view",
    source: "gads",
    payload,
    timestamp: details.timeStamp || Date.now(),
    url: details.url,
    tabId: details.tabId,
    method: details.method || "GET",
    origin,
    collectHost: url.hostname,
    consent: extractConsent(p),
  }];
}

/**
 * Extract all params from a Google Ads request — merges URL query params
 * with POST body params (form data or raw body). POST body takes precedence
 * since Google Ads often sends as form submit.
 */
function collectGAdsParams(details) {
  const url = new URL(details.url);
  const merged = new URLSearchParams(url.searchParams);

  if (details.requestBody) {
    // Form data (most common for Google Ads form submits)
    if (details.requestBody.formData) {
      for (const [key, vals] of Object.entries(details.requestBody.formData)) {
        for (const v of vals) merged.set(key, v);
      }
    }
    // Raw body (sendBeacon / fetch)
    if (details.requestBody.raw && details.requestBody.raw.length) {
      try {
        const dec = new TextDecoder("utf-8");
        const text = details.requestBody.raw
          .map((chunk) => (chunk.bytes ? dec.decode(chunk.bytes) : ""))
          .join("");
        if (text.trim()) {
          const bodyP = new URLSearchParams(text.trim());
          for (const [k, v] of bodyP) merged.set(k, v);
        }
      } catch { /* ignore decode errors */ }
    }
  }

  return merged;
}

/**
 * Parse the semicolon-separated `data` parameter found in Google Ads
 * conversion requests.  Format: "event=purchase;value=100;currency=USD"
 * Returns a Map of key→value pairs.
 */
function parseGAdsDataParam(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const pair of raw.split(";")) {
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const key = decodeURIComponent(pair.slice(0, eq).trim());
      const val = decodeURIComponent(pair.slice(eq + 1).trim());
      map.set(key, val);
    }
  }
  return map;
}

/**
 * Parse a Google Ads conversion request.
 *
 * Conversion ID is extracted from the URL path:
 *   /pagead/conversion/CONVERSION_ID/?label=...&value=...
 *
 * Event name is derived strictly from the request payload:
 *   1. Direct `en` or `event_name` param
 *   2. The `data` param (format: event=EVENT_NAME;value=...;currency=...)
 *   3. Fallback: "conversion"
 *
 * We NEVER guess the event name from the presence of value/transaction_id.
 *
 * Returns ParsedEvent[] (typically one element).
 */
function parseGAdsRequest(details) {
  const url = new URL(details.url);
  const p = collectGAdsParams(details);

  // Extract conversion ID from path: /pagead/conversion/123/ or /pagead/1p-conversion/123/
  const pathMatch = url.pathname.match(/\/pagead\/(?:1p-)?(?:viewthrough)?conversion\/([^/?]+)/);
  const conversionId = pathMatch ? pathMatch[1] : "";

  // Parse the `data` param (semicolon-separated key=value pairs)
  const dataMap = parseGAdsDataParam(p.get("data") || "");

  // ---------------------------------------------------------------
  // Determine event name — ONLY from explicit payload fields
  // ---------------------------------------------------------------
  let eventName = "";

  // 1. Direct param: `en` or `event_name`
  eventName = p.get("en") || p.get("event_name") || "";

  // 2. `data` param: event=add_to_cart;value=50;currency=USD
  if (!eventName && dataMap.has("event")) {
    eventName = dataMap.get("event");
  }

  // 3. Fallback — distinguish gtag('config') pageview from real conversion
  //    gtag('config', 'AW-xxx') fires a bare /pagead/conversion/ with no event,
  //    no value, no transaction — it's a remarketing pageview ping.
  //    Note: config calls often send value=0 in the URL, so we must check
  //    the numeric value (not just string truthiness — "0" is truthy!).
  if (!eventName) {
    const rawValue = p.get("value") || dataMap.get("value") || "";
    const numValue = Number(rawValue);
    const hasRealValue = rawValue !== "" && !isNaN(numValue) && numValue > 0;
    const hasTxn = !!(p.get("transaction_id") || dataMap.get("transaction_id"));
    const hasItems = !!(dataMap.get("id") || p.get("item_id") || p.get("prodid") ||
                        p.get("dynx_itemid") || p.get("ecomm_prodid"));
    eventName = (hasRealValue || hasTxn || hasItems) ? "conversion" : "page_view";
  }

  // 4. Map Google Ads internal event names to standard names
  //    gtag.config = gtag('config', 'AW-xxx') call = page view
  //    Must run AFTER all event name determination steps
  if (eventName === "gtag.config") eventName = "page_view";

  // ---------------------------------------------------------------
  // Build event params & items — skip ecommerce data for page_view
  // (config calls share the same URL as conversions but the data
  //  belongs to the conversion, not the pageview)
  // ---------------------------------------------------------------
  const eventParams = {};
  const items = [];

  if (eventName !== "page_view") {
    const val = p.get("value") || dataMap.get("value") || "";
    if (val) eventParams.value = toNum(val);

    const cur = p.get("currency_code") || p.get("currency") || dataMap.get("currency") || "";
    if (cur) eventParams.currency = cur;

    const txn = p.get("transaction_id") || dataMap.get("transaction_id") || "";
    if (txn) eventParams.transaction_id = txn;

    const oid = p.get("oid") || dataMap.get("order_id") || "";
    if (oid) eventParams.order_id = oid;

    // Capture ALL remaining data param fields into event_params
    const dataSkip = new Set(["event", "id", "quantity", "price", "value", "currency", "transaction_id", "order_id"]);
    for (const [k, v] of dataMap) {
      if (dataSkip.has(k)) continue;
      if (!eventParams.hasOwnProperty(k)) {
        eventParams[k] = toNum(v);
      }
    }

    // Capture remarketing / ecommerce direct URL params
    for (const [k, v] of p) {
      if (k.startsWith("ecomm_") || k.startsWith("dynx_") || k === "pcat" || k === "pagetype") {
        if (!eventParams.hasOwnProperty(k)) eventParams[k] = toNum(v);
      }
    }

    // Extract items from data param and/or direct params
    const itemId = dataMap.get("id") || p.get("item_id") || p.get("prodid") ||
                   p.get("dynx_itemid") || p.get("ecomm_prodid") || "";
    if (itemId) {
      let ids = [];
      try {
        const parsed = JSON.parse(itemId);
        ids = Array.isArray(parsed) ? parsed : [itemId];
      } catch {
        if (itemId.includes(",")) {
          ids = itemId.split(",").map((s) => s.trim()).filter(Boolean);
        } else {
          ids = [itemId];
        }
      }
      for (const id of ids) {
        const item = { item_id: String(id) };
        const qty = dataMap.get("quantity") || "";
        if (qty) item.quantity = toNum(qty);
        const pr = dataMap.get("price") || "";
        if (pr) item.price = toNum(pr);
        const nm = dataMap.get("name") || dataMap.get("item_name") || "";
        if (nm) item.item_name = nm;
        const br = dataMap.get("brand") || dataMap.get("item_brand") || "";
        if (br) item.item_brand = br;
        const cat = dataMap.get("category") || dataMap.get("item_category") || "";
        if (cat) item.item_category = cat;
        items.push(item);
      }
    }
  }

  // ---------------------------------------------------------------
  // Extract Enhanced Conversion user data (hashed email, phone)
  // ---------------------------------------------------------------
  const userData = {};
  const rawEm = p.get("em") || dataMap.get("em") || "";
  const rawPh = p.get("ph") || dataMap.get("ph") || "";
  if (rawEm) userData.em = rawEm;
  if (rawPh) userData.ph = rawPh;

  const pageUrl = p.get("url") || "";
  const pageTitle = p.get("tiba") || "";

  let origin = details.initiator || "";
  if (!origin && pageUrl) {
    try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
  }

  let collectHost = "";
  try { collectHost = url.hostname; } catch { /* ignore */ }

  const payload = {
    event_name: eventName,
    conversion_id: conversionId ? "AW-" + conversionId : "",
    conversion_label: p.get("label") || "",
    measurement_id: "",
    client_id: "",
    session_id: "",
    page_location: pageUrl,
    page_title: pageTitle,
    page_referrer: "",
    user_properties: {},
    event_params: eventParams,
    items: items,
    user_data: Object.keys(userData).length ? userData : null,
  };

  return [{
    eventName,
    source: "gads",
    payload,
    timestamp: details.timeStamp || Date.now(),
    url: details.url,
    tabId: details.tabId,
    method: details.method || "GET",
    origin,
    collectHost,
    consent: extractConsent(p),
  }];
}

// ---------------------------------------------------------------------------
// Facebook Pixel detection & parsing
// ---------------------------------------------------------------------------

/** Facebook Pixel sends events to www.facebook.com/tr/ (or /tr without slash). */
const FB_PATH_RE = /^\/tr\/?$/;
const FB_HOSTS = new Set([
  "www.facebook.com",
]);

/** Facebook ecommerce event names (PascalCase, as sent by fbq). */
const FB_ECOMMERCE_EVENTS = new Set([
  "PageView",
  "ViewContent",
  "AddToCart",
  "AddToWishlist",
  "InitiateCheckout",
  "AddPaymentInfo",
  "Purchase",
  "Search",
]);

/**
 * Determines whether a request URL points to a Facebook Pixel endpoint.
 *
 * Two-stage check:
 *   1. Hostname must be a known FB tracking host
 *   2. Path must be exactly /tr or /tr/
 */
function isFBPixel(url) {
  try {
    const u = new URL(url);
    if (!FB_HOSTS.has(u.hostname)) return false;
    return FB_PATH_RE.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Collect all params from a Facebook Pixel request.
 * Merges URL query params with POST body (form data or raw).
 * Facebook sends via image pixel (GET) or sendBeacon (POST).
 */
function collectFBParams(details) {
  const url = new URL(details.url);
  const merged = new URLSearchParams(url.searchParams);

  if (details.requestBody) {
    if (details.requestBody.formData) {
      for (const [key, vals] of Object.entries(details.requestBody.formData)) {
        for (const v of vals) merged.set(key, v);
      }
    }
    if (details.requestBody.raw && details.requestBody.raw.length) {
      try {
        const dec = new TextDecoder("utf-8");
        const text = details.requestBody.raw
          .map((chunk) => (chunk.bytes ? dec.decode(chunk.bytes) : ""))
          .join("");
        if (text.trim()) {
          const bodyP = new URLSearchParams(text.trim());
          for (const [k, v] of bodyP) merged.set(k, v);
        }
      } catch { /* ignore decode errors */ }
    }
  }

  return merged;
}

/**
 * Parse a Facebook Pixel request.
 *
 * Key parameters:
 *   - ev        → event name (ViewContent, AddToCart, Purchase, etc.)
 *   - id        → pixel ID
 *   - dl        → document location (page URL)
 *   - rl        → referrer
 *   - cd[...]   → custom data (cd[value], cd[currency], cd[contents], etc.)
 *   - pmd[...]  → product metadata (pmd[contents] has name, brand, description, etc.)
 *   - ap[...]   → automatic params (ap[contents] has mpn, item_price, availability, etc.)
 *   - fbp / fbc → browser/click IDs
 *
 * Items are merged from cd[contents], pmd[contents], and ap[contents].
 *
 * Returns only ecommerce ParsedEvent[].
 */
function parseFBRequest(details) {
  const p = collectFBParams(details);

  // Event name — from `ev` parameter
  const eventName = p.get("ev") || "";
  if (!eventName || !FB_ECOMMERCE_EVENTS.has(eventName)) return [];

  // Pixel ID — from `id` parameter
  const pixelId = p.get("id") || "";

  // Must have a pixel ID to be a valid FB pixel request
  if (!pixelId) return [];

  // ---------------------------------------------------------------
  // Extract all param groups: cd[...], pmd[...], ap[...]
  // ---------------------------------------------------------------
  const customData = {};   // cd[key] — custom data (ecommerce values)
  const pmdData = {};      // pmd[key] — product metadata (name, brand, desc)
  const apData = {};       // ap[key] — automatic params (price, availability)
  const udData = {};       // ud[key] — user data / Advanced Matching (hashed email, phone)

  for (const [key, val] of p) {
    let m;
    if ((m = key.match(/^cd\[(.+)\]$/)))  customData[m[1]] = val;
    else if ((m = key.match(/^pmd\[(.+)\]$/))) pmdData[m[1]] = val;
    else if ((m = key.match(/^ap\[(.+)\]$/)))  apData[m[1]] = val;
    else if ((m = key.match(/^ud\[(.+)\]$/)))  udData[m[1]] = val;
  }

  // Build event params from cd[...] keys
  const eventParams = {};
  if (customData.value) eventParams.value = toNum(customData.value);
  if (customData.currency) eventParams.currency = customData.currency;
  if (customData.order_id) eventParams.order_id = customData.order_id;
  if (customData.content_type) eventParams.content_type = customData.content_type;
  if (customData.content_name) eventParams.content_name = customData.content_name;
  if (customData.content_category) eventParams.content_category = customData.content_category;
  if (customData.num_items) eventParams.num_items = toNum(customData.num_items);
  if (customData.search_string) eventParams.search_string = customData.search_string;

  // Capture ALL remaining cd[...] params
  for (const [k, v] of Object.entries(customData)) {
    if (k === "contents" || k === "content_ids") continue;
    if (!eventParams.hasOwnProperty(k)) eventParams[k] = toNum(v);
  }

  // Capture pmd[...] event-level params (locale, description, etc.)
  for (const [k, v] of Object.entries(pmdData)) {
    if (k === "contents") continue; // items, handled below
    if (!eventParams.hasOwnProperty(k)) eventParams["pmd_" + k] = v;
  }

  // Capture ap[...] event-level params (currency, etc.)
  for (const [k, v] of Object.entries(apData)) {
    if (k === "contents") continue; // items, handled below
    if (!eventParams.hasOwnProperty(k)) eventParams["ap_" + k] = toNum(v);
  }

  // ---------------------------------------------------------------
  // Parse items from all three sources and merge by item_id
  // ---------------------------------------------------------------

  /** Map a raw FB item object to our normalised shape. */
  function mapFBItem(it) {
    const mapped = {};
    for (const [k, v] of Object.entries(it)) {
      if (k === "id")         mapped.item_id = String(v);
      else if (k === "ids")   mapped.item_id = Array.isArray(v) ? String(v[0]) : String(v);
      else if (k === "item_price") mapped.price = toNum(v);
      else if (k === "quantity")   mapped.quantity = toNum(v);
      else if (k === "name")       mapped.item_name = String(v);
      else if (k === "brand")      mapped.item_brand = String(v);
      else if (k === "mpn")        mapped.mpn = String(v);
      else if (k === "availability") mapped.availability = String(v);
      else if (typeof v === "object" && v !== null) mapped[k] = JSON.stringify(v);
      else mapped[k] = v;
    }
    return mapped;
  }

  /** Parse a JSON contents string into an array of mapped items. */
  function parseFBContents(raw) {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(mapFBItem);
    } catch { /* ignore */ }
    return [];
  }

  // Parse each source
  const cdItems  = parseFBContents(customData.contents);
  const pmdItems = parseFBContents(pmdData.contents);
  const apItems  = parseFBContents(apData.contents);

  // Merge all items into a single map keyed by item_id
  const itemMap = {};
  function mergeInto(list) {
    for (const it of list) {
      const id = it.item_id || "";
      if (!id) continue;
      if (!itemMap[id]) itemMap[id] = {};
      for (const [k, v] of Object.entries(it)) {
        if (v != null && v !== "" && !itemMap[id].hasOwnProperty(k)) {
          itemMap[id][k] = v;
        }
      }
    }
  }
  // Merge order: pmd first (richest metadata), then ap (price/availability), then cd
  mergeInto(pmdItems);
  mergeInto(apItems);
  mergeInto(cdItems);

  let items = Object.values(itemMap);

  // Fallback: cd[content_ids] if no items from any contents source
  if (!items.length && customData.content_ids) {
    try {
      const ids = JSON.parse(customData.content_ids);
      if (Array.isArray(ids)) {
        items = ids.map((id) => ({ item_id: String(id) }));
        // Try to enrich from pmd/ap even without contents
        mergeInto(pmdItems);
        mergeInto(apItems);
        if (Object.keys(itemMap).length) items = Object.values(itemMap);
      }
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------
  // Build event
  // ---------------------------------------------------------------
  const pageUrl = p.get("dl") || "";
  const pageReferrer = p.get("rl") || "";

  let origin = details.initiator || "";
  if (!origin && pageUrl) {
    try { origin = new URL(pageUrl).origin; } catch { /* ignore */ }
  }

  // Build user_data from ud[...] params (Advanced Matching)
  const userData = {};
  if (udData.em) userData.em = udData.em;
  if (udData.ph) userData.ph = udData.ph;

  const payload = {
    event_name: eventName,
    pixel_id: pixelId,
    measurement_id: "",
    client_id: p.get("fbp") || "",
    session_id: "",
    page_location: pageUrl,
    page_title: "",
    page_referrer: pageReferrer,
    user_properties: {},
    event_params: eventParams,
    items: items,
    user_data: Object.keys(userData).length ? userData : null,
  };

  return [{
    eventName,
    source: "fb",
    payload,
    timestamp: details.timeStamp || Date.now(),
    url: details.url,
    tabId: details.tabId,
    method: details.method || "GET",
    origin,
    collectHost: "www.facebook.com",
    consent: null,
  }];
}

// ---------------------------------------------------------------------------
// webRequest listener  (observe-only — never blocks or modifies requests)
// ---------------------------------------------------------------------------

/**
 * URL filter patterns:
 *
 * The *:// prefix covers both http (dev) and https (prod).
 * The wildcard host (*) lets us catch sGTM / first-party proxy domains
 * in addition to standard Google-owned hosts.
 *
 * The path portion narrows the filter so this listener does NOT fire for
 * every single network request — only those whose path starts with
 * /g/collect, /j/collect, /debug/mp/collect, /pagead/conversion, or /tr.
 *
 * Inside the callback, detection functions do second-stage checks
 * to reject false positives.
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;

    let events = [];
    if (isGA4Collect(details.url)) {
      events = parseGA4Request(details);
    } else if (isGAdsConversion(details.url)) {
      events = parseGAdsRequest(details);
    } else if (isGAdsPageview(details.url)) {
      events = parseGAdsPageview(details);
    } else if (isFBPixel(details.url)) {
      events = parseFBRequest(details);
    }
    if (!events.length) return;

    const tabId = details.tabId;
    const newEvents = events.filter(evt => !isDuplicate(tabId, evt));
    if (!newEvents.length) return;

    // Capture message types before enqueue (enqueue may delete _replaces)
    const msgTypes = newEvents.map(evt => evt._replaces ? "REPLACE_EVENT" : "NEW_EVENT");

    for (const evt of newEvents) enqueueWrite(tabId, evt);

    _writeQueues[tabId].then(async () => {
      await updateBadge(tabId);
      for (let i = 0; i < newEvents.length; i++) {
        chrome.runtime.sendMessage({ type: msgTypes[i], event: newEvents[i], tabId }).catch(() => {});
      }
    });
  },
  {
    urls: [
      // ---- GA4: wildcard host catches sGTM, custom proxy domains ----
      "*://*/g/collect*",
      "*://*/g/collect?*",
      "*://*/j/collect*",
      "*://*/j/collect?*",
      "*://*/debug/mp/collect*",
      "*://*/debug/mp/collect?*",
      // ---- Google Ads conversion tracking (wildcard host for full coverage) ----
      "*://*/pagead/conversion/*",
      "*://*/pagead/1p-conversion/*",
      "*://*/pagead/viewthroughconversion/*",
      // ---- Google Ads config/remarketing/landing (specific hosts only) ----
      "*://www.googleadservices.com/pagead/*",
      "*://googleads.g.doubleclick.net/pagead/*",
      "*://pagead2.googlesyndication.com/pagead/*",
      // ---- Facebook Pixel ----
      "*://www.facebook.com/tr/*",
      "*://www.facebook.com/tr?*",
    ],
  },
  ["requestBody"]
);

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

async function updateBadge(tabId) {
  try {
    const data = await loadTab(tabId);
    const n = data.events.length;
    await chrome.action.setBadgeText({ text: n > 0 ? String(n) : "", tabId });
    await chrome.action.setBadgeBackgroundColor({ color: "#301B92", tabId });
    await chrome.action.setBadgeTextColor({ color: "#ffffff", tabId });
  } catch { /* tab may have closed */ }
}

// ---------------------------------------------------------------------------
// Message handling  (popup ↔ background)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_EVENTS") {
    loadTab(msg.tabId).then((data) => sendResponse({ events: data.events }));
    return true;
  }
  if (msg.type === "CLEAR_EVENTS") {
    clearTab(msg.tabId).then(() => {
      updateBadge(msg.tabId);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === "EXPORT_EVENTS") {
    loadTab(msg.tabId).then((data) => sendResponse({ events: data.events }));
    return true;
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTab(tabId);
  delete _writeQueues[tabId];
  clearDedupCache(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearDedupCache(tabId);
  }
});

chrome.runtime.onStartup.addListener(restoreBadges);
chrome.runtime.onInstalled.addListener(restoreBadges);

async function restoreBadges() {
  const all = await chrome.storage.local.get(null);
  const tabs = await chrome.tabs.query({});
  const openIds = new Set(tabs.map((t) => t.id));
  for (const key of Object.keys(all)) {
    if (!key.startsWith("tab_")) continue;
    const tabId = parseInt(key.slice(4), 10);
    if (openIds.has(tabId)) {
      updateBadge(tabId);
    } else {
      chrome.storage.local.remove(key);
    }
  }
}
