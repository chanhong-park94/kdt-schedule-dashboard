function readEnvValue(key: string): string {
  // 1. Vite browser builds: import.meta.env is replaced at build time
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
    if (metaEnv) {
      const v = metaEnv[key];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
  } catch {
    /* import.meta not available */
  }

  // 2. Node.js / vitest: process.env is available
  try {
    const v = process.env[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  } catch {
    /* process not available in browser */
  }

  return "";
}

export function readClientEnv(keys: string[]): string {
  for (const key of keys) {
    const fromProcess = readEnvValue(key);
    if (fromProcess.length > 0) {
      return fromProcess;
    }
  }

  return "";
}

export function assertClientEnv(keys: string[]): string {
  if (keys.length === 0) {
    throw new RangeError("assertClientEnv: keys 배열이 비어 있습니다.");
  }
  for (const key of keys) {
    const value = readEnvValue(key);
    if (value.length > 0) {
      return value;
    }
  }
  throw new Error(
    `필수 환경변수가 없습니다: ${keys.join(", ")}\n` + `.env.local 또는 배포 환경의 환경변수를 확인하세요.`,
  );
}

export function isDevRuntime(): boolean {
  const nodeEnv = readEnvValue("NODE_ENV");
  return nodeEnv !== "production";
}

export function isProdRuntime(): boolean {
  return readEnvValue("NODE_ENV") === "production";
}
