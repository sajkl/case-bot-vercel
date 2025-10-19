<script>
(function () {
  'use strict';

  // --- safety wrapper: предотвращаем фатальные ошибки от внешних инжекторов ---
  try {
    // если какие-то расширения ломают window.ethereum — просто ловим ошибку
    Object.getOwnPropertyDescriptor(window, 'ethereum');
  } catch (err) {
    console.warn('External injector problem suppressed:', err);
  }

  // --- утилиты ---
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const noop = ()=>{};
  const makeToast = (msg) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(()=> t.classList.add('show'));
    setTimeout(()=> { t.classList.remove('show'); setTimeout(()=> t.remove(), 300); }, 2000);
  };
  const toggleLoading = (el, on) => {
    if (!el) return;
    el.disabled = !!on;
    el.classList.toggle('loading', !!on);
  };

  // --- ensure overlay exists: если нет — создаём ---
  function ensureOpenCase() {
    let oc = $('#openCase');
    if (oc) return oc;

    const html = `
      <div id="openCase" class="open-case" hidden>
        <div class="open-case__backdrop"></div>
        <div class="open-case__stage">
          <div class="door door--left"></div>
          <div class="door door--right"></div>
          <div class="lock">
            <div class="lock__body"></div>
            <div class="lock__u"></div>
            <div class="spark spark--1"></div>
            <div class="spark spark--2"></div>
            <div class="spark spark--3"></div>
          </div>
          <div class="prize" aria-live="polite">
            <img class="prize__img" src="/assets/prizes/sample.png" alt="Приз">
            <div class="prize__title">Ваш приз!</div>
            <button class="prize__btn">Забрать</button>
          </div>
        </div>
      </div>
    `.trim();

    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
    return $('#openCase');
  }

  const oc = ensureOpenCase();
  const prizeImgEl = $('.prize__img', oc);
  const prizeTitleEl = $('.prize__title', oc);

  // --- overlay helpers ---
  function setPrize(img, title) {
    try {
      if (prizeImgEl) { prizeImgEl.src = img; prizeImgEl.alt = title || 'Приз'; }
      if (prizeTitleEl) prizeTitleEl.textContent = title || 'Приз';
    } catch (e) { console.warn('setPrize error', e); }
  }

  function runOpenAnimation() {
    try {
      oc.hidden = false;
      oc.classList.remove('enter','break','shatter','open','reveal');
      // small delay to ensure class removal processed
      requestAnimationFrame(()=> oc.classList.add('enter'));
      setTimeout(()=> oc.classList.add('break'),   180);
      setTimeout(()=> oc.classList.add('shatter'), 520);
      setTimeout(()=> oc.classList.add('open'),    820);
      setTimeout(()=> oc.classList.add('reveal'),  1220);
    } catch (e) { console.warn('runOpenAnimation error', e); oc.hidden = false; }
  }

  function closeOverlay() {
    try {
      oc.classList.remove('enter','break','shatter','open','reveal');
      oc.hidden = true;
    } catch (e) { console.warn('closeOverlay error', e); }
  }

  // --- balance fetch (non-blocking) ---
  (function loadBalance(){
    const balEl = $('#balance .value');
    if (!balEl) return;
    fetch('/api/profile').then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d.stars !== 'undefined') balEl.textContent = d.stars; })
      .catch(()=>{ /* ignore */ });
  })();

  // --- click handling (delegation, resilient) ---
  document.addEventListener('click', async (e) => {
    // 1) close overlay when clicking backdrop or "Забрать"
    if (e.target.classList && (e.target.classList.contains('open-case__backdrop') || e.target.classList.contains('prize__btn'))) {
      e.preventDefault();
      closeOverlay();
      return;
    }

    // 2) sheet close
    if (e.target.classList && e.target.classList.contains('sheet-close')) {
      const sheet = $('#sheet');
      if (sheet) { sheet.classList.remove('show'); setTimeout(()=> sheet.hidden = true, 200); }
      return;
    }

    // 3) nav buttons (заглушки)
    const navBtn = e.target.closest('.nav .btn');
    if (navBtn) {
      e.preventDefault();
      $$('.nav .btn').forEach(b => b.classList.remove('active'));
      navBtn.classList.add('active');
      const tab = navBtn.dataset.tab;
      const sheet = $('#sheet');
      if (!sheet) return;
      const title = $('#sheet-title');
      const text = $('#sheet-text');
      if (tab === 'profile') { title.textContent = 'Профиль'; text.textContent = 'Личный кабинет в разработке.'; }
      if (tab === 'vote')    { title.textContent = 'Голосование'; text.textContent = 'Скоро сможете голосовать за кейсы.'; }
      if (tab === 'inv')     { title.textContent = 'Инвентарь'; text.textContent = 'Ваши призы появятся здесь позже.'; }
      sheet.hidden = false; sheet.classList.add('show');
      return;
    }

    // 4) click on case card (closest .card)
    const card = e.target.closest ? e.target.closest('.card') : null;
    if (!card) return;

    // make sure card has dataset.caseid
    const caseId = card.dataset ? card.dataset.caseid : null;
    if (!caseId) {
      console.warn('card missing data-caseid'); return;
    }

    // disable btn
    toggleLoading(card, true);

    // optimistic UI: show overlay and default prize immediately
    setPrize('/assets/prizes/sample.png', 'Открываем…');
    runOpenAnimation();

    // call API in background; update prize when response arrives
    try {
      const res = await fetch('/api/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId })
      });

      if (!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();

      // update balance if provided
      try {
        const balEl = $('#balance .value');
        if (balEl && data && data.stars != null) balEl.textContent = data.stars;
      } catch(e){}

      // update prize
      const img = data?.prize?.image || '/assets/prizes/sample.png';
      const title = data?.prize?.title || 'Секретный приз';
      setPrize(img, title);
    } catch (err) {
      console.warn('open case error:', err);
      setPrize('/assets/prizes/sample.png', 'Тестовый приз');
      makeToast('Сервер недоступен — показан демо-приз');
    } finally {
      toggleLoading(card, false);
    }
  });

  // --- overlay click was already handled above via delegation, but keep a fallback listener ---
  oc.addEventListener && oc.addEventListener('click', (e) => {
    if (e.target.classList && (e.target.classList.contains('open-case__backdrop') || e.target.classList.contains('prize__btn'))) {
      closeOverlay();
    }
  });

  // --- small dev/test hook ---
  window.openCaseTest = function(img = '/assets/prizes/sample.png', title = 'Тестовый приз') {
    setPrize(img, title);
    runOpenAnimation();
  };

  // --- end IIFE ---
})();
</script>

