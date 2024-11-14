import {
  BlockAction,
  Middleware,
  SlackActionMiddlewareArgs,
} from '@slack/bolt';
import { getLatestCPODeployPages } from '../external';
import { InputItem } from '../types';
import { generateSlackLinkBlocks } from '../util';

export const handleSelectSlackTemplate: Middleware<
  SlackActionMiddlewareArgs<BlockAction>
> = async ({ ack, respond }) => {
  await ack();
  await respond({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*필요한 템플릿을 골라주세요.*',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'CPO BO 정기배포/핫픽스',
              emoji: true,
            },
            value: 'cpo_bo_deploy',
            action_id: 'cpo_bo_deploy_slack_template',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '소프티어 정기배포/핫픽스',
              emoji: true,
            },
            value: 'softeer_deploy',
            action_id: 'softeer_deploy_slack_template',
          },
        ],
      },
    ],
  });
};

export const handleGetSlackTemplate: Middleware<
  SlackActionMiddlewareArgs<BlockAction>
> = async ({ ack, body, client, say, respond }) => {
  await ack();

  // CPO BO 배포 템플릿
  if ((body.actions[0] as { value: string }).value === 'cpo_bo_deploy') {
    const recentReleaseNotes: InputItem[] = [];

    const latestDeployPages = await getLatestCPODeployPages();
    if (latestDeployPages && Array.isArray(latestDeployPages)) {
      latestDeployPages.forEach((page) => {
        recentReleaseNotes.push({ type: 'Confluence', ...page });
      });
    }
    const slackBlocks = generateSlackLinkBlocks(recentReleaseNotes);

    await respond({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*CPO BO 정기배포/핫픽스* 템플릿이예요. 🤖`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '<  *Gitlab*  >\n1. 배포 승인 대기\n2. release -> main 머지 <https://gitlab.hmc.co.kr/kia-cpo/kia-cpo-bo-web/-/merge_requests|BO> / <https://gitlab.hmc.co.kr/kia-cpo/kia-pricing-bo-web/-/merge_requests|프라이싱> / <https://gitlab.hmc.co.kr/kia-cpo/kia-cpo-partner-web/-/merge_requests|평가사>\n\t- 담당 PR건들 release 브랜치로 머지 - <!subteam^S05SK5F8Z5J> 완료시 따봉\n\t- 릴리즈 발행 (`{release-yyyyMMdd}`) - <@U04D5SP327J>\n\t- 릴리즈 노트: `{맨 아래 링크 참고하여 릴리즈 노트 링크 복붙}`\n3. main 로컬구동 모니터링 - <!subteam^S05SK5F8Z5J>\n4. 배포 전 할 일 확인 - <!subteam^S05SK5F8Z5J>\n5. 운영 배포 trigger - <@U04D5SP327J>\n6. main -> stage, stage2 현행화/배포\n\ta. BO `{담당자 태그}`\n\tb. 프라이싱 `{담당자 태그}`\n\tc. 평가사 `{담당자 태그}`\n7. 배포 후 모니터링 - <!subteam^S05SK5F8Z5J>\n8. 배포 후 할 일 확인 - <!subteam^S05SK5F8Z5J>\n9. 운영 모니터링 - `{모니터링 순서 작성}`\n10. 배포 완료',
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '참고) 최신 릴리즈 노트 목록입니다. :memo:',
          },
        },
        ...slackBlocks,
      ],
    });
    return;
  }

  // 소프티어 배포 템플릿
  if ((body.actions[0] as { value: string }).value === 'softeer_deploy') {
    await respond({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*소프티어 정기배포/핫픽스* 템플릿이예요. 🤖`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '< *소프티어 배포* >\n1. 팀즈 배포 승인 대기\n2. release/hotfix -> main 머지 <https://gitlab.hmc.co.kr/ignite-hmg-developers/hmg-developers/-/merge_requests|Gitlab MR>\n3. main 로컬구동 모니터링 - <!subteam^S067AHD9MFZ>\n4. 배포 전 할 일 확인 - <https://ignitecorp.atlassian.net/wiki/spaces/HDS/pages/839024722/Dev|Dev) 배포관리> <!subteam^S067AHD9MFZ>\n5. main 검증계 배포 (staging 태그 발행)\n6. 검증계 배포 완료 대기\n\t- <https://gitlab.hmc.co.kr/ignite-hmg-developers/hmg-developers/-/pipelines|gitlab pipeline> 확인\n\t- <https://argo.hmc.co.kr/|argo> 업데이트 확인\n7. main 운영계 배포 (release 태그 발행)\n8. 배포 후 모니터링 - <!subteam^S067AHD9MFZ>\n9. 배포 후 할 일 확인 - <https://ignitecorp.atlassian.net/wiki/spaces/HDS/pages/839024722/Dev|Dev) 배포관리> <!subteam^S067AHD9MFZ>\n10. 팀즈 배포 완료 공유',
          },
        },
      ],
    });
    return;
  }

  await respond({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `템플릿이예요. 🤖`,
        },
      },
    ],
  });
};
