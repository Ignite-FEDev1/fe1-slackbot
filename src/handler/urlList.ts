import {
  BlockAction,
  Middleware,
  SlackActionMiddlewareArgs,
} from '@slack/bolt';

export const handleSelectURLListProject: Middleware<
  SlackActionMiddlewareArgs<BlockAction>
> = async ({ ack, respond }) => {
  await ack();
  await respond({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*관련된 페이지를 요청하실 프로젝트를 골라주세요.*',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'CPO BO',
              emoji: true,
            },
            value: 'kia-cpo-bo-web',
            action_id: 'cpo_bo_url_list',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'HMG DEV',
              emoji: true,
            },
            value: 'hmg-developers',
            action_id: 'hmg_dev_url_list',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '그룹웨어',
              emoji: true,
            },
            value: 'hmg-groupware-bo-web',
            action_id: 'groupware_url_list',
          },
        ],
      },
    ],
  });
};
