const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const XLSX = require('xlsx');
const multer = require('multer');
const { customAlphabet } = require('nanoid');
const { Server } = require('socket.io');
const db = require('./db');
const { SEED_LABS } = require('./labs-content');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);
const participantId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function getBaseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  return `http://${getLocalIp()}:${PORT}`;
}

app.get('/api/tests', (req, res) => {
  const data = db.load();
  const list = Object.values(data.tests).sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

app.get('/api/tests/:id', (req, res) => {
  const data = db.load();
  const test = data.tests[req.params.id];
  if (!test) return res.status(404).json({ error: 'Тест не найден' });
  res.json(test);
});

app.post('/api/tests', async (req, res) => {
  const { title, questions } = req.body;
  if (!title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Нужны название и хотя бы один вопрос' });
  }
  const id = participantId();
  const test = {
    id,
    title,
    questions: questions.map((q, i) => ({
      id: 'q' + i,
      text: q.text,
      options: q.options,
      correct: q.correct,
      multi: !!q.multi
    })),
    createdAt: Date.now()
  };
  await db.update((data) => { data.tests[id] = test; });
  res.json(test);
});

app.put('/api/tests/:id', async (req, res) => {
  const { title, questions } = req.body;
  const result = await db.update((data) => {
    const test = data.tests[req.params.id];
    if (!test) return null;
    test.title = title;
    test.questions = questions.map((q, i) => ({
      id: q.id || 'q' + i,
      text: q.text,
      options: q.options,
      correct: q.correct,
      multi: !!q.multi
    }));
    return test;
  });
  if (!result) return res.status(404).json({ error: 'Тест не найден' });
  res.json(result);
});

app.delete('/api/tests/:id', async (req, res) => {
  await db.update((data) => { delete data.tests[req.params.id]; });
  res.json({ ok: true });
});

app.get('/api/import-template', (req, res) => {
  const headers = ['Вопрос', 'Вариант 1', 'Вариант 2', 'Вариант 3', 'Вариант 4', 'Вариант 5', 'Правильные (номера через запятую)'];
  const example1 = ['Какая муфта применяется во избежание поломок деталей механизма из-за перегрузок?', 'Компенсирующая муфта', 'Жёсткая муфта', 'Предохранительная муфта', 'Обгонная муфта', '', '3'];
  const example2 = ['Выберите чётные числа', '1', '2', '3', '4', '', '2,4'];
  const ws = XLSX.utils.aoa_to_sheet([headers, example1, example2]);
  ws['!cols'] = [{ wch: 45 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Вопросы');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="shablon_voprosov.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.post('/api/import-questions', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  } catch (e) {
    return res.status(400).json({ error: 'Не удалось прочитать файл. Убедитесь, что это .xlsx или .xls' });
  }
  if (rows.length < 2) {
    return res.status(400).json({ error: 'В файле нет вопросов. Заполните строки под заголовком.' });
  }
  const questions = [];
  const skipped = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => String(c).trim() === '')) continue;
    const text = String(row[0] || '').trim();
    const options = [];
    for (let c = 1; c <= 5; c++) {
      const val = String(row[c] || '').trim();
      if (val) options.push(val);
    }
    const correctRaw = String(row[6] || '').trim();
    if (!text || options.length < 2 || !correctRaw) {
      skipped.push({ row: i + 1, reason: 'нет текста вопроса, вариантов (мин. 2) или правильного ответа' });
      continue;
    }
    const correctNums = correctRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const correctIdxs = correctNums.map(n => n - 1).filter(idx => idx >= 0 && idx < options.length);
    if (correctIdxs.length === 0) {
      skipped.push({ row: i + 1, reason: 'номер правильного ответа не соответствует вариантам' });
      continue;
    }
    const multi = correctIdxs.length > 1;
    questions.push({ text, options, correct: multi ? correctIdxs : correctIdxs[0], multi });
  }
  if (questions.length === 0) {
    return res.status(400).json({ error: 'Не удалось распознать ни одного вопроса. Проверьте формат файла (скачайте шаблон).', skipped });
  }
  res.json({ questions, skipped });
});

