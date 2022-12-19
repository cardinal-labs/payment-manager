import { connectionFor, tryGetAccount } from "@cardinal/common";
import * as anchor from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import * as web3Js from "@solana/web3.js";

import { getPaymentManager } from "../sdk/accounts";
import { findPaymentManagerAddress } from "../sdk/pda";
import { withUpdate } from "../sdk/transaction";
import { executeTransaction, keypairFrom } from "./utils";

const wallet = keypairFrom(process.env.WALLET ?? "");

export type PaymentManagerParams = {
  feeCollector?: PublicKey;
  authority?: PublicKey;
  makerFeeBasisPoints?: number;
  takerFeeBasisPoints?: number;
  includeSellerFeeBasisPoints?: boolean;
  royaltyFeeShare?: anchor.BN;
};

const main = async (
  paymentManagerName: string,
  params: PaymentManagerParams,
  cluster: web3Js.Cluster = "devnet"
) => {
  const connection = connectionFor(cluster);
  const transaction = new web3Js.Transaction();
  await withUpdate(
    transaction,
    connection,
    new anchor.Wallet(wallet),
    paymentManagerName,
    params.feeCollector,
    params.makerFeeBasisPoints,
    params.takerFeeBasisPoints,
    params.royaltyFeeShare
  );
  try {
    await executeTransaction(
      connection,
      transaction,
      new anchor.Wallet(wallet)
    );
  } catch (e) {
    console.log(`Transaction failed: `, e);
  }
  const [paymentManagerId] = await findPaymentManagerAddress(
    paymentManagerName
  );
  const paymentManagerData = await tryGetAccount(() =>
    getPaymentManager(connection, paymentManagerId)
  );
  if (!paymentManagerData) {
    console.log("Error: Failed to create payment manager");
  } else {
    console.log(`Created payment manager ${paymentManagerName}`);
  }
};

const paymentManagerName = "cardinal-marketplace";
const params: PaymentManagerParams = {
  authority: new PublicKey("cpmaMZyBQiPxpeuxNsQhW7N8z1o9yaNdLgiPhWGUEiX"),
  feeCollector: new PublicKey("cpmaMZyBQiPxpeuxNsQhW7N8z1o9yaNdLgiPhWGUEiX"),
  makerFeeBasisPoints: 100,
  takerFeeBasisPoints: 0,
};

main(paymentManagerName, params).catch((e) => console.log(e));
