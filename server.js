require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Simple JSON Database
const DB_FILE = path.join(__dirname, 'db.json');
let DB = { users: [], chats: [], messages: [] };
if (fs.existsSync(DB_FILE)) { try { DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e){} }
function saveDB(){ try{ fs.writeFileSync(DB_FILE, JSON.stringify(DB)); }catch(e){} }

// GUEST USER - No Login Needed
const GUEST_ID = 'guest-1';
function getChats(){ return DB.chats.filter(c => c.userId === GUEST_ID); }

// --- CHATS ---
app.get('/api/chats', (req, res) => {
  res.json(getChats().map(c => ({ id: c.id, title: c.title || 'Chat' })));
});

app.get('/api/chats/:id', (req, res) => {
  const msgs = DB.messages.filter(m => String(m.chatId) === String(req.params.id));
  res.json(msgs.map(m => ({ role: m.role, content: m.content })));
});

app.delete('/api/chats/:id', (req, res) => {
  DB.chats = DB.chats.filter(c => String(c.id) !== String(req.params.id));
  DB.messages = DB.messages.filter(m => String(m.chatId) !== String(req.params.id));
  saveDB(); res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ id: GUEST_ID, email: 'guest@silverdot.ai', name: 'Guest', plan: 'pro' });
});

// --- CHAT - GROQ - STREAMING ---
async function handleChat(req, res){
  try{
    const body = req.body || {};
    let userText = body.message || body.prompt || '';
    if(body.messages && body.messages.length) userText = body.messages[body.messages.length-1].content || userText;
    if(!userText) return res.status(400).json({ error: 'No message' });

    if(!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY missing in Render Env! Add it!' });

    // Get or Create Chat
    let chatId = body.chatId;
    let chat = DB.chats.find(c => String(c.id) === String(chatId));
    if(!chat){
      chatId = Date.now();
      chat = { id: chatId, userId: GUEST_ID, title: userText.slice(0, 40), createdAt: new Date().toISOString() };
      DB.chats.unshift(chat);
    }
    DB.messages.push({ chatId, role: 'user', content: userText });
    saveDB();

    // STREAMING - Frontend expects this!
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('X-Chat-Id', String(chatId));

    const stream = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'system', content: 'You are Silver Dot AI, a helpful AI assistant.' }, { role: 'user', content: userText }],
      max_tokens: 2000,
      temperature: 0.7,
      stream: true,
    });

    let full = '';
    for await (const chunk of stream){
      const txt = chunk.choices[0]?.delta?.content || '';
      if(txt){ full += txt; res.write(txt); }
    }
    DB.messages.push({ chatId, role: 'assistant', content: full });
    saveDB();
    res.end();
  } catch(e){
    console.error('CHAT ERROR:', e.message);
    if(!res.headersSent) return res.status(500).json({ error: e.message });
    res.write('[Error: ' + e.message + ']');
    res.end();
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
