/* ============================================================
   VIVID IELTS — Premium Approval Bot
   + Majburiy kanal (Join Request bilan ishlaydi)
   + Narxlar va Admin tugmalari
   + CD TESTLAR va BOOKS (Telegram file_id orqali)
   + Keep-alive
   + STATISTIKA: /stats — foydalanuvchilar soni (admin uchun)
   + ✍️ WRITING CHECKER:
       - Saytdagi Mock Test > Writing bo'limidan yuborilgan insholar — BEPUL
       - Botning o'zidan yuborilgan insholar — PULLIK (to'lov admin tomonidan tasdiqlanadi)
   + 🗣️ SPEAKING CHECKER (YANGI, PULLIK):
       - 3 tarif: Oddiy / Premium / Gold
       - To'lov skrinshotini yuborish → admin tasdiqlaydi → mock avtomatik boshlanadi
       - Part 1: random topic, 4 ta savol, har biriga 25 soniya
       - Part 2: random cue-card, 2 daqiqa
       - Part 3: Part 2 mavzusiga bog'liq 5-6 ta savol, har biriga 40-45 soniya
       - Javoblar matn yoki ovozli xabar (ovoz avtomatik matnga o'giriladi — OpenAI Whisper)
       - To'liq mock (savol-javob) admin(sizga)ga yuboriladi, siz /javob <kod> orqali
         (yoki forward qilingan xabarga REPLY qilib) natija yuborasiz — 60 daqiqa ichida.
   + 🌐 SAYTDAN KELGAN SPEAKING MOCK: /submit-speaking
       - speaking-mock.html/js orqali saytda topshirilgan to'liq mock (matn + audio)
         shu endpoint orqali qabul qilinadi va admin chatga yuboriladi.
   + 🔐 SAYTGA KIRISH KODI: /login
       - Foydalanuvchi botga /login yuboradi, bot 6 xonali kod generatsiya qilib
         Supabase'ga yozadi va foydalanuvchiga yuboradi. Kod 5 daqiqa amal qiladi.
         Saytdagi Edge Function (telegram-code-login) shu kodni tekshirib kirgizadi.
   ============================================================ */

const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const FormData = require('form-data');
const Busboy = require('busboy');

const { PART1, PART2, PART3, PART2_TO_PART3 } = require('./speaking-data');

// ---- Environment variables ----
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PREMIUM_DAYS = parseInt(process.env.PREMIUM_DAYS || '30', 10);

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '-1004304384442';
const CHANNEL_INVITE_LINK = 'https://t.me/+0Wiqg6jiVGc4YTEy';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'vividieltsadmin';
const SITE_URL = process.env.SITE_URL || 'https://vividielt-ss.vercel.app/';

// Writing (bot orqali to'g'ridan-to'g'ri) narxi
const WRITING_PRICE_TEXT = process.env.WRITING_PRICE_TEXT || "12,000 so'm";

// Speaking tariflari
const SPEAKING_TIERS = {
  basic: {
    key: 'basic',
    label: "🟢 Oddiy tarif",
    price: "5,000 so'm",
    priceValue: 5000,
    desc: "Faqat mock natijasi (band ball)",
  },
  premium: {
    key: 'premium',
    label: "🔵 Premium tarif",
    price: "10,000 so'm",
    priceValue: 10000,
    desc: "Natija + umumiy feedback + 7+ band uchun javoblar tahlili",
  },
  gold: {
    key: 'gold',
    label: "🟣 Gold tarif",
    price: "15,000 so'm",
    priceValue: 15000,
    desc: "Premium + Topic Words + Grammar Structures + Topic Videos",
  },
};

// Ovozli xabarlarni matnga o'girish uchun (ixtiyoriy, lekin tavsiya etiladi)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ============================================================
// STATISTIKA (foydalanuvchilar sonini kuzatish)
// ============================================================
const allUsersSeen = new Set();     // barcha vaqtdagi unique userId lar
const dailyActiveUsers = new Set(); // shu kun ichida faol bo'lgan userId lar
let statsDay = new Date().toDateString();
let totalStartCount = 0;            // nechta marta /start bosilgan
let totalPremiumApproved = 0;
let totalWritingChecked = 0;
let totalSpeakingChecked = 0;

function trackUser(userId) {
  const today = new Date().toDateString();
  if (today !== statsDay) {
    statsDay = today;
    dailyActiveUsers.clear();
  }
  allUsersSeen.add(userId);
  dailyActiveUsers.add(userId);
}

