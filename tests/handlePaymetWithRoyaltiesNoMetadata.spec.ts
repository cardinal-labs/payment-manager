import { withFindOrInitAssociatedTokenAccount } from "@cardinal/common";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
import { BN, web3 } from "@project-serum/anchor";
import { expectTXTable } from "@saberhq/chai-solana";
import { SolanaProvider, TransactionEnvelope } from "@saberhq/solana-contrib";
import type { Token } from "@solana/spl-token";
import * as splToken from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { DEFAULT_BUY_SIDE_FEE_SHARE } from "../sdk";
import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";
import { withHandlePaymentWithRoyalties, withInit } from "../sdk/transaction";
import { createMint, withRemainingAccountsForPayment } from "../sdk/utils";

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
  let paymentMint: Token;
  let rentalMint: Token;

  before(async () => {
    const provider = getProvider();
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
  });

  it("Create payment manager", async () => {
    const provider = getProvider();
    const transaction = new web3.Transaction();

    await withInit(
      transaction,
      provider.connection,
      provider.wallet,
      paymentManagerName,
      feeCollector.publicKey,
      MAKER_FEE.toNumber(),
      TAKER_FEE.toNumber(),
      includeSellerFeeBasisPoints,
      ROYALTEE_FEE_SHARE
    );

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

    const [checkPaymentManagerId] = await findPaymentManagerAddress(
      paymentManagerName
    );
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
  });

  it("Handle payment with royalties", async () => {
    const provider = getProvider();
    const transaction = new web3.Transaction();

    const metadataId = await Metadata.getPDA(rentalMint.publicKey);
    const [paymentManagerId] = await findPaymentManagerAddress(
      paymentManagerName
    );

    const [paymentTokenAccountId, feeCollectorTokenAccountId, _accounts] =
      await withRemainingAccountsForPayment(
        transaction,
        provider.connection,
        provider.wallet,
        rentalMint.publicKey,
        paymentMint.publicKey,
        paymentReceiver.publicKey,
        paymentManagerId
      );

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
      paymentManagerName,
      new BN(paymentAmount),
      rentalMint.publicKey,
      metadataId,
      paymentMint.publicKey,
      payerTokenAccountId,
      feeCollectorTokenAccountId,
      paymentTokenAccountId,
      undefined,
      []
    );

    const txEnvelope = new TransactionEnvelope(
      SolanaProvider.init({
        connection: provider.connection,
        wallet: provider.wallet,
        opts: provider.opts,
      }),
      [...transaction.instructions]
    );
    await expectTXTable(txEnvelope, "Handle Payment With Royalties", {
      verbosity: "error",
      formatLogs: true,
    }).to.be.fulfilled;

    const makerFee = paymentAmount.mul(MAKER_FEE).div(BASIS_POINTS_DIVISOR);
    const takerFee = paymentAmount.mul(TAKER_FEE).div(BASIS_POINTS_DIVISOR);
    let totalFees = makerFee.add(takerFee);
    let feesPaidOut = new BN(0);

    const sellerFee = new BN(0);
    totalFees = totalFees.add(sellerFee);

    const buySideFee = paymentAmount
      .mul(new BN(DEFAULT_BUY_SIDE_FEE_SHARE))
      .div(BASIS_POINTS_DIVISOR);
    const feeCollectorAtaInfo = await paymentMintInfo.getAccountInfo(
      feeCollectorTokenAccountId
    );
    expect(Number(feeCollectorAtaInfo.amount)).to.eq(
      totalFees.add(buySideFee).sub(feesPaidOut).toNumber()
    );

    const afterPayerTokenAccountAmount = (
      await paymentMintInfo.getAccountInfo(payerTokenAccountId)
    ).amount;
    expect(
      beforePayerTokenAccountAmount.sub(afterPayerTokenAccountAmount).toNumber()
    ).to.eq(paymentAmount.add(takerFee).toNumber());
  });
});
