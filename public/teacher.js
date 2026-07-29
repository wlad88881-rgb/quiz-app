let currentTestId = null;
let currentSessionCode = null;
let currentSessionType = 'quiz';
let socket = null;
let statsChart = null;
let currentStatsTestId = null;
let qCounter = 0;
let labFaultCounter = 0;
let currentLabId = null;

const SOUND_TYPES = [
  { value: 'grinding', label: 'Скрежет (шум с потрескиванием)' },
  { value: 'squeal', label: 'Визг/свист (высокая частота)' },
  { value: 'clicking', label: 'Щелчки/стук (периодические импульсы)' },
  { value: 'hum_axial', label: 'Гул с пульсацией (осевой, 2-я гармоника)' },
  { value: 'hum_smooth', label: 'Ровный гул (без модуляции)' }
];

// ---------- ВКЛАДКИ ----------
function switchTab(tab) {
  ['tests', 'labs', 'stats'].forEach(t => {
    document.getElementById('tab-btn-' + t).classList.toggle('active', t === tab);
    document.getElementById('tab-' + t).style.display = t === tab ? 'block' : 'none';
  });
  // Если мы на экране сессии, при переключении вкладок выходим из сессии в список
  if (document.getElementById('screen-session').style.display === 'block') {
    showList();
  }
  if (tab === 'labs') showLabsList();
  if (tab === 'stats') showStatsList();
}

// ---------- НАВИГАЦИЯ ----------
function showScreen(id) {
  ['screen-main', 'screen-editor', 'screen-lab-editor', 'screen-session', 'screen-stats'].forEach(s => {
    document.getElementById(s).style.display = (s === id) ? 'block' : 'none';
  });
}

function showList() {
  showScreen('screen-main');
  loadTestsList();
}

