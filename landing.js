var heroEl = document.querySelector('.hero');
var pricingEl = document.getElementById('pricing');
var calculatorEl = document.getElementById('calculator');
var stickyEl = document.getElementById('sticky');
var stickyBtnEl = document.querySelector('.sticky-btn');
var pb = document.getElementById('pb');
function setScrollPad() {
  var nav = document.querySelector('nav');
  document.documentElement.style.setProperty('--scroll-pad', (nav ? nav.offsetHeight : 0) + 'px');
}

function fixCalcMobile() {
  if (window.innerWidth <= 768) {
    var wrap = document.getElementById('calc-wrap-el');
    if (wrap) {
      wrap.style.marginLeft = '0';
      wrap.style.marginRight = '0';
      wrap.style.width = '100%';
      wrap.style.boxSizing = 'border-box';
    }
  }
}

// REVEAL
var obs = new IntersectionObserver(function(entries) {
  entries.forEach(function(e) {
    if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
  });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(function(el) { obs.observe(el); });

// UNIFIED rAF SCROLL — batch reads once, then write
var _st = {ticking:false, pct:0, scrolled:false, hb:0, pt:0, navH:0};
function _scroll(){
  _st.pct = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight) * 100;
  _st.scrolled = window.scrollY > 60;
  _st.navH = (document.querySelector('nav') || {offsetHeight:0}).offsetHeight;
  if(!_st.ticking){
    requestAnimationFrame(function(){
      if(heroEl && pricingEl && stickyEl){
        _st.hb = heroEl.getBoundingClientRect().bottom;
        _st.pt = pricingEl.getBoundingClientRect().top;
        stickyEl.classList.toggle('show', _st.hb < 0 && _st.pt > window.innerHeight);
        document.body.style.paddingBottom = stickyEl.classList.contains('show') ? '64px' : '';
      }
      if(calculatorEl && stickyBtnEl){
        var calcRect = calculatorEl.getBoundingClientRect();
        var calcInView = calcRect.top < window.innerHeight * 0.75 && calcRect.bottom > 0;
        if(calcInView && stickyBtnEl.getAttribute('href') !== '#calc-wrap-el'){
          stickyBtnEl.textContent = 'Порахувати потенціал →';
          stickyBtnEl.setAttribute('href', '#calc-wrap-el');
        } else if(!calcInView && stickyBtnEl.getAttribute('href') !== '#price-target'){
          stickyBtnEl.textContent = 'Отримати курс →';
          stickyBtnEl.setAttribute('href', '#price-target');
        }
      }
      pb.style.width = _st.pct + '%';
      document.body.classList.toggle('scrolled', _st.scrolled);
      document.documentElement.style.setProperty('--scroll-pad', _st.navH + 'px');
      _st.ticking = false;
    });
    _st.ticking = true;
  }
}
window.addEventListener('scroll', _scroll, {passive:true});
setScrollPad(); _scroll();
window.addEventListener('resize', function(){ setScrollPad(); fixCalcMobile(); });
fixCalcMobile();

// CALCULATOR
var budget = 5000, scenario = 'real';
var margin = { cons: 0.08, real: 0.16, opti: 0.25 };
var growth = { cons: 1.07, real: 1.12, opti: 1.18 };
var marginText = { cons:'8%', real:'16%', opti:'25%' };
var lossRate = { cons: [0, -0.08, -0.04], real: [0, -0.06, -0.02], opti: [0, -0.04, 0] };
var fcW = 380, fcH = 180, fcPadT = 28, fcPadB = 28;

function fcSeries(sc, m) {
  var pts = [{t:0, v:0}];
  var cum = 0;
  for (var t = 1; t <= m; t++) {
    if (t <= 2) {
      cum += budget * lossRate[sc][t];
    } else if (t === 3) {
      cum += budget * margin[sc];
    } else {
      cum += budget * margin[sc] * Math.pow(growth[sc], t - 3);
    }
    pts.push({t:t, v: Math.round(cum)});
  }
  return pts;
}
function fcSmoothPath(pts) {
  if (pts.length < 2) return '';
  var d = 'M' + pts[0].x + ',' + pts[0].y;
  for (var i = 0; i < pts.length - 1; i++) {
    var xc = (pts[i].x + pts[i+1].x) / 2, yc = (pts[i].y + pts[i+1].y) / 2;
    d += ' Q' + pts[i].x + ',' + pts[i].y + ' ' + xc + ',' + yc;
  }
  d += ' L' + pts[pts.length-1].x + ',' + pts[pts.length-1].y;
  return d;
}
function setBudget(v, btn) {
  budget = v;
  document.querySelectorAll('.fc-slab').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  updateCalc();
}
function setScenario(sc, el) {
  scenario = sc;
  document.querySelectorAll('.fc-step').forEach(function(b) { b.classList.remove('active'); });
  el.classList.add('active');
  updateCalc();
}
function resetCalc() {
  budget = 5000; scenario = 'real';
  document.querySelectorAll('.fc-slab').forEach(function(b,i){ b.classList.toggle('active', i===2); });
  document.querySelectorAll('.fc-step').forEach(function(b,i){ b.classList.toggle('active', i===1); });
  document.getElementById('ms').value = 12;
  updateCalc();
}
function updateCalc() {
  var m = parseInt(document.getElementById('ms').value);
  var slider = document.getElementById('ms');
  slider.style.setProperty('--range-progress', (((m - slider.min) / (slider.max - slider.min)) * 100) + '%');
  document.getElementById('mv').textContent = m;
  var mt = m === 1 ? '1 місяць' : m < 5 ? m + ' місяці' : m + ' місяців';
  document.getElementById('cmt').textContent = mt;

  var scenes = ['cons','real','opti'];
  var allSeries = {}, allVals = [];
  scenes.forEach(function(sc) {
    var pts = fcSeries(sc, m);
    allSeries[sc] = pts;
    pts.forEach(function(p){ allVals.push(p.v); });
  });
  var minV = Math.min.apply(null, allVals), maxV = Math.max.apply(null, allVals);
  if (minV === maxV) minV -= 1;

  var chartXY = {};
  scenes.forEach(function(sc) {
    chartXY[sc] = allSeries[sc].map(function(p) {
      return { x: (p.t / m) * fcW, y: fcPadT + (maxV - p.v) / (maxV - minV) * (fcH - fcPadT - fcPadB) };
    });
  });

  scenes.forEach(function(sc) {
    var xy = chartXY[sc];
    var elId = sc === 'real' ? 'fcCurve' : 'fcCurve' + sc.charAt(0).toUpperCase() + sc.slice(1);
    var curveEl = document.getElementById(elId);
    curveEl.setAttribute('d', fcSmoothPath(xy));

    var areaElId = sc === 'real' ? 'fcArea' : 'fcArea' + sc.charAt(0).toUpperCase() + sc.slice(1);
    var areaEl = document.getElementById(areaElId);
    if (areaEl) {
      var baseY = fcPadT + (maxV - 0) / (maxV - minV) * (fcH - fcPadT - fcPadB);
      var areaD = fcSmoothPath(xy) + ' L' + xy[xy.length-1].x + ',' + baseY + ' L' + xy[0].x + ',' + baseY + ' Z';
      areaEl.setAttribute('d', areaD);
    }

    if (sc !== 'real') {
      var dotEl = document.getElementById('fcDot' + sc.charAt(0).toUpperCase() + sc.slice(1));
      if (dotEl) { dotEl.setAttribute('cx', xy[xy.length-1].x); dotEl.setAttribute('cy', xy[xy.length-1].y); }
    }
  });

  var last = chartXY[scenario][chartXY[scenario].length-1];
  document.getElementById('fcDot').setAttribute('cx', last.x);
  document.getElementById('fcDot').setAttribute('cy', last.y);
  document.getElementById('fcDot').setAttribute('fill', scenario === 'cons' ? 'var(--muted2)' : scenario === 'opti' ? '#7fd99a' : '#a855f7');
  document.getElementById('fcRing').setAttribute('cx', last.x);
  document.getElementById('fcRing').setAttribute('cy', last.y);
  document.getElementById('fcRing').setAttribute('stroke', scenario === 'cons' ? 'var(--muted2)' : scenario === 'opti' ? '#7fd99a' : '#a855f7');
  document.getElementById('fcEndTag').textContent = 'міс. ' + m;
  document.getElementById('fcEndTag').setAttribute('x', Math.min(last.x, 378));

  var pts = allSeries[scenario];
  var finalVal = pts[pts.length-1].v;
  var result = Math.round(finalVal / 100) * 100;
  var prevVal = pts.length > 1 ? pts[pts.length-2].v : 0;
  var monthly = Math.max(0, Math.round((finalVal - prevVal) / 10) * 10);

  var el = document.getElementById('cr');
  el.textContent = '$' + result.toLocaleString();
  el.className = 'fc-result-num ' + scenario;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');

  document.getElementById('tBudget').textContent = '$' + budget.toLocaleString();
  document.getElementById('tRoi').textContent = marginText[scenario];
  document.getElementById('tMonthly').textContent = '$' + monthly.toLocaleString();

  var monthlyBase = Math.round(budget * margin[scenario]);
  var growthPct = Math.round((growth[scenario] - 1) * 100);
  var extra = Math.max(0, m - 3);
  document.getElementById('fcFormula').textContent =
    '$' + budget.toLocaleString() + ' × ' + marginText[scenario] + ' маржа = $' + monthlyBase.toLocaleString() + '/міс';
  document.getElementById('fcFormulaSub').textContent = extra > 0
    ? '+ ' + growthPct + '% щомісячного зростання × ' + extra + ' міс.'
    : '+ ' + growthPct + '% щомісячного зростання з місяця 3';
}
updateCalc();

// REVIEWS — жодної каруселі, всі картки в сітці

// ===== BOLD FEATURES =====

// 1b. BLOBS — inject colorful morphing blobs into light sections
(function(){
  var colors = ['rgba(240,180,41,0.25)','rgba(180,160,220,0.18)','rgba(100,200,200,0.16)'];
  document.querySelectorAll('.light-section').forEach(function(s){
    if(s.querySelector('.light-blob')) return;
    for(var i=0;i<3;i++){
      var b = document.createElement('div');
      b.className = 'light-blob';
      b.style.cssText = 'background:'+colors[i]+';width:'+(180+i*40)+'px;height:'+(180+i*40)+'px;top:'+(20+i*25)+'%;left:'+(10+i*30)+'%';
      s.appendChild(b);
    }
  });
})();

// 3. SECTION DIVIDER — wave already via CSS mask

// Decorative parallax/tilt effects are intentionally omitted: they add
// continuous pointer work without improving conversion or readability.

// 6. SMOOTH SCROLL × ANCHOR
(function(){
  document.addEventListener('click', function(e){
    var a = e.target.closest('a[href^="#"]');
    if(!a) return;
    var id = a.getAttribute('href').slice(1);
    if(!id) return;
    if(a.hasAttribute('onclick')) return;
    e.preventDefault();
    var el = document.getElementById(id);
    if(!el) return;
    el.scrollIntoView({behavior:'smooth',block:'start'});
  });
})();

// PRICING CAROUSEL — center the main «Вигідна ціна» card on mobile
(function(){
  function centerPricing(){
    var wrap = document.querySelector('.pricing3-wrap');
    var main = wrap ? wrap.querySelector('.pricing3-main') : null;
    if(!wrap || !main) return;
    if(window.innerWidth > 900) { wrap.scrollLeft = 0; return; }
    var wRect = wrap.getBoundingClientRect();
    var mRect = main.getBoundingClientRect();
    var target = wrap.scrollLeft + (mRect.left - wRect.left) - (wrap.clientWidth - main.offsetWidth) / 2;
    if(target < 0) target = 0;
    wrap.scrollLeft = target;
  }
  centerPricing();
  window.addEventListener('resize', centerPricing);
  window.addEventListener('load', function(){ setTimeout(centerPricing, 150); });
})();

// MODALS
var modalContent = {
  offer: {
    title: 'Публічна оферта',
    body: '<p><strong>Договір публічної оферти</strong></p><p>Цей документ є офіційною пропозицією (офертою) на придбання доступу до електронного освітнього продукту «Старт на Amazon» (далі — Курс).</p><p><strong>1. Предмет договору</strong><br>Продавець надає Покупцю персональний доступ до Курсу на онлайн-платформі (особистий кабінет) після здійснення оплати. Доступ діє безстроково, без підписки та додаткових платежів.</p><p><strong>2. Порядок оплати</strong><br>Оплата здійснюється через платіжні сервіси, зазначені на сайті. Після підтвердження оплати доступ до особистого кабінету активується автоматично, дані для входу надсилаються на електронну адресу Покупця протягом 24 годин.</p><p><strong>3. Доставка</strong><br>Курс є цифровим продуктом у форматі онлайн-платформи. Доступ надається виключно через персональний кабінет на сайті, дані для входу — на e-mail, вказаний при оплаті.</p><p><strong>4. Повернення коштів</strong><br>Зважаючи на цифровий характер продукту, повернення коштів після надання доступу до платформи не передбачено.</p><p><strong>5. Авторські права</strong><br>Всі матеріали Курсу є інтелектуальною власністю автора. Передача власного доступу, копіювання матеріалів або їх перепродаж третім особам заборонена.</p><p><strong>6. Прийняття оферти</strong><br>Здійснення оплати є беззастережним прийняттям умов цього договору.</p>'
  },
  disclaimer: {
    title: 'Відмова від відповідальності',
    body: '<p>Використовуючи цей сайт та матеріали посібника «Старт на Amazon», ви підтверджуєте, що ознайомилися з цим документом і погоджуєтесь з його положеннями.</p><p>Автор посібника — Дмитро — є практикуючим продавцем на Amazon і ділиться власним досвідом в освітніх цілях. Всі матеріали надаються «як є» і є актуальними на момент публікації. З огляду на динамічний розвиток платформи Amazon їх зміст може втрачати актуальність з плином часу.</p><p>Результати після проходження курсу залежать від індивідуальних зусиль, стартового капіталу, ринкової ситуації та інших зовнішніх обставин. Автор не гарантує конкретних фінансових результатів, рівня доходу або успішного працевлаштування.</p><p>Автор не несе відповідальності за будь-які збитки, що можуть виникнути в результаті прийнятих вами бізнес-рішень на основі матеріалів посібника. Матеріали не є юридичною, фінансовою або податковою консультацією.</p><p>Усі можливі суперечки вирішуються відповідно до чинного законодавства України. З питаннями звертайтеся через контакти, вказані на сайті.</p>'
  },
  privacy: {
    title: 'Політика конфіденційності',
    body: '<p><strong>Політика конфіденційності</strong></p><p>Ця сторінка пояснює які дані ми збираємо і як їх використовуємо.</p><p><strong>1. Які дані збираємо</strong><br>При оплаті ми отримуємо ім&#39;я та електронну адресу Покупця виключно для надсилання придбаних матеріалів.</p><p><strong>2. Використання даних</strong><br>Дані використовуються лише для обробки замовлення і не передаються третім особам без згоди Покупця.</p><p><strong>3. Cookies</strong><br>Сайт може використовувати технічні cookies для коректної роботи. Дані cookies не містять особистої інформації.</p><p><strong>4. Зберігання даних</strong><br>Електронна адреса зберігається для можливості повторного надсилання матеріалів у разі технічних проблем.</p><p><strong>5. Ваші права</strong><br>Ви маєте право запросити видалення ваших даних, надіславши запит на контактну електронну адресу.</p><p><strong>6. Контакт</strong><br>З питань конфіденційності звертайтесь у Telegram: @startamazon</p>'
  }
};
function openModal(type) {
  var cookieBanner = document.getElementById('cookie-banner');
  if (cookieBanner) {
    cookieBanner.dataset.pausedByModal = '1';
    cookieBanner.style.opacity = '0';
    cookieBanner.style.transform = 'translateY(24px)';
    cookieBanner.style.pointerEvents = 'none';
  }
  document.getElementById('modal-title').textContent = modalContent[type].title;
  document.getElementById('modal-body').innerHTML = modalContent[type].body;
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  var cookieBanner = document.getElementById('cookie-banner');
  if (cookieBanner && cookieBanner.dataset.pausedByModal === '1') {
    delete cookieBanner.dataset.pausedByModal;
    if (!localStorage.getItem('cookies_ok')) {
      cookieBanner.style.opacity = '1';
      cookieBanner.style.transform = 'translateY(0)';
      cookieBanner.style.pointerEvents = 'auto';
    }
  }
}
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

// FAQ
document.querySelectorAll('.faq-trigger').forEach(function(t) {
  t.addEventListener('click', function() {
    var item = t.closest('.faq-item'), open = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(function(i) { i.classList.remove('open'); });
    if (!open) item.classList.add('open');
  });
});

// CURRICULUM ACCORDION (mobile)
document.querySelectorAll('.curr-item').forEach(function(c) {
  c.addEventListener('click', function() {
    c.classList.toggle('open');
  });
});

// CURRICULUM + APPENDICES EXPAND
// Desktop: bottom button toggles both; Mobile: each column button toggles its own.
function toggleAll(btn, col) {
  var isOpen = btn.classList.toggle('open');
  var items;
  if (col) {
    var container = document.getElementById(col + '-col');
    items = container.querySelectorAll('.curr-hidden');
    var listEl = container.querySelector(col === 'apps' ? '.app' : '.curr');
    if (listEl) listEl.classList.toggle('expanded', isOpen);
  } else {
    items = document.querySelectorAll('#curriculum .curr-hidden');
    document.querySelectorAll('#curriculum .curr, #curriculum .app').forEach(function(el) {
      el.classList.toggle('expanded', isOpen);
    });
  }
  items.forEach(function(h) {
    h.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) h.classList.add('visible');
  });
  btn.innerHTML = isOpen
    ? '<span class="curr-expand-btn__label">Згорнути</span><span class="curr-expand-btn__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg></span>'
    : '<span class="curr-expand-btn__label">Розгорнути</span><span class="curr-expand-btn__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>';
  if (!isOpen) {
    var section = document.getElementById(col ? col + '-col' : 'curriculum');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}



// CONFETTI — desktop only
if(!('ontouchstart' in window) && navigator.maxTouchPoints === 0){
var cc = document.getElementById('confetti-canvas');
var ctx2 = cc.getContext('2d');
cc.width = window.innerWidth; cc.height = window.innerHeight;
window.addEventListener('resize', function() { cc.width = window.innerWidth; cc.height = window.innerHeight; });
var pieces = [];
var COLS = ['#F0B429','#f7c95a','#ffe38a','#fff','#F0B429'];
function spawn(x, y) {
  for (var i = 0; i < 80; i++) {
    pieces.push({ x: x, y: y, vx: (Math.random()-0.5)*13, vy: (Math.random()-0.85)*14, size: 4+Math.random()*6, color: COLS[Math.floor(Math.random()*COLS.length)], rot: Math.random()*360, rotS: (Math.random()-0.5)*8, grav: 0.4+Math.random()*0.25, alpha: 1, rect: Math.random()>0.4 });
  }
}
function drawConfetti() {
  ctx2.clearRect(0, 0, cc.width, cc.height);
  pieces = pieces.filter(function(p) { return p.alpha > 0.03; });
  pieces.forEach(function(p) {
    p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.vx *= 0.986; p.rot += p.rotS; p.alpha -= 0.014;
    ctx2.save();
    ctx2.globalAlpha = Math.max(0, p.alpha);
    ctx2.fillStyle = p.color;
    ctx2.translate(p.x, p.y);
    ctx2.rotate(p.rot * Math.PI / 180);
    if (p.rect) { ctx2.fillRect(-p.size/2, -p.size/4, p.size, p.size/2); }
    else { ctx2.beginPath(); ctx2.arc(0, 0, p.size/2.5, 0, Math.PI*2); ctx2.fill(); }
    ctx2.restore();
  });
  if (pieces.length) requestAnimationFrame(drawConfetti);
  else ctx2.clearRect(0, 0, cc.width, cc.height);
}
document.querySelectorAll('.btn-buy-hero, #btn-buy').forEach(function(el) {
  el.addEventListener('click', function(e) {
    spawn(e.clientX, e.clientY); drawConfetti();
  });
});
} // end desktop-only confetti
;
document.addEventListener("DOMContentLoaded",function(){if(!window.location.hash){window.scrollTo(0,0);}else{history.replaceState(null,"",window.location.pathname+window.location.search);}if(typeof updateCalc==='function'){updateCalc(false);}});window.addEventListener('pageshow',function(e){if(e.persisted||!window.location.hash)window.scrollTo(0,0);});window.addEventListener('load',function(){if(!window.location.hash)window.scrollTo(0,0);});
;
// Counter animation
function animateCounter(el, target, duration){
  var start = 0;
  var step = target / (duration / 16);
  var timer = setInterval(function(){
    start += step;
    if(start >= target){
      start = target;
      clearInterval(timer);
    }
    el.textContent = Math.round(start);
  }, 16);
}
(function(){
  var observed = false;
  var obs = new IntersectionObserver(function(entries){
    if(entries[0].isIntersecting && !observed){
      observed = true;
      var flag = document.querySelector('.hs:last-child .hs-val');
      if(flag) flag.classList.add('flag-spinning');
      var cabinet = document.querySelector('.hs:nth-child(3) .hs-val');
      if(cabinet) cabinet.classList.add('cabinet-pop');
      document.querySelectorAll('.hs-val').forEach(function(el){
        var val = parseInt(el.textContent);
        if(!isNaN(val)){
          el.textContent = '0';
          animateCounter(el, val, 1200);
        }
      });
      setTimeout(function(){
        if(flag) flag.classList.remove('flag-spinning');
        if(cabinet) cabinet.classList.remove('cabinet-pop');
      }, 1300);
    }
  }, {threshold: 0.5});
  var stats = document.querySelector('.hero-stats');
  if(stats) obs.observe(stats);
})();

// Counter animation for inc numbers
(function(){
  var incGrid = document.querySelector('.inc-grid');
  if(!incGrid) return;
  var counted = false;
  var obs2 = new IntersectionObserver(function(entries){
    if(entries[0].isIntersecting && !counted){
      counted = true;
      incGrid.querySelectorAll('.inc-val').forEach(function(el){
        var val = parseInt(el.textContent);
        if(!isNaN(val)){
          el.textContent = '0';
          animateCounter(el, val, 1000);
        }
      });
    }
  }, {threshold: 0.4});
  obs2.observe(incGrid);
})();
;
// ── Eyebrow badge text rotation ──
(function(){
  var el = document.getElementById('eyebrowText');
  var badge = document.getElementById('eyebrowBadge');
  if(!el || !badge) return;
  // добавим white-space:nowrap сразу — не давать тексту переносить
  badge.style.whiteSpace = 'nowrap';
  badge.style.overflow = 'hidden';
  badge.style.position = 'relative';
  var texts = [
    'Навчимо продавати на Amazon',
    'Допоможемо знайти товар, який продається',
    'Покажемо, як доставити товар на склад Amazon'
  ];
  var i = 0;
  // inline transition on the text span itself
  el.style.display = 'inline-block';
  el.style.transition = 'opacity 0s, transform 0s';

  setInterval(function(){
    // roll out upward
    el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(function(){
      i = (i + 1) % texts.length;
      el.textContent = texts[i];
      // snap to bottom, then roll in
      el.style.transition = 'none';
      el.style.transform = 'translateY(10px)';
      el.style.opacity = '0';
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          el.style.transition = 'opacity 0.35s cubic-bezier(.22,1,.36,1), transform 0.35s cubic-bezier(.22,1,.36,1)';
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        });
      });
    }, 270);
  }, 4500);
})();
;
(function(){
  function loadGA(){
    if(window._gaLoaded) return;
    window._gaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=G-XGHL9EY2G3';
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', 'G-XGHL9EY2G3');
  }

  function hideBanner(){
    var b = document.getElementById('cookie-banner');
    b.style.opacity='0';
    b.style.transform='translateY(24px)';
    b.style.pointerEvents='none';
  }

  if(localStorage.getItem('cookies_ok')==='1'){ loadGA(); return; }
  if(localStorage.getItem('cookies_ok')==='0') return;

  setTimeout(function(){
    if(document.getElementById('modal-overlay')?.classList.contains('open')) return;
    var b = document.getElementById('cookie-banner');
    b.style.opacity='1';
    b.style.transform='translateY(0)';
    b.style.pointerEvents='auto';
  }, 1000);

  document.getElementById('cookie-decline').addEventListener('click', function(){
    hideBanner();
    localStorage.setItem('cookies_ok','0');
  });

  document.getElementById('cookie-ok').addEventListener('click', function(){
    hideBanner();
    localStorage.setItem('cookies_ok','1');
    loadGA();
  });
})();
;
// CABINET MOCKUP — scroll-driven emergence from depth (desktop only)
// Isolated in its own <script> tag on purpose: an error anywhere else on the
// page must never be able to stop this from running.
(function () {
  try {
    var wrap = document.getElementById('cabScrollWrap');
    if (!wrap) { console.warn('[cab-mockup] #cabScrollWrap not found in DOM'); return; }
    if (window.innerWidth <= 768) return;

    var inner = wrap.querySelector('.cab-frame');
    if (inner) { inner.classList.add('visible'); inner.style.transition = 'none'; }

    wrap.style.transformStyle = 'preserve-3d';
    wrap.style.willChange = 'transform, opacity, filter';

    var minScale = 0.72, maxScale = 1;
    var ticking = false;

    function update() {
      ticking = false;
      var rect = wrap.getBoundingClientRect();
      var vh = window.innerHeight;
      var start = vh * 1.05;
      var end = vh * 0.4;
      var progress = Math.min(1, Math.max(0, (start - rect.top) / (start - end)));
      var eased = progress * progress * (3 - 2 * progress); // smoothstep
      var scale = minScale + (maxScale - minScale) * eased;
      var opacity = 0.15 + 0.85 * eased;
      var translateY = (1 - eased) * 70;
      var rotateX = (1 - eased) * 10;
      var blur = (1 - eased) * 10;
      wrap.style.transform = 'perspective(1400px) translateY(' + translateY.toFixed(1) + 'px) rotateX(' + rotateX.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
      wrap.style.filter = 'blur(' + blur.toFixed(2) + 'px)';
      wrap.style.opacity = opacity.toFixed(3);
    }

    function onScroll() {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  } catch (err) {
    console.error('[cab-mockup] animation failed to init:', err);
  }
})();
;
(function () {
  var overview = document.getElementById('cabOverview');
  var chapter = document.getElementById('cabChapterContent');
  var toggle = document.getElementById('cabPreviewToggle');
  var back = document.getElementById('cabPreviewBack');
  if (!overview || !chapter || !toggle || !back) return;
  function show(open, focus) {
    overview.style.display = open ? 'none' : '';
    chapter.style.display = open ? 'block' : 'none';
    var frame = chapter.closest('.cab-frame');
    if (frame) frame.classList.toggle('preview-reading',open);
    if (open && frame) frame.scrollIntoView({block:'center',behavior:'auto'});
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Повернутися до розділів ←' : 'Відкрити фрагмент розділу →';
    var cursor = document.getElementById('cabCursor');
    if (cursor) cursor.style.display = 'none';
    if (focus) (open ? back : toggle).focus({preventScroll:true});
  }
  toggle.addEventListener('click', function () { show(toggle.getAttribute('aria-expanded') !== 'true', false); });
  back.addEventListener('click', function () { show(false, true); });
  [overview.querySelectorAll('.cab-card')[1],document.getElementById('cabLink1')].forEach(function (el) {
    if (!el) return;
    el.setAttribute('role','button'); el.tabIndex = 0;
    el.setAttribute('aria-label','Відкрити фрагмент розділу 1');
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () { show(true, true); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(true, true); }
    });
  });
})();
// CABINET MOCKUP — cursor wanders around the cabinet
(function(){
  try {
    var sidebar = document.getElementById('cabSidebar');
    var cursor = document.getElementById('cabCursor');
    var overview = document.getElementById('cabOverview');
    var chapterContent = document.getElementById('cabChapterContent');
    var mobileChapterEl = document.getElementById('cabMobileChapterName');

    var links = [];
    for (var i = 0; i <= 6; i++) {
      var el = document.getElementById('cabLink' + i);
      if (el) links.push(el);
    }
    if (!sidebar || !cursor || !overview || !chapterContent || links.length < 3) {
      console.warn('[cab-cursor] element(s) not found');
      return;
    }

    function getScaleOf(el) {
      var st = window.getComputedStyle(el);
      var tr = st.transform || st.webkitTransform;
      if (!tr || tr === 'none') return 1;
      var m = tr.match(/^matrix\(([^,]+),/);
      return m ? parseFloat(m[1]) || 1 : 1;
    }

    function moveCursorTo(el) {
      var frame = sidebar.closest('.cab-frame') || document.querySelector('.cab-frame');
      var scale = frame ? getScaleOf(frame) : 1;
      var sRect = sidebar.getBoundingClientRect();
      var lRect = el.getBoundingClientRect();
      var top = (lRect.top - sRect.top + lRect.height / 2 - 4) / scale;
      var left = (lRect.left - sRect.left + lRect.width - 16) / scale;
      cursor.style.top = top + 'px';
      cursor.style.left = left + 'px';
    }

    function moveCursorToMain(el) {
      var frame = sidebar.closest('.cab-frame') || document.querySelector('.cab-frame');
      var scale = frame ? getScaleOf(frame) : 1;
      var main = sidebar.closest('.cab-body').querySelector('.cab-main');
      var mRect = main.getBoundingClientRect();
      var lRect = el.getBoundingClientRect();
      var top = (lRect.top - mRect.top + lRect.height / 2) / scale;
      var left = (lRect.left - mRect.left + lRect.width / 2) / scale;
      cursor.style.top = top + 'px';
      cursor.style.left = left + 'px';
    }

    // Start: cursor sits on the first sidebar link
    moveCursorTo(links[0]);
    var cur = 0;

    // Step 1: wander down sidebar links slowly
    function wanderDown(i, cb) {
      if (i >= Math.min(4, links.length)) { cb(); return; }
      moveCursorTo(links[i]);
      cur = i;
      setTimeout(function(){ wanderDown(i + 1, cb); }, 800);
    }

    // Step 2: wander across the cards in the main area, then stop on one
    function landOnCards(cb) {
      var cards = overview.querySelectorAll('.cab-card');
      if (cards.length > 1) {
        moveCursorToMain(cards[0]);
        setTimeout(function(){
          moveCursorToMain(cards[1]);
          setTimeout(function(){
            moveCursorToMain(cards[3]);
            setTimeout(function(){
              moveCursorToMain(cards[2]);
              setTimeout(function(){ cb(); }, 1100);
            }, 1100);
          }, 1100);
        }, 1100);
      } else {
        setTimeout(function(){ cb(); }, 300);
      }
    }

    // Full sequence: wander sidebar links, then wander over cards, stop
    setTimeout(function(){
      wanderDown(1, function(){
        setTimeout(function(){
          landOnCards(function(){
            // done — cursor settles on a card
          });
        }, 500);
      });
    }, 1000);

  } catch (err) {
    console.error('[cab-cursor] init failed:', err);
  }
})();
;
// Помітний pointer-follow ефект для карток відгуків на десктопі.
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth <= 768) return;
  document.querySelectorAll('.review-grid .rc').forEach(function(card){
    function moveCard(event){
      var rect = card.getBoundingClientRect();
      var x = (event.clientX - rect.left) / rect.width - .5;
      var y = (event.clientY - rect.top) / rect.height - .5;
      card.style.transition = 'transform .1s cubic-bezier(.22,1,.36,1), box-shadow .18s ease';
      card.style.transform = 'perspective(750px) rotateX(' + (-y * 17).toFixed(2) + 'deg) rotateY(' + (x * 17).toFixed(2) + 'deg) translate3d(' + (x * 10).toFixed(1) + 'px,' + (y * 8 - 3).toFixed(1) + 'px,0) scale(1.035)';
    }
    card.addEventListener('pointermove', moveCard);
    card.addEventListener('pointerenter', function(){
      card.style.willChange = 'transform';
      card.style.zIndex = '3';
    });
    card.addEventListener('pointerleave', function(){
      card.style.transition = '';
      card.style.transform = '';
      card.style.willChange = '';
      card.style.zIndex = '';
    });
  });
})();
;
// Помітний 3D pointer-follow ефект для карток ціни на десктопі.
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth <= 768) return;
  document.querySelectorAll('.pricing3-card').forEach(function(card){
    var targetX = 0, targetY = 0, currentX = 0, currentY = 0, raf = 0, active = false, pop = 0, popTarget = 0;
    function render(){
      currentX += (targetX - currentX) * .16;
      currentY += (targetY - currentY) * .16;
      pop += (popTarget - pop) * .11;
      card.style.transform = 'perspective(820px) rotateX(' + (-currentY * 8 * pop).toFixed(2) + 'deg) rotateY(' + (currentX * 8 * pop).toFixed(2) + 'deg) translate3d(' + (currentX * 6 * pop).toFixed(1) + 'px,' + ((currentY * 5 - 3) * pop).toFixed(1) + 'px,0) scale(' + (1 + .02 * pop).toFixed(4) + ')';
      if (active || Math.abs(targetX - currentX) > .01 || Math.abs(targetY - currentY) > .01 || Math.abs(popTarget - pop) > .01) raf = requestAnimationFrame(render);
      else raf = 0;
    }
    function moveCard(event){
      var rect = card.getBoundingClientRect();
      targetX = (event.clientX - rect.left) / rect.width - .5;
      targetY = (event.clientY - rect.top) / rect.height - .5;
      if (!raf) raf = requestAnimationFrame(render);
    }
    card.addEventListener('pointermove', moveCard);
    card.addEventListener('pointerenter', function(){
      active = true;
      popTarget = 1;
      card.style.transition = 'box-shadow .22s ease';
      card.style.willChange = 'transform';
      card.style.zIndex = '3';
      if (!raf) raf = requestAnimationFrame(render);
    });
    card.addEventListener('pointerleave', function(){
      active = false;
      targetX = 0;
      targetY = 0;
      popTarget = 0;
      card.style.transition = 'transform .42s cubic-bezier(.22,1,.36,1), box-shadow .22s ease';
      if (!raf) raf = requestAnimationFrame(render);
      card.style.willChange = '';
      card.style.zIndex = '';
    });
  });
})();
;
// Помітний 3D pointer-follow ефект для карток типових помилок на десктопі.
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth <= 768) return;
  document.querySelectorAll('.fail-card').forEach(function(card){
    var targetX = 0, targetY = 0, currentX = 0, currentY = 0, raf = 0, active = false, pop = 0, popTarget = 0;
    function render(){
      currentX += (targetX - currentX) * .16;
      currentY += (targetY - currentY) * .16;
      pop += (popTarget - pop) * .11;
      card.style.transform = 'perspective(750px) rotateX(' + (-currentY * 23 * pop).toFixed(2) + 'deg) rotateY(' + (currentX * 23 * pop).toFixed(2) + 'deg) translate3d(' + (currentX * 13 * pop).toFixed(1) + 'px,' + ((currentY * 10 - 4) * pop).toFixed(1) + 'px,0) scale(' + (1 + .06 * pop).toFixed(4) + ')';
      if (active || Math.abs(targetX - currentX) > .01 || Math.abs(targetY - currentY) > .01 || Math.abs(popTarget - pop) > .01) raf = requestAnimationFrame(render);
      else { raf = 0; card.style.transition = ''; }
    }
    card.addEventListener('pointermove', function(event){
      var rect = card.getBoundingClientRect();
      targetX = (event.clientX - rect.left) / rect.width - .5;
      targetY = (event.clientY - rect.top) / rect.height - .5;
      if (!raf) raf = requestAnimationFrame(render);
    });
    card.addEventListener('pointerenter', function(){
      active = true; popTarget = 1; card.style.willChange = 'transform'; card.style.transition = 'none'; card.style.zIndex = '3';
      if (!raf) raf = requestAnimationFrame(render);
    });
    card.addEventListener('pointerleave', function(){
      active = false; targetX = 0; targetY = 0; popTarget = 0;
      card.style.willChange = ''; card.style.zIndex = '';
      if (!raf) raf = requestAnimationFrame(render);
    });
  });
})();
;
// Легкий 3D pointer-follow ефект для головної CTA-кнопки на десктопі.
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth <= 768) return;
  document.querySelectorAll('.hero .btn-buy-hero').forEach(function(button){
    var targetX = 0, targetY = 0, currentX = 0, currentY = 0, raf = 0, active = false, pop = 0, popTarget = 0;
    function render(){
      currentX += (targetX - currentX) * .16;
      currentY += (targetY - currentY) * .16;
      pop += (popTarget - pop) * .12;
      button.style.transform = 'perspective(700px) rotateX(' + (-currentY * 5 * pop).toFixed(2) + 'deg) rotateY(' + (currentX * 5 * pop).toFixed(2) + 'deg) translate3d(' + (currentX * 4 * pop).toFixed(1) + 'px,' + ((currentY * 3 - 2) * pop).toFixed(1) + 'px,0) scale(' + (1 + .025 * pop).toFixed(4) + ')';
      if (active || Math.abs(targetX - currentX) > .01 || Math.abs(targetY - currentY) > .01 || Math.abs(popTarget - pop) > .01) raf = requestAnimationFrame(render);
      else raf = 0;
    }
    button.addEventListener('pointermove', function(event){
      var rect = button.getBoundingClientRect();
      targetX = (event.clientX - rect.left) / rect.width - .5;
      targetY = (event.clientY - rect.top) / rect.height - .5;
      if (!raf) raf = requestAnimationFrame(render);
    });
    button.addEventListener('pointerenter', function(){
      active = true; popTarget = 1; button.style.willChange = 'transform';
      if (!raf) raf = requestAnimationFrame(render);
    });
    button.addEventListener('pointerleave', function(){
      active = false; targetX = 0; targetY = 0; popTarget = 0;
      button.style.willChange = '';
      if (!raf) raf = requestAnimationFrame(render);
    });
  });
})();
;
// Помітний 3D pointer-follow ефект для карток інструментів на десктопі.
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth <= 768) return;
  document.querySelectorAll('.tools-grid .tool').forEach(function(card){
    var targetX = 0, targetY = 0, currentX = 0, currentY = 0, raf = 0, active = false, pop = 0, popTarget = 0;
    function render(){
      currentX += (targetX - currentX) * .16;
      currentY += (targetY - currentY) * .16;
      pop += (popTarget - pop) * .11;
      card.style.transform = 'perspective(820px) rotateX(' + (-currentY * 12 * pop).toFixed(2) + 'deg) rotateY(' + (currentX * 12 * pop).toFixed(2) + 'deg) translate3d(' + (currentX * 7 * pop).toFixed(1) + 'px,' + ((currentY * 5 - 3) * pop).toFixed(1) + 'px,0) scale(' + (1 + .03 * pop).toFixed(4) + ')';
      if (active || Math.abs(targetX - currentX) > .01 || Math.abs(targetY - currentY) > .01 || Math.abs(popTarget - pop) > .01) raf = requestAnimationFrame(render);
      else { raf = 0; card.style.transition = ''; }
    }
    card.addEventListener('pointermove', function(event){
      var rect = card.getBoundingClientRect();
      targetX = (event.clientX - rect.left) / rect.width - .5;
      targetY = (event.clientY - rect.top) / rect.height - .5;
      if (!raf) raf = requestAnimationFrame(render);
    });
    card.addEventListener('pointerenter', function(){
      active = true; popTarget = 1; card.style.willChange = 'transform'; card.style.transition = 'none'; card.style.zIndex = '3';
      if (!raf) raf = requestAnimationFrame(render);
    });
    card.addEventListener('pointerleave', function(){
      active = false; targetX = 0; targetY = 0; popTarget = 0;
      card.style.willChange = ''; card.style.zIndex = '';
      if (!raf) raf = requestAnimationFrame(render);
    });
  });
})();
;
// Small accessibility pass for the existing accordion: preserve its behavior,
// while making the same controls usable with keyboard and assistive technology.
(function(){
  document.querySelectorAll('.faq-item').forEach(function(item){
    var trigger = item.querySelector('.faq-trigger');
    var body = item.querySelector('.faq-body');
    if (!trigger || !body) return;
    trigger.setAttribute('role','button');
    trigger.setAttribute('tabindex','0');
    trigger.setAttribute('aria-expanded', item.classList.contains('open') ? 'true' : 'false');
    trigger.addEventListener('keydown', function(event){
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        trigger.click();
      }
    });
    item.addEventListener('click', function(){
      trigger.setAttribute('aria-expanded', item.classList.contains('open') ? 'true' : 'false');
    });
  });
})();
