import type { Wallet } from "@saberhq/solana-contrib";
import * as splToken from "@solana/spl-token";
import type { Connection } from "@solana/web3.js";
import * as web3 from "@solana/web3.js";

export function chunkArray<T>(arr: T[], size: number): T[][] {
  return arr.length > size
    ? [arr.slice(0, size), ...chunkArray(arr.slice(size), size)]
    : [arr];
}

/**
 * Pay and create mint and token account
 * @param connection
 * @param creator
 * @returns
 */
export const createMint = async (
  connection: web3.Connection,
  creator: web3.Keypair,
  recipient: web3.PublicKey,
  amount = 1,
  freezeAuthority: web3.PublicKey = recipient
): Promise<[web3.PublicKey, splToken.Token]> => {
  const mint = await splToken.Token.createMint(
    connection,
    creator,
    creator.publicKey,
    freezeAuthority,
    0,
    splToken.TOKEN_PROGRAM_ID
  );
  const tokenAccount = await mint.createAssociatedTokenAccount(recipient);
  await mint.mintTo(tokenAccount, creator.publicKey, [], amount);
  return [tokenAccount, mint];
};

export const executeTransaction = async (
  connection: Connection,
  wallet: Wallet,
  transaction: web3.Transaction,
  config: {
    silent?: boolean;
    signers?: web3.Signer[];
    confirmOptions?: web3.ConfirmOptions;
    callback?: (success: boolean) => void;
  }
): Promise<string> => {
  let txid = "";
  try {
    transaction.feePayer = wallet.publicKey;
    transaction.recentBlockhash = (
      await connection.getRecentBlockhash("max")
    ).blockhash;
    await wallet.signTransaction(transaction);
    if (config.signers && config.signers.length > 0) {
      transaction.partialSign(...config.signers);
    }
    txid = await web3.sendAndConfirmRawTransaction(
      connection,
      transaction.serialize(),
      config.confirmOptions
    );
    config.callback && config.callback(true);
    console.log("Successful tx", txid);
  } catch (e: unknown) {
    console.log(
      "Failed transaction: ",
      (e as web3.SendTransactionError).logs,
      e
    );
    config.callback && config.callback(false);
    if (!config.silent) {
      throw e;
    }
  }
  return txid;
};
