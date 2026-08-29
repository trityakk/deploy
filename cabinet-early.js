// Prevent a flash of the mobile sidebar before cabinet.js initializes.
(function () {
  try {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    var isMobile = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
    if (!isMobile) return;
    var hasHash = window.location.hash.length > 1;
    var shouldOpen = false;
    if (!hasHash) {
      try { shouldOpen = localStorage.getItem('sa_sidebar_open_mobile') === 'true'; } catch (e) {}
    }
    if (!shouldOpen) sidebar.classList.remove('open');
  } catch (e) {}
})();
