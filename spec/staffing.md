# Staffing 모델 명세

v7-E 문서 구조를 기준으로 **코호트 단위 + Phase(P1/P2/365) 단위 + 담당자/기간** 모델을 사용한다.

## 데이터 모델

- `Phase`: `P1`, `P2`, `365`
- `StaffAssignment`
  - `cohort`: 과정기수
  - `phase`: `P1 | P2 | 365`
  - `assignee`: 담당자명
  - `startDate`: 시작일 (`YYYY-MM-DD`)
  - `endDate`: 종료일 (`YYYY-MM-DD`)
  - `workDays`: 배치일수(일 단위, 설정에 따라 주말 포함/제외)

## 화면 요구사항 (v7-E 대응)

1. 코호트별 배치표 (v7-E 1p 유사)
   - 코호트별로 P1/P2/365 담당자 + 기간 입력/조회
2. 전체 과정 간트 (v7-E 2p)
   - 코호트 기준으로 phase 바를 한 화면에 표시
3. 담당자별 간트 (v7-E 3p)
   - 담당자 기준으로 코호트+phase 바를 표시
4. 담당자별 상세 표 + 겹침일수 KPI (v7-E 4~5p)
   - 담당자별 총 배치일수, phase별 배치일수, 겹침일수

## 겹침 정의

담당자 기준 겹침(overlap)은 아래 조건으로 정의한다.

```txt
동일 담당자 AND A.startDate <= B.endDate AND B.startDate <= A.endDate
```

※ staffing은 Session(시간 단위) 충돌과 별개로 **일 단위** 계산한다.

## 출력(내보내기)

### 설계 원칙

- 내부 표준 스키마(`InternalV7ERecord`)는 불변으로 유지한다.
- 외부 포맷 헤더/행은 매핑 테이블(`HEADER_MAPPINGS`)로 생성한다.
- 새 포맷은 매핑 테이블 키만 추가해 확장한다.
- 매핑 정의는 JSON(`src/public/mappings/*.json`)으로 관리한다.

### 헤더 alias 정책

- 매핑 JSON은 `headerAliases`를 가질 수 있다.
  - 예: `"과정명" -> "과정"`
- import/비교/검증 시 alias를 표준 헤더로 normalize한다.
- export 기본 동작은 표준 헤더를 출력한다.
- 필요 시 옵션으로 alias 헤더 출력이 가능하다.

내보내기 모드는 아래 2가지를 지원한다.

- `v7e_strict`
  - v7-E 문서 헤더/순서/날짜 포맷 고정
  - 프리셋(P1/P2/365 자동 산정) 상태에서만 활성
  - 필요 시 담당자 상세 CSV를 추가로 내보낼 수 있음
- `modules_generic`
  - 세션 기반 모듈 범위(과정/모듈/강사/강의실/시작/종료/세션수) 내보내기

`v7e_strict` 기본 컬럼:

- 기본 컬럼
  - 과정
  - 개강
  - 종강
  - P1담당자
  - P1기간
  - P2담당자
  - P2기간
  - 365담당자
  - 365기간

`v7e_strict` 정규 표준 헤더 문자열(원문 고정, 순서 고정):

```text
과정,개강,종강,P1담당자,P1기간,P2담당자,P2기간,365담당자,365기간
```

### strict 모드 제약

- 코호트별 P1/P2/365 기간이 프리셋 계산식과 일치해야 함
- 날짜 포맷은 `YYYY-MM-DD` 또는 `YYYY-MM-DD~YYYY-MM-DD` 고정
- 컬럼명/순서는 변경하지 않음 (변경 시 major bump)

## 계산 옵션

- 글로벌 주말 토글은 사용하지 않는다.
- 코호트 `trackType` 정책으로 업무일수를 산정한다.
  - `UNEMPLOYED`: 월~금
  - `EMPLOYED`: 월~토
- `INSTRUCTOR`는 세션/배치 기준상 7일 정책으로 계산하며,
  `FACILITATOR`/`OPERATION`은 `trackType` 정책을 따른다.
