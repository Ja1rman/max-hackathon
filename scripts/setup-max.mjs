#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { maxApiRequest, miniAppLink, normalizeHttpsUrl, readMaxConfig } from '../server/max-bot.mjs';

/** Run explicitly after deploying HTTPS and configuring existing bot credentials. */
export async function setupMax(config = readMaxConfig(), { fetchImpl, output = console.log } = {}) {
  if (!config.token) throw new Error('Set MAX_BOT_TOKEN to the existing bot token');
  if (!/^[A-Za-z0-9_-]{5,256}$/.test(config.webhookSecret || '')) {
    throw new Error('Set MAX_WEBHOOK_SECRET to 5–256 letters, digits, underscores or hyphens');
  }
  const publicUrl = normalizeHttpsUrl(config.publicUrl, 'PUBLIC_URL');
  const publicEndpoint = new URL(publicUrl);
  if (publicEndpoint.port && publicEndpoint.port !== '443') throw new Error('MAX webhook requires HTTPS port 443');
  normalizeHttpsUrl(config.apiUrl, 'MAX_API_URL');

  const bot = await maxApiRequest(config, '/me', { fetchImpl });
  if (!bot?.is_bot || typeof bot.username !== 'string') throw new Error('MAX /me did not return a bot username');
  const username = bot.username.replace(/^@/, '');
  const appLink = miniAppLink(username);
  if (config.username && config.username.replace(/^@/, '') !== username) {
    throw new Error('MAX_BOT_USERNAME does not match the configured token; update it before registering the webhook');
  }
  const webhookUrl = `${publicUrl}/api/max/webhook`;
  const subscription = await maxApiRequest(config, '/subscriptions', {
    method: 'POST',
    fetchImpl,
    body: { url: webhookUrl, update_types: ['bot_started', 'bot_stopped', 'message_created'], secret: config.webhookSecret },
  });
  if (subscription?.success !== true) throw new Error('MAX did not confirm webhook registration');
  const commands = [...(Array.isArray(bot.commands) ? bot.commands : []).filter(command => command.name !== 'id'), { name: 'id', description: 'Показать мой MAX ID' }];
  const commandResult = await maxApiRequest(config, '/me/commands', {
    method: 'PATCH', fetchImpl, body: { commands },
  });
  if (commandResult?.success === false) throw new Error('MAX did not confirm command registration');
  output(`MAX_BOT_USERNAME=${username}`);
  output(`Webhook configured: ${webhookUrl}`);
  output(`Set the Mini App URL in MAX for Business to: ${publicUrl}`);
  output(`Open Mini App: ${appLink}`);
  return { username, webhookUrl, publicUrl, appLink };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setupMax().catch((error) => {
    console.error(`MAX setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
