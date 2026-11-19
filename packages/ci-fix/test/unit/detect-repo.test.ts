import { describe, expect, it } from "vitest";
import { parseGitHubRemote, sameGitHubRepo } from "../../src/detect-repo.js";

describe("github remote parsing", () => {
  it("accepts every remote form GitHub emits", () => {
    expect(parseGitHubRemote("https://github.com/ottili/alran-code.git")).toEqual({
      owner: "ottili",
      repo: "alran-code",
      fullName: "ottili/alran-code",
    });
    expect(parseGitHubRemote("git@github.com:ottili/alran-code.git")?.fullName).toBe(
      "ottili/alran-code",
    );
    expect(parseGitHubRemote("ssh://git@github.com/ottili/alran-code.git")?.fullName).toBe(
      "ottili/alran-code",
    );
    expect(parseGitHubRemote("git://github.com/ottili/alran-code.git")?.fullName).toBe(
      "ottili/alran-code",
    );
    expect(parseGitHubRemote("github.com:ottili/alran-code")?.fullName).toBe("ottili/alran-code");
    expect(parseGitHubRemote("https://github.com/ottili/alran-code")?.fullName).toBe(
      "ottili/alran-code",
    );
  });

  it("rejects non-GitHub hosts and malformed paths", () => {
    expect(parseGitHubRemote("https://gitlab.com/ottili/alran-code.git")).toBeUndefined();
    expect(parseGitHubRemote("https://github.com/ottili")).toBeUndefined();
    expect(parseGitHubRemote("")).toBeUndefined();
    expect(parseGitHubRemote("file:///home/user/alran-code")).toBeUndefined();
  });

  it("compares repositories case-insensitively", () => {
    const a = parseGitHubRemote("https://github.com/Ottili/Alran-Code")!;
    const b = parseGitHubRemote("https://github.com/ottili/alran-code.git")!;
    expect(sameGitHubRepo(a, b)).toBe(true);
  });
});
