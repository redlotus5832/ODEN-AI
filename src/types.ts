export interface Source {
  id: string;
  title: string;
  url: string;
  type: 'Primary' | 'Secondary' | 'Archive' | 'Upload' | 'Other';
  classification?: string;
  institution?: string;
  institution_normalized?: string;
  department?: string;
  physical_location?: string;
  content_summary?: string;
  relevance_explanation?: string;
  addedAt: string;
  notes?: string;
  content?: string;
}

export interface EvidenceRecord {
  record_id: string;
  record_type: 'Person' | 'Institution' | 'Document' | 'Event' | 'Financial' | 'Gap' | 'Location' | 'Record Group' | 'Artifact' | 'Communication' | 'Policy' | 'Other';
  status: 'verified' | 'unverified' | 'gap' | 'incomplete' | 'contested';
  classification?: 'verified' | 'unverified' | 'contested' | 'gap';
  label: string;
  description: string;
  observed_content?: string;
  why_it_matters?: string;
  connection_logic?: string;
  significance?: string;
  impact?: 'Supports' | 'Weakens' | 'Complicates' | 'Leaves Open';
  strength?: 'Strong' | 'Weak' | 'Noise';
  suggestions?: string;
  missing_verification?: string;
  citation: string | null;
  citation_url?: string;
  citation_type: 'primary' | 'secondary' | 'none';
  institution_normalized?: string;
  gap_reasoning?: {
    why_should_exist: string;
    where_specifically: string;
    institutional_process?: string;
  };
  expected_location?: string;
  research_preview?: string;
  raw_result?: string;
  weight?: number;
  entities?: string[];
  related_records?: string[];
  timeline_date?: string | null;
}

export interface Suggestions {
  bridges: { label: string; reason: string; records: string[] }[];
  gaps: { label: string; description: string }[];
  researchAreas: { title: string; description: string; priority: 'High' | 'Medium' | 'Low' }[];
  crossovers: { title: string; description: string; significance: string }[];
  entities: { name: string; type: string; relevance: string }[];
  anomalies: { title: string; description: string; impact: string }[];
  conflicts: { title: string; description: string; resolution: string }[];
  keyActors: { name: string; role: string; significance: string }[];
  methodologicalAdvice: { title: string; advice: string }[];
  institutionalGaps: { label: string; description: string }[];
  structuralAnomalies: { title: string; description: string }[];
  patternRecognition: { title: string; description: string }[];
  riskAssessment: { title: string; risk: string; mitigation: string }[];
  summary?: string;
}

export interface InvestigationItem {
  id: string;
  name: string;
  type: 'Institution' | 'Person' | 'Location' | 'Record Group' | 'Other' | 'Pattern' | 'Financial' | 'Policy';
  status: 'Pending' | 'In Progress' | 'Completed' | 'Blocked';
  priority: 'High' | 'Medium' | 'Low';
  explanation?: string;
  connection_to_pattern?: string;
  verification_needs?: string;
  supporting_sources?: string[];
  inference_type?: 'Direct' | 'Inferred';
  notes: string;
  searchQuery?: string;
  createdAt: string;
  isStrategistDiscovery?: boolean;
  discoveryReason?: string;
}

export interface Edge {
  source: string;
  target: string;
  label: string;
}

export interface SubClaim {
  id: string;
  claim: string;
  description: string;
}

export interface BridgeCandidate {
  entity: string;
  appears_in: string[];
  confidence: number;
}

export interface Request {
  id: string;
  title: string;
  recipient: string;
  institution_normalized: string;
  department?: string;
  subject: string;
  body: string;
  type: 'FOIA' | 'Archival' | 'Institutional';
  status: 'Draft' | 'Pending' | 'Sent';
  destination_email?: string;
  submission_portal?: string;
  mailing_address?: string;
  fingerprint: string;
  createdAt: string;
  verification_status?: 'Verified' | 'Unverified' | 'Guess';
  alternative_contacts?: { type: string; value: string }[];
  verification_source?: string;
}

export interface ResearchResponse {
  original_claim: string;
  sub_claims: SubClaim[];
  neutralized?: {
    neutralized_claim: string;
    testable_form: string;
    evidence_categories: string[];
  };
  blueprint?: {
    checklist: any[];
  };
  results: EvidenceRecord[];
  bridges: { label: string; reason: string; records: string[] }[];
  summary?: string;
  links?: Edge[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  entities?: string[];
  timestamp: string;
  citations?: { title: string; url: string; institution?: string }[];
  actions?: {
    type: 'add_log' | 'add_evidence' | 'add_request' | 'update_request' | 'update_evidence' | 'update_status' | 'analyze_log';
    label: string;
    data: any;
  }[];
}

export interface Investigation {
  id: string;
  title: string;
  ownerId: string;
  collaborators?: string[];
  collaboratorEmails?: string[];
  claim: string;
  data: ResearchResponse | null;
  chatMessages: ChatMessage[];
  requests: Request[];
  sources: Source[];
  researchPoints: InvestigationItem[];
  suggestions: Suggestions;
  updatedAt: any;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  investigationIds?: string[];
}
