# TROUBLESHOOTING

## 1) `npm` / `node` 인식 오류 (Windows PATH)

- 증상: `npm is not recognized` 또는 `node is not recognized`
- 점검:
  - `where node`
  - `where npm`
- 해결:
  1. `C:\Program Files\nodejs\`가 PATH에 있는지 확인
  2. 터미널 완전 종료 후 새로 열기
  3. `node -v`, `npm -v` 재확인

## 2) Node 버전 정책 (LTS)

- 팀 배포 기준: **Node LTS만 사용**
- 권장: `22.x` (기본), 허용: `24.x`
- 비권장: `23.x`, `25.x` 같은 홀수 메이저(non-LTS)
- 저장소 정책: `package.json`의 `engines.node = ^22.0.0 || ^24.0.0`
- 점검:
  - `node -v`
  - `npm -v`

## 3) PowerShell ExecutionPolicy 오류

- 증상: `npm.ps1 cannot be loaded ...`
- 우회:
  - `npm.cmd` 사용
  - 예: `npm.cmd run build`
- 정책 변경이 필요한 경우 조직 보안정책을 우선 확인

## 4) CSV 업로드 형식 오류

- 필수 컬럼 누락/시간 포맷 오류 시 파싱 에러 패널에 표시
- 시간은 `HHMM`, 날짜는 `YYYYMMDD` 형식을 권장
- 시작시간이 종료시간보다 같거나 느리면 차단

## 5) 공휴일 API 실패 (오프라인 포함)

- 증상: 공휴일 자동 로드 실패
- 대응:
  1. 네트워크 상태 확인
  2. 잠시 후 재시도
  3. 수동으로 공휴일 날짜 입력
  4. 오프라인 운영 시 JSON 상태 파일로 공휴일 목록 재사용

## 6) `The CJS build of Vite's Node API is deprecated` 경고

- 원인: Vite Node API가 CommonJS 경로로 로드될 때 발생
- 조치:
  1. Vite 설정 파일을 ESM으로 유지 (`vite.config.mts`)
  2. `require`/`module.exports` 대신 `import`/`export default` 사용
  3. `npm run build`, `npm test -- --run`으로 재확인
- 재발 방지:
  - 설정 파일 신규 추가 시 `.mjs`/`.mts` 우선 사용
  - Node는 LTS 라인(22/24)에서만 실행
