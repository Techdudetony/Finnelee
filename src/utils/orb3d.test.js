import { afterEach, describe, expect, it, vi } from "vitest";
import { failOrb3d, orb3dAllowed, orb3dFailure } from "./orb3d";

describe("orb3dAllowed", () => {
  afterEach(() => {
    failOrb3d(null);
    vi.unstubAllGlobals();
  });
  const withWebGL = () =>
    vi.stubGlobal("WebGLRenderingContext", function () {});

  it("is off unless the switch is exactly on (older backups have no orb3d)", () => {
    withWebGL();
    expect(orb3dAllowed(undefined, true)).toBe(false);
    expect(orb3dAllowed(false, true)).toBe(false);
    expect(orb3dAllowed("true", true)).toBe(false);
    expect(orb3dAllowed(true, true)).toBe(true);
  });

  it("only runs at Full motion", () => {
    withWebGL();
    expect(orb3dAllowed(true, false)).toBe(false);
  });

  it("needs WebGL", () => {
    vi.stubGlobal("WebGLRenderingContext", undefined);
    expect(orb3dAllowed(true, true)).toBe(false);
  });

  it("stays off for the rest of the session after a failure, and says why", () => {
    withWebGL();
    expect(orb3dFailure()).toBe(null);
    failOrb3d("slow");
    expect(orb3dAllowed(true, true)).toBe(false);
    expect(orb3dFailure()).toBe("slow");
  });
});
