import { tryGetAccount } from "@cardinal/common";
import { Wallet } from "@saberhq/solana-contrib";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { getPaymentManager } from "./accounts";
import {
  close,
  handleNativePaymentWithRoyalties,
  handlePaymentWithRoyalties,
  init,
  managePayment,
  update,
} from "./instruction";
import { findPaymentManagerAddress } from "./pda";
import { withRemainingAccountsForHandlePaymentWithRoyalties } from "./utils";

export const withInit = async (
  transaction: Transaction,
  connection: Connection,
  wallet: Wallet,
  name: string,
  feeCollectorId: PublicKey,
  makerFeeBasisPoints: number,
  takerFeeBasisPoints: number,
  includeSellerFeeBasisPoints: boolean,
  royaltyFeeShare?: BN,
  authority = wallet.publicKey
): Promise<[Transaction, PublicKey]> => {
  const [paymentManagerId] = await findPaymentManagerAddress(name);
  transaction.add(
    init(connection, wallet, name, {
      paymentManagerId: paymentManagerId,
      feeCollector: feeCollectorId,
      authority: wallet.publicKey,
      makerFeeBasisPoints: makerFeeBasisPoints,
      takerFeeBasisPoints: takerFeeBasisPoints,
      includeSellerFeeBasisPoints: includeSellerFeeBasisPoints,
      royaltyFeeShare: royaltyFeeShare,
      payer: authority,
    })
  );
  return [transaction, paymentManagerId];
};

export const withManagePayment = async (
  transaction: Transaction,
  connection: Connection,
  wallet: Wallet,
  name: string,
  paymentAmount: BN,
  payerTokenAccountId: PublicKey,
  feeCollectorTokenAccountId: PublicKey,
  paymentTokenAccountId: PublicKey
): Promise<Transaction> => {
  const [paymentManagerId] = await findPaymentManagerAddress(name);

  transaction.add(
    managePayment(connection, wallet, {
      paymentManagerId: paymentManagerId,
      paymentAmount: paymentAmount,
      payerTokenAccount: payerTokenAccountId,
      feeCollectorTokenAccount: feeCollectorTokenAccountId,
      paymentTokenAccount: paymentTokenAccountId,
    })
  );
  return transaction;
};

export const withHandlePaymentWithRoyalties = async (
  transaction: Transaction,
  connection: Connection,
  wallet: Wallet,
  name: string,
  paymentAmount: BN,
  mintId: PublicKey,
  mintMetadataId: PublicKey,
  paymentMintId: PublicKey,
  payerTokenAccountId: PublicKey,
  feeCollectorTokenAccountId: PublicKey,
  paymentTokenAccountId: PublicKey,
  buySideTokenAccountId?: PublicKey,
  excludeCretors = []
): Promise<Transaction> => {
  const [paymentManagerId] = await findPaymentManagerAddress(name);

  const remainingAccounts =
    await withRemainingAccountsForHandlePaymentWithRoyalties(
      new Transaction(),
      connection,
      wallet,
      mintId,
      paymentMintId,
      buySideTokenAccountId,
      excludeCretors
    );

  transaction.add(
    handlePaymentWithRoyalties(connection, wallet, {
      paymentManagerId: paymentManagerId,
      paymentAmount: paymentAmount,
      payerTokenAccount: payerTokenAccountId,
      feeCollectorTokenAccount: feeCollectorTokenAccountId,
      paymentTokenAccount: paymentTokenAccountId,
      paymentMint: paymentMintId,
      mint: mintId,
      mintMetadata: mintMetadataId,
      royaltiesRemainingAccounts: remainingAccounts,
    })
  );
  return transaction;
};

export const withHandleNativePaymentWithRoyalties = async (
  transaction: Transaction,
  connection: Connection,
  wallet: Wallet,
  name: string,
  paymentAmount: BN,
  mintId: PublicKey,
  mintMetadataId: PublicKey,
  paymentMintId: PublicKey,
  feeCollector: PublicKey,
  paymentTarget: PublicKey,
  buySideTokenAccountId?: PublicKey,
  excludeCretors = []
): Promise<Transaction> => {
  const [paymentManagerId] = await findPaymentManagerAddress(name);

  const remainingAccounts =
    await withRemainingAccountsForHandlePaymentWithRoyalties(
      new Transaction(),
      connection,
      wallet,
      mintId,
      paymentMintId,
      buySideTokenAccountId,
      excludeCretors
    );

  transaction.add(
    handleNativePaymentWithRoyalties(connection, wallet, {
      paymentManagerId: paymentManagerId,
      paymentAmount: paymentAmount,
      feeCollector: feeCollector,
      paymentTarget: paymentTarget,
      mint: mintId,
      mintMetadata: mintMetadataId,
      royaltiesRemainingAccounts: remainingAccounts,
    })
  );
  return transaction;
};

export const withClose = async (
  transaction: Transaction,
  connection: Connection,
  wallet: Wallet,
  name: string,
  collectorId = wallet.publicKey
): Promise<Transaction> => {
  const [paymentManagerId] = await findPaymentManagerAddress(name);

  transaction.add(close(connection, wallet, paymentManagerId, collectorId));
  return transaction;
};

export const withUpdate = async (
  transaction: Transaction,
  connection: Connection,
  wallet: Wallet,
  name: string,
  feeCollectorId?: PublicKey,
  makerFeeBasisPoints?: number,
  takerFeeBasisPoints?: number,
  royaltyFeeShare?: BN
): Promise<Transaction> => {
  const [paymentManagerId] = await findPaymentManagerAddress(name);
  const checkPaymentManager = await tryGetAccount(() =>
    getPaymentManager(connection, paymentManagerId)
  );
  if (!checkPaymentManager) {
    throw `No payment manager found with name ${name}`;
  }

  transaction.add(
    update(connection, wallet, {
      paymentManagerId: paymentManagerId,
      feeCollector: checkPaymentManager.parsed.feeCollector ?? feeCollectorId,
      authority: checkPaymentManager.parsed.authority ?? wallet.publicKey,
      makerFeeBasisPoints:
        checkPaymentManager.parsed.makerFeeBasisPoints ?? makerFeeBasisPoints,
      takerFeeBasisPoints:
        checkPaymentManager.parsed.takerFeeBasisPoints ?? takerFeeBasisPoints,
      royaltyFeeShare:
        checkPaymentManager.parsed.royaltyFeeShare ?? royaltyFeeShare,
    })
  );
  return transaction;
};
