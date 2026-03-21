// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./IYieldStrategy.sol";
import "./ITaxVault.sol";

interface IHarburger {
    function settleTaxes(address account) external;
}

/// @title TaxVault
/// @notice Manages deposits for Harberger tax payments with multi-strategy yield allocation
/// @dev Users split funds across approved yield strategies or keep an idle (non-yielding) balance.
///      The Harburger contract calls `payTax` to automatically drain funds for tax payments.
contract TaxVault is ITaxVault, ReentrancyGuard, Pausable {

    // ============ Custom Errors ============

    error ZeroAmount();
    error ZeroAddress();
    error StrategyNotApproved();
    error StrategyAlreadyApproved();
    error CannotRemoveIdle();
    error MaxStrategiesReached();
    error SameStrategy();
    error InsufficientBalance();
    error StrategyShortfall();
    error NoDeposits();
    error OnlyManager();
    error OnlyHarburger();
    error ETHTransferFailed();
    error StrategyNotDrained();
    error DepositsRemaining();
    error UnauthorizedETHSender();
    error TooManyRemovedStrategies();

    // ============ Constants ============

    address public constant IDLE_STRATEGY = address(0);
    uint256 public constant MAX_STRATEGIES = 10;
    uint256 public constant MAX_REMOVED_STRATEGIES = 20;
    uint256 private constant RECOVERY_PRECISION = 1e18;

    // ============ State Variables ============

    address public immutable harburger;
    address public manager;

    address[] public approvedStrategies;
    mapping(address => bool) public isApprovedStrategy;

    address[] public removedStrategies;

    /// @notice user => strategy => deposit amount (Wei)
    mapping(address => mapping(address => uint256)) public userDeposits;

    /// @notice strategy => total deposits from all users (Wei)
    mapping(address => uint256) public totalDepositsPerStrategy;

    /// @notice Tracks all strategies ever registered (for receive() validation)
    mapping(address => bool) private _isKnownStrategy;

    /// @notice Recovery rate for emergency-drained strategies.
    ///         0 = not drained. Non-zero = (recovered * 1e18) / totalDeposits at drain time.
    ///         Users get: userDeposits[user][strategy] * _recoveryRate[strategy] / 1e18
    mapping(address => uint256) public recoveryRate;

    // ============ Events ============

    event Deposited(address indexed user, address indexed strategy, uint256 amount);
    event Withdrawn(address indexed user, address indexed strategy, uint256 amount);
    event StrategyAdded(address indexed strategy);
    event StrategyRemoved(address indexed strategy);
    event FundsMoved(address indexed user, address indexed from, address indexed to, uint256 amount);
    event TaxPaymentProcessed(address indexed user, uint256 amount);
    event EmergencyWithdrawal(address indexed strategy, uint256 amount);
    event YieldHarvested(address indexed user, address indexed strategy, uint256 yieldAmount);
    event ManagerUpdated(address indexed oldManager, address indexed newManager);
    event DepositMigrated(address indexed user, address indexed strategy, uint256 amount);

    // ============ Modifiers ============

    modifier onlyManager() {
        if (msg.sender != manager) revert OnlyManager();
        _;
    }

    modifier onlyHarburger() {
        if (msg.sender != harburger) revert OnlyHarburger();
        _;
    }

    // ============ Constructor ============

    constructor(address _harburger, address _manager) {
        harburger = _harburger;
        manager = _manager;
        isApprovedStrategy[IDLE_STRATEGY] = true;
    }

    // ============ Core User Functions ============

    /// @notice Deposit ETH into a chosen strategy (or IDLE_STRATEGY for no yield)
    function deposit(address strategy) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();
        if (!isApprovedStrategy[strategy]) revert StrategyNotApproved();

        userDeposits[msg.sender][strategy] += msg.value;
        totalDepositsPerStrategy[strategy] += msg.value;

        if (strategy != IDLE_STRATEGY) {
            IYieldStrategy(strategy).deposit{value: msg.value}();
        }

        emit Deposited(msg.sender, strategy, msg.value);
    }

    /// @notice Withdraw from a specific strategy
    function withdraw(address strategy, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        // Settle pending taxes before any funds leave the vault
        _settleTaxes(msg.sender);

        uint256 balance = getBalanceInStrategy(msg.sender, strategy);
        if (balance < amount) revert InsufficientBalance();

        _updateWithdrawAccounting(msg.sender, strategy, amount);

        if (strategy == IDLE_STRATEGY || _isDrained(strategy)) {
            // For idle or drained strategies, ETH is already in this contract
            if (_isDrained(strategy)) {
                // Reduce idle total since the recovered ETH sits as idle balance
                totalDepositsPerStrategy[IDLE_STRATEGY] = _safeSub(totalDepositsPerStrategy[IDLE_STRATEGY], amount);
            }
        } else {
            uint256 withdrawn = IYieldStrategy(strategy).withdraw(amount);
            if (withdrawn < amount) revert StrategyShortfall();
        }

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert ETHTransferFailed();

        emit Withdrawn(msg.sender, strategy, amount);
    }

    /// @notice Move funds between strategies without withdrawing to wallet
    function moveStrategy(address from, address to, uint256 amount) external nonReentrant whenNotPaused {
        if (from == to) revert SameStrategy();
        if (!isApprovedStrategy[to]) revert StrategyNotApproved();
        if (amount == 0) revert ZeroAmount();

        uint256 balance = getBalanceInStrategy(msg.sender, from);
        if (balance < amount) revert InsufficientBalance();

        _updateWithdrawAccounting(msg.sender, from, amount);

        if (from == IDLE_STRATEGY || _isDrained(from)) {
            if (_isDrained(from)) {
                totalDepositsPerStrategy[IDLE_STRATEGY] = _safeSub(totalDepositsPerStrategy[IDLE_STRATEGY], amount);
            }
        } else {
            uint256 withdrawn = IYieldStrategy(from).withdraw(amount);
            if (withdrawn < amount) revert StrategyShortfall();
        }

        userDeposits[msg.sender][to] += amount;
        totalDepositsPerStrategy[to] += amount;

        if (to != IDLE_STRATEGY) {
            IYieldStrategy(to).deposit{value: amount}();
        }

        emit FundsMoved(msg.sender, from, to, amount);
    }

    /// @notice Migrate deposits from a drained strategy into idle.
    ///         Users call this after emergencyWithdrawFromStrategy to reclaim their
    ///         proportional share at the idle level.
    function migrateFromDrainedStrategy(address strategy) external nonReentrant whenNotPaused {
        if (!_isDrained(strategy)) revert StrategyNotDrained();

        uint256 deposited = userDeposits[msg.sender][strategy];
        if (deposited == 0) revert NoDeposits();

        uint256 recovered = (deposited * recoveryRate[strategy]) / RECOVERY_PRECISION;
        userDeposits[msg.sender][strategy] = 0;
        userDeposits[msg.sender][IDLE_STRATEGY] += recovered;
        // totalDepositsPerStrategy[IDLE_STRATEGY] already includes this from the drain;
        // individual idle tracking is now correct.

        emit DepositMigrated(msg.sender, strategy, recovered);
    }

    // ============ Tax Payment (called by Harburger) ============

    /// @inheritdoc ITaxVault
    function payTax(address user, uint256 amount)
        external
        onlyHarburger
        returns (uint256)
    {
        // Compute drainable balance (idle + approved + removed strategies).
        uint256 drainable = userDeposits[user][IDLE_STRATEGY];
        for (uint256 i = 0; i < approvedStrategies.length; i++) {
            drainable += getBalanceInStrategy(user, approvedStrategies[i]);
        }
        for (uint256 i = 0; i < removedStrategies.length; i++) {
            drainable += getBalanceInStrategy(user, removedStrategies[i]);
        }

        if (drainable < amount) {
            // Partial payment: drain what we can
            if (drainable == 0) return 0;
            amount = drainable;
        }

        uint256 remaining = amount;

        // Drain idle first (cheapest — no external call)
        uint256 idle = userDeposits[user][IDLE_STRATEGY];
        if (idle > 0 && remaining > 0) {
            uint256 take = idle < remaining ? idle : remaining;
            userDeposits[user][IDLE_STRATEGY] -= take;
            totalDepositsPerStrategy[IDLE_STRATEGY] -= take;
            remaining -= take;
        }

        // Drain approved yield strategies
        if (remaining > 0) {
            remaining = _drainStrategies(user, remaining, approvedStrategies);
        }

        // Drain removed yield strategies if still needed
        if (remaining > 0) {
            remaining = _drainStrategies(user, remaining, removedStrategies);
        }

        uint256 paid = amount - remaining;
        if (paid == 0) return 0;

        (bool ok, ) = payable(harburger).call{value: paid}("");
        if (!ok) revert ETHTransferFailed();

        emit TaxPaymentProcessed(user, paid);
        return paid;
    }

    // ============ Manager Functions ============

    function addStrategy(address strategy) external onlyManager {
        if (strategy == address(0)) revert ZeroAddress();
        if (isApprovedStrategy[strategy]) revert StrategyAlreadyApproved();
        if (approvedStrategies.length >= MAX_STRATEGIES) revert MaxStrategiesReached();

        isApprovedStrategy[strategy] = true;
        _isKnownStrategy[strategy] = true;
        approvedStrategies.push(strategy);

        // Clean from removed list if re-adding (prevents double-counting)
        _removeFromArray(removedStrategies, strategy);

        // Clear stale recovery rate if this strategy was previously drained
        if (recoveryRate[strategy] > 0) {
            delete recoveryRate[strategy];
        }

        emit StrategyAdded(strategy);
    }

    function removeStrategy(address strategy) external onlyManager {
        if (!isApprovedStrategy[strategy]) revert StrategyNotApproved();
        if (strategy == IDLE_STRATEGY) revert CannotRemoveIdle();
        if (removedStrategies.length >= MAX_REMOVED_STRATEGIES) revert TooManyRemovedStrategies();

        isApprovedStrategy[strategy] = false;
        _removeFromArray(approvedStrategies, strategy);
        removedStrategies.push(strategy);

        emit StrategyRemoved(strategy);
    }

    /// @notice Manager can clean up a removed strategy once all users have migrated
    function cleanRemovedStrategy(address strategy) external onlyManager {
        // Only allow cleanup if no deposits remain
        if (totalDepositsPerStrategy[strategy] > 0) revert DepositsRemaining();
        _removeFromArray(removedStrategies, strategy);
    }

    function emergencyWithdrawFromStrategy(address strategy) external onlyManager nonReentrant {
        if (strategy == IDLE_STRATEGY) revert CannotRemoveIdle();
        uint256 deposits = totalDepositsPerStrategy[strategy];
        if (deposits == 0) revert NoDeposits();

        uint256 recovered = IYieldStrategy(strategy).emergencyWithdraw(address(this));

        // Store recovery rate so users can claim their proportional share
        recoveryRate[strategy] = (recovered * RECOVERY_PRECISION) / deposits;

        // Zero out strategy total — all funds are now idle ETH
        totalDepositsPerStrategy[strategy] = 0;
        totalDepositsPerStrategy[IDLE_STRATEGY] += recovered;

        emit EmergencyWithdrawal(strategy, recovered);
    }

    function updateManager(address newManager) external onlyManager {
        if (newManager == address(0)) revert ZeroAddress();
        address old = manager;
        manager = newManager;
        emit ManagerUpdated(old, newManager);
    }

    function pause() external onlyManager {
        _pause();
    }

    function unpause() external onlyManager {
        _unpause();
    }

    // ============ Batch Withdrawal ============

    /// @notice Withdraw all deposits across every strategy in a single transaction
    function batchWithdrawAll() external nonReentrant whenNotPaused {
        // Settle pending taxes before any funds leave the vault
        _settleTaxes(msg.sender);

        uint256 total = _collectAllPrincipal(msg.sender);
        if (total == 0) revert NoDeposits();

        (bool success, ) = payable(msg.sender).call{value: total}("");
        if (!success) revert ETHTransferFailed();

        emit Withdrawn(msg.sender, address(0), total);
    }

    // ============ View Functions ============

    function getBalanceInStrategy(address user, address strategy) public view returns (uint256) {
        uint256 deposited = userDeposits[user][strategy];
        if (deposited == 0) return 0;
        if (strategy == IDLE_STRATEGY) return deposited;

        // If strategy was emergency-drained, use recovery rate
        if (_isDrained(strategy)) {
            return (deposited * recoveryRate[strategy]) / RECOVERY_PRECISION;
        }

        uint256 totalValue = IYieldStrategy(strategy).convertToAssets(
            IYieldStrategy(strategy).balanceOf(address(this))
        );
        uint256 totalDeposited = totalDepositsPerStrategy[strategy];
        if (totalDeposited == 0) return 0;

        return (deposited * totalValue) / totalDeposited;
    }

    /// @inheritdoc ITaxVault
    function getTotalBalance(address user) public view returns (uint256) {
        uint256 total = userDeposits[user][IDLE_STRATEGY];

        for (uint256 i = 0; i < approvedStrategies.length; i++) {
            total += getBalanceInStrategy(user, approvedStrategies[i]);
        }
        for (uint256 i = 0; i < removedStrategies.length; i++) {
            total += getBalanceInStrategy(user, removedStrategies[i]);
        }

        return total;
    }

    function getBalanceBreakdown(address user)
        external
        view
        returns (address[] memory strategies, uint256[] memory balances)
    {
        uint256 len = 1 + approvedStrategies.length + removedStrategies.length;
        strategies = new address[](len);
        balances = new uint256[](len);

        strategies[0] = IDLE_STRATEGY;
        balances[0] = userDeposits[user][IDLE_STRATEGY];

        for (uint256 i = 0; i < approvedStrategies.length; i++) {
            strategies[i + 1] = approvedStrategies[i];
            balances[i + 1] = getBalanceInStrategy(user, approvedStrategies[i]);
        }

        uint256 offset = 1 + approvedStrategies.length;
        for (uint256 i = 0; i < removedStrategies.length; i++) {
            strategies[offset + i] = removedStrategies[i];
            balances[offset + i] = getBalanceInStrategy(user, removedStrategies[i]);
        }
    }

    function getApprovedStrategies() external view returns (address[] memory) {
        return approvedStrategies;
    }

    // ============ Internal Helpers ============

    /// @dev Settle any pending taxes via Harburger before funds leave the vault.
    ///      This ensures users can't withdraw funds they owe in taxes.
    function _settleTaxes(address user) private {
        IHarburger(harburger).settleTaxes(user);
    }

    /// @dev Check if a strategy has been emergency-drained
    function _isDrained(address strategy) private view returns (bool) {
        return recoveryRate[strategy] > 0;
    }

    /// @dev Update accounting when withdrawing `amount` from a strategy.
    ///      Adjusts both user deposits and total deposits proportionally so that
    ///      totalDepositsPerStrategy stays consistent with the actual strategy value.
    function _updateWithdrawAccounting(address user, address strategy, uint256 amount) private {
        uint256 deposited = userDeposits[user][strategy];
        if (strategy == IDLE_STRATEGY || _isDrained(strategy)) {
            // Idle and drained: 1:1 accounting
            userDeposits[user][strategy] -= amount;
            totalDepositsPerStrategy[strategy] = _safeSub(totalDepositsPerStrategy[strategy], amount);
        } else {
            // For yield strategies, reduce deposit proportionally to maintain ratio consistency.
            // amount is the user's share of the strategy value, deposited is their deposit tracking.
            // Reduce deposit by the same proportion: depositReduction = deposited * amount / balance
            uint256 balance = getBalanceInStrategy(user, strategy);
            uint256 depositReduction;
            if (amount >= balance) {
                // Withdrawing entire balance
                depositReduction = deposited;
            } else {
                depositReduction = (deposited * amount) / balance;
                if (depositReduction == 0) depositReduction = 1; // avoid leaving dust
            }
            uint256 yield = amount > depositReduction ? amount - depositReduction : 0;
            userDeposits[user][strategy] -= depositReduction;
            totalDepositsPerStrategy[strategy] = _safeSub(totalDepositsPerStrategy[strategy], depositReduction);
            if (yield > 0) {
                emit YieldHarvested(user, strategy, yield);
            }
        }
    }

    /// @dev Drain `remaining` Wei from user's strategies in `list`. Returns leftover.
    function _drainStrategies(address user, uint256 remaining, address[] storage list) private returns (uint256) {
        uint256 count = list.length;
        address[] memory toWithdraw = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        uint256 idx = 0;

        for (uint256 i = 0; i < count && remaining > 0; i++) {
            address strategy = list[i];
            uint256 bal = getBalanceInStrategy(user, strategy);
            if (bal == 0) continue;

            uint256 take = bal < remaining ? bal : remaining;
            _updateWithdrawAccounting(user, strategy, take);

            if (_isDrained(strategy)) {
                // Drained strategy: ETH is already in vault as idle, reduce idle total
                totalDepositsPerStrategy[IDLE_STRATEGY] = _safeSub(totalDepositsPerStrategy[IDLE_STRATEGY], take);
            } else {
                toWithdraw[idx] = strategy;
                amounts[idx] = take;
                idx++;
            }
            remaining -= take;
        }

        // External calls after all state updates (only for live strategies)
        for (uint256 i = 0; i < idx; i++) {
            uint256 withdrawn = IYieldStrategy(toWithdraw[i]).withdraw(amounts[i]);
            if (withdrawn < amounts[i]) revert StrategyShortfall();
        }

        return remaining;
    }

    /// @dev Collect and zero all principal for a user across all strategy lists.
    ///      For drained strategies, returns the recovered amount (not original deposit).
    function _collectAllPrincipal(address user) private returns (uint256 total) {
        uint256 idle = userDeposits[user][IDLE_STRATEGY];
        total = idle;
        totalDepositsPerStrategy[IDLE_STRATEGY] = _safeSub(totalDepositsPerStrategy[IDLE_STRATEGY], idle);
        userDeposits[user][IDLE_STRATEGY] = 0;

        total += _collectFromList(user, approvedStrategies);
        total += _collectFromList(user, removedStrategies);
    }

    /// @dev Zero user deposits for each strategy in `list`, adjusting totals.
    ///      For drained strategies, returns recovered amount and adjusts idle total.
    ///      For live strategies, withdraws ETH from the strategy contract.
    function _collectFromList(address user, address[] storage list) private returns (uint256 collected) {
        uint256 count = list.length;
        address[] memory toWithdraw = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        uint256 idx = 0;

        for (uint256 i = 0; i < count; i++) {
            address strategy = list[i];
            uint256 dep = userDeposits[user][strategy];
            if (dep > 0) {
                if (_isDrained(strategy)) {
                    uint256 recovered = (dep * recoveryRate[strategy]) / RECOVERY_PRECISION;
                    collected += recovered;
                    userDeposits[user][strategy] = 0;
                    totalDepositsPerStrategy[IDLE_STRATEGY] = _safeSub(totalDepositsPerStrategy[IDLE_STRATEGY], recovered);
                } else {
                    // Compute proportional share before zeroing deposit
                    uint256 totalValue = IYieldStrategy(strategy).convertToAssets(
                        IYieldStrategy(strategy).balanceOf(address(this))
                    );
                    uint256 totalDeposited = totalDepositsPerStrategy[strategy];
                    uint256 share = totalDeposited > 0 ? (dep * totalValue) / totalDeposited : 0;

                    userDeposits[user][strategy] = 0;
                    totalDepositsPerStrategy[strategy] = _safeSub(totalDepositsPerStrategy[strategy], dep);
                    collected += share;
                    toWithdraw[idx] = strategy;
                    amounts[idx] = share;
                    idx++;
                }
            }
        }

        // External calls after all state updates — check return values
        for (uint256 i = 0; i < idx; i++) {
            uint256 withdrawn = IYieldStrategy(toWithdraw[i]).withdraw(amounts[i]);
            if (withdrawn < amounts[i]) {
                // Adjust collected to actual amount received
                collected -= (amounts[i] - withdrawn);
            }
        }
    }

    /// @dev Remove first occurrence of `target` from `arr` using swap-and-pop
    function _removeFromArray(address[] storage arr, address target) private {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == target) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                return;
            }
        }
    }

    /// @dev Saturating subtraction (caps at zero)
    function _safeSub(uint256 a, uint256 b) private pure returns (uint256) {
        return b <= a ? a - b : 0;
    }

    // ============ Receive ============

    /// @notice Accept ETH only from known yield strategies (returning funds on withdrawal)
    receive() external payable {
        if (!_isKnownStrategy[msg.sender]) revert UnauthorizedETHSender();
    }
}
