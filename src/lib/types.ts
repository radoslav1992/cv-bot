/** Shared CV domain types. Kept plain-JSON so the whole document can travel
 *  between the browser (localStorage) and the Worker in a single request. */

export interface CVExperience {
  id: string;
  role: string;
  company: string;
  period: string;
  location?: string;
  bullets: string[];
}

export interface CVEducation {
  id: string;
  degree: string;
  school: string;
  period: string;
  note?: string;
}

export interface CVProject {
  id: string;
  name: string;
  description: string;
  link?: string;
}

export interface CVLanguage {
  name: string;
  level: string;
}

export interface CVContact {
  name: string;
  title: string;
  city: string;
  email: string;
  phone: string;
  links: string[];
}

export interface TargetJob {
  title: string;
  company: string;
  description: string;
}

export interface CV {
  id: string;
  /** Document name shown in „Моите CV-та“. */
  name: string;
  lang: 'bg' | 'en';
  createdAt: string;
  updatedAt: string;
  contact: CVContact;
  summary: string;
  experience: CVExperience[];
  education: CVEducation[];
  skills: string[];
  languages: CVLanguage[];
  projects: CVProject[];
  certificates: string[];
  targetJob?: TargetJob;
  coverLetter?: string;
  /** Set when the CV came from an uploaded file — feeds the format score. */
  sourceFormatFlags?: FormatFlags;
}

export interface FormatFlags {
  hasTables?: boolean;
  hasImages?: boolean;
  hasColumns?: boolean;
  hasHeaderFooter?: boolean;
  pages?: number;
}

export type Severity = 'good' | 'warn' | 'bad';

export interface Finding {
  id: string;
  severity: Severity;
  /** Points the CV would gain by acting on this finding. */
  points: number;
  text: string;
}

export interface ScoreDimensions {
  structure: number;
  keywords: number;
  impact: number;
  readability: number;
  format: number;
}

export interface AtsReport {
  total: number;
  dimensions: ScoreDimensions;
  findings: Finding[];
  matchedKeywords: string[];
  missingKeywords: string[];
  label: string;
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Tool activity rendered as a small chip under the bot bubble. */
  actions?: string[];
}

export interface Application {
  id: string;
  company: string;
  position: string;
  status: 'draft' | 'sent' | 'waiting' | 'interview' | 'offer' | 'rejected';
  date: string;
  cvId?: string;
  note?: string;
}
