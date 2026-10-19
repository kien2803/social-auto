import { open } from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';

const ACCEPTED_FORMATS = new Set(['mp4', 'mov', 'webm']);

export async function detectRealFileType(filePath: string): Promise<string> {
  try {
    const fileHandle = await open(filePath, 'r');
    const buffer = Buffer.alloc(4100);
    const { bytesRead } = await fileHandle.read(buffer, 0, 4100, 0);
    await fileHandle.close();
    
    const type = await fileTypeFromBuffer(buffer.subarray(0, bytesRead));
    
    if (type && ACCEPTED_FORMATS.has(type.ext)) {
      return type.ext;
    }
    
    throw new Error(`Invalid video format based on file signature. Detected: ${type?.ext || 'unknown'}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid video format')) {
      throw error;
    }
    throw new Error(`File type detection failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export function detectFileTypeByMIME(filePath: string): string {
  // Fallback to extension-based detection if magic number detection fails
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext && ACCEPTED_FORMATS.has(ext)) {
    return ext;
  }
  throw new Error(`Cannot determine file type from extension: ${ext}`);
}