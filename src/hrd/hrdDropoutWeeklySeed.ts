/**
 * 하차방어율 — 그룹회의 스프레드시트 R9 시드 데이터
 *
 * 출처: [2026]KDT공통_실업자.xlsx + [2026]KDT공통_재직자.xlsx (2026-05-13 스냅샷)
 * 각 기수 탭의 R9(하차방어율) 행 1주~최신주 값.
 *
 * 사용:
 *  - 처음 페이지 방문 시 자동 임포트 (localStorage 빈 상태)
 *  - SEED_VERSION 이 바뀌면 재임포트 (defenseRate 만 덮어쓰고 사용자 메타 보존)
 *
 * 향후 매주 데이터를 갱신할 때:
 *  - (A) SEED_VERSION 바꾸고 TUPLES 갱신해서 재배포  ← 현재 방식
 *  - (B) 폼으로 매주 수기 입력  ← 운영 권장
 *  - (C) 차후 xlsx 직접 업로드 기능 추가
 */

import { addOrUpdateWeeklyEntry, parseAlias, loadWeeklyEntries } from "./hrdDropoutWeekly";

export const SEED_VERSION = "2026-05-13";
const SEED_VERSION_KEY = "kdt_dropout_weekly_seed_version";

/** [alias, weekNum, defenseRate] — 17개 기수, 257건 */
const SEED_TUPLES: ReadonlyArray<readonly [string, number, number]> = [
  ["DS6",1,100], ["DS6",2,100], ["DS6",3,100], ["DS6",4,100], ["DS6",5,100], ["DS6",6,100],
  ["DS6",7,100], ["DS6",8,94.44], ["DS6",9,94.44], ["DS6",10,94.44], ["DS6",11,94.44], ["DS6",12,94.44],
  ["DS6",13,94.44], ["DS6",14,88.89], ["DS6",15,88.89], ["DS6",16,88.89], ["DS6",17,77.78], ["DS6",18,77.78],
  ["DS6",19,77.78], ["DS6",20,66.67], ["DS6",21,66.67], ["DS6",22,66.67], ["DS6",23,50], ["DS6",24,50],
  ["DS6",25,50], ["DS6",26,50], ["DS7",1,100], ["DS7",2,100], ["DS7",3,100], ["DS7",4,100],
  ["DS7",5,100], ["DS7",6,100], ["DS7",7,100], ["DS7",8,100], ["DS7",9,100], ["DS7",10,100],
  ["DS7",11,100], ["DS7",12,100], ["DS7",13,100], ["DS7",14,100], ["DS7",15,100], ["DS7",16,100],
  ["DS7",17,100], ["DS7",18,100], ["DS7",19,83.33], ["DS7",20,66.66], ["DS7",21,50], ["DS7",22,50],
  ["DS7",23,50], ["DS7",24,50], ["DS7",25,50], ["DS7",26,50], ["DS8",1,100], ["DS8",2,100],
  ["DS8",3,100], ["DS8",4,100], ["DS8",5,100], ["DS8",6,100], ["DS8",7,100], ["DS8",8,100],
  ["DS8",9,100], ["DS8",10,100], ["DS8",11,100], ["DS8",12,100], ["DS8",13,100], ["DS8",14,100],
  ["DS8",15,100], ["DS8",16,100], ["DS8",17,100], ["DS8",18,100], ["DS8",19,88.88], ["DS8",20,88.88],
  ["DS8",21,88.88], ["EDATA4",1,100], ["EDATA4",2,98.15], ["EDATA4",3,92.59], ["EDATA4",4,79.63], ["EDATA4",5,72.22],
  ["EDATA4",6,64.81], ["EDATA4",7,62.96], ["EDATA4",8,53.7], ["EDATA4",9,48.15], ["EDATA4",10,44.44], ["EDATA5",1,100],
  ["EDATA5",2,100], ["EDATA5",3,96.55], ["EDATA5",4,93.1], ["EDATA5",5,89.66], ["EDATA5",6,86.21], ["EDATA5",7,82.76],
  ["EDATA5",8,82.76], ["EDATA5",9,79.31], ["EGIGAE4",1,100], ["EGIGAE4",2,98.63], ["EGIGAE4",3,98.63], ["EGIGAE4",4,98.63],
  ["EGIGAE4",5,98.63], ["EGIGAE4",6,93.15], ["EGIGAE4",7,91.78], ["EGIGAE4",8,84.93], ["EGIGAE4",9,80.82], ["EGIGAE4",10,75.34],
  ["EGIGAE4",11,75.34], ["EGIGAE4",12,71.23], ["EGIGAE4",13,63.01], ["EGIGAE5",1,100], ["EGIGAE5",2,100], ["EGIGAE5",3,97.91],
  ["EGIGAE5",4,95.83], ["EGIGAE5",5,93.75], ["EGIGAE5",6,93.75], ["EGIGAE5",7,93.75], ["EGIGAE6",1,100], ["EGIGAE6",2,100],
  ["EGIGAE6",3,96.87], ["ELLM5",1,100], ["ELLM5",2,100], ["ELLM5",3,100], ["ELLM5",4,100], ["ELLM5",5,95.83],
  ["ELLM5",6,95.83], ["ELLM5",7,94.44], ["ELLM5",8,93.03], ["ELLM5",9,93.03], ["ELLM5",10,87.5], ["ELLM5",11,84],
  ["ELLM5",12,80.56], ["ELLM5",13,80.56], ["ELLM5",14,80.56], ["ELLM6",1,100], ["ELLM6",2,100], ["ELLM6",3,100],
  ["ELLM6",4,96.42], ["ELLM6",5,96.42], ["ELLM6",6,91.07], ["ELLM6",7,91.07], ["ELLM6",8,89.29], ["ELLM6",9,89.29],
  ["ENGR1",1,100], ["ENGR1",2,100], ["ENGR1",3,100], ["ENGR1",4,100], ["ENGR1",5,100], ["ENGR1",6,100],
  ["ENGR1",7,100], ["ENGR1",8,100], ["ENGR1",9,100], ["ENGR1",10,100], ["ENGR1",11,100], ["ENGR1",12,94],
  ["ENGR1",13,94], ["ENGR1",14,94], ["ENGR1",15,94], ["ENGR1",16,94], ["ENGR1",17,94], ["ENGR1",18,94],
  ["ENGR2",1,100], ["ENGR2",2,100], ["ENGR2",3,100], ["ENGR2",4,100], ["ENGR2",5,100], ["ENGR2",6,96.55],
  ["ENGR2",7,96.55], ["ENGR2",8,96.55], ["PDA4",1,100], ["PDA4",2,100], ["PDA4",3,100], ["PDA4",4,100],
  ["PDA4",5,92.86], ["PDA4",6,92.86], ["PDA4",7,92.86], ["PDA4",8,92.86], ["PDA4",9,92.86], ["PDA4",10,85.71],
  ["PDA4",11,78.57], ["PDA4",12,71.43], ["PDA4",13,71.43], ["PDA4",14,71.43], ["PDA4",15,71.43], ["PDA4",16,64.29],
  ["PDA4",17,64.29], ["PDA4",18,64.29], ["PDA4",19,64.29], ["PDA4",20,57.14], ["PDA4",21,57.14], ["PDA4",22,57.14],
  ["PDA4",23,57.14], ["PDA5",1,100], ["PDA5",2,100], ["PDA5",3,100], ["PDA5",4,90.32], ["PDA5",5,90.32],
  ["PDA5",6,90.32], ["PDA5",7,83.87], ["PDA5",8,83.87], ["PDA5",9,80.65], ["PDA5",10,80.65], ["PDA5",11,77.42],
  ["PDA5",12,77.42], ["PDA5",13,77.42], ["PDA5",14,77.42], ["PDA5",15,77.42], ["PDA5",16,74.19], ["PDA5",17,70.97],
  ["PDA5",18,70.97], ["PDA5",19,70.97], ["RESEARCH15",1,100], ["RESEARCH15",2,100], ["RESEARCH15",3,100], ["RESEARCH15",4,94.44],
  ["RESEARCH15",5,94.44], ["RESEARCH15",6,94.44], ["RESEARCH15",7,94.44], ["RESEARCH15",8,94.44], ["RESEARCH15",9,94.44], ["RESEARCH15",10,94.44],
  ["RESEARCH15",11,94.44], ["RESEARCH15",12,88.89], ["RESEARCH15",13,88.89], ["RESEARCH15",14,88.89], ["RESEARCH15",15,88.89], ["RESEARCH15",16,83.33],
  ["RESEARCH15",17,83.33], ["RESEARCH15",18,72.22], ["RESEARCH15",19,72.22], ["RESEARCH15",20,72.22], ["RESEARCH15",21,72.22], ["RESEARCH15",22,72.22],
  ["RESEARCH15",23,72.22], ["RESEARCH15",24,72.22], ["RESEARCH15",25,66.66], ["RESEARCH16",1,94.74], ["RESEARCH16",2,94.74], ["RESEARCH16",3,94.74],
  ["RESEARCH16",4,89.47], ["RESEARCH16",5,89.47], ["RESEARCH16",6,89.47], ["RESEARCH16",7,89.47], ["RESEARCH16",8,89.47], ["RESEARCH16",9,89.47],
  ["RESEARCH16",10,89.47], ["RESEARCH16",11,89.47], ["RESEARCH16",12,89.47], ["RESEARCH16",13,89.47], ["RESEARCH16",14,84.21], ["RESEARCH16",15,84.21],
  ["RESEARCH16",16,84.21], ["RESEARCH16",17,78.95], ["RESEARCH16",18,78.95], ["RESEARCH17",1,100], ["RESEARCH17",2,100], ["RESEARCH17",3,100],
  ["RESEARCH17",4,100], ["RESEARCH17",5,100], ["RESEARCH17",6,100], ["RESEARCH17",7,93.33], ["RESEARCH17",8,93.33],
];

