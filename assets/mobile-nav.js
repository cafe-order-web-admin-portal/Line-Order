/* Mobile-only navigation behavior for LIVE ORDERS.
   Visibility follows the authenticated app section; this does not change auth/session logic. */
(() => {
  'use strict';
  const nav = document.getElementById('mobile-bottom-nav');
  const app = document.getElementById('app');
  if (!nav || !app) return;
  const syncVisibility = () => {
    nav.hidden = app.classList.contains('hidden');
  };
  new MutationObserver(syncVisibility).observe(app, {
    attributes: true,
    attributeFilter: ['class']
  });
  syncVisibility();
  const refresh = document.getElementById('mobile-refresh');
  if (refresh) refresh.addEventListener('click', () => {
    const button = document.getElementById('refresh-btn');
    if (button && !button.disabled) button.click();
  });
})();
