import { BN, Wallet, web3 } from "@coral-xyz/anchor";
import {
  createCreateMasterEditionV3Instruction,
  createCreateMetadataAccountV2Instruction,
} from "@metaplex-foundation/mpl-token-metadata";
import { getAccount } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import {
  createMint,
  executeTransaction,
  findAta,
  findMintEditionId,
  findMintMetadataId,
  withFindOrInitAssociatedTokenAccount,
} from "@solana-nft-programs/common";

import { DEFAULT_BUY_SIDE_FEE_SHARE } from "../sdk";
import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";
import { withHandlePaymentWithRoyalties, withInit } from "../sdk/transaction";
import { withRemainingAccountsForPayment } from "../sdk/utils";
import type { SolanaProvider } from "./workspace";
import { getProvider } from "./workspace";

describe("Handle payment with royalties with buy side receiver and seller fee", () => {
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
  const buySideReceiver = Keypair.generate();
  let paymentMintId: PublicKey;
  let mintId: PublicKey;
  let provider: SolanaProvider;

  beforeAll(async () => {
    provider = await getProvider();
    const airdropCreator = await provider.connection.requestAirdrop(
      tokenCreator.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropCreator);

    [, paymentMintId] = await createMint(
      provider.connection,
      new Wallet(tokenCreator),
      {
        target: provider.wallet.publicKey,
        amount: RECIPIENT_START_PAYMENT_AMOUNT.toNumber(),
      }
    );

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
    const paymentManagerId = findPaymentManagerAddress(paymentManagerName);

    const buySideReceiverTokenAccountId =
      await withFindOrInitAssociatedTokenAccount(
        transaction,
        provider.connection,
        paymentMintId,
        buySideReceiver.publicKey,
        provider.wallet.publicKey,
        true
      );

    const [paymentTokenAccountId, feeCollectorTokenAccount, _accounts] =
      await withRemainingAccountsForPayment(
        transaction,
        provider.connection,
        provider.wallet,
        mintId,
        paymentMintId,
        paymentReceiver.publicKey,
        paymentManagerId
      );

    const payerTokenAccountId = await withFindOrInitAssociatedTokenAccount(
      transaction,
      provider.connection,
      paymentMintId,
      provider.wallet.publicKey,
      provider.wallet.publicKey,
      true
    );

    const creator1Ata = await findAta(paymentMintId, creator1.publicKey, true);
    const creator2Ata = await findAta(paymentMintId, creator2.publicKey, true);
    const creator3Ata = await findAta(paymentMintId, creator3.publicKey, true);

    await expect(
      getAccount(provider.connection, creator1Ata)
    ).rejects.toThrow();
    await expect(
      getAccount(provider.connection, creator2Ata)
    ).rejects.toThrow();
    await expect(
      getAccount(provider.connection, creator3Ata)
    ).rejects.toThrow();

    let beforePaymentTokenAccountAmount = new BN(0);
    try {
      beforePaymentTokenAccountAmount = new BN(
        Number(
          (await getAccount(provider.connection, paymentTokenAccountId)).amount
        )
      );
    } catch (e) {
      // pass
    }
    let beforePayerTokenAccountAmount = new BN(0);
    try {
      beforePayerTokenAccountAmount = new BN(
        Number(
          (await getAccount(provider.connection, payerTokenAccountId)).amount
        )
      );
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
        mintId: mintId,
        paymentMintId: paymentMintId,
        payerTokenAccountId: payerTokenAccountId,
        feeCollectorTokenAccountId: feeCollectorTokenAccount,
        paymentTokenAccountId: paymentTokenAccountId,
        buySideTokenAccountId: buySideReceiverTokenAccountId,
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
    const creator1AtaInfo = await getAccount(provider.connection, creator1Ata);
    expect(Number(creator1AtaInfo.amount)).toEqual(creator1Funds.toNumber());
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const creator2Funds = totalCreatorsFee
      .mul(creator2Share)
      .div(new BN(100))
      .add(new BN(cretorsFeeRemainder > 0 ? 1 : 0));
    feesPaidOut = feesPaidOut.add(creator2Funds);
    const creator2AtaInfo = await getAccount(provider.connection, creator2Ata);
    expect(Number(creator2AtaInfo.amount)).toEqual(creator2Funds.toNumber());
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const creator3Funds = totalCreatorsFee
      .mul(creator3Share)
      .div(new BN(100))
      .add(new BN(cretorsFeeRemainder > 0 ? 1 : 0));
    feesPaidOut = feesPaidOut.add(creator3Funds);
    const creator3AtaInfo = await getAccount(provider.connection, creator3Ata);
    expect(Number(creator3AtaInfo.amount)).toEqual(creator3Funds.toNumber());
    cretorsFeeRemainder = cretorsFeeRemainder > 0 ? cretorsFeeRemainder - 1 : 0;

    const buySideFee = paymentAmount
      .mul(new BN(DEFAULT_BUY_SIDE_FEE_SHARE))
      .div(BASIS_POINTS_DIVISOR);
    const buySideReceiverAtaInfo = await getAccount(
      provider.connection,
      buySideReceiverTokenAccountId
    );
    expect(Number(buySideReceiverAtaInfo.amount)).toEqual(
      buySideFee.toNumber()
    );
    const feeCollectorAtaInfo = await getAccount(
      provider.connection,
      feeCollectorTokenAccount
    );
    expect(Number(feeCollectorAtaInfo.amount)).toEqual(
      totalFees.sub(feesPaidOut).toNumber()
    );

    const paymentAtaInfo = await getAccount(
      provider.connection,
      paymentTokenAccountId
    );
    expect(Number(paymentAtaInfo.amount)).toEqual(
      beforePaymentTokenAccountAmount
        .add(paymentAmount.add(takerFee).sub(totalFees).sub(buySideFee))
        .toNumber()
    );

    const afterPayerTokenAccountAmount = new BN(
      Number(
        (await getAccount(provider.connection, payerTokenAccountId)).amount
      )
    );
    expect(
      beforePayerTokenAccountAmount.sub(afterPayerTokenAccountAmount).toNumber()
    ).toEqual(paymentAmount.add(takerFee).toNumber());
  });
});
