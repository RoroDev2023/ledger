// [Alex] Every page change fades and lifts in (Next re-mounts a template on each navigation).
'use client';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { EASE } from '../components/motion';

export default function Template({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
      {children}
    </motion.div>
  );
}
