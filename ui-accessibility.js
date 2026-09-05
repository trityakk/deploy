(function () {
  'use strict';
  var current = null, restoreFocus = null, previousOverflow = '', inertBefore = [];
  var focusables = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
  function visible(el) {
    var style = getComputedStyle(el);
    return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && el.getClientRects().length > 0;
  }
  function release() {
    inertBefore.forEach(function (item) { item[0].inert = item[1]; });
    inertBefore = [];
    document.body.style.overflow = previousOverflow;
    if (restoreFocus && restoreFocus.isConnected) restoreFocus.focus();
    current = null;
  }
  function sync() {
    var open = Array.from(document.querySelectorAll('#modal-overlay.open,#passwordChangeModal,#statsOverlay.active,#flashOverlay.active'))
      .filter(visible).pop();
    if (open === current) return;
    if (current) release();
    if (!open) return;
    current = open; restoreFocus = document.activeElement;
    previousOverflow = document.body.style.overflow === 'hidden' ? '' : document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    open.setAttribute('role','dialog'); open.setAttribute('aria-modal','true');
    if (!open.getAttribute('aria-label') && !open.getAttribute('aria-labelledby')) {
      open.setAttribute('aria-label', open.querySelector('h2,h3,.modal-title')?.textContent || 'Вікно');
    }
    var branch = open;
    while (branch.parentElement) {
      Array.from(branch.parentElement.children).forEach(function (sibling) {
        if (sibling !== branch && !['SCRIPT','STYLE','LINK'].includes(sibling.tagName)) {
          inertBefore.push([sibling,sibling.inert]); sibling.inert = true;
        }
      });
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    var first = Array.from(open.querySelectorAll(focusables)).find(visible);
    if (first) first.focus(); else { open.tabIndex = -1; open.focus(); }
  }
  var observed = new WeakSet();
  function observe() {
    document.querySelectorAll('#modal-overlay,#passwordChangeModal,#statsOverlay,#flashOverlay').forEach(function (el) {
      if (observed.has(el)) return;
      observed.add(el);
      new MutationObserver(sync).observe(el,{attributes:true,attributeFilter:['class','style','hidden']});
    });
  }
  observe();
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-password-target]');
    if (!button) return;
    var field = document.getElementById(button.dataset.passwordTarget);
    if (!field) return;
    var show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    button.textContent = show ? 'Сховати' : 'Показати';
    button.setAttribute('aria-pressed', String(show));
  });
  new MutationObserver(function () { observe(); }).observe(document.getElementById('cabinetContent') || document.body,{childList:true});
  document.addEventListener('keydown',function (e) {
    if (!current || e.key !== 'Tab') return;
    var items = Array.from(current.querySelectorAll(focusables)).filter(function (el) {return visible(el) && !el.disabled;});
    if (!items.length) {e.preventDefault();return;}
    var first=items[0],last=items[items.length-1];
    if (e.shiftKey && (document.activeElement === first || !current.contains(document.activeElement))) {e.preventDefault();last.focus();}
    else if (!e.shiftKey && (document.activeElement === last || !current.contains(document.activeElement))) {e.preventDefault();first.focus();}
  });
})();
