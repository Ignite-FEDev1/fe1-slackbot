import {
  Block,
  BlockAction,
  KnownBlock,
  Middleware,
  SlackActionMiddlewareArgs,
} from '@slack/bolt';
import {
  getLatestPages,
  getPageContent,
  createNewPage,
  getTodayJiraIssues,
  getNotStartedJiraIssues,
  getNotEndedJiraIssues,
} from '../external';
import { LinkBlockInputItem } from '../types';
import { generateSlackLinkBlocks, makeTextRespond } from '../util';
import { addDays, format, startOfWeek } from 'date-fns';

export const PAGE_CONTAINER_ID = {
  DAILY: '1323565232',
  WEEKLY: '1323532404',
};

export const handleGetDailyPage: Middleware<
  SlackActionMiddlewareArgs<BlockAction>
> = async ({ ack, body, client, say, respond }) => {
  await ack();
  const recentReleaseNotes: LinkBlockInputItem[] = [];

  const latestDailyPages = await getLatestPages(PAGE_CONTAINER_ID.DAILY);
  if (latestDailyPages && Array.isArray(latestDailyPages)) {
    latestDailyPages.forEach((page) => {
      recentReleaseNotes.push(page);
    });
  }
  const slackBlocks = generateSlackLinkBlocks(recentReleaseNotes);

  await respond({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*데일리 페이지 목록입니다. (최신 10개까지)* 🤖`,
        },
      },
      {
        type: 'divider',
      },
      ...slackBlocks,
    ],
  });
  return;
};

export const handleGetWeeklyPage: Middleware<
  SlackActionMiddlewareArgs<BlockAction>
> = async ({ ack, body, client, say, respond }) => {
  await ack();
  const recentDailyPages: LinkBlockInputItem[] = [];

  const latestWeeklyPages = await getLatestPages(PAGE_CONTAINER_ID.WEEKLY);
  if (latestWeeklyPages && Array.isArray(latestWeeklyPages)) {
    latestWeeklyPages.forEach((page) => {
      recentDailyPages.push(page);
    });
  }
  const slackBlocks = generateSlackLinkBlocks(recentDailyPages);

  await respond({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*위클리 페이지 목록입니다. (최신 10개까지)* 🤖`,
        },
      },
      {
        type: 'divider',
      },
      ...slackBlocks,
    ],
  });
  return;
};

export const handleMyJiraIssues: Middleware<
  SlackActionMiddlewareArgs<BlockAction>
> = async ({ ack, body, client, say, respond }) => {
  await ack();
  try {
    const results = await Promise.allSettled([
      getTodayJiraIssues(),
      getNotStartedJiraIssues(),
      getNotEndedJiraIssues(),
    ]);

    const blocks: KnownBlock[] = [];

    const [todayResult, notStartedResult, notEndedResult] = results;

    const processIssues = (
      result: PromiseSettledResult<any>,
      { title, description }: { title: string; description?: string }
    ) => {
      if (result.status === 'fulfilled' && result.value?.length > 0) {
        blocks.push({ type: 'divider' });
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*📌 ${title}*` },
        });
        if (description) {
          blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: description },
          });
        }
        blocks.push(...generateSlackLinkBlocks(result.value));
      }
    };

    // 각 결과를 처리
    processIssues(todayResult, { title: '오늘 내 할 일' });
    processIssues(notStartedResult, {
      title: '시작하지 않은 이슈',
      description:
        '시작일이 지났지만 아직 티켓 상태가 "해야할 일"인 이슈 목록입니다.',
    });
    processIssues(notEndedResult, {
      title: '완료되지 않은 이슈',
      description:
        '완료일이 지났지만 아직 티켓 상태가 "완료"가 아닌 이슈 목록입니다.',
    });

    await respond({ blocks });
  } catch (error) {
    console.error(error);
    await makeTextRespond({
      respond,
      text: `지라 이슈를 불러오는 중에 문제가 발생했습니다. 나중에 다시 시도해주세요. 😢`,
    });
  }
};

export const handleCreateDailyPage: Middleware<
  SlackActionMiddlewareArgs<BlockAction>
> = async ({ ack, body, client, say, respond }) => {
  await ack();
  const dailyPages = await getLatestPages(PAGE_CONTAINER_ID.DAILY);

  // 데일리 페이지가 없을 경우
  if (!dailyPages || dailyPages.length === 0) {
    await makeTextRespond({
      respond,
      text: `데일리 페이지가 없습니다. 최초 페이지는 Jira에서 생성해주세요.`,
    });
    return;
  }

  const title = getWeeklyTitle();
  const thisWeekDailyPage = dailyPages.find((page) => page.name === title);

  // 이미 생성된 이번주 데일리 페이지가 있을 경우
  if (thisWeekDailyPage) {
    await respond({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `이미 생성된 이번주 데일리 페이지가 있습니다. <https://ignitecorp.atlassian.net/wiki${thisWeekDailyPage.url}|${title}>`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '다음주 데일리 미리 만들기',
                emoji: true,
              },
              value: 'create_next_daily_page',
              action_id: 'create_next_daily_page',
            },
          ],
        },
      ],
    });
    return;
  }

  const latestDailyPage = dailyPages[0];
  const pageContent = await getPageContent(latestDailyPage.id);
  if (!pageContent) {
    await makeTextRespond({
      respond,
      text: `복사를 위해 참조할 수 있는 데일리 페이지가 없습니다. 최초 페이지는 Jira에서 생성해주세요.`,
    });
    return;
  }

  const newPage = await createNewPage(
    PAGE_CONTAINER_ID.DAILY,
    pageContent.body,
    title
  );
  if (!newPage) {
    await makeTextRespond({
      respond,
      text: `페이지 생성에 실패하였습니다. 나중에 다시 시도해주세요. 😢`,
    });
    return;
  }

  await makeTextRespond({
    respond,
    text: `✅ 페이지가 성공적으로 생성되었습니다. <https://ignitecorp.atlassian.net/wiki${newPage._links.webui}|${title}>`,
  });
  return;
};

