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

app.post('/api/sessions', async (req, res) => {
  const { testId } = req.body;
  const data = db.load();
  const test = data.tests[testId];
  if (!test) return res.status(404).json({ error: 'Тест не найден' });

  let code;
  do { code = nanoid(); } while (data.sessions[code]);

  const session
