type ShowAdvancedPolicyInput = {
  savedShowAdvanced: boolean | undefined;
  search: string;
  isDev: boolean;
  isProd: boolean;
};

function parseBooleanQueryValue(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return null;
}

export function resolveShowAdvancedPolicy(input: ShowAdvancedPolicyInput): boolean {
  if (input.isProd) {
    return false;
  }

  if (input.isDev) {
    const params = new URLSearchParams(input.search);
    const fromQuery = parseBooleanQueryValue(params.get("showAdvanced"));
    if (fromQuery !== null) {
      return fromQuery;
    }
  }

  return input.savedShowAdvanced === true;
}
