export interface EventOpportunity {
  key: string;
  opportunityType: string;
  title: string;
  description: string;
  confidence: number;
  evidence: string[];
}

const KNOWN_EVENTS: Array<{
  name: string;
  month: number;
  day: number;
  description: string;
  evidence: string[];
}> = [
  { name: "Valentine's Day", month: 2, day: 14, description: "Couples dinner promotion", evidence: ['Fixed calendar date', 'High restaurant relevance'] },
  { name: 'Mother\'s Day', month: 5, day: 10, description: 'Family celebration', evidence: ['Fixed calendar date', 'High restaurant relevance'] },
  { name: 'Father\'s Day', month: 6, day: 15, description: 'Family dining', evidence: ['Fixed calendar date', 'High restaurant relevance'] },
  { name: 'New Year\'s Eve', month: 12, day: 31, description: 'Celebration dinner', evidence: ['Fixed calendar date', 'High restaurant relevance'] },
  { name: 'Christmas Day', month: 12, day: 25, description: 'Holiday dining', evidence: ['Fixed calendar date', 'High restaurant relevance'] },
  { name: 'Easter Weekend', month: 4, day: 18, description: 'Long weekend dining', evidence: ['Fixed calendar date', 'High restaurant relevance'] },
  { name: 'Heritage Day', month: 9, day: 24, description: 'South African cultural celebration', evidence: ['Fixed calendar date', 'Local public holiday'] },
  { name: 'Freedom Day', month: 4, day: 27, description: 'South African public holiday', evidence: ['Fixed calendar date', 'Local public holiday'] },
  { name: 'Worker\'s Day', month: 5, day: 1, description: 'South African public holiday', evidence: ['Fixed calendar date', 'Local public holiday'] },
  { name: 'Youth Day', month: 6, day: 16, description: 'South African public holiday', evidence: ['Fixed calendar date', 'Local public holiday'] },
  { name: 'Women\'s Day', month: 8, day: 9, description: 'South African public holiday', evidence: ['Fixed calendar date', 'Local public holiday'] },
  { name: 'Reconciliation Day', month: 12, day: 16, description: 'South African public holiday', evidence: ['Fixed calendar date', 'Local public holiday'] },
];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function detectEventOpportunities(tenantId: string, now = new Date()): EventOpportunity[] {
  const today = startOfDay(now);
  const windowEnd = addDays(today, 30);
  const year = today.getFullYear();

  return KNOWN_EVENTS
    .map((evt) => {
      const eventDate = new Date(year, evt.month - 1, evt.day);
      if (eventDate < today || eventDate > windowEnd) return null;
      return {
        key: `event:${evt.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}:${year}`,
        opportunityType: 'event',
        title: `${evt.name} promotion`,
        description: evt.description,
        confidence: 1,
        evidence: evt.evidence,
      };
    })
    .filter((opt): opt is EventOpportunity => opt !== null);
}