export const handleCreateNextDailyPage: Middleware<
  SlackActionMiddlewareArgs<BlockAction>
> = async ({ ack, body, client, say, respond }) => {
  await ack();
  const dailyPages = await getLatestPages(PAGE_CONTAINER_ID.DAILY);

  // 데일리 페이지가 없을 경우
  if (!dailyPages || dailyPages.length === 0) {
    await makeTextRespond({
      respond,
      text: `데일리 페이지가 없습니다. 최초 페이지는 Jira에서 생성해주세요.`,
    });
    return;
  }

  const nextWeek = addDays(new Date(), 7);
  const title = getWeeklyTitle(nextWeek);
  const nextWeekDailyPage = dailyPages.find((page) => page.name === title);

  // 이미 생성된 다음주 데일리 페이지가 있을 경우
  if (nextWeekDailyPage) {
    await makeTextRespond({
      respond,
      text: `이미 생성된 다음주 데일리 페이지가 있습니다. <https://ignitecorp.atlassian.net/wiki${nextWeekDailyPage.url}|${title}>`,
    });
    return;
  }

  const latestDailyPage = dailyPages[0];
  const pageContent = await getPageContent(latestDailyPage.id);
  if (!pageContent) {
    await makeTextRespond({
      respond,
      text: `복사를 위해 참조할 수 있는 데일리 페이지가 없습니다. 최초 페이지는 Jira에서 생성해주세요.`,
    });
    return;
  }

  const newPage = await createNewPage(
    PAGE_CONTAINER_ID.DAILY,
    pageContent.body,
    title
  );
  if (!newPage) {
    await makeTextRespond({
      respond,
      text: `페이지 생성에 실패하였습니다. 나중에 다시 시도해주세요. 😢`,
    });
    return;
  }

  await makeTextRespond({
    respond,
    text: `✅ 페이지가 성공적으로 생성되었습니다. <https://ignitecorp.atlassian.net/wiki${newPage._links.webui}|${title}>`,
  });
  return;
};

const getWeeklyTitle = (targetDate?: Date): string => {
  const _targetDate = targetDate ? targetDate : new Date();

  // 이번 주 월요일 찾기 (startOfWeek에서 { weekStartsOn: 1 } → 월요일 기준)
  const monday = startOfWeek(_targetDate, { weekStartsOn: 1 });
  // 이번 주 금요일 계산
  const friday = addDays(monday, 4);

  // 날짜 포맷팅
  const formattedMonday = format(monday, 'yyyy-MM-dd');
  const formattedFriday = format(friday, 'MM-dd');

  return `FE1) 데일리 - ${formattedMonday} ~ ${formattedFriday}`;
};
