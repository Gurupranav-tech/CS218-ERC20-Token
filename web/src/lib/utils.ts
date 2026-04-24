import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { ethers } from "ethers";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTokenAmount(wei: bigint, decimals = 18): string {
  const formatted = ethers.formatUnits(wei, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return "0.00";
  if (num < 0.01) return "< 0.01";
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text);
}
