// Load private content and hydrate account state before starting the UI.
(async function () {
  var accessGranted = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('script_load_failed')); };
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
    await loadScript('cabinet-progress.js?v=2');
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
    try {
      await window.courseProgress.init(session);
    } catch (cause) {
      var error = new Error('progress_load_failed');
      error.cause = cause;
      throw error;
    }
  }

  function loadErrorMessage(error) {
    var code = String(error && error.cause && error.cause.code || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0,32);
    if (error.message === 'progress_load_failed') return 'Не вдалося прочитати збережений прогрес. Дані не скинуто. Код: PROGRESS' + (code ? '_' + code : '') + '.';
    if (error.message === 'script_load_failed') return 'Не завантажився файл кабінету. Код: SCRIPT. Онови сторінку.';
    var stage = String(error.stage || 'LOAD').replace(/[^A-Z_]/g, '');
    return 'Не вдалося завантажити кабінет. Код: ' + stage + (code ? '_' + code : '') + '. Спробуй ще раз.';
  }

  function isInvalidCredentials(error) {
    var code = String(error && (error.code || error.error_code) || '').toLowerCase();
    var message = String(error && error.message || '').toLowerCase();
    return code === 'invalid_credentials' || message.includes('invalid login credentials');
  }

  function authErrorMessage(error) {
    if (isInvalidCredentials(error)) return 'Невірний email або пароль. Скористайся «Надіслати нове посилання», щоб задати новий пароль.';
    var message = String(error && error.message || '').toLowerCase();
    if (message.includes('failed to fetch') || message.includes('network')) return 'Safari не зміг з’єднатися із сервером входу. Вимкни блокування контенту для цієї сторінки та спробуй ще раз.';
    if (error && error.status === 429) return 'Забагато спроб входу. Зачекай кілька хвилин і повтори.';
    return loadErrorMessage(error);
  }

  try {
    var target = document.getElementById('cabinetContent');
    for (const src of [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4',
      'platform-client.js?v=1'
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
    var bootError = document.getElementById('cabinetLoginError');
    if (bootError) { bootError.textContent = loadErrorMessage(error); bootError.style.display = 'block'; }
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
      var stage = 'AUTH';
      try {
        var login = await window.startAmazonSupabase.auth.signInWithPassword({ email: email, password: password });
        if (login.error) throw login.error;
        stage = 'ACCESS';
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
        stage = 'CONTENT';
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
        stage = 'PROGRESS';
        await hydrateProgress(login.data.session);
        localStorage.removeItem('sa_token');
        document.body.classList.remove('cabinet-guest');
        if (loginModal) loginModal.style.display = 'none';
        stage = 'APP';
        await loadScript('cabinet.js?v=87');
      } catch (error) {
        error.stage = stage;
        console.warn('Cabinet loading failed at ' + stage, error);
        if (errorEl) {
          errorEl.style.display = 'block';
          errorEl.textContent = error.message === 'no_access'
            ? 'Для цього email ще немає оплаченного доступу.'
            : error.message === 'access_check_failed'
              ? 'Не вдалося перевірити доступ до курсу. Онови сторінку та спробуй ще раз.'
              : error.message === 'content_load_failed'
                ? 'Доступ підтверджено, але матеріали не завантажились. Спробуй ще раз.'
                : stage === 'AUTH' ? authErrorMessage(error)
                  : loadErrorMessage(error);
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
    await loadScript('cabinet.js?v=87');
  } catch (error) {
    document.body.classList.add('cabinet-load-error');
    console.error('Не вдалося запустити кабінет.', error);
  }
})();
