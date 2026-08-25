export interface BriefIdea {
  topic: string;
  audience: string;
  message: string;
  cta: string;
  visual: string;
}

export interface DailyBriefInput {
  restaurantName: string;
  slowDays?: Array<{ day: string; recommendation?: string; currentBookings?: number }>;
  events?: Array<{ eventName: string; eventDate: string; suggestion?: string }>;
  opportunities?: Array<{ title: string; description: string }>;
  reviewThemes?: string[];
}

export interface DailyBrief {
  date: string;
  summary: string;
  ideas: BriefIdea[];
  signals: { slowDays: number; events: number; opportunities: number; reviewThemes: number };
}

export function generateDailyBrief(input: DailyBriefInput, now = new Date()): DailyBrief {
  const ideas: BriefIdea[] = [];
  const slowDay = input.slowDays?.[0];
  const event = input.events?.[0];
  const opportunity = input.opportunities?.[0];
  const reviewTheme = input.reviewThemes?.[0];

  if (slowDay) {
    ideas.push({
      topic: `${slowDay.day} booking boost`,
      audience: 'Local diners planning their week',
      message: `${input.restaurantName} has space on ${slowDay.day}. Make it the easy choice with a timely reason to visit.`,
      cta: `Book a table for ${slowDay.day}`,
      visual: 'A bright table setting with the weekday offer overlaid',
    });
  }
  if (event) {
    ideas.push({
      topic: event.eventName,
      audience: 'Guests looking for a reason to celebrate',
      message: event.suggestion ?? `Celebrate ${event.eventName} at ${input.restaurantName}.`,
      cta: 'Reserve your celebration table',
      visual: 'A close-up of a signature dish styled for the occasion',
    });
  }
  if (opportunity) {
    ideas.push({
      topic: opportunity.title,
      audience: 'Guests searching for something new nearby',
      message: opportunity.description,
      cta: 'Discover the menu',
      visual: 'A simple carousel of the relevant dish or experience',
    });
  }
  if (reviewTheme) {
    ideas.push({
      topic: 'Guest favourite',
      audience: 'Existing followers and recent guests',
      message: `Guests keep mentioning ${reviewTheme}. Put that experience at the centre of today’s story.`,
      cta: 'Come taste it yourself',
      visual: 'A candid guest-approved detail or staff recommendation',
    });
  }
  while (ideas.length < 3) {
    ideas.push({
      topic: ideas.length === 0 ? 'Behind the scenes' : 'Signature experience',
      audience: 'Your local community',
      message: `${input.restaurantName} is ready to make an ordinary meal feel memorable.`,
      cta: 'Plan your visit',
      visual: 'Natural light, human hands, and the venue in action',
    });
  }

  return {
    date: now.toISOString().slice(0, 10),
    summary: `A practical content plan for ${input.restaurantName}, shaped by demand, local moments, market gaps, and guest feedback.`,
    ideas: ideas.slice(0, 5),
    signals: {
      slowDays: input.slowDays?.length ?? 0,
      events: input.events?.length ?? 0,
      opportunities: input.opportunities?.length ?? 0,
      reviewThemes: input.reviewThemes?.length ?? 0,
    },
  };
}