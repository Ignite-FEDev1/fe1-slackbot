## 배포 방법

1. `src/` 하위 폴더에서 작업
2. `npm run build` (`./app.js`가 업데이트 됩니다.)
3. `sls deploy` (`./app.js`가 배포됩니다.)

## 배포 중 FAQ

1. VPN 이슈 등으로 TLS 실패하는 경우, `sls deploy` 이전에 `export NODE_TLS_REJECT_UNAUTHORIZED=0`

- 주의: 보안 이슈가 있어, 해당 터미널에서는 다른 작업은 지양합니다.

## 로컬 디버깅 방법

`sls logs -f slack -t`
