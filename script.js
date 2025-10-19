<script>
(function () {
  const balEl = document.querySelector('#balance .value');
  const oc = document.getElementById('openCase');

  // ---- helpers
  const disable = (btn, s) => { btn.disabled = s; btn.classList.toggle('loading', s); };
  const toast = (m) => {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = m;
    document.body.appendChild(t);
    requestAnimationFrame(()=>t.classList.add('show'));
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300); }, 2000);
  };
  const setPrize = (img, title) => {
    oc.querySelector('.prize__img').src = img;
    oc.querySelector('.prize__img').alt = title;
    oc.querySelector('.prize__title').textContent = title;
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

  // ---- balance (не критично, тихо падаем при ошибке)
  fetch('/api/profile')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(d => { if (d && typeof d.stars !== 'undefined') balEl.textContent = d.stars; })
    .catch(()=>{});

  // ---- click on case cards
  document.querySelectorAll('.card').forEach(btn => {
    btn.addEventListener('click', async () => {
      const caseId = btn.dataset.caseid; // jiga | camry | bmw | lambo
      disable(btn, true);

      // 1) оптимистично показываем анимацию и заглушку приза
      setPrize('/assets/prizes/sample.png', 'Открываем…');
      runOpenAnimation();

      // 2) пробуем получить реальный приз
      try {
        const res = await fetch('/api/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data && data.stars != null) balEl.textContent = data.stars;

        const img = data?.prize?.image || '/assets/prizes/sample.png';
        const title = data?.prize?.title || 'Секретный приз';
        setPrize(img, title);
      } catch (e) {
        console.log('open error:', e);
        // оставляем дефолтный приз и показываем тост
        setPrize('/assets/prizes/sample.png', 'Тестовый приз');
        toast('Сервер недоступен — показан демо-приз');
      } finally {
        disable(btn, false);
      }
    });
  });

  // ---- закрытие оверлея (фон или кнопка "Забрать")
  oc.addEventListener('click', (e) => {
    if (e.target.classList.contains('open-case__backdrop') ||
        e.target.classList.contains('prize__btn')) {
      oc.classList.remove('enter','break','shatter','open','reveal');
      oc.hidden = true;
    }
  });
})();
</script>
