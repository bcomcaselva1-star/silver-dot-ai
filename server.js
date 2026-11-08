require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const JWT_SECRET = process.env.JWT_SECRET || 'silver-dot-ai-3000-secret';
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Simple JSON Database - No install needed!
const DB_FILE = path.join(__dirname, 'db.json');
let DB = { users: [], chats: [], messages: [] };
if (fs.existsSync(DB_FILE)) { try { DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e){} }
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(DB)); }

const PLANS = { free: { model: 'llama-3.3-70b-versatile', daily: 20 }, pro: { model: 'llama-3.3-70b-versatile', daily: 1000 } };

function auth(req, res, next){
  const h = req.headers.authorization || '';
  const token = h.replace('Bearer ', '');
  if(!token) return next();
  try{ req.user = jwt.verify(token, JWT_SECRET); }catch(e){}
  next();
}
app.use(auth);

// Register
app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if(!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if(DB.users.find(u => u.email === email)) return res.status(400).json({ error: 'User already exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), email, name: name || email.split('@')[0], password: hash, plan: 'free', createdAt: new Date().toISOString() };
  DB.users.push(user); saveDB();
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = DB.users.find(u => u.email === email);
  if(!user) return res.status(400).json({ error: 'User not found' });
  const ok = await bcrypt.compare(password, user.password);
  if(!ok) return res.status(400).json({ error: 'Wrong password' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
});

app.get('/api/me', (req, res) => {
  if(!req.user) return res.status(401).json({ error: 'No token' });
  const user = DB.users.find(u => u.id === req.user.id);
  if(!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, email: user.email, name: user.name, plan: user.plan });
});

// CHAT - GROQ FREE
async function handleChat(req, res){
  try{
    const body = req.body || {};
    let messages = body.messages || [];
    if(body.message) messages = [{ role: 'user', content: body.message }];
    if(body.prompt) messages = [{ role: 'user', content: body.prompt }];
    if(!messages.length) return res.status(400).json({ error: 'No message' });

    const clean = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || String(m.content))
    }));

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: 'You are Silver Dot AI, a helpful AI assistant.' }, ...clean],
      max_tokens: 2000,
      temperature: 0.7,
    });
    const reply = completion.choices[0]?.message?.content || 'Sorry, no reply';
    res.json({ reply, response: reply, content: reply, message: reply, text: reply, choices: [{ message: { content: reply, role: 'assistant' } }] });
  } catch(e){
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
app.post('/api/chat', handleChat);
app.post('/api/message', handleChat);
app.post('/api/messages', handleChat);
app.post('/chat', handleChat);

app.get('*', (req, res) => {
  const p = path.join(__dirname, 'public', 'index.html');
  if(fs.existsSync(p)) return res.sendFile(p);
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Silver Dot AI on ' + PORT));
