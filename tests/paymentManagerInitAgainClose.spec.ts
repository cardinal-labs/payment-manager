import { tryGetAccount } from "@cardinal/common";
import { web3 } from "@project-serum/anchor";
import { expectTXTable } from "@saberhq/chai-solana";
import { SolanaProvider, TransactionEnvelope } from "@saberhq/solana-contrib";
import { Keypair, Transaction } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";

import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";
import { withClose, withInit } from "../sdk/transaction";
import { getProvider } from "./workspace";

describe("Init again and close payment manager", () => {
  const MAKER_FEE = 500;
  const TAKER_FEE = 300;
  const paymentManagerName = Math.random().toString(36).slice(2, 7);
  const feeCollector = Keypair.generate();

  it("Create payment manager", async () => {
    const provider = getProvider();
    const transaction = new web3.Transaction();

    await withInit(transaction, provider.connection, provider.wallet, {
      paymentManagerName,
      feeCollectorId: feeCollector.publicKey,
      makerFeeBasisPoints: MAKER_FEE,
      takerFeeBasisPoints: TAKER_FEE,
      includeSellerFeeBasisPoints: false,
      royaltyFeeShare: new BN(0),
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
    expect(paymentManagerData.parsed.makerFeeBasisPoints).to.eq(MAKER_FEE);
    expect(paymentManagerData.parsed.takerFeeBasisPoints).to.eq(TAKER_FEE);
  });

  it("Init again fails", async () => {
    const provider = getProvider();

    const transaction = new Transaction();
    await withInit(transaction, provider.connection, provider.wallet, {
      paymentManagerName,
      feeCollectorId: feeCollector.publicKey,
      makerFeeBasisPoints: MAKER_FEE,
      takerFeeBasisPoints: TAKER_FEE,
      includeSellerFeeBasisPoints: false,
      royaltyFeeShare: new BN(0),
    });
    expect(async () => {
      await expectTXTable(
        new TransactionEnvelope(
          SolanaProvider.init(provider),
          transaction.instructions
        ),
        "Fail to init again",
        { verbosity: "error" }
      ).to.be.rejectedWith(Error);
    });
  });

  it("Close", async () => {
    const provider = getProvider();
    const balanceBefore = await provider.connection.getBalance(
      provider.wallet.publicKey
    );
    const transaction = new Transaction();
    await withClose(transaction, provider.connection, provider.wallet, {
      paymentManagerName,
    });

    await expectTXTable(
      new TransactionEnvelope(
        SolanaProvider.init(provider),
        transaction.instructions
      ),
      "Close payment manager",
      {
        verbosity: "error",
        formatLogs: true,
      }
    ).to.be.fulfilled;

    const paymentManagerId = findPaymentManagerAddress(paymentManagerName);
    const paymentManagerData = await tryGetAccount(() =>
      getPaymentManager(provider.connection, paymentManagerId)
    );
    expect(paymentManagerData).to.eq(null);

    const balanceAfter = await provider.connection.getBalance(
      provider.wallet.publicKey
    );

    expect(balanceAfter).to.greaterThan(balanceBefore);
  });
});
