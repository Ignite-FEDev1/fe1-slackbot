import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { WorkerPayload } from './worker';

const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'ap-northeast-2' });

/**
 * Slack ack() 이후 느린 작업(Jira 생성 + Slack 메시지)을 비동기 Lambda 호출로 위임한다.
 * InvocationType: 'Event' = fire-and-forget, 현재 Lambda는 즉시 리턴.
 */
export const invokeWorker = async (payload: WorkerPayload): Promise<void> => {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    // 로컬 개발 환경: 직접 실행
    const { handleWorker } = await import('./worker');
    await handleWorker(payload);
    return;
  }

  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event', // 비동기 — 즉시 리턴
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );
};
