// Load the course body before the application code starts.
(async function () {
  try {
    var target = document.getElementById('cabinetContent');
    var response = await fetch('cabinet-content.html', { cache: 'default' });
    if (!response.ok) throw new Error('Course content request failed');
    target.innerHTML = await response.text();

    for (const src of [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4',
      'supabase-config.js?v=2',
      'cabinet.js?v=54'
    ]) {
      await new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }
  } catch (error) {
    document.body.classList.add('cabinet-load-error');
    console.error('Не вдалося завантажити кабінет.', error);
  }
})();
