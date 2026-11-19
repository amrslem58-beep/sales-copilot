// سيرفر صغير: بيخبي مفتاح الـ API وبيمرر الرد لحظيًا للصفحة. من غير أي مكتبات.
const fs = require("fs"), path = require("path"), http = require("http");
const KEY = process.env.ANTHROPIC_API_KEY;
const PASS = process.env.APP_PASSWORD || "";
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const MODELS = {
  quick: process.env.MODEL_QUICK || "claude-haiku-5-5",     // للردود السريعة
  default: process.env.MODEL_DEFAULT || "claude-sonnet-5-5"  // للتعلّم وتحديث الدفتر
};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function body(req) {
  return new Promise((ok, no) => {
    let s = "";
    req.on("data", c => { s += c; if (s.length > 300000) { no(new Error("big")); req.destroy(); } });
    req.on("end", () => ok(s));
  });
}

http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (req.method === "POST" && url === "/api/ask") {
    if (!KEY) { res.writeHead(500); return res.end("ANTHROPIC_API_KEY مش متظبط على السيرفر"); }
    if (PASS && req.headers["x-pass"] !== PASS) { res.writeHead(401); return res.end("كلمة السر غلط"); }
    let j;
    try { j = JSON.parse(await body(req)); } catch { res.writeHead(400); return res.end("طلب غير صالح"); }
    const tier = j.tier === "default" ? "default" : "quick";
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    try {
      const up = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: ac.signal,
        headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODELS[tier], max_tokens: tier === "quick" ? 700 : 1800, stream: true,
          messages: [{ role: "user", content: String(j.prompt || "").slice(0, 60000) }] })
      });
      if (!up.ok) { res.writeHead(up.status); return res.end(await up.text()); }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
      let buf = ""; const dec = new TextDecoder();
      for await (const chunk of up.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          try { const d = JSON.parse(line.slice(5)); if (d.type === "content_block_delta" && d.delta && d.delta.text) res.write(d.delta.text); } catch {}
        }
      }
      res.end();
    } catch (e) { if (!res.headersSent) res.writeHead(502); res.end(); }
    return;
  }
  const p = path.join(PUB, url === "/" ? "/index.html" : decodeURIComponent(url));
  if (!p.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end("مش موجود"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log("شغال على المنفذ " + PORT));
