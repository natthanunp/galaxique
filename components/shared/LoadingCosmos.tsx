"use client";

import { motion } from "framer-motion";

/** A small spinning-orbit loader shown while Gemini is thinking. */
export function LoadingCosmos({
  label = "Consulting the cosmos…",
}: {
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16">
      <div className="relative size-24">
        {/* orbit ring */}
        <motion.div
          className="absolute inset-0 rounded-full border border-primary/30"
          animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
        />
        {/* inner ring */}
        <motion.div
          className="absolute inset-3 rounded-full border border-accent/40"
          animate={{ rotate: -360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        />
        {/* glowing core */}
        <motion.div
          className="absolute inset-8 rounded-full bg-primary"
          animate={{
            scale: [1, 1.25, 1],
            opacity: [0.7, 1, 0.7],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          style={{ boxShadow: "0 0 24px 4px hsl(var(--primary) / 0.6)" }}
        />
        {/* orbiting dot */}
        <motion.div
          className="absolute left-1/2 top-0 size-2 -translate-x-1/2 rounded-full bg-accent"
          style={{ boxShadow: "0 0 10px 2px hsl(var(--accent) / 0.8)" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          // orbit around center by rotating the wrapper
        >
          <motion.div
            className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
            style={{ boxShadow: "0 0 10px 2px hsl(var(--accent) / 0.8)" }}
          />
        </motion.div>
      </div>
      <motion.p
        className="text-sm text-muted-foreground"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        {label}
      </motion.p>
    </div>
  );
}
