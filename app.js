// ─── State ────────────────────────────────────────────────────
const state = {
  streams:    [null, null, null, null], // {service, value, label, isLive, embedUrl}
  zoomMode:   false,
  focusIndex: 0,
  adDetectors:{},
  adActive:   {},
  adGrace:    {},
  _autoSwappedFrom: null,
};

// ─── Persistent iframe pool ───────────────────────────────────
// Four iframes are created ONCE and never destroyed.
// We move them between grid cells / zoom main / dock slots by
// appending them to the correct container. The browser keeps the
// live session intact — no reload, no double audio, no blip.
const pool = [0, 1, 2, 3].map(i => {
  const f = document.createElement('iframe');
  f.id    = `pool-iframe-${i}`;
  f.allow = 'autoplay; fullscreen';
  f.allowFullscreen = true;
  f.style.cssText   = 'width:100%;height:100%;border:none;display:block;background:#000;';
  return f;
});

// ─── Service Config ───────────────────────────────────────────
const SERVICES = {
  twitch: {
    label:      'twitch',
    isLive:     true,
    inputLabel: 'Channel name',
    placeholder:'e.g. yourfavoritestreamer',
    embedUrl: (v) =>
      `https://player.twitch.tv/?channel=${encodeURIComponent(v.trim())}&parent=${location.hostname || 'localhost'}&autoplay=true`,
  },
  youtube: {
    label:      'youtube',
    isLive:     false,
    inputLabel: 'Video URL or ID',
    placeholder:'e.g. https://youtube.com/watch?v=...',
    embedUrl: (v) => {
      const id = extractYouTubeId(v.trim());
      return id
        ? `https://www.youtube.com/embed/${id}?autoplay=1`
        : `https://www.youtube.com/embed/?autoplay=1`;
    },
  },
  kick: {
    label:      'kick',
    isLive:     true,
    inputLabel: 'Channel name',
    placeholder:'e.g. channelname',
    embedUrl: (v) =>
      `https://player.kick.com/${encodeURIComponent(v.trim())}?autoplay=true`,
  },
  url: {
    label:      'url',
    isLive:     false,
    inputLabel: 'URL',
    placeholder:'https://...',
    embedUrl: (v) => v.trim(),
  },
};

function extractYouTubeId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
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
  document.getElementById('inputLabel').textContent       = cfg.inputLabel;
  document.getElementById('modalInput').placeholder       = cfg.placeholder;
  document.getElementById('modalInput').value             = '';
  document.getElementById('modalInputWrap').style.display = 'flex';
  setTimeout(() => document.getElementById('modalInput').focus(), 50);
}

function confirmStream() {
  const val = document.getElementById('modalInput').value.trim();
  if (!val || pickerTargetIndex === null || !pickerService) return;
  const cfg = SERVICES[pickerService];

  state.streams[pickerTargetIndex] = {
    service:  pickerService,
    value:    val,
    label:    val,
    isLive:   cfg.isLive,
    embedUrl: cfg.embedUrl(val),
  };

  // Set src once — the only time we touch it
  pool[pickerTargetIndex].src = state.streams[pickerTargetIndex].embedUrl;

  closePicker();
  layout();
  startAdDetection(pickerTargetIndex);
}

document.getElementById('modalInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmStream();
});

function removeStream(index) {
  stopAdDetection(index);
  state.streams[index]  = null;
  state.adActive[index] = false;
  pool[index].src       = 'about:blank';
  layout();
}

// ─── Layout engine ────────────────────────────────────────────
// Moves pool iframes into the right containers without recreating them.

function layout() {
  if (state.zoomMode) {
    layoutZoom();
  } else {
    layoutGrid();
  }
  updateOverlays();
}

function layoutGrid() {
  for (let i = 0; i < 4; i++) {
    const cell   = document.getElementById(`cell-${i}`);
    const stream = state.streams[i];

    if (!stream) {
      // Remove iframe from cell if present
      if (pool[i].parentNode === cell) cell.removeChild(pool[i]);
      // Ensure empty placeholder exists
      if (!cell.querySelector('.cell-empty')) {
        cell.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'cell-empty';
        empty.onclick   = () => openPicker(i);
        empty.innerHTML = `<div class="plus-btn">+</div><span class="plus-label">add stream</span>`;
        cell.appendChild(empty);
      }
    } else {
      // Remove empty placeholder if present
      cell.querySelector('.cell-empty')?.remove();
      // Move iframe into cell if not already there
      if (pool[i].parentNode !== cell) cell.appendChild(pool[i]);
    }
  }
}

function layoutZoom() {
  const mainEl  = document.getElementById('zoomMain');
  const dockEls = [
    document.getElementById('dock-0'),
    document.getElementById('dock-1'),
    document.getElementById('dock-2'),
  ];
  const others  = [0, 1, 2, 3].filter(i => i !== state.focusIndex);

  // Focus → main
  const focusStream = state.streams[state.focusIndex];
  if (focusStream) {
    mainEl.querySelector('.zoom-empty')?.remove();
    if (pool[state.focusIndex].parentNode !== mainEl) mainEl.appendChild(pool[state.focusIndex]);
  } else {
    if (pool[state.focusIndex].parentNode === mainEl) mainEl.removeChild(pool[state.focusIndex]);
    if (!mainEl.querySelector('.zoom-empty')) {
      mainEl.innerHTML = `<div class="zoom-empty"><span>select a stream to focus</span></div>`;
    }
  }

  // Others → dock slots
  dockEls.forEach((slot, di) => {
    const si     = others[di];
    const stream = state.streams[si];

    if (!stream) {
      if (pool[si].parentNode === slot) slot.removeChild(pool[si]);
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
      if (pool[si].parentNode !== slot) slot.appendChild(pool[si]);
    }
  });
}

