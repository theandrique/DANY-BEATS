# Backend DB (likes + commentaires)

Ce backend ajoute une base SQLite + API REST pour stocker et afficher les likes/commentaires des utilisateurs.

## 1) Installation

```bash
cd backend
npm install
npm start
```

API disponible sur `http://localhost:4000`.

## 2) Base de données

Le schéma est dans `backend/schema.sql`:
- `users`
- `beats`
- `beat_likes`
- `beat_comments`

Le fichier SQLite est créé automatiquement: `backend/danybeats.db`.

## 3) Endpoints utiles

### Health
```http
GET /api/health
```

### Statistiques d'un beat
```http
GET /api/beats/:beatRef/stats
```
`beatRef` peut être un id (`12`) ou un slug (`trap-01`).

### Like / Unlike
```http
POST /api/beats/:beatRef/likes
Content-Type: application/json

{
  "sessionId": "browser-uuid",
  "liked": true
}
```

### Lister les commentaires
```http
GET /api/beats/:beatRef/comments?limit=20&offset=0
```

### Ajouter un commentaire
```http
POST /api/beats/:beatRef/comments
Content-Type: application/json

{
  "sessionId": "browser-uuid",
  "authorName": "Dany Fan",
  "text": "Le beat est trop lourd 🔥"
}
```

### Vue admin (stats globales)
```http
GET /api/admin/overview
```

## 4) Exemple d'intégration front (`index.html`)

```js
const API_BASE = 'http://localhost:4000/api';

async function loadBeatStats(beatId) {
  const res = await fetch(`${API_BASE}/beats/${beatId}/stats`);
  const data = await res.json();
  document.getElementById(`like-count-${beatId}`).textContent = data.likes;
  document.getElementById(`comment-count-${beatId}`).textContent = data.comments;
}

async function likeBeat(beatId, sessionId, liked) {
  const res = await fetch(`${API_BASE}/beats/${beatId}/likes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, liked })
  });
  return res.json();
}

async function addComment(beatId, sessionId, authorName, text) {
  const res = await fetch(`${API_BASE}/beats/${beatId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, authorName, text })
  });
  return res.json();
}
```

## 5) Conseils production

- Mettre Nginx/Apache devant l'API.
- Ajouter authentification (JWT/session serveur) pour sécuriser les actions.
- Ajouter rate-limit anti-spam sur les commentaires.
- Prévoir modération (`status: pending/approved/rejected`) dans `beat_comments`.
