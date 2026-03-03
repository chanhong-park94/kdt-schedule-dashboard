# RELEASE CHECKLIST (v0.1.0)

## 필수 점검 항목

- [ ] `npm ci` 통과
- [ ] `npm test -- --run` 통과
- [ ] `npm run build` 통과
- [ ] 데모 샘플 로드 동작 확인 (`?demo=1`)
- [ ] HRD CSV 다운로드 검증 통과 및 다운로드 확인
- [ ] `v7e_strict` export 동작 확인
- [ ] 충돌 3탭 CSV export 확인
  - [ ] 강사 시간 충돌 CSV
  - [ ] 강사 배치(일) 충돌 CSV
  - [ ] 퍼실/운영 배치(일) 충돌 CSV
- [ ] print 출력(PDF 포함) 확인
- [ ] Chrome UI 확인
- [ ] Edge UI 확인

## 배포 산출물

- [ ] 파일명 규칙 확인: `academic-schedule-manager_v0.1.0_out.zip`
- [ ] 생성 명령 실행 후 zip 파일 무결성 확인

## 보안 알림

- 현 시점 `npm audit` 결과: `moderate 5건`
- 본 릴리즈에서는 기능 배포 완료를 우선하고, 취약점 조치는 **보안 업데이트 전용 PR**에서 처리
