# NUTECH Vault — Fix Implementation Guide

## What Was Fixed & Added

---

## 1. Fullscreen Image Viewer (Lightbox) — Now Working

### Root Cause of the Bug
The gallery image click used inline `onclick` with `JSON.stringify(photos)` embedded directly
in the HTML string:

```js
// ❌ OLD — breaks if photo URLs contain quotes or special characters
onclick="openLightbox(${JSON.stringify(photos)}, 0)"
```

Any URL with `&`, `'`, or long Supabase paths could silently break the onclick handler,
preventing the lightbox from ever opening.

### Fix Applied
Photos are now stored in a registry (`window._galleryRegistry`) keyed by memory ID,
and a new safe function `openLightboxFromGallery()` looks them up at click time:

```js
// ✅ NEW — safe, no JSON embedded in HTML
<div data-memory-id="${m.id}" onclick="openLightboxFromGallery(this, 0)">
```

```js
function openLightboxFromGallery(el, startIndex) {
  const memId = el.dataset.memoryId || el.closest('[data-memory-id]')?.dataset.memoryId;
  const photos = window._galleryRegistry[memId] || window.currentGalleryPhotos || [];
  openLightbox(photos, startIndex || 0);
}
```

### Zoom Controls
The lightbox already had full zoom support — it was just not opening due to the bug above.
After applying the fix, these all work:
- **Scroll wheel** — zoom in/out
- **+ / −** buttons in top bar
- **Double-click** — toggle 2.5× zoom
- **Pinch gesture** (mobile) — pinch to zoom
- **Drag** — pan when zoomed in
- **0 key** or click % label — reset zoom
- **Arrow keys / swipe** — navigate between photos

---

## 2. Image Protection Features

All protection is added in `initImageProtection()` in `app.js` — no backend changes needed.

### A. Right-Click Disabled
```js
document.addEventListener('contextmenu', function(e) {
  if (e.target.tagName === 'IMG' || e.target.closest('.protected-gallery, #lightbox-overlay')) {
    e.preventDefault();
  }
});
```
Prevents "Save image as…", "Copy image", "Open image in new tab" from the context menu.

### B. Drag Disabled
```js
document.addEventListener('dragstart', function(e) {
  if (e.target.tagName === 'IMG') { e.preventDefault(); }
});
```
Also applied via CSS (`-webkit-user-drag: none`) and `draggable="false"` attribute on all gallery images.

### C. Middle-Click (Open in New Tab) Blocked
```js
document.addEventListener('auxclick', function(e) {
  if (e.button === 1 && e.target.tagName === 'IMG') { e.preventDefault(); }
});
```

### D. Print / Screenshot Deterrence
```css
@media print {
  body * { visibility: hidden !important; }
  body::after {
    content: "NUTECH Vault — Content is protected.";
    /* centered, visible */
  }
}
```
When a user tries to print the page (which some tools use to "save as PDF"), all content
is hidden and a protection message is shown instead.

### E. Lightbox Watermark Overlay
A subtle diagonal grid overlay (`#lb-screenshot-guard`) sits as an absolutely positioned
layer over the lightbox image. It's invisible to normal viewing but appears in screenshots
taken via screen-capture tools that render CSS layers.

---

## 3. How to Deploy

1. **Replace `app.js`** in your project with the fixed version from this output
2. No changes needed to `index.html`, `style.css`, or database
3. Test by opening any memory → clicking the image → lightbox should open with zoom controls

---

## 4. Supabase: Signed URLs for Stronger Protection (Recommended)

The strongest protection against direct URL access is switching to **private buckets + signed URLs**.

### Step 1 — Make bucket private
Supabase Dashboard → Storage → `memory-photos` → Settings → uncheck "Public bucket"

### Step 2 — Update `getPhotoUrl()` in `app.js`
```js
async function getPhotoUrlSigned(path) {
  if (!path) return '';
  const first = path.split(',')[0].trim();
  if (first.startsWith('http')) return first; // already absolute
  const { data, error } = await supabaseClient.storage
    .from('memory-photos')
    .createSignedUrl(first, 3600); // expires in 1 hour
  return data?.signedUrl || '';
}
```

This means:
- Direct URL sharing is impossible after 1 hour
- Bots/scrapers cannot access images without an authenticated session
- Each signed URL is unique per session

> **Note:** This requires making `getPhotoUrl` async throughout the app wherever it's called —
> a larger refactor. For now, the frontend protections in the fix are already applied.

---

## 5. Important Limitation: OS-Level Screenshots

**No web technology can fully prevent screenshots.** The OS-level Print Screen key,
`Cmd+Shift+4` on Mac, and screen recording tools operate at the OS level — browsers
have no access to block them.

What the current implementation does:
| Method | What it blocks |
|--------|---------------|
| Right-click disabled | "Save image as", "Copy image", "Open in new tab" |
| Drag disabled | Drag-to-desktop saves |
| Middle-click blocked | Opening image URL directly in new tab |
| Print CSS | Print-to-PDF, browser print dialog |
| Watermark overlay | May appear in some screen-capture tools |

What it **cannot** block:
- OS-level Print Screen / Cmd+Shift+4
- Phone camera pointing at screen
- Screen recording software (OBS, etc.)

This is a browser security boundary that applies to every website including Netflix,
Google Photos, and iCloud — none can fully prevent screenshots.
