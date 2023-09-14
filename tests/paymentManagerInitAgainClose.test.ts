import { web3 } from "@coral-xyz/anchor";
import { Keypair, Transaction } from "@solana/web3.js";
import { executeTransaction, tryGetAccount } from "@solana-nft-programs/common";
import { BN } from "bn.js";

import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";
import { withClose, withInit } from "../sdk/transaction";
import type { SolanaProvider } from "./workspace";
import { getProvider } from "./workspace";

describe("Init again and close payment manager", () => {
  const MAKER_FEE = 500;
  const TAKER_FEE = 300;
  const paymentManagerName = Math.random().toString(36).slice(2, 7);
  const feeCollector = Keypair.generate();
  let provider: SolanaProvider;

  beforeAll(async () => {
    provider = await getProvider();
  });

  it("Create payment manager", async () => {
    const transaction = new web3.Transaction();

    await withInit(transaction, provider.connection, provider.wallet, {
      paymentManagerName,
      feeCollectorId: feeCollector.publicKey,
      makerFeeBasisPoints: MAKER_FEE,
      takerFeeBasisPoints: TAKER_FEE,
      includeSellerFeeBasisPoints: false,
      royaltyFeeShare: new BN(0),
    });
    await executeTransaction(provider.connection, transaction, provider.wallet);

    const checkPaymentManagerId = findPaymentManagerAddress(paymentManagerName);
    const paymentManagerData = await getPaymentManager(
      provider.connection,
      checkPaymentManagerId
    );
    expect(paymentManagerData.parsed.name).toEqual(paymentManagerName);
    expect(paymentManagerData.parsed.makerFeeBasisPoints).toEqual(MAKER_FEE);
    expect(paymentManagerData.parsed.takerFeeBasisPoints).toEqual(TAKER_FEE);
  });

  it("Init again fails", async () => {
    const transaction = new Transaction();
    await withInit(transaction, provider.connection, provider.wallet, {
      paymentManagerName,
      feeCollectorId: feeCollector.publicKey,
      makerFeeBasisPoints: MAKER_FEE,
      takerFeeBasisPoints: TAKER_FEE,
      includeSellerFeeBasisPoints: false,
      royaltyFeeShare: new BN(0),
    });
    await expect(
      executeTransaction(provider.connection, transaction, provider.wallet, {
        silent: true,
      })
    ).rejects.toThrow();
  });

  it("Close", async () => {
    const balanceBefore = await provider.connection.getBalance(
      provider.wallet.publicKey
    );
    const transaction = new Transaction();
    await withClose(transaction, provider.connection, provider.wallet, {
      paymentManagerName,
    });
    await executeTransaction(provider.connection, transaction, provider.wallet);

    const paymentManagerId = findPaymentManagerAddress(paymentManagerName);
    const paymentManagerData = await tryGetAccount(() =>
      getPaymentManager(provider.connection, paymentManagerId)
    );
    expect(paymentManagerData).toEqual(null);

    const balanceAfter = await provider.connection.getBalance(
      provider.wallet.publicKey
    );

    expect(balanceAfter).toBeGreaterThan(balanceBefore);
  });
});
