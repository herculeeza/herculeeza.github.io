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
  const SECONDS_PER_YEAR = 31536000n;
  const RATE_PRECISION = 10n ** 18n;
  const TAX_RATE = (10n * RATE_PRECISION) / (100n * SECONDS_PER_YEAR);
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
      await harburger.connect(owner).deposit({ value: ethers.parseEther("1.0") });
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
      expect(finalBuyerBalance).to.equal(initialBuyerBalance - INITIAL_PRICE);
      const tolerance = ethers.parseEther("0.001");
      expect(finalOwnerBalance).to.be.closeTo(initialOwnerBalance + INITIAL_PRICE, tolerance);
    });

    it("Should revert if buyer has insufficient balance", async function () {
      await harburger.connect(addr3).deposit({ value: ethers.parseEther("0.01") });
      await expect(
        harburger.connect(addr3).buyNFT(ethers.parseEther("0.2"))
      ).to.be.revertedWithCustomError(harburger, "InsufficientBalance");
    });
  });

  describe("Tax System", function () {
    beforeEach(async function () {
      await harburger.connect(owner).deposit({ value: ethers.parseEther("1.0") });
    });

    it("Should calculate taxes with RATE_PRECISION", async function () {
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");
      const taxesOwed = await harburger.calculateTaxes(owner.address);
      const expectedTax = (INITIAL_PRICE * TAX_RATE * 100n) / RATE_PRECISION;
      expect(taxesOwed).to.be.closeTo(expectedTax, ethers.parseEther("0.0001"));
    });

    it("Should produce reasonable annual tax amounts", async function () {
      await ethers.provider.send("evm_increaseTime", [31536000]);
      await ethers.provider.send("evm_mine");
      const taxesOwed = await harburger.calculateTaxes(owner.address);
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

  describe("NFT Trading - Earmark Clearing", function () {
    beforeEach(async function () {
      await harburger.connect(owner).deposit({ value: ethers.parseEther("1.0") });
      await harburger.connect(buyer).deposit({ value: ethers.parseEther("0.5") });
    });

    it("Should clear active earmark when NFT is bought", async function () {
      await harburger.connect(owner).deposit({ value: ethers.parseEther("0.01") });
      await harburger.connect(owner).earmarkNFT(addr3.address, 0);

      await harburger.connect(buyer).buyNFT(ethers.parseEther("0.2"));

      const earmark = await harburger.earmark();
      expect(earmark.active).to.be.false;
    });
  });
});
