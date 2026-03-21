const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TaxVault", function () {
  let taxVault;
  let harburger;
  let manager;
  let user1;
  let user2;

  const RATE_PRECISION = 10n ** 18n;
  const SECONDS_PER_YEAR = 31536000n;
  const TAX_RATE = (10n * RATE_PRECISION) / (100n * SECONDS_PER_YEAR);
  const INITIAL_PRICE = ethers.parseEther("0.1");

  beforeEach(async function () {
    [, manager, user1, user2] = await ethers.getSigners();

    // Deploy real Harburger so settleTaxes calls work
    const Harburger = await ethers.getContractFactory("Harburger");
    harburger = await Harburger.deploy(
      "Test", "TST", TAX_RATE, manager.address, INITIAL_PRICE, ethers.ZeroAddress
    );
    await harburger.waitForDeployment();

    const TaxVault = await ethers.getContractFactory("TaxVault");
    taxVault = await TaxVault.deploy(await harburger.getAddress(), manager.address);
    await taxVault.waitForDeployment();

    // Wire up the vault
    await harburger.updateTaxVault(await taxVault.getAddress());
  });

  describe("Deployment", function () {
    it("Should set the correct harburger address", async function () {
      expect(await taxVault.harburger()).to.equal(await harburger.getAddress());
    });

    it("Should set the correct manager", async function () {
      expect(await taxVault.manager()).to.equal(manager.address);
    });

    it("Should have IDLE_STRATEGY approved by default", async function () {
      expect(await taxVault.isApprovedStrategy(ethers.ZeroAddress)).to.be.true;
    });
  });

  describe("Deposits and Withdrawals", function () {
    it("Should allow deposits to idle strategy", async function () {
      const depositAmount = ethers.parseEther("1.0");

      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      const balance = await taxVault.getBalanceInStrategy(user1.address, ethers.ZeroAddress);
      expect(balance).to.equal(depositAmount);
    });

    it("Should allow withdrawals from idle strategy", async function () {
      const depositAmount = ethers.parseEther("1.0");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      const withdrawAmount = ethers.parseEther("0.5");
      const initialBalance = await ethers.provider.getBalance(user1.address);

      const tx = await taxVault.connect(user1).withdraw(ethers.ZeroAddress, withdrawAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance).to.be.closeTo(
        initialBalance + withdrawAmount - gasUsed,
        ethers.parseEther("0.001")
      );
    });

    it("Should revert withdrawal with insufficient balance", async function () {
      await expect(
        taxVault.connect(user1).withdraw(ethers.ZeroAddress, ethers.parseEther("1.0"))
      ).to.be.revertedWithCustomError(taxVault, "InsufficientBalance");
    });

    it("Should track total balance correctly", async function () {
      const depositAmount = ethers.parseEther("2.5");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      const totalBalance = await taxVault.getTotalBalance(user1.address);
      expect(totalBalance).to.equal(depositAmount);
    });
  });

  describe("Batch Withdrawal", function () {
    it("Should allow batch withdrawal of all funds", async function () {
      const depositAmount = ethers.parseEther("5.0");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      const initialBalance = await ethers.provider.getBalance(user1.address);
      const tx = await taxVault.connect(user1).batchWithdrawAll();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance).to.be.closeTo(
        initialBalance + depositAmount - gasUsed,
        ethers.parseEther("0.01")
      );
    });

    it("Should revert batch withdrawal with no deposits", async function () {
      await expect(
        taxVault.connect(user1).batchWithdrawAll()
      ).to.be.revertedWithCustomError(taxVault, "NoDeposits");
    });
  });

  describe("Strategy Management", function () {
    it("Should allow manager to add strategy", async function () {
      await taxVault.connect(manager).addStrategy(user2.address);
      expect(await taxVault.isApprovedStrategy(user2.address)).to.be.true;
    });

    it("Should prevent non-manager from adding strategy", async function () {
      await expect(
        taxVault.connect(user1).addStrategy(user2.address)
      ).to.be.revertedWithCustomError(taxVault, "OnlyManager");
    });

    it("Should enforce max strategies limit", async function () {
      const MAX_STRATEGIES = await taxVault.MAX_STRATEGIES();

      for (let i = 0; i < MAX_STRATEGIES; i++) {
        const mockAddr = ethers.Wallet.createRandom().address;
        await taxVault.connect(manager).addStrategy(mockAddr);
      }

      const oneMoreAddr = ethers.Wallet.createRandom().address;
      await expect(
        taxVault.connect(manager).addStrategy(oneMoreAddr)
      ).to.be.revertedWithCustomError(taxVault, "MaxStrategiesReached");
    });

    it("Should allow manager to remove strategy", async function () {
      await taxVault.connect(manager).addStrategy(user2.address);
      await taxVault.connect(manager).removeStrategy(user2.address);

      expect(await taxVault.isApprovedStrategy(user2.address)).to.be.false;
    });

    it("Should not allow removing IDLE_STRATEGY", async function () {
      await expect(
        taxVault.connect(manager).removeStrategy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(taxVault, "CannotRemoveIdle");
    });
  });

  describe("Tax Payment", function () {
    it("Should allow Harburger to deduct taxes from idle balance", async function () {
      const depositAmount = ethers.parseEther("10.0");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      const taxAmount = ethers.parseEther("1.0");
      const harburgerAddr = await harburger.getAddress();
      const initialHarburgerBalance = await ethers.provider.getBalance(harburgerAddr);

      // Call payTax via the harburger contract by triggering tax settlement
      // For direct testing, we need to impersonate the harburger contract
      await ethers.provider.send("hardhat_setBalance", [harburgerAddr, "0x56BC75E2D63100000"]);
      const harburgerSigner = await ethers.getImpersonatedSigner(harburgerAddr);

      const tx = await taxVault.connect(harburgerSigner).payTax(user1.address, taxAmount);
      await tx.wait();

      const finalUserBalance = await taxVault.getTotalBalance(user1.address);
      expect(finalUserBalance).to.equal(depositAmount - taxAmount);
    });

    it("Should prevent non-Harburger from calling payTax", async function () {
      const depositAmount = ethers.parseEther("1.0");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      await expect(
        taxVault.connect(user1).payTax(user1.address, ethers.parseEther("0.1"))
      ).to.be.revertedWithCustomError(taxVault, "OnlyHarburger");
    });

    it("Should return 0 if no balance for tax", async function () {
      const taxAmount = ethers.parseEther("0.01");

      const harburgerAddr = await harburger.getAddress();
      await ethers.provider.send("hardhat_setBalance", [harburgerAddr, "0x56BC75E2D63100000"]);
      const harburgerSigner = await ethers.getImpersonatedSigner(harburgerAddr);

      const paid = await taxVault
        .connect(harburgerSigner)
        .payTax.staticCall(user1.address, taxAmount);

      expect(paid).to.equal(0n);
    });

    it("Should handle partial tax payment", async function () {
      const depositAmount = ethers.parseEther("0.5");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      const taxAmount = ethers.parseEther("1.0"); // more than deposited

      const harburgerAddr = await harburger.getAddress();
      await ethers.provider.send("hardhat_setBalance", [harburgerAddr, "0x56BC75E2D63100000"]);
      const harburgerSigner = await ethers.getImpersonatedSigner(harburgerAddr);

      const paid = await taxVault
        .connect(harburgerSigner)
        .payTax.staticCall(user1.address, taxAmount);

      expect(paid).to.equal(depositAmount);
    });
  });

  describe("Pause", function () {
    it("Should allow manager to pause and unpause", async function () {
      await taxVault.connect(manager).pause();
      expect(await taxVault.paused()).to.be.true;

      await taxVault.connect(manager).unpause();
      expect(await taxVault.paused()).to.be.false;
    });

    it("Should block deposits when paused", async function () {
      await taxVault.connect(manager).pause();

      await expect(
        taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: ethers.parseEther("1.0") })
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should block withdrawals when paused", async function () {
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: ethers.parseEther("1.0") });
      await taxVault.connect(manager).pause();

      await expect(
        taxVault.connect(user1).withdraw(ethers.ZeroAddress, ethers.parseEther("0.5"))
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("Receive restriction", function () {
    it("Should reject ETH from unknown senders", async function () {
      await expect(
        user1.sendTransaction({
          to: await taxVault.getAddress(),
          value: ethers.parseEther("1.0")
        })
      ).to.be.revertedWithCustomError(taxVault, "UnauthorizedETHSender");
    });
  });

  describe("Manager Functions", function () {
    it("Should allow manager to update manager address", async function () {
      await taxVault.connect(manager).updateManager(user1.address);
      expect(await taxVault.manager()).to.equal(user1.address);
    });

    it("Should prevent updating manager to zero address", async function () {
      await expect(
        taxVault.connect(manager).updateManager(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(taxVault, "ZeroAddress");
    });
  });

  describe("Drain recovery", function () {
    it("Should have zero recoveryRate for non-drained strategies", async function () {
      const rate = await taxVault.recoveryRate(user2.address);
      expect(rate).to.equal(0n);
    });

    it("Should revert migrateFromDrainedStrategy if not drained", async function () {
      await expect(
        taxVault.connect(user1).migrateFromDrainedStrategy(user2.address)
      ).to.be.revertedWithCustomError(taxVault, "StrategyNotDrained");
    });
  });

  describe("View Functions", function () {
    it("Should return correct total balance", async function () {
      const depositAmount = ethers.parseEther("3.5");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      const balance = await taxVault.getTotalBalance(user1.address);
      expect(balance).to.equal(depositAmount);
    });

    it("Should return correct balance breakdown including IDLE slot", async function () {
      const [strategies, balances] = await taxVault.getBalanceBreakdown(user1.address);
      expect(strategies.length).to.be.greaterThan(0);
      expect(balances[0]).to.equal(0n);
    });

    it("Should return empty approved strategies array at deploy", async function () {
      const strategies = await taxVault.getApprovedStrategies();
      expect(strategies.length).to.equal(0);
    });
  });

  describe("Events", function () {
    it("Should emit Deposited event on deposit", async function () {
      const depositAmount = ethers.parseEther("1.0");

      await expect(
        taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount })
      )
        .to.emit(taxVault, "Deposited")
        .withArgs(user1.address, ethers.ZeroAddress, depositAmount);
    });

    it("Should emit Withdrawn event on withdrawal", async function () {
      const depositAmount = ethers.parseEther("1.0");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      const withdrawAmount = ethers.parseEther("0.5");

      await expect(
        taxVault.connect(user1).withdraw(ethers.ZeroAddress, withdrawAmount)
      )
        .to.emit(taxVault, "Withdrawn")
        .withArgs(user1.address, ethers.ZeroAddress, withdrawAmount);
    });

    it("Should emit StrategyAdded event", async function () {
      await expect(taxVault.connect(manager).addStrategy(user2.address))
        .to.emit(taxVault, "StrategyAdded")
        .withArgs(user2.address);
    });
  });
});
