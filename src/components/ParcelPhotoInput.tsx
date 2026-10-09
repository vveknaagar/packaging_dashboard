'use client';

import { useEffect, useState } from 'react';

const MAX_SIDE = 1600;
const MAX_BYTES = 2 * 1024 * 1024;

/** Phone photos are often 5 MB or more; shrink to a JPEG well under the upload limit before sending. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not shrink the photo.');
  return new File([blob], 'parcel.jpg', { type: 'image/jpeg' });
}

interface Props {
  required?: boolean;
  /** Told whether a usable photo is chosen, so the form can enable its Dispatch button. */
  onReady?: (ready: boolean) => void;
}

/** Photo of the packed parcel, which the sender must add to dispatch a transfer. */
export function ParcelPhotoInput({ required, onReady }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setError(null);
    setPreview(null);
    onReady?.(false);
    if (!file) return;
    setBusy(true);
    try {
      let photo = file;
      try { photo = await shrink(file); } catch { /* the browser cannot read it; send it as it is and let the server judge */ }
      if (photo.size > MAX_BYTES) throw new Error(`This photo is ${(photo.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`);
      // Send the smaller copy in place of the original.
      const files = new DataTransfer();
      files.items.add(photo);
      input.files = files.files;
      setPreview(URL.createObjectURL(photo));
      onReady?.(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This photo cannot be used.');
      input.value = '';
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="image-input">
      <div className="image-preview">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview ? <img src={preview} alt="Parcel photo" /> : <span className="muted">{busy ? 'Preparing…' : 'No photo'}</span>}
      </div>
      <div>
        <input type="file" name="parcel_photo" accept="image/*" required={required} onChange={onChange} />
        <p className="hint">Take a clear photo of the packed parcel. On a phone you can use the camera.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
