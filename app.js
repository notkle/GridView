// ─── State ────────────────────────────────────────────────────
const state = {
  streams:    [null, null, null, null], // {service, value, label, isLive} | null
  zoomMode:   false,
  focusIndex: 0,
  adDetectors:{},
  adActive:   {},
  adGrace:    {},
  _autoSwappedFrom: null,
};

// ─── Notepad storage ──────────────────────────────────────────
// Each notepad slot saves to localStorage so content survives refresh.
const notepadData = [0,1,2,3].map(i => {
  return { content: localStorage.getItem(`gridview-note-${i}`) || '' };
});

// ─── Service Config ───────────────────────────────────────────
const SERVICES = {
  twitch: {
    label:      'twitch',
    isLive:     true,
    isNotepad:  false,
    needsInput: true,
    inputLabel: 'Channel name',
    placeholder:'e.g. yourfavoritestreamer',
    embedUrl: (v) =>
      `https://player.twitch.tv/?channel=${encodeURIComponent(v.trim())}&parent=${location.hostname}&autoplay=true`,
  },
  notepad: {
    label:      'notepad',
    isLive:     false,
    isNotepad:  true,
    needsInput: false,
    embedUrl:   () => '',
  },
};

// ─── Iframe pool (Twitch only) ────────────────────────────────
const pool = [0,1,2,3].map(i => {
  const f = document.createElement('iframe');
  f.id    = `pool-iframe-${i}`;
  f.allow = 'autoplay; fullscreen';
  f.allowFullscreen = true;
  f.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#000;';
  return f;
});

// ─── Notepad panels (persistent, one per slot) ────────────────
const notepads = [0,1,2,3].map(i => buildNotepad(i));

function buildNotepad(i) {
  const wrap = document.createElement('div');
  wrap.className = 'notepad-wrap';
  wrap.id = `notepad-${i}`;

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'notepad-toolbar';
  toolbar.innerHTML = `
    <div class="notepad-tools-left">
      <button class="nt-btn" data-cmd="bold"      title="Bold (Ctrl+B)"><b>B</b></button>
      <button class="nt-btn" data-cmd="italic"    title="Italic (Ctrl+I)"><i>I</i></button>
      <button class="nt-btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
      <div class="nt-divider"></div>
      <button class="nt-btn" data-cmd="insertUnorderedList" title="Bullet list">&#8226;&#8212;</button>
      <button class="nt-btn" data-cmd="insertOrderedList"   title="Numbered list">1&#8212;</button>
      <div class="nt-divider"></div>
      <button class="nt-btn" data-cmd="h1"  title="Heading">H</button>
      <button class="nt-btn" data-cmd="hl"  title="Highlight">&#9650;</button>
      <div class="nt-divider"></div>
      <button class="nt-btn" data-cmd="undo" title="Undo (Ctrl+Z)">&#8630;</button>
      <button class="nt-btn" data-cmd="redo" title="Redo (Ctrl+Y)">&#8631;</button>
    </div>
    <div class="notepad-tools-right">
      <button class="nt-btn nt-clear" data-cmd="clear" title="Clear all">&#10005; clear</button>
      <button class="nt-btn nt-copy"  data-cmd="copy"  title="Copy all text">&#10697; copy</button>
    </div>
  `;

  // Lined writing area
  const editor = document.createElement('div');
  editor.className       = 'notepad-editor';
  editor.id              = `notepad-editor-${i}`;
  editor.contentEditable = 'true';
  editor.spellcheck      = true;
  editor.setAttribute('data-placeholder', 'start writing...');

  // Restore saved content
  if (notepadData[i].content) editor.innerHTML = notepadData[i].content;

  // Auto-save on input
  editor.addEventListener('input', () => {
    notepadData[i].content = editor.innerHTML;
    localStorage.setItem(`gridview-note-${i}`, editor.innerHTML);
  });

  // Toolbar actions
  toolbar.addEventListener('click', e => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    editor.focus();
    switch (cmd) {
      case 'bold':               document.execCommand('bold');               break;
      case 'italic':             document.execCommand('italic');             break;
      case 'underline':          document.execCommand('underline');          break;
      case 'insertUnorderedList':document.execCommand('insertUnorderedList');break;
      case 'insertOrderedList':  document.execCommand('insertOrderedList');  break;
      case 'undo':               document.execCommand('undo');               break;
      case 'redo':               document.execCommand('redo');               break;
      case 'h1':
        document.execCommand('formatBlock', false, 'h3');
        break;
      case 'hl':
        document.execCommand('hiliteColor', false, '#3a3200');
        break;
      case 'clear':
        if (confirm('Clear this notepad?')) {
          editor.innerHTML = '';
          notepadData[i].content = '';
          localStorage.removeItem(`gridview-note-${i}`);
        }
        break;
      case 'copy':
        navigator.clipboard.writeText(editor.innerText).then(() => {
          btn.textContent = '✓ copied';
          setTimeout(() => { btn.innerHTML = '&#10697; copy'; }, 1500);
        });
        break;
    }
  });

  wrap.appendChild(toolbar);
  wrap.appendChild(editor);
  return wrap;
}

