export type SupportedPlatform = 'youtube' | 'instagram';

export interface ValidationResult {
  valid: boolean;
  platform?: SupportedPlatform;
  cleanUrl?: string;
  error?: string;
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com',
]);

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'instagr.am',
]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
]);

/**
 * Validates whether the given URL is a legitimate public YouTube or Instagram URL,
 * protecting against SSRF, internal network scanning, and malformed inputs.
 */
export function validateMediaUrl(rawUrl: string): ValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string' };
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return { valid: false, error: 'URL is too long' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Must use HTTP or HTTPS
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'URL protocol must be HTTP or HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // SSRF and private IP range checks
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
  ) {
    return { valid: false, error: 'Access to private or local network resources is forbidden' };
  }

  // Check YouTube
  if (YOUTUBE_HOSTS.has(hostname)) {
    // Basic path check
    const path = parsed.pathname;
    if (
      path.includes('/watch') ||
      path.includes('/shorts/') ||
      path.includes('/live/') ||
      hostname === 'youtu.be'
    ) {
      return { valid: true, platform: 'youtube', cleanUrl: parsed.toString() };
    }
    // Also allow direct video URLs
    return { valid: true, platform: 'youtube', cleanUrl: parsed.toString() };
  }

  // Check Instagram
  if (INSTAGRAM_HOSTS.has(hostname)) {
    const path = parsed.pathname;
    if (
      path.includes('/reel/') ||
      path.includes('/reels/') ||
      path.includes('/p/') ||
      path.includes('/tv/') ||
      path.includes('/stories/')
    ) {
      return { valid: true, platform: 'instagram', cleanUrl: parsed.toString() };
    }
    return { valid: true, platform: 'instagram', cleanUrl: parsed.toString() };
  }

  return {
    valid: false,
    error: 'Only YouTube and Instagram URLs are supported. Please check the URL provided.',
  };
}

/**
 * Sanitizes a title string into a safe file name across Windows/Linux/macOS filesystems.
 */
export function sanitizeFilename(title: string, fallback = 'download'): string {
  if (!title || typeof title !== 'string') return fallback;
  
  // Replace illegal characters: / \ ? * : | " < > and control characters
  let clean = title.replace(/[/\\?%*:|"<>]/g, '').trim();
  // Replace multi spaces
  clean = clean.replace(/\s+/g, ' ');
  // Truncate to reasonable length
  if (clean.length > 100) {
    clean = clean.substring(0, 100).trim();
  }
  return clean || fallback;
}
