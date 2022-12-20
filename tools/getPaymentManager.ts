import { connectionFor, tryGetAccount } from "@cardinal/common";
import type { Cluster } from "@solana/web3.js";

import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";

const main = async (
  paymentManagerName: string,
  cluster: Cluster = "devnet"
) => {
  const connection = connectionFor(cluster);
  const paymentManagerId = findPaymentManagerAddress(paymentManagerName);
  const paymentManagerData = await tryGetAccount(() =>
    getPaymentManager(connection, paymentManagerId)
  );
  if (!paymentManagerData) {
    console.log("Error: Failed to get payment manager");
  } else {
    console.log(
      `Got payment manager ${paymentManagerName} (${paymentManagerId.toString()})`,
      paymentManagerData
    );
  }
};

const paymentManagerName = "cardinal-mini-royale";

main(paymentManagerName).catch((e) => console.log(e));
