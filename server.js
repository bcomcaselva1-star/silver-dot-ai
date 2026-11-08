require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const JWT_SECRET = process.env.JWT_SECRET || "silver-dot-ai-3000-secret";
const PLANS = { free: { model: "claude-sonnet-4-20250514", daily: 3000 }, pro: { model: "claude-sonnet-4-20250514", daily: 3000 }, max: { model: "claude-sonnet-4-20250514", daily: 3000 } };

// Simple JSON Database - No install needed!
const DB_FILE = "selva.json";
let DB = { users: [], chats: [], messages: [], usage: [] };
if (fs.existsSync(DB_FILE)) { try { DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch {} }
function save() { fs.writeFileSync(DB_FILE, JSON.stringify(DB)); }
let nextId = () => Date.now() + Math.floor(Math.random() * 1000);
const today = () => new Date().toISOString().slice(0, 10);
const usedToday = (uid) => { const u = DB.usage.find(x => x.user_id === uid && x.day === today()); return u ? u.count : 0; };

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
const sign = (u) => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: "30d" });
function auth(req, res, next) {
  try {
    const t = (req.headers.authorization || "").replace("Bearer ", "");
    req.user = DB.users.find(u => u.id === jwt.verify(t, JWT_SECRET).id);
    if (!req.user) throw new Error();
    next();
  } catch { res.status(401).json({ error: "Please log in." }); }
}
app.post("/api/signup", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) return res.status(400).json({ error: "Use a valid email and a password of 8+ characters." });
  if (DB.users.find(u => u.email === email.toLowerCase())) return res.status(409).json({ error: "This email is already registered." });
  const user = { id: nextId(), email: email.toLowerCase(), hash: bcrypt.hashSync(password, 10), plan: "free" };
  DB.users.push(user); save();
  res.json({ token: sign(user) });
});
app.post("/api/login", (req, res) => {
  const u = DB.users.find(x => x.email === (req.body.email || "").toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || "", u.hash)) return res.status(401).json({ error: "Wrong email or password." });
  res.json({ token: sign(u) });
});
app.get("/api/me", auth, (req, res) => {
  const p = PLANS[req.user.plan];
  res.json({ email: req.user.email, plan: "PRO MAX FREE", used: usedToday(req.user.id), limit: p.daily });
});
app.get("/api/chats", auth, (req, res) => res.json(DB.chats.filter(c => c.user_id === req.user.id).sort((a,b)=>b.updated-a.updated).map(c=>({id:c.id,title:c.title}))));
app.get("/api/chats/:id", auth, (req, res) => {
  const chat = DB.chats.find(c => c.id == req.params.id && c.user_id === req.user.id);
  if (!chat) return res.sendStatus(404);
  res.json(DB.messages.filter(m => m.chat_id == chat.id).map(m=>({role:m.role,content:m.content})));
});
app.delete("/api/chats/:id", auth, (req, res) => {
  DB.messages = DB.messages.filter(m => m.chat_id != req.params.id);
  DB.chats = DB.chats.filter(c => !(c.id == req.params.id && c.user_id === req.user.id));
  save(); res.sendStatus(204);
});
app.post("/api/chat", auth, async (req, res) => {
  const { message } = req.body; let { chatId } = req.body;
  if (!message) return res.status(400).json({ error: "Message is required." });
  const plan = PLANS[req.user.plan];
  if (usedToday(req.user.id) >= plan.daily) return res.status(429).json({ error: "You reached today's limit. Try tomorrow!" });
  if (chatId) { if (!DB.chats.find(c => c.id == chatId && c.user_id === req.user.id)) return res.sendStatus(404); }
  else { chatId = nextId(); DB.chats.push({ id: chatId, user_id: req.user.id, title: message.slice(0, 40), updated: Date.now() }); }
  DB.messages.push({ id: nextId(), chat_id: chatId, role: "user", content: message });
  let u = DB.usage.find(x => x.user_id === req.user.id && x.day === today());
  if (u) u.count++; else DB.usage.push({ user_id: req.user.id, day: today(), count: 1 });
  save();
  const history = DB.messages.filter(m => m.chat_id == chatId).slice(-40);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Chat-Id", String(chatId));
  let reply = "";
  try {
    const stream = client.messages.stream({ model: plan.model, max_tokens: 4096, system: "You are Silver Dot AI 3000, a friendly assistant. Answer any question. When asked for code or a website, give complete working code in fenced code blocks (a full website goes in one self-contained html block).", messages: history });
    stream.on("text", (t) => { reply += t; res.write(t); });
    await stream.finalMessage();
    DB.messages.push({ id: nextId(), chat_id: chatId, role: "assistant", content: reply });
    const c = DB.chats.find(x => x.id == chatId); if (c) c.updated = Date.now();
    save(); res.end();
  } catch (e) { console.error(e); res.end("\n\n[Error: could not finish the reply]"); }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Silver Dot AI 3000 running at http://localhost:${PORT}`));