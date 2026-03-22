// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createTabLoader } from "../src/ui/tabLoader";

describe("createTabLoader", () => {
  it("calls factory on first load and caches result", async () => {
    const factory = vi.fn().mockResolvedValue(undefined);
    const loader = createTabLoader(factory);

    await loader();
    await loader();

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("returns the factory promise on concurrent calls", async () => {
    let resolveFactory!: () => void;
    const factory = vi.fn().mockReturnValue(
      new Promise<void>((r) => {
        resolveFactory = r;
      })
    );
    const loader = createTabLoader(factory);

    const p1 = loader();
    const p2 = loader();

    resolveFactory();
    await Promise.all([p1, p2]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("shows and hides loading indicator", async () => {
    const indicator = document.createElement("div");
    indicator.id = "tabLoadingIndicator";
    document.body.appendChild(indicator);

    const factory = vi.fn().mockResolvedValue(undefined);
    const loader = createTabLoader(factory);
    await loader();

    // After load, indicator should be hidden
    expect(indicator.classList.contains("is-visible")).toBe(false);
    document.body.removeChild(indicator);
  });
});
