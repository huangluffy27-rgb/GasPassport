import { useEffect, useMemo, useState } from "react";
import { concat, encodeFunctionData, keccak256, stringToHex, toHex } from "viem";
import { ALIGNED_AIRDROP, BATCH_AIRDROP } from "./contracts";
import {
  AIR_BUCKETS,
  ALIGNED,
  bucketFor,
  fmt,
  MONAD_CHAIN,
  PAGE_BUCKETS,
  PAGE_COST,
  pct,
  RPC,
  STATS,
} from "./data";
import { useWallet } from "./useWallet";

type Tab = "overview" | "budget" | "align";
type Toast = { id: number; text: string; kind: "ok" | "err" };

const FROM = "0x00000000000000000000000000000000000000aa";
const TO = "0x00000000000000000000000000000000000000bb";

function usersFor(n: number): `0x${string}`[] {
  return Array.from({ length: n }, (_, i) => {
    const h = keccak256(concat([stringToHex("chaosgas-dapp"), toHex(BigInt(i), { size: 32 })]));
    return `0x${h.slice(-40)}` as `0x${string}`;
  });
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json());
  if (res.error) throw new Error(res.error.message);
  return res.result as T;
}

async function estimate(code: string, data: string, to = TO): Promise<number> {
  const override = to === TO ? { [TO]: { code } } : undefined;
  const params = [
    { from: FROM, to, data, gasPrice: "0x0", value: "0x0" },
    "latest",
    ...(override ? [override] : []),
  ];
  const hex = await rpc<string>("eth_estimateGas", params);
  return Number(BigInt(hex));
}

export default function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const wallet = useWallet();

  const toast = (text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  };

  return (
    <div className="app">
      <Header tab={tab} setTab={setTab} wallet={wallet} />
      <main className="wrap">
        {wallet.wrongChain && (
          <div className="banner">
            当前网络不是 Monad Testnet，请点击右上角切换（chainId {parseInt(MONAD_CHAIN.chainId, 16)}）。
          </div>
        )}
        {tab === "overview" && <Overview setTab={setTab} />}
        {tab === "budget" && <BudgetPanel notify={toast} />}
        {tab === "align" && <AlignPanel wallet={wallet} notify={toast} />}
      </main>
      <footer className="footer">
        <span>ChaosGas · Monad Blitz@广州</span>
        <div>
          <a href="./report.html">完整报告</a>
          <a href="https://github.com/huangluffy27-rgb/Monad_Product" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://mojo.devnads.com/projects/446" target="_blank" rel="noreferrer">
            Mojo
          </a>
        </div>
      </footer>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Header({ tab, setTab, wallet }: { tab: Tab; setTab: (t: Tab) => void; wallet: ReturnType<typeof useWallet> }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "概览" },
    { key: "budget", label: "预算表" },
    { key: "align", label: "页对齐实测" },
  ];
  return (
    <header className="header">
      <div className="brand">
        <div className="mark">CG</div>
        <div>
          <div className="name">ChaosGas</div>
          <div className="tag">Monad gas 预算护照</div>
        </div>
      </div>
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? "tab active" : "tab"} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="wallet">
        <span className={wallet.wrongChain ? "net bad" : "net"}>
          {wallet.address ? (wallet.wrongChain ? "网络错误" : "Monad Testnet") : "未连接"}
        </span>
        {wallet.address ? (
          <button className="btn ghost" onClick={wallet.disconnect} title={wallet.address}>
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
          </button>
        ) : (
          <button className="btn" onClick={wallet.connect} disabled={wallet.busy}>
            {wallet.busy ? "连接中…" : "连接钱包"}
          </button>
        )}
      </div>
    </header>
  );
}

