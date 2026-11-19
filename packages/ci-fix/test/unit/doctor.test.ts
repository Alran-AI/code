import { describe, expect, it } from "vitest";
import { doctorIsHealthy, runDoctorChecks } from "../../src/doctor.js";
import { DEFAULT_CI_FIX_CONFIG } from "../../src/config.js";

const healthy = {
  ghAuthenticated: true,
  secretPresent: true,
  workflowInstalled: true,
  workflowPermissions: ["contents: write", "pull-requests: write", "actions: read"],
  isFork: false,
  repositoryWorkflows: ["CI", "Rust"],
  monitoredWorkflows: ["CI"],
  pushTokenSecretPresent: true,
  configEnabled: true,
  configProblems: [],
};

describe("doctor checks", () => {
  it("passes a healthy installation", () => {
    const checks = runDoctorChecks(healthy);
    expect(checks.map((check) => check.id)).toEqual([
      "gh-login",
      "api-key-secret",
      "workflow-permissions",
      "fork",
      "monitored-workflows",
      "config",
      "enabled",
      "retrigger-token",
    ]);
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(doctorIsHealthy(checks)).toBe(true);
  });

  it("flags a fork and a missing monitored workflow", () => {
    const checks = runDoctorChecks({ ...healthy, isFork: true, monitoredWorkflows: ["CI", "Nope"] });
    const fork = checks.find((check) => check.id === "fork")!;
    const workflows = checks.find((check) => check.id === "monitored-workflows")!;
    expect(fork.ok).toBe(false);
    expect(fork.hint).toContain("upstream");
    expect(workflows.ok).toBe(false);
    expect(workflows.detail).toContain("Nope");
    expect(doctorIsHealthy(checks)).toBe(false);
  });

  it("rejects a workflow with too much permission", () => {
    const checks = runDoctorChecks({
      ...healthy,
      workflowPermissions: ["contents: write", "pull-requests: write", "actions: read", "security-events: write"],
    });
    const permissions = checks.find((check) => check.id === "workflow-permissions")!;
    expect(permissions.ok).toBe(false);
    expect(permissions.detail).toContain("extra");
  });

  it("treats a missing push token as a warning, not a failure", () => {
    const checks = runDoctorChecks({ ...healthy, pushTokenSecretPresent: false });
    const token = checks.find((check) => check.id === "retrigger-token")!;
    expect(token.ok).toBe(false);
    expect(token.severity).toBe("warning");
    expect(token.hint).toContain("ALRAN_CI_PUSH_TOKEN");
    expect(doctorIsHealthy(checks)).toBe(true);
  });

  it("reports config problems and a disabled installation", () => {
    const checks = runDoctorChecks({
      ...healthy,
      configProblems: ["mode.pull_request: unknown mode"],
      configEnabled: false,
    });
    expect(checks.find((check) => check.id === "config")?.hint).toContain("unknown mode");
    expect(checks.find((check) => check.id === "enabled")?.ok).toBe(false);
    expect(checks.find((check) => check.id === "enabled")?.severity).toBe("error");
    expect(doctorIsHealthy(checks)).toBe(false);
  });

  it("uses the baseline config for defaults", () => {
    expect(DEFAULT_CI_FIX_CONFIG.guards.forbid_test_weakening).toBe(true);
  });
});
