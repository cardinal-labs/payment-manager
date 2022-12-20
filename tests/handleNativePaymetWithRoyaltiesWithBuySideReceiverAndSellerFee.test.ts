import {
  createMint,
  executeTransaction,
  findMintEditionId,
  findMintMetadataId,
} from "@cardinal/common";
import {
  createCreateMasterEditionV3Instruction,
  createCreateMetadataAccountV2Instruction,
} from "@metaplex-foundation/mpl-token-metadata";
import { BN, Wallet, web3 } from "@project-serum/anchor";
import type { PublicKey } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";

import { DEFAULT_BUY_SIDE_FEE_SHARE } from "../sdk";
import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";
import {
  withHandleNativePaymentWithRoyalties,
  withInit,
} from "../sdk/transaction";
import type { CardinalProvider } from "./workspace";
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
  let mintId: PublicKey;
  let provider: CardinalProvider;

  beforeAll(async () => {
    provider = await getProvider();
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

    [, mintId] = await createMint(
      provider.connection,
      new Wallet(tokenCreator),
      {
        target: provider.wallet.publicKey,
      }
    );

    const metadataId = findMintMetadataId(mintId);
    const masterEditionId = findMintEditionId(mintId);
    const transaction = new Transaction().add(
      createCreateMetadataAccountV2Instruction(
        {
          metadata: metadataId,
          mint: mintId,
          mintAuthority: tokenCreator.publicKey,
          payer: tokenCreator.publicKey,
          updateAuthority: tokenCreator.publicKey,
        },
        {
          createMetadataAccountArgsV2: {
            isMutable: true,
            data: {
              name: "test",
              symbol: "TST",
              uri: "http://test/",
              sellerFeeBasisPoints: sellerFeeBasisPoints,
              creators: [
                {
                  address: tokenCreator.publicKey,
                  verified: true,
                  share: 0,
                },
                {
                  address: creator1.publicKey,
                  verified: false,
                  share: creator1Share.toNumber(),
                },
                {
                  address: creator2.publicKey,
                  verified: false,
                  share: creator2Share.toNumber(),
                },
                {
                  address: creator3.publicKey,
                  verified: false,
                  share: creator3Share.toNumber(),
                },
              ],
              collection: null,
              uses: null,
            },
          },
        }
      ),
      createCreateMasterEditionV3Instruction(
        {
          edition: masterEditionId,
          mint: mintId,
          updateAuthority: tokenCreator.publicKey,
          mintAuthority: tokenCreator.publicKey,
          metadata: metadataId,
          payer: tokenCreator.publicKey,
        },
        {
          createMasterEditionArgs: {
            maxSupply: new BN(0),
          },
        }
      )
    );
    await executeTransaction(
      provider.connection,
      transaction,
      new Wallet(tokenCreator)
    );
  });

  it("Create payment manager", async () => {
    const transaction = new web3.Transaction();

    await withInit(transaction, provider.connection, provider.wallet, {
      paymentManagerName,
      feeCollectorId: feeCollector.publicKey,
      makerFeeBasisPoints: MAKER_FEE.toNumber(),
      takerFeeBasisPoints: TAKER_FEE.toNumber(),
      includeSellerFeeBasisPoints,
      royaltyFeeShare: ROYALTEE_FEE_SHARE,
    });

    await executeTransaction(provider.connection, transaction, provider.wallet);

    const checkPaymentManagerId = findPaymentManagerAddress(paymentManagerName);
    const paymentManagerData = await getPaymentManager(
      provider.connection,
      checkPaymentManagerId
    );
    expect(paymentManagerData.parsed.name).toEqual(paymentManagerName);
    expect(paymentManagerData.parsed.makerFeeBasisPoints).toEqual(
      MAKER_FEE.toNumber()
    );
    expect(paymentManagerData.parsed.takerFeeBasisPoints).toEqual(
      TAKER_FEE.toNumber()
    );
    expect(paymentManagerData.parsed.includeSellerFeeBasisPoints).toBeTruthy();
    expect(paymentManagerData.parsed.royaltyFeeShare?.toNumber()).toEqual(
      ROYALTEE_FEE_SHARE.toNumber()
    );
  });

  it("Handle payment with royalties with seller fee", async () => {
    const transaction = new web3.Transaction();

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
      new Wallet(payer),
      {
        paymentManagerName,
        paymentAmount: new BN(paymentAmount),
        mintId: mintId,
        feeCollectorId: feeCollector.publicKey,
        paymentTargetId: paymentReceiver.publicKey,
        buySideTokenAccountId: buySideReceiver.publicKey,
        excludeCretors: [],
      }
    );
    await executeTransaction(
      provider.connection,
      transaction,
      new Wallet(payer)
    );

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
    expect(Number(creator1Info?.lamports)).toEqual(
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
    expect(Number(creator2Info?.lamports)).toEqual(
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
    expect(Number(creator3Info?.lamports)).toEqual(
      beforeCreator3Amount + creator3Funds.toNumber()
    );
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const buySideFee = paymentAmount
      .mul(new BN(DEFAULT_BUY_SIDE_FEE_SHARE))
      .div(BASIS_POINTS_DIVISOR);
    const buySideReceiverInfo = await provider.connection.getAccountInfo(
      buySideReceiver.publicKey
    );
    expect(Number(buySideReceiverInfo?.lamports)).toEqual(
      beforeBuysideAmount + buySideFee.toNumber()
    );
    const feeCollectorInfo = await provider.connection.getAccountInfo(
      feeCollector.publicKey
    );
    expect(Number(feeCollectorInfo?.lamports)).toEqual(
      beforeFeeCollectorAmount + totalFees.sub(feesPaidOut).toNumber()
    );

    const paymentReceiverInfo = await provider.connection.getAccountInfo(
      paymentReceiver.publicKey
    );
    expect(Number(paymentReceiverInfo?.lamports)).toEqual(
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
    ).toBeLessThanOrEqual(5000);
  });
});
