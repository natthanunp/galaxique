import * as React from "react";

import { cn } from "@/lib/utils";

/** A thin glowing progress bar used for quiz step progress. */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<"div"> & { value?: number }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  return (
    <div
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      {...props}
    >
      <div
        className="h-full rounded-full bg-linear-to-r from-primary to-accent transition-all duration-500 ease-out"
        style={{
          width: `${pct}%`,
        }}
      />
    </div>
  );
}

export { Progress };