function Overview({ setTab }: { setTab: (t: Tab) => void }) {
  return (
    <>
      <section className="hero">
        <div className="pill">Monad Blitz@广州 · 参赛原型</div>
        <h1>
          给你的合约一张
          <br />
          可认证的 gas 预算表
        </h1>
        <p>
          1,536 条测试网原生采样，按输入规模分桶做条件共形预测。不是又一个 gas 估算器——它补的是
          <code>eth_estimateGas</code> 覆盖不到的部署前审计、批量代付、输入后定与状态漂移。
        </p>
        <div className="hero-actions">
          <button className="btn lg" onClick={() => setTab("budget")}>
            查看预算表
          </button>
          <button className="btn ghost lg" onClick={() => setTab("align")}>
            看页对齐实测
          </button>
        </div>
      </section>

      <section className="stats">
        <Stat k="覆盖保证" v="99%" n="条件共形，留出集实测 100%" />
        <Stat k="每页增量" v={fmt(STATS.pageExtra)} n="Monad 测试网实测 gas" />
        <Stat k="页对齐收益" v="28.3%" n="64 人空投，实测 gas 降幅" />
        <Stat k="真实交易" v="6 笔" n="校准 estimateGas 与回执语义" />
      </section>

      <section className="panel">
        <h2>为什么不是直接调 estimateGas？</h2>
        <p className="muted">
          我们自己的真实交易校准证明：<code>estimateGas</code> 就是最小可行 limit。所以这个产品不跟它抢单笔预估，只补四类它到不了的场景。
        </p>
        <div className="why">
          {[
            ["部署前 / CI 审计", "合约还没上链，调不了", "给定函数与输入族，部署前产出上限"],
            ["批量 / 代付 / AA", "逐笔模拟，延迟叠加", "一次认证，运行时查表 0 次 RPC"],
            ["输入在签名后才确定", "不知道参数，估不了", "按输入规模分桶，每桶一个上限"],
            ["状态漂移与并发", "只反映当前状态", "分布上的覆盖保证，不是单点估值"],
          ].map(([a, b, c]) => (
            <div className="why-row" key={a}>
              <div className="why-k">{a}</div>
              <div className="why-bad">{b}</div>
              <div className="why-good">{c}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>从采样到预算表</h2>
        <div className="steps">
          {[
            ["1", "测试网采样", "state override + estimateGas，不发交易"],
            ["2", "数据驱动分桶", "DP 最小化期望超付，每桶 ≥60 校准样本"],
            ["3", "条件共形 + CV+", "99% 有限样本覆盖，比率分数平滑上限"],
            ["4", "预算表 / CI", "导出 JSON，供 Paymaster、批量任务、GitHub Action"],
          ].map(([n, t, d]) => (
            <div className="step" key={n}>
              <div className="step-n">{n}</div>
              <div className="step-t">{t}</div>
              <div className="step-d">{d}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Stat({ k, v, n }: { k: string; v: string; n: string }) {
  return (
    <div className="stat">
      <div className="stat-k">{k}</div>
      <div className="stat-v">{v}</div>
      <div className="stat-n">{n}</div>
    </div>
  );
}

function BudgetPanel({ notify }: { notify: (t: string, k?: "ok" | "err") => void }) {
  const [target, setTarget] = useState<"page" | "air">("page");
  const [n, setN] = useState(32);
  const buckets = target === "page" ? PAGE_BUCKETS : AIR_BUCKETS;
  const max = target === "page" ? 64 : 32;
  const bucket = bucketFor(buckets, n);
  const overpay = bucket.buffer3x / bucket.limit - 1;
  const row = PAGE_COST.reduce((a, b) => (Math.abs(b.n - n) < Math.abs(a.n - n) ? b : a));
  const pages = target === "page" ? Math.max(1, Math.round(n)) : Math.ceil(n / 32);

  const download = () => {
    const payload = {
      target: target === "page" ? "PageWriter.writeScattered" : "BatchAirdrop.airdrop",
      generatedAt: new Date().toISOString(),
      coverage: STATS.coverage,
      buckets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gas-budget.json";
    a.click();
    URL.revokeObjectURL(url);
    notify("gas-budget.json 已导出");
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>预算表</h2>
          <p className="muted">选择输入规模，查该桶的 99% 认证上限；右侧是朴素 3x buffer 的对比。</p>
        </div>
        <button className="btn ghost" onClick={download}>
          导出 gas-budget.json
        </button>
      </div>

      <div className="controls">
        <div className="seg">
          <button className={target === "page" ? "on" : ""} onClick={() => { setTarget("page"); setN(32); }}>
            PageWriter
          </button>
          <button className={target === "air" ? "on" : ""} onClick={() => { setTarget("air"); setN(16); }}>
            BatchAirdrop
          </button>
        </div>
        <div className="slider">
          <label>
            输入规模 <b>{n}</b>
          </label>
          <input type="range" min={1} max={max} value={n} onChange={(e) => setN(Number(e.target.value))} />
        </div>
      </div>

      <div className="grid3">
        <div className="card accent">
          <div className="k">99% 认证上限</div>
          <div className="v">{fmt(bucket.limit)}</div>
          <div className="n">桶 {bucket.label} · 留出覆盖 {pct(bucket.coverage)}</div>
        </div>
        <div className="card">
          <div className="k">朴素 3x buffer</div>
          <div className="v">{fmt(bucket.buffer3x)}</div>
          <div className="n">多付 {pct(overpay)}</div>
        </div>
        <div className="card">
          <div className="k">EVT 99.9%</div>
          <div className="v">{fmt(bucket.evt)}</div>
          <div className="n">尾部外推，保守取值</div>
        </div>
      </div>

      <div className="panel sub">
        <h3>这次调用会碰多少页？</h3>
        <div className="kv">
          <div><span>估算页数</span><b>{pages}</b></div>
          <div><span>每页增量</span><b>{fmt(STATS.pageExtra)} gas</b></div>
          <div><span>本次页成本</span><b>+{fmt((pages - 1) * STATS.pageExtra)} gas</b></div>
          <div><span>参考同页基线</span><b>{fmt(row.contiguous)} gas</b></div>
        </div>
        <p className="muted">
          128 槽 × 32 字节 = 4KB，与 OS 页 / SSD 页同粒度。页数越多，gas 和状态 I/O 一起上涨。
        </p>
      </div>
    </section>
  );
}

function AlignPanel({
  wallet,
  notify,
}: {
  wallet: ReturnType<typeof useWallet>;
  notify: (t: string, k?: "ok" | "err") => void;
}) {
  const [n, setN] = useState(32);
  const [sim, setSim] = useState<{ mapping: number; aligned: number } | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [steps, setSteps] = useState<{ label: string; state: "idle" | "run" | "ok" | "err"; detail?: string }[]>([]);
  const [liveBusy, setLiveBusy] = useState(false);

  const row = useMemo(() => ALIGNED.reduce((a, b) => (Math.abs(b.n - n) < Math.abs(a.n - n) ? b : a)), [n]);

  const runSim = async () => {
    setSimBusy(true);
    try {
      const users = usersFor(n);
      const dataMapping = encodeFunctionData({ abi: BATCH_AIRDROP.abi, functionName: "airdrop", args: [users, 10n ** 18n] });
      const dataAligned = encodeFunctionData({ abi: ALIGNED_AIRDROP.abi, functionName: "airdrop", args: [users, 10n ** 18n / 1000n] });
      const [mapping, aligned] = await Promise.all([
        estimate(BATCH_AIRDROP.bytecode, dataMapping),
        estimate(ALIGNED_AIRDROP.bytecode, dataAligned),
      ]);
      setSim({ mapping, aligned });
      notify(`模拟完成：节省 ${fmt(mapping - aligned)} gas`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setSimBusy(false);
    }
  };

  const setStep = (i: number, state: "run" | "ok" | "err", detail?: string) =>
    setSteps((s) => s.map((x, idx) => (idx === i ? { ...x, state, detail } : x)));

  const runLive = async () => {
    if (!wallet.address) {
      await wallet.connect();
      return;
    }
    setLiveBusy(true);
    const labels = ["部署 BatchAirdrop", "部署 AlignedAirdrop", "执行散列映射空投", "执行页对齐空投"];
    setSteps(labels.map((label) => ({ label, state: "idle" })));
    try {
      setStep(0, "run");
      const b = await wallet.sendTransaction({ data: BATCH_AIRDROP.bytecode, gas: 1_200_000 });
      if (!b.contractAddress) throw new Error("部署失败：没有拿到合约地址");
      setStep(0, "ok", b.contractAddress);

      setStep(1, "run");
      const a = await wallet.sendTransaction({ data: ALIGNED_AIRDROP.bytecode, gas: 1_200_000 });
      if (!a.contractAddress) throw new Error("部署失败：没有拿到合约地址");
      setStep(1, "ok", a.contractAddress);

      const users = usersFor(n);
      const dataMapping = encodeFunctionData({ abi: BATCH_AIRDROP.abi, functionName: "airdrop", args: [users, 10n ** 18n] });
      const dataAligned = encodeFunctionData({ abi: ALIGNED_AIRDROP.abi, functionName: "airdrop", args: [users, 10n ** 18n / 1000n] });
      const [estM, estA] = await Promise.all([
        estimate("0x", dataMapping, b.contractAddress),
        estimate("0x", dataAligned, a.contractAddress),
      ]);

      setStep(2, "run");
      const rm = await wallet.sendTransaction({ to: b.contractAddress, data: dataMapping, gas: Math.ceil(estM * 1.02) });
      setStep(2, rm.status === "0x1" ? "ok" : "err", `limit ${fmt(Math.ceil(estM * 1.02))} · ${rm.hash.slice(0, 10)}…`);

      setStep(3, "run");
      const ra = await wallet.sendTransaction({ to: a.contractAddress, data: dataAligned, gas: Math.ceil(estA * 1.02) });
      setStep(3, ra.status === "0x1" ? "ok" : "err", `limit ${fmt(Math.ceil(estA * 1.02))} · ${ra.hash.slice(0, 10)}…`);

      setSim({ mapping: estM, aligned: estA });
      notify(`链上实测完成：页对齐省 ${fmt(estM - estA)} gas`);
    } catch (err) {
      setSteps((s) => s.map((x) => (x.state === "run" ? { ...x, state: "err" } : x)));
      notify(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setLiveBusy(false);
    }
  };

  const max = Math.max(sim?.mapping ?? row.mapping, sim?.aligned ?? row.aligned);
  const m = sim?.mapping ?? row.mapping;
  const a = sim?.aligned ?? row.aligned;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>页对齐实测</h2>
          <p className="muted">散列映射 vs packed 追加记录。可以先用状态覆盖模拟，再连接钱包真实验证。</p>
        </div>
        <div className="seg">
          {[8, 16, 32, 64].map((x) => (
            <button key={x} className={n === x ? "on" : ""} onClick={() => { setN(x); setSim(null); }}>
              {x} 人
            </button>
          ))}
        </div>
      </div>

      <div className="bars">
        <Bar label="散列映射" value={m} max={max} tone="warn" />
        <Bar label="页对齐" value={a} max={max} tone="good" />
      </div>
      <div className="delta">
        节省 <b>{fmt(m - a)}</b> gas（{pct((m - a) / m)}）· 状态页流量 256KB → 4KB
      </div>

      <div className="row-actions">
        <button className="btn" onClick={runSim} disabled={simBusy}>
          {simBusy ? "模拟中…" : "状态覆盖模拟"}
        </button>
        <button className="btn ghost" onClick={runLive} disabled={liveBusy || wallet.busy}>
          {wallet.address ? (liveBusy ? "链上执行中…" : "用钱包链上实测") : "连接钱包后实测"}
        </button>
        {sim && <span className="muted small">本次结果来自链上 estimateGas</span>}
      </div>

      {steps.length > 0 && (
        <ol className="txsteps">
          {steps.map((s) => (
            <li key={s.label} className={s.state}>
              <span className="dot" />
              <div>
                <b>{s.label}</b>
                {s.detail && <span className="muted"> · {s.detail}</span>}
              </div>
              <span className="state">{s.state === "ok" ? "完成" : s.state === "err" ? "失败" : s.state === "run" ? "进行中" : "等待"}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="panel sub">
        <h3>四种输入规模的实测</h3>
        <table>
          <thead>
            <tr><th>人数</th><th>散列映射</th><th>页对齐</th><th>差额</th><th>降幅</th></tr>
          </thead>
          <tbody>
            {ALIGNED.map((r) => (
              <tr key={r.n} className={r.n === n ? "hl" : ""}>
                <td>{r.n}</td><td>{fmt(r.mapping)}</td><td>{fmt(r.aligned)}</td><td>{fmt(r.diff)}</td><td className="good-text">{r.pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          低于「页数 32 → 1」的理论值（约 59%），因为每个槽仍要付零→非零写入；页对齐真正省下的是页激活、缓存与 I/O。
        </p>
      </div>
    </section>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "warn" | "good" }) {
  const w = Math.max(4, (value / max) * 100);
  return (
    <div className="bar-row">
      <div className="bar-label">{label}</div>
      <div className="bar-track">
        <div className={`bar-fill ${tone}`} style={{ width: `${w}%` }} />
      </div>
      <div className="bar-value">{fmt(value)}</div>
    </div>
  );
}
