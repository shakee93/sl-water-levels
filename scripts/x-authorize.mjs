// One-time helper: gets the access token + secret for the BOT account (PIN-based OAuth 1.0a, "oob") and stores them
// straight into GitHub Actions secrets X_ACCESS_TOKEN / X_ACCESS_SECRET with `gh secret set`. Nothing secret is printed.
//
//   node scripts/x-authorize.mjs
//
// Why: the developer console's own "Access Token" posts as whoever owns the app (the owner's personal account). The
// bot is a different account, so it has to be authorised once, while logged in as the BOT.
// Steps: it asks for the app's API Key and Secret (or reads X_API_KEY / X_API_SECRET from the environment; typing is
// hidden), prints a link; open it in a browser logged in as the BOT account, press "Authorize app", copy the PIN shown,
// paste it here. It also stores X_API_KEY and X_API_SECRET as secrets. Needs: the app has "Read and write" permission and
// OAuth 1.0a enabled with the PIN-based ("oob") callback; `gh` logged in for this repo.
import { createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import readline from "node:readline";

const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function header(method, url, key, secret, extra = {}, tokenSecret = "") {
  const oauth = { oauth_consumer_key: key, oauth_nonce: randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_version: "1.0", ...extra };
  const param = Object.keys(oauth).sort().map((k) => `${enc(k)}=${enc(oauth[k])}`).join("&");
  oauth.oauth_signature = createHmac("sha1", `${enc(secret)}&${enc(tokenSecret)}`).update([method, enc(url), enc(param)].join("&")).digest("base64");
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(", ");
}

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); });
  });
}

async function call(url, auth) {
  const res = await fetch(url, { method: "POST", headers: { Authorization: auth } });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from X: ${body.slice(0, 200)}`);
  return Object.fromEntries(new URLSearchParams(body));
}

function setSecret(name, value) {
  const r = spawnSync("gh", ["secret", "set", name], { input: value, stdio: ["pipe", "ignore", "inherit"] });
  if (r.status !== 0) throw new Error(`gh secret set ${name} failed`);
  console.log(`saved secret ${name}`);
}

const key = process.env.X_API_KEY || (await ask("API Key: ", true));
const secret = process.env.X_API_SECRET || (await ask("API Key Secret: ", true));
if (!key || !secret) throw new Error("API Key and Secret are required");

const rt = await call("https://api.x.com/oauth/request_token", header("POST", "https://api.x.com/oauth/request_token", key, secret, { oauth_callback: "oob" }));
if (rt.oauth_callback_confirmed !== "true") throw new Error("X did not confirm the PIN (oob) callback: enable OAuth 1.0a with the PIN-based option in the app settings");
console.log(`\nOpen this link in a browser where you are logged in as the BOT account (not your personal one):\n\n  https://api.x.com/oauth/authorize?oauth_token=${rt.oauth_token}\n`);
const pin = await ask("PIN shown after you press Authorize: ", false);

const at = await call(
  "https://api.x.com/oauth/access_token",
  header("POST", "https://api.x.com/oauth/access_token", key, secret, { oauth_token: rt.oauth_token, oauth_verifier: pin }, rt.oauth_token_secret),
);
if (!at.oauth_token || !at.oauth_token_secret) throw new Error("no access token came back");
console.log(`\nAuthorised as @${at.screen_name} (check this is the BOT account).`);
setSecret("X_API_KEY", key);
setSecret("X_API_SECRET", secret);
setSecret("X_ACCESS_TOKEN", at.oauth_token);
setSecret("X_ACCESS_SECRET", at.oauth_token_secret);
console.log("Done. Posting stays in dry-run until you run: gh variable set X_POSTING --body live");
