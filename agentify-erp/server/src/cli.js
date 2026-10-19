// Server-side maintenance commands (run on the server, never exposed over HTTP):
//   npm run platform:setup-token   print a fresh one-time token for /platform/first-run (only while no console account exists)
//   npm run platform:lifecycle     run the subscription lifecycle job once (trial expiry, reminders, renewals)
import { platformDb } from './platform.js';
import { issueSetupToken, setupNeeded, SETUP_TOKEN_FILE } from './services/platformStaff.js';

const cmd = process.argv[2];
platformDb();
if (cmd === 'setup-token') {
  if (!setupNeeded()) { console.error('The platform already has a console account. Sign in at /platform, or ask a Platform Owner to invite you.'); process.exit(1); }
  const token = issueSetupToken();
  console.log(`One-time setup token (valid 24 hours, also saved to ${SETUP_TOKEN_FILE}):\n\n  ${token}\n\nOpen https://<your main domain>/platform/first-run and enter it to create the Platform Owner.`);
} else if (cmd === 'lifecycle') {
  const { runLifecycle } = await import('./services/lifecycle.js');
  console.log(JSON.stringify(await runLifecycle(), null, 2));
} else {
  console.error('Usage: node src/cli.js setup-token | lifecycle');
  process.exit(1);
}
