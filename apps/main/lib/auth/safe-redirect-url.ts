export function getSafeRedirectUrl(
  url: string | null | undefined,
  fallback: string,
): string {
  if (!url) {
    return fallback;
  }

  if (!url.startsWith('/') || url.startsWith('//')) {
    return fallback;
  }

  return url;
}
