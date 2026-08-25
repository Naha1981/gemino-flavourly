import {
  summarizeDailySeries,
  buildOverview,
  forecastRevenue,
  cohortRetention,
  type PlatformOverview,
  type RevenueForecast,
  type CohortRow,
  type EngineSummary,
  type DailyPoint,
} from './engine';
import { fetchAllEngineSeries } from './store';

export interface TenantAnalytics {
  overview: PlatformOverview;
  forecast: RevenueForecast;
  cohorts: CohortRow[];
  series: {
    revenue: DailyPoint[];
    operations: DailyPoint[];
    reputation: DailyPoint[];
    market: DailyPoint[];
    marketing: DailyPoint[];
  };
}

/**
 * Assemble every analytics view for one tenant. The store supplies raw,
 * tenant-scoped series; the engine reduces them to KPIs, a 30-day revenue
 * forecast and customer cohorts. One function, called by every analytics
 * route so the six engines are always computed the same way.
 */
export async function buildTenantAnalytics(tenantId: string): Promise<TenantAnalytics> {
  const s = await fetchAllEngineSeries(tenantId);
  const cohorts = cohortRetention(s.cohorts);

  const customerSeries: DailyPoint[] = cohorts.map((c) => ({
    date: `${c.cohortMonth}-01`,
    value: c.cohortSize,
  }));

  const summaries: EngineSummary[] = [
    summarizeDailySeries('revenue', s.revenue),
    summarizeDailySeries('operations', s.operations),
    summarizeDailySeries('customers', customerSeries),
    summarizeDailySeries('reputation', s.reputation),
    summarizeDailySeries('market', s.market),
    summarizeDailySeries('marketing', s.marketing),
  ];

  return {
    overview: buildOverview(summaries),
    forecast: forecastRevenue(s.revenue.map((p) => p.value), 30),
    cohorts,
    series: {
      revenue: s.revenue,
      operations: s.operations,
      reputation: s.reputation,
      market: s.market,
      marketing: s.marketing,
    },
  };
}

export function findSummary(analytics: TenantAnalytics, engine: string): EngineSummary | undefined {
  return analytics.overview.engines.find((e) => e.engine === engine);
}