// ─── Which element represents a slot ──────────────────────────
function slotEl(i) {
  const stream = state.streams[i];
  if (!stream) return null;
  return stream.service === 'notepad' ? notepads[i] : pool[i];
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
    addStream(pickerTargetIndex, service, '', service);
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
  const cfg = SERVICES[service];
  state.streams[index] = { service, value, label, isLive: cfg.isLive };
  if (service === 'twitch') pool[index].src = cfg.embedUrl(value);
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
  if (pool[index].src !== 'about:blank') pool[index].src = 'about:blank';
  layout();
}

// ─── Layout ───────────────────────────────────────────────────
function layout() {
  state.zoomMode ? layoutZoom() : layoutGrid();
  updateOverlays();
}

function place(i, target) {
  const el = slotEl(i);
  if (el && el.parentNode !== target) target.appendChild(el);
}

function unplace(i, from) {
  const el = slotEl(i);
  if (el && el.parentNode === from) from.removeChild(el);
}

function showEmpty(cell, index) {
  if (!cell.querySelector('.cell-empty')) {
    cell.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'cell-empty';
    empty.onclick   = () => openPicker(index);
    empty.innerHTML = `<div class="plus-btn">+</div><span class="plus-label">add panel</span>`;
    cell.appendChild(empty);
  }
}

function layoutGrid() {
  for (let i = 0; i < 4; i++) {
    const cell   = document.getElementById(`cell-${i}`);
    const stream = state.streams[i];
    if (!stream) {
      unplace(i, cell);
      showEmpty(cell, i);
    } else {
      cell.querySelector('.cell-empty')?.remove();
      place(i, cell);
    }
  }
}

function layoutZoom() {
  const mainEl  = document.getElementById('zoomMain');
  const dockEls = [0,1,2].map(d => document.getElementById(`dock-${d}`));
  const others  = [0,1,2,3].filter(i => i !== state.focusIndex);

  if (state.streams[state.focusIndex]) {
    mainEl.querySelector('.zoom-empty')?.remove();
    place(state.focusIndex, mainEl);
  } else {
    unplace(state.focusIndex, mainEl);
    if (!mainEl.querySelector('.zoom-empty'))
      mainEl.innerHTML = `<div class="zoom-empty"><span>select a panel to focus</span></div>`;
  }

  dockEls.forEach((slot, di) => {
    const si     = others[di];
    const stream = state.streams[si];
    if (!stream) {
      unplace(si, slot);
      if (!slot.querySelector('.dock-slot-empty')) {
        slot.innerHTML = '';
        const e = document.createElement('div');
        e.className = 'dock-slot-empty';
        e.innerHTML = `<span>empty</span>`;
        slot.appendChild(e);
      }
      slot.onclick = null;
      slot.classList.remove('has-stream');
    } else {
      slot.querySelector('.dock-slot-empty')?.remove();
      slot.classList.add('has-stream');
      slot.onclick = () => setZoomFocus(si);
      place(si, slot);
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
    if (!stream || stream.service === 'notepad') continue; // notepad has its own UI

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

    const lbl = document.createElement('div');
    lbl.className   = 'cell-label';
    lbl.textContent = `${stream.service} · ${stream.label}`;
    cell.appendChild(lbl);
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

// ─── Zoom ─────────────────────────────────────────────────────
function toggleZoom() {
  state.zoomMode = !state.zoomMode;
  document.getElementById('zoomToggle').setAttribute('aria-pressed', state.zoomMode);
  document.getElementById('gridView').style.display = state.zoomMode ? 'none' : 'grid';
  document.getElementById('zoomView').style.display = state.zoomMode ? 'flex'  : 'none';
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
      const ch = (e.data.channel || '').toLowerCase().trim();
      const s  = state.streams[slotIndex];
      if (s && s.value.toLowerCase().trim() === ch) handleAdDetected(slotIndex, !!e.data.active);
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
layout();