export interface SeedRunResult {
  /** 이번 호출에서 실제로 임포트가 실행됐는지 */
  ran: boolean;
  added: number;
  updated: number;
  total: number;
}

/**
 * localStorage 의 seed 버전이 코드의 SEED_VERSION 과 다를 때만 시드 실행.
 *
 *  - defenseRate 는 항상 시드 값으로 덮어씀 (스프레드시트가 source of truth)
 *  - riskModule / riskSignal / actionTaken / actionPlanned / note 는 보존
 *  - 사용자가 폼으로 추가한 신규 (alias, weekNum) 항목은 그대로 유지
 */
export function runSeedIfNeeded(): SeedRunResult {
  const storedVersion = readVersion();
  if (storedVersion === SEED_VERSION) {
    return { ran: false, added: 0, updated: 0, total: loadWeeklyEntries().length };
  }

  const existing = loadWeeklyEntries();
  const existingKeys = new Set(existing.map((e) => `${e.alias}|${e.weekNum}`));
  let added = 0;
  let updated = 0;

  for (const [alias, weekNum, defenseRate] of SEED_TUPLES) {
    const match = parseAlias(alias);
    if (!match) continue;
    const key = `${alias}|${weekNum}`;
    const isNew = !existingKeys.has(key);
    const prev = existing.find((e) => e.alias === alias && e.weekNum === weekNum);
    addOrUpdateWeeklyEntry({
      alias,
      trainPrId: match.trainPrId,
      degr: match.degr,
      weekNum,
      defenseRate,
      riskModule: prev?.riskModule ?? "",
      riskSignal: prev?.riskSignal ?? "",
      actionTaken: prev?.actionTaken ?? "",
      actionPlanned: prev?.actionPlanned ?? "",
      note: prev?.note?.trim() ? prev.note : `엑셀 R9 자동 임포트 (${SEED_VERSION})`,
    });
    if (isNew) added++;
    else updated++;
  }

  writeVersion(SEED_VERSION);
  return { ran: true, added, updated, total: loadWeeklyEntries().length };
}

function readVersion(): string | null {
  try {
    return localStorage.getItem(SEED_VERSION_KEY);
  } catch {
    return null;
  }
}

function writeVersion(v: string): void {
  try {
    localStorage.setItem(SEED_VERSION_KEY, v);
  } catch {
    /* ignore */
  }
}
