import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../contractABI';

const RATE_PRECISION = 10n ** 18n;
const SECONDS_PER_YEAR = 31536000n;

const EXPECTED_CHAIN_ID = import.meta.env.VITE_CHAIN_ID
  ? Number(import.meta.env.VITE_CHAIN_ID)
  : null;

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
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);

      if (EXPECTED_CHAIN_ID) {
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
          handleError(`Wrong network. Expected chain ID ${EXPECTED_CHAIN_ID}, got ${network.chainId}.`);
          setLoading(false);
          return;
        }
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const inst = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      setAccount(address);
      setContract(inst);
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
    if (!contract) return;
    try {
      const [owner, price, rate, receiver, vault, name, symbol, uri] = await Promise.all([
        contract.currentOwner(),
        contract.currentPrice(),
        contract.taxRate(),
        contract.taxReceiver(),
        contract.taxVault(),
        contract.name(),
        contract.symbol(),
        contract.tokenURI(1)
      ]);
      setContractData({
        currentOwner: owner, currentPrice: price.toString(),
        taxRate: rate.toString(), taxReceiver: receiver,
        taxVault: vault, nftName: name, nftSymbol: symbol, tokenURI: uri
      });
      const em = await contract.earmark();
      setEarmark({
        creator: em.creator, receiver: em.receiver,
        depositAmount: em.depositAmount.toString(), active: em.active
      });
    } catch (err) { console.error('Error loading contract data:', err); }
  }, [contract]);

  const loadAccountData = useCallback(async () => {
    if (!account || !contract) return;
    try {
      const [info, [netBalance, debt], taxesOwed] = await Promise.all([
        contract.accounts(account),
        contract.getAccountBalance(account),
        contract.calculateTaxes(account)
      ]);
      setAccountData({
        netBalance: netBalance.toString(), debt: debt.toString(),
        rawBalance: info.balance.toString(),
        lastTaxPayment: info.lastTaxPayment.toString(),
        totalTaxesPaid: info.totalTaxesPaid.toString(),
        taxesOwed: taxesOwed.toString(), usesVault: info.usesVault
      });
    } catch (err) { console.error('Error loading account data:', err); }
  }, [account, contract]);

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

  const handleDeposit = useCallback((amount) =>
    exec(async () => {
      const tx = await contract.deposit({ value: ethers.parseEther(amount) });
      await tx.wait();
    }, 'Deposit successful')
  , [contract, exec]);

  const handleWithdraw = useCallback((amount) =>
    exec(async () => {
      const tx = await contract.withdraw(ethers.parseEther(amount));
      await tx.wait();
    }, 'Withdrawal successful')
  , [contract, exec]);

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
    isOwner, isEarmarkReceiver, vaultBalance,
    connectWallet,
    handleDeposit, handleWithdraw, handleSetPrice, handleBuyNFT,
    handleEarmark, handleClaimEarmark, handleCancelEarmark,
    handleEnableVault, handleDisableVault,
    formatAddress, formatEther, annualTaxPercent
  };
}
