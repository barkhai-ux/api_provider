"use client";

import { motion, type HTMLMotionProps } from "motion/react";

/** Strong ease-out (see --ease-out in globals.css). */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type RevealProps = HTMLMotionProps<"div"> & {
  /** Seconds to wait after the element scrolls into view. */
  delay?: number;
  /** Starting offset in pixels below the resting position. */
  offset?: number;
};

/**
 * Fades and lifts its children once, the first time they scroll into view.
 * Uses a transform string so the animation runs off the main thread.
 */
export function Reveal({ delay = 0, offset = 24, transition, ...props }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, transform: `translateY(${offset}px)` }}
      whileInView={{ opacity: 1, transform: "translateY(0px)" }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.7, ease: EASE_OUT, delay, ...transition }}
      {...props}
    />
  );
}
