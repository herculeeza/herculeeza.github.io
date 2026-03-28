import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ABI, CONTRACT_ADDRESS, TAX_VAULT_ABI } from '../contractABI';

const RATE_PRECISION = 10n ** 18n;
const SECONDS_PER_YEAR = 31536000n;

const EXPECTED_CHAIN_ID = import.meta.env.VITE_CHAIN_ID
  ? Number(import.meta.env.VITE_CHAIN_ID)
  : null;

const DEFAULT_RPC = import.meta.env.VITE_RPC_URL || {
  1: 'https://ethereum-rpc.publicnode.com',
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
}[EXPECTED_CHAIN_ID || 1];

function formatAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatEther(wei) {
  if (!wei || wei === '0') return '0.000000';
  try {
    return parseFloat(ethers.formatEther(wei.toString())).toFixed(6);
  } catch {
    return '0.000000';
  }
}

function annualTaxPercent(rawRate) {
  try {
    const rate = BigInt(rawRate);
    const bps = rate * SECONDS_PER_YEAR * 10000n / RATE_PRECISION;
    return (Number(bps) / 100).toFixed(2);
  } catch {
    return '0.00';
  }
}

export function useHarburger() {
  const [account, setAccount] = useState(null);
  const [contract, setContract] = useState(null);

  // Read-only contract for loading data without a wallet
  const readContract = useMemo(() => {
    if (!CONTRACT_ADDRESS || !DEFAULT_RPC) return null;
    try {
      const provider = new ethers.JsonRpcProvider(DEFAULT_RPC);
      return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    } catch { return null; }
  }, []);
  const [vaultContract, setVaultContract] = useState(null);
  const [strategies, setStrategies] = useState([]); // approved yield strategies
  const [strategyNames, setStrategyNames] = useState({}); // address -> human name
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const errorTimer = useRef(null);
  const successTimer = useRef(null);

  const [contractData, setContractData] = useState({
    currentOwner: '',
    currentPrice: '0',
    taxRate: '0',
    taxReceiver: '',
    taxVault: '',
    nftName: '',
    nftSymbol: '',
    tokenURI: ''
  });

  const [accountData, setAccountData] = useState({
    netBalance: '0',
    debt: '0',
    rawBalance: '0',
    lastTaxPayment: '0',
    totalTaxesPaid: '0',
    taxesOwed: '0',
    usesVault: false
  });

  const [earmark, setEarmark] = useState({
    creator: '',
    receiver: '',
    depositAmount: '0',
    active: false
  });

  // ---- Helpers ----

  const handleError = useCallback((msg) => {
    setError(msg);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(''), 5000);
  }, []);

  const handleSuccess = useCallback((msg) => {
    setSuccess(msg);
    clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccess(''), 3000);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(errorTimer.current);
      clearTimeout(successTimer.current);
    };
  }, []);

  // ---- Wallet ----

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      handleError('No wallet detected. Install MetaMask or another browser wallet.');
      return;
    }
    if (!CONTRACT_ADDRESS) {
      handleError('Contract address not configured. Set VITE_CONTRACT_ADDRESS in .env');
      return;
    }
    try {
      setLoading(true);
      let provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);

      if (EXPECTED_CHAIN_ID) {
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
          const hexChainId = '0x' + EXPECTED_CHAIN_ID.toString(16);
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: hexChainId }],
            });
          } catch (switchError) {
            if (switchError.code === 4902) {
              const chainConfig = {
                11155111: { chainName: 'Sepolia', rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: ['https://sepolia.etherscan.io'], nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 } },
                42161: { chainName: 'Arbitrum One', rpcUrls: ['https://arb1.arbitrum.io/rpc'], blockExplorerUrls: ['https://arbiscan.io'], nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 } },
                421614: { chainName: 'Arbitrum Sepolia', rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'], blockExplorerUrls: ['https://sepolia.arbiscan.io'], nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 } },
              }[EXPECTED_CHAIN_ID];
              if (chainConfig) {
                await window.ethereum.request({
                  method: 'wallet_addEthereumChain',
                  params: [{ chainId: hexChainId, ...chainConfig }],
                });
              } else {
                handleError(`Please switch to chain ID ${EXPECTED_CHAIN_ID} in your wallet.`);
                setLoading(false);
                return;
              }
            } else {
              handleError(`Failed to switch network: ${switchError.message}`);
              setLoading(false);
              return;
            }
          }
          // Re-create provider after chain switch
          provider = new ethers.BrowserProvider(window.ethereum);
        }
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const inst = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      setAccount(address);
      setContract(inst);

      // Set up vault contract if configured
      try {
        const vaultAddr = await inst.taxVault();
        if (vaultAddr && vaultAddr !== ethers.ZeroAddress) {
          const vInst = new ethers.Contract(vaultAddr, TAX_VAULT_ABI, signer);
          setVaultContract(vInst);
          const strats = await vInst.getApprovedStrategies();
          setStrategies(strats);

          // Resolve human-readable names for strategies
          const names = {};
          await Promise.all(strats.map(async (addr) => {
            const fallback = `Strategy (${addr.slice(0, 6)}…${addr.slice(-4)})`;
            try {
              const aave = new ethers.Contract(addr, ["function aavePool() view returns (address)"], signer);
              await aave.aavePool();
              names[addr] = 'Aave V3 WETH';
              return;
            } catch { /* not Aave */ }
            try {
              const comp = new ethers.Contract(addr, ["function comet() view returns (address)"], signer);
              await comp.comet();
              names[addr] = 'Compound V3 WETH';
              return;
            } catch { /* not Compound */ }
            names[addr] = fallback;
          }));
          setStrategyNames(names);
        }
      } catch (e) { console.error('Vault setup error:', e); }
    } catch (err) {
      handleError('Failed to connect wallet: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    if (!window.ethereum) return;

    const check = async () => {
      try {
        const accs = await window.ethereum.request({ method: 'eth_accounts' });
        if (accs.length > 0) await connectWallet();
      } catch (err) {
        console.error('Error checking wallet:', err);
      }
    };
    check();

    const onAccountsChanged = (accs) => {
      if (accs.length === 0) { setAccount(null); setContract(null); }
      else connectWallet();
    };
    const onChainChanged = () => window.location.reload();

    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('chainChanged', onChainChanged);
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener('chainChanged', onChainChanged);
    };
  }, [connectWallet]);

  // ---- Data loading ----

  const loadContractData = useCallback(async () => {
    const c = contract || readContract;
    if (!c) return;
    try {
      const [owner, price, rate, receiver, vault, name, symbol, uri] = await Promise.all([
        c.currentOwner(),
        c.currentPrice(),
        c.taxRate(),
        c.taxReceiver(),
        c.taxVault(),
        c.name(),
        c.symbol(),
        c.tokenURI(1)
      ]);
      setContractData({
        currentOwner: owner, currentPrice: price.toString(),
        taxRate: rate.toString(), taxReceiver: receiver,
        taxVault: vault, nftName: name, nftSymbol: symbol, tokenURI: uri
      });
      const em = await c.earmark();
      setEarmark({
        creator: em.creator, receiver: em.receiver,
        depositAmount: em.depositAmount.toString(), active: em.active
      });
    } catch (err) { console.error('Error loading contract data:', err); }
  }, [contract, readContract]);

  const loadTopTaxpayers = useCallback(async () => {
    const c = contract || readContract;
    if (!c) return;
    try {
      const provider = c.runner?.provider || c.runner;
      const currentBlock = await provider.getBlockNumber();
      const filter = c.filters.TaxPaid();
      // Public RPCs cap eth_getLogs to ~50k blocks per request.
      // Scan backwards in chunks. Stop after 3 consecutive empty chunks
      // (tolerates quiet periods without missing older events).
      const CHUNK = 49_000;
      let events = [];
      let to = currentBlock;
      let emptyRun = 0;
      while (to > 0) {
        const from = Math.max(0, to - CHUNK);
        const chunk = await c.queryFilter(filter, from, to);
        events = events.concat(chunk);
        emptyRun = chunk.length > 0 ? 0 : emptyRun + 1;
        if (emptyRun >= 3) break;
        if (from === 0) break;
        to = from - 1;
      }
      // Also scan NFTSold to discover owners who accrued debt (not TaxPaid)
      const soldFilter = c.filters.NFTSold();
      to = currentBlock;
      emptyRun = 0;
      while (to > 0) {
        const from = Math.max(0, to - CHUNK);
        const chunk = await c.queryFilter(soldFilter, from, to);
        for (const e of chunk) {
          // args: from, to, price — both buyer and seller may have tax history
          events.push({ args: [e.args[0]] });
          events.push({ args: [e.args[1]] });
        }
        emptyRun = chunk.length > 0 ? 0 : emptyRun + 1;
        if (emptyRun >= 3) break;
        if (from === 0) break;
        to = from - 1;
      }
      // Collect unique addresses
      const payers = [...new Set(events.map(e => e.args[0]))];
      // Read on-chain totals (totalTaxesPaid + debt = total taxes charged)
      const accountInfos = await Promise.all(payers.map(addr => c.accounts(addr)));
      let allTotal = 0n;
      const entries = [];
      for (let i = 0; i < payers.length; i++) {
        const info = accountInfos[i];
        const total = info.totalTaxesPaid + info.debt;
        if (total === 0n) continue;
        allTotal += total;
        entries.push({ address: payers[i], total: total.toString() });
      }
      const sorted = entries
        .sort((a, b) => (BigInt(b.total) > BigInt(a.total) ? 1 : -1))
        .slice(0, 10);
      setTopTaxpayers(sorted);
      setTotalAllTaxesPaid(allTotal.toString());
    } catch (err) { console.error('Error loading top taxpayers:', err); }
  }, [contract, readContract]);

  useEffect(() => {
    const c = contract || readContract;
    if (c) loadTopTaxpayers();
  }, [contract, readContract, loadTopTaxpayers]);

  const [vaultBreakdown, setVaultBreakdown] = useState([]);
  const [walletBalance, setWalletBalance] = useState('0');
  const [topTaxpayers, setTopTaxpayers] = useState([]);
  const [totalAllTaxesPaid, setTotalAllTaxesPaid] = useState('0');

  const loadAccountData = useCallback(async () => {
    if (!account || !contract) return;
    try {
      const provider = contract.runner?.provider;
      const [info, [netBalance, debt], taxesOwed, ethBal] = await Promise.all([
        contract.accounts(account),
        contract.getAccountBalance(account),
        contract.calculateTaxes(account),
        provider ? provider.getBalance(account) : 0n
      ]);
      setWalletBalance(ethBal.toString());
      setAccountData({
        netBalance: netBalance.toString(), debt: debt.toString(),
        rawBalance: info.balance.toString(),
        lastTaxPayment: info.lastTaxPayment.toString(),
        totalTaxesPaid: info.totalTaxesPaid.toString(),
        taxesOwed: taxesOwed.toString(), usesVault: info.usesVault
      });

      // Load vault balance breakdown if vault is active
      if (info.usesVault && vaultContract) {
        try {
          const [strats, bals] = await vaultContract.getBalanceBreakdown(account);
          const breakdown = strats.map((s, i) => ({
            address: s,
            balance: bals[i].toString()
          })).filter(e => e.balance !== '0');
          setVaultBreakdown(breakdown);
        } catch (e) { console.error('Error loading vault breakdown:', e); }
      }
    } catch (err) { console.error('Error loading account data:', err); }
  }, [account, contract, vaultContract]);

  // Load read-only contract data on mount (no wallet needed)
  useEffect(() => {
    if (!account && readContract) {
      loadContractData();
    }
  }, [account, readContract, loadContractData]);

  // Poll contract + account data when wallet is connected
  useEffect(() => {
    if (account && contract) {
      loadContractData();
      loadAccountData();
      const id = setInterval(() => {
        loadContractData();
        loadAccountData();
      }, 10000);
      return () => clearInterval(id);
    }
  }, [account, contract, loadContractData, loadAccountData]);

  // ---- Transaction wrapper ----
  // Returns true on success, false on failure (for form clearing)

  const exec = useCallback(async (fn, successMsg) => {
    try {
      setLoading(true);
      await fn();
      handleSuccess(successMsg);
      await loadContractData();
      await loadAccountData();
      return true;
    } catch (err) {
      handleError(err.reason || err.shortMessage || err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [handleError, handleSuccess, loadContractData, loadAccountData]);

  // ---- Actions ----

  // destination: 'internal' | strategy address (ethers.ZeroAddress for vault idle)
  const handleDeposit = useCallback((amount, destination = 'internal') =>
    exec(async () => {
      const wei = ethers.parseEther(amount);
      if (destination !== 'internal' && vaultContract) {
        const tx = await vaultContract.deposit(destination, { value: wei });
        await tx.wait();
      } else {
        const tx = await contract.deposit({ value: wei });
        await tx.wait();
      }
    }, 'Deposit successful')
  , [contract, vaultContract, exec]);

  // source: 'internal' | strategy address
  const handleWithdraw = useCallback((amount, source = 'internal') =>
    exec(async () => {
      const wei = ethers.parseEther(amount);
      if (source !== 'internal' && vaultContract) {
        const tx = await vaultContract.withdraw(source, wei);
        await tx.wait();
      } else {
        const tx = await contract.withdraw(wei);
        await tx.wait();
      }
    }, 'Withdrawal successful')
  , [contract, vaultContract, exec]);

  // Move between vault strategies (single tx)
  const handleMoveStrategy = useCallback((amount, from, to) =>
    exec(async () => {
      const wei = ethers.parseEther(amount);
      const tx = await vaultContract.moveStrategy(from, to, wei);
      await tx.wait();
    }, 'Funds moved')
  , [vaultContract, exec]);

  // Move between internal balance and vault (two txs batched)
  const handleMoveToVault = useCallback((amount, strategy) =>
    exec(async () => {
      const wei = ethers.parseEther(amount);
      // Withdraw from Harburger internal
      const tx1 = await contract.withdraw(wei);
      await tx1.wait();
      // Deposit to vault strategy
      const tx2 = await vaultContract.deposit(strategy, { value: wei });
      await tx2.wait();
    }, 'Moved to vault')
  , [contract, vaultContract, exec]);

  const handleMoveFromVault = useCallback((amount, strategy) =>
    exec(async () => {
      const wei = ethers.parseEther(amount);
      // Withdraw from vault (ETH returned to user wallet)
      const tx1 = await vaultContract.withdraw(strategy, wei);
      await tx1.wait();
      // Deposit to Harburger internal
      const tx2 = await contract.deposit({ value: wei });
      await tx2.wait();
    }, 'Moved to internal balance')
  , [contract, vaultContract, exec]);

  const handleSetPrice = useCallback((price) =>
    exec(async () => {
      const tx = await contract.setPrice(ethers.parseEther(price));
      await tx.wait();
    }, 'Price updated')
  , [contract, exec]);

  const handleBuyNFT = useCallback((price) =>
    exec(async () => {
      const tx = await contract.buyNFT(ethers.parseEther(price));
      await tx.wait();
    }, 'NFT purchased')
  , [contract, exec]);

  const handleEarmark = useCallback((receiver, deposit) =>
    exec(async () => {
      const wei = deposit ? ethers.parseEther(deposit) : 0n;
      const tx = await contract.earmarkNFT(receiver, wei);
      await tx.wait();
    }, 'NFT earmarked')
  , [contract, exec]);

  const handleClaimEarmark = useCallback((price) =>
    exec(async () => {
      const tx = await contract.claimEarmark(ethers.parseEther(price));
      await tx.wait();
    }, 'Earmark claimed')
  , [contract, exec]);

  const handleCancelEarmark = useCallback(() =>
    exec(async () => {
      const tx = await contract.cancelEarmark();
      await tx.wait();
    }, 'Earmark cancelled')
  , [contract, exec]);

  const handleEnableVault = useCallback(() =>
    exec(async () => {
      const tx = await contract.enableVault();
      await tx.wait();
    }, 'Vault enabled')
  , [contract, exec]);

  const handleDisableVault = useCallback(() =>
    exec(async () => {
      const tx = await contract.disableVault();
      await tx.wait();
    }, 'Vault disabled')
  , [contract, exec]);

  const handleBatchWithdrawAll = useCallback(() =>
    exec(async () => {
      const tx = await vaultContract.batchWithdrawAll();
      await tx.wait();
    }, 'All vault funds withdrawn')
  , [vaultContract, exec]);

  // ---- Derived ----

  const isOwner = account && contractData.currentOwner.toLowerCase() === account.toLowerCase();
  const isEarmarkReceiver = account && earmark.receiver && earmark.receiver.toLowerCase() === account.toLowerCase();

  const vaultBalance = useMemo(() => {
    try {
      const net = BigInt(accountData.netBalance);
      const raw = BigInt(accountData.rawBalance);
      const tax = BigInt(accountData.taxesOwed);
      const v = net - raw + tax;
      return (v > 0n ? v : 0n).toString();
    } catch { return '0'; }
  }, [accountData.netBalance, accountData.rawBalance, accountData.taxesOwed]);

  return {
    account, loading, error, setError, success,
    contractData, accountData, earmark,
    isOwner, isEarmarkReceiver, vaultBalance, walletBalance, topTaxpayers, totalAllTaxesPaid,
    vaultEnabled: accountData.usesVault && !!vaultContract,
    strategies, strategyNames, vaultBreakdown,
    connectWallet,
    handleDeposit, handleWithdraw, handleSetPrice, handleBuyNFT,
    handleEarmark, handleClaimEarmark, handleCancelEarmark,
    handleEnableVault, handleDisableVault, handleBatchWithdrawAll,
    handleMoveStrategy, handleMoveToVault, handleMoveFromVault,
    formatAddress, formatEther, annualTaxPercent
  };
}
