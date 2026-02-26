# Changelog

## 0.1.0 - 2026-02-24

### Added

- 일정 생성기(요일 템플릿, break, 공휴일/자체휴강 반영)
- 공휴일 자동 로드(Nager API) 및 목록 관리
- 충돌 3탭(강사 시간, 강사 배치(일), 퍼실/운영 배치(일))
- Staffing 배치관리(v7-E), KPI/상세/간트 뷰
- 탭별 CSV 내보내기(필터 적용)
- 상태 저장(localStorage 자동저장 + JSON 저장/불러오기)
- 프린트/PDF 리포트(간트, KPI, 선택 충돌 상위 50건)
- 운영 체크리스트
- 상태 스키마 마이그레이션 훅(`migrateState`)
- 코드 표준화 유틸(`standardize`) 및 샘플 상태 로더(`?demo=1`)
- export 매핑 JSON(`src/public/mappings/*.json`) 기반 포맷 관리
- 매핑 계약 테스트/샘플 E2E 회귀 테스트/포맷 검증 테스트
- 매핑 JSON 스키마(`src/core/mapping.schema.json`) 및 개발 모드 런타임 검증

### Changed

- 코호트 `trackType` 정책 기반 업무일수 산정(UNEMPLOYED/EMPLOYED)
- 리소스타입 분리 정책 강화(`INSTRUCTOR`/`FACILITATOR`/`OPERATION`)
- `v7e_strict` / `modules_generic` 내보내기 모드 추가
- `v7e_strict` 헤더를 고정 표준으로 명시
- `v7e_strict` 생성 방식을 헤더 매핑 테이블(JSON) 기반으로 리팩터링
- CI에서 스냅샷 자동 업데이트 금지(`--update=false`)로 변경 통제 강화

### Fixed

- HRD CSV 다운로드 전 검증(중복 row, 시간 역전/동일, 공휴일 포함, 빈 세션)
- 대용량 충돌 계산 로깅 및 10,000건 경고
- 상태 파일 호환성 처리(버전 누락/구버전 마이그레이션)
