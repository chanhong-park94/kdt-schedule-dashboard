"use client";

import { useEffect } from "react";

let bootstrapPromise: Promise<unknown> | null = null;

declare global {
  interface Window {
    __kdtLegacyBootstrapped?: boolean;
  }
}

export default function LegacyBootstrap(): null {
  useEffect(() => {
    if (window.__kdtLegacyBootstrapped) {
      return;
    }

    window.__kdtLegacyBootstrapped = true;

    if (!bootstrapPromise) {
      bootstrapPromise = import("../src/main");
    }
  }, []);

  return null;
}