// ============================================================
// 🔐 SAYTGA KIRISH KODI (/login)
// ============================================================
function generateLoginCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function issueLoginCode(chatId, userId, fullName) {
  const code = generateLoginCode();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/telegram_login_codes`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      code,
      telegram_id: userId,
      full_name: fullName,
      expires_at: expiresAt,
      used: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('issueLoginCode xato:', errText);
    return bot.sendMessage(chatId, "⚠️ Kod yaratishda xatolik yuz berdi. Birozdan keyin qayta urinib ko'ring.");
  }

  await bot.sendMessage(
    chatId,
    `🔐 Saytga kirish kodingiz:\n\n*${code}*\n\n` +
    `Bu kodni saytdagi "Telegram" tugmasi ostidagi maydonga kiriting.\n` +
    `⏳ Kod *5 daqiqa* amal qiladi va faqat bir marta ishlatiladi.`,
    { parse_mode: 'Markdown' }
  );
}

// ---- HTTP server (+ /submit-writing va /submit-speaking endpointlari sayt uchun) ----
const PORT = process.env.PORT || 3000;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) { // 1MB himoya
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/submit-writing') {
    try {
      const data = await readJsonBody(req);
      const email = (data.email || '').trim();
      const studentName = (data.studentName || '').trim();
      const taskType = (data.taskType || 'Task 2').trim();
      const essayText = (data.essayText || '').trim();

      if (essayText.length < 20) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, message: 'Insho matni juda qisqa.' }));
      }

      const code = generateResultCode();
      submissions[code] = {
        type: 'writing',
        source: 'site',
        email: email || null,
        studentName: studentName || null,
        taskType,
        essayText,
        tier: null,
        status: 'pending',
        feedback: null,
        band: null,
        studentChatId: null,
        createdAt: Date.now(),
      };

      const header =
        `✍️ Yangi Writing (🌐 SAYT orqali — BEPUL)\n\n` +
        `🔑 Kod: ${code}\n` +
        `👤 Ism: ${studentName || '(kiritilmagan)'}\n` +
        `📧 Email: ${email || '(kiritilmagan)'}\n` +
        `📝 Task: ${taskType}\n\n` +
        `— Insho matni quyida —`;

      await bot.sendMessage(ADMIN_CHAT_ID, header);
      const chunks = splitLongText(essayText);
      let lastMsg = null;
      for (const chunk of chunks) {
        lastMsg = await bot.sendMessage(ADMIN_CHAT_ID, chunk);
      }
      if (lastMsg) {
        adminMsgToCode[lastMsg.message_id] = code;
        submissions[code].adminMsgId = lastMsg.message_id;
      }
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `👆 Baholash uchun YUQORIDAGI oxirgi xabarga REPLY qilib, baho va izohingizni yozing.\n(Masalan: "Band: 6.5\\nIzoh: ...")`
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, code }));
    } catch (e) {
      console.error('submit-writing error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, message: 'Server xatosi.' }));
    }
  }

  // ============================================================
  // 🌐 SAYTDAGI SPEAKING MOCK TEST — /submit-speaking
  // speaking-mock.js dan FormData orqali keladi:
  //   - "meta" fieldi (JSON matn): kod, part1/2/3 topiclar, contact, answers[]
  //   - "audio_<index>_part<part>" fieldlari: har bir javobning audio fayli
  // ============================================================
  if (req.method === 'POST' && req.url === '/submit-speaking') {
    try {
      const busboy = Busboy({ headers: req.headers });
      let meta = null;
      const audioFiles = []; // { fieldname, buffer, filename }

      busboy.on('field', (fieldname, val) => {
        if (fieldname === 'meta') {
          try { meta = JSON.parse(val); } catch (e) { meta = null; }
        }
      });

      busboy.on('file', (fieldname, file, info) => {
        const chunks = [];
        file.on('data', (d) => chunks.push(d));
        file.on('end', () => {
          audioFiles.push({ fieldname, buffer: Buffer.concat(chunks), filename: info.filename });
        });
      });

      busboy.on('finish', async () => {
        try {
          if (!meta || !Array.isArray(meta.answers) || meta.answers.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: false, message: "Meta yoki javoblar topilmadi." }));
          }

          const code = meta.code || generateResultCode();
          submissions[code] = {
            type: 'speaking',
            source: 'site',
            tier: null,
            email: null,
            studentName: null,
            status: 'pending',
            feedback: null,
            band: null,
            studentChatId: null,
            contact: meta.contact || null,
            createdAt: Date.now(),
          };

          const header =
            `🗣️ Yangi Speaking Mock (🌐 SAYT orqali)\n\n` +
            `🔑 Kod: ${code}\n` +
            `PART 1: ${meta.part1Topic || '-'}\n` +
            `PART 2: ${meta.part2Topic || '-'}\n` +
            `PART 3: ${meta.part3Topic || '-'}` +
            (meta.contact ? `\n📧 Kontakt: ${meta.contact}` : '');

          await bot.sendMessage(ADMIN_CHAT_ID, header);

          // Har bir savol-javobni tartib bilan yuborish (audio bilan birga)
          const sortedAnswers = meta.answers.slice().sort((a, b) => a.index - b.index);

          for (const ans of sortedAnswers) {
            await bot.sendMessage(
              ADMIN_CHAT_ID,
              `PART ${ans.part} — ${ans.question}\n👤 Matn: ${ans.text || "(matn yo'q)"}${ans.durationSec ? `\n⏱ ${ans.durationSec}s` : ''}`
            );

            const match = audioFiles.find(f => f.fieldname === `audio_${ans.index}_part${ans.part}`);
            if (match && match.buffer && match.buffer.length > 0) {
              try {
                await bot.sendVoice(ADMIN_CHAT_ID, match.buffer, {}, {
                  filename: match.filename || `answer_${ans.index}.webm`,
                  contentType: 'audio/webm',
                });
              } catch (e) {
                console.error('sendVoice xato:', e.message);
              }
            }
          }

          const lastMsg = await bot.sendMessage(
            ADMIN_CHAT_ID,
            `👆 Baholash uchun YUQORIDAGI oxirgi xabarga REPLY qilib javob yozing.\n(Masalan: "Band: 6.5\\nIzoh: ...")\n\nYoki: /javob ${code} Band: 6.5\nIzoh: ...`
          );
          adminMsgToCode[lastMsg.message_id] = code;
          submissions[code].adminMsgId = lastMsg.message_id;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, code }));
        } catch (innerErr) {
          console.error('submit-speaking (finish) xato:', innerErr);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Server xatosi.' }));
        }
      });

      req.pipe(busboy);
    } catch (e) {
      console.error('submit-speaking xato:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'Server xatosi.' }));
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Premium bot is running.');
}).listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// ---- Keep-alive ----
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL ||
  (process.env.RENDER_EXTERNAL_HOSTNAME
    ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
    : null);

if (KEEP_ALIVE_URL) {
  setInterval(() => {
    https.get(KEEP_ALIVE_URL, (res) => {
      console.log(`[Keep-alive] ${res.statusCode}`);
    }).on('error', (err) => {
      console.log(`[Keep-alive] Error: ${err.message}`);
    });
  }, 4 * 60 * 1000);
  console.log(`[Keep-alive] Enabled → ${KEEP_ALIVE_URL}`);
}

// ============================================================
// CD TESTLAR va BOOKS fayllari
// ============================================================
const CD_TEST_FILES = [
  { title: 'Passage 1.html (1)', file_id: 'BQACAgIAAxkBAAOAapQo_mJtZrWq7jpm39kN04V8O1sAAsqZAAL9ioBL7hFuo10N35I9BA' },
  { title: 'Passage 3.html (1)', file_id: 'BQACAgIAAxkBAAODapQo_nBkqoiiipXZU9yt9X6tAS8AAt6YAAJrZaFL06AwtqVn0vM9BA' },
  { title: 'CDI Passage 1.html (1)', file_id: 'BQACAgIAAxkBAAOCapQo_nG1OfM2stjdk0pmguXCHH8AAnaXAAJrZZFLgXUrfFj1b349BA' },
  { title: 'CDI Passage 3.html (1)', file_id: 'BQACAgIAAxkBAAOBapQo_gp4Rd-JwFLF-gABX5HzpB0IAALMlgACa2WRS-09q5wfpvKFPQQ' },
  { title: 'Passage 1.html (2)', file_id: 'BQACAgIAAxkBAAOEapQo_koNz66maT7SnfhkdxN272QAAuOLAAIHa6hLGCVYBpJqLjk9BA' },
  { title: 'Passage 3.html (2)', file_id: 'BQACAgIAAxkBAAOFapQo_rOwOGdMllhg2WYKq60e5P0AAn2dAAJDC7BLyKS7lX_G92o9BA' },
  { title: 'CDI Passage 3.html (2)', file_id: 'BQACAgIAAxkBAAOJapQo_kH3h95Ekb6Y2EKZLGxIfasAAsebAALhOSFIJRv4sJn5zEM9BA' },
  { title: 'Passage 2.html (1)', file_id: 'BQACAgIAAxkBAAOMapQo_scZvNNPI7wFlE0nh5ufm9gAAkebAAK8hrBJcaqXfcFn1nY9BA' },
  { title: 'Passage 2.html (2)', file_id: 'BQACAgIAAxkBAAOKapQo_pz31MBbluwMlwoQJurLUvIAAtCgAAKQdYhJJJBxZ7dQuYM9BA' },
  { title: 'Passage 1.html (3)', file_id: 'BQACAgIAAxkBAAOLapQo_o940c1_BTcvqNzLoVGuOjEAAh2eAAJJrEhIgQbWO5Z3WV49BA' },
  { title: 'Passage 1.html (4)', file_id: 'BQACAgIAAxkBAAOHapQo_o-1fMLYWK8CRJxoGB0gHGkAAoCbAALVROFLxrit1XCJUuA9BA' },
  { title: 'Passage 3.html (3)', file_id: 'BQACAgIAAxkBAAOIapQo_je1WaCbEtI1BrqJoU68_GgAAuaaAAKxi-hLyNsrjSFBW789BA' },
  { title: 'CDI Passage 1.html (2)', file_id: 'BQACAgIAAxkBAAOGapQo_k7lm9hxfp_P9L3CbUwcMOsAAiWTAALVRNlL2GGo6J1yRmI9BA' },
  { title: 'Passage 2.html (3)', file_id: 'BQACAgIAAxkBAAONapQo_mHYsFQMKFrKbgJPtMfSjUMAAkuUAAIgaKhJIq8XTd29pX09BA' },
  { title: 'Passage 1.html (5)', file_id: 'BQACAgIAAxkBAAOOapQo_qQ4DVjr5OuZx8WDs_YCOnAAAnuqAAIgaKBJp4cbrwIPtQ49BA' },
];

const BOOK_FILES = [
  { title: 'Marcus Aurelius - Meditations', file_id: 'BQACAgIAAxkBAAPGapQs6BWKYg4qgzB-L8s6BQ-wdS4AAhx1AAKfEvBLPgs9UX9Xgl89BA' },
  { title: 'Never Split the Difference', file_id: 'BQACAgIAAxkBAAPJapQs6IRd_N1juvE3l6wytIwX9IMAAh91AAKfEvBL67VoeEmQXlc9BA' },
  { title: 'Atomic Habits', file_id: 'BQACAgIAAxkBAAPBapQs6BszZvpBfOm5bWMvdICuQ5gAAqgOAALRcfFJwj7UqSaKKDI9BA' },
  { title: 'How To Stop Worrying And Start Living', file_id: 'BQACAgIAAxkBAAPHapQs6BfiOMKzbHgrZn2Sk4A6i9UAAh11AAKfEvBLDrykEZmmUkE9BA' },
  { title: 'Praying To Get Results - Kenneth E. Hagin', file_id: 'BQACAgIAAxkBAAPMapQs6DIe-DnlEqKTsD4R5Prr8MIAAi11AAKfEvBLqvq4SjaO88I9BA' },
  { title: 'RH Study Guide V2', file_id: 'BQACAgIAAxkBAAPIapQs6O3WvMUuuOWA7QdDh7Mv9hMAAh51AAKfEvBLrdMQ6YQOQjc9BA' },
  { title: 'Genius Foods', file_id: 'BQACAgIAAxkBAAPOapQs6GF_1IhgAAFtxB4gN13kbqXuAAIzdQACnxLwS4lqNfUh2mo3PQQ' },
  { title: 'Build an Extracurricular Profile for Top US Universities', file_id: 'BQACAgIAAxkBAAPPapQs6DgWF9Qu7s56lz3f_oHsLLgAAsYPAAKVCKBLxfmLs5BDvuM9BA' },
  { title: 'Speak to Win', file_id: 'BQACAgIAAxkBAAPDapQs6EzK-G8zGgg8sRUjibkHgs8AAhh1AAKfEvBL2T18Wq9PrmE9BA' },
  { title: 'Awakening the Third Eye', file_id: 'BQACAgIAAxkBAAPFapQs6JyO_TY7yLvoGI6OXc7oMP0AAht1AAKfEvBLaXqAocdOL689BA' },
  { title: 'How to Win Every Argument', file_id: 'BQACAgIAAxkBAAPNapQs6P2Pj4bxyK2gwCwwgMFYYb4AAjF1AAKfEvBLKBIX7p05-zw9BA' },
  { title: '100 Ways to Motivate Yourself', file_id: 'BQACAgIAAxkBAAPLapQs6N3_GCRKhguyBezzYqVnCUAAAix1AAKfEvBLLU5O03S_mnI9BA' },
  { title: 'The Philosophy Of Psychology', file_id: 'BQACAgIAAxkBAAPEapQs6Mhr7wHaHiMmee_F4aE8v7wAAhl1AAKfEvBLpLLt6bfd06Q9BA' },
  { title: '536-2', file_id: 'BQACAgIAAxkBAAPKapQs6JSSFFqApsJTZ8lEJ0mHgcIAAiZ1AAKfEvBLc1KgzxFBiBc9BA' },
  { title: 'Drawing Cartoons & Comics for Dummies', file_id: 'BQACAgIAAxkBAAPCapQs6JbXUaonE7aFJLDYU2Hdm1EAAhR1AAKfEvBL1-MMHu-5V_g9BA' },
  { title: 'Eat That Frog', file_id: 'BQACAgIAAxkBAAPRapQs6NIy_uskwhvJSW-9TQfJ8SMAAuAXAAIDaWBKNhDpIDZ-dYo9BA' },
  { title: 'Make Time - How to Focus', file_id: 'BQACAgIAAxkBAAPUapQs6KEPPjV6FQYRZFoEKJynuNoAAq9iAAIgeVlLuoHhL8_89SQ9BA' },
  { title: 'The Economist USA - 4 January 2025', file_id: 'BQACAgQAAxkBAAPTapQs6D1l3yBeNR3BNAPPoG7A_48AAsAVAAJEXNFTd6q9UTAZQ6U9BA' },
  { title: 'Mindset - Carol S. Dweck', file_id: 'BQACAgIAAxkBAAPVapQs6Ma7Kua54q8nLkiCXhW-oocAAlMTAAIHhUFJ7psBTlRnMpo9BA' },
  { title: '1984', file_id: 'BQACAgIAAxkBAAPXapQs6A6QzwH0pJHvIwgEoSzRt3QAAqQWAAI45SFJP1LaYBIK2Oo9BA' },
  { title: 'Harvard Business Review OnPoint Winter 2019', file_id: 'BQACAgUAAxkBAAPbapQs6IZuU1t8XCO6OBC7ho2TNRQAArkAA3AfyFaih7KWlUZajz0E' },
  { title: 'Why We Sleep', file_id: 'BQACAgIAAxkBAAPcapQs6L0dE00dhohYZ_nZXpZPi20AAlBuAALmEthJsNaoM_iE9BA' },
  { title: '12 Rules for Life', file_id: 'BQACAgIAAxkBAAPQapQs6HL8dXiy5-US44rUZ2OnxhcAAkolAAJoUbhJTAhjxPPS4rc9BA' },
  { title: 'Rich Dad Poor Dad', file_id: 'BQACAgIAAxkBAAPYapQs6HUlFC9DaWfOyC8areZOIHcAAvgVAAJvIBFJ0XRiUqrIwbY9BA' },
  { title: 'Good Vibes Good Life', file_id: 'BQACAgIAAxkBAAPaapQs6DUOtyIFW8JBmwWWdF435OMAAlAlAAJoUbhJA7coaDgXwhA9BA' },
  { title: "Can't Hurt Me", file_id: 'BQACAgIAAxkBAAPWapQs6KHYqTFU-MqK4p-JLurMtsEAAkpMAAK-5hBIn4xAiAFlVrw9BA' },
  { title: 'The 7 Habits of Highly Effective People', file_id: 'BQACAgIAAxkBAAPSapQs6ImOYCI8_E1GuuM1a2IauD4AAmFXAAKIaDhIwgShAh6gZ6s9BA' },
  { title: 'The Psychology of Money', file_id: 'BQACAgIAAxkBAAPZapQs6LPA8kqr-VMLzPGGfBDkbKEAAtdlAAJKwDlKJ4jYHrnyF8w9BA' },
  { title: 'Talk Like TED', file_id: 'BQACAgIAAxkBAAPeapQs6O01W0EaLU8II6A51GvX3dIAAnopAAIMb0BJfoxUIAjTETo9BA' },
  { title: 'Essentialism', file_id: 'BQACAgUAAxkBAAPfapQs6BAe_M11PMCFRaegqSDeRXYAAsUDAAJZ0tFUh1gPaYXj6CQ9BA' },
  { title: 'Show Your Work', file_id: 'BQACAgIAAxkBAAPdapQs6KoWYv36u7C4KLY1_Frpb1QAAllgAALAgNhLhGLlBVw54z89BA' },
  { title: "Factfulness - Hans Rosling", file_id: 'BQACAgQAAxkBAAPgapQs6HsW1uN-BPN_52agFBeNSlEAAkcFAAIP5wABUNanH5Q6uJd1PQQ' },
  { title: '12 Rules for Life - An Antidote to Chaos', file_id: 'BQACAgIAAxkBAAPhapQs6IuGw1wQflootBoZlMDmm-cAAvIoAALE2GFJe-yt3zhf5yY9BA' },
  { title: '101 Essays That Will Change The Way You Think', file_id: 'BQACAgIAAxkBAAPiapQs6Nkpk8lO81lcHoJO_gjAHaQAAvUcAAL2R9lIdzRKJC3QJa09BA' },
  { title: 'Allah Loves - Omar Suleiman', file_id: 'BQACAgIAAxkBAAPjapQs6GzzXanqVEg3rm1teaUQfyIAAitPAAIJ33hK-7xhhrAT8IQ9BA' },
];

// ---- So'rov yuborganlarni eslab qolish ----
const pendingJoinRequests = new Set(); // userId lar

// ---- Kanal tekshirish ----
async function isSubscribed(userId) {
  if (pendingJoinRequests.has(userId)) {
    return true;
  }
  try {
    const member = await bot.getChatMember(REQUIRED_CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return false;
  }
}

function getSubscribeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📢 Kanalga obuna bo\'lish', url: CHANNEL_INVITE_LINK }],
      [{ text: '🌐 Bizning sayt', url: SITE_URL }],
      [{ text: '✅ So\'rov yubordim', callback_data: 'check_sub' }]
    ]
  };
}

function getMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔐 Saytga kirish kodi', callback_data: 'get_login_code' }],
      [{ text: '💰 Narxlar', callback_data: 'prices' }],
      [{ text: '📄 CD TESTLAR', callback_data: 'cd_tests' }, { text: '📚 BOOKS', callback_data: 'books' }],
      [{ text: '✍️ Writing Checker', callback_data: 'writing_checker' }],
      [{ text: '🗣️ Speaking Checker', callback_data: 'speaking_checker' }],
      [{ text: '🌐 Sayt havolasi', url: SITE_URL }],
      [{ text: '👤 Admin bilan bog\'lanish', url: `https://t.me/${ADMIN_USERNAME}` }],
      [{ text: '📸 To\'lov chekini yuborish', callback_data: 'send_payment' }]
    ]
  };
}

