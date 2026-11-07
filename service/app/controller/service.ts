import { json } from '@server/response';
import type { ControllerInput } from '@server/types';

type SayHelloInput = ControllerInput<
  never,
  {
    foo?: string;
    bar?: string;
  }
>;

export async function sayHello(input: SayHelloInput) {
  const rawBody = typeof input.body === 'object' && input.body !== null ? (input.body as { foo?: string; bar?: string }) : {};
  const foo = typeof rawBody.foo === 'string' ? rawBody.foo : '';
  const bar = typeof rawBody.bar === 'string' ? rawBody.bar : '';
  return json({
    result: `Hello ${foo} ${bar}`.trim(),
  });
}
