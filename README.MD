# 🤖 Talang AI — Discord Bot

Bot Discord yang ngobrol kayak manusia beneran, powered by Claude AI.

---

## ⚡ Fitur

- 💬 Balas pesan seperti manusia (santai, gaul, natural)
- 🧠 Ingat riwayat percakapan per channel (20 pesan terakhir)
- ⌨️ Simulasi "sedang mengetik..." sebelum balas
- 🎯 Bisa di-mention atau reply otomatis
- 📩 Support DM (Direct Message)
- 🔧 Command bawaan: `!reset`, `!ping`, `!help`

---

## 🛠️ Cara Setup

### 1. Buat Discord Bot

1. Buka [Discord Developer Portal](https://discord.com/developers/applications)
2. Klik **New Application** → kasih nama "Talang AI"
3. Masuk ke menu **Bot** → klik **Add Bot**
4. Di bagian **Privileged Gateway Intents**, aktifkan:
   - ✅ `SERVER MEMBERS INTENT`
   - ✅ `MESSAGE CONTENT INTENT`
5. Klik **Reset Token** → copy token-nya
6. Masuk **OAuth2 → URL Generator**:
   - Scope: `bot`
   - Bot Permissions: `Send Messages`, `Read Messages/View Channels`, `Read Message History`
7. Copy URL yang dihasilkan → paste di browser → invite bot ke server

### 2. Dapatkan Anthropic API Key

1. Daftar di [console.anthropic.com](https://console.anthropic.com)
2. Masuk **API Keys** → buat key baru
3. Copy key-nya

### 3. Install & Jalankan

```bash
# Clone / extract folder ini
cd talang-ai-bot

# Install dependencies
npm install

# Buat file .env dari template
cp .env.example .env

# Edit .env dan isi token + API key
nano .env   # atau pakai text editor apapun
```

### 4. Isi file `.env`

```env
DISCORD_TOKEN=token_discord_kamu_disini
ANTHROPIC_API_KEY=api_key_anthropic_kamu_disini

# Opsional: batasi ke channel tertentu (ID channel, pisah koma)
ALLOWED_CHANNELS=

# Mode reply: "mention" | "all" | "both"
RESPONSE_MODE=both
```

### 5. Jalankan Bot

```bash
# Jalankan biasa
npm start

# Atau pakai nodemon (auto-restart saat file berubah)
npm run dev
```

---

## 🎮 Commands

| Command | Fungsi |
|---------|--------|
| `!ping` | Cek bot online + latency |
| `!reset` | Hapus riwayat chat di channel |
| `!help` | Tampilkan info bot |

---

## 💡 Tips Pakai

- **Mention bot** → `@Talang AI hei bro!`
- **DM bot langsung** → bot selalu balas di DM
- Kalau mau bot balas **semua pesan** di channel tertentu → set `RESPONSE_MODE=all` dan isi `ALLOWED_CHANNELS` dengan ID channel-nya

---

## 🚀 Deploy ke VPS / Server (opsional)

```bash
# Install PM2 agar bot tetap jalan 24/7
npm install -g pm2

pm2 start index.js --name "talang-ai"
pm2 save
pm2 startup
```

---

## ❓ Troubleshooting

| Error | Solusi |
|-------|--------|
| `DISCORD_TOKEN tidak ditemukan` | Pastikan file `.env` sudah diisi dengan benar |
| `401 Unauthorized` | Cek ulang ANTHROPIC_API_KEY |
| Bot online tapi nggak balas | Aktifkan **MESSAGE CONTENT INTENT** di Developer Portal |
| Bot nggak masuk channel | Pastikan bot punya permission di channel itu |
