import {
  calculateCustomerSegment,
  type CustomerProfileForSegmentation,
  type CustomerSegment,
} from './segmentation';

export interface SegmentationProfile extends CustomerProfileForSegmentation {
  id: string;
  tenantId?: string;
}

export interface CustomerSegmentationStore {
  /** Return only tenant ids the caller is allowed to scan. */
  findTenantIds(): Promise<string[]>;
  fetchProfilesForSegmentation(tenantId: string): Promise<SegmentationProfile[]>;
  /** Returns true when a row was changed, false when its segment was unchanged. */
  updateSegment(profileId: string, segment: CustomerSegment, confidence: number): Promise<boolean>;
}

export interface CustomerSegmentationCronOptions {
  now?: Date;
}

export interface CustomerSegmentationCronSummary {
  tenantsChecked: number;
  profilesScanned: number;
  segmentsUpdated: number;
  failed: number;
  samples: Array<{
    profileId: string;
    tenantId: string;
    segment: CustomerSegment;
    confidence: number;
  }>;
}

/**
 * Recalculate every profile for every tenant. The tenant id is carried by the
 * outer loop rather than inferred from a profile's phone number, so identical
 * phone numbers in two restaurants remain independent customers.
 */
export async function runCustomerSegmentationCron(
  store: CustomerSegmentationStore,
  options: CustomerSegmentationCronOptions = {}
): Promise<CustomerSegmentationCronSummary> {
  const now = options.now ?? new Date();
  const tenantIds = await store.findTenantIds();
  const summary: CustomerSegmentationCronSummary = {
    tenantsChecked: tenantIds.length,
    profilesScanned: 0,
    segmentsUpdated: 0,
    failed: 0,
    samples: [],
  };

  for (const tenantId of tenantIds) {
    let profiles: SegmentationProfile[];
    try {
      profiles = await store.fetchProfilesForSegmentation(tenantId);
    } catch (err) {
      summary.failed += 1;
      console.error(`[Customer Segmentation] Failed to fetch profiles for tenant ${tenantId}`, err);
      continue;
    }

    summary.profilesScanned += profiles.length;
    for (const profile of profiles) {
      // A store implementation must return profiles for the tenant it was
      // asked for. Keep this check as defense in depth for adapters and tests
      // that use an in-memory implementation.
      if (profile.tenantId && profile.tenantId !== tenantId) {
        summary.failed += 1;
        console.error(
          `[Customer Segmentation] Refusing profile ${profile.id} returned for tenant ${profile.tenantId} while scanning ${tenantId}`
        );
        continue;
      }

      const result = calculateCustomerSegment(profile, { now });
      try {
        const changed = await store.updateSegment(profile.id, result.segment, result.confidence);
        if (!changed) continue;
        summary.segmentsUpdated += 1;
        if (summary.samples.length < 5) {
          summary.samples.push({
            profileId: profile.id,
            tenantId,
            segment: result.segment,
            confidence: result.confidence,
          });
        }
      } catch (err) {
        summary.failed += 1;
        console.error(`[Customer Segmentation] Failed to update profile ${profile.id}`, err);
      }
    }
  }

  return summary;
}