// ---- Join Request kelganda ----
bot.on('chat_join_request', (msg) => {
  const userId = msg.from.id;
  pendingJoinRequests.add(userId);
  console.log(`Yangi join request: ${userId} (${msg.from.first_name})`);
});

// ---- In-memory store (premium to'lovlar uchun) ----
const pendingRequests = {};
let requestCounter = 1;

// ---- In-memory store (Writing / Speaking Checker uchun, umumiy) ----
// submissions[code] = {
//   type: 'writing' | 'speaking',
//   source: 'site' | 'bot',
//   tier, email, studentName, taskType, essayText, transcript,
//   status: 'pending' | 'reviewed',
//   feedback, band, studentChatId, adminMsgId, createdAt
// }
const submissions = {};
const adminMsgToCode = {};                 // admin xabar ID -> code

// ---- Writing Checker holatlari ----
const awaitingWritingPayment = new Set();  // userId lar: to'lov chekini kutyapmiz
const writingApproved = new Set();         // chatId lar: to'lov tasdiqlandi, insho matnini kutyapmiz
const pendingWritingRequests = {};         // reqId -> { userChatId, userName, username }
let writingReqCounter = 1;

// ---- Speaking Checker holatlari ----
const awaitingSpeakingPayment = {};        // userId -> tierKey ('basic'|'premium'|'gold'): to'lov chekini kutyapmiz
const speakingApprovedTier = {};           // chatId -> tierKey: to'lov tasdiqlandi, mock boshlashni kutyapmiz
const pendingSpeakingRequests = {};        // reqId -> { userChatId, userName, username, tier }
const speakingSessions = {};               // chatId -> session object (faol mock)
let speakingReqCounter = 1;

function generateResultCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function splitLongText(text, maxLen = 3500) {
  const parts = [];
  let t = text;
  while (t.length > maxLen) {
    parts.push(t.slice(0, maxLen));
    t = t.slice(maxLen);
  }
  parts.push(t);
  return parts;
}

function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, n) {
  return shuffle(arr).slice(0, Math.min(n, arr.length));
}

// ============================================================
// OVOZNI MATNGA O'GIRISH (OpenAI Whisper)
// ============================================================
async function transcribeVoice(fileId) {
  if (!OPENAI_API_KEY) {
    return null; // sozlanmagan — matnga o'girib bo'lmaydi
  }
  try {
    const fileLink = await bot.getFileLink(fileId);
    const audioRes = await fetch(fileLink);
    if (!audioRes.ok) throw new Error(`Audio yuklab olinmadi (${audioRes.status})`);
    const audioBuffer = await audioRes.buffer();

    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-1');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI xato (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return (data.text || '').trim() || null;
  } catch (e) {
    console.error('transcribeVoice xato:', e.message);
    return null;
  }
}

// ---- /start ----
bot.onText(/\/start(?:\s+(.+))?/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (String(chatId) !== String(ADMIN_CHAT_ID)) {
    trackUser(userId);
    totalStartCount++;
  }

  const subscribed = await isSubscribed(userId);

  if (!subscribed) {
    return bot.sendMessage(chatId,
      `⚠️ Botdan foydalanish uchun avval kanalimizga obuna bo'ling:\n\nSo'rov yuborganingizdan keyin "✅ So'rov yubordim" tugmasini bosing.`,
      { reply_markup: getSubscribeKeyboard() }
    );
  }

  bot.sendMessage(chatId,
    `Salom! 👋\n\nVIVID IELTS Premium botiga xush kelibsiz!\n\nQuyidagi tugmalardan birini tanlang:`,
    { reply_markup: getMainKeyboard() }
  );
});

// ---- /login — saytga kirish kodi ----
bot.onText(/\/login/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (String(chatId) === String(ADMIN_CHAT_ID)) return;

  const subscribed = await isSubscribed(userId);
  if (!subscribed) {
    return bot.sendMessage(chatId,
      `⚠️ Avval kanalga obuna bo'ling:`,
      { reply_markup: getSubscribeKeyboard() }
    );
  }

  const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  await issueLoginCode(chatId, userId, fullName);
});

// ---- /stats — faqat admin uchun ----
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== String(ADMIN_CHAT_ID)) return;

  const activeSpeakingMocks = Object.keys(speakingSessions).length;
  const pendingWritingCount = Object.values(submissions).filter(s => s.type === 'writing' && s.status === 'pending').length;
  const pendingSpeakingCount = Object.values(submissions).filter(s => s.type === 'speaking' && s.status === 'pending').length;

  bot.sendMessage(chatId,
    `📊 *Bot statistikasi*\n\n` +
    `👥 Jami unique foydalanuvchilar: *${allUsersSeen.size}*\n` +
    `🟢 Bugun faol bo'lganlar: *${dailyActiveUsers.size}*\n` +
    `🚀 Jami /start bosilgan: *${totalStartCount}*\n\n` +
    `💎 Premium berilgan: *${totalPremiumApproved}*\n` +
    `✍️ Tekshirilgan Writing (jami): *${totalWritingChecked}*\n` +
    `🗣️ Tekshirilgan Speaking (jami): *${totalSpeakingChecked}*\n\n` +
    `⏳ Javob kutayotgan Writing: *${pendingWritingCount}*\n` +
    `⏳ Javob kutayotgan Speaking: *${pendingSpeakingCount}*\n` +
    `🎙 Hozir faol Speaking mocklar: *${activeSpeakingMocks}*`,
    { parse_mode: 'Markdown' }
  );
});

// ---- /natija <kod> — saytdan yuborilgan Writing yoki Speaking natijasini olish ----
bot.onText(/\/natija(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const code = match && match[1] ? match[1].trim() : null;

  if (!code) {
    return bot.sendMessage(chatId,
      `Natijangizni bilish uchun kodingiz bilan shu ko'rinishda yuboring:\n/natija 123456`
    );
  }

  const sub = submissions[code];
  if (!sub) {
    return bot.sendMessage(chatId, '❗ Bunday kod topilmadi. Kodni to\'g\'ri kiritganingizni tekshiring.');
  }

  if (sub.status !== 'reviewed') {
    return bot.sendMessage(chatId,
      '⏳ Natijangiz hali tayyor emas. Javob odatda 60 daqiqa (Writing uchun 12–24 soat) ichida keladi. Birozdan keyin qayta urinib ko\'ring:\n/natija ' + code
    );
  }

  bot.sendMessage(chatId,
    `📝 Natijangiz (kod: ${code})\n\n` +
    (sub.band ? `🎯 Band: ${sub.band}\n\n` : '') +
    `💬 Fikr-mulohaza:\n${sub.feedback}`
  );
});

// ---- ADMIN: /javob <kod> Baho: X Izoh: ... — natijani kod orqali yuborish ----
bot.onText(/\/javob\s+(\S+)\s+([\s\S]+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  const code = match[1].trim();
  const feedbackText = match[2].trim();
  await deliverFeedback(code, feedbackText);
});

async function deliverFeedback(code, feedbackText) {
  const sub = submissions[code];
  if (!sub) {
    return bot.sendMessage(ADMIN_CHAT_ID, `❗ "${code}" kodli topshiriq topilmadi.`);
  }

  let band = null;
  const bandMatch = feedbackText.match(/band[:\s]+([0-9]+(\.[0-9])?)/i);
  if (bandMatch) band = bandMatch[1];

  sub.feedback = feedbackText;
  sub.band = band;
  sub.status = 'reviewed';

  if (sub.type === 'writing') totalWritingChecked++;
  if (sub.type === 'speaking') totalSpeakingChecked++;

  if (sub.source === 'bot' && sub.studentChatId) {
    try {
      await bot.sendMessage(sub.studentChatId,
        `📝 ${sub.type === 'speaking' ? 'Speaking' : 'Writing'} natijangiz tayyor!\n\n` +
        (band ? `🎯 Band: ${band}\n\n` : '') +
        `💬 Fikr-mulohaza:\n${feedbackText}`
      );
    } catch (e) {
      console.error('Talabaga yuborishda xato:', e.message);
    }
  }

  bot.sendMessage(ADMIN_CHAT_ID,
    `✅ Natija saqlandi${sub.source === 'bot' ? ' va talabaga yuborildi' : ''}.\n(Kod: ${code}${sub.email ? ', email: ' + sub.email : ''})` +
    (sub.source === 'site' ? '\n\nTalaba natijani /natija ' + code + ' orqali botdan oladi.' : '')
  );
}

// ---- ADMIN: hujjat yuborganda file_id'ni ko'rsatish ----
bot.on('document', (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== String(ADMIN_CHAT_ID)) return;

  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name || 'nomsiz fayl';

  bot.sendMessage(
    chatId,
    `📎 Fayl qabul qilindi: ${fileName}\n\nfile_id:\n${fileId}\n\nBuni CD_TEST_FILES yoki BOOK_FILES massiviga nusxalang.`
  );
});

// ---- ADMIN: forward qilingan Writing/Speaking xabariga REPLY qilib baholash ----
bot.on('message', async (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  if (!msg.reply_to_message) return;

  const repliedId = msg.reply_to_message.message_id;
  const code = adminMsgToCode[repliedId];
  if (!code) return;

  const feedbackText = msg.text || msg.caption || '';
  if (!feedbackText.trim()) return;

  await deliverFeedback(code, feedbackText);
});

