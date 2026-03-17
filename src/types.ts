export interface Source {
  id: string;
  title: string;
  url: string;
  type: 'Primary' | 'Secondary' | 'Archive' | 'Other';
  addedAt: string;
  notes?: string;
}

export interface Node {
  node_id: string;
  node_type: 'Person' | 'Institution' | 'Document' | 'Event' | 'Financial' | 'Gap';
  status: 'verified' | 'unverified' | 'gap' | 'incomplete' | 'contested';
  label: string;
  description: string;
  citation: string | null;
  citation_url?: string;
  citation_type: 'primary' | 'secondary' | 'none';
  gap_reasoning?: {
    why_should_exist: string;
    where_specifically: string;
  };
  expected_location?: string;
  research_preview?: string;
  raw_result?: string;
  weight?: number;
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
  subject: string;
  body: string;
  type: 'FOIA' | 'Archival' | 'Institutional';
  status: 'Draft' | 'Pending' | 'Sent';
  createdAt: string;
}

export interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
  timestamp: string;
}

export interface InvestigationItem {
  id: string;
  name: string;
  type: 'Institution' | 'Person' | 'Location' | 'Record Group' | 'Other';
  status: 'Pending' | 'In Progress' | 'Completed' | 'Blocked';
  priority: 'High' | 'Medium' | 'Low';
  notes: string;
  searchQuery?: string;
  createdAt: string;
}

export interface ResearchResponse {
  neutralized: {
    neutralized_claim: string;
    testable_form: string;
    evidence_categories: string[];
  };
  blueprint: {
    checklist: any[];
  };
  results: Node[];
  bridges: {
    bridge_candidates: BridgeCandidate[];
  };
}
