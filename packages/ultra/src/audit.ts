/**
 * Interim audits (spec 13.4).
 *
 * Every `audit_every` rounds an auditor reviews the whole run against the goal
 * document. Its job is not to re-check a packet — that is the verifier's — but to
 * catch *drift*: an early decision that was wrong, and that every later packet
 * then kept building on. A run of individually green packets can still be
 * building the wrong thing, and only a view of the whole can see it.
 *
 * The audit is deliberately allowed to be skipped when it fails. An auditor that
 * cannot run must not end an otherwise healthy run; it is recorded in the ledger
 * and the next round proceeds. What it must not do is invent confidence, so a
 * failed audit produces no findings and no rework.
 */

import type { Ledger } from './ledger.js';
import { RunStore } from './run-state.js';
import type { GoalDocument } from './goal.js';
import type { PlanPacket } from './types.js';

export type AuditSeverity = 'low' | 'medium' | 'high';
export type AuditFindingKind = 'drift' | 'gap' | 'risk' | 'note';

export interface AuditFinding {
  readonly round: number;
  readonly kind: AuditFindingKind;
  readonly severity: AuditSeverity;
  readonly text: string;
  /** What the next round should do about it; empty means "no action". */
  readonly rework: string;
}

export interface AuditPorts {
  /**
   * Reviews the run against the goal document. Returns findings, not a verdict:
   * the loop decides what to do with them.
   */
  readonly audit: (input: {
    readonly round: number;
    readonly goal: GoalDocument;
    readonly notes: string;
  }) => Promise<{
    readonly findings: readonly AuditFinding[];
    readonly costUsd?: number;
    readonly tokensUsed?: number;
  }>;
}

export interface AuditResult {
  readonly findings: readonly AuditFinding[];
  /** Packets the next round should run to address high-severity drift. */
  readonly rework: readonly PlanPacket[];
}

/** Rounds are audited every `auditEvery` rounds; 0 or undefined disables it. */
export function isAuditRound(round: number, auditEvery: number | undefined): boolean {
  if (!auditEvery || auditEvery <= 0) return false;
  return round % auditEvery === 0;
}

/**
 * Runs one audit.
 *
 * Never throws: a failed audit is recorded and returns no findings, because a
 * broken auditor must not be able to end a healthy run.
 */
export async function auditRound(input: {
  readonly store: RunStore;
  readonly ledger: Ledger;
  readonly goal: GoalDocument;
  readonly round: number;
  readonly ports: AuditPorts;
  /** Prior curated notes, so the auditor sees the run's own memory. */
  readonly notes?: string;
}): Promise<AuditResult> {
  const { store, ledger, goal, ports, round } = input;

  let findings: AuditFinding[] = [];
  try {
    const report = await ports.audit({
      round,
      goal,
      notes: input.notes ?? '',
    });
    findings = report.findings.map((finding) => ({ ...finding, round }));
    ledger.append({
      kind: 'step',
      role: 'audit',
      status: 'done',
      note: `${findings.length} finding(s)`,
      ...(typeof report.costUsd === 'number' ? { costUsd: report.costUsd } : {}),
      ...(typeof report.tokensUsed === 'number' ? { tokensUsed: report.tokensUsed } : {}),
    });
  } catch (error) {
    ledger.append({
      kind: 'step',
      role: 'audit',
      status: 'error',
      note: error instanceof Error ? error.message : String(error),
    });
    return { findings: [], rework: [] };
  }

  return { findings, rework: reworkPackets(findings, store) };
}

/**
 * Turns high-severity findings into packets for the next round.
 *
 * Only `high` severity produces work: a medium finding is worth recording, but
 * turning every note into a packet would let the auditor rewrite the plan every
 * round, which is the opposite of a bounded run.
 */
function reworkPackets(findings: readonly AuditFinding[], store: RunStore): PlanPacket[] {
  const packets: PlanPacket[] = [];
  let index = 0;
  for (const finding of findings) {
    if (finding.severity !== 'high') continue;
    index += 1;
    const id = `audit${store.state.runId.replace(/[^A-Za-z0-9]/gu, '').slice(-4)}-${String(index)}`;
    packets.push({
      id,
      round: finding.round + 1,
      title: `Audit rework: ${finding.kind}`,
      goal: finding.rework.length > 0 ? finding.rework : finding.text,
      // Audit rework is a consequence of the whole run, so it is not confined to
      // one module: the scope is the run's own source tree, kept broad enough to
      // be actionable and still inside the repository.
      scope: ['src/**'],
      depends_on: [],
    });
  }
  return packets;
}