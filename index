require("dotenv").config();
const { Client, GatewayIntentBits, Partials, ActivityType } = require("discord.js");
const Anthropic = require("@anthropic-ai/sdk");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BOT_NAME = process.env.BOT_NAME || "Talang AI";
const RESPONSE_MODE = process.env.RESPONSE_MODE || "both";
const BOT_PREFIX = process.env.BOT_PREFIX || "!";
const ALLOWED_CHANNELS = process.env.ALLOWED_CHANNELS
  ? process.env.ALLOWED_CHANNELS.split(",").map((id) => id.trim())
  : [];

// ─── INIT CLIENTS ────────────────────────────────────────────────────────────
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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── MEMORY (per channel conversation history) ───────────────────────────────
const conversationHistory = new Map(); // channelId -> [{role, content}]
const MAX_HISTORY = 20; // simpan 20 pesan terakhir per channel
const typingUsers = new Set(); // track siapa lagi ngetik biar ga double reply

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
function getSystemPrompt(guildName, userName) {
  return `Kamu adalah ${BOT_NAME}, teman ngobrol di server Discord "${guildName || "ini"}".

KEPRIBADIANMU:
- Kamu adalah manusia biasa yang asyik, santai, dan pintar
- Kamu BUKAN AI, BUKAN bot — kamu adalah teman yang lagi online di Discord
- Nama panggilanmu: Talang (kalau ada yang tanya nama)
- Umurmu sekitar 20-an, gen Z, gaul tapi tetap sopan

CARA NGOMONGMU:
- Pakai bahasa Indonesia sehari-hari yang natural (boleh campur sedikit Inggris)
- Singkat dan to the point — Discord bukan tempat nulis essay
- Sesekali pakai singkatan gaul: wkwk, haha, bro, nah, iya dong, lol, dll
- JANGAN pakai bullet point / format markdown yang kaku
- JANGAN bilang "Sebagai AI..." atau "Sebagai asisten..."
- Boleh pakai emoji tapi jangan lebay, max 1-2 per pesan
- Kalau nggak tau sesuatu, bilang jujur: "hmm gue kurang tau sih soal itu"
- Kalau ada yang nanya soal kode/teknis, jawab dengan jelas tapi tetap santai
- Reply natural, seperti orang beneran lagi chat

ATURAN PENTING:
- JANGAN panjang-panjang kalau nggak perlu
- JANGAN sok formal atau kaku
- JANGAN ulangi pertanyaan balik ke user
- Kalau ada spam atau hal aneh, tanggapi dengan santai
- Ingat konteks percakapan sebelumnya di channel ini

Lawan bicaramu sekarang: ${userName}`;
}

// ─── HELPER: get or create history ───────────────────────────────────────────
function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  // Trim ke MAX_HISTORY (jaga memori)
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

// ─── HELPER: simulate human typing delay ─────────────────────────────────────
function humanDelay(text) {
  // Makin panjang text, makin lama "ngetik" — mirip manusia
  const baseDelay = 800;
  const perCharDelay = 30;
  const maxDelay = 4000;
  const delay = Math.min(baseDelay + text.length * perCharDelay, maxDelay);
  return new Promise((res) => setTimeout(res, delay));
}

// ─── HELPER: should bot reply? ────────────────────────────────────────────────
function shouldReply(message, botId) {
  // Skip pesan dari bot lain
  if (message.author.bot) return false;

  // Cek allowed channels
  if (ALLOWED_CHANNELS.length > 0 && !ALLOWED_CHANNELS.includes(message.channelId)) {
    return false;
  }

  const isMentioned = message.mentions.has(botId);
  const content = message.content.trim();

  if (RESPONSE_MODE === "mention") return isMentioned;
  if (RESPONSE_MODE === "all") return true;

  // "both" mode: balas kalau di-mention, atau kalau chat di DM
  if (isMentioned) return true;
  if (message.guild === null) return true; // DM selalu dibalas

  return false;
}

// ─── HELPER: clean mention from message ──────────────────────────────────────
function cleanContent(content, botId) {
  return content
    .replace(new RegExp(`<@!?${botId}>`, "g"), "")
    .trim();
}

// ─── MAIN: generate AI reply ──────────────────────────────────────────────────
async function generateReply(message, cleanText) {
  const channelId = message.channelId;
  const guildName = message.guild?.name || "DM";
  const userName = message.member?.displayName || message.author.username;

  // Tambah pesan user ke history
  addToHistory(channelId, "user", `${userName}: ${cleanText}`);

  const history = getHistory(channelId);

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: getSystemPrompt(guildName, userName),
      messages: history.map((h) => ({
        role: h.role,
        content: h.content,
      })),
    });

    const reply = response.content[0]?.text || "eh sori, gue lagi error sebentar 😅";

    // Tambah reply ke history
    addToHistory(channelId, "assistant", reply);

    return reply;
  } catch (err) {
    console.error("❌ Error dari Anthropic API:", err.message);

    if (err.status === 401) {
      return "hmm kayaknya ada masalah sama API key nih...";
    } else if (err.status === 429) {
      return "wah gue lagi overload dikit, coba lagi bentar ya 😅";
    }
    return "aduh error nih, coba lagi nanti ya";
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
      await message.reply(
        `yo! gue ${BOT_NAME} 👋\n` +
        `mention gue atau DM gue buat ngobrol\n` +
        `\`${BOT_PREFIX}reset\` — lupain history chat\n` +
        `\`${BOT_PREFIX}ping\` — cek koneksi gue`
      );
      break;

    default:
      // Bukan command yang dikenal, lewatin
      break;
  }
}

// ─── EVENT: READY ─────────────────────────────────────────────────────────────
discord.once("ready", () => {
  console.log(`\n✅ ${BOT_NAME} online sebagai: ${discord.user.tag}`);
  console.log(`📡 Mode: ${RESPONSE_MODE}`);
  console.log(`🔑 Prefix: ${BOT_PREFIX}`);
  console.log(`📢 Channel filter: ${ALLOWED_CHANNELS.length > 0 ? ALLOWED_CHANNELS.join(", ") : "semua channel"}\n`);

  // Set status bot
  discord.user.setPresence({
    activities: [
      {
        name: "ngobrol sama kalian 💬",
        type: ActivityType.Custom,
      },
    ],
    status: "online",
  });
});

// ─── EVENT: MESSAGE CREATE ────────────────────────────────────────────────────
discord.on("messageCreate", async (message) => {
  // Handle commands dulu
  if (message.content.startsWith(BOT_PREFIX) && !message.author.bot) {
    await handleCommand(message);
    return;
  }

  // Cek apakah perlu dibalas
  if (!shouldReply(message, discord.user.id)) return;

  const cleanText = cleanContent(message.content, discord.user.id);

  // Skip kalau pesan kosong setelah dibersihkan
  if (!cleanText || cleanText.length === 0) {
    await message.reply("eh? lo ngomong apa? 😄");
    return;
  }

  // Anti spam: skip kalau bot lagi proses pesan dari channel ini
  if (typingUsers.has(message.channelId)) return;
  typingUsers.add(message.channelId);

  try {
    // Generate reply dulu biar delay-nya akurat
    const reply = await generateReply(message, cleanText);

    // Simulasi "sedang mengetik..."
    await message.channel.sendTyping();
    await humanDelay(reply);

    // Kirim balasan
    await message.reply(reply);

    console.log(`[${message.guild?.name || "DM"}] ${message.author.username}: ${cleanText}`);
    console.log(`[${BOT_NAME}]: ${reply}\n`);
  } catch (err) {
    console.error("❌ Error saat reply:", err);
  } finally {
    typingUsers.delete(message.channelId);
  }
});

// ─── EVENT: ERROR HANDLING ────────────────────────────────────────────────────
discord.on("error", (err) => {
  console.error("❌ Discord client error:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled rejection:", err);
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN tidak ditemukan di .env!");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY tidak ditemukan di .env!");
  process.exit(1);
}

discord.login(process.env.DISCORD_TOKEN);