// ============================================================
// SPEAKING MOCK — savol/timer logikasi
// ============================================================

function speakingKeyboardTiers() {
  return {
    inline_keyboard: [
      [{ text: `${SPEAKING_TIERS.basic.label} — ${SPEAKING_TIERS.basic.price}`, callback_data: 'speaking_tier:basic' }],
      [{ text: `${SPEAKING_TIERS.premium.label} — ${SPEAKING_TIERS.premium.price}`, callback_data: 'speaking_tier:premium' }],
      [{ text: `${SPEAKING_TIERS.gold.label} — ${SPEAKING_TIERS.gold.price}`, callback_data: 'speaking_tier:gold' }],
    ]
  };
}

function clearSessionTimer(session) {
  if (session && session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }
}

async function endSession(chatId, notify = false) {
  const session = speakingSessions[chatId];
  if (!session) return;
  clearSessionTimer(session);
  delete speakingSessions[chatId];
  if (notify) {
    try { await bot.sendMessage(chatId, 'Mock sessiyasi tugatildi.'); } catch (e) {}
  }
}

// Sessiyani boshlash: Part 1 dan
async function startSpeakingMock(chatId, tier) {
  const topic = PART1[Math.floor(Math.random() * PART1.length)];
  const questions = pickRandom(topic.questions, Math.min(4, topic.questions.length));

  const session = {
    tier,
    stage: 'part1',
    part1: { topic: topic.topic, questions, index: 0, answers: [] },
    part2: null,
    part3: null,
    timeoutId: null,
    currentKey: null,
    answered: false,
    startedAt: Date.now(),
  };
  speakingSessions[chatId] = session;

  await bot.sendMessage(chatId,
    `🎙️ *Speaking Mock boshlandi!*\n\n` +
    `*PART 1* — Mavzu: _${topic.topic}_\n\n` +
    `Har bir savolga *25 soniya* ichida javob bering (matn yoki ovozli xabar).`,
    { parse_mode: 'Markdown' }
  );

  await askPart1Question(chatId);
}

async function askPart1Question(chatId) {
  const session = speakingSessions[chatId];
  if (!session) return;
  const { questions, index } = session.part1;

  if (index >= questions.length) {
    return startPart2(chatId);
  }

  const qText = questions[index];
  const key = `p1-${index}-${Date.now()}`;
  session.currentKey = key;
  session.answered = false;

  await bot.sendMessage(chatId, `🔹 Part 1 — Savol ${index + 1}/${questions.length}:\n\n${qText}\n\n⏱ 25 soniya`);

  session.timeoutId = setTimeout(() => {
    handlePart1Timeout(chatId, key);
  }, 25 * 1000);
}

async function handlePart1Timeout(chatId, key) {
  const session = speakingSessions[chatId];
  if (!session || session.currentKey !== key || session.answered) return;
  session.answered = true;
  session.part1.answers.push({ question: session.part1.questions[session.part1.index], answer: '(vaqt tugadi, javob berilmadi)', viaVoice: false });
  session.part1.index++;
  try { await bot.sendMessage(chatId, '⏰ Vaqt tugadi! Keyingi savolga o\'tamiz...'); } catch (e) {}
  askPart1Question(chatId);
}

async function startPart2(chatId) {
  const session = speakingSessions[chatId];
  if (!session) return;

  const topic = PART2[Math.floor(Math.random() * PART2.length)];
  session.stage = 'part2';
  session.part2 = { topicId: topic.id, topic: topic.topic, cue: topic.cue, answer: null };
  session.currentKey = `p2-${Date.now()}`;
  session.answered = false;

  await bot.sendMessage(chatId,
    `🔸 *PART 2*\n\n${topic.cue}\n\n` +
    `Javobingizni tayyorlab, *2 daqiqa* ichida gapirib bering yoki yozib yuboring.`,
    { parse_mode: 'Markdown' }
  );

  session.timeoutId = setTimeout(() => {
    handlePart2Timeout(chatId, session.currentKey);
  }, 120 * 1000);
}

async function handlePart2Timeout(chatId, key) {
  const session = speakingSessions[chatId];
  if (!session || session.currentKey !== key || session.answered) return;
  session.answered = true;
  session.part2.answer = '(vaqt tugadi, javob berilmadi)';
  session.part2.viaVoice = false;
  try { await bot.sendMessage(chatId, '⏰ Vaqt tugadi! Endi Part 3 savollariga o\'tamiz...'); } catch (e) {}
  startPart3(chatId);
}

async function startPart3(chatId) {
  const session = speakingSessions[chatId];
  if (!session) return;

  const groupId = PART2_TO_PART3[session.part2.topicId];
  const group = PART3.find(g => g.id === groupId) || PART3[0];
  const count = Math.random() < 0.5 ? 5 : 6;
  const questions = pickRandom(group.questions, Math.min(count, group.questions.length));

  session.stage = 'part3';
  session.part3 = { topic: group.topic, questions, index: 0, answers: [] };

  await bot.sendMessage(chatId,
    `🔹 *PART 3* — Mavzu: _${group.topic}_\n\nHar bir savolga *40-45 soniya* ichida javob bering.`,
    { parse_mode: 'Markdown' }
  );

  await askPart3Question(chatId);
}

async function askPart3Question(chatId) {
  const session = speakingSessions[chatId];
  if (!session) return;
  const { questions, index } = session.part3;

  if (index >= questions.length) {
    return finishSpeakingMock(chatId);
  }

  const qText = questions[index];
  const seconds = 40 + Math.floor(Math.random() * 6); // 40-45
  const key = `p3-${index}-${Date.now()}`;
  session.currentKey = key;
  session.answered = false;

  await bot.sendMessage(chatId, `🔹 Part 3 — Savol ${index + 1}/${questions.length}:\n\n${qText}\n\n⏱ ${seconds} soniya`);

  session.timeoutId = setTimeout(() => {
    handlePart3Timeout(chatId, key);
  }, seconds * 1000);
}

async function handlePart3Timeout(chatId, key) {
  const session = speakingSessions[chatId];
  if (!session || session.currentKey !== key || session.answered) return;
  session.answered = true;
  session.part3.answers.push({ question: session.part3.questions[session.part3.index], answer: '(vaqt tugadi, javob berilmadi)', viaVoice: false });
  session.part3.index++;
  try { await bot.sendMessage(chatId, '⏰ Vaqt tugadi! Keyingi savolga o\'tamiz...'); } catch (e) {}
  askPart3Question(chatId);
}

// Foydalanuvchidan kelgan javobni (matn yoki ovoz) qabul qilish
async function handleSpeakingAnswer(msg) {
  const chatId = msg.chat.id;
  const session = speakingSessions[chatId];
  if (!session || session.answered) return false;

  let answerText = msg.text || msg.caption || null;
  let viaVoice = false;
  let voiceFileId = null;

  if (msg.voice) {
    viaVoice = true;
    voiceFileId = msg.voice.file_id;
    await bot.sendChatAction(chatId, 'typing');
    const transcript = await transcribeVoice(voiceFileId);
    answerText = transcript || '(ovozli javob — matnga o\'girib bo\'lmadi, admin ovoz orqali eshitadi)';
  }

  if (!answerText) return false; // bu xabar javob emas (masalan, rasm)

  clearSessionTimer(session);
  session.answered = true;

  if (session.stage === 'part1') {
    session.part1.answers.push({ question: session.part1.questions[session.part1.index], answer: answerText, viaVoice, voiceFileId });
    session.part1.index++;
    askPart1Question(chatId);
  } else if (session.stage === 'part2') {
    session.part2.answer = answerText;
    session.part2.viaVoice = viaVoice;
    session.part2.voiceFileId = voiceFileId;
    startPart3(chatId);
  } else if (session.stage === 'part3') {
    session.part3.answers.push({ question: session.part3.questions[session.part3.index], answer: answerText, viaVoice, voiceFileId });
    session.part3.index++;
    askPart3Question(chatId);
  }

  return true;
}

