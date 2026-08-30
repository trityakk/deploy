(function () {
  'use strict';

  var STORAGE_KEY = 'sa_onboarding_seen';
  var TOTAL = 3;

  // Посилання з листа після оплати відкриває цей режим і дозволяє
  // покупцеві створити пароль без окремої реєстрації.
  if (new URLSearchParams(window.location.search).get('mode') === 'activate') {
    var activate = document.getElementById('activate');
    var onboard = document.getElementById('onboard');
    var form = document.getElementById('activateForm');
    var error = document.getElementById('activateError');
    if (activate) activate.style.display = 'flex';
    if (onboard) onboard.style.display = 'none';
    var submit = form && form.querySelector('.activate-submit');
    var status = document.getElementById('activateStatus');
    var recoveryReady = false;

    setActivationReady(false);

    function setActivationReady(ready) {
      recoveryReady = ready;
      if (submit) submit.disabled = !ready;
      if (status) {
        status.textContent = ready ? 'Посилання підтверджено. Можна створити пароль.' : 'Посилання ще перевіряється…';
        status.classList.toggle('activate-status--ready', ready);
      }
    }

    function waitForRecoverySession() {
      return new Promise(function (resolve) {
        var finished = false;
        var timer = setTimeout(function () { finish(null); }, 20000);
        var poll = setInterval(checkSession, 300);
        var listener = window.startAmazonSupabase.auth.onAuthStateChange(function (event, session) {
          if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) finish(session);
        });
        function finish(session) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          clearInterval(poll);
          if (listener && listener.data && listener.data.subscription) listener.data.subscription.unsubscribe();
          resolve(session);
        }
        function checkSession() {
          window.startAmazonSupabase.auth.getSession().then(function (result) {
          var session = result && result.data && result.data.session;
          if (session) finish(session);
          }).catch(function () { /* URL-сесія ще може оброблятися */ });
        }
        checkSession();
      });
    }

    document.querySelectorAll('.password-toggle').forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        var input = document.getElementById(toggle.getAttribute('data-target'));
        if (!input) return;
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        toggle.classList.toggle('is-visible', !showing);
        toggle.setAttribute('aria-label', showing ? 'Показати пароль' : 'Сховати пароль');
        toggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
      });
    });
    async function completeAuthCallback() {
      var code = new URLSearchParams(window.location.search).get('code');
      if (!code) return;
      var result = await window.startAmazonSupabase.auth.exchangeCodeForSession(code);
      if (result && result.error) throw result.error;
    }

    completeAuthCallback().catch(function (err) {
      console.warn('Не вдалося обміняти код активації на сесію.', err);
    }).finally(function () {
      return waitForRecoverySession();
    }).then(function (session) {
      setActivationReady(!!session);
      if (!session && error) {
        var params = new URLSearchParams(window.location.search);
        var reason = params.get('error_description') || params.get('error');
        error.textContent = reason
          ? 'Не вдалося підтвердити посилання: ' + reason.replace(/\+/g, ' ')
          : 'Не вдалося підтвердити сесію. Відкрий лист ще раз або запроси нове посилання.';
        error.classList.add('is-visible');
      }
    });
    if (form) form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!recoveryReady) return;
      var password = document.getElementById('activatePassword').value;
      var repeat = document.getElementById('activatePasswordAgain').value;
      if (password !== repeat) {
        error.textContent = 'Паролі не збігаються.';
        error.classList.add('is-visible');
        return;
      }
      if (submit) submit.disabled = true;
      try {
        var result = await window.startAmazonSupabase.auth.updateUser({ password: password });
        if (result.error) throw result.error;
        localStorage.setItem(STORAGE_KEY, '1');
        window.location.href = 'cabinet.html';
      } catch (err) {
        if (submit) submit.disabled = false;
        error.textContent = err && err.message ? 'Не вдалося зберегти пароль: ' + err.message : 'Не вдалося зберегти пароль. Посилання могло застаріти.';
        error.classList.add('is-visible');
      }
    });
    return;
  }

  if (localStorage.getItem(STORAGE_KEY) === '1') {
    window.location.replace('cabinet.html');
    return;
  }

  var step = 0;
  var btn = document.getElementById('onboardBtn');
  var bgs = document.querySelectorAll('.onboard__bg');
  var steps = document.querySelectorAll('.onboard__step');
  var dots = document.querySelectorAll('.onboard__dot');
  var track = document.querySelector('.onboard__bg-track');
  var touchStartX = 0;
  var touchDeltaX = 0;

  function setStep(next) {
    if (next < 0 || next >= TOTAL) return;
    step = next;

    bgs.forEach(function (bg, i) {
      bg.classList.toggle('onboard__bg--active', i === step);
    });

    var activeBg = bgs[step];
    if (activeBg && document.body) {
      var photo = getComputedStyle(activeBg).getPropertyValue('--onboard-photo').trim();
      if (photo && photo !== 'none') {
        document.body.style.setProperty('--onboard-bg', photo);
      }
    }

    steps.forEach(function (el, i) {
      el.classList.toggle('onboard__step--active', i === step);
    });

    dots.forEach(function (dot, i) {
      var active = i === step;
      dot.classList.toggle('onboard__dot--active', active);
      dot.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    btn.textContent = step === TOTAL - 1 ? 'Увійти в кабінет' : (step === 0 ? 'Почнемо' : 'Далі →');
  }

  function finish() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) { /* ignore */ }
    window.location.href = 'cabinet.html';
  }

  function nextStep() {
    if (step >= TOTAL - 1) finish();
    else setStep(step + 1);
  }

  function prevStep() {
    if (step > 0) setStep(step - 1);
  }

  if (btn) btn.addEventListener('click', nextStep);

  dots.forEach(function (dot) {
    dot.addEventListener('click', function () {
      var idx = parseInt(dot.getAttribute('data-dot'), 10);
      if (!isNaN(idx)) setStep(idx);
    });
  });

  if (track) {
    track.addEventListener('touchstart', function (e) {
      touchStartX = e.changedTouches[0].clientX;
      touchDeltaX = 0;
    }, { passive: true });

    track.addEventListener('touchmove', function (e) {
      touchDeltaX = e.changedTouches[0].clientX - touchStartX;
    }, { passive: true });

    track.addEventListener('touchend', function () {
      if (Math.abs(touchDeltaX) < 48) return;
      if (touchDeltaX < 0) nextStep();
      else prevStep();
    }, { passive: true });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'Enter') nextStep();
    if (e.key === 'ArrowLeft') prevStep();
  });
})();
