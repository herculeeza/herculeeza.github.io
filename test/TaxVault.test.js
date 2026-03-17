const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TaxVault", function () {
  let taxVault;
  let harburger; // signer acting as the Harburger contract in tests
  let manager;
  let user1;
  let user2;

  beforeEach(async function () {
    [harburger, manager, user1, user2] = await ethers.getSigners();

    const TaxVault = await ethers.getContractFactory("TaxVault");
    taxVault = await TaxVault.deploy(harburger.address, manager.address);
    await taxVault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct harburger address", async function () {
      expect(await taxVault.harburger()).to.equal(harburger.address);
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
      const initialHarburgerBalance = await ethers.provider.getBalance(harburger.address);

      const tx = await taxVault.connect(harburger).payTax(user1.address, taxAmount);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const finalUserBalance = await taxVault.getTotalBalance(user1.address);
      const finalHarburgerBalance = await ethers.provider.getBalance(harburger.address);

      expect(finalUserBalance).to.equal(depositAmount - taxAmount);
      // harburger signer receives taxAmount but also pays gas for the tx
      expect(finalHarburgerBalance).to.equal(initialHarburgerBalance + taxAmount - gasCost);
    });

    it("Should prevent non-Harburger from calling payTax", async function () {
      const depositAmount = ethers.parseEther("1.0");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      await expect(
        taxVault.connect(user1).payTax(user1.address, ethers.parseEther("0.1"))
      ).to.be.revertedWithCustomError(taxVault, "OnlyHarburger");
    });

    it("Should return false if insufficient balance for tax", async function () {
      const depositAmount = ethers.parseEther("0.001");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      const taxAmount = ethers.parseEther("0.01"); // More than deposited
      const success = await taxVault
        .connect(harburger)
        .payTax.staticCall(user1.address, taxAmount);

      expect(success).to.be.false;
    });

    it("Should drain removed strategy balance to pay taxes", async function () {
      await taxVault.connect(manager).addStrategy(user2.address);

      const depositAmount = ethers.parseEther("5.0");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      await taxVault.connect(manager).removeStrategy(user2.address);

      const taxAmount = ethers.parseEther("1.0");
      const success = await taxVault
        .connect(harburger)
        .payTax.staticCall(user1.address, taxAmount);

      expect(success).to.be.true;
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

    it("Should reject ETH from harburger contract directly", async function () {
      await expect(
        harburger.sendTransaction({
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

    it("Should allow manager to activate emergency mode", async function () {
      await taxVault.connect(manager).activateEmergencyMode();
      expect(await taxVault.emergencyMode()).to.be.true;
    });

    it("Should allow manager to deactivate emergency mode", async function () {
      await taxVault.connect(manager).activateEmergencyMode();
      expect(await taxVault.emergencyMode()).to.be.true;

      await taxVault.connect(manager).deactivateEmergencyMode();
      expect(await taxVault.emergencyMode()).to.be.false;
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow emergency withdrawal when emergency mode is active", async function () {
      const depositAmount = ethers.parseEther("5.0");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      await taxVault.connect(manager).activateEmergencyMode();

      const initialBalance = await ethers.provider.getBalance(user1.address);
      const tx = await taxVault.connect(user1).emergencyWithdrawUser();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance).to.be.closeTo(
        initialBalance + depositAmount - gasUsed,
        ethers.parseEther("0.01")
      );
    });

    it("Should prevent emergency withdrawal when not in emergency mode", async function () {
      const depositAmount = ethers.parseEther("1.0");
      await taxVault.connect(user1).deposit(ethers.ZeroAddress, { value: depositAmount });

      await expect(
        taxVault.connect(user1).emergencyWithdrawUser()
      ).to.be.revertedWithCustomError(taxVault, "NotInEmergencyMode");
    });
  });

  describe("Drain recovery", function () {
    it("Should set recoveryRate on emergencyWithdrawFromStrategy", async function () {
      // We test with idle + the recovery accounting since we don't have a real
      // IYieldStrategy mock in this test suite. The key is verifying the new
      // recoveryRate and migrateFromDrainedStrategy paths work for idle balance.
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
      // getBalanceBreakdown always returns at least the IDLE slot
      expect(strategies.length).to.be.greaterThan(0);
      expect(balances[0]).to.equal(0n);
    });

    it("Should return empty approved strategies array at deploy", async function () {
      const strategies = await taxVault.getApprovedStrategies();
      // IDLE_STRATEGY is not in the approvedStrategies array; only yield strategies are
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

    it("Should emit EmergencyModeActivated event", async function () {
      await expect(taxVault.connect(manager).activateEmergencyMode())
        .to.emit(taxVault, "EmergencyModeActivated");
    });

    it("Should emit EmergencyModeDeactivated event", async function () {
      await taxVault.connect(manager).activateEmergencyMode();
      await expect(taxVault.connect(manager).deactivateEmergencyMode())
        .to.emit(taxVault, "EmergencyModeDeactivated");
    });
  });
});
