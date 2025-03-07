import {
  BlockAction,
  KnownBlock,
  SlackActionMiddlewareArgs,
} from '@slack/bolt';
import _ from 'lodash';
import { LinkBlockInputItem } from './types';

export const generateSlackLinkBlocks = (
  input: LinkBlockInputItem[]
): KnownBlock[] => {
  const grouped = _.groupBy(input, 'type');

  const blocks: KnownBlock[] = [];

  for (const [type, items] of Object.entries(grouped)) {
    console.log(type);
    // if (type) {
    //   blocks.push({
    //     type: 'section',
    //     text: {
    //       type: 'mrkdwn',
    //       text: `*${type}*`,
    //     },
    //   });
    // }

    const linksText = items
      .map((item) => {
        // '<', '>'을 HTML 엔티티로 변환하여 링크가 깨지지 않도록 함
        const safeName = item.name
          .replace(/</g, '&lt;') // '<' -> '&lt;'
          .replace(/>/g, '&gt;'); // '>' -> '&gt;'

        return `<${item.url}|${safeName}>`;
      })
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: linksText,
      },
    });

    blocks.push({ type: 'divider' });
  }

  // 마지막 divider 제거
  blocks.pop();
  return blocks;
};

export const makeTextRespond = async ({
  respond,
  text,
}: {
  respond?: SlackActionMiddlewareArgs<BlockAction>['respond'];
  text: string;
}) => {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text,
      },
    },
  ];

  if (respond) {
    await respond({ blocks });
  }

  return { blocks }; // respond 없이 사용하고 싶을 때를 위해 반환
};
