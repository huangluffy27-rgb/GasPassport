// GasPassport 本地 API + CLI。
// 服务：node scripts/prebudget_api.mjs                      → http://127.0.0.1:8787
// CLI ：node scripts/prebudget_api.mjs --artifact out/X.json --function airdrop --min 1 --max 64 --step 8
// 部署：node scripts/prebudget_api.mjs --deploy out/X.json --args 0x
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import http from "node:http";
import { batchPlan, deployBudget, functionBudget } from "./budget_core.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const API_KEY = process.env.GASPASSPORT_API_KEY ?? "";
const QUOTA = Number(process.env.GASPASSPORT_QUOTA ?? 0);
const USAGE_FILE = process.env.GASPASSPORT_USAGE_FILE ?? resolve(process.cwd(), ".local", "api-usage.json");
const today = () => new Date().toISOString().slice(0, 10);

function loadUsage() {
  try {
    const u = JSON.parse(readFileSync(USAGE_FILE, "utf8"));
    if (u.day === today()) return u;
  } catch {
    // 首次运行或文件损坏：从零开始
  }
  return { day: today(), count: 0 };
}

let usage = loadUsage();

function consume() {
  if (usage.day !== today()) usage = { day: today(), count: 0 };
  usage.count += 1;
  mkdirSync(dirname(USAGE_FILE), { recursive: true });
  writeFileSync(USAGE_FILE, JSON.stringify(usage));
  return usage;
}

function readArtifact(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

async function runCli() {
  const artifactPath = argOf("artifact");
  const deployPath = argOf("deploy");
  const batch = argOf("batch");
  if (batch) {
    const [totalUsers, perUserGas] = batch.split(",").map(Number);
    console.log(JSON.stringify(batchPlan({ totalUsers, perUserGas }), null, 2));
    return true;
  }
  if (deployPath) {
    const artifact = readArtifact(deployPath);
    const bytecode = artifact.bytecode?.object ?? artifact.bytecode;
    const args = argOf("args", "0x");
    console.log(JSON.stringify(await deployBudget({ bytecode, constructorArgs: args }), null, 2));
    return true;
  }
  if (!artifactPath) return false;
  const artifact = readArtifact(artifactPath);
  const out = await functionBudget({
    artifact,
    functionName: argOf("function", "airdrop"),
    min: Number(argOf("min", 1)),
    max: Number(argOf("max", 64)),
    step: Number(argOf("step", 1)),
    samplesPerInput: Number(argOf("samples", 1)),
    varyIndex: argOf("vary") === undefined ? undefined : Number(argOf("vary")),
  });
  console.log(JSON.stringify(out, null, 2));
  return true;
}

function send(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function startServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204, {});
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    try {
      if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
      const needsAuth = req.method === "POST" || req.url === "/v1/usage";
      if (needsAuth && API_KEY && req.headers["x-api-key"] !== API_KEY) {
        return send(res, 401, { error: "unauthorized" });
      }
      if (req.method === "GET" && req.url === "/v1/usage") {
        return send(res, 200, {
          day: usage.day,
          used: usage.count,
          quota: QUOTA || null,
          remaining: QUOTA ? Math.max(0, QUOTA - usage.count) : null,
        });
      }
      const apiPost =
        req.method === "POST" && ["/v1/batch-plan", "/v1/deploy-budget", "/v1/budget"].includes(req.url);
      if (apiPost) {
        if (QUOTA > 0 && usage.count >= QUOTA) {
          return send(res, 429, { error: "quota exceeded", quota: QUOTA, used: usage.count });
        }
        consume();
      }
      if (req.method === "POST" && req.url === "/v1/batch-plan") {
        return send(res, 200, batchPlan(await readBody(req)));
      }
      if (req.method === "POST" && req.url === "/v1/deploy-budget") {
        const body = await readBody(req);
        const bytecode = body.bytecode ?? body.artifact?.bytecode?.object ?? body.artifact?.bytecode;
        if (!bytecode) return send(res, 400, { error: "缺少 bytecode" });
        return send(res, 200, await deployBudget({ bytecode, constructorArgs: body.constructorArgs ?? "0x" }));
      }
      if (req.method === "POST" && req.url === "/v1/budget") {
        const body = await readBody(req);
        if (!body.artifact) return send(res, 400, { error: "缺少 artifact" });
        return send(
          res,
          200,
          await functionBudget({
            artifact: body.artifact,
            functionName: body.function ?? "airdrop",
            min: body.min ?? 1,
            max: body.max ?? 64,
            step: body.step ?? 1,
            samplesPerInput: body.samplesPerInput ?? 1,
            varyIndex: body.varyIndex,
          }),
        );
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`GasPassport API: http://127.0.0.1:${PORT}`);
    console.log(`GET  /health`);
    console.log(`POST /v1/deploy-budget  { bytecode, constructorArgs? }`);
    console.log(`POST /v1/budget         { artifact, function, min?, max?, step?, samplesPerInput? }`);
    console.log(`POST /v1/batch-plan     { totalUsers, perUserGas, txGasCap?, txOverhead? }`);
    console.log(API_KEY ? "auth: x-api-key required" : "auth: open (set GASPASSPORT_API_KEY to enable)");
    console.log(`GET  /v1/usage`);
    console.log(`usage: ${usage.count}/${QUOTA || "∞"} (${USAGE_FILE})`);
  });
}

const handled = await runCli();
if (!handled) await startServer();
