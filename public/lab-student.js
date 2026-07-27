const sessionCode = window.location.pathname.split('/l/')[1];
let cases = null;
let participantId = null;
const answers = {};

async function init() {
  try {
    const res = await fetch(`/api/lab-sessions/${sessionCode}/info`);
    if (!res.ok) {
      const err = await res.json();
      document.getElementById('join-title').textContent = 'Недоступно';
      document.getElementById('join-error').textContent = err.error || 'Тренажёр недоступен';
      return;
    }
    const data = await res.json();
    document.getElementById('join-title').textContent = data.testTitle;
    document.getElementById('join-intro').textContent = data.intro || '';
  } catch (e) {
    document.getElementById('join-error').textContent = 'Не удалось подключиться к серверу';
  }
}

async function joinLab() {
  const name = document.getElementById('student-name').value.trim();
  const errorEl = document.getElementById('join-error');
  errorEl.textContent = '';
  if (!name) { errorEl.textContent = 'Введите имя'; return; }

  const res = await fetch(`/api/lab-sessions/${sessionCode}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (!res.ok) { errorEl.textContent = data.error || 'Ошибка'; return; }

  participantId = data.participantId;
  cases = data.cases;
  renderLab(data.testTitle);
}

function renderLab(title) {
  document.getElementById('screen-join').style.display = 'none';
  document.getElementById('screen-lab').style.display = 'block';
  document.getElementById('lab-title').textContent = title;

  const nav = document.getElementById('case-nav');
  nav.innerHTML = cases.map((c, i) => `<div id="nav-${i}">${i + 1}</div>`).join('');

  const list = document.getElementById('cases-list');
  list.innerHTML = cases.map((c, i) => `
    <div class="case-card">
      <div class="case-title">${i + 1}. ${escapeHtml(c.title)}</div>
      <div class="gauges">
        <div class="gauge">
          <div class="gauge-label">Вибрация</div>
          <div class="gauge-value">${escapeHtml(c.vibration.value)}</div>
          <div class="gauge-desc">${escapeHtml(c.vibration.desc)}</div>
        </div>
        <div class="gauge">
          <div class="gauge-label">Температура</div>
          <div class="gauge-value">${escapeHtml(c.temp.value)}</div>
          <div class="gauge-desc">${escapeHtml(c.temp.desc)}</div>
        </div>
      </div>
      <div class="sound-row">
        <button class="btn-audio" id="audio-btn-${i}" onclick="playSound('${c.sound.type}', ${i})">▶ Прослушать</button>
        <div class="sound-desc">${escapeHtml(c.sound.desc)}</div>
      </div>
      <div class="diagnosis-label">Диагноз</div>
      <div id="options-${i}">
        ${c.options.map((opt, oi) => `
          <label class="option-choice" id="choice-${i}-${oi}">
            <input type="radio" name="case-${i}" value="${opt.id}" onchange="selectAnswer(${i}, '${opt.id}')">
            ${escapeHtml(opt.label)}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function selectAnswer(caseIdx, faultId) {
  answers[caseIdx] = faultId;
  document.querySelectorAll(`[id^="choice-${caseIdx}-"]`).forEach(el => el.classList.remove('selected'));
  const inputs = document.querySelectorAll(`input[name="case-${caseIdx}"]`);
  inputs.forEach(inp => {
    if (inp.checked) document.getElementById(inp.closest('.option-choice').id).classList.add('selected');
  });
  document.getElementById(`nav-${caseIdx}`).classList.add('answered');
}

async function submitLab() {
  const errorEl = document.getElementById('submit-error');
  const unanswered = cases.map((c, i) => i).filter(i => answers[i] === undefined);
  if (unanswered.length > 0) {
    errorEl.textContent = `Осталось без диагноза случаев: ${unanswered.length}. Отправить всё равно можно.`;
  }

  const res = await fetch(`/api/lab-sessions/${sessionCode}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, answers })
  });
  const data = await res.json();
  if (!res.ok) { errorEl.textContent = data.error || 'Ошибка отправки'; return; }

  document.getElementById('screen-lab').style.display = 'none';
  document.getElementById('screen-result').style.display = 'block';
  document.getElementById('result-score').textContent = `${data.score} / ${data.total}`;
  document.getElementById('result-percent').textContent = Math.round((data.score / data.total) * 100) + '%';

  renderReview(data.review);
}

function renderReview(review) {
  const container = document.getElementById('review-list');
  container.innerHTML = review.map((c, i) => {
    const optionsHtml = c.options.map(opt => {
      const isCorrectOpt = opt.id === c.correct;
      const wasGiven = opt.id === c.given;
      let cls = 'review-option';
      let mark = '';
      if (isCorrectOpt) { cls += ' correct'; mark = '✓ '; }
      if (wasGiven && !isCorrectOpt) { cls += ' wrong'; mark = '✕ '; }
      return `<div class="${cls}">${mark}${escapeHtml(opt.label)}</div>`;
    }).join('');

    const statusBadge = c.isCorrect
      ? '<span class="badge live">Верно</span>'
      : '<span class="badge" style="background:#fdeaea;color:#d64545">Неверно</span>';

    return `
      <div class="card">
        <div class="row between">
          <strong>${i + 1}. ${escapeHtml(c.title)}</strong>
          ${statusBadge}
        </div>
        <div style="margin-top:10px">${optionsHtml}</div>
        <div class="review-explain">${escapeHtml(c.explain)}</div>
      </div>
    `;
  }).join('');
}

// ---------- СИНТЕЗ ЗВУКА (Web Audio API, без файлов) ----------

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function makeNoiseBuffer(ctx, duration) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function playSound(type, caseIdx) {
  const btn = document.getElementById(`audio-btn-${caseIdx}`);
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') ctx.resume();

  btn.disabled = true;
  btn.classList.add('playing');
  btn.textContent = '🔊 Звучит...';

  const now = ctx.currentTime;
  let duration = 2.2;

  if (type === 'grinding') {
    duration = 2.4;
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, duration);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
    // неровная, "скрежещущая" огибающая
    for (let t = 0; t < duration; t += 0.12) {
      gain.gain.linearRampToValueAtTime(0.15 + Math.random() * 0.3, now + t);
    }
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    src.connect(bp).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + duration);
  } else if (type === 'squeal') {
    duration = 2.2;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, now);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.15);
    gain.gain.linearRampToValueAtTime(0.22, now + duration - 0.2);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now); lfo.start(now);
    osc.stop(now + duration); lfo.stop(now + duration);
  } else if (type === 'clicking') {
    duration = 2.2;
    const interval = 0.38;
    let t = 0.1;
    while (t < duration) {
      const src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx, 0.04);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, now + t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.04);
      src.connect(hp).connect(gain).connect(ctx.destination);
      src.start(now + t);
      src.stop(now + t + 0.05);
      t += interval;
    }
  } else if (type === 'hum_axial') {
    duration = 2.4;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 95;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.5; // пульсация от перекоса (2х гармоника)
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.12;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    lfo.connect(lfoGain).connect(gain.gain);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.15);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    osc.connect(lp).connect(gain).connect(ctx.destination);
    osc.start(now); lfo.start(now);
    osc.stop(now + duration); lfo.stop(now + duration);
  } else if (type === 'hum_smooth') {
    duration = 2.0;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 75;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.2);
    gain.gain.linearRampToValueAtTime(0.25, now + duration - 0.2);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    osc.connect(lp).connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  setTimeout(() => {
    btn.disabled = false;
    btn.classList.remove('playing');
    btn.textContent = '▶ Прослушать';
  }, duration * 1000 + 100);
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

init();
