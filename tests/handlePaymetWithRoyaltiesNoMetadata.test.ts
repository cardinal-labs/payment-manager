import {
  createMint,
  executeTransaction,
  withFindOrInitAssociatedTokenAccount,
} from "@cardinal/common";
import { BN, Wallet, web3 } from "@project-serum/anchor";
import { getAccount } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

import { DEFAULT_BUY_SIDE_FEE_SHARE } from "../sdk";
import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";
import { withHandlePaymentWithRoyalties, withInit } from "../sdk/transaction";
import { withRemainingAccountsForPayment } from "../sdk/utils";
import type { CardinalProvider } from "./workspace";
import { getProvider } from "./workspace";

describe("Handle payment with royalties with no metadata", () => {
  const includeSellerFeeBasisPoints = false;
  const MAKER_FEE = new BN(500);
  const TAKER_FEE = new BN(300);
  const ROYALTEE_FEE_SHARE = new BN(5000);
  const BASIS_POINTS_DIVISOR = new BN(10000);
  const paymentAmount = new BN(1000);
  const RECIPIENT_START_PAYMENT_AMOUNT = new BN(10000000000);
  const paymentManagerName = Math.random().toString(36).slice(2, 7);
  const feeCollector = Keypair.generate();
  const paymentReceiver = Keypair.generate();

  const tokenCreator = Keypair.generate();
  let paymentMintId: PublicKey;
  let mintId: PublicKey;
  let provider: CardinalProvider;

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
  });

  it("Handle payment with royalties", async () => {
    const transaction = new web3.Transaction();
    const paymentManagerId = findPaymentManagerAddress(paymentManagerName);

    const [paymentTokenAccountId, feeCollectorTokenAccountId, _accounts] =
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

    let beforePayerTokenAccountAmount = 0;
    try {
      beforePayerTokenAccountAmount = Number(
        (await getAccount(provider.connection, payerTokenAccountId)).amount
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
        feeCollectorTokenAccountId: feeCollectorTokenAccountId,
        paymentTokenAccountId: paymentTokenAccountId,
        excludeCretors: [],
      }
    );

    await executeTransaction(provider.connection, transaction, provider.wallet);

    const makerFee = paymentAmount.mul(MAKER_FEE).div(BASIS_POINTS_DIVISOR);
    const takerFee = paymentAmount.mul(TAKER_FEE).div(BASIS_POINTS_DIVISOR);
    let totalFees = makerFee.add(takerFee);
    const feesPaidOut = new BN(0);

    const sellerFee = new BN(0);
    totalFees = totalFees.add(sellerFee);

    const buySideFee = paymentAmount
      .mul(new BN(DEFAULT_BUY_SIDE_FEE_SHARE))
      .div(BASIS_POINTS_DIVISOR);
    const feeCollectorAtaInfo = await getAccount(
      provider.connection,
      feeCollectorTokenAccountId
    );
    expect(Number(feeCollectorAtaInfo.amount)).toEqual(
      totalFees.add(buySideFee).sub(feesPaidOut).toNumber()
    );

    const afterPayerTokenAccountAmount = (
      await getAccount(provider.connection, payerTokenAccountId)
    ).amount;
    expect(
      beforePayerTokenAccountAmount - Number(afterPayerTokenAccountAmount)
    ).toEqual(paymentAmount.add(takerFee).toNumber());
  });
});
