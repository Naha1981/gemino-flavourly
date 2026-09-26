import type { BrandProfile, MenuItem } from '@/lib/brand-intelligence/scraper';

export type AuditSeverity = 'high' | 'medium' | 'low';
export type AuditEvidence = 'verified' | 'strong_evidence' | 'hypothesis' | 'unknown';

export interface AuditFinding {
  id: string;
  title: string;
  description: string;
  severity: AuditSeverity;
  evidence: AuditEvidence;
  score: number;
  action: string;
  source: string;
}

export interface RestaurantAuditResult {
  readinessScore: number;
  readinessLabel: 'Strong foundation' | 'Needs work' | 'Significant leakage candidates';
  findings: AuditFinding[];
  menuPreview: MenuItem[];
  evidenceNotes: string[];
  profile: {
    brandName: string;
    tagline: string | null;
    confidence: number;
    hasLogo: boolean;
    hasHours: boolean;
    menuItems: number;
    pricedItems: number;
    describedItems: number;
  };
}

export interface RestaurantAuditContext {
  rating?: number | null;
  reviewCount?: number | null;
  competitorCount?: number | null;
  competitorAverageRating?: number | null;
}

function asMenuItems(value: unknown): MenuItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is MenuItem => Boolean(item && typeof item === 'object' && typeof (item as MenuItem).name === 'string'))
    .slice(0, 60);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildRestaurantAudit(
  profile: BrandProfile,
  context: RestaurantAuditContext = {},
): RestaurantAuditResult {
  const menuItems = asMenuItems(profile.menuJson);
  const pricedItems = menuItems.filter((item) => Boolean(item.price));
  const describedItems = menuItems.filter((item) => Boolean(item.description?.trim()));
  const hours = Array.isArray(profile.hoursJson) ? profile.hoursJson : [];

  const findings: AuditFinding[] = [];
  const pricedRatio = menuItems.length ? pricedItems.length / menuItems.length : 0;
  const describedRatio = menuItems.length ? describedItems.length / menuItems.length : 0;

  if (menuItems.length === 0) {
    findings.push({
      id: 'menu-not-observable',
      title: 'Menu evidence is missing',
      description: 'The website scan could not verify a usable menu structure. Customers may have to work harder to understand what is available.',
      severity: 'high', evidence: 'unknown', score: 25,
      action: 'Add or expose a crawlable menu with item names, prices and descriptions.',
      source: 'Website scan',
    });
  } else if (pricedRatio < 0.75) {
    findings.push({
      id: 'menu-price-coverage',
      title: 'Menu pricing is incomplete',
      description: pricedItems.length + ' of ' + menuItems.length + ' detected items include a price. Incomplete pricing can force customers to leave the buying journey to find basic information.',
      severity: pricedRatio < 0.5 ? 'high' : 'medium', evidence: 'verified',
      score: Math.round((1 - pricedRatio) * 100),
      action: 'Make core menu prices visible and consistent across customer-facing channels.',
      source: 'Website menu extraction',
    });
  }

  if (menuItems.length > 0 && describedRatio < 0.5) {
    findings.push({
      id: 'menu-description-coverage',
      title: 'Many menu items lack descriptions',
      description: describedItems.length + ' of ' + menuItems.length + ' detected items have usable descriptions. Descriptions are one of the easiest places to reduce uncertainty before a purchase.',
      severity: describedRatio < 0.25 ? 'high' : 'medium', evidence: 'verified',
      score: Math.round((1 - describedRatio) * 100),
      action: 'Rewrite priority items with concise, truthful descriptions that clarify what the customer receives.',
      source: 'Website menu extraction',
    });
  }

  if (menuItems.length > 0 && menuItems.length < 6) {
    findings.push({
      id: 'menu-depth',
      title: 'Very small visible menu',
      description: 'Only a small number of menu items were observable. This may be intentional, but it is worth verifying whether the scan reached the full menu or only the first section.',
      severity: 'low', evidence: 'unknown', score: 35,
      action: 'Verify the complete menu and expose categories or a dedicated menu page if content exists elsewhere.',
      source: 'Website scan',
    });
  }

  if (!profile.logoUrl) {
    findings.push({
      id: 'brand-asset',
      title: 'No clear logo asset was detected',
      description: 'The website did not expose a clear logo or wordmark asset in common metadata or image markup.',
      severity: 'low', evidence: 'verified', score: 20,
      action: 'Add a canonical logo or wordmark with descriptive alt text and consistent brand metadata.',
      source: 'Website scan',
    });
  }

  if (hours.length === 0) {
    findings.push({
      id: 'opening-hours',
      title: 'Opening hours were not verified',
      description: 'No structured or text-based opening hours were detected on the scanned page.',
      severity: 'medium', evidence: 'unknown', score: 30,
      action: 'Publish current opening hours in structured and customer-visible form.',
      source: 'Website scan',
    });
  }

  if (context.rating !== null && context.rating !== undefined) {
    const rating = Number(context.rating);
    if (Number.isFinite(rating) && rating < 4) {
      findings.push({
        id: 'rating-pressure',
        title: 'Public rating is below 4.0',
        description: 'The supplied rating is ' + rating.toFixed(1) + '. The rating is treated as verified only when it comes from the connected review source; this audit does not infer why it is low.',
        severity: rating < 3.5 ? 'high' : 'medium', evidence: 'strong_evidence',
        score: Math.round((4 - rating) * 20),
        action: 'Connect review intelligence and identify recurring customer complaints before changing the offer.',
        source: 'Connected review source',
      });
    }
  }

  if (context.competitorCount !== null && context.competitorCount !== undefined) {
    const competitorCount = Number(context.competitorCount);
    const competitorAverage = Number(context.competitorAverageRating);
    const rating = Number(context.rating);
    if (Number.isFinite(competitorAverage) && Number.isFinite(rating) && rating + 0.3 < competitorAverage) {
      findings.push({
        id: 'competitive-rating-gap',
        title: 'Observed rating gap versus tracked competitors',
        description: 'Tracked competitors average ' + competitorAverage.toFixed(1) + ' versus ' + rating.toFixed(1) + ' for this restaurant.',
        severity: 'medium', evidence: 'strong_evidence', score: 45,
        action: 'Investigate the review themes and customer journey differences before changing the offer.',
        source: competitorCount + ' tracked competitors',
      });
    }
  }

  findings.sort((a, b) => b.score - a.score);
  const penalty = findings.reduce((sum, finding) => sum + Math.min(22, finding.score * 0.22), 0);
  const readinessScore = Math.round(clamp(100 - penalty, 12, 96));
  const readinessLabel = readinessScore >= 75 ? 'Strong foundation' : readinessScore >= 50 ? 'Needs work' : 'Significant leakage candidates';

  const evidenceNotes = [
    'This scan reports observable evidence and explicit unknowns. It does not estimate revenue without commercial data.',
    'A hypothesis is not treated as a verified customer problem.',
    'Connecting review, competitor, order and booking data unlocks a stronger revenue attribution layer.',
  ];
  if (context.reviewCount === null || context.reviewCount === undefined) {
    evidenceNotes.push('Review count and rating were not supplied to this scan; no rating conclusion was invented.');
  }

  return {
    readinessScore,
    readinessLabel,
    findings: findings.slice(0, 8),
    menuPreview: menuItems.slice(0, 8),
    evidenceNotes,
    profile: {
      brandName: profile.brandName,
      tagline: profile.tagline,
      confidence: profile.confidence,
      hasLogo: Boolean(profile.logoUrl),
      hasHours: hours.length > 0,
      menuItems: menuItems.length,
      pricedItems: pricedItems.length,
      describedItems: describedItems.length,
    },
  };
}

export function isSafePublicAuditUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    if (url.port && !['80', '443'].includes(url.port)) return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.test') || hostname.endsWith('.invalid')) return false;
    if (/^127\./.test(hostname) || hostname === '0.0.0.0' || hostname === '::1' || /^10\./.test(hostname)) return false;
    if (/^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) return false;
    const private172 = hostname.match(/^172\.(\d{1,3})\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return hostname.length > 0 && hostname.includes('.');
  } catch {
    return false;
  }
}