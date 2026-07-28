let currentTestId = null;
let currentSessionCode = null;
let currentSessionType = 'quiz';
let socket = null;

// ---------- ВКЛАДКИ ----------

function switchTab(tab) {
  document.getElementById('tab-btn-tests').classList.toggle('active', tab === 'tests');
  document.getElementById('tab-btn-labs').classList.toggle('active', tab === 'labs');
  document.getElementById('tab-tests').style.display = tab === 'tests' ? 'block' : 'none';
  document.getElementById('tab-labs').style.display = tab === 'labs' ? 'block' : 'none';
  if (tab === 'labs') showLabsList();
}

async function showLabsList() {
  const res = await fetch('/api/labs');
  const labs = await res.json();
  const container = document.getElementById('labs-list');
  if (labs.length === 0) {
    container.innerHTML = '<p class="muted">Тренажёров пока нет.</p>';
    return;
  }
  container.innerHTML = labs.map(l => `
    <div class="card row between">
      <div>
        <strong>${escapeHtml(l.title)}</strong>
        <div class="muted">${l.faultCount} тип(ов) неисправностей, с вариациями показаний</div>
      </div>
      <div class="row">
        <button class="btn small" onclick="startLabSession('${l.id}')">Начать сессию</button>
        <button class="btn outline small" onclick="editLab('${l.id}')">Изменить</button>
        <button class="btn danger small" onclick="deleteLab('${l.id}')">Удалить</button>
      </div>
    </div>
  `).join('');
}

// ---------- НАВИГАЦИЯ ----------

function showScreen(id) {
  ['screen-list', 'screen-editor', 'screen-lab-editor', 'screen-session'].forEach(s => {
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
  } else {
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
  if (document.getElementById('tab-btn-labs').classList.contains('active')) showLabsList();
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
    questions.push({ text, options, multi, correct: multi ? correctIdxs : correctIdxs[0] });
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

// ---------- РЕДАКТОР ТРЕНАЖЁРА ----------

let currentLabId = null;
let labFaultCounter = 0;

const SOUND_TYPES = [
  { value: 'grinding', label: 'Скрежет (шум с потрескиванием)' },
  { value: 'squeal', label: 'Визг/свист (высокая частота)' },
  { value: 'clicking', label: 'Щелчки/стук (периодические импульсы)' },
  { value: 'hum_axial', label: 'Гул с пульсацией (осевой, 2-я гармоника)' },
  { value: 'hum_smooth', label: 'Ровный гул (без модуляции)' }
];

function showLabEditor() {
  currentLabId = null;
  document.getElementById('lab-editor-title').textContent = 'Новый тренажёр';
  document.getElementById('lab-title-input').value = '';
  document.getElementById('lab-intro-input').value = '';
  document.getElementById('faults-container').innerHTML = '';
  document.getElementById('lab-save-error').textContent = '';
  addFault();
  showScreen('screen-lab-editor');
}

async function editLab(id) {
  const res = await fetch('/api/labs/' + id);
  const lab = await res.json();
  currentLabId = id;
  document.getElementById('lab-editor-title').textContent = 'Редактирование тренажёра';
  document.getElementById('lab-title-input').value = lab.title;
  document.getElementById('lab-intro-input').value = lab.intro || '';
  document.getElementById('faults-container').innerHTML = '';
  lab.faults.forEach(f => addFault(f));
  document.getElementById('lab-save-error').textContent = '';
  showScreen('screen-lab-editor');
}

async function deleteLab(id) {
  if (!confirm('Удалить этот тренажёр?')) return;
  await fetch('/api/labs/' + id, { method: 'DELETE' });
  showLabsList();
}

function addFault(existing) {
  labFaultCounter++;
  const fid = 'labf' + labFaultCounter;
  const wrap = document.createElement('div');
  wrap.className = 'question-block';
  wrap.id = fid;
  wrap.innerHTML = `
    <div class="row between">
      <label style="margin-top:0">Неисправность (диагноз)</label>
      <button class="btn outline small" onclick="document.getElementById('${fid}').remove()">Удалить неисправность</button>
    </div>
    <input type="text" class="fault-label" value="${existing ? escapeAttr(existing.label) : ''}" placeholder="Например: Недостаток смазки">
    <label>Объяснение (что увидит ученик после ответа)</label>
    <textarea class="fault-explain" rows="3" placeholder="Почему именно эти признаки указывают на этот дефект...">${existing ? escapeHtml(existing.explain) : ''}</textarea>
    <label>Вариации показаний</label>
    <div class="variations-container" id="${fid}-vars"></div>
    <button class="btn outline small" style="margin-top:8px" onclick="addVariation('${fid}')">+ Вариация показаний</button>
  `;
  document.getElementById('faults-container').appendChild(wrap);

  if (existing && existing.variations && existing.variations.length) {
    existing.variations.forEach(v => addVariation(fid, v));
  } else {
    addVariation(fid);
  }
}

function addVariation(fid, existing) {
  const container = document.getElementById(fid + '-vars');
  const vid = fid + '_v' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const soundOptions = SOUND_TYPES.map(s =>
    `<option value="${s.value}" ${existing && existing.sound && existing.sound.type === s.value ? 'selected' : ''}>${s.label}</option>`
  ).join('');

  const div = document.createElement('div');
  div.className = 'variation-block';
  div.id = vid;
  div.innerHTML = `
    <div class="row between">
      <label style="margin-top:0">Вариация</label>
      <button class="btn outline small" onclick="document.getElementById('${vid}').remove()">✕</button>
    </div>
    <input type="text" class="v-title" value="${existing ? escapeAttr(existing.title) : ''}" placeholder="Название узла, например: Узел № 14 — опорный подшипник">
    <div class="row" style="gap:10px;align-items:flex-start">
      <div style="flex:1">
        <label>Вибрация — значение</label>
        <input type="text" class="v-vib-value" value="${existing ? escapeAttr(existing.vibration.value) : ''}" placeholder="8.2 мм/с">
      </div>
      <div style="flex:2">
        <label>Вибрация — описание</label>
        <input type="text" class="v-vib-desc" value="${existing ? escapeAttr(existing.vibration.desc) : ''}" placeholder="широкополосный рост уровня...">
      </div>
    </div>
    <div class="row" style="gap:10px;align-items:flex-start">
      <div style="flex:1">
        <label>Температура — значение</label>
        <input type="text" class="v-temp-value" value="${existing ? escapeAttr(existing.temp.value) : ''}" placeholder="+6 °C">
      </div>
      <div style="flex:2">
        <label>Температура — описание</label>
        <input type="text" class="v-temp-desc" value="${existing ? escapeAttr(existing.temp.desc) : ''}" placeholder="незначительно выше нормы">
      </div>
    </div>
    <label>Тип звука</label>
    <select class="v-sound-type">${soundOptions}</select>
    <label>Описание звука (текстом, что услышит ученик)</label>
    <input type="text" class="v-sound-desc" value="${existing ? escapeAttr(existing.sound.desc) : ''}" placeholder="скрежещущий, с потрескиванием">
  `;
  container.appendChild(div);
}

async function saveLab() {
  const title = document.getElementById('lab-title-input').value.trim();
  const intro = document.getElementById('lab-intro-input').value.trim();
  const errorEl = document.getElementById('lab-save-error');
  errorEl.textContent = '';

  if (!title) { errorEl.textContent = 'Введите название тренажёра'; return; }

  const faultBlocks = document.querySelectorAll('#faults-container > .question-block');
  if (faultBlocks.length === 0) { errorEl.textContent = 'Добавьте хотя бы одну неисправность'; return; }

  const faults = [];
  for (const fb of faultBlocks) {
    const label = fb.querySelector('.fault-label').value.trim();
    const explain = fb.querySelector('.fault-explain').value.trim();
    const varBlocks = fb.querySelectorAll('.variation-block');
    if (!label || !explain || varBlocks.length === 0) {
      errorEl.textContent = 'Заполните диагноз, объяснение и хотя бы одну вариацию для каждой неисправности';
      return;
    }
    const variations = [];
    for (const vb of varBlocks) {
      const vTitle = vb.querySelector('.v-title').value.trim();
      const vibValue = vb.querySelector('.v-vib-value').value.trim();
      const vibDesc = vb.querySelector('.v-vib-desc').value.trim();
      const tempValue = vb.querySelector('.v-temp-value').value.trim();
      const tempDesc = vb.querySelector('.v-temp-desc').value.trim();
      const soundType = vb.querySelector('.v-sound-type').value;
      const soundDesc = vb.querySelector('.v-sound-desc').value.trim();
      if (!vTitle || !vibValue || !tempValue) {
        errorEl.textContent = 'Заполните название узла, значение вибрации и температуры в каждой вариации';
        return;
      }
      variations.push({
        title: vTitle,
        vibration: { value: vibValue, desc: vibDesc },
        temp: { value: tempValue, desc: tempDesc },
        sound: { type: soundType, desc: soundDesc }
      });
    }
    faults.push({ label, explain, variations });
  }

  const payload = { title, intro, faults };
  const url = currentLabId ? '/api/labs/' + currentLabId : '/api/labs';
  const method = currentLabId ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) { errorEl.textContent = data.error || 'Не удалось сохранить тренажёр'; return; }

  showScreen('screen-list');
  switchTab('labs');
}

// ---------- СЕССИЯ ----------

async function startSession(testId) {
  currentSessionType = 'quiz';
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testId })
  });
  const data = await res.json();
  openSession(data.session.code, data);
}

