# 세션 작업 진행 현황 (2026-03-19)

## 완료된 작업

### 1. 학업성취도 (실업자) — ✅ 배포 완료
- Google Sheets API (Apps Script Web App)로 구글시트에서 데이터 직접 조회
- 대시보드용 DB 엑셀 (56개 시트, 노드/퀘스트) → 통합시트로 변환
- Apps Script 배포 URL: `https://script.google.com/macros/s/AKfycbx9uKcnfG3rJUDcVol_c1dGpxEgQlSy_YFYGHRbt5aStD9czNeA13ARs64wzgRoLLudtA/exec`
- 689명, 45,574건 데이터 로드 확인
- 과정/기수 필터, 이름 검색, 신호등(🔴🟡🟢) 정렬
- localStorage 캐시 (24시간 TTL, 앱 재시작 시 자동 복원)

### 2. ADP22 데이터스키마 구글시트 — ✅ 완료
- 스키마 시트 URL: `https://docs.google.com/spreadsheets/d/1FO_U99xts2OEaFOniPDaS0Qfz9Stx3iO66zdQRnK0IE/edit`
- Apps Script 설치 완료 (Code.gs + formatDesign.gs)
- 포맷팅 적용: 진한 남색 헤더, 줄무늬, 테두리, 열 너비 자동 맞춤
- 문의응대 탭 삭제 (에어테이블이라), 출결 탭 삭제 (이미 있음)
- 만족도 탭에서 이름/생년월일 열 삭제 (과정/기수 취합이라 불필요)

### 3. 문의응대 (Airtable) — ✅ 배포 완료
- Airtable REST API 연동 (Base ID: `apppPJRGktnS2yjkp`, Table: `응대`)
- PAT: 설정 탭에서 입력 (보안상 코드에 포함하지 않음)
- 응대 + 수강생 + 과정 3개 테이블 병렬 fetch → Linked Record ID→이름 매핑
- 통계 카드 (총 문의, 최근 7일, 채널별, 작성자별, 질문 유형 분포)
- 테이블: 날짜, 학생, 과정, 질문요약, 채널(컬러 뱃지), 작성자
- 82건 로드 확인, 채널/작성자 필터, 검색
- 설정 탭 → API 연동에서 Base ID + PAT 저장

### 4. 만족도 — ✅ 배포 완료
- 스키마 시트 "만족도" 탭에서 수기 입력 데이터를 Apps Script로 조회
- 과정/기수/모듈별 NPS, 강사만족도, 중간만족도, 최종만족도

### 5. 학업성취도 실업자/재직자 분리 — ✅ 배포 완료
- 학업성취도 탭에 실업자/재직자 서브탭 버튼 추가
- 실업자: 기존 퀘스트/노드 기반
- 재직자: 유닛리포트 기반 (유닛1~12 강사진단/운영진단 + 프로젝트1~4)
- 종합등급 A/B/C/D (강사+운영 평균)

### 6. 재직자 기수 코드 매핑 — ✅ 배포 완료
- `parseCohortCode()` in `hrdEmployedApi.ts`
- 0-x = 재직자LLM x기 (CSV 기수 1~9)
- 1-x = 재직자데이터 x기 (CSV 기수 11~19)
- 2-x = 재직자기획/개발 x기 (CSV 기수 21~29)
- 99 = 테스트 (제외)

### 7. UI/UX 개선 — ✅ 배포 완료
- 테이블 셀 색상 강화 (채널 뱃지, 신호등, 훈련상태, 등급)
- 라이트 모드 색상 호환성 수정 (CSS fallback에 다크 모드 색상 사용 금지)
- API 연동 설정 통합 (학업성취도/문의응대/Slack → 설정 탭)
- localStorage 저장으로 배포 시에도 API 키/URL 유지
- 캐시 자동 복원 (새로고침해도 데이터 유지)

### 8. CLAUDE.md 업데이트 — ✅
- 외부 API 연동 섹션 추가
- hrd/ 디렉토리 구조 상세화
- 기수 코드 규칙 추가
- 라이트 모드 디자인 시스템 반영

## 미완료 / 다음 세션 작업

### 1. 재직자 유닛리포트 API 연동 (팀장님 API 제공 예정)
- 현재: 스키마 시트 기반 조회 (schema_employed action)
- 예정: 팀장님이 유닛리포트 대시보드 API URL 제공 → 직접 API 호출로 전환
- UUID 유지, 기수 코드로 과정명 자동 매핑
- CSV 파일: `C:\Users\Admin\Downloads\trainee_reports (4).csv` (543명)

### 2. Apps Script 재배포 필요
- `schema_employed` action 추가 → 재직자 데이터 조회용
- 만족도 관련 action도 포함 확인 필요
- Code.gs 최신 코드는 `docs/apps-script-schema-template.js` 참고

### 3. 스키마 시트 "학업성취도(재직자)" 데이터 입력
- 헤더: 과정명, 기수, 성명, 레벨, 경험치, 작성일, 유닛1~12_강사진단, 유닛1~12_운영진단, 프로젝트1~4
- CSV에서 UUID 열 제거 후 붙여넣기
- 과정명은 기수 코드에서 자동 매핑되므로 비워도 됨

### 4. 만족도 시트 수기 데이터 입력
- 스키마 시트 "만족도" 탭에 과정/기수/모듈별 NPS/강사/중간/최종 점수 입력

### 5. cmux 터미널 셋업 (macOS)
- Claude Code + Codex CLI (GPT) 병렬 실행
- macOS 전용, Windows 불가

## 주요 URL/키 정보

| 항목 | 값 |
|------|-----|
| 배포 URL | https://chanhong-park94.github.io/kdt-schedule-dashboard/ |
| 대시보드용 DB 시트 | https://docs.google.com/spreadsheets/d/1jwFQ6M-ZHCBoYkGSoT7u8GhNM2ssBZwjfYXvt_FvGGw/edit |
| 스키마 시트 | https://docs.google.com/spreadsheets/d/1FO_U99xts2OEaFOniPDaS0Qfz9Stx3iO66zdQRnK0IE/edit |
| Apps Script URL | https://script.google.com/macros/s/AKfycbx9uKcnfG3rJUDcVol_c1dGpxEgQlSy_YFYGHRbt5aStD9czNeA13ARs64wzgRoLLudtA/exec |
| Airtable Base ID | apppPJRGktnS2yjkp |
| GitHub repo | chanhong-park94/kdt-schedule-dashboard |
| 작업 브랜치 | claude/epic-benz (main에 계속 머지) |

## 파일 구조 (신규 생성)
```
src/hrd/
├── hrdEmployedTypes.ts    — 재직자 유닛리포트 타입
├── hrdEmployedApi.ts      — 재직자 API + parseCohortCode()
├── hrdInquiryTypes.ts     — 문의응대 타입
├── hrdInquiryApi.ts       — Airtable API 연동
├── hrdInquiry.ts          — 문의응대 UI
├── hrdSatisfactionTypes.ts — 만족도 타입
├── hrdSatisfactionApi.ts  — 만족도 API
├── hrdSatisfaction.ts     — 만족도 UI
├── hrdAchievement.ts      — 학업성취도 (실업자+재직자 서브탭)
└── hrdAchievementApi.ts   — 실업자 API
```
