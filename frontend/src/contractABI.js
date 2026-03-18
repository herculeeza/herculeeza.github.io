export const CONTRACT_ABI = [
  // ── View ──────────────────────────────────────────────────────────────────
  "function currentOwner() view returns (address)",
  "function currentPrice() view returns (uint256)",
  "function taxRate() view returns (uint256)",
  "function taxReceiver() view returns (address)",
  "function taxVault() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function tokenURI(uint256) view returns (string)",
  "function RATE_PRECISION() view returns (uint256)",

  "function getAccountBalance(address) view returns (uint256 balance, uint256 debt)",
  "function calculateTaxes(address) view returns (uint256)",
  "function accounts(address) view returns (uint256 balance, uint256 debt, uint256 totalTaxesPaid, uint64 lastTaxPayment, bool usesVault)",
  "function earmark() view returns (address creator, address receiver, uint256 depositAmount, bool active)",

  // ── Write ─────────────────────────────────────────────────────────────────
  "function deposit() payable",
  "function withdraw(uint256 amount)",
  "function setPrice(uint256 newPrice)",
  "function buyNFT(uint256 newPrice)",
  "function earmarkNFT(address receiver, uint256 depositAmount)",
  "function claimEarmark(uint256 newPrice)",
  "function cancelEarmark()",
  "function enableVault()",
  "function disableVault()",

  // ── Events ────────────────────────────────────────────────────────────────
  "event PriceSet(address indexed owner, uint256 newPrice)",
  "event Deposited(address indexed account, uint256 amount)",
  "event Withdrawn(address indexed account, uint256 amount)",
  "event TaxPaid(address indexed payer, uint256 amount, address indexed receiver)",
  "event NFTSold(address indexed from, address indexed to, uint256 price)",
  "event NFTEarmarked(address indexed from, address indexed to, uint256 deposit)",
  "event EarmarkClaimed(address indexed claimer)",
  "event EarmarkCancelled(address indexed owner)",
  "event DebtSettled(address indexed debtor, uint256 debtAmount)",
  "event VaultEnabled(address indexed user)",
  "event VaultDisabled(address indexed user)",

  // ── Errors ────────────────────────────────────────────────────────────────
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error ZeroPrice()",
  "error InsufficientBalance()",
  "error OnlyNFTOwner()",
  "error AlreadyNFTOwner()",
  "error BuyerHasDebt()",
  "error NoActiveEarmark()",
  "error EarmarkAlreadyActive()",
  "error NotEarmarkReceiver()",
  "error CannotEarmarkToSelf()",
  "error VaultNotSet()",
  "error TransferNotAllowed()",
  "error OnlyTaxVault()",
  "error ETHTransferFailed()"
];

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";