app.get('/api/tests/:id/stats', (req, res) => {
  const data = db.load();
  const test = data.tests[req.params.id];
  if (!test) return res.status(404).json({ error: 'Тест не найден' });
  const sessions = Object.values(data.sessions)
    .filter(s => s.testId === req.params.id && !s.type)
    .sort((a, b) => a.startedAt - b.startedAt);
  const sessionStats = sessions.map(s => {
    const participants = Object.values(s.participants).filter(p => p.finished);
    const count = participants.length;
    const avgScore = count > 0
      ? Math.round((participants.reduce((sum, p) => sum + (p.score / p.total * 100), 0) / count) * 10) / 10
      : null;
    return {
      code: s.code,
      startedAt: s.startedAt,
      ended: s.ended,
      totalParticipants: Object.keys(s.participants).length,
      finishedParticipants: count,
      avgScore
    };
  });
  const questionStats = test.questions.map(q => {
    let correct = 0;
    let total = 0;
    sessions.forEach(s => {
      Object.values(s.participants).forEach(p => {
        if (!p.finished || !p.answers) return;
        const a = p.answers[q.id];
        if (!a) return;
        total++;
        if (a.isCorrect) correct++;
      });
    });
    return {
      id: q.id,
      text: q.text,
      correct,
      total,
      errorRate: total > 0 ? Math.round(((total - correct) / total) * 100) : null
    };
  }).sort((a, b) => (b.errorRate || 0) - (a.errorRate || 0));
  res.json({ test: { id: test.id, title: test.title }, sessionStats, questionStats });
});

