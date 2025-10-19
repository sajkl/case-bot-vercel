<script>
(function () {
  // ===== helpers =====
  const $  = (sel, r=document) => r.querySelector(sel);
  const $$ = (sel, r=document) => Array.from(r.querySelectorAll(sel));
  const disable = (el, s)=>{ if(!el) return; el.disabled=s; el.classList.toggle('loading', s); };
  const toast = (m)=>{
    const t=document.createElement('div'); t.className='toast'; t.textContent=m;
    document.body.appendChild(t); requestAnimationFrame(()=>t.classList.add('show'));
    setTimeout(()=>{t.classList.remove('show'); setTimeout(()=>t.remove(),300)}, 1800);
  };

  // ===== ensure overlay exists (auto-inject) =====
  function ensureOpenCase(){
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
      </div>`;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
    return $('#openCase');
  }
  const oc = ensureOpenCase();

  // prize helpers
  const setPrize = (img, title)=>{
    $('.prize__img', oc).src = img;
    $('.prize__img', oc).alt = title;
    $('.prize__title', oc).textContent = title;
  };
  const runOpenAnimation = ()=>{
    oc.hidden = false;
    oc.classList.remove('enter','break','shatter','open','reveal');
    oc.classList.add('enter');
    setTimeout(()=> oc.classList.add('break'),   180);
    setTimeout(()=> oc.classList.add('shatter'), 520);
    setTimeout(()=> oc.classList.add('open'),    820);
    setTimeout(()=> oc.classList.add('reveal'),  1220);
  };
  const closeOverlay = ()=>{
    oc.classList.remove('enter','break','shatter','open','reveal');
    oc.hidden = true;
  };

  // ===== balance (тихо) =====
  const balEl = $('#balance .value');
  fetch('/api/profile')
    .then(r=>r.ok?r.json():null)
    .then(d=>{ if(d && typeof d.stars!=='undefined' && balEl) balEl.textContent=d.stars; })
    .catch(()=>{});

  // ===== CLICK via delegation (на случай, если .card подгружается динамически) =====
  document.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.card');
    if (!btn) return;

    const caseId = btn.dataset.caseid;
    disable(btn, true);

    // 1) оптимистично — показываем анимацию сейчас
    setPrize('/assets/prizes/sample.png', 'Открываем…');
    runOpenAnimation();

    // 2) параллельно тянем API, если упадёт — оставим демо
    try {
      const res = await fetch('/api/open', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ caseId })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && data.stars != null && balEl) balEl.textContent = data.stars;
      const img = data?.prize?.image || '/assets/prizes/sample.png';
      const title = data?.prize?.title || 'Секретный приз';
      setPrize(img, title);
    } catch (err) {
      console.log('open error:', err);
      setPrize('/assets/prizes/sample.png', 'Тестовый приз');
      toast('Сервер недоступен — показан демо-приз');
    } finally {
      disable(btn, false);
    }
  });

  // ===== закрытие по фону или "Забрать" =====
  oc.addEventListener('click', (e)=>{
    if (e.target.classList.contains('open-case__backdrop') ||
        e.target.classList.contains('prize__btn')) {
      closeOverlay();
    }
  });

  // ===== тест-хук: window.openCaseTest() для ручной проверки =====
  window.openCaseTest = function(){
    setPrize('/assets/prizes/sample.png', 'Тестовый приз');
    runOpenAnimation();
  };
})();
</script>

