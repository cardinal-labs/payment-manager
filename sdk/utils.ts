/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type { Wallet } from "@saberhq/solana-contrib";
import * as splToken from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import * as web3 from "@solana/web3.js";
import {
  findAta,
  tryGetAccount,
  withFindOrInitAssociatedTokenAccount,
} from "@cardinal/common";
import {
  Metadata,
  MetadataData,
} from "@metaplex-foundation/mpl-token-metadata";
import { getPaymentManager } from "./accounts";

export type AccountData<T> = {
  pubkey: web3.PublicKey;
  parsed: T;
};

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

/**
 * Pay and create mint and token account
 * @param connection
 * @param creator
 * @returns
 */
export const createMintTransaction = async (
  transaction: web3.Transaction,
  connection: web3.Connection,
  wallet: Wallet,
  recipient: web3.PublicKey,
  mintId: web3.PublicKey,
  amount = 1,
  freezeAuthority: web3.PublicKey = recipient,
  receiver = wallet.publicKey
): Promise<[web3.PublicKey, web3.Transaction]> => {
  const mintBalanceNeeded = await splToken.Token.getMinBalanceRentForExemptMint(
    connection
  );
  transaction.add(
    web3.SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mintId,
      lamports: mintBalanceNeeded,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      space: splToken.MintLayout.span,
      programId: splToken.TOKEN_PROGRAM_ID,
    })
  );
  transaction.add(
    splToken.Token.createInitMintInstruction(
      splToken.TOKEN_PROGRAM_ID,
      mintId,
      0,
      wallet.publicKey,
      freezeAuthority
    )
  );
  const receiverAta = await withFindOrInitAssociatedTokenAccount(
    transaction,
    connection,
    mintId,
    receiver,
    wallet.publicKey,
    true
  );
  if (amount > 0) {
    transaction.add(
      splToken.Token.createMintToInstruction(
        splToken.TOKEN_PROGRAM_ID,
        mintId,
        receiverAta,
        wallet.publicKey,
        [],
        amount
      )
    );
  }
  return [receiverAta, transaction];
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

export const withRemainingAccountsForPayment = async (
  transaction: web3.Transaction,
  connection: Connection,
  wallet: Wallet,
  mint: web3.PublicKey,
  paymentMint: web3.PublicKey,
  issuerId: web3.PublicKey,
  paymentManagerId: web3.PublicKey,
  options?: {
    payer?: web3.PublicKey;
    receiptMint?: web3.PublicKey | null;
  }
): Promise<[web3.PublicKey, web3.PublicKey, web3.AccountMeta[]]> => {
  const payer = options?.payer ?? wallet.publicKey;
  const royaltiesRemainingAccounts =
    await withRemainingAccountsForHandlePaymentWithRoyalties(
      transaction,
      connection,
      wallet,
      mint,
      paymentMint,
      [issuerId.toString()]
    );
  const mintMetadataId = await Metadata.getPDA(mint);
  const paymentRemainingAccounts = [
    {
      pubkey: paymentMint,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: mint,
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: mintMetadataId,
      isSigner: false,
      isWritable: true,
    },
  ];

  if (options?.receiptMint) {
    const receiptMintLargestAccount = await connection.getTokenLargestAccounts(
      options.receiptMint
    );
    // get holder of receipt mint
    const receiptTokenAccountId = receiptMintLargestAccount.value[0]?.address;
    if (!receiptTokenAccountId) throw new Error("No token accounts found");
    const receiptMintToken = new splToken.Token(
      connection,
      options.receiptMint,
      splToken.TOKEN_PROGRAM_ID,
      web3.Keypair.generate()
    );
    const receiptTokenAccount = await receiptMintToken.getAccountInfo(
      receiptTokenAccountId
    );

    // get ATA for this mint of receipt mint holder
    const returnTokenAccountId = receiptTokenAccount.owner.equals(
      wallet.publicKey
    )
      ? await findAta(paymentMint, receiptTokenAccount.owner, true)
      : await withFindOrInitAssociatedTokenAccount(
          transaction,
          connection,
          paymentMint,
          receiptTokenAccount.owner,
          payer,
          true
        );

    const paymentManager = await tryGetAccount(() =>
      getPaymentManager(connection, paymentManagerId)
    );
    const feeCollectorTokenAccountId =
      await withFindOrInitAssociatedTokenAccount(
        transaction,
        connection,
        paymentMint,
        paymentManager ? paymentManager.parsed.feeCollector : paymentManagerId,
        payer,
        true
      );
    return [
      returnTokenAccountId,
      feeCollectorTokenAccountId,
      [
        {
          pubkey: receiptTokenAccountId,
          isSigner: false,
          isWritable: true,
        },
        ...paymentRemainingAccounts,
        ...royaltiesRemainingAccounts,
      ],
    ];
  } else {
    const issuerTokenAccountId = issuerId.equals(wallet.publicKey)
      ? await findAta(paymentMint, issuerId, true)
      : await withFindOrInitAssociatedTokenAccount(
          transaction,
          connection,
          paymentMint,
          issuerId,
          payer,
          true
        );
    const paymentManager = await tryGetAccount(() =>
      getPaymentManager(connection, paymentManagerId)
    );
    const feeCollectorTokenAccountId =
      await withFindOrInitAssociatedTokenAccount(
        transaction,
        connection,
        paymentMint,
        paymentManager ? paymentManager.parsed.feeCollector : paymentManagerId,
        payer,
        true
      );
    return [
      issuerTokenAccountId,
      feeCollectorTokenAccountId,
      [...paymentRemainingAccounts, ...royaltiesRemainingAccounts],
    ];
  }
};

export const withRemainingAccountsForHandlePaymentWithRoyalties = async (
  transaction: web3.Transaction,
  connection: Connection,
  wallet: Wallet,
  mint: web3.PublicKey,
  paymentMint: web3.PublicKey,
  excludeCreators?: string[]
): Promise<web3.AccountMeta[]> => {
  const creatorsRemainingAccounts: web3.AccountMeta[] = [];
  const mintMetadataId = await Metadata.getPDA(mint);
  const accountInfo = await connection.getAccountInfo(mintMetadataId);
  let metaplexMintData: MetadataData | undefined;
  try {
    metaplexMintData = MetadataData.deserialize(
      accountInfo?.data as Buffer
    ) as MetadataData;
  } catch (e) {
    return [];
  }
  if (metaplexMintData.data.creators) {
    for (const creator of metaplexMintData.data.creators) {
      if (creator.share !== 0) {
        const creatorAddress = new web3.PublicKey(creator.address);
        const creatorMintTokenAccount = excludeCreators?.includes(
          creator.address.toString()
        )
          ? await findAta(paymentMint, creatorAddress, true)
          : await withFindOrInitAssociatedTokenAccount(
              transaction,
              connection,
              paymentMint,
              creatorAddress,
              wallet.publicKey,
              true
            );
        creatorsRemainingAccounts.push({
          pubkey: creatorMintTokenAccount,
          isSigner: false,
          isWritable: true,
        });
      }
    }
  }

  return creatorsRemainingAccounts;
};
