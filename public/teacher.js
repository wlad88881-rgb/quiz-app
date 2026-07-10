let currentTestId = null;
let currentSessionCode = null;
let socket = null;

// ---------- НАВИГАЦИЯ ----------

function showScreen(id) {
  ['screen-list', 'screen-editor', 'screen-session'].forEach(s => {
    document.getElementById(s).style.display = (s === id) ? 'block' : 'none';
  });
}

async function showList() {
  showScreen('screen-list');
  const res = await fetch('/api/tests');
  const tests = await res.json();
  const container = document.getElementById('tests-list');
  if (tests.length === 0) {
    container.innerHTML = '<p class="muted">Тестов пока нет — создайте первый.</p>';
    return;
  }
  container.innerHTML = tests.map(t => `
    <div class="card row between">
      <div>
        <strong>${escapeHtml(t.title)}</strong>
        <div class="muted">${t.questions.length} вопрос(ов)</div>
      </div>
      <div class="row">
        <button class="btn small" onclick="startSession('${t.id}')">Начать сессию</button>
        <button class="btn outline small" onclick="editTest('${t.id}')">Изменить</button>
        <button class="btn danger small" onclick="deleteTest('${t.id}')">Удалить</button>
      </div>
    </div>
  `).join('');
}

// ---------- РЕДАКТОР ТЕСТА ----------

function showEditor() {
  currentTestId = null;
  document.getElementById('editor-title').textContent = 'Новый тест';
  document.getElementById('test-title').value = '';
  document.getElementById('questions-container').innerHTML = '';
  document.getElementById('save-error').textContent = '';
  addQuestion();
  showScreen('screen-editor');
}

async function editTest(id) {
  const res = await fetch('/api/tests/' + id);
  const test = await res.json();
  currentTestId = id;
  document.getElementById('editor-title').textContent = 'Редактирование теста';
  document.getElementById('test-title').value = test.title;
  document.getElementById('questions-container').innerHTML = '';
  test.questions.forEach(q => addQuestion(q));
  showScreen('screen-editor');
}

async function deleteTest(id) {
  if (!confirm('Удалить этот тест?')) return;
  await fetch('/api/tests/' + id, { method: 'DELETE' });
  showList();
}

let qCounter = 0;

function addQuestion(existing) {
  qCounter++;
  const qid = 'newq' + qCounter;
  const wrap = document.createElement('div');
  wrap.className = 'question-block';
  wrap.id = qid;

  const optionsHtml = (existing ? existing.options : ['', '']).map((opt, i) => optionRowHtml(qid, i, opt)).join('');

  wrap.innerHTML = `
    <div class="row between">
      <label style="margin-top:0">Вопрос</label>
      <button class="btn outline small" onclick="document.getElementById('${qid}').remove()">Удалить вопрос</button>
    </div>
    <input type="text" class="q-text" value="${existing ? escapeAttr(existing.text) : ''}" placeholder="Текст вопроса">
    <label><input type="checkbox" class="q-multi" ${existing && existing.multi ? 'checked' : ''} style="width:auto"> Несколько правильных ответов</label>
    <label>Варианты ответа (отметьте правильный/правильные)</label>
    <div class="options-container">${optionsHtml}</div>
    <button class="btn outline small" style="margin-top:8px" onclick="addOption('${qid}')">+ Вариант ответа</button>
  `;
  document.getElementById('questions-container').appendChild(wrap);

  if (existing) {
    const correctArr = existing.multi ? existing.correct : [existing.correct];
    correctArr.forEach(idx => {
      const cb = wrap.querySelectorAll('.opt-correct')[idx];
      if (cb) cb.checked = true;
    });
  }
}

function optionRowHtml(qid, i, value) {
  return `
    <div class="option-row" data-idx="${i}">
      <input type="checkbox" class="opt-correct" title="Правильный вариант">
      <input type="text" class="opt-text" value="${escapeAttr(value || '')}" placeholder="Вариант ${i + 1}">
      <button class="btn outline small" onclick="this.parentElement.remove()">✕</button>
    </div>
  `;
}

function addOption(qid) {
  const container = document.querySelector('#' + qid + ' .options-container');
  const div = document.createElement('div');
  div.innerHTML = optionRowHtml(qid, container.children.length, '');
  container.appendChild(div.firstElementChild);
}

