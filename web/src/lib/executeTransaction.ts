import type { ContractTransaction } from "ethers";

export type TxStatus = "idle" | "pending" | "success" | "error";

export interface TxState {
  status: TxStatus;
  hash?: string;
  error?: string;
}

type SetState = (state: TxState) => void;

export async function executeTransaction(
  fn: () => Promise<ContractTransaction>,
  setState: SetState,
  onSuccess?: () => void
): Promise<void> {
  setState({ status: "pending" });
  try {
    const tx = await fn();
    setState({ status: "pending", hash: tx.hash });
    await tx.wait();
    setState({ status: "success", hash: tx.hash });
    onSuccess?.();
    setTimeout(() => setState({ status: "idle" }), 4000);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Transaction failed";
    const short = message.includes("user rejected")
      ? "Transaction rejected"
      : message.split("(")[0].trim();
    setState({ status: "error", error: short });
    setTimeout(() => setState({ status: "idle" }), 5000);
  }
}