// ─── Overlays ─────────────────────────────────────────────────
// Badges / labels sit on top of iframes. Rebuilt on layout changes
// but iframes underneath are never touched.

function updateOverlays() {
  if (state.zoomMode) {
    updateZoomOverlays();
  } else {
    updateGridOverlays();
  }
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
      </div>
    `;
    cell.appendChild(overlay);

    const lbl = document.createElement('div');
    lbl.className   = 'cell-label';
    lbl.textContent = `${stream.service} · ${stream.label}`;
    cell.appendChild(lbl);
  }
}

function updateZoomOverlays() {
  const mainEl  = document.getElementById('zoomMain');
  const dockEls = [
    document.getElementById('dock-0'),
    document.getElementById('dock-1'),
    document.getElementById('dock-2'),
  ];
  const others  = [0, 1, 2, 3].filter(i => i !== state.focusIndex);

  // Main overlay
  mainEl.querySelector('.zoom-main-overlay')?.remove();
  const focusStream = state.streams[state.focusIndex];
  if (focusStream) {
    const ov = document.createElement('div');
    ov.className = 'zoom-main-overlay';
    ov.innerHTML = `
      <div class="zoom-main-label">${focusStream.service} · ${focusStream.label}</div>
      <button class="cell-act-btn zoom-remove-btn" title="Remove"
        onclick="removeStream(${state.focusIndex})">✕</button>
    `;
    mainEl.appendChild(ov);
  }

  // Dock overlays
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
      <div class="dock-slot-label">${stream.service} · ${stream.label}</div>
    `;
    slot.appendChild(ov);
  });
}

// ─── Zoom toggle ──────────────────────────────────────────────
function toggleZoom() {
  state.zoomMode = !state.zoomMode;

  const toggle   = document.getElementById('zoomToggle');
  const gridView = document.getElementById('gridView');
  const zoomView = document.getElementById('zoomView');
  const lblGrid  = document.getElementById('lbl-grid');
  const lblZoom  = document.getElementById('lbl-zoom');

  toggle.setAttribute('aria-pressed', state.zoomMode);

  if (state.zoomMode) {
    gridView.style.display = 'none';
    zoomView.style.display = 'flex';
    lblZoom.classList.add('active');
    lblGrid.classList.remove('active');
    const first = state.streams.findIndex(s => s !== null);
    state.focusIndex = first >= 0 ? first : 0;
  } else {
    gridView.style.display = 'grid';
    zoomView.style.display = 'none';
    lblGrid.classList.add('active');
    lblZoom.classList.remove('active');
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

    // Extension message — primary, high confidence
    if (e.data.source === 'viewgrid-extension' && e.data.type === 'vg-ad') {
      const channel = (e.data.channel || '').toLowerCase().trim();
      const s       = state.streams[slotIndex];
      if (s && s.value.toLowerCase().trim() === channel) {
        handleAdDetected(slotIndex, !!e.data.active);
      }
      return;
    }

    // Fallback: generic Twitch postMessage
    const type = (e.data.type || e.data.event || '');
    if (type.toLowerCase().includes('ad')) {
      handleAdDetected(slotIndex, true);
    }
  };
  window.addEventListener('message', msgHandler);

  // DOM polling — works on localhost / same-origin
  const intervalId = setInterval(() => {
    const iframe = pool[slotIndex];
    let found = false;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        found = !!(
          doc.querySelector('[class*="ad-banner"]')            ||
          doc.querySelector('[class*="ad-countdown"]')         ||
          doc.querySelector('[data-a-target="ad-countdown"]')  ||
          doc.querySelector('[aria-label="Advertisement"]')    ||
          [...doc.querySelectorAll('*')].find(el =>
            el.children.length === 0 &&
            el.textContent.trim() === 'Ad' &&
            el.offsetParent !== null
          )
        );
      }
    } catch (_) { /* cross-origin in production — expected */ }

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

  // Update badges in place — no layout needed
  document.getElementById(`adpill-${slotIndex}`)?.classList.toggle('visible', isAd);
  document.getElementById(`dockad-${slotIndex}`)?.classList.toggle('visible', isAd);

  showAdAlert(isAd);

  if (isAd && state.zoomMode && slotIndex === state.focusIndex) {
    autoSwapAway(slotIndex);
  }

  if (!isAd && state.zoomMode && state._autoSwappedFrom === slotIndex) {
    setTimeout(() => {
      if (!state.adActive[slotIndex] && state.streams[slotIndex]) {
        state.focusIndex       = slotIndex;
        state._autoSwappedFrom = null;
        layout();
        showAdAlert(false);
      }
    }, 1200);
  }
}

function autoSwapAway(adSlotIndex) {
  const candidates = [0, 1, 2, 3].filter(i =>
    i !== adSlotIndex &&
    state.streams[i] !== null &&
    !state.adActive[i]
  );
  if (!candidates.length) return;

  state._autoSwappedFrom = adSlotIndex;
  state.focusIndex       = candidates[0];
  layout();
  flashAdAlert();
}

let adAlertTimeout = null;
function showAdAlert(visible) {
  const el = document.getElementById('ad-alert');
  if (visible) {
    el.style.display = 'block';
  } else {
    if (!Object.values(state.adActive).some(Boolean)) el.style.display = 'none';
  }
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
window.simulateAd = (slotIndex, isAd) => {
  console.log(`[viewgrid] simulateAd(${slotIndex}, ${isAd})`);
  handleAdDetected(slotIndex, isAd);
};

// ─── Init ─────────────────────────────────────────────────────
document.getElementById('lbl-grid').classList.add('active');
layout();
