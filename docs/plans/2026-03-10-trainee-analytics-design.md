# 훈련생 분석 페이지 설계

## 개요
HRD API 데이터(명단/출결/탈락)를 기반으로 훈련생 인구통계 및 리스크 요인을 분석하는 독립 페이지.
향후 학습데이터, 만족도, 문의응대 등 통합 분석 허브로 확장 예정.

## 사이드바 배치
- `📊 훈련생 분석` — 출결현황과 설정 사이
- SIDEBAR_MENU_CONFIG_KEY 버전 업

## 데이터 소스
- 현재 등록된 과정/기수만 대상
- `fetchRoster()` → 명단 + 생년월일/성별
- `fetchDailyAttendance()` → 출결 데이터
- 주민번호 파싱: 생년월일 → 연령, 7번째 자리 → 성별(1,3=남, 2,4=여)

## 핵심 데이터 모델
```typescript
interface TraineeAnalysis {
  name: string;
  birth: string;          // YYYYMMDD
  age: number;
  gender: "남" | "여" | "미상";
  courseName: string;
  category: "재직자" | "실업자";
  degr: string;
  attendanceRate: number;
  absentDays: number;
  lateDays: number;
  excusedDays: number;
  dropout: boolean;
}
```

## 탭 구성

### [개요] 탭
- 요약 카드: 전체 훈련생 | 평균 연령 | 성별 비율 | 중도탈락률
- 연령대 분포 Bar chart
- 성별 구성 Donut chart
- 과정별 인구 구성 Stacked bar

### [리스크 분석] 탭
**섹션 A: 출결 패턴**
- 요일별 결석률 Bar chart
- 월별 결석/공결 추이 Line chart
- 시간대별 지각률 Bar chart

**섹션 B: 탈락 요인**
- 연령대별 탈락률 Bar chart (재직자/실업자 구분)
- 성별 × 과정유형별 탈락률 Grouped bar
- 결석일수 vs 탈락 여부 Scatter plot

**섹션 C: 자동 인사이트 카드**

### [상세 데이터] 탭
- 필터: 과정/기수/성별/연령대/상태
- 테이블: 이름|과정|기수|연령|성별|출석률|결석일수|상태
- 컬럼 정렬

## 파일 구조
```
src/hrd/hrdAnalytics.ts          — 메인 (데이터 수집 + 차트)
src/hrd/hrdAnalyticsTypes.ts     — 타입 정의
src/hrd/hrdAnalyticsInsights.ts  — 인사이트 카드 로직
```

## 구현 순서
1. Phase 1: 데이터 수집 + 파싱 (타입/성별/연령)
2. Phase 2: [개요] 탭 — 카드 + 인구통계 차트
3. Phase 3: [리스크 분석] 탭 — 출결 패턴 + 탈락 요인 + 인사이트
4. Phase 4: [상세 데이터] 탭 — 필터 + 테이블
