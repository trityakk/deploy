(function () {
  'use strict';
  var query = new URLSearchParams(location.search);
  var hash = new URLSearchParams(location.hash.slice(1));
  var callback = query.has('code') || hash.has('access_token') || hash.has('error') ||
    query.get('type') === 'recovery' || hash.get('type') === 'recovery';
  window.courseAuthCallback = {
    active: callback || query.get('mode') === 'activate',
    error: hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error')
  };
  if (callback && !location.pathname.endsWith('/enter.html')) {
    var target = new URL('enter.html', location.href);
    target.search = location.search;
    target.searchParams.set('mode', 'activate');
    target.hash = location.hash;
    location.replace(target.href);
  }
})();
