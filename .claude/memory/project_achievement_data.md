---
name: 학업성취도 데이터 통합 프로젝트
description: ADP22 데이터스키마 + 대시보드용 DB(노드/퀘스트) 학업성취도 데이터를 대시보드에 반영하는 작업 계획
type: project
---

## 데이터 소스

### 1. ADP22 데이터스키마 초안 (ADP22_데이터스키마_초안.xlsx)
- 6개 탭: 출결, 만족도, 학업성취도(실업자), 학업성취도(재직자), 문의응대, 범례
- 훈련생 여정 전체를 추적하는 종합 스키마 설계
- **스키마 구글시트**: https://docs.google.com/spreadsheets/d/1FO_U99xts2OEaFOniPDaS0Qfz9Stx3iO66zdQRnK0IE/

### 2. 대시보드용 DB (대시보드용 DB.xlsx → 구글시트)
- **73개 시트** (노드 37개 + 퀘스트 37개 + 통합 1개)
- **노드퀘스트DB (통합)**: 63,145행 × 18열 마스터 테이블
- 공통 키: 과정명 + 기수 + 이름
- 구글시트 URL: https://docs.google.com/spreadsheets/d/1jwFQ6M-ZHCBoYkGSoT7u8GhNM2ssBZwjfYXvt_FvGGw/

### 3. 각 탭별 데이터 소스 현황
| 탭 | 소스 | 상태 |
|---|---|---|
| 학업성취도(실업자) | 대시보드용 DB 구글시트 → Apps Script | ✅ 완료 |
| 학업성취도(재직자) | 유닛리포트 CSV / API (팀장 제공 예정) | ✅ 타입/API 생성, 기수코드 매핑 완료. Apps Script 재배포 + 시트 데이터 입력 필요 |
| 출결 | HRD-Net API (기존 hrdApi.ts) | ✅ 기존 구현 완료 |
| 만족도 | 스키마 시트 "만족도" → Apps Script | ✅ 탭 추가, 수기 입력 대기 |
| 문의응대 | Airtable API 직접 호출 | ✅ 완료 (Base: apppPJRGktnS2yjkp, Table: 응대) |

## 재직자 기수 코드 매핑
```
기수 1~9   (0-x) → 재직자LLM 1~9기
기수 11~19 (1-x) → 재직자데이터 1~9기
기수 21~29 (2-x) → 재직자기획/개발 1~9기
기수 99          → 테스트 (제외)
```

## 구현 완료

### Phase 1: 학업성취도 (실업자) — 2026-03-18
- Apps Script Web App 배포 완료
- 688명 / 45,574건 로드 확인
- 과정/기수 필터, 이름 검색, 신호등 정렬
- 캐시 자동 복원 (localStorage)

### Phase 2: 문의응대 + 만족도 + 재직자 — 2026-03-19
- **문의응대**: Airtable API 연동, 통계카드(총문의/최근7일/채널별/작성자별/질문유형), 테이블+상세, 캐시
- **만족도**: 스키마 시트 기반 조회 탭 추가 (과정/기수/NPS/강사/중간/최종)
- **학업성취도 실업자/재직자 서브탭 분리**: 버튼 전환 방식
- **재직자 유닛리포트**: hrdEmployedTypes.ts, hrdEmployedApi.ts 생성 (유닛1~12 강사진단/운영진단 + 프로젝트1~4)
- **API 연동 설정 통합**: 학업성취도/문의응대/Slack 모두 설정 탭에서 관리, localStorage 영구 저장
- **테이블 색상 강화**: 채널/상태/등급별 배지 컬러, 라이트 모드 호환
- **스키마 구글시트 디자인 포맷팅**: Apps Script로 헤더 색상/줄무늬/테두리/열너비 적용

### 핵심 파일
```
src/hrd/hrdAchievement.ts      — 학업성취도 UI (실업자+재직자 서브탭)
src/hrd/hrdAchievementApi.ts   — 실업자 API
src/hrd/hrdAchievementTypes.ts — 실업자 타입
src/hrd/hrdEmployedApi.ts      — 재직자 API (기수코드 매핑 포함)
src/hrd/hrdEmployedTypes.ts    — 재직자 타입
src/hrd/hrdInquiry.ts          — 문의응대 UI
src/hrd/hrdInquiryApi.ts       — 문의응대 Airtable API
src/hrd/hrdSatisfaction.ts     — 만족도 UI
```

## 다음 세션 작업
- [ ] 재직자 유닛리포트 API 연동 (팀장 제공 시)
- [ ] Apps Script에 `schema_employed` action 추가 → 재배포
- [ ] 스키마 시트 "학업성취도(재직자)" CSV 데이터 입력 (UUID 제거, 과정명 열 추가)
- [ ] 만족도 시트 수기 데이터 입력 후 조회 테스트
- [ ] 만족도 NPS 모듈별 구분 상세 구현
