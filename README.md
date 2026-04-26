# viewgrid — Firefox Extension

Companion extension for [viewgrid](../README.md). Gives the webapp real ad detection on Twitch by running inside the Twitch player iframe where it has full DOM access.

## How it works

The extension injects `content.js` into every `player.twitch.tv` frame. That script polls the Twitch player DOM every second for ad indicators (ad banner elements, countdown timers, "Ad" text badges). When it finds one, it fires a `postMessage` to the parent viewgrid page, which then auto-swaps the focused stream.

Without this extension, ad detection success rate is ~10–20%. With it: ~85–95%.

## Install in Firefox (unpacked — no store needed)

1. Open Firefox and go to `about:debugging`
2. Click **This Firefox** in the left sidebar
3. Click **Load Temporary Add-on...**
4. Navigate to this `extension/` folder and select `manifest.json`
5. Done — the extension is active

> **Note:** Firefox temporary add-ons are cleared when the browser restarts. Just repeat the steps above to reload it. This is fine for testing.

## File structure

```
extension/
├── manifest.json   — extension config, permissions, content script declaration
├── content.js      — injected into player.twitch.tv, detects ads, posts messages
├── icon48.png      — extension icon
├── icon96.png      — extension icon (retina)
└── README.md
```

## Message format

The content script posts this message to `window.top` (the viewgrid page):

```js
{
  source: 'viewgrid-extension',
  type:   'vg-ad',
  active: true,      // true = ad started, false = ad ended
  channel: 'xqc',   // channel name from the iframe URL
}
```

viewgrid's `app.js` listens for this and matches it to the correct slot by channel name.

## Ad selectors

Twitch occasionally updates their player DOM. If detection stops working, update the `AD_SELECTORS` array in `content.js` with the new class names. No other file needs changing.

Current selectors watched:
- `[class*="ad-banner"]`
- `[class*="ad-countdown"]`
- `[data-a-target="ad-countdown"]`
- `[aria-label="Advertisement"]`
- `.player-ad-overlay`
- `[class*="VideoAdOverlay"]`
- `[class*="video-ad"]`
- Text node scan for visible lone "Ad" text

## Testing without a live ad

In the viewgrid page, open DevTools console and run:

```js
simulateAd(0, true)   // fake ad on slot 0
simulateAd(0, false)  // clear it
```
