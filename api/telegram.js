// Vercel Serverless Function: Telegram webhook handler
// Supports Telegram Stars (XTR) invoices.
// Node 18+ (fetch is global).

const AMOUNTS = [500, 1000, 1500, 2000, 3000, 4000, 5000];

function numEnv(name, def = 0) {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_USER_ID = numEnv("ADMIN_USER_ID", 0);
const LOG_CHAT_ID = numEnv("LOG_CHAT_ID", 0);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

function apiUrl(method) {
  return `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
}

async function tg(method, body) {
  const res = await fetch(apiUrl(method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json || !json.ok) {
    const desc = json?.description || "Unknown Telegram API error";
    throw new Error(`${method} failed: ${desc}`);
  }
  return json.result;
}

function isAdmin(userId) {
  return ADMIN_USER_ID > 0 && userId === ADMIN_USER_ID;
}

function donateKeyboard() {
  const rows = [];
  for (let i = 0; i < AMOUNTS.length; i += 2) {
    const row = AMOUNTS.slice(i, i + 2).map((a) => ({
      text: `${a} ⭐`,
      callback_data: `donate:${a}`,
    }));
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

module.exports = async (req, res) => {
  // Basic sanity
  if (!BOT_TOKEN) {
    res.status(500).send("BOT_TOKEN missing");
    return;
  }
  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }

  // Optional webhook secret check
  if (WEBHOOK_SECRET) {
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (secret !== WEBHOOK_SECRET) {
      res.status(403).send("forbidden");
      return;
    }
  }

  const update = req.body;

  // Always respond 200 quickly
  res.status(200).send("ok");

  try {
    // 1) pre_checkout_query -> MUST answer fast
    if (update.pre_checkout_query) {
      await tg("answerPreCheckoutQuery", {
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true,
      });
      return;
    }

    // 2) successful_payment -> thank + log
    const sp = update.message?.successful_payment;
    if (sp) {
      const chatId = update.message.chat.id;
      const from = update.message.from || {};
      const total = sp.total_amount;
      const payload = sp.invoice_payload;
      const chargeId = sp.telegram_payment_charge_id;

      await tg("sendMessage", {
        chat_id: chatId,
        text: `✅ Получено ${total} ⭐ Спасибо!`,
      });

      if (LOG_CHAT_ID) {
        const username = from.username ? `@${from.username}` : "";
        const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
        const lines = [
          "💫 Stars payment received",
          `from: ${[name, username].filter(Boolean).join(" ").trim()}`,
          `user_id: ${from.id}`,
          `amount: ${total} ⭐`,
          `payload: ${payload}`,
          `charge_id: ${chargeId}`,
          `date: ${new Date().toISOString()}`,
        ].join("\n");

        await tg("sendMessage", { chat_id: LOG_CHAT_ID, text: lines });
      }
      return;
    }

    // 3) Text commands: /start, /donate, /balance, /tx
    const text = update.message?.text;
    if (text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from?.id;

      if (text === "/start" || text.startsWith("/donate")) {
        await tg("sendMessage", {
          chat_id: chatId,
          text: "Выбери сумму поддержки в Telegram Stars:",
          reply_markup: donateKeyboard(),
        });
        return;
      }

      if (text.startsWith("/balance")) {
        if (!isAdmin(userId)) {
          await tg("sendMessage", { chat_id: chatId, text: "⛔️ Только для админа" });
          return;
        }
        const bal = await tg("getMyStarBalance", {});
        await tg("sendMessage", {
          chat_id: chatId,
          text: `⭐️ Баланс Stars:\n${safeJsonStringify(bal)}`,
        });
        return;
      }

      if (text.startsWith("/tx")) {
        if (!isAdmin(userId)) {
          await tg("sendMessage", { chat_id: chatId, text: "⛔️ Только для админа" });
          return;
        }
        const tx = await tg("getStarTransactions", { limit: 10 });
        await tg("sendMessage", {
          chat_id: chatId,
          text: `🧾 Последние транзакции Stars:\n${safeJsonStringify(tx)}`,
        });
        return;
      }

      return;
    }

    // 4) callback_query donate:AMOUNT -> sendInvoice
    const cq = update.callback_query;
    if (cq) {
      const data = cq.data || "";
      const chatId = cq.message?.chat?.id;
      const cbId = cq.id;

      if (data.startsWith("donate:") && chatId) {
        const amount = Number(data.split(":")[1]);
        if (!AMOUNTS.includes(amount)) {
          await tg("answerCallbackQuery", { callback_query_id: cbId, text: "Неверная сумма" });
          return;
        }

        await tg("answerCallbackQuery", { callback_query_id: cbId });

        const payload = `donate_${amount}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

        // Telegram Stars invoice requirements:
        // - currency="XTR"
        // - provider_token=""
        // - prices must have exactly 1 item
        await tg("sendInvoice", {
          chat_id: chatId,
          title: "Поддержка проекта",
          description: `Спасибо! Поддержка на ${amount} Stars.`,
          payload,
          provider_token: "",
          currency: "XTR",
          prices: [{ label: "Support", amount }],
        });
      }
      return;
    }
  } catch (e) {
    // Don't crash, just log
    console.error("Webhook error:", e);
  }
};
