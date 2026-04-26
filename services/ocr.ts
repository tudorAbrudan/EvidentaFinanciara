import TextRecognition from '@react-native-ml-kit/text-recognition';
import type { TextBlock } from '@react-native-ml-kit/text-recognition';

export type { TextBlock };

export interface OcrResult {
  text: string;
  blocks: string[];
  rawBlocks: TextBlock[];
}

/**
 * Extrage text dintr-o imagine locală.
 * @param imageUri - URI local (file:// sau path direct)
 */
export async function extractText(imageUri: string): Promise<OcrResult> {
  const result = await TextRecognition.recognize(imageUri);
  const blocks = result.blocks.map(b => b.text).filter(t => t.trim().length > 0);
  return {
    text: result.text,
    blocks,
    rawBlocks: result.blocks,
  };
}
