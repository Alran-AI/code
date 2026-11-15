import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

export interface RefreshOwner {
  pid: number;
  startedAtMs: number;
}

const owner: RefreshOwner = {
  pid: process.pid,
  startedAtMs: Math.trunc(performance.timeOrigin),
};

/**
 * How much later than the recorded owner a process may have started and still be that owner.
 *
 * `startedAtMs` is Node's own clock reading, taken a moment after the process began; the kernel's
 * figure (Linux: jiffies since boot over a boot time with one-second resolution) is a different
 * measurement of the same instant. Five seconds is far above their disagreement and far below the
 * time it takes a PID to come round again, so a process that started later than this was not the
 * one that wrote the fence.
 */
const RECYCLED_PID_MARGIN_MS = 5_000;

/** Where a process's start time can be read from; replaceable so the rule can be tested. */
export interface ProcessStartProbe {
  /** Epoch milliseconds at which `pid` started, or `undefined` when this platform cannot say. */
  processStartMs(pid: number): number | undefined;
}

/** Linux: `/proc/<pid>/stat` field 22 (jiffies since boot) plus the boot time from `/proc/stat`. */
function readProcfsStartMs(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command name is parenthesised and may itself contain spaces and parentheses, so the
    // numeric fields are counted from the last `)`: the remainder starts at field 3 (state).
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const startJiffies = Number(fields[19]);
    const bootSeconds = Number(/^btime (\d+)$/mu.exec(readFileSync('/proc/stat', 'utf8'))?.[1]);
    if (!Number.isFinite(startJiffies) || !Number.isFinite(bootSeconds)) return undefined;
    // USER_HZ is 100 on every Linux ABI that exposes /proc/<pid>/stat in jiffies.
    return bootSeconds * 1_000 + (startJiffies / 100) * 1_000;
  } catch {
    return undefined;
  }
}

/**
 * Whether the kernel's clock agrees with this process's own for the one process whose start we know.
 *
 * Declaring a live owner dead lets a second process refresh a grant the first is still using, which
 * is the double use the fence exists to prevent. A container or time namespace whose boot time does
 * not line up with the wall clock would make every foreign process look as if it had started "later",
 * so the probe is only believed when it reproduces this process's own start.
 */
let procfsCalibrated: boolean | undefined;
function procfsAgreesWithNode(): boolean {
  if (procfsCalibrated === undefined) {
    const own = readProcfsStartMs(process.pid);
    procfsCalibrated = own !== undefined && Math.abs(own - owner.startedAtMs) <= RECYCLED_PID_MARGIN_MS;
  }
  return procfsCalibrated;
}

const procfsProbe: ProcessStartProbe = {
  processStartMs(pid) {
    if (process.platform !== 'linux' || !procfsAgreesWithNode()) return undefined;
    return readProcfsStartMs(pid);
  },
};

export function currentRefreshOwner(): RefreshOwner {
  return { ...owner };
}

/**
 * Unknown/foreign reused PIDs stay live; only positive evidence may discard a grant.
 *
 * Positive evidence is a process that does not exist (`ESRCH`), or a process that exists under the
 * PID but started after the owner recorded in the fence did: PIDs are recycled, and a fence whose
 * owner crashed must not be kept alive for ever by an unrelated process that was given its number.
 */
export function isRefreshOwnerAlive(
  candidate: RefreshOwner | undefined,
  probe: ProcessStartProbe = procfsProbe,
): boolean {
  if (!candidate) return true; // Intermediate development builds wrote fences without an owner.
  if (candidate.pid === owner.pid) return candidate.startedAtMs === owner.startedAtMs;
  try {
    process.kill(candidate.pid, 0);
  } catch (error) {
    // `ESRCH` is the only proof of absence. `EPERM` means the process exists and is somebody
    // else's, which is exactly the case in which its start time still says who it is.
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
  }
  const startedMs = probe.processStartMs(candidate.pid);
  if (startedMs === undefined) return true;
  return startedMs - candidate.startedAtMs <= RECYCLED_PID_MARGIN_MS;
}
