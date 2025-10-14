const balanceEl = document.querySelector('.balance .value');
// Demo: you can wire this to your real balance later
let balance = 25;
balanceEl.textContent = balance;

document.querySelectorAll('.case').forEach((el, idx)=>{
  el.addEventListener('click', ()=>{
    // Placeholder: call your existing /api/open logic here
    alert('Открываем кейс #' + (idx+1) + ' (2999⭐)');
  });
});