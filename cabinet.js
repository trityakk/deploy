(function () {
  'use strict';

  function safeJSONParse(str, fallback) {
    try { return JSON.parse(str || 'null') || fallback; }
    catch (e) {
      console.warn('Не вдалося прочитати збережені дані, використано значення за замовчуванням:', e);
      return fallback;
    }
  }

  // Тонка обгортка над localStorage. localStorage лишається миттєвим
  // локальним кешем (UI читає саме з нього), а Supabase — джерело правди
  // між пристроями.
  // schedulePushProgress визначена нижче (function-декларація, тому
  // доступна тут завдяки hoisting) і сама вирішує, чи ключ взагалі
  // варто синхронізувати.
  function saveProgress(key, value) {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      schedulePushProgress(key);
    } catch (e) {
      console.warn('Не вдалося зберегти прогрес (' + key + '):', e);
    }
  }

  function loadProgress(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      // theme/last_chapter/user зберігаються як прості рядки, інше — як JSON
      if (key === 'sa_theme' || key === 'sa_last_chapter' || key === 'sa_user' || key === 'sa_display_name') return raw;
      return safeJSONParse(raw, fallback);
    } catch (e) {
      console.warn('Не вдалося завантажити прогрес (' + key + '):', e);
      return fallback;
    }
  }

  var user = loadProgress('sa_user', 'guest') || 'guest';

  function clearLocalAccountCache() {
    var keys = [
      'sa_read', 'sa_last_chapter', 'sa_bookmarks', 'sa_flashcards',
      'sa_homework', 'sa_homework_answers', 'sa_exam_passed', 'sa_streak',
      'sa_theme', 'sa_tour_seen', 'sa_active_tab', 'sa_overview_tab',
      'sa_sidebar_open_mobile', 'sa_display_name'
    ];
    keys.forEach(function (key) { localStorage.removeItem(key); });
    try {
      var dynamic = [];
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        if (key && key.indexOf('hw_marked_') === 0) dynamic.push(key);
      }
      dynamic.forEach(function (key) { localStorage.removeItem(key); });
    } catch (e) {}
  }

  // При кожному відкритті підтягуємо прогрес із сервера. Це важливо після
  // першого входу: sessionStorage міг залишити прапорець навіть тоді, коли
  // попередній запит не завершився або був перерваний.
  (function syncOnEntry() {
    if (user === 'guest') return;
    pullProgressFromServer(user, function (changed) {
      if (changed) location.reload();
    });
  })();

  var loginModal = document.getElementById('cabinetLoginModal');
  var accountMenu = document.getElementById('sidebarAccountMenu');
  var accountTrigger = document.getElementById('sidebarAvatar');
  window.toggleAccountMenu = function (event) {
    if (event) event.stopPropagation();
    if (!accountMenu) return;
    accountMenu.hidden = !accountMenu.hidden;
    if (accountTrigger) accountTrigger.setAttribute('aria-expanded', accountMenu.hidden ? 'false' : 'true');
  };
  document.addEventListener('click', function (event) {
    if (!accountMenu || accountMenu.hidden) return;
    if (!accountMenu.contains(event.target) && event.target !== accountTrigger) {
      accountMenu.hidden = true;
      if (accountTrigger) accountTrigger.setAttribute('aria-expanded', 'false');
    }
  });
  var passwordChangeModal = document.getElementById('passwordChangeModal');
  var passwordChangeForm = document.getElementById('passwordChangeForm');
  var passwordChangeError = document.getElementById('passwordChangeError');
  var passwordChangeSuccess = document.getElementById('passwordChangeSuccess');
  window.openPasswordChange = function () {
    if (!passwordChangeModal) return;
    passwordChangeModal.style.display = 'flex';
    passwordChangeModal.setAttribute('aria-hidden', 'false');
    if (passwordChangeError) passwordChangeError.style.display = 'none';
    if (passwordChangeSuccess) passwordChangeSuccess.style.display = 'none';
    var first = document.getElementById('newPassword');
    if (first) first.focus();
  };
  function closePasswordChange() {
    if (!passwordChangeModal) return;
    passwordChangeModal.style.display = 'none';
    passwordChangeModal.setAttribute('aria-hidden', 'true');
    if (passwordChangeForm) passwordChangeForm.reset();
  }
  document.querySelectorAll('[data-close-password-modal]').forEach(function (el) {
    el.addEventListener('click', closePasswordChange);
  });
  if (passwordChangeForm) passwordChangeForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var password = document.getElementById('newPassword').value;
    var repeat = document.getElementById('newPasswordAgain').value;
    if (password !== repeat) {
      passwordChangeError.textContent = 'Паролі не збігаються.';
      passwordChangeError.style.display = 'block';
      return;
    }
    var button = passwordChangeForm.querySelector('button[type="submit"]');
    button.disabled = true;
    passwordChangeError.style.display = 'none';
    try {
      var result = await window.startAmazonSupabase.auth.updateUser({ password: password });
      if (result.error) throw result.error;
      passwordChangeSuccess.style.display = 'block';
      setTimeout(closePasswordChange, 900);
    } catch (error) {
      passwordChangeError.textContent = 'Не вдалося змінити пароль. Спробуй ще раз.';
      passwordChangeError.style.display = 'block';
    } finally {
      button.disabled = false;
    }
  });
  // Гість не повинен бачити кабінет або мати можливість взаємодіяти з ним.
  // Важливо: це лише UI-запобіжник; повний захист контенту потребує його
  // перенесення з цього статичного HTML у захищений backend/API.
  if (loginModal) loginModal.style.display = user === 'guest' ? 'flex' : 'none';

  // Вхід через Supabase Auth.
  if (window.startAmazonSupabase) {
    window.doLogin = async function (e) {
      e.preventDefault();
      var email = document.getElementById('cabinetLoginInput').value.trim().toLowerCase();
      var password = document.getElementById('cabinetPassInput').value;
      var errorEl = document.getElementById('cabinetLoginError');
      var button = document.querySelector('.login-submit');
      if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
      if (button) button.disabled = true;
      try {
        var result = await window.startAmazonSupabase.auth.signInWithPassword({ email: email, password: password });
        if (result.error) throw result.error;
        var access = await window.startAmazonSupabase.rpc('has_active_course_access');
        if (access.error) throw access.error;
        if (access.data !== true) {
          await window.startAmazonSupabase.auth.signOut();
          throw new Error('no_access');
        }
        localStorage.setItem('sa_user', email);
        localStorage.removeItem('sa_token');
        window.location.reload();
      } catch (err) {
        if (errorEl) {
          errorEl.style.display = 'block';
          errorEl.textContent = err.message === 'no_access'
            ? 'Для цього email ще немає оплаченного доступу.'
            : 'Невірний email або пароль.';
        }
      } finally {
        if (button) button.disabled = false;
      }
      return false;
    };

    // Не довіряємо localStorage як доказу входу: він легко редагується через
    // DevTools. Справжнім джерелом авторизації є Supabase session.
    window.startAmazonSupabase.auth.getSession().then(function (result) {
      var session = result && result.data && result.data.session;
      if (!session || !session.user || !session.user.email) {
        localStorage.removeItem('sa_user');
        localStorage.removeItem('sa_display_name');
        if (loginModal) loginModal.style.display = 'flex';
        return;
      }
      var sessionEmail = session.user.email.toLowerCase();
      if (localStorage.getItem('sa_user') !== sessionEmail) {
        clearLocalAccountCache();
        localStorage.setItem('sa_user', sessionEmail);
      }
    });
  }

  // The sidebar starts open (class="open" in HTML) on all viewports.
  // On mobile it's a fullscreen overlay, so we explicitly (re)apply the
  // scroll-lock body class here too — this used to only get set inside
  // toggleSidebar(), meaning the *initial* open state on page load never
  // locked scroll, so the page behind the fullscreen menu could still
  // scroll. Doing it here guarantees the sidebar reliably "greets" the
  // user open right after entering the cabinet, on any viewport.
  function isMobileViewport() {
    return window.matchMedia && window.matchMedia('(max-width:768px)').matches;
  }

  // body.sidebar-locked{position:fixed} stops the page from scrolling, but
  // position:fixed on its own resets the visual scroll offset to the top of
  // the viewport and forgets where the user actually was. We save scrollY
  // before locking, offset the fixed body by that amount (so nothing visibly
  // jumps), and restore the real scroll position with scrollTo when we
  // unlock — otherwise every open/close snaps the page back to the top.
  var lockedScrollY = 0;
  function lockBodyScroll() {
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = (-lockedScrollY) + 'px';
    document.body.classList.add('sidebar-locked');
    document.documentElement.classList.add('sidebar-locked');
  }
  function unlockBodyScroll() {
    document.body.classList.remove('sidebar-locked');
    document.documentElement.classList.remove('sidebar-locked');
    document.body.style.top = '';
    window.scrollTo(0, lockedScrollY);
  }

  function ensureSidebarOpenOnEntry() {
    var sb = document.getElementById('sidebar');
    if (!sb) return;
    sb.classList.add('open');
    if (isMobileViewport()) {
      lockBodyScroll();
    }
  }

  // On mobile, once the user actually picks something to read from the
  // fullscreen menu, close it so the content becomes visible. (Desktop is
  // unaffected — there .open just means "sidebar visible next to content".)
  function closeSidebarIfMobile() {
    if (!isMobileViewport()) return;
    var sb = document.getElementById('sidebar');
    if (!sb) return;
    sb.classList.remove('open');
    unlockBodyScroll();
    saveProgress('sa_sidebar_open_mobile', false);
    var results = document.getElementById('searchResults');
    if (results) results.classList.remove('active');
  }

  // .sidebar has `transition: transform`, which makes browsers treat it as a
  // containing block for position:fixed descendants (even while transform is
  // currently 'none'). Moving the search dropdown to <body> keeps its fixed
  // coordinates relative to the real viewport instead of the sidebar's box.
  var searchResultsEl = document.getElementById('searchResults');
  if (searchResultsEl) {
    document.body.appendChild(searchResultsEl);
  }

  // The course markup is inserted inside .cabinet__main. Moving the stats
  // overlay to <body> lets its fixed/z-index layer sit above the sidebar,
  // which is its own stacking context.
  var statsOverlayEl = document.getElementById('statsOverlay');
  if (statsOverlayEl) {
    document.body.appendChild(statsOverlayEl);
  }
  var progressTrigger = document.getElementById('sidebarProgress');
  if (progressTrigger) {
    progressTrigger.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      showStatsPanel();
    });
  }

  var displayName = loadProgress('sa_display_name', '');
  var nameEl = document.getElementById('sidebarName');
  nameEl.textContent = displayName || user;

  function saveDisplayName(value) {
    var cleanValue = String(value || '').trim();
    if (!cleanValue) cleanValue = user;
    displayName = cleanValue;
    saveProgress('sa_display_name', cleanValue === user ? '' : cleanValue);
    // Имя должно переживать закрытие вкладки сразу после редактирования,
    // поэтому не полагаемся только на debounce-синхронизацию прогресса.
    if (window.startAmazonSupabase && user !== 'guest') {
      setTimeout(function () { pushProgressNow(user); }, 0);
    }
    if (!window.startAmazonSupabase || user === 'guest') return;
    window.startAmazonSupabase.auth.getSession().then(function (result) {
      var session = result && result.data && result.data.session;
      if (!session || !session.user) return;
      return window.startAmazonSupabase.from('profiles').upsert({
        id: session.user.id,
        email: session.user.email.toLowerCase(),
        display_name: cleanValue === user ? null : cleanValue,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' }).then(function (result) {
        if (result.error) throw result.error;
        return window.startAmazonSupabase.auth.updateUser({
          data: { display_name: cleanValue === user ? null : cleanValue }
        });
      });
    }).catch(function (error) {
      console.warn('Не вдалося зберегти ім’я профілю:', error);
    });
  }

  nameEl.addEventListener('click', function () {
    if (nameEl.getAttribute('contenteditable') === 'true') return;
    nameEl.setAttribute('contenteditable', 'true');
    nameEl.setAttribute('spellcheck', 'false');
    nameEl.focus();
    var sel = window.getSelection();
    sel.selectAllChildren(nameEl);
    sel.collapseToEnd();
  });
  nameEl.addEventListener('blur', function () {
    nameEl.removeAttribute('contenteditable');
    var val = nameEl.textContent.trim();
    if (!val) nameEl.textContent = user;
    saveDisplayName(val);
  });
  nameEl.addEventListener('input', function () {
    saveProgress('sa_display_name', nameEl.textContent.trim());
  });
  nameEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
  });

  // Имя хранится в профиле отдельно от учебного прогресса. Подтягиваем его
  // после загрузки кабинета, чтобы оно восстанавливалось и на новом устройстве.
  if (window.startAmazonSupabase && user !== 'guest') {
    window.startAmazonSupabase.auth.getSession().then(function (result) {
      var session = result && result.data && result.data.session;
      if (!session || !session.user) return;
      return window.startAmazonSupabase.from('profiles')
        .select('display_name')
        .eq('id', session.user.id)
        .maybeSingle();
    }).then(async function (result) {
      var serverName = result && result.data && result.data.display_name;
      if (!serverName) {
        var sessionResult = await window.startAmazonSupabase.auth.getSession();
        var sessionUser = sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.user;
        serverName = sessionUser && sessionUser.user_metadata && sessionUser.user_metadata.display_name;
      }
      if (serverName) {
        displayName = serverName;
        nameEl.textContent = serverName;
        saveProgress('sa_display_name', serverName);
      }
    }).catch(function () {});
  }
  var avatarNum = Math.floor(Math.random() * 3) + 1;
