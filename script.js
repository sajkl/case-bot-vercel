<script>
(function () {
  // ===== helpers =====
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const disable = (el, s) => { if(!el) return; el.disabled = s; el.classList.toggle('loading', s); };
  const toast = (m) => {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = m;
    document.body.appendChild(t);
    requestAnimationFrame(()=>t.classList.add('show'));
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300); }, 2000);
  };

  // ===== ensure overlay exists (auto-inject if missing) =====
  let oc = qs('#openCase');
  if (!oc) {
    const tpl = document.createElement('div');
    tpl.innerHTML = `
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
      </div>`;
    document.body.appendChild(tpl.firstElementChild);
    oc = qs('#openCase');
  }

  // ===== prize helpers =====
  const setPrize = (img, title) => {
    qs('.prize__img', oc).src = img;
    qs('.prize__img', oc).alt = title;
    qs('.prize__title', oc).textContent = title;
  };
  const runOpenAnimation = () => {
    oc.hidden = false;
    oc.classList.remove('enter','break','shatter','open','reveal');
    oc.classList.add('enter');
    setTimeout(()=> oc.classList.add('break'),   180);
    setTimeout(()=> oc.classList.add('shatter'), 520);
    setTimeout(()=> oc.classList.add('open'),    820);
    setTimeout(()=> oc.classList.add('reveal'),  1220);
  };
  const closeOverlay = () => {
    oc.classList.remove('enter','break','shatter','open','reveal');
    oc.hidden = true;
  };

  // ===== balance (тихо, без ошибок) =====
  const balEl = qs('#balance .value');
  fetch('/api/profile').then(r=>r.ok?r.json():null)
    .then(d=>{ if(d && typeof d.stars!=='undefined' && balEl) balEl.textContent = d.stars; })
    .catch(()=>{});

  // ===== click handlers for cases (optimistic UI) =====
  qsa('.card').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const caseId = btn.dataset.caseid; // jiga | camry | bmw | lambo
      disable(btn, true);

      // показываем оверлей сразу
      setPrize('/assets/prizes/sample.png', 'Открываем…');
      runOpenAnimation();

      try {
        const res = await fetch('/api/open', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ caseId })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data && data.stars != null && balEl) balEl.textContent = data.stars;

        const img = data?.prize?.image || '/assets/prizes/sample.png';
        const title = data?.prize?.title || 'Секретный приз';
        setPrize(img, title);
      } catch (e) {
        console.log('open error:', e);
        setPrize('/assets/prizes/sample.png', 'Тестовый приз');
        toast('Сервер недоступен — показан демо-приз');
      } finally {
        disable(btn, false);
      }
    });
  });

  // ===== overlay close (backdrop or button) =====
  oc.addEventListener('click', (e) => {
    if (e.target.classList.contains('open-case__backdrop') ||
        e.target.classList.contains('prize__btn')) {
      closeOverlay();
    }
  });
})();
</script>

