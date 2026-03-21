const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Harburger", function () {
  let harburger;
  let owner;
  let taxReceiver;
  let buyer;
  let addr3;

  const NFT_NAME = "Test Harburger";
  const NFT_SYMBOL = "THBRG";
  // 10% annual tax rate scaled by RATE_PRECISION (1e18)
  // = 0.10 / 31_536_000 * 1e18 ≈ 3_170_979_198
  const SECONDS_PER_YEAR = 31536000n;
  const RATE_PRECISION = 10n ** 18n;
  const TAX_RATE = (10n * RATE_PRECISION) / (100n * SECONDS_PER_YEAR); // ~3170979198
  // Price in wei (0.1 ETH)
  const INITIAL_PRICE = ethers.parseEther("0.1");

  beforeEach(async function () {
    [owner, taxReceiver, buyer, addr3] = await ethers.getSigners();

    const Harburger = await ethers.getContractFactory("Harburger");
    harburger = await Harburger.deploy(
      NFT_NAME,
      NFT_SYMBOL,
      TAX_RATE,
      taxReceiver.address,
      INITIAL_PRICE,
      ethers.ZeroAddress // TaxVault placeholder
    );
    await harburger.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await harburger.currentOwner()).to.equal(owner.address);
    });

    it("Should mint NFT to deployer", async function () {
      expect(await harburger.ownerOf(1)).to.equal(owner.address);
    });

    it("Should set correct initial parameters", async function () {
      expect(await harburger.taxRate()).to.equal(TAX_RATE);
      expect(await harburger.taxReceiver()).to.equal(taxReceiver.address);
      expect(await harburger.currentPrice()).to.equal(INITIAL_PRICE);
    });

    it("Should expose RATE_PRECISION constant", async function () {
      expect(await harburger.RATE_PRECISION()).to.equal(RATE_PRECISION);
    });
  });

  describe("Deposits and Withdrawals", function () {
    it("Should allow deposits", async function () {
      const depositAmount = ethers.parseEther("0.5");

      await harburger.connect(buyer).deposit({ value: depositAmount });

      const [balance] = await harburger.getAccountBalance(buyer.address);
      expect(balance).to.equal(depositAmount);
    });

    it("Should allow withdrawals", async function () {
      const depositAmount = ethers.parseEther("0.5");
      await harburger.connect(buyer).deposit({ value: depositAmount });

      const withdrawAmount = ethers.parseEther("0.2");
      await harburger.connect(buyer).withdraw(withdrawAmount);

      const [balance] = await harburger.getAccountBalance(buyer.address);
      expect(balance).to.equal(depositAmount - withdrawAmount);
    });

    it("Should revert withdrawal with insufficient balance", async function () {
      await expect(
        harburger.connect(buyer).withdraw(ethers.parseEther("1.0"))
      ).to.be.revertedWithCustomError(harburger, "InsufficientBalance");
    });
  });

  describe("Price Setting", function () {
    it("Should allow owner to set price", async function () {
      const newPrice = ethers.parseEther("0.5");
      await harburger.connect(owner).setPrice(newPrice);

      expect(await harburger.currentPrice()).to.equal(newPrice);
    });

    it("Should revert if non-owner tries to set price", async function () {
      await expect(
        harburger.connect(buyer).setPrice(ethers.parseEther("0.5"))
      ).to.be.revertedWithCustomError(harburger, "OnlyNFTOwner");
    });
  });

  describe("NFT Trading", function () {
    beforeEach(async function () {
      // Owner deposits so accrued taxes don't push them into debt
      // (debt triggers the free-buy/forgiveness path, bypassing normal payment)
      await harburger.connect(owner).deposit({ value: ethers.parseEther("1.0") });
      // Give buyer enough balance to cover the current price
      await harburger.connect(buyer).deposit({ value: ethers.parseEther("0.5") });
    });

    it("Should allow buying NFT", async function () {
      const newPrice = ethers.parseEther("0.2");

      await harburger.connect(buyer).buyNFT(newPrice);

      expect(await harburger.currentOwner()).to.equal(buyer.address);
      expect(await harburger.currentPrice()).to.equal(newPrice);
      expect(await harburger.ownerOf(1)).to.equal(buyer.address);
    });

    it("Should transfer payment correctly", async function () {
      const [initialBuyerBalance] = await harburger.getAccountBalance(buyer.address);
      const [initialOwnerBalance] = await harburger.getAccountBalance(owner.address);

      await harburger.connect(buyer).buyNFT(ethers.parseEther("0.2"));

      const [finalBuyerBalance] = await harburger.getAccountBalance(buyer.address);
      const [finalOwnerBalance] = await harburger.getAccountBalance(owner.address);

      // Buyer paid INITIAL_PRICE; owner received it (minus small accrued taxes)
      expect(finalBuyerBalance).to.equal(initialBuyerBalance - INITIAL_PRICE);
      const tolerance = ethers.parseEther("0.001"); // small tax accrual between blocks
      expect(finalOwnerBalance).to.be.closeTo(initialOwnerBalance + INITIAL_PRICE, tolerance);
    });

    it("Should revert if buyer has insufficient balance", async function () {
      // addr3 deposits much less than INITIAL_PRICE
      await harburger.connect(addr3).deposit({ value: ethers.parseEther("0.01") });

      await expect(
        harburger.connect(addr3).buyNFT(ethers.parseEther("0.2"))
      ).to.be.revertedWithCustomError(harburger, "InsufficientBalance");
    });

    it("Should clear active earmark when NFT is bought", async function () {
      // Owner creates an earmark for addr3
      await harburger.connect(owner).deposit({ value: ethers.parseEther("0.01") });
      await harburger.connect(owner).earmarkNFT(addr3.address, 0);

      // Buyer buys the NFT
      await harburger.connect(buyer).buyNFT(ethers.parseEther("0.2"));

      // Earmark must be cleared — addr3 cannot claim after the sale
      const earmark = await harburger.earmark();
      expect(earmark.active).to.be.false;
    });
  });

  describe("Earmark System", function () {
    beforeEach(async function () {
      await harburger.connect(owner).deposit({ value: ethers.parseEther("0.5") });
    });

    it("Should allow owner to earmark NFT", async function () {
      const deposit = ethers.parseEther("0.1");

      await harburger.connect(owner).earmarkNFT(buyer.address, deposit);

      const earmark = await harburger.earmark();
      expect(earmark.creator).to.equal(owner.address);
      expect(earmark.receiver).to.equal(buyer.address);
      expect(earmark.depositAmount).to.equal(deposit);
      expect(earmark.active).to.be.true;
    });

    it("Should allow earmark receiver to claim NFT", async function () {
      const deposit = ethers.parseEther("0.1");
      const newPrice = ethers.parseEther("0.2");

      await harburger.connect(owner).earmarkNFT(buyer.address, deposit);
      await harburger.connect(buyer).claimEarmark(newPrice);

      expect(await harburger.currentOwner()).to.equal(buyer.address);
      expect(await harburger.currentPrice()).to.equal(newPrice);

      const [buyerBalance] = await harburger.getAccountBalance(buyer.address);
      expect(buyerBalance).to.equal(deposit);
    });

    it("Should return earmark deposit to creator on cancel", async function () {
      const deposit = ethers.parseEther("0.1");
      const [balanceBefore] = await harburger.getAccountBalance(owner.address);

      await harburger.connect(owner).earmarkNFT(buyer.address, deposit);

      await harburger.connect(owner).cancelEarmark();

      const earmark = await harburger.earmark();
      expect(earmark.active).to.be.false;

      const [balanceAfter] = await harburger.getAccountBalance(owner.address);
      expect(balanceAfter).to.be.closeTo(balanceBefore, ethers.parseEther("0.001"));
    });
  });

  describe("Tax System", function () {
    beforeEach(async function () {
      await harburger.connect(owner).deposit({ value: ethers.parseEther("1.0") });
    });

    it("Should calculate taxes with RATE_PRECISION", async function () {
      // Advance 100 seconds
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      const taxesOwed = await harburger.calculateTaxes(owner.address);
      // formula: (price * taxRate * elapsed) / RATE_PRECISION
      const expectedTax = (INITIAL_PRICE * TAX_RATE * 100n) / RATE_PRECISION;

      expect(taxesOwed).to.be.closeTo(expectedTax, ethers.parseEther("0.0001"));
    });

    it("Should produce reasonable annual tax amounts", async function () {
      // Advance 1 year
      await ethers.provider.send("evm_increaseTime", [31536000]);
      await ethers.provider.send("evm_mine");

      const taxesOwed = await harburger.calculateTaxes(owner.address);
      // 10% of 0.1 ETH = 0.01 ETH per year
      const expectedAnnualTax = ethers.parseEther("0.01");

      expect(taxesOwed).to.be.closeTo(expectedAnnualTax, ethers.parseEther("0.0001"));
    });

    it("Should update taxes when setting price", async function () {
      const [initialBalance] = await harburger.getAccountBalance(owner.address);

      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      await harburger.connect(owner).setPrice(ethers.parseEther("0.2"));

      const [finalBalance] = await harburger.getAccountBalance(owner.address);
      expect(finalBalance).to.be.lt(initialBalance);
    });

    it("Should allow tax receiver to withdraw accumulated taxes", async function () {
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      // Trigger tax settlement
      await harburger.connect(owner).setPrice(INITIAL_PRICE);

      const [taxBalance] = await harburger.getAccountBalance(taxReceiver.address);
      expect(taxBalance).to.be.gt(0n);

      await harburger.connect(taxReceiver).withdraw(taxBalance);

      const [finalTaxBalance] = await harburger.getAccountBalance(taxReceiver.address);
      expect(finalTaxBalance).to.equal(0n);
    });
  });

  describe("Token URI", function () {
    it("Should return on-chain base64 JSON with SVG image", async function () {
      const tokenURI = await harburger.tokenURI(1);
      expect(tokenURI).to.match(/^data:application\/json;base64,/);

      const json = JSON.parse(
        Buffer.from(tokenURI.split(",")[1], "base64").toString()
      );
      expect(json.name).to.include("Test Harburger");
      expect(json.description).to.be.a("string");
      expect(json.image).to.match(/^data:image\/svg\+xml;base64,/);
    });

    it("Should revert for non-existent token", async function () {
      await expect(harburger.tokenURI(999)).to.be.reverted;
    });
  });

  describe("Debt-triggered free buy", function () {
    it("Should allow free acquisition when owner has debt", async function () {
      // Owner has no deposit — taxes will push them into debt
      await ethers.provider.send("evm_increaseTime", [86400]); // 1 day
      await ethers.provider.send("evm_mine");

      // Trigger tax settlement so debt accrues
      await harburger.settleTaxes(owner.address);

      const [, ownerDebt] = await harburger.getAccountBalance(owner.address);
      expect(ownerDebt).to.be.gt(0n);

      // Buyer needs no balance — NFT is free when owner is in debt
      await harburger.connect(buyer).buyNFT(ethers.parseEther("0.05"));

      expect(await harburger.currentOwner()).to.equal(buyer.address);
      // Owner's debt should be forgiven
      const [, debtAfter] = await harburger.getAccountBalance(owner.address);
      expect(debtAfter).to.equal(0n);
    });

    it("Should reject free buy if buyer also has debt", async function () {
      // Step 1: buyer becomes owner, sets high price, drains balance into debt
      await harburger.connect(owner).deposit({ value: ethers.parseEther("1.0") });
      await harburger.connect(buyer).deposit({ value: ethers.parseEther("0.5") });
      await harburger.connect(buyer).buyNFT(ethers.parseEther("100"));

      await ethers.provider.send("evm_increaseTime", [60 * 86400]);
      await ethers.provider.send("evm_mine");

      // Step 2: transfer via earmark (does NOT forgive buyer's debt, unlike buyNFT)
      await harburger.connect(buyer).earmarkNFT(addr3.address, 0);
      await harburger.connect(addr3).claimEarmark(ethers.parseEther("100"));

      const [, buyerDebt] = await harburger.getAccountBalance(buyer.address);
      expect(buyerDebt).to.be.gt(0n);

      // Step 3: addr3 accrues debt too (no balance, high price)
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");
      await harburger.settleTaxes(addr3.address);
      const [, addr3Debt] = await harburger.getAccountBalance(addr3.address);
      expect(addr3Debt).to.be.gt(0n);

      // buyer tries to buy — addr3 has debt (free buy), but buyer also has debt
      await expect(
        harburger.connect(buyer).buyNFT(ethers.parseEther("0.05"))
      ).to.be.revertedWithCustomError(harburger, "BuyerHasDebt");
    });
  });

  describe("Vault-integrated tax payment", function () {
    let taxVault;

    beforeEach(async function () {
      const TaxVault = await ethers.getContractFactory("TaxVault");
      taxVault = await TaxVault.deploy(await harburger.getAddress(), owner.address);
      await taxVault.waitForDeployment();
      await harburger.updateTaxVault(await taxVault.getAddress());

      // Enable vault for owner and deposit into it
      await harburger.connect(owner).enableVault();
      await taxVault.connect(owner).deposit(ethers.ZeroAddress, { value: ethers.parseEther("1.0") });
    });

    it("Should pay taxes from vault when enabled", async function () {
      const vaultBefore = await taxVault.getTotalBalance(owner.address);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      // Trigger settlement
      await harburger.connect(owner).setPrice(INITIAL_PRICE);

      const vaultAfter = await taxVault.getTotalBalance(owner.address);
      expect(vaultAfter).to.be.lt(vaultBefore);

      // Tax receiver should have received funds
      const [receiverBal] = await harburger.getAccountBalance(taxReceiver.address);
      expect(receiverBal).to.be.gt(0n);
    });

    it("Should fall back to internal balance when vault is insufficient", async function () {
      // Deposit a large internal balance too
      await harburger.connect(owner).deposit({ value: ethers.parseEther("5.0") });

      // Set a very high price so one day of taxes exceeds vault balance (1 ETH)
      // 10% annual on 100_000 ETH => 10_000 ETH/yr => ~27.4 ETH/day
      await harburger.connect(owner).setPrice(ethers.parseEther("100000"));

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      // Trigger settlement — vault (1 ETH) won't cover it, internal (5 ETH) picks up the rest
      await harburger.connect(owner).setPrice(ethers.parseEther("100000"));

      const vaultAfter = await taxVault.getTotalBalance(owner.address);
      expect(vaultAfter).to.equal(0n); // vault fully drained

      // Internal balance should also have been reduced
      const acc = await harburger.accounts(owner.address);
      expect(acc.balance).to.be.lt(ethers.parseEther("5.0"));
    });
  });

  describe("Admin: updateTaxReceiver", function () {
    it("Should migrate accumulated balance to new receiver", async function () {
      await harburger.connect(owner).deposit({ value: ethers.parseEther("1.0") });

      // Accrue and settle some taxes
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");
      await harburger.connect(owner).setPrice(INITIAL_PRICE);

      const [oldReceiverBal] = await harburger.getAccountBalance(taxReceiver.address);
      expect(oldReceiverBal).to.be.gt(0n);

      // Update tax receiver to addr3
      await harburger.updateTaxReceiver(addr3.address);

      // Old receiver balance should be zero, new receiver inherits it
      const [oldAfter] = await harburger.getAccountBalance(taxReceiver.address);
      expect(oldAfter).to.equal(0n);

      const [newReceiverBal] = await harburger.getAccountBalance(addr3.address);
      expect(newReceiverBal).to.be.gte(oldReceiverBal);
    });
  });

  describe("Pause / Unpause", function () {
    it("Should freeze user-facing functions when paused", async function () {
      await harburger.pause();

      await expect(
        harburger.connect(buyer).deposit({ value: ethers.parseEther("1.0") })
      ).to.be.revertedWith("Pausable: paused");

      await expect(
        harburger.connect(owner).setPrice(ethers.parseEther("0.5"))
      ).to.be.revertedWith("Pausable: paused");

      await expect(
        harburger.connect(buyer).buyNFT(ethers.parseEther("0.2"))
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should not accrue taxes during paused period", async function () {
      await harburger.connect(owner).deposit({ value: ethers.parseEther("1.0") });

      await harburger.pause();
      const [balAtPause] = await harburger.getAccountBalance(owner.address);

      // Advance time while paused
      await ethers.provider.send("evm_increaseTime", [86400 * 30]); // 30 days
      await ethers.provider.send("evm_mine");

      await harburger.unpause();

      // Balance should be unchanged — no taxes during pause
      const [balAfterUnpause] = await harburger.getAccountBalance(owner.address);
      expect(balAfterUnpause).to.be.closeTo(balAtPause, ethers.parseEther("0.0001"));
    });
  });

  describe("Transfer Restrictions", function () {
    it("Should prevent direct transferFrom", async function () {
      await expect(
        harburger.connect(owner).transferFrom(owner.address, buyer.address, 1)
      ).to.be.revertedWithCustomError(harburger, "TransferNotAllowed");
    });

    it("Should prevent safeTransferFrom", async function () {
      await expect(
        harburger.connect(owner)["safeTransferFrom(address,address,uint256)"](
          owner.address,
          buyer.address,
          1
        )
      ).to.be.revertedWithCustomError(harburger, "TransferNotAllowed");
    });
  });
});
