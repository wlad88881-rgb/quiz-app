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
