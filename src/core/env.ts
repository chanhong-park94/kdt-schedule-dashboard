function readProcessEnv(key: string): string {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
}

export function readClientEnv(keys: string[]): string {
  for (const key of keys) {
    const fromProcess = readProcessEnv(key);
    if (fromProcess.length > 0) {
      return fromProcess;
    }
  }

  return "";
}

export function isDevRuntime(): boolean {
  const nodeEnv = readProcessEnv("NODE_ENV");
  return nodeEnv !== "production";
}

export function isProdRuntime(): boolean {
  return readProcessEnv("NODE_ENV") === "production";
}