app.post('/api/sessions', async (req, res) => {
  const { testId } = req.body;
  const data = db.load();
  const test = data.tests[testId];
  if (!test) return res.status(404).json({ error: 'Тест не найден' });
  let code;
  do { code = nanoid(); } while (data.sessions[code]);
  const session = {
    code,
    testId,
    testTitle: test.title,
    timeLimit: req.body.timeLimit || null,
    startedAt: Date.now(),
    ended: false,
    participants: {}
  };
  await db.update((d) => { d.sessions[code] = session; });
  const url = `${getBaseUrl()}/s/${code}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 400, margin: 1 });
  res.json({ session, url, qrDataUrl });
});

app.get('/api/sessions', (req, res) => {
  const data = db.load();
  const list = Object.values(data.sessions).sort((a, b) => b.startedAt - a.startedAt);
  res.json(list);
});

app.get('/api/sessions/:code', (req, res) => {
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
  res.json(session);
});

app.get('/api/sessions/:code/quiz', (req, res) => {
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
  if (session.ended) return res.status(410).json({ error: 'Тестирование завершено' });
  const test = data.tests[session.testId];
  if (!test) return res.status(404).json({ error: 'Тест не найден' });
    res.json({
    testTitle: test.title,
    questions: test.questions.map(q => ({
      id: q.id,
      text: q.text,
      options: q.options,
      multi: q.multi
    })),
    timeLimit: session.timeLimit // <--- ДОБАВЛЕНА ЭТА СТРОКА
  });
app.post('/api/sessions/:code/join', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Введите имя' });
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
  if (session.ended) return res.status(410).json({ error: 'Тестирование завершено' });
  const pid = participantId();
  const participant = {
    id: pid,
    name: name.trim(),
    joinedAt: Date.now(),
    answers: {},
    finished: false,
    score: null,
    total: null
  };
  await db.update((d) => { d.sessions[req.params.code].participants[pid] = participant; });
  io.to('session:' + req.params.code).emit('participant:joined', participant);
  res.json({ participantId: pid });
});

app.post('/api/sessions/:code/submit', async (req, res) => {
  const { participantId: pid, answers } = req.body;
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
  const participant = session.participants[pid];
  if (!participant) return res.status(404).json({ error: 'Участник не найден' });
  if (participant.finished) return res.status(400).json({ error: 'Тест уже сдан' });
  const test = data.tests[session.testId];
  let score = 0;
  const total = test.questions.length;
  const detail = {};
  for (const q of test.questions) {
    const given = answers[q.id];
    let isCorrect = false;
    if (q.multi) {
      const correctSet = JSON.stringify([...q.correct].sort());
      const givenSet = JSON.stringify([...(given || [])].sort());
      isCorrect = correctSet === givenSet;
    } else {
      isCorrect = given === q.correct;
    }
    if (isCorrect) score++;
    detail[q.id] = { given, correct: q.correct, isCorrect };
  }
  const result = await db.update((d) => {
    const p = d.sessions[req.params.code].participants[pid];
    p.answers = detail;
    p.finished = true;
    p.finishedAt = Date.now();
    p.score = score;
    p.total = total;
    return p;
  });
  const review = test.questions.map(q => ({
    text: q.text,
    options: q.options,
    multi: q.multi,
    given: detail[q.id].given,
    correct: detail[q.id].correct,
    isCorrect: detail[q.id].isCorrect
  }));
  io.to('session:' + req.params.code).emit('participant:finished', result);
  res.json({ score, total, review });
});

app.post('/api/sessions/:code/end', async (req, res) => {
  await db.update((d) => {
    const s = d.sessions[req.params.code];
    if (s) s.ended = true;
  });
  io.to('session:' + req.params.code).emit('session:ended');
  res.json({ ok: true });
});

app.get('/api/sessions/:code/export', (req, res) => {
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session) return res.status(404).send('Сессия не найдена');
  const test = data.tests[session.testId];
  const rows = Object.values(session.participants).map(p => {
    const row = {
      'Имя': p.name,
      'Баллы': p.score !== null ? p.score : '—',
      'Всего вопросов': p.total !== null ? p.total : '—',
      'Процент': p.total ? Math.round((p.score / p.total) * 100) + '%' : '—',
      'Статус': p.finished ? 'Завершил' : 'В процессе'
    };
    if (test) {
      test.questions.forEach((q, i) => {
        const d = p.answers[q.id];
        row[`В${i + 1}: ${q.text}`] = d ? (d.isCorrect ? 'Верно' : 'Неверно') : '—';
      });
    }
    return row;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Результаты');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="results_${req.params.code}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ==================== ЛАБОРАТОРИИ ====================

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildOptionsPool(lab) {
  return lab.faults.map(f => ({ id: f.id, label: f.label }));
}

function assignCases(lab) {
  const order = shuffleArr(lab.faults.map(f => f.id));
  return order.map(faultId => {
    const fault = lab.faults.find(f => f.id === faultId);
    const variationIndex = Math.floor(Math.random() * fault.variations.length);
    return { faultId, variationIndex };
  });
}

function caseForClient(lab, assignment) {
  const fault = lab.faults.find(f => f.id === assignment.faultId);
  const v = fault.variations[assignment.variationIndex];
  return {
    title: v.title,
    vibration: v.vibration,
    temp: v.temp,
    sound: v.sound,
    options: shuffleArr(buildOptionsPool(lab))
  };
}

app.delete('/api/tests/:id/sessions', async (req, res) => {
  await db.update((d) => {
    Object.keys(d.sessions).forEach(code => {
      if (d.sessions[code].testId === req.params.id && !d.sessions[code].type) {
        delete d.sessions[code];
      }
    });
  });
  res.json({ ok: true });
});app.get('/api/labs', (req, res) => {
  const data = db.load();
  const list = Object.values(data.labs).map(l => ({
    id: l.id,
    title: l.title,
    intro: l.intro,
    faultCount: l.faults.length
  }));
  res.json(list);
});

app.get('/api/labs/:id', (req, res) => {
  const data = db.load();
  const lab = data.labs[req.params.id];
  if (!lab) return res.status(404).json({ error: 'Тренажёр не найден' });
  res.json(lab);
});

function validateLabPayload(body) {
  const { title, faults } = body;
  if (!title || !title.trim()) return 'Введите название тренажёра';
  if (!Array.isArray(faults) || faults.length === 0) return 'Добавьте хотя бы одну неисправность';
  for (const f of faults) {
    if (!f.label || !f.label.trim()) return 'У каждой неисправности должно быть название диагноза';
    if (!f.explain || !f.explain.trim()) return 'У каждой неисправности должно быть объяснение';
    if (!Array.isArray(f.variations) || f.variations.length === 0) {
      return `У неисправности «${f.label}» должна быть хотя бы одна вариация показаний`;
    }
    for (const v of f.variations) {
      if (!v.title || !v.vibration || !v.vibration.value || !v.temp || !v.temp.value || !v.sound || !v.sound.type) {
        return `Заполните все поля показаний в вариациях для «${f.label}»`;
      }
    }
  }
  return null;
}

app.post('/api/labs', async (req, res) => {
  const err = validateLabPayload(req.body);
  if (err) return res.status(400).json({ error: err });
  const id = participantId();
  const lab = {
    id,
    title: req.body.title.trim(),
    intro: (req.body.intro || '').trim(),
    faults: req.body.faults.map((f, fi) => ({
      id: f.id || ('f' + fi + '_' + id),
      label: f.label.trim(),
      explain: f.explain.trim(),
      variations: f.variations.map(v => ({
        title: v.title.trim(),
        vibration: { value: v.vibration.value.trim(), desc: (v.vibration.desc || '').trim() },
        temp: { value: v.temp.value.trim(), desc: (v.temp.desc || '').trim() },
        sound: { type: v.sound.type, desc: (v.sound.desc || '').trim() }
      }))
    })),
    createdAt: Date.now(),
    custom: true
  };
  await db.update((d) => { d.labs[id] = lab; });
  res.json(lab);
});

app.put('/api/labs/:id', async (req, res) => {
  const err = validateLabPayload(req.body);
  if (err) return res.status(400).json({ error: err });
  const result = await db.update((d) => {
    const existing = d.labs[req.params.id];
    if (!existing) return null;
    existing.title = req.body.title.trim();
    existing.intro = (req.body.intro || '').trim();
    existing.faults = req.body.faults.map((f, fi) => ({
      id: f.id || ('f' + fi + '_' + req.params.id),
      label: f.label.trim(),
      explain: f.explain.trim(),
      variations: f.variations.map(v => ({
        title: v.title.trim(),
        vibration: { value: v.vibration.value.trim(), desc: (v.vibration.desc || '').trim() },
        temp: { value: v.temp.value.trim(), desc: (v.temp.desc || '').trim() },
        sound: { type: v.sound.type, desc: (v.sound.desc || '').trim() }
      }))
    }));
    return existing;
  });
  if (!result) return res.status(404).json({ error: 'Тренажёр не найден' });
  res.json(result);
});

app.delete('/api/labs/:id', async (req, res) => {
  await db.update((d) => { delete d.labs[req.params.id]; });
  res.json({ ok: true });
});

app.post('/api/lab-sessions', async (req, res) => {
  const { labId } = req.body;
  const data = db.load();
  const lab = data.labs[labId];
  if (!lab) return res.status(404).json({ error: 'Тренажёр не найден' });
  let code;
  do { code = nanoid(); } while (data.sessions[code]);
  const session = {
    code,
    type: 'lab',
    labId,
    testTitle: lab.title,
    startedAt: Date.now(),
    ended: false,
    participants: {}
  };
  await db.update((d) => { d.sessions[code] = session; });
  const url = `${getBaseUrl()}/l/${code}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 400, margin: 1 });
  res.json({ session, url, qrDataUrl });
});

