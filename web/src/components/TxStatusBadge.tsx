import type { TxState } from "../lib/executeTransaction";

export default function TxStatusBadge({ state }: { state: TxState }) {
  if (state.status === "idle") return null;

  return (
    <div className="fade-in mt-3 text-xs mono">
      {state.status === "pending" && (
        <span className="text-[#6b6b6b]">
          ⟳ Broadcasting{state.hash ? ` · ${state.hash.slice(0, 16)}...` : "..."}
        </span>
      )}
      {state.status === "success" && (
        <span className="text-[#22c55e]">
          ✓ Confirmed{state.hash ? ` · ${state.hash.slice(0, 16)}...` : ""}
        </span>
      )}
      {state.status === "error" && (
        <span className="text-[#ef4444]">✕ {state.error}</span>
      )}
    </div>
  );
}
