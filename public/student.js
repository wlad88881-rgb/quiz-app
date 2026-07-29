<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Прохождение теста</title>
  <link rel="stylesheet" href="/style.css">
  <style>
    #timer {
      display: none;
      align-items: center;
      gap: 16px;
      background: #fff;
      padding: 14px 24px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      margin-bottom: 24px;
      border: 1px solid #e0e0e0;
    }
    #timer .timer-icon { font-size: 22px; }
    #timer .timer-time { font-weight: 700; font-size: 24px; min-width: 60px; color: #2C3E50; font-variant-numeric: tabular-nums; }
    #timer .timer-track { flex: 1; height: 6px; background: #eee; border-radius: 4px; overflow: hidden; }
    #timer .timer-bar { height: 100%; background: #2e9e4f; width: 100%; border-radius: 4px; transition: width 0.3s ease; }
    #timer.timer-urgent .timer-time { color: #d64545; }
    .timer-notice { display: none; background: #fdeaea; color: #d64545; padding: 12px 16px; border-radius: 8px; font-weight: 600; margin-bottom: 20px; border: 1px solid #d64545; }
  </style>
</head>
<body>
<div class="container">
  <!-- Шапка с переключателем языка -->
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
    <div style="font-weight: 700; color: #2C3E50;">ERG Тестирование</div>
    <div style="display: flex; gap: 8px; align-items: center;">
      <button onclick="setLang('ru')" style="background: none; border: 1px solid #2C3E50; color: #2C3E50; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-weight: 600;">RU</button>
      <button onclick="setLang('kz')" style="background: none; border: 1px solid #2C3E50; color: #2C3E50; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-weight: 600;">KZ</button>
    </div>
  </div>

  <!-- Экран входа -->
  <div id="screen-join">
    <h1 id="join-title">Загрузка...</h1>
    <div id="join-error" class="error"></div>
    <input type="text" id="student-name" placeholder="Введите ваше имя">
    <button class="btn" id="btn-join" onclick="joinTest()">Присоединиться</button>
  </div>

  <!-- Экран теста -->
  <div id="screen-quiz" style="display:none;">
    <h1 id="quiz-title"></h1>
    <div id="timer">
      <div class="timer-icon">⏱️</div>
      <div class="timer-time">00:00</div>
      <div class="timer-track"><div class="timer-bar" id="timer-bar"></div></div>
    </div>
    <div id="timer-notice" class="timer-notice">⏰ Время вышло! Результат отправлен автоматически.</div>
    <div id="q-nav" class="q-nav"></div>
    <div id="questions-list"></div>
    <div id="submit-error" class="error" style="margin-top:10px;"></div>
    <button class="btn" id="btn-submit" onclick="submitQuiz()">Завершить тест</button>
  </div>

  <!-- Экран результатов -->
  <div id="screen-result" style="display:none;">
    <h1 id="lbl-results">Результаты</h1>
    <p style="font-size:24px; font-weight:700;">
      <span id="result-score">0</span> / <span id="result-total">0</span>
      (<span id="result-percent">0%</span>)
    </p>
    <div id="review-list"></div>
    <button class="btn outline" id="btn-restart" onclick="location.reload()">Вернуться к началу</button>
  </div>
</div>

<script src="/student.js"></script>
<script src="/translations.js"></script>
<script>
  function applyTranslations() {
    const joinBtn = document.getElementById('btn-join');
    if (joinBtn) joinBtn.textContent = t('studentJoin');
    
    const nameInput = document.getElementById('student-name');
    if (nameInput) nameInput.placeholder = t('studentEnterName');
    
    const submitBtn = document.getElementById('btn-submit');
    if (submitBtn) submitBtn.textContent = t('btnSubmit');
    
    const notice = document.getElementById('timer-notice');
    if (notice) notice.textContent = t('timerEnded');
    
    const resultsTitle = document.getElementById('lbl-results');
    if (resultsTitle) resultsTitle.textContent = t('studentResults');
    
    const restartBtn = document.getElementById('btn-restart');
    if (restartBtn) restartBtn.textContent = t('btnBack');
  }

  window.setLang = function(lang) {
    currentLang = lang;
    applyTranslations();
    // Перезагружаем страницу, чтобы обновить язык у тестов
    location.reload();
  };

  document.addEventListener('DOMContentLoaded', applyTranslations);
</script>
</body>
</html>
