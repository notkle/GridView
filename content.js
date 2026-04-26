// viewgrid — content.js
// Injected into every player.twitch.tv frame by the extension.
// Has full DOM access to the Twitch player regardless of cross-origin rules.
// Detects ads and posts messages to the parent (viewgrid) page.

(function () {
  'use strict';

  const POLL_MS = 1000;       // how often to check for ads
  const GRACE_TICKS = 3;      // consecutive clean polls before declaring ad over

  let adActive = false;
  let cleanTicks = 0;

  // ── Ad node selectors ────────────────────────────────────────
  // Twitch changes these periodically. Add new selectors here as
  // Twitch updates their player — no other file needs changing.
  const AD_SELECTORS = [
    '[class*="ad-banner"]',           // ad banner wrapper
    '[class*="ad-countdown"]',        // countdown timer shown during ads
    '[data-a-target="ad-countdown"]', // data attribute Twitch uses
    '[aria-label="Advertisement"]',   // accessibility label
    '.player-ad-overlay',             // overlay during mid-rolls
    '[class*="VideoAdOverlay"]',      // React component class fragment
    '[class*="video-ad"]',            // generic video ad class
  ];

  // Also check for the visible "Ad" text badge Twitch renders
  function hasAdTextBadge() {
    const allElements = document.querySelectorAll(
      '[class*="CoreText"], [class*="tw-c-text"], p, span, div'
    );
    for (const el of allElements) {
      if (
        el.children.length === 0 &&
        el.textContent.trim() === 'Ad' &&
        el.offsetParent !== null // must be visible
      ) {
        return true;
      }
    }
    return false;
  }

  function isAdShowing() {
    // Check structural selectors first (faster)
    for (const sel of AD_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return true;
      } catch (_) {}
    }
    // Fall back to text badge scan
    return hasAdTextBadge();
  }

  // ── Messaging ────────────────────────────────────────────────
  // Post to the top-level page (viewgrid). '*' target origin is fine
  // here because viewgrid's listener validates the message type.
  function notify(isAd) {
    try {
      window.top.postMessage({
        source: 'viewgrid-extension',
        type: 'vg-ad',
        active: isAd,
        // Include the channel name so viewgrid knows which slot to act on
        channel: extractChannel(),
      }, '*');
    } catch (_) {
      // top may be cross-origin in some edge cases — nothing to do
    }
  }

  function extractChannel() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('channel') || '';
    } catch (_) {
      return '';
    }
  }

  // ── Poll loop ────────────────────────────────────────────────
  function tick() {
    const adNow = isAdShowing();

    if (adNow) {
      cleanTicks = 0;
      if (!adActive) {
        adActive = true;
        notify(true);
        console.debug('[viewgrid] Ad detected on', extractChannel());
      }
    } else {
      if (adActive) {
        cleanTicks++;
        if (cleanTicks >= GRACE_TICKS) {
          adActive = false;
          cleanTicks = 0;
          notify(false);
          console.debug('[viewgrid] Ad cleared on', extractChannel());
        }
      }
    }
  }

  // Start polling once the player has had a moment to render
  setTimeout(() => {
    setInterval(tick, POLL_MS);
  }, 2000);

  console.debug('[viewgrid] Ad detector active on', extractChannel());
})();
