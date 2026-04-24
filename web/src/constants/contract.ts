export const SEPOLIA_CHAIN_ID = 11155111;

export const ADDRESSES = {
  token: "0x8928046eF425eaA377299C4Bdc5bA2fE6F19C6A6",
  staking: "0xA31e4c31A3d3cC2e3935fbD059e673Ca3141fA8e",
};

export const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function mint(address, uint256)",
  "function setMinter(address)",
  "function minter() view returns (address)",
  "function owner() view returns (address)",
];

export const STAKING_ABI = [
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claimRewards()",
  "function getPendingRewards(address user) view returns (uint256)",
  "function getStakedBalance(address user) view returns (uint256)",
  "function setRewardRate(uint256 _rewardRate)",
  "function rewardRate() view returns (uint256)",
  "function owner() view returns (address)",
];
