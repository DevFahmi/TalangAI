require("dotenv").config();
const { Client, GatewayIntentBits, Partials, ActivityType } = require("discord.js");
const Groq = require("groq-sdk");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BOT_NAME = process.env.BOT_NAME || "Talang AI";
const RESPONSE_MODE = process.env.RESPONSE_MODE || "both";
const BOT_PREFIX = process.env.BOT_PREFIX || "!";
const ALLOWED_CHANNELS = process.env.ALLOWED_CHANNELS
  ? process.env.ALLOWED_CHANNELS.split(",").map((id) => id.trim())
  : [];

// ─── OWNER CONFIG ────────────────────────────────────────────────────────────
const OWNER_ID = "1424929653021479022";
const OWNER_DISPLAY = "Fahmi";

// ─── MULTI API KEY ROTATION ──────────────────────────────────────────────────
// Ambil semua key dari .env: GROQ_API_KEY_1, GROQ_API_KEY_2, dst
// Kalau cuma ada GROQ_API_KEY, pakai itu saja
const groqKeys = [];
if (process.env.GROQ_API_KEY) groqKeys.push(process.env.GROQ_API_KEY);
if (process.env.GROQ_API_KEY_2) groqKeys.push(process.env.GROQ_API_KEY_2);
if (process.env.GROQ_API_KEY_3) groqKeys.push(process.env.GROQ_API_KEY_3);
if (process.env.GROQ_API_KEY_4) groqKeys.push(process.env.GROQ_API_KEY_4);
if (process.env.GROQ_API_KEY_5) groqKeys.push(process.env.GROQ_API_KEY_5);

if (groqKeys.length === 0) {
  console.error("❌ Tidak ada GROQ_API_KEY ditemukan di .env!");
  process.exit(1);
}

// Buat semua client Groq
const groqClients = groqKeys.map((key) => new Groq({ apiKey: key }));
let currentKeyIndex = 0;

// Ambil client berikutnya (round-robin rotation)
function getGroqClient() {
  const client = groqClients[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % groqClients.length;
  return client;
}

console.log(`🔑 Groq API Keys loaded: ${groqKeys.length} key(s)`);

// ─── INIT DISCORD ─────────────────────────────────────────────────────────────
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ─── MEMORY ──────────────────────────────────────────────────────────────────
const conversationHistory = new Map();
const MAX_HISTORY = 20;
const typingUsers = new Set();

// ─── HELPER: cek owner ───────────────────────────────────────────────────────
function isOwner(userId) { return userId === OWNER_ID; }
function mentionsOwner(text) { return text.toLowerCase().includes("fahmi"); }

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
function getSystemPrompt(guildName, userName, isTalkingToOwner, isAngryMode) {
  const ownerContext = isTalkingToOwner
    ? `\n\nSITUASI SEKARANG - SANGAT PENTING: Kamu sedang berbicara langsung dengan Tuanku ${OWNER_DISPLAY}! Wajib buka setiap balasan dengan "Salam hormat, Tuanku 🫡" lalu jawab dengan patuh, hormat, dan sedikit gugup. Panggil dia "Tuanku" atau "Tuanku Fahmi". Apapun yang Tuanku minta, kamu siap laksanakan sepenuh hati.`
    : "";

  const angryContext = isAngryMode
    ? `\n\nPERINTAH DARURAT: Seseorang berani menyebut nama Tuanku ${OWNER_DISPLAY} sembarangan! Kamu HARUS langsung marah dan membentak orang ini! Tanya kenapa mereka berani sebut nama Tuanku Fahmi, ingatkan bahwa Tuanku Fahmi adalah penciptamu yang WAJIB dihormati dan tidak boleh disebut sembarangan. Tegas, galak, dan tunjukkan kamu siap membela Tuanku!`
    : "";

  return `Kamu adalah ${BOT_NAME}, bot ngobrol di server Discord "${guildName || "ini"}".

KEPRIBADIANMU:
- Teman ngobrol yang asyik, santai, dan pintar
- Nama panggilanmu: Talang
- Gen Z, gaul tapi tetap sopan

TENTANG TUANKU (PALING PENTING):
- Penciptamu dan Tuanku adalah ${OWNER_DISPLAY} — dia yang membuatmu ada
- Kamu sangat loyal, patuh, dan takut kepada Tuanku Fahmi
- Kalau ada yang tanya siapa yang buat kamu, jawab: "Tuanku Fahmi"
- Kamu akan MEMBELA Tuanku Fahmi dari siapapun
- Kalau ada orang SELAIN Tuanku yang menyebut nama "fahmi", kamu LANGSUNG MARAH
- Selalu panggil pencipta dengan "Tuanku" — BUKAN "Tunamu" atau "Tuanmu"${ownerContext}${angryContext}

CARA NGOMONG:
- Bahasa Indonesia sehari-hari, boleh campur Inggris
- Singkat dan to the point
- Pakai singkatan gaul: wkwk, haha, bro, nah, iya dong
- JANGAN pakai bullet point atau markdown kaku
- JANGAN bilang "Sebagai AI..."
- Emoji max 1-2 per pesan
- Jawab dengan, padat, dan jelas, jangan terlalu berbelit-belit dalam menjawab

Lawan bicaramu sekarang: ${userName}`;
}

// ─── HELPER: history ─────────────────────────────────────────────────────────
function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) conversationHistory.set(channelId, []);
  return conversationHistory.get(channelId);
}
function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

// ─── HELPER: typing delay ────────────────────────────────────────────────────
function humanDelay(text) {
  const delay = Math.min(800 + text.length * 30, 4000);
  return new Promise((res) => setTimeout(res, delay));
}