async function loadTestsList() {
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
          <button class="btn outline small" onclick="showTestStats('${t.id}')">История</button>
          <button class="btn outline small" onclick="editTest('${t.id}')">Изменить</button>
          <button class="btn danger small" onclick="deleteTest('${t.id}')">Удалить</button>
        </div>
      </div>
    `).join('');
  }
  if (document.getElementById('tab-btn-labs').classList.contains('active')) showLabsList();
  if (document.getElementById('tab-btn-stats').classList.contains('active')) showStatsList();
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
  loadTestsList();
}

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
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) { errorEl.textContent = 'Не удалось сохранить тест'; return; }
  loadTestsList();
}

// ---------- СТАТИСТИКА ----------
async function showStatsList() {
  const res = await fetch('/api/tests');
  const tests = await res.json();
  const container = document.getElementById('stats-tests-list');
  if (tests.length === 0) {
    container.innerHTML = '<p class="muted">Тестов пока нет.</p>';
    return;
  }
  container.innerHTML = tests.map(t => `
    <div class="card row between">
      <div>
        <strong>${escapeHtml(t.title)}</strong>
        <div class="muted">${t.questions.length} вопрос(ов)</div>
      </div>
      <button class="btn outline small" onclick="showTestStats('${t.id}')">Смотреть статистику</button>
    </div>
  `).join('');
}

async function showTestStats(testId) {
  currentStatsTestId = testId;
  const res = await fetch('/api/tests/' + testId + '/stats');
  const data = await res.json();
  document.getElementById('stats-test-title').textContent = data.test.title;
  showScreen('screen-stats');
  const tbody = document.getElementById('stats-sessions-body');
  const noSessions = document.getElementById('stats-no-sessions');
  if (data.sessionStats.length === 0) {
    tbody.innerHTML = '';
    noSessions.style.display = 'block';
  } else {
    noSessions.style.display = 'none';
    tbody.innerHTML = data.sessionStats.map(s => {
      const date = new Date(s.startedAt).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const avg = s.avgScore !== null ? s.avgScore + '%' : '—';
      const avgColor = s.avgScore === null ? '' : s.avgScore >= 80 ? 'color:#2e9e4f' : s.avgScore >= 60 ? 'color:#b26a00' : 'color:#d64545';
      return `<tr><td>${date}</td><td>${s.totalParticipants}</td><td>${s.finishedParticipants}</td><td style="font-weight:700;${avgColor}">${avg}</td></tr>`;
    }).join('');
  }
  const chartEl = document.getElementById('stats-chart');
  const chartEmpty = document.getElementById('stats-chart-empty');
  const chartSessions = data.sessionStats.filter(s => s.avgScore !== null);
  if (statsChart) { statsChart.destroy(); statsChart = null; }
  if (chartSessions.length < 2) {
    chartEl.style.display = 'none';
    chartEmpty.style.display = 'block';
  } else {
    chartEl.style.display = 'block';
    chartEmpty.style.display = 'none';
    const labels = chartSessions.map(s => { const d = new Date(s.startedAt); return `${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}`; });
    const scores = chartSessions.map(s => s.avgScore);
    drawChart(chartEl, labels, scores);
  }
  const qContainer = document.getElementById('stats-questions-list');
  const withData = data.questionStats.filter(q => q.total > 0);
  if (withData.length === 0) {
    qContainer.innerHTML = '<p class="muted">Ещё нет данных по вопросам.</p>';
  } else {
    qContainer.innerHTML = withData.map(q => {
      const rate = q.errorRate;
      const color = rate >= 50 ? '#d64545' : rate >= 25 ? '#b26a00' : '#2e9e4f';
      const bg = rate >= 50 ? '#fdeaea' : rate >= 25 ? '#fff3e0' : '#e6f4ea';
      return `<div class="card" style="margin-bottom:10px">
        <div class="row between">
          <div style="flex:1;font-size:14px">${escapeHtml(q.text)}</div>
          <div style="flex-shrink:0;margin-left:16px;text-align:center">
            <div style="background:${bg};color:${color};font-weight:700;font-size:18px;padding:6px 14px;border-radius:8px">${rate}%</div>
            <div class="muted" style="font-size:11px;margin-top:2px">ошибок</div>
          </div>
        </div>
        <div style="margin-top:8px;background:#eee;border-radius:4px;overflow:hidden;height:6px"><div style="width:${rate}%;height:6px;background:${color};border-radius:4px"></div></div>
        <div class="muted" style="font-size:12px;margin-top:4px">${q.total - q.correct} из ${q.total} ответов неверны</div>
      </div>`;
    }).join('');
  }
}

async function clearTestHistory() {
  if (!confirm('Удалить всю историю сессий по этому тесту? Данные участников будут потеряны.')) return;
  await fetch('/api/tests/' + currentStatsTestId + '/sessions', { method: 'DELETE' });
  showTestStats(currentStatsTestId);
}

function drawChart(canvas, labels, scores) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 600;
  const H = canvas.offsetHeight || 160;
  canvas.width = W; canvas.height = H;
  const pad = { top: 20, right: 20, bottom: 30, left: 40 };
  const w = W - pad.left - pad.right;
  const h = H - pad.top - pad.bottom;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1;
  [0, 25, 50, 75, 100].forEach(v => {
    const y = pad.top + h - (v / 100) * h;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + w, y); ctx.stroke();
    ctx.fillStyle = '#999'; ctx.font = '11px Arial'; ctx.textAlign = 'right'; ctx.fillText(v + '%', pad.left - 4, y + 4);
  });
  const step = w / (scores.length - 1);
  ctx.beginPath(); ctx.strokeStyle = '#F07C00'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  scores.forEach((s, i) => {
    const x = pad.left + i * step;
    const y = pad.top + h - (s / 100) * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  scores.forEach((s, i) => {
    const x = pad.left + i * step; const y = pad.top + h - (s / 100) * h;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = '#F07C00'; ctx.fill();
    ctx.fillStyle = '#2C3E50'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.fillText(s + '%', x, y - 10);
    ctx.fillStyle = '#999'; ctx.font = '11px Arial'; ctx.fillText(labels[i], x, pad.top + h + 18);
  });
}

// ---------- СЕССИЯ ----------
async function startSession(testId) {
  currentSessionType = 'quiz';
  const timeLimit = prompt('Введите лимит времени в минутах (0 — без ограничений):', '0');
  if (timeLimit === null) return;
  const limit = parseInt(timeLimit) || 0;
  
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testId, timeLimit: limit })
  });
  const data = await res.json();
  openSession(data.session.code, data);
}

async function startLabSession(labId) {
  currentSessionType = 'lab';
  const res = await fetch('/api/lab-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ labId }) });
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
  if (createData) document.getElementById('qr-img').src = createData.qrDataUrl;
  setSessionEndedUI(session.ended);
  renderParticipants(session.participants || {});
  showScreen('screen-session');
  connectSocket(code);
}

function setSessionEndedUI(ended) {
  const badge = document.getElementById('session-status');
  const endBtn = document.getElementById('end-session-btn');
  if (ended) {
    badge.textContent = 'Завершено'; badge.className = 'badge ended'; endBtn.disabled = true;
  } else {
    badge.textContent = 'Идёт тестирование'; badge.className = 'badge live'; endBtn.disabled = false;
  }
}

function connectSocket(code) {
  if (socket) {
    // Очищаем старые обработчики, чтобы события не дублировались
    socket.off('participant:joined');
    socket.off('participant:finished');
    socket.off('session:ended');
    socket.disconnect();
  }
  
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
  Object.values(participants).sort((a, b) => a.joinedAt - b.joinedAt).forEach(p => upsertParticipantRow(p));
  
  // Включаем отображение таблицы, если есть участники
  document.getElementById('results-table').style.display = Object.keys(participants).length > 0 ? 'table' : 'none';
}

function upsertParticipantRow(p) {
  const tbody = document.getElementById('results-body');
  document.getElementById('no-participants').style.display = 'none';
  let row = participantRows[p.id];
  if (!row) { row = document.createElement('tr'); participantRows[p.id] = row; tbody.appendChild(row); }
  const status = p.finished ? '<span class="badge live">Завершил</span>' : '<span class="badge" style="background:#fff3e0;color:#b26a00">Проходит</span>';
  const score = p.finished ? `${p.score} / ${p.total}` : '—';
  row.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${status}</td><td>${score}</td>`;
  document.getElementById('results-table').style.display = 'table';
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
  const file = fileInput.files[0];
  if (!file) return;
  const formData = new FormData(); formData.append('file', file);
  try {
    const res = await fetch('/api/import-questions', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Ошибка импорта'); return; }
    data.questions.forEach(q => addQuestion(q));
    alert(`Импортировано вопросов: ${data.questions.length}`);
  } catch (e) { alert('Ошибка при загрузке файла'); }
  finally { fileInput.value = ''; }
}

// ---------- ЛАБОРАТОРИИ ----------
async function showLabsList() {
  const res = await fetch('/api/labs');
  const labs = await res.json();
  const container = document.getElementById('labs-list');
  if (labs.length === 0) {
    container.innerHTML = '<p class="muted">Тренажёров пока нет.</p>'; return;
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
  wrap.className = 'question-block'; wrap.id = fid;
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
  } else { addVariation(fid); }
}

function addVariation(fid, existing) {
  const container = document.getElementById(fid + '-vars');
  const vid = fid + '_v' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const soundOptions = SOUND_TYPES.map(s => `<option value="${s.value}" ${existing && existing.sound && existing.sound.type === s.value ? 'selected' : ''}>${s.label}</option>`).join('');
  const div = document.createElement('div');
  div.className = 'variation-block'; div.id = vid;
  div.innerHTML = `
    <div class="row between"><label style="margin-top:0">Вариация</label><button class="btn outline small" onclick="document.getElementById('${vid}').remove()">✕</button></div>
    <input type="text" class="v-title" value="${existing ? escapeAttr(existing.title) : ''}" placeholder="Название узла, например: Узел № 14 — опорный подшипник">
    <div class="row" style="gap:10px;align-items:flex-start">
      <div style="flex:1"><label>Вибрация — значение</label><input type="text" class="v-vib-value" value="${existing ? escapeAttr(existing.vibration.value) : ''}" placeholder="8.2 мм/с"></div>
      <div style="flex:2"><label>Вибрация — описание</label><input type="text" class="v-vib-desc" value="${existing ? escapeAttr(existing.vibration.desc) : ''}" placeholder="широкополосный рост уровня..."></div>
    </div>
    <div class="row" style="gap:10px;align-items:flex-start">
      <div style="flex:1"><label>Температура — значение</label><input type="text" class="v-temp-value" value="${existing ? escapeAttr(existing.temp.value) : ''}" placeholder="+6 °C"></div>
      <div style="flex:2"><label>Температура — описание</label><input type="text" class="v-temp-desc" value="${existing ? escapeAttr(existing.temp.desc) : ''}" placeholder="незначительно выше нормы"></div>
    </div>
    <label>Тип звука</label><select class="v-sound-type">${soundOptions}</select>
    <label>Описание звука (текстом, что услышит ученик)</label><input type="text" class="v-sound-desc" value="${existing ? escapeAttr(existing.sound.desc) : ''}" placeholder="скрежещущий, с потрескиванием">
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
      errorEl.textContent = 'Заполните диагноз, объяснение и хотя бы одну вариацию для каждой неисправности'; return;
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
        errorEl.textContent = 'Заполните название узла, значение вибрации и температуры в каждой вариации'; return;
      }
      variations.push({ title: vTitle, vibration: { value: vibValue, desc: vibDesc }, temp: { value: tempValue, desc: tempDesc }, sound: { type: soundType, desc: soundDesc } });
    }
    faults.push({ label, explain, variations });
  }
  const payload = { title, intro, faults };
  const url = currentLabId ? '/api/labs/' + currentLabId : '/api/labs';
  const method = currentLabId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) { errorEl.textContent = data.error || 'Не удалось сохранить тренажёр'; return; }
  showScreen('screen-main'); switchTab('labs');
}

// ---------- УТИЛИТЫ ----------
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }

// ---------- СТАРТ ----------
loadTestsList();
