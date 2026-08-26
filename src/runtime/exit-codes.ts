/**
 * Exit codes two processes have to agree about.
 *
 * One member, and it exists because `scripts/dev.ts` restarts a child that dies
 * and `scripts/worker.ts` needs a way to say *"do not"*. A bare `78` in both
 * files would be two magic numbers that agree until somebody changes one.
 *
 * The value is `EX_CONFIG` from `sysexits.h` — the BSD convention for *"a
 * configuration error, and the software cannot proceed"*. Chosen rather than
 * invented because a supervisor above ours (launchd, an editor task runner, a
 * future menu-bar app) may already know what it means, and 1 means nothing at
 * all beyond "failed".
 */
export const EX_CONFIG = 78
