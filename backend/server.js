const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 4000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'danybeats.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const MUSIC_DIR = path.resolve(__dirname, '..', 'music');

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function initDatabase() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
}

initDatabase();

const insertBeatStmt = db.prepare(
  'INSERT INTO beats (slug, title) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING'
);
const getBeatBySlugStmt = db.prepare('SELECT id, slug, title FROM beats WHERE slug = ?');
const getBeatByIdStmt = db.prepare('SELECT id, slug, title FROM beats WHERE id = ?');

function resolveBeatId(beatRef) {
  if (/^\d+$/.test(beatRef)) {
    const beat = getBeatByIdStmt.get(Number(beatRef));
    return beat ? beat.id : null;
  }

  insertBeatStmt.run(beatRef, beatRef.replaceAll('-', ' '));
  const beat = getBeatBySlugStmt.get(beatRef);
  return beat ? beat.id : null;
}

function getLikesCount(beatId) {
  const row = db
    .prepare('SELECT COUNT(*) AS total FROM beat_likes WHERE beat_id = ? AND is_liked = 1')
    .get(beatId);
  return row.total;
}

function getCommentsCount(beatId) {
  const row = db.prepare('SELECT COUNT(*) AS total FROM beat_comments WHERE beat_id = ?').get(beatId);
  return row.total;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, dbPath: DB_PATH });
});

app.get('/api/beats/:beatRef/stats', (req, res) => {
  const beatId = resolveBeatId(req.params.beatRef);
  if (!beatId) {
    return res.status(404).json({ error: 'Beat introuvable' });
  }

  return res.json({
    beatId,
    likes: getLikesCount(beatId),
    comments: getCommentsCount(beatId)
  });
});

app.post('/api/beats/:beatRef/likes', (req, res) => {
  const beatId = resolveBeatId(req.params.beatRef);
  if (!beatId) {
    return res.status(404).json({ error: 'Beat introuvable' });
  }

  const { userId, sessionId, liked } = req.body;

  if (!userId && !sessionId) {
    return res.status(400).json({ error: 'userId ou sessionId est obligatoire' });
  }

  if (typeof liked !== 'boolean') {
    return res.status(400).json({ error: 'liked doit être true ou false' });
  }

  const existing = db
    .prepare(
      `SELECT id FROM beat_likes
       WHERE beat_id = ?
       AND ((user_id = ? AND ? IS NOT NULL) OR (session_id = ? AND ? IS NOT NULL))`
    )
    .get(beatId, userId || null, userId || null, sessionId || null, sessionId || null);

  if (existing) {
    db.prepare(
      `UPDATE beat_likes
       SET is_liked = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(liked ? 1 : 0, existing.id);
  } else {
    db.prepare(
      `INSERT INTO beat_likes (beat_id, user_id, session_id, is_liked)
       VALUES (?, ?, ?, ?)`
    ).run(beatId, userId || null, sessionId || null, liked ? 1 : 0);
  }

  return res.json({
    beatId,
    liked,
    likes: getLikesCount(beatId)
  });
});

app.get('/api/beats/:beatRef/comments', (req, res) => {
  const beatId = resolveBeatId(req.params.beatRef);
  if (!beatId) {
    return res.status(404).json({ error: 'Beat introuvable' });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const comments = db
    .prepare(
      `SELECT id, beat_id AS beatId, author_name AS authorName, comment_text AS text, created_at AS createdAt
       FROM beat_comments
       WHERE beat_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(beatId, limit, offset);

  return res.json({
    beatId,
    total: getCommentsCount(beatId),
    comments
  });
});

app.post('/api/beats/:beatRef/comments', (req, res) => {
  const beatId = resolveBeatId(req.params.beatRef);
  if (!beatId) {
    return res.status(404).json({ error: 'Beat introuvable' });
  }

  const { userId, sessionId, authorName, text } = req.body;

  if (!authorName || !String(authorName).trim()) {
    return res.status(400).json({ error: 'authorName est obligatoire' });
  }

  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'text est obligatoire' });
  }

  db.prepare(
    `INSERT INTO beat_comments (beat_id, user_id, session_id, author_name, comment_text)
     VALUES (?, ?, ?, ?, ?)`
  ).run(beatId, userId || null, sessionId || null, String(authorName).trim(), String(text).trim());

  return res.status(201).json({
    beatId,
    comments: getCommentsCount(beatId)
  });
});

app.get('/api/admin/overview', (req, res) => {
  const beats = db
    .prepare(
      `SELECT b.id, b.slug, b.title,
              SUM(CASE WHEN l.is_liked = 1 THEN 1 ELSE 0 END) AS likes,
              COUNT(DISTINCT c.id) AS comments
       FROM beats b
       LEFT JOIN beat_likes l ON l.beat_id = b.id
       LEFT JOIN beat_comments c ON c.beat_id = b.id
       GROUP BY b.id
       ORDER BY likes DESC, comments DESC, b.id DESC`
    )
    .all();

  const totals = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM beat_likes WHERE is_liked = 1) AS totalLikes,
        (SELECT COUNT(*) FROM beat_comments) AS totalComments,
        (SELECT COUNT(*) FROM beats) AS totalBeats`
    )
    .get();

  res.json({ totals, beats });
});

app.get('/api/beats/download-all', (req, res) => {
  if (!fs.existsSync(MUSIC_DIR)) {
    return res.status(404).json({ error: 'Dossier music introuvable' });
  }

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', 'attachment; filename="dany-beats-all.tar.gz"');

  const tarProcess = spawn('tar', ['-czf', '-', '-C', path.dirname(MUSIC_DIR), path.basename(MUSIC_DIR)]);

  tarProcess.stdout.pipe(res);

  tarProcess.on('error', (error) => {
    if (!res.headersSent) {
      return res.status(500).json({ error: `Impossible de générer l'archive: ${error.message}` });
    }

    res.end();
  });

  tarProcess.stderr.on('data', (chunk) => {
    console.error(`[download-all] tar stderr: ${chunk.toString()}`);
  });

  tarProcess.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) {
      res.status(500).end();
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ API DANY BEATS lancée sur http://localhost:${PORT}`);
});
