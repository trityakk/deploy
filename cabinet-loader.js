// Recovery links occasionally arrive at cabinet.html when Supabase uses the
// project's default Site URL. Route them to the password-creation screen.
var cabinetRecoverySearch = new URLSearchParams(window.location.search);
var cabinetRecoveryHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
if (cabinetRecoverySearch.has('code') || cabinetRecoverySearch.get('type') === 'recovery' || cabinetRecoveryHash.get('type') === 'recovery') {
  var cabinetRecoveryUrl = new URL('enter.html', window.location.href);
  cabinetRecoveryUrl.searchParams.set('mode', 'activate');
  cabinetRecoveryUrl.hash = window.location.hash;
  window.location.replace(cabinetRecoveryUrl.href);
}

// Load the course body before the application code starts.
(async function () {
  var accessGranted = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  try {
    var target = document.getElementById('cabinetContent');
    for (const src of [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4',
      'supabase-config.js?v=3'
    ]) await loadScript(src);

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
        accessGranted = true;
      }
    }
  } catch (error) {
    // A guest or an account without an entitlement is an expected state, not
    // a broken page. Keep the console clean and show the login modal below.
    console.warn('Кабінет очікує підтвердження доступу.', error);
  }

  // Resolve the initial boot state before the full cabinet script starts.
  document.body.classList.remove('cabinet-booting');

  // Never leave an empty course shell visible. The login modal remains usable
  // for guests, while the protected course UI appears only after its content
  // has been downloaded successfully.
  if (!accessGranted) {
    document.body.classList.add('cabinet-guest');
    var loginModal = document.getElementById('cabinetLoginModal');
    if (loginModal) loginModal.style.display = 'flex';

    // The full cabinet app expects protected markup to exist. Guests only
    // need this small login handler, so do not start the course UI empty.
    window.doLogin = async function (event) {
      event.preventDefault();
      var email = document.getElementById('cabinetLoginInput').value.trim().toLowerCase();
      var password = document.getElementById('cabinetPassInput').value;
      var errorEl = document.getElementById('cabinetLoginError');
      var button = document.querySelector('.login-submit');
      if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
      if (button) button.disabled = true;
      try {
        var login = await window.startAmazonSupabase.auth.signInWithPassword({ email: email, password: password });
        if (login.error) throw login.error;
        var access = await window.startAmazonSupabase.rpc('has_active_course_access');
        if (access.error || access.data !== true) {
          await window.startAmazonSupabase.auth.signOut();
          throw new Error('no_access');
        }
        localStorage.setItem('sa_user', email);
        localStorage.removeItem('sa_token');
        var target = document.getElementById('cabinetContent');
        var content = await window.startAmazonSupabase.storage
          .from('course-content')
          .download('cabinet-content.html');
        if (content.error) throw content.error;
        target.innerHTML = await content.data.text();
        document.body.classList.remove('cabinet-guest');
        if (loginModal) loginModal.style.display = 'none';
        await loadScript('cabinet.js?v=58');
      } catch (error) {
        if (errorEl) {
          errorEl.style.display = 'block';
          errorEl.textContent = error.message === 'no_access'
            ? 'Для цього email ще немає оплаченного доступу.'
            : 'Невірний email або пароль.';
        }
      } finally {
        if (button) button.disabled = false;
      }
      return false;
    };
    var recoveryButton = document.getElementById('cabinetRecoveryBtn');
    if (recoveryButton) recoveryButton.addEventListener('click', async function () {
      var email = document.getElementById('cabinetLoginInput').value.trim().toLowerCase();
      var errorEl = document.getElementById('cabinetLoginError');
      if (!email) {
        if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = 'Спочатку введіть email.'; }
        return;
      }
      recoveryButton.disabled = true;
      try {
        var redirectTo = new URL('enter.html?mode=activate', window.location.href).href;
        var recovery = await window.startAmazonSupabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
        if (recovery.error) throw recovery.error;
        if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = 'Нове посилання надіслано на email.'; }
      } catch (error) {
        if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = 'Не вдалося надіслати посилання. Спробуй ще раз.'; }
      } finally {
        recoveryButton.disabled = false;
      }
    });
    return;
  }

  // Load the application after the protected body (or guest state) is ready.
  try {
    await loadScript('cabinet.js?v=58');
  } catch (error) {
    document.body.classList.add('cabinet-load-error');
    console.error('Не вдалося запустити кабінет.', error);
  }
})();
