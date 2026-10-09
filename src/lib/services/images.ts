import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from '../config';
import { get, now, run } from '../db';
import { AppError } from '../errors';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

/** The only image names the app ever stores or serves under /uploads/. */
export const STORED_IMAGE_PATTERN = /^items\/[a-f0-9]{24}(_t)?\.webp$/;

export interface ProcessedImage {
  main: Buffer;
  thumb: Buffer;
}

/**
 * Validate an uploaded image and produce the two files the app stores:
 * a web-sized main image and a small square thumbnail. Re-encoding also
 * strips anything that is not picture data.
 */
export async function processImage(buffer: Buffer): Promise<ProcessedImage> {
  if (!buffer || !buffer.length) throw new AppError('Image is required.');
  if (buffer.length > config.MAX_IMAGE_BYTES) throw new AppError('Image is larger than 2 MB.');
  let format: string | undefined;
  try {
    format = (await sharp(buffer).metadata()).format;
  } catch {
    throw new AppError('The file is not a valid image.');
  }
  if (!format || !ALLOWED_FORMATS.has(format)) throw new AppError('Image must be a JPG, PNG, WebP or GIF.');
  try {
    const main = await sharp(buffer).rotate()
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 82 }).toBuffer();
    const thumb = await sharp(buffer).rotate()
      .resize(200, 200, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 76 }).toBuffer();
    return { main, thumb };
  } catch {
    throw new AppError('The image could not be processed.');
  }
}

/**
 * Store a processed image and its thumbnail. Returns the paths they are served
 * under (/uploads/<path>). Inside tx() they are saved together with the item.
 */
export async function saveProcessed({ main, thumb }: ProcessedImage): Promise<{ image: string; thumb: string }> {
  const id = crypto.randomBytes(12).toString('hex');
  const image = `items/${id}.webp`;
  const thumbPath = `items/${id}_t.webp`;
  const ts = now();
  await run('INSERT INTO images (path, data, created_at) VALUES (?, ?, ?), (?, ?, ?)', image, main, ts, thumbPath, thumb, ts);
  return { image, thumb: thumbPath };
}

/** The bytes of a stored image, or undefined. Only generated names are ever looked up. */
export async function readStored(relativePath: string): Promise<Buffer | undefined> {
  if (!STORED_IMAGE_PATTERN.test(relativePath)) return undefined;
  return (await get<{ data: Buffer }>('SELECT data FROM images WHERE path = ?', relativePath))?.data;
}

/** Remove stored images. */
export async function removeStored(...relativePaths: string[]): Promise<void> {
  for (const rel of relativePaths) {
    if (STORED_IMAGE_PATTERN.test(rel || '')) await run('DELETE FROM images WHERE path = ?', rel);
  }
}
