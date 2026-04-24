import { buildModule } from "@nomicfoundation/hardhat-ignition/modules"

const StakingModule = buildModule("StakingModule", (m) => {
  const token = m.contract("CS218Token");
  const staking = m.contract("StakingContract", [token]);

  m.call(token, "setMinter", [staking]);

  return { token, staking };
})

export default StakingModule;
