// Load private content and hydrate account state before starting the UI.
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

  async function downloadCourseContent() {
    var lastError;
    for (var attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await window.startAmazonSupabase.auth.getSession();
        await new Promise(function (resolve) { setTimeout(resolve, 450); });
      }
      var result = await window.startAmazonSupabase.storage
        .from('course-content')
        .download('cabinet-content.html');
      if (!result.error && result.data) return result.data;
      lastError = result.error || new Error('empty_course_content');
    }
    throw lastError;
  }

  async function hydrateProgress(session) {
    await loadScript('cabinet-progress.js?v=1');
    window.courseProgress = window.createCourseProgress(window.startAmazonSupabase, localStorage, {
      onStatus: function (state) {
        var el = document.getElementById('progressSyncStatus');
        if (el) {
          el.textContent = state === 'saved' ? 'Збережено' : state === 'pending' ? 'Зберігаємо…' : 'Немає з’єднання — зміни збережено на цьому пристрої';
          el.dataset.state = state;
        }
      },
      onError: function (error) { console.warn('Progress sync:', error.message); }
    });
    await window.courseProgress.init(session);
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
        await hydrateProgress(session);
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
        if (access.error) {
          var accessError = new Error('access_check_failed');
          accessError.cause = access.error;
          throw accessError;
        }
        if (access.data !== true) {
          await window.startAmazonSupabase.auth.signOut();
          throw new Error('no_access');
        }
        var target = document.getElementById('cabinetContent');
        var contentFile;
        try {
          contentFile = await downloadCourseContent();
        } catch (storageError) {
          var contentError = new Error('content_load_failed');
          contentError.cause = storageError;
          throw contentError;
        }
        target.innerHTML = await contentFile.text();
        await hydrateProgress(login.data.session);
        localStorage.removeItem('sa_token');
        document.body.classList.remove('cabinet-guest');
        if (loginModal) loginModal.style.display = 'none';
        await loadScript('cabinet.js?v=86');
      } catch (error) {
        if (errorEl) {
          errorEl.style.display = 'block';
          errorEl.textContent = error.message === 'no_access'
            ? 'Для цього email ще немає оплаченного доступу.'
            : error.message === 'access_check_failed'
              ? 'Не вдалося перевірити доступ до курсу. Онови сторінку та спробуй ще раз.'
              : error.message === 'content_load_failed'
                ? 'Доступ підтверджено, але матеріали не завантажились. Спробуй ще раз.'
                : error.code === 'invalid_credentials' ? 'Невірний email або пароль.'
                  : 'Не вдалося завантажити кабінет. Перевір з’єднання та спробуй ще раз.';
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
      if (!email || !document.getElementById('cabinetLoginInput').checkValidity()) {
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
        if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = error.status === 429 ? 'Забагато запитів. Зачекай перед наступною спробою.' : 'Не вдалося надіслати посилання. Спробуй пізніше.'; }
      } finally {
        setTimeout(function () { recoveryButton.disabled = false; }, 60000);
      }
    });
    return;
  }

  // Load the application after the protected body (or guest state) is ready.
  try {
    await loadScript('cabinet.js?v=86');
  } catch (error) {
    document.body.classList.add('cabinet-load-error');
    console.error('Не вдалося запустити кабінет.', error);
  }
})();
