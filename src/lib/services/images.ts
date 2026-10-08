import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config, ensureDataDirs } from '../config';
import { AppError } from '../errors';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

/** The only file names the app ever stores or serves from uploads/. */
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

/** Write a processed image into the uploads folder. Returns paths relative to it. */
export function saveProcessed({ main, thumb }: ProcessedImage): { image: string; thumb: string } {
  ensureDataDirs();
  const id = crypto.randomBytes(12).toString('hex');
  const image = `items/${id}.webp`;
  const thumbPath = `items/${id}_t.webp`;
  fs.writeFileSync(path.join(config.UPLOAD_DIR, image), main);
  fs.writeFileSync(path.join(config.UPLOAD_DIR, thumbPath), thumb);
  return { image, thumb: thumbPath };
}

/** Remove stored image files. Only ever touches generated names inside uploads/items. */
export function removeStored(...relativePaths: string[]): void {
  for (const rel of relativePaths) {
    if (!STORED_IMAGE_PATTERN.test(rel || '')) continue;
    fs.rm(path.join(config.UPLOAD_DIR, rel), { force: true }, () => {});
  }
}
