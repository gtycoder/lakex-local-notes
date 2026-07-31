interface ConvertMessage {
  id: string;
  bytes: number[];
  mimeType: string;
}

interface ConvertResult {
  id: string;
  success: boolean;
  bytes?: number[];
  error?: string;
}

self.onmessage = async (event: MessageEvent<ConvertMessage>) => {
  const { id, bytes, mimeType } = event.data;

  try {
    const pngBytes = await convertToPng(bytes, mimeType);
    self.postMessage({ id, success: true, bytes: pngBytes } as ConvertResult);
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    } as ConvertResult);
  }
};

async function convertToPng(bytes: number[], mimeType: string): Promise<number[]> {
  const uint8Array = new Uint8Array(bytes);
  const blob = new Blob([uint8Array], { type: mimeType });
  const bitmap = await createImageBitmap(blob);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    ctx.drawImage(bitmap, 0, 0);

    const pngBlob = await canvas.convertToBlob({ type: "image/png" });
    const pngBuffer = await pngBlob.arrayBuffer();
    return Array.from(new Uint8Array(pngBuffer));
  } finally {
    bitmap.close();
  }
}
