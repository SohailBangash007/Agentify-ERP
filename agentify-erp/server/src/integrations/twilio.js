// Twilio voice and SMS for the CRM dialer. The workspace owner pastes their own Account SID, Auth Token and a Twilio phone
// number; nothing is shared between workspaces. Calls use Twilio's "bridge" pattern: Twilio rings the agent's own phone,
// and when the agent answers it connects the lead, showing the Twilio number as the caller ID. Every call is logged.
import crypto from 'node:crypto';
import { bad } from '../util.js';

const API = 'https://api.twilio.com/2010-04-01';
const auth = (c) => `Basic ${Buffer.from(`${c.account_sid}:${c.auth_token}`).toString('base64')}`;
const SID = /^AC[0-9a-f]{32}$/i;

export function validateTwilioConfig(c) {
  if (!SID.test(String(c.account_sid || '').trim())) throw bad('The Account SID starts with AC and has 34 characters. Copy it from the Twilio Console home page.');
  if (String(c.auth_token || '').trim().length < 20) throw bad('Paste the Auth Token from the Twilio Console home page (click the eye icon to show it).');
  if (!/^\+[1-9]\d{6,14}$/.test(String(c.phone_number || '').trim())) throw bad('The Twilio phone number must be in international format, for example +14155550100.');
  return { account_sid: c.account_sid.trim(), auth_token: c.auth_token.trim(), phone_number: c.phone_number.trim() };
}

async function twilio(c, method, path, form) {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: auth(c), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form).toString() : undefined });
  let body = null; try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) { const e = new Error(body?.message || `Twilio answered ${res.status}`); e.status = res.status; e.code = body?.code; throw e; }
  return body;
}

/** A real request: the account must exist and the number must belong to it. */
export async function testTwilio(c) {
  const acct = await twilio(c, 'GET', `/Accounts/${c.account_sid}.json`);
  if (acct.status && acct.status !== 'active') throw new Error(`The Twilio account is ${acct.status}.`);
  const nums = await twilio(c, 'GET', `/Accounts/${c.account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(c.phone_number)}`);
  if (!nums.incoming_phone_numbers?.length) throw new Error(`${c.phone_number} is not a number on this Twilio account. Buy or choose one in the Twilio Console first.`);
  return { friendly_name: acct.friendly_name, type: acct.type, number_sid: nums.incoming_phone_numbers[0].sid, voice: nums.incoming_phone_numbers[0].capabilities?.voice !== false, sms: nums.incoming_phone_numbers[0].capabilities?.sms !== false };
}

/** Rings `agentNumber`; when answered, Twilio asks `bridgeUrl` for instructions (which connect the lead). */
export async function startBridgeCall(c, { agentNumber, bridgeUrl, statusUrl }) {
  const r = await twilio(c, 'POST', `/Accounts/${c.account_sid}/Calls.json`, { To: agentNumber, From: c.phone_number, Url: bridgeUrl, StatusCallback: statusUrl, StatusCallbackEvent: 'initiated ringing answered completed', Method: 'POST', Timeout: '30' });
  return { sid: r.sid, status: r.status };
}
export async function sendSms(c, { to, body }) {
  const r = await twilio(c, 'POST', `/Accounts/${c.account_sid}/Messages.json`, { To: to, From: c.phone_number, Body: body });
  return { sid: r.sid, status: r.status };
}

/** TwiML that connects the lead. XML-escaped; the number is validated before it gets here. With recording on, the call opens with a spoken notice and both sides are recorded on separate tracks. */
export function bridgeTwiml({ leadNumber, callerId, record = false, announcement = '', recordingCallback = '' }) {
  const esc = (x) => String(x).replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
  const say = record && announcement ? `<Say>${esc(announcement)}</Say>` : '<Say>Connecting you to your lead.</Say>';
  const rec = record ? ` record="record-from-answer-dual" recordingStatusCallback="${esc(recordingCallback)}" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST"` : ' record="do-not-record"';
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Dial callerId="${esc(callerId)}" answerOnBridge="true"${rec}><Number>${esc(leadNumber)}</Number></Dial></Response>`;
}

/** Twilio signs each webhook: base64(HMAC-SHA1(authToken, url + sorted params)). */
export function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params || {}).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', authToken).update(data).digest('base64');
}
export function verifyTwilioSignature(authToken, url, params, header) {
  if (!header) return false;
  const a = Buffer.from(twilioSignature(authToken, url, params)), b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
