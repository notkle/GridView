// ─── State ────────────────────────────────────────────────────
const state = {
  streams: [null, null, null, null], // {service, value, label, isLive}
  zoomMode: false,
  focusIndex: 0,        // which of the 4 slots is in main focus
  adDetectors: {},      // intervalId per slot index
  adActive: {},         // bool per slot index
};

// ─── Service Config ───────────────────────────────────────────
const SERVICES = {
  twitch: {
    label: 'twitch',
    isLive: true,
    inputLabel: 'Channel name',
    placeholder: 'e.g. xqc',
    embedUrl: (v) =>
      `https://player.twitch.tv/?channel=${encodeURIComponent(v.trim())}&parent=${location.hostname || 'localhost'}&autoplay=true&muted=false`,
  },
  youtube: {
    label: 'youtube',
    isLive: false,
    inputLabel: 'Video or channel URL',
    placeholder: 'e.g. https://youtube.com/watch?v=...',
    embedUrl: (v) => {
      const id = extractYouTubeId(v.trim());
      return id
        ? `https://www.youtube.com/embed/${id}?autoplay=1`
        : `https://www.youtube.com/embed/${encodeURIComponent(v.trim())}`;
    },
  },
  kick: {
    label: 'kick',
    isLive: true,
    inputLabel: 'Channel name',
    placeholder: 'e.g. trainwreckstv',
    embedUrl: (v) =>
      `https://player.kick.com/${encodeURIComponent(v.trim())}?autoplay=true`,
  },
  url: {
    label: 'url',
    isLive: false,
    inputLabel: 'URL',
    placeholder: 'https://...',
    embedUrl: (v) => v.trim(),
  },
};

