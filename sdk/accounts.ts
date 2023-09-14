import type { Connection, PublicKey } from "@solana/web3.js";
import type { AccountData } from "@solana-nft-programs/common";
import { fetchIdlAccount } from "@solana-nft-programs/common";

import type { PAYMENT_MANAGER_PROGRAM, PaymentManagerData } from ".";
import { PAYMENT_MANAGER_IDL } from ".";

export const getPaymentManager = async (
  connection: Connection,
  paymentManagerId: PublicKey
): Promise<AccountData<PaymentManagerData>> => {
  return fetchIdlAccount<"paymentManager", PAYMENT_MANAGER_PROGRAM>(
    connection,
    paymentManagerId,
    "paymentManager",
    PAYMENT_MANAGER_IDL
  );
};
