// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CS218Token is ERC20, Ownable {
    address public minter;

    constructor() ERC20("CS218Token", "C218") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    function setMinter(address _minter) external onlyOwner {
        minter = _minter;
    }

    function mint(address to, uint256 amount) external {
        require(
            msg.sender == minter || msg.sender == owner(),
            "Not authorized to mint"
        );
        _mint(to, amount);
    }
}
