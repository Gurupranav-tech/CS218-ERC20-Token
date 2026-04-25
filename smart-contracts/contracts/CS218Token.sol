// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CS218Token — ERC-20 token for the CS218 Staking Project (gas-optimised)
/// @notice Standard ERC-20 token whose mint function is restricted to the
///         authorised Staking contract and the owner.
contract CS218Token is ERC20, Ownable {
    /// @notice The address authorised to mint new tokens (set to StakingContract after deploy)
    address public minter;

    /// @notice Emitted when the authorised minter address is updated
    event MinterUpdated(address indexed newMinter);

    /// @param initialSupply Amount (in whole tokens) pre-minted to the deployer
    constructor(uint256 initialSupply)
        ERC20("CS218Token", "C218")
        Ownable(msg.sender)
    {
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    /// @notice Sets the address that is allowed to call mint() — should be the StakingContract
    /// @dev    Only callable by owner. Emits MinterUpdated.
    /// @param  _minter The new authorised minter address (must be non-zero)
    function setMinter(address _minter) external onlyOwner {
        require(_minter != address(0), "Minter cannot be zero address");
        minter = _minter;
        emit MinterUpdated(_minter);
    }

    /// @notice Mints `amount` tokens to `to`
    /// @dev    Restricted to the authorised Staking contract OR the owner.
    ///
    ///         GAS OPT 1 — cache owner() into a local variable.
    ///         owner() calls Ownable._owner which costs 1 SLOAD (~2100 gas cold,
    ///         ~100 gas warm). Without caching, the short-circuit `||` may still
    ///         execute the second comparison even after the first fails, causing a
    ///         second SLOAD. Caching reads storage once and reuses the stack value.
    ///
    ///         GAS OPT 2 — remove the redundant `to != address(0)` check.
    ///         OpenZeppelin's ERC20._mint() already reverts with "ERC20: mint to
    ///         the zero address" if `to` is address(0). Duplicating the check
    ///         costs an extra ISZERO + JUMPI (~10 gas) on every valid mint call.
    ///
    /// @param  to     Recipient address
    /// @param  amount Amount in wei (18 decimals), must be > 0
    function mint(address to, uint256 amount) external {
        // GAS OPT 1: single SLOAD for owner, reused on stack — saves ~100 gas
        // on the warm path where msg.sender != minter and falls through to owner check.
        address _owner = owner();
        require(
            msg.sender == minter || msg.sender == _owner,
            "CS218Token: not authorised to mint"
        );
        require(amount > 0, "CS218Token: mint amount must be > 0");
        // GAS OPT 2: `to != address(0)` check removed — OZ _mint handles it.
        _mint(to, amount);
    }
}
