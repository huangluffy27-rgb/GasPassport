import { useCallback, useEffect, useRef, useState } from "react";
import { MONAD_CHAIN } from "./data";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

export type TxState = "idle" | "pending" | "success" | "error";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorAt, setErrorAt] = useState(0);
  const ethRef = useRef<Eip1193 | null>(null);

  const eth = () => {
    const e = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!e) throw new Error("没有检测到钱包，请安装 MetaMask 或兼容钱包");
    ethRef.current = e;
    return e;
  };

  const refresh = useCallback(async () => {
    const e = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!e) return;
    const accounts = (await e.request({ method: "eth_accounts" })) as string[];
    setAddress(accounts[0] ?? null);
    setChainId((await e.request({ method: "eth_chainId" })) as string);
  }, []);

  useEffect(() => {
    void refresh();
    const e = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!e?.on) return;
    const onAccounts = (accounts: string[]) => setAddress(accounts[0] ?? null);
    const onChain = (id: string) => setChainId(id);
    e.on("accountsChanged", onAccounts);
    e.on("chainChanged", onChain);
    return () => {
      e.removeListener?.("accountsChanged", onAccounts);
      e.removeListener?.("chainChanged", onChain);
    };
  }, [refresh]);

  const ensureChain = useCallback(async () => {
    const e = eth();
    const id = (await e.request({ method: "eth_chainId" })) as string;
    if (id === MONAD_CHAIN.chainId) return;
    try {
      await e.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MONAD_CHAIN.chainId }] });
    } catch {
      await e.request({ method: "wallet_addEthereumChain", params: [MONAD_CHAIN] });
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const e = eth();
      const accounts = (await e.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts[0] ?? null);
      await ensureChain();
      setChainId((await e.request({ method: "eth_chainId" })) as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorAt(Date.now());
    } finally {
      setBusy(false);
    }
  }, [ensureChain]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setError(null);
  }, []);

  const sendTransaction = useCallback(
    async (tx: { to?: string; data: string; gas: number }) => {
      const e = eth();
      await ensureChain();
      const hash = (await e.request({
        method: "eth_sendTransaction",
        params: [{ from: address, ...tx, gas: `0x${tx.gas.toString(16)}` }],
      })) as string;
      for (let i = 0; i < 120; i++) {
        const receipt = (await e.request({ method: "eth_getTransactionReceipt", params: [hash] })) as
          | { status: string; gasUsed: string; contractAddress?: string }
          | null;
        if (receipt) {
          return {
            hash,
            status: receipt.status,
            gasUsed: Number(BigInt(receipt.gasUsed)),
            contractAddress: receipt.contractAddress,
          };
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      throw new Error("交易等待超时，请到浏览器查看");
    },
    [address, ensureChain],
  );

  return { address, chainId, busy, error, errorAt, connect, disconnect, sendTransaction, wrongChain: !!address && chainId !== MONAD_CHAIN.chainId };
}
