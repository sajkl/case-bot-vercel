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
      .then(res => {
        if (res && res.stars != null) balEl.textContent = res.stars;
        toast(res?.prize?.title ? `Вы выиграли: ${res.prize.title}` : 'Кейс открыт!');
      })
      .catch(()=> toast('Ошибка открытия кейса'))
      .finally(()=> disable(btn,false));
    });
  });
})();
