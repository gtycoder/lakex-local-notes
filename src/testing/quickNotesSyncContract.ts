import { expect } from "vitest";
import {
  syncQuickNotesViaEngine,
  type QuickNotesSyncDbPort,
} from "../core/quickNotesSyncEngine.js";
import type { S3Store, SyncConfig } from "../core/syncEngine.js";
import type { ManifestItem } from "../core/manifestTypes.js";
import {
  normalizeQuickNoteContent,
  quickNoteBodyFromTextAndImages,
  serializeQuickNoteContent,
} from "../core/quickNoteModel.js";
import { sha256Sync } from "../core/sha256Sync.js";

export interface QuickNotesContractDevice {
  readonly port: QuickNotesSyncDbPort;
  create(text: string): { id: string; contentHash: string };
  edit(id: string, text: string): void;
  text(id: string): string | null;
  activeIds(): string[];
  deletedIds(): string[];
  restore(id: string): void;
}

const contractConfig: SyncConfig = {
  endpoint: "https://s3.contract.test",
  region: "contract",
  bucket: "contract",
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  prefix: "contract",
};

export function createContractS3(): S3Store & { bucket: Map<string, Uint8Array> } {
  const bucket = new Map<string, Uint8Array>();
  return {
    bucket,
    async getObject(key) {
      return bucket.get(key) ?? null;
    },
    async putObject(key, body) {
      bucket.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
    },
  };
}

function readManifest(s3: ReturnType<typeof createContractS3>): { items: ManifestItem[] } {
  const bytes = s3.bucket.get("contract/quick-notes/manifests/latest.json");
  expect(bytes).toBeTruthy();
  return JSON.parse(new TextDecoder().decode(bytes)) as { items: ManifestItem[] };
}

async function sync(device: QuickNotesContractDevice, s3: S3Store) {
  return syncQuickNotesViaEngine(contractConfig, s3, device.port);
}

export async function runQuickNotesRoundTripContract(
  author: QuickNotesContractDevice,
  peer: QuickNotesContractDevice,
): Promise<void> {
  const s3 = createContractS3();
  const note = author.create("contract v1");

  const upload = await sync(author, s3);
  expect(upload.uploaded).toBe(1);
  expect(readManifest(s3).items[0]?.id).toBe(note.id);
  expect(readManifest(s3).items[0]?.deleted).not.toBe(true);

  await sync(peer, s3);
  expect(peer.text(note.id)).toBe("contract v1");

  author.port.deleteLocalQuickNote(note.id);
  await sync(author, s3);
  expect(readManifest(s3).items[0]?.id).toBe(note.id);
  expect(readManifest(s3).items[0]?.deleted).toBe(true);

  await sync(peer, s3);
  expect(peer.activeIds()).not.toContain(note.id);

  await new Promise((resolve) => setTimeout(resolve, 10));
  peer.restore(note.id);
  await sync(peer, s3);
  expect(readManifest(s3).items[0]?.id).toBe(note.id);
  expect(readManifest(s3).items[0]?.deleted).not.toBe(true);

  await sync(author, s3);
  expect(author.activeIds()).toContain(note.id);
  expect(author.text(note.id)).toBe("contract v1");
  expect(author.deletedIds()).not.toContain(note.id);
}

export async function runQuickNotesConflictContract(
  author: QuickNotesContractDevice,
  peer: QuickNotesContractDevice,
): Promise<void> {
  const s3 = createContractS3();
  const note = peer.create("conflict v1");
  await sync(peer, s3);
  await sync(author, s3);

  author.edit(note.id, "author local edit");
  peer.edit(note.id, "peer remote edit");
  await sync(peer, s3);

  const result = await sync(author, s3);
  expect(result.conflicts).toBe(1);
  expect(author.text(note.id)).toBe("peer remote edit");

  const archivedIds = author.deletedIds();
  expect(archivedIds).toHaveLength(1);
  expect(archivedIds[0]).not.toBe(note.id);
  expect(readManifest(s3).items.map((item) => item.id)).not.toContain(archivedIds[0]);
}

export async function runQuickNotesRemoteImportRollbackContract(
  device: QuickNotesContractDevice,
): Promise<void> {
  const local = device.create("local body");
  const imageBytes = new Uint8Array([1, 2, 3]);
  const image = {
    id: "contract-image",
    filename: "missing.png",
    mimeType: "image/png",
    width: 1,
    height: 1,
    size: imageBytes.length,
    hash: sha256Sync(imageBytes),
  };
  const content = serializeQuickNoteContent({
    version: 2,
    text: "remote body",
    body: "<p><br></p>",
    images: [image],
  });
  const bytes = new TextEncoder().encode(content);
  const item: ManifestItem = {
    id: local.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    contentHash: sha256Sync(bytes),
    isConflict: false,
    assets: [image],
  };

  await expect(
    (async () => device.port.applyRemoteQuickNote(item, bytes, []))(),
  ).rejects.toThrow();
  expect(device.text(local.id)).toBe("local body");
  expect(device.activeIds()).toEqual([local.id]);
}

export function contractQuickNoteContent(text: string): string {
  return serializeQuickNoteContent(normalizeQuickNoteContent(text, quickNoteBodyFromTextAndImages(text, [], () => "", () => "u-sync"), []));
}