async function startLabSession(labId) {
  currentSessionType = 'lab';
  const res = await fetch('/api/lab-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labId })
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
  socket.on('participant:joined', (p) => { upsertParticipantRow(p); });
  socket.on('participant:finished', (p) => { upsertParticipantRow(p); });
  socket.on('session:ended', () => { setSessionEndedUI(true); });
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
  const base = currentSessionType === 'lab' ? '/api/lab-sessions/' : '/api/sessions/';
  await fetch(base + currentSessionCode + '/end', { method: 'POST' });
  setSessionEndedUI(true);
}

function exportResults() {
  const base = currentSessionType === 'lab' ? '/api/lab-sessions/' : '/api/sessions/';
  window.location.href = base + currentSessionCode + '/export';
}

async function importFromExcel() {
  const fileInput = document.getElementById('import-file');
  const statusEl = document.getElementById('import-status');
  const file = fileInput.files[0];
  if (!file) return;

  statusEl.textContent = 'Загрузка и обработка файла...';
  statusEl.className = 'muted';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/import-questions', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      statusEl.textContent = data.error || 'Не удалось импортировать вопросы';
      statusEl.className = 'error';
      return;
    }

    data.questions.forEach(q => addQuestion(q));

    let msg = `Импортировано вопросов: ${data.questions.length}`;
    if (data.skipped && data.skipped.length > 0) {
      msg += `. Пропущено строк: ${data.skipped.length}`;
    }
    statusEl.textContent = msg;
    statusEl.className = 'muted';
  } catch (e) {
    statusEl.textContent = 'Ошибка при загрузке файла';
    statusEl.className = 'error';
  } finally {
    fileInput.value = '';
  }
}

// ---------- УТИЛИТЫ ----------

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------- СТАРТ ----------
showList();
