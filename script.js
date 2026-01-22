(function () {
  'use strict';

  // --- 0) TELEGRAM WEB APP INIT (Самое важное) ---
  // Проверяем, доступны ли объекты Телеграма
  const tg = window.Telegram.WebApp;

  if (tg) {
    tg.expand(); // Принудительно раскрываем на 100% высоты
    // tg.enableClosingConfirmation(); // Можно включить подтверждение закрытия, если нужно
  }

  // 1) Находим оверлей
  const oc = document.getElementById('openCase');
  
  // Проверка на случай, если скрипт загрузился раньше HTML (или ID неверен)
  if (!oc) {
    console.error('Element #openCase not found!');
    return;
  }

  const pImg = oc.querySelector('.prize__img');
  const pTitle = oc.querySelector('.prize__title');

  // 2) Примитивные функции показа/скрытия
  const setPrize = (img, title) => {
    if(pImg) { pImg.src = img; pImg.alt = title || 'Приз'; }
    if(pTitle) { pTitle.textContent = title || 'Приз'; }
  };

  const openOverlay = () => {
    oc.hidden = false;
    // Снимаем классы анимаций, чтобы состояние сбросилось
    oc.classList.remove('enter', 'break', 'shatter', 'open', 'reveal');
    
    // Небольшой хак: добавляем класс show через мгновение, чтобы CSS transitions сработали, если они есть
    requestAnimationFrame(() => {
        oc.classList.add('show');
    });
  };

  const closeOverlay = () => {
    oc.hidden = true;
    oc.classList.remove('show');
  };

  // 3) Клик по карточкам — просто показываем экран (без API)
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;

    // Сюда потом подключим реальную логику (какой именно кейс открыли)
    // Пока демо-приз:
    setPrize('/assets/prizes/sample.png', 'Тестовый приз');
    openOverlay();
    
    // Вибрация (Haptic Feedback) для приятного ощущения в телефоне
    if (tg && tg.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
  });

  // 4) Закрытие по клику на фон или кнопку "Забрать"
  oc.addEventListener('click', (e) => {
    if (e.target.classList.contains('open-case__backdrop') ||
        e.target.classList.contains('prize__btn') || 
        e.target.closest('.back')) { // Если добавишь кнопку назад внутри
      closeOverlay();
    }
  });

  // 5) Горячая клавиша "O" — открыть для проверки (для десктопа)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'o' || e.key === 'O') {
      setPrize('/assets/prizes/sample.png', 'Тестовый приз (hotkey)');
      openOverlay();
    }
  });

  // 6) Автотест (Я его ЗАКОММЕНТИРОВАЛ, чтобы не мешал при запуске)
  /*
  window.addEventListener('load', () => {
    setTimeout(() => {
      setPrize('/assets/prizes/sample.png', 'Тестовый приз (auto)');
      openOverlay();
    }, 700);
  });
  */

})();
