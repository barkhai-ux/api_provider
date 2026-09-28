"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";

/**
 * Lays its child back in 3D and stands it upright as it scrolls into view.
 * The transform reaches identity before the child is fully on screen, so
 * pointer input on an embedded map is never skewed while someone uses it.
 */
export function ScrollTilt({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.4"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [18, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.94, 1]);

  return (
    <div ref={ref} className={className} style={{ perspective: 1800 }}>
      <motion.div style={reduced ? undefined : { rotateX, scale, transformOrigin: "50% 0%" }}>{children}</motion.div>
    </div>
  );
}
