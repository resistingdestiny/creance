import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenFreezeTransaction,
  TokenMintTransaction,
  TokenUnfreezeTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction,
} from '@hiero-ledger/sdk';
import { MirrorClient } from '@creance/client';

/// The native Hedera services the bind path uses: one HCS receipt and one
/// policy NFT.
///
/// @hiero-ledger/sdk only, never @hashgraph/sdk: docs/DECISIONS.md, T03.
///
/// Two keys are in play and they are not the same key.
///
/// The api account holds BINDER_ROLE and the payments topic's submit key, so
/// the receipt is written with it. The policy NFT collection's treasury, admin,
/// supply and freeze keys are all the operator's, set that way by
/// `pnpm hedera:setup`, so the mint, the transfer out of treasury and the
/// freeze are signed with the operator key. See docs/DECISIONS.md, "The policy
/// NFT is minted and frozen with the operator key".

/** The HTS cap, measured on testnet in bytes and not in characters. */
export const MAX_NFT_METADATA_BYTES = 100;

export interface TopicReceipt {
  topicId: string;
  sequenceNumber: number;
  transactionId: string;
  hashscan: string;
}

export interface MintedPolicyNft {
  tokenId: string;
  serial: number;
  mintTransactionId: string;
  transferTransactionId: string;
  freezeTransactionId: string;
  /** Present only when the holder was frozen from an earlier policy. */
  unfreezeTransactionId?: string;
  hashscan: string;
}

export interface HederaGateway {
  publish(topicId: string, message: string): Promise<TopicReceipt>;
  mintPolicyNft(holderAccountId: string, metadata: string): Promise<MintedPolicyNft>;
  close(): void;
}

export interface HederaGatewayOptions {
  network: string;
  mirrorUrl: string;
  policyNftTokenId: string;
  apiAccountId: string;
  apiKey: string;
  operatorAccountId: string;
  operatorKey: string;
}

export class SdkHederaGateway implements HederaGateway {
  private readonly client: Client;
  private readonly mirror: MirrorClient;
  private readonly apiKey: PrivateKey;
  private readonly operatorKey: PrivateKey;

  constructor(private readonly options: HederaGatewayOptions) {
    if (options.network !== 'testnet') {
      throw new Error(`refusing to build a ${options.network} client: this build is testnet only`);
    }
    this.apiKey = PrivateKey.fromStringECDSA(options.apiKey);
    this.operatorKey = PrivateKey.fromStringECDSA(options.operatorKey);
    // The operator of the client is the api account: it pays for the receipt
    // and for the mint. The operator key is added as an extra signature where
    // the token's keys demand it, rather than by swapping the payer.
    this.client = Client.forTestnet();
    this.client.setOperator(AccountId.fromString(options.apiAccountId), this.apiKey);
    this.client.setDefaultMaxTransactionFee(new Hbar(10));
    this.mirror = new MirrorClient({ baseUrl: options.mirrorUrl });
  }

  async publish(topicId: string, message: string): Promise<TopicReceipt> {
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(message)
      .execute(this.client);
    const receipt = await response.getReceipt(this.client);
    const sequenceNumber = Number(receipt.topicSequenceNumber?.toString() ?? '0');
    return {
      topicId,
      sequenceNumber,
      transactionId: response.transactionId.toString(),
      hashscan: `https://hashscan.io/testnet/topic/${topicId}`,
    };
  }

  /**
   * Mint one serial, move it to the holder and freeze the holder against the
   * collection.
   *
   * Three transactions rather than one, because the collection has no default
   * freeze: `freezeDefault` true does not compose with unlimited automatic
   * association and the transfer fails with ACCOUNT_FROZEN_FOR_TOKEN. See
   * docs/DECISIONS.md, "The policy NFT collection has no default freeze". The
   * end state is the same, a holder who cannot move the receipt.
   *
   * A holder who already has a policy is frozen, so the unfreeze comes first
   * when the mirror node says the relationship is frozen. Unfreezing is a
   * no-op on a holder who is not.
   */
  async mintPolicyNft(holderAccountId: string, metadata: string): Promise<MintedPolicyNft> {
    const bytes = Buffer.from(metadata, 'utf8');
    if (bytes.byteLength > MAX_NFT_METADATA_BYTES) {
      throw new Error(
        `policy NFT metadata is ${bytes.byteLength} bytes, over the ${MAX_NFT_METADATA_BYTES} byte cap`,
      );
    }
    const tokenId = this.options.policyNftTokenId;
    const treasury = AccountId.fromString(this.options.operatorAccountId);
    const holder = AccountId.fromString(holderAccountId);

    const relationship = await this.mirror.tokenRelationship(holderAccountId, tokenId);
    let unfreezeId: string | null = null;
    if (relationship?.freeze_status === 'FROZEN') {
      const unfreeze = await (
        await new TokenUnfreezeTransaction()
          .setTokenId(tokenId)
          .setAccountId(holder)
          .freezeWith(this.client)
          .sign(this.operatorKey)
      ).execute(this.client);
      await unfreeze.getReceipt(this.client);
      unfreezeId = unfreeze.transactionId.toString();
    }

    const mint = await (
      await new TokenMintTransaction()
        .setTokenId(tokenId)
        .setMetadata([bytes])
        .freezeWith(this.client)
        .sign(this.operatorKey)
    ).execute(this.client);
    const mintReceipt = await mint.getReceipt(this.client);
    const serial = Number(mintReceipt.serials[0]?.toString() ?? '0');
    if (serial === 0) throw new Error('the mint receipt carried no serial');

    const transfer = await (
      await new TransferTransaction()
        .addNftTransfer(tokenId, serial, treasury, holder)
        .freezeWith(this.client)
        .sign(this.operatorKey)
    ).execute(this.client);
    await transfer.getReceipt(this.client);

    const freeze = await (
      await new TokenFreezeTransaction()
        .setTokenId(tokenId)
        .setAccountId(holder)
        .freezeWith(this.client)
        .sign(this.operatorKey)
    ).execute(this.client);
    await freeze.getReceipt(this.client);

    return {
      tokenId,
      serial,
      mintTransactionId: mint.transactionId.toString(),
      transferTransactionId: transfer.transactionId.toString(),
      freezeTransactionId: freeze.transactionId.toString(),
      hashscan: `https://hashscan.io/testnet/token/${tokenId}/${serial}`,
      ...(unfreezeId === null ? {} : { unfreezeTransactionId: unfreezeId }),
    };
  }

  close(): void {
    this.client.close();
  }
}
