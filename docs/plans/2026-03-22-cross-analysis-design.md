# 교차분석 (Cross Analysis) 설계 문서

## 개요
출결↔학업성취도↔만족도 3개 데이터소스의 상관관계를 분석하는 새 탭.

## 서브탭 구성

### 1. 학생 교차분석
- **데이터 매칭**: 이름 + 기수로 출결(AttendanceStudent) ↔ 성취도(TraineeAchievementSummary) 조인
- **산점도**: X=출결률, Y=성취도 composite(0~100), 점 색상=신호등
- **히트맵**: 출결률 구간(4행) × 신호등(3열), 셀=학생수, 클릭→목록 필터
- **통계 카드**: 매칭 학생수, 상관계수(Pearson r), 고위험군, 우수군
- **학생 목록 테이블**: 히트맵 셀 클릭 시 필터링

### 2. 기수 교차분석
- **데이터 매칭**: 과정명 + 기수로 출결(평균) ↔ 성취도(평균) ↔ 만족도(SatisfactionSummary) 조인
- **레이더 차트**: 3축(출결률/성취도/NPS), 기수별 폴리곤 오버레이 (최대 5개)
- **비교 테이블**: 기수별 3지표 + 종합점수
- **인사이트 요약**: 자동 생성 텍스트

## 파일 구조
```
src/crossAnalysis/
├── crossAnalysisTypes.ts    — 타입 정의
├── crossAnalysisData.ts     — 데이터 매칭/집계
├── crossAnalysisCharts.ts   — Chart.js 차트
└── crossAnalysisInit.ts     — 탭 초기화
```

## 데이터 소스 (캐시 활용, 추가 API 호출 없음)
- 출결: localStorage `academic_schedule_manager_hrd_config_v1` → hrdApi
- 성취도: localStorage `kdt_achievement_cache_v1` → UnifiedRecord[]
- 만족도: localStorage `kdt_satisfaction_cache_v1` → SatisfactionRecord[]

## 종합점수 공식
```
cohortScore = avgAttendanceRate × 0.3 + achievementGreenRate × 0.4 + normalizedNPS × 0.3
```