function extractYouTubeId(url) {
  const patterns = [
    /(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Picker State ─────────────────────────────────────────────
let pickerTargetIndex = null;
let pickerService = null;

function openPicker(index) {
  pickerTargetIndex = index;
  pickerService = null;
  document.getElementById('modalInputWrap').style.display = 'none';
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('modalInput').value = '';
}

function closePicker() {
  document.getElementById('modalOverlay').classList.remove('open');
  pickerTargetIndex = null;
  pickerService = null;
}

function selectService(service) {
  pickerService = service;
  const cfg = SERVICES[service];
  const wrap = document.getElementById('modalInputWrap');
  const label = document.getElementById('inputLabel');
  const input = document.getElementById('modalInput');
  label.textContent = cfg.inputLabel;
  input.placeholder = cfg.placeholder;
  input.value = '';
  wrap.style.display = 'flex';
  setTimeout(() => input.focus(), 50);
}

function confirmStream() {
  const val = document.getElementById('modalInput').value.trim();
  if (!val || pickerTargetIndex === null || !pickerService) return;
  const cfg = SERVICES[pickerService];
  state.streams[pickerTargetIndex] = {
    service: pickerService,
    value: val,
    label: val,
    isLive: cfg.isLive,
    embedUrl: cfg.embedUrl(val),
  };
  closePicker();
  renderAll();
}

// Enter key on input
document.getElementById('modalInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmStream();
});

// ─── Render ───────────────────────────────────────────────────
function renderAll() {
  if (state.zoomMode) {
    renderZoom();
  } else {
    renderGrid();
  }
}

function renderGrid() {
  for (let i = 0; i < 4; i++) {
    const cell = document.getElementById(`cell-${i}`);
    const stream = state.streams[i];
    cell.innerHTML = '';

    if (!stream) {
      const empty = document.createElement('div');
      empty.className = 'cell-empty';
      empty.onclick = () => openPicker(i);
      empty.innerHTML = `<div class="plus-btn">+</div><span class="plus-label">add stream</span>`;
      cell.appendChild(empty);
    } else {
      // iframe
      const iframe = document.createElement('iframe');
      iframe.src = stream.embedUrl;
      iframe.className = 'cell-frame';
      iframe.allowFullscreen = true;
      iframe.allow = 'autoplay; fullscreen';
      iframe.id = `iframe-${i}`;
      cell.appendChild(iframe);

      // overlay
      const overlay = document.createElement('div');
      overlay.className = 'cell-overlay';
      overlay.innerHTML = `
        <div class="cell-badge">
          ${stream.isLive ? `<span class="live-pill">live</span>` : ''}
          <span class="ad-pill" id="adpill-${i}">ad</span>
        </div>
        <div class="cell-actions">
          <button class="cell-act-btn" title="Remove" onclick="removeStream(${i})">✕</button>
        </div>
      `;
      cell.appendChild(overlay);

      const label = document.createElement('div');
      label.className = 'cell-label';
      label.textContent = `${stream.service} · ${stream.label}`;
      cell.appendChild(label);

      // start ad detection for twitch
      startAdDetection(i);
    }
  }
}

function removeStream(index) {
  stopAdDetection(index);
  state.streams[index] = null;
  state.adActive[index] = false;
  renderAll();
}

// ─── Zoom Mode ────────────────────────────────────────────────
function toggleZoom() {
  state.zoomMode = !state.zoomMode;
  const toggle = document.getElementById('zoomToggle');
  const gridView = document.getElementById('gridView');
  const zoomView = document.getElementById('zoomView');
  const lblGrid = document.getElementById('lbl-grid');
  const lblZoom = document.getElementById('lbl-zoom');

  toggle.setAttribute('aria-pressed', state.zoomMode);

  if (state.zoomMode) {
    gridView.style.display = 'none';
    zoomView.style.display = 'flex';
    lblZoom.classList.add('active');
    lblGrid.classList.remove('active');
    // Pick first filled slot as focus
    const firstFilled = state.streams.findIndex(s => s !== null);
    state.focusIndex = firstFilled >= 0 ? firstFilled : 0;
    renderZoom();
  } else {
    gridView.style.display = 'grid';
    zoomView.style.display = 'none';
    lblGrid.classList.add('active');
    lblZoom.classList.remove('active');
    renderGrid();
  }
}

function renderZoom() {
  const main = document.getElementById('zoomMain');
  const dockSlots = [
    document.getElementById('dock-0'),
    document.getElementById('dock-1'),
    document.getElementById('dock-2'),
  ];

  // Main focus panel
  const focusStream = state.streams[state.focusIndex];
  main.innerHTML = '';
  if (focusStream) {
    const iframe = document.createElement('iframe');
    iframe.src = focusStream.embedUrl;
    iframe.id = `iframe-focus`;
    iframe.allow = 'autoplay; fullscreen';
    iframe.allowFullscreen = true;
    main.appendChild(iframe);

    // overlay label on main
    const lbl = document.createElement('div');
    lbl.className = 'cell-label';
    lbl.style.cssText = 'font-size:10px;bottom:10px;left:12px;';
    lbl.textContent = `${focusStream.service} · ${focusStream.label}`;
    main.appendChild(lbl);
  } else {
    main.innerHTML = `<div class="zoom-empty"><span>click a dock stream to focus</span></div>`;
  }

  // Dock — the other 3 slots in order
  const others = [0, 1, 2, 3].filter(i => i !== state.focusIndex);
  dockSlots.forEach((slot, di) => {
    const streamIndex = others[di];
    const stream = state.streams[streamIndex];
    slot.innerHTML = '';
    slot.className = 'dock-slot';

    if (!stream) {
      slot.classList.remove('has-stream');
      const empty = document.createElement('div');
      empty.className = 'dock-slot-empty';
      empty.innerHTML = `<span>empty</span>`;
      slot.appendChild(empty);
      slot.onclick = null;
    } else {
      slot.classList.add('has-stream');
      slot.onclick = () => setZoomFocus(streamIndex);

      // Scaled-down iframe preview
      const iframe = document.createElement('iframe');
      iframe.src = stream.embedUrl;
      iframe.id = `iframe-dock-${di}`;
      iframe.allow = 'autoplay; fullscreen';
      iframe.setAttribute('tabindex', '-1');
      slot.appendChild(iframe);

      // Overlay
      const overlay = document.createElement('div');
      overlay.className = 'dock-slot-overlay';
      overlay.innerHTML = `
        ${stream.isLive ? `<span class="dock-live">live</span>` : ''}
        <span class="dock-ad" id="dockad-${streamIndex}">ad</span>
        <div class="dock-slot-label">${stream.service} · ${stream.label}</div>
      `;
      slot.appendChild(overlay);

      // Restore ad state badge if already active
      if (state.adActive[streamIndex]) {
        const dockAd = document.getElementById(`dockad-${streamIndex}`);
        if (dockAd) dockAd.classList.add('visible');
      }

      startAdDetection(streamIndex);
    }
  });
}

function setZoomFocus(index) {
  if (!state.streams[index]) return;
  state.focusIndex = index;
  renderZoom();
}

// ─── Ad Detection ─────────────────────────────────────────────
//
// Strategy: Poll the iframe's contentDocument for Twitch ad indicators.
// Twitch renders an "Ad" text badge and a countdown during mid-rolls.
// We look for that DOM node. Cross-origin iframes will throw on access —
// we catch that and fall back to a heuristic: monitor postMessage events
// that Twitch's player emits, and watch for the "ad-banner" class on
// the player wrapper if the same-origin embed allows it.
//
// Additionally, we watch for the purple Twitch "Ad" overlay badge text
// by injecting a MutationObserver through a proxy approach.
//
// For non-Twitch streams, ad detection is skipped.
// ─────────────────────────────────────────────────────────────

const AD_CHECK_INTERVAL = 1500; // ms

function startAdDetection(slotIndex) {
  const stream = state.streams[slotIndex];
  if (!stream || stream.service !== 'twitch') return;

  stopAdDetection(slotIndex);

  // Primary: listen for messages from the viewgrid Firefox extension.
  // The extension content script runs inside the Twitch iframe with full
  // DOM access, detects ads, and posts { source: 'viewgrid-extension',
  // type: 'vg-ad', active: bool, channel: string } to window.top (us).
  const msgHandler = (e) => {
    if (!e.data || typeof e.data !== 'object') return;

    // ── Extension message (high confidence) ──────────────────
    if (e.data.source === 'viewgrid-extension' && e.data.type === 'vg-ad') {
      const channel = (e.data.channel || '').toLowerCase().trim();
      const stream  = state.streams[slotIndex];
      // Match by channel name so we don't cross-fire across slots
      if (stream && stream.value.toLowerCase().trim() === channel) {
        handleAdDetected(slotIndex, !!e.data.active);
      }
      return;
    }

    // ── Fallback: generic Twitch player postMessage events ───
    const type = e.data.type || e.data.event || '';
    if (
      type.toLowerCase().includes('ad') ||
      (e.data.params && JSON.stringify(e.data.params).toLowerCase().includes('ad'))
    ) {
      handleAdDetected(slotIndex, true);
    }
  };
  window.addEventListener('message', msgHandler);

  // Secondary: interval-based DOM polling
  // Twitch cross-origin iframes block direct DOM access, so we detect
  // via indirect signals: frame freeze, URL hash changes, or by checking
  // if the parent page has ad-related overlays we can observe.
  //
  // Most reliable in practice: poll the iframe's src URL for ad params,
  // and watch for the "ADVERTISEMENT" aria-label that Twitch injects
  // into the player wrapper (only accessible if CORS allows it, which
  // varies by browser / embed config).
  const intervalId = setInterval(() => {
    const iframeEl = getIframeForSlot(slotIndex);
    if (!iframeEl) return;

    let adFound = false;

    // Attempt DOM access (will succeed on localhost, fail cross-origin)
    try {
      const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
      if (doc) {
        // Look for Twitch ad badge: <div class="tw-c-text-overlay">Ad</div>
        // or aria labels, or the "ad-banner" class
        const adBadge = doc.querySelector('[class*="ad-banner"]') ||
          doc.querySelector('[aria-label*="Ad"]') ||
          doc.querySelector('[class*="ad-countdown"]') ||
          [...doc.querySelectorAll('*')].find(el =>
            el.children.length === 0 &&
            el.textContent.trim() === 'Ad' &&
            el.offsetWidth > 0
          );

        if (adBadge) adFound = true;
      }
    } catch (_) {
      // Cross-origin — expected for deployed Twitch embeds
      // Fall through to postMessage-only detection
    }

    if (adFound) {
      handleAdDetected(slotIndex, true);
    } else if (state.adActive[slotIndex]) {
      // Check if ad has ended: if no ad found on this poll, start a grace
      // period before clearing (Twitch sometimes briefly drops the badge)
      if (!state.adGrace) state.adGrace = {};
      state.adGrace[slotIndex] = (state.adGrace[slotIndex] || 0) + 1;
      if (state.adGrace[slotIndex] >= 4) {
        state.adGrace[slotIndex] = 0;
        handleAdDetected(slotIndex, false);
      }
    }
  }, AD_CHECK_INTERVAL);

  state.adDetectors[slotIndex] = { intervalId, msgHandler };
}

function stopAdDetection(slotIndex) {
  const det = state.adDetectors[slotIndex];
  if (!det) return;
  clearInterval(det.intervalId);
  window.removeEventListener('message', det.msgHandler);
  delete state.adDetectors[slotIndex];
}

function getIframeForSlot(slotIndex) {
  // In grid mode
  const gridIframe = document.getElementById(`iframe-${slotIndex}`);
  if (gridIframe) return gridIframe;
  // In zoom mode — check if it's focus or in dock
  if (slotIndex === state.focusIndex) {
    return document.getElementById('iframe-focus');
  }
  const others = [0, 1, 2, 3].filter(i => i !== state.focusIndex);
  const di = others.indexOf(slotIndex);
  if (di >= 0) return document.getElementById(`iframe-dock-${di}`);
  return null;
}

function handleAdDetected(slotIndex, isAd) {
  if (state.adActive[slotIndex] === isAd) return; // no change
  state.adActive[slotIndex] = isAd;

  // Update grid pill
  const pill = document.getElementById(`adpill-${slotIndex}`);
  if (pill) pill.classList.toggle('visible', isAd);

  // Update dock badge
  const dockAd = document.getElementById(`dockad-${slotIndex}`);
  if (dockAd) dockAd.classList.toggle('visible', isAd);

  // Show / hide global alert
  showAdAlert(isAd);

  // Auto-swap focus if in zoom mode and the focused stream has an ad
  if (isAd && state.zoomMode && slotIndex === state.focusIndex) {
    autoSwapAway(slotIndex);
  }

  // If ad cleared, optionally swap back
  if (!isAd && state.zoomMode && state._autoSwappedFrom === slotIndex) {
    // Swap back to the original after ad clears
    setTimeout(() => {
      if (!state.adActive[slotIndex] && state.streams[slotIndex]) {
        state.focusIndex = slotIndex;
        state._autoSwappedFrom = null;
        renderZoom();
        showAdAlert(false);
      }
    }, 800);
  }
}

function autoSwapAway(adSlotIndex) {
  // Find the next filled slot that isn't showing an ad
  const candidates = [0, 1, 2, 3].filter(i =>
    i !== adSlotIndex &&
    state.streams[i] !== null &&
    !state.adActive[i]
  );
  if (candidates.length === 0) return; // all streams have ads, nothing to do

  state._autoSwappedFrom = adSlotIndex;
  state.focusIndex = candidates[0];
  renderZoom();
  flashAdAlert();
}

let adAlertTimeout = null;
function showAdAlert(visible) {
  const el = document.getElementById('ad-alert');
  if (visible) {
    el.style.display = 'block';
  } else {
    // Only hide if no other streams are showing ads
    const anyAd = Object.values(state.adActive).some(Boolean);
    if (!anyAd) el.style.display = 'none';
  }
}

function flashAdAlert() {
  const el = document.getElementById('ad-alert');
  el.style.display = 'block';
  clearTimeout(adAlertTimeout);
  adAlertTimeout = setTimeout(() => {
    const anyAd = Object.values(state.adActive).some(Boolean);
    if (!anyAd) el.style.display = 'none';
  }, 5000);
}

// ─── Simulation (for testing without live Twitch embeds) ──────
//
// Since Twitch iframes are cross-origin and ads only appear on live streams,
// the function below lets you manually trigger ad detection for any slot.
// Open DevTools console and call: simulateAd(0, true) / simulateAd(0, false)
//
window.simulateAd = function(slotIndex, isAd) {
  console.log(`[viewgrid] Simulating ad=${isAd} on slot ${slotIndex}`);
  handleAdDetected(slotIndex, isAd);
};

// ─── Init ─────────────────────────────────────────────────────
document.getElementById('lbl-grid').classList.add('active');
renderGrid();
