export type ScoreContribution = {
  rule: string;
  value: number;
  note?: string;
};

export type ScoreTraceSnapshot = {
  total: number;
  contributions: ScoreContribution[];
};

export type ScoreBreakdown = ScoreTraceSnapshot;

export class ScoreTrace {
  private totalValue = 0;
  private readonly entries: ScoreContribution[] = [];

  add(rule: string, value: number, note?: string) {
    if (!Number.isFinite(value) || value === 0) {
      return this;
    }

    this.totalValue += value;
    this.entries.push(note ? { rule, value, note } : { rule, value });
    return this;
  }

  total() {
    return this.totalValue;
  }

  snapshot(): ScoreTraceSnapshot {
    return {
      total: this.totalValue,
      contributions: [...this.entries],
    };
  }
}
