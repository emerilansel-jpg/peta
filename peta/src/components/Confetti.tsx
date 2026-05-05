import React from 'react';

const COLORS = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#06D6A0', '#FF8B6B', '#A78BFA'];

interface Piece {
  id: number;
  left: number;       // %
  delay: number;      // s
  duration: number;   // s
  color: string;
  rotate: number;     // deg
  drift: number;      // px horizontal drift
  size: number;       // px
  shape: 'sq' | 'circ';
}

function makePieces(count: number): Piece[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.4,
    duration: 1.6 + Math.random() * 1.6,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotate: Math.random() * 360,
    drift: (Math.random() - 0.5) * 200,
    size: 8 + Math.random() * 8,
    shape: Math.random() > 0.5 ? 'sq' : 'circ',
  }));
}

/**
 * Imperatively-firable confetti. Mount once near the page root, then call
 * the returned `fire()` to launch a burst.
 *
 *   const confetti = useConfetti();
 *   <ConfettiHost ref={confetti.ref} />
 *   confetti.fire();
 */
export function ConfettiBurst({ active, onDone }: { active: boolean; onDone?: () => void }) {
  const [pieces, setPieces] = React.useState<Piece[]>([]);
  // Hold latest onDone in a ref so re-creating the prop callback every render
  // doesn't restart the burst.
  const onDoneRef = React.useRef(onDone);
  React.useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  React.useEffect(() => {
    if (!active) return;
    setPieces(makePieces(70));
    const t = setTimeout(() => {
      setPieces([]);
      onDoneRef.current?.();
    }, 3500);
    return () => clearTimeout(t);
    // Intentionally only depend on `active` — onDone is read via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (pieces.length === 0) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.shape === 'circ' ? p.size : p.size * 1.4}px`,
            background: p.color,
            borderRadius: p.shape === 'circ' ? '50%' : '2px',
            animation: `confetti-fall ${p.duration}s ${p.delay}s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`,
            ['--rot' as any]: `${p.rotate}deg`,
            ['--drift' as any]: `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
