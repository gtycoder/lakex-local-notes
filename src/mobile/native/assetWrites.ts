export interface AssetWrite {
  key: string;
  bytes: Uint8Array;
}

export interface AssetWriteDeps {
  memory: Map<string, Uint8Array>;
  save(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
}

interface AssetPlacement {
  key: string;
  previous: Uint8Array | null;
}

async function rollbackPlacements(
  placements: AssetPlacement[],
  deps: AssetWriteDeps,
): Promise<void> {
  for (let index = placements.length - 1; index >= 0; index -= 1) {
    const placement = placements[index]!;
    if (placement.previous) {
      deps.memory.set(placement.key, placement.previous);
      try {
        await deps.save(placement.key, placement.previous);
      } catch {
        // Memory has been restored; a failed disk restore must not mask the original error.
      }
    } else {
      deps.memory.delete(placement.key);
      try {
        await deps.remove(placement.key);
      } catch {
        // The destination was absent before this write; best-effort cleanup is sufficient.
      }
    }
  }
}

/**
 * Writes assets to memory and persistent storage, returning a rollback function.
 * If any write fails, all placements made by this call are rolled back before
 * the original error is rethrown.
 */
export async function stageAssetWrites(
  writes: AssetWrite[],
  deps: AssetWriteDeps,
): Promise<() => Promise<void>> {
  const placements: AssetPlacement[] = [];
  try {
    for (const write of writes) {
      const previous = deps.memory.get(write.key) ?? null;
      deps.memory.set(write.key, write.bytes);
      placements.push({ key: write.key, previous });
      await deps.save(write.key, write.bytes);
    }
    return async () => rollbackPlacements(placements, deps);
  } catch (error) {
    await rollbackPlacements(placements, deps);
    throw error;
  }
}
