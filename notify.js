import fs from "node:fs";

const CLIENT_ID = process.env.KICK_CLIENT_ID;
const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SLUG = process.env.KICK_SLUG || "xposed";
const STATE_FILE = "state.json";

for (const [name, value] of Object.entries({ CLIENT_ID, CLIENT_SECRET, BOT_TOKEN, CHAT_ID })) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
}

async function getAppAccessToken() {
  const res = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Kick token request failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function getChannelStatus(slug) {
  const token = await getAppAccessToken();
  const res = await fetch(
    `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Kick channel lookup failed: ${res.status}`);
  const json = await res.json();
  const channel = json.data?.[0];
  return {
    isLive: Boolean(channel?.stream?.is_live),
    title: channel?.stream_title || "",
    viewers: channel?.stream?.viewer_count,
  };
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildLiveMessage(slug, status) {
  const lines = [`🔴 <b>${escapeHtml(slug)} just went live on Kick!</b>`];
  if (status.title) lines.push(`🎮 ${escapeHtml(status.title)}`);
  if (typeof status.viewers === "number") lines.push(`👀 ${status.viewers.toLocaleString()} watching`);
  lines.push("");
  lines.push(`▶️ <a href="https://kick.com/${slug}">Watch now</a>`);
  lines.push("✅ Chat bot will start posting automatically.");
  return lines.join("\n");
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram send failed: ${res.status} ${body}`);
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { wasLive: false };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

const state = loadState();
const status = await getChannelStatus(SLUG);

console.log(`${SLUG} live check: was=${state.wasLive} now=${status.isLive}`);

if (status.isLive && !state.wasLive) {
  await sendTelegram(buildLiveMessage(SLUG, status));
  console.log("Notified via Telegram.");
}

if (status.isLive !== state.wasLive) {
  saveState({ wasLive: status.isLive });
}
