import type { Wallet } from "@coral-xyz/anchor/dist/cjs/provider";
import type { Connection } from "@solana/web3.js";

import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";

export const commandName = "getPaymentManager";
export const description = "Get a payment manager";

export const getArgs = (_connection: Connection, _wallet: Wallet) => ({
  paymentManagerName: "pm-name",
});

export const handler = async (
  connection: Connection,
  _wallet: Wallet,
  args: ReturnType<typeof getArgs>,
) => {
  const paymentManagerId = findPaymentManagerAddress(args.paymentManagerName);
  const paymentManagerData = await getPaymentManager(
    connection,
    paymentManagerId,
  );
  console.log(
    `[success] Found payment manager ${
      args.paymentManagerName
    } (${paymentManagerId.toString()})`,
    JSON.stringify(
      { pubkey: paymentManagerData.pubkey, parsed: paymentManagerData.parsed },
      null,
      2,
    ),
  );
};
