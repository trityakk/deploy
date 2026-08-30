// Load the course body before the application code starts.
(async function () {
  try {
    var target = document.getElementById('cabinetContent');
    for (const src of [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4',
      'supabase-config.js?v=3'
    ]) {
      await new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }

    // The course body is private. Only an authenticated user with an active
    // entitlement can download it from the private Supabase Storage bucket.
    var sessionResult = await window.startAmazonSupabase.auth.getSession();
    var session = sessionResult && sessionResult.data && sessionResult.data.session;
    if (session && session.user) {
      var access = await window.startAmazonSupabase.rpc('has_active_course_access');
      if (access.error) throw access.error;
      if (access.data === true) {
        var content = await window.startAmazonSupabase.storage
          .from('course-content')
          .download('cabinet-content.html');
        if (content.error) throw content.error;
        target.innerHTML = await content.data.text();
      }
    }

    // Load the application after the protected body (or empty guest view) is
    // ready, so cabinet.js never needs to fetch public course content.
    await new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'cabinet.js?v=58';
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  } catch (error) {
    document.body.classList.add('cabinet-load-error');
    console.error('Не вдалося завантажити кабінет.', error);
  }
})();
