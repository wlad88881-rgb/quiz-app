const sessionCode = window.location.pathname.split('/s/')[1];
let quizData = null;
let participantId = null;
const answers = {};

async function init() {
  try {
    const res = await fetch(`/api/sessions/${sessionCode}/quiz`);
    if (!res.ok) {
      const err = await res.json();
      document.getElementById('join-title').textContent = 'Недоступно';
      document.getElementById('join-error').textContent = err.error || 'Тест недоступен';
      return;
    }
    quizData = await res.json();
    document.getElementById('join-title').textContent = quizData.testTitle;

    const savedPid = sessionStorage.getItem('pid_' + sessionCode);
    if (savedPid) {
      participantId = savedPid;
    }
  } catch (e) {
    document.getElementById('join-error').textContent = 'Не удалось подключиться к серверу';
  }
}

async function joinTest() {
  const name = document.getElementById('student-name').value.trim();
  const errorEl = document.getElementById('join-error');
  errorEl.textContent = '';
  if (!name) { errorEl.textContent = 'Введите имя'; return; }

  const res = await fetch(`/api/sessions/${sessionCode}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (!res.ok) { errorEl.textContent = data.error || 'Ошибка'; return; }

  participantId = data.participantId;
  sessionStorage.setItem('pid_' + sessionCode, participantId);
  renderQuiz();
}

function renderQuiz() {
  document.getElementById('screen-join').style.display = 'none';
  document.getElementById('screen-quiz').style.display = 'block';
  document.getElementById('quiz-title').textContent = quizData.testTitle;

  const nav = document.getElementById('q-nav');
  nav.innerHTML = quizData.questions.map((q, i) => `<div id="nav-${q.id}">${i + 1}</div>`).join('');

  const list = document.getElementById('questions-list');
  list.innerHTML = quizData.questions.map((q, i) => `
    <div class="card">
      <strong>${i + 1}. ${escapeHtml(q.text)}</strong>
      <div id="options-${q.id}">
        ${q.options.map((opt, oi) => `
          <label class="option-choice" id="choice-${q.id}-${oi}">
            <input type="${q.multi ? 'checkbox' : 'radio'}" name="${q.id}" value="${oi}"
              onchange="selectAnswer('${q.id}', ${oi}, ${q.multi})">
            ${escapeHtml(opt)}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function selectAnswer(qid, optionIdx, multi) {
  if (multi) {
    if (!answers[qid]) answers[qid] = [];
    const idx = answers[qid].indexOf(optionIdx);
    const checkbox = document.querySelector(`#choice-${qid}-${optionIdx} input`);
    if (checkbox.checked) {
      if (idx === -1) answers[qid].push(optionIdx);
    } else {
      if (idx !== -1) answers[qid].splice(idx, 1);
    }
  } else {
    answers[qid] = optionIdx;
  }

  // подсветка выбранного
  document.querySelectorAll(`[id^="choice-${qid}-"]`).forEach(el => el.classList.remove('selected'));
  const selectedIdxs = multi ? answers[qid] : [answers[qid]];
  selectedIdxs.forEach(i => {
    const el = document.getElementById(`choice-${qid}-${i}`);
    if (el) el.classList.add('selected');
  });

  const hasAnswer = multi ? answers[qid].length > 0 : answers[qid] !== undefined;
  document.getElementById(`nav-${qid}`).classList.toggle('answered', hasAnswer);
}

async function submitQuiz() {
  const errorEl = document.getElementById('submit-error');
  const unanswered = quizData.questions.filter(q => {
    const a = answers[q.id];
    return q.multi ? (!a || a.length === 0) : a === undefined;
  });
  if (unanswered.length > 0) {
    errorEl.textContent = `Осталось без ответа вопросов: ${unanswered.length}. Отправить всё равно можно.`;
  }

  const res = await fetch(`/api/sessions/${sessionCode}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, answers })
  });
  const data = await res.json();
  if (!res.ok) { errorEl.textContent = data.error || 'Ошибка отправки'; return; }

  document.getElementById('screen-quiz').style.display = 'none';
  document.getElementById('screen-result').style.display = 'block';
  document.getElementById('result-score').textContent = `${data.score} / ${data.total}`;
  document.getElementById('result-percent').textContent = Math.round((data.score / data.total) * 100) + '%';
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

init();
