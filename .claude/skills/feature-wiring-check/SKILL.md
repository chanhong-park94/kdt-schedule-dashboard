---
name: feature-wiring-check
description: 기능 업데이트 후 기존 연결(wiring)이 끊어지지 않았는지 검토하는 체크리스트 에이전트. 탭 로더 누락, 이벤트 리스너 미바인딩, 초기화 함수 의존성 문제, CSS 변수 누락 등을 사전에 잡아냅니다. Use when: 코드 변경 완료 후, 커밋 전, PR 생성 전, '검토해줘', '연결 확인', 'wiring check', '배선 점검', 새 탭/모듈/컴포넌트를 추가하거나 기존 모듈을 분리/리팩터링한 경우, 또는 UI 요소의 클릭/토글/이벤트가 동작하지 않는 문제를 디버깅할 때.
---

# Feature Wiring Check

기능 업데이트 후 기존 연결이 끊어지지 않았는지 체계적으로 검증합니다.

## 배경

이 프로젝트는 SPA로, 탭별 lazy-load 패턴을 사용합니다.
과거에 발생한 대표적 문제:
- 설정 탭 카드 클릭 불가: `setupSettingsHandlers()`가 출결 탭 `initAttendanceDashboard()` 안에서만 호출되어 출결 탭 미방문 시 이벤트 리스너가 바인딩되지 않음
- `tabRegistry.ts`에 settings 로더 자체가 누락되어 `ensureTabLoaded("settings")`가 아무 동작 않음

이런 유형의 문제는 코드가 정상 컴파일되고, 특정 경로로만 접근하면 잘 동작하기 때문에 발견이 어렵습니다.

## 체크리스트

변경된 파일을 분석한 뒤, 아래 항목을 순서대로 점검하세요.
각 항목은 **PASS / FAIL / N/A** 로 판정합니다.

### 1. 탭 로더 등록 (Tab Registry)

`src/ui/tabRegistry.ts`의 `tabLoaders` 객체를 확인합니다.

- [ ] `AppSidebarNavKey` 타입에 정의된 모든 navKey가 `tabLoaders`에 대응하는 엔트리를 갖고 있는가?
- [ ] 새로 추가된 탭이 있다면 `createTabLoader()` 패턴으로 등록되어 있는가?
- [ ] 등록된 로더의 import 경로가 실제 파일과 일치하는가?
- [ ] export된 init 함수명이 import destructuring과 일치하는가?

```bash
# 자동 검증: navKey 타입 vs tabLoaders 비교
grep -oP '"\w+"' src/core/state.ts | sort > /tmp/navkeys.txt
grep -oP '^\s+(\w+):' src/ui/tabRegistry.ts | sed 's/://' | sort > /tmp/loaders.txt
diff /tmp/navkeys.txt /tmp/loaders.txt
```

### 2. 이벤트 리스너 바인딩 (Event Binding)

변경된 파일에서 `addEventListener`, `click`, `change`, `keydown` 등의 이벤트 바인딩을 검색합니다.

- [ ] 이벤트 바인딩이 올바른 초기화 함수 내에서 호출되는가? (다른 탭의 init에 묻혀 있지 않은가?)
- [ ] 동적으로 생성된 DOM 요소에 이벤트가 바인딩되는 경우, 요소 생성 이후 시점에서 바인딩이 이루어지는가?
- [ ] 같은 요소에 중복 바인딩을 방지하는 가드가 있는가? (예: `dataset.bound` 플래그)
- [ ] `data-*` 속성으로 선택되는 요소가 HTML에 실제로 존재하는가?

```bash
# data 속성 사용 vs HTML 존재 여부 교차 검증
grep -rhoP 'data-[\w-]+' src/**/*.ts | sort -u > /tmp/ts_data_attrs.txt
grep -rhoP 'data-[\w-]+' src/index.html | sort -u > /tmp/html_data_attrs.txt
comm -23 /tmp/ts_data_attrs.txt /tmp/html_data_attrs.txt
```

### 3. 초기화 함수 의존성 (Init Dependencies)

모듈 간 초기화 순서와 의존성을 확인합니다.

- [ ] init 함수가 다른 모듈의 스코프 변수(모듈 레벨 `let`/`const`)에 의존하지 않는가?
- [ ] 순환 의존(A init → B init → A init)이 없는가?
- [ ] `createTabLoader()`의 콜백이 async인 경우, await가 필요한 init 함수에 await를 붙였는가?
- [ ] 분리/리팩터링한 함수가 원래 모듈의 private 변수를 참조하지 않는가?

### 4. HTML 구조 (data-page-group)

탭 콘텐츠의 표시/숨김이 올바르게 동작하는지 확인합니다.

- [ ] 새로 추가된 섹션에 `data-page-group="navKey"` 속성이 있는가?
- [ ] navKey 값이 `AppSidebarNavKey` 타입과 정확히 일치하는가?
- [ ] 사이드바 버튼에 `data-nav-key="navKey"` 속성이 있는가?

### 5. CSS 변수 & 스타일 (Style Wiring)

- [ ] 새로 추가된 색상이 하드코딩이 아닌 CSS 변수(`var(--xxx)`)를 사용하는가?
- [ ] CSS fallback 값에 다크 모드 색상이 혼입되지 않았는가?
- [ ] 클릭 가능한 요소에 `cursor: pointer`가 적용되어 있는가?
- [ ] `pointer-events: none`이 의도치 않게 클릭을 차단하지 않는가?

### 6. 빌드 & 런타임 검증

- [ ] `npm run build` 성공 (새로운 에러 없음)?
- [ ] 브라우저 콘솔에 새로운 에러 없음?
- [ ] 변경된 탭을 **다른 탭을 먼저 방문하지 않고** 직접 열었을 때 정상 동작하는가?

## 실행 방법

1. `git diff --name-only HEAD~1` 또는 변경 파일 목록을 확인
2. 변경된 파일이 속한 모듈/탭을 식별
3. 위 체크리스트를 해당 모듈에 맞게 순서대로 점검
4. FAIL 항목이 있으면 수정 후 다시 점검
5. 모든 항목이 PASS/N/A이면 커밋 진행

## 출력 형식

```
## Wiring Check Report

| # | 항목 | 결과 | 비고 |
|---|------|------|------|
| 1 | 탭 로더 등록 | PASS | settings 로더 확인 |
| 2 | 이벤트 바인딩 | PASS | 5개 토글 바인딩 확인 |
| 3 | 초기화 의존성 | PASS | 독립 모듈 |
| 4 | HTML 구조 | N/A | HTML 변경 없음 |
| 5 | CSS 변수 | N/A | 스타일 변경 없음 |
| 6 | 빌드 & 런타임 | PASS | 빌드 성공, 콘솔 에러 없음 |

총 결과: ✅ 6/6 PASS (N/A 제외)
```
