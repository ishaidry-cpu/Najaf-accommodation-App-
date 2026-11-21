export class MissingCredentials extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingCredentials';
  }
}

export function nkerpLogin(env: NodeJS.ProcessEnv = process.env): { loginId: string; password: string } {
  const loginId = env.NKERP_LOGIN_ID?.trim();
  const password = env.NKERP_PASSWORD;
  if (!loginId || !password) {
    throw new MissingCredentials('NKERP login is not configured on the server (set NKERP_LOGIN_ID and NKERP_PASSWORD)');
  }
  return { loginId, password };
}

export function credentialStatus(env: NodeJS.ProcessEnv = process.env) {
  try { nkerpLogin(env); return { nkerp: true, problem: null }; }
  catch (err) { return { nkerp: false, problem: (err as Error).message }; }
}
