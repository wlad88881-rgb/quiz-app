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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5); // короткий код без похожих символов
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

// Если программа развёрнута на хостинге (Render и т.п.), используем публичный адрес.
// Иначе — локальный IP для работы в домашней/офисной Wi-Fi сети.
function getBaseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  return `http://${getLocalIp()}:${PORT}`;
}

// ---------- ТЕСТЫ ----------

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
      correct: q.correct, // индекс правильного варианта (или массив индексов, если multi)
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

// ---------- ИМПОРТ ВОПРОСОВ ИЗ EXCEL ----------

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

  // первая строка — заголовок, пропускаем
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => String(c).trim() === '')) continue; // пустая строка

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
    questions.push({
      text,
      options,
      correct: multi ? correctIdxs : correctIdxs[0],
      multi
    });
  }

  if (questions.length === 0) {
    return res.status(400).json({ error: 'Не удалось распознать ни одного вопроса. Проверьте формат файла (скачайте шаблон).', skipped });
  }

  res.json({ questions, skipped });
});

// ---------- СЕССИИ ----------

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

// Ученик открывает тест по коду — получает вопросы БЕЗ правильных ответов
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
    }))
  });
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

  io.to('session:' + req.params.code).emit('participant:finished', result);
  res.json({ score, total });
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

// ---------- СТРАНИЦЫ ----------

app.get('/s/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

// ---------- SOCKET.IO ----------

io.on('connection', (socket) => {
  socket.on('teacher:watch', (code) => {
    socket.join('session:' + code);
  });
});

async function start() {
  await db.initCache();
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
