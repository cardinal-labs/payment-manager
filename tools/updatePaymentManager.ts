import * as anchor from "@project-serum/anchor";
import { SignerWallet } from "@saberhq/solana-contrib";
import { PublicKey } from "@solana/web3.js";
import * as web3Js from "@solana/web3.js";
import { connectionFor, tryGetAccount } from "@cardinal/common";
import { withUpdate } from "../sdk/transaction";
import { executeTransaction } from "../sdk/utils";
import { findPaymentManagerAddress } from "../sdk/pda";
import { getPaymentManager } from "../sdk/accounts";

const wallet = web3Js.Keypair.fromSecretKey(
  anchor.utils.bytes.bs58.decode(anchor.utils.bytes.bs58.encode([]))
); // your wallet's secret key
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
  transaction.add(
    (
      await withUpdate(
        transaction,
        connection,
        new SignerWallet(wallet),
        paymentManagerName,
        params.feeCollector,
        params.makerFeeBasisPoints,
        params.takerFeeBasisPoints,
        params.royaltyFeeShare
      )
    )[0]
  );
  try {
    await executeTransaction(
      connection,
      new SignerWallet(wallet),
      transaction,
      {}
    );
  } catch (e) {
    console.log(`Transactionn failed: ${e}`);
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
