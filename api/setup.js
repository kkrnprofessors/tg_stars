// Vercel Serverless Function: sets Telegram webhook for this deployment.
// Protected by SETUP_KEY.

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const SETUP_KEY = process.env.SETUP_KEY || "";

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

module.exports = async (req, res) => {
  if (!BOT_TOKEN) {
    res.status(500).send("BOT_TOKEN missing");
    return;
  }

  const key = req.query?.key || "";
  if (!SETUP_KEY || key !== SETUP_KEY) {
    res.status(403).send("forbidden");
    return;
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const url = `${proto}://${host}/api/telegram`;

  try {
    const result = await tg("setWebhook", {
      url,
      secret_token: WEBHOOK_SECRET || undefined,
      drop_pending_updates: true
    });

    res.status(200).send(
      `Webhook set OK\nURL: ${url}\nResult: ${JSON.stringify(result)}`
    );
  } catch (e) {
    res.status(500).send(`Error: ${e.message}`);
  }
};
