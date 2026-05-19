export interface PRRecord {
  number: number;
  title: string;
  author: string;
  authorName: string;
  repo: string;
  mergedAt: string;
  url: string;
}

export interface PRStats {
  prs: PRRecord[];
  totalPRs: number;
  contributors: string[];
  activeDays: number;
  dateRange: { from: string; to: string };
}
