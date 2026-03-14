import type { Issue } from 'stet';

export interface IssueRange {
  start: number;
  end: number;
}

export function resolveIssueRange(text: string, issue: Issue, searchWindow = 24): IssueRange | null {
  const fallbackLength = issue.originalText?.length || issue.length;
  const directMatch = text.slice(issue.offset, issue.offset + fallbackLength);

  if (issue.originalText && directMatch === issue.originalText) {
    return { start: issue.offset, end: issue.offset + issue.originalText.length };
  }

  if (!issue.originalText && issue.length > 0) {
    return { start: issue.offset, end: issue.offset + issue.length };
  }

  if (issue.originalText) {
    const nearest = findNearestExactMatch(text, issue.originalText, issue.offset, searchWindow);
    if (nearest !== null) {
      return { start: nearest, end: nearest + issue.originalText.length };
    }
  }

  if (issue.length > 0 && issue.offset >= 0 && issue.offset < text.length) {
    return { start: issue.offset, end: Math.min(text.length, issue.offset + issue.length) };
  }

  return null;
}

export function resolveIssueApplyRange(text: string, issue: Issue, searchWindow = 24): IssueRange | null {
  const applyEndOffset = getIssueMetaNumber(issue, 'applyEndOffset');
  const applyLength = getIssueMetaNumber(issue, 'applyLength');
  const resolvedApplyLength = applyEndOffset !== null
    ? applyEndOffset - issue.offset
    : applyLength;

  if (resolvedApplyLength === null || resolvedApplyLength <= 0) {
    return resolveIssueRange(text, issue, searchWindow);
  }

  if (issue.originalText) {
    const directMatch = text.slice(issue.offset, issue.offset + issue.originalText.length);
    if (directMatch === issue.originalText) {
      return {
        start: issue.offset,
        end: Math.min(text.length, issue.offset + resolvedApplyLength),
      };
    }

    const nearest = findNearestExactMatch(text, issue.originalText, issue.offset, searchWindow);
    if (nearest !== null) {
      return {
        start: nearest,
        end: Math.min(text.length, nearest + resolvedApplyLength),
      };
    }
  }

  const annotationRange = resolveIssueRange(text, issue, searchWindow);
  if (annotationRange) {
    return {
      start: annotationRange.start,
      end: Math.min(text.length, annotationRange.start + resolvedApplyLength),
    };
  }

  if (issue.offset >= 0 && issue.offset < text.length) {
    return {
      start: issue.offset,
      end: Math.min(text.length, issue.offset + resolvedApplyLength),
    };
  }

  return null;
}

function findNearestExactMatch(
  text: string,
  query: string,
  expectedOffset: number,
  searchWindow: number,
): number | null {
  const start = Math.max(0, expectedOffset - searchWindow);
  const end = Math.min(text.length, expectedOffset + searchWindow + query.length);
  const haystack = text.slice(start, end);

  let bestIndex: number | null = null;
  let fromIndex = 0;

  while (fromIndex < haystack.length) {
    const matchIndex = haystack.indexOf(query, fromIndex);
    if (matchIndex === -1) break;

    const absoluteIndex = start + matchIndex;
    if (
      bestIndex === null ||
      Math.abs(absoluteIndex - expectedOffset) < Math.abs(bestIndex - expectedOffset)
    ) {
      bestIndex = absoluteIndex;
    }

    fromIndex = matchIndex + 1;
  }

  return bestIndex;
}

function getIssueMetaNumber(issue: Issue, key: string): number | null {
  const value = issue.meta?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
