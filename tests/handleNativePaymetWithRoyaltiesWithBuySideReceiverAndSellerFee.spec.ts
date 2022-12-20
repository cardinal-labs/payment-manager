import {
  CreateMasterEditionV3,
  CreateMetadataV2,
  Creator,
  DataV2,
  MasterEdition,
  Metadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { BN, web3 } from "@project-serum/anchor";
import { expectTXTable } from "@saberhq/chai-solana";
import {
  SignerWallet,
  SolanaProvider,
  TransactionEnvelope,
} from "@saberhq/solana-contrib";
import type { Token } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

import { DEFAULT_BUY_SIDE_FEE_SHARE } from "../sdk";
import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";
import {
  withHandleNativePaymentWithRoyalties,
  withInit,
} from "../sdk/transaction";
import { createMint } from "./utils";
import { getProvider } from "./workspace";

describe("Handle payment with royalties with buy side receiver and seller fee", () => {
  const includeSellerFeeBasisPoints = true;
  const MAKER_FEE = new BN(500);
  const TAKER_FEE = new BN(300);
  const ROYALTEE_FEE_SHARE = new BN(4500);
  const BASIS_POINTS_DIVISOR = new BN(10000);
  const paymentAmount = new BN(LAMPORTS_PER_SOL);
  const sellerFeeBasisPoints = 100;
  const paymentManagerName = Math.random().toString(36).slice(2, 7);
  const feeCollector = Keypair.generate();

  const creator1 = Keypair.generate();
  const creator1Share = new BN(15);
  const creator2 = Keypair.generate();
  const creator2Share = new BN(30);
  const creator3 = Keypair.generate();
  const creator3Share = new BN(55);
  const tokenCreator = Keypair.generate();
  const paymentReceiver = Keypair.generate();
  const payer = Keypair.generate();
  const buySideReceiver = Keypair.generate();
  let rentalMint: Token;

  before(async () => {
    const provider = getProvider();
    const airdropCreator = await provider.connection.requestAirdrop(
      tokenCreator.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropCreator);
    const paymentReceiverInfo = await provider.connection.requestAirdrop(
      paymentReceiver.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(paymentReceiverInfo);
    const buySideReceiverInfo = await provider.connection.requestAirdrop(
      buySideReceiver.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(buySideReceiverInfo);
    const feeCollectorInfo = await provider.connection.requestAirdrop(
      feeCollector.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(feeCollectorInfo);
    const payerInfo = await provider.connection.requestAirdrop(
      payer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(payerInfo);
    const creator1Info = await provider.connection.requestAirdrop(
      creator1.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(creator1Info);
    const creator2Info = await provider.connection.requestAirdrop(
      creator2.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(creator2Info);
    const creator3Info = await provider.connection.requestAirdrop(
      creator3.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(creator3Info);

    // create rental mint
    [, rentalMint] = await createMint(
      provider.connection,
      tokenCreator,
      provider.wallet.publicKey,
      1,
      tokenCreator.publicKey
    );

    // specify creators shares
    const metadataId = await Metadata.getPDA(rentalMint.publicKey);
    const metadataTx = new CreateMetadataV2(
      { feePayer: tokenCreator.publicKey },
      {
        metadata: metadataId,
        metadataData: new DataV2({
          name: "test",
          symbol: "TST",
          uri: "http://test/",
          sellerFeeBasisPoints: sellerFeeBasisPoints,
          creators: [
            new Creator({
              address: tokenCreator.publicKey.toString(),
              verified: true,
              share: 0,
            }),
            new Creator({
              address: creator1.publicKey.toString(),
              verified: false,
              share: creator1Share.toNumber(),
            }),
            new Creator({
              address: creator2.publicKey.toString(),
              verified: false,
              share: creator2Share.toNumber(),
            }),
            new Creator({
              address: creator3.publicKey.toString(),
              verified: false,
              share: creator3Share.toNumber(),
            }),
          ],
          collection: null,
          uses: null,
        }),
        updateAuthority: tokenCreator.publicKey,
        mint: rentalMint.publicKey,
        mintAuthority: tokenCreator.publicKey,
      }
    );

    const masterEditionId = await MasterEdition.getPDA(rentalMint.publicKey);
    const masterEditionTx = new CreateMasterEditionV3(
      { feePayer: tokenCreator.publicKey },
      {
        edition: masterEditionId,
        metadata: metadataId,
        updateAuthority: tokenCreator.publicKey,
        mint: rentalMint.publicKey,
        mintAuthority: tokenCreator.publicKey,
        maxSupply: new BN(1),
      }
    );
    const txEnvelope = new TransactionEnvelope(
      SolanaProvider.init({
        connection: provider.connection,
        wallet: new SignerWallet(tokenCreator),
        opts: provider.opts,
      }),
      [...metadataTx.instructions, ...masterEditionTx.instructions]
    );

    await expectTXTable(txEnvelope, "test", {
      verbosity: "error",
      formatLogs: true,
    }).to.be.fulfilled;
  });

  it("Create payment manager", async () => {
    const provider = getProvider();
    const transaction = new web3.Transaction();

    await withInit(transaction, provider.connection, provider.wallet, {
      paymentManagerName,
      feeCollectorId: feeCollector.publicKey,
      makerFeeBasisPoints: MAKER_FEE.toNumber(),
      takerFeeBasisPoints: TAKER_FEE.toNumber(),
      includeSellerFeeBasisPoints,
      royaltyFeeShare: ROYALTEE_FEE_SHARE,
    });

    const txEnvelope = new TransactionEnvelope(
      SolanaProvider.init({
        connection: provider.connection,
        wallet: provider.wallet,
        opts: provider.opts,
      }),
      [...transaction.instructions]
    );
    await expectTXTable(txEnvelope, "Create Payment Manager", {
      verbosity: "error",
      formatLogs: true,
    }).to.be.fulfilled;

    const checkPaymentManagerId = findPaymentManagerAddress(paymentManagerName);
    const paymentManagerData = await getPaymentManager(
      provider.connection,
      checkPaymentManagerId
    );
    expect(paymentManagerData.parsed.name).to.eq(paymentManagerName);
    expect(paymentManagerData.parsed.makerFeeBasisPoints).to.eq(
      MAKER_FEE.toNumber()
    );
    expect(paymentManagerData.parsed.takerFeeBasisPoints).to.eq(
      TAKER_FEE.toNumber()
    );
    expect(paymentManagerData.parsed.includeSellerFeeBasisPoints).to.be.true;
    expect(paymentManagerData.parsed.royaltyFeeShare?.toNumber()).to.eq(
      ROYALTEE_FEE_SHARE.toNumber()
    );
  });

  it("Handle payment with royalties with seller fee", async () => {
    const provider = getProvider();
    const transaction = new web3.Transaction();
    const metadataId = await Metadata.getPDA(rentalMint.publicKey);

    const beforeCreator1Amount =
      (await provider.connection.getAccountInfo(creator1.publicKey))
        ?.lamports || 0;
    const beforeCreator2Amount =
      (await provider.connection.getAccountInfo(creator2.publicKey))
        ?.lamports || 0;
    const beforeCreator3Amount =
      (await provider.connection.getAccountInfo(creator3.publicKey))
        ?.lamports || 0;
    const beforeBuysideAmount =
      (await provider.connection.getAccountInfo(buySideReceiver.publicKey))
        ?.lamports || 0;
    const beforeFeeCollectorAmount =
      (await provider.connection.getAccountInfo(feeCollector.publicKey))
        ?.lamports || 0;
    const beforePaymentAmount =
      (await provider.connection.getAccountInfo(paymentReceiver.publicKey))
        ?.lamports || 0;
    const beforePayerAmount =
      (await provider.connection.getAccountInfo(payer.publicKey))?.lamports ||
      0;

    await withHandleNativePaymentWithRoyalties(
      transaction,
      provider.connection,
      new SignerWallet(payer),
      {
        paymentManagerName,
        paymentAmount: new BN(paymentAmount),
        mintId: rentalMint.publicKey,
        feeCollectorId: feeCollector.publicKey,
        paymentTargetId: paymentReceiver.publicKey,
        buySideTokenAccountId: buySideReceiver.publicKey,
        excludeCretors: [],
      }
    );

    const txEnvelope = new TransactionEnvelope(
      SolanaProvider.init({
        connection: provider.connection,
        wallet: new SignerWallet(payer),
        opts: provider.opts,
      }),
      [...transaction.instructions]
    );
    await expectTXTable(
      txEnvelope,
      "Handle Payment With Royalties With Seller Fee",
      {
        verbosity: "error",
        formatLogs: true,
      }
    ).to.be.fulfilled;

    const makerFee = paymentAmount.mul(MAKER_FEE).div(BASIS_POINTS_DIVISOR);
    const takerFee = paymentAmount.mul(TAKER_FEE).div(BASIS_POINTS_DIVISOR);
    let totalFees = makerFee.add(takerFee);
    let feesPaidOut = new BN(0);

    const sellerFee = includeSellerFeeBasisPoints
      ? paymentAmount
          .mul(new BN(sellerFeeBasisPoints))
          .div(BASIS_POINTS_DIVISOR)
      : new BN(0);
    const totalCreatorsFee = totalFees
      .mul(ROYALTEE_FEE_SHARE)
      .div(BASIS_POINTS_DIVISOR)
      .add(sellerFee);
    totalFees = totalFees.add(sellerFee);
    let cretorsFeeRemainder = includeSellerFeeBasisPoints
      ? totalCreatorsFee
          .sub(
            [
              totalCreatorsFee.mul(creator1Share),
              totalCreatorsFee.mul(creator2Share),
              totalCreatorsFee.mul(creator3Share),
            ]
              .reduce((partialSum, a) => partialSum.add(a), new BN(0))
              .div(new BN(100))
          )
          .toNumber()
      : 0;

    const creator1Funds = totalCreatorsFee
      .mul(creator1Share)
      .div(new BN(100))
      .add(new BN(cretorsFeeRemainder > 0 ? 1 : 0));
    feesPaidOut = feesPaidOut.add(creator1Funds);
    const creator1Info = await provider.connection.getAccountInfo(
      creator1.publicKey
    );
    expect(Number(creator1Info?.lamports)).to.eq(
      beforeCreator1Amount + creator1Funds.toNumber()
    );
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const creator2Funds = totalCreatorsFee
      .mul(creator2Share)
      .div(new BN(100))
      .add(new BN(cretorsFeeRemainder > 0 ? 1 : 0));
    feesPaidOut = feesPaidOut.add(creator2Funds);
    const creator2Info = await provider.connection.getAccountInfo(
      creator2.publicKey
    );
    expect(Number(creator2Info?.lamports)).to.eq(
      beforeCreator2Amount + creator2Funds.toNumber()
    );
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const creator3Funds = totalCreatorsFee
      .mul(creator3Share)
      .div(new BN(100))
      .add(new BN(cretorsFeeRemainder > 0 ? 1 : 0));
    feesPaidOut = feesPaidOut.add(creator3Funds);
    const creator3Info = await provider.connection.getAccountInfo(
      creator3.publicKey
    );
    expect(Number(creator3Info?.lamports)).to.eq(
      beforeCreator3Amount + creator3Funds.toNumber()
    );
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const buySideFee = paymentAmount
      .mul(new BN(DEFAULT_BUY_SIDE_FEE_SHARE))
      .div(BASIS_POINTS_DIVISOR);
    const buySideReceiverInfo = await provider.connection.getAccountInfo(
      buySideReceiver.publicKey
    );
    expect(Number(buySideReceiverInfo?.lamports)).to.eq(
      beforeBuysideAmount + buySideFee.toNumber()
    );
    const feeCollectorInfo = await provider.connection.getAccountInfo(
      feeCollector.publicKey
    );
    expect(Number(feeCollectorInfo?.lamports)).to.eq(
      beforeFeeCollectorAmount + totalFees.sub(feesPaidOut).toNumber()
    );

    const paymentReceiverInfo = await provider.connection.getAccountInfo(
      paymentReceiver.publicKey
    );
    expect(Number(paymentReceiverInfo?.lamports)).to.eq(
      beforePaymentAmount +
        paymentAmount.add(takerFee).sub(totalFees).sub(buySideFee).toNumber()
    );

    const afterPayerAmount =
      (await provider.connection.getAccountInfo(payer.publicKey))?.lamports ||
      0;

    // account for gas fees
    expect(
      beforePayerAmount -
        afterPayerAmount -
        paymentAmount.add(takerFee).toNumber()
    ).to.be.lessThanOrEqual(5000);
  });
});
