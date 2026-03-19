import React, { useState, useEffect, useRef } from 'react';
import { Search, Shield, Network, FileText, AlertCircle, CheckCircle2, HelpCircle, Loader2, ArrowRight, ChevronRight, ChevronDown, Info, Mail, Edit3, Trash2, Send, BookOpen, ExternalLink, List, History, Save, Download, Upload, Trash, LayoutGrid, Settings, Sparkles, X, Zap, AlertTriangle, Check, Filter, Plus, Compass, Brain, MessageSquare, Building2, ShieldAlert, Users, Cloud } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ResearchResponse, EvidenceRecord, BridgeCandidate, Request, Source, ChatMessage, InvestigationItem, SubClaim } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [researchStep, setResearchStep] = useState<number>(0);
  const [claim, setClaim] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'guide' | 'pipeline' | 'dossier' | 'list' | 'chat' | 'requests' | 'investigation' | 'suggestions' | 'document-sync'>('guide');
  const [prevTab, setPrevTab] = useState<typeof activeTab>('guide');
  const [isMobile, setIsMobile] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [viewingRecord, setViewingRecord] = useState<EvidenceRecord | null>(null);
  const [viewingSource, setViewingSource] = useState<Source | null>(null);

  const updateSource = (updatedSource: Source) => {
    setSources(prev => prev.map(s => s.id === updatedSource.id ? updatedSource : s));
    setEditingSource(null);
  };

  const addSource = (newSource: Source) => {
    setSources(prev => [newSource, ...prev]);
    setEditingSource(null);
  };

  const askAIAboutRecord = (record: EvidenceRecord) => {
    setChatInput(`Tell me more about this ${record.record_type}: "${record.label}". What specific primary sources should I look for to verify its details?`);
    setActiveTab('chat');
  };

  // Track previous tab for "Close" buttons
  useEffect(() => {
    if (activeTab !== 'suggestions' && activeTab !== 'document-sync') {
      setPrevTab(activeTab);
    }
  }, [activeTab]);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<EvidenceRecord | null>(null);
  const [editingRecord, setEditingRecord] = useState<EvidenceRecord | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [requests, setRequests] = useState<Request[]>([]);
  const [requestSearch, setRequestSearch] = useState('');
  const [editingRequest, setEditingRequest] = useState<Request | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [researchPoints, setResearchPoints] = useState<InvestigationItem[]>([]);
  const [editingResearchPoint, setEditingResearchPoint] = useState<InvestigationItem | null>(null);
  const [investigationFilter, setInvestigationFilter] = useState<'All' | 'High' | 'Medium' | 'Low'>('All');
  const [investigationSearch, setInvestigationSearch] = useState('');
  const [suggestions, setSuggestions] = useState<{ 
    bridges: any[], 
    gaps: any[],
    researchAreas: any[],
    crossovers: any[],
    entities: any[],
    anomalies: any[],
    conflicts: any[],
    keyActors: any[],
    methodologicalAdvice: any[],
    institutionalGaps: any[],
    structuralAnomalies: any[],
    patternRecognition: any[],
    riskAssessment: any[]
  }>({ 
    bridges: [], 
    gaps: [], 
    researchAreas: [], 
    crossovers: [], 
    entities: [], 
    anomalies: [], 
    conflicts: [], 
    keyActors: [], 
    methodologicalAdvice: [],
    institutionalGaps: [],
    structuralAnomalies: [],
    patternRecognition: [],
    riskAssessment: []
  });
  const [suggestionChatMessages, setSuggestionChatMessages] = useState<ChatMessage[]>([]);
  const [suggestionChatLoading, setSuggestionChatLoading] = useState(false);
  const [isAnalyzingSuggestions, setIsAnalyzingSuggestions] = useState(false);

  // Load from LocalStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('oden_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.data) setData(parsed.data);
        if (parsed.chatMessages) setChatMessages(parsed.chatMessages);
        if (parsed.requests) setRequests(parsed.requests);
        if (parsed.sources) setSources(parsed.sources);
        if (parsed.researchPoints) setResearchPoints(parsed.researchPoints);
        if (parsed.claim) setClaim(parsed.claim);
        if (parsed.suggestions) setSuggestions(parsed.suggestions);
      } catch (e) {
        console.error("Failed to load session", e);
      }
    }
  }, []);

  // Auto-save to LocalStorage
  useEffect(() => {
    const session = {
      data,
      chatMessages,
      requests,
      sources,
      researchPoints,
      claim,
      suggestions
    };
    localStorage.setItem('oden_session', JSON.stringify(session));
  }, [data, chatMessages, requests, sources, claim]);

  // Close sidebar on mobile by default
  useEffect(() => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, []);

  const [uploadedFiles, setUploadedFiles] = useState<{ name: string, content: string, type: string }[]>([]);
  const [isReportingError, setIsReportingError] = useState(false);
  
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'All' | 'Primary' | 'Secondary' | 'Archive' | 'Upload' | 'Other'>('All');

  const downloadChatLog = () => {
    const log = chatMessages.map(m => `[${new Date(m.timestamp).toLocaleString()}] ${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const blob = new Blob([log], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ODEN_Research_Log_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- Gemini AI Client-Side Logic ---
  
  const getGenAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API Key is missing. Please ensure it is configured in the environment.");
    }
    return new GoogleGenAI({ apiKey });
  };

  const runClaimScoper = async (claim: string) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a claim scoping specialist for the ODEN Research System. 
      Decompose the following complex claim into discrete, falsifiable, and independently researchable sub-claims.
      Complex Claim: "${claim}"
      
      The goal is to prevent cross-contamination by ensuring each sub-claim can be investigated in its own independent thread.
      
      Output ONLY valid JSON: { "sub_claims": [{ "id": string, "claim": string, "description": string }] }.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sub_claims: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  claim: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["id", "claim", "description"],
              },
            },
          },
          required: ["sub_claims"],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const runNeutralizer = async (claim: string) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a claim neutralizer for the ODEN Research System. Strip all emotional, political, and narrative framing from the input claim. 
      Input claim: "${claim}"
      
      Use Google Search to understand any historical or institutional context if needed.
      
      Output ONLY valid JSON: { "neutralized_claim": string, "testable_form": string, "evidence_categories": string[] }. 
      The testable_form must be a falsifiable statement of institutional or physical fact.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            neutralized_claim: { type: Type.STRING },
            testable_form: { type: Type.STRING },
            evidence_categories: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["neutralized_claim", "testable_form", "evidence_categories"],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const runBlueprint = async (testableForm: string) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a structural evidence mapper for the ODEN Research System. Given a neutralized research claim, generate the institutional evidence checklist — the complete list of record types, documents, communications, and physical traces that must exist if this claim is structurally true. 
      Testable form: "${testableForm}"
      
      Use Google Search to identify relevant archives, government agencies, or record-keeping bodies.
      
      Output ONLY valid JSON: { "checklist": [{ "item_id": string, "description": string, "expected_location": string, "priority": "high" | "medium" | "low" }] }.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            checklist: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  item_id: { type: Type.STRING },
                  description: { type: Type.STRING },
                  expected_location: { type: Type.STRING },
                  priority: { type: Type.STRING, enum: ["high", "medium", "low"] },
                },
                required: ["item_id", "description", "expected_location", "priority"],
              },
            },
          },
          required: ["checklist"],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const runResearcher = async (item: any, uploadedFiles: { name: string, content: string }[]) => {
    const genAI = getGenAI();
    const filesContext = uploadedFiles && uploadedFiles.length > 0
      ? `USER UPLOADED NOTES/DOCUMENTS:\n${uploadedFiles.map((f: any) => `FILE: ${f.name}\nCONTENT: ${f.content}`).join('\n\n')}\n\n`
      : '';      const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { parts: [{ text: `You are an ODEN Primary Source Researcher. Your task is to investigate a specific checklist item strictly against primary sources and user-provided data.
      
      ITEM TO RESEARCH:
      ID: ${item.item_id}
      Description: ${item.description}
      Expected Institutional Location: ${item.expected_location}
      
      ${filesContext}
      
      METHODOLOGY CONSTRAINTS:
      1. PRIMARY SOURCES ONLY for verification: original documents, institutional records, physical evidence, direct testimony.
      2. USER UPLOADED DATA: If the user has provided notes or documents that directly confirm or refute this item, prioritize them as primary source evidence.
      3. SECONDARY SOURCES (Wikipedia, news accounts, documentaries, academic reconstructions) DO NOT qualify as verification. They only inform the search.
      4. NO INFERENCE: Do not connect dots. Report only what is explicitly documented.
      5. ENTITY RECOGNITION: Identify all specific people, organizations, agencies, departments, locations, and dates mentioned in the sources.
      6. URL EXTRACTION: If the research reveals specific URLs to archival finding aids, digital records, or institutional portals, include them.
      
      Use Google Search to find the specific record at the expected location. Search for archival finding aids, record group descriptions, or digital repositories.
      
      Output ONLY valid JSON: { "item_id": string, "source_found": boolean, "source_type": "primary" | "secondary" | "none", "citation": string | null, "citation_url": string | null, "raw_result": string, "timeline_date": string | null, "research_preview": string, "entities": string[] }.` }] }
      ],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            item_id: { type: Type.STRING },
            source_found: { type: Type.BOOLEAN },
            source_type: { type: Type.STRING, enum: ["primary", "secondary", "none"] },
            citation: { type: Type.STRING, nullable: true },
            citation_url: { type: Type.STRING, nullable: true },
            raw_result: { type: Type.STRING },
            timeline_date: { type: Type.STRING, nullable: true },
            research_preview: { type: Type.STRING },
            entities: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["item_id", "source_found", "source_type", "raw_result", "research_preview", "entities"],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const runDeepAnalysis = async (data: any, chatMessages: ChatMessage[]) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a Lead Investigator for the ODEN Research System. 
      Perform a deep structural analysis of the current research state.
      
      CURRENT RESEARCH DATA: ${JSON.stringify(data?.results?.map((n: any) => ({ id: n.record_id, label: n.label, status: n.status, description: n.description, type: n.record_type, entities: n.entities })) || [])}
      CONVERSATION HISTORY: ${JSON.stringify(chatMessages.slice(-10))}
      
      TASK:
      1. Identify "Structural Bridges": Entities or events that connect independent threads.
      2. Identify "Archival Gaps": Missing records that should exist by protocol or institutional logic.
      3. Suggest "Research Areas": New institutional domains or record groups to investigate based on current findings.
      4. Identify "Interesting Crossovers": Non-obvious patterns, coincidences, or recurring actors that warrant scrutiny.
      5. Identify "Institutional Entities": Key organizations, agencies, or departments that appear central to the narrative.
      6. Detect "Timeline Anomalies": Dates, sequences, or durations that seem out of order, structurally impossible, or historically inconsistent.
      7. Identify "Evidence Conflicts": Contradictory records or conflicting accounts that need reconciliation.
      8. Identify "Key Actors": Central figures in the investigation, their roles, and potential motivations.
      9. Provide "Methodological Advice": Strategic suggestions on how to improve the current research process or documentation.
      10. Identify "Institutional Gaps": Missing links in the chain of command or process.
      11. Identify "Structural Anomalies": Data points that violate institutional protocols.
      12. Identify "Pattern Recognition": Recurring motifs or procedural behaviors.
      13. Provide "Risk Assessment": Potential pitfalls or areas of high uncertainty.
      
      Output ONLY valid JSON: {
        "bridges": [{ "label": string, "reason": string, "records": string[] }],
        "gaps": [{ "label": string, "description": string, "record_id": string | null }],
        "researchAreas": [{ "title": string, "description": string, "priority": "High" | "Medium" | "Low" }],
        "crossovers": [{ "title": string, "description": string, "significance": string }],
        "entities": [{ "name": string, "type": string, "relevance": string }],
        "anomalies": [{ "title": string, "description": string, "impact": string }],
        "conflicts": [{ "title": string, "description": string, "resolution": string }],
        "keyActors": [{ "name": string, "role": string, "significance": string }],
        "methodologicalAdvice": [{ "title": string, "advice": string }],
        "institutionalGaps": [{ "label": string, "description": string }],
        "structuralAnomalies": [{ "title": string, "description": string }],
        "patternRecognition": [{ "title": string, "description": string }],
        "riskAssessment": [{ "title": string, "risk": string, "mitigation": string }]
      }.`,
      config: {
        responseMimeType: "application/json",
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const handleDeepAnalysis = async () => {
    if (!data) return;
    setIsAnalyzingSuggestions(true);
    try {
      const result = await runDeepAnalysis(data, chatMessages);
      setSuggestions({
        bridges: result.bridges || [],
        gaps: result.gaps || [],
        researchAreas: result.researchAreas || [],
        crossovers: result.crossovers || [],
        entities: result.entities || [],
        anomalies: result.anomalies || [],
        conflicts: result.conflicts || [],
        keyActors: result.keyActors || [],
        methodologicalAdvice: result.methodologicalAdvice || [],
        institutionalGaps: result.institutionalGaps || [],
        structuralAnomalies: result.structuralAnomalies || [],
        patternRecognition: result.patternRecognition || [],
        riskAssessment: result.riskAssessment || []
      });
    } catch (err: any) {
      console.error("Deep Analysis Error:", err);
      setError("Failed to run deep analysis: " + err.message);
    } finally {
      setIsAnalyzingSuggestions(false);
    }
  };

  const handleSuggestionChat = async (message: string) => {
    if (!message.trim()) return;
    const userMsg: ChatMessage = { role: 'user', content: message, timestamp: new Date().toISOString() };
    setSuggestionChatMessages(prev => [...prev, userMsg]);
    setSuggestionChatLoading(true);
    
    try {
      const genAI = getGenAI();
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are the ODEN Research Strategist. You are helping a researcher analyze their current findings and suggestions.
        
        CURRENT SUGGESTIONS: ${JSON.stringify(suggestions)}
        CURRENT DATA: ${JSON.stringify(data?.results?.map((r: any) => ({ label: r.label, status: r.status })) || []).slice(0, 1000)}
        CHAT HISTORY: ${JSON.stringify(suggestionChatMessages.slice(-5))}
        USER QUESTION: "${message}"
        
        Provide strategic advice, suggest new search queries, or help the researcher understand the structural significance of their findings. Keep it professional, analytical, and focused on institutional evidence. Use the term "record" instead of "card" or "node".`,
      });
      
      const aiMsg: ChatMessage = { role: 'ai', content: response.text || "I'm analyzing the data...", timestamp: new Date().toISOString() };
      setSuggestionChatMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      console.error("Suggestion Chat Error:", err);
    } finally {
      setSuggestionChatLoading(false);
    }
  };

  const runClassifier = async (results: any[]) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are an ODEN Evidence Classifier. Apply the four-state classification strictly based on structural research principles.
      
      RESEARCH RESULTS: ${JSON.stringify(results)}
      
      CLASSIFICATION LOGIC:
      - VERIFIED: These are discrete occurrences — a meeting, a transaction, a document being signed, a personnel appointment. They happened or they didn't. Verification status reflects whether a primary source directly records the event.
      - UNVERIFIED: Source exists but is secondary, contested, or indirect.
      - GAP: These are different in kind. A gap record is not a failed verified record. It is a structurally declared absence — a specific record type that institutional logic requires to exist, at a named location, that is not there. The gap IS the finding. Its absence is as meaningful as any verified record.
      - INCOMPLETE: Search returned no results but no structural expectation of existence has been established.
      - CONTESTED: Multiple primary sources exist but directly contradict each other on this specific evidence record.
      
      THE GAP TEST (Required for GAP status):
      1. Why should this evidence structurally exist? (Name the institutional protocol/process).
      2. Where specifically should it be? (Name the archive/record group/repository).
      
      If BOTH Gap Test questions cannot be answered substantively, you MUST output INCOMPLETE, not GAP.
      
      Output ONLY valid JSON: { "records": [{ "record_id": string, "status": "verified" | "unverified" | "gap" | "incomplete" | "contested", "label": string, "description": string, "gap_reasoning": { "why_should_exist": string, "where_specifically": string } | null }] }.
      CONSTRAINTS:
      - label: Max 3-5 words. Concise name for the record.
      - description: Max 15 words. Concise summary of the evidence or gap.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            records: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  record_id: { type: Type.STRING },
                  status: { type: Type.STRING, enum: ["verified", "unverified", "gap", "incomplete", "contested"] },
                  label: { type: Type.STRING },
                  description: { type: Type.STRING },
                  gap_reasoning: {
                    type: Type.OBJECT,
                    properties: {
                      why_should_exist: { type: Type.STRING },
                      where_specifically: { type: Type.STRING },
                    },
                    nullable: true,
                  },
                },
                required: ["record_id", "status", "label", "description"],
              },
            },
          },
          required: ["records"],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const runBridgeDetector = async (records: any[]) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a structural analyst for the ODEN Research System. 
      Perform a "Cross-Thread Bridge Record Scan" on the following evidence records.
      Each record belongs to an independent research thread (sub-claim).
      
      CONNECTION LOGIC:
      - VERIFIED records connect to other records through documented relationships: shared sources, shared institutions, shared date ranges, or direct personnel overlap.
      - GAP records connect to the central claim through the institutional logic that requires them. 
      - Connections between a GAP record and any other record should be treated as UNCONFIRMED until independent verification establishes it.
      
      Identify entities (people, institutions, locations) that appear across multiple independent threads.
      These are "Bridge Records" that suggest a structural nexus.
      
      Records: ${JSON.stringify(records)}
      
      Output ONLY valid JSON: { 
        "bridge_candidates": [{ "entity": string, "appears_in": string[], "confidence": number }],
        "links": [{ "source": string, "target": string, "label": string }]
      }.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bridge_candidates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  entity: { type: Type.STRING },
                  appears_in: { type: Type.ARRAY, items: { type: Type.STRING } },
                  confidence: { type: Type.NUMBER },
                },
                required: ["entity", "appears_in", "confidence"],
              },
            },
            links: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  source: { type: Type.STRING },
                  target: { type: Type.STRING },
                  label: { type: Type.STRING },
                },
                required: ["source", "target", "label"],
              },
            },
          },
          required: ["bridge_candidates", "links"],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const reportError = async (errorMessage: string) => {
    setIsReportingError(true);
    try {
      await fetch('/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: errorMessage,
          userEmail: 'Kyglass91@gmail.com', // As requested
          context: {
            claim,
            activeTab,
            recordCount: data?.results?.length || 0,
            timestamp: new Date().toISOString()
          }
        })
      });
      alert('Error reported to Kyglass91@gmail.com');
    } catch (e) {
      console.error("Failed to report error", e);
    } finally {
      setIsReportingError(false);
    }
  };

  const updateRecord = (updatedRecord: EvidenceRecord) => {
    if (!data) return;
    const newResults = data.results.map(n => n.record_id === updatedRecord.record_id ? updatedRecord : n);
    setData({ ...data, results: newResults });
    setEditingRecord(null);
    setSelectedRecord(updatedRecord);
  };

  const addManualRecord = () => {
    const newRecord: EvidenceRecord = {
      record_id: `manual-${Date.now()}`,
      record_type: 'Person',
      status: 'unverified',
      label: 'New Evidence Record',
      description: 'Manually added record.',
      citation: '',
      citation_url: '',
      citation_type: 'none',
      weight: 5
    };
    setData(prev => {
      if (!prev) return { 
        original_claim: claim || 'Manual Investigation',
        sub_claims: [],
        results: [newRecord], 
        links: [],
        bridges: { bridge_candidates: [] }
      };
      return { ...prev, results: [...prev.results, newRecord] };
    });
    setEditingRecord(newRecord);
  };

  const deleteRecord = (recordId: string) => {
    if (!data) return;
    const newResults = data.results.filter(n => n.record_id !== recordId);
    setData({ ...data, results: newResults });
    setSelectedRecord(null);
    setEditingRecord(null);
  };

  const [isParsing, setIsParsing] = useState(false);
  const [parsingProgress, setParsingProgress] = useState("");

  const parseUploadedDocument = async (fileName: string, content: string) => {
    setIsParsing(true);
    setParsingProgress(`Analyzing ${fileName}...`);
    try {
      const genAI = getGenAI();
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are an ODEN Document Parser. Analyze the following uploaded document and extract key intelligence.
        
        DOCUMENT NAME: ${fileName}
        CONTENT: ${content.slice(0, 15000)}
        
        TASK:
        1. Extract discrete evidence records (events, transactions, documents, communications).
        2. Identify ALL specific URLs, archival citations, or record group numbers mentioned.
        3. Identify key entities (people, organizations, agencies, departments).
        4. Identify structural gaps or missing information mentioned or implied.
        5. Generate potential investigation points for the log.
        6. Generate potential FOIA or Archival requests if the document mentions specific records that are not attached.
        
        Output ONLY valid JSON: {
          "records": [{ 
            "label": string, 
            "description": string, 
            "type": string, 
            "entities": string[], 
            "citations": string[],
            "urls": string[],
            "weight": number,
            "status": "verified" | "unverified" | "gap"
          }],
          "investigationPoints": [{
            "name": string,
            "type": "Institution" | "Person" | "Location" | "Record Group" | "Other",
            "priority": "High" | "Medium" | "Low",
            "notes": string,
            "searchQuery": string
          }],
          "requests": [{
            "title": string,
            "recipient": string,
            "subject": string,
            "body": string,
            "type": "FOIA" | "Archival" | "Institutional"
          }]
        }.`,
        config: {
          responseMimeType: "application/json",
        },
      });
      
      const result = JSON.parse(response.text || "{}");
      const timestamp = new Date().toISOString();

      if (result.records) {
        const newRecords: EvidenceRecord[] = result.records.map((r: any) => ({
          record_id: Math.random().toString(36).substr(2, 9),
          label: r.label,
          description: r.description,
          status: r.status || 'verified',
          record_type: r.type || 'Document',
          citation: r.citations?.join(', ') || `Uploaded: ${fileName}`,
          citation_url: r.urls?.[0] || '',
          entities: r.entities || [],
          weight: r.weight || 5,
          thread_id: 'upload-sync'
        }));
        
        setData(prev => {
          if (!prev) return { 
            original_claim: 'Document Analysis',
            sub_claims: [],
            results: newRecords, 
            bridges: { bridge_candidates: [] },
            links: []
          };
          return {
            ...prev,
            results: [...(prev.results || []), ...newRecords]
          };
        });
      }

      if (result.investigationPoints) {
        const newPoints = result.investigationPoints.map((p: any) => ({
          ...p,
          id: Math.random().toString(36).substr(2, 9),
          status: 'Pending',
          createdAt: timestamp
        }));
        setResearchPoints(prev => [...newPoints, ...prev]);
      }

      if (result.requests) {
        const newReqs = result.requests.map((r: any) => ({
          ...r,
          id: Math.random().toString(36).substr(2, 9),
          status: 'Draft',
          createdAt: timestamp
        }));
        setRequests(prev => [...newReqs, ...prev]);
      }

      setParsingProgress(`Successfully parsed ${fileName}`);
      setTimeout(() => {
        setIsParsing(false);
        setParsingProgress("");
      }, 2000);

    } catch (err) {
      console.error("Document Parsing Error:", err);
      setIsParsing(false);
      setParsingProgress("Error parsing document");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const content = event.target?.result as string;
        setUploadedFiles(prev => [...prev, { name: file.name, content, type: file.type }]);
        
        // Also add to sources as a local note
        const newSource: Source = {
          id: Math.random().toString(36).substr(2, 9),
          title: `Uploaded: ${file.name}`,
          url: 'Local File',
          type: 'Upload',
          addedAt: new Date().toISOString(),
          notes: `User uploaded file: ${file.name}`,
          content: content
        };
        setSources(prev => [newSource, ...prev]);
        
        // Parse the document for records
        await parseUploadedDocument(file.name, content);
      };
      reader.readAsText(file);
    });
  };

  const handleResearch = async () => {
    if (!claim.trim()) return;
    setLoading(true);
    setResearchStep(1);
    setError(null);
    setData(null);
    try {
      // Phase 1: Claim Scoping
      const scoping = await runClaimScoper(claim);
      const subClaims: SubClaim[] = scoping.sub_claims;
      
      let allClassifiedCards: EvidenceRecord[] = [];
      
      // Run pipeline for each sub-claim
      for (const subClaim of subClaims) {
        setResearchStep(2);
        // Phase 2: Neutralize
        const neutralized = await runNeutralizer(subClaim.claim);
        
        setResearchStep(3);
        // Phase 3: Blueprint
        const blueprint = await runBlueprint(neutralized.testable_form);
        
        setResearchStep(4);
        // Phase 4: Research
        const researchResults = [];
        for (const item of blueprint.checklist) {
          const result = await runResearcher(item, uploadedFiles);
          researchResults.push({ ...item, ...result });
        }
        
        setResearchStep(5);
        // Phase 5: Classify
        const classification = await runClassifier(researchResults);
        const classifiedCards: EvidenceRecord[] = researchResults.map(r => {
          const c = classification.records.find((n: any) => n.record_id === r.item_id);
          return { 
            record_id: r.item_id,
            record_type: r.source_type === 'primary' ? 'Document' : 'Event',
            status: c?.status || "incomplete", 
            label: c?.label || r.description,
            description: c?.description || r.research_preview,
            citation: r.citation,
            citation_url: r.citation_url,
            citation_type: r.source_type || 'none',
            gap_reasoning: c?.gap_reasoning,
            weight: r.priority === 'high' ? 3 : r.priority === 'medium' ? 2 : 1
          };
        });
        
        allClassifiedCards = [...allClassifiedCards, ...classifiedCards];
      }
      
      setResearchStep(6);
      // Phase 6: Global Bridge Detection (Cross-thread scan)
      const bridges = await runBridgeDetector(allClassifiedCards);

      // Update Investigation Log with new findings
      const newInvestigationItems: InvestigationItem[] = allClassifiedCards
        .filter(n => n.status === 'gap' || n.status === 'unverified')
        .map(n => ({
          id: Math.random().toString(36).substr(2, 9),
          name: n.label,
          type: n.record_type === 'Document' ? 'Record Group' : 'Other',
          status: 'Pending',
          priority: n.weight === 3 ? 'High' : n.weight === 2 ? 'Medium' : 'Low',
          notes: n.description,
          searchQuery: `Investigate ${n.label}`,
          createdAt: new Date().toISOString()
        }));
      
      setResearchPoints(prev => [...newInvestigationItems, ...prev]);
      
      setSuggestions({
        bridges: bridges.bridge_candidates.map((b: any) => ({
          label: b.entity,
          reason: `Potential bridge entity appearing in ${b.appears_in.length} threads.`,
          records: b.appears_in
        })),
        gaps: allClassifiedCards.filter(n => n.status === 'gap').map(n => ({
          label: n.label,
          description: n.gap_reasoning?.why_should_exist || n.description
        })),
        researchAreas: [],
        crossovers: [],
        entities: [],
        anomalies: [],
        conflicts: [],
        keyActors: [],
        methodologicalAdvice: [],
        institutionalGaps: [],
        structuralAnomalies: [],
        patternRecognition: [],
        riskAssessment: []
      });
      
      setData({
        original_claim: claim,
        sub_claims: subClaims,
        results: allClassifiedCards,
        bridges,
        links: bridges.links || []
      });
      setActiveTab('dossier');
    } catch (err: any) {
      console.error("Research Error:", err);
      setError(err.message);
      reportError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    const timestamp = new Date().toISOString();
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const genAI = getGenAI();
      const historyContext = chatMessages && chatMessages.length > 0 
        ? `CONVERSATION HISTORY:\n${chatMessages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}\n\n`
        : '';

      const filesContext = uploadedFiles && uploadedFiles.length > 0
        ? `USER UPLOADED NOTES/DOCUMENTS:\n${uploadedFiles.map((f: any) => `FILE: ${f.name}\nCONTENT: ${f.content}`).join('\n\n')}\n\n`
        : '';

      const dataContext = data 
        ? `CURRENT RESEARCH DATA (PIPELINE RESULTS):\n${JSON.stringify(data?.results?.map(n => ({ id: n.record_id, label: n.label, status: n.status, description: n.description })) || []).slice(0, 2000)}\n\n`
        : '';
      
      const sourcesContext = sources.length > 0
        ? `CURRENT SOURCES:\n${sources.map(s => `${s.title} (${s.type})`).join(', ')}\n\n`
        : '';
      
      const investigationContext = researchPoints.length > 0
        ? `CURRENT INVESTIGATION LOG:\n${researchPoints.map(p => `${p.name} [${p.status}]`).join(', ')}\n\n`
        : '';

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { parts: [{ text: `CONTEXT:\n${filesContext}${dataContext}${sourcesContext}${investigationContext}${historyContext}\n\nCURRENT INQUIRY: ${userMsg}` }] }
        ],
        config: {
          systemInstruction: `You are a knowledgeable ODEN Research Collaborator. Your goal is to partner with the user to investigate claims using a strict methodological approach.
          
          YOUR PERSONA:
          - You are a peer researcher. Engage in natural back-and-forth conversation.
          - You have access to the current state of the research (evidence records, sources, investigation log, uploaded documents).
          - You can answer questions, discuss historical or institutional context, and brainstorm research paths.
          - Use the term "record" instead of "card" or "node".
          
          METHODOLOGICAL CONSTRAINTS:
          1. PRIMARY SOURCES ONLY: Always steer the conversation toward finding original records.
          2. NO INFERENCE: Clearly distinguish between documented facts and research hypotheses.
          3. RECOGNIZE ENTITIES: Actively identify people, organizations, agencies, departments, locations, and dates in the user's input and the research data.
          4. ANALYZE UPLOADS: If the user has uploaded documents, analyze them thoroughly and reference their content in your responses.
          5. SITE RESEARCH: Look at the research already on the site (the evidence records and sources) and talk about it.
          
          INTERNET ACCESS:
          - Use Google Search to verify facts and find archival links.
          
          BEHAVIOR:
          - If the user mentions an entity or a gap that needs following up, include it in 'suggestedResearchPoints'.
          - ALWAYS offer to add investigation points to the log if you identify a new research path.
          - If a specific archival or FOIA request is needed, generate it in 'generatedRequest'.
          - For archival requests, use the same formal, institutional tone as FOIA requests, specifying the archive (e.g., NARA, Library of Congress) and record group if known.
          
          Output ONLY valid JSON matching the schema.`,
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              response: { type: Type.STRING },
              entities: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggestedResearchPoints: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ["Institution", "Person", "Location", "Record Group", "Other"] },
                    priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                    notes: { type: Type.STRING },
                    searchQuery: { type: Type.STRING },
                  },
                  required: ["name", "type", "priority", "notes", "searchQuery"],
                },
                nullable: true,
              },
              generatedRequest: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  recipient: { type: Type.STRING },
                  subject: { type: Type.STRING },
                  body: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["FOIA", "Archival", "Institutional"] },
                },
                nullable: true,
              },
            },
            required: ["response", "entities"],
          },
        },
      });
      
      const result = JSON.parse(response.text || "{}");
      const aiTimestamp = new Date().toISOString();
      
      // Handle suggested research points
      if (result.suggestedResearchPoints && result.suggestedResearchPoints.length > 0) {
        const newPoints = result.suggestedResearchPoints.map((p: any) => ({
          ...p,
          id: Math.random().toString(36).substr(2, 9),
          status: 'Pending',
          createdAt: aiTimestamp
        }));
        setResearchPoints(prev => [...newPoints, ...prev]);
      }

      // Check if the AI generated a request
      if (result.generatedRequest) {
        const newReq: Request = {
          ...result.generatedRequest,
          id: Math.random().toString(36).substr(2, 9),
          status: 'Draft',
          createdAt: aiTimestamp
        };
        setRequests(prev => [newReq, ...prev]);
        setChatMessages(prev => [...prev, { 
          role: 'ai', 
          content: `${result.response}\n\n[SYSTEM: A new ${newReq.type} request and ${result.suggestedResearchPoints?.length || 0} research points have been generated.]`,
          timestamp: aiTimestamp,
          entities: result.entities
        }]);
      } else {
        setChatMessages(prev => [...prev, { 
          role: 'ai', 
          content: result.response, 
          timestamp: aiTimestamp,
          entities: result.entities
        }]);
      }
    } catch (err: any) {
      console.error("Chat Error:", err);
      setChatMessages(prev => [...prev, { role: 'ai', content: `Error: ${err.message}`, timestamp: new Date().toISOString() }]);
      reportError(err.message);
    } finally {
      setChatLoading(false);
    }
  };

  const updateRequestStatus = (id: string, status: Request['status']) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  };

  const updateRequest = (updatedRequest: Request) => {
    setRequests(prev => prev.map(r => r.id === updatedRequest.id ? updatedRequest : r));
    setEditingRequest(null);
  };

  const addRequest = (newRequest: Request) => {
    setRequests(prev => [newRequest, ...prev]);
    setEditingRequest(null);
  };

  const deleteRequest = (id: string) => {
    setRequests(prev => prev.filter(r => r.id !== id));
  };

  const saveRequest = (req: Request) => {
    setRequests(prev => prev.map(r => r.id === req.id ? req : r));
    setEditingRequest(null);
  };

  const saveRecord = (record: EvidenceRecord) => {
    if (!data) return;
    setData({
      ...data,
      results: data.results.map(n => n.record_id === record.record_id ? record : n)
    });
    if (selectedRecord?.record_id === record.record_id) setSelectedRecord(record);
    setEditingRecord(null);
  };

  const saveSource = (source: Source) => {
    if (sources.find(s => s.id === source.id)) {
      setSources(prev => prev.map(s => s.id === source.id ? source : s));
    } else {
      setSources(prev => [source, ...prev]);
    }
    setEditingSource(null);
  };

  const deleteSource = (id: string) => {
    setSources(prev => prev.filter(s => s.id !== id));
  };

  const saveResearchPoint = (point: InvestigationItem) => {
    if (researchPoints.find(p => p.id === point.id)) {
      setResearchPoints(prev => prev.map(p => p.id === point.id ? point : p));
    } else {
      setResearchPoints(prev => [point, ...prev]);
    }
    setEditingResearchPoint(null);
  };

  const deleteResearchPoint = (id: string) => {
    setResearchPoints(prev => prev.filter(p => p.id !== id));
  };

  const exportData = () => {
    const exportObj = {
      researchData: data,
      requests,
      sources,
      researchPoints,
      chatMessages,
      claim,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oden-research-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (imported.researchData) setData(imported.researchData);
        if (imported.requests) setRequests(imported.requests);
        if (imported.sources) setSources(imported.sources);
        if (imported.researchPoints) setResearchPoints(imported.researchPoints);
        if (imported.chatMessages) setChatMessages(imported.chatMessages);
        if (imported.claim) setClaim(imported.claim);
        setActiveTab('dossier');
      } catch (err) {
        setError("Failed to parse import file.");
      }
    };
    reader.readAsText(file);
  };

  const clearSession = () => {
    if (window.confirm("Are you sure you want to clear all research data? This cannot be undone.")) {
      setData(null);
      setChatMessages([]);
      setRequests([]);
      setSources([]);
      setResearchPoints([]);
      setClaim('');
      localStorage.removeItem('oden_session');
      setActiveTab('guide');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fcfcfc] text-black">
      {/* Header */}
      <header className="border-b border-black p-4 md:p-6 flex justify-between items-center bg-white sticky top-0 z-[60]">
        <div className="flex items-center gap-4">
          <div className="md:hidden">
            <select 
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as any)}
              className="bg-transparent font-mono text-[10px] uppercase border border-black px-2 py-1 focus:outline-none"
            >
              <option value="guide">00 Guide</option>
              <option value="pipeline">01 Pipeline</option>
              <option value="dossier">02 Dossier</option>
              <option value="list">03 Records</option>
              <option value="investigation">04 Log</option>
              <option value="chat">05 Chat</option>
              <option value="requests">06 Requests</option>
              <option value="suggestions">07 Suggestions</option>
              <option value="document-sync">08 Document Sync</option>
            </select>
          </div>
          <div className="hidden md:block">
            <h1 className="text-2xl font-serif italic tracking-tight leading-none">ODEN</h1>
            <p className="text-[8px] font-mono uppercase opacity-40 tracking-widest mt-1">Observational Diagnostic Entry Network</p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-6 text-[10px] font-mono uppercase tracking-widest">
          <nav className="flex gap-6">
            <button 
              onClick={() => setActiveTab('guide')}
              className={cn("pb-1 border-b-2 transition-all", activeTab === 'guide' ? "border-black opacity-100" : "border-transparent opacity-30 hover:opacity-100")}
            >
              00 Guide
            </button>
            <button 
              onClick={() => setActiveTab('pipeline')}
              className={cn("pb-1 border-b-2 transition-all", activeTab === 'pipeline' ? "border-black opacity-100" : "border-transparent opacity-30 hover:opacity-100")}
            >
              01 Pipeline
            </button>
            <button 
              onClick={() => setActiveTab('dossier')}
              className={cn("pb-1 border-b-2 transition-all", activeTab === 'dossier' ? "border-black opacity-100" : "border-transparent opacity-30 hover:opacity-100")}
            >
              02 Dossier
            </button>
            <button 
              onClick={() => setActiveTab('list')}
              className={cn("pb-1 border-b-2 transition-all", activeTab === 'list' ? "border-black opacity-100" : "border-transparent opacity-30 hover:opacity-100")}
            >
              03 Records
            </button>

            <button 
              onClick={() => setActiveTab('investigation')}
              className={cn("pb-1 border-b-2 transition-all", activeTab === 'investigation' ? "border-black opacity-100" : "border-transparent opacity-30 hover:opacity-100")}
            >
              04 Log
            </button>
          </nav>

          <div className="h-4 w-[1px] bg-black/10 mx-2" />

          <div className="relative group">
            <button className="flex items-center gap-2 pb-1 border-b-2 border-transparent opacity-40 group-hover:opacity-100 transition-all">
              <LayoutGrid className="w-3 h-3" />
              <span>Workspace</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-black shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[70]">
              <div className="p-2 flex flex-col">
                {[
                  { id: 'chat', label: 'Research Chat', icon: Send },
                  { id: 'requests', label: 'FOIA Requests', icon: Mail },
                  { id: 'investigation', label: 'Investigation Log', icon: Network },
                  { id: 'suggestions', label: 'AI Suggestions', icon: Sparkles },
                  { id: 'document-sync', label: 'Document Sync', icon: Save },
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id as any)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 text-left hover:bg-black hover:text-white transition-all",
                      activeTab === item.id ? "bg-black/5 font-bold" : ""
                    )}
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2">
            <div className={cn("w-1.5 h-1.5 rounded-full", error ? "bg-red-500 animate-pulse" : "bg-emerald-500")} />
            <span className="text-[8px] font-mono uppercase opacity-40">
              {error ? "Error" : "Sync Active"}
            </span>
          </div>
          <button 
            onClick={clearSession}
            className="p-2 hover:bg-red-50 text-red-600 transition-all rounded-full"
            title="Clear Session"
          >
            <Trash className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
          <AnimatePresence mode="wait">
            {activeTab === 'guide' && (
              <motion.div
                key="guide"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full overflow-y-auto bg-stone-50"
              >
                <div className="max-w-5xl mx-auto p-8 md:p-16">
                  <div className="border-b border-black pb-12 mb-16">
                    <h2 className="text-5xl md:text-7xl font-serif italic mb-6 tracking-tight">How to use ODEN.</h2>
                    <p className="text-lg md:text-xl font-serif italic opacity-60 max-w-2xl leading-relaxed">
                      ODEN is a diagnostic research engine built to strip narrative bias and reveal the structural evidence required to verify or falsify institutional claims.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
                    <section className="space-y-8">
                      <div>
                        <h3 className="col-header mb-6">01 The Pipeline</h3>
                        <p className="text-sm leading-relaxed mb-4">
                          The Pipeline is your entry point. When you enter a claim, ODEN performs a multi-stage analysis:
                        </p>
                        <div className="space-y-4">
                          <div className="p-4 border border-black bg-white">
                            <p className="text-[10px] font-mono uppercase font-bold mb-1">Neutralization</p>
                            <p className="text-xs opacity-60">Strips emotional framing to find the testable institutional fact.</p>
                          </div>
                          <div className="p-4 border border-black bg-white">
                            <p className="text-[10px] font-mono uppercase font-bold mb-1">Blueprint Generation</p>
                            <p className="text-xs opacity-60">Deduces which record groups *must* exist if the claim is true.</p>
                          </div>
                          <div className="p-4 border border-black bg-white">
                            <p className="text-[10px] font-mono uppercase font-bold mb-1">Primary Research</p>
                            <p className="text-xs opacity-60">Scans archives and digital repositories for those specific records.</p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="col-header mb-6">02 Evidence Classification</h3>
                        <p className="text-sm leading-relaxed mb-4">
                          Every finding is classified into one of four structural states:
                        </p>
                        <div className="grid grid-cols-1 gap-2">
                          <div className="flex items-center gap-3 p-3 border border-black bg-green-50">
                            <div className="w-2 h-2 bg-green-600 rounded-full" />
                            <span className="text-[10px] font-mono uppercase font-bold">Verified</span>
                            <span className="text-[10px] opacity-60">— Confirmed by primary source.</span>
                          </div>
                          <div className="flex items-center gap-3 p-3 border border-black bg-red-50">
                            <div className="w-2 h-2 bg-red-600 rounded-full" />
                            <span className="text-[10px] font-mono uppercase font-bold">Gap</span>
                            <span className="text-[10px] opacity-60">— Record should exist but is missing.</span>
                          </div>
                          <div className="flex items-center gap-3 p-3 border border-black bg-purple-50">
                            <div className="w-2 h-2 bg-purple-600 rounded-full" />
                            <span className="text-[10px] font-mono uppercase font-bold">Contested</span>
                            <span className="text-[10px] opacity-60">— Conflicting primary records.</span>
                          </div>
                          <div className="flex items-center gap-3 p-3 border border-black bg-yellow-50">
                            <div className="w-2 h-2 bg-yellow-600 rounded-full" />
                            <span className="text-[10px] font-mono uppercase font-bold">Unverified</span>
                            <span className="text-[10px] opacity-60">— Secondary source only.</span>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-8">
                      <div>
                        <h3 className="col-header mb-6">03 The Dossier</h3>
                        <p className="text-sm leading-relaxed mb-4">
                          The Dossier is your evidence workspace. Use it to:
                        </p>
                        <ul className="text-xs space-y-3 font-mono uppercase opacity-70">
                          <li className="flex gap-3"><ChevronRight className="w-3 h-3 flex-shrink-0" /> Inspect individual evidence records</li>
                          <li className="flex gap-3"><ChevronRight className="w-3 h-3 flex-shrink-0" /> Identify "Bridges" (entities appearing in multiple threads)</li>
                          <li className="flex gap-3"><ChevronRight className="w-3 h-3 flex-shrink-0" /> Manually add your own research findings</li>
                          <li className="flex gap-3"><ChevronRight className="w-3 h-3 flex-shrink-0" /> Deep-dive into specific records with the AI</li>
                        </ul>
                      </div>

                      <div className="p-8 border border-black bg-stone-900 text-white">
                        <h4 className="text-xl font-serif italic mb-4">Pro Tip: Structural Gaps</h4>
                        <p className="text-xs opacity-60 leading-relaxed mb-6">
                          A "Gap" is more than just missing info. It is a methodological failure of an institution to produce a record that its own protocols require. Gaps are often more revealing than verified facts.
                        </p>
                        <button 
                          onClick={() => setActiveTab('pipeline')}
                          className="w-full py-4 border border-white/20 hover:bg-white hover:text-black transition-all text-[10px] font-mono uppercase font-bold tracking-widest"
                        >
                          Start Your First Research
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'pipeline' && (
              <motion.div
                key="pipeline"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="h-full overflow-y-auto bg-stone-50"
              >
                {/* Hero Section - Square Grid Layout */}
                <section className="py-12 px-4 md:px-8 border-b border-black bg-white">
                  <div className="max-w-6xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
                      {/* Left Column: Input */}
                      <div className="flex flex-col border border-black p-8 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        <div className="mb-8">
                          <h2 className="text-3xl font-serif italic mb-2 tracking-tight">Neutralize the Narrative.</h2>
                          <p className="text-[10px] font-mono uppercase opacity-50">
                            Reveal the structural evidence blueprint and identify institutional gaps.
                          </p>
                        </div>
                        
                        <div className="flex-1 flex flex-col gap-6">
                          <div className="flex flex-col gap-2 flex-1">
                            <label className="text-[10px] font-mono uppercase font-bold opacity-40">Research Seed / Claim</label>
                            <textarea
                              value={claim}
                              onChange={(e) => setClaim(e.target.value)}
                              placeholder="e.g., 'The 1974 archival records were destroyed by...'"
                              className="w-full h-full bg-transparent border-2 border-black p-4 font-sans text-lg focus:outline-none focus:ring-0 transition-all placeholder:opacity-30 resize-none min-h-[150px]"
                              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleResearch()}
                            />
                          </div>
                          
                          <div className="flex gap-3">
                            <button
                              onClick={handleResearch}
                              disabled={loading || !claim.trim()}
                              className="flex-1 py-4 bg-black text-white hover:bg-black/90 disabled:opacity-30 transition-all flex items-center justify-center gap-3"
                            >
                              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                              <span className="text-xs font-mono uppercase font-bold tracking-widest">Initiate Research</span>
                            </button>
                            
                            <label className="cursor-pointer bg-white border-2 border-black p-4 hover:bg-black hover:text-white transition-all flex items-center justify-center">
                              <Upload className="w-5 h-5" />
                              <input type="file" className="hidden" multiple onChange={handleFileUpload} />
                            </label>
                          </div>

                          {uploadedFiles.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {uploadedFiles.map((f, i) => (
                                <span key={i} className="text-[8px] font-mono uppercase bg-black/5 border border-black/10 px-2 py-1 flex items-center gap-1">
                                  <FileText className="w-2 h-2" /> {f.name}
                                </span>
                              ))}
                            </div>
                          )}

                          {error && (
                            <p className="text-red-600 text-[10px] font-mono uppercase flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> {error}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right Column: Pipeline Status */}
                      <div className="flex flex-col border border-black p-8 bg-stone-900 text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        <div className="flex justify-between items-end mb-8">
                          <h3 className="text-[10px] font-mono uppercase font-bold opacity-40">Pipeline Status</h3>
                          {loading && <span className="text-[10px] font-mono uppercase animate-pulse text-emerald-400">Processing...</span>}
                        </div>
                        <div className="grid grid-cols-1 gap-3 flex-1">
                          <PipelineStep label="01 Claim Scoping" status={researchStep === 1 ? 'loading' : researchStep > 1 ? 'complete' : 'pending'} />
                          <PipelineStep label="02 Neutralizing Sub-Claims" status={researchStep === 2 ? 'loading' : researchStep > 2 ? 'complete' : 'pending'} />
                          <PipelineStep label="03 Generating Blueprints" status={researchStep === 3 ? 'loading' : researchStep > 3 ? 'complete' : 'pending'} />
                          <PipelineStep label="04 Primary Source Research" status={researchStep === 4 ? 'loading' : researchStep > 4 ? 'complete' : 'pending'} />
                          <PipelineStep label="05 Record Classification" status={researchStep === 5 ? 'loading' : researchStep > 5 ? 'complete' : 'pending'} />
                          <PipelineStep label="06 Bridge Detection" status={researchStep === 6 ? 'loading' : researchStep > 6 ? 'complete' : 'pending'} />
                        </div>
                        <div className="mt-8 pt-8 border-t border-white/10">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-mono opacity-50 uppercase">Current Session</span>
                            <span className="text-xs font-bold uppercase">{data?.results?.length || 0} Records Found</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <div className="p-8">
                  <div className="max-w-6xl mx-auto mb-12">
                    <div className="flex justify-between items-end border-b border-black pb-8 mb-12">
                      <div>
                        <h2 className="text-3xl font-serif italic mb-2">Intake Research Pipeline</h2>
                        <p className="text-sm opacity-70 leading-relaxed max-w-2xl">
                          The ODEN Pipeline is a multi-stage diagnostic engine designed to strip narrative bias and reveal the structural evidence required to verify or falsify a claim.
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-mono opacity-50 uppercase mb-1">Current Session Status</p>
                        <p className="text-xs font-bold uppercase">{data?.results?.length || 0} Evidence Records</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-16">
                      {[
                        { step: "01", title: "Neutralizer", desc: "Strips emotional framing and political bias from the input claim.", icon: Shield },
                        { step: "02", title: "Blueprint", desc: "Deduces the institutional records that *must* exist if the claim is true.", icon: Network },
                        { step: "03", title: "Researcher", desc: "Scans primary archives, record groups, and digital repositories.", icon: Search },
                        { step: "04", title: "Classifier", desc: "Applies the four-state evidence model: Verified, Gap, Contested, Unverified.", icon: FileText },
                      ].map((item) => (
                        <div key={item.step} className="p-6 border border-black bg-white hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all group">
                          <div className="flex justify-between items-start mb-4">
                            <span className="text-[10px] font-mono opacity-30">{item.step}</span>
                            <item.icon className="w-4 h-4 opacity-40 group-hover:opacity-100 transition-all" />
                          </div>
                          <h4 className="font-serif italic text-xl mb-2">{item.title}</h4>
                          <p className="text-[10px] font-mono uppercase opacity-60 leading-relaxed">{item.desc}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 border-t border-black pt-12">
                      <div>
                        <h3 className="col-header mb-6">Methodological Basis</h3>
                        <div className="space-y-4">
                          <div className="p-4 border border-black bg-black/5">
                            <p className="text-[10px] font-mono uppercase font-bold mb-2">Structural Deduction</p>
                            <p className="text-xs opacity-70 leading-relaxed">
                              Your input claim acts as the seed. The pipeline uses it to deduce which record groups (financial, archival, communication) *must* exist if the claim is structurally valid.
                            </p>
                          </div>
                          <div className="p-4 border border-black bg-black/5">
                            <p className="text-[10px] font-mono uppercase font-bold mb-2">Primary Source Priority</p>
                            <p className="text-xs opacity-70 leading-relaxed">
                              Secondary sources (news, Wikipedia) only inform the search. Verification requires original institutional records or physical evidence.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col justify-center items-center text-center p-8 border border-black border-dashed opacity-40">
                        <Zap className="w-8 h-8 mb-4" />
                        <p className="font-serif italic text-lg">System Ready for Intake.</p>
                        <p className="text-[9px] font-mono uppercase mt-2">Awaiting Claim Seed</p>
                      </div>
                    </div>
                  </div>

                  {data && (
                    <div className="max-w-4xl mx-auto space-y-12 mt-12">
                      {data.sub_claims && data.sub_claims.length > 0 && (
                        <section>
                          <h3 className="col-header mb-4">Claim Decomposition (Scoping)</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {data.sub_claims.map(sc => (
                              <div key={sc.id} className="p-4 border border-black bg-white space-y-2">
                                <div className="flex justify-between items-start">
                                  <span className="text-[8px] font-mono uppercase bg-black text-white px-2 py-0.5">Sub-Claim</span>
                                  <span className="text-[8px] font-mono uppercase opacity-30">ID: {sc.id}</span>
                                </div>
                                <p className="font-serif italic text-sm">"{sc.claim}"</p>
                                <p className="text-[10px] opacity-60 leading-relaxed">{sc.description}</p>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {data.neutralized && (
                        <section>
                          <h3 className="col-header mb-4">Neutralized Claim</h3>
                          <div className="p-6 border border-black bg-white">
                            <p className="font-serif text-xl italic mb-2">"{data.neutralized.neutralized_claim}"</p>
                            <div className="flex gap-2 mt-4">
                              {data.neutralized.evidence_categories.map((cat, i) => (
                                <span key={`${cat}-${i}`} className="text-[9px] font-mono uppercase px-2 py-1 bg-black/5 border border-black/10">
                                  {cat}
                                </span>
                              ))}
                            </div>
                          </div>
                        </section>
                      )}

                      <section>
                        <h3 className="col-header mb-4">Pipeline Execution Log</h3>
                        <div className="space-y-2">
                          {data.results.map((record, i) => (
                            <div key={record.record_id || `record-${i}`} className="data-row p-4 flex items-center justify-between bg-white/30">
                              <div className="flex items-center gap-4">
                                <span className="text-[10px] font-mono opacity-30">{(i + 1).toString().padStart(2, '0')}</span>
                                <div>
                                  <p className="text-xs font-medium">{record.label || record.description}</p>
                                  <p className="text-[9px] font-mono opacity-50 uppercase">{record.record_type}</p>
                                </div>
                              </div>
                              <StatusBadge status={record.status} />
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'dossier' && (
              <motion.div
                key="dossier"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col relative bg-stone-50"
              >
                <div className="flex-1 overflow-y-auto p-6 md:p-12">
                  <div className="max-w-7xl mx-auto space-y-12">
                    <div className="flex justify-between items-end border-b border-black pb-8">
                      <div>
                        <h2 className="text-4xl font-serif italic mb-2">Evidence Dossier</h2>
                        <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">Methodological Compilation of Research Findings</p>
                      </div>
                      <div className="flex gap-4">
                        <button 
                          onClick={addManualRecord}
                          className="bg-black text-white px-6 py-3 text-[10px] font-mono uppercase tracking-widest font-bold hover:bg-black/80 transition-all flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" /> Add Manual Entry
                        </button>
                      </div>
                    </div>

                    {data?.original_claim && (
                      <div className="p-8 border border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        <span className="text-[10px] font-mono uppercase opacity-40 mb-2 block tracking-widest">Central Research Claim</span>
                        <h3 className="text-2xl font-serif italic leading-tight">"{data.original_claim}"</h3>
                      </div>
                    )}

                    {/* Filter / Stats Bar */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="p-4 border border-black bg-white flex flex-col justify-between h-24">
                        <span className="text-[9px] font-mono uppercase opacity-50">Total Records</span>
                        <span className="text-3xl font-serif italic">{data?.results?.length || 0}</span>
                      </div>
                      <div className="p-4 border border-black bg-white flex flex-col justify-between h-24 border-l-4 border-l-green-600">
                        <span className="text-[9px] font-mono uppercase opacity-50">Verified</span>
                        <span className="text-3xl font-serif italic">{data?.results?.filter(n => n.status === 'verified').length || 0}</span>
                      </div>
                      <div className="p-4 border border-black bg-white flex flex-col justify-between h-24 border-l-4 border-l-red-600">
                        <span className="text-[9px] font-mono uppercase opacity-50">Archival Gaps</span>
                        <span className="text-3xl font-serif italic">{data?.results?.filter(n => n.status === 'gap').length || 0}</span>
                      </div>
                      <div className="p-4 border border-black bg-white flex flex-col justify-between h-24 border-l-4 border-l-purple-600">
                        <span className="text-[9px] font-mono uppercase opacity-50">Contested</span>
                        <span className="text-3xl font-serif italic">{data?.results?.filter(n => n.status === 'contested').length || 0}</span>
                      </div>
                      <div className="p-4 border border-black bg-white flex flex-col justify-between h-24 border-l-4 border-l-yellow-600">
                        <span className="text-[9px] font-mono uppercase opacity-50">Unverified</span>
                        <span className="text-3xl font-serif italic">{data?.results?.filter(n => n.status === 'unverified').length || 0}</span>
                      </div>
                    </div>

                    {/* Crossovers / Bridges Section */}
                    {data?.bridges?.bridge_candidates && data.bridges.bridge_candidates.length > 0 && (
                      <section>
                        <h3 className="col-header mb-6">Structural Crossovers (Bridges)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          {data?.bridges?.bridge_candidates?.map(bridge => (
                            <div key={bridge.entity} className="p-6 border border-black bg-stone-900 text-white space-y-4">
                              <div className="flex justify-between items-start">
                                <h4 className="font-serif italic text-xl">{bridge.entity}</h4>
                                <span className="text-[8px] font-mono bg-white text-black px-2 py-0.5 uppercase font-bold">Bridge</span>
                              </div>
                              <p className="text-[10px] font-mono opacity-60 leading-relaxed">
                                This entity appears in {bridge.appears_in.length} independent research threads, suggesting a structural nexus.
                              </p>
                              <div className="flex flex-wrap gap-1 pt-2">
                                {bridge.appears_in.map(id => {
                                  const record = data?.results?.find(c => c.record_id === id);
                                  return (
                                    <button 
                                      key={id} 
                                      onClick={() => {
                                        if (record) {
                                          setSelectedRecord(record);
                                          setIsSidebarOpen(true);
                                        }
                                      }}
                                      className="text-[8px] font-mono bg-white/10 hover:bg-white/20 px-2 py-1 border border-white/10 transition-all"
                                    >
                                      {record?.label || id}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* New Suggestion Categories: Entities & Anomalies */}
                    {(suggestions.entities.length > 0 || suggestions.anomalies.length > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                        {suggestions.entities.length > 0 && (
                          <section>
                            <h3 className="col-header mb-6">Key Institutional Entities</h3>
                            <div className="space-y-4">
                              {suggestions.entities.map((ent: any, i: number) => (
                                <div key={i} className="p-4 border border-black bg-white">
                                  <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-bold text-sm">{ent.name}</h4>
                                    <span className="text-[8px] font-mono bg-black/10 px-1 uppercase">{ent.type}</span>
                                  </div>
                                  <p className="text-[10px] opacity-70 leading-relaxed">{ent.relevance}</p>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                        {suggestions.anomalies.length > 0 && (
                          <section>
                            <h3 className="col-header mb-6">Timeline Anomalies</h3>
                            <div className="space-y-4">
                              {suggestions.anomalies.map((anom: any, i: number) => (
                                <div key={i} className="p-4 border border-black bg-red-50">
                                  <div className="flex items-center gap-2 mb-2">
                                    <AlertTriangle className="w-3 h-3 text-red-600" />
                                    <h4 className="font-bold text-sm">{anom.title}</h4>
                                  </div>
                                  <p className="text-[10px] opacity-70 leading-relaxed mb-2">{anom.description}</p>
                                  <p className="text-[9px] font-mono uppercase font-bold text-red-600">Impact: {anom.impact}</p>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                      </div>
                    )}

                    {/* Main Record Grid */}
                    <section>
                      <h3 className="col-header mb-6">Evidence Records</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {data?.results?.map((record) => (
                          <motion.div 
                            key={record.record_id}
                            layoutId={record.record_id}
                            onClick={() => {
                              setSelectedRecord(record);
                              setIsSidebarOpen(true);
                            }}
                            className={cn(
                              "group p-6 border border-black bg-white hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer flex flex-col justify-between h-80",
                              record.status === 'gap' && "border-red-600 border-2"
                            )}
                          >
                            <div className="space-y-4">
                              <div className="flex justify-between items-start">
                                <StatusBadge status={record.status} />
                                <span className="text-[9px] font-mono uppercase opacity-40">{record.record_type}</span>
                              </div>
                              <h4 className="font-serif italic text-2xl leading-tight group-hover:underline">{record.label}</h4>
                              <p className="text-xs opacity-60 line-clamp-4 font-serif italic leading-relaxed">
                                {record.description}
                              </p>
                            </div>
                            
                            <div className="pt-6 border-t border-black/5 flex justify-between items-center">
                              <span className="text-[9px] font-mono uppercase opacity-40">ID: {record.record_id?.slice(0, 8) || 'Unknown'}</span>
                              <div className="flex gap-2">
                                <button className="p-2 hover:bg-black/5 transition-all">
                                  <Info className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>

                <AnimatePresence>
                  {isSidebarOpen && (
                    <motion.aside 
                      initial={{ x: '100%' }}
                      animate={{ x: 0 }}
                      exit={{ x: '100%' }}
                      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                      className="absolute inset-y-0 right-0 w-full md:w-[450px] border-l border-black bg-white overflow-y-auto p-8 z-40 shadow-2xl"
                    >
                      <div className="flex justify-between items-center mb-8 border-b border-black/10 pb-4">
                        <h3 className="col-header">Record Inspector</h3>
                        <button 
                          onClick={() => setIsSidebarOpen(false)}
                          className="p-2 hover:bg-black/5 rounded-full transition-all"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      {selectedRecord ? (
                        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                          <div className="space-y-4">
                            <div className="flex items-center gap-3">
                              <StatusBadge status={selectedRecord.status} />
                              <span className="text-[10px] font-mono uppercase opacity-40 tracking-widest">{selectedRecord.record_type}</span>
                            </div>
                            <h4 className="font-serif italic text-3xl leading-tight">{selectedRecord.label}</h4>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => setViewingRecord(selectedRecord)}
                                className="flex-1 bg-black text-white py-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all"
                              >
                                Full Report
                              </button>
                              <button 
                                onClick={() => setEditingRecord(selectedRecord)}
                                className="p-3 border border-black hover:bg-black/5 transition-all"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          
                          <div className="space-y-6">
                            <section>
                              <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Description</h5>
                              <p className="text-sm leading-relaxed opacity-70 font-serif italic">{selectedRecord.description}</p>
                            </section>

                            {selectedRecord.citation_url && (
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Source Document</h5>
                                <a 
                                  href={selectedRecord.citation_url} 
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="flex items-center justify-between p-4 border border-black/10 bg-stone-50 hover:bg-black hover:text-white transition-all group"
                                >
                                  <span className="text-xs font-bold truncate pr-4">{selectedRecord.citation || 'View Primary Record'}</span>
                                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                </a>
                              </section>
                            )}

                            {selectedRecord.status === 'gap' && selectedRecord.gap_reasoning && (
                              <section className="p-5 border border-red-200 bg-red-50/50 space-y-4">
                                <div className="flex items-center gap-2 text-red-800">
                                  <AlertCircle className="w-4 h-4" />
                                  <p className="text-[10px] font-mono uppercase font-bold">Structural Gap Detected</p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-mono uppercase opacity-50 mb-1">Deductive Basis</p>
                                  <p className="text-xs leading-relaxed">{selectedRecord.gap_reasoning.why_should_exist}</p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-mono uppercase opacity-50 mb-1">Target Location</p>
                                  <p className="text-xs leading-relaxed font-mono">{selectedRecord.gap_reasoning.where_specifically}</p>
                                </div>
                              </section>
                            )}

                            {/* Related Records Section */}
                            {data?.links?.some(l => l.source === selectedRecord.record_id || l.target === selectedRecord.record_id) && (
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Related Evidence</h5>
                                <div className="space-y-2">
                                  {data?.links?.filter(l => l.source === selectedRecord.record_id || l.target === selectedRecord.record_id).map((link, idx) => {
                                    const relatedId = link.source === selectedRecord.record_id ? link.target : link.source;
                                    const relatedRecord = data?.results?.find(c => c.record_id === relatedId);
                                    return (
                                      <div 
                                        key={relatedId || `link-${idx}`} 
                                        onClick={() => relatedRecord && setSelectedRecord(relatedRecord)}
                                        className="p-3 border border-black/5 bg-stone-50 hover:bg-black/5 cursor-pointer flex justify-between items-center"
                                      >
                                        <span className="text-xs font-serif italic">{relatedRecord?.label || 'Unknown Record'}</span>
                                        <span className="text-[8px] font-mono uppercase opacity-40">{link.label}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </section>
                            )}
                          </div>

                          <button 
                            onClick={() => askAIAboutRecord(selectedRecord)}
                            className="w-full border-2 border-black py-4 text-[10px] font-mono uppercase font-bold tracking-[0.2em] hover:bg-black hover:text-white transition-all flex items-center justify-center gap-2"
                          >
                            <Zap className="w-4 h-4" /> Deep Dive with AI
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full opacity-30 space-y-4">
                          <LayoutGrid className="w-12 h-12" />
                          <p className="text-[10px] font-mono uppercase tracking-widest">Select a record to inspect</p>
                        </div>
                      )}
                    </motion.aside>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {activeTab === 'list' && (
              <motion.div
                key="list"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12"
              >
                <div className="max-w-6xl mx-auto">
                  <div className="flex justify-between items-end mb-10 border-b border-black pb-4">
                    <h2 className="text-3xl font-serif italic">Record Inventory</h2>
                    <p className="text-[10px] font-mono opacity-50 uppercase">{data?.results?.length || 0} Structural Records Logged</p>
                  </div>

                  {data?.original_claim && (
                    <div className="mb-12 p-6 border border-black bg-white/50 border-dashed">
                      <span className="text-[9px] font-mono uppercase opacity-40 mb-1 block">Active Investigation</span>
                      <p className="font-serif italic text-lg opacity-70">"{data.original_claim}"</p>
                    </div>
                  )}

                  {!data ? (
                    <div className="text-center py-20 opacity-20">
                      <List className="w-16 h-16 mx-auto mb-4" />
                      <p className="font-serif italic text-xl">No research data available. Initiate a pipeline search first.</p>
                    </div>
                  ) : (
                    <div className="border border-black overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-black text-white text-[9px] font-mono uppercase">
                          <tr>
                            <th className="p-4 border-r border-white/20">Status</th>
                            <th className="p-4 border-r border-white/20">Type</th>
                            <th className="p-4 border-r border-white/20">Record Label / Description</th>
                            <th className="p-4 border-r border-white/20">Citation</th>
                            <th className="p-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="text-xs">
                          {data?.results?.map(record => (
                            <tr key={record.record_id} className="border-b border-black hover:bg-black/5 transition-all">
                              <td className="p-4 border-r border-black">
                                <StatusBadge status={record.status} />
                              </td>
                              <td className="p-4 border-r border-black font-mono text-[10px] uppercase opacity-60">
                                {record.record_type}
                              </td>
                              <td className="p-4 border-r border-black">
                                <p className="font-bold mb-1">{record.label}</p>
                                <p className="opacity-70 line-clamp-2">{record.description}</p>
                              </td>
                              <td className="p-4 border-r border-black">
                                {record.citation_url ? (
                                  <a href={record.citation_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                                    <ExternalLink className="w-3 h-3" /> {record.citation || 'View Source'}
                                  </a>
                                ) : (
                                  <span className="opacity-40 italic">{record.citation || 'No citation'}</span>
                                )}
                              </td>
                              <td className="p-4">
                                <div className="flex gap-2">
                                  <button 
                                    onClick={() => setViewingRecord(record)}
                                    className="p-2 hover:bg-black hover:text-white transition-all rounded flex items-center gap-2 text-[10px] font-mono uppercase"
                                    title="View Evidence"
                                  >
                                    <BookOpen className="w-4 h-4" /> Evidence
                                  </button>
                                  <button 
                                    onClick={() => setEditingRecord(record)}
                                    className="p-2 hover:bg-black/5 transition-all rounded"
                                    title="Edit Metadata"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => deleteRecord(record.record_id)}
                                    className="p-2 hover:bg-red-50 text-red-600 transition-all rounded"
                                    title="Delete Record"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'chat' && (
              <motion.div
                key="chat"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="h-full flex flex-col p-4 md:p-8"
              >
                <div className="flex justify-between items-end mb-6 border-b border-black pb-4">
                  <h2 className="text-3xl font-serif italic">Research Log</h2>
                  <div className="flex gap-2">
                    <button 
                      onClick={downloadChatLog}
                      className="text-[9px] font-mono uppercase border border-black px-3 py-1 hover:bg-black hover:text-white transition-all flex items-center gap-2"
                    >
                      <Download className="w-3 h-3" /> Download Log
                    </button>
                    <p className="text-[10px] font-mono opacity-50 uppercase">Thinking Process Archive</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 mb-4 scrollbar-thin pr-2">
                  {chatMessages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center opacity-20 text-center">
                      <HelpCircle className="w-16 h-16 mb-4" />
                      <p className="font-serif italic text-xl">Direct Inquiry Mode. Ask for structural deep-dives.</p>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={`msg-${msg.timestamp}-${i}`} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[85%] p-4 border",
                        msg.role === 'user' ? "bg-black text-white border-black shadow-lg" : "bg-white border-black"
                      )}>
                        <div className="flex justify-between items-end mb-1 gap-4">
                          <p className="text-[9px] font-mono uppercase opacity-50">{msg.role === 'user' ? 'Inquirer' : 'ODEN System'}</p>
                          {msg.timestamp && (
                            <p className="text-[8px] font-mono opacity-30">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="p-4 border border-black bg-white animate-pulse">
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 pb-20 md:pb-0">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask for deep-dives or FOIA templates..."
                    className="flex-1 bg-transparent border border-black p-4 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                    onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                  />
                  <button
                    onClick={handleChat}
                    disabled={chatLoading || !chatInput.trim()}
                    className="px-6 bg-black text-white hover:bg-black/80 disabled:opacity-30 transition-all flex items-center justify-center"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {activeTab === 'requests' && (
              <motion.div
                key="requests"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12"
              >
                <div className="max-w-5xl mx-auto">
                  <div className="flex flex-col md:flex-row justify-between items-end mb-10 border-b border-black pb-4 gap-4">
                    <div>
                      <h2 className="text-3xl font-serif italic">Archival & FOIA Requests</h2>
                      <p className="text-[10px] font-mono opacity-50 uppercase">{requests.length} Document Inquiries Active</p>
                    </div>
                    <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
                      <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 opacity-30" />
                        <input 
                          type="text"
                          placeholder="Search requests..."
                          value={requestSearch}
                          onChange={(e) => setRequestSearch(e.target.value)}
                          className="w-full pl-8 pr-4 py-2 border border-black text-[10px] font-mono uppercase focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      </div>
                      <button 
                        onClick={() => setEditingRequest({ id: Math.random().toString(36).substr(2, 9), title: '', recipient: '', subject: '', body: '', status: 'Draft', type: 'FOIA', createdAt: new Date().toISOString() })}
                        className="w-full md:w-auto text-[10px] font-mono uppercase bg-black text-white px-6 py-2 hover:bg-black/80 transition-all whitespace-nowrap"
                      >
                        New Request
                      </button>
                    </div>
                  </div>

                  {requests.length === 0 ? (
                    <div className="text-center py-20 opacity-20">
                      <Mail className="w-16 h-16 mx-auto mb-4" />
                      <p className="font-serif italic text-xl">No requests generated yet. Use the Research Chat to identify gaps.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-6">
                      {requests.filter(req => 
                        req.title.toLowerCase().includes(requestSearch.toLowerCase()) ||
                        req.recipient.toLowerCase().includes(requestSearch.toLowerCase()) ||
                        req.subject.toLowerCase().includes(requestSearch.toLowerCase())
                      ).map(req => (
                        <div key={req.id} className="border border-black bg-white p-6 relative group">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] font-mono bg-black text-white px-1 uppercase">{req.type}</span>
                                <span className={cn(
                                  "text-[9px] font-mono px-1 uppercase border",
                                  req.status === 'Draft' ? "border-gray-400 text-gray-400" :
                                  req.status === 'Pending' ? "border-yellow-600 text-yellow-600" :
                                  "border-green-600 text-green-600"
                                )}>{req.status}</span>
                              </div>
                              <h4 className="font-serif italic text-xl">{req.title}</h4>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => setEditingRequest(req)}
                                className="p-2 hover:bg-black/5 transition-all"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => deleteRequest(req.id)}
                                className="p-2 hover:bg-red-50 text-red-600 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="space-y-2 mb-6">
                            <p className="text-[10px] font-mono uppercase opacity-50">Recipient: <span className="text-black opacity-100">{req.recipient}</span></p>
                            <p className="text-[10px] font-mono uppercase opacity-50">Subject: <span className="text-black opacity-100">{req.subject}</span></p>
                          </div>

                          <div className="flex gap-3">
                            <a 
                              href={`mailto:${req.recipient}?subject=${encodeURIComponent(req.subject)}&body=${encodeURIComponent(req.body)}`}
                              onClick={() => updateRequestStatus(req.id, 'Sent')}
                              className="flex-1 bg-black text-white p-3 text-center text-[10px] font-mono uppercase font-bold tracking-widest flex items-center justify-center gap-2 hover:bg-black/90 transition-all"
                            >
                              <Send className="w-3 h-3" /> Send via Mail Client
                            </a>
                            <select 
                              value={req.status}
                              onChange={(e) => updateRequestStatus(req.id, e.target.value as any)}
                              className="border border-black px-3 text-[10px] font-mono uppercase focus:outline-none"
                            >
                              <option value="Draft">Draft</option>
                              <option value="Pending">Pending</option>
                              <option value="Sent">Sent</option>
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'document-sync' && (
              <motion.div
                key="document-sync"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12"
              >
                <div className="max-w-6xl mx-auto space-y-16">
                  {/* Section 1: Research Sources */}
                  <section>
                    <div className="flex justify-between items-end mb-6 border-b border-black pb-4">
                      <h2 className="text-3xl font-serif italic">Research Sources</h2>
                      <div className="flex gap-2">
                        <label className="cursor-pointer text-[10px] font-mono uppercase border border-black px-4 py-2 hover:bg-black hover:text-white transition-all flex items-center gap-2">
                          <Upload className="w-3 h-3" />
                          <span>Upload Notes</span>
                          <input type="file" className="hidden" multiple onChange={handleFileUpload} />
                        </label>
                        <button 
                          onClick={() => setEditingSource({ id: Math.random().toString(36).substr(2, 9), title: '', url: '', type: 'Primary', addedAt: new Date().toISOString() })}
                          className="text-[10px] font-mono uppercase bg-black text-white px-4 py-2 hover:bg-black/80 transition-all"
                        >
                          Add Source
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-4 mb-8">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                        <input 
                          type="text"
                          placeholder="Search sources..."
                          value={sourceSearch}
                          onChange={(e) => setSourceSearch(e.target.value)}
                          className="w-full bg-black/5 border border-black/10 p-3 pl-10 text-xs font-mono focus:outline-none focus:border-black transition-all"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 opacity-30" />
                        <select 
                          value={sourceFilter}
                          onChange={(e) => setSourceFilter(e.target.value as any)}
                          className="bg-black/5 border border-black/10 p-3 text-xs font-mono uppercase focus:outline-none focus:border-black transition-all"
                        >
                          <option value="All">All Types</option>
                          <option value="Primary">Primary</option>
                          <option value="Secondary">Secondary</option>
                          <option value="Archive">Archive</option>
                          <option value="Upload">Uploads</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                    </div>

                    {sources.length === 0 ? (
                      <div className="text-center py-12 opacity-20 border border-dashed border-black/20 rounded-lg">
                        <BookOpen className="w-12 h-12 mx-auto mb-4" />
                        <p className="font-serif italic text-lg">No sources logged. Keep track of your evidence here.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {sources.filter(s => {
                          const matchesSearch = s.title.toLowerCase().includes(sourceSearch.toLowerCase()) || 
                                               s.notes?.toLowerCase().includes(sourceSearch.toLowerCase());
                          const matchesFilter = sourceFilter === 'All' || s.type === sourceFilter;
                          return matchesSearch && matchesFilter;
                        }).map(source => (
                          <div key={source.id} className={cn(
                            "border border-black p-6 group relative transition-all",
                            source.type === 'Upload' ? "bg-black/5" : "bg-white"
                          )}>
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex gap-2">
                                <span className={cn(
                                  "text-[8px] font-mono px-1 uppercase",
                                  source.type === 'Upload' ? "bg-black text-white" : "bg-black/10 text-black"
                                )}>{source.type}</span>
                                {source.url === 'Local File' && <span className="text-[8px] font-mono bg-emerald-500 text-white px-1 uppercase">Local</span>}
                              </div>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                <button 
                                  onClick={() => setViewingSource(source)} 
                                  className="p-1 hover:bg-black/5"
                                  title="View Full Document"
                                >
                                  <BookOpen className="w-3 h-3" />
                                </button>
                                <button onClick={() => setEditingSource(source)} className="p-1 hover:bg-black/5"><Edit3 className="w-3 h-3" /></button>
                                <button onClick={() => deleteSource(source.id)} className="p-1 hover:bg-red-50 text-red-600"><Trash2 className="w-3 h-3" /></button>
                              </div>
                            </div>
                            <h4 className="font-serif italic text-lg mb-2">{source.title}</h4>
                            {source.url !== 'Local File' ? (
                              <a href={source.url} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-blue-600 hover:underline break-all block mb-4">
                                {source.url}
                              </a>
                            ) : (
                              <div className="flex items-center gap-2 text-[10px] font-mono opacity-40 mb-4">
                                <FileText className="w-3 h-3" />
                                <span>Internal Document</span>
                              </div>
                            )}
                            {source.notes && <p className="text-xs opacity-60 italic border-l border-black/20 pl-3">{source.notes}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Section 1.5: Uploaded Document Sync */}
                  <section className="space-y-8">
                    {isParsing && (
                      <div className="bg-black text-white p-4 border border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] animate-pulse flex items-center gap-3">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-[10px] font-mono uppercase tracking-widest">{parsingProgress}</span>
                      </div>
                    )}

                    {uploadedFiles.length > 0 && (
                      <section>
                        <div className="flex justify-between items-end mb-6 border-b border-black pb-4">
                          <h2 className="text-3xl font-serif italic">Document Sync</h2>
                          <div className="flex items-center gap-4">
                            <p className="text-[10px] font-mono opacity-50 uppercase tracking-widest">{uploadedFiles.length} Files Parsed Across System</p>
                            <label className="cursor-pointer bg-black text-white px-4 py-2 text-[10px] font-mono uppercase hover:bg-black/80 transition-all">
                              Upload New
                              <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                            </label>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {uploadedFiles.map((file, idx) => (
                            <div key={`upload-${idx}`} className="border border-black p-6 bg-stone-50 flex flex-col">
                              <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                  <FileText className="w-5 h-5" />
                                  <h4 className="font-serif italic text-xl">{file.name}</h4>
                                </div>
                                <span className="text-[8px] font-mono bg-black text-white px-2 py-1 uppercase tracking-widest">PARSED</span>
                              </div>
                              <div className="flex-1 max-h-32 overflow-y-auto mb-6 p-4 bg-white border border-black/10 text-[10px] font-mono leading-relaxed opacity-60 whitespace-pre-wrap">
                                {file.content}
                              </div>
                              <div className="flex gap-3">
                                <button 
                                  onClick={() => {
                                    const source = sources.find(s => s.title === `Uploaded: ${file.name}`);
                                    if (source) setViewingSource(source);
                                  }}
                                  className="flex-1 border border-black p-2 text-[9px] font-mono uppercase font-bold hover:bg-black hover:text-white transition-all"
                                >
                                  View Full Text
                                </button>
                                <button 
                                  onClick={() => parseUploadedDocument(file.name, file.content)}
                                  className="flex-1 border border-black p-2 text-[9px] font-mono uppercase font-bold hover:bg-black hover:text-white transition-all"
                                >
                                  Re-Parse
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </section>

                  {/* Section 2: Data Management & Cloud Sync */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Local Data Management */}
                    <section>
                      <h2 className="text-2xl font-serif italic mb-6 border-b border-black pb-4">Local Data Management</h2>
                      <div className="grid grid-cols-1 gap-6">
                        <div className="border border-black p-6 space-y-4">
                          <div className="flex items-center gap-3">
                            <Download className="w-5 h-5" />
                            <h3 className="text-sm font-bold uppercase tracking-tighter">Export Session</h3>
                          </div>
                          <p className="text-xs opacity-70 leading-relaxed">
                            Download your entire research session as a portable <strong>.oden</strong> file.
                          </p>
                          <button 
                            onClick={exportData}
                            className="w-full bg-black text-white p-3 text-[9px] font-mono uppercase font-bold tracking-widest hover:bg-black/90 transition-all flex items-center justify-center gap-2"
                          >
                            Download Package
                          </button>
                        </div>

                        <div className="border border-black p-6 space-y-4">
                          <div className="flex items-center gap-3">
                            <Upload className="w-5 h-5" />
                            <h3 className="text-sm font-bold uppercase tracking-tighter">Import Session</h3>
                          </div>
                          <p className="text-xs opacity-70 leading-relaxed">
                            Load a previously exported research file to continue your investigation.
                          </p>
                          <label className="w-full bg-white border border-black p-3 text-[9px] font-mono uppercase font-bold tracking-widest hover:bg-black/5 transition-all flex items-center justify-center gap-2 cursor-pointer">
                            Upload Package
                            <input type="file" accept=".json" onChange={importData} className="hidden" />
                          </label>
                        </div>

                        <div className="border border-black p-6 space-y-4">
                          <div className="flex items-center gap-3 text-red-600">
                            <Trash className="w-5 h-5" />
                            <h3 className="text-sm font-bold uppercase tracking-tighter">Clear Session</h3>
                          </div>
                          <p className="text-xs opacity-70 leading-relaxed">
                            Wipe all current research data from this browser's local storage.
                          </p>
                          <button 
                            onClick={clearSession}
                            className="w-full border border-red-600 text-red-600 p-3 text-[9px] font-mono uppercase font-bold tracking-widest hover:bg-red-50 transition-all"
                          >
                            Clear All Data
                          </button>
                        </div>
                      </div>
                    </section>

                    {/* Cloud Synchronization */}
                    <section>
                      <h2 className="text-2xl font-serif italic mb-6 border-b border-black pb-4">Cloud Synchronization</h2>
                      <div className="space-y-6">
                        <div className="border border-black p-6 bg-black text-white">
                          <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                              <Network className="w-5 h-5" />
                              <h3 className="text-sm font-bold uppercase tracking-tighter">Cloud Sync</h3>
                            </div>
                            <span className="text-[8px] font-mono bg-white text-black px-2 py-0.5">PREMIUM</span>
                          </div>
                          <p className="opacity-70 leading-relaxed text-xs mb-6">
                            Securely upload your research to the central ODEN repository.
                          </p>
                          <div className="grid grid-cols-1 gap-3">
                            <button 
                              onClick={() => alert("Syncing with odensystem.com... (Feature Mocked)")}
                              className="w-full bg-white text-black p-3 text-[9px] font-mono uppercase font-bold tracking-widest hover:bg-white/90 transition-all flex items-center justify-center gap-2"
                            >
                              Sync with Cloud
                            </button>
                            <label className="w-full border border-white/30 p-3 text-[9px] font-mono uppercase font-bold tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2 cursor-pointer">
                              <Upload className="w-3 h-3" />
                              Upload to Cloud
                              <input type="file" multiple onChange={handleFileUpload} className="hidden" />
                            </label>
                          </div>
                        </div>

                        <div className="border border-black p-6 bg-stone-50">
                          <h4 className="text-[10px] font-mono uppercase font-bold mb-4">Remote Evidence Files</h4>
                          <div className="space-y-3">
                            {[
                              { name: 'Global_Institutional_Map_2025.oden', size: '2.4 MB' },
                              { name: 'Financial_Thread_Analysis_Archive.oden', size: '1.1 MB' }
                            ].map((file) => (
                              <div key={file.name} className="flex justify-between items-center text-[10px] font-mono">
                                <span className="opacity-70">{file.name}</span>
                                <button onClick={() => alert('Remote analysis is premium.')} className="underline">ANALYZE</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'investigation' && (
              <motion.div
                key="investigation"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12"
              >
                <div className="max-w-5xl mx-auto">
                  <div className="flex justify-between items-end mb-6 border-b border-black pb-4">
                    <h2 className="text-3xl font-serif italic">Investigation Log</h2>
                    <div className="flex gap-4">
                      <div className="relative hidden md:flex items-center gap-2">
                        <Filter className="w-3 h-3 opacity-30" />
                        <select 
                          value={investigationFilter}
                          onChange={(e) => setInvestigationFilter(e.target.value as any)}
                          className="bg-black/5 border border-black/10 p-2 text-[10px] font-mono uppercase focus:outline-none focus:border-black transition-all"
                        >
                          <option value="All">All Priorities</option>
                          <option value="High">High Priority</option>
                          <option value="Medium">Medium Priority</option>
                          <option value="Low">Low Priority</option>
                        </select>
                      </div>
                      <div className="relative hidden md:block">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 opacity-30" />
                        <input 
                          type="text"
                          placeholder="Search log..."
                          value={investigationSearch}
                          onChange={(e) => setInvestigationSearch(e.target.value)}
                          className="bg-black/5 border border-black/10 p-2 pl-8 text-[10px] font-mono focus:outline-none focus:border-black transition-all w-48"
                        />
                      </div>
                      <button 
                        onClick={() => setEditingResearchPoint({ id: Math.random().toString(36).substr(2, 9), name: '', type: 'Other', status: 'Pending', priority: 'Medium', notes: '', searchQuery: '', createdAt: new Date().toISOString() })}
                        className="text-[10px] font-mono uppercase bg-black text-white px-4 py-2 hover:bg-black/80 transition-all"
                      >
                        Log New Entry
                      </button>
                    </div>
                  </div>

                  {researchPoints.length === 0 ? (
                    <div className="text-center py-20 opacity-20">
                      <Network className="w-16 h-16 mx-auto mb-4" />
                      <p className="font-serif italic text-xl">No investigation entries logged. Map out institutions, people, or areas to investigate.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {researchPoints.filter(p => {
                        const matchesSearch = p.name.toLowerCase().includes(investigationSearch.toLowerCase()) || 
                                             p.notes.toLowerCase().includes(investigationSearch.toLowerCase());
                        const matchesFilter = investigationFilter === 'All' || p.priority === investigationFilter;
                        return matchesSearch && matchesFilter;
                      }).map(point => (
                        <div key={point.id} className="border border-black p-6 bg-white group relative flex flex-col">
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex gap-2">
                              <span className="text-[8px] font-mono bg-black text-white px-1 uppercase">{point.type}</span>
                              <span className={cn(
                                "text-[8px] font-mono px-1 uppercase border",
                                point.priority === 'High' ? "border-red-600 text-red-600" :
                                point.priority === 'Medium' ? "border-yellow-600 text-yellow-600" :
                                "border-blue-600 text-blue-600"
                              )}>{point.priority}</span>
                            </div>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                              <button onClick={() => setEditingResearchPoint(point)} className="p-1 hover:bg-black/5"><Edit3 className="w-3 h-3" /></button>
                              <button onClick={() => deleteResearchPoint(point.id)} className="p-1 hover:bg-red-50 text-red-600"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          </div>
                          <h4 className="font-serif italic text-xl mb-2">{point.name}</h4>
                          <div className="mb-4">
                            <span className={cn(
                              "text-[9px] font-mono uppercase px-2 py-0.5 border",
                              point.status === 'Completed' ? "bg-green-50 text-green-800 border-green-200" :
                              point.status === 'In Progress' ? "bg-yellow-50 text-yellow-800 border-yellow-200" :
                              point.status === 'Blocked' ? "bg-red-50 text-red-800 border-red-200" :
                              "bg-gray-50 text-gray-800 border-gray-200"
                            )}>{point.status}</span>
                          </div>
                          {point.searchQuery && (
                            <div className="mb-4 p-2 bg-black/5 border-l border-black">
                              <label className="text-[7px] font-mono uppercase opacity-50 block mb-1">Generated Query</label>
                              <p className="text-[10px] font-mono italic break-words">"{point.searchQuery}"</p>
                            </div>
                          )}
                          {point.notes && <p className="text-xs opacity-70 leading-relaxed mb-4 flex-1">{point.notes}</p>}
                          <p className="text-[8px] font-mono opacity-30 mt-auto">Logged: {new Date(point.createdAt).toLocaleDateString()}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}






















            {activeTab === 'suggestions' && (
              <motion.div
                key="suggestions"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-hidden flex flex-col"
              >
                <div className="flex-1 overflow-y-auto p-6 md:p-12 bg-stone-50">
                  <div className="max-w-5xl mx-auto">
                    <div className="flex justify-between items-end mb-10 border-b border-black pb-4">
                      <div>
                        <h2 className="text-3xl font-serif italic">AI Research Suggestions</h2>
                        <p className="text-[10px] font-mono opacity-50 uppercase tracking-widest mt-1">Strategic Analysis of {data?.results?.length || 0} Evidence Points</p>
                      </div>
                      <button 
                        onClick={handleDeepAnalysis}
                        disabled={isAnalyzingSuggestions || !data}
                        className={cn(
                          "px-8 py-4 bg-black text-white text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all flex items-center gap-2",
                          isAnalyzingSuggestions && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {isAnalyzingSuggestions ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" /> Analyzing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" /> Initiate Deep Analysis
                          </>
                        )}
                      </button>
                    </div>

                    {!data ? (
                      <div className="text-center py-20 opacity-20">
                        <Sparkles className="w-16 h-16 mx-auto mb-4" />
                        <p className="font-serif italic text-xl">No research data available. Initiate a pipeline search first.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                        <div className="lg:col-span-12 space-y-12">
                          {/* Strategic Chat - Rethought Layout (More Square) */}
                          <section className="border border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                            <div className="grid grid-cols-1 md:grid-cols-2">
                              <div className="p-6 border-r border-black flex flex-col bg-white">
                                <div className="flex items-center gap-4 mb-4 border-b border-black pb-4">
                                  <Brain className="w-6 h-6" />
                                  <div>
                                    <h3 className="text-lg font-serif italic">Research Strategist</h3>
                                    <p className="text-[8px] font-mono opacity-50 uppercase tracking-widest">Interactive Methodological Advisory</p>
                                  </div>
                                </div>
                                
                                <div className="flex-1 h-[350px] flex flex-col border border-black bg-stone-50">
                                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                    {suggestionChatMessages.length === 0 && (
                                      <div className="text-center py-8 opacity-30">
                                        <MessageSquare className="w-6 h-6 mx-auto mb-2" />
                                        <p className="text-[8px] font-mono uppercase">Ask about the structural significance of your findings.</p>
                                      </div>
                                    )}
                                    {suggestionChatMessages.map((msg, i) => (
                                      <div key={`smsg-${msg.timestamp}-${i}`} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                                        <div className={cn(
                                          "max-w-[90%] p-3 text-[10px] leading-relaxed",
                                          msg.role === 'user' ? "bg-black text-white" : "bg-white border border-black"
                                        )}>
                                          {msg.content}
                                        </div>
                                      </div>
                                    ))}
                                    {suggestionChatLoading && (
                                      <div className="flex justify-start">
                                        <div className="bg-white border border-black p-3 flex gap-2">
                                          <div className="w-1 h-1 bg-black rounded-full animate-bounce" />
                                          <div className="w-1 h-1 bg-black rounded-full animate-bounce [animation-delay:0.2s]" />
                                          <div className="w-1 h-1 bg-black rounded-full animate-bounce [animation-delay:0.4s]" />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <div className="p-3 border-t border-black bg-white">
                                    <form 
                                      onSubmit={(e) => {
                                        e.preventDefault();
                                        const input = e.currentTarget.elements.namedItem('suggestion-input') as HTMLInputElement;
                                        handleSuggestionChat(input.value);
                                        input.value = '';
                                      }}
                                      className="flex gap-2"
                                    >
                                      <input 
                                        name="suggestion-input"
                                        type="text"
                                        placeholder="Ask Strategist..."
                                        className="flex-1 border border-black p-2 text-[10px] focus:outline-none"
                                      />
                                      <button className="bg-black text-white p-2 hover:bg-black/80 transition-all">
                                        <Send className="w-3 h-3" />
                                      </button>
                                    </form>
                                  </div>
                                </div>
                              </div>

                              <div className="p-6 bg-stone-50 flex flex-col justify-between">
                                <div className="space-y-6">
                                  <div className="p-4 bg-black text-white border border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
                                    <h4 className="text-[8px] font-mono uppercase tracking-widest mb-2 opacity-50">Current Strategic Focus</h4>
                                    <p className="text-xs font-serif italic leading-relaxed">
                                      "The current evidence cluster suggests a high degree of institutional opacity. Focus on cross-referencing personnel records with internal memos to identify the nexus of decision-making."
                                    </p>
                                  </div>

                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3 bg-white border border-black">
                                      <h5 className="text-[7px] font-mono uppercase opacity-40 mb-1">Active Gaps</h5>
                                      <p className="text-base font-serif italic">{suggestions.gaps.length + suggestions.institutionalGaps.length}</p>
                                    </div>
                                    <div className="p-3 bg-white border border-black">
                                      <h5 className="text-[7px] font-mono uppercase opacity-40 mb-1">Conflicts</h5>
                                      <p className="text-base font-serif italic">{suggestions.conflicts.length}</p>
                                    </div>
                                  </div>

                                  <div className="space-y-3">
                                    <h4 className="text-[8px] font-mono uppercase tracking-widest opacity-40">Strategic Tools</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                      <button className="p-3 border border-black text-[8px] font-mono uppercase hover:bg-black hover:text-white transition-all bg-white">
                                        Analyze Gaps
                                      </button>
                                      <button className="p-3 border border-black text-[8px] font-mono uppercase hover:bg-black hover:text-white transition-all bg-white">
                                        Verify Links
                                      </button>
                                      <button className="p-3 border border-black text-[8px] font-mono uppercase hover:bg-black hover:text-white transition-all bg-white">
                                        Methodology
                                      </button>
                                      <button className="p-3 border border-black text-[8px] font-mono uppercase hover:bg-black hover:text-white transition-all bg-white">
                                        Export Strat
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-4 pt-4 border-t border-black/10">
                                  <p className="text-[8px] font-mono uppercase opacity-30 italic">
                                    ODEN Strategic Advisory Engine v2.5 // Structural Analysis Mode Active
                                  </p>
                                </div>
                              </div>
                            </div>
                          </section>
                        </div>

                        <div className="lg:col-span-8 space-y-12">
                          {/* Structural Bridges */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Structural Bridges</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Cross-Thread Record Connections</p>
                              </div>
                              <Zap className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="space-y-4">
                              {suggestions.bridges.length > 0 ? suggestions.bridges.map((bridge, idx) => (
                                <div key={`bridge-${bridge.label}-${idx}`} className="border border-black p-8 bg-white hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all group">
                                  <div className="flex items-center gap-2 mb-3">
                                    <Zap className="w-4 h-4 text-yellow-600" />
                                    <span className="text-[10px] font-mono uppercase font-bold tracking-widest">Potential Nexus</span>
                                  </div>
                                  <h4 className="text-2xl font-serif italic mb-3">{bridge.label}</h4>
                                  <p className="text-base opacity-70 leading-relaxed mb-8">{bridge.reason}</p>
                                  <div className="flex flex-wrap gap-2 mb-8">
                                    {bridge.records.map(recordId => {
                                      const record = data?.results?.find(n => n.record_id === recordId);
                                      return (
                                        <span key={recordId} className="text-[10px] font-mono bg-black/5 px-3 py-1.5 border border-black/10 uppercase font-bold">
                                          {record?.label || recordId}
                                        </span>
                                      );
                                    })}
                                  </div>
                                  <button 
                                    onClick={() => {
                                      const newRecord: EvidenceRecord = {
                                        record_id: `bridge-${Date.now()}`,
                                        label: bridge.label,
                                        description: bridge.reason,
                                        status: 'unverified',
                                        record_type: 'Event',
                                        citation: null,
                                        citation_url: '',
                                        citation_type: 'none',
                                        weight: 2
                                      };
                                      const newLinks = bridge.records.map(recordId => ({
                                        source: newRecord.record_id,
                                        target: recordId,
                                        label: 'Bridge Connection'
                                      }));
                                      setData({
                                        ...data,
                                        results: [...(data.results || []), newRecord],
                                        links: [...(data.links || []), ...newLinks]
                                      });
                                      setSuggestions({...suggestions, bridges: suggestions.bridges.filter((_, i) => i !== idx)});
                                    }}
                                    className="w-full md:w-auto px-8 border border-black p-4 text-[10px] font-mono uppercase font-bold hover:bg-black hover:text-white transition-all tracking-widest"
                                  >
                                    Materialize Bridge Record
                                  </button>
                                </div>
                              )) : (
                                <div className="border border-dashed border-black/20 p-12 text-center opacity-40">
                                  <p className="font-serif italic text-lg">No bridge candidates identified. Try broadening your research.</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Evidence Conflicts */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Evidence Conflicts</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Contradictory Data Points Requiring Resolution</p>
                              </div>
                              <ShieldAlert className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="space-y-4">
                              {suggestions.conflicts.length > 0 ? suggestions.conflicts.map((conflict, idx) => (
                                <div key={`conflict-${idx}`} className="border border-black p-6 bg-red-50/30 border-l-4 border-l-red-600">
                                  <h4 className="font-serif italic text-xl mb-2">{conflict.title}</h4>
                                  <p className="text-xs opacity-70 leading-relaxed mb-4">{conflict.description}</p>
                                  <div className="p-3 bg-white border border-black/10 text-[10px] font-mono">
                                    <span className="font-bold uppercase text-red-600 mr-2">Resolution Path:</span>
                                    {conflict.resolution}
                                  </div>
                                </div>
                              )) : (
                                <div className="border border-dashed border-black/20 p-12 text-center opacity-40">
                                  <p className="font-serif italic text-lg">No critical conflicts identified.</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Institutional Gaps */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Institutional Gaps</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Systemic Absences in Record Groups</p>
                              </div>
                              <Building2 className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {suggestions.institutionalGaps && suggestions.institutionalGaps.length > 0 ? suggestions.institutionalGaps.map((gap, idx) => (
                                <div key={`inst-gap-${idx}`} className="border border-black p-6 bg-white hover:bg-stone-50 transition-all">
                                  <h4 className="font-serif italic text-xl mb-2">{gap.label}</h4>
                                  <p className="text-xs opacity-70 leading-relaxed">{gap.description}</p>
                                </div>
                              )) : (
                                <div className="col-span-2 border border-dashed border-black/20 p-12 text-center opacity-40">
                                  <p className="font-serif italic text-lg">No institutional gaps identified.</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Structural Anomalies */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Structural Anomalies</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Deviations from Standard Institutional Logic</p>
                              </div>
                              <Zap className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {suggestions.structuralAnomalies && suggestions.structuralAnomalies.length > 0 ? suggestions.structuralAnomalies.map((anomaly, idx) => (
                                <div key={`struct-anomaly-${idx}`} className="border border-black p-6 bg-white hover:bg-stone-50 transition-all">
                                  <h4 className="font-serif italic text-xl mb-2">{anomaly.title}</h4>
                                  <p className="text-xs opacity-70 leading-relaxed">{anomaly.description}</p>
                                </div>
                              )) : (
                                <div className="col-span-2 border border-dashed border-black/20 p-12 text-center opacity-40">
                                  <p className="font-serif italic text-lg">No structural anomalies detected.</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Pattern Recognition */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Pattern Recognition</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Recurring Structural Signatures</p>
                              </div>
                              <Network className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {suggestions.patternRecognition && suggestions.patternRecognition.length > 0 ? suggestions.patternRecognition.map((pattern, idx) => (
                                <div key={`pattern-${idx}`} className="border border-black p-6 bg-white hover:bg-stone-50 transition-all">
                                  <h4 className="font-serif italic text-xl mb-2">{pattern.title}</h4>
                                  <p className="text-xs opacity-70 leading-relaxed">{pattern.description}</p>
                                </div>
                              )) : (
                                <div className="col-span-2 border border-dashed border-black/20 p-12 text-center opacity-40">
                                  <p className="font-serif italic text-lg">No recurring patterns identified.</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Archival Gaps */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Archival Gaps</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Absence of Required Institutional Records</p>
                              </div>
                              <AlertTriangle className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {suggestions.gaps.length > 0 ? suggestions.gaps.map((gap, idx) => (
                                <div key={`gap-${gap.label}-${idx}`} className="border border-black p-6 bg-white hover:bg-stone-50 transition-all">
                                  <div className="flex items-center gap-2 mb-3">
                                    <AlertTriangle className="w-4 h-4 text-red-600" />
                                    <span className="text-[10px] font-mono uppercase opacity-50 font-bold tracking-widest">Missing Evidence</span>
                                  </div>
                                  <h4 className="font-serif italic text-xl mb-2">{gap.label}</h4>
                                  <p className="text-xs opacity-70 leading-relaxed mb-6">{gap.description}</p>
                                  <button 
                                    onClick={() => {
                                      const newRecord: EvidenceRecord = {
                                        record_id: `gap-${Date.now()}`,
                                        label: gap.label,
                                        description: gap.description,
                                        status: 'gap',
                                        record_type: 'Document',
                                        citation: null,
                                        citation_url: '',
                                        citation_type: 'none',
                                        weight: 3
                                      };
                                      setData({
                                        ...data,
                                        results: [...(data.results || []), newRecord]
                                      });
                                      setSuggestions({...suggestions, gaps: suggestions.gaps.filter((_, i) => i !== idx)});
                                    }}
                                    className="text-[10px] font-mono uppercase font-bold border-b border-black hover:opacity-50 transition-all"
                                  >
                                    Log as Structural Gap
                                  </button>
                                </div>
                              )) : (
                                <div className="col-span-2 border border-dashed border-black/20 p-12 text-center opacity-40">
                                  <p className="font-serif italic text-lg">No specific gaps identified yet.</p>
                                </div>
                              )}
                            </div>
                          </section>
                        </div>

                        <div className="lg:col-span-4 space-y-12">
                          {/* Risk Assessment */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Risk Assessment</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Potential Research Vulnerabilities</p>
                              </div>
                              <ShieldAlert className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="space-y-4">
                              {suggestions.riskAssessment && suggestions.riskAssessment.length > 0 ? suggestions.riskAssessment.map((risk, idx) => (
                                <div key={`risk-${idx}`} className="border border-black p-4 bg-red-50">
                                  <h4 className="font-serif italic text-lg mb-1 text-red-900">{risk.title}</h4>
                                  <p className="text-[10px] text-red-800 mb-2 font-bold uppercase tracking-tighter">Risk: {risk.risk}</p>
                                  <p className="text-[10px] opacity-70 leading-relaxed italic">Mitigation: {risk.mitigation}</p>
                                </div>
                              )) : (
                                <div className="border border-dashed border-black/20 p-8 text-center opacity-40">
                                  <p className="font-serif italic">No critical risks identified.</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Key Actors */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Key Actors</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Primary Entities of Interest</p>
                              </div>
                              <Users className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="space-y-4">
                              {suggestions.keyActors.length > 0 ? suggestions.keyActors.map((actor, idx) => (
                                <div key={`actor-${idx}`} className="border border-black p-4 bg-white">
                                  <h4 className="font-serif italic text-lg mb-1">{actor.name}</h4>
                                  <div className="text-[8px] font-mono uppercase opacity-50 mb-2">{actor.role}</div>
                                  <p className="text-[10px] opacity-70 leading-relaxed">{actor.significance}</p>
                                </div>
                              )) : (
                                <div className="border border-dashed border-black/20 p-8 text-center opacity-40">
                                  <p className="font-serif italic">No key actors identified.</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Methodological Advice */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Methodological Advice</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Strategic Research Guidance</p>
                              </div>
                              <BookOpen className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="space-y-4">
                              {suggestions.methodologicalAdvice.length > 0 ? suggestions.methodologicalAdvice.map((advice, idx) => (
                                <div key={`advice-${idx}`} className="border border-black p-4 bg-stone-900 text-stone-300">
                                  <h4 className="font-serif italic text-lg mb-2 text-white">{advice.title}</h4>
                                  <p className="text-[10px] leading-relaxed italic">"{advice.advice}"</p>
                                </div>
                              )) : (
                                <div className="border border-dashed border-black/20 p-8 text-center opacity-40">
                                  <p className="font-serif italic">No strategic advice available.</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Research Areas */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Suggested Research Areas</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">New Institutional Domains to Scrutinize</p>
                              </div>
                              <Compass className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="space-y-4">
                              {suggestions.researchAreas.length > 0 ? suggestions.researchAreas.map((area, idx) => (
                                <div key={`area-${idx}`} className="border border-black p-6 bg-white flex gap-6 items-start">
                                  <div className={cn(
                                    "w-12 h-12 flex-shrink-0 flex items-center justify-center border border-black",
                                    area.priority === 'High' ? "bg-red-50" : area.priority === 'Medium' ? "bg-yellow-50" : "bg-blue-50"
                                  )}>
                                    <span className="text-[10px] font-mono font-bold">{area.priority[0]}</span>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-serif italic text-xl mb-2">{area.title}</h4>
                                    <p className="text-xs opacity-70 leading-relaxed mb-4">{area.description}</p>
                                    <button 
                                      onClick={() => {
                                        setResearchPoints(prev => [{
                                          id: Math.random().toString(36).substr(2, 9),
                                          name: area.title,
                                          type: 'Record Group',
                                          status: 'Pending',
                                          priority: area.priority,
                                          notes: area.description,
                                          searchQuery: `Investigate ${area.title}`,
                                          createdAt: new Date().toISOString()
                                        }, ...prev]);
                                        setSuggestions({...suggestions, researchAreas: suggestions.researchAreas.filter((_, i) => i !== idx)});
                                      }}
                                      className="text-[10px] font-mono uppercase font-bold border-b border-black hover:opacity-50 transition-all"
                                    >
                                      Add to Research Log
                                    </button>
                                  </div>
                                </div>
                              )) : (
                                <div className="border border-dashed border-black/20 p-12 text-center opacity-40">
                                  <p className="font-serif italic text-lg">Run Deep Analysis to generate new research areas.</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Crossovers */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Interesting Crossovers</h3>
                                <p className="text-[10px] font-mono opacity-50 mt-1 uppercase tracking-widest">Non-Obvious Patterns and Coincidences</p>
                              </div>
                              <Network className="w-4 h-4 opacity-20" />
                            </div>
                            <div className="grid grid-cols-1 gap-6">
                              {suggestions.crossovers.length > 0 ? suggestions.crossovers.map((cross, idx) => (
                                <div key={`cross-${idx}`} className="border border-black p-6 bg-black text-white">
                                  <div className="flex items-center gap-2 mb-3">
                                    <Sparkles className="w-4 h-4 text-emerald-400" />
                                    <span className="text-[10px] font-mono uppercase opacity-50 font-bold tracking-widest">Pattern Detected</span>
                                  </div>
                                  <h4 className="font-serif italic text-xl mb-2">{cross.title}</h4>
                                  <p className="text-xs opacity-70 leading-relaxed mb-4">{cross.description}</p>
                                  <div className="p-3 bg-white/10 border border-white/10 text-[10px] font-mono italic">
                                    Significance: {cross.significance}
                                  </div>
                                </div>
                              )) : (
                                <div className="border border-dashed border-black/20 p-12 text-center opacity-40">
                                  <p className="font-serif italic text-lg text-black">No complex crossovers detected yet.</p>
                                </div>
                              )}
                            </div>
                          </section>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {/* Modals */}
        {viewingRecord && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white text-black w-full max-w-4xl p-8 shadow-2xl overflow-y-auto max-h-[90vh] border border-black"
                >
                  <div className="flex justify-between items-start mb-8 border-b border-black pb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <StatusBadge status={viewingRecord.status} />
                        <span className="text-[10px] font-mono uppercase opacity-40 tracking-widest">{viewingRecord.record_type}</span>
                      </div>
                      <h2 className="text-4xl font-serif italic tracking-tighter">{viewingRecord.label || viewingRecord.description}</h2>
                    </div>
                    <button onClick={() => setViewingRecord(null)} className="text-2xl hover:opacity-50 transition-opacity">✕</button>
                  </div>

                  <div className="grid md:grid-cols-3 gap-12">
                    <div className="md:col-span-2 space-y-8">
                      <section>
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Contextual Analysis</h3>
                        <div className="text-lg leading-relaxed opacity-80 font-serif italic max-h-60 overflow-y-auto pr-4 custom-scrollbar">
                          {viewingRecord.description}
                        </div>
                      </section>

                      {viewingRecord.raw_result && (
                        <section>
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Raw Research Data</h3>
                          <div className="p-6 border border-black/10 bg-stone-50 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto custom-scrollbar">
                            {viewingRecord.raw_result}
                          </div>
                        </section>
                      )}
                    </div>

                    <div className="space-y-8">
                      <section>
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Source Attribution</h3>
                        {viewingRecord.citation_url ? (
                          <a 
                            href={viewingRecord.citation_url} 
                            target="_blank" 
                            rel="noreferrer"
                            className="block p-4 border border-black hover:bg-black hover:text-white transition-all group"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[9px] font-mono uppercase opacity-50 group-hover:opacity-100">Primary Record</span>
                              <ExternalLink className="w-3 h-3" />
                            </div>
                            <p className="text-xs font-bold leading-tight">{viewingRecord.citation || 'View Source Document'}</p>
                          </a>
                        ) : (
                          <p className="text-xs opacity-40 italic">No primary source URL attached.</p>
                        )}
                      </section>

                      <section>
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Structural Weight</h3>
                        <div className="flex items-center gap-4">
                          <div className="flex-1 h-2 bg-black/5">
                            <div className="h-full bg-black" style={{ width: `${(viewingRecord.weight || 1) * 10}%` }} />
                          </div>
                          <span className="text-[10px] font-mono font-bold">{viewingRecord.weight || 1}/10</span>
                        </div>
                      </section>

                      <div className="pt-8 border-t border-black/10">
                        <button 
                          onClick={() => {
                            askAIAboutRecord(viewingRecord);
                            setViewingRecord(null);
                          }}
                          className="w-full bg-black text-white p-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all flex items-center justify-center gap-3"
                        >
                          <Sparkles className="w-4 h-4" /> Ask AI About Record
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}

            {viewingSource && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white text-black w-full max-w-6xl p-0 shadow-2xl overflow-hidden border border-black flex flex-col h-[90vh]"
                >
                  <div className="flex justify-between items-center p-6 border-b border-black bg-stone-50">
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-[10px] font-mono bg-black text-white px-2 py-1 uppercase tracking-widest">{viewingSource.type}</span>
                          <span className="text-[10px] font-mono uppercase opacity-40 tracking-widest">Added {new Date(viewingSource.addedAt).toLocaleDateString()}</span>
                        </div>
                        <h2 className="text-2xl font-serif italic tracking-tighter">{viewingSource.title}</h2>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {viewingSource.url && (
                        <a 
                          href={viewingSource.url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex items-center gap-2 px-4 py-2 border border-black text-[10px] font-mono uppercase hover:bg-black hover:text-white transition-all"
                        >
                          <ExternalLink className="w-3 h-3" /> Original Source
                        </a>
                      )}
                      <button onClick={() => setViewingSource(null)} className="p-2 hover:bg-black/5 transition-opacity">
                        <X className="w-6 h-6" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                    <div className="flex-1 overflow-y-auto p-8 space-y-12 border-r border-black/10">
                      <section>
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Document Content</h3>
                        <div className="p-12 border border-black/10 bg-stone-50 font-mono text-sm leading-relaxed whitespace-pre-wrap shadow-inner">
                          {viewingSource.content || 'Content not available for this source type.'}
                        </div>
                      </section>
                    </div>

                    <div className="w-full md:w-80 bg-stone-50 p-8 overflow-y-auto space-y-8">
                      <section>
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Researcher Notes</h3>
                        <p className="text-sm leading-relaxed opacity-80 font-serif italic">
                          {viewingSource.notes || 'No notes provided for this source.'}
                        </p>
                      </section>

                      {viewingSource.url && (
                        <section>
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Metadata</h3>
                          <div className="space-y-2">
                            <p className="text-[10px] font-mono uppercase opacity-50">Source URL</p>
                            <p className="text-[10px] font-mono break-all opacity-70">{viewingSource.url}</p>
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                </motion.div>
              </div>
            )}

            {editingRecord && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white text-black w-full max-w-2xl p-8 shadow-2xl overflow-y-auto max-h-[90vh] border border-black"
                >
                  <div className="flex justify-between items-center mb-8 border-b border-black pb-4">
                    <h3 className="text-2xl font-serif italic">Edit Record: {editingRecord.label}</h3>
                    <button onClick={() => setEditingRecord(null)} className="text-2xl hover:opacity-50 transition-opacity">✕</button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Label / Name</label>
                        <input 
                          type="text" 
                          value={editingRecord.label}
                          onChange={(e) => setEditingRecord({...editingRecord, label: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Record Type</label>
                        <select 
                          value={editingRecord.record_type}
                          onChange={(e) => setEditingRecord({...editingRecord, record_type: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        >
                          <option value="Person">Person</option>
                          <option value="Institution">Institution</option>
                          <option value="Document">Document</option>
                          <option value="Event">Event</option>
                          <option value="Financial">Financial</option>
                          <option value="Gap">Gap</option>
                          <option value="Location">Location</option>
                          <option value="Record Group">Record Group</option>
                          <option value="Artifact">Artifact</option>
                          <option value="Communication">Communication</option>
                          <option value="Policy">Policy</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Status</label>
                        <select 
                          value={editingRecord.status}
                          onChange={(e) => setEditingRecord({...editingRecord, status: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        >
                          <option value="verified">Verified (Green)</option>
                          <option value="unverified">Unverified (Yellow)</option>
                          <option value="gap">Structural Gap (Red)</option>
                          <option value="incomplete">Incomplete (Gray)</option>
                          <option value="contested">Contested (Purple)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Priority / Weight (1-10)</label>
                        <input 
                          type="number" 
                          min="1" max="10"
                          value={editingRecord.weight || 1}
                          onChange={(e) => setEditingRecord({...editingRecord, weight: parseInt(e.target.value)})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Description</label>
                        <textarea 
                          rows={4}
                          value={editingRecord.description}
                          onChange={(e) => setEditingRecord({...editingRecord, description: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Expected Location / Archive</label>
                        <input 
                          type="text" 
                          value={editingRecord.expected_location || ''}
                          onChange={(e) => setEditingRecord({...editingRecord, expected_location: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="e.g. National Archives RG 59"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Citation URL</label>
                        <input 
                          type="text" 
                          value={editingRecord.citation_url || ''}
                          onChange={(e) => setEditingRecord({...editingRecord, citation_url: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="https://..."
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 border-t border-black pt-8">
                    <h4 className="text-[10px] font-mono uppercase font-bold mb-4">Connections</h4>
                    <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                      {data?.links.filter(l => l.source === editingRecord.record_id || l.target === editingRecord.record_id).map((link, idx) => (
                        <div key={`edit-link-${idx}`} className="flex justify-between items-center p-2 bg-stone-50 border border-black/10 text-[10px] font-mono">
                          <span>{link.source === editingRecord.record_id ? 'TO' : 'FROM'}: {data.results.find(n => n.record_id === (link.source === editingRecord.record_id ? link.target : link.source))?.label || 'Unknown'}</span>
                          <button 
                            onClick={() => {
                              if (!data) return;
                              setData({
                                ...data,
                                links: data.links.filter((_, i) => i !== data.links.indexOf(link))
                              });
                            }}
                            className="text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <select 
                        id="new-link-target"
                        className="flex-1 border border-black p-2 text-[10px] font-mono"
                      >
                        <option value="">Select record to link...</option>
                        {data?.results.filter(n => n.record_id !== editingRecord.record_id).map(n => (
                          <option key={n.record_id} value={n.record_id}>{n.label}</option>
                        ))}
                      </select>
                      <button 
                        onClick={() => {
                          const targetId = (document.getElementById('new-link-target') as HTMLSelectElement).value;
                          if (!targetId || !data) return;
                          setData({
                            ...data,
                            links: [...data.links, { source: editingRecord.record_id, target: targetId, label: 'Manual Connection' }]
                          });
                        }}
                        className="bg-black text-white px-4 py-2 text-[10px] font-mono uppercase"
                      >
                        Add Link
                      </button>
                    </div>
                  </div>

                  <div className="mt-12 flex gap-4">
                    <button 
                      onClick={() => updateRecord(editingRecord)}
                      className="flex-1 bg-black text-white py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/90 transition-all"
                    >
                      Save Changes
                    </button>
                    <button 
                      onClick={() => setEditingRecord(null)}
                      className="flex-1 border border-black py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/5 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              </div>
            )}

            {editingRequest && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white text-black w-full max-w-2xl p-8 shadow-2xl overflow-y-auto max-h-[90vh] border border-black"
                >
                  <div className="flex justify-between items-center mb-8 border-b border-black pb-4">
                    <h3 className="text-2xl font-serif italic">{requests.find(r => r.id === editingRequest.id) ? 'Edit FOIA Request' : 'New FOIA Request'}</h3>
                    <button onClick={() => setEditingRequest(null)} className="text-2xl hover:opacity-50 transition-opacity">✕</button>
                  </div>

                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Recipient Agency</label>
                        <input 
                          type="text" 
                          value={editingRequest.recipient}
                          onChange={(e) => setEditingRequest({...editingRequest, recipient: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="e.g. Department of State"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Status</label>
                        <select 
                          value={editingRequest.status}
                          onChange={(e) => setEditingRequest({...editingRequest, status: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        >
                          <option value="Draft">Draft</option>
                          <option value="Pending">Pending</option>
                          <option value="Sent">Sent</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-mono uppercase font-bold block mb-2">Subject Line</label>
                      <input 
                        type="text" 
                        value={editingRequest.title}
                        onChange={(e) => setEditingRequest({...editingRequest, title: e.target.value, subject: e.target.value})}
                        className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        placeholder="FOIA Request: [Subject]"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-mono uppercase font-bold block mb-2">Request Body</label>
                      <textarea 
                        rows={10}
                        value={editingRequest.body}
                        onChange={(e) => setEditingRequest({...editingRequest, body: e.target.value})}
                        className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                        placeholder="Describe the records you are seeking in detail..."
                      />
                    </div>
                  </div>

                  <div className="mt-12 flex gap-4">
                    <button 
                      onClick={() => {
                        if (requests.find(r => r.id === editingRequest.id)) {
                          updateRequest(editingRequest);
                        } else {
                          addRequest(editingRequest);
                        }
                      }}
                      className="flex-1 bg-black text-white py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/90 transition-all"
                    >
                      {requests.find(r => r.id === editingRequest.id) ? 'Save Changes' : 'Create Request'}
                    </button>
                    <button 
                      onClick={() => setEditingRequest(null)}
                      className="flex-1 border border-black py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/5 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              </div>
            )}

            {editingSource && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white text-black w-full max-w-2xl p-8 shadow-2xl overflow-y-auto max-h-[90vh] border border-black"
                >
                  <div className="flex justify-between items-center mb-8 border-b border-black pb-4">
                    <h3 className="text-2xl font-serif italic">{sources.find(s => s.id === editingSource.id) ? 'Edit Source' : 'Add New Source'}</h3>
                    <button onClick={() => setEditingSource(null)} className="text-2xl hover:opacity-50 transition-opacity">✕</button>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="text-[10px] font-mono uppercase font-bold block mb-2">Source Title</label>
                      <input 
                        type="text" 
                        value={editingSource.title}
                        onChange={(e) => setEditingSource({...editingSource, title: e.target.value})}
                        className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        placeholder="e.g. CIA CREST Record 00012345"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Source Type</label>
                        <select 
                          value={editingSource.type}
                          onChange={(e) => setEditingSource({...editingSource, type: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        >
                          <option value="Primary">Primary</option>
                          <option value="Secondary">Secondary</option>
                          <option value="Archive">Archive</option>
                          <option value="Upload">Upload</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">URL / Location</label>
                        <input 
                          type="text" 
                          value={editingSource.url}
                          onChange={(e) => setEditingSource({...editingSource, url: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="https://..."
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-mono uppercase font-bold block mb-2">Researcher Notes</label>
                      <textarea 
                        rows={6}
                        value={editingSource.notes || ''}
                        onChange={(e) => setEditingSource({...editingSource, notes: e.target.value})}
                        className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                        placeholder="What does this source prove? What are its limitations?"
                      />
                    </div>
                  </div>

                  <div className="mt-12 flex gap-4">
                    <button 
                      onClick={() => {
                        if (sources.find(s => s.id === editingSource.id)) {
                          updateSource(editingSource);
                        } else {
                          addSource(editingSource);
                        }
                      }}
                      className="flex-1 bg-black text-white py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/90 transition-all"
                    >
                      {sources.find(s => s.id === editingSource.id) ? 'Save Changes' : 'Add Source'}
                    </button>
                    <button 
                      onClick={() => setEditingSource(null)}
                      className="flex-1 border border-black py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/5 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

      {/* Footer */}
      <footer className="border-t border-black p-4 flex justify-between items-center bg-white text-[9px] font-mono uppercase opacity-50">
        <div>ODEN v1.0 // Methodological Constraint Active</div>
        <div>{new Date().toISOString()}</div>
      </footer>
      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-black z-50 flex justify-around items-center h-16 px-2 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          <button 
            onClick={() => setActiveTab('pipeline')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'pipeline' ? "text-black" : "text-black/30")}
          >
            <Search className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Search</span>
          </button>
          <button 
            onClick={() => setActiveTab('dossier')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'dossier' ? "text-black" : "text-black/30")}
          >
            <LayoutGrid className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Dossier</span>
          </button>
          <button 
            onClick={() => setActiveTab('chat')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'chat' ? "text-black" : "text-black/30")}
          >
            <History className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Log</span>
          </button>
          <button 
            onClick={() => setActiveTab('requests')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'requests' ? "text-black" : "text-black/30")}
          >
            <Mail className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">FOIA</span>
          </button>
          <button 
            onClick={() => setActiveTab('document-sync')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'document-sync' ? "text-black" : "text-black/30")}
          >
            <Cloud className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Sync</span>
          </button>
          <button 
            onClick={() => setActiveTab('investigation')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'investigation' ? "text-black" : "text-black/30")}
          >
            <List className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Investigation</span>
          </button>
        </nav>
      )}
    </div>
  );
}

function PipelineStep({ label, status }: { label: string, status: 'loading' | 'pending' | 'complete' }) {
  return (
    <div className="flex items-center justify-between p-4 border border-black/10 bg-white/50">
      <div className="flex items-center gap-4">
        {status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 
         status === 'complete' ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : 
         <div className="w-4 h-4 border border-black/20 rounded-full" />}
        <span className="text-xs font-mono uppercase tracking-widest">{label}</span>
      </div>
      <span className="text-[9px] font-mono opacity-50">{status.toUpperCase()}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: EvidenceRecord['status'] }) {
  const styles = {
    verified: "bg-green-100 text-green-800 border-green-200",
    unverified: "bg-yellow-100 text-yellow-800 border-yellow-200",
    gap: "bg-red-100 text-red-800 border-red-200",
    incomplete: "bg-gray-100 text-gray-800 border-gray-200",
    contested: "bg-purple-100 text-purple-800 border-purple-200"
  };
  return (
    <span className={cn("text-[8px] font-mono uppercase px-2 py-0.5 border", styles[status])}>
      {status}
    </span>
  );
}

function LegendItem({ color, label }: { color: string, label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[9px] font-mono uppercase text-white/50">{label}</span>
    </div>
  );
}