app.get('/api/lab-sessions/:code', (req, res) => {
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session || session.type !== 'lab') return res.status(404).json({ error: 'Сессия не найдена' });
  res.json(session);
});

app.get('/api/lab-sessions/:code/info', (req, res) => {
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session || session.type !== 'lab') return res.status(404).json({ error: 'Сессия не найдена' });
  if (session.ended) return res.status(410).json({ error: 'Тренажёр завершён' });
  const lab = data.labs[session.labId];
  res.json({ testTitle: session.testTitle, intro: lab ? lab.intro : '' });
});

app.post('/api/lab-sessions/:code/join', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Введите имя' });
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session || session.type !== 'lab') return res.status(404).json({ error: 'Сессия не найдена' });
  if (session.ended) return res.status(410).json({ error: 'Тренажёр завершён' });
  const lab = data.labs[session.labId];
  if (!lab) return res.status(404).json({ error: 'Тренажёр не найден' });
  const pid = participantId();
  const caseAssignment = assignCases(lab);
  const participant = {
    id: pid,
    name: name.trim(),
    joinedAt: Date.now(),
    caseAssignment,
    finished: false,
    score: null,
    total: null
  };
  await db.update((d) => { d.sessions[req.params.code].participants[pid] = participant; });
  io.to('session:' + req.params.code).emit('participant:joined', participant);
  res.json({
    participantId: pid,
    testTitle: lab.title,
    cases: caseAssignment.map(a => caseForClient(lab, a))
  });
});

