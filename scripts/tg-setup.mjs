#!/usr/bin/env node
// Register the Telegram webhook + set the bot's command list.
//
//   node --env-file=.env.local scripts/tg-setup.mjs
//
// Requires in env:
//   TELEGRAM_BOT_TOKEN        from BotFather (use the token AFTER you /revoke the leaked one)
//   TELEGRAM_WEBHOOK_SECRET   any random string you also set in Vercel env
//
// Also run these in BotFather once:
//   /setprivacy -> select the bot -> Disable   (REQUIRED so it sees group messages)
//   /setjoingroups -> Enable                   (allows adding it to groups)

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const URL = process.env.WEBHOOK_URL || 'https://www.robinscan4u.com/api/tg/webhook';

if (!BOT) { console.error('TELEGRAM_BOT_TOKEN not set'); process.exit(1); }

const api = async (method, payload) => {
  const r = await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return r.json();
};

const cmd = process.argv[2] || 'set';

if (cmd === 'set') {
  const res = await api('setWebhook', {
    url: URL,
    secret_token: SECRET || undefined,
    allowed_updates: ['message', 'channel_post'],
    drop_pending_updates: true,
  });
  console.log('setWebhook:', JSON.stringify(res));

  const cmds = await api('setMyCommands', {
    commands: [
      { command: 'scan', description: 'Scan a token by contract address' },
      { command: 'help', description: 'How to use RobinScan' },
    ],
  });
  console.log('setMyCommands:', JSON.stringify(cmds));

  const me = await api('getMe', {});
  console.log('getMe:', JSON.stringify(me.result && me.result.username));
} else if (cmd === 'info') {
  console.log(JSON.stringify(await api('getWebhookInfo', {}), null, 2));
} else if (cmd === 'delete') {
  console.log(JSON.stringify(await api('deleteWebhook', { drop_pending_updates: true })));
} else {
  console.log('usage: tg-setup.mjs [set|info|delete]');
}
