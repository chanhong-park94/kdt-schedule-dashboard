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

export function assertClientEnv(keys: string[]): string {
  for (const key of keys) {
    const value = readProcessEnv(key);
    if (value.length > 0) {
      return value;
    }
  }
  throw new Error(
    `필수 환경변수가 없습니다: ${keys.join(", ")}\n` +
    `.env.local 또는 배포 환경의 환경변수를 확인하세요.`
  );
}

export function isDevRuntime(): boolean {
  const nodeEnv = readProcessEnv("NODE_ENV");
  return nodeEnv !== "production";
}

export function isProdRuntime(): boolean {
  return readProcessEnv("NODE_ENV") === "production";
}
