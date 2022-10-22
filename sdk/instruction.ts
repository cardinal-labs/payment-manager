import type { BN } from "@project-serum/anchor";
import { AnchorProvider, Program } from "@project-serum/anchor";
import type { Wallet } from "@saberhq/solana-contrib";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type {
  AccountMeta,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import { CRANK_KEY } from ".";

import type { PAYMENT_MANAGER_PROGRAM } from ".";
import { PAYMENT_MANAGER_ADDRESS, PAYMENT_MANAGER_IDL } from ".";

export const init = (
  connection: Connection,
  wallet: Wallet,
  name: string,
  params: {
    paymentManagerId: PublicKey;
    feeCollector: PublicKey;
    authority: PublicKey;
    makerFeeBasisPoints: number;
    takerFeeBasisPoints: number;
    includeSellerFeeBasisPoints: boolean;
    payer: PublicKey;
    royaltyFeeShare?: BN;
  }
): TransactionInstruction => {
  const provider = new AnchorProvider(connection, wallet, {});

  const paymentManagerProgram = new Program<PAYMENT_MANAGER_PROGRAM>(
    PAYMENT_MANAGER_IDL,
    PAYMENT_MANAGER_ADDRESS,
    provider
  );

  return paymentManagerProgram.instruction.init(
    {
      name: name,
      feeCollector: params.feeCollector,
      makerFeeBasisPoints: params.makerFeeBasisPoints,
      takerFeeBasisPoints: params.takerFeeBasisPoints,
      includeSellerFeeBasisPoints: params.includeSellerFeeBasisPoints,
      royaltyFeeShare: params.royaltyFeeShare ?? null,
    },
    {
      accounts: {
        paymentManager: params.paymentManagerId,
        authority: params.authority,
        payer: params.payer,
        systemProgram: SystemProgram.programId,
      },
    }
  );
};

export const managePayment = (
  connection: Connection,
  wallet: Wallet,
  params: {
    paymentManagerId: PublicKey;
    paymentAmount: BN;
    payerTokenAccount: PublicKey;
    feeCollectorTokenAccount: PublicKey;
    paymentTokenAccount: PublicKey;
  }
): TransactionInstruction => {
  const provider = new AnchorProvider(connection, wallet, {});

  const paymentManagerProgram = new Program<PAYMENT_MANAGER_PROGRAM>(
    PAYMENT_MANAGER_IDL,
    PAYMENT_MANAGER_ADDRESS,
    provider
  );

  return paymentManagerProgram.instruction.managePayment(params.paymentAmount, {
    accounts: {
      paymentManager: params.paymentManagerId,
      payerTokenAccount: params.payerTokenAccount,
      feeCollectorTokenAccount: params.feeCollectorTokenAccount,
      paymentTokenAccount: params.paymentTokenAccount,
      payer: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });
};

export const handlePaymentWithRoyalties = (
  connection: Connection,
  wallet: Wallet,
  params: {
    paymentManagerId: PublicKey;
    paymentAmount: BN;
    payerTokenAccount: PublicKey;
    feeCollectorTokenAccount: PublicKey;
    paymentTokenAccount: PublicKey;
    paymentMint: PublicKey;
    mint: PublicKey;
    mintMetadata: PublicKey;
    royaltiesRemainingAccounts: AccountMeta[];
  }
): TransactionInstruction => {
  const provider = new AnchorProvider(connection, wallet, {});

  const paymentManagerProgram = new Program<PAYMENT_MANAGER_PROGRAM>(
    PAYMENT_MANAGER_IDL,
    PAYMENT_MANAGER_ADDRESS,
    provider
  );

  return paymentManagerProgram.instruction.handlePaymentWithRoyalties(
    params.paymentAmount,
    {
      accounts: {
        paymentManager: params.paymentManagerId,
        payerTokenAccount: params.payerTokenAccount,
        feeCollectorTokenAccount: params.feeCollectorTokenAccount,
        paymentTokenAccount: params.paymentTokenAccount,
        paymentMint: params.paymentMint,
        mint: params.mint,
        mintMetadata: params.mintMetadata,
        payer: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      remainingAccounts: params.royaltiesRemainingAccounts,
    }
  );
};

export const close = (
  connection: Connection,
  wallet: Wallet,
  paymentManagerId: PublicKey,
  collector?: PublicKey
): TransactionInstruction => {
  const provider = new AnchorProvider(connection, wallet, {});

  const paymentManagerProgram = new Program<PAYMENT_MANAGER_PROGRAM>(
    PAYMENT_MANAGER_IDL,
    PAYMENT_MANAGER_ADDRESS,
    provider
  );

  return paymentManagerProgram.instruction.close({
    accounts: {
      paymentManager: paymentManagerId,
      collector: collector || CRANK_KEY,
      closer: wallet.publicKey,
    },
  });
};

export const update = (
  connection: Connection,
  wallet: Wallet,
  params: {
    paymentManagerId: PublicKey;
    authority: PublicKey;
    feeCollector: PublicKey;
    makerFeeBasisPoints: number;
    takerFeeBasisPoints: number;
    royaltyFeeShare?: BN;
  }
): TransactionInstruction => {
  const provider = new AnchorProvider(connection, wallet, {});

  const paymentManagerProgram = new Program<PAYMENT_MANAGER_PROGRAM>(
    PAYMENT_MANAGER_IDL,
    PAYMENT_MANAGER_ADDRESS,
    provider
  );

  return paymentManagerProgram.instruction.update(
    {
      authority: params.authority,
      feeCollector: params.feeCollector,
      makerFeeBasisPoints: params.makerFeeBasisPoints,
      takerFeeBasisPoints: params.takerFeeBasisPoints,
      royaltyFeeShare: params.royaltyFeeShare ?? null,
    },
    {
      accounts: {
        paymentManager: params.paymentManagerId,
        payer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      },
    }
  );
};