app.post('/api/lab-sessions/:code/submit', async (req, res) => {
  const { participantId: pid, answers } = req.body;
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session || session.type !== 'lab') return res.status(404).json({ error: 'Сессия не найдена' });
  const participant = session.participants[pid];
  if (!participant) return res.status(404).json({ error: 'Участник не найден' });
  if (participant.finished) return res.status(400).json({ error: 'Тренажёр уже сдан' });
  const lab = data.labs[session.labId];
  let score = 0;
  const total = participant.caseAssignment.length;
  const review = [];
  participant.caseAssignment.forEach((assignment, i) => {
    const fault = lab.faults.find(f => f.id === assignment.faultId);
    const v = fault.variations[assignment.variationIndex];
    const given = answers ? answers[i] : undefined;
    const isCorrect = given === assignment.faultId;
    if (isCorrect) score++;
    review.push({
      title: v.title,
      vibration: v.vibration,
      temp: v.temp,
      sound: v.sound,
      options: buildOptionsPool(lab),
      given,
      correct: assignment.faultId,
      correctLabel: fault.label,
      isCorrect,
      explain: fault.explain
    });
  });
  const result = await db.update((d) => {
    const p = d.sessions[req.params.code].participants[pid];
    p.finished = true;
    p.finishedAt = Date.now();
    p.score = score;
    p.total = total;
    p.review = review;
    return p;
  });
  io.to('session:' + req.params.code).emit('participant:finished', result);
  res.json({ score, total, review });
});

app.post('/api/lab-sessions/:code/end', async (req, res) => {
  await db.update((d) => {
    const s = d.sessions[req.params.code];
    if (s) s.ended = true;
  });
  io.to('session:' + req.params.code).emit('session:ended');
  res.json({ ok: true });
});

app.get('/api/lab-sessions/:code/export', (req, res) => {
  const data = db.load();
  const session = data.sessions[req.params.code];
  if (!session || session.type !== 'lab') return res.status(404).send('Сессия не найдена');
  const lab = data.labs[session.labId];
  const rows = Object.values(session.participants).map(p => {
    const row = {
      'Имя': p.name,
      'Баллы': p.score !== null ? p.score : '—',
      'Всего случаев': p.total !== null ? p.total : '—',
      'Процент': p.total ? Math.round((p.score / p.total) * 100) + '%' : '—',
      'Статус': p.finished ? 'Завершил' : 'В процессе'
    };
    if (p.review) {
      p.review.forEach((c, i) => {
        row[`Случай ${i + 1}: ${c.title}`] = c.isCorrect ? 'Верно' : `Неверно (${c.correctLabel})`;
      });
    }
    return row;
  });
  const faultStats = {};
  if (lab) lab.faults.forEach(f => { faultStats[f.label] = { wrong: 0, total: 0 }; });
  Object.values(session.participants).forEach(p => {
    if (!p.review) return;
    p.review.forEach(c => {
      if (!faultStats[c.correctLabel]) faultStats[c.correctLabel] = { wrong: 0, total: 0 };
      faultStats[c.correctLabel].total++;
      if (!c.isCorrect) faultStats[c.correctLabel].wrong++;
    });
  });
  const summaryRows = Object.entries(faultStats).map(([label, s]) => ({
    'Тип неисправности': label,
    'Ошибок': s.wrong,
    'Всего показов': s.total,
    'Доля ошибок': s.total ? Math.round((s.wrong / s.total) * 100) + '%' : '—'
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Результаты');
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Проблемные типы');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="lab_results_${req.params.code}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});
app.get('/l/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lab-student.html'));
});

app.get('/s/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

io.on('connection', (socket) => {
  socket.on('teacher:watch', (code) => {
    socket.join('session:' + code);
  });
});

async function seedLabs() {
  await db.update((d) => {
    SEED_LABS.forEach(l => { d.labs[l.id] = l; });
  });
  console.log(`[labs] Синхронизировано тренажёров: ${SEED_LABS.length}`);
}

async function start() {
  await db.initCache();
  await seedLabs();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('=== Приложение для тестирования запущено ===');
    console.log(`Панель преподавателя: http://localhost:${PORT}`);
    console.log(`Публичный адрес (для QR): ${getBaseUrl()}`);
    if (!process.env.PUBLIC_URL && !process.env.RENDER_EXTERNAL_URL) {
      console.log('Убедитесь, что телефоны учеников подключены к той же Wi-Fi сети.');
    }
    console.log('==============================================');
  });
}

start();

