// guesses person vs bot for a visitor log entry. score > 0 leans person, < 0 bot.
// old entries only have the UA + address so they mostly come out unknown

export const VERDICTS = {
  human: { label: 'Person', tone: 'emerald' },
  'likely-human': { label: 'Likely person', tone: 'teal' },
  unknown: { label: 'Unknown', tone: 'slate' },
  'likely-bot': { label: 'Likely bot', tone: 'amber' },
  bot: { label: 'Bot', tone: 'rose' },
  test: { label: 'Test', tone: 'violet' },
};

export const isPerson = (verdict) => verdict === 'human' || verdict === 'likely-human';

// not chat apps, people open links in discord/slack/telegram and their previewers say "bot"
const BOT_UA =
  /[a-z0-9-]*bot\b|crawl\w*|spider|slurp|scrap\w*|facebookexternalhit|embedly|skypeuripreview|python[\w-]*|curl|wget|httpie|go-http-client|okhttp|axios|node-fetch|undici|java\/|libwww|headless\w*|lighthouse|pagespeed|gtmetrix|pingdom|uptime\w*|phantomjs|selenium|puppeteer|playwright|google-inspectiontool|googleother|bytespider|ccbot|perplexity|semrush|ahrefs|mj12/i;

// for old entries from before we asked ip-api for the hosting flag
const HOST_ISP =
  /amazon|aws|google llc|google cloud|microsoft|azure|digitalocean|linode|akamai|ovh|hetzner|vultr|choopa|contabo|oracle|alibaba|tencent|scaleway|leaseweb|m247|datacamp|cloudflare|fastly|hostinger|ionos|hostwinds|psychz|colocrossing|quadranet|stark industries|zenlayer|data ?cent(er|re)|hosting|servers?\b/i;

const SOFTWARE_GPU = /swiftshader|llvmpipe|software|basic render|mesa offscreen/i;
const PHONE_UA = /iphone|android.+mobile/i;

function isLocal(ip = '') {
  return /^(::1|127\.|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|localhost)/i.test(ip);
}

export function judgeEntry(log) {
  const reasons = [];
  const add = (weight, text) => reasons.push({ weight, text });
  const ua = log.userAgent || '';

  if (isLocal(log.ip)) {
    return { verdict: 'test', score: 0, reasons: [{ weight: 0, text: 'local address (development or a test run)' }] };
  }
  const named = ua.match(BOT_UA);
  if (named || !ua) {
    return {
      verdict: 'bot',
      score: -10,
      reasons: [{ weight: -10, text: named ? `user agent names a bot or tool: ${named[0]}` : 'no user agent' }],
    };
  }
  const visitor = log.visitor;
  if (visitor?.webdriver) {
    return { verdict: 'bot', score: -10, reasons: [{ weight: -10, text: 'browser driven by automation (webdriver)' }] };
  }

  const h = log.headers;
  if (h) {
    if (!h.secFetchMode && !h.acceptLanguage) {
      add(-4, "called the API without a browser's headers");
    } else if (!h.secFetchMode && /chrome|firefox|edg/i.test(ua)) {
      add(-2, 'no Sec-Fetch headers from a browser that sends them');
    } else {
      add(1, "a browser's request headers");
    }
  }

  const loc = log.location || {};
  if (loc.hosting) {
    add(-2, `datacenter address${loc.isp ? ` (${loc.isp})` : ''}`);
  } else if (loc.hosting === undefined && HOST_ISP.test(`${loc.isp} ${loc.org}`)) {
    add(-2, `ISP looks like a host (${loc.isp || loc.org})`);
  }
  if (loc.proxy) {
    add(-1, 'VPN, proxy or Tor');
  }
  if (loc.mobile) {
    add(1, 'cellular network');
  }

  if (visitor) {
    const input = [
      [visitor.moves, 'pointer moves'],
      [visitor.clicks, 'clicks'],
      [visitor.touches, 'touches'],
      [visitor.scrolls, 'wheel scrolls'],
      [visitor.keys, 'keys'],
    ].filter(([n]) => n > 0);
    const real = visitor.touches > 0 || visitor.clicks > 0 || visitor.scrolls > 0 || visitor.keys > 0 || visitor.moves >= 5;
    if (real) {
      add(3, `real input: ${input.map(([n, what]) => `${n} ${what}`).join(', ')}`);
    } else if (visitor.dwellMs > 15000) {
      add(-1, `${Math.round(visitor.dwellMs / 1000)} s on the page with no input`);
    }
    if (visitor.outer === '0x0') {
      add(-3, 'window with no size (headless)');
    }
    if (visitor.languages === 0) {
      add(-2, 'no languages');
    }
    if (visitor.renderer && SOFTWARE_GPU.test(visitor.renderer)) {
      add(-2, `software GPU, as headless browsers and VMs run (${visitor.renderer})`);
    }
    if (visitor.timezone && loc.timezone) {
      if (visitor.timezone === loc.timezone) {
        add(1, 'timezone matches the address');
      } else {
        add(-1, `timezone ${visitor.timezone} isn't the address's (${loc.timezone})`);
      }
    }
    if (PHONE_UA.test(ua) && visitor.touchPoints === 0) {
      add(-2, 'phone user agent with no touch screen');
    }
  } else if (h && Date.now() - new Date(log.timestamp).getTime() > 60 * 1000) {
    add(-1, 'the page never reported back (no script ran, or it closed at once)');
  }
  if (log.relight?.phase === 'running' && log.relight.gpu && !SOFTWARE_GPU.test(log.relight.gpu)) {
    add(1, 'ran the relit room on a real GPU');
  }

  if (!reasons.length) {
    add(0, 'nothing recorded to judge by (logged before the judge)');
  }
  const score = reasons.reduce((sum, r) => sum + r.weight, 0);
  return { verdict: verdictOf(score), score, reasons };
}

function verdictOf(score) {
  if (score >= 3) return 'human';
  if (score >= 1) return 'likely-human';
  if (score <= -4) return 'bot';
  if (score <= -2) return 'likely-bot';
  return 'unknown';
}

// penalty for loading pages faster than anyone could read them
export function judgeVisitor(entries) {
  const judged = entries.map((log) => ({ log, ...judgeEntry(log) }));
  const sure = judged.find((j) => j.verdict === 'test') || judged.find((j) => j.score <= -10);
  if (sure) {
    return { verdict: sure.verdict, score: sure.score, reasons: sure.reasons, judged };
  }
  const best = judged.reduce((a, b) => (b.score > a.score ? b : a));
  const reasons = [...best.reasons];
  let score = best.score;
  const burst = busiestMinute(entries);
  if (burst > 20) {
    reasons.push({ weight: -3, text: `${burst} page views in one minute` });
    score -= 3;
  }
  return { verdict: verdictOf(score), score, reasons, judged };
}

function busiestMinute(entries) {
  const times = entries.map((e) => new Date(e.timestamp).getTime()).sort((a, b) => a - b);
  let most = 0;
  for (let i = 0, j = 0; i < times.length; i += 1) {
    while (times[i] - times[j] > 60 * 1000) {
      j += 1;
    }
    most = Math.max(most, i - j + 1);
  }
  return most;
}
