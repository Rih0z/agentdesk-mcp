export interface ReviewResult {
  verdict: 'PASS' | 'FAIL' | 'CONDITIONAL_PASS'
  score: number
  issues: ReviewIssue[]
  checklist: ChecklistItem[]
  summary: string
  reviewer_model: string
}

export interface ReviewIssue {
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  description: string
  suggestion: string
}

export interface ChecklistItem {
  item: string
  status: 'pass' | 'fail'
  evidence: string
}
