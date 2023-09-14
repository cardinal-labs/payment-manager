import type { Wallet } from "@coral-xyz/anchor/dist/cjs/provider";
import type { Connection } from "@solana/web3.js";
import { PublicKey, Transaction } from "@solana/web3.js";
import { executeTransaction } from "@solana-nft-programs/common";
import { BN } from "bn.js";

import { withInit } from "../sdk/transaction";

export const commandName = "createPaymentManager";
export const description = "Create payment manager";

export const getArgs = (_connection: Connection, _wallet: Wallet) => ({
  paymentManagerName: "test-5",
  feeCollectorId: new PublicKey("cpmaMZyBQiPxpeuxNsQhW7N8z1o9yaNdLgiPhWGUEiX"),
  authority: new PublicKey("cpmaMZyBQiPxpeuxNsQhW7N8z1o9yaNdLgiPhWGUEiX"),
  makerFeeBasisPoints: 5000,
  takerFeeBasisPoints: 0,
  includeSellerFeeBasisPoints: false,
  royaltyFeeShare: new BN(0),
});

export const handler = async (
  connection: Connection,
  wallet: Wallet,
  args: ReturnType<typeof getArgs>,
) => {
  const transaction = new Transaction();
  await withInit(transaction, connection, wallet, args);
  await executeTransaction(connection, transaction, wallet);
  console.log(`[success] Created payment manager ${args.paymentManagerName}`);
};
