import { Holiday } from "./types";

const HOLIDAY_CACHE = new Map<number, Holiday[]>();

function mapHoliday(raw: unknown): Holiday | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item = raw as Record<string, unknown>;

  if (typeof item.date !== "string" || typeof item.localName !== "string" || typeof item.name !== "string") {
    return null;
  }

  const holiday: Holiday = {
    date: item.date,
    localName: item.localName,
    name: item.name
  };

  if (typeof item.fixed === "boolean") {
    holiday.fixed = item.fixed;
  }
  if (typeof item.global === "boolean") {
    holiday.global = item.global;
  }
  if (item.counties === null || Array.isArray(item.counties)) {
    holiday.counties = item.counties as string[] | null;
  }
  if (item.launchYear === null || typeof item.launchYear === "number") {
    holiday.launchYear = item.launchYear as number | null;
  }
  if (Array.isArray(item.types)) {
    holiday.types = item.types.filter((value): value is string => typeof value === "string");
  }

  return holiday;
}

export async function fetchPublicHolidaysKR(year: number): Promise<Holiday[]> {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new Error(`공휴일 조회 연도가 올바르지 않습니다: ${year}`);
  }

  const cached = HOLIDAY_CACHE.get(year);
  if (cached) {
    return cached;
  }

  const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/KR`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("공휴일 정보를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
  }

  if (!response.ok) {
    throw new Error(
      `공휴일 정보를 불러오지 못했습니다. (연도: ${year}, 상태코드: ${response.status}) 잠시 후 다시 시도해 주세요.`
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error("공휴일 응답을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  if (!Array.isArray(json)) {
    throw new Error("공휴일 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.");
  }

  const mapped = json.map((item) => mapHoliday(item)).filter((item): item is Holiday => item !== null);

  // 2026년부터 제헌절(7/17) 공휴일 복원 — 외부 API 미반영 대비
  if (year >= 2026) {
    const constitutionDate = `${year}-07-17`;
    if (!mapped.some((h) => h.date === constitutionDate)) {
      mapped.push({
        date: constitutionDate,
        localName: "제헌절",
        name: "Constitution Day",
        fixed: true,
        global: true,
        counties: null,
        launchYear: 1949,
        types: ["Public"],
      });
      mapped.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  HOLIDAY_CACHE.set(year, mapped);
  return mapped;
}
