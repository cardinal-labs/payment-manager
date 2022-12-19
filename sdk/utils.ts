import {
  findAta,
  tryGetAccount,
  withFindOrInitAssociatedTokenAccount,
} from "@cardinal/common";
import {
  Metadata,
  MetadataData,
} from "@metaplex-foundation/mpl-token-metadata";
import type { Wallet } from "@project-serum/anchor/dist/cjs/provider";
import * as splToken from "@solana/spl-token";
import type { Connection } from "@solana/web3.js";
import * as web3 from "@solana/web3.js";

import { getPaymentManager } from "./accounts";

export type AccountData<T> = {
  pubkey: web3.PublicKey;
  parsed: T;
};

export const withRemainingAccountsForPayment = async (
  transaction: web3.Transaction,
  connection: Connection,
  wallet: Wallet,
  mint: web3.PublicKey,
  paymentMint: web3.PublicKey,
  issuerId: web3.PublicKey,
  paymentManagerId: web3.PublicKey,
  buySideTokenAccountId?: web3.PublicKey,
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
      buySideTokenAccountId,
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
  buySideTokenAccountId?: web3.PublicKey,
  excludeCreators?: string[]
): Promise<web3.AccountMeta[]> => {
  const remainingAccounts: web3.AccountMeta[] = [];
  const mintMetadataId = await Metadata.getPDA(mint);
  const accountInfo = await connection.getAccountInfo(mintMetadataId);
  let metaplexMintData: MetadataData | undefined;
  try {
    metaplexMintData = MetadataData.deserialize(
      accountInfo?.data as Buffer
    ) as MetadataData;
    // eslint-disable-next-line no-empty
  } catch (e) {}
  if (metaplexMintData && metaplexMintData.data.creators) {
    for (const creator of metaplexMintData.data.creators) {
      if (creator.share !== 0) {
        const creatorAddress = new web3.PublicKey(creator.address);
        if (paymentMint.toString() === web3.PublicKey.default.toString()) {
          remainingAccounts.push({
            pubkey: new web3.PublicKey(creator.address),
            isSigner: false,
            isWritable: true,
          });
        } else {
          const creatorMintTokenAccount = excludeCreators?.includes(
            creator.address
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
          remainingAccounts.push({
            pubkey: creatorMintTokenAccount,
            isSigner: false,
            isWritable: true,
          });
        }
      }
    }
  }

  return [
    ...remainingAccounts,
    ...(buySideTokenAccountId
      ? [
          {
            pubkey: buySideTokenAccountId,
            isSigner: false,
            isWritable: true,
          },
        ]
      : []),
  ];
};
