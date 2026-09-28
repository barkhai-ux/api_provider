"use client";

import { motion } from "motion/react";

/**
 * The raised "selected" background of a segmented control. Render it inside
 * the selected segment (which must be `relative`); with a shared `layoutId`
 * it slides between segments instead of jumping.
 */
export function SegmentThumb({ layoutId }: { layoutId: string }) {
  return (
    <motion.span
      layoutId={layoutId}
      className="absolute inset-0 rounded-md bg-background shadow-xs"
      transition={{ type: "spring", duration: 0.3, bounce: 0 }}
      aria-hidden="true"
    />
  );
}
