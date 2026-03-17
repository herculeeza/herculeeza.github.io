// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./ITaxVault.sol";

/// @title Harburger
/// @notice Harberger Tax NFT with optional yield-bearing vault integration
/// @dev Single-token ERC721 where the owner must self-assess a price and pay
///      continuous taxes. Anyone can force-buy at the declared price.
contract Harburger is ERC721, Ownable, ReentrancyGuard {

    // ============ Custom Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error ZeroPrice();
    error InsufficientBalance();
    error OnlyNFTOwner();
    error AlreadyNFTOwner();
    error BuyerHasDebt();
    error NoActiveEarmark();
    error EarmarkAlreadyActive();
    error NotEarmarkReceiver();
    error CannotEarmarkToSelf();
    error OnlyTaxReceiver();
    error VaultNotSet();
    error TransferNotAllowed();
    error OnlyTaxVault();
    error ETHTransferFailed();

    // ============ Constants ============

    uint256 public constant TOKEN_ID = 1;
    uint256 private constant MAX_TAX_PERIOD = 365 days;
    /// @notice Precision divisor for tax rate. taxRate is a per-second rate scaled by 1e18.
    ///         Example: 10% annual = (0.10 / 31_536_000) * 1e18 ≈ 3_170_979_198
    uint256 public constant RATE_PRECISION = 1e18;

    // ============ State Variables ============

    uint256 public taxRate;
    address public taxReceiver;
    uint256 public currentPrice;
    address public currentOwner;
    ITaxVault public taxVault;

    // ============ Structs ============

    struct Account {
        uint256 balance;         // Wei deposited, always ETH-backed
        uint256 debt;            // Unpaid taxes in Wei
        uint256 totalTaxesPaid;
        uint64 lastTaxPayment;
        bool usesVault;          // Packed with lastTaxPayment in one slot
    }

    struct Earmark {
        address creator;         // Owner who created the earmark (deposit should be returned to them)
        address receiver;
        uint256 depositAmount;   // Wei escrowed from owner
        bool active;
    }

    // ============ Storage ============

    mapping(address => Account) public accounts;
    Earmark public earmark;

    // ============ Events ============

    event PriceSet(address indexed owner, uint256 newPrice);
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event TaxPaid(address indexed payer, uint256 amount, address indexed receiver);
    event NFTSold(address indexed from, address indexed to, uint256 price);
    event NFTEarmarked(address indexed from, address indexed to, uint256 deposit);
    event EarmarkClaimed(address indexed claimer);
    event EarmarkCancelled(address indexed owner);
    event TaxReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event DebtSettled(address indexed debtor, uint256 debtAmount);
    event VaultEnabled(address indexed user);
    event VaultDisabled(address indexed user);
    event TaxVaultUpdated(address indexed oldVault, address indexed newVault);

    // ============ Modifiers ============

    /// @dev Settle accrued taxes for an account before executing the function body
    modifier settlesTaxes(address account) {
        _updateTaxes(account);
        _;
    }

    // ============ Constructor ============

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _taxRate,
        address _taxReceiver,
        uint256 _initialPrice,
        address _taxVault
    ) ERC721(_name, _symbol) {
        if (_taxReceiver == address(0)) revert ZeroAddress();
        if (_taxRate == 0) revert ZeroAmount();
        if (_initialPrice == 0) revert ZeroPrice();

        taxRate = _taxRate;
        taxReceiver = _taxReceiver;
        currentPrice = _initialPrice;
        currentOwner = msg.sender;
        taxVault = ITaxVault(_taxVault);

        _mint(msg.sender, TOKEN_ID);

        accounts[msg.sender].lastTaxPayment = uint64(block.timestamp);
    }

    // ============ Tax Internals ============

    /// @notice Calculate taxes owed by the current owner since last settlement
    function calculateTaxes(address account) public view returns (uint256) {
        if (account != currentOwner) return 0;

        uint256 elapsed = block.timestamp - accounts[account].lastTaxPayment;
        if (elapsed > MAX_TAX_PERIOD) {
            elapsed = MAX_TAX_PERIOD;
        }

        return (currentPrice * taxRate * elapsed) / RATE_PRECISION;
    }

    /// @dev Settle accrued taxes for the current owner
    function _updateTaxes(address account) private {
        if (account != currentOwner) return;

        uint256 taxesOwed = calculateTaxes(account);
        if (taxesOwed == 0) return;

        Account storage acc = accounts[account];
        uint256 paid;

        if (acc.usesVault && address(taxVault) != address(0)) {
            bool success = taxVault.payTax(account, taxesOwed);

            if (success) {
                // Vault sent ETH to this contract — credit the tax receiver
                acc.totalTaxesPaid += taxesOwed;
                accounts[taxReceiver].balance += taxesOwed;
                paid = taxesOwed;
            } else {
                // Vault couldn't cover it — accrue as debt
                paid = _deductOrDebt(acc, taxesOwed);
                if (paid > 0) {
                    accounts[taxReceiver].balance += paid;
                }
            }
        } else {
            paid = _deductOrDebt(acc, taxesOwed);
            if (paid > 0) {
                accounts[taxReceiver].balance += paid;
            }
        }

        acc.lastTaxPayment = uint64(block.timestamp);

        if (paid > 0) {
            emit TaxPaid(account, paid, taxReceiver);
        }
    }

    /// @dev Deduct `amount` from account balance; any shortfall becomes debt.
    ///      Returns the amount actually deducted (ETH-backed portion).
    function _deductOrDebt(Account storage acc, uint256 amount) private returns (uint256 paid) {
        if (acc.balance >= amount) {
            acc.balance -= amount;
            acc.totalTaxesPaid += amount;
            return amount;
        }

        // Partial payment — balance covers some, rest becomes debt
        paid = acc.balance;
        uint256 shortfall = amount - acc.balance;
        acc.balance = 0;
        acc.debt += shortfall;
        acc.totalTaxesPaid += paid;
    }

    // ============ Vault Integration ============

    function enableVault() external nonReentrant settlesTaxes(msg.sender) {
        if (address(taxVault) == address(0)) revert VaultNotSet();
        accounts[msg.sender].usesVault = true;
        emit VaultEnabled(msg.sender);
    }

    function disableVault() external nonReentrant settlesTaxes(msg.sender) {
        accounts[msg.sender].usesVault = false;
        emit VaultDisabled(msg.sender);
    }

    // ============ Deposit & Withdrawal ============

    function deposit() external payable nonReentrant settlesTaxes(msg.sender) {
        if (msg.value == 0) revert ZeroAmount();

        Account storage acc = accounts[msg.sender];

        // Pay off debt first
        if (acc.debt > 0) {
            uint256 debtPayment = msg.value >= acc.debt ? acc.debt : msg.value;
            acc.debt -= debtPayment;
            accounts[taxReceiver].balance += debtPayment;
            emit DebtSettled(msg.sender, debtPayment);

            uint256 remaining = msg.value - debtPayment;
            acc.balance += remaining;
        } else {
            acc.balance += msg.value;
        }

        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant settlesTaxes(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        Account storage acc = accounts[msg.sender];
        if (acc.balance < amount) revert InsufficientBalance();

        acc.balance -= amount;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert ETHTransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    // ============ NFT Ownership ============

    function setPrice(uint256 newPrice) external nonReentrant settlesTaxes(msg.sender) {
        if (msg.sender != currentOwner) revert OnlyNFTOwner();
        if (newPrice == 0) revert ZeroPrice();

        currentPrice = newPrice;
        emit PriceSet(msg.sender, newPrice);
    }

    function buyNFT(uint256 newPrice) external nonReentrant {
        if (newPrice == 0) revert ZeroPrice();
        if (msg.sender == currentOwner) revert AlreadyNFTOwner();

        _updateTaxes(msg.sender);
        _updateTaxes(currentOwner);

        Account storage buyerAcc = accounts[msg.sender];
        Account storage ownerAcc = accounts[currentOwner];

        uint256 purchasePrice = currentPrice;

        if (ownerAcc.debt > 0) {
            // Owner has unpaid taxes — NFT is free, debt is forgiven
            if (buyerAcc.debt > 0) revert BuyerHasDebt();
            emit DebtSettled(currentOwner, ownerAcc.debt);
            ownerAcc.debt = 0;
            purchasePrice = 0;
        } else {
            if (buyerAcc.balance < purchasePrice) revert InsufficientBalance();
        }

        if (purchasePrice > 0) {
            buyerAcc.balance -= purchasePrice;
            ownerAcc.balance += purchasePrice;
        }

        // Clear any active earmark; return escrowed deposit to the earmark creator.
        // Without this, the earmark receiver could later call claimEarmark() and
        // transfer the NFT from the new owner without their consent (NFT theft).
        if (earmark.active) {
            uint256 earmarkRefund = earmark.depositAmount;
            address earmarkCreator = earmark.creator;
            delete earmark;
            if (earmarkRefund > 0) {
                accounts[earmarkCreator].balance += earmarkRefund;
            }
        }

        address previousOwner = currentOwner;
        currentOwner = msg.sender;
        currentPrice = newPrice;
        _transfer(previousOwner, msg.sender, TOKEN_ID);

        accounts[msg.sender].lastTaxPayment = uint64(block.timestamp);

        emit NFTSold(previousOwner, msg.sender, purchasePrice);
        emit PriceSet(msg.sender, newPrice);
    }

    // ============ Earmark ============

    function earmarkNFT(address receiver, uint256 depositAmount) external nonReentrant settlesTaxes(msg.sender) {
        if (msg.sender != currentOwner) revert OnlyNFTOwner();
        if (receiver == address(0)) revert ZeroAddress();
        if (receiver == msg.sender) revert CannotEarmarkToSelf();
        if (earmark.active) revert EarmarkAlreadyActive();

        Account storage acc = accounts[msg.sender];
        if (acc.balance < depositAmount) revert InsufficientBalance();

        if (depositAmount > 0) {
            acc.balance -= depositAmount;
        }

        earmark = Earmark({
            creator: msg.sender,
            receiver: receiver,
            depositAmount: depositAmount,
            active: true
        });

        emit NFTEarmarked(msg.sender, receiver, depositAmount);
    }

    function claimEarmark(uint256 newPrice) external nonReentrant {
        if (!earmark.active) revert NoActiveEarmark();
        if (msg.sender != earmark.receiver) revert NotEarmarkReceiver();
        if (newPrice == 0) revert ZeroPrice();

        _updateTaxes(currentOwner);
        _updateTaxes(msg.sender);

        address previousOwner = currentOwner;
        uint256 earmarkDeposit = earmark.depositAmount;

        currentOwner = msg.sender;
        currentPrice = newPrice;
        _transfer(previousOwner, msg.sender, TOKEN_ID);

        if (earmarkDeposit > 0) {
            accounts[msg.sender].balance += earmarkDeposit;
        }

        delete earmark;
        accounts[msg.sender].lastTaxPayment = uint64(block.timestamp);

        emit EarmarkClaimed(msg.sender);
        emit PriceSet(msg.sender, newPrice);
    }

    function cancelEarmark() external nonReentrant settlesTaxes(msg.sender) {
        if (msg.sender != currentOwner) revert OnlyNFTOwner();
        if (!earmark.active) revert NoActiveEarmark();

        uint256 refund = earmark.depositAmount;
        address creator = earmark.creator;
        delete earmark;

        // Return deposit to whoever created the earmark, not necessarily currentOwner.
        // This prevents a new owner from claiming the previous owner's escrowed deposit.
        if (refund > 0) {
            accounts[creator].balance += refund;
        }

        emit EarmarkCancelled(msg.sender);
    }

    // ============ Admin ============

    function updateTaxReceiver(address newTaxReceiver) external onlyOwner {
        if (newTaxReceiver == address(0)) revert ZeroAddress();

        // Settle pending taxes under the old receiver
        _updateTaxes(currentOwner);

        address oldReceiver = taxReceiver;

        // Transfer accumulated balance so it isn't stranded
        uint256 oldBalance = accounts[oldReceiver].balance;
        if (oldBalance > 0) {
            accounts[oldReceiver].balance = 0;
            accounts[newTaxReceiver].balance += oldBalance;
        }

        taxReceiver = newTaxReceiver;
        emit TaxReceiverUpdated(oldReceiver, newTaxReceiver);
    }

    function updateTaxVault(address newTaxVault) external onlyOwner {
        address oldVault = address(taxVault);
        taxVault = ITaxVault(newTaxVault);
        emit TaxVaultUpdated(oldVault, newTaxVault);
    }

    // ============ View ============

    function getAccountBalance(address user) external view returns (uint256 balance, uint256 debt) {
        Account memory acc = accounts[user];
        balance = acc.balance;
        debt = acc.debt;

        if (acc.usesVault && address(taxVault) != address(0)) {
            balance += taxVault.getTotalBalance(user);
        }

        if (user == currentOwner) {
            uint256 pendingTax = calculateTaxes(user);
            if (pendingTax <= balance) {
                balance -= pendingTax;
            } else {
                debt += pendingTax - balance;
                balance = 0;
            }
        }
    }

    // ============ Transfer Restrictions ============

    function approve(address, uint256) public pure override {
        revert TransferNotAllowed();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert TransferNotAllowed();
    }

    function transferFrom(address, address, uint256) public pure override {
        revert TransferNotAllowed();
    }

    function safeTransferFrom(address, address, uint256) public pure override {
        revert TransferNotAllowed();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert TransferNotAllowed();
    }

    // ============ Receive ============

    /// @notice Accept ETH only from TaxVault (for tax payments)
    receive() external payable {
        if (msg.sender != address(taxVault)) revert OnlyTaxVault();
    }
}
