import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("Project 9: ERC-20 Token with Staking Rewards - Updated Suite", function() {

  // Fixture for a clean state in every test
  async function deployStakingFixture() {
    const [owner, user1, user2, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("CS218Token");
    const token = await Token.deploy();
    const tokenAddress = await token.getAddress();

    const Staking = await ethers.getContractFactory("StakingContract");
    const staking = await Staking.deploy(tokenAddress);
    const stakingAddress = await staking.getAddress();

    // Assign minter role to the staking contract
    await token.setMinter(stakingAddress);

    const decimals = await token.decimals();
    const initialFund = ethers.parseUnits("100000", decimals);

    // Give users starting balances
    await token.transfer(user1.address, initialFund);
    await token.transfer(user2.address, initialFund);
    await token.transfer(attacker.address, initialFund);

    // Users approve the staking contract
    await token.connect(user1).approve(stakingAddress, ethers.MaxUint256);
    await token.connect(user2).approve(stakingAddress, ethers.MaxUint256);
    await token.connect(attacker).approve(stakingAddress, ethers.MaxUint256);

    return { token, staking, owner, user1, user2, attacker, stakingAddress, decimals };
  }

  describe("1. Deployment & Setup", function() {
    it("1. Should set the correct token address in staking contract", async function() {
      const { token, staking } = await loadFixture(deployStakingFixture);
      expect(await staking.token()).to.equal(await token.getAddress());
    });

    it("2. Should have the correct initial reward rate (100)", async function() {
      const { staking } = await loadFixture(deployStakingFixture);
      expect(await staking.rewardRate()).to.equal(100n);
    });

    it("3. Should correctly set the Staking contract as the token Minter", async function() {
      const { token, stakingAddress } = await loadFixture(deployStakingFixture);
      expect(await token.minter()).to.equal(stakingAddress);
    });
  });

  describe("2. Core Staking Logic", function() {
    // [MAIN TEST CASE]: Requirement - Staking transfers tokens
    it("4. [MAIN TEST CASE] Should correctly transfer tokens from user to contract on stake", async function() {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);

      const tx = await staking.connect(user1).stake(stakeAmount);
      await expect(tx).to.changeTokenBalances(
        token,
        [user1.address, stakingAddress],
        [-stakeAmount, stakeAmount]
      );
    });

    it("5. Should update the user's staked balance accurately", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);
      await staking.connect(user1).stake(stakeAmount);
      expect(await staking.getStakedBalance(user1.address)).to.equal(stakeAmount);
    });

    it("6. Should emit a Staked event with correct parameters", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("500", 18);
      await expect(staking.connect(user1).stake(stakeAmount))
        .to.emit(staking, "Staked")
        .withArgs(user1.address, stakeAmount);
    });

    it("7. Should revert when user tries to stake 0 tokens", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).stake(0)).to.be.revertedWith("Cannot stake zero tokens");
    });

    it("8. Should properly aggregate balance if user stakes multiple times", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      const amount = ethers.parseUnits("100", 18);
      await staking.connect(user1).stake(amount);
      await staking.connect(user1).stake(amount);
      expect(await staking.getStakedBalance(user1.address)).to.equal(ethers.parseUnits("200", 18));
    });
  });

  describe("3. Time Travel & Reward Calculation", function() {
    // [MAIN TEST CASE]: Requirement - Linear accrual (1 day vs 2 days)
    it("9. [MAIN TEST CASE] Should accrue rewards linearly (Day 2 equals 2x Day 1)", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);
      await staking.connect(user1).stake(stakeAmount);

      await time.increase(24 * 3600); // 1 day
      const day1Rewards = await staking.getPendingRewards(user1.address);

      await time.increase(24 * 3600); // +1 day (Total 2)
      const day2Rewards = await staking.getPendingRewards(user1.address);

      expect(day2Rewards).to.equal(day1Rewards * 2n);
    });

    // [MAIN TEST CASE]: Requirement - Proportional rewards
    it("10. [MAIN TEST CASE] Should accrue 2x rewards for a user staking 2x the tokens", async function() {
      const { staking, user1, user2 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(ethers.parseUnits("1000", 18));
      await staking.connect(user2).stake(ethers.parseUnits("2000", 18));

      await time.increase(24 * 3600); // 1 day

      const user1Rewards = await staking.getPendingRewards(user1.address);
      const user2Rewards = await staking.getPendingRewards(user2.address);

      expect(user2Rewards).to.equal(user1Rewards * 2n);
    });
  });

  describe("4. Claiming Rewards", function() {
    // [MAIN TEST CASE]: Requirement - claimRewards mints rewards correctly
    it("11. [MAIN TEST CASE] Should mint correct reward amount to user upon claim", async function() {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(ethers.parseUnits("1000", 18));
      await time.increase(24 * 3600); // 1 day

      const pending = await staking.getPendingRewards(user1.address);
      const userBalanceBefore = await token.balanceOf(user1.address);

      await staking.connect(user1).claimRewards();

      const userBalanceAfter = await token.balanceOf(user1.address);
      expect(userBalanceAfter - userBalanceBefore).to.equal(pending);
    });

    // [MAIN TEST CASE]: Requirement - claimRewards resets accrual timer
    it("12. [MAIN TEST CASE] Should reset accrual timer and revert on immediate secondary claim", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(ethers.parseUnits("1000", 18));
      await time.increase(24 * 3600);

      await staking.connect(user1).claimRewards(); // First claim

      // Timer is reset, so pending is 0.
      await expect(staking.connect(user1).claimRewards()).to.be.revertedWith("No rewards to claim");
    });
  });

  describe("5. Unstaking Logic (Partial & Full)", function() {
    // [MAIN TEST CASE]: Requirement - unstaking returns principal correctly
    it("13. [MAIN TEST CASE] Should return exact principal amount back to user on FULL unstake", async function() {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);
      await staking.connect(user1).stake(stakeAmount);

      const tx = await staking.connect(user1).unstake(stakeAmount); // Unstake all

      await expect(tx).to.changeTokenBalances(
        token,
        [stakingAddress],
        [-stakeAmount]
      );
      expect(await staking.getStakedBalance(user1.address)).to.equal(0n);
    });

    // [MAIN TEST CASE]: Requirement - Partial Unstaking Accrual
    it("14. [MAIN TEST CASE] Partial unstaking should leave remainder accruing rewards", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);
      await staking.connect(user1).stake(stakeAmount);

      await time.increase(24 * 3600); // 1 day passes for 1000 tokens
      const day1RewardsOnFull = await staking.getPendingRewards(user1.address);

      // Unstake HALF
      const halfAmount = ethers.parseUnits("500", 18);
      await staking.connect(user1).unstake(halfAmount);

      // 500 remains. Advance another day
      await time.increase(24 * 3600);
      const day2RewardsOnHalf = await staking.getPendingRewards(user1.address);

      // Rewards on 500 should be half of rewards on 1000 for the same period
      expect(day2RewardsOnHalf).to.equal(day1RewardsOnFull / 2n);
    });

    it("15. Should also mint and send pending rewards during an unstake", async function() {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);
      await staking.connect(user1).stake(stakeAmount);
      await time.increase(24 * 3600);

      const pending = await staking.getPendingRewards(user1.address);
      const userBalBefore = await token.balanceOf(user1.address);

      await staking.connect(user1).unstake(stakeAmount);

      const userBalAfter = await token.balanceOf(user1.address);
      expect(userBalAfter - userBalBefore).to.equal(stakeAmount + pending);
    });

    it("16. Should emit Unstaked event on partial or full unstake", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);
      await staking.connect(user1).stake(stakeAmount);

      await expect(staking.connect(user1).unstake(stakeAmount))
        .to.emit(staking, "Unstaked")
        .withArgs(user1.address, stakeAmount);
    });

    it("17. Should revert if attempting to unstake more than the staked balance", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(ethers.parseUnits("100", 18));

      await expect(
        staking.connect(user1).unstake(ethers.parseUnits("200", 18))
      ).to.be.revertedWith("Amount exceeds staked balance");
    });
  });

  describe("6. Security & Attack Vectors", function() {

    // [MAIN TEST CASE]: Attack Vector - Access Control (Unauthorized Minting)
    it("18. [MAIN TEST CASE - ATTACK] Prevent direct unauthorized minting (Access Control Protection)", async function() {
      const { token, attacker } = await loadFixture(deployStakingFixture);
      // Attacker tries to call the token contract directly to print money
      await expect(token.connect(attacker).mint(attacker.address, 50000))
        .to.be.revertedWith("Not authorized to mint");
    });

    // [MAIN TEST CASE]: Attack Vector - Access Control (State Manipulation)
    it("19. [MAIN TEST CASE - ATTACK] Prevent non-owner from changing the reward rate", async function() {
      const { staking, attacker } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(attacker).setRewardRate(999))
        .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount")
        .withArgs(attacker.address);
    });

    // [MAIN TEST CASE]: Attack Vector - Flash-staking
    it("20. [MAIN TEST CASE - ATTACK] Prevent Flash-staking (staking and unstaking in same block yields 0 reward)", async function() {
      const { token, staking, attacker } = await loadFixture(deployStakingFixture);
      const attackAmount = ethers.parseUnits("50000", 18);
      await staking.connect(attacker).stake(attackAmount);

      // Immediately unstaking without `time.increase` simulates a flash loan execution
      const balBefore = await token.balanceOf(attacker.address);
      await staking.connect(attacker).unstake(attackAmount);
      const balAfter = await token.balanceOf(attacker.address);

      // Attacker gains NO rewards
      expect(balAfter - balBefore).to.equal(attackAmount);
      expect(await staking.getPendingRewards(attacker.address)).to.equal(0n);
    });

    // [MAIN TEST CASE]: Attack Vector - Reentrancy / State Consistency
    it("21. [MAIN TEST CASE - ATTACK] Unstake state update occurs BEFORE external call to prevent Reentrancy", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);
      await staking.connect(user1).stake(stakeAmount);

      await staking.connect(user1).unstake(stakeAmount);

      const finalStakeInfo = await staking.stakes(user1.address);
      // Verification of Checks-Effects-Interactions pattern: balance is 0
      expect(finalStakeInfo.amount).to.equal(0n);
    });

    it("22. Owner successfully changing reward rate alters future calculations for users", async function() {
      const { staking, owner, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(ethers.parseUnits("1000", 18));

      // Change rate from 100 to 200
      await staking.connect(owner).setRewardRate(200n);
      await time.increase(24 * 3600); // 1 day passes

      const pending = await staking.getPendingRewards(user1.address);
      const expected = (ethers.parseUnits("1000", 18) * 200n * 1n) / 1000n;
      expect(pending).to.equal(expected);
    });

    it("23. Staking additionally auto-claims old rewards before adding new principal", async function() {
      const { token, staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(ethers.parseUnits("1000", 18));

      await time.increase(24 * 3600); // 1 day passes
      const pending = await staking.getPendingRewards(user1.address);
      const balanceBefore = await token.balanceOf(user1.address);

      // User stakes MORE tokens (should trigger auto-claim of Day 1 rewards)
      await staking.connect(user1).stake(ethers.parseUnits("500", 18));

      const balanceAfter = await token.balanceOf(user1.address);
      // Net token change should be +pending - 500
      expect(balanceAfter - balanceBefore).to.equal(pending - ethers.parseUnits("500", 18));
    });

    it("24. User cannot claim if they have 0 staked balance (Nothing staked)", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user1).claimRewards()).to.be.revertedWith("Nothing staked");
    });

    it("25. Malicious user cannot trick contract by trying to unstake 0", async function() {
      const { staking, attacker } = await loadFixture(deployStakingFixture);
      // Generic transaction revert without specific require msg, or underflow
      await expect(staking.connect(attacker).unstake(0)).to.be.reverted;
    });

    it("26. State is pristine after a user stakes, waits, claims, waits, and fully unstakes", async function() {
      const { token, staking, user1, stakingAddress } = await loadFixture(deployStakingFixture);
      const stakeAmount = ethers.parseUnits("1000", 18);
      await staking.connect(user1).stake(stakeAmount);

      await time.increase(24 * 3600);
      await staking.connect(user1).claimRewards(); // First interval

      await time.increase(24 * 3600);
      await staking.connect(user1).unstake(stakeAmount); // Second interval & exit

      // Final asserts
      expect(await staking.getStakedBalance(user1.address)).to.equal(0n);
      expect(await staking.getPendingRewards(user1.address)).to.equal(0n);
      // Contract should hold 0 user funds
      expect(await token.balanceOf(stakingAddress)).to.equal(0n);
    });

    it("27. Reward calculation bounds handles minimal passage of time (1 second)", async function() {
      const { staking, user1 } = await loadFixture(deployStakingFixture);
      await staking.connect(user1).stake(ethers.parseUnits("1000", 18));
      await time.increase(1); // Exactly 1 second
      // Because `elapsed` in `_calculateRewards` drops fractions of a day
      // 1 second / 1 days = 0.
      expect(await staking.getPendingRewards(user1.address)).to.equal(0n);
    });
  });
});
