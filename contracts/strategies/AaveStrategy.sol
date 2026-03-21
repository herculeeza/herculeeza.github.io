// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../IYieldStrategy.sol";

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * @title AaveStrategy
 * @notice Deposits ETH into Aave V3 to earn yield
 * @dev Wraps/unwraps ETH to WETH for Aave compatibility
 */
contract AaveStrategy is IYieldStrategy {

    // ============ Custom Errors ============

    error OnlyVault();
    error ZeroAmount();
    error ZeroAddress();
    error OnlyVaultRecipient();
    error ETHTransferFailed();

    // ============ State Variables ============

    IPool public immutable aavePool;
    IERC20 public immutable aWETH;
    IWETH public immutable weth;
    address public immutable vault;

    // ============ Constructor ============

    constructor(
        address _aavePoolAddressesProvider,
        address _weth,
        address _aWETH,
        address _vault
    ) {
        if (_aavePoolAddressesProvider == address(0) || _weth == address(0) || _aWETH == address(0) || _vault == address(0)) revert ZeroAddress();
        IPoolAddressesProvider provider = IPoolAddressesProvider(_aavePoolAddressesProvider);
        aavePool = IPool(provider.getPool());
        weth = IWETH(_weth);
        aWETH = IERC20(_aWETH);
        vault = _vault;
    }

    // ============ Modifiers ============

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    // ============ IYieldStrategy Implementation ============

    function deposit() external payable onlyVault returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();
        
        // Wrap ETH to WETH
        weth.deposit{value: msg.value}();
        
        // Approve Aave pool
        weth.approve(address(aavePool), msg.value);
        
        // Supply to Aave (receives aWETH in return)
        aavePool.supply(address(weth), msg.value, address(this), 0);
        
        return msg.value; // Return shares (1:1 initially)
    }
    
    function withdraw(uint256 amount) external onlyVault returns (uint256) {
        if (amount == 0) revert ZeroAmount();

        uint256 withdrawn = aavePool.withdraw(address(weth), amount, address(this));
        weth.withdraw(withdrawn);

        (bool success, ) = payable(vault).call{value: withdrawn}("");
        if (!success) revert ETHTransferFailed();

        return withdrawn;
    }

    function balanceOf(address) external view returns (uint256) {
        return aWETH.balanceOf(address(this));
    }

    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function emergencyWithdraw(address recipient) external onlyVault returns (uint256) {
        if (recipient != vault) revert OnlyVaultRecipient();

        uint256 balance = aWETH.balanceOf(address(this));
        if (balance == 0) return 0;

        uint256 withdrawn = aavePool.withdraw(address(weth), balance, address(this));
        weth.withdraw(withdrawn);

        (bool success, ) = payable(recipient).call{value: withdrawn}("");
        if (!success) revert ETHTransferFailed();

        return withdrawn;
    }
    
    // ============ Receive Function ============
    
    receive() external payable {}
}