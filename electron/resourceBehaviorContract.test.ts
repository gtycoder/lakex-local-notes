import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineResourceBehaviorContract, type ResourceBehaviorAdapter } from "../src/testing/resourceBehaviorContract.js";
import { ResourceRepository } from "./resourceRepository.js";

function createDesktopAdapter(): ResourceBehaviorAdapter {
  const root = mkdtempSync(path.join(tmpdir(), "lake-resource-contract-"));
  const repository = new ResourceRepository({
    noteAssetsDirFor: (noteId) => path.join(root, noteId),
    assetUrl: (noteId, filename) => `http://127.0.0.1:19876/${noteId}/${filename}`,
    registerOrphan: () => undefined,
  });
  return {
    upload: async (input, noteId) => repository.upload(input, noteId),
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

defineResourceBehaviorContract("Desktop", createDesktopAdapter);
