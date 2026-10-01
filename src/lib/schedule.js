// Formatting, sanitising and highlighting are synchronous and block the main
// thread. Awaiting this between stages lets the browser paint the progress
// overlay first, so a slow document shows what it is doing instead of freezing.
export function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

// Documents below this size are fast enough that staging them would only make
// the overlay flicker, so they are done in one synchronous pass.
export const STAGE_THRESHOLD = 250_000
