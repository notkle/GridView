// gridview — content.js
// Injected into every player.twitch.tv frame by the extension.
// Detects ads, parses the break duration from the notification banner,
// and messages gridview with both the ad state and seconds remaining.

(function () {
  'use strict';

  const POLL_MS    = 800;   // poll frequency during normal watching
  const GRACE_TICKS = 3;   // clean polls needed before declaring ad over

  let adActive   = false;
  let cleanTicks = 0;
  let lastDuration = null;  // last parsed duration in seconds

  // ── Selectors ─────────────────────────────────────────────────
  const AD_SELECTORS = [
    '[class*="ad-banner"]',
    '[class*="ad-countdown"]',
    '[data-a-target="ad-countdown"]',
    '[aria-label="Advertisement"]',
    '.player-ad-overlay',
    '[class*="VideoAdOverlay"]',
    '[class*="video-ad"]',
    // "Ad ⓘ" badge visible top-right of the commercial break screen
    '[data-a-target="player-ad-indicator"]',
    '[class*="AdIndicator"]',
    '[class*="ad-indicator"]',
  ];

  // ── Duration parser ───────────────────────────────────────────
  // Confirmed banner format from live testing:
  // "Rexlent90 is taking an ad break; stick around to support the stream! Ad (1:37)"
  // Also matches the standalone "Ad (0:30)" countdown badge.
  // Returns seconds as integer, or null if not found.
  function parseDuration() {
    // Primary: scan all text-bearing elements for (M:SS) pattern
    const candidates = document.querySelectorAll(
      'p, span, div, [class*="CoreText"], [class*="ScCoreText"], [class*="tw-c-text"]'
    );
    for (const el of candidates) {
      if (el.children.length > 3) continue;
      const text = el.textContent || '';
      // Matches (1:37), (0:30), (2:50) etc.
      const m = text.match(/\((\d+):(\d{2})\)/);
      if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }

    // Fallback: scan full body text for the pattern
    // (catches cases where the banner is in a non-standard element)
    const bodyText = document.body?.innerText || '';
    const m = bodyText.match(/Ad \((\d+):(\d{2})\)/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);

    // "Commercial break in progress" screen detected but no duration visible
    if (bodyText.includes('Commercial break in progress')) return null;

    return null;
  }

  // ── Ad presence check ─────────────────────────────────────────
  function isAdShowing() {
    for (const sel of AD_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return true;
      } catch (_) {}
    }

    const bodyText = document.body?.innerText || '';

    // Confirmed "Commercial break in progress" full-screen
    if (bodyText.includes('Commercial break in progress')) return true;

    // Confirmed banner: "X is taking an ad break"
    if (bodyText.includes('taking an ad break')) return true;

    // Lone visible "Ad" text badge (top-right "Ad ⓘ")
    const els = document.querySelectorAll('p, span, div');
    for (const el of els) {
      if (
        el.children.length === 0 &&
        el.textContent.trim() === 'Ad' &&
        el.offsetParent !== null
      ) return true;
    }

    return false;
  }

  // ── Messaging ─────────────────────────────────────────────────
  function notify(isAd, duration) {
    try {
      window.top.postMessage({
        source:   'gridview-extension',
        type:     'vg-ad',
        active:   isAd,
        channel:  extractChannel(),
        duration: duration ?? null, // seconds, or null if unknown
      }, '*');
    } catch (_) {}
  }

  function extractChannel() {
    try {
      return new URLSearchParams(window.location.search).get('channel') || '';
    } catch (_) { return ''; }
  }

  // ── Poll loop ─────────────────────────────────────────────────
  function tick() {
    const adNow = isAdShowing();

    if (adNow) {
      cleanTicks = 0;

      // Always try to parse/refresh duration while ad is running
      const dur = parseDuration();

      if (!adActive) {
        // Ad just started
        adActive     = true;
        lastDuration = dur;
        notify(true, dur);
        console.debug('[gridview] Ad started on', extractChannel(), '— duration:', dur, 's');
      } else if (dur !== null && dur !== lastDuration) {
        // Duration updated (e.g. streamer extended break)
        lastDuration = dur;
        notify(true, dur); // re-send with updated duration
        console.debug('[gridview] Ad duration updated:', dur, 's');
      }

    } else {
      if (adActive) {
        cleanTicks++;
        if (cleanTicks >= GRACE_TICKS) {
          adActive     = false;
          cleanTicks   = 0;
          lastDuration = null;
          notify(false, null);
          console.debug('[gridview] Ad cleared on', extractChannel());
        }
      }
    }
  }

  // Start after player has rendered
  setTimeout(() => {
    setInterval(tick, POLL_MS);
  }, 2000);

  console.debug('[gridview] Ad detector active on', extractChannel());
})();
