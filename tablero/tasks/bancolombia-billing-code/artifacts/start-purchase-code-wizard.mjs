import {spawn} from 'node:child_process';
if(!process.env.FRONTEND_REPO)throw new Error('Set FRONTEND_REPO to the isolated frontend checkout.');
const api='http://127.0.0.1:8127';
const env={...process.env,APP_ENV:'local',VITE_API_URL:api,AUTH_SECRET:'local-purchase-code-fixture-secret',SESSION_SECRET:'local-purchase-code-fixture-session-secret',COGNITO_DOMAIN:'127.0.0.1:8127',COGNITO_CLIENT_ID:'local-fixture',COGNITO_CLIENT_SECRET:'local-fixture',CALLBACK_URL:'http://127.0.0.1:5187/auth/callback',ALIADOS_BASE_URL:api,INTERNAL_SSO_TOKEN:'local-fixture',MERCHANT_API_URL:api,VITE_PUSHER_APP_KEY:'local-fixture',VITE_PUSHER_HOST:'127.0.0.1',VITE_PUSHER_PORT:'8127',VITE_PUSHER_SCHEME:'http',VITE_PUBLIC_POSTHOG_KEY:'',VITE_PUBLIC_POSTHOG_HOST:'',POSTHOG_API_KEY:'',POSTHOG_ENABLED:'false',VITE_ONBOARDING_FORM_SERVICE:api+'/v1',VITE_FORM_SERVICE_BASE_URL:api,VITE_PREAPPROVALS_ENDPOINT:api+'/v1/preapprovals/check'};
const p=spawn('pnpm',['--filter','loan-request-wizard','dev','--host','127.0.0.1','--port','5187'],{cwd:process.env.FRONTEND_REPO,env,stdio:'inherit'});
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>p.kill(s));
p.on('exit',code=>process.exit(code??1));
