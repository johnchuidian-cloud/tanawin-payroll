// The Tanawin wordmark: the flower/starburst sits ABOVE the i (as its dot —
// dotless ı + positioned ✸), not inline, so it can't read as a letter.
// Mirrors Kitchen's Wordmark; colors inherit except the flower's override.
export default function Wordmark({
  className = '',
  flowerClassName = '',
}: {
  className?: string;
  flowerClassName?: string;
}) {
  return (
    <div className={`font-bold tracking-[0.3px] flex items-center ${className}`}>
      Tanaw
      <span className="relative inline-block">
        ı
        <span
          className={`absolute left-1/2 -translate-x-1/2 text-[0.5em] leading-none ${flowerClassName}`}
          style={{ bottom: '1.6em' }}
        >
          ✸
        </span>
      </span>
      n
    </div>
  );
}
