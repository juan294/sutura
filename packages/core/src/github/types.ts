import type { CaseFile } from '../domain.js';

export interface WorkflowRunRecord {
  id: number;
  headSha: string;
  repository: string;
  event: string;
  conclusion: string | null;
  headBranch?: string | null;
  pullRequests: Array<{ number: number }>;
}

export interface PullRequestRecord {
  number: number;
  headSha: string;
  headRef: string;
  headRepo: string | null;
  baseSha: string;
  baseRef: string;
}

export interface WorkflowJobStep {
  name: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowJobRecord {
  id: number;
  name: string;
  conclusion: string | null;
  steps: WorkflowJobStep[];
}

export interface CheckAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: 'notice' | 'warning' | 'failure';
  title: string;
  message: string;
}

export interface GitHubApi {
  getWorkflowRun(runId: number): Promise<WorkflowRunRecord>;
  listPullRequestsForCommit(sha: string): Promise<Array<{ number: number }>>;
  getPullRequest(number: number): Promise<PullRequestRecord>;
  listJobsForWorkflowRun(runId: number): Promise<WorkflowJobRecord[]>;
  downloadJobLogs(jobId: number): Promise<string>;
  listIssueComments(issueNumber: number): Promise<Array<{ id: number; body: string | null; authorLogin: string | null }>>;
  listCommitComments(sha: string): Promise<Array<{ id: number; body: string | null; authorLogin: string | null }>>;
  createRef(ref: string, sha: string): Promise<void>;
  deleteRef(ref: string): Promise<void>;
  createIssueComment(issueNumber: number, body: string): Promise<{ id: number }>;
  createCommitComment(sha: string, body: string): Promise<{ id: number }>;
  updateIssueComment(commentId: number, body: string): Promise<void>;
  updateCommitComment(commentId: number, body: string): Promise<void>;
  getRefSha(ref: string): Promise<string>;
  getCommitParents(sha: string): Promise<string[]>;
  getCommitSha(sha: string): Promise<string>;
  createPullRequest(input: { title: string; head: string; base: string; body: string }): Promise<{ number: number; url: string }>;
  listCheckRunsForRef(ref: string): Promise<Array<{
    id: number; headSha: string; externalId: string | null; name: string;
    status: string; conclusion: string | null;
  }>>;
  createCheckRun(input: {
    name: string; headSha: string; externalId: string; status: 'in_progress';
    title: string; summary: string;
  }): Promise<{ id: number }>;
  updateCheckRun(input: {
    checkRunId: number; status: 'completed'; conclusion: 'neutral' | 'action_required';
    detailsUrl?: string; title: string; summary: string; annotations: CheckAnnotation[];
  }): Promise<void>;
}

export interface TextArtifactPort {
  uploadTextArtifact(
    name: string,
    content: string,
    extension: 'html' | 'json',
  ): Promise<{ url: string }>;
}

export interface GitHubAdapterOptions {
  owner: string;
  repo: string;
  runId: string;
  artifact?: TextArtifactPort;
}

export interface GitHubCheckOutput {
  title: string;
  summary: string;
  conclusion: 'neutral' | 'action_required';
  annotations: CheckAnnotation[];
  caseFile: CaseFile;
}
