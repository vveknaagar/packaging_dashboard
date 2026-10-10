'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { finishTourAction } from '@/app/actions/auth';
import type { TourStep } from '@/lib/guide';

const WIDE = 960;
const BUBBLE = 340;
const GAP = 14;
const START_EVENT = 'mayave:start-tour';

/** "Take the tour again" on the User guide. */
export function StartTourButton() {
  return <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event(START_EVENT))}>Take the tour again</button>;
}

interface Props {
  steps: TourStep[];
  /** Open by itself: the user has not finished or skipped it before. */
  autoStart: boolean;
  /** On a phone the menu slides in, and must be open for the tour to point at its links. */
  setMenuOpen: (open: boolean) => void;
}

type Place = { left: number; top: number } | 'bottom' | 'top' | 'center';

/** Where the bubble goes: beside the highlighted thing if there is room, otherwise along the screen edge away from it. */
function placeFor(rect: DOMRect | null): Place {
  if (!rect) return 'center';
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (rect.right + GAP + BUBBLE <= w - 12) {
    return { left: rect.right + GAP, top: Math.max(12, Math.min(rect.top - 8, h - 260)) };
  }
  return rect.top + rect.height / 2 > h / 2 ? 'top' : 'bottom';
}

/**
 * A short walk through the menu on a user's first visit: each stop highlights
 * a feature and says what it is for. Finishing or skipping it is remembered.
 */
export function Tour({ steps, autoStart, setMenuOpen }: Props) {
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = index === null ? null : steps[index];

  // Opens on the first visit, and whenever the User guide's button asks for it again.
  useEffect(() => {
    if (autoStart) setIndex(0);
    const start = () => setIndex(0);
    window.addEventListener(START_EVENT, start);
    return () => window.removeEventListener(START_EVENT, start);
  }, [autoStart]);

  const close = useCallback(() => {
    setIndex(null);
    setRect(null);
    setMenuOpen(false);
    void finishTourAction();
  }, [setMenuOpen]);

  // Find what this step points at; open the phone menu first if it lives there.
  useLayoutEffect(() => {
    if (!step) return;
    const narrow = window.innerWidth < WIDE;
    if (narrow) setMenuOpen(!!step.inMenu);
    let frame = 0;
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
      setRect(el && el.offsetParent !== null ? el.getBoundingClientRect() : null);
    };
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    el?.scrollIntoView({ block: 'nearest' });
    measure();
    // The phone menu slides in, so measure again once it has arrived.
    const timer = window.setTimeout(measure, narrow ? 240 : 0);
    const onMove = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [step, setMenuOpen]);

  useEffect(() => {
    if (index === null) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setIndex((i) => (i === null ? i : Math.min(i + 1, steps.length - 1)));
      else if (e.key === 'ArrowLeft') setIndex((i) => (i === null ? i : Math.max(i - 1, 0)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, steps.length, close]);

  if (index === null || !step) return null;
  const last = index === steps.length - 1;
  const place = placeFor(rect);
  const pad = 6;

  return (
    <div className={`tour-layer${rect ? '' : ' tour-dim'}`}>
      {rect && (
        <div
          className="tour-spot" aria-hidden="true"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      )}
      <div
        className={`tour-bubble${typeof place === 'string' ? ` tour-${place}` : ''}`}
        style={typeof place === 'object' ? { left: place.left, top: place.top } : undefined}
        role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"
      >
        <div className="tour-count">{index + 1} of {steps.length}</div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-actions">
          {!last && <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Skip tour</button>}
          <span className="tour-spacer" />
          {index > 0 && <button type="button" className="btn btn-sm" onClick={() => setIndex(index - 1)}>Back</button>}
          <button
            ref={nextRef} type="button" className="btn btn-primary btn-sm"
            onClick={() => (last ? close() : setIndex(index + 1))}
          >
            {last ? 'Finish' : index === 0 ? 'Start' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