async function finishSpeakingMock(chatId) {
  const session = speakingSessions[chatId];
  if (!session) return;

  const tierInfo = SPEAKING_TIERS[session.tier];
  const code = generateResultCode();

  const meRef = await bot.sendMessage(chatId,
    `✅ *Mock yakunlandi!*\n\n` +
    `Tarifingiz: ${tierInfo.label}\n` +
    `Natijangiz odatda *60 daqiqa* ichida shu chatga keladi.\n` +
    `Kodingiz (ixtiyoriy tekshirish uchun): \`${code}\``,
    { parse_mode: 'Markdown' }
  );

  submissions[code] = {
    type: 'speaking',
    source: 'bot',
    tier: session.tier,
    email: null,
    studentName: null,
    status: 'pending',
    feedback: null,
    band: null,
    studentChatId: chatId,
    createdAt: Date.now(),
  };

  // Adminga to'liq transkriptni yuborish
  const header =
    `🗣️ Yangi Speaking Mock — ${tierInfo.label}\n\n` +
    `🔑 Kod: ${code}\n\n` +
    `PART 1 — ${session.part1.topic}`;
  await bot.sendMessage(ADMIN_CHAT_ID, header);

  for (const [i, qa] of session.part1.answers.entries()) {
    await bot.sendMessage(ADMIN_CHAT_ID, `P1.${i + 1}) ${qa.question}\n👤 ${qa.answer}${qa.viaVoice ? ' 🎤' : ''}`);
    if (qa.viaVoice && qa.voiceFileId) {
      try { await bot.sendVoice(ADMIN_CHAT_ID, qa.voiceFileId); } catch (e) {}
    }
  }

  await bot.sendMessage(ADMIN_CHAT_ID, `PART 2 — ${session.part2.topic}\n\n${session.part2.cue}\n\n👤 ${session.part2.answer}${session.part2.viaVoice ? ' 🎤' : ''}`);
  if (session.part2.viaVoice && session.part2.voiceFileId) {
    try { await bot.sendVoice(ADMIN_CHAT_ID, session.part2.voiceFileId); } catch (e) {}
  }

  await bot.sendMessage(ADMIN_CHAT_ID, `PART 3 — ${session.part3.topic}`);
  for (const [i, qa] of session.part3.answers.entries()) {
    await bot.sendMessage(ADMIN_CHAT_ID, `P3.${i + 1}) ${qa.question}\n👤 ${qa.answer}${qa.viaVoice ? ' 🎤' : ''}`);
    if (qa.viaVoice && qa.voiceFileId) {
      try { await bot.sendVoice(ADMIN_CHAT_ID, qa.voiceFileId); } catch (e) {}
    }
  }

  let feedbackGuide;
  if (session.tier === 'gold') {
    feedbackGuide = 'Gold tarif: Band + umumiy feedback + 7+ javoblar tahlili + Topic Words + Grammar Structures + Topic Videos havolasini yozing.';
  } else if (session.tier === 'premium') {
    feedbackGuide = 'Premium tarif: Band + umumiy feedback + 7+ band uchun javoblar tahlilini yozing.';
  } else {
    feedbackGuide = 'Oddiy tarif: faqat Band ballni yozing.';
  }

  const lastMsg = await bot.sendMessage(ADMIN_CHAT_ID,
    `👆 Baholash uchun shu xabarga REPLY qilib javob yozing (yoki /javob ${code} Band: 6.5\\nIzoh: ...).\n\n📌 ${feedbackGuide}`
  );
  adminMsgToCode[lastMsg.message_id] = code;
  submissions[code].adminMsgId = lastMsg.message_id;

  delete speakingSessions[chatId];
}

// ---- Oddiy xabarlar ----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (String(chatId) === String(ADMIN_CHAT_ID)) return;
  if (msg.text && msg.text.startsWith('/start')) return;
  if (msg.text && msg.text.startsWith('/natija')) return;
  if (msg.text && msg.text.startsWith('/login')) return;
  if (msg.document) return; // hujjatlar yuqorida alohida ishlanadi

  trackUser(userId);

  const subscribed = await isSubscribed(userId);
  if (!subscribed) {
    return bot.sendMessage(chatId,
      `⚠️ Avval kanalga obuna bo'ling:`,
      { reply_markup: getSubscribeKeyboard() }
    );
  }

  const text = msg.caption || msg.text || '';

  // ---- 0) Faol Speaking mock bo'lsa — bu xabar javob ----
  if (speakingSessions[chatId]) {
    const handled = await handleSpeakingAnswer(msg);
    if (handled) return;
    return bot.sendMessage(chatId, 'Iltimos, savolga matn yoki ovozli xabar orqali javob bering.');
  }

  // ---- 1) To'lovi tasdiqlangan foydalanuvchi (Writing) — bu xabar uning INSHOSI ----
  if (writingApproved.has(chatId)) {
    if (!text || text.trim().length < 20) {
      return bot.sendMessage(chatId, 'Iltimos, Writing (insho) matningizni to\'liq matn shaklida yuboring (kamida bir necha jumla).');
    }
    writingApproved.delete(chatId);

    const code = generateResultCode();
    submissions[code] = {
      type: 'writing',
      source: 'bot',
      tier: null,
      email: null,
      studentName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
      taskType: 'Task 2',
      essayText: text,
      status: 'pending',
      feedback: null,
      band: null,
      studentChatId: chatId,
      createdAt: Date.now(),
    };

    const header =
      `✍️ Yangi Writing (🤖 BOT orqali — PULLIK, tasdiqlangan)\n\n` +
      `🔑 Kod: ${code}\n` +
      `👤 Ism: ${submissions[code].studentName}\n` +
      `🔗 Username: ${msg.from.username ? '@' + msg.from.username : '(yo\'q)'}\n\n` +
      `— Insho matni quyida —`;

    await bot.sendMessage(ADMIN_CHAT_ID, header);
    const chunks = splitLongText(text);
    let lastMsg = null;
    for (const chunk of chunks) {
      lastMsg = await bot.sendMessage(ADMIN_CHAT_ID, chunk);
    }
    if (lastMsg) {
      adminMsgToCode[lastMsg.message_id] = code;
      submissions[code].adminMsgId = lastMsg.message_id;
    }
    await bot.sendMessage(
      ADMIN_CHAT_ID,
      `👆 Baholash uchun YUQORIDAGI oxirgi xabarga REPLY qilib, baho va izohingizni yozing.\n(Masalan: "Band: 6.5\\nIzoh: ...")`
    );

    return bot.sendMessage(chatId,
      `✅ Inshoyingiz qabul qilindi!\n\n⏳ Javob odatda 12–24 soat ichida shu chatga keladi.`
    );
  }

  // ---- 2) Writing Checker uchun to'lov kutilayotgan foydalanuvchi — bu xabar TO'LOV CHEKI ----
  if (awaitingWritingPayment.has(userId)) {
    awaitingWritingPayment.delete(userId);

    const reqId = 'w' + String(writingReqCounter++);
    pendingWritingRequests[reqId] = {
      userChatId: chatId,
      userName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
      username: msg.from.username ? '@' + msg.from.username : '(username yo\'q)',
    };

    try {
      await bot.forwardMessage(ADMIN_CHAT_ID, chatId, msg.message_id);
    } catch (e) {}

    await bot.sendMessage(ADMIN_CHAT_ID,
      `✍️ Writing Checker — to'lov da'vosi\n\n` +
      `👤 Ism: ${pendingWritingRequests[reqId].userName}\n` +
      `🔗 Username: ${pendingWritingRequests[reqId].username}\n` +
      `💵 Narx: ${WRITING_PRICE_TEXT}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Ruxsat berish', callback_data: `approve_writing:${reqId}` },
            { text: '❌ Rad etish', callback_data: `reject_writing:${reqId}` },
          ]]
        }
      }
    );

    return bot.sendMessage(chatId, 'Rahmat! To\'lov cheki adminga yuborildi, tasdiqlangach insho yuborishingiz mumkin bo\'ladi ⏳');
  }

  // ---- 3) Speaking Checker uchun to'lov kutilayotgan foydalanuvchi — bu xabar TO'LOV CHEKI ----
  if (awaitingSpeakingPayment[userId]) {
    const tierKey = awaitingSpeakingPayment[userId];
    delete awaitingSpeakingPayment[userId];
    const tierInfo = SPEAKING_TIERS[tierKey];

    const reqId = 's' + String(speakingReqCounter++);
    pendingSpeakingRequests[reqId] = {
      userChatId: chatId,
      userName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
      username: msg.from.username ? '@' + msg.from.username : '(username yo\'q)',
      tier: tierKey,
    };

    try {
      await bot.forwardMessage(ADMIN_CHAT_ID, chatId, msg.message_id);
    } catch (e) {}

    await bot.sendMessage(ADMIN_CHAT_ID,
      `🗣️ Speaking Checker — to'lov da'vosi\n\n` +
      `👤 Ism: ${pendingSpeakingRequests[reqId].userName}\n` +
      `🔗 Username: ${pendingSpeakingRequests[reqId].username}\n` +
      `💎 Tarif: ${tierInfo.label}\n` +
      `💵 Narx: ${tierInfo.price}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Ruxsat berish', callback_data: `approve_speaking:${reqId}` },
            { text: '❌ Rad etish', callback_data: `reject_speaking:${reqId}` },
          ]]
        }
      }
    );

    return bot.sendMessage(chatId, 'Rahmat! To\'lov cheki adminga yuborildi, tasdiqlangach Speaking mock avtomatik boshlanadi ⏳');
  }

  // ---- 4) Aks holda — bu PREMIUM uchun to'lov da'vosi ----
  const email = extractEmail(text);

  const reqId = String(requestCounter++);
  pendingRequests[reqId] = {
    email,
    userChatId: chatId,
    userName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
    username: msg.from.username ? '@' + msg.from.username : '(username yo\'q)',
  };

  const summary =
    `🆕 Yangi to'lov da'vosi\n\n` +
    `👤 Ism: ${pendingRequests[reqId].userName}\n` +
    `🔗 Username: ${pendingRequests[reqId].username}\n` +
    `📧 Aniqlangan email: ${email || '❗ topilmadi — foydalanuvchidan so\'rang'}\n\n` +
    `Xabar matni: ${text || '(matn yo\'q, ehtimol faqat rasm yubordi)'}`;

  try {
    await bot.forwardMessage(ADMIN_CHAT_ID, chatId, msg.message_id);
  } catch (e) {}

  await bot.sendMessage(ADMIN_CHAT_ID, summary, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Premium berish', callback_data: `approve:${reqId}` },
          { text: '❌ Rad etish', callback_data: `reject:${reqId}` },
        ],
      ],
    },
  });

  bot.sendMessage(chatId, 'Rahmat! So\'rovingiz adminga yuborildi, tez orada javob olasiz ⏳');
});