async function saveTest() {
  const title = document.getElementById('test-title').value.trim();
  const errorEl = document.getElementById('save-error');
  errorEl.textContent = '';

  if (!title) { errorEl.textContent = 'Введите название теста'; return; }

  const blocks = document.querySelectorAll('.question-block');
  if (blocks.length === 0) { errorEl.textContent = 'Добавьте хотя бы один вопрос'; return; }

  const questions = [];
  for (const block of blocks) {
    const text = block.querySelector('.q-text').value.trim();
    const multi = block.querySelector('.q-multi').checked;
    const optionRows = block.querySelectorAll('.option-row');
    const options = [];
    const correctIdxs = [];
    optionRows.forEach((row, i) => {
      const val = row.querySelector('.opt-text').value.trim();
      if (val) {
        options.push(val);
        if (row.querySelector('.opt-correct').checked) correctIdxs.push(options.length - 1);
      }
    });
    if (!text || options.length < 2 || correctIdxs.length === 0) {
      errorEl.textContent = 'Каждый вопрос должен иметь текст, минимум 2 варианта и хотя бы один правильный ответ';
      return;
    }
    questions.push({
      text,
      options,
      multi,
      correct: multi ? correctIdxs : correctIdxs[0]
    });
  }

  const payload = { title, questions };
  const url = currentTestId ? '/api/tests/' + currentTestId : '/api/tests';
  const method = currentTestId ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) { errorEl.textContent = 'Не удалось сохранить тест'; return; }
  showList();
}

// ---------- СЕССИЯ ----------

async function startSession(testId) {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testId })
  });
  const data = await res.json();
  openSession(data.session.code, data);
}

async function openSession(code, createData) {
  currentSessionCode = code;
  const data = createData || await (await fetch('/api/sessions/' + code)).json();
  const session = createData ? data.session : data;

  document.getElementById('session-title').textContent = session.testTitle;
  document.getElementById('session-code').textContent = code;
  document.getElementById('session-link').textContent = createData ? createData.url : window.location.origin + '/s/' + code;
  if (createData) {
    document.getElementById('qr-img').src = createData.qrDataUrl;
  } else {
    // восстановление QR по коду
    const ip = window.location.hostname;
    document.getElementById('qr-img').src = ''; // не критично при повторном открытии
  }

  setSessionEndedUI(session.ended);
  renderParticipants(session.participants || {});
  showScreen('screen-session');

  connectSocket(code);
}

function setSessionEndedUI(ended) {
  const badge = document.getElementById('session-status');
  const endBtn = document.getElementById('end-session-btn');
  if (ended) {
    badge.textContent = 'Завершено';
    badge.className = 'badge ended';
    endBtn.disabled = true;
  } else {
    badge.textContent = 'Идёт тестирование';
    badge.className = 'badge live';
    endBtn.disabled = false;
  }
}

function connectSocket(code) {
  if (socket) socket.disconnect();
  socket = io();
  socket.emit('teacher:watch', code);
  socket.on('participant:joined', (p) => {
    upsertParticipantRow(p);
  });
  socket.on('participant:finished', (p) => {
    upsertParticipantRow(p);
  });
  socket.on('session:ended', () => {
    setSessionEndedUI(true);
  });
}

const participantRows = {};

function renderParticipants(participants) {
  document.getElementById('results-body').innerHTML = '';
  Object.keys(participantRows).forEach(k => delete participantRows[k]);
  Object.values(participants)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .forEach(p => upsertParticipantRow(p));
}

function upsertParticipantRow(p) {
  const tbody = document.getElementById('results-body');
  document.getElementById('no-participants').style.display = 'none';

  let row = participantRows[p.id];
  if (!row) {
    row = document.createElement('tr');
    participantRows[p.id] = row;
    tbody.appendChild(row);
  }
  const status = p.finished
    ? '<span class="badge live">Завершил</span>'
    : '<span class="badge" style="background:#fff3e0;color:#b26a00">Проходит</span>';
  const score = p.finished ? `${p.score} / ${p.total}` : '—';
  row.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${status}</td><td>${score}</td>`;
}

async function endSession() {
  if (!confirm('Завершить сессию? Ученики больше не смогут отправлять ответы.')) return;
  await fetch('/api/sessions/' + currentSessionCode + '/end', { method: 'POST' });
  setSessionEndedUI(true);
}

function exportResults() {
  window.location.href = '/api/sessions/' + currentSessionCode + '/export';
}

// ---------- УТИЛИТЫ ----------

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------- СТАРТ ----------
showList();
