// Local SMTP sink for browser tests: the API sends real SMTP mail here and
// the tests read it back over HTTP to follow the links, like a user would.
import { createServer } from 'node:http';
import { SMTPServer } from 'smtp-server';

const SMTP_PORT = Number(process.env.SINK_SMTP_PORT ?? 2525);
const HTTP_PORT = Number(process.env.SINK_HTTP_PORT ?? 2526);
const mails = [];

const decodeQP = (s) =>
  s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, session, done) {
    let raw = '';
    stream.on('data', (c) => (raw += c));
    stream.on('end', () => {
      mails.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), body: decodeQP(raw) });
      done();
    });
  },
}).listen(SMTP_PORT, '127.0.0.1');

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return res.end('ok');
  const to = (url.searchParams.get('to') ?? '').toLowerCase();
  const mail = [...mails].reverse().find((m) => m.to.includes(to));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(mail ?? null));
}).listen(HTTP_PORT, '127.0.0.1');