// ---- Helper: fayllar ro'yxatini tugma qilib chiqarish ----
function buildFileListKeyboard(files, prefix) {
  return {
    inline_keyboard: files.map((f, idx) => [
      { text: f.title, callback_data: `${prefix}:${idx}` }
    ])
  };
}

// ---- Callback tugmalar ----
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  // 0. Saytga kirish kodi
  if (query.data === 'get_login_code') {
    await bot.answerCallbackQuery(query.id);
    const fullName = [query.from.first_name, query.from.last_name].filter(Boolean).join(' ');
    await issueLoginCode(chatId, userId, fullName);
    return;
  }

  // 1. So'rov yubordim tugmasi
  if (query.data === 'check_sub') {
    const subscribed = await isSubscribed(userId);
    if (subscribed) {
      await bot.answerCallbackQuery(query.id, { text: 'Rahmat! Endi botdan foydalanishingiz mumkin ✅' });
      await bot.sendMessage(chatId,
        `Salom! 👋\n\nVIVID IELTS Premium botiga xush kelibsiz!\n\nQuyidagi tugmalardan birini tanlang:`,
        { reply_markup: getMainKeyboard() }
      );
    } else {
      await bot.answerCallbackQuery(query.id, {
        text: 'Hali so\'rov yubormagansiz yoki bot sezmagan. Avval kanalga so\'rov yuboring!',
        show_alert: true
      });
    }
    return;
  }

  // 2. Narxlar
  if (query.data === 'prices') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId,
