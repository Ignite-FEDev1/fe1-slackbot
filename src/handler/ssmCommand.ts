import {
  BlockAction,
  Middleware,
  SlackActionMiddlewareArgs,
} from '@slack/bolt';

export const handleGetSsmCommand: Middleware<
  SlackActionMiddlewareArgs<BlockAction>
> = async ({ ack, respond }) => {
  await ack();
  await respond({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*NginX 관련 명령어*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '- `sudo cat /etc/nginx/sites-available/default.conf`: 현재 돌고 있는 NginX 설정 확인\n- `sudo nano /etc/nginx/nginx.conf`: NginX 전체 설정 파일을 편집\n- `sudo nginx -t`: NginX 설정 파일에 오류가 있는지 테스트\n- `sudo service nginx restart`: NginX 재시작\n- `sudo service nginx status`: NginX 상태 확인\n- `sudo tail -f /var/log/nginx/access.log`: NginX의 실시간 접근 로그 확인\n- `sudo tail -f /var/log/nginx/error.log`: NginX의 실시간 에러 로그 확인\n- `sudo netstat -tulnp | grep :80`: 80번 포트를 사용 중인 프로세스를 확인\n- `sudo netstat -tulnp | grep :443`: HTTPS (443번 포트) 관련 확인\n- `systemctl list-units --type=service`: 현재 실행 중이거나 활성화된 서비스 목록 표시',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Node.js 관련 명령어*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '- `ps aux | grep node`: 실행 중인 Node.js 프로세스를 확인\n- `pm2 list`: pm2로 관리 중인 Node.js 프로세스 상태 확인\n- `pm2 logs <app-name>`: 특정 앱의 PM2 로그를 실시간으로 확인\n- `pm2 restart <app-name>`: pm2로 실행 중인 Node.js 앱을 재시작\n- `sudo systemctl restart node-app`: 시스템 서비스로 등록된 Node.js 앱을 재시작\n- `/data/logs`: 로그 위치\n- `tail -f nodejs-app.log`: 실시간 로그 확인\n- `cat nodejs-app.log`: log 확인\n- `sudo lsof -i :<port-number>`: 특정 포트(예: 8080)에서 실행 중인 프로세스를 확인',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*시스템 리소스 및 상태 확인*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '- `top`: CPU 및 메모리 사용량을 실시간으로 확인\n- `htop`: htop이 설치된 경우, 더 상세한 리소스 모니터링\n- `free -m`: 메모리 사용 상태 확인\n- `df -h`: 디스크 공간 사용량을 확인\n- `du -sh /path/to/folder`: 특정 폴더의 디스크 사용량을 확인',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*EC2 관련 명령어*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '- `sudo tail -f /var/log/syslog`: 시스템 로그 확인\n- `dmesg | less`: 커널 로그 확인\n- `ping google.com`: 외부 네트워크 연결이 가능한지 확인\n- `curl http://localhost:<port>`: 로컬에서 애플리케이션의 응답을 확인\n- `curl -I http://localhost`: 헤더 정보만 가져와서 응답 상태 확인\n- `sudo ufw status`: 방화벽 설정 확인',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*기타 유용한 명령어*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '- `journalctl -u <service-name>`: 시스템 서비스 관련 로그 확인\n- `ss -tuln`: 열려 있는 포트를 확인\n- `curl -I http://127.0.0.1:8080/health`: 해당 URL의 헤더 응답 확인(상태 코드만 확인)\n- `curl -o rss_feed.xml https://developers.hyundaimotorgroup.com/journal/rss`: url의 페이지를 rss_feed.xml로 다운로드',
        },
      },
    ],
  });
};