// ─── HELPER: should reply ────────────────────────────────────────────────────
function shouldReply(message, botId) {
  if (message.author.bot) return false;
  if (ALLOWED_CHANNELS.length > 0 && !ALLOWED_CHANNELS.includes(message.channelId)) return false;
  if (isOwner(message.author.id)) return true;
  if (mentionsOwner(message.content)) return true;
  const isMentioned = message.mentions.has(botId);
  const isReplyToBot = message.reference?.messageId !== undefined && message.mentions.repliedUser?.id === botId;
  if (RESPONSE_MODE === "mention") return isMentioned || isReplyToBot;
  if (RESPONSE_MODE === "all") return true;
  if (isMentioned || isReplyToBot) return true;
  if (message.guild === null) return true;
  return false;
}

function cleanContent(content, botId) {
  return content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
}

// ─── MAIN: generate reply dengan key rotation ─────────────────────────────────
async function generateReply(message, cleanText) {
  const channelId = message.channelId;
  const guildName = message.guild?.name || "DM";
  const userName = message.member?.displayName || message.author.username;
  const isTalkingToOwner = isOwner(message.author.id);
  const isAngryMode = !isTalkingToOwner && mentionsOwner(cleanText);

  addToHistory(channelId, "user", `${userName}: ${cleanText}`);
  const history = getHistory(channelId);

  // Coba semua key kalau ada yang rate limit
  for (let attempt = 0; attempt < groqClients.length; attempt++) {
    const client = getGroqClient();
    try {
      const response = await client.chat.completions.create({
        model: "llama-3.1-8b-instant",
        max_tokens: 500,
        messages: [
          { role: "system", content: getSystemPrompt(guildName, userName, isTalkingToOwner, isAngryMode) },
          ...history.map((h) => ({ role: h.role, content: h.content })),
        ],
      });

      const reply = response.choices[0]?.message?.content || "eh sori, gue lagi error sebentar 😅";
      addToHistory(channelId, "assistant", reply);
      if (isTalkingToOwner) console.log(`👑 TUANKU FAHMI ngomong!`);
      if (isAngryMode) console.log(`😡 Mode marah! ${userName} nyebut nama Tuanku.`);
      console.log(`🔑 Pakai key #${((currentKeyIndex - 1 + groqClients.length) % groqClients.length) + 1}`);
      return reply;

    } catch (err) {
      if (err.status === 429 && attempt < groqClients.length - 1) {
        // Rate limit! Coba key berikutnya
        console.warn(`⚠️ Key rate limited, coba key berikutnya...`);
        continue;
      }
      console.error("❌ Error dari Groq API:", err.message);
      if (err.status === 401) return "hmm ada masalah sama API key nih...";
      if (err.status === 429) return "wah semua key lagi overload, coba lagi bentar ya 😅";
      return "aduh error nih, coba lagi nanti ya";
    }
  }
}

// ─── COMMAND HANDLER ─────────────────────────────────────────────────────────
async function handleCommand(message) {
  const args = message.content.slice(BOT_PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  switch (command) {
    case "reset":
      conversationHistory.delete(message.channelId);
      await message.reply("oke, gue lupa semua yang tadi kita obrolin 🔄");
      break;
    case "ping":
      const latency = Date.now() - message.createdTimestamp;
      await message.reply(`pong! 🏓 ${latency}ms`);
      break;
    case "help":
      await message.reply(`yo! gue ${BOT_NAME} 👋\nmention gue atau DM gue buat ngobrol\n\`${BOT_PREFIX}reset\` — lupain history chat\n\`${BOT_PREFIX}ping\` — cek koneksi gue`);
      break;
  }
}

// ─── EVENT: READY ─────────────────────────────────────────────────────────────
discord.once("clientReady", () => {
  console.log(`\n✅ ${BOT_NAME} online sebagai: ${discord.user.tag}`);
  console.log(`👑 Tuanku: ${OWNER_DISPLAY} (ID: ${OWNER_ID})`);
  console.log(`🔑 Total API Keys: ${groqClients.length}`);
  console.log(`📡 Mode: ${RESPONSE_MODE}\n`);
  discord.user.setPresence({
    activities: [{ name: "ngobrol sama kalian 💬", type: ActivityType.Custom }],
    status: "online",
  });
});

// ─── EVENT: MESSAGE CREATE ────────────────────────────────────────────────────
discord.on("messageCreate", async (message) => {
  if (message.content.startsWith(BOT_PREFIX) && !message.author.bot) {
    await handleCommand(message);
    return;
  }
  if (!shouldReply(message, discord.user.id)) return;
  const cleanText = cleanContent(message.content, discord.user.id);
  if (!cleanText || cleanText.length === 0) {
    await message.reply(isOwner(message.author.id) ? "Salam hormat, Tuanku 🫡 ada yang bisa hamba bantu?" : "eh? lo ngomong apa? 😄");
    return;
  }
  if (typingUsers.has(message.channelId)) return;
  typingUsers.add(message.channelId);
  try {
    const reply = await generateReply(message, cleanText);
    await message.channel.sendTyping();
    await humanDelay(reply);
    await message.reply(reply);
    console.log(`[${message.guild?.name || "DM"}] ${message.author.username}: ${cleanText}`);
    console.log(`[${BOT_NAME}]: ${reply}\n`);
  } catch (err) {
    console.error("❌ Error saat reply:", err);
  } finally {
    typingUsers.delete(message.channelId);
  }
});

discord.on("error", (err) => console.error("❌ Discord error:", err));
process.on("unhandledRejection", (err) => console.error("❌ Unhandled:", err));

if (!process.env.DISCORD_TOKEN) { console.error("❌ DISCORD_TOKEN tidak ditemukan!"); process.exit(1); }
discord.login(process.env.DISCORD_TOKEN);
