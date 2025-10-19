<script>
(function () {
  'use strict';

  // ===== элементы оверлея =====
  const oc = document.getElementById('openCase');
  const pImg   = oc.querySelector('.prize__img');
  const pTitle = oc.querySelector('.prize__title');

  // ===== утилиты =====
  const setPrize = (img, title) => {
    pImg.src = img; pImg.alt = title || 'Приз';
    pTitle.textContent = title || 'Приз';
  };
  const runOpen = () => {
    oc.hidden = false;
    oc.classList.remove('enter','break','shatter','open','reveal');
    // на кадр позже, чтобы сброс применился
    requestAnimationFrame(() => {
      oc.classList.add('enter');
      setTimeout(()=> oc.classList.add('break'),   180);
      setTimeout(()=> oc.classList.add('shatter'), 520);
      setTimeout(()=> oc.classList.add('open'),    820);
      setTimeout(()=> oc.classList.add('reveal'),  1220);
    });
  };
  const closeOpen = () => {
    oc.classList.remove('enter','break','shatter','open','reveal');
    oc.hidden = true;
  };
  const disable = (el, s) => { el.disabled = s; el.classList.toggle('loading', s); };

  // ===== баланс (не критично) =====
  const balEl = document.querySelector('#balance .value');
  fetch('/api/profile')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d && typeof d.stars !== 'undefined') balEl.textContent = d.stars; })
    .catch(()=>{ /* ignore */ });

  // ===== клики по карточкам — ОПТИМИСТИЧНО =====
  document.querySelectorAll('.card').forEach(btn=>{
    btn.addEventListener('click', async () => {
      const caseId = btn.dataset.caseid;  // jiga | camry | bmw | lambo
      disable(btn, true);

      // 1) показываем экран СРАЗУ, без ожидания API
      setPrize('/assets/prizes/sample.png', 'Открываем…');
      runOpen();

      // 2) тянем API и обновляем приз, если ответ пришёл
      try {
        const res = await fetch('/api/open', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ caseId })
        });
        if (!res.ok) throw new Error('HTTP '+res.status);

        const data = await res.json();
        if (data && data.stars != null) balEl.textContent = data.stars;

        setPrize(
          data?.prize?.image || '/assets/prizes/sample.png',
          data?.prize?.title || 'Секретный приз'
        );
      } catch (e) {
        // ничего страшного — остаётся демо-приз
        console.log('open error:', e);
        setPrize('/assets/prizes/sample.png', 'Тестовый приз');
      } finally {
        disable(btn, false);
      }
    });
  });

  // ===== закрытие оверлея (фон или "Забрать") =====
  oc.addEventListener('click', (e) => {
    if (e.target.classList.contains('open-case__backdrop') ||
        e.target.classList.contains('prize__btn')) {
      closeOpen();
    }
  });

  // ===== dev-хук: можно открыть вручную из консоли =====
  window.openCaseTest = function(img='/assets/prizes/sample.png', title='Тестовый приз'){
    setPrize(img, title);
    runOpen();
  };
})();
</script>

