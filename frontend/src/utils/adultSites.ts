// Adult-site detection for the 18+ age gate.
// When a pasted URL belongs to a known adult site, the app must ask
// "Are you 18+?" BEFORE analyzing/downloading, instead of relying only
// on the video metadata age_limit (which adult extractors often do not return).

const ADULT_DOMAINS = [
  'pornhub.com',
  'xvideos.com',
  'xnxx.com',
  'xhamster.com',
  'redtube.com',
  'youporn.com',
  'brazzers.com',
  'onlyfans.com',
  'chaturbate.com',
  'livejasmin.com',
  'stripchat.com',
  'cam4.com',
  'bongacams.com',
  'xhamsterlive.com',
  'porn.com',
  'tube8.com',
  'spankbang.com',
  'beeg.com',
  'eporner.com',
  'hqporner.com',
  'tnaflix.com',
  'empflix.com',
  'sunporno.com',
  'gotporn.com',
  'xvideos2.com',
  'pornhubpremium.com',
];

export function isAdultUrl(rawUrl: string): boolean {
  let host = '';
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (ADULT_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  return /(^|\.)(porn|xxx|sex|adult|erotic|cam|nude)($|\.)/.test(host) || host.includes('porn') || host.includes('xxx');
}
