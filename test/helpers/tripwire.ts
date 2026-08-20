/**
 * Fail the run if any promise rejection escapes the framework.
 *
 * The hardening checklist requires this in every suite that exercises the error
 * or disconnect paths: a swallowed rejection is exactly the bug class the
 * central dispatcher exists to prevent.
 */
export function trapUnhandledRejections(): { reasons: unknown[]; restore: () => void } {
  const reasons: unknown[] = [];
  const existing = process.listeners("unhandledRejection");
  for (const listener of existing) process.off("unhandledRejection", listener);

  const onRejection = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onRejection);

  return {
    reasons,
    restore: () => {
      process.off("unhandledRejection", onRejection);
      for (const listener of existing) process.on("unhandledRejection", listener);
    },
  };
}
