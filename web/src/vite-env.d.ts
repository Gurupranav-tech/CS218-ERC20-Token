/// <reference types="vite/client" />

import type { Eip1193Provider } from "ethers";

interface EthereumProvider extends Eip1193Provider {
  on?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: any[]) => void
  ) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
