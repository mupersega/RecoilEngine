// node elements.mjs <engine folder> <out dir>
// The engine's own RmlUi elements (<svg>, <texture>) on one engine: a stage with one of each, the Codex
// (five <svg> images) and the texture spike (<texture> from $, # and live GL sources), with screenshots and the RmlUi console.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "file:///C:/Users/cambo/dev/bar-dev-mcp/scripts/stdio_client.mjs";

const [engine, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const server = startServer({ env: { BAR_DEV_NO_UPDATE: "1" } });
await server.initialize("pr-3746-elements");
const call = async (name, args = {}) => {
  const r = await server.rpc("tools/call", { name, arguments: args });
  const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  if (r.isError) throw new Error(`${name}: ${text.slice(0, 600)}`);
  return { text, json };
};
const wait = (seconds) => call("bar_wait", { seconds }).catch(() => {});
const shoot = async (document, name, extra = {}) => {
  try {
    const s = await call("bar_screenshot", { document, format: "png", ...extra });
    const path = s.json?.paths?.[0] ?? s.json?.path ?? (s.text.match(/[A-Za-z]:[^"\n]*?\.png/) || [])[0];
    copyFileSync(path, join(out, `${name}.png`));
    console.log("shot", name);
    return true;
  } catch (err) {
    console.log("no shot", name, err.message.slice(0, 200));
    return false;
  }
};

const log = {};
let sessionId;
try {
  const started = await call("bar_session_start", { engine, empty: true, mode: "window", resolution: [1920, 1080] });
  sessionId = started.json.session.id;
  log.engine = started.json.ping?.engine;
  console.log("engine", log.engine);
  const seqStart = (await call("bar_log", { limit: 1 })).json?.consoleSeq ?? 0;

  await call("bar_widget", { action: "enable", name: "RML stage" });
  await wait(1);
  const rml =
    "<svg id='s' src='/luaui/images/rml/codex/plate.svg' style='display: block; position: absolute; left: 10dp; top: 10dp; width: 140dp; height: 140dp;'/>" +
    "<texture id='t' style='display: block; position: absolute; left: 170dp; top: 10dp; width: 140dp; height: 140dp;'/>";
  log.stage = (
    await call("bar_eval", {
      code: `local r = WG.rmlStage.load({ rml = ${JSON.stringify(rml)}, rcss = "", width = 320, height = 160, left = 40, top = 40, ground = "#8a96a3", raw = true })
local t = WG.rmlStage.query("#t")[1]
t:SetAttribute("src", "#" .. UnitDefNames.armcom.id)
local s = WG.rmlStage.query("#s")[1]
return { loaded = r.loaded, svgTag = s.tag_name, textureTag = t.tag_name, svgSize = { s.client_width, s.client_height }, textureSize = { t.client_width, t.client_height } }`,
    })
  ).json;
  await wait(1);
  await shoot("RML stage", "stage-svg-texture");

  await call("bar_widget", { action: "enable", name: "RML texture spike" });
  await wait(2);
  await shoot("RML texture spike", "texture-spike");

  await call("bar_widget", { action: "enable", name: "Codex" });
  await wait(1);
  log.codexOpen = (await call("bar_eval", { code: `return WG.codex ~= nil or true` })).json;
  await wait(2);
  await shoot("Codex", "codex");

  const lines = (await call("bar_log", { since: seqStart, limit: 400 })).json?.lines ?? [];
  log.problems = lines.map((l) => l.text).filter((t) => /error|warning|failed|could not|unable/i.test(t));
  log.rmlLines = lines.map((l) => l.text).filter((t) => /rmlui|svg|texture/i.test(t)).slice(-40);
  console.log("problems", log.problems.length);
  for (const p of log.problems.slice(0, 20)) console.log("  ", p.slice(0, 220));
} catch (err) {
  log.error = err.message;
  console.error(err.message);
} finally {
  writeFileSync(join(out, "elements-log.json"), JSON.stringify(log, null, 1));
  if (sessionId) await call("bar_session_stop", { session: sessionId }).catch(() => {});
  server.close();
}
