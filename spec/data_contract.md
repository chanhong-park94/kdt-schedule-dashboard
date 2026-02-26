# 데이터 계약서 (Data Contract)

## 입력 CSV 스키마

아래 컬럼명은 **정확히 고정**한다.

| 컬럼명 | 형식 | 필수 | 설명 |
|---|---|---|---|
| 훈련일자 | `YYYYMMDD` | Y | 훈련 일자 |
| 훈련시작시간 | `HHMM` | Y | 훈련 시작 시간 |
| 훈련종료시간 | `HHMM` | Y | 훈련 종료 시간 |
| 방학/원격여부 | 문자열 | N | 방학/원격 구분 값 |
| 시작시간 | `HHMM` | N | 원본 시작시간 보조값 |
| 시간구분 | 문자열 | N | 시간 구분 값 |
| 훈련강사코드 | 문자열 | Y* | 강사 기준 충돌 판정 키 |
| 교육장소(강의실)코드 | 문자열 | Y* | 강의실 기준 충돌 판정 키 |
| 교과목(및 능력단위)코드 | 문자열 | N | 표시/내보내기용 코드 |
| 과정기수 | 문자열 | Y | 기수 식별자 |

`Y*`: 충돌 판정 관점에서 필요. 비어 있으면 해당 기준 충돌 계산에서 제외한다.

## 정규화 규칙

### 1) 날짜/시간 파싱 규칙
- `훈련일자`는 8자리 숫자(`YYYYMMDD`)만 유효하다.
- `훈련시작시간`, `훈련종료시간`, `시작시간`은 4자리 숫자(`HHMM`)를 기본으로 하며, 필요 시 좌측 0 패딩 후 해석한다.
- 시간 계산은 분 단위(`HH * 60 + MM`)로 변환한다.
- 유효 interval 조건: `훈련시작시간 < 훈련종료시간`.

### 2) 공백/NA 처리
- 모든 셀 값은 `trim()` 후 사용한다.
- 빈 문자열, 공백, `NA`, `N/A`, `null`, `-`는 결측값으로 간주해 빈값(`""`)으로 정규화한다.
- 결측값이 충돌 기준키(일자/강사코드/강의실코드/시간)에 포함되면 충돌 계산에서 제외한다.

### 3) export 규칙
- export 대상은 HRD 9개 컬럼만 사용한다.
- `과정기수`는 export에서 제외한다.
- export 컬럼 순서는 아래와 같이 고정한다.

1. 훈련일자
2. 훈련시작시간
3. 훈련종료시간
4. 방학/원격여부
5. 시작시간
6. 시간구분
7. 훈련강사코드
8. 교육장소(강의실)코드
9. 교과목(및 능력단위)코드

## 내부 타입 정의

아래 타입은 구현 시 사용할 내부 표준 모델이다.

### Session

```ts
type Session = {
  trainingDate: string; // YYYYMMDD
  trainingStartTime: string; // HHMM
  trainingEndTime: string; // HHMM
  vacationOrRemote: string;
  originStartTime: string; // 시작시간
  timeCategory: string; // 시간구분
  instructorCode: string;
  classroomCode: string;
  subjectCode: string;
  cohort: string;
  startMin: number | null;
  endMin: number | null;
};
```

예시 레코드:

```json
{
  "trainingDate": "20260302",
  "trainingStartTime": "0900",
  "trainingEndTime": "1250",
  "vacationOrRemote": "집체",
  "originStartTime": "0900",
  "timeCategory": "정규",
  "instructorCode": "TCH-1001",
  "classroomCode": "ROOM-A01",
  "subjectCode": "SUBJ-ML-01",
  "cohort": "KDT-12기",
  "startMin": 540,
  "endMin": 770
}
```

### CohortSummary

```ts
type CohortSummary = {
  cohort: string;
  startDate: string;
  endDate: string;
  trainingDayCount: number;
  sessionCount: number;
};
```

예시 레코드:

```json
{
  "cohort": "KDT-12기",
  "startDate": "20260302",
  "endDate": "20260730",
  "trainingDayCount": 102,
  "sessionCount": 408
}
```

### Conflict

```ts
type Conflict = {
  basis: "강의실" | "강사";
  date: string; // YYYYMMDD
  key: string; // 강의실코드 또는 강사코드
  cohortA: string;
  timeA: string; // HHMM-HHMM
  subjectA: string;
  cohortB: string;
  timeB: string; // HHMM-HHMM
  subjectB: string;
};
```

예시 레코드:

```json
{
  "basis": "강사",
  "date": "20260314",
  "key": "TCH-1001",
  "cohortA": "KDT-12기",
  "timeA": "0900-1100",
  "subjectA": "SUBJ-ML-01",
  "cohortB": "KDT-13기",
  "timeB": "1000-1200",
  "subjectB": "SUBJ-WEB-02"
}
```
