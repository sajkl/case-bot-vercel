// /api/debug-check-token.js
import crypto from "crypto";

function compute(raw, token) {
  const secret = crypto.createHash("sha256").update((token || "").trim()).digest();
  const pairs = String(raw).split("&").filter(Boolean).filter(p => !p.startsWith("hash="));
  pairs.sort((a,b)=> (a.split("=")[0] < b.split("=")[0] ? -1 : 1));
  const dcs = pairs.join("\n");
  return crypto.createHmac("sha256", secret).update(dcs).digest("hex");
}

export default async function handler(req, res) {
  const { initData = "", token = "" } = req.method === "POST" ? (req.body || {}) : req.query;
  const provided = new URLSearchParams(initData).get("hash") || "";
  const computed = token ? compute(initData, token) : "";
  res.status(200).json({
    ok: !!token && !!initData && provided === computed,
    provided: provided ? provided.slice(0,16) + "…" : null,
    computed: computed ? computed.slice(0,16) + "…" : null
  });
}
