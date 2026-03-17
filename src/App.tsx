import React, { useState, useEffect, useRef } from 'react';
import { Search, Shield, Network, FileText, AlertCircle, CheckCircle2, HelpCircle, Loader2, ArrowRight, ChevronRight, Info, Mail, Edit3, Trash2, Send, BookOpen, ExternalLink, List, History, Save, Download, Upload, Trash } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as d3 from 'd3';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ResearchResponse, Node, BridgeCandidate, Request, Source, ChatMessage, InvestigationItem } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [claim, setClaim] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'graph' | 'list' | 'chat' | 'requests' | 'sources' | 'investigation' | 'save' | 'how-to' | 'blueprint'>('pipeline');
  const [isMobile, setIsMobile] = useState(false);
  const [chatInput, setChatInput] = useState('');

  const askAIAboutNode = (node: Node) => {
    setChatInput(`Tell me more about this ${node.node_type}: "${node.label}". What specific primary sources should I look for to verify its details?`);
    setActiveTab('chat');
  };

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [editingNode, setEditingNode] = useState<Node | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [requests, setRequests] = useState<Request[]>([]);
  const [editingRequest, setEditingRequest] = useState<Request | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [researchPoints, setResearchPoints] = useState<InvestigationItem[]>([]);
  const [editingResearchPoint, setEditingResearchPoint] = useState<InvestigationItem | null>(null);

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
      claim
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

  // --- Gemini AI Client-Side Logic ---
  
  const getGenAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API Key is missing. Please ensure it is configured in the environment.");
    }
    return new GoogleGenAI({ apiKey });
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

  const runResearcher = async (item: any) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { parts: [{ text: `You are an ODEN Primary Source Researcher. Your task is to investigate a specific checklist item strictly against primary sources.
      
      ITEM TO RESEARCH:
      ID: ${item.item_id}
      Description: ${item.description}
      Expected Institutional Location: ${item.expected_location}
      
      METHODOLOGY CONSTRAINTS:
      1. PRIMARY SOURCES ONLY for verification: original documents, institutional records, physical evidence, direct testimony.
      2. SECONDARY SOURCES (Wikipedia, news accounts, documentaries, academic reconstructions) DO NOT qualify as verification. They only inform the search.
      3. NO INFERENCE: Do not connect dots. Report only what is explicitly documented.
      
      Use Google Search to find the specific record at the expected location. Search for archival finding aids, record group descriptions, or digital repositories.
      
      Output ONLY valid JSON: { "item_id": string, "source_found": boolean, "source_type": "primary" | "secondary" | "none", "citation": string | null, "raw_result": string, "timeline_date": string | null, "research_preview": string }.` }] }
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
            raw_result: { type: Type.STRING },
            timeline_date: { type: Type.STRING, nullable: true },
            research_preview: { type: Type.STRING },
          },
          required: ["item_id", "source_found", "source_type", "raw_result", "research_preview"],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const runClassifier = async (results: any[]) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are an ODEN Evidence Classifier. Apply the four-state classification strictly.
      
      RESEARCH RESULTS: ${JSON.stringify(results)}
      
      CLASSIFICATION RULES:
      - VERIFIED: Primary source citation exists and directly confirms the node. NO INFERENCE PERMITTED.
      - UNVERIFIED: Source exists but is secondary, contested, or indirect.
      - GAP: Evidence should structurally exist here by institutional protocol, and it is absent from where it must be. 
      - INCOMPLETE: Search returned no results but no structural expectation of existence has been established.
      - CONTESTED: Multiple primary sources exist but directly contradict each other on this specific node.
      
      THE GAP TEST (Required for GAP status):
      1. Why should this evidence structurally exist? (Name the institutional protocol/process).
      2. Where specifically should it be? (Name the archive/record group/repository).
      
      If BOTH Gap Test questions cannot be answered substantively, you MUST output INCOMPLETE, not GAP.
      
      Output ONLY valid JSON: { "nodes": [{ "node_id": string, "status": "verified" | "unverified" | "gap" | "incomplete" | "contested", "gap_reasoning": { "why_should_exist": string, "where_specifically": string } | null }] }.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            nodes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  node_id: { type: Type.STRING },
                  status: { type: Type.STRING, enum: ["verified", "unverified", "gap", "incomplete", "contested"] },
                  gap_reasoning: {
                    type: Type.OBJECT,
                    properties: {
                      why_should_exist: { type: Type.STRING },
                      where_specifically: { type: Type.STRING },
                    },
                    nullable: true,
                  },
                },
                required: ["node_id", "status"],
              },
            },
          },
          required: ["nodes"],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const runBridgeDetector = async (nodes: any[]) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Scan the following classified nodes for entities (people, institutions, locations) appearing across 3 or more independent verified threads.
      Nodes: ${JSON.stringify(nodes)}
      Output ONLY valid JSON: { "bridge_candidates": [{ "entity": string, "appears_in": string[], "confidence": number }] }.`,
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
          },
          required: ["bridge_candidates"],
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
            nodeCount: data?.results?.length || 0,
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

  const updateNode = (updatedNode: Node) => {
    if (!data) return;
    const newResults = data.results.map(n => n.node_id === updatedNode.node_id ? updatedNode : n);
    setData({ ...data, results: newResults });
    setEditingNode(null);
    setSelectedNode(updatedNode);
  };

  const addManualNode = () => {
    const newNode: Node = {
      node_id: `manual-${Math.random().toString(36).substr(2, 9)}`,
      node_type: 'Event',
      status: 'incomplete',
      label: 'New Node',
      description: 'Manually added node',
      citation: null,
      citation_type: 'none',
      weight: 1
    };
    if (data) {
      setData({ ...data, results: [...data.results, newNode] });
    } else {
      setData({
        neutralized: { neutralized_claim: '', testable_form: '', evidence_categories: [] },
        blueprint: { checklist: [] },
        results: [newNode],
        bridges: { bridge_candidates: [] }
      });
    }
    setEditingNode(newNode);
  };

  const deleteNode = (nodeId: string) => {
    if (!data) return;
    if (confirm('Are you sure you want to delete this node?')) {
      const newResults = data.results.filter(n => n.node_id !== nodeId);
      setData({ ...data, results: newResults });
      setSelectedNode(null);
      setEditingNode(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setUploadedFiles(prev => [...prev, { name: file.name, content, type: file.type }]);
        // Also add to sources as a local note
        const newSource: Source = {
          id: Math.random().toString(36).substr(2, 9),
          title: `Uploaded: ${file.name}`,
          url: 'Local File',
          type: 'Primary',
          addedAt: new Date().toISOString(),
          notes: `User uploaded file: ${file.name}`
        };
        setSources(prev => [newSource, ...prev]);
      };
      reader.readAsText(file);
    });
  };

  const handleResearch = async () => {
    if (!claim.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      // Phase 1: Neutralize
      const neutralized = await runNeutralizer(claim);
      
      // Phase 2: Blueprint
      const blueprint = await runBlueprint(neutralized.testable_form);
      
      // Phase 3: Research
      const researchResults = [];
      for (const item of blueprint.checklist) {
        const result = await runResearcher(item);
        researchResults.push({ ...item, ...result });
      }
      
      // Phase 4: Classify
      const classification = await runClassifier(researchResults);
      const classifiedNodes: Node[] = researchResults.map(r => {
        const c = classification.nodes.find((n: any) => n.node_id === r.item_id);
        return { 
          node_id: r.item_id,
          node_type: r.source_type === 'primary' ? 'Document' : 'Event',
          status: c?.status || "incomplete", 
          label: r.description,
          description: r.research_preview,
          citation: r.citation,
          citation_url: r.citation_url,
          citation_type: r.source_type || 'none',
          gap_reasoning: c?.gap_reasoning,
          weight: r.priority === 'high' ? 3 : r.priority === 'medium' ? 2 : 1
        };
      });
      
      // Phase 5: Bridge Detection
      const bridges = await runBridgeDetector(classifiedNodes);
      
      setData({
        neutralized,
        blueprint,
        results: classifiedNodes,
        bridges
      });
      setActiveTab('graph');
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

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { parts: [{ text: `USER UPLOADED NOTES/DOCUMENTS:\n${filesContext}\n\nCONVERSATION HISTORY:\n${historyContext}\n\nCURRENT INQUIRY: ${userMsg}` }] }
        ],
        config: {
          systemInstruction: `You are a knowledgeable ODEN Research Collaborator. Your goal is to partner with the user to investigate claims using a strict methodological approach.
          
          YOUR PERSONA:
          - You are a peer researcher. Engage in natural back-and-forth conversation.
          - You can answer questions, discuss historical or institutional context, and brainstorm research paths.
          - You are helpful, professional, and intellectually rigorous.
          
          METHODOLOGICAL CONSTRAINTS (Apply these to your brainstorming):
          1. PRIMARY SOURCES ONLY: Always steer the conversation toward finding original records (National Archives, SEC filings, internal memos, etc.).
          2. NO INFERENCE: When brainstorming, clearly distinguish between "what is documented" and "what we need to find." Do not present connections as facts unless documented.
          3. NEUTRALITY: Help the user strip away emotional or narrative framing from their inquiries.
          
          INTERNET ACCESS:
          - You have access to Google Search. Use it to verify facts, find archival links, and identify record groups.
          
          BEHAVIOR:
          - If the user provides notes or documents, analyze them for structural evidence.
          - If the user mentions an entity (person, place, institution) that should be investigated, include it in 'suggestedResearchPoints'.
          - For each suggested research point, generate a precise 'searchQuery' that would help find primary source records.
          - If a specific archival request is needed, generate it in 'generatedRequest'.
          
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

  const deleteRequest = (id: string) => {
    setRequests(prev => prev.filter(r => r.id !== id));
  };

  const saveRequest = (req: Request) => {
    setRequests(prev => prev.map(r => r.id === req.id ? req : r));
    setEditingRequest(null);
  };

  const saveNode = (node: Node) => {
    if (!data) return;
    setData({
      ...data,
      results: data.results.map(n => n.node_id === node.node_id ? node : n)
    });
    if (selectedNode?.node_id === node.node_id) setSelectedNode(node);
    setEditingNode(null);
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
        setActiveTab('graph');
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
      setActiveTab('pipeline');
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-black p-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-serif italic tracking-tight">ODEN</h1>
          <p className="text-[10px] font-mono uppercase opacity-50">Observational Diagnostic Entry Network</p>
        </div>
        <div className="flex items-center gap-4 md:gap-8 overflow-x-auto no-scrollbar px-4 md:px-0">
          <div className="hidden md:flex items-center gap-2 border-r border-black/10 pr-6">
            <div className={cn("w-1.5 h-1.5 rounded-full", error ? "bg-red-500 animate-pulse" : "bg-emerald-500")} />
            <span className="text-[9px] font-mono uppercase opacity-40">
              {error ? "System Error" : "Connected"}
            </span>
          </div>
          <div className="flex gap-3 md:gap-4 text-[9px] md:text-[10px] font-mono uppercase whitespace-nowrap">
            <button 
              onClick={() => setActiveTab('pipeline')}
              className={cn("pb-1 border-b transition-all", activeTab === 'pipeline' ? "border-black opacity-100" : "border-transparent opacity-40")}
            >
              01 Pipeline
            </button>
          <button 
            onClick={() => setActiveTab('graph')}
            className={cn("pb-1 border-b transition-all", activeTab === 'graph' ? "border-black opacity-100" : "border-transparent opacity-40")}
          >
            02 Evidence Map
          </button>
          <button 
            onClick={() => setActiveTab('list')}
            className={cn("pb-1 border-b transition-all", activeTab === 'list' ? "border-black opacity-100" : "border-transparent opacity-40")}
          >
            03 Evidence List
          </button>
          <button 
            onClick={() => setActiveTab('chat')}
            className={cn("pb-1 border-b transition-all", activeTab === 'chat' ? "border-black opacity-100" : "border-transparent opacity-40")}
          >
            04 Research Chat
          </button>
          <button 
            onClick={() => setActiveTab('requests')}
            className={cn("pb-1 border-b transition-all", activeTab === 'requests' ? "border-black opacity-100" : "border-transparent opacity-40")}
          >
            05 Requests {requests.length > 0 && `(${requests.length})`}
          </button>
          <button 
            onClick={() => setActiveTab('sources')}
            className={cn("pb-1 border-b transition-all", activeTab === 'sources' ? "border-black opacity-100" : "border-transparent opacity-40")}
          >
            06 Sources {sources.length > 0 && `(${sources.length})`}
          </button>
          <button 
            onClick={() => setActiveTab('investigation')}
            className={cn("pb-1 border-b transition-all", activeTab === 'investigation' ? "border-black opacity-100" : "border-transparent opacity-40")}
          >
            07 Investigation Log {researchPoints.length > 0 && `(${researchPoints.length})`}
          </button>
          <button 
            onClick={() => setActiveTab('save')}
            className={cn("pb-1 border-b transition-all", activeTab === 'save' ? "border-black opacity-100" : "border-transparent opacity-40")}
          >
            08 Save/Sync
          </button>
          <button 
            onClick={() => setActiveTab('how-to')}
            className={cn("pb-1 border-b transition-all", activeTab === 'how-to' ? "border-black opacity-100" : "border-transparent opacity-40")}
          >
            09 How-To
          </button>
          <button 
            onClick={() => setActiveTab('blueprint')}
            className={cn("pb-1 border-b transition-all", activeTab === 'blueprint' ? "border-black opacity-100" : "border-transparent opacity-40")}
          >
            10 Methodology
          </button>
        </div>
      </div>
    </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
          <AnimatePresence mode="wait">
            {activeTab === 'pipeline' && (
              <motion.div
                key="pipeline"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="h-full overflow-y-auto"
              >
                {/* Hero Section - Only on Pipeline Tab */}
                <section className="py-12 md:py-20 px-4 md:px-8 border-b border-black bg-white">
                  <div className="max-w-4xl mx-auto text-center">
                    <h2 className="text-4xl md:text-6xl font-serif italic mb-6 tracking-tight">Neutralize the Narrative.</h2>
                    <p className="text-sm md:text-base font-mono uppercase opacity-50 mb-10 max-w-2xl mx-auto">
                      Enter a claim to reveal its structural evidence blueprint and identify institutional gaps.
                    </p>
                    <div className="flex flex-col md:flex-row gap-2 max-w-3xl mx-auto">
                      <input
                        type="text"
                        value={claim}
                        onChange={(e) => setClaim(e.target.value)}
                        placeholder="e.g., 'The 1974 archival records were destroyed by...'"
                        className="flex-1 bg-transparent border-2 border-black p-5 font-sans text-lg focus:outline-none focus:ring-0 transition-all placeholder:opacity-30"
                        onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
                      />
                      <button
                        onClick={handleResearch}
                        disabled={loading || !claim.trim()}
                        className="px-10 py-5 bg-black text-white hover:bg-black/90 disabled:opacity-30 transition-all flex items-center justify-center gap-3"
                      >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                        <span className="text-xs font-mono uppercase font-bold tracking-widest">Initiate Research</span>
                      </button>
                    </div>
                    
                    <div className="mt-8 flex justify-center gap-4">
                      <label className="cursor-pointer text-[10px] font-mono uppercase border border-black/20 px-4 py-2 hover:bg-black hover:text-white transition-all flex items-center gap-2">
                        <Upload className="w-3 h-3" />
                        <span>Upload Research Notes</span>
                        <input type="file" className="hidden" multiple onChange={handleFileUpload} />
                      </label>
                      {uploadedFiles.length > 0 && (
                        <span className="text-[10px] font-mono uppercase opacity-50 flex items-center">
                          {uploadedFiles.length} files uploaded
                        </span>
                      )}
                    </div>

                    {error && (
                      <p className="mt-4 text-red-600 text-[10px] font-mono uppercase flex items-center justify-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {error}
                      </p>
                    )}
                  </div>
                </section>

                <div className="p-8">
                  <div className="max-w-4xl mx-auto mb-12 border-b border-black pb-8">
                  <h2 className="text-3xl font-serif italic mb-4">Intake Research Pipeline</h2>
                  <p className="text-sm opacity-70 leading-relaxed mb-4">
                    The ODEN Pipeline is a multi-stage diagnostic engine designed to strip narrative bias and reveal the structural evidence required to verify or falsify a claim.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-[11px] font-mono uppercase">
                    <div className="p-4 border border-black bg-black/5">
                      <p className="font-bold mb-2">How it works:</p>
                      <ul className="space-y-1 opacity-70">
                        <li>• Neutralizes emotional framing</li>
                        <li>• Generates an institutional blueprint</li>
                        <li>• Scans primary archives & records</li>
                        <li>• Identifies structural evidence gaps</li>
                      </ul>
                    </div>
                    <div className="p-4 border border-black bg-black/5">
                      <p className="font-bold mb-2">Intake Interaction:</p>
                      <p className="opacity-70 normal-case leading-relaxed">
                        Your input claim acts as the seed. The pipeline uses it to deduce which record groups (financial, archival, communication) *must* exist if the claim is structurally valid.
                      </p>
                    </div>
                  </div>
                </div>

                {!data && !loading && (
                  <div className="h-full flex flex-col items-center justify-center opacity-20 text-center">
                    <Shield className="w-16 h-16 mb-4" />
                    <p className="font-serif italic text-xl">System Idle. Awaiting Claim Input.</p>
                  </div>
                )}

                {loading && (
                  <div className="max-w-2xl mx-auto space-y-8">
                    <PipelineStep label="01 Neutralizing Claim" status="loading" />
                    <PipelineStep label="02 Generating Blueprint" status="pending" />
                    <PipelineStep label="03 Primary Source Research" status="pending" />
                    <PipelineStep label="04 Node Classification" status="pending" />
                    <PipelineStep label="05 Bridge Detection" status="pending" />
                  </div>
                )}

                {data && (
                  <div className="max-w-4xl mx-auto space-y-12">
                    <section>
                      <h3 className="col-header mb-4">Neutralized Claim</h3>
                      <div className="p-6 border border-black bg-white">
                        <p className="font-serif text-xl italic mb-2">"{data.neutralized.neutralized_claim}"</p>
                        <div className="flex gap-2 mt-4">
                          {data.neutralized.evidence_categories.map(cat => (
                            <span key={cat} className="text-[9px] font-mono uppercase px-2 py-1 bg-black/5 border border-black/10">
                              {cat}
                            </span>
                          ))}
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="col-header mb-4">Pipeline Execution Log</h3>
                      <div className="space-y-2">
                        {data.results.map((node, i) => (
                          <div key={node.node_id} className="data-row p-4 flex items-center justify-between bg-white/30">
                            <div className="flex items-center gap-4">
                              <span className="text-[10px] font-mono opacity-30">{(i + 1).toString().padStart(2, '0')}</span>
                              <div>
                                <p className="text-xs font-medium">{node.label || node.description}</p>
                                <p className="text-[9px] font-mono opacity-50 uppercase">{node.expected_location}</p>
                              </div>
                            </div>
                            <StatusBadge status={node.status} />
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </div>
            </motion.div>
          )}

            {activeTab === 'graph' && (
              <motion.div
                key="graph"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col md:flex-row relative"
              >
                <div className="flex-1 bg-[#0a0a0a] relative overflow-hidden">
                  {/* Scanline Effect */}
                  <div className="absolute inset-0 pointer-events-none z-10 opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
                  
                  <ForceGraph 
                    nodes={data?.results || []} 
                    onNodeClick={(node) => {
                      setSelectedNode(node);
                      if (window.innerWidth < 768) setIsSidebarOpen(true);
                    }} 
                  />
                  
                  <div className="absolute top-6 right-6 flex flex-col md:flex-row gap-2 z-20">
                    <button 
                      onClick={addManualNode}
                      className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-white/20 flex items-center gap-2 transition-all backdrop-blur-sm"
                    >
                      <Edit3 className="w-3 h-3" /> Add Manual Node
                    </button>
                    <div className="bg-black/40 backdrop-blur-md border border-white/10 p-4 space-y-3">
                      <LegendItem color="#22c55e" label="Verified" />
                      <LegendItem color="#eab308" label="Unverified" />
                      <LegendItem color="#ef4444" label="Gap" />
                      <LegendItem color="#6b7280" label="Incomplete" />
                    </div>
                  </div>

                  <button 
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="absolute top-6 right-6 z-30 p-2 bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all md:hidden"
                  >
                    {isSidebarOpen ? <ChevronRight className="rotate-180" /> : <Info />}
                  </button>
                </div>
                
                <AnimatePresence>
                  {isSidebarOpen && (
                    <motion.aside 
                      initial={{ x: '100%' }}
                      animate={{ x: 0 }}
                      exit={{ x: '100%' }}
                      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                      className="absolute inset-y-0 right-0 w-full md:relative md:w-96 border-l border-black bg-white overflow-y-auto p-6 z-40"
                    >
                      <button 
                        onClick={() => setIsSidebarOpen(false)}
                        className="absolute top-4 right-4 p-2 md:hidden"
                      >
                        <ChevronRight className="rotate-180" />
                      </button>

                      <h3 className="col-header mb-6">Bridge Node Candidates</h3>
                  {data?.bridges.bridge_candidates.length ? (
                    <div className="space-y-4">
                      {data.bridges.bridge_candidates.map(bridge => (
                        <div key={bridge.entity} className="p-4 border border-black bg-black/5">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-serif italic text-lg">{bridge.entity}</h4>
                            <span className="text-[9px] font-mono bg-black text-white px-1">BRIDGE</span>
                          </div>
                          <p className="text-[10px] font-mono opacity-50 mb-3">Appears in {bridge.appears_in.length} independent threads</p>
                          <div className="flex flex-wrap gap-1">
                            {bridge.appears_in.map(id => (
                              <span key={id} className="text-[8px] font-mono border border-black/20 px-1">
                                {id.slice(0, 4)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] font-mono opacity-30 italic">No bridge nodes detected in current map.</p>
                  )}

                  <div className="mt-12">
                    <h3 className="col-header mb-4">Node Inspector</h3>
                    {selectedNode ? (
                      <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="flex justify-between items-start">
                          <h4 className="font-serif italic text-xl">{selectedNode.label || selectedNode.description}</h4>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={selectedNode.status} />
                            <button 
                              onClick={() => setEditingNode(selectedNode)}
                              className="p-1 hover:bg-black/5 rounded transition-all"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        
                        <div className="space-y-3">
                          {selectedNode.citation_url && (
                            <a 
                              href={selectedNode.citation_url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-[10px] font-mono text-blue-600 hover:underline flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" /> View Primary Source
                            </a>
                          )}
                          <div>
                            <p className="col-header text-[9px] mb-1">Expected Location</p>
                            <p className="text-xs font-mono bg-black/5 p-2 border border-black/10">{selectedNode.expected_location}</p>
                          </div>

                          {selectedNode.status === 'gap' && selectedNode.gap_reasoning && (
                            <div className="p-3 border border-red-200 bg-red-50 space-y-2">
                              <p className="text-[9px] font-mono uppercase text-red-800 font-bold">Structural Gap Detected</p>
                              <div>
                                <p className="text-[8px] font-mono uppercase opacity-50">Why should it exist?</p>
                                <p className="text-[11px] leading-relaxed">{selectedNode.gap_reasoning.why_should_exist}</p>
                              </div>
                              <div>
                                <p className="text-[8px] font-mono uppercase opacity-50">Where specifically?</p>
                                <p className="text-[11px] leading-relaxed">{selectedNode.gap_reasoning.where_specifically}</p>
                              </div>
                            </div>
                          )}

                          {selectedNode.citation && (
                            <div>
                              <p className="col-header text-[9px] mb-1">Primary Citation</p>
                              <p className="text-xs italic border-l-2 border-black pl-3 py-1">{selectedNode.citation}</p>
                            </div>
                          )}

                          {selectedNode.raw_result && (
                            <div>
                              <p className="col-header text-[9px] mb-1">Research Data</p>
                              <div className="text-[11px] leading-relaxed opacity-80 max-h-48 overflow-y-auto scrollbar-thin pr-2">
                                {selectedNode.raw_result}
                              </div>
                            </div>
                          )}

                          {selectedNode.research_preview && (
                            <div className="p-4 border border-black bg-black text-white">
                              <p className="text-[9px] font-mono uppercase opacity-50 mb-2">Research Preview</p>
                              <p className="text-xs leading-relaxed italic">
                                {selectedNode.research_preview}
                              </p>
                            </div>
                          )}

                          <button 
                            onClick={() => askAIAboutNode(selectedNode)}
                            className="w-full border border-black p-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black hover:text-white transition-all flex items-center justify-center gap-2"
                          >
                            <Send className="w-3 h-3" /> Research with AI
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[10px] font-mono opacity-30 italic">Select a node in the graph to inspect evidence.</p>
                    )}
                  </div>
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
                    <h2 className="text-3xl font-serif italic">Evidence Inventory</h2>
                    <p className="text-[10px] font-mono opacity-50 uppercase">{data?.results.length || 0} Structural Nodes Logged</p>
                  </div>

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
                            <th className="p-4 border-r border-white/20">Label / Description</th>
                            <th className="p-4 border-r border-white/20">Citation</th>
                            <th className="p-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="text-xs">
                          {data.results.map(node => (
                            <tr key={node.node_id} className="border-b border-black hover:bg-black/5 transition-all">
                              <td className="p-4 border-r border-black">
                                <StatusBadge status={node.status} />
                              </td>
                              <td className="p-4 border-r border-black font-mono text-[10px] uppercase opacity-60">
                                {node.node_type}
                              </td>
                              <td className="p-4 border-r border-black">
                                <p className="font-bold mb-1">{node.label}</p>
                                <p className="opacity-70 line-clamp-2">{node.description}</p>
                              </td>
                              <td className="p-4 border-r border-black">
                                {node.citation_url ? (
                                  <a href={node.citation_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                                    <ExternalLink className="w-3 h-3" /> {node.citation || 'View Source'}
                                  </a>
                                ) : (
                                  <span className="opacity-40 italic">{node.citation || 'No citation'}</span>
                                )}
                              </td>
                              <td className="p-4">
                                <button 
                                  onClick={() => {
                                    setSelectedNode(node);
                                    setEditingNode(node);
                                  }}
                                  className="p-2 hover:bg-black hover:text-white transition-all rounded"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
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
                  <p className="text-[10px] font-mono opacity-50 uppercase">Thinking Process Archive</p>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 mb-4 scrollbar-thin pr-2">
                  {chatMessages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center opacity-20 text-center">
                      <HelpCircle className="w-16 h-16 mb-4" />
                      <p className="font-serif italic text-xl">Direct Inquiry Mode. Ask for structural deep-dives.</p>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
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
                  <div className="flex justify-between items-end mb-10 border-b border-black pb-4">
                    <h2 className="text-3xl font-serif italic">Archival & FOIA Requests</h2>
                    <p className="text-[10px] font-mono opacity-50 uppercase">{requests.length} Document Inquiries Active</p>
                  </div>

                  {requests.length === 0 ? (
                    <div className="text-center py-20 opacity-20">
                      <Mail className="w-16 h-16 mx-auto mb-4" />
                      <p className="font-serif italic text-xl">No requests generated yet. Use the Research Chat to identify gaps.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-6">
                      {requests.map(req => (
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

                {/* Node Edit Modal */}
                <AnimatePresence>
                  {editingNode && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
                    >
                      <motion.div 
                        initial={{ scale: 0.95, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        className="bg-white border border-black w-full max-w-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
                      >
                        <h3 className="text-2xl font-serif italic mb-6 border-b border-black pb-4">Edit Node Evidence</h3>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Label</label>
                              <input 
                                type="text" 
                                value={editingNode.label}
                                onChange={(e) => setEditingNode({...editingNode, label: e.target.value})}
                                className="w-full border border-black p-2 text-sm focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Status</label>
                              <select 
                                value={editingNode.status}
                                onChange={(e) => setEditingNode({...editingNode, status: e.target.value as any})}
                                className="w-full border border-black p-2 text-sm focus:outline-none"
                              >
                                <option value="verified">Verified</option>
                                <option value="unverified">Unverified</option>
                                <option value="gap">Gap</option>
                                <option value="incomplete">Incomplete</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Description</label>
                            <textarea 
                              rows={3}
                              value={editingNode.description}
                              onChange={(e) => setEditingNode({...editingNode, description: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Primary Citation (Text)</label>
                            <input 
                              type="text" 
                              value={editingNode.citation || ''}
                              onChange={(e) => setEditingNode({...editingNode, citation: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Source URL</label>
                            <input 
                              type="text" 
                              value={editingNode.citation_url || ''}
                              onChange={(e) => setEditingNode({...editingNode, citation_url: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                              placeholder="https://unverifiableonline.com/..."
                            />
                          </div>
                        </div>
                        <div className="flex gap-4 mt-8">
                          <button 
                            onClick={() => saveNode(editingNode)}
                            className="flex-1 bg-black text-white p-3 text-[10px] font-mono uppercase font-bold tracking-widest"
                          >
                            Save Node
                          </button>
                          <button 
                            onClick={() => setEditingNode(null)}
                            className="px-8 border border-black p-3 text-[10px] font-mono uppercase"
                          >
                            Cancel
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Source Edit Modal */}
                <AnimatePresence>
                  {editingSource && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
                    >
                      <motion.div 
                        initial={{ scale: 0.95, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        className="bg-white border border-black w-full max-w-md p-8 shadow-2xl"
                      >
                        <h3 className="text-2xl font-serif italic mb-6 border-b border-black pb-4">Log Source</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Title</label>
                            <input 
                              type="text" 
                              value={editingSource.title}
                              onChange={(e) => setEditingSource({...editingSource, title: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">URL</label>
                            <input 
                              type="text" 
                              value={editingSource.url}
                              onChange={(e) => setEditingSource({...editingSource, url: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Type</label>
                            <select 
                              value={editingSource.type}
                              onChange={(e) => setEditingSource({...editingSource, type: e.target.value as any})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                            >
                              <option value="Primary">Primary</option>
                              <option value="Secondary">Secondary</option>
                              <option value="Archive">Archive</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Notes</label>
                            <textarea 
                              rows={3}
                              value={editingSource.notes}
                              onChange={(e) => setEditingSource({...editingSource, notes: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                            />
                          </div>
                        </div>
                        <div className="flex gap-4 mt-8">
                          <button 
                            onClick={() => saveSource(editingSource)}
                            className="flex-1 bg-black text-white p-3 text-[10px] font-mono uppercase font-bold tracking-widest"
                          >
                            Save Source
                          </button>
                          <button 
                            onClick={() => setEditingSource(null)}
                            className="px-8 border border-black p-3 text-[10px] font-mono uppercase"
                          >
                            Cancel
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {editingRequest && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
                    >
                      <motion.div 
                        initial={{ scale: 0.95, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        className="bg-white border border-black w-full max-w-2xl p-8 shadow-2xl"
                      >
                        <h3 className="text-2xl font-serif italic mb-6 border-b border-black pb-4">Edit Request Template</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Recipient</label>
                            <input 
                              type="text" 
                              value={editingRequest.recipient}
                              onChange={(e) => setEditingRequest({...editingRequest, recipient: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Subject</label>
                            <input 
                              type="text" 
                              value={editingRequest.subject}
                              onChange={(e) => setEditingRequest({...editingRequest, subject: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Body</label>
                            <textarea 
                              rows={10}
                              value={editingRequest.body}
                              onChange={(e) => setEditingRequest({...editingRequest, body: e.target.value})}
                              className="w-full border border-black p-3 text-sm focus:outline-none font-sans leading-relaxed"
                            />
                          </div>
                        </div>
                        <div className="flex gap-4 mt-8">
                          <button 
                            onClick={() => saveRequest(editingRequest)}
                            className="flex-1 bg-black text-white p-3 text-[10px] font-mono uppercase font-bold tracking-widest"
                          >
                            Save Changes
                          </button>
                          <button 
                            onClick={() => setEditingRequest(null)}
                            className="px-8 border border-black p-3 text-[10px] font-mono uppercase"
                          >
                            Cancel
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Research Point Edit Modal */}
                <AnimatePresence>
                  {editingResearchPoint && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
                    >
                      <motion.div 
                        initial={{ scale: 0.95, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        className="bg-white border border-black w-full max-w-md p-8 shadow-2xl"
                      >
                        <h3 className="text-2xl font-serif italic mb-6 border-b border-black pb-4">Log Investigation Entry</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Name / Entity</label>
                            <input 
                              type="text" 
                              value={editingResearchPoint.name}
                              onChange={(e) => setEditingResearchPoint({...editingResearchPoint, name: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                              placeholder="e.g. National Archives Record Group 59"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Search Query (Generated)</label>
                            <input 
                              type="text" 
                              value={editingResearchPoint.searchQuery || ''}
                              onChange={(e) => setEditingResearchPoint({...editingResearchPoint, searchQuery: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none font-mono italic"
                              placeholder="e.g. site:archives.gov 'Record Group 59'"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Type</label>
                              <select 
                                value={editingResearchPoint.type}
                                onChange={(e) => setEditingResearchPoint({...editingResearchPoint, type: e.target.value as any})}
                                className="w-full border border-black p-2 text-sm focus:outline-none"
                              >
                                <option value="Institution">Institution</option>
                                <option value="Person">Person</option>
                                <option value="Location">Location</option>
                                <option value="Record Group">Record Group</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Priority</label>
                              <select 
                                value={editingResearchPoint.priority}
                                onChange={(e) => setEditingResearchPoint({...editingResearchPoint, priority: e.target.value as any})}
                                className="w-full border border-black p-2 text-sm focus:outline-none"
                              >
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Low">Low</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Status</label>
                            <select 
                              value={editingResearchPoint.status}
                              onChange={(e) => setEditingResearchPoint({...editingResearchPoint, status: e.target.value as any})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                            >
                              <option value="Pending">Pending</option>
                              <option value="In Progress">In Progress</option>
                              <option value="Completed">Completed</option>
                              <option value="Blocked">Blocked</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] font-mono uppercase opacity-50 block mb-1">Notes / Objectives</label>
                            <textarea 
                              rows={4}
                              value={editingResearchPoint.notes}
                              onChange={(e) => setEditingResearchPoint({...editingResearchPoint, notes: e.target.value})}
                              className="w-full border border-black p-2 text-sm focus:outline-none"
                              placeholder="What specifically needs to be found here?"
                            />
                          </div>
                        </div>
                        <div className="flex gap-4 mt-8">
                          <button 
                            onClick={() => saveResearchPoint(editingResearchPoint)}
                            className="flex-1 bg-black text-white p-3 text-[10px] font-mono uppercase font-bold tracking-widest"
                          >
                            Save Point
                          </button>
                          <button 
                            onClick={() => setEditingResearchPoint(null)}
                            className="px-8 border border-black p-3 text-[10px] font-mono uppercase"
                          >
                            Cancel
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {activeTab === 'sources' && (
              <motion.div
                key="sources"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12"
              >
                <div className="max-w-5xl mx-auto">
                  <div className="flex justify-between items-end mb-10 border-b border-black pb-4">
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

                  {sources.length === 0 && uploadedFiles.length === 0 ? (
                    <div className="text-center py-20 opacity-20">
                      <BookOpen className="w-16 h-16 mx-auto mb-4" />
                      <p className="font-serif italic text-xl">No sources logged. Keep track of your evidence here.</p>
                    </div>
                  ) : (
                    <div className="space-y-12">
                      {uploadedFiles.length > 0 && (
                        <section>
                          <h3 className="col-header mb-6">Uploaded Research Notes</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {uploadedFiles.map((file, idx) => (
                              <div key={idx} className="border border-black p-6 bg-black/5 relative group">
                                <div className="flex justify-between items-start mb-2">
                                  <span className="text-[8px] font-mono bg-black text-white px-1 uppercase">Local Note</span>
                                  <button 
                                    onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== idx))}
                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 text-red-600 transition-all"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                                <h4 className="font-serif italic text-lg mb-2">{file.name}</h4>
                                <div className="max-h-32 overflow-y-auto scrollbar-thin pr-2">
                                  <p className="text-xs opacity-70 leading-relaxed whitespace-pre-wrap">{file.content}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      <section>
                        <h3 className="col-header mb-6">External Sources & Archives</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {sources.filter(s => s.url !== 'Local File').map(source => (
                            <div key={source.id} className="border border-black p-6 bg-white group relative">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[8px] font-mono bg-black text-white px-1 uppercase">{source.type}</span>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                  <button onClick={() => setEditingSource(source)} className="p-1 hover:bg-black/5"><Edit3 className="w-3 h-3" /></button>
                                  <button onClick={() => deleteSource(source.id)} className="p-1 hover:bg-red-50 text-red-600"><Trash2 className="w-3 h-3" /></button>
                                </div>
                              </div>
                              <h4 className="font-serif italic text-lg mb-2">{source.title}</h4>
                              <a href={source.url} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-blue-600 hover:underline break-all block mb-4">
                                {source.url}
                              </a>
                              {source.notes && <p className="text-xs opacity-60 italic border-l border-black/20 pl-3">{source.notes}</p>}
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  )}
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
                  <div className="flex justify-between items-end mb-10 border-b border-black pb-4">
                    <h2 className="text-3xl font-serif italic">Investigation Log</h2>
                    <button 
                      onClick={() => setEditingResearchPoint({ id: Math.random().toString(36).substr(2, 9), name: '', type: 'Other', status: 'Pending', priority: 'Medium', notes: '', searchQuery: '', createdAt: new Date().toISOString() })}
                      className="text-[10px] font-mono uppercase bg-black text-white px-4 py-2 hover:bg-black/80 transition-all"
                    >
                      Log New Entry
                    </button>
                  </div>

                  {researchPoints.length === 0 ? (
                    <div className="text-center py-20 opacity-20">
                      <Network className="w-16 h-16 mx-auto mb-4" />
                      <p className="font-serif italic text-xl">No investigation entries logged. Map out institutions, people, or areas to investigate.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {researchPoints.map(point => (
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

            {activeTab === 'save' && (
              <motion.div
                key="save"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12"
              >
                <div className="max-w-3xl mx-auto">
                  <h2 className="text-4xl font-serif italic mb-10 border-b border-black pb-6">Data Management</h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="border border-black p-8 space-y-6">
                      <div className="flex items-center gap-3 mb-2">
                        <Download className="w-6 h-6" />
                        <h3 className="text-xl font-bold uppercase tracking-tighter">Export Session</h3>
                      </div>
                      <p className="text-sm opacity-70 leading-relaxed">
                        Download your entire research session as a portable <strong>.oden</strong> (JSON) file. This includes the graph, chat logs, sources, and requests.
                      </p>
                      <button 
                        onClick={exportData}
                        className="w-full bg-black text-white p-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/90 transition-all flex items-center justify-center gap-2"
                      >
                        Download Research Package
                      </button>
                    </div>

                    <div className="border border-black p-8 space-y-6">
                      <div className="flex items-center gap-3 mb-2">
                        <Upload className="w-6 h-6" />
                        <h3 className="text-xl font-bold uppercase tracking-tighter">Import Session</h3>
                      </div>
                      <p className="text-sm opacity-70 leading-relaxed">
                        Load a previously exported research file to continue your investigation exactly where you left off.
                      </p>
                      <label className="w-full bg-white border border-black p-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/5 transition-all flex items-center justify-center gap-2 cursor-pointer">
                        Upload Research Package
                        <input type="file" accept=".json" onChange={importData} className="hidden" />
                      </label>
                    </div>

                    <div className="border border-black p-8 space-y-6">
                      <div className="flex items-center gap-3 mb-2 text-red-600">
                        <Trash className="w-6 h-6" />
                        <h3 className="text-xl font-bold uppercase tracking-tighter">Clear Session</h3>
                      </div>
                      <p className="text-sm opacity-70 leading-relaxed">
                        Wipe all current research data from this browser's local storage. <strong>Warning: This action is permanent.</strong>
                      </p>
                      <button 
                        onClick={clearSession}
                        className="w-full border border-red-600 text-red-600 p-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-red-50 transition-all"
                      >
                        Clear All Data
                      </button>
                    </div>

                    <div className="border border-black p-8 space-y-6 bg-black text-white">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <Network className="w-6 h-6" />
                          <h3 className="text-xl font-bold uppercase tracking-tighter">Cloud Sync</h3>
                        </div>
                        <span className="text-[9px] font-mono bg-white text-black px-2 py-1">PREMIUM</span>
                      </div>
                      <p className="opacity-70 leading-relaxed text-sm">
                        Seamlessly upload your research to the central ODEN repository at <span className="underline">odensystem.com</span>.
                      </p>
                      <button 
                        onClick={() => alert("Syncing with odensystem.com... (Feature Mocked)")}
                        className="w-full bg-white text-black p-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-white/90 transition-all flex items-center justify-center gap-2"
                      >
                        Sync with Cloud
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'how-to' && (
              <motion.div
                key="how-to"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12 bg-white"
              >
                <div className="max-w-4xl mx-auto">
                  <h2 className="text-5xl font-serif italic mb-4 tracking-tight">Getting Started with ODEN</h2>
                  <p className="text-xl opacity-60 mb-12 font-sans">A beginner's guide to the Observational Diagnostic Entry Network.</p>
                  
                  <div className="grid md:grid-cols-2 gap-12">
                    <section className="space-y-6">
                      <div className="p-8 border border-black/10 bg-stone-50 rounded-2xl">
                        <h3 className="text-lg font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                          <Search className="w-5 h-5" /> 01. The Search
                        </h3>
                        <p className="text-sm leading-relaxed opacity-80">
                          Enter any claim or research topic in the <strong>Pipeline</strong> tab. ODEN doesn't just "search the web"—it breaks your claim into institutional components. It asks: <em>"If this were true, what records would exist, and where would they be held?"</em>
                        </p>
                      </div>

                      <div className="p-8 border border-black/10 bg-stone-50 rounded-2xl">
                        <h3 className="text-lg font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                          <Network className="w-5 h-5" /> 02. The Evidence Map
                        </h3>
                        <p className="text-sm leading-relaxed opacity-80">
                          This is your visual workspace. Nodes represent people, institutions, or documents. 
                          <br/><br/>
                          <strong>Event Nodes:</strong> Specific historical occurrences.
                          <br/>
                          <strong>Gap Nodes:</strong> These are the most important. A "Gap" is a piece of evidence that <em>should</em> exist by institutional protocol but cannot be found. Gaps are the "fingerprints" of missing history.
                        </p>
                      </div>
                    </section>

                    <section className="space-y-6">
                      <div className="p-8 border border-black/10 bg-stone-50 rounded-2xl">
                        <h3 className="text-lg font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                          <Mail className="w-5 h-5" /> 03. FOIA & Requests
                        </h3>
                        <p className="text-sm leading-relaxed opacity-80">
                          When the AI finds a "Gap" or an archive it can't reach (like a physical-only government file), it suggests a <strong>FOIA (Freedom of Information Act)</strong> request. 
                          <br/><br/>
                          Go to the <strong>FOIA</strong> tab to find pre-written templates you can send to agencies to get the real documents.
                        </p>
                      </div>

                      <div className="p-8 border border-black/10 bg-stone-50 rounded-2xl">
                        <h3 className="text-lg font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                          <Edit3 className="w-5 h-5" /> 04. Full Editability
                        </h3>
                        <p className="text-sm leading-relaxed opacity-80">
                          You are the lead researcher. You can click any node to edit its details, change its status, or add your own notes. You can even add manual nodes and connections to build out the map as you find your own evidence.
                        </p>
                      </div>
                    </section>
                  </div>

                  <div className="mt-16 p-12 border-t border-black/10">
                    <h3 className="text-2xl font-serif italic mb-6">Why use ODEN?</h3>
                    <p className="text-lg opacity-70 leading-relaxed max-w-2xl">
                      Traditional AI often hallucinates or summarizes news. ODEN is built for <strong>Primary Source Verification</strong>. It forces the research to stay grounded in institutional facts—records, filings, and physical traces—rather than opinions or narratives.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'blueprint' && (
              <motion.div
                key="blueprint"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12"
              >
                <div className="max-w-4xl mx-auto">
                  <h2 className="text-5xl font-serif italic mb-12 tracking-tight">The ODEN Methodology</h2>
                  
                  <div className="grid gap-16">
                    <section className="relative pl-20">
                      <span className="absolute left-0 top-0 text-6xl font-serif italic opacity-10">01</span>
                      <h3 className="text-xl font-bold uppercase tracking-widest mb-4">Claim Neutralization</h3>
                      <p className="text-lg opacity-70 leading-relaxed">
                        We strip away all emotional, political, and narrative "noise." We convert a story into a <strong>Testable Form</strong>. We don't ask "Is this a conspiracy?" We ask "What institutional records would this event generate?"
                      </p>
                    </section>

                    <section className="relative pl-20">
                      <span className="absolute left-0 top-0 text-6xl font-serif italic opacity-10">02</span>
                      <h3 className="text-xl font-bold uppercase tracking-widest mb-4">Structural Mapping</h3>
                      <p className="text-lg opacity-70 leading-relaxed">
                        We map the <strong>Infrastructure of Fact</strong>. If a person worked at a company, there must be a payroll record. If a plane flew, there must be a flight plan. We map these requirements before we even start searching.
                      </p>
                    </section>

                    <section className="relative pl-20">
                      <span className="absolute left-0 top-0 text-6xl font-serif italic opacity-10">03</span>
                      <h3 className="text-xl font-bold uppercase tracking-widest mb-4">Gap Analysis</h3>
                      <p className="text-lg opacity-70 leading-relaxed">
                        A <strong>Gap Node</strong> is a structural absence. If a payroll record <em>should</em> be in the National Archives but is missing or restricted, that is a discovery in itself. Gaps guide the next phase of research.
                      </p>
                    </section>

                    <section className="relative pl-20">
                      <span className="absolute left-0 top-0 text-6xl font-serif italic opacity-10">04</span>
                      <h3 className="text-xl font-bold uppercase tracking-widest mb-4">Bridge Detection</h3>
                      <p className="text-lg opacity-70 leading-relaxed">
                        We look for <strong>Bridges</strong>—entities that appear across multiple, unrelated research threads. These intersections reveal the hidden connections between seemingly separate events.
                      </p>
                    </section>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Node Editor Modal */}
          <AnimatePresence>
            {editingNode && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white text-black w-full max-w-2xl p-8 shadow-2xl overflow-y-auto max-h-[90vh] border border-black"
                >
                  <div className="flex justify-between items-center mb-8 border-b border-black pb-4">
                    <h3 className="text-2xl font-serif italic">Edit Node: {editingNode.label}</h3>
                    <button onClick={() => setEditingNode(null)} className="text-2xl hover:opacity-50 transition-opacity">✕</button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Label / Name</label>
                        <input 
                          type="text" 
                          value={editingNode.label}
                          onChange={(e) => setEditingNode({...editingNode, label: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Node Type</label>
                        <select 
                          value={editingNode.node_type}
                          onChange={(e) => setEditingNode({...editingNode, node_type: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        >
                          <option value="Person">Person</option>
                          <option value="Institution">Institution</option>
                          <option value="Document">Document</option>
                          <option value="Event">Event</option>
                          <option value="Financial">Financial</option>
                          <option value="Gap">Gap</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Status</label>
                        <select 
                          value={editingNode.status}
                          onChange={(e) => setEditingNode({...editingNode, status: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        >
                          <option value="verified">Verified (Green)</option>
                          <option value="unverified">Unverified (Yellow)</option>
                          <option value="gap">Structural Gap (Red)</option>
                          <option value="incomplete">Incomplete (Gray)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Priority / Weight (1-10)</label>
                        <input 
                          type="number" 
                          min="1" max="10"
                          value={editingNode.weight || 1}
                          onChange={(e) => setEditingNode({...editingNode, weight: parseInt(e.target.value)})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Description</label>
                        <textarea 
                          rows={4}
                          value={editingNode.description}
                          onChange={(e) => setEditingNode({...editingNode, description: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Expected Location / Archive</label>
                        <input 
                          type="text" 
                          value={editingNode.expected_location || ''}
                          onChange={(e) => setEditingNode({...editingNode, expected_location: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="e.g. National Archives RG 59"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Citation URL</label>
                        <input 
                          type="text" 
                          value={editingNode.citation_url || ''}
                          onChange={(e) => setEditingNode({...editingNode, citation_url: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="https://..."
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-12 flex gap-4">
                    <button 
                      onClick={() => updateNode(editingNode)}
                      className="flex-1 bg-black text-white py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/90 transition-all"
                    >
                      Save Changes
                    </button>
                    <button 
                      onClick={() => setEditingNode(null)}
                      className="flex-1 border border-black py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/5 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>

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
            onClick={() => setActiveTab('graph')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'graph' ? "text-black" : "text-black/30")}
          >
            <Network className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Map</span>
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
            onClick={() => setActiveTab('sources')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'sources' ? "text-black" : "text-black/30")}
          >
            <BookOpen className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Sources</span>
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

function StatusBadge({ status }: { status: Node['status'] }) {
  const styles = {
    verified: "bg-green-100 text-green-800 border-green-200",
    unverified: "bg-yellow-100 text-yellow-800 border-yellow-200",
    gap: "bg-red-100 text-red-800 border-red-200",
    incomplete: "bg-gray-100 text-gray-800 border-gray-200"
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

function ForceGraph({ nodes, onNodeClick }: { nodes: Node[], onNodeClick?: (node: Node) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Create links based on shared thread_ids (simulating connections)
    const links: any[] = [];
    nodes.forEach((node, i) => {
      nodes.slice(i + 1).forEach(other => {
        const commonThreads = (node as any).thread_ids?.filter((id: string) => (other as any).thread_ids?.includes(id));
        if (commonThreads?.length > 0) {
          links.push({ source: node.node_id, target: other.node_id, value: commonThreads.length });
        }
      });
    });

    const simulation = d3.forceSimulation(nodes as any)
      .force("link", d3.forceLink(links).id((d: any) => d.node_id).distance(150))
      .force("charge", d3.forceManyBody().strength(-600))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(80));

    const g = svg.append("g");

    // Add Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Draw Links
    const linkElements = g.append("g")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", "#ffffff")
      .attr("stroke-opacity", 0.15)
      .attr("stroke-width", d => Math.max(1, Math.sqrt(d.value) * 2));

    const nodeElements = g.selectAll("g.node")
      .data(nodes)
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        if (onNodeClick) onNodeClick(d as unknown as Node);
      })
      .on("dblclick", (event, d: any) => {
        // Reset position on double click
        d.fx = null;
        d.fy = null;
        simulation.alpha(0.3).restart();
      })
      .call(d3.drag<any, any>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          // Keep fixed after drag unless double clicked
          // d.fx = null; 
          // d.fy = null;
        }));

    // Glow Filter
    const defs = svg.append("defs");
    const filter = defs.append("filter")
      .attr("id", "glow");
    filter.append("feGaussianBlur")
      .attr("stdDeviation", "3.5")
      .attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    nodeElements.append("circle")
      .attr("r", d => (d as unknown as Node).status === 'gap' ? 12 : 8)
      .attr("fill", d => {
        const n = d as unknown as Node;
        if (n.status === 'verified') return "#22c55e";
        if (n.status === 'unverified') return "#eab308";
        if (n.status === 'gap') return "#ef4444";
        return "#6b7280";
      })
      .attr("filter", "url(#glow)")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1)
      .attr("class", d => (d as unknown as Node).status === 'gap' ? "animate-pulse" : "");

    nodeElements.append("text")
      .text(d => (d as unknown as Node).label || (d as unknown as Node).node_id.slice(0, 8))
      .attr("x", 16)
      .attr("y", 4)
      .attr("fill", "#fff")
      .attr("font-family", "JetBrains Mono")
      .attr("font-size", "10px")
      .attr("font-weight", "500")
      .attr("pointer-events", "none")
      .attr("opacity", 0.8);

    simulation.on("tick", () => {
      linkElements
        .attr("x1", d => (d.source as any).x)
        .attr("y1", d => (d.source as any).y)
        .attr("x2", d => (d.target as any).x)
        .attr("y2", d => (d.target as any).y);

      nodeElements.attr("transform", d => `translate(${(d as any).x},${(d as any).y})`);
    });

    return () => simulation.stop();
  }, [nodes]);

  return <svg ref={svgRef} className="w-full h-full" />;
}
