export function normalizeHashRouteSearch(href: string): string | null {
  const url = new URL(href);
  const rawHash = url.hash;
  const qIdx = rawHash.indexOf("?");

  if (qIdx === -1) {
    return null;
  }

  const searchParams = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(rawHash.slice(qIdx));

  hashParams.forEach((value, key) => {
    searchParams.set(key.toLowerCase(), value);
  });

  url.hash = rawHash.slice(0, qIdx);
  url.search = searchParams.toString();

  return url.href;
}
