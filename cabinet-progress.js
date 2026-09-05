(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.createCourseProgress = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  var keys = ['sa_read', 'sa_last_chapter', 'sa_bookmarks', 'sa_flashcards',
    'sa_homework', 'sa_homework_answers', 'sa_exam_passed', 'sa_streak', 'sa_theme',
    'sa_tour_seen', 'sa_active_tab', 'sa_overview_tab', 'sa_sidebar_open_mobile', 'sa_display_name'];
  function allowed(k) { return keys.includes(k) || /^hw_marked_[a-z0-9_]+$/.test(k); }
  function parse(raw, fallback) { try { return JSON.parse(raw) ?? fallback; } catch (_) { return fallback; } }
  function list(raw) { var v = parse(raw, []); return Array.isArray(v) ? v : []; }
  return function createCourseProgress(client, storage, options) {
    options = options || {};
    var owner, cacheKey, ready = false, pending = {}, server = {}, timer, running;
    var revision = 0;
    function status(value) { if (options.onStatus) options.onStatus(value); }
    function persist() { storage.setItem(cacheKey, JSON.stringify(pending)); }
    function writeLocal(k, v) { if (v == null) storage.removeItem(k); else storage.setItem(k, v); }
    function clearView() {
      var names = [];
      for (var i = 0; i < storage.length; i++) if (allowed(storage.key(i))) names.push(storage.key(i));
      names.forEach(function (k) { storage.removeItem(k); });
    }
    async function init(session) {
      if (!session || !session.user) throw new Error('session_required');
      owner = session.user.id;
      cacheKey = 'sa_pending::' + owner + '::amazon-course';
      var result = await client.from('course_progress').select('data').eq('user_id', owner).maybeSingle();
      if (result.error) throw result.error; // Never overwrite the server after a failed read.
      server = result.data && result.data.data || {};
      var savedPending = parse(storage.getItem(cacheKey), {});
      pending = {};
      Object.keys(savedPending).forEach(function (k) {
        var p = savedPending[k];
        if (allowed(k) && p && (p.value === null || typeof p.value === 'string')) {
          pending[k] = {value: p.value, base: p.base, rev: ++revision};
        }
      });
      // Import the legacy local copy only when the account has no server row.
      if (!result.data && storage.getItem('sa_user') === session.user.email.toLowerCase()) {
        for (var i = 0; i < storage.length; i++) {
          var k = storage.key(i);
          if (allowed(k) && !pending[k]) pending[k] = {value: storage.getItem(k), base: null, rev: ++revision};
        }
      }
      clearView();
      Object.keys(server).filter(allowed).forEach(function (k) { writeLocal(k, server[k]); });
      Object.keys(pending).forEach(function (k) { writeLocal(k, pending[k].value); });
      if (!storage.getItem('sa_display_name') && !Object.hasOwn(server, 'sa_display_name')) {
        var profile = await client.from('profiles').select('display_name').eq('id', owner).maybeSingle();
        var name = profile.data && profile.data.display_name || session.user.user_metadata && session.user.user_metadata.display_name;
        if (name) writeLocal('sa_display_name', name);
      }
      storage.setItem('sa_user', session.user.email.toLowerCase());
      persist();
      ready = true;
      status(Object.keys(pending).length ? 'pending' : 'saved');
      if (Object.keys(pending).length) schedule();
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(flush, 500); }
    function set(k, value) {
      if (!ready || !allowed(k)) return;
      var serialized = value === null ? null : typeof value === 'string' ? value : JSON.stringify(value);
      if (storage.getItem(k) === serialized) return;
      var base = pending[k] ? pending[k].base : storage.getItem(k);
      writeLocal(k, serialized);
      pending[k] = {value: serialized, base: base, rev: ++revision};
      persist();
      status('pending');
      schedule();
    }
    async function drain() {
      try {
        while (Object.keys(pending).length) {
          var sessionResult = await client.auth.getSession();
          var session = sessionResult.data && sessionResult.data.session;
          if (sessionResult.error || !session || session.user.id !== owner) throw new Error('session_changed');
          var batch = Object.assign({}, pending), patch = {}, lists = {};
          Object.keys(batch).forEach(function (k) {
            var p = batch[k];
            if ((k === 'sa_read' || k === 'sa_bookmarks') && p.value !== null) {
              var before = list(p.base), after = list(p.value);
              lists[k] = {add: after.filter(function (v) { return !before.includes(v); }),
                remove: before.filter(function (v) { return !after.includes(v); })};
            } else patch[k] = p.value;
          });
          var result = await client.rpc('save_course_progress', {p_patch: patch, p_lists: lists});
          if (result.error) throw result.error;
          server = result.data;
          Object.keys(batch).forEach(function (k) {
            if (pending[k] && pending[k].rev === batch[k].rev) delete pending[k];
            else if (pending[k]) pending[k].base = batch[k].value;
          });
          persist();
        }
        status('saved');
        return true;
      } catch (error) {
        status('error');
        if (options.onError) options.onError(error);
        return false;
      }
    }
    function flush() {
      clearTimeout(timer);
      if (!ready) return Promise.resolve(false);
      if (!running) running = drain().finally(function () { running = null; });
      return running;
    }
    return {init: init, set: set, flush: flush, clearView: clearView, allowed: allowed};
  };
});
