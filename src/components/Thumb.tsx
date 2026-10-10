/** An item's thumbnail. Items imported in bulk have no picture until one is added, so they show a placeholder. */
export function Thumb({ src, alt = '', size = 44, href }: { src: string; alt?: string; size?: number; href?: string }) {
  if (!src) return <span className="thumb thumb-missing" style={{ width: size, height: size }} title="No picture yet" aria-hidden="true" />;
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="thumb" src={`/uploads/${src}`} alt={alt} width={size} height={size} loading="lazy" />
  );
  return href ? <a href={`/uploads/${href}`} target="_blank" rel="noreferrer" title="Open full image">{img}</a> : img;
}
