// [Alex] Small animation building blocks used across the app (Motion / framer-motion).
'use client';
import { animate, motion, useInView, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts its children in, once, when scrolled into view. */
export function Reveal({ children, delay = 0, y = 18, ...rest }: { children: ReactNode; delay?: number; y?: number } & HTMLMotionProps<'div'>) {
  return (
    <motion.div initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.8, ease: EASE, delay }} {...rest}>
      {children}
    </motion.div>
  );
}

/** Children appear one after another (wrap each in <StaggerItem>). */
export function Stagger({ children, gap = 0.07, ...rest }: { children: ReactNode; gap?: number } & HTMLMotionProps<'div'>) {
  return (
    <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }} {...rest}>
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, ...rest }: { children: ReactNode } & HTMLMotionProps<'div'>) {
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } }} {...rest}>
      {children}
    </motion.div>
  );
}

/** A number that counts up to its value when it comes into view. */
export function CountUp({ value, format = (n) => n.toFixed(0), duration = 1.4 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) return setShown(value);
    const c = animate(0, value, { duration, ease: EASE, onUpdate: setShown });
    return () => c.stop();
  }, [inView, value, duration, reduce]);
  return (
    <span ref={ref} className="num">
      {format(shown)}
    </span>
  );
}

/** Drag-and-drop file picker. The real <input type=file> covers the zone, so clicks and drops both work. */
export function Dropzone({ accept, onFile, file, title, hint, icon }: { accept: string; onFile: (f: File | null) => void; file: File | null; title: string; hint: string; icon: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`drop${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => setOver(false)}
    >
      <input type="file" accept={accept} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <motion.div key={file?.name ?? 'empty'} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.45, ease: EASE }} style={{ color: file ? 'var(--green)' : 'var(--brass)' }}>
        {icon}
      </motion.div>
      {file ? (
        <>
          <b style={{ fontWeight: 600 }}>{file.name}</b>
          <span className="muted" style={{ fontSize: 13 }}>
            {(file.size / 1e6).toFixed(file.size > 1e6 ? 1 : 2)} MB · click or drop to replace
          </span>
        </>
      ) : (
        <>
          <b style={{ fontWeight: 600 }}>{title}</b>
          <span className="muted" style={{ fontSize: 13 }}>
            {hint}
          </span>
        </>
      )}
    </label>
  );
}

/** Thin-line icons (24 px grid). */
export const Icon = {
  plan: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h18v16H3z" />
      <path d="M3 12h7v8M14 4v6h7M10 12h1M14 14v6" />
    </svg>
  ),
  video: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5 9-10" />
    </svg>
  ),
  arrow: (
    <svg className="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
};
