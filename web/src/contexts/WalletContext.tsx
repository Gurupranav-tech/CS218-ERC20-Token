import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import { ethers, BrowserProvider, JsonRpcSigner, Contract } from "ethers";
import { ADDRESSES, TOKEN_ABI, STAKING_ABI, SEPOLIA_CHAIN_ID } from "../constants/contract";

interface WalletState {
  address: string | null;
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  tokenContract: Contract | null;
  stakingContract: Contract | null;
  isConnecting: boolean;
  error: string | null;
  chainId: number | null;
}

type WalletAction =
  | { type: "CONNECT_START" }
  | {
    type: "CONNECT_SUCCESS";
    payload: {
      address: string;
      provider: BrowserProvider;
      signer: JsonRpcSigner;
      tokenContract: Contract;
      stakingContract: Contract;
      chainId: number;
    };
  }
  | { type: "CONNECT_ERROR"; payload: string }
  | { type: "DISCONNECT" };

const initialState: WalletState = {
  address: null,
  provider: null,
  signer: null,
  tokenContract: null,
  stakingContract: null,
  isConnecting: false,
  error: null,
  chainId: null,
};

function reducer(state: WalletState, action: WalletAction): WalletState {
  switch (action.type) {
    case "CONNECT_START":
      return { ...state, isConnecting: true, error: null };
    case "CONNECT_SUCCESS":
      return { ...state, isConnecting: false, ...action.payload };
    case "CONNECT_ERROR":
      return { ...state, isConnecting: false, error: action.payload };
    case "DISCONNECT":
      return initialState;
    default:
      return state;
  }
}

interface WalletContextType extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

async function switchToSepolia(): Promise<void> {
  await window.ethereum!.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0xaa36a7" }], // 11155111 in hex
  });
}

async function addSepolia(): Promise<void> {
  await window.ethereum!.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: "0xaa36a7",
        chainName: "Sepolia Testnet",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://rpc.sepolia.org"],
        blockExplorerUrls: ["https://sepolia.etherscan.io"],
      },
    ],
  });
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      dispatch({ type: "CONNECT_ERROR", payload: "MetaMask not installed" });
      return;
    }
    dispatch({ type: "CONNECT_START" });
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

      // Check and switch network
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
        try {
          await switchToSepolia();
        } catch (switchErr: unknown) {
          // Chain not added to MetaMask yet — add it then switch
          if ((switchErr as { code?: number }).code === 4902) {
            await addSepolia();
            await switchToSepolia();
          } else {
            throw new Error("Please switch MetaMask to the Sepolia testnet");
          }
        }
      }

      // Re-instantiate provider after network switch
      const finalProvider = new ethers.BrowserProvider(window.ethereum);
      const signer = await finalProvider.getSigner();
      const address = await signer.getAddress();
      const finalNetwork = await finalProvider.getNetwork();

      const tokenContract = new ethers.Contract(ADDRESSES.token, TOKEN_ABI, signer);
      const stakingContract = new ethers.Contract(ADDRESSES.staking, STAKING_ABI, signer);

      dispatch({
        type: "CONNECT_SUCCESS",
        payload: {
          address,
          provider: finalProvider,
          signer,
          tokenContract,
          stakingContract,
          chainId: Number(finalNetwork.chainId),
        },
      });
    } catch (err) {
      dispatch({
        type: "CONNECT_ERROR",
        payload: err instanceof Error ? err.message : "Failed to connect",
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    dispatch({ type: "DISCONNECT" });
  }, []);

  // Re-connect on account or chain change
  React.useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountChange = () => {
      if (state.address) connect();
    };

    const handleChainChange = () => {
      window.location.reload();
    };

    window.ethereum.on?.("accountsChanged", handleAccountChange);
    window.ethereum.on?.("chainChanged", handleChainChange);

    return () => {
      window.ethereum!.removeListener?.("accountsChanged", handleAccountChange);
      window.ethereum!.removeListener?.("chainChanged", handleChainChange);
    };
  }, [state.address, connect]);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
