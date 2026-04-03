/**
 * Popup UI Controller
 *
 * Fetches persisted events from background for the active tab, renders
 * them as expandable cards, and listens for new events in real-time.
 */

(function () {
  "use strict";

  // --- State ---
  let events = [];
  let activeFilter = "all";
  let expandedCards = new Set();
  let currentTabId = null;
  let activeSource = "all";
  let checkViewActive = false;
  let insightsViewActive = false;
  let consentViewActive = false;
  let pixelViewActive = false;

  /** Identity fingerprint — mirrors background.js identityFingerprint(). */
  function _identityFP(e) {
    const p = e.payload;
    if (e.source === "ga4")  return `ga4|${p.measurement_id}|${p.event_name}`;
    if (e.source === "gads") return `gads|${p.conversion_id}|${p.conversion_label}|${p.event_name}`;
    if (e.source === "fb")   return `fb|${p.pixel_id}|${p.event_name}`;
    return e.url;
  }

  // --- Platform icons (shared between card rendering, check matrix, insights) ---
  const GA4_ICON = '<svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="9" width="3" height="6" rx="1"/><rect x="6.5" y="5" width="3" height="10" rx="1"/><rect x="12" y="1" width="3" height="14" rx="1"/></svg>';
  const GADS_ICON = '<svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 4.5l5 8h3l-5-8z"/><path d="M9.5 4.5l5 8h-3l-5-8z"/><circle cx="12" cy="12" r="2"/></svg>';
  const FB_ICON = '<svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><path d="M16 8a8 8 0 10-9.25 7.9v-5.59H4.72V8h2.03V6.27c0-2 1.2-3.12 3.02-3.12.88 0 1.8.16 1.8.16v1.97h-1.01c-1 0-1.31.62-1.31 1.26V8h2.22l-.36 2.31H9.25v5.59A8 8 0 0016 8z"/></svg>';

  const CHECK_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
  const LIST_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
  const INSIGHTS_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
  const CONSENT_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  const PIXEL_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M12 2a10 10 0 0 1 10 10"/><path d="M12 6a6 6 0 0 1 6 6"/><path d="M12 2a10 10 0 0 0-10 10"/><path d="M12 6a6 6 0 0 0-6 6"/></svg>';

  // --- Check matrix config ---
  const CHECK_MATRIX = [
    { key: "pageview", label: "Page View", events: ["page_view","PageView"], color: "--color-pageview" },
    { key: "view", label: "View", events: ["view_item","view_item_list","select_item","ViewContent","Search","AddToWishlist"], color: "--color-view" },
    { key: "cart", label: "Cart", events: ["add_to_cart","remove_from_cart","view_cart","AddToCart"], color: "--color-cart" },
    { key: "checkout", label: "Checkout", events: ["begin_checkout","add_shipping_info","add_payment_info","InitiateCheckout","AddPaymentInfo"], color: "--color-checkout" },
    { key: "purchase", label: "Purchase", events: ["purchase","Purchase"], color: "--color-purchase" },
    { key: "conversion", label: "Conversion", events: ["conversion"], color: "--color-gads" },
  ];

  const PLATFORMS = [
    { key: "ga4", label: "GA4", color: "--purple-light", dim: "--purple-dim", icon: GA4_ICON },
    { key: "gads", label: "Google Ads", color: "--gold", dim: "--gold-dim", icon: GADS_ICON },
    { key: "fb", label: "Meta", color: "--fb-blue", dim: "--fb-dim", icon: FB_ICON },
  ];

  // --- Insights config ---
  const INSIGHTS_STAGES = [
    { key: "pageview", label: "Page View", ga4: ["page_view"], fb: ["PageView"], gads: ["page_view"], color: "--color-pageview" },
    { key: "view", label: "View Item", ga4: ["view_item"], fb: ["ViewContent"], gads: ["view_item"], color: "--color-view" },
    { key: "cart", label: "Add to Cart", ga4: ["add_to_cart"], fb: ["AddToCart"], gads: ["add_to_cart"], color: "--color-cart" },
    { key: "checkout", label: "Begin Checkout", ga4: ["begin_checkout"], fb: ["InitiateCheckout"], gads: ["begin_checkout"], color: "--color-checkout" },
    { key: "purchase", label: "Purchase", ga4: ["purchase"], fb: ["Purchase"], gads: ["purchase"], color: "--color-purchase" },
  ];

  // --- DOM ---
  const eventList = document.getElementById("eventList");
  const emptyState = document.getElementById("emptyState");
  const countAll = document.getElementById("countAll");
  const pageUrl = document.getElementById("pageUrl");
  const clearBtn = document.getElementById("clearBtn");
  const exportBtn = document.getElementById("exportBtn");
  const filterChips = document.querySelectorAll(".filter-chip");
  const statusText = document.getElementById("statusText");
  const sourceButtons = document.querySelectorAll(".source-btn");
  const checkViewBtn = document.getElementById("checkViewBtn");
  const insightsViewBtn = document.getElementById("insightsViewBtn");
  const consentViewBtn = document.getElementById("consentViewBtn");
  const pixelViewBtn = document.getElementById("pixelViewBtn");
  const sourceToggle = document.querySelector(".source-toggle");
  const filtersBar = document.querySelector(".filters");

  const FILTER_MAP = {
    all: null,
    page_view: ["page_view", "PageView"],
    view_item: ["view_item", "view_item_list", "select_item", "ViewContent", "Search", "AddToWishlist"],
    add_to_cart: ["add_to_cart", "remove_from_cart", "view_cart", "AddToCart"],
    begin_checkout: ["begin_checkout", "add_shipping_info", "add_payment_info", "InitiateCheckout", "AddPaymentInfo"],
    purchase: ["purchase", "Purchase"],
  };

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    currentTabId = tab.id;

    try {
      const url = new URL(tab.url);
      pageUrl.textContent = url.hostname + url.pathname;
      statusText.textContent = "Listening on " + url.hostname;
    } catch {
      pageUrl.textContent = "Ecommerce Events";
      statusText.textContent = "Listening for GA4, Google Ads & Meta events\u2026";
    }

    chrome.runtime.sendMessage(
      { type: "GET_EVENTS", tabId: currentTabId },
      (response) => {
        if (chrome.runtime.lastError || !response) return;
        events = response.events || [];
        render();
      }
    );
  }

  // ------------------------------------------------------------------
  // Real-time updates
  // ------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.tabId !== currentTabId) return;
    if (msg.type === "NEW_EVENT") {
      events.push(msg.event);
      render();
      if (!checkViewActive && !insightsViewActive && !consentViewActive && !pixelViewActive) {
        requestAnimationFrame(() => { eventList.scrollTop = 0; });
      }
    } else if (msg.type === "REPLACE_EVENT") {
      const fp = _identityFP(msg.event);
      // Find the sparser match to replace (lowest event_params count)
      let bestIdx = -1, bestScore = Infinity;
      for (let i = 0; i < events.length; i++) {
        if (_identityFP(events[i]) !== fp) continue;
        const ep = events[i].payload.event_params || {};
        const s = Object.keys(ep).length + (events[i].payload.items || []).length;
        if (s < bestScore) { bestScore = s; bestIdx = i; }
      }
      if (bestIdx >= 0) events[bestIdx] = msg.event; else events.push(msg.event);
      render();
    }
  });

  // ------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------

  filterChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      filterChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeFilter = chip.dataset.filter;

      if (checkViewActive) exitCheckView();
      if (insightsViewActive) exitInsightsView();
      if (consentViewActive) exitConsentView();
      if (pixelViewActive) exitPixelView();

      render();
    });
  });

  sourceButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      sourceButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeSource = btn.dataset.source;
      render();
    });
  });

  // --- Check Events toggle ---
  checkViewBtn.addEventListener("click", () => {
    if (insightsViewActive) exitInsightsView();
    if (consentViewActive) exitConsentView();
    if (pixelViewActive) exitPixelView();

    checkViewActive = !checkViewActive;
    checkViewBtn.classList.toggle("active", checkViewActive);
    checkViewBtn.innerHTML = checkViewActive
      ? LIST_ICON_SVG + " Event List"
      : CHECK_ICON_SVG + " Check Events";

    sourceToggle.classList.toggle("hidden", checkViewActive);

    if (checkViewActive) {
      activeSource = "all";
      sourceButtons.forEach((b) => b.classList.remove("active"));
      document.querySelector('.source-btn[data-source="all"]').classList.add("active");
    }

    render();
  });

  function exitCheckView() {
    checkViewActive = false;
    checkViewBtn.classList.remove("active");
    checkViewBtn.innerHTML = CHECK_ICON_SVG + " Check Events";
    sourceToggle.classList.remove("hidden");
  }

  // --- Insights toggle ---
  insightsViewBtn.addEventListener("click", () => {
    if (checkViewActive) exitCheckView();
    if (consentViewActive) exitConsentView();
    if (pixelViewActive) exitPixelView();

    insightsViewActive = !insightsViewActive;
    insightsViewBtn.classList.toggle("active", insightsViewActive);
    insightsViewBtn.innerHTML = insightsViewActive
      ? LIST_ICON_SVG + " Event List"
      : INSIGHTS_ICON_SVG + " Insights";

    sourceToggle.classList.toggle("hidden", insightsViewActive);

    if (insightsViewActive) {
      activeSource = "all";
      sourceButtons.forEach((b) => b.classList.remove("active"));
      document.querySelector('.source-btn[data-source="all"]').classList.add("active");
    }

    render();
  });

  function exitInsightsView() {
    insightsViewActive = false;
    insightsViewBtn.classList.remove("active");
    insightsViewBtn.innerHTML = INSIGHTS_ICON_SVG + " Insights";
    sourceToggle.classList.remove("hidden");
  }

  // --- Consent toggle ---
  consentViewBtn.addEventListener("click", () => {
    if (checkViewActive) exitCheckView();
    if (insightsViewActive) exitInsightsView();
    if (pixelViewActive) exitPixelView();

    consentViewActive = !consentViewActive;
    consentViewBtn.classList.toggle("active", consentViewActive);
    consentViewBtn.innerHTML = consentViewActive
      ? LIST_ICON_SVG + " Event List"
      : CONSENT_ICON_SVG + " Consent";

    sourceToggle.classList.toggle("hidden", consentViewActive);
    filtersBar.classList.toggle("hidden", consentViewActive);

    if (consentViewActive) {
      activeSource = "all";
      sourceButtons.forEach((b) => b.classList.remove("active"));
      document.querySelector('.source-btn[data-source="all"]').classList.add("active");
    }

    render();
  });

  function exitConsentView() {
    consentViewActive = false;
    consentViewBtn.classList.remove("active");
    consentViewBtn.innerHTML = CONSENT_ICON_SVG + " Consent";
    sourceToggle.classList.remove("hidden");
    filtersBar.classList.remove("hidden");
  }

  // --- Pixel Inspector toggle ---
  pixelViewBtn.addEventListener("click", () => {
    if (checkViewActive) exitCheckView();
    if (insightsViewActive) exitInsightsView();
    if (consentViewActive) exitConsentView();

    pixelViewActive = !pixelViewActive;
    pixelViewBtn.classList.toggle("active", pixelViewActive);
    pixelViewBtn.innerHTML = pixelViewActive
      ? LIST_ICON_SVG + " Event List"
      : PIXEL_ICON_SVG + " Pixels";

    sourceToggle.classList.toggle("hidden", pixelViewActive);
    filtersBar.classList.toggle("hidden", pixelViewActive);

    if (pixelViewActive) {
      activeSource = "all";
      sourceButtons.forEach((b) => b.classList.remove("active"));
      document.querySelector('.source-btn[data-source="all"]').classList.add("active");
    }

    render();
  });

  function exitPixelView() {
    pixelViewActive = false;
    pixelViewBtn.classList.remove("active");
    pixelViewBtn.innerHTML = PIXEL_ICON_SVG + " Pixels";
    sourceToggle.classList.remove("hidden");
    filtersBar.classList.remove("hidden");
  }

  clearBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "CLEAR_EVENTS", tabId: currentTabId }, () => {
      events = [];
      expandedCards.clear();
      render();
    });
  });

  exportBtn.addEventListener("click", () => {
    const html = generateReport();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  });

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  function getFilteredEvents() {
    let filtered = events;

    if (activeSource !== "all") {
      filtered = filtered.filter((e) => (e.source || "ga4") === activeSource);
    }

    if (activeFilter !== "all") {
      const allowed = FILTER_MAP[activeFilter];
      if (allowed) filtered = filtered.filter((e) => allowed.includes(e.eventName));
    }

    return filtered;
  }

  function render() {
    countAll.textContent = events.length;

    if (pixelViewActive) {
      renderPixelView();
      return;
    }

    if (consentViewActive) {
      renderConsentView();
      return;
    }

    if (insightsViewActive) {
      renderInsightsView();
      return;
    }

    if (checkViewActive) {
      renderCheckMatrix();
      return;
    }

    const filtered = getFilteredEvents();

    if (filtered.length === 0) {
      eventList.innerHTML = "";
      eventList.appendChild(emptyState);
      emptyState.style.display = "flex";
      return;
    }

    emptyState.style.display = "none";

    const reversed = [...filtered].reverse();
    eventList.innerHTML = reversed
      .map((e, ri) => createEventCard(e, filtered.length - 1 - ri))
      .join("");

    eventList.querySelectorAll(".event-header").forEach((h) =>
      h.addEventListener("click", () => toggleCard(h))
    );
    eventList.querySelectorAll(".detail-tab").forEach((t) =>
      t.addEventListener("click", onTabClick)
    );
    eventList.querySelectorAll(".copy-btn").forEach((b) =>
      b.addEventListener("click", onCopyClick)
    );
  }

  // ------------------------------------------------------------------
  // Consent View
  // ------------------------------------------------------------------

  const CONSENT_CATEGORIES = [
    { key: "ad_storage", label: "ad_storage" },
    { key: "analytics_storage", label: "analytics_storage" },
    { key: "ad_user_data", label: "ad_user_data" },
    { key: "ad_personalization", label: "ad_personalization" },
  ];

  const CONSENT_PLATFORMS = [
    { key: "ga4", label: "GA4", icon: GA4_ICON, color: "--purple-light" },
    { key: "gads", label: "Google Ads", icon: GADS_ICON, color: "--gold" },
  ];

  function getLatestConsent(source) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].source === source && events[i].consent && events[i].consent.gcd) {
        return events[i].consent;
      }
    }
    return null;
  }

  function getAllConsentSnapshots(source) {
    const snapshots = [];
    for (const evt of events) {
      if (evt.source === source && evt.consent && evt.consent.gcd) {
        snapshots.push({ consent: evt.consent, timestamp: evt.timestamp, eventName: evt.eventName });
      }
    }
    return snapshots;
  }

  function consentPillHTML(state) {
    const labels = { granted: "Granted", denied: "Denied", not_set: "Not Set", unknown: "Unknown" };
    const cls = state === "granted" ? "granted" : state === "denied" ? "denied" : "unknown";
    return '<span class="cv-pill cv-pill-' + cls + '">' + (labels[state] || "Unknown") + "</span>";
  }

  /**
   * GCD update codes — these letters indicate the consent state resulted
   * from a consent update (user interacted with the CMP banner).
   * r = default denied → updated to granted
   * n = granted (update only)
   * v = granted (default + update)
   */
  const GCD_UPDATE_GRANTED = new Set(["r", "n", "v"]);

  function detectConsentChanges() {
    const changes = [];
    for (const plat of CONSENT_PLATFORMS) {
      const snaps = getAllConsentSnapshots(plat.key);
      if (snaps.length < 2) continue;
      for (let i = 1; i < snaps.length; i++) {
        for (const cat of CONSENT_CATEGORIES) {
          const prev = snaps[i - 1].consent.gcd[cat.key];
          const curr = snaps[i].consent.gcd[cat.key];
          if (!prev || !curr || prev.state === curr.state) continue;

          // Skip when previous had no consent signals (consent mode not loaded yet)
          if (prev.state === "not_set" || curr.state === "not_set") continue;

          // Skip normal CMP flow: denied → granted via consent update
          if (prev.state === "denied" && curr.state === "granted" &&
              curr.code && GCD_UPDATE_GRANTED.has(curr.code.toLowerCase())) continue;

          changes.push({
            platform: plat.label,
            category: cat.label,
            from: prev.state,
            to: curr.state,
            eventName: snaps[i].eventName,
          });
        }
      }
    }
    return changes;
  }

  // ------------------------------------------------------------------
  // Pixel Inspector
  // ------------------------------------------------------------------

  function collectPixelData() {
    const platforms = {
      ga4:  { ids: {} },
      gads: { ids: {} },
      fb:   { ids: {} },
    };

    for (const evt of events) {
      const src = evt.source;
      if (!platforms[src]) continue;

      let id = null;
      if (src === "ga4")  id = evt.payload.measurement_id;
      if (src === "gads") id = evt.payload.conversion_id;
      if (src === "fb")   id = evt.payload.pixel_id;

      if (!id) continue;

      if (!platforms[src].ids[id]) {
        platforms[src].ids[id] = {
          endpoints: new Set(),
          eventCount: 0,
          eventNames: new Set(),
          conversionLabels: new Set(),
        };
      }

      const entry = platforms[src].ids[id];
      entry.eventCount++;

      try {
        entry.endpoints.add(new URL(evt.url).hostname);
      } catch (_) { /* malformed URL */ }

      if (evt.payload.event_name) {
        entry.eventNames.add(evt.payload.event_name);
      }

      if (src === "gads" && evt.payload.conversion_label) {
        entry.conversionLabels.add(evt.payload.conversion_label);
      }
    }

    return platforms;
  }

  function renderPixelView() {
    const WARN_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    const RADAR_SVG = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M12 2a10 10 0 0 1 10 10"/><path d="M12 6a6 6 0 0 1 6 6"/><path d="M12 2a10 10 0 0 0-10 10"/><path d="M12 6a6 6 0 0 0-6 6"/></svg>';

    emptyState.style.display = "none";

    if (!events.length) {
      eventList.innerHTML =
        '<div class="pv-empty">' + RADAR_SVG +
        '<p class="pv-empty-title">No events captured yet</p>' +
        '<p class="pv-empty-text">Navigate to a page with tracking pixels to inspect detected IDs and endpoints.</p></div>';
      return;
    }

    const data = collectPixelData();
    const totalIds = Object.values(data).reduce((sum, p) => sum + Object.keys(p.ids).length, 0);

    if (totalIds === 0) {
      eventList.innerHTML =
        '<div class="pv-empty">' + RADAR_SVG +
        '<p class="pv-empty-title">No tracking IDs detected</p>' +
        '<p class="pv-empty-text">Events were captured but no measurement IDs, conversion IDs, or pixel IDs could be extracted.</p></div>';
      return;
    }

    let html = '<div class="pixel-view">';

    for (const plat of PLATFORMS) {
      const platData = data[plat.key];
      const ids = Object.keys(platData.ids);
      if (ids.length === 0) continue;

      html += '<div class="pv-section">';

      // Section header
      html += '<div class="pv-section-header">';
      html += '<span class="pv-platform-name" style="color:var(' + plat.color + ')">' + plat.icon + ' ' + plat.label + '</span>';
      html += '<span class="pv-id-count">' + ids.length + ' ID' + (ids.length > 1 ? 's' : '') + '</span>';
      html += '</div>';

      // Multiple ID warning
      if (ids.length > 1) {
        html += '<div class="pv-warning">' + WARN_SVG + ' <span>Multiple ' + esc(plat.label) + ' IDs detected: <strong>' + ids.map(i => esc(i)).join(', ') + '</strong>. This may indicate misconfiguration or intentional multi-property tracking.</span></div>';
      }

      // ID cards
      for (const id of ids) {
        const info = platData.ids[id];
        html += '<div class="pv-id-card">';
        html += '<div class="pv-id-value">' + esc(id) + '</div>';

        // Endpoints
        html += '<div class="pv-id-meta"><span class="pv-meta-label">Endpoints</span>';
        for (const ep of info.endpoints) {
          html += '<span class="pv-endpoint">' + esc(ep) + '</span>';
        }
        html += '</div>';

        // Events
        html += '<div class="pv-id-meta"><span class="pv-meta-label">Events</span>' + info.eventCount + ' total (' + [...info.eventNames].map(n => esc(n)).join(', ') + ')</div>';

        // GAds: conversion labels
        if (plat.key === "gads" && info.conversionLabels.size > 0) {
          html += '<div class="pv-id-meta"><span class="pv-meta-label">Labels</span>';
          for (const label of info.conversionLabels) {
            html += '<span class="pv-endpoint">' + esc(label) + '</span>';
          }
          html += '</div>';
        }

        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div>';
    eventList.innerHTML = html;
  }

  function renderConsentView() {
    const ga4Consent = getLatestConsent("ga4");
    const gadsConsent = getLatestConsent("gads");
    const hasAny = ga4Consent || gadsConsent;

    // Empty state
    if (!events.length) {
      eventList.innerHTML = '<div class="cv-empty"><div class="cv-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><p class="cv-empty-title">No events captured yet</p><p class="cv-empty-text">Navigate to a page with Google tracking to see consent signals.</p></div>';
      emptyState.style.display = "none";
      return;
    }

    if (!hasAny) {
      eventList.innerHTML = '<div class="cv-empty"><div class="cv-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div><p class="cv-empty-title">No consent signals detected</p><p class="cv-empty-text">The site may not have implemented Google Consent Mode v2, or no gcd/gcs parameters were found in the intercepted requests.</p></div>';
      emptyState.style.display = "none";
      return;
    }

    emptyState.style.display = "none";
    let html = '<div class="consent-view">';

    // --- Section 1: General Consent Status ---
    html += '<div class="cv-section"><div class="cv-section-title">General Consent Status</div>';
    for (const cat of CONSENT_CATEGORIES) {
      const ga4State = ga4Consent && ga4Consent.gcd ? ga4Consent.gcd[cat.key]?.state : null;
      const gadsState = gadsConsent && gadsConsent.gcd ? gadsConsent.gcd[cat.key]?.state : null;

      const states = [ga4State, gadsState].filter(Boolean);
      const unique = [...new Set(states)];

      html += '<div class="cv-row"><span class="cv-category">' + cat.label + "</span>";
      html += '<div class="cv-status">';

      if (unique.length === 0) {
        html += consentPillHTML("unknown");
      } else if (unique.length === 1) {
        html += consentPillHTML(unique[0]);
      } else {
        // Discrepancy
        html += '<span class="cv-pill cv-pill-discrepancy">Discrepancy</span>';
        html += '<span class="cv-discrepancy-detail">';
        if (ga4State) html += '<span style="color:var(--purple-light)">GA4:</span> ' + consentPillHTML(ga4State) + " ";
        if (gadsState) html += '<span style="color:var(--gold)">GAds:</span> ' + consentPillHTML(gadsState);
        html += "</span>";
      }

      html += "</div></div>";
    }
    html += "</div>";

    // --- Section 2: Platform Breakdown Grid ---
    html += '<div class="cv-grid">';
    // Header row
    html += '<div class="cv-grid-corner"></div>';
    for (const plat of CONSENT_PLATFORMS) {
      html += '<div class="cv-grid-header" style="color:var(' + plat.color + ')">' + plat.icon + " " + plat.label + "</div>";
    }
    // Category rows
    for (const cat of CONSENT_CATEGORIES) {
      html += '<div class="cv-grid-label">' + cat.label + "</div>";
      for (const plat of CONSENT_PLATFORMS) {
        const consent = plat.key === "ga4" ? ga4Consent : gadsConsent;
        const info = consent && consent.gcd ? consent.gcd[cat.key] : null;
        html += '<div class="cv-grid-cell">';
        if (info) {
          html += consentPillHTML(info.state);
          html += ' <span class="cv-code">(' + (info.code || "?") + ")</span>";
          if (info.inherited) html += ' <span class="cv-code" title="Inherited from another consent category">↗</span>';
        } else {
          html += '<span class="cv-pill cv-pill-unknown">—</span>';
        }
        html += "</div>";
      }
    }
    html += "</div>";

    // --- Section 3: Consent Changes ---
    const changes = detectConsentChanges();
    if (changes.length) {
      html += '<div class="cv-section"><div class="cv-section-title">Consent Changes During Session</div>';
      const warnSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      for (const c of changes) {
        html += '<div class="cv-change-warning">' + warnSvg + " <span><strong>" + c.category + "</strong> changed from <strong>" + c.from + "</strong> → <strong>" + c.to + "</strong> on " + c.platform + " (" + c.eventName + ")</span></div>";
      }
      html += "</div>";
    }

    // --- Section 4: Raw Values ---
    html += '<div class="cv-section"><div class="cv-section-title">Raw Consent Strings</div>';
    for (const plat of CONSENT_PLATFORMS) {
      const consent = plat.key === "ga4" ? ga4Consent : gadsConsent;
      if (!consent) continue;

      html += '<div class="cv-raw-block">';
      html += '<div class="cv-raw-label" style="color:var(' + plat.color + ')">' + plat.label + "</div>";

      if (consent.gcd) {
        html += '<div class="cv-raw-value">' + escAttr(consent.gcd.raw) + '</div>';
        html += '<div class="cv-raw-breakdown">';
        for (const cat of CONSENT_CATEGORIES) {
          const info = consent.gcd[cat.key];
          if (info && info.code) {
            html += "<span>" + cat.label + ":</span> " + info.code + " = " + info.meaning + "<br>";
          }
        }
        html += "</div>";
      }

      if (consent.gcs) {
        html += '<div style="margin-top:8px"><div class="cv-raw-value">' + escAttr(consent.gcs.raw) + ' <span class="cv-code">(gcs)</span></div>';
        html += '<div class="cv-raw-breakdown">';
        html += "<span>ad_storage:</span> " + consent.gcs.ad_storage + "<br>";
        html += "<span>analytics_storage:</span> " + consent.gcs.analytics_storage;
        html += "</div></div>";
      }

      html += "</div>";
    }
    html += "</div>";

    // --- Section 5: Info Note ---
    html += '<div class="cv-info-note"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><span>functionality_storage, security_storage, and personalization_storage are not transmitted in gcd/gcs parameters and cannot be detected from network requests.</span></div>';

    html += "</div>";
    eventList.innerHTML = html;
  }

  // ------------------------------------------------------------------
  // Check Matrix (unchanged)
  // ------------------------------------------------------------------

  function renderCheckMatrix() {
    const lookup = {};
    for (const p of PLATFORMS) lookup[p.key] = {};

    for (const evt of events) {
      const src = evt.source || "ga4";
      if (!lookup[src]) continue;
      lookup[src][evt.eventName] = (lookup[src][evt.eventName] || 0) + 1;
    }

    const checkSvg = '<svg class="cell-check-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const missSvg = '<svg class="cell-miss-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';

    let h = '<div class="check-matrix">';
    h += '<div class="cm-corner">Event</div>';
    for (const p of PLATFORMS) {
      h += '<div class="cm-header" style="color: var(' + p.color + ')">' + p.icon + ' ' + esc(p.label) + '</div>';
    }

    // Map which event names belong to which platform
    const PLATFORM_EVENTS = {
      ga4: new Set(["page_view","view_item","view_item_list","select_item","add_to_cart","remove_from_cart","view_cart","begin_checkout","add_shipping_info","add_payment_info","purchase"]),
      gads: new Set(["page_view","view_item","add_to_cart","begin_checkout","purchase","conversion"]),
      fb: new Set(["PageView","ViewContent","Search","AddToWishlist","AddToCart","InitiateCheckout","AddPaymentInfo","Purchase"]),
    };

    for (const cat of CHECK_MATRIX) {
      h += '<div class="cm-category"><span class="dot" style="background: var(' + cat.color + ')"></span>' + esc(cat.label) + '</div>';

      for (const p of PLATFORMS) {
        // Show N/A if this platform can't produce any events in this category
        const canMatch = cat.events.some((ev) => PLATFORM_EVENTS[p.key].has(ev));
        if (!canMatch) {
          h += '<div class="cm-cell cm-na"><span class="cm-na-text">N/A</span></div>';
          continue;
        }

        const matched = [];
        let total = 0;
        for (const evtName of cat.events) {
          const count = lookup[p.key][evtName] || 0;
          if (count > 0) {
            matched.push({ name: evtName, count: count });
            total += count;
          }
        }

        if (matched.length > 0) {
          h += '<div class="cm-cell cm-hit" style="background: var(' + p.dim + ')">';
          h += '<div class="cm-status">' + checkSvg + '<span class="cm-count">' + total + '</span></div>';
          h += '<div class="cm-details">';
          for (const m of matched) {
            h += '<div class="cm-evt">' + esc(m.name) + ' <span class="cm-evt-n">(' + m.count + ')</span></div>';
          }
          h += '</div></div>';
        } else {
          h += '<div class="cm-cell cm-miss"><div class="cm-status">' + missSvg + '</div></div>';
        }
      }
    }

    h += '</div>';
    emptyState.style.display = "none";
    eventList.innerHTML = h;
  }

  // ------------------------------------------------------------------
  // Insights — Analysis Engine
  // ------------------------------------------------------------------

  /** Score an event by how much data it carries (more = richer). */
  function eventDataScore(e) {
    let score = 0;
    const ep = e.payload.event_params || {};
    const items = e.payload.items || [];
    // Count non-empty event_params
    for (const v of Object.values(ep)) {
      if (v != null && v !== "") score++;
    }
    // Items contribute heavily — each item and its fields
    for (const it of items) {
      score += 1; // item existence
      for (const v of Object.values(it)) {
        if (v != null && v !== "") score++;
      }
    }
    // Bonus for user_data
    if (e.payload.user_data) {
      for (const v of Object.values(e.payload.user_data)) {
        if (v) score++;
      }
    }
    return score;
  }

  /**
   * Find the best event for insights: among all matching events for
   * this source+stage, pick the one with the richest data.
   * On tie, prefer the most recent (last in array).
   */
  function findBestEvent(source, eventNames) {
    if (!eventNames.length) return null;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if ((e.source || "ga4") !== source || !eventNames.includes(e.eventName)) continue;
      const s = eventDataScore(e);
      if (s >= bestScore) {
        bestScore = s;
        best = e;
      }
    }
    return best;
  }

  function extractFields(event) {
    if (!event) return null;
    const ep = event.payload.event_params || {};
    const items = event.payload.items || [];
    return {
      value: ep.value ?? null,
      currency: ep.currency ?? null,
      txnId: ep.transaction_id || ep.order_id || null,
      itemIds: items.map((i) => String(i.item_id || "")).filter(Boolean).sort(),
      itemCount: items.length,
      items: items,
      eventParams: ep,
      eventName: event.eventName,
      timestamp: event.timestamp,
      userData: event.payload.user_data || null,
    };
  }

  function roundVal(v) {
    return v != null ? Math.round(v * 100) / 100 : null;
  }

  // ------------------------------------------------------------------
  // Insights — Global Item ID Analysis
  // ------------------------------------------------------------------

  /** Scan ALL events and build platform → stage → Set<item_id>. */
  function collectItemIdsByStage() {
    const eventToStage = {};
    for (const stage of INSIGHTS_STAGES) {
      if (stage.key === "pageview") continue;
      for (const name of stage.ga4) eventToStage["ga4|" + name] = stage.key;
      for (const name of stage.gads) eventToStage["gads|" + name] = stage.key;
      for (const name of stage.fb) eventToStage["fb|" + name] = stage.key;
    }
    const result = { ga4: {}, gads: {}, fb: {} };
    for (const evt of events) {
      const src = evt.source || "ga4";
      const stageKey = eventToStage[src + "|" + evt.eventName];
      if (!stageKey) continue;
      const items = evt.payload.items || [];
      if (!items.length) continue;
      if (!result[src][stageKey]) result[src][stageKey] = new Set();
      for (const item of items) {
        const id = item.item_id;
        if (id != null && String(id) !== "") result[src][stageKey].add(String(id));
      }
    }
    return result;
  }

  /** Compare ID sets between two platforms using shared-stages logic. */
  function compareItemIdSets(insights, labelA, stagesA, labelB, stagesB) {
    const allStageKeys = new Set([...Object.keys(stagesA), ...Object.keys(stagesB)]);
    const sharedStages = [];
    for (const sk of allStageKeys) {
      if (stagesA[sk] && stagesA[sk].size > 0 && stagesB[sk] && stagesB[sk].size > 0) {
        sharedStages.push(sk);
      }
    }
    if (sharedStages.length === 0) return;
    const idsA = new Set();
    const idsB = new Set();
    for (const sk of sharedStages) {
      for (const id of stagesA[sk]) idsA.add(id);
      for (const id of stagesB[sk]) idsB.add(id);
    }
    const missingInB = [...idsA].filter((id) => !idsB.has(id));
    const missingInA = [...idsB].filter((id) => !idsA.has(id));
    if (missingInB.length === 0 && missingInA.length === 0) return;
    if (missingInB.length > 0) {
      insights.push({ severity: "warning", message: labelB + " missing ID(s) found in " + labelA + ": " + missingInB.join(", ") });
    }
    if (missingInA.length > 0) {
      insights.push({ severity: "warning", message: labelA + " missing ID(s) found in " + labelB + ": " + missingInA.join(", ") });
    }
  }

  /** Global cross-platform item ID analysis. */
  function analyzeItemIds() {
    const stageData = collectItemIdsByStage();
    const perPlatform = {};
    for (const plat of ["ga4", "gads", "fb"]) {
      const allIds = new Set();
      for (const sk of Object.keys(stageData[plat])) {
        for (const id of stageData[plat][sk]) allIds.add(id);
      }
      perPlatform[plat] = { allIds: allIds, stageIds: stageData[plat] };
    }
    const hasAnyItems = perPlatform.ga4.allIds.size > 0 || perPlatform.gads.allIds.size > 0 || perPlatform.fb.allIds.size > 0;
    if (!hasAnyItems) return { perPlatform: perPlatform, insights: [], maxSeverity: null, hasAnyItems: false };

    const insights = [];
    const activePlats = [];
    if (perPlatform.ga4.allIds.size > 0) activePlats.push({ key: "ga4", label: "GA4", data: perPlatform.ga4 });
    if (perPlatform.gads.allIds.size > 0) activePlats.push({ key: "gads", label: "GAds", data: perPlatform.gads });
    if (perPlatform.fb.allIds.size > 0) activePlats.push({ key: "fb", label: "Meta", data: perPlatform.fb });

    if (activePlats.length < 2) {
      insights.push({ severity: "info", message: "Only " + activePlats[0].label + " has item data \u2014 no cross-platform comparison possible" });
      return { perPlatform: perPlatform, insights: insights, maxSeverity: "info", hasAnyItems: true };
    }

    for (let i = 0; i < activePlats.length; i++) {
      for (let j = i + 1; j < activePlats.length; j++) {
        compareItemIdSets(insights, activePlats[i].label, activePlats[i].data.stageIds, activePlats[j].label, activePlats[j].data.stageIds);
      }
    }

    const maxSeverity = insights.some((i) => i.severity === "error") ? "error"
      : insights.some((i) => i.severity === "warning") ? "warning" : "ok";

    if (insights.length === 0) {
      insights.push({ severity: "ok", message: "All item IDs match across platforms" });
    }

    return { perPlatform: perPlatform, insights: insights, maxSeverity: maxSeverity, hasAnyItems: true };
  }

  function compareField(insights, field, labelA, valA, labelB, valB, sev) {
    if (valA == null && valB == null) return;
    if (valA == null || valB == null) {
      insights.push({ severity: "warning", message: field + " missing on " + (valA == null ? labelA : labelB) });
      return;
    }
    const a = field === "Value" ? roundVal(valA) : String(valA);
    const b = field === "Value" ? roundVal(valB) : String(valB);
    if (String(a) !== String(b)) {
      insights.push({ severity: sev || "error", message: field + " mismatch: " + labelA + "=" + valA + ", " + labelB + "=" + valB });
    }
  }

  /**
   * Compare items between two platforms.
   * Compares ALL properties that BOTH platforms have for matched items.
   */
  function compareItems(insights, labelA, dataA, labelB, dataB) {
    if (!dataA || !dataB) return;
    if (dataA.itemCount === 0 && dataB.itemCount === 0) return;
    // One has items, other doesn't
    if (dataA.itemCount > 0 && dataB.itemCount === 0) {
      insights.push({ severity: "info", message: labelB + " has no items (vs " + dataA.itemCount + " on " + labelA + ")" });
      return;
    }
    if (dataA.itemCount === 0 && dataB.itemCount > 0) {
      insights.push({ severity: "info", message: labelA + " has no items (vs " + dataB.itemCount + " on " + labelB + ")" });
      return;
    }
    // Both have items — compare counts
    if (dataA.itemCount !== dataB.itemCount) {
      insights.push({ severity: "warning", message: "Item count differs: " + labelA + "=" + dataA.itemCount + ", " + labelB + "=" + dataB.itemCount });
    }
    // Compare item IDs
    const idsA = dataA.itemIds.join(",");
    const idsB = dataB.itemIds.join(",");
    if (idsA !== idsB) {
      insights.push({ severity: "error", message: "Item IDs differ: " + labelA + "=[" + (dataA.itemIds.join(", ") || "none") + "], " + labelB + "=[" + (dataB.itemIds.join(", ") || "none") + "]" });
    } else if (idsA) {
      // IDs match — compare ALL shared properties per item
      const mapA = {};
      dataA.items.forEach((it) => { if (it.item_id) mapA[it.item_id] = it; });
      const mapB = {};
      dataB.items.forEach((it) => { if (it.item_id) mapB[it.item_id] = it; });
      // Skip internal/meta keys when comparing
      const skipKeys = new Set(["item_id"]);
      for (const id of dataA.itemIds) {
        const a = mapA[id], b = mapB[id];
        if (!a || !b) continue;
        // Find all keys present in BOTH items
        const keysA = Object.keys(a).filter((k) => !skipKeys.has(k) && a[k] != null && a[k] !== "");
        const keysB = new Set(Object.keys(b).filter((k) => !skipKeys.has(k) && b[k] != null && b[k] !== ""));
        const shared = keysA.filter((k) => keysB.has(k));
        for (const k of shared) {
          const va = typeof a[k] === "number" ? roundVal(a[k]) : String(a[k]);
          const vb = typeof b[k] === "number" ? roundVal(b[k]) : String(b[k]);
          if (String(va) !== String(vb)) {
            insights.push({ severity: "warning", message: k + " differs for " + id + ": " + labelA + "=" + a[k] + ", " + labelB + "=" + b[k] });
          }
        }
      }
    }
  }

  /**
   * Compare ALL shared event_params between two platforms.
   * Only reports differences for keys that exist on BOTH sides.
   */
  function compareEventParams(insights, labelA, epA, labelB, epB) {
    const skipKeys = new Set(["value", "currency", "transaction_id", "order_id"]); // already compared
    const keysA = Object.keys(epA).filter((k) => !skipKeys.has(k) && epA[k] != null && epA[k] !== "");
    const keysB = new Set(Object.keys(epB).filter((k) => !skipKeys.has(k) && epB[k] != null && epB[k] !== ""));
    const shared = keysA.filter((k) => keysB.has(k));
    for (const k of shared) {
      const va = typeof epA[k] === "number" ? roundVal(epA[k]) : String(epA[k]);
      const vb = typeof epB[k] === "number" ? roundVal(epB[k]) : String(epB[k]);
      if (String(va) !== String(vb)) {
        insights.push({ severity: "warning", message: k + " differs: " + labelA + "=" + epA[k] + ", " + labelB + "=" + epB[k] });
      }
    }
  }

  function analyzeStage(stage) {
    const ga4Evt = findBestEvent("ga4", stage.ga4);
    const gadsEvt = findBestEvent("gads", stage.gads);
    const fbEvt = findBestEvent("fb", stage.fb);

    const ga4 = extractFields(ga4Evt);
    const gads = extractFields(gadsEvt);
    const fb = extractFields(fbEvt);

    const insights = [];
    const isPageview = stage.key === "pageview";

    // Event presence — only check platforms that have mapped event names
    if (stage.ga4.length && !ga4) {
      insights.push({ severity: "error", message: "No " + stage.label + " event from GA4" });
    }
    if (stage.gads.length && !gads) {
      insights.push({ severity: "info", message: "No " + stage.label + " event from Google Ads" });
    }
    if (stage.fb.length && !fb) {
      insights.push({ severity: "error", message: "No " + stage.label + " event from Meta" });
    }

    // Build list of active platforms
    const active = [];
    if (ga4) active.push({ key: "GA4", data: ga4 });
    if (gads) active.push({ key: "GAds", data: gads });
    if (fb) active.push({ key: "Meta", data: fb });

    // Cross-platform comparisons — only compare properties that BOTH have
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        // Value — only compare if both have it
        if (a.data.value != null && b.data.value != null) {
          compareField(insights, "Value", a.key, a.data.value, b.key, b.data.value);
        }
        // Currency — only compare if both have it
        if (a.data.currency != null && b.data.currency != null) {
          compareField(insights, "Currency", a.key, a.data.currency, b.key, b.data.currency);
        }
        // Transaction ID — only on purchase, only if both have it
        if (stage.key === "purchase" && a.data.txnId && b.data.txnId) {
          compareField(insights, "Transaction ID", a.key, a.data.txnId, b.key, b.data.txnId, "warning");
        }
      }
    }

    // Compare ALL shared event_params between platform pairs
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        compareEventParams(insights, active[i].key, active[i].data.eventParams, active[j].key, active[j].data.eventParams);
      }
    }

    // Item comparisons — skip for pageview (no items expected)
    if (!isPageview) {
      if (ga4 && fb) compareItems(insights, "GA4", ga4, "Meta", fb);
      if (ga4 && gads) compareItems(insights, "GA4", ga4, "GAds", gads);
      if (gads && fb) compareItems(insights, "GAds", gads, "Meta", fb);
    }

    // Enhanced Conversions — purchase only
    if (stage.key === "purchase") {
      const gadsHasEm = !!(gads && gads.userData && gads.userData.em);
      const fbHasEm = !!(fb && fb.userData && fb.userData.em);
      const gadsHasPh = !!(gads && gads.userData && gads.userData.ph);
      const fbHasPh = !!(fb && fb.userData && fb.userData.ph);
      if (gads && fb) {
        if (gadsHasEm && !fbHasEm) insights.push({ severity: "warning", message: "Email hash present on GAds but missing on Meta" });
        if (!gadsHasEm && fbHasEm) insights.push({ severity: "warning", message: "Email hash present on Meta but missing on GAds" });
        if (gadsHasPh && !fbHasPh) insights.push({ severity: "warning", message: "Phone hash present on GAds but missing on Meta" });
        if (!gadsHasPh && fbHasPh) insights.push({ severity: "warning", message: "Phone hash present on Meta but missing on GAds" });
      }
    }

    const maxSeverity = insights.some((i) => i.severity === "error") ? "error"
      : insights.some((i) => i.severity === "warning") ? "warning" : "ok";

    if (insights.length === 0) {
      const hasAny = ga4 || gads || fb;
      insights.push(hasAny
        ? { severity: "ok", message: "All values consistent across platforms" }
        : { severity: "info", message: "No events captured for this stage" });
    }

    return { stage, ga4Evt, gadsEvt, fbEvt, ga4, gads, fb, insights, maxSeverity };
  }

  // ------------------------------------------------------------------
  // Insights — Renderer
  // ------------------------------------------------------------------

  function renderInsightsView() {
    const results = INSIGHTS_STAGES.map((s) => analyzeStage(s));
    const itemIdAnalysis = analyzeItemIds();

    let errCount = results.filter((r) => r.maxSeverity === "error").length;
    let warnCount = results.filter((r) => r.maxSeverity === "warning").length;
    let okCount = results.filter((r) => r.maxSeverity === "ok").length;
    if (itemIdAnalysis.hasAnyItems) {
      if (itemIdAnalysis.maxSeverity === "error") errCount++;
      else if (itemIdAnalysis.maxSeverity === "warning") warnCount++;
      else if (itemIdAnalysis.maxSeverity === "ok") okCount++;
    }

    let h = '<div class="insights-view">';

    // Summary bar
    h += '<div class="ins-summary">';
    if (errCount) h += '<span class="ins-pill ins-pill-error">' + errCount + ' error' + (errCount > 1 ? 's' : '') + '</span>';
    if (warnCount) h += '<span class="ins-pill ins-pill-warning">' + warnCount + ' warning' + (warnCount > 1 ? 's' : '') + '</span>';
    if (okCount) h += '<span class="ins-pill ins-pill-ok">' + okCount + ' OK</span>';
    const infoCount = results.filter((r) => r.maxSeverity === "ok" && r.insights.some((i) => i.severity === "info")).length;
    // info results are counted inside OK — no separate pill needed
    h += '<div class="ins-actions">';
    h += '<button class="ins-action-btn ins-btn-clear" id="insClearBtn">';
    h += '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    h += ' Clear</button>';
    h += '<button class="ins-action-btn ins-btn-retest" id="insRetestBtn">';
    h += '<svg class="ins-retest-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
    h += ' Retest</button>';
    h += '</div>';
    h += '</div>';

    // Stage cards wrapper
    h += '<div id="insStageCards">';
    for (const r of results) {
      const sev = r.maxSeverity;
      const sevLabel = sev === "error" ? "Issues found" : sev === "warning" ? "Warnings" : "OK";
      const sevIcon = sev === "error" ? "\u2716" : sev === "warning" ? "\u26A0" : "\u2714";

      h += '<div class="ins-stage">';

      // Header
      h += '<div class="ins-stage-header">';
      h += '<span class="dot" style="background: var(' + r.stage.color + ')"></span>';
      h += '<span class="ins-stage-label">' + esc(r.stage.label) + '</span>';
      h += '<span class="ins-severity-badge ' + sev + '">' + sevIcon + ' ' + sevLabel + '</span>';
      h += '</div>';

      // Platform rows — compact horizontal layout
      h += '<div class="ins-plat-rows">';
      const platformData = [
        { p: PLATFORMS[0], evt: r.ga4Evt, data: r.ga4, stageEvents: r.stage.ga4 },
        { p: PLATFORMS[1], evt: r.gadsEvt, data: r.gads, stageEvents: r.stage.gads },
        { p: PLATFORMS[2], evt: r.fbEvt, data: r.fb, stageEvents: r.stage.fb },
      ];

      for (const { p, data, stageEvents } of platformData) {
        // N/A if the stage has no mapped events for this platform
        if (!stageEvents || stageEvents.length === 0) {
          h += '<div class="ins-plat-row">';
          h += '<span class="ins-plat-badge" style="color: var(' + p.color + ')">' + p.icon + ' ' + esc(p.label) + '</span>';
          h += '<span class="ins-plat-na">N/A</span>';
          h += '</div>';
          continue;
        }

        if (!data) {
          h += '<div class="ins-plat-row">';
          h += '<span class="ins-plat-badge" style="color: var(' + p.color + ')">' + p.icon + ' ' + esc(p.label) + '</span>';
          h += '<span class="ins-plat-na">No event</span>';
          h += '</div>';
          continue;
        }

        h += '<div class="ins-plat-row" style="background: var(' + p.dim + ')">';
        h += '<span class="ins-plat-badge" style="color: var(' + p.color + ')">' + p.icon + ' ' + esc(p.label) + '</span>';
        h += '<span class="ins-plat-evt">' + esc(data.eventName) + '</span>';
        if (r.stage.key !== "pageview") h += renderFieldInline(data);
        h += '</div>';
      }
      h += '</div>';

      // Enhanced Conversions bar — purchase only, full-width compact row
      if (r.stage.key === "purchase") {
        h += renderEnhancedBar(r.ga4, r.gads, r.fb);
      }

      // Findings
      h += '<div class="ins-findings">';
      for (const ins of r.insights) {
        const icon = ins.severity === "error" ? "\u2716" : ins.severity === "warning" ? "\u26A0" : ins.severity === "info" ? "\u2139" : "\u2714";
        h += '<div class="ins-row ins-row-' + ins.severity + '"><span class="ins-row-icon">' + icon + '</span>' + esc(ins.message) + '</div>';
      }
      h += '</div>';

      h += '</div>';
    }

    // Item IDs section — after stage cards, inside insStageCards
    if (itemIdAnalysis.hasAnyItems) {
      h += renderItemIdsCard(itemIdAnalysis);
    }

    h += '</div>'; // close insStageCards
    h += '</div>'; // close insights-view
    emptyState.style.display = "none";
    eventList.innerHTML = h;

    // Wire Clear button — clears stage cards only, keeps summary bar + buttons
    const insClear = document.getElementById("insClearBtn");
    if (insClear) {
      insClear.addEventListener("click", (e) => {
        e.stopPropagation();
        const cards = document.getElementById("insStageCards");
        if (cards) {
          cards.innerHTML = '<div class="ins-cleared"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3;color:var(--accent)"><polyline points="20 6 9 17 4 12"/></svg><p style="color:var(--text-tertiary);font-size:12px;margin-top:8px">Insights cleared. Click <b>Retest</b> to re-analyze.</p></div>';
        }
      });
    }

    // Wire Retest button — skeleton loading then re-fetch + re-analyze
    const insRetest = document.getElementById("insRetestBtn");
    if (insRetest) {
      insRetest.addEventListener("click", (e) => {
        e.stopPropagation();
        showInsightsSkeleton();
        chrome.runtime.sendMessage(
          { type: "GET_EVENTS", tabId: currentTabId },
          (response) => {
            if (!chrome.runtime.lastError && response) {
              events = response.events || [];
            }
            setTimeout(() => { render(); }, 1000);
          }
        );
      });
    }
  }

  function showInsightsSkeleton() {
    let h = '<div class="insights-view">';

    // Skeleton summary bar
    h += '<div class="ins-summary ins-skeleton-row">';
    h += '<span class="ins-skel-pill"></span>';
    h += '<span class="ins-skel-pill short"></span>';
    h += '</div>';

    // 5 skeleton stage cards
    for (let i = 0; i < 6; i++) {
      h += '<div class="ins-stage ins-skeleton-stage">';
      h += '<div class="ins-stage-header"><span class="ins-skel-dot"></span><span class="ins-skel-text"></span><span class="ins-skel-badge"></span></div>';
      h += '<div class="ins-platforms">';
      h += '<div class="ins-platform ins-skel-platform"><span class="ins-skel-line w60"></span><span class="ins-skel-line w80"></span><span class="ins-skel-line w40"></span></div>';
      h += '<div class="ins-platform ins-skel-platform"><span class="ins-skel-line w60"></span><span class="ins-skel-line w80"></span><span class="ins-skel-line w40"></span></div>';
      h += '<div class="ins-platform ins-skel-platform"><span class="ins-skel-line w60"></span><span class="ins-skel-line w80"></span><span class="ins-skel-line w40"></span></div>';
      h += '</div>';
      h += '<div class="ins-findings ins-skel-findings"><span class="ins-skel-line w90"></span></div>';
      h += '</div>';
    }

    h += '</div>';
    emptyState.style.display = "none";
    eventList.innerHTML = h;
  }

  function renderFieldRows(data) {
    let h = '';
    if (data.value != null) h += '<div class="ins-field"><span class="ins-field-label">Value:</span> ' + esc(String(data.value)) + '</div>';
    if (data.currency) h += '<div class="ins-field"><span class="ins-field-label">Currency:</span> ' + esc(data.currency) + '</div>';
    if (data.txnId) h += '<div class="ins-field"><span class="ins-field-label">Txn ID:</span> ' + esc(data.txnId) + '</div>';
    if (data.itemCount > 0) {
      h += '<div class="ins-field"><span class="ins-field-label">Items:</span> ' + data.itemCount + '</div>';
      h += '<div class="ins-field"><span class="ins-field-label">IDs:</span> ' + esc(data.itemIds.join(", ") || "—") + '</div>';
    }
    return h;
  }

  /** Render fields inline (horizontal) for the compact platform row layout. */
  function renderFieldInline(data) {
    const parts = [];
    if (data.value != null) {
      let v = String(data.value);
      if (data.currency) v += ' ' + data.currency;
      parts.push(v);
    }
    if (data.txnId) parts.push('Txn:' + data.txnId);
    if (data.itemCount > 0) parts.push(data.itemCount + ' item' + (data.itemCount > 1 ? 's' : ''));
    if (!parts.length) return '';
    return '<span class="ins-plat-fields">' + esc(parts.join(' \u00B7 ')) + '</span>';
  }

  /** Render item IDs as monospace chips (max 10 visible). */
  function renderIdChips(ids) {
    const MAX_VISIBLE = 10;
    const arr = [...ids].sort();
    let h = '<span class="ins-item-chips">';
    const visible = arr.slice(0, MAX_VISIBLE);
    for (const id of visible) {
      h += '<span class="ins-item-chip">' + esc(id) + '</span>';
    }
    if (arr.length > MAX_VISIBLE) {
      h += '<span class="ins-item-more">+' + (arr.length - MAX_VISIBLE) + ' more</span>';
    }
    h += '</span>';
    return h;
  }

  /** Render the global Item IDs card for insights view. */
  function renderItemIdsCard(analysis) {
    const sev = analysis.maxSeverity || "info";
    const sevLabel = sev === "error" ? "Issues found" : sev === "warning" ? "Warnings" : sev === "ok" ? "OK" : "Info";
    const sevIcon = sev === "error" ? "\u2716" : sev === "warning" ? "\u26A0" : sev === "ok" ? "\u2714" : "\u2139";

    let h = '<div class="ins-stage">';

    // Header
    h += '<div class="ins-stage-header">';
    h += '<span class="dot" style="background: var(--accent)"></span>';
    h += '<span class="ins-stage-label">Item IDs</span>';
    h += '<span class="ins-severity-badge ' + sev + '">' + sevIcon + ' ' + sevLabel + '</span>';
    h += '</div>';

    // Platform rows
    h += '<div class="ins-plat-rows">';
    const platList = [
      { p: PLATFORMS[0], ids: analysis.perPlatform.ga4.allIds },
      { p: PLATFORMS[1], ids: analysis.perPlatform.gads.allIds },
      { p: PLATFORMS[2], ids: analysis.perPlatform.fb.allIds },
    ];
    for (const { p, ids } of platList) {
      if (ids.size === 0) {
        h += '<div class="ins-plat-row">';
        h += '<span class="ins-plat-badge" style="color: var(' + p.color + ')">' + p.icon + ' ' + esc(p.label) + '</span>';
        h += '<span class="ins-plat-na">No items</span>';
        h += '</div>';
      } else {
        h += '<div class="ins-plat-row" style="background: var(' + p.dim + ')">';
        h += '<span class="ins-plat-badge" style="color: var(' + p.color + ')">' + p.icon + ' ' + esc(p.label) + '</span>';
        h += renderIdChips(ids);
        h += '<span class="ins-item-count">' + ids.size + ' ID' + (ids.size > 1 ? 's' : '') + '</span>';
        h += '</div>';
      }
    }
    h += '</div>';

    // Findings
    h += '<div class="ins-findings">';
    for (const ins of analysis.insights) {
      const icon = ins.severity === "error" ? "\u2716" : ins.severity === "warning" ? "\u26A0" : ins.severity === "info" ? "\u2139" : "\u2714";
      h += '<div class="ins-row ins-row-' + ins.severity + '"><span class="ins-row-icon">' + icon + '</span>' + esc(ins.message) + '</div>';
    }
    h += '</div>';

    h += '</div>';
    return h;
  }

  /** Render Enhanced Conversions as a full-width bar for purchase stage. */
  function renderEnhancedBar(ga4Data, gadsData, fbData) {
    const check = '\u2714';
    const dash = '—';

    /** Show email/phone status — only if event exists AND has non-empty user_data */
    function ecStatus(data) {
      // No event at all, or no user_data, or user_data exists but both fields empty
      if (!data) return '<span class="ec-na">N/A</span>';
      const ud = data.userData;
      const hasEm = ud && ud.em && ud.em.length > 0;
      const hasPh = ud && ud.ph && ud.ph.length > 0;
      if (!hasEm && !hasPh) return '<span class="ec-na">N/A</span>';
      let s = '';
      s += '<span class="ec-field"><span class="ec-label">Email</span> ' + (hasEm ? '<span class="ec-yes">' + check + '</span>' : '<span class="ec-no">' + dash + '</span>') + '</span>';
      s += '<span class="ec-field"><span class="ec-label">Phone</span> ' + (hasPh ? '<span class="ec-yes">' + check + '</span>' : '<span class="ec-no">' + dash + '</span>') + '</span>';
      return s;
    }

    let h = '<div class="ins-enhanced-bar">';
    h += '<span class="ec-title">Enhanced Conversions</span>';
    h += '<div class="ec-platforms">';
    // GA4
    h += '<span class="ec-plat"><span class="ec-plat-name" style="color:var(--purple-light)">GA4</span> <span class="ec-na">N/A</span></span>';
    // Google Ads
    h += '<span class="ec-plat"><span class="ec-plat-name" style="color:var(--gold)">GAds</span> ' + ecStatus(gadsData) + '</span>';
    // Meta
    h += '<span class="ec-plat"><span class="ec-plat-name" style="color:var(--fb-blue)">Meta</span> ' + ecStatus(fbData) + '</span>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  // ------------------------------------------------------------------
  // Card builders (unchanged)
  // ------------------------------------------------------------------

  function createEventCard(event, index) {
    const expanded = expandedCards.has(index);
    const time = fmtTime(event.timestamp);
    const items = event.payload.items || [];
    const ep = event.payload.event_params || {};
    const value = ep.value || ep.revenue || "";
    const currency = ep.currency || "";

    let pagePath = "";
    try {
      const u = new URL(event.payload.page_location);
      pagePath = u.pathname.length > 40 ? u.pathname.slice(0, 40) + "\u2026" : u.pathname;
    } catch { /* ignore */ }

    const methodCls = (event.method || "GET") === "POST" ? "post" : "get";
    const methodLabel = (event.method || "GET");

    const src = event.source || "ga4";
    const sourceBadge = src === "gads"
      ? '<span class="source-badge gads">' + GADS_ICON + ' GAds</span>'
      : src === "fb"
        ? '<span class="source-badge fb">' + FB_ICON + ' Meta</span>'
        : '<span class="source-badge ga4">' + GA4_ICON + ' GA4</span>';

    const collectHost = event.collectHost || "";
    let endpointBadge = "";
    if (src === "gads") {
      endpointBadge = '<span class="endpoint-badge gads" title="' + esc(collectHost) + '">Google Ads</span>';
    } else if (src === "fb") {
      endpointBadge = '<span class="endpoint-badge fb" title="' + esc(collectHost) + '">Meta Pixel</span>';
    } else if (collectHost) {
      const isFirstParty = collectHost &&
        !collectHost.endsWith("google-analytics.com") &&
        !collectHost.endsWith("analytics.google.com") &&
        !collectHost.endsWith("googletagmanager.com");
      endpointBadge = isFirstParty
        ? '<span class="endpoint-badge sgtm" title="Server-side GTM / first-party endpoint: ' + esc(collectHost) + '">' + esc(collectHost) + '</span>'
        : '<span class="endpoint-badge google" title="' + esc(collectHost) + '">GA4</span>';
    }

    const trackingId = src === "gads"
      ? (event.payload.conversion_id || "")
      : src === "fb"
        ? (event.payload.pixel_id || "")
        : (event.payload.measurement_id || "");

    return [
      '<div class="event-card' + (expanded ? " expanded" : "") + '" data-index="' + index + '" data-source="' + src + '">',
      '  <div class="event-header">',
      '    <div class="event-indicator ' + esc(event.eventName) + '"></div>',
      '    <div class="event-info">',
      '      <div class="event-name' + (event.eventName === "conversion" ? " is-conversion" : "") + '">' + esc(event.eventName) + '</div>',
      '      <div class="event-meta">',
      '        <span class="event-meta-item">' + time + '</span>',
      '        <span class="method-badge ' + methodCls + '">' + methodLabel + '</span>',
      sourceBadge,
      endpointBadge,
      pagePath ? '<span class="event-meta-item">' + esc(pagePath) + '</span>' : '',
      value ? '<span class="event-meta-item">' + esc(String(currency)) + ' ' + esc(String(value)) + '</span>' : '',
      trackingId ? '<span class="event-meta-item">' + esc(trackingId) + '</span>' : '',
      '      </div>',
      '    </div>',
      items.length > 0
        ? '<span class="event-items-badge">' + items.length + ' item' + (items.length !== 1 ? 's' : '') + '</span>'
        : '',
      '    <svg class="event-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
      '  </div>',
      '  <div class="event-detail">',
      '    <div class="detail-tabs">',
      '      <button class="detail-tab active" data-tab="payload">Payload</button>',
      items.length > 0 ? '      <button class="detail-tab" data-tab="items">Items</button>' : '',
      '      <button class="detail-tab" data-tab="raw">Raw JSON</button>',
      '    </div>',
      '    <div class="detail-content">' + renderPanels(event) + '</div>',
      '  </div>',
      '</div>',
    ].join("\n");
  }

  function renderPanels(event) {
    const full = JSON.stringify(event.payload, null, 2);
    const clean = JSON.stringify(cleanPayload(event.payload), null, 2);
    const items = event.payload.items || [];
    const ej = escAttr(full);

    let h = '<div class="tab-panel" data-panel="payload" style="display:block">' +
      copyBtn(ej) + '<div class="json-block">' + highlight(clean) + '</div></div>';

    if (items.length) {
      h += '<div class="tab-panel" data-panel="items" style="display:none">' +
        itemsTable(items) + '</div>';
    }

    h += '<div class="tab-panel" data-panel="raw" style="display:none">' +
      copyBtn(ej) + '<div class="json-block">' + highlight(full) + '</div></div>';

    return h;
  }

  function copyBtn(escapedJson) {
    return '<button class="copy-btn" data-json=\'' + escapedJson + '\'>' +
      '<svg class="copy-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
      '<svg class="check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
      '<span class="copy-text">Copy</span></button>';
  }

  function cleanPayload(p) {
    const c = { event_name: p.event_name };
    if (p.pixel_id) c.pixel_id = p.pixel_id;
    if (p.conversion_id) c.conversion_id = p.conversion_id;
    if (p.conversion_label) c.conversion_label = p.conversion_label;
    if (p.measurement_id) c.measurement_id = p.measurement_id;
    if (p.page_location) c.page_location = p.page_location;
    if (p.event_params && Object.keys(p.event_params).length) c.event_params = p.event_params;
    if (p.items && p.items.length) c.items = p.items;
    if (p.user_properties && Object.keys(p.user_properties).length) c.user_properties = p.user_properties;
    return c;
  }

  function itemsTable(items) {
    const keys = new Set();
    items.forEach((it) => Object.keys(it).forEach((k) => keys.add(k)));
    const prio = ["item_id","item_name","item_brand","item_category","item_variant","price","quantity","coupon","discount"];
    const cols = prio.filter((k) => keys.has(k));
    keys.forEach((k) => { if (!cols.includes(k)) cols.push(k); });

    return '<table class="items-table"><thead><tr>' +
      cols.map((c) => '<th>' + esc(c) + '</th>').join('') +
      '</tr></thead><tbody>' +
      items.map((it) => '<tr>' + cols.map((c) => {
        const v = it[c] != null ? String(it[c]) : '-';
        return '<td title="' + escAttr(v) + '">' + esc(v) + '</td>';
      }).join('') + '</tr>').join('') +
      '</tbody></table>';
  }

  // ------------------------------------------------------------------
  // Interactions (unchanged)
  // ------------------------------------------------------------------

  function toggleCard(header) {
    const card = header.closest(".event-card");
    const idx = parseInt(card.dataset.index, 10);
    if (expandedCards.has(idx)) {
      expandedCards.delete(idx);
      card.classList.remove("expanded");
    } else {
      expandedCards.add(idx);
      card.classList.add("expanded");
    }
  }

  function onTabClick(e) {
    const tab = e.target.closest(".detail-tab");
    if (!tab) return;
    const card = tab.closest(".event-card");
    const name = tab.dataset.tab;
    card.querySelectorAll(".detail-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    card.querySelectorAll(".tab-panel").forEach((p) => {
      p.style.display = p.dataset.panel === name ? "block" : "none";
    });
  }

  function onCopyClick(e) {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;
    e.stopPropagation();
    navigator.clipboard.writeText(btn.dataset.json).then(() => {
      btn.classList.add("copied");
      btn.querySelector(".copy-text").textContent = "Copied!";
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.querySelector(".copy-text").textContent = "Copy";
      }, 1500);
    });
  }

  // ------------------------------------------------------------------
  // Helpers (unchanged)
  // ------------------------------------------------------------------

  function highlight(json) {
    return json.replace(
      /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (m) => {
        let c = "json-number";
        if (/^"/.test(m)) c = /:$/.test(m) ? "json-key" : "json-string";
        else if (/true|false/.test(m)) c = "json-bool";
        else if (/null/.test(m)) c = "json-null";
        return '<span class="' + c + '">' + m + '</span>';
      }
    );
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return s.replace(/&/g,"&amp;").replace(/'/g,"&#39;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // ------------------------------------------------------------------
  // PDF Report Generator
  // ------------------------------------------------------------------

  function generateReport() {
    const pageUrlText = document.getElementById("pageUrl").textContent || "";
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

    // Run insights analysis
    const results = INSIGHTS_STAGES.map((s) => analyzeStage(s));

    // Count sources
    const sourceSet = new Set(events.map((e) => e.source || "ga4"));
    const totalEvents = events.length;

    // HTML escape for report (standalone, no DOM dependency)
    const h = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    // Platform display helpers
    const platName = { ga4: "GA4", gads: "Google Ads", fb: "Meta" };
    const platColor = { ga4: "#8B5CF6", gads: "#F6CF12", fb: "#1877F2" };
    const sevColor = { error: "#ef4444", warning: "#F6CF12", ok: "#07F2C7", info: "#8B9CF7" };
    const sevIcon = { error: "\u2716", warning: "\u26A0", ok: "\u2714", info: "\u2139" };
    const sevLabel = { error: "Issues Found", warning: "Warnings", ok: "OK", info: "Info" };

    let doc = "";

    // Data for new sections
    const pixelData = collectPixelData();
    const ga4Consent = getLatestConsent("ga4");
    const gadsConsent = getLatestConsent("gads");
    const consentChanges = detectConsentChanges();
    const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "";
    const consentLabel = { granted: "Granted", denied: "Denied", not_set: "Not Set", unknown: "Unknown" };
    const CM_PLATFORM_EVENTS = {
      ga4: new Set(["page_view","view_item","view_item_list","select_item","add_to_cart","remove_from_cart","view_cart","begin_checkout","add_shipping_info","add_payment_info","purchase"]),
      gads: new Set(["page_view","view_item","add_to_cart","begin_checkout","purchase","conversion"]),
      fb: new Set(["PageView","ViewContent","Search","AddToWishlist","AddToCart","InitiateCheckout","AddPaymentInfo","Purchase"]),
    };

    // --- Section 1: Tracking IDs ---
    doc += '<h2>Tracking IDs</h2>';
    const pixelPlatforms = [
      { key: "ga4", label: "GA4", idLabel: "Measurement ID" },
      { key: "gads", label: "Google Ads", idLabel: "Conversion ID" },
      { key: "fb", label: "Meta", idLabel: "Pixel ID" },
    ];
    let hasAnyIds = false;
    for (const pp of pixelPlatforms) {
      const platIds = Object.keys(pixelData[pp.key].ids);
      if (platIds.length === 0) continue;
      hasAnyIds = true;
      doc += '<div class="pixel-section">';
      doc += '<div class="pixel-plat-header">';
      doc += '<strong style="color:' + platColor[pp.key] + '">' + h(pp.label) + '</strong>';
      doc += '<span class="tag">' + platIds.length + ' ID' + (platIds.length > 1 ? 's' : '') + '</span>';
      if (platIds.length > 1) {
        doc += '<span class="pixel-warn">\u26A0 Multiple IDs detected</span>';
      }
      doc += '</div>';
      const showLabels = pp.key === "gads";
      doc += '<table class="data-table"><thead><tr>';
      doc += '<th>' + h(pp.idLabel) + '</th><th>Endpoints</th><th>Events</th><th>Event Names</th>';
      if (showLabels) doc += '<th>Conv. Labels</th>';
      doc += '</tr></thead><tbody>';
      for (const id of platIds) {
        const info = pixelData[pp.key].ids[id];
        doc += '<tr>';
        doc += '<td class="mono">' + h(id) + '</td>';
        doc += '<td>' + [...info.endpoints].map((e) => h(e)).join(', ') + '</td>';
        doc += '<td>' + info.eventCount + '</td>';
        doc += '<td class="mono">' + [...info.eventNames].map((n) => h(n)).join(', ') + '</td>';
        if (showLabels) {
          doc += '<td class="mono">' + [...info.conversionLabels].map((l) => h(l)).join(', ') + '</td>';
        }
        doc += '</tr>';
      }
      doc += '</tbody></table>';
      doc += '</div>';
    }
    if (!hasAnyIds) {
      doc += '<p class="no-data">No tracking IDs detected in captured events.</p>';
    }

    // --- Section 2: Event Coverage ---
    doc += '<h2>Event Coverage</h2>';
    const cmLookup = {};
    for (const p of PLATFORMS) cmLookup[p.key] = {};
    for (const evt of events) {
      const src = evt.source || "ga4";
      if (!cmLookup[src]) continue;
      cmLookup[src][evt.eventName] = (cmLookup[src][evt.eventName] || 0) + 1;
    }
    doc += '<table class="data-table check-grid"><thead><tr><th>Stage</th>';
    for (const p of PLATFORMS) {
      doc += '<th style="color:' + platColor[p.key] + '">' + platName[p.key] + '</th>';
    }
    doc += '</tr></thead><tbody>';
    for (const cat of CHECK_MATRIX) {
      doc += '<tr><td><strong>' + h(cat.label) + '</strong></td>';
      for (const p of PLATFORMS) {
        const canMatch = cat.events.some((ev) => CM_PLATFORM_EVENTS[p.key].has(ev));
        if (!canMatch) {
          doc += '<td class="cm-report-na">N/A</td>';
          continue;
        }
        const matched = [];
        let cmTotal = 0;
        for (const evtName of cat.events) {
          const count = cmLookup[p.key][evtName] || 0;
          if (count > 0) { matched.push(h(evtName) + ' (' + count + ')'); cmTotal += count; }
        }
        if (matched.length > 0) {
          doc += '<td class="cm-report-hit">\u2714 ' + cmTotal + ' \u2014 ' + matched.join(', ') + '</td>';
        } else {
          doc += '<td class="cm-report-miss">\u2014</td>';
        }
      }
      doc += '</tr>';
    }
    doc += '</tbody></table>';

    // --- Section 3: Consent Mode ---
    doc += '<h2>Consent Mode</h2>';
    if (!ga4Consent && !gadsConsent) {
      doc += '<p class="no-data">No consent signals detected. The site may not have implemented Google Consent Mode v2.</p>';
    } else {
      // General Consent Status
      doc += '<h3>General Consent Status</h3>';
      doc += '<table class="data-table"><thead><tr><th>Category</th><th>Status</th></tr></thead><tbody>';
      for (const cat of CONSENT_CATEGORIES) {
        const ga4St = ga4Consent && ga4Consent.gcd ? (ga4Consent.gcd[cat.key] ? ga4Consent.gcd[cat.key].state : null) : null;
        const gadsSt = gadsConsent && gadsConsent.gcd ? (gadsConsent.gcd[cat.key] ? gadsConsent.gcd[cat.key].state : null) : null;
        const states = [ga4St, gadsSt].filter(Boolean);
        const unique = [...new Set(states)];
        doc += '<tr><td class="mono">' + h(cat.label) + '</td><td>';
        if (unique.length === 0) {
          doc += '<span class="consent-unknown">Unknown</span>';
        } else if (unique.length === 1) {
          doc += '<span class="consent-' + unique[0] + '">' + (consentLabel[unique[0]] || capitalize(unique[0])) + '</span>';
        } else {
          doc += '<span class="consent-discrepancy">Discrepancy</span> \u2014 ';
          if (ga4St) doc += '<span style="color:#8B5CF6">GA4:</span> ' + (consentLabel[ga4St] || capitalize(ga4St)) + ' ';
          if (gadsSt) doc += '<span style="color:#F6CF12">GAds:</span> ' + (consentLabel[gadsSt] || capitalize(gadsSt));
        }
        doc += '</td></tr>';
      }
      doc += '</tbody></table>';

      // Platform Breakdown
      doc += '<h3>Platform Breakdown</h3>';
      doc += '<table class="data-table"><thead><tr><th>Category</th>';
      doc += '<th style="color:#8B5CF6">GA4</th>';
      doc += '<th style="color:#F6CF12">Google Ads</th>';
      doc += '</tr></thead><tbody>';
      for (const cat of CONSENT_CATEGORIES) {
        doc += '<tr><td class="mono">' + h(cat.label) + '</td>';
        for (const plat of CONSENT_PLATFORMS) {
          const consent = plat.key === "ga4" ? ga4Consent : gadsConsent;
          const info = consent && consent.gcd ? (consent.gcd[cat.key] || null) : null;
          doc += '<td>';
          if (info) {
            doc += '<span class="consent-' + info.state + '">' + (consentLabel[info.state] || capitalize(info.state)) + '</span>';
            doc += ' <span class="mono" style="color:#888">(' + h(info.code || '?') + ')</span>';
            if (info.inherited) doc += ' <span style="color:#888">\u2197</span>';
          } else {
            doc += '<span style="color:#999">\u2014</span>';
          }
          doc += '</td>';
        }
        doc += '</tr>';
      }
      doc += '</tbody></table>';

      // Consent Changes
      if (consentChanges.length) {
        doc += '<h3>Consent Changes During Session</h3>';
        doc += '<div class="findings">';
        for (const c of consentChanges) {
          doc += '<div class="finding" style="color:#F6CF12">\u26A0 <strong>' + h(c.category) + '</strong> changed from <strong>' + h(c.from) + '</strong> \u2192 <strong>' + h(c.to) + '</strong> on ' + h(c.platform) + ' (' + h(c.eventName) + ')</div>';
        }
        doc += '</div>';
      }

      // Raw Consent Strings
      doc += '<h3>Raw Consent Strings</h3>';
      for (const plat of CONSENT_PLATFORMS) {
        const consent = plat.key === "ga4" ? ga4Consent : gadsConsent;
        if (!consent) continue;
        doc += '<div class="consent-raw">';
        doc += '<p><strong style="color:' + platColor[plat.key] + '">' + h(plat.label) + '</strong></p>';
        if (consent.gcd) {
          doc += '<p class="mono consent-raw-value">gcd: ' + h(consent.gcd.raw) + '</p>';
          doc += '<p class="consent-decoded">';
          for (const cat of CONSENT_CATEGORIES) {
            const info = consent.gcd[cat.key];
            if (info && info.code) {
              doc += h(cat.label) + ': ' + h(info.code) + ' = ' + h(info.meaning) + '<br>';
            }
          }
          doc += '</p>';
        }
        if (consent.gcs) {
          doc += '<p class="mono consent-raw-value">gcs: ' + h(consent.gcs.raw) + '</p>';
          doc += '<p class="consent-decoded">';
          doc += 'ad_storage: ' + h(consent.gcs.ad_storage) + '<br>';
          doc += 'analytics_storage: ' + h(consent.gcs.analytics_storage);
          doc += '</p>';
        }
        doc += '</div>';
      }

      doc += '<p class="consent-note">\u2139 functionality_storage, security_storage, and personalization_storage are not transmitted in gcd/gcs parameters and cannot be detected from network requests.</p>';
    }

    // --- Section 4: Insights Summary ---
    doc += '<h2>Insights Summary</h2>';

    for (const r of results) {
      const sev = r.maxSeverity;
      doc += '<div class="stage-card">';
      doc += '<div class="stage-header">';
      doc += '<span class="stage-dot" style="background:' + (r.stage.key === "pageview" ? "#8B9CF7" : r.stage.key === "view" ? "#07F2C7" : r.stage.key === "cart" ? "#F6CF12" : r.stage.key === "checkout" ? "#8B5CF6" : "#07F2C7") + '"></span>';
      doc += '<strong>' + h(r.stage.label) + '</strong>';
      doc += '<span class="sev-badge" style="background:' + sevColor[sev] + '20;color:' + sevColor[sev] + '">' + sevIcon[sev] + ' ' + sevLabel[sev] + '</span>';
      doc += '</div>';

      // Platform rows
      const platforms = [
        { key: "ga4", evt: r.ga4Evt, data: r.ga4, stageEvents: r.stage.ga4 },
        { key: "gads", evt: r.gadsEvt, data: r.gads, stageEvents: r.stage.gads },
        { key: "fb", evt: r.fbEvt, data: r.fb, stageEvents: r.stage.fb },
      ];

      doc += '<table class="plat-table"><tbody>';
      for (const pl of platforms) {
        doc += '<tr>';
        doc += '<td class="plat-name" style="color:' + platColor[pl.key] + '">' + platName[pl.key] + '</td>';
        if (!pl.stageEvents || pl.stageEvents.length === 0) {
          doc += '<td class="plat-na" colspan="2">N/A</td>';
        } else if (!pl.data) {
          doc += '<td class="plat-na" colspan="2">No event</td>';
        } else {
          doc += '<td class="plat-evt">' + h(pl.data.eventName) + '</td>';
          if (r.stage.key !== "pageview") {
            const parts = [];
            if (pl.data.value != null) {
              let v = String(pl.data.value);
              if (pl.data.currency) v += " " + pl.data.currency;
              parts.push(v);
            }
            if (pl.data.txnId) parts.push("Txn: " + pl.data.txnId);
            if (pl.data.itemCount > 0) parts.push(pl.data.itemCount + " item" + (pl.data.itemCount > 1 ? "s" : ""));
            doc += '<td class="plat-vals">' + h(parts.join(" \u00B7 ")) + '</td>';
          } else {
            doc += '<td></td>';
          }
        }
        doc += '</tr>';
      }
      doc += '</tbody></table>';

      // Enhanced Conversions (purchase only)
      if (r.stage.key === "purchase") {
        doc += '<div class="ec-bar">';
        doc += '<span class="ec-title">Enhanced Conversions</span>';
        doc += '<span class="ec-plat"><b style="color:' + platColor.ga4 + '">GA4</b> <i class="na">N/A</i></span>';
        // GAds
        const gadsUd = r.gads && r.gads.userData;
        const gadsHasEm = gadsUd && gadsUd.em && gadsUd.em.length > 0;
        const gadsHasPh = gadsUd && gadsUd.ph && gadsUd.ph.length > 0;
        doc += '<span class="ec-plat"><b style="color:' + platColor.gads + '">GAds</b> ';
        if (!r.gads || (!gadsHasEm && !gadsHasPh)) { doc += '<i class="na">N/A</i>'; }
        else { doc += 'Email ' + (gadsHasEm ? '<span class="ec-ok">\u2714</span>' : '\u2014') + ' Phone ' + (gadsHasPh ? '<span class="ec-ok">\u2714</span>' : '\u2014'); }
        doc += '</span>';
        // Meta
        const fbUd = r.fb && r.fb.userData;
        const fbHasEm = fbUd && fbUd.em && fbUd.em.length > 0;
        const fbHasPh = fbUd && fbUd.ph && fbUd.ph.length > 0;
        doc += '<span class="ec-plat"><b style="color:' + platColor.fb + '">Meta</b> ';
        if (!r.fb || (!fbHasEm && !fbHasPh)) { doc += '<i class="na">N/A</i>'; }
        else { doc += 'Email ' + (fbHasEm ? '<span class="ec-ok">\u2714</span>' : '\u2014') + ' Phone ' + (fbHasPh ? '<span class="ec-ok">\u2714</span>' : '\u2014'); }
        doc += '</span>';
        doc += '</div>';
      }

      // Findings
      if (r.insights.length) {
        doc += '<div class="findings">';
        for (const ins of r.insights) {
          doc += '<div class="finding" style="color:' + sevColor[ins.severity] + '">' + sevIcon[ins.severity] + ' ' + h(ins.message) + '</div>';
        }
        doc += '</div>';
      }

      doc += '</div>'; // stage-card
    }

    // Item IDs section in report
    const reportItemIds = analyzeItemIds();
    if (reportItemIds.hasAnyItems) {
      const idSev = reportItemIds.maxSeverity || "info";
      doc += '<div class="stage-card">';
      doc += '<div class="stage-header">';
      doc += '<span class="stage-dot" style="background:#07F2C7"></span>';
      doc += '<strong>Item IDs</strong>';
      doc += '<span class="sev-badge" style="background:' + sevColor[idSev] + '20;color:' + sevColor[idSev] + '">' + sevIcon[idSev] + ' ' + sevLabel[idSev] + '</span>';
      doc += '</div>';
      doc += '<table class="plat-table"><tbody>';
      for (const pl of [{ key: "ga4", label: "GA4" }, { key: "gads", label: "Google Ads" }, { key: "fb", label: "Meta" }]) {
        const ids = reportItemIds.perPlatform[pl.key].allIds;
        doc += '<tr>';
        doc += '<td class="plat-name" style="color:' + platColor[pl.key] + '">' + pl.label + '</td>';
        if (ids.size === 0) {
          doc += '<td class="plat-na">No items</td>';
        } else {
          doc += '<td class="mono">' + [...ids].sort().map((id) => h(id)).join(', ') + ' <span style="color:#888">(' + ids.size + ')</span></td>';
        }
        doc += '</tr>';
      }
      doc += '</tbody></table>';
      if (reportItemIds.insights.length) {
        doc += '<div class="findings">';
        for (const ins of reportItemIds.insights) {
          doc += '<div class="finding" style="color:' + sevColor[ins.severity] + '">' + sevIcon[ins.severity] + ' ' + h(ins.message) + '</div>';
        }
        doc += '</div>';
      }
      doc += '</div>';
    }

    // --- Section 5: Event Payloads (best event per stage per platform) ---
    doc += '<h2>Event Payloads</h2>';

    for (const r of results) {
      const platforms = [
        { key: "ga4", evt: r.ga4Evt, data: r.ga4 },
        { key: "gads", evt: r.gadsEvt, data: r.gads },
        { key: "fb", evt: r.fbEvt, data: r.fb },
      ];

      const hasAny = platforms.some((p) => p.evt);
      if (!hasAny) continue;

      doc += '<h3>' + h(r.stage.label) + '</h3>';

      for (const pl of platforms) {
        if (!pl.evt) continue;
        const ep = pl.evt.payload.event_params || {};
        const items = pl.evt.payload.items || [];
        const ud = pl.evt.payload.user_data;

        doc += '<div class="payload-block">';
        doc += '<div class="payload-header" style="border-left:3px solid ' + platColor[pl.key] + '">';
        doc += '<b style="color:' + platColor[pl.key] + '">' + platName[pl.key] + '</b> \u2014 <code>' + h(pl.evt.eventName) + '</code>';
        if (pl.evt.payload.measurement_id) doc += ' &nbsp;<span class="tag">' + h(pl.evt.payload.measurement_id) + '</span>';
        if (pl.evt.payload.conversion_id) doc += ' &nbsp;<span class="tag">' + h(pl.evt.payload.conversion_id) + '</span>';
        if (pl.evt.payload.pixel_id) doc += ' &nbsp;<span class="tag">Pixel: ' + h(pl.evt.payload.pixel_id) + '</span>';
        doc += '</div>';

        // Event params table
        const epKeys = Object.keys(ep).filter((k) => ep[k] != null && ep[k] !== "");
        if (epKeys.length) {
          doc += '<table class="data-table"><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>';
          for (const k of epKeys) {
            doc += '<tr><td>' + h(k) + '</td><td>' + h(typeof ep[k] === "object" ? JSON.stringify(ep[k]) : String(ep[k])) + '</td></tr>';
          }
          doc += '</tbody></table>';
        }

        // Items table
        if (items.length) {
          const allKeys = new Set();
          items.forEach((it) => Object.keys(it).forEach((k) => { if (it[k] != null && it[k] !== "") allKeys.add(k); }));
          const cols = Array.from(allKeys);
          doc += '<p class="sub-label">Items (' + items.length + ')</p>';
          doc += '<table class="data-table"><thead><tr>';
          for (const c of cols) doc += '<th>' + h(c) + '</th>';
          doc += '</tr></thead><tbody>';
          for (const it of items) {
            doc += '<tr>';
            for (const c of cols) doc += '<td>' + h(it[c] != null ? (typeof it[c] === "object" ? JSON.stringify(it[c]) : String(it[c])) : "") + '</td>';
            doc += '</tr>';
          }
          doc += '</tbody></table>';
        }

        // User data
        if (ud) {
          doc += '<p class="sub-label">User Data (Enhanced Conversions)</p>';
          doc += '<table class="data-table"><thead><tr><th>Field</th><th>Value (hashed)</th></tr></thead><tbody>';
          for (const [k, v] of Object.entries(ud)) {
            if (v) doc += '<tr><td>' + h(k) + '</td><td><code>' + h(v) + '</code></td></tr>';
          }
          doc += '</tbody></table>';
        }

        doc += '</div>'; // payload-block
      }
    }

    // --- Section 6: Event Timeline ---
    doc += '<h2>Event Timeline</h2>';
    doc += '<table class="data-table timeline"><thead><tr><th>Time</th><th>Source</th><th>Event</th><th>Value</th><th>Items</th></tr></thead><tbody>';

    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    for (const e of sorted) {
      const src = e.source || "ga4";
      const ep = e.payload.event_params || {};
      const items = e.payload.items || [];
      const val = ep.value != null ? String(ep.value) + (ep.currency ? " " + ep.currency : "") : "";
      const time = new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      doc += '<tr>';
      doc += '<td class="mono">' + h(time) + '</td>';
      doc += '<td><span class="src-badge" style="background:' + platColor[src] + '20;color:' + platColor[src] + '">' + platName[src] + '</span></td>';
      doc += '<td class="mono">' + h(e.eventName) + '</td>';
      doc += '<td class="mono">' + h(val) + '</td>';
      doc += '<td>' + (items.length || "") + '</td>';
      doc += '</tr>';
    }
    doc += '</tbody></table>';

    // --- Wrap in full HTML ---
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Cooked Pixels Report</title><style>' +
      reportCSS() +
      '</style></head><body>' +
      '<div class="report">' +
      '<header>' +
      '<h1>\uD83D\uDD25 Cooked Pixels <span class="subtitle">Ecommerce Tracking Report</span></h1>' +
      '<div class="meta">' +
      '<div><strong>Page:</strong> ' + h(pageUrlText) + '</div>' +
      '<div><strong>Generated:</strong> ' + h(dateStr) + ' at ' + h(timeStr) + '</div>' +
      '<div><strong>Events:</strong> ' + totalEvents + ' across ' + sourceSet.size + ' platform' + (sourceSet.size > 1 ? 's' : '') + '</div>' +
      '</div>' +
      '</header>' +
      doc +
      '<footer>Generated by Cooked Pixels v1.5.0 \u2014 Ecommerce Event Inspector</footer>' +
      '</div>' +
      '<script>window.onload=function(){window.print()}<\/script>' +
      '</body></html>';
  }

  function reportCSS() {
    return '*{margin:0;padding:0;box-sizing:border-box}' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:12px;color:#1a1a1a;background:#fff;padding:20px 30px;line-height:1.5}' +
      '.report{max-width:900px;margin:0 auto}' +
      'h1{font-size:20px;font-weight:800;color:#1a1a1a;margin-bottom:4px}' +
      'h1 .subtitle{font-weight:400;font-size:13px;color:#666;margin-left:8px}' +
      'h2{font-size:15px;font-weight:700;color:#1a1a1a;margin:24px 0 10px;padding-bottom:6px;border-bottom:2px solid #e5e5e5}' +
      'h3{font-size:13px;font-weight:700;color:#444;margin:16px 0 8px}' +
      '.meta{font-size:11px;color:#666;margin:8px 0 20px;display:flex;gap:20px;flex-wrap:wrap}' +
      'header{border-bottom:3px solid #1a1a1a;padding-bottom:16px;margin-bottom:24px}' +
      'footer{margin-top:40px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:10px;color:#999;text-align:center}' +

      // Stage cards
      '.stage-card{border:1px solid #e0e0e0;border-radius:6px;margin-bottom:12px;overflow:hidden;break-inside:avoid}' +
      '.stage-header{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f8f8f8;border-bottom:1px solid #e0e0e0}' +
      '.stage-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}' +
      '.sev-badge{margin-left:auto;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px}' +

      // Platform table
      '.plat-table{width:100%;border-collapse:collapse}' +
      '.plat-table td{padding:5px 12px;border-bottom:1px solid #f0f0f0;font-size:11px}' +
      '.plat-name{font-weight:700;font-size:10px;width:80px;white-space:nowrap}' +
      '.plat-evt{font-family:"SF Mono",Consolas,monospace;font-weight:600}' +
      '.plat-vals{font-family:"SF Mono",Consolas,monospace;color:#555}' +
      '.plat-na{color:#999;font-style:italic}' +

      // Enhanced Conversions bar
      '.ec-bar{display:flex;align-items:center;gap:16px;padding:6px 12px;background:#f8f8f8;border-top:1px solid #e0e0e0;font-size:11px}' +
      '.ec-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#888}' +
      '.ec-plat{display:inline-flex;align-items:center;gap:4px}' +
      '.ec-ok{color:#059669;font-weight:700}' +
      '.na{color:#999;font-size:10px}' +

      // Findings
      '.findings{padding:6px 12px;border-top:1px solid #e0e0e0;background:#fafafa}' +
      '.finding{font-size:11px;padding:2px 0}' +

      // Data tables
      '.data-table{width:100%;border-collapse:collapse;margin:4px 0 12px;font-size:11px}' +
      '.data-table th{background:#f5f5f5;text-align:left;padding:4px 8px;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.3px;color:#555;border-bottom:2px solid #e0e0e0}' +
      '.data-table td{padding:3px 8px;border-bottom:1px solid #f0f0f0;font-family:"SF Mono",Consolas,monospace;font-size:10.5px;word-break:break-all}' +
      '.data-table tr:nth-child(even){background:#fafafa}' +

      // Payload blocks
      '.payload-block{margin-bottom:16px;break-inside:avoid}' +
      '.payload-header{padding:6px 10px;background:#f8f8f8;border-radius:4px;font-size:11px;margin-bottom:4px}' +
      '.payload-header code{font-family:"SF Mono",Consolas,monospace;font-weight:600}' +
      '.tag{font-size:9px;padding:1px 6px;background:#e8e8e8;border-radius:3px;color:#555}' +
      '.sub-label{font-size:10px;font-weight:700;color:#555;margin:8px 0 2px;text-transform:uppercase;letter-spacing:0.3px}' +
      '.src-badge{font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;white-space:nowrap}' +
      '.mono{font-family:"SF Mono",Consolas,monospace}' +

      // Timeline
      '.timeline td{padding:2px 8px}' +

      // Pixel Inspector section
      '.pixel-section{border:1px solid #e0e0e0;border-radius:6px;margin-bottom:12px;padding:10px 12px;break-inside:avoid}' +
      '.pixel-plat-header{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px}' +
      '.pixel-warn{color:#f59e0b;font-size:10px;font-weight:700;margin-left:auto}' +

      // Check Matrix grid
      '.check-grid td{text-align:center;font-size:10.5px}' +
      '.check-grid td:first-child{text-align:left}' +
      '.cm-report-hit{color:#059669;font-weight:600}' +
      '.cm-report-miss{color:#999;font-size:14px}' +
      '.cm-report-na{color:#999;font-style:italic}' +

      // Consent Mode
      '.consent-granted{color:#059669;font-weight:700}' +
      '.consent-denied{color:#ef4444;font-weight:700}' +
      '.consent-not_set{color:#999;font-weight:600}' +
      '.consent-unknown{color:#999;font-style:italic}' +
      '.consent-discrepancy{color:#f59e0b;font-weight:700}' +
      '.consent-raw{border:1px solid #e0e0e0;border-radius:4px;padding:8px 12px;margin-bottom:8px;break-inside:avoid}' +
      '.consent-raw-value{font-size:11px;background:#f5f5f5;padding:4px 8px;border-radius:3px;margin:4px 0}' +
      '.consent-decoded{font-size:10px;color:#666;padding:2px 8px;line-height:1.6}' +
      '.consent-note{font-size:10px;color:#888;font-style:italic;margin-top:8px;padding:6px 10px;background:#f8f8f8;border-radius:4px}' +

      // Shared utility
      '.no-data{color:#999;font-style:italic;font-size:11px;padding:8px 0}' +

      // Print
      '@media print{body{padding:10px 15px}h2{break-before:avoid}.stage-card{break-inside:avoid}.payload-block{break-inside:avoid}.pixel-section{break-inside:avoid}.consent-raw{break-inside:avoid}.check-grid{break-inside:avoid}}' +
      '@page{margin:15mm 12mm;size:A4}';
  }

  // ------------------------------------------------------------------
  init();
})();
