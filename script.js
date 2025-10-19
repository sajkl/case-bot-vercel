(function(){
  const balEl = document.querySelector('#balance .value');

  fetch('/api/profile')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(d => { if (d && typeof d.stars !== 'undefined') balEl.textContent = d.stars; })
    .catch(()=>{});

  const disable = (btn, s)=>{ btn.disabled=s; btn.classList.toggle('loading', s); };
  const toast = (m)=>{ let t=document.createElement('div'); t.className='toast'; t.textContent=m;
    document.body.appendChild(t); setTimeout(()=>t.classList.add('show'));
    setTimeout(()=>{t.classList.remove('show'); setTimeout(()=>t.remove(),300)}, 2000);
  };

  document.querySelectorAll('.card').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const caseId = btn.dataset.caseid; // jiga | camry | bmw | lambo
      disable(btn, true);
      fetch('/api/open', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ caseId })
      })
      .then(r => r.json())
    .then(res=>{
  if(res && res.stars!=null) balEl.textContent=res.stars;

  // 1) определяем приз (картинка и заголовок)
  const prizeImg = res?.prize?.image || "/assets/prizes/sample.png";
  const prizeTitle = res?.prize?.title || "Секретный приз";

  // 2) показываем оверлей и запускаем анимации по стадиям
  const oc = document.getElementById('openCase');
  const pImg = oc.querySelector('.prize__img');
  const pTitle = oc.querySelector('.prize__title');

  pImg.src = prizeImg;
  pImg.alt = prizeTitle;
  pTitle.textContent = prizeTitle;

  oc.hidden = false;
  oc.classList.remove('break','shatter','open','reveal');
  oc.classList.add('enter');

  // тайминг: удар → крошка → двери → приз
  setTimeout(()=> oc.classList.add('break'),   180);
  setTimeout(()=> oc.classList.add('shatter'), 520);
  setTimeout(()=> oc.classList.add('open'),    820);
  setTimeout(()=> oc.classList.add('reveal'),  1220);
})
// Закрытие «Забрать» или тап по затемнению
(() => {
  const oc = document.getElementById('openCase');
  oc.addEventListener('click', (e) => {
    if (e.target.classList.contains('open-case__backdrop') ||
        e.target.classList.contains('prize__btn')) {
      oc.classList.remove('enter','break','shatter','open','reveal');
      oc.hidden = true;
    }
  });
})();

    });
  });
})();
