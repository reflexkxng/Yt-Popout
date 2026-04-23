(() => {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  const PIP_ID = 'yt-autofloat-pip';
  const CLOSE_ID = 'yt-autofloat-close';
  const RESIZE_ID = 'yt-autofloat-resize';
  const DEFAULT_WIDTH = 360;       // px
  const SCROLL_THRESH = 40;        // px below video bottom before floating

  // ─── State ────────────────────────────────────────────────────────────────
  let pip = null;
  let closeBtn = null;
  let resizeHandle = null;
  let pipVisible = false;
  let manualClose = false;  // user explicitly closed → don't re-open until scroll top
  let rafId = null;

  // Drag state
  let dragging = false;
  let dragStartX, dragStartY, pipStartRight, pipStartBottom;

  // Resize state
  let resizing = false;
  let resizeStartX, resizeStartWidth;

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Wait for a selector to appear in DOM, then resolve */
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) { resolve(el); return; }

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { observer.disconnect(); resolve(found); }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => { observer.disconnect(); reject(new Error('Timeout')); }, timeout);
    });
  }

  /** Get the primary video element on a YouTube watch page */
  function getYTVideo() {
    return document.querySelector('video.html5-main-video') ||
      document.querySelector('#movie_player video') ||
      document.querySelector('video') ||
      document.querySelector('player-container') ||
      document.querySelector('ytd-player') ||
      document.querySelector('ytp-iv-video-content');
  }

  /** Get the player container element (used for threshold) */
  function getPlayerContainer() {
    return document.querySelector('#movie_player') ||
      document.querySelector('#ytd-player') ||
      document.querySelector('.html5-video-player');
  }

  // ─── Build PiP overlay ────────────────────────────────────────────────────

  function buildPip() {
    if (document.getElementById(PIP_ID)) return;

    pip = document.createElement('div');
    pip.id = PIP_ID;

    // Close button
    closeBtn = document.createElement('div');
    closeBtn.id = CLOSE_ID;
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Close floating player';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hidePip(true);
    });

    // Resize handle (bottom-left)
    resizeHandle = document.createElement('div');
    resizeHandle.id = RESIZE_ID;

    pip.appendChild(closeBtn);
    pip.appendChild(resizeHandle);
    document.body.appendChild(pip);

    setupDrag();
    setupResize();
  }

  // ─── Show / Hide ──────────────────────────────────────────────────────────

  function showPip() {
    if (pipVisible || manualClose) return;

    const video = getYTVideo();
    if (!video || video.paused) return;   // nothing to show if paused/missing

    buildPip();

    // Move the real <video> element into PiP (no clone = perfectly synced)
    if (!pip.contains(video)) {
      pip.insertBefore(video, closeBtn);
    }

    // Trigger CSS transition
    requestAnimationFrame(() => {
      pip.classList.add('visible');
    });

    pipVisible = true;
  }

  function hidePip(manual = false) {
    if (!pipVisible) return;
    if (manual) manualClose = true;

    pip.classList.remove('visible');
    pipVisible = false;

    // After transition, put the video back in the player
    pip.addEventListener('transitionend', restoreVideo, { once: true });
  }

  function restoreVideo() {
    const video = getYTVideo();
    const player = getPlayerContainer();

    if (video && player && pip && pip.contains(video)) {
      // Re-insert at the beginning of the player
      player.insertBefore(video, player.firstChild);
    }
  }

  // ─── Scroll detection ─────────────────────────────────────────────────────

  function onScroll() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      checkScroll();
    });
  }

  function checkScroll() {
    const player = getPlayerContainer();
    if (!player) return;

    const rect = player.getBoundingClientRect();
    const pastPlayer = rect.bottom < -SCROLL_THRESH;   // video scrolled above viewport

    if (pastPlayer && !pipVisible && !manualClose) {
      showPip();
    } else if (!pastPlayer && pipVisible) {
      hidePip(false);
    }

    // Reset manual-close flag once user scrolls back to top of player
    if (rect.top >= 0 && manualClose) {
      manualClose = false;
    }
  }

  // ─── Drag to reposition ───────────────────────────────────────────────────

  function setupDrag() {
    pip.addEventListener('mousedown', (e) => {
      // Only drag from the top grabber bar area (top 28px), skip close/resize
      if (e.target === closeBtn || e.target === resizeHandle) return;
      if (e.offsetY > 28) return;

      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      const cs = getComputedStyle(pip);
      pipStartRight = parseInt(cs.right, 10) || 24;
      pipStartBottom = parseInt(cs.bottom, 10) || 24;

      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
      e.preventDefault();
    });
  }

  function onDragMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    pip.style.right = `${pipStartRight - dx}px`;
    pip.style.bottom = `${pipStartBottom + dy}px`;
  }

  function onDragEnd() {
    dragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  // ─── Resize ───────────────────────────────────────────────────────────────

  function setupResize() {
    resizeHandle.addEventListener('mousedown', (e) => {
      resizing = true;
      resizeStartX = e.clientX;
      resizeStartWidth = pip.getBoundingClientRect().width;

      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', onResizeEnd);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  function onResizeMove(e) {
    if (!resizing) return;
    const dx = resizeStartX - e.clientX;   // dragging left = bigger
    const newWidth = Math.max(240, Math.min(720, resizeStartWidth + dx));
    pip.style.width = `${newWidth}px`;
  }

  function onResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }

  // ─── Navigation / SPA handling ────────────────────────────────────────────
  // YouTube is a SPA; watch for URL changes to re-initialise

  let lastHref = location.href;

  function onUrlChange() {
    if (location.href === lastHref) return;
    lastHref = location.href;

    // Tear down
    if (pip) {
      restoreVideo();
      pip.remove();
      pip = null;
    }
    pipVisible = false;
    manualClose = false;

    // Re-init if still on a watch page
    if (location.pathname === '/watch') {
      init();
    }
  }

  // Observe pushState / popstate navigations
  const _pushState = history.pushState.bind(history);
  history.pushState = (...args) => { _pushState(...args); onUrlChange(); };
  window.addEventListener('popstate', onUrlChange);


  // ─── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    try {
      await waitForElement('#movie_player video, video.html5-main-video, video');
    } catch (_) {
      alert("No vid");
      return;
    }

    buildPip();
    // Give YouTube a moment to stabilize
    window.addEventListener('scroll', onScroll, { passive: true });
    checkScroll();  // run once on load in case already scrolled
  }

  // Only run on /watch pages
  if (location.pathname.startsWith('/watch')) {
    init();
  }
})();
