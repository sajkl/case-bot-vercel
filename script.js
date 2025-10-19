<script>
(function () {
  'use strict';

  // 1) Находим оверлей
  const oc = document.getElementById('openCase');
  const pImg = oc.querySelector('.prize__img');
  const pTitle = oc.querySelector('.prize__title');

  // 2) Примитивные функции показа/скрытия
  const setPrize = (img, title) => {
    pImg.src = img; pImg.alt = title || 'Приз';
    pTitle.textContent = title || 'Приз';
  };
  const openOverlay = () => {
    oc.hidden = false;
    // уберём анимационные классы, чтобы даже без CSS-анимаций было видно
    oc.classList.remove('enter','break','shatter','open','reveal');
  };
  const closeOverlay = () => { oc.hidden = true; };

  // 3) Клик по карточкам — просто показываем экран (без API)
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;

    // демо-приз, чтобы было что показать
    setPrize('/assets/prizes/sample.png', 'Тестовый приз');
    openOverlay();
  });

  // 4) Закрытие по клику на фон или кнопку "Забрать"
  oc.addEventListener('click', (e) => {
    if (e.target.classList.contains('open-case__backdrop') ||
        e.target.classList.contains('prize__btn')) {
      closeOverlay();
    }
  });

  // 5) Горячая клавиша "O" — открыть для проверки
  document.addEventListener('keydown', (e) => {
    if (e.key === 'o' || e.key === 'O') {
      setPrize('/assets/prizes/sample.png', 'Тестовый приз (hotkey)');
      openOverlay();
    }
  });

  // 6) Автотест через 700 мс — сразу покажет оверлей при загрузке
  window.addEventListener('load', () => {
    setTimeout(() => {
      setPrize('/assets/prizes/sample.png', 'Тестовый приз (auto)');
      openOverlay();
    }, 700);
  });
})();
</script>

