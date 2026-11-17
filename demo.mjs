// node demo.mjs <engine folder> <out dir> [--keep]
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "file:///C:/Users/cambo/dev/bar-dev-mcp/scripts/stdio_client.mjs";

const [engine, out] = process.argv.slice(2);
const keep = process.argv.includes("--keep");
mkdirSync(out, { recursive: true });

const RML = `<div id="theme"><div class="card">
<div class="title">Update RmlUi to 6.3</div>
<div class="sub">Every colour, gap and radius here is a var()</div>
<div class="row"><div class="swatch s1"/><div class="swatch s2"/><div class="swatch s3"/></div>
<div class="meter"><div class="fill"/></div>
<div class="button">Deploy</div>
</div></div>`;

const RCSS = `
#theme { --accent: #3fa9f5; --accent-soft: #3fa9f540; --surface: #10161c; --panel: #1b242d; --text: #e6edf3; --muted: #8b98a5; --gap: 12dp; --radius: 6dp; --fill: 70%;
  display: block; position: absolute; left: 0dp; top: 0dp; width: 420dp; height: 280dp; background-color: var(--surface); }
.card { display: block; position: absolute; left: var(--gap); top: var(--gap); right: var(--gap); bottom: var(--gap); background-color: var(--panel); border: 2dp var(--accent); border-radius: var(--radius); padding: var(--gap); }
.title { display: block; color: var(--text); font-size: 22dp; font-weight: 600; }
.sub { display: block; color: var(--muted); font-size: 14dp; margin-top: 4dp; }
.row { display: block; margin-top: var(--gap); height: 28dp; }
.swatch { display: inline-block; width: 28dp; height: 28dp; margin-right: 8dp; border-radius: var(--radius); }
.s1 { background-color: var(--accent); }
.s2 { background-color: var(--text); }
.s3 { background-color: var(--muted); }
.meter { display: block; margin-top: var(--gap); height: 10dp; background-color: var(--accent-soft); border-radius: 5dp; }
.fill { display: block; width: var(--fill); height: 10dp; background-color: var(--accent); border-radius: 5dp; }
.button { display: block; position: absolute; right: var(--gap); bottom: var(--gap); width: 120dp; height: 34dp; line-height: 34dp; text-align: center; color: var(--surface); background-color: var(--accent); border-radius: var(--radius); font-size: 15dp; font-weight: 600; }
`;

const THEMES = [
  { name: "1-amber", vars: { "--accent": "#f5a623", "--accent-soft": "#f5a62340", "--fill": "35%" } },
  { name: "2-green", vars: { "--accent": "#3ddc84", "--accent-soft": "#3ddc8440", "--fill": "90%", "--radius": "14dp" } },
  { name: "3-red", vars: { "--accent": "#ff5c5c", "--accent-soft": "#ff5c5c40", "--fill": "15%", "--radius": "0dp", "--gap": "20dp" } },
];

const server = startServer({ env: { BAR_DEV_NO_UPDATE: "1" } });
await server.initialize("pr-3746-demo");
const call = async (name, args = {}) => {
  const r = await server.rpc("tools/call", { name, arguments: args });
  const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  let json;
  try { json = JSON.parse(text); } catch {}
  if (r.isError) throw new Error(`${name}: ${text.slice(0, 600)}`);
  return { text, json };
};
const lua = (s) => JSON.stringify(s);
const log = {};
let sessionId;
try {
  const started = await call("bar_session_start", { engine, empty: true, mode: "window", resolution: [1920, 1080] });
  sessionId = started.json.session.id;
  log.session = { id: sessionId, port: started.json.session.port, dir: started.json.session.dir, engine: started.json.ping?.engine };
  console.log("session", JSON.stringify(log.session));
  log.enable = (await call("bar_widget", { action: "enable", name: "RML stage" })).text;
  await call("bar_wait", { seconds: 1 }).catch(() => {});
  log.load = (await call("bar_eval", { code: `return WG.rmlStage.load({ rml = ${lua(RML)}, rcss = ${lua(RCSS)}, width = 420, height = 280, left = 40, top = 40, ground = "#000000", raw = true })` })).json;
  await call("bar_wait", { seconds: 1 }).catch(() => {});
  const shoot = async (name) => {
    const s = await call("bar_screenshot", { document: "RML stage", format: "png" });
    const path = s.json?.paths?.[0] ?? s.json?.path ?? (s.text.match(/[A-Za-z]:[^"\n]*?\.png/) || [])[0];
    const dest = join(out, `${name}.png`);
    copyFileSync(path, dest);
    console.log("shot", dest);
  };
  await shoot("0-default");
  if (!process.argv.includes("--no-themes")) {
    for (const theme of THEMES) {
      const sets = Object.entries(theme.vars).map(([k, v]) => `e.style[${lua(k)}] = ${lua(v)}`).join("; ");
      log[theme.name] = (await call("bar_eval", { code: `local e = WG.rmlStage.query("#theme")[1]; ${sets}; return { accent = e.style["--accent"], fill = e.style["--fill"] }` })).json;
      await call("bar_wait", { seconds: 0.5 }).catch(() => {});
      await shoot(theme.name);
    }
    log.pairs = (await call("bar_eval", { code: `local e = WG.rmlStage.query("#theme")[1]; local names = {}; local ok, err = pcall(function() for k, v in pairs(e.style) do names[#names + 1] = k .. ": " .. tostring(v) end end); table.sort(names); return { ok = ok, err = err and tostring(err), names = names }` })).json;
  }
  log.console = (await call("bar_log", { rml: true, limit: 40 }).catch((e) => ({ text: e.message }))).text;
} catch (err) {
  log.error = err.message;
  console.error(err.message);
} finally {
  writeFileSync(join(out, "log.json"), JSON.stringify(log, null, 1));
  if (sessionId && !keep) await call("bar_session_stop", { session: sessionId }).catch(() => {});
  server.close();
}