`💰 *VIVID IELTS Tariflari:*

🟢 *Free* — 0 so'm
• Limited lesson access
• 2 Reading mock tests
• 2 Full Listening mock tests

🔵 *Premium* — ~79,000 UZS/oy~
• 30 full Reading & Listening mock tests
• Certificate on completion
• Keyword tables & wordlists
• Writing mock test + AI review
• Full article library access

🟣 *Pro* — ~249,000 UZS/oy~
• Everything in Premium
• Article library + topic wordlists
• Full Speaking mock test
• 3 full IELTS mock exams

✍️ *Writing Checker (bot orqali)* — ${WRITING_PRICE_TEXT}

🗣️ *Speaking Checker (bot orqali):*
• ${SPEAKING_TIERS.basic.label} — ${SPEAKING_TIERS.basic.price} (${SPEAKING_TIERS.basic.desc})
• ${SPEAKING_TIERS.premium.label} — ${SPEAKING_TIERS.premium.price} (${SPEAKING_TIERS.premium.desc})
• ${SPEAKING_TIERS.gold.label} — ${SPEAKING_TIERS.gold.price} (${SPEAKING_TIERS.gold.desc})

To'lovdan keyin chekni va emailingizni yuboring.`,
      { parse_mode: 'Markdown', reply_markup: getMainKeyboard() }
    );
    return;
  }

  // 3. To'lov chekini yuborish
  if (query.data === 'send_payment') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId,
      `📸 Iltimos, to'lov chekini (screenshot) va saytda ro'yxatdan o'tgan *emailingizni* yuboring.\n\nMisol:\nemail@gmail.com`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 4. CD TESTLAR — barcha fayllarni birdaniga yuborish
  if (query.data === 'cd_tests') {
    await bot.answerCallbackQuery(query.id);
    if (CD_TEST_FILES.length === 0) {
      return bot.sendMessage(chatId, '📄 Hozircha CD testlar qo\'shilmagan. Tez orada qo\'shiladi!');
    }
    await bot.sendMessage(chatId, `📄 ${CD_TEST_FILES.length} ta fayl yuborilmoqda...`);
    for (const file of CD_TEST_FILES) {
      try {
        await bot.sendDocument(chatId, file.file_id, { caption: file.title });
      } catch (e) {
        console.error(`Faylni yuborishda xato (${file.title}):`, e.message);
      }
    }
    await bot.sendMessage(
      chatId,
      `✅ Barcha testlar yuborildi!\n\n📚 Ko'proq real exam testlar uchun saytimizga tashrif buyuring:`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '🌐 Saytga o\'tish', url: SITE_URL }]]
        }
      }
    );
    return;
  }

  // 5. BOOKS ro'yxati
  if (query.data === 'books') {
    await bot.answerCallbackQuery(query.id);
    if (BOOK_FILES.length === 0) {
      return bot.sendMessage(chatId, '📚 Hozircha kitoblar qo\'shilmagan. Tez orada qo\'shiladi!');
    }
    return bot.sendMessage(chatId, '📚 Kerakli kitobni tanlang:', {
      reply_markup: buildFileListKeyboard(BOOK_FILES, 'get_book')
    });
  }

  // 6. Tanlangan CD test faylini yuborish
  if (query.data.startsWith('get_cd:')) {
    const idx = parseInt(query.data.split(':')[1], 10);
    const file = CD_TEST_FILES[idx];
    await bot.answerCallbackQuery(query.id);
    if (!file) return bot.sendMessage(chatId, 'Fayl topilmadi.');
    return bot.sendDocument(chatId, file.file_id, { caption: file.title });
  }

  // 7. Tanlangan kitobni yuborish
  if (query.data.startsWith('get_book:')) {
    const idx = parseInt(query.data.split(':')[1], 10);
    const file = BOOK_FILES[idx];
    await bot.answerCallbackQuery(query.id);
    if (!file) return bot.sendMessage(chatId, 'Fayl topilmadi.');
    return bot.sendDocument(chatId, file.file_id, { caption: file.title });
  }

  // 8. Writing Checker menyusi
  if (query.data === 'writing_checker') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId,
      `✍️ *Writing Checker*\n\n` +
      `Bot orqali to'g'ridan-to'g'ri insho (Writing) yuborib tekshirtirish narxi: *${WRITING_PRICE_TEXT}*.\n\n` +
      `To'lovni amalga oshirib, chekni (screenshot) shu yerga yuboring. Admin tasdiqlagach, inshoyingizni matn shaklida yuborishingiz mumkin bo'ladi. Javob 12–24 soat ichida keladi.\n\n` +
      `📌 Eslatma: agar saytimizdagi *Mock Test → Writing* bo'limida insho yozgan bo'lsangiz — bu *BEPUL*. Natijangizni bilish uchun shu botga /natija <kodingiz> deb yuboring.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '👤 Admin bilan bog\'lanish', url: `https://t.me/${ADMIN_USERNAME}` }]]
        }
      }
    );
    awaitingWritingPayment.add(userId);
    return;
  }

  // 9. Speaking Checker menyusi — tarif tanlash
  if (query.data === 'speaking_checker') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId,
      `🗣️ *Speaking Checker*\n\n` +
      `To'liq IELTS Speaking mock (Part 1 + Part 2 + Part 3) — savollar tasodifiy tanlanadi, javoblaringizni matn yoki ovozli xabar orqali yuborasiz.\n\n` +
      `Tarifni tanlang:\n\n` +
      `${SPEAKING_TIERS.basic.label} — ${SPEAKING_TIERS.basic.price}\n${SPEAKING_TIERS.basic.desc}\n\n` +
      `${SPEAKING_TIERS.premium.label} — ${SPEAKING_TIERS.premium.price}\n${SPEAKING_TIERS.premium.desc}\n\n` +
      `${SPEAKING_TIERS.gold.label} — ${SPEAKING_TIERS.gold.price}\n${SPEAKING_TIERS.gold.desc}`,
      { parse_mode: 'Markdown', reply_markup: speakingKeyboardTiers() }
    );
    return;
  }

  // 10. Speaking tarif tanlandi -> to'lov so'rash
  if (query.data.startsWith('speaking_tier:')) {
    const tierKey = query.data.split(':')[1];
    const tierInfo = SPEAKING_TIERS[tierKey];
    if (!tierInfo) return bot.answerCallbackQuery(query.id);

    await bot.answerCallbackQuery(query.id);
    awaitingSpeakingPayment[userId] = tierKey;

    await bot.sendMessage(chatId,
      `💳 Siz *${tierInfo.label}* ni tanladingiz — *${tierInfo.price}*.\n\n` +
      `To'lovni amalga oshirib, chekni (screenshot) shu yerga yuboring. Admin tasdiqlagach, Speaking mock avtomatik boshlanadi.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '👤 Admin bilan bog\'lanish', url: `https://t.me/${ADMIN_USERNAME}` }]]
        }
      }
    );
    return;
  }

  // 11. Mockni boshlash tugmasi (admin tasdiqlagandan keyin)
  if (query.data === 'start_speaking_mock') {
    await bot.answerCallbackQuery(query.id);
    const tierKey = speakingApprovedTier[chatId];
    if (!tierKey) {
      return bot.sendMessage(chatId, 'Ruxsat topilmadi. Iltimos, avval to\'lovni tasdiqlatib oling.');
    }
    if (speakingSessions[chatId]) {
      return bot.sendMessage(chatId, 'Sizda allaqachon faol mock bor. Uni yakunlang.');
    }
    delete speakingApprovedTier[chatId];
    await startSpeakingMock(chatId, tierKey);
    return;
  }

  // ---- Admin tugmalari (Writing Checker uchun to'lov ruxsati) ----
  if (query.data.startsWith('approve_writing:') || query.data.startsWith('reject_writing:')) {
    if (String(chatId) !== String(ADMIN_CHAT_ID)) return;

    const [action, reqId] = query.data.split(':');
    const req = pendingWritingRequests[reqId];

    if (!req) {
      return bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov eskirgan yoki topilmadi.' });
    }

    if (action === 'reject_writing') {
      delete pendingWritingRequests[reqId];
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      await bot.sendMessage(ADMIN_CHAT_ID, '❌ Writing Checker so\'rovi rad etildi.');
      bot.sendMessage(req.userChatId, 'Kechirasiz, to\'lovingiz tasdiqlanmadi. Iltimos, admin bilan bog\'laning.');
      return bot.answerCallbackQuery(query.id);
    }

    if (action === 'approve_writing') {
      delete pendingWritingRequests[reqId];
      writingApproved.add(req.userChatId);

      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      await bot.sendMessage(ADMIN_CHAT_ID, `✅ Writing Checker uchun ruxsat berildi (${req.userName}).`);
      bot.sendMessage(req.userChatId,
        `✅ To'lovingiz tasdiqlandi!\n\nEndi Writing (Task 2) insho matningizni shu botga oddiy matn qilib yuboring.`
      );
      return bot.answerCallbackQuery(query.id, { text: 'Ruxsat berildi ✅' });
    }
  }

  // ---- Admin tugmalari (Speaking Checker uchun to'lov ruxsati) ----
  if (query.data.startsWith('approve_speaking:') || query.data.startsWith('reject_speaking:')) {
    if (String(chatId) !== String(ADMIN_CHAT_ID)) return;

    const [action, reqId] = query.data.split(':');
    const req = pendingSpeakingRequests[reqId];

    if (!req) {
      return bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov eskirgan yoki topilmadi.' });
    }

    if (action === 'reject_speaking') {
      delete pendingSpeakingRequests[reqId];
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      await bot.sendMessage(ADMIN_CHAT_ID, '❌ Speaking Checker so\'rovi rad etildi.');
      bot.sendMessage(req.userChatId, 'Kechirasiz, to\'lovingiz tasdiqlanmadi. Iltimos, admin bilan bog\'laning.');
      return bot.answerCallbackQuery(query.id);
    }

    if (action === 'approve_speaking') {
      delete pendingSpeakingRequests[reqId];
      speakingApprovedTier[req.userChatId] = req.tier;

      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      await bot.sendMessage(ADMIN_CHAT_ID, `✅ Speaking Checker uchun ruxsat berildi (${req.userName}, ${SPEAKING_TIERS[req.tier].label}).`);
      bot.sendMessage(req.userChatId,
        `✅ To'lovingiz tasdiqlandi! (${SPEAKING_TIERS[req.tier].label})\n\nMockni boshlash uchun tugmani bosing 👇`,
        { reply_markup: { inline_keyboard: [[{ text: '🎙 Mockni boshlash', callback_data: 'start_speaking_mock' }]] } }
      );
      return bot.answerCallbackQuery(query.id, { text: 'Ruxsat berildi ✅' });
    }
  }

  // ---- Admin tugmalari (premium berish/rad etish) ----
  if (String(chatId) !== String(ADMIN_CHAT_ID)) return;

  const [action, reqId] = query.data.split(':');
  const req = pendingRequests[reqId];

  if (!req) {
    return bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov eskirgan yoki topilmadi.' });
  }

  if (action === 'reject') {
    delete pendingRequests[reqId];
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: query.message.message_id,
    });
    await bot.sendMessage(ADMIN_CHAT_ID, '❌ Rad etildi.');
    bot.sendMessage(req.userChatId, 'Kechirasiz, to\'lovingiz tasdiqlanmadi. Iltimos, admin bilan bog\'laning.');
    return bot.answerCallbackQuery(query.id);
  }

  if (action === 'approve') {
    if (!req.email) {
      return bot.answerCallbackQuery(query.id, {
        text: 'Email topilmadi! Avval foydalanuvchidan email so\'rang.',
        show_alert: true,
      });
    }

    try {
      const result = await grantPremium(req.email, PREMIUM_DAYS);
      if (!result.ok) {
        await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Xatolik: ${result.message}`);
        return bot.answerCallbackQuery(query.id, { text: 'Xatolik yuz berdi.' });
      }

      delete pendingRequests[reqId];
      totalPremiumApproved++;
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `✅ Premium berildi!\n📧 ${req.email}\n📅 ${PREMIUM_DAYS} kunga faollashtirildi.`
      );
      bot.sendMessage(
        req.userChatId,
        `🎉 Tabriklaymiz! Premium tarif faollashtirildi (${PREMIUM_DAYS} kun). Saytga qayta kirib, premium bo'limlardan foydalanishingiz mumkin.`
      );
      bot.answerCallbackQuery(query.id, { text: 'Premium berildi ✅' });
    } catch (err) {
      console.error(err);
      bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Kutilmagan xatolik: ${err.message}`);
      bot.answerCallbackQuery(query.id, { text: 'Xatolik yuz berdi.' });
    }
  }
});

// ---- Supabase ----
async function grantPremium(email, days) {
  const listRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!listRes.ok) {
    return { ok: false, message: `Supabase auth so'rovi muvaffaqiyatsiz (${listRes.status})` };
  }

  const listData = await listRes.json();
  const users = listData.users || listData;
  const user = Array.isArray(users) ? users.find(u => u.email === email) : null;

  if (!user) {
    return { ok: false, message: `"${email}" bilan ro'yxatdan o'tgan foydalanuvchi topilmadi.` };
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: user.id,
      tariff: 'premium',
      premium_expires_at: expiresAt,
    }),
  });

  if (!upsertRes.ok) {
    const errText = await upsertRes.text();
    return { ok: false, message: `Profilni yangilab bo'lmadi: ${errText}` };
  }

  return { ok: true };
}

console.log('Bot ishga tushdi...');