document.getElementById('avatarImg').src = 'photo/cabavatar' + avatarNum + '.jpg';
  var prefaceAvatar = document.getElementById('prefaceAvatarImg');
  if (prefaceAvatar) prefaceAvatar.src = 'photo/cabavatar' + avatarNum + '.jpg';

  var links = document.querySelectorAll('.sidebar__link');
  var chapters = document.querySelectorAll('.cabinet__chapter');
  var readChapters = loadProgress('sa_read', []);
  var overviewCards = document.getElementById('overviewCards');
  var progressCount = document.getElementById('progressCount');
  var progressFill = document.getElementById('progressFill');
  var totalChapters = 0;
  var currentChapter = null;
  var bookmarks = loadProgress('sa_bookmarks', []);
  var bookmarksLink = document.getElementById('bookmarksLink');
  if (bookmarksLink) {
    bookmarksLink.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      showBookmarksPanel();
    });
  }

  // ─── Streak: дні навчання поспіль ───
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayDiff(a, b) {
    var da = new Date(a); var db = new Date(b);
    var utcA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
    var utcB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
    return Math.round((utcB - utcA) / 86400000);
  }
  var streak = loadProgress('sa_streak', { count: 0, best: 0, last: null });
  function bumpStreak() {
    var today = todayStr();
    if (streak.last === today) return;
    if (streak.last && dayDiff(streak.last, today) === 1) {
      streak.count += 1;
    } else {
      streak.count = 1;
    }
    streak.last = today;
    if (streak.count > streak.best) streak.best = streak.count;
    saveProgress('sa_streak', streak);
  }
  bumpStreak();

  var chapterIcons = {
    preface: '📖', ch1: '🌍', ch2: '📝', ch3: '🔍', ch4: '🤝', ch5: '🚢',
    ch6: '📸', ch7: '🎨', ch8: '🏆', ch9: '🛡️', ch10: '💰', ch11: '⚖️',
    ch12: '✅', ch13: '📢', ch14: '🇺🇦', ch15: '⭐', ch16: '🚀', ch17: '⚡',
    ch18: '🏭', final_exam: '🎓', appendix_intro: '📚',
    appendix_a: '🧩', appendix_b: '💥', appendix_c: '📅', appendix_d: '❓',
    appendix_e: '🧠', appendix_f: '🧩', appendix_g: '✍️', appendix_h: '🎄',
    appendix_i: '👍', appendix_j: '🔄', appendix_k: '📋', appendix_l: '🚫',
    appendix_m: '📊', appendix_n: '🔗', appendix_o: '💼', appendix_p: '📖',
    appendix_q: '📹', appendix_r: '🤖', appendix_s: '📅',
    appendix_t: '🔗', appendix_u: '📊'
  };

  function buildChapterOrder() {
    var arr = [];
    document.querySelectorAll('.cabinet__chapter').forEach(function (art) {
      if (art.id) arr.push(art.id);
    });
    return arr;
  }

  function buildChapterNames() {
    var names = {};
    document.querySelectorAll('.sidebar__link[data-ch]').forEach(function (link) {
      var id = link.getAttribute('data-ch');
      if (!id) return;
      var clone = link.cloneNode(true);
      var numEl = clone.querySelector('.sidebar__link-num');
      var num = numEl ? numEl.textContent.trim() : '';
      if (numEl) numEl.remove();
      var checkEl = clone.querySelector('.sidebar__link-check');
      if (checkEl) checkEl.remove();
      var title = clone.textContent.replace(/\s+/g, ' ').trim();
      var icon = chapterIcons[id] || num;
      names[id] = icon ? icon + ' ' + title : title;
    });
    return names;
  }

  var chapterOrder = buildChapterOrder();
  var chapterNames = buildChapterNames();

  chapterOrder.forEach(function (id) {
    if (!chapterNames[id]) chapterNames[id] = id;
  });

  totalChapters = chapterOrder.length;

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function escCssSelector(s) {
    return s.replace(/["\\\]]/g, '\\$&');
  }

  function qs(el, sel) {
    try { return el.querySelector(sel); } catch (e) { return null; }
  }

  function qsa(el, sel) {
    try { return el.querySelectorAll(sel); } catch (e) { return []; }
  }

  window.toggleSidebar = function () {
    var sb = document.getElementById('sidebar');
    if (!sb) return;
    sb.classList.toggle('open');
    var isOpen = sb.classList.contains('open');
    if (isMobileViewport()) {
      if (isOpen) { lockBodyScroll(); } else { unlockBodyScroll(); }
      saveProgress('sa_sidebar_open_mobile', isOpen);
    }
    if (!isOpen) {
      var results = document.getElementById('searchResults');
      if (results) results.classList.remove('active');
    }
  };

  var searchTimeout = null;

  function positionSearchResults() {
    var input = document.getElementById('sidebarSearch');
    var results = document.getElementById('searchResults');
    if (!input || !results) return;
    var r = input.getBoundingClientRect();
    results.style.left = r.left + 'px';
    results.style.top = (r.bottom + 6) + 'px';
    results.style.width = r.width + 'px';
  }

  window.searchContent = function (query) {
    var wrap = document.getElementById('sidebarSearchWrap');
    if (wrap) wrap.classList.toggle('has-value', !!query);
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function () {
      var results = document.getElementById('searchResults');
      if (!query || query.length < 2) { results.classList.remove('active'); results.innerHTML = ''; return; }
      var q = query.toLowerCase();
      var found = [];
      document.querySelectorAll('.cabinet__chapter').forEach(function (ch) {
        var id = ch.id;
        var name = chapterNames[id] || id;
        var text = ch.textContent || '';
        var lower = text.toLowerCase();
        var idx = lower.indexOf(q);
        if (idx !== -1) {
          var start = Math.max(0, idx - 40);
          var end = Math.min(text.length, idx + query.length + 40);
          var snippet = (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
          snippet = escHtml(snippet);
          var escapedQuery = escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          snippet = snippet.replace(new RegExp('(' + escapedQuery + ')', 'gi'), '<b>$1</b>');
          found.push({ id: id, name: name, snippet: snippet });
        }
      });
      results.innerHTML = '';
      if (found.length === 0) {
        results.innerHTML = '<div class="sidebar__search-result">Нічого не знайдено</div>';
      } else {
        found.forEach(function (r) {
          var div = document.createElement('div');
          div.className = 'sidebar__search-result';
          div.textContent = r.name + ' ';
          var span = document.createElement('span');
          span.innerHTML = r.snippet;
          div.appendChild(span);
          div.addEventListener('click', function () {
            window.goToChapter(r.id);
          });
          results.appendChild(div);
        });
      }
      positionSearchResults();
      results.classList.add('active');
    }, 200);
  };

  window.addEventListener('resize', positionSearchResults);
  window.addEventListener('scroll', positionSearchResults, true);

  window.clearSidebarSearch = function () {
    var input = document.getElementById('sidebarSearch');
    var results = document.getElementById('searchResults');
    var wrap = document.getElementById('sidebarSearchWrap');
    if (input) { input.value = ''; input.blur(); }
    if (results) { results.classList.remove('active'); results.innerHTML = ''; }
    if (wrap) wrap.classList.remove('has-value');
  };

  window.goToChapter = function (id) {
    document.getElementById('searchResults').classList.remove('active');
    document.getElementById('sidebarSearch').value = '';
    var wrap = document.getElementById('sidebarSearchWrap');
    if (wrap) wrap.classList.remove('has-value');
    showChapter(id);
  };

  function updateProgress() {
    var done = readChapters.length;
    progressCount.textContent = done + ' / ' + totalChapters;
    progressFill.style.width = (done / totalChapters * 100) + '%';
  }

  function isRead(id) { return readChapters.indexOf(id) !== -1; }

  function markRead(id) {
    if (!isRead(id)) {
      readChapters.push(id);
      saveProgress('sa_read', readChapters);
    }
    applyReadState(id);
    updateProgress();
  }

  function unmarkRead(id) {
    var idx = readChapters.indexOf(id);
    if (idx !== -1) {
      readChapters.splice(idx, 1);
      saveProgress('sa_read', readChapters);
    }
    applyReadState(id);
    updateProgress();
  }

  function applyReadState(id) {
    var link = qs(document, '.sidebar__link[data-ch="' + escCssSelector(id) + '"]');
    if (link) {
      if (isRead(id)) { link.classList.add('sidebar__link--completed'); } else { link.classList.remove('sidebar__link--completed'); }
    }
    var card = qs(document, '.chapter-card[href="#' + escCssSelector(id) + '"]');
    if (card) {
      if (isRead(id)) { card.classList.add('chapter-card--done'); } else { card.classList.remove('chapter-card--done'); }
    }
    updateMarkReadButton(id);
  }

  function updateMarkReadButton(id) {
    try {
      var btns = qsa(document, '.mark-read');
      btns.forEach(function (btn) {
        var onclick = btn.getAttribute('onclick');
        if (!onclick) return;
        var match = onclick.match(/toggleRead\('([^']+)'\)/);
        if (match && match[1] === id) {
          if (isRead(id)) { btn.classList.add('mark-read--done'); } else { btn.classList.remove('mark-read--done'); }
        }
      });
    } catch (e) { /* skip */ }
  }

  function getNextChapterId(id) {
    var idx = chapterOrder.indexOf(id);
    return idx >= 0 && idx < chapterOrder.length - 1 ? chapterOrder[idx + 1] : null;
  }

  function updateUnifiedButtons() {
    document.querySelectorAll('.mark-read').forEach(function (btn) {
      var onclick = btn.getAttribute('onclick');
      if (!onclick) return;
      var match = onclick.match(/toggleRead\('([^']+)'\)/);
      if (!match) return;
      var cid = match[1];
      var nextId = getNextChapterId(cid);
      var textEl = btn.querySelector('.mark-read__text');
      if (nextId) {
        var name = chapterNames[nextId] || nextId;
        name = name.replace(/^[^\s]+\s/, '');
        textEl.textContent = name + ' →';
      } else {
        textEl.textContent = 'Курс завершено';
      }
      var labelDali = btn.querySelector('.mark-read__label--dali');
      var labelDone = btn.querySelector('.mark-read__label--done');
      if (!labelDali) {
        labelDali = document.createElement('span');
        labelDali.className = 'chapter-nav__label mark-read__label--dali';
        labelDali.textContent = 'Далі';
        btn.insertBefore(labelDali, textEl);
      }
      if (!labelDone) {
        labelDone = document.createElement('span');
        labelDone.className = 'chapter-nav__label mark-read__label--done';
        labelDone.textContent = 'Прочитано';
        btn.insertBefore(labelDone, textEl);
      }
      if (isRead(cid)) { btn.classList.add('mark-read--done'); } else { btn.classList.remove('mark-read--done'); }
    });
  }

  window.toggleRead = function (id) {
    if (isRead(id)) {
      unmarkRead(id);
    } else {
      if (id === 'final_exam' && !isExamPassed()) {
        var introEl = document.getElementById('exam_intro');
        if (introEl) {
          introEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
          introEl.classList.add('exam--shake');
          setTimeout(function () { introEl.classList.remove('exam--shake'); }, 600);
        }
        var examStatus = document.getElementById('examStatus');
        if (examStatus) {
          examStatus.textContent = 'Спочатку склади іспит: правильно відповідай щонайменше на 28 з 42 питань.';
          examStatus.className = 'exam__status exam__status--error';
        }
        return;
      }
      if (!isHomeworkPassed(id)) {
        flashHomeworkWarning(id);
        return;
      }
      markRead(id);
      showCompletionScreen(id);
    }
    updateUnifiedButtons();
    updateContinueReadingBtn();
  };

  function showOverview() {
    chapters.forEach(function (c) { c.style.display = 'none'; });
    overviewCards.style.display = 'grid';
    links.forEach(function (l) { l.classList.remove('active'); });
    var cards = overviewCards.querySelectorAll('.chapter-card');
    cards.forEach(function (card, i) {
      card.style.opacity = '0';
      card.style.transform = 'translateY(12px)';
      setTimeout(function () {
        card.style.transition = 'opacity .35s ease, transform .35s ease';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, 40 * i);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    history.replaceState(null, '', '#');
    currentChapter = null;
    closeSidebarIfMobile();
  }

  function showChapter(id, fromNav) {
    var bookmarksPanel = document.getElementById('bookmarksPanel');
    if (bookmarksPanel) bookmarksPanel.style.display = 'none';
    overviewCards.style.display = 'none';
    chapters.forEach(function (c) { c.style.display = 'none'; });
    var el = document.getElementById(id);
    if (el) el.style.display = 'block';
    if (rdRevealChapter) setTimeout(function () { rdRevealChapter(id); }, 40);
    links.forEach(function (l) { l.classList.remove('active'); });
    var activeLink = qs(document, '.sidebar__link[data-ch="' + escCssSelector(id) + '"]');
    if (activeLink) {
      activeLink.classList.add('active');
      var parentGroup = activeLink.closest('.sidebar__group');
      if (parentGroup && window.switchSidebarTab) window.switchSidebarTab(parentGroup.id);
      var nav = document.querySelector('.sidebar__nav');
      if (nav) {
        var linkTop = activeLink.offsetTop;
        var linkH = activeLink.offsetHeight;
        var navH = nav.clientHeight;
        if (linkTop < nav.scrollTop) {
          nav.scrollTop = Math.max(0, linkTop - 8);
        } else if (linkTop + linkH > nav.scrollTop + navH) {
          nav.scrollTop = linkTop + linkH - navH + 8;
        }
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    currentChapter = id;
    saveProgress('sa_last_chapter', id);
    updateMarkReadButtons();
    updateUnifiedButtons();
    initBookmarkPins();
    updateContinueReadingBtn();
    initChapterMeta(id);
    if (window.innerWidth > 768) rdAutoLinkGlossary(id);
    if (fromNav && isRead(id)) {
      showCompletionScreen(id);
    }
    closeSidebarIfMobile();
  }

  function updateMarkReadButtons() {
    document.querySelectorAll('.mark-read').forEach(function (btn) {
      var onclick = btn.getAttribute('onclick');
      if (!onclick) return;
      var match = onclick.match(/toggleRead\('([^']+)'\)/);
      if (!match) return;
      var cid = match[1];
      if (isRead(cid)) { btn.classList.add('mark-read--done'); } else { btn.classList.remove('mark-read--done'); }
    });
  }

  links.forEach(function (l) {
    l.addEventListener('click', function (e) {
      e.preventDefault();
      var id = this.getAttribute('data-ch');
      history.replaceState(null, '', '#' + id);
      showChapter(id);
    });
  });

  document.querySelectorAll('.chapter-card').forEach(function (card) {
    card.addEventListener('click', function (e) {
      e.preventDefault();
      var href = this.getAttribute('href').replace('#', '');
      history.replaceState(null, '', '#' + href);
      showChapter(href);
    });
  });

  // Desktop-only pointer tilt: a restrained 3D response makes the overview
  // feel tactile without adding work or accidental movement on touch devices.
  if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.chapter-card').forEach(function (card) {
      var frame = 0;
      card.addEventListener('pointerenter', function () {
        card.classList.add('chapter-card--tilting');
        card.style.transition = '';
      });
      card.addEventListener('pointermove', function (event) {
        var rect = card.getBoundingClientRect();
        var x = (event.clientX - rect.left) / rect.width - 0.5;
        var y = (event.clientY - rect.top) / rect.height - 0.5;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(function () {
          card.style.transform = 'perspective(900px) translateY(-5px) rotateX(' + (-y * 6).toFixed(2) + 'deg) rotateY(' + (x * 7).toFixed(2) + 'deg) scale(1.018)';
        });
      });
      card.addEventListener('pointerleave', function () {
        cancelAnimationFrame(frame);
        card.classList.remove('chapter-card--tilting');
        card.style.transform = '';
      });
    });

    // Lightweight pointer tilt for the content cards.  It reuses the same
    // tactile motion as chapter cards, but keeps the angle and scale subtle.
    document.querySelectorAll('.rd-stat, .rd-role, .rd-flow .supply-chain__step').forEach(function (card) {
      var frame = 0;
      card.addEventListener('pointerenter', function () {
        card.classList.add('rd-pointer-tilting');
      });
      card.addEventListener('pointermove', function (event) {
        var rect = card.getBoundingClientRect();
        var x = (event.clientX - rect.left) / rect.width - 0.5;
        var y = (event.clientY - rect.top) / rect.height - 0.5;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(function () {
          card.style.transform = 'perspective(800px) translateY(-4px) rotateX(' + (-y * 5).toFixed(2) + 'deg) rotateY(' + (x * 6).toFixed(2) + 'deg) scale(1.012)';
        });
      });
      card.addEventListener('pointerleave', function () {
        cancelAnimationFrame(frame);
        card.classList.remove('rd-pointer-tilting');
        card.style.transform = '';
      });
    });
  }

  window.switchSidebarTab = function (id) {
    document.querySelectorAll('.sidebar__group').forEach(function (g) {
      g.classList.toggle('sidebar__group--collapsed', g.id !== id);
    });
    document.querySelectorAll('.sidebar__tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.target === id);
    });
    saveProgress('sa_active_tab', id);
  };

  var savedTab = loadProgress('sa_active_tab', 'chapterGroup');
  if (document.getElementById(savedTab)) {
    window.switchSidebarTab(savedTab);
  }

  readChapters.forEach(function (id) { applyReadState(id); });
  updateProgress();
  updateMarkReadButtons();

  var hash = window.location.hash.replace('#', '');
  history.scrollRestoration = 'manual';
  if (hash && document.getElementById(hash)) {
    // Reloading while a specific chapter is open (e.g. user just refreshed
    // the page mid-read) — stay on that chapter, don't force the sidebar
    // open over it.
    showChapter(hash);
    window.scrollTo(0, 0);
  } else if (isMobileViewport()) {
    // Genuine "entry" into the cabinet on mobile: show the chapter-cards
    // overview by default, not the fullscreen sidebar overlay on top of it.
    // If the user had explicitly left the sidebar open (e.g. mid-browsing,
    // then refreshed), respect that instead of overriding their choice.
    // Must read the saved preference BEFORE showOverview(), since
    // showOverview() itself closes the mobile sidebar and would otherwise
    // overwrite the saved "open" preference with false first.
    var wantOpenMobile = loadProgress('sa_sidebar_open_mobile', false);
    showOverview();
    var sb = document.getElementById('sidebar');
    if (sb && wantOpenMobile) {
      sb.classList.add('open');
      lockBodyScroll();
      saveProgress('sa_sidebar_open_mobile', true);
    }
    window.scrollTo(0, 0);
  } else {
    // No chapter in the URL — this is a genuine "entry" into the cabinet
    // (e.g. fresh arrival from the landing page login), so on desktop the
    // sidebar should greet the user open (it's a persistent nav rail there,
    // not an overlay).
    showOverview();
    ensureSidebarOpenOnEntry();
    window.scrollTo(0, 0);
  }

  // Safety net for the "start at the very top" cases above: avatar photos,
  // chapter images and web fonts keep finishing after this script already
  // ran and set scroll to 0, and the layout shift that follows can nudge
  // the page down (see IMG_4188 — reload lands slightly scrolled instead of
  // at the very top). overflow-anchor:none in CSS covers most engines, but
  // a single window.addEventListener('load', ...) isn't reliable on its
  // own — if everything is already cached, 'load' can fire before this
  // script finishes running and attaches the listener, so it's silently
  // missed. Re-assert scroll 0 from several angles instead — cheap, and
  // every attempt is skipped the moment the user actually starts scrolling.
  var userScrolledManually = false;
  function markManualScroll() { userScrolledManually = true; }
  window.addEventListener('touchstart', markManualScroll, { passive: true, once: true });
  window.addEventListener('wheel', markManualScroll, { passive: true, once: true });
  window.addEventListener('keydown', markManualScroll, { once: true });
  function forceScrollTopIfUntouched() {
    if (!userScrolledManually) window.scrollTo(0, 0);
  }
  if (document.readyState === 'complete') {
    // Already fully loaded (e.g. this script itself was loaded from cache
    // and ran late) — window's 'load' has already fired, so listening for
    // it below would never call back. Correct right away instead.
    forceScrollTopIfUntouched();
  } else {
    window.addEventListener('load', forceScrollTopIfUntouched);
  }
  // Late-arriving reflows (a chapter photo finishing decode, a web font
  // swapping in) can still nudge the page after 'load' fires. A couple of
  // delayed re-checks catch that without fighting the user's own scrolling.
  [50, 250, 600].forEach(function (delay) {
    setTimeout(forceScrollTopIfUntouched, delay);
  });

  window.doLogout = function () {
    if (window.startAmazonSupabase) window.startAmazonSupabase.auth.signOut();
    clearLocalAccountCache();
    localStorage.removeItem('sa_user');
    localStorage.removeItem('sa_token');
    localStorage.removeItem('sa_display_name');
    window.location.href = 'index.html';
  };

  // ─── Синхронізація прогресу через Supabase ───
  // Email визначає доступ до курсу, а прогрес зберігається за UUID
  // авторизованого користувача. Тому він не прив'язаний до одного браузера.
  var SYNC_KEYS = [
    'sa_read', 'sa_last_chapter', 'sa_bookmarks', 'sa_flashcards',
    'sa_homework', 'sa_homework_answers', 'sa_exam_passed', 'sa_streak', 'sa_theme',
    'sa_tour_seen', 'sa_active_tab', 'sa_overview_tab', 'sa_sidebar_open_mobile',
    'sa_display_name'
  ];

  function isSyncKey(key) {
    return SYNC_KEYS.indexOf(key) !== -1 || String(key).indexOf('hw_marked_') === 0;
  }

  function backendReady() {
    return !!window.startAmazonSupabase;
  }

  function currentUserEmail() {
    var u = loadProgress('sa_user', 'guest');
    return (u && u !== 'guest') ? u : null;
  }

  var pushTimer = null;
  function buildProgressSnapshot() {
    var snapshot = {};
    for (var i = 0; i < localStorage.length; i += 1) {
      var k = localStorage.key(i);
      if (!isSyncKey(k)) continue;
      var v = localStorage.getItem(k);
      if (v !== null) snapshot[k] = v;
    }
    return snapshot;
  }
  function schedulePushProgress(key) {
    if (!backendReady() || !isSyncKey(key)) return;
    var email = currentUserEmail();
    if (!email) return;
    clearTimeout(pushTimer);
    // Дебаунс: чекаємо коротку паузу в діях, щоб не бити по бекенду
    // на кожен клік — за читання розділу типово прилітає кілька
    // saveProgress() підряд (позначка прочитаного + активна вкладка тощо).
    pushTimer = setTimeout(function () { pushProgressNow(email); }, 500);
  }

  function pushProgressNow(email) {
    var snapshot = buildProgressSnapshot();
    return window.startAmazonSupabase.auth.getSession().then(function (result) {
      var session = result && result.data && result.data.session;
      if (!session || !session.user) return;
      return window.startAmazonSupabase.from('course_progress').upsert({
        user_id: session.user.id,
        data: snapshot,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    }).then(function (result) {
      if (result && result.error) throw result.error;
      return true;
    }).catch(function (error) {
      console.warn('Не вдалося синхронізувати прогрес, буде повтор:', error);
      return false;
    });
  }

  // Після першого входу гарантовано створюємо серверний запис навіть якщо
  // користувач ще нічого не натиснув у кабінеті.
  if (user !== 'guest') {
    setTimeout(function () {
      pushProgressNow(user).then(function (saved) {
        if (saved) return;
        setTimeout(function () { pushProgressNow(user); }, 2500);
      });
    }, 2200);
  }

  // Витягує прогрес із сервера і мерджить у localStorage. Викликається:
  // 1) одразу після успішного логіна (перед reload) — щоб на новому
  //    пристрої підтягнувся вже накопичений прогрес;
  // 2) один раз за сесію вкладки при відкритті кабінету — щоб зміни,
  //    зроблені на іншому пристрої, долетіли й сюди.
  function pullProgressFromServer(email, done) {
    if (!backendReady() || !email) { if (done) done(false); return; }
    window.startAmazonSupabase.auth.getSession()
      .then(function (result) {
        var session = result && result.data && result.data.session;
        if (!session || !session.user) return null;
        return window.startAmazonSupabase
          .from('course_progress')
          .select('data')
          .eq('user_id', session.user.id)
          .maybeSingle();
      })
      .then(function (result) {
        var changed = false;
        if (result && result.error) throw result.error;
        var serverData = result && result.data && result.data.data;
        var serverObject = serverData && typeof serverData === 'object'
          ? serverData
          : (typeof serverData === 'string' ? safeJSONParse(serverData, {}) : {});
        if (Object.keys(serverObject).length > 0) {
          Object.keys(serverObject).forEach(function (k) {
              if (!isSyncKey(k)) return;
              if (localStorage.getItem(k) !== serverObject[k]) {
                localStorage.setItem(k, serverObject[k]);
                changed = true;
              }
            });
        } else if (Object.keys(buildProgressSnapshot()).length > 0) {
          // Перший вхід після міграції: зберігаємо локальний прогрес
          // у профілі Supabase, навіть якщо рядок уже існує з data = {}.
          return pushProgressNow(email).then(function () {
            if (done) done(false);
          });
        }
        if (done) done(changed);
      })
      .catch(function () { if (done) done(false); });
  }

  // Якщо користувач одразу оновив або закрив сторінку після кліку, debounce
  // може ще не встигнути відправити дані. Остання спроба також виконується
  // при виході зі сторінки; це не замінює debounce, а страхує його.
  window.addEventListener('pagehide', function () {
    if (user !== 'guest') pushProgressNow(user);
  });

  var toggleBtn = document.querySelector('.sidebar__toggle');
  var openBtn = document.querySelector('.sidebar-open-btn');
  var tip = document.getElementById('global-tooltip');

  function showTip(el, text, e) {
    tip.textContent = text;
    tip.style.opacity = '1';
    var r = el.getBoundingClientRect();
    var th = tip.offsetHeight;
    var left = r.right + 10;
    var top = r.top + r.height / 2 - th / 2;
    if (left + tip.offsetWidth > window.innerWidth - 8) left = r.left - tip.offsetWidth - 10;
    if (top + th > window.innerHeight - 8) top = window.innerHeight - th - 8;
    if (top < 8) top = 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip() { tip.style.opacity = '0'; }

  var supportsHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  function bindTip(btn, text) {
    if (!btn || !tip || !supportsHover) return;
    btn.addEventListener('mouseenter', function (e) { showTip(btn, text, e); });
    btn.addEventListener('mouseleave', hideTip);
  }
  if (toggleBtn && tip && supportsHover) {
    toggleBtn.addEventListener('mouseenter', function (e) { showTip(toggleBtn, 'Закрити бічну панель', e); });
    toggleBtn.addEventListener('mouseleave', hideTip);
  }
  if (openBtn && tip && supportsHover) {
    openBtn.addEventListener('mouseenter', function (e) { showTip(openBtn, 'Відкрити бічну панель', e); });
    openBtn.addEventListener('mouseleave', hideTip);
  }
  document.querySelectorAll('.sidebar__logout, .sidebar__avatar, .sidebar__progress, .sidebar__tool').forEach(function (b) {
    bindTip(b, b.getAttribute('data-tip') || b.getAttribute('title') || '');
  });

  window.showChapter = showChapter;
  window.showOverview = showOverview;

  window.switchOverviewTab = function (id) {
    document.querySelectorAll('.overview-group').forEach(function (g) {
      g.classList.toggle('overview-group--hidden', g.id !== id);
    });
    document.querySelectorAll('.overview-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.target === id);
    });
    saveProgress('sa_overview_tab', id);
  };

  var savedOverviewTab = loadProgress('sa_overview_tab', 'overviewChapters');
  if (savedOverviewTab !== 'overviewChapters') {
    window.switchOverviewTab(savedOverviewTab);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    saveProgress('sa_theme', theme);
    var btn = document.getElementById('themeToggle');
    if (btn) {
      btn.setAttribute('aria-label', theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему');
      btn.setAttribute('title', theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему');
    }
  }
  window.toggleTheme = function () {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };
  applyTheme(loadProgress('sa_theme', 'dark') || 'dark');

  function getChapterOrder() {
    return chapterOrder.slice();
  }
  function firstUnreadChapter() {
    var order = getChapterOrder();
    for (var i = 0; i < order.length; i++) {
      if (!isRead(order[i])) return order[i];
    }
    return null;
  }
  function updateContinueReadingBtn() {
    var btn = document.getElementById('continueReadingBtn');
    var nameEl = document.getElementById('continueReadingName');
    if (!btn) return;
    // Нема чого "продовжувати", якщо ще жоден розділ не позначено
    // прочитаним — інакше кнопка з'являється одразу на порожньому
    // акаунті й показує перший розділ курсу, хоча читання ще не почалось.
    if (!readChapters.length) {
      btn.style.display = 'none';
      return;
    }
    var target = firstUnreadChapter();
    if (!target || target === currentChapter) {
      btn.style.display = 'none';
      return;
    }
    nameEl.textContent = chapterNames[target] || target;
    btn.setAttribute('data-target', target);
    btn.style.display = 'flex';
  }
  window.continueReading = function () {
    var btn = document.getElementById('continueReadingBtn');
    var target = btn && btn.getAttribute('data-target');
    if (target) {
      history.replaceState(null, '', '#' + target);
      showChapter(target);
    }
  };

  function saveBookmarks() {
    saveProgress('sa_bookmarks', bookmarks);
    updateBookmarksUI();
  }

  function isBookmarked(chapterId, pIndex) {
    return bookmarks.some(function (b) { return b.chapter === chapterId && b.pIndex === pIndex; });
  }

  function addBookmark(chapterId, pIndex, text) {
    if (isBookmarked(chapterId, pIndex)) return;
    bookmarks.push({
      chapter: chapterId,
      pIndex: pIndex,
      text: text.slice(0, 140),
      chapterName: chapterNames[chapterId] || chapterId
    });
    saveBookmarks();
  }

  function removeBookmark(chapterId, pIndex) {
    bookmarks = bookmarks.filter(function (b) { return !(b.chapter === chapterId && b.pIndex === pIndex); });
    saveBookmarks();
  }

  function initBookmarkPins() {
    var chapterEl = document.getElementById(currentChapter);
    if (!chapterEl) return;
    var paragraphs = chapterEl.querySelectorAll('.chapter-body > p');
    paragraphs.forEach(function (p, idx) {
      if (p.querySelector('.bookmark-pin')) return;
      var pin = document.createElement('button');
      pin.className = 'bookmark-pin';
      pin.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
      pin.title = 'Додати закладку';
      if (isBookmarked(currentChapter, idx)) pin.classList.add('bookmark-pin--active');
      pin.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isBookmarked(currentChapter, idx)) {
          removeBookmark(currentChapter, idx);
          pin.classList.remove('bookmark-pin--active');
        } else {
          addBookmark(currentChapter, idx, p.textContent.trim());
          pin.classList.add('bookmark-pin--active');
        }
      });
      p.style.position = 'relative';
      p.appendChild(pin);
    });
  }

  function updateBookmarksUI() {
    var countEl = document.getElementById('bookmarksCount');
    var linkEl = document.getElementById('bookmarksLink');
    if (countEl) countEl.textContent = bookmarks.length;
    if (linkEl) linkEl.style.display = bookmarks.length ? 'flex' : 'none';

    var listEl = document.getElementById('bookmarksList');
    var emptyEl = document.getElementById('bookmarksEmpty');
    if (!listEl) return;
    if (bookmarks.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'flex';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    bookmarks.forEach(function (b, i) {
      var card = document.createElement('div');
      card.className = 'bookmark-card';

      var meta = document.createElement('div');
      meta.className = 'bookmark-card__meta';
      meta.textContent = b.chapterName;
      card.appendChild(meta);

      var text = document.createElement('div');
      text.className = 'bookmark-card__text';
      text.textContent = b.text + (b.text.length >= 140 ? '…' : '');
      card.appendChild(text);

      var actions = document.createElement('div');
      actions.className = 'bookmark-card__actions';

      var goBtn = document.createElement('button');
      goBtn.className = 'bookmark-card__go';
      goBtn.textContent = 'Перейти →';
      goBtn.addEventListener('click', function () { window.goToBookmark(b.chapter, b.pIndex); });
      actions.appendChild(goBtn);

      var delBtn = document.createElement('button');
      delBtn.className = 'bookmark-card__remove';
      delBtn.textContent = 'Видалити';
      delBtn.addEventListener('click', function () { window.removeBookmarkAt(i); });
      actions.appendChild(delBtn);

      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  window.goToBookmark = function (chapterId, pIndex) {
    closeBookmarksPanel();
    history.replaceState(null, '', '#' + chapterId);
    showChapter(chapterId);
    setTimeout(function () {
      var chapterEl = document.getElementById(chapterId);
      var p = chapterEl && chapterEl.querySelectorAll('.chapter-body > p')[pIndex];
      if (p) {
        p.scrollIntoView({ block: 'center', behavior: 'smooth' });
        p.classList.add('bookmark-highlight');
        setTimeout(function () { p.classList.remove('bookmark-highlight'); }, 1600);
      }
    }, 150);
  };

  window.removeBookmarkAt = function (i) {
    var b = bookmarks[i];
    if (b) removeBookmark(b.chapter, b.pIndex);
    initBookmarkPins();
  };

  window.showBookmarksPanel = function () {
    document.getElementById('overviewCards').style.display = 'none';
    chapters.forEach(function (c) { c.style.display = 'none'; });
    document.getElementById('bookmarksPanel').style.display = 'block';
    updateBookmarksUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.closeBookmarksPanel = function () {
    var panel = document.getElementById('bookmarksPanel');
    if (panel) panel.style.display = 'none';
  };

  updateBookmarksUI();

  function estimateReadMinutes(bodyEl) {
    var words = (bodyEl.textContent.match(/[^\s]+/g) || []).length;
    return Math.max(1, Math.round(words / 200));
  }

  function initChapterMeta(id) {
    if (id === 'final_exam') return;
    var articleEl = document.getElementById(id);
    if (!articleEl) return;
    var bodyEl = articleEl.querySelector('.chapter-body');
    if (!bodyEl) return;
    var minutes = estimateReadMinutes(bodyEl);

    var meta = articleEl.querySelector('.chapter-meta');
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'chapter-meta';
      meta.innerHTML =
        '<span class="chapter-meta__item chapter-meta__time">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>' +
        '<span></span>' +
        '</span>';
      var heroFigure = articleEl.querySelector('.origin-hero__figure');
      var byline = articleEl.querySelector('.origin-byline');
      var anchor = articleEl.querySelector('.chapter-head');
      if (heroFigure) {
        meta.classList.add('chapter-meta--inline');
        heroFigure.appendChild(meta);
      } else if (byline) {
        meta.classList.add('chapter-meta--inline');
        byline.appendChild(meta);
      } else if (anchor) {
        anchor.insertAdjacentElement('afterend', meta);
      } else {
        bodyEl.parentNode.insertBefore(meta, bodyEl);
      }
    }
    meta.querySelector('.chapter-meta__time span').textContent = minutes + ' хв читання';
  }

  function getChapterOutcomes(id) {
    var articleEl = document.getElementById(id);
    if (!articleEl) return [];
    var items = articleEl.querySelectorAll('.box--after li');
    var list = [];
    items.forEach(function (li) { list.push(li.textContent.trim()); });
    return list;
  }

  window.showCompletionScreen = function (id) {
    var overlay = document.getElementById('completionOverlay');
    if (!overlay) return;
    document.getElementById('completionChapterName').textContent = chapterNames[id] || id;
    var outcomes = getChapterOutcomes(id);
    var listEl = document.getElementById('completionList');
    if (outcomes.length) {
      listEl.innerHTML = '';
      outcomes.forEach(function (o) {
        var div = document.createElement('div');
        div.className = 'completion-card__item';
        var check = document.createElement('span');
        check.className = 'completion-card__check';
        check.textContent = '✓';
        div.appendChild(check);
        div.appendChild(document.createTextNode(o));
        listEl.appendChild(div);
      });
      listEl.style.display = 'flex';
    } else {
      listEl.style.display = 'none';
    }
    var done = readChapters.length;
    var total = getChapterOrder().length;
    var remaining = total - done;
    document.getElementById('completionProgressCount').textContent = done + ' / ' + total;
    document.getElementById('completionProgressFill').style.width = (done / total * 100) + '%';
    document.getElementById('completionRemaining').textContent =
      remaining > 0 ? 'Залишилось ' + remaining + ' ' + (remaining === 1 ? 'розділ' : 'розділів') + ' до кінця курсу' : 'Курс повністю пройдено 🎉';
    var idx = getChapterOrder().indexOf(id);
    var nextId = idx >= 0 && idx < getChapterOrder().length - 1 ? getChapterOrder()[idx + 1] : null;
    var nextBtn = document.getElementById('completionNextBtn');
    if (nextId) {
      nextBtn.style.display = 'block';
      nextBtn.setAttribute('data-next', nextId);
      nextBtn.textContent = (chapterNames[nextId] || nextId).replace(/^[^\s]+\s/, '') + ' →';
    } else {
      nextBtn.style.display = 'none';
    }
    overlay.classList.add('active');
  };

  window.closeCompletionScreen = function () {
    var overlay = document.getElementById('completionOverlay');
    if (overlay) overlay.classList.remove('active');
  };

  window.goToNextFromCompletion = function () {
    var nextBtn = document.getElementById('completionNextBtn');
    var nextId = nextBtn && nextBtn.getAttribute('data-next');
    closeCompletionScreen();
    if (nextId) {
      history.replaceState(null, '', '#' + nextId);
      showChapter(nextId);
    }
  };

  window.calcProfit = function () {
    var priceInput = document.getElementById('pc_price');
    var cogsInput = document.getElementById('pc_cogs');
    var shipInput = document.getElementById('pc_ship');
    var referralInput = document.getElementById('pc_referral');
    var fbaInput = document.getElementById('pc_fba');
    var ppcInput = document.getElementById('pc_ppc');
    if (!priceInput || !cogsInput || !shipInput || !referralInput || !fbaInput || !ppcInput) return;
    var price = parseFloat(priceInput.value) || 0;
    var cogs = parseFloat(cogsInput.value) || 0;
    var ship = parseFloat(shipInput.value) || 0;
    var referralPct = parseFloat(referralInput.value) || 0;
    var fba = parseFloat(fbaInput.value) || 0;
    var ppc = parseFloat(ppcInput.value) || 0;
    var referralFee = price * (referralPct / 100);
    var totalCost = cogs + ship + referralFee + fba + ppc;
    var profit = price - totalCost;
    var margin = price > 0 ? (profit / price * 100) : 0;
    var investedCost = cogs + ship;
    var roi = investedCost > 0 ? (profit / investedCost * 100) : 0;
    var profitEl = document.getElementById('pc_profit');
    var marginEl = document.getElementById('pc_margin');
    var roiEl = document.getElementById('pc_roi');
    var verdictEl = document.getElementById('pc_verdict');
    if (!profitEl || !marginEl || !roiEl || !verdictEl) return;
    profitEl.textContent = '$' + profit.toFixed(2);
    marginEl.textContent = margin.toFixed(1) + '%';
    roiEl.textContent = roi.toFixed(0) + '%';
    [profitEl, marginEl].forEach(function (el) {
      el.classList.remove('profit-calc__result-value--bad', 'profit-calc__result-value--ok', 'profit-calc__result-value--good');
    });
    var cls = margin < 15 ? 'bad' : (margin < 25 ? 'ok' : 'good');
    profitEl.classList.add('profit-calc__result-value--' + cls);
    marginEl.classList.add('profit-calc__result-value--' + cls);
    if (margin < 0) {
      verdictEl.textContent = '⚠ Збиток. При такій ціні й витратах ти втрачаєш гроші з кожного продажу.';
      verdictEl.className = 'profit-calc__verdict profit-calc__verdict--bad';
    } else if (margin < 15) {
      verdictEl.textContent = '⚠ Маржа дуже низька. Будь-яке підвищення реклами чи комісій — і ти в мінусі. Підніми ціну або знайди дешевшого постачальника.';
      verdictEl.className = 'profit-calc__verdict profit-calc__verdict--bad';
    } else if (margin < 25) {
      verdictEl.textContent = 'Маржа прийнятна, але без запасу. Рекомендована ціль курсу — 25%+.';
      verdictEl.className = 'profit-calc__verdict profit-calc__verdict--ok';
    } else {
      verdictEl.textContent = '✓ Хороша маржа. Є запас на коливання реклами і комісій.';
      verdictEl.className = 'profit-calc__verdict profit-calc__verdict--good';
    }
  };

  var homeworkPassed = loadProgress('sa_homework', {});

  // ─── FBA fee-калькулятор (приблизна оцінка) ───
  window.calcFbaFee = function () {
    var get = function (id) { return parseFloat(document.getElementById(id).value) || 0; };
    var weight = get('fb_weight');
    var l = get('fb_length'), w = get('fb_width'), h = get('fb_height');
    var feeEl = document.getElementById('fb_fee');
    var sizeEl = document.getElementById('fb_size');
    var verdictEl = document.getElementById('fb_verdict');
    if (!feeEl || !sizeEl || !verdictEl) return;

    var dimWt = l * w * h / 139;
    var billable = Math.max(weight, dimWt);
    var maxSide = Math.max(l, w, h);

    var tier = 'Стандарт';
    var oversized = false;
    if (maxSide > 18 || l > 18 && w > 14 && h > 8 || billable > 50) {
      tier = 'Великогабарит';
      oversized = true;
    }

    var fee;
    if (!oversized) {
      var tiers = [
        { max: 0.5, f: 4.71 }, { max: 1, f: 5.02 }, { max: 2, f: 5.78 },
        { max: 3, f: 6.46 }, { max: 4, f: 7.14 }, { max: 5, f: 7.82 },
        { max: 6, f: 8.50 }, { max: 7, f: 9.18 }, { max: 8, f: 9.86 },
        { max: 9, f: 10.54 }, { max: 10, f: 11.22 }, { max: 11, f: 11.90 },
        { max: 12, f: 12.58 }, { max: 13, f: 13.26 }, { max: 14, f: 13.94 },
        { max: 15, f: 14.62 }, { max: 16, f: 15.30 }, { max: 18, f: 16.50 }
      ];
      fee = 16.50;
      for (var i = 0; i < tiers.length; i++) {
        if (billable <= tiers[i].max) { fee = tiers[i].f; break; }
      }
    } else {
      var base = Math.max(9.75, billable * 0.55);
      fee = base + 2.20;
    }

    feeEl.textContent = '$' + fee.toFixed(2);
    sizeEl.textContent = tier;
    [feeEl, sizeEl].forEach(function (el) {
      el.classList.remove('fba-calc__result-value--good', 'fba-calc__result-value--ok', 'fba-calc__result-value--bad');
    });

    var msg, cls;
    if (weight === 0 && l === 0 && w === 0 && h === 0) {
      msg = 'Введи вагу й габарити упаковки, щоб оцінити комісію.';
      cls = 'fba-calc__verdict--info';
      feeEl.classList.add('fba-calc__result-value--ok');
    } else if (oversized) {
      msg = 'Великогабаритний товар: комісія значно вища. Якщо можливо — перепакуй у компактнішу коробку.';
      cls = 'fba-calc__verdict--bad';
      feeEl.classList.add('fba-calc__result-value--bad');
    } else if (fee < 7) {
      msg = 'Компактний товар — фулфілмент дешевий. Хороший кандидат для FBA.';
      cls = 'fba-calc__verdict--good';
      feeEl.classList.add('fba-calc__result-value--good');
    } else if (fee < 12) {
      msg = 'Середня комісія. Стеж, щоб маржа покривала її разом із рекламою.';
      cls = 'fba-calc__verdict--ok';
      feeEl.classList.add('fba-calc__result-value--ok');
    } else {
      msg = 'Комісія висока. Перевір, чи лишається маржа після всіх витрат (див. калькулятор вище).';
      cls = 'fba-calc__verdict--bad';
      feeEl.classList.add('fba-calc__result-value--bad');
    }
    verdictEl.textContent = msg;
    verdictEl.className = 'fba-calc__verdict ' + cls;
  };

  // ─── Flash-картки (spaced repetition) ───
  var flashDeck = [
    { q: 'Скільки розділів в основному курсі і що потрібно для сертифіката?', a: '18 розділів + передмова + фінальний іспит. Сертифікат — після проходження всіх розділів і складання іспиту (28+ правильних із 42).' },
    { q: 'Мінімальна цільова маржа для старту на Amazon?', a: 'Мінімум 25%, оптимально 30%+. Формула: (Ціна − витрати) / Ціна × 100%.' },
    { q: 'Що входить до витрат юніт-економіки?', a: 'COGS (собівартість) + доставка до Amazon + Referral Fee (≈15%) + FBA Fulfillment + Storage + PPC реклама.' },
    { q: 'Що таке Referral Fee?', a: 'Комісія Amazon за продаж, зазвичай 15% від ціни. Відрізняється за категорією товару.' },
    { q: 'Що таке ACoS?', a: 'Advertising Cost of Sale — відношення витрат на рекламу до доходу з рекламних продажів: Витрати на рекламу ÷ Рекламний дохід × 100%.' },
    { q: 'Що таке TACoS і чим він кращий за ACoS?', a: 'TACoS = Витрати на рекламу ÷ Весь дохід × 100%. Показує здоров’я бізнесу в цілому, враховуючи й органіку, на відміну від ACoS.' },
    { q: 'Скільки тижнів потрібно товару до Prime Day/події, щоб бути на FBA?', a: 'Мінімум 6 тижнів до події. Товар має бути відправлений заздалегідь, бо приймання займає час.' },
    { q: 'До якої дати Q4-партія має бути на складі FBA?', a: 'До 1 жовтня. Критично для сезону Q4, бо Storage Fee зростає втричі пізньої осені.' },
    { q: 'Який товар обирати на старті (критерії)?', a: 'Невеликий і легкий (дешевий FBA), ціна $25–$45, без крихких матеріалів, не сезонний, з попитом але без жорсткої конкуренції.' },
    { q: 'Що таке Buy Box і як його виграти?', a: 'Кнопка «Add to Cart». Виграєш: конкурентною ціною, швидкою доставкою (FBA), хорошим метриками відгуків і лістингу.' },
    { q: 'Чому FBA переважний для новачка?', a: 'Amazon сам складує, пакує і доставляє, бере на себе службу підтримки клієнтів — це сильно підвищує шанси на Buy Box і довіру.' },
    { q: 'Що таке PPC і як працює на старті?', a: 'Платна реклама всередині Amazon (Sponsored Products). На старті — тестування ключових слів і збір даних, до мінімуму.' },
    { q: 'Що таке A-to-Z і як уникнути?', a: 'Гарантія Amazon для покупця. Виникає при проблемах із замовленням. Уникнути: якісний товар, швидка доставка, вчасна відповідь покупцям.' },
    { q: 'Як підвищити конверсію лістингу?', a: 'Фото: hero 970×600 lifestyle + bullets «вигода в капслок + деталь», порівняльна таблиця, A+ Content, соціальний доказ.' },
    { q: 'Що показує метрика «Return Rate» і яка норма?', a: 'Відсоток повернень. Якщо він вищий за середнє по категорії — проблема в товарі або очікуваннях з лістингу.' },
    { q: 'Як захистити акаунт від блокування?', a: 'Не порушувати правила лістингу, не мати кілька акаунтів без дозволу, стежити за метриками здоров’я акаунту, відповідати на повідомлення вчасно.' },
    { q: 'Що таке Storage Fee і коли вона зростає?', a: 'Плата за зберігання на FBA-складі. У жовтні–грудні (Q4) зростає приблизно втричі.' },
    { q: 'Скільки відгуків потрібно для конкурентного лістингу?', a: '50+ реальних відгуків — мінімум для довіри. Не купувати фейкові — бан акаунту.' },
    { q: 'Що робити, якщо постачальник зник/прийшов брак?', a: 'Контракт із чіткими умовами, оплата частинами, альтернативний постачальник у резерві, перевірка товару (QC) перед відправкою.' },
    { q: 'Коли найкращий час для запуску нового товару?', a: 'За 2–3 місяці до піку сезону, щоб назбирати відгуки й позиції до хай-сезону.' },
    { q: 'Що таке «стратегія фокусу» на 1 товар?', a: 'Спочатку один товар: вивчити все на ньому, налаштувати PPC, лістинг, поставки — і лише потім масштабуватись.' },
    { q: 'Який бюджет потрібен на старт?', a: 'Мінімум ~$2,700 (розрахунок у Розділі 1), комфортно $4,000–$6,000 — на першу партію, доставку, рекламу і резерв.' },
    { q: 'Що таке «оформлення лістингу» з точки зору SEO Amazon?', a: 'Заголовок із ключовими словами + бекенд-слова, bullets із вигодами, фото, брендовий сторі — щоб Amazon розумів, що це за товар.' },
    { q: 'Чому не можна ставити ціну значно нижче ринку?', a: 'Amazon може розцінити як маніпуляцію/демпінг, падає маржа, а у Buy Box можуть виграти інші. Оптимально — конкурентна ціна з маржею 25%+.' },
    { q: 'Чому не можна реєструвати акаунт через VPN?', a: 'Amazon бачить невідповідність IP і геолокації документів і блокує акаунт миттєво. Реєструйся з чистого браузера, свого IP і реальних даних.' },
    { q: 'Як пройти відеоверифікацію з першого разу?', a: 'Оригінал паспорта в руках, без фільтрів і окулярів, добре світло, тихе приміщення. Відповідай коротко і тільки те, про що питають. Це не іспит — 10–15 хвилин.' },
    { q: 'Individual чи Professional акаунт на старті?', a: 'Professional ($39.99/міс) з першого дня. Без нього немає доступу до PPC, Buy Box і рекламних інструментів — економія $40 коштує дорожче.' },
    { q: 'Що таке PROFIT-5?', a: '5 фільтрів перед будь-яким замовленням товару: попит стабільний, конкуренція підйомна, ціна $25–45, маржа 25%+, товар не крихкий/не регульований жорстко.' },
    { q: 'Що таке Trade Assurance і чому це важливо?', a: 'Захист платежів на Alibaba: гроші йдуть на escrow-рахунок платформи, а не напряму постачальнику. Якщо товар не відповідає умовам — є підстави для спору.' },
    { q: 'Навіщо замовляти зразки перед партією?', a: 'Перевірити якість матеріалів, швів, упаковки своїми руками. Зразок за $30–70 економить тисячі на партії браку. Завжди перед першим PO.' },
    { q: 'Авіа чи море для першої партії?', a: 'Перша партія — авіа або залізницею: швидкість тесту гіпотези важливіша за ціну. Море — з другої партії, коли продукт уже підтверджений продажами.' },
    { q: 'Що таке FNSKU?', a: 'Унікальний штрихкод Amazon на кожну одиницю твого товару. Він пов\'язує одиницю саме з твоїм лістингом — відрізняється від UPC виробника.' },
    { q: 'Найдорожча помилка в Shipment Plan?', a: 'Неправильний вибір складу призначення або кількості в коробках: Amazon розподіляє партію між складами США — помилка в плані = подвійна логістика і тижні затримки.' },
    { q: 'Що таке LISTING DNA?', a: 'Логічна структура лістингу: хто купує → яку проблему вирішує → чому твій товар. Заголовок, фото, булети і A+ мають розповідати одну і ту саму історію.' },
    { q: 'Куди писати backend keywords?', a: 'У приховане поле Search Terms у Seller Central. Туди — варіанти написання, синоніми, слова без наголосів. Не повторюй те, що вже в заголовку.' },
    { q: 'Вимоги до головного фото лістингу?', a: 'Білий фон RGB 255,255,255, товар займає ≥85% кадру, без логотипів, водяних знаків і додаткових предметів. 2000px по довжині — для zoom.' },
    { q: 'Що дає Brand Registry?', a: 'Доступ до A+ Content, Storefront, Sponsored Brands, Brand Analytics і захисту від hijackers. Потрібен зареєстрований або pending товарний знак.' },
    { q: 'Скільки часу і грошей займає товарний знак для Brand Registry?', a: 'Подача через USPTO ~$250–350 за клас, розгляд 8–14 місяців. Статус «Pending» уже дає право подати заявку в Brand Registry.' },
    { q: 'Хто такий hijacker і перша дія проти нього?', a: 'Продавець, який прикріпився до твого лістинга. Перша дія — test buy його одиницю, потім complaint у Seller Support із доказами відмінності товару.' },
    { q: 'Структура Plan of Action (POA)?', a: 'Три частини: 1) Корінна причина проблеми. 2) Що ти вже виправив негайно. 3) Системні заходи, щоб це не повторилось. Коротко, фактами, без емоцій.' },
    { q: 'Формула точки беззбитковості (break-even)?', a: 'Постійні витрати ÷ Маржа з одиниці = кількість продажів для нуля. Все після цієї цифри — прибуток, все до — інвестиція.' },
    { q: 'Що таке reorder point і як його рахувати?', a: 'Рівень запасу, за якого треба замовляти наступну партію: середні продажі на день × час циклу (виробництво + доставка + приймання) + страховий запас.' },
    { q: 'Чому cash flow важливіший за прибуток?', a: 'Прибуток на папері може співіснувати з порожнім рахунком: гроші заморожені в товарі на 3–4 місяці вперед. Без оборотки бізнес вмирає навіть із маржею 30%.' },
    { q: 'Що таке W-8BEN і кому потрібен?', a: 'Форма для нерезидента США в Seller Central: підтверджує, що власник не платник американських податків. Без неї Amazon утримує 30% з виплат.' },
    { q: 'Що таке FBAR і хто зобов\'язаний подати?', a: 'Звіт US persons про закордонні рахунки понад $10,000 сумарно. Подача — в FinCEN (США). Нерезидент-власник US LLC зазвичай НЕ подає FBAR: Mercury — рахунок США, а ти не US person.' },
    { q: 'Який головний річний звіт для нерезидента — власника US LLC?', a: 'Form 5472 + pro-forma 1120 в IRS до 15 квітня: декларація операцій між LLC і власником-нерезидентом. Штраф за неподання — від $25,000.' },
    { q: 'Що таке PPC TRIANGLE?', a: 'Три взаємопов\'язані важелі кампанії: bids (ставки), бюджет, таргетинг (ключові слова). Покращуєш одне — контролюй два інші.' },
    { q: 'Навіщо negative keywords у PPC?', a: 'Виключають сміттєві запити, на які показується реклама. Без них бюджет згорає на кліки без купівельної можливості. Поповнюється зі Search Term Report щотижня.' },
    { q: 'Що таке Search Term Report і «ритуал» з ним?', a: 'Щотижневий звіт: які запити дали кліки і продажі. Ритуал: конвертуючі → в exact-кампанію, сміття → в negative, неоднозначні → спостереження.' },
    { q: 'Request a Review — легальний спосіб відгуку?', a: 'Так: офіційна кнопка в Seller Central, один запит на замовлення, автоматичне повідомлення від Amazon. Єдиний масовий спосіб без ризику блокування.' }
  ];

  // The deck keeps the original 50-card count, but uses one clear idea per card.
  flashDeck = [
    { q: 'Що таке Amazon FBA?', a: 'Amazon зберігає, пакує та відправляє товар клієнту замість продавця. Дія: порівняй FBA з FBM для свого товару.' },
    { q: 'Що таке FBM?', a: 'Продавець сам зберігає, пакує та відправляє замовлення. Дія: врахуй свій час, склад і доставку в розрахунку.' },
    { q: 'З чого почати запуск?', a: 'З перевірки товару, цифр і ризиків, а не з покупки партії. Дія: пройди фільтри PROFIT-5.' },
    { q: 'Що таке ніша?', a: 'Група товарів і покупців із конкретною потребою. Дія: опиши, хто купує і яку проблему вирішує товар.' },
    { q: 'Навіщо досліджувати попит?', a: 'Щоб не купити товар, який ніхто не шукає. Дія: перевір продажі конкурентів і динаміку попиту.' },
    { q: 'Що таке конкуренція?', a: 'Кількість і сила продавців, з якими доведеться боротися за покупця. Дія: оцінюй не лише кількість відгуків, а й якість лістингів.' },
    { q: 'Який товар простіше тестувати?', a: 'Невеликий, легкий, не крихкий і без складних обмежень. Дія: перевір правила категорії до пошуку постачальника.' },
    { q: 'Навіщо дивитися сезонність?', a: 'Попит може сильно змінюватися протягом року. Дія: не плануй першу партію лише за даними одного місяця.' },
    { q: 'Що таке PROFIT-5?', a: 'П’ять перевірок: попит, конкуренція, ціна, маржа та ризики товару. Дія: не замовляй товар, поки всі п’ять не зрозумілі.' },
    { q: 'Коли не варто брати товар?', a: 'Коли цифри тримаються на припущеннях або товар має незрозумілі ризики. Дія: відклади ідею, якщо не можеш підтвердити дані.' },
    { q: 'Що входить у собівартість?', a: 'Ціна товару, упаковка, перевірка якості та підготовка. Дія: попроси постачальника розписати всі складові ціни.' },
    { q: 'Які витрати додає доставка?', a: 'Доставка до складу, митні та сервісні витрати, якщо вони є. Дія: рахуй доставку на одну одиницю, а не лише за всю партію.' },
    { q: 'Що таке Referral Fee?', a: 'Комісія Amazon за продаж товару. Її розмір залежить від категорії та умов акаунта.' },
    { q: 'Що таке FBA Fulfillment Fee?', a: 'Плата за обробку, пакування та доставку одиниці зі складу Amazon. Дія: перевір її в калькуляторі до замовлення.' },
    { q: 'Що таке Storage Fee?', a: 'Плата за зберігання товару на складі Amazon. Дія: не завозь більше товару, ніж можеш продати в розумний строк.' },
    { q: 'Що таке маржа?', a: 'Частка прибутку в ціні після витрат. Формула: прибуток ÷ ціна × 100%.' },
    { q: 'Чому важлива юніт-економіка?', a: 'Вона показує, скільки залишається з кожної проданої одиниці. Дія: рахуй одну одиницю до запуску реклами.' },
    { q: 'Що таке break-even?', a: 'Точка, де дохід покриває витрати, але прибутку ще немає. Дія: порахуй, скільки одиниць треба продати до виходу в плюс.' },
    { q: 'Чому прибуток не дорівнює грошам на рахунку?', a: 'Гроші можуть бути заморожені в товарі, доставці або рекламі. Дія: веди окремо прибуток і cash flow.' },
    { q: 'Який запас грошей потрібен?', a: 'Резерв на рекламу, повторне замовлення, повернення та непередбачені витрати. Дія: не витрачай весь бюджет на першу партію.' },
    { q: 'Навіщо замовляти зразок?', a: 'Щоб перевірити якість до покупки великої партії. Дія: склади список перевірок і зафіксуй результат.' },
    { q: 'Що перевірити у постачальника?', a: 'Досвід, документи, умови виробництва, терміни та відгуки. Дія: порівняй щонайменше трьох постачальників.' },
    { q: 'Що таке Trade Assurance?', a: 'Сервіс захисту замовлення на Alibaba за погодженими умовами. Дія: не покладайся лише на листування — фіксуй умови в замовленні.' },
    { q: 'Чому важливий контроль якості?', a: 'Він допомагає знайти брак до відправки, а не після доставки клієнту. Дія: погодь критерії приймання заздалегідь.' },
    { q: 'Що має бути в домовленості з постачальником?', a: 'Специфікація, кількість, ціна, упаковка, терміни та правила браку. Дія: запиши все в одному документі.' },
    { q: 'Що таке лістинг?', a: 'Сторінка товару на Amazon: заголовок, фото, опис, bullets і характеристики.' },
    { q: 'Що має зробити головне фото?', a: 'За секунду показати, що це за товар. Дія: використовуй чистий білий фон і сам товар без зайвих елементів.' },
    { q: 'Для чого потрібні додаткові фото?', a: 'Вони показують розмір, деталі, використання та переваги. Дія: кожне фото має відповідати на окреме питання покупця.' },
    { q: 'Як писати bullets?', a: 'Спочатку вигода для покупця, потім коротке підтвердження. Дія: заміни загальні слова конкретним результатом або характеристикою.' },
    { q: 'Що таке ключові слова?', a: 'Фрази, якими покупці шукають товар. Дія: використовуй їх природно в заголовку, bullets і пошукових полях.' },
    { q: 'Що таке backend keywords?', a: 'Приховані пошукові слова для Amazon. Дія: додавай синоніми й варіанти написання, не дублюючи весь заголовок.' },
    { q: 'Що таке A+ Content?', a: 'Розширений блок із зображеннями та поясненнями бренду й товару. Дія: використовуй його для порівняння та відповідей на заперечення.' },
    { q: 'Що таке конверсія?', a: 'Частка відвідувачів лістингу, які купили товар. Дія: покращуй фото, цінність пропозиції та довіру.' },
    { q: 'Навіщо аналізувати відгуки конкурентів?', a: 'У них видно, що покупцям подобається і що їх дратує. Дія: перетвори повторювані скарги на переваги свого товару.' },
    { q: 'Що таке PPC?', a: 'Реклама товару всередині Amazon із оплатою за клік. Дія: починай із тесту ключових слів і невеликого контрольованого бюджету.' },
    { q: 'Що таке ACoS?', a: 'Витрати на рекламу ÷ рекламний дохід × 100%. Дія: оцінюй ACoS разом із прибутком, а не окремо.' },
    { q: 'Що таке TACoS?', a: 'Витрати на рекламу ÷ весь дохід × 100%. Він показує, яку частину загальних продажів коштує реклама.' },
    { q: 'Навіщо negative keywords?', a: 'Вони зупиняють покази за нерелевантними запитами. Дія: регулярно переглядай пошукові запити та прибирай марні кліки.' },
    { q: 'Що таке Buy Box?', a: 'Основна кнопка покупки на сторінці товару. На неї впливають ціна, доставка, залишки та якість роботи продавця.' },
    { q: 'Що таке FNSKU?', a: 'Штрихкод Amazon, який прив’язує одиницю товару до конкретного продавця та лістингу.' },
    { q: 'Що робити перед відправкою партії?', a: 'Перевірити товар, упаковку, маркування, кількість і план поставки. Дія: пройди чек-лист, а не покладайся на пам’ять.' },
    { q: 'Що таке reorder point?', a: 'Момент, коли треба замовляти наступну партію, щоб не залишитися без запасу. Дія: врахуй продажі, виробництво, доставку та приймання.' },
    { q: 'Як не втратити контроль над акаунтом?', a: 'Використовуй реальні дані, дотримуйся правил і стеж за повідомленнями Amazon. Дія: не ігноруй попередження та метрики акаунта.' },
    { q: 'Навіщо потрібні документи на товар?', a: 'Деякі категорії потребують підтверджень безпеки, якості або права продажу. Дія: перевір вимоги до закупівлі.' },
    { q: 'Що робити з поверненнями?', a: 'Визначити причину та знайти повторювану проблему. Дія: порівнюй причини повернень із текстом лістингу й якістю товару.' },
    { q: 'Коли масштабувати товар?', a: 'Коли є підтверджений попит, зрозуміла маржа та стабільна операційна система. Дія: спочатку стабілізуй один товар.' },
    { q: 'Що робити після першого продажу?', a: 'Перевірити економіку, рекламу, відгуки та залишки. Дія: запиши висновки й онови план наступного тижня.' },
    { q: 'Яка головна помилка новачка?', a: 'Купити товар на емоціях без перевірки цифр. Дія: приймай рішення лише після розрахунку та перевірки ризиків.' },
    { q: 'Як зрозуміти, що товар готовий до запуску?', a: 'Є перевірений попит, порахована маржа, зразок, постачальник і план поставки. Дія: познач кожен пункт у чек-листі.' },
    { q: 'Який наступний крок після цієї картки?', a: 'Повернися до розділу, де тема пояснюється детальніше. Flash-картка нагадує головне, але не замінює урок.' }
  ];

  var flashState = loadProgress('sa_flashcards', {});
  if (flashState.deckVersion !== 2) {
    flashState = { cards: {}, reviewed: {}, deckVersion: 2 };
    saveProgress('sa_flashcards', flashState);
  }
  if (!flashState.cards) flashState.cards = {};
  if (!flashState.reviewed) flashState.reviewed = {};
  var flashIndex = 0;
  var flashDue = [];
  var flashFlipShown = false;

  function flashToday() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function flashDueList() {
    var today = flashToday();
    var list = [];
    for (var i = 0; i < flashDeck.length; i++) {
      var st = flashState.cards[i];
      if (!st || (st.due && st.due <= today)) list.push(i);
    }
    return list;
  }
  window.openFlashPanel = function () {
    var ov = document.getElementById('flashOverlay');
    if (!ov) return;
    document.body.classList.add('flash-panel-open');
    flashDue = flashDueList();
    if (flashDue.length === 0) {
      ov.classList.add('active');
      document.getElementById('flashDeck').style.display = 'none';
      document.getElementById('flashEmpty').style.display = 'block';
      document.getElementById('flashLeft').textContent = '0';
      document.getElementById('flashDone').textContent = Object.keys(flashState.reviewed).length;
      document.getElementById('flashSub').textContent = 'Сьогодні все повторено. Повернись завтра!';
      return;
    }
    flashIndex = 0;
    flashFlipShown = false;
    document.getElementById('flashEmpty').style.display = 'none';
    document.getElementById('flashDeck').style.display = 'block';
    document.getElementById('flashSub').textContent = 'Метод інтервального повторення: картки повертаються через 1/3/7 днів';
    ov.classList.add('active');
    flashShow();
  };
  window.closeFlashPanel = function () {
    var ov = document.getElementById('flashOverlay');
    if (ov) ov.classList.remove('active');
    document.body.classList.remove('flash-panel-open');
  };
  function flashShow() {
    var idx = flashDue[flashIndex];
    if (idx === undefined) { window.closeFlashPanel(); return; }
    var card = flashDeck[idx];
    flashFlipShown = false;
    var tag = 'Карта ' + (flashIndex + 1) + ' із ' + flashDue.length;
    var dueCount = flashDue.length - flashIndex;
    document.getElementById('flashTag').textContent = tag;
    document.getElementById('flashQ').textContent = card.q;
    document.getElementById('flashA').textContent = card.a;
    document.getElementById('flashLeft').textContent = dueCount;
    document.getElementById('flashDone').textContent = Object.keys(flashState.reviewed).length;
    document.getElementById('flashFront').style.display = 'flex';
    document.getElementById('flashBack').style.display = 'none';
  }
  window.flashFlip = function () {
    if (flashFlipShown) return;
    flashFlipShown = true;
    document.getElementById('flashFront').style.display = 'none';
    document.getElementById('flashBack').style.display = 'flex';
  };
  function flashAddDays(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  window.flashRate = function (rating) {
    var idx = flashDue[flashIndex];
    if (idx === undefined) return;
    var st = flashState.cards[idx] || { due: null, interval: 0 };
    if (rating === 'again') {
      st.due = flashToday();
    } else if (rating === 'hard') {
      st.due = flashAddDays(1); st.interval = 1;
    } else if (rating === 'good') {
      st.due = flashAddDays(3); st.interval = 3;
    } else {
      st.due = flashAddDays(7); st.interval = 7;
    }
    flashState.cards[idx] = st;
    flashState.reviewed[idx] = true;
    saveProgress('sa_flashcards', flashState);
    flashIndex++;
    if (flashIndex >= flashDue.length) {
      document.getElementById('flashDeck').style.display = 'none';
      document.getElementById('flashEmpty').style.display = 'block';
      document.getElementById('flashEmpty').querySelector('p').textContent = '🎉 На сьогодні все повторив!';
      document.getElementById('flashSub').textContent = 'Відмінно. Повернись завтра, щоб закріпити.';
      document.getElementById('flashDone').textContent = Object.keys(flashState.reviewed).length;
      return;
    }
    flashShow();
  };
  window.flashResetToday = function () {
    for (var i = 0; i < flashDeck.length; i++) {
      if (!flashState.cards[i]) flashState.cards[i] = { due: flashToday(), interval: 0 };
    }
    saveProgress('sa_flashcards', flashState);
    window.openFlashPanel();
  };
  window.flashHardReset = function () {
    if (!window.confirm('Скинути весь прогрес flash-карток? Цю дію не можна скасувати.')) return;
    flashState = { cards: {}, reviewed: {} };
    saveProgress('sa_flashcards', flashState);
    window.openFlashPanel();
  };

  function homeworkKey(chapterId) { return 'hw:' + chapterId; }

  function isHomeworkPassed(chapterId) {
    var block = document.getElementById('homework_' + chapterId);
    if (!block) return true;
    return !!homeworkPassed[homeworkKey(chapterId)];
  }

  function setMarkReadLocked(chapterId, locked) {
    try {
      qsa(document, '.mark-read').forEach(function (btn) {
        var onclick = btn.getAttribute('onclick');
        if (!onclick) return;
        var match = onclick.match(/toggleRead\('([^']+)'\)/);
        if (match && match[1] === chapterId) {
          btn.classList.toggle('mark-read--locked', !!locked && !isRead(chapterId));
        }
      });
    } catch (e) { /* skip */ }
  }

  function loadHomeworkAnswers() {
    try { return loadProgress('sa_homework_answers', {}); } catch (e) { return {}; }
  }

  function saveHomeworkAnswers(obj) {
    try { saveProgress('sa_homework_answers', obj); } catch (e) { }
  }

  function homeworkMarkedKey(chapterId) { return 'hw_marked_' + chapterId; }

  function bindHomeworkAnswerSave() {
    document.querySelectorAll('.homework__q input[type="radio"]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var q = inp.closest('.homework__q');
        if (!q) return;
        var block = q.closest('.homework');
        if (!block) return;
        var cid = block.getAttribute('data-chapter');
        var qi = Array.prototype.indexOf.call(block.querySelectorAll('.homework__q'), q);
        var answers = loadHomeworkAnswers();
        if (!answers[cid]) answers[cid] = [];
        answers[cid][qi] = inp.value;
        saveHomeworkAnswers(answers);
      });
    });
  }

  function restoreHomeworkAnswers() {
    var answers = loadHomeworkAnswers();
    document.querySelectorAll('.homework').forEach(function (block) {
      var cid = block.getAttribute('data-chapter');
      var list = answers[cid] || [];
      if (!list.length) return;
      block.querySelectorAll('.homework__q').forEach(function (q, qi) {
        var v = list[qi];
        if (v === undefined) return;
        var inp = q.querySelector('input[name="hw_' + cid + '_' + qi + '"][value="' + v + '"]');
        if (inp) inp.checked = true;
      });
    });
  }

  window.checkHomework = function (chapterId) {
    var block = document.getElementById('homework_' + chapterId);
    if (!block) return;
    var questions = block.querySelectorAll('.homework__q');
    var unanswered = [];
    var wrong = [];
    questions.forEach(function (q, qi) {
      q.classList.remove('homework__q--correct', 'homework__q--wrong', 'homework__q-ok');
      q.querySelectorAll('.homework__opt').forEach(function (o) {
        o.classList.remove('homework__opt--correct', 'homework__opt--wrong');
      });
      var selected = q.querySelector('input[name="hw_' + chapterId + '_' + qi + '"]:checked');
      if (!selected) {
        unanswered.push(qi);
        return;
      }
      var correctValue = q.getAttribute('data-answer');
      var correctOpt = null;
      q.querySelectorAll('.homework__opt input').forEach(function (inp) {
        if (String(inp.value) === String(correctValue)) {
          correctOpt = inp.closest('.homework__opt');
        }
      });
      if (String(selected.value) === correctValue) {
        if (correctOpt) correctOpt.classList.add('homework__opt--correct');
        q.classList.add('homework__q--correct', 'homework__q-ok');
      } else {
        selected.closest('.homework__opt').classList.add('homework__opt--wrong');
        q.classList.add('homework__q--wrong');
        wrong.push(qi);
      }
    });
    var marked = {};
    try { marked = loadProgress(homeworkMarkedKey(chapterId), {}) || {}; } catch (e) { }
    marked.marked = true;
    saveProgress(homeworkMarkedKey(chapterId), marked);
    var statusEl = document.getElementById('homeworkStatus_' + chapterId);
    if (!statusEl) return;
    if (wrong.length === 0 && unanswered.length === 0) {
      homeworkPassed[homeworkKey(chapterId)] = true;
      saveProgress('sa_homework', homeworkPassed);
      block.classList.add('homework--done');
      block.classList.remove('homework--unlocked');
      statusEl.textContent = '✓ Усі відповіді правильні! Розділ розблоковано.';
      statusEl.className = 'homework__status homework__status--done';
      var checkBtn = block.querySelector('.homework__check');
      if (checkBtn) checkBtn.classList.add('homework__check--done');
      setMarkReadLocked(chapterId, false);
      updateUnifiedButtons();
      updateContinueReadingBtn();
    } else {
      var msg = '';
      if (unanswered.length > 0) {
        msg = 'Відповів не на всі питання. Дай відповідь на питання ' +
          unanswered.map(function (i) { return i + 1; }).join(', ') + '.';
      } else {
        msg = 'Правильних: ' + (questions.length - wrong.length) + ' з ' + questions.length +
          '. Подумай ще над питаннями: ' +
          wrong.map(function (i) { return i + 1; }).join(', ') + '.';
      }
      statusEl.textContent = msg;
      statusEl.className = 'homework__status homework__status--error';
      var firstBad = block.querySelector('.homework__q--wrong');
      if (!firstBad) firstBad = block.querySelector('.homework__q');
      if (firstBad) firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  function updateHomeworkUI(chapterId) {
    var block = document.getElementById('homework_' + chapterId);
    if (!block) return;
    var passed = isHomeworkPassed(chapterId);
    if (passed) {
      block.classList.add('homework--done');
      var statusEl = document.getElementById('homeworkStatus_' + chapterId);
      if (statusEl) {
        statusEl.textContent = '✓ Усі відповіді правильні! Розділ розблоковано.';
        statusEl.className = 'homework__status homework__status--done';
      }
      var checkBtn = block.querySelector('.homework__check');
      if (checkBtn) checkBtn.classList.add('homework__check--done');
      block.querySelectorAll('.homework__q').forEach(function (q) {
        q.classList.add('homework__q--correct', 'homework__q-ok');
        var correctValue = q.getAttribute('data-answer');
        q.querySelectorAll('.homework__opt input').forEach(function (inp) {
          if (String(inp.value) === String(correctValue)) {
            inp.closest('.homework__opt').classList.add('homework__opt--correct');
          }
        });
      });
    } else if (isHomeworkMarked(chapterId)) {
      var statusEl2 = document.getElementById('homeworkStatus_' + chapterId);
      if (statusEl2) {
        statusEl2.textContent = 'Спробуй ще раз — розділ розблокується, коли відповіси правильно на всі питання.';
        statusEl2.className = 'homework__status homework__status--pending';
      }
      block.querySelectorAll('.homework__q').forEach(function (q) {
        var correctValue = q.getAttribute('data-answer');
        var checkedInp = q.querySelector('input:checked');
        if (checkedInp && String(checkedInp.value) !== String(correctValue)) {
          checkedInp.closest('.homework__opt').classList.add('homework__opt--wrong');
          q.classList.add('homework__q--wrong');
        } else if (checkedInp) {
          q.querySelectorAll('.homework__opt input').forEach(function (inp) {
            if (String(inp.value) === String(correctValue)) {
              inp.closest('.homework__opt').classList.add('homework__opt--correct');
            }
          });
          q.classList.add('homework__q--correct', 'homework__q-ok');
        }
      });
    }
    setMarkReadLocked(chapterId, !passed);
  }

  function isHomeworkMarked(chapterId) {
    try { var m = loadProgress(homeworkMarkedKey(chapterId), {}) || {}; return !!m.marked; } catch (e) { return false; }
  }

  window.flashHomeworkWarning = function (chapterId) {
    var block = document.getElementById('homework_' + chapterId);
    if (!block) return;
    block.scrollIntoView({ block: 'center', behavior: 'smooth' });
    block.classList.add('homework--shake');
    setTimeout(function () { block.classList.remove('homework--shake'); }, 600);
    var statusEl = document.getElementById('homeworkStatus_' + chapterId);
    if (statusEl) {
      statusEl.textContent = 'Спочатку дай правильні відповіді на всі 3 питання — тоді розділ розблокується.';
      statusEl.className = 'homework__status homework__status--error';
    }
  };

  function initHomeworkBlocks() {
    document.querySelectorAll('.homework').forEach(function (block) {
      var chapterId = block.getAttribute('data-chapter');
      updateHomeworkUI(chapterId);
    });
  }

  // ─── Фінальний іспит ───
  var examPassed = loadProgress('sa_exam_passed', false);

  function isExamPassed() { return !!examPassed; }

  var examIndex = 0;
  var examTotal = 42;
  var examAnswered = {};

  function examRenderDots() {
    var dotsWrap = document.getElementById('examDots');
    if (!dotsWrap) return;
    dotsWrap.innerHTML = '';
  }

  function examRenderQuestion() {
    var block = document.getElementById('exam_block');
    if (!block) return;
    var questions = block.querySelectorAll('.exam__q');
    if (!questions.length) return;
    questions.forEach(function (q, qi) {
      q.classList.toggle('exam__q--active', qi === examIndex);
      q.style.display = qi === examIndex ? '' : 'none';
    });
    var label = document.getElementById('examProgressLabel');
    if (label) label.textContent = 'Питання ' + (examIndex + 1) + ' із ' + examTotal;
    var fill = document.getElementById('examProgressFill');
    if (fill) fill.style.width = (((examIndex + 1) / examTotal) * 100) + '%';
    var prevBtn = block.querySelector('.exam__nav-btn--prev');
    if (prevBtn) prevBtn.disabled = examIndex === 0;
    var nextBtn = block.querySelector('.exam__nav-btn--next');
    if (nextBtn) nextBtn.textContent = (examIndex === examTotal - 1) ? 'Завершити →' : 'Далі →';
    examRenderDots();
  }

  window.examNav = function (delta) {
    var block = document.getElementById('exam_block');
    if (!block) return;
    var questions = block.querySelectorAll('.exam__q');
    if (!questions.length) return;
    if (delta > 0 && examIndex === examTotal - 1) {
      window.checkFinalExam();
      return;
    }
    examIndex = Math.max(0, Math.min(examTotal - 1, examIndex + delta));
    examRenderQuestion();
    questions[examIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  function examAutoNext(qi) {
    setTimeout(function () {
      if (examIndex === qi && examIndex < examTotal - 1) {
        examIndex++;
        examRenderQuestion();
        var questions = document.querySelectorAll('#exam_block .exam__q');
        if (questions[examIndex]) questions[examIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (examIndex === qi && examIndex === examTotal - 1) {
        window.checkFinalExam();
      }
    }, 350);
  }

  window.startExam = function () {
    var intro = document.getElementById('exam_intro');
    var block = document.getElementById('exam_block');
    if (intro) {
      intro.classList.add('exam-intro--hidden');
      setTimeout(function () { intro.style.display = 'none'; }, 420);
    }
    if (block) {
      block.classList.add('exam--reveal');
      block.style.display = 'block';
      examRenderQuestion();
      setTimeout(function () {
        block.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 120);
    }
  };

  function examBindAnswers() {
    var block = document.getElementById('exam_block');
    if (!block) return;
    var questions = block.querySelectorAll('.exam__q');
    questions.forEach(function (q, qi) {
      q.querySelectorAll('input[type="radio"]').forEach(function (r) {
        r.addEventListener('change', function () {
          examAnswered[qi] = true;
          var dotsWrap = document.getElementById('examDots');
          if (dotsWrap && dotsWrap.children[qi]) dotsWrap.children[qi].classList.add('exam__nav-dot--done');
          examAutoNext(qi);
        });
      });
    });
  }

  window.checkFinalExam = function () {
    var block = document.getElementById('exam_block');
    if (!block) return;
    var questions = block.querySelectorAll('.exam__q');
    var unanswered = 0;
    var correct = 0;
    questions.forEach(function (q, qi) {
      q.classList.remove('exam__q--correct', 'exam__q--wrong', 'exam__q-ok');
      q.querySelectorAll('.exam__opt').forEach(function (o) {
        o.classList.remove('exam__opt--correct', 'exam__opt--wrong');
      });
      var selected = q.querySelector('input[name="fx_' + qi + '"]:checked');
      if (!selected) { unanswered++; return; }
      var correctValue = q.getAttribute('data-answer');
      var correctOpt = null;
      q.querySelectorAll('.exam__opt input').forEach(function (inp) {
        if (String(inp.value) === String(correctValue)) {
          correctOpt = inp.closest('.exam__opt');
        }
      });
      if (String(selected.value) === correctValue) {
        if (correctOpt) correctOpt.classList.add('exam__opt--correct');
        q.classList.add('exam__q--correct', 'exam__q-ok');
        correct++;
      } else {
        selected.closest('.exam__opt').classList.add('exam__opt--wrong');
        q.classList.add('exam__q--wrong');
      }
    });
    var statusEl = document.getElementById('examStatus');
    var resultEl = document.getElementById('examResult');
    if (!statusEl || !resultEl) return;
    if (unanswered === 0 && correct >= 28) {
      examPassed = true;
      saveProgress('sa_exam_passed', true);
      block.classList.add('exam--done');
      statusEl.textContent = '';
      statusEl.className = 'exam__status';
      block.querySelectorAll('.exam__q').forEach(function (q) {
        q.classList.add('exam__q--correct', 'exam__q-ok');
      });
      resultEl.style.display = 'block';
      resultEl.className = 'exam__result exam__result--pass';
      resultEl.innerHTML = ''
        + '<div class="exam__result-ico">🏆</div>'
        + '<div class="exam__result-title">Вітаємо! Ти склав іспит</div>'
        + '<div class="exam__result-score">' + correct + ' із ' + examTotal + ' правильних</div>'
        + '<div class="exam__result-text">Сертифікат про завершення курсу вже доступний.</div>'
        + '<button class="exam__result-btn" onclick="showCertificate()">Отримати сертифікат 🎓</button>';
      var examNavEl = block.querySelector('.exam__nav');
      if (examNavEl) examNavEl.style.display = 'none';
      var progressEl = document.getElementById('examProgress');
      if (progressEl) progressEl.style.display = 'none';
      var headEl = block.querySelector('.exam__head');
      if (headEl) headEl.style.display = 'none';
      if (!isRead('final_exam')) {
        markRead('final_exam');
        updateUnifiedButtons();
        updateContinueReadingBtn();
      }
      resultEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      var msg;
      if (unanswered > 0) {
        msg = 'Дай відповіді на всі ' + examTotal + ' питань — пропущено ' + unanswered + '. Повернись і відміть їх.';
        statusEl.className = 'exam__status exam__status--error';
        resultEl.style.display = 'none';
        var firstUnanswered = null;
        questions.forEach(function (q, qi) {
          if (!q.querySelector('input[name="fx_' + qi + '"]:checked') && !firstUnanswered) firstUnanswered = q;
        });
        if (firstUnanswered) firstUnanswered.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        msg = 'Ти відповів правильно на ' + correct + ' з ' + examTotal + '. Для успішного складання потрібно щонайменше 28.';
        statusEl.className = 'exam__status exam__status--error';
        resultEl.style.display = 'block';
        resultEl.className = 'exam__result exam__result--fail';
        resultEl.innerHTML = ''
          + '<div class="exam__result-ico">📚</div>'
          + '<div class="exam__result-title">Не цього разу</div>'
          + '<div class="exam__result-score">' + correct + ' із ' + examTotal + ' правильних</div>'
          + '<div class="exam__result-text">Потрібно 28+. Переглянь матеріали та спробуй ще раз.</div>'
          + '<button class="exam__result-btn" onclick="location.reload()">Спробувати ще раз ↻</button>';
        resultEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      statusEl.textContent = msg;
    }
  };

  function updateExamUI() {
    var block = document.getElementById('exam_block');
    var intro = document.getElementById('exam_intro');
    if (!block) return;
    if (examPassed) {
      block.style.display = 'block';
      if (intro) intro.style.display = 'none';
      block.classList.add('exam--done');
      var statusEl = document.getElementById('examStatus');
      var resultEl = document.getElementById('examResult');
      if (statusEl) { statusEl.textContent = ''; statusEl.className = 'exam__status'; }
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.className = 'exam__result exam__result--pass';
        resultEl.innerHTML = ''
          + '<div class="exam__result-ico">🏆</div>'
          + '<div class="exam__result-title">Іспит складено</div>'
          + '<div class="exam__result-score">Сертифікат доступний</div>'
          + '<button class="exam__result-btn" onclick="showCertificate()">Отримати сертифікат 🎓</button>';
      }
      block.querySelectorAll('.exam__q').forEach(function (q) {
        q.classList.add('exam__q--correct', 'exam__q-ok');
      });
      var examNavEl = block.querySelector('.exam__nav');
      if (examNavEl) examNavEl.style.display = 'none';
      var progressEl = document.getElementById('examProgress');
      if (progressEl) progressEl.style.display = 'none';
      var headEl = block.querySelector('.exam__head');
      if (headEl) headEl.style.display = 'none';
      return;
    }
    examRenderQuestion();
  }

  // ─── Сертифікат ───
  window.showCertificate = function () {
    var overlay = document.getElementById('certificateOverlay');
    if (!overlay) return;
    var nameEl = document.getElementById('certificateUserName');
    nameEl.textContent = displayName || user;
    var dateEl = document.getElementById('certificateDate');
    dateEl.textContent = 'Дата завершення: ' + new Date().toLocaleDateString('uk-UA', { year: 'numeric', month: 'long', day: 'numeric' });
    overlay.classList.add('active');
  };

  window.closeCertificate = function () {
    var overlay = document.getElementById('certificateOverlay');
    if (overlay) overlay.classList.remove('active');
  };

  window.printCertificate = function () {
    document.body.classList.add('printing-certificate');
    window.print();
    setTimeout(function () { document.body.classList.remove('printing-certificate'); }, 200);
  };

  window.printCurrentChapter = function () {
    if (!currentChapter) { showOverview(); return; }
    document.querySelectorAll('.cabinet__chapter').forEach(function (c) {
      c.removeAttribute('data-chapter-print');
      if (c.id === currentChapter) c.setAttribute('data-chapter-print', '1');
    });
    document.body.classList.add('printing-chapter');
    window.print();
    setTimeout(function () {
      document.body.classList.remove('printing-chapter');
      document.querySelectorAll('.cabinet__chapter').forEach(function (c) { c.removeAttribute('data-chapter-print'); });
    }, 300);
  };

  // ─── Статистика ───
  function statsChapterNames() {
    var map = {};
    document.querySelectorAll('.sidebar__link[data-ch]').forEach(function (a) {
      var numEl = a.querySelector('.sidebar__link-num');
      map[a.getAttribute('data-ch')] = (numEl ? a.textContent.replace(numEl.textContent, '') : a.textContent).replace(/\s+/g, ' ').trim();
    });
    return map;
  }

  var statsMainChapters = null;
  var statsBonusChapters = null;
  function statsChapterIds() {
    if (statsMainChapters) return;
    statsMainChapters = [];
    statsBonusChapters = [];
    document.querySelectorAll('.sidebar__link[data-ch]').forEach(function (a) {
      var id = a.getAttribute('data-ch');
      if (a.closest('#appendixGroup')) statsBonusChapters.push(id);
      else statsMainChapters.push(id);
    });
  }

  function computeBadges(readMain, mainTotal, hwPassedCount, bookmarkCount) {
    var mainReadIds = statsMainChapters.filter(function (id) { return isRead(id); });
    var stats = [];
    function push(id, name, ico, earned) {
      stats.push({ id: id, name: name, ico: ico, earned: !!earned });
    }
    push('start', 'Перший крок', '🎯', mainReadIds.length >= 1);
    push('reader5', 'Читач 5', '📚', mainReadIds.length >= 5);
    push('reader10', 'Читач 10', '📚', mainReadIds.length >= 10);
    push('reader_all', 'Усе прочитано', '🏛️', mainReadIds.length >= mainTotal);
    push('homework_all', 'Майстер тестів', '🧠', hwPassedCount >= 18);
    push('exam', 'Іспит складено', '🎓', examPassed);
    push('streak3', '3 дні поспіль', '🔥', streak.best >= 3);
    push('streak7', 'Тиждень вогню', '🔥', streak.best >= 7);
    push('bookmark', 'Дослідник', '🔖', bookmarkCount >= 1);
    return stats;
  }
  function renderBadges(badges) {
    var grid = document.getElementById('statsBadgesGrid');
    if (!grid) return;
    var html = '';
    for (var i = 0; i < badges.length; i++) {
      var b = badges[i];
      html += '<div class="stats-card__badge' + (b.earned ? ' stats-card__badge--earned' : '') + '">' +
        '<span class="stats-card__badge-ico">' + b.ico + '</span>' +
        '<span class="stats-card__badge-name">' + b.name + '</span>' +
      '</div>';
    }
    grid.innerHTML = html;
  }

  window.showStatsPanel = function () {
    var overlay = document.getElementById('statsOverlay');
    if (!overlay) return;
    var sCard = document.querySelector('.stats-card');
    if (sCard) sCard.classList.toggle('stats-card--wide', isDesktopViewport());
    statsChapterIds();
    var names = statsChapterNames();
    var hwPassedCount = Object.keys(homeworkPassed).filter(function (k) { return k.indexOf('hw:') === 0; }).length;

    function fill(id, val, max) {
      var el = document.getElementById(id);
      if (!el) return;
      if (max) el.textContent = val + ' / ' + max;
      else el.textContent = val ? '✓' : '—';
    }

    var readMain = statsMainChapters.filter(function (id) { return isRead(id); }).length;
    var readBonus = statsBonusChapters.filter(function (id) { return isRead(id); }).length;

    fill('statsReadNum', readMain, statsMainChapters.length);
    fill('statsBonusNum', readBonus, statsBonusChapters.length);
    fill('statsHomeworkNum', hwPassedCount, 18);
    document.getElementById('statsExamNum').textContent = examPassed ? '✓ Складено' : '— Не складено';
    document.getElementById('statsBookmarksNum').textContent = bookmarks.length;

    // ── Streak ──
    var sNum = document.getElementById('statsStreakNum');
    var sBest = document.getElementById('statsStreakBest');
    if (sNum) sNum.textContent = streak.count;
    if (sBest) sBest.textContent = streak.best;

    // ── Досягнення ──
    var badges = computeBadges(readMain, statsMainChapters.length, hwPassedCount, bookmarks.length);
    renderBadges(badges);

    function setFill(id, pct) {
      var el = document.getElementById(id);
      if (el) el.style.width = Math.max(0, Math.min(100, Math.round(pct))) + '%';
    }
    setFill('statsReadFill', readMain / statsMainChapters.length * 100);
    setFill('statsBonusFill', readBonus / statsBonusChapters.length * 100);
    setFill('statsHomeworkFill', hwPassedCount / 18 * 100);
    setFill('statsExamFill', examPassed ? 100 : 0);
    setFill('statsBookmarksFill', (bookmarks.length > 0) ? Math.min(100, bookmarks.length * 25) : 0);

    var tasks = readMain + readBonus + hwPassedCount + (examPassed ? 1 : 0);
    var tasksTotal = statsMainChapters.length + statsBonusChapters.length + 18 + 1;
    var overall = Math.round(tasks / tasksTotal * 100);
    var ring = document.getElementById('statsRing');
    if (ring) ring.style.setProperty('--p', overall);
    var overallEl = document.getElementById('statsOverallNum');
    if (overallEl) overallEl.textContent = overall + '%';

    var titleEl = document.getElementById('statsTotalTitle');
    var descEl = document.getElementById('statsTotalDesc');
    var nextBtn = document.getElementById('statsNextBtn');
    var nextTarget = null;

    if (examPassed && readMain === statsMainChapters.length) {
      titleEl.textContent = 'Курс завершено 🎉';
      descEl.textContent = 'Ти пройшов увесь курс і склав фінальний іспит. Сертифікат уже твій!';
      if (nextBtn) { nextBtn.textContent = 'Переглянути сертифікат'; nextTarget = 'cert'; }
    } else {
      var firstUnreadMain = statsMainChapters.filter(function (id) { return !isRead(id); })[0];
      var hwTarget = null;
      var readCh = statsMainChapters.filter(function (id) { return isRead(id); });
      for (var i = 0; i < readCh.length; i++) {
        if (readCh[i].indexOf('ch') === 0 && !homeworkPassed[homeworkKey(readCh[i])]) { hwTarget = readCh[i]; break; }
      }
      if (firstUnreadMain) {
        titleEl.textContent = 'Наступний крок';
        descEl.textContent = 'Прочитай «' + (names[firstUnreadMain] || firstUnreadMain) + '», щоб рухатися далі.';
        if (nextBtn) { nextBtn.textContent = 'Продовжити навчання'; nextTarget = firstUnreadMain; }
      } else if (hwTarget) {
        titleEl.textContent = 'Закріпи знання';
        descEl.textContent = 'Пройди домашній тест у «' + (names[hwTarget] || hwTarget) + '».';
        if (nextBtn) { nextBtn.textContent = 'До прочитаного тесту'; nextTarget = hwTarget; }
      } else if (!examPassed) {
        titleEl.textContent = 'Фінальний іспит';
        descEl.textContent = 'Всі розділи прочитано й тести складено. Час отримати сертифікат!';
        if (nextBtn) { nextBtn.textContent = 'Скласти іспит'; nextTarget = 'final_exam'; }
      } else {
        var firstBonus = statsBonusChapters.filter(function (id) { return !isRead(id); })[0];
        if (firstBonus) {
          titleEl.textContent = 'Поглибся';
          descEl.textContent = 'Обери додаток «' + (names[firstBonus] || firstBonus) + '» для глибшого розуміння.';
          if (nextBtn) { nextBtn.textContent = 'Відкрити додаток'; nextTarget = firstBonus; }
        }
      }
    }
    if (nextBtn) nextBtn.setAttribute('data-target', nextTarget || '');
    overlay.classList.add('active');
    document.documentElement.classList.add('has-stats-open');
    document.body.classList.add('has-stats-open');
  };

  window.goStatsNext = function () {
    var btn = document.getElementById('statsNextBtn');
    var target = btn && btn.getAttribute('data-target');
    closeStatsPanel();
    if (!target) return;
    if (target === 'cert') { showCertificate(); return; }
    if (target === 'final_exam') { showChapter('final_exam', true); return; }
    showChapter(target, true);
  };

  window.closeStatsPanel = function () {
    var overlay = document.getElementById('statsOverlay');
    if (overlay) overlay.classList.remove('active');
    document.documentElement.classList.remove('has-stats-open');
    document.body.classList.remove('has-stats-open');
  };
  // клік по фону закриває статистику
  (function () {
    var so = document.getElementById('statsOverlay');
    if (so) so.addEventListener('click', function (e) { if (e.target === so) window.closeStatsPanel(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') window.closeStatsPanel(); });
  })();

  // ─── Скидання прогресу ───
  window.resetProgress = function () {
    if (!window.confirm('Видалити весь прогрес: прочитані розділи, тести, закладки, іспит? Цю дію не можна скасувати.')) return;
    var keys = ['sa_read', 'sa_homework', 'sa_homework_answers', 'sa_bookmarks', 'sa_exam_passed', 'sa_last_chapter', 'sa_streak', 'sa_flashcards'];
    keys.forEach(function (k) { localStorage.removeItem(k); });
    // також чистимо позначки відповідей по кожному розділу (hw_marked_ch1 …)
    try {
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('hw_marked_') === 0) toRemove.push(k);
      }
      toRemove.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    pushProgressNow(user).finally(function () { window.location.reload(); });
  };

  updateExamUI();
  examBindAnswers();

  function initChapterHeadNums() {
    document.querySelectorAll('.chapter-head').forEach(function (head) {
      var tag = head.querySelector('.chapter-tag');
      if (!tag) return;
      var num = (tag.textContent.match(/\d+/) || [])[0];
      if (!num) {
        var letter = (tag.textContent.match(/\b[A-Za-z]\b/) || [])[0];
        if (letter) num = letter.toUpperCase();
      }
      if (num) head.setAttribute('data-num', num);
    });
  }
  initChapterHeadNums();

  function initSidebarScrollProgress() {
    var nav = document.querySelector('.sidebar__nav');
    if (!nav) return;
    var ticking = false;
    var update = function () {
      ticking = false;
      var max = nav.scrollHeight - nav.clientHeight;
      var pct = max > 0 ? (nav.scrollTop / max) * 100 : 0;
      // iOS-скрол при швидкому фліку може на мить "відскочити" за межі
      // контенту (elastic bounce), тоді scrollTop стає від'ємним або
      // більшим за max — без обмеження це і давало той візуальний глюк,
      // коли смужка миттєво зникала й з'являлась.
      if (!isFinite(pct)) pct = 0;
      pct = Math.max(0, Math.min(100, pct));
      nav.style.setProperty('--scroll-progress', pct + '%');
    };
    var onScroll = function () {
      // rAF-throttle: під час швидкого скролу scroll-подій прилітає
      // набагато більше, ніж встигає перемалюватись кадрів — без
      // цього смужка й "мерехтіла" на флік-скролі.
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    nav.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    update();
  }
  initSidebarScrollProgress();

  restoreHomeworkAnswers();
  initHomeworkBlocks();
  bindHomeworkAnswerSave();
  updateUnifiedButtons();
  updateContinueReadingBtn();
  if (typeof window.calcProfit === 'function') window.calcProfit();
  if (typeof window.calcFbaFee === 'function') window.calcFbaFee();

  // ─── Тур-знайомство з навігацією (desktop, перший вхід) ───
  var tourSteps = [
    {
      sel: '.sidebar__logo',
      title: 'Картки розділів',
      text: 'Щоб повернутися до зручних карток розділів, натисни на лого «Навчальна платформа» зверху сайдбара.',
      placement: 'right'
    },
    {
      sel: '#sidebarAvatar',
      title: 'Профіль',
      text: 'Натисни на аватар — тут можна змінити ім’я та пароль.',
      placement: 'right'
    },
    {
      sel: '#sidebarProgress',
      title: 'Твій прогрес',
      text: 'Тут показано, скільки розділів ти вже опрацював. Натисни на смужку — відкриється докладна статистика навчання.',
      placement: 'right'
    },
    {
      sel: '.sidebar__logout',
      title: 'Вихід',
      text: 'Щоб вийти з кабінету й повернутися на головну сторінку курсу, натисни кнопку зі стрілкою внизу профілю.',
      placement: 'right'
    },
    {
      sel: '#themeToggle',
      title: 'Тема оформлення',
      text: 'Перемикач світлої та темної теми. Обери ту, в якій зручніше читати, — вибір запам’ятається.',
      placement: 'right'
    },
    {
      sel: '#sidebarSearchWrap',
      title: 'Пошук по курсу',
      text: 'Миттєвий пошук по всьому курсу: введи слово — і отримаєш розділи, де воно зустрічається.',
      placement: 'right'
    },
    {
      sel: '.sidebar__tabs',
      title: 'Розділи та додатки',
      text: 'Основний курс із 18 розділів — у вкладці «Розділи». Бонусні матеріали, кейси та глосарій — у «Додатки».',
      placement: 'right'
    },
    {
      sel: '.sidebar__tools',
      title: 'Інструменти',
      text: 'Тут — flash-картки для повторення та друк поточного розділу (зручно для конспекту в PDF).',
      placement: 'right'
    },
    {
      sel: '.sidebar__link[data-ch="ch1"]',
      title: 'Список розділів',
      text: 'Обери розділ і починай навчання. Кожен розділ завершується невеликим тестом, який відкриває наступний.',
      placement: 'right'
    }
  ];
  var tourIndex = 0;
  var tourActive = false;

  window.skipTour = function () {
    if (!tourActive) return;
    tourActive = false;
    var ov = document.getElementById('tourOverlay');
    if (ov) ov.classList.remove('active');
    document.body.classList.remove('tour-locked');
    saveProgress('sa_tour_seen', '1');
    // Туториал не должен появляться снова, если пользователь сразу
    // обновил страницу после закрытия.
    if (user !== 'guest') {
      setTimeout(function () { pushProgressNow(user); }, 0);
    }
  };

  window.nextTour = function () {
    if (!tourActive) return;
    tourIndex++;
    if (tourIndex >= tourSteps.length) { window.skipTour(); return; }
    positionTour();
  };

  function isDesktopViewport() {
    return window.matchMedia && window.matchMedia('(min-width:769px)').matches;
  }

  function positionTour() {
    var step = tourSteps[tourIndex];
    var target = document.querySelector(step.sel);
    var ov = document.getElementById('tourOverlay');
    var dot = document.getElementById('tourDot');
    var pop = document.getElementById('tourPop');
    var stepEl = document.getElementById('tourStep');
    var titleEl = document.getElementById('tourTitle');
    var textEl = document.getElementById('tourText');
    if (!target || !ov || !dot || !pop) return;

    pop.style.opacity = '0';
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });

    setTimeout(function () {
      var r = target.getBoundingClientRect();
      var d = 14;
      dot.style.left = (r.left + r.width / 2) + 'px';
      dot.style.top = (r.top + r.height / 2) + 'px';

      var pw = 300;
      var ph = 0;
      var px, py;
      if (step.placement === 'right') {
        px = r.right + 24;
        py = r.top + r.height / 2;
      } else if (step.placement === 'left') {
        px = r.left - pw - 24;
        py = r.top + r.height / 2;
      } else if (step.placement === 'bottom') {
        px = r.left + r.width / 2 - pw / 2;
        py = r.bottom + 24;
      } else {
        px = r.left + r.width / 2 - pw / 2;
        py = r.top - 24;
        ph = -1;
      }
      px = Math.max(12, Math.min(window.innerWidth - pw - 12, px));
      py = Math.max(12, Math.min(window.innerHeight - 260, py));
      pop.style.left = px + 'px';
      pop.style.top = py + 'px';
      pop.setAttribute('data-placement', step.placement);

      stepEl.textContent = 'Крок ' + (tourIndex + 1) + ' із ' + tourSteps.length;
      titleEl.textContent = step.title;
      textEl.textContent = step.text;
      var nextBtn = document.getElementById('tourNext');
      if (nextBtn) nextBtn.textContent = (tourIndex === tourSteps.length - 1) ? 'Зрозуміло ✓' : 'Далі →';
      dot.style.opacity = '';
      pop.style.opacity = '1';
    }, 450);
  }

  function startTour() {
    if (!isDesktopViewport()) return;
    var seen = loadProgress('sa_tour_seen', null);
    if (seen) return;
    var ov = document.getElementById('tourOverlay');
    if (!ov) return;
    tourActive = true;
    tourIndex = 0;
    ov.classList.add('active');
    document.body.classList.add('tour-locked');
    var dot0 = document.getElementById('tourDot');
    var pop0 = document.getElementById('tourPop');
    if (dot0) dot0.style.opacity = '0';
    if (pop0) pop0.style.opacity = '0';
    var onKey = function (e) {
      if (e.key === 'Escape') { window.skipTour(); window.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Enter' || e.key === ' ') { window.nextTour(); }
    };
    window.addEventListener('keydown', onKey);
    setTimeout(function () { positionTour(); }, 300);
  }

  setTimeout(startTour, 1400);

  // ═══ Дизайн-покращення: тултіпи, reveal, таймер, кільце, теми, карта, чеклісти, глосарій, міні-меню ═══

  var rdTimer = null;
  var rdTimerTotal = 15 * 60;
  var rdTimerLeft = rdTimerTotal;

  function rdTopicForQuestion(qi) {
    var map = [
      'Фінанси розрахунки', 'Реєстрація акаунта', 'Вибір товару', 'Постачальники',
      'Постачальники', 'Логістика', 'Лістинг', 'Брендинг', 'Buy Box',
      'Захист акаунта', 'Лістинг', 'Фінанси розрахунки', 'Реєстрація акаунта',
      'Лістинг', 'Постачальники', 'Вибір товару', 'Логістика', 'Лістинг',
      'Основи Amazon', 'Основи Amazon', 'Реєстрація акаунта', 'Вибір товару',
      'Логістика', 'Брендинг', 'Buy Box', 'Захист акаунта', 'Юридичне',
      'Підсумки', 'Підсумки', 'PPC реклама', 'Специфіка Україна', 'Специфіка Україна',
      'Відгуки', 'Масштабування', 'Helium 10', 'Готовий товар',
      'Додатки', 'Додатки', 'Додатки', 'Додатки', 'Додатки', 'Додатки'
    ];
    return map[qi] || 'Різне';
  }

  function rdFormatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function rdStartExamTimer() {
    var timerEl = document.getElementById('examTimer');
    var numEl = document.getElementById('examTimerNum');
    if (!timerEl || !numEl) return;
    if (rdTimer) clearInterval(rdTimer);
    rdTimerLeft = rdTimerTotal;
    timerEl.style.display = '';
    numEl.textContent = rdFormatTime(rdTimerLeft);
    rdTimer = setInterval(function () {
      rdTimerLeft--;
      if (rdTimerLeft <= 0) {
        rdTimerLeft = 0;
        clearInterval(rdTimer);
        rdTimer = null;
        numEl.textContent = rdFormatTime(0);
        window.checkFinalExam();
        return;
      }
      numEl.textContent = rdFormatTime(rdTimerLeft);
      timerEl.classList.toggle('exam__timer--warn', rdTimerLeft <= 5 * 60);
      timerEl.classList.toggle('exam__timer--danger', rdTimerLeft <= 60);
    }, 1000);
  }

  function rdStopExamTimer() {
    if (rdTimer) { clearInterval(rdTimer); rdTimer = null; }
  }

  function rdUpdateRing(answered, total) {
    var ring = document.getElementById('examIntroRing');
    var label = document.getElementById('examIntroRingLabel');
    if (!ring) return;
    var pct = total ? Math.round((answered / total) * 100) : 0;
    var r = 54;
    var c = 2 * Math.PI * r;
    ring.style.strokeDasharray = c;
    ring.style.strokeDashoffset = c * (1 - pct / 100);
    if (label) label.textContent = pct + '%';
  }

  function rdBuildTopicBreakdown() {
    var block = document.getElementById('exam_block');
    if (!block) return '';
    var questions = block.querySelectorAll('.exam__q');
    var topicStats = {};
    var order = [];
    questions.forEach(function (q, qi) {
      var topic = rdTopicForQuestion(qi);
      if (!topicStats[topic]) { topicStats[topic] = { total: 0, correct: 0 }; order.push(topic); }
      topicStats[topic].total++;
      var selected = q.querySelector('input[name="fx_' + qi + '"]:checked');
      if (selected && String(selected.value) === q.getAttribute('data-answer')) topicStats[topic].correct++;
    });
    var html = '<div class="exam__breakdown"><div class="exam__breakdown-title">Розбивка по темах</div>';
    order.forEach(function (t) {
      var st = topicStats[t];
      var pct = st.total ? Math.round((st.correct / st.total) * 100) : 0;
      html += '<div class="exam__break-row">'
        + '<div class="exam__break-head"><span>' + t + '</span><span class="exam__break-val">' + st.correct + ' / ' + st.total + '</span></div>'
        + '<div class="exam__break-track"><div class="exam__break-fill" style="width:' + pct + '%"></div></div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  }

  function rdAppendBreakdown(resultEl) {
    if (!resultEl) return;
    var div = document.createElement('div');
    div.innerHTML = rdBuildTopicBreakdown();
    var bd = div.querySelector('.exam__breakdown');
    if (bd) resultEl.appendChild(bd);
  }

  // ── Тултіпи на номерах розділів ──
  function initChapterTooltips() {
  }

  // ── Бібліотека ефектів появи ──
  var rdRevealObserver = null;
  function initRevealLibrary() {
    var targets = document.querySelectorAll('.rd-reveal');
    if (!targets.length) return;
    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('rd-reveal--in'); });
      return;
    }
    if (rdRevealObserver) {
      targets.forEach(function (el) { rdRevealObserver.observe(el); });
      return;
    }
    rdRevealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('rd-reveal--in');
          rdRevealObserver.unobserve(en.target);
        }
      });
    }, { threshold: 0.15 });
    targets.forEach(function (el) { rdRevealObserver.observe(el); });
    // Запасний варіант: якщо через 2.5с елемент не з'явився (напр. він у
    // прихованому розділі, або observer не підтримується коректно) — показуємо.
    setTimeout(function () {
      document.querySelectorAll('.rd-reveal:not(.rd-reveal--in)').forEach(function (el) {
        var visible = el.closest('.cabinet__chapter');
        if (!visible || visible.style.display !== 'none') {
          el.classList.add('rd-reveal--in');
        }
      });
    }, 2500);
  }

  // Коли розділ стає видимим — запускаємо reveal заново для його елементів,
  // бо приховані (display:none) елементи не генерують intersection-події.
  function rdRevealChapter(id) {
    var ch = document.getElementById(id);
    if (!ch) return;
    ch.querySelectorAll('.rd-reveal:not(.rd-reveal--in)').forEach(function (el) {
      if (rdRevealObserver) rdRevealObserver.observe(el);
    });
  }

  // Авто-підключення reveal до стандартних блоків контенту.
  // JS додає прихований клас лише тоді, коли працює — тому при збої
  // JS весь контент залишається видимим.
  function autoReveal() {
    if (!('IntersectionObserver' in window)) return;
    var selectors = '.rd-stats>.rd-stat, .rd-roles>.rd-role, .rd-road__step, .summary.rd-summary .summary__item, .origin-ledger.rd-ledger .origin-ledger__row, .step-list.rd-stagger .step-list__item, .rd-budget tr, .tbl-wrap.rd-tbl tr, .origin-arc.rd-timeline .origin-arc__item, .rd-roles>.rd-role, .rd-flow, .origin-quote.rd-quote';
    var els = document.querySelectorAll(selectors);
    els.forEach(function (el) {
      if (el.classList.contains('rd-reveal')) return;
      if (el.closest('.rd-stagger, .rd-anim')) return;
      el.classList.add('rd-reveal');
    });
    initRevealLibrary();
  }

  // ── Анімовані лічильники ──
  function animateCounter(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    if (isNaN(target)) return;
    var suffix = el.getAttribute('data-suffix') || '';
    var dur = 1200;
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = target * eased;
      var out = Number.isInteger(target) ? Math.round(val).toLocaleString('uk-UA') : val.toFixed(1);
      el.textContent = out + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function initCounters() {
    var els = document.querySelectorAll('.rd-count[data-count]');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(animateCounter);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          animateCounter(en.target);
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  }

  // ── Фліп-картки ──
  function initFlipCards() {
    document.querySelectorAll('.rd-flip').forEach(function (card) {
      if (card.dataset.rdBound) return;
      card.dataset.rdBound = '1';
      card.addEventListener('click', function () {
        card.classList.toggle('rd-flip--flipped');
      });
    });
  }

  // ── Паралакс ──
  function initParallax() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var els = document.querySelectorAll('.rd-parallax');
    if (!els.length) return;
    var ticking = false;
    function apply() {
      ticking = false;
      els.forEach(function (el) {
        var rect = el.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        var speed = parseFloat(el.getAttribute('data-speed') || '0.15');
        var offset = (rect.top + rect.height / 2 - window.innerHeight / 2) * -speed;
        el.style.transform = 'translate3d(0,' + Math.round(offset) + 'px,0)';
      });
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    }, { passive: true });
    apply();
  }

  // ── Інтерактивні чеклісти ──
  function initChecklists() {
    document.querySelectorAll('.checkbox-lg').forEach(function (box) {
      if (box.dataset.rdBound) return;
      box.dataset.rdBound = '1';
      box.style.cursor = 'pointer';
      box.addEventListener('click', function () {
        box.classList.toggle('checkbox-lg--done');
      });
    });
  }

  // ── Глосарій-тултіпи ──
  var glossTipEl = null;
  function initGlossaryTips() {
    if (!glossTipEl) {
      glossTipEl = document.createElement('div');
      glossTipEl.className = 'rd-tooltip rd-tooltip--glossary';
      glossTipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(glossTipEl);
    }
    var tip = glossTipEl;
    document.querySelectorAll('.rd-term').forEach(function (term) {
      if (term.dataset.rdBound) return;
      term.dataset.rdBound = '1';
      var def = term.getAttribute('data-def');
      term.addEventListener('mouseenter', function () {
        tip.textContent = def || '';
        tip.classList.add('rd-tooltip--show');
        var rect = term.getBoundingClientRect();
        tip.style.left = (rect.left + rect.width / 2) + 'px';
        tip.style.top = (rect.top - 8) + 'px';
        tip.style.transform = 'translateX(-50%) translateY(-100%)';
      });
      term.addEventListener('mouseleave', function () {
        tip.classList.remove('rd-tooltip--show');
        tip.style.transform = '';
      });
    });
  }

  // ── Автолінки глосарію: перший прохід по тексту розділу обгортає
  //    відомі терміни з Додатка P у .rd-term із підказкою ──
  var rdGlossDict = null;
  function rdBuildGlossaryDict() {
    if (rdGlossDict) return rdGlossDict;
    rdGlossDict = [];
    var appP = document.getElementById('appendix_p');
    if (!appP) return rdGlossDict;
    appP.querySelectorAll('.tbl-wrap tbody tr').forEach(function (tr) {
      var tds = tr.querySelectorAll('td');
      if (tds.length < 2) return;
      var term = tds[0].textContent.trim();
      var def = tds[1].textContent.trim().replace(/\s+/g, ' ');
      if (term.length >= 4 && def.length > 15 && !/[а-яіїєґ]{40,}/i.test(def)) {
        rdGlossDict.push({ t: term, d: def });
      }
    });
    rdGlossDict.sort(function (a, b) { return b.t.length - a.t.length; });
    return rdGlossDict;
  }

  function rdAutoLinkGlossary(id) {
    var art = document.getElementById(id);
    if (!art || art.id === 'appendix_p' || art.id === 'final_exam') return;
    var body = art.querySelector('.chapter-body');
    if (!body || body.dataset.glossDone) return;
    body.dataset.glossDone = '1';
    var dict = rdBuildGlossaryDict();
    if (!dict.length) return;
    var map = {};
    dict.forEach(function (e) { map[e.t.toLowerCase()] = e.d; });
    var alt = dict.map(function (e) { return e.t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
    var re;
    try {
      re = new RegExp('(?<![\\p{L}\\p{N}])(' + alt + ')(?![\\p{L}\\p{N}])', 'giu');
    } catch (err) { return; }
    var SKIP = { A:1, BUTTON:1, CODE:1, PRE:1, SCRIPT:1, STYLE:1, H1:1, H2:1, H3:1, H4:1 };
    function inSkip(node) {
      var p = node.parentNode;
      while (p && p !== body) {
        if (SKIP[p.nodeName] || (p.classList && (p.classList.contains('rd-term') || p.classList.contains('box__ribbon') || p.classList.contains('chapter-meta')))) return true;
        p = p.parentNode;
      }
      return false;
    }
    var CAP = 18;
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    var injected = 0;
    for (var i = 0; i < nodes.length && injected < CAP; i++) {
      var node = nodes[i];
      if (inSkip(node)) continue;
      var text = node.nodeValue;
      if (!text || text.length < 4) continue;
      re.lastIndex = 0;
      var m, segs = [], lastIdx = 0;
      while ((m = re.exec(text))) {
        if (injected >= CAP) break;
        var termText = m[1];
        var def = map[termText.toLowerCase()];
        segs.push(document.createTextNode(text.slice(lastIdx, m.index)));
        var span = document.createElement('span');
        span.className = 'rd-term';
        span.setAttribute('data-def', def);
        span.textContent = termText;
        segs.push(span);
        lastIdx = m.index + termText.length;
        injected++;
        if (re.lastIndex === m.index) re.lastIndex++;
      }
      if (segs.length) {
        segs.push(document.createTextNode(text.slice(lastIdx)));
        var frag = document.createDocumentFragment();
        segs.forEach(function (s) { frag.appendChild(s); });
        node.parentNode.replaceChild(frag, node);
      }
    }
    if (injected) initGlossaryTips();
  }

  // ── Міні-меню секцій розділу ──
  function rdCleanHeading(t) {
    t = t.replace(/^[^\p{L}\p{N}]+/u, '');
    t = t.replace(/^[\d]+(?:\s*[.\-–—]\s*[\d]*\s*[.\-–—]?\s*)?/, '');
    t = t.replace(/^\d+\s*[.\-–—]\s*/, '');
    return t.trim();
  }

  function initChapterMiniMenu() {
    document.querySelectorAll('.cabinet__chapter').forEach(function (ch) {
      var menu = ch.querySelector('.rd-minimenu');
      if (menu) return;
      var heads = ch.querySelectorAll('h2, h3');
      if (!heads.length) return;
      var container = ch.querySelector('.chapter-head');
      if (!container) return;

      menu = document.createElement('div');
      menu.className = 'rd-minimenu';

      // Кнопка "Меню розділу" — на десктопі схована через CSS (там і так
      // видно всю стрічку пілюль), на мобілці це єдина точка входу:
      // тап розгортає список підрозділів, повторний тап — згортає й
      // повертає скрол туди, де він був до розгортання.
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'rd-minimenu__toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML =
        '<span>Меню розділу</span>' +
        '<span class="rd-minimenu__toggle-count">' + heads.length + '</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

      var list = document.createElement('div');
      list.className = 'rd-minimenu__list';
      var id = ch.id || '';
      var links = [];
      var savedScrollY = null;

      function closeMenu(restoreScroll) {
        menu.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        if (restoreScroll && savedScrollY !== null) {
          window.scrollTo({ top: savedScrollY, behavior: 'auto' });
        }
        savedScrollY = null;
      }

      toggle.addEventListener('click', function () {
        var isOpen = menu.classList.contains('is-open');
        if (isOpen) {
          closeMenu(true);
        } else {
          savedScrollY = window.scrollY;
          if (window.innerWidth <= 768) {
            var r = toggle.getBoundingClientRect();
            list.style.top = (r.bottom + 8) + 'px';
          }
          menu.classList.add('is-open');
          toggle.setAttribute('aria-expanded', 'true');
        }
      });

      heads.forEach(function (h, i) {
        var slug = (h.getAttribute('id')) || ('sec-' + i);
        if (!h.getAttribute('id')) h.setAttribute('id', id + '-' + slug);
        var a = document.createElement('a');
        a.className = 'rd-minimenu__link';
        a.href = '#' + h.id;
        a.textContent = rdCleanHeading(h.textContent.trim()).split(' ').slice(0, 6).join(' ');
        a.addEventListener('click', function (e) {
          e.preventDefault();
          history.replaceState(null, '', '#' + id);
          showChapter(id);
          // Це вже свідомий перехід до підрозділу, а не "передумав" —
          // тож просто ховаємо меню без відкату скрола на попереднє місце.
          closeMenu(false);
          setTimeout(function () {
            var target = document.getElementById(h.id);
            if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }, 60);
        });
        list.appendChild(a);
        links.push({ head: h, link: a });
      });

      window.addEventListener('scroll', function () {
        if (menu.classList.contains('is-open')) closeMenu(false);
      }, { passive: true });

      menu.appendChild(toggle);
      menu.appendChild(list);
      container.appendChild(menu);
      initMiniMenuScrollspy(links, list);
    });
  }

  // ── Скролспай міні-меню: підсвічує пункт розділу під поточним скролом ──
  function initMiniMenuScrollspy(links, list) {
    if (!links.length || typeof IntersectionObserver === 'undefined') return;
    var current = null;

    function setActive(link) {
      if (link === current) return;
      if (current) current.classList.remove('rd-minimenu__link--active');
      current = link;
      if (!current) return;
      current.classList.add('rd-minimenu__link--active');
      // Горизонтально прокручуємо стрічку пілюль (десктоп); на мобілці
      // список вертикальний і схований, тут просто нічого не станеться.
      var target = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
      if (list.scrollWidth > list.clientWidth) {
        list.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
      }
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var match = links.filter(function (l) { return l.head === entry.target; })[0];
        if (match) setActive(match.link);
      });
    }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });

    links.forEach(function (l) { observer.observe(l.head); });
  }

  // ── Кнопка «вгору» + посилання «На початок розділу» ──
  var toTopBtn = document.createElement('button');
  toTopBtn.className = 'rd-to-top';
  toTopBtn.setAttribute('aria-label', 'Вгору');
  toTopBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(toTopBtn);
  toTopBtn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  window.addEventListener('scroll', function () {
    toTopBtn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  toTopBtn.classList.toggle('visible', window.scrollY > 400);

  function initChapterTopLinks() {
    document.querySelectorAll('.cabinet__chapter').forEach(function (ch) {
      if (ch.id === 'final_exam') return;
      if (ch.querySelector('.rd-to-chapter-top')) return;
      var body = ch.querySelector('.chapter-body');
      if (!body) return;
      var link = document.createElement('a');
      link.className = 'rd-to-chapter-top';
      link.href = '#';
      link.innerHTML = '↑ На початок розділу';
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var head = ch.querySelector('.chapter-head');
        var target = head || ch;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      body.appendChild(link);
    });
  }

  // ── Ініціалізація та інтеграція з іспитом ──
  initChapterTooltips();
  autoReveal();
  initCounters();
  initFlipCards();
  initParallax();
  initChecklists();
  initGlossaryTips();
  initChapterMiniMenu();
  initChapterTopLinks();

  // старт таймера
  var origStartExam = window.startExam;
  window.startExam = function () {
    rdStartExamTimer();
    origStartExam();
  };

  // оновлення кільця при відповідях
  function rdBindRingUpdates() {
    var block = document.getElementById('exam_block');
    if (!block) return;
    block.querySelectorAll('input[type="radio"]').forEach(function (r) {
      r.addEventListener('change', function () {
        var answered = Object.keys(examAnswered).length;
        rdUpdateRing(answered, examTotal);
      });
    });
  }
  rdBindRingUpdates();
  rdUpdateRing(0, examTotal);

  // розбивка по темах у результатах
  var origCheckFinalExam = window.checkFinalExam;
  window.checkFinalExam = function () {
    var resultEl = document.getElementById('examResult');
    var beforePass = !!examPassed;
    var oldInnerHTML = resultEl ? resultEl.innerHTML : '';
    origCheckFinalExam();
    if (examPassed && !beforePass) {
      rdStopExamTimer();
      var r2 = document.getElementById('examResult');
      if (r2) rdAppendBreakdown(r2);
    }
    if (!examPassed && oldInnerHTML === '' && !beforePass) {
      var r3 = document.getElementById('examResult');
      if (r3 && r3.style.display !== 'none' && r3.className.indexOf('fail') !== -1) {
        rdAppendBreakdown(r3);
      }
    }
  };

  var origUpdateExamUI = updateExamUI;
  updateExamUI = function () {
    origUpdateExamUI();
    if (examPassed) {
      rdStopExamTimer();
      var timerEl = document.getElementById('examTimer');
      if (timerEl) timerEl.style.display = 'none';
      var r = document.getElementById('examResult');
      if (r && r.querySelector('.exam__breakdown') === null) rdAppendBreakdown(r);
    }
  };
  if (typeof updateExamUI === 'function') { updateExamUI(); }
})();
