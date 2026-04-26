// ─── State ────────────────────────────────────────────────────
const state = {
  streams:    [null, null, null, null],
  zoomMode:   false,
  focusIndex: 0,
  adDetectors:{},
  adActive:   {},
  adGrace:    {},
  _autoSwappedFrom: null,
};

// ─── Piped instance ───────────────────────────────────────────
const PIPED_FALLBACKS = [
  'https://piped.video',
  'https://piped.adminforge.de',
  'https://piped.privacydev.net',
];
let pipedInstance = PIPED_FALLBACKS[0];

async function resolvePipedInstance() {
  for (const fallback of PIPED_FALLBACKS) {
    try {
      const res = await fetch(fallback + '/feed/trending', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
        mode: 'no-cors',
      });
      pipedInstance = fallback;
      console.log('[gridview] Piped instance:', pipedInstance);
      break;
    } catch (_) {}
  }
  const hint = document.getElementById('yt-instance-hint');
  if (hint) hint.textContent = 'browse & pick';
}

// ─── Service Config ───────────────────────────────────────────
const BROWSER_HOME = 'https://piped.video';

const SERVICES = {
  twitch: {
    label:      'twitch',
    isLive:     true,
    inputLabel: 'Channel name',
    placeholder:'e.g. yourfavoritestreamer',
    needsInput: true,
    isBrowser:  false,
    embedUrl: (v) =>
      `https://player.twitch.tv/?channel=${encodeURIComponent(v.trim())}&parent=${location.hostname}&autoplay=true`,
  },
  youtube: {
    label:      'youtube',
    isLive:     false,
    needsInput: false,
    isBrowser:  true,   // gets nav bar, loads Piped
    embedUrl: () => pipedInstance,
  },
  kick: {
    label:      'kick',
    isLive:     true,
    inputLabel: 'Channel name',
    placeholder:'e.g. channelname',
    needsInput: true,
    isBrowser:  false,
    embedUrl: (v) =>
      `https://player.kick.com/${encodeURIComponent(v.trim())}?autoplay=true`,
  },
  url: {
    label:      'url',
    isLive:     false,
    inputLabel: 'Full URL',
    placeholder:'https://example.com',
    needsInput: true,
    isBrowser:  true,   // also gets nav bar
    embedUrl: (v) => {
      v = v.trim();
      if (v && !v.match(/^https?:\/\//i)) v = 'https://' + v;
      return v;
    },
  },
};

// ─── Iframe pool ──────────────────────────────────────────────
// One iframe per slot, never destroyed, just moved.
const pool = [0, 1, 2, 3].map(i => {
  const f = document.createElement('iframe');
  f.id    = `pool-iframe-${i}`;
  f.allow = 'autoplay; fullscreen';
  f.allowFullscreen = true;
  f.style.cssText = 'width:100%;height:100%;border:none;display:block;flex:1;min-height:0;background:#000;';
  return f;
});

// ─── Browser nav bars ─────────────────────────────────────────
// Each browser-type slot has a persistent nav bar wrapper.
// The wrapper holds: [nav bar][iframe]. Both stay alive.
const browserWrappers = [0, 1, 2, 3].map(i => {
  const wrap = document.createElement('div');
  wrap.id        = `browser-wrap-${i}`;
  wrap.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;';

  const nav = document.createElement('div');
  nav.className  = 'browser-nav';
  nav.innerHTML  = `
    <button class="nav-btn" id="nav-back-${i}" onclick="navBack(${i})" title="Back">&#8592;</button>
    <button class="nav-btn" id="nav-fwd-${i}"  onclick="navFwd(${i})"  title="Forward">&#8594;</button>
    <button class="nav-btn" id="nav-home-${i}" onclick="navHome(${i})" title="Home">&#8962;</button>
    <input  class="nav-url" id="nav-url-${i}"  type="text" spellcheck="false" placeholder="https://..." />
    <button class="nav-go"  id="nav-go-${i}"   onclick="navGo(${i})">go</button>
  `;
  wrap.appendChild(nav);

  // Wire Enter key on url bar
  setTimeout(() => {
    const urlBar = document.getElementById(`nav-url-${i}`);
    if (urlBar) urlBar.addEventListener('keydown', e => { if (e.key === 'Enter') navGo(i); });
  }, 0);

  return wrap;
});

// Attach pool iframes into browser wrappers
pool.forEach((iframe, i) => {
  browserWrappers[i].appendChild(iframe);
});

// Navigate the browser panel
function navGo(i) {
  const urlBar = document.getElementById(`nav-url-${i}`);
  if (!urlBar) return;
  let url = urlBar.value.trim();
  if (!url) return;
  if (!url.match(/^https?:\/\//i)) url = 'https://' + url;
  urlBar.value = url;
  pool[i].src  = url;
  if (state.streams[i]) state.streams[i].embedUrl = url;
}
function navBack(i)  { try { pool[i].contentWindow.history.back();    } catch(_) {} }
function navFwd(i)   { try { pool[i].contentWindow.history.forward(); } catch(_) {} }
function navHome(i)  {
  const stream = state.streams[i];
  const home   = stream ? SERVICES[stream.service].embedUrl(stream.value) : BROWSER_HOME;
  pool[i].src  = home;
  const urlBar = document.getElementById(`nav-url-${i}`);
  if (urlBar) urlBar.value = home;
}

// Update url bar when iframe navigates (same-origin only; cross-origin silently ignored)
pool.forEach((iframe, i) => {
  iframe.addEventListener('load', () => {
    const urlBar = document.getElementById(`nav-url-${i}`);
    if (!urlBar) return;
    try {
      const href = iframe.contentWindow.location.href;
      if (href && href !== 'about:blank') urlBar.value = href;
    } catch (_) { /* cross-origin */ }
  });
});

// ─── Which container to use for a slot ────────────────────────
function containerFor(i) {
  const stream = state.streams[i];
  if (stream && SERVICES[stream.service].isBrowser) return browserWrappers[i];
  return pool[i];
}

// ─── Picker ───────────────────────────────────────────────────
let pickerTargetIndex = null;
let pickerService     = null;

function openPicker(index) {
  pickerTargetIndex = index;
  pickerService     = null;
  document.getElementById('modalInputWrap').style.display = 'none';
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('modalInput').value = '';
}

function closePicker() {
  document.getElementById('modalOverlay').classList.remove('open');
  pickerTargetIndex = null;
  pickerService     = null;
}

function selectService(service) {
  pickerService = service;
  const cfg = SERVICES[service];
  if (!cfg.needsInput) {
    addStream(pickerTargetIndex, service, '', 'youtube');
    closePicker();
    return;
  }
  document.getElementById('inputLabel').textContent       = cfg.inputLabel;
  document.getElementById('modalInput').placeholder       = cfg.placeholder;
  document.getElementById('modalInput').value             = '';
  document.getElementById('modalInputWrap').style.display = 'flex';
  setTimeout(() => document.getElementById('modalInput').focus(), 50);
}

function confirmStream() {
  const val = document.getElementById('modalInput').value.trim();
  if (!val || pickerTargetIndex === null || !pickerService) return;
  addStream(pickerTargetIndex, pickerService, val, val);
  closePicker();
}

function addStream(index, service, value, label) {
  const cfg    = SERVICES[service];
  const url    = cfg.embedUrl(value);
  state.streams[index] = { service, value, label, isLive: cfg.isLive, embedUrl: url };

  // Set iframe src
  pool[index].src = url;

  // Pre-fill nav bar if browser type
  if (cfg.isBrowser) {
    const urlBar = document.getElementById(`nav-url-${index}`);
    if (urlBar) urlBar.value = url;
  }

  layout();
  startAdDetection(index);
}

document.getElementById('modalInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmStream();
});

function removeStream(index) {
  stopAdDetection(index);
  state.streams[index]  = null;
  state.adActive[index] = false;
  pool[index].src       = 'about:blank';
  const urlBar = document.getElementById(`nav-url-${index}`);
  if (urlBar) urlBar.value = '';
  layout();
}

// ─── Layout ───────────────────────────────────────────────────
function layout() {
  state.zoomMode ? layoutZoom() : layoutGrid();
  updateOverlays();
}

function placeSlot(i, targetEl) {
  const el = containerFor(i);
  if (el.parentNode !== targetEl) targetEl.appendChild(el);
}

function unplaceSlot(i, fromEl) {
  const el = containerFor(i);
  if (el.parentNode === fromEl) fromEl.removeChild(el);
}

function layoutGrid() {
  for (let i = 0; i < 4; i++) {
    const cell   = document.getElementById(`cell-${i}`);
    const stream = state.streams[i];
    if (!stream) {
      unplaceSlot(i, cell);
      if (!cell.querySelector('.cell-empty')) {
        cell.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'cell-empty';
        empty.onclick   = () => openPicker(i);
        empty.innerHTML = `<div class="plus-btn">+</div><span class="plus-label">add stream</span>`;
        cell.appendChild(empty);
      }
    } else {
      cell.querySelector('.cell-empty')?.remove();
      placeSlot(i, cell);
    }
  }
}

function layoutZoom() {
  const mainEl  = document.getElementById('zoomMain');
  const dockEls = [0,1,2].map(d => document.getElementById(`dock-${d}`));
  const others  = [0,1,2,3].filter(i => i !== state.focusIndex);

  // Focus → main
  if (state.streams[state.focusIndex]) {
    mainEl.querySelector('.zoom-empty')?.remove();
    placeSlot(state.focusIndex, mainEl);
  } else {
    unplaceSlot(state.focusIndex, mainEl);
    if (!mainEl.querySelector('.zoom-empty'))
      mainEl.innerHTML = `<div class="zoom-empty"><span>select a stream to focus</span></div>`;
  }

  // Others → dock
  dockEls.forEach((slot, di) => {
    const si     = others[di];
    const stream = state.streams[si];
    if (!stream) {
      unplaceSlot(si, slot);
      if (!slot.querySelector('.dock-slot-empty')) {
        slot.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'dock-slot-empty';
        empty.innerHTML = `<span>empty</span>`;
        slot.appendChild(empty);
      }
      slot.onclick = null;
      slot.classList.remove('has-stream');
    } else {
      slot.querySelector('.dock-slot-empty')?.remove();
      slot.classList.add('has-stream');
      slot.onclick = () => setZoomFocus(si);
      placeSlot(si, slot);
    }
  });
}

// ─── Overlays ─────────────────────────────────────────────────
function updateOverlays() {
  state.zoomMode ? updateZoomOverlays() : updateGridOverlays();
}

function updateGridOverlays() {
  for (let i = 0; i < 4; i++) {
    const cell   = document.getElementById(`cell-${i}`);
    const stream = state.streams[i];
    cell.querySelector('.cell-overlay')?.remove();
    cell.querySelector('.cell-label')?.remove();
    if (!stream) continue;

    const overlay = document.createElement('div');
    overlay.className = 'cell-overlay';
    overlay.innerHTML = `
      <div class="cell-badge">
        ${stream.isLive ? `<span class="live-pill">live</span>` : ''}
        <span class="ad-pill${state.adActive[i] ? ' visible' : ''}" id="adpill-${i}">ad</span>
      </div>
      <div class="cell-actions">
        <button class="cell-act-btn" title="Remove" onclick="removeStream(${i})">✕</button>
      </div>`;
    cell.appendChild(overlay);

    // Label only for non-browser panels (browser has nav bar)
    if (!SERVICES[stream.service].isBrowser) {
      const lbl = document.createElement('div');
      lbl.className   = 'cell-label';
      lbl.textContent = `${stream.service} · ${stream.label}`;
      cell.appendChild(lbl);
    }
  }
}

function updateZoomOverlays() {
  const mainEl  = document.getElementById('zoomMain');
  const dockEls = [0,1,2].map(d => document.getElementById(`dock-${d}`));
  const others  = [0,1,2,3].filter(i => i !== state.focusIndex);

  mainEl.querySelector('.zoom-main-overlay')?.remove();
  const fs = state.streams[state.focusIndex];
  if (fs) {
    const ov = document.createElement('div');
    ov.className = 'zoom-main-overlay';
    ov.innerHTML = `
      <div class="zoom-main-label">${fs.service} · ${fs.label}</div>
      <button class="cell-act-btn zoom-remove-btn" title="Remove"
        onclick="removeStream(${state.focusIndex})">✕</button>`;
    mainEl.appendChild(ov);
  }

  dockEls.forEach((slot, di) => {
    const si     = others[di];
    const stream = state.streams[si];
    slot.querySelector('.dock-slot-overlay')?.remove();
    if (!stream) return;
    const ov = document.createElement('div');
    ov.className = 'dock-slot-overlay';
    ov.innerHTML = `
      ${stream.isLive ? `<span class="dock-live">live</span>` : ''}
      <span class="dock-ad${state.adActive[si] ? ' visible' : ''}" id="dockad-${si}">ad</span>
      <div class="dock-slot-label">${stream.service} · ${stream.label}</div>`;
    slot.appendChild(ov);
  });
}

// ─── Zoom toggle ──────────────────────────────────────────────
function toggleZoom() {
  state.zoomMode = !state.zoomMode;
  document.getElementById('zoomToggle').setAttribute('aria-pressed', state.zoomMode);
  document.getElementById('gridView').style.display  = state.zoomMode ? 'none' : 'grid';
  document.getElementById('zoomView').style.display  = state.zoomMode ? 'flex' : 'none';
  document.getElementById('lbl-zoom').classList.toggle('active', state.zoomMode);
  document.getElementById('lbl-grid').classList.toggle('active', !state.zoomMode);
  if (state.zoomMode) {
    const first = state.streams.findIndex(s => s !== null);
    state.focusIndex = first >= 0 ? first : 0;
  }
  layout();
}

function setZoomFocus(index) {
  if (!state.streams[index]) return;
  state.focusIndex = index;
  layout();
}

// ─── Ad Detection ─────────────────────────────────────────────
const AD_CHECK_INTERVAL = 1500;

function startAdDetection(slotIndex) {
  const stream = state.streams[slotIndex];
  if (!stream || stream.service !== 'twitch') return;
  stopAdDetection(slotIndex);

  const msgHandler = (e) => {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.source === 'gridview-extension' && e.data.type === 'vg-ad') {
      const channel = (e.data.channel || '').toLowerCase().trim();
      const s = state.streams[slotIndex];
      if (s && s.value.toLowerCase().trim() === channel)
        handleAdDetected(slotIndex, !!e.data.active);
      return;
    }
    const type = (e.data.type || e.data.event || '');
    if (type.toLowerCase().includes('ad')) handleAdDetected(slotIndex, true);
  };
  window.addEventListener('message', msgHandler);

  const intervalId = setInterval(() => {
    const iframe = pool[slotIndex];
    let found = false;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) found = !!(
        doc.querySelector('[class*="ad-banner"]')           ||
        doc.querySelector('[class*="ad-countdown"]')        ||
        doc.querySelector('[data-a-target="ad-countdown"]') ||
        doc.querySelector('[aria-label="Advertisement"]')   ||
        [...doc.querySelectorAll('*')].find(el =>
          el.children.length === 0 &&
          el.textContent.trim() === 'Ad' &&
          el.offsetParent !== null)
      );
    } catch (_) {}

    if (found) {
      handleAdDetected(slotIndex, true);
    } else if (state.adActive[slotIndex]) {
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

function handleAdDetected(slotIndex, isAd) {
  if (state.adActive[slotIndex] === isAd) return;
  state.adActive[slotIndex] = isAd;
  document.getElementById(`adpill-${slotIndex}`)?.classList.toggle('visible', isAd);
  document.getElementById(`dockad-${slotIndex}`)?.classList.toggle('visible', isAd);
  showAdAlert(isAd);
  if (isAd && state.zoomMode && slotIndex === state.focusIndex) autoSwapAway(slotIndex);
  if (!isAd && state.zoomMode && state._autoSwappedFrom === slotIndex) {
    setTimeout(() => {
      if (!state.adActive[slotIndex] && state.streams[slotIndex]) {
        state.focusIndex = slotIndex;
        state._autoSwappedFrom = null;
        layout();
        showAdAlert(false);
      }
    }, 1200);
  }
}

function autoSwapAway(adSlotIndex) {
  const candidates = [0,1,2,3].filter(i =>
    i !== adSlotIndex && state.streams[i] !== null && !state.adActive[i]);
  if (!candidates.length) return;
  state._autoSwappedFrom = adSlotIndex;
  state.focusIndex = candidates[0];
  layout();
  flashAdAlert();
}

let adAlertTimeout = null;
function showAdAlert(visible) {
  const el = document.getElementById('ad-alert');
  if (visible) { el.style.display = 'block'; return; }
  if (!Object.values(state.adActive).some(Boolean)) el.style.display = 'none';
}
function flashAdAlert() {
  document.getElementById('ad-alert').style.display = 'block';
  clearTimeout(adAlertTimeout);
  adAlertTimeout = setTimeout(() => {
    if (!Object.values(state.adActive).some(Boolean))
      document.getElementById('ad-alert').style.display = 'none';
  }, 5000);
}

// ─── Dev helper ───────────────────────────────────────────────
window.simulateAd = (i, isAd) => handleAdDetected(i, isAd);

// ─── Init ─────────────────────────────────────────────────────
document.getElementById('lbl-grid').classList.add('active');
resolvePipedInstance();
layout();
