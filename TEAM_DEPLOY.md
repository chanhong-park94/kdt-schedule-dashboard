# TEAM DEPLOY GUIDE (사내 정적 서버)

## 1) 배포 절차 (dist 업로드 방식)

1. 로컬에서 빌드/테스트 완료
   - `npm ci`
   - `npm test -- --run`
   - `npm run build`
2. 배포 아티팩트 생성
   - 파일명: `academic-schedule-manager_v0.1.0_dist.zip`
   - Windows PowerShell:
     - `Compress-Archive -Path "dist\*" -DestinationPath "academic-schedule-manager_v0.1.0_dist.zip" -Force`
3. 사내 정적 서버 업로드
   - 대상 경로 예: `/var/www/academic-schedule-manager/` 또는 사내 웹루트
   - 기존 운영본 백업 후 신규 zip 업로드
4. 서버에서 압축 해제 및 반영
   - 예시(리눅스): `unzip -o academic-schedule-manager_v0.1.0_dist.zip -d /var/www/academic-schedule-manager/`
5. 반영 검증
   - 메인 화면 로드
   - `?demo=1` 샘플 로드
   - HRD CSV 다운로드
   - `v7e_strict` export

## 2) 롤백 절차 (이전 dist.zip로 교체)

1. 배포 장애 확인 후 즉시 롤백 결정
2. 직전 안정 버전 zip 확인
   - 예: `academic-schedule-manager_v0.0.9_dist.zip`
3. 운영 경로에 이전 zip 재배포
   - 기존 파일 덮어쓰기 방식으로 압축 해제
4. 롤백 검증
   - 주요 기능(업로드, 충돌 계산, export, print) 재확인
5. 장애 원인 기록 및 후속 배포 일정 재수립

## 3) 버전 업데이트 절차 (CHANGELOG/태그)

1. `CHANGELOG.md`에 릴리즈 항목 추가/정리
2. `package.json` 버전 확인/조정
3. 릴리즈 태그 생성
   - `git tag -a v0.1.0 -m "Release v0.1.0"`
   - `git push origin v0.1.0`
4. 릴리즈 아티팩트(zip)와 태그 버전 일치 여부 검증

## 보안 알림

- 현재 `npm audit` 결과: `moderate 5건`
- 본 이슈는 릴리즈 배포 PR에서 혼합 처리하지 않고, **보안 업데이트 전용 PR**로 분리하여 처리 권장
