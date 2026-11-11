// For workflow steps: node scripts/notify-cli.mjs --source <s> --kind <k> --severity <sev> [--key <k>] [--run-url <u>] "<text>"
// Posts the text to SLACK_WEBHOOK_URL (body {"text": ...}, as the curl steps did) and logs it (lib/notify.mjs).
// Exit 0 when Slack accepted it; exit 1 when Slack was not reached or refused, so a step can fall back to curl.
// With no SLACK_WEBHOOK_URL it does nothing and exits 0 (a job without the secret behaves as it always did).
import { notify } from "../lib/notify.mjs";

const argv = process.argv.slice(2);
const opts = {};
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--") && i + 1 < argv.length) opts[a.slice(2)] = argv[++i];
  else rest.push(a);
}
const text = rest.join(" ");
if (!text) {
  console.error('usage: node scripts/notify-cli.mjs --source <s> --kind <k> --severity <sev> "<text>"');
  process.exit(2);
}
if (!process.env.SLACK_WEBHOOK_URL) process.exit(0);
const source = opts.source || "workflow";
const { slackOk } = await notify(text, {
  source,
  kind: opts.kind,
  severity: opts.severity,
  key: opts.key || (opts.kind === "workflow-failed" && source.startsWith("workflow:") ? source : undefined),
  runUrl: opts["run-url"],
});
process.exit(slackOk ? 0 : 1);
