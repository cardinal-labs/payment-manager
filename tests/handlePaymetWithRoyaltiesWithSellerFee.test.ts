import {
  executeTransaction,
  findAta,
  withFindOrInitAssociatedTokenAccount,
} from "@cardinal/common";
import {
  CreateMasterEditionV3,
  CreateMetadataV2,
  Creator,
  DataV2,
  MasterEdition,
  Metadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { BN, Wallet, web3 } from "@project-serum/anchor";
import type { Token } from "@solana/spl-token";
import * as splToken from "@solana/spl-token";
import type { AccountMeta } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";

import { DEFAULT_BUY_SIDE_FEE_SHARE } from "../sdk";
import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";
import { withHandlePaymentWithRoyalties, withInit } from "../sdk/transaction";
import { withRemainingAccountsForPayment } from "../sdk/utils";
import { createMint } from "./utils";
import type { CardinalProvider } from "./workspace";
import { getProvider } from "./workspace";

describe("Handle payment with royalties with seller fee", () => {
  const includeSellerFeeBasisPoints = true;
  const MAKER_FEE = new BN(500);
  const TAKER_FEE = new BN(300);
  const ROYALTEE_FEE_SHARE = new BN(4500);
  const BASIS_POINTS_DIVISOR = new BN(10000);
  const paymentAmount = new BN(1000);
  const sellerFeeBasisPoints = 100;
  const RECIPIENT_START_PAYMENT_AMOUNT = new BN(10000000000);
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
  let paymentMint: Token;
  let rentalMint: Token;
  let provider: CardinalProvider;

  beforeAll(async () => {
    provider = await getProvider();
    const airdropCreator = await provider.connection.requestAirdrop(
      tokenCreator.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropCreator);

    // create payment mint
    [, paymentMint] = await createMint(
      provider.connection,
      tokenCreator,
      provider.wallet.publicKey,
      RECIPIENT_START_PAYMENT_AMOUNT.toNumber()
    );

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
    const transaction = new Transaction().add(
      ...metadataTx.instructions,
      ...masterEditionTx.instructions
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
    const paymentManagerId = findPaymentManagerAddress(paymentManagerName);

    const [paymentTokenAccountId, feeCollectorTokenAccount, _accounts] =
      await withRemainingAccountsForPayment(
        transaction,
        provider.connection,
        provider.wallet,
        rentalMint.publicKey,
        paymentMint.publicKey,
        paymentReceiver.publicKey,
        paymentManagerId
      );
    const royaltiesRemainingAccounts: AccountMeta[] = [];

    ///
    const creator1MintTokenAccount = await findAta(
      paymentMint.publicKey,
      creator1.publicKey,
      true
    );
    royaltiesRemainingAccounts.push({
      pubkey: creator1MintTokenAccount,
      isSigner: false,
      isWritable: true,
    });

    const creator2MintTokenAccount = await findAta(
      paymentMint.publicKey,
      creator2.publicKey,
      true
    );
    royaltiesRemainingAccounts.push({
      pubkey: creator2MintTokenAccount,
      isSigner: false,
      isWritable: true,
    });

    const creator3MintTokenAccount = await findAta(
      paymentMint.publicKey,
      creator3.publicKey,
      true
    );
    royaltiesRemainingAccounts.push({
      pubkey: creator3MintTokenAccount,
      isSigner: false,
      isWritable: true,
    });
    ///

    const payerTokenAccountId = await withFindOrInitAssociatedTokenAccount(
      transaction,
      provider.connection,
      paymentMint.publicKey,
      provider.wallet.publicKey,
      provider.wallet.publicKey,
      true
    );

    const paymentMintInfo = new splToken.Token(
      provider.connection,
      paymentMint.publicKey,
      splToken.TOKEN_PROGRAM_ID,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      null
    );
    const creator1Ata = await findAta(
      paymentMint.publicKey,
      creator1.publicKey,
      true
    );
    const creator2Ata = await findAta(
      paymentMint.publicKey,
      creator2.publicKey,
      true
    );
    const creator3Ata = await findAta(
      paymentMint.publicKey,
      creator3.publicKey,
      true
    );

    await expect(paymentMintInfo.getAccountInfo(creator1Ata)).rejects.toThrow();
    await expect(paymentMintInfo.getAccountInfo(creator2Ata)).rejects.toThrow();
    await expect(paymentMintInfo.getAccountInfo(creator3Ata)).rejects.toThrow();

    let beforePaymentTokenAccountAmount = new BN(0);
    try {
      beforePaymentTokenAccountAmount = (
        await paymentMintInfo.getAccountInfo(paymentTokenAccountId)
      ).amount;
    } catch (e) {
      // pass
    }
    let beforePayerTokenAccountAmount = new BN(0);
    try {
      beforePayerTokenAccountAmount = (
        await paymentMintInfo.getAccountInfo(payerTokenAccountId)
      ).amount;
    } catch (e) {
      // pass
    }

    await withHandlePaymentWithRoyalties(
      transaction,
      provider.connection,
      provider.wallet,
      {
        paymentManagerName,
        paymentAmount: new BN(paymentAmount),
        mintId: rentalMint.publicKey,
        paymentMintId: paymentMint.publicKey,
        payerTokenAccountId: payerTokenAccountId,
        feeCollectorTokenAccountId: feeCollectorTokenAccount,
        paymentTokenAccountId: paymentTokenAccountId,
        excludeCretors: [],
      }
    );

    await executeTransaction(provider.connection, transaction, provider.wallet);

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
    const creator1AtaInfo = await paymentMintInfo.getAccountInfo(creator1Ata);
    expect(Number(creator1AtaInfo.amount)).toEqual(creator1Funds.toNumber());
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const creator2Funds = totalCreatorsFee
      .mul(creator2Share)
      .div(new BN(100))
      .add(new BN(cretorsFeeRemainder > 0 ? 1 : 0));
    feesPaidOut = feesPaidOut.add(creator2Funds);
    const creator2AtaInfo = await paymentMintInfo.getAccountInfo(creator2Ata);
    expect(Number(creator2AtaInfo.amount)).toEqual(creator2Funds.toNumber());
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const creator3Funds = totalCreatorsFee
      .mul(creator3Share)
      .div(new BN(100))
      .add(new BN(cretorsFeeRemainder > 0 ? 1 : 0));
    feesPaidOut = feesPaidOut.add(creator3Funds);
    const creator3AtaInfo = await paymentMintInfo.getAccountInfo(creator3Ata);
    expect(Number(creator3AtaInfo.amount)).toEqual(creator3Funds.toNumber());
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const buySideFee = paymentAmount
      .mul(new BN(DEFAULT_BUY_SIDE_FEE_SHARE))
      .div(BASIS_POINTS_DIVISOR);
    const feeCollectorAtaInfo = await paymentMintInfo.getAccountInfo(
      feeCollectorTokenAccount
    );
    expect(Number(feeCollectorAtaInfo.amount)).toEqual(
      totalFees.add(buySideFee).sub(feesPaidOut).toNumber()
    );

    const paymentAtaInfo = await paymentMintInfo.getAccountInfo(
      paymentTokenAccountId
    );
    expect(Number(paymentAtaInfo.amount)).toEqual(
      beforePaymentTokenAccountAmount
        .add(paymentAmount.add(takerFee).sub(totalFees).sub(buySideFee))
        .toNumber()
    );

    const afterPayerTokenAccountAmount = (
      await paymentMintInfo.getAccountInfo(payerTokenAccountId)
    ).amount;
    expect(
      beforePayerTokenAccountAmount.sub(afterPayerTokenAccountAmount).toNumber()
    ).toEqual(paymentAmount.add(takerFee).toNumber());
  });
});
