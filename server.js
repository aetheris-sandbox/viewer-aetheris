// server.js — simple signed-url proxy for serving model files
// Usage: SIGN_SECRET=your_secret node server.js

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SIGN_SECRET = process.env.SIGN_SECRET || 'dev-secret';
const MODELS_DIR = path.join(__dirname, 'models');

function sign(name, expires) {
  const hmac = crypto.createHmac('sha256', SIGN_SECRET);
  hmac.update(name + '|' + expires);
  return hmac.digest('hex');
}

function verify(name, expires, sig) {
  if (!name || !expires || !sig) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now > Number(expires)) return false;
  const expected = sign(name, expires);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// Endpoint: /api/getSignedUrl?name=AK-47.glb&ttl=60
app.get('/api/getSignedUrl', (req, res) => {
  const name = req.query.name;
  const ttl = parseInt(req.query.ttl || '60', 10);
  if (!name) return res.status(400).json({ error: 'missing name' });
  const filePath = path.join(MODELS_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const sig = sign(name, expires);
  // Return a URL relative to this server
  const url = `/protected/models/${encodeURIComponent(name)}?expires=${expires}&sig=${sig}`;
  return res.json({ url });
});

// Protected direct serving route
app.get('/protected/models/:name', (req, res) => {
  const name = req.params.name;
  const expires = req.query.expires;
  const sig = req.query.sig;
  if (!verify(name, expires, sig)) return res.status(403).send('Forbidden');
  const filePath = path.join(MODELS_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

  // Stream the file with no-cache and inline disposition
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline; filename="' + path.basename(name) + '"');
  res.setHeader('Cache-Control', 'no-store');
  // optional: restrict CORS if viewer is hosted elsewhere
  res.setHeader('Access-Control-Allow-Origin', '*');

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Signed model proxy running on http://localhost:${PORT}`);
  console.log('Set SIGN_SECRET env var in production.');
});
