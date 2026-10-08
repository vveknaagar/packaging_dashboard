'use client';

import { useEffect, useState } from 'react';

const MAX_BYTES = 2 * 1024 * 1024;

interface Props {
  name: string;
  required?: boolean;
  /** Existing image to show until a new one is chosen. */
  currentSrc?: string;
}

/** Image picker with an instant preview and a 2 MB check before anything is uploaded. */
export function ImageInput({ name, required, currentSrc }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    setPreview(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`This image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`);
      event.target.value = '';
      return;
    }
    setPreview(URL.createObjectURL(file));
  }

  const shown = preview ?? currentSrc;
  return (
    <div className="image-input">
      <div className="image-preview">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shown ? <img src={shown} alt="Item preview" /> : <span className="muted">No image</span>}
      </div>
      <div>
        <input type="file" name={name} accept="image/jpeg,image/png,image/webp,image/gif" required={required} onChange={onChange} />
        <p className="hint">JPG, PNG, WebP or GIF, up to 2 MB. A thumbnail is created automatically.</p>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
