import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import { Search, Shield, Network, FileText, AlertCircle, CheckCircle2, HelpCircle, Loader2, ArrowRight, ChevronRight, ChevronDown, Info, Mail, Edit3, Trash2, Send, BookOpen, ExternalLink, List, History, Save, Download, Upload, Trash, LayoutGrid, Settings, Sparkles, X, Zap, AlertTriangle, Check, Filter, Plus, Compass, Brain, MessageSquare, Building2, ShieldAlert, Users, Cloud, Calendar, Link as LinkIcon, LogIn, LogOut, FolderOpen, Share2, DollarSign, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { normalizeInstitution, generateFingerprint } from "./utils/normalization";
import { ResearchResponse, EvidenceRecord, BridgeCandidate, Request, Source, ChatMessage, InvestigationItem, SubClaim, Suggestions, Investigation, UserProfile } from './types';
import { auth, db, googleProvider, signInWithPopup, onAuthStateChanged, doc, setDoc, getDoc, onSnapshot, User, FirestoreError, collection, query, where, or, getDocs, addDoc, updateDoc, arrayUnion, arrayRemove, disableNetwork, enableNetwork } from './firebase';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import mammoth from 'mammoth';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Firebase Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

// --- Firebase Context ---
interface FirebaseContextType {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  continueAsGuest: () => void;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user) setIsGuest(false);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        return; // Silently handle user closing the popup
      }
      
      if (error.code === 'auth/unauthorized-domain') {
        const domain = window.location.hostname;
        console.error(`ODEN: Domain "${domain}" is not authorized in Firebase Console.`);
        alert(`Authentication Error: This domain (${domain}) is not authorized for sign-in. \n\nPlease add it to the "Authorized domains" list in your Firebase Console -> Authentication -> Settings.`);
      } else {
        console.error("Sign in failed", error);
        alert(`Sign in failed: ${error.message}`);
      }
    }
  };

  const signOut = async () => {
    try {
      await auth.signOut();
      setIsGuest(false);
    } catch (error) {
      console.error("Sign out failed", error);
    }
  };

  const continueAsGuest = () => {
    setIsGuest(true);
  };

  return (
    <FirebaseContext.Provider value={{ user, loading, isGuest, signIn, signOut, continueAsGuest }}>
      {children}
    </FirebaseContext.Provider>
  );
}

function useFirebase() {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
}

// --- Storage Utilities ---
const safeGenerateContent = async (genAI: any, params: any, retries = 3): Promise<any> => {
  try {
    // Truncate text in contents if it's too long to prevent 500/XHR errors
    if (params.contents) {
      if (typeof params.contents === 'string') {
        params.contents = params.contents.slice(0, 30000);
      } else if (Array.isArray(params.contents)) {
        params.contents = params.contents.map((c: any) => {
          if (c.parts) {
            c.parts = c.parts.map((p: any) => {
              if (p.text) return { ...p, text: p.text.slice(0, 30000) };
              return p;
            });
          }
          return c;
        });
      }
    }
    return await genAI.models.generateContent(params);
  } catch (e: any) {
    // Handle 503 (Service Unavailable / High Demand) with retries
    if (retries > 0 && (e.message?.includes('503') || e.message?.includes('UNAVAILABLE'))) {
      const delay = (4 - retries) * 2000; // Exponential backoff: 2s, 4s, 6s
      console.warn(`ODEN: Gemini API busy (503). Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return safeGenerateContent(genAI, params, retries - 1);
    }

    console.error("ODEN: Gemini API Error:", e);
    // Re-throw with a cleaner message if it's a known error type
    if (e.message?.includes('xhr error') || e.message?.includes('500')) {
      throw new Error("The AI service is currently overloaded or the request was too large. Please try a shorter claim or fewer documents.");
    }
    if (e.message?.includes('503') || e.message?.includes('UNAVAILABLE')) {
      throw new Error("The AI service is currently experiencing high demand. Please wait a moment and try again.");
    }
    throw e;
  }
};

const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`ODEN: Failed to get item ${key} from localStorage:`, e);
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`ODEN: Failed to set item ${key} in localStorage:`, e);
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn(`ODEN: Failed to remove item ${key} from localStorage:`, e);
    }
  }
};

function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch (e) {
    console.warn("ODEN: Failed to parse JSON:", e);
    return fallback;
  }
}

// --- UI Components ---
const SourceCard = ({ source, onEdit, onDelete, onView }: { source: Source, onEdit?: (s: Source) => void, onDelete?: (id: string) => void, onView?: (s: Source) => void }) => (
  <div className={cn(
    "border border-black p-6 group relative transition-all h-full flex flex-col",
    source.type === 'Upload' ? "bg-black/5" : "bg-white"
  )}>
    <div className="flex justify-between items-start mb-2">
      <div className="flex gap-2 flex-wrap">
        <span className={cn(
          "text-[8px] font-mono px-1 uppercase",
          source.type === 'Upload' ? "bg-black text-white" : "bg-black/10 text-black"
        )}>{source.type}</span>
        {source.classification && <span className="text-[8px] font-mono bg-blue-500 text-white px-1 uppercase">{source.classification}</span>}
        {source.url === 'Local File' && <span className="text-[8px] font-mono bg-emerald-500 text-white px-1 uppercase">Local</span>}
      </div>
      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
        {onView && (
          <button 
            onClick={() => onView(source)} 
            className="p-1 hover:bg-black/5"
            title="View Full Document"
          >
            <BookOpen className="w-3 h-3" />
          </button>
        )}
        {onEdit && <button onClick={() => onEdit(source)} className="p-1 hover:bg-black/5"><Edit3 className="w-3 h-3" /></button>}
        {onDelete && <button onClick={() => onDelete(source.id)} className="p-1 hover:bg-red-50 text-red-600"><Trash2 className="w-3 h-3" /></button>}
      </div>
    </div>
    <h4 className="font-serif italic text-lg mb-2 line-clamp-2">{source.title}</h4>
    <div className="space-y-1 mb-4">
      {source.institution_normalized && <p className="text-[9px] font-mono uppercase opacity-50">Institution: <span className="text-black opacity-100">{source.institution_normalized}</span></p>}
      {source.department && <p className="text-[9px] font-mono uppercase opacity-50">Department: <span className="text-black opacity-100">{source.department}</span></p>}
      {source.physical_location && <p className="text-[9px] font-mono uppercase opacity-50">Location: <span className="text-black opacity-100 italic">{source.physical_location}</span></p>}
    </div>
    <div className="mt-auto">
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
      {source.notes && <p className="text-xs opacity-60 italic border-l border-black/20 pl-3 line-clamp-3">{source.notes}</p>}
    </div>
  </div>
);

// --- Error Boundary ---
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          minHeight: '100vh', 
          backgroundColor: '#f9fafb', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          padding: '2rem',
          fontFamily: 'sans-serif'
        }}>
          <div style={{ 
            maxWidth: '28rem', 
            width: '100%', 
            border: '2px solid black', 
            padding: '2rem', 
            backgroundColor: 'white', 
            boxShadow: '8px 8px 0px 0px rgba(0,0,0,1)' 
          }}>
            <h2 style={{ fontSize: '1.5rem', fontStyle: 'italic', marginBottom: '1rem' }}>
              Research Interrupted.
            </h2>
            <p style={{ fontSize: '0.875rem', opacity: 0.6, marginBottom: '1.5rem', lineHeight: '1.5' }}>
              An unexpected error occurred in the ODEN system. This might be due to a data inconsistency or a temporary glitch.
            </p>
            <div style={{ 
              padding: '1rem', 
              backgroundColor: '#fef2f2', 
              border: '1px solid #fecaca', 
              fontSize: '10px', 
              fontFamily: 'monospace', 
              marginBottom: '1.5rem', 
              overflow: 'auto', 
              maxHeight: '10rem' 
            }}>
              {this.state.error?.toString()}
            </div>
            <button 
              onClick={() => window.location.reload()}
              style={{ 
                width: '100%', 
                backgroundColor: 'black', 
                color: 'white', 
                padding: '0.75rem 0', 
                fontSize: '10px', 
                fontFamily: 'monospace', 
                textTransform: 'uppercase', 
                fontWeight: 'bold', 
                letterSpacing: '0.1em', 
                cursor: 'pointer',
                border: 'none'
              }}
            >
              Restart Session
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <FirebaseProvider>
        <ODENAppWrapper />
      </FirebaseProvider>
    </ErrorBoundary>
  );
}

function ODENAppWrapper() {
  const { user, loading, signIn, isGuest, continueAsGuest } = useFirebase();

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-black" />
          <p className="text-[10px] font-mono uppercase tracking-widest">Initializing System...</p>
        </div>
      </div>
    );
  }

  if (!user && !isGuest) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full border-2 border-black p-12 bg-white shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex justify-center mb-8">
            <div className="w-16 h-16 bg-black flex items-center justify-center rounded-full">
              <Shield className="text-white w-8 h-8" />
            </div>
          </div>
          <h1 className="text-3xl font-serif italic mb-2 text-center">ODEN Research</h1>
          <p className="text-[10px] font-mono uppercase tracking-widest text-center mb-8 opacity-60">Investigative Partner System</p>
          
          <div className="space-y-6 mb-10">
            <p className="text-sm leading-relaxed text-center opacity-80">
              Access to the ODEN system requires secure authentication for cloud sync. Alternatively, you can continue as a guest and store data locally on this device.
            </p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={signIn}
              className="w-full bg-black text-white py-4 flex items-center justify-center gap-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all group"
            >
              <LogIn className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              Authenticate with Google
            </button>

            <button 
              onClick={continueAsGuest}
              className="w-full border border-black/20 text-black py-4 flex items-center justify-center gap-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-stone-100 transition-all"
            >
              Continue without signing in
            </button>
          </div>
          
          <div className="mt-8 pt-8 border-t border-stone-100 text-center">
            <p className="text-[9px] font-mono uppercase opacity-40">Secure Access Protocol v2.5.0</p>
          </div>
        </div>
      </div>
    );
  }

  return <ODENApp />;
}

function ODENApp() {
  const { user, signOut, signIn, isGuest } = useFirebase();
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errMessage = error instanceof Error ? error.message : String(error);
    
    // Check for quota exceeded
    if (errMessage.includes('resource-exhausted') || errMessage.includes('Quota limit exceeded')) {
      console.warn("ODEN: Firestore quota exceeded. Switching to Local Mode.");
      setQuotaExceeded(true);
      disableNetwork(db).catch(err => console.error("Failed to disable network:", err));
      return; // Stop here for quota errors
    }

    const errInfo: FirestoreErrorInfo = {
      error: errMessage,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    // Don't throw if we're just handling quota, to prevent app crash
    if (!quotaExceeded) {
      // throw new Error(JSON.stringify(errInfo));
    }
  };
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const parseFirestoreError = (err: string): FirestoreErrorInfo | null => {
    try {
      const parsed = JSON.parse(err);
      if (parsed && typeof parsed === 'object' && 'operationType' in parsed) {
        return parsed as FirestoreErrorInfo;
      }
    } catch (e) {
      // Not a JSON error
    }
    return null;
  };
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [currentInvestigationId, setCurrentInvestigationId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [localTitle, setLocalTitle] = useState(() => safeStorage.getItem('oden_local_title') || 'Local Session');
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);

  const [researchStep, setResearchStep] = useState<number>(0);
  const [claim, setClaim] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'guide' | 'pipeline' | 'dossier' | 'timeline' | 'list' | 'chat' | 'requests' | 'investigation' | 'suggestions' | 'sources' | 'data-management' | 'settings'>('guide');
  const [dossierSort, setDossierSort] = useState<'default' | 'strength' | 'impact' | 'chrono' | 'institutional' | 'verification' | 'people' | 'financial'>('default');
  const [dossierFilter, setDossierFilter] = useState<'all' | 'verified' | 'contested' | 'gap'>('all');
  const [prevTab, setPrevTab] = useState<typeof activeTab>('guide');
  const [isMobile, setIsMobile] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [viewingRecord, setViewingRecord] = useState<EvidenceRecord | null>(null);
  const [viewingSource, setViewingSource] = useState<Source | null>(null);

  const consultStrategistOnLog = (log: InvestigationItem) => {
    setActiveTab('chat');
    const msg = `I am looking at this investigation log: "${log.name}". 
    Details: ${log.notes}
    Status: ${log.status}
    Type: ${log.type}
    
    Analyze this finding against our current Research Claim. What are the structural implications? What should be my next step?`;
    handleChat(msg);
  };

  const addStrategistDiscovery = (name: string, notes: string, reason: string) => {
    const newItem: InvestigationItem = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      type: 'Pattern',
      status: 'Pending',
      priority: 'Medium',
      notes,
      createdAt: new Date().toISOString(),
      isStrategistDiscovery: true,
      discoveryReason: reason
    };
    setResearchPoints(prev => [newItem, ...prev]);
    setStrategistFeed(prev => [{
      id: Math.random().toString(36).substr(2, 9),
      content: `Strategist Discovery: ${name}. ${reason}`,
      timestamp: new Date().toISOString(),
      type: 'discovery'
    }, ...prev]);
  };

  const addSource = (newSource: Source) => {
    const normalized = normalizeInstitution(newSource.institution || '');
    const sourceWithNormalized = { ...newSource, institution_normalized: normalized };
    setSources(prev => [sourceWithNormalized, ...prev]);
    setEditingSource(null);
  };

  const updateSource = (updatedSource: Source) => {
    const normalized = normalizeInstitution(updatedSource.institution || '');
    const sourceWithNormalized = { ...updatedSource, institution_normalized: normalized };
    setSources(prev => prev.map(s => s.id === updatedSource.id ? sourceWithNormalized : s));
    setEditingSource(null);
  };

  const askAIAboutRecord = (record: EvidenceRecord) => {
    if (!record) return;
    setChatInput(`Tell me more about this ${record.record_type || 'Record'}: "${record.label || 'Evidence Record'}". What specific primary sources should I look for to verify its details?`);
    setActiveTab('chat');
  };

  const searchNara = async (query: string) => {
    if (!naraApiKey) return { error: "NARA API Key not configured." };
    try {
      const url = `https://catalog.archives.gov/api/v2/records/search?q=${encodeURIComponent(query)}&api_key=${naraApiKey}`;
      const response = await fetch(url);
      if (!response.ok) return { error: `NARA API Error: ${response.status}` };
      return await response.json();
    } catch (error) {
      return { error: "Failed to connect to NARA API." };
    }
  };

  // Track previous tab for "Close" buttons
  useEffect(() => {
    if (activeTab !== 'suggestions' && activeTab !== 'data-management') {
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
  const [suggestions, setSuggestions] = useState<Suggestions>({ 
    bridges: [], 
    gaps: [], 
    researchAreas: [], 
    crossovers: [], 
    personnelCrossovers: [],
    financialCrossovers: [],
    investigativeOutlook: '',
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

  // Close sidebar on mobile by default
  useEffect(() => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  }, []);

  const [aiConnected, setAiConnected] = useState(false);
  const [apiKeySource, setApiKeySource] = useState<'none' | 'custom' | 'platform' | 'managed'>('none');
  const [customGeminiKey, setCustomGeminiKey] = useState(() => safeStorage.getItem('oden_custom_gemini_key') || '');
  const [bypassPlatformKey, setBypassPlatformKey] = useState(() => {
    const saved = safeStorage.getItem('oden_bypass_platform_key');
    return saved === null ? true : saved === 'true'; // Default to true (Safety On)
  });
  const [customFirebaseConfig, setCustomFirebaseConfig] = useState(() => safeStorage.getItem('oden_custom_firebase_config') || '');
  const [naraApiKey, setNaraApiKey] = useState(() => safeStorage.getItem('oden_nara_key') || '');
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string, content: string, type: string }[]>([]);
  const [isReportingError, setIsReportingError] = useState(false);
  const [strategistFeed, setStrategistFeed] = useState<{ id: string, content: string, timestamp: string, type: 'thought' | 'discovery' | 'alert' }[]>([]);
  
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'All' | 'Primary' | 'Secondary' | 'Archive' | 'Upload' | 'Other'>('All');
  const [sourceGroupBy, setSourceGroupBy] = useState<'None' | 'Institution' | 'Type'>('None');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showNewInvestigationModal, setShowNewInvestigationModal] = useState(false);
  const [newInvestigationTitle, setNewInvestigationTitle] = useState('');
  const [showRenameModal, setShowRenameModal] = useState<{ id: string, title: string } | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ id: string, title: string } | null>(null);

  // 1. Handle User Profile and Investigation List
  useEffect(() => {
    setIsLoaded(false); // Reset on user change
    if (!user) {
      let localInvs = [];
      localInvs = safeJsonParse(safeStorage.getItem('oden_local_investigations'), []);
      
      // Migration from old single-session format
      if (localInvs.length === 0) {
        const oldSessionStr = safeStorage.getItem('oden_session');
        let oldSession = { claim: '', data: null, chatMessages: [], requests: [], sources: [], researchPoints: [], suggestions: null };
        if (oldSessionStr) {
          oldSession = safeJsonParse(oldSessionStr, oldSession);
        }
        
        const defaultInv = {
          id: 'local-default',
          title: safeStorage.getItem('oden_local_title') || 'Local Session',
          ownerId: 'guest',
          collaborators: ['guest'],
          collaboratorEmails: [],
          claim: oldSession.claim || '',
          data: oldSession.data || null,
          chatMessages: oldSession.chatMessages || [],
          requests: oldSession.requests || [],
          sources: oldSession.sources || [],
          researchPoints: oldSession.researchPoints || [],
          suggestions: oldSession.suggestions || { 
            bridges: [], gaps: [], researchAreas: [], crossovers: [], entities: [], 
            anomalies: [], conflicts: [], keyActors: [], methodologicalAdvice: [],
            institutionalGaps: [], structuralAnomalies: [], patternRecognition: [], riskAssessment: [] 
          },
          updatedAt: new Date().toISOString()
        };
        localInvs = [defaultInv];
        safeStorage.setItem('oden_local_investigations', JSON.stringify(localInvs));
      }

      setInvestigations(localInvs);
      
      const savedId = safeStorage.getItem('oden_current_inv_id');
      if (savedId && localInvs.find((i: any) => i.id === savedId)) {
        setCurrentInvestigationId(savedId);
      } else {
        setCurrentInvestigationId(localInvs[0].id);
      }
      
      setUserProfile(null);
      setIsLoaded(true); // Guest mode is "loaded" immediately
      return;
    }

    let unsubInvs: (() => void) | null = null;

    const setupUserAndListen = async (retries = 3) => {
      if (quotaExceeded) return;
      try {
        const userDocRef = doc(db, 'users', user.uid);
        let userDocSnap;
        
        try {
          userDocSnap = await getDoc(userDocRef);
        } catch (e) {
          if (retries > 0 && e instanceof Error && e.message.includes('offline')) {
            console.warn(`Firestore offline, retrying in 2s... (${retries} left)`);
            setTimeout(() => setupUserAndListen(retries - 1), 2000);
            return;
          }
          throw e;
        }
        
        let profile: UserProfile;
        if (!userDocSnap.exists()) {
          profile = {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || '',
            photoURL: user.photoURL || '',
            investigationIds: []
          };
          await setDoc(userDocRef, profile);
        } else {
          profile = userDocSnap.data() as UserProfile;
        }
        setUserProfile(profile);

        // Listen for investigations where user is owner or collaborator
        const conditions = [where('ownerId', '==', user.uid)];
        if (user.email) {
          conditions.push(where('collaboratorEmails', 'array-contains', user.email));
        }

        const q = query(
          collection(db, 'investigations'),
          or(...conditions)
        );
        
        unsubInvs = onSnapshot(q, (snapshot) => {
          const invs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Investigation));
          setInvestigations(invs);
          
          // Auto-select first investigation if none selected
          if (invs.length > 0 && !currentInvestigationId) {
            setCurrentInvestigationId(invs[0].id);
          } else if (invs.length === 0) {
            // Create a default one if none exist
            createNewInvestigation("Initial Investigation");
          }
        }, (error) => {
          // Don't throw for offline errors in snapshot, just log
          if (error.message.includes('offline')) {
            console.warn("Firestore snapshot listener is offline, waiting for connection...");
          } else {
            handleFirestoreError(error, OperationType.LIST, 'investigations');
          }
        });

      } catch (e) {
        handleFirestoreError(e, OperationType.GET, `users/${user.uid}`);
      }
    };

    setupUserAndListen();

    return () => {
      if (unsubInvs) unsubInvs();
    };
  }, [user]);

  // 2. Sync current investigation data to state
  useEffect(() => {
    if (!user || !currentInvestigationId) {
      setIsLoaded(false);
      return;
    }

    setIsLoaded(false); // Reset on ID change to prevent saving old data to new ID

    const unsubscribe = onSnapshot(doc(db, 'investigations', currentInvestigationId), (docSnap) => {
      if (docSnap.exists()) {
        // If we have pending local writes or quota is exceeded, don't overwrite with potentially stale server data
        if (docSnap.metadata.hasPendingWrites || quotaExceeded) return;

        const inv = docSnap.data() as Investigation;
        
        // Update local state from cloud, but be careful with chatMessages to avoid race conditions
        setData(inv.data || null);
        
        setChatMessages(prev => {
          const incoming = inv.chatMessages || [];
          // Only update if the incoming list is longer or we are not currently loading a chat
          // This prevents the "disappearing message" race condition during AI generation
          if (prev.length > incoming.length && chatLoading) return prev;
          return incoming;
        });

        setRequests(inv.requests || []);
        setSources(inv.sources || []);
        setResearchPoints(inv.researchPoints || []);
        setClaim(inv.claim || '');
        setSuggestions(inv.suggestions || { 
          bridges: [], gaps: [], researchAreas: [], crossovers: [], 
          personnelCrossovers: [], financialCrossovers: [], investigativeOutlook: '',
          entities: [], 
          anomalies: [], conflicts: [], keyActors: [], methodologicalAdvice: [],
          institutionalGaps: [], structuralAnomalies: [], patternRecognition: [], riskAssessment: [] 
        });
        setIsLoaded(true);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `investigations/${currentInvestigationId}`);
    });

    return unsubscribe;
  }, [user, currentInvestigationId]);

  // 1c. Handle local investigation switching
  useEffect(() => {
    if (user || !currentInvestigationId || !currentInvestigationId.startsWith('local-')) return;

    const localInvs = safeJsonParse(safeStorage.getItem('oden_local_investigations'), []);
    const inv = localInvs.find((i: any) => i.id === currentInvestigationId);
    if (inv) {
      setData(inv.data);
      setChatMessages(inv.chatMessages || []);
      setSuggestionChatMessages(inv.suggestionChatMessages || []);
      setRequests(inv.requests || []);
      setSources(inv.sources || []);
      setResearchPoints(inv.researchPoints || []);
      setClaim(inv.claim || '');
      setResearchStep(inv.researchStep || 0);
      setSuggestions(inv.suggestions || { 
        bridges: [], gaps: [], researchAreas: [], crossovers: [], 
        personnelCrossovers: [], financialCrossovers: [], investigativeOutlook: '',
        entities: [], 
        anomalies: [], conflicts: [], keyActors: [], methodologicalAdvice: [],
        institutionalGaps: [], structuralAnomalies: [], patternRecognition: [], riskAssessment: [] 
      });
      setLocalTitle(inv.title);
      setIsLoaded(true);
    }
  }, [currentInvestigationId, user]);

  const renameInvestigation = async (id: string, newTitle: string) => {
    if (!newTitle) return;
    try {
      if (user && id !== 'local' && !quotaExceeded) {
        await updateDoc(doc(db, 'investigations', id), {
          title: newTitle,
          updatedAt: serverTimestamp()
        });
      } else if (id === 'local' || (id && id.startsWith('local-')) || quotaExceeded) {
        if (id === 'local') {
          setLocalTitle(newTitle);
          safeStorage.setItem('oden_local_title', newTitle);
        }
        // Update the investigations list immediately for local or if quota exceeded
        setInvestigations(prev => prev.map(inv => inv.id === id ? { ...inv, title: newTitle } : inv));
        
        // Also update localStorage for local investigations
        if (id.startsWith('local-')) {
          const localInvs = safeJsonParse(safeStorage.getItem('oden_local_investigations'), []);
          const updated = localInvs.map((inv: any) => inv.id === id ? { ...inv, title: newTitle, updatedAt: new Date().toISOString() } : inv);
          safeStorage.setItem('oden_local_investigations', JSON.stringify(updated));
        }
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `investigations/${id}`);
    }
  };

  const createNewInvestigation = async (title: string = "New Investigation") => {
    if (!user) {
      const newId = `local-${Math.random().toString(36).substr(2, 9)}`;
      const newInv: Investigation = {
        id: newId,
        title,
        ownerId: 'guest',
        collaborators: ['guest'],
        collaboratorEmails: [],
        claim: '',
        data: null,
        chatMessages: [],
        requests: [],
        sources: [],
        researchPoints: [],
        suggestions: { 
          bridges: [], gaps: [], researchAreas: [], crossovers: [], entities: [], 
          anomalies: [], conflicts: [], keyActors: [], methodologicalAdvice: [],
          institutionalGaps: [], structuralAnomalies: [], patternRecognition: [], riskAssessment: [] 
        },
        updatedAt: new Date().toISOString()
      };
      const localInvs = safeJsonParse(safeStorage.getItem('oden_local_investigations'), []);
      const updatedInvs = [...localInvs, newInv];
      safeStorage.setItem('oden_local_investigations', JSON.stringify(updatedInvs));
      setInvestigations(updatedInvs);
      setCurrentInvestigationId(newId);
      safeStorage.setItem('oden_current_inv_id', newId);
      setActiveTab('guide');
      return;
    }
    try {
      if (quotaExceeded) {
        throw new Error("Quota exceeded. Please use local mode.");
      }
      const docRef = doc(collection(db, 'investigations'));
      const newInv: Investigation = {
        id: docRef.id,
        title,
        ownerId: user.uid,
        collaborators: [user.uid],
        collaboratorEmails: [user.email || ''],
        claim: '',
        data: null,
        chatMessages: [],
        requests: [],
        sources: [],
        researchPoints: [],
        suggestions: { 
          bridges: [], gaps: [], researchAreas: [], crossovers: [], entities: [], 
          anomalies: [], conflicts: [], keyActors: [], methodologicalAdvice: [],
          institutionalGaps: [], structuralAnomalies: [], patternRecognition: [], riskAssessment: [] 
        },
        updatedAt: serverTimestamp()
      };
      await setDoc(docRef, newInv);
      setCurrentInvestigationId(docRef.id);
      setActiveTab('guide');
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'investigations');
    }
  };

  const shareInvestigation = async (email: string) => {
    if (!currentInvestigationId || !email || quotaExceeded) return;
    setIsSharing(true);
    try {
      await updateDoc(doc(db, 'investigations', currentInvestigationId), {
        collaboratorEmails: arrayUnion(email)
      });
      setShareEmail('');
      setShowShareModal(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `investigations/${currentInvestigationId}`);
    } finally {
      setIsSharing(false);
    }
  };

  // 3. Initial load from LocalStorage for guest mode
  useEffect(() => {
    if (!user) {
      const saved = safeStorage.getItem('oden_session');
      if (saved) {
        const parsed = safeJsonParse<any>(saved, null);
        if (parsed) {
          if (parsed.data) setData(parsed.data);
          if (parsed.chatMessages) setChatMessages(parsed.chatMessages);
          if (parsed.requests) setRequests(parsed.requests);
          if (parsed.sources) setSources(parsed.sources);
          if (parsed.researchPoints) setResearchPoints(parsed.researchPoints);
          if (parsed.claim) setClaim(parsed.claim);
          if (parsed.suggestions) setSuggestions(parsed.suggestions);
          if (parsed.suggestionChatMessages) setSuggestionChatMessages(parsed.suggestionChatMessages);
          if (parsed.activeTab) setActiveTab(parsed.activeTab);
          if (parsed.researchStep !== undefined) setResearchStep(parsed.researchStep);
          if (parsed.uploadedFiles) setUploadedFiles(parsed.uploadedFiles);
          if (parsed.strategistFeed) setStrategistFeed(parsed.strategistFeed);
        }
      }
      setIsLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    safeStorage.setItem('oden_nara_key', naraApiKey);
  }, [naraApiKey]);

  useEffect(() => {
    safeStorage.setItem('oden_custom_gemini_key', customGeminiKey);
  }, [customGeminiKey]);

  useEffect(() => {
    safeStorage.setItem('oden_bypass_platform_key', String(bypassPlatformKey));
    
    if (customGeminiKey) {
      setApiKeySource('custom');
      setAiConnected(true);
    } else if (bypassPlatformKey) {
      setApiKeySource('none');
      setAiConnected(false);
    } else if (process.env.GEMINI_API_KEY) {
      setApiKeySource('platform');
      setAiConnected(true);
    } else {
      setApiKeySource('none');
      setAiConnected(false);
    }
  }, [customGeminiKey, bypassPlatformKey]);

  useEffect(() => {
    safeStorage.setItem('oden_custom_firebase_config', customFirebaseConfig);
  }, [customFirebaseConfig]);

  useEffect(() => {
    if (quotaExceeded) {
      disableNetwork(db).catch(err => console.error("Failed to disable network:", err));
    }
  }, [quotaExceeded]);

  // Auto-save to LocalStorage (High frequency, all state)
  useEffect(() => {
    if (!isLoaded) return;

    const timeoutId = setTimeout(() => {
      const session = {
        data,
        chatMessages,
        requests,
        sources,
        researchPoints,
        claim,
        suggestions,
        suggestionChatMessages,
        activeTab,
        researchStep,
        dossierSort,
        dossierFilter,
        investigationFilter,
        sourceFilter,
        uploadedFiles,
        strategistFeed,
        updatedAt: new Date().toISOString()
      };

      // Save to LocalStorage
      safeStorage.setItem('oden_session', JSON.stringify(session));

      if (!user && currentInvestigationId && currentInvestigationId.startsWith('local-')) {
        const localInvsStr = safeStorage.getItem('oden_local_investigations');
        if (localInvsStr) {
          const localInvs = safeJsonParse(localInvsStr, []);
          const updatedInvs = localInvs.map((inv: any) => {
            if (inv.id === currentInvestigationId) {
              return {
                ...inv,
                ...session,
                title: localTitle,
                updatedAt: new Date().toISOString()
              };
            }
            return inv;
          });
          safeStorage.setItem('oden_local_investigations', JSON.stringify(updatedInvs));
          setInvestigations(updatedInvs);
        }
      }
    }, 2000); // 2-second debounce for local storage

    return () => clearTimeout(timeoutId);
  }, [
    isLoaded, user, currentInvestigationId, data, chatMessages, requests, sources, 
    researchPoints, claim, suggestions, suggestionChatMessages, activeTab, 
    researchStep, dossierSort, dossierFilter, investigationFilter, sourceFilter, 
    uploadedFiles, strategistFeed, localTitle
  ]);

  // Auto-save to Firestore (Lower frequency, core data only)
  useEffect(() => {
    if (!isLoaded || !user || !currentInvestigationId || currentInvestigationId.startsWith('local-') || quotaExceeded) return;

    const timeoutId = setTimeout(() => {
      const saveToFirestore = async () => {
        try {
          await updateDoc(doc(db, 'investigations', currentInvestigationId), {
            data,
            chatMessages,
            requests,
            sources,
            researchPoints,
            claim,
            suggestions,
            updatedAt: serverTimestamp()
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `investigations/${currentInvestigationId}`);
        }
      };
      saveToFirestore();
    }, 10000); // 10-second debounce for Firestore to save quota

    return () => clearTimeout(timeoutId);
  }, [
    isLoaded, user, currentInvestigationId, quotaExceeded,
    data, chatMessages, requests, sources, researchPoints, claim, suggestions
  ]);

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
    const apiKey = customGeminiKey || (bypassPlatformKey ? undefined : process.env.GEMINI_API_KEY);
    if (!apiKey) {
      throw new Error("Gemini API Key is missing. This usually happens if you've cleared your keys but haven't 'Connected' to the platform's free tier. Click 'Connect AI Engine' in Settings to restore access.");
    }
    return new GoogleGenAI({ apiKey });
  };

  const runClaimScoper = async (claim: string) => {
    const genAI = getGenAI();
    const response = await safeGenerateContent(genAI, {
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
    const response = await safeGenerateContent(genAI, {
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
    const response = await safeGenerateContent(genAI, {
      model: "gemini-3-flash-preview",
      contents: `You are a structural evidence mapper and Investigative Partner for the ODEN Research System. Given a neutralized research claim, generate the institutional evidence checklist — the complete list of record types, documents, communications, and physical traces that must exist if this claim is structurally true. 
      Testable form: "${testableForm}"
      
      CRITICAL: NEVER use placeholder text like "Unnamed Record" or "Unknown Location". Use Google Search to identify the EXACT archives, government agencies, or record-keeping bodies relevant to this specific claim.
      
      FOLLOW THE ACTORS & CAPITAL: Explicitly identify key people (actors) and money trails (financial flows) that would leave institutional traces. These are the structural pillars of any institutional pattern.
      
      INVESTIGATIVE STRATEGY: Provide strategic advice on how to approach these records. What are the potential obstacles? What secondary sources might provide context?
      
      Output ONLY valid JSON: { "checklist": [{ "item_id": string, "description": string, "expected_location": string, "priority": "high" | "medium" | "low" }] }. 
      Limit to the 5-7 most critical institutional records.`,
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
      ? `USER UPLOADED NOTES/DOCUMENTS:\n${uploadedFiles.map((f: any) => `FILE: ${f.name}\nCONTENT: ${f.content.slice(0, 5000)}`).join('\n\n')}\n\n`
      : '';
    const response = await safeGenerateContent(genAI, {
      model: "gemini-3-flash-preview",
      contents: [
        { parts: [{ text: `You are an ODEN Investigative Partner and Research Assistant. Your task is to investigate a specific checklist item strictly against primary sources and user-provided data, while providing strategic context for the broader investigation.
      
      ITEM TO RESEARCH:
      ID: ${item.item_id}
      Description: ${item.description}
      Expected Institutional Location: ${item.expected_location}
      
      ${filesContext}
      
      CRITICAL: NEVER use placeholder text like "Unnamed Evidence", "Unknown", or "No description provided". You MUST use Google Search to find the specific record, the actual name of the office, and the real content of the finding. If you find a gap, describe the gap specifically (e.g., "Missing 1954 Correspondence from Office of X").
      
      METHODOLOGY CONSTRAINTS:
      1. PRIMARY SOURCES ONLY for verification.
      2. USER UPLOADED DATA: Prioritize user notes.
      3. SECONDARY SOURCES: Inform search and provide research context.
      4. FOLLOW THE ACTORS & CAPITAL: Explicitly identify key people (actors) and money trails (financial flows).
      5. REASONING DEPTH: Observed, Connection, Significance, Crossover Analysis.
      6. SIGNAL VS NOISE: Distinguish support from context.
      7. ENTITY RECOGNITION: Identify real people, agencies, and dates.
      8. INSTITUTION NORMALIZATION: Use canonical names.
      9. INVESTIGATIVE NARRATIVE: Use natural, engaging language to describe findings and their significance.
      10. URL INTEGRITY & SOURCE LOCK (CRITICAL): NEVER hallucinate or guess a URL. ONLY use exact URLs found in the raw Google Search tool output. If you find information on a website, news outlet, or public database, you MUST provide the direct URL in the 'citation_url' field. If no URL is found, state: '[URL NOT FOUND IN SEARCH]'.
      
      Use Google Search to find the specific record at the expected location.
      Output ONLY valid JSON: { 
        "item_id": string, 
        "source_found": boolean, 
        "classification": "verified" | "unverified" | "contested" | "gap",
        "label": string,
        "description": string,
        "observed_content": string,
        "connection_logic": string,
        "significance": string,
        "impact": "Supports" | "Weakens" | "Complicates" | "Leaves Open",
        "strength": "Strong" | "Weak" | "Noise",
        "suggestions": string,
        "missing_verification": string,
        "citation": string | null, 
        "citation_url": string | null, 
        "raw_result": string, 
        "timeline_date": string | null, 
        "research_preview": string, 
        "entities": string[],
        "institution_normalized": string
      }.` }] }
      ],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            item_id: { type: Type.STRING },
            source_found: { type: Type.BOOLEAN },
            classification: { type: Type.STRING, enum: ["verified", "unverified", "contested", "gap"] },
            label: { type: Type.STRING },
            description: { type: Type.STRING },
            observed_content: { type: Type.STRING },
            connection_logic: { type: Type.STRING },
            significance: { type: Type.STRING },
            impact: { type: Type.STRING, enum: ["Supports", "Weakens", "Complicates", "Leaves Open"] },
            strength: { type: Type.STRING, enum: ["Strong", "Weak", "Noise"] },
            suggestions: { type: Type.STRING },
            missing_verification: { type: Type.STRING },
            citation: { type: Type.STRING, nullable: true },
            citation_url: { type: Type.STRING, nullable: true },
            raw_result: { type: Type.STRING },
            timeline_date: { type: Type.STRING, nullable: true },
            research_preview: { type: Type.STRING },
            entities: { type: Type.ARRAY, items: { type: Type.STRING } },
            institution_normalized: { type: Type.STRING },
          },
          required: [
            "item_id", "source_found", "classification", "label", "description", 
            "observed_content", "connection_logic", "significance", "impact", 
            "strength", "suggestions", "missing_verification", "raw_result", 
            "research_preview", "entities", "institution_normalized"
          ],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const runDeepAnalysis = async (data: any, chatMessages: ChatMessage[], discoveryFindings: string, focus?: string) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are the ODEN Senior Research Strategist. 
      Perform a "Deep Structural Analysis" on the current research state.
      
      CURRENT DATA: ${JSON.stringify(data?.results || [])}
      CHAT HISTORY: ${JSON.stringify(chatMessages.slice(-5))}
      FOCUS: ${focus || 'General structural analysis'}
      SEARCH FINDINGS:
      ${discoveryFindings}
      
      CORE METHODOLOGY (ODEN):
      1. ASSUME THE PREMISE: Never dismiss, correct, or "fact-check" the user's premise. If the user says "records were burned," treat it as an absolute fact. 
      2. MAP THE SHADOW: Your task is to identify what evidence *should* exist if the user's premise is true. Focus on administrative footprints, secondary ledgers, and institutional crossovers.
      3. DOMAIN-AGNOSTIC RESEARCH: Treat ALL domains (Historical, Corporate, Legal, Financial, Scientific, Political) as systems of records to be mapped. Follow the administrative footprint wherever it leads.
      4. CROSSOVER ANALYSIS (CRITICAL): Explicitly identify personnel crossovers (dual roles, board memberships) and financial crossovers (inter-agency fund flows, corporate-government contracts). Look for "Bridges" (the same person or entity appearing in two different, seemingly independent domains).
      
      ANALYSIS GOALS:
      1. Identify "Bridge Records": Entities (people, institutions, locations) that appear across multiple independent threads.
      2. Identify "Evidence Conflicts": Contradictory data points that require resolution.
      3. Identify "Institutional Gaps": Systemic absences in record groups that should exist based on institutional process.
      4. Identify "Structural Anomalies": Deviations from standard institutional, financial, or social logic.
      5. Identify "Pattern Recognition": Recurring structural signatures across different domains.
      6. Identify "Risk Assessment": Methodological risks and potential biases in the current findings.
      7. Identify "Key Actors": Central figures, organizations, or systems identified across the research.
      8. Identify "Methodological Advice": Specific, actionable advice for the next phase of research.
      9. Identify "Research Areas": New institutional or data domains suggested by the structural nexus.
      10. FOIA GENERATION: Based on the institutional gaps and search findings, draft specific FOIA or Archival requests.
      11. INVESTIGATIVE OUTLOOK: Provide a section on the implications of the findings—what they *could* imply about structural links, gaps, or hidden patterns.
      
      FACTUAL RIGOR & CATEGORIZATION (MANDATORY):
      - SELF-CHECK BEFORE OUTPUT (REQUIRED): Before finalizing any output, perform this internal check on every named individual, date, institution, historical claim, and archival citation:
        1. Does this claim appear in the user-provided data or a source retrieved via Google Search in this session?
           - If yes: mark it [DOCUMENTED] and cite the source.
        2. Is it a logical inference from documented data?
           - If yes: mark it [INFERRED] and explicitly explain the "Structural Logic" or "Nexus" (e.g., "We connect A to B because they share the same business manager in 1905").
        3. Is it structurally plausible but unverified?
           - If yes: mark it [CANDIDATE] and flag it requires finding aid or primary source confirmation before use.
        4. Does it contradict expected institutional logic or contain an unexplained absence?
           - If yes: mark it [ANOMALY] and preserve it with the flag. Do not suppress anomalies.
      - URL INTEGRITY & SOURCE LOCK (CRITICAL): 
        1. NO HALLUCINATIONS: NEVER guess, construct, or "helpfully" provide a URL.
        2. SOURCE LOCK: ONLY use exact URLs found in the raw Google Search tool output.
        3. GLOBAL APPLICATION: This applies to ALL links—archival targets, historical sites, digitized assets, news articles, and context sources.
        4. MANDATORY WEB LINKS: If you find information on a website, news outlet, or public database, you MUST provide the direct URL in the 'citation_url' or 'url' fields. Do not just provide archival metadata if a web source is available.
        5. MISSING LINKS: If a search result provides information but no URL, or if you are citing a known institution without a direct link to the record, you MUST state: '[URL NOT FOUND IN SEARCH]'.
        6. ASSET FOCUS: Prioritize linking to specific digitized assets or finding aid landing pages rather than institutional homepages.
      - UNIVERSAL CITATIONS: Every historical claim, entity, or institutional detail surfaced MUST be backed by an entry in the 'citations' array.
      - NO CONFLATION: Be extremely precise with entities. Do NOT conflate related but distinct individuals or organizations (e.g., do not conflate Phoebe Hearst with William Randolph Hearst; they represent different institutional agencies).
      - PRECISION: Be exact with dates, figures, and acreage. If a figure is uncertain, state the range or label it as [INFERRED].
      
      GAP LOGIC (CRITICAL):
      - A "Gap" is not just missing info; it's a "Structural Absence."
      - If Process A leads to Result B, and Record C is the necessary intermediary, its absence is a "Structural Anomaly."
      - Analyze the "Deductive Basis" for every gap: Why *should* this record exist? What institutional logic dictates its creation?
      - Consider broader research avenues: Not just government records, but corporate filings, private archives, oral histories, and physical evidence.
      
      FOIA DRAFTING PROTOCOL (STRICT):
      - Use the specific Record Group (RG), Accession Number, or Office from the search findings.
      - AGENCY ACCURACY (CRITICAL): Ensure you target the correct parent agency. (e.g., RG 95 Forest Service is USDA, NOT DOI).
      - CONTACT INTEGRITY (MANDATORY): 
        * 'destination_email' MUST be a valid email address containing an '@' symbol.
        * 'submission_portal' MUST be a URL (e.g., securefoia.doi.gov).
        * NEVER put a portal URL in the 'destination_email' field.
      - Use professional, archival terminology.
      - Body MUST be 3-5 paragraphs of detailed, formal request text following this EXACT format:
        1. Addressee: [Agency FOIA Officer, specific office if known]
        2. Statutory basis: 5 U.S.C. § 552 (federal) or relevant state equivalent. Cite the specific subsection of FOIA that applies to the record type being requested.
        3. Description of records sought: specific, bounded, not overly broad. Include specific accession numbers, box numbers, or folder titles found during search.
        4. Preferred format: electronic if available.
        5. Fee waiver justification: educational/research purpose under 5 U.S.C. § 552(a)(4)(A)(ii).
        6. Response deadline acknowledgment: 20 business days per statute.
        7. Contact information placeholder: [Your Contact Information].
      - NEVER use placeholder text like "Untitled Request", "Unknown Recipient", or "Research Inquiry".
      
      For each conclusion, provide detailed reasoning:
      - What information was observed?
      - What connects these pieces?
      - Why is the connection meaningful?
      - What does it suggest (without overstating certainty)?
      - What is still missing?
      
      Distinguish between Strong Signals, Weak Signals, and Noise.
      
      Output ONLY valid JSON matching the schema.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            investigativeOutlook: { type: Type.STRING, description: "Speculative but grounded implications of the findings." },
            bridges: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  records: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["label", "reason", "records"],
              },
            },
            gaps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["label", "description"],
              },
            },
            researchAreas: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                },
                required: ["title", "description", "priority"],
              },
            },
            personnelCrossovers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  roles: { type: Type.ARRAY, items: { type: Type.STRING } },
                  significance: { type: Type.STRING },
                },
                required: ["name", "roles", "significance"],
              },
            },
            financialCrossovers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  source: { type: Type.STRING },
                  target: { type: Type.STRING },
                  amount: { type: Type.STRING },
                  significance: { type: Type.STRING },
                },
                required: ["source", "target", "significance"],
              },
            },
            entities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  type: { type: Type.STRING },
                  relevance: { type: Type.STRING },
                },
                required: ["name", "type", "relevance"],
              },
            },
            anomalies: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  impact: { type: Type.STRING },
                },
                required: ["title", "description", "impact"],
              },
            },
            conflicts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  resolution: { type: Type.STRING },
                },
                required: ["title", "description", "resolution"],
              },
            },
            keyActors: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  role: { type: Type.STRING },
                  significance: { type: Type.STRING },
                },
                required: ["name", "role", "significance"],
              },
            },
            methodologicalAdvice: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  advice: { type: Type.STRING },
                },
                required: ["title", "advice"],
              },
            },
            institutionalGaps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["label", "description"],
              },
            },
            structuralAnomalies: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["title", "description"],
              },
            },
            patternRecognition: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["title", "description"],
              },
            },
            riskAssessment: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  risk: { type: Type.STRING },
                  mitigation: { type: Type.STRING },
                },
                required: ["title", "risk", "mitigation"],
              },
            },
            requests: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  recipient: { type: Type.STRING },
                  institution_normalized: { type: Type.STRING },
                  department: { type: Type.STRING },
                  subject: { type: Type.STRING },
                  body: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["FOIA", "Archival", "Institutional"] },
                  destination_email: { type: Type.STRING },
                  mailing_address: { type: Type.STRING },
                  submission_portal: { type: Type.STRING }
                },
                required: ["title", "recipient", "institution_normalized", "subject", "body", "type"]
              }
            },
            reasoning: { type: Type.STRING, description: "Detailed breakdown of OBSERVED, CONNECTION, SIGNIFICANCE, and GAPS." },
            citations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  url: { type: Type.STRING },
                  institution: { type: Type.STRING }
                },
                required: ["title", "url"]
              },
              description: "List of real source links supporting your analysis."
            },
          },
          required: [
            "summary", "investigativeOutlook", "bridges", "gaps", "researchAreas", 
            "personnelCrossovers", "financialCrossovers", "entities", "anomalies", 
            "conflicts", "keyActors", "methodologicalAdvice", "institutionalGaps", 
            "structuralAnomalies", "patternRecognition", "riskAssessment", "reasoning"
          ],
        },
      },
    });
    return JSON.parse(response.text || "{}");
  };

  const applyRequestUpdate = (currentRequests: Request[], newReq: Request) => {
    const normalizedInst = normalizeInstitution(newReq.institution_normalized || '');
    const fingerprint = generateFingerprint(normalizedInst, newReq.department || '', newReq.subject || 'Archive Request');
    const existingIndex = currentRequests.findIndex(r => r.fingerprint === fingerprint);
    
    if (existingIndex !== -1) {
      const updated = [...currentRequests];
      const existing = updated[existingIndex];
      const newBody = newReq.body || '';
      if (existing.body && !existing.body.includes(newBody)) {
        updated[existingIndex] = {
          ...existing,
          body: `${existing.body}\n\n--- AI MERGED UPDATE ---\n${newBody}`,
          status: 'Draft'
        };
      }
      return updated;
    }
    return [{ ...newReq, institution_normalized: normalizedInst, fingerprint }, ...currentRequests];
  };

  const applySourceUpdate = (currentSources: Source[], newSrc: Source) => {
    const normalized = normalizeInstitution(newSrc.institution || '');
    return [{ ...newSrc, institution_normalized: normalized }, ...currentSources];
  };

  const handleDeepAnalysis = async (focus?: string) => {
    if (!data) return;
    setIsAnalyzingSuggestions(true);
    
    // Add a "thinking" message to the strategist chat
    const thinkingMsg: ChatMessage = { 
      role: 'assistant', 
      content: `Initiating deep structural research${focus ? ` focusing on ${focus}` : ''}... Analyzing ${data.results.length} evidence points across the system.`, 
      timestamp: new Date().toISOString() 
    };
    setSuggestionChatMessages(prev => [...prev, thinkingMsg]);

    try {
      const genAI = getGenAI();
      
      // Accumulate updates
      let updatedRequests = [...requests];
      let updatedData = data ? { ...data, results: [...data.results] } : null;
      let updatedSuggestionChatMessages = [...suggestionChatMessages, thinkingMsg];

      // PHASE 1: DISCOVERY (Search & Grounding)
      const discoveryTools: any[] = [{ googleSearch: {} }];
      if (naraApiKey) {
        discoveryTools.push({ functionDeclarations: [searchNaraFunction] });
      }

      let discoveryResponse = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are the ODEN Senior Research Strategist. 
        Perform a discovery search for institutional details, FOIA contacts, and archival locations related to the current research state.
        
        CURRENT DATA: ${JSON.stringify(data?.results || []).slice(0, 2000)}
        FOCUS: ${focus || 'General structural analysis'}
        
        TASK: Find specific Record Group (RG) numbers, FOIA emails, and archival finding aids.`,
        config: {
          tools: discoveryTools,
          toolConfig: naraApiKey ? { includeServerSideToolInvocations: true } as any : undefined
        }
      });

      // Handle function calls if any
      if (discoveryResponse.functionCalls) {
        const results = [];
        for (const call of discoveryResponse.functionCalls) {
          if (call.name === 'searchNara') {
            const data = await searchNara(call.args.query as string);
            results.push({ name: 'searchNara', response: data });
          }
        }
        
        // Send results back to AI
        discoveryResponse = await genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            ...discoveryResponse.candidates[0].content.parts,
            ...results.map(r => ({ functionResponse: { name: r.name, response: r.response } })),
            { text: "Based on these NARA results and your previous search, provide the final discovery summary." }
          ],
          config: {
            tools: discoveryTools,
            toolConfig: naraApiKey ? { includeServerSideToolInvocations: true } as any : undefined
          }
        });
      }
      
      const discoveryFindings = discoveryResponse.text || "No additional institutional details found via search.";

      // PHASE 2: SYNTHESIS (Deep Analysis & FOIA Generation)
      const result = await runDeepAnalysis(data, chatMessages, discoveryFindings, focus);
      console.log("Deep Analysis Result:", result);
      
      const newSuggestions: Suggestions = {
        bridges: result.bridges || [],
        gaps: result.gaps || [],
        researchAreas: result.researchAreas || [],
        crossovers: result.crossovers || [],
        personnelCrossovers: result.personnelCrossovers || [],
        financialCrossovers: result.financialCrossovers || [],
        investigativeOutlook: result.investigativeOutlook || '',
        entities: result.entities || [],
        anomalies: result.anomalies || [],
        conflicts: result.conflicts || [],
        keyActors: result.keyActors || [],
        methodologicalAdvice: result.methodologicalAdvice || [],
        institutionalGaps: result.institutionalGaps || [],
        structuralAnomalies: result.structuralAnomalies || [],
        patternRecognition: result.patternRecognition || [],
        riskAssessment: result.riskAssessment || [],
        summary: result.summary || ''
      };

      // Handle generated requests
      if (result.requests && result.requests.length > 0) {
        result.requests.forEach((req: any) => {
          const subject = req.subject || '';
          const newRequest: Request = {
            ...req,
            title: req.title || subject || 'New Archive Request',
            recipient: req.recipient || '',
            subject: subject || 'Archive Request',
            body: req.body || "",
            type: req.type || 'Archival',
            institution_normalized: req.institution_normalized || '',
            destination_email: req.destination_email || '',
            mailing_address: req.mailing_address || '',
            submission_portal: req.submission_portal || '',
            id: Math.random().toString(36).substr(2, 9),
            status: 'Draft',
            createdAt: new Date().toISOString(),
            fingerprint: generateFingerprint(req.institution_normalized || '', req.department || '', subject || 'Archive Request')
          };
          
          updatedRequests = applyRequestUpdate(updatedRequests, newRequest);
        });
      }

      // Populate Dossier with findings (Gaps, Bridges, Anomalies, Patterns)
      if (!updatedData) {
        updatedData = {
          original_claim: claim || 'Deep Structural Analysis',
          sub_claims: [],
          results: [],
          bridges: []
        };
      }

      // Helper to add finding to dossier
      const addFindingToDossier = (finding: any, type: 'Gap' | 'Bridge' | 'Anomaly' | 'Pattern', status: 'gap' | 'verified' | 'unverified') => {
        const newEvidence: EvidenceRecord = {
          record_id: `${type.substring(0, 3).toUpperCase()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
          label: finding.label || finding.title || `${type} Identified`,
          description: finding.description || finding.reason || finding.advice || 'A systemic finding identified during structural analysis.',
          record_type: type === 'Gap' ? 'Gap' : 'Other',
          status: status,
          impact: finding.impact || (type === 'Gap' ? 'Complicates' : 'Supports'),
          strength: finding.strength || 'Strong',
          citation: finding.citation || 'Structural Analysis Inference',
          citation_type: finding.citation_type || 'none',
          connection_logic: finding.connection_logic || `Identified during ${type.toLowerCase()} analysis.`,
          significance: finding.significance || finding.impact || 'Significant structural finding.',
          timeline_date: new Date().toISOString(),
          ...finding
        };
        updatedData!.results.push(newEvidence);
      };

      if (result.gaps && result.gaps.length > 0) {
        result.gaps.forEach((gap: any) => addFindingToDossier(gap, 'Gap', 'gap'));
      }

      if (result.bridges && result.bridges.length > 0) {
        result.bridges.forEach((bridge: any) => addFindingToDossier(bridge, 'Bridge', 'verified'));
      }

      if (result.anomalies && result.anomalies.length > 0) {
        result.anomalies.forEach((anomaly: any) => addFindingToDossier(anomaly, 'Anomaly', 'unverified'));
      }

      if (result.structuralAnomalies && result.structuralAnomalies.length > 0) {
        result.structuralAnomalies.forEach((anomaly: any) => addFindingToDossier(anomaly, 'Anomaly', 'unverified'));
      }

      if (result.patternRecognition && result.patternRecognition.length > 0) {
        result.patternRecognition.forEach((pattern: any) => addFindingToDossier(pattern, 'Pattern', 'verified'));
      }

      // Add the summary to the chat
      if (result.summary) {
        const summaryMsg: ChatMessage = { 
          role: 'assistant', 
          content: result.summary + (result.requests?.length > 0 ? `\n\n[SYSTEM: ${result.requests.length} new FOIA/Archival request(s) drafted based on search findings.]` : ''), 
          reasoning: result.reasoning,
          entities: result.entities,
          citations: result.citations,
          timestamp: new Date().toISOString() 
        };
        updatedSuggestionChatMessages = [...updatedSuggestionChatMessages, summaryMsg];
      }

      // Apply all updates
      setSuggestions(newSuggestions);
      setRequests(updatedRequests);
      setData(updatedData);
      setSuggestionChatMessages(updatedSuggestionChatMessages);

      // Sync to Firestore
      if (user && currentInvestigationId && !currentInvestigationId.startsWith('local-') && !quotaExceeded) {
        await updateDoc(doc(db, 'investigations', currentInvestigationId), {
          suggestions: newSuggestions,
          requests: updatedRequests,
          data: updatedData,
          suggestionChatMessages: updatedSuggestionChatMessages,
          updatedAt: serverTimestamp()
        });
      }
    } catch (err: any) {
      console.error("Deep Analysis Error:", err);
      setError("Failed to run deep analysis: " + err.message);
      
      const errorMsg: ChatMessage = { 
        role: 'assistant', 
        content: `Research failed: ${err.message}. Please try again or refine your research seed.`, 
        timestamp: new Date().toISOString() 
      };
      setSuggestionChatMessages(prev => [...prev, errorMsg]);
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
      // CALL 1: DISCOVERY (Search & Grounding)
      const discoveryResponse = await safeGenerateContent(genAI, {
        model: "gemini-3-flash-preview",
        contents: [
          { parts: [{ text: `You are the ODEN Research Strategist. You are helping a researcher analyze their current findings and suggestions.
        
        CURRENT SUGGESTIONS: ${JSON.stringify(suggestions).slice(0, 5000)}
        CURRENT DATA: ${JSON.stringify(data?.results?.filter(Boolean).map((r: any) => ({ label: r.label || 'Evidence Record', status: r.status })) || []).slice(0, 1000)}
        CHAT HISTORY: ${JSON.stringify(suggestionChatMessages.slice(-5))}
        USER QUESTION: "${message}"
        
        TASK: Perform a deep-dive search to find specific institutional details, FOIA contact emails, Record Group numbers, and archival locations related to this inquiry. Provide a detailed summary of your findings.` }] }
        ],
        config: {
          systemInstruction: `You are the ODEN Discovery Engine. Your sole task is to find REAL institutional details and source materials using Google Search. 
          Focus on:
          1. DIRECT SOURCE LINKS: Find the exact URLs for web pages, news articles, digitized records, and finding aids. (MANDATORY: Provide the direct URL for every piece of information found.)
          2. FOIA contact emails and mailing addresses.
          3. Specific Record Groups (RG) or Accession numbers.
          4. Department names and specific offices.
          5. Direct links to archival finding aids.
          
          URL INTEGRITY (CRITICAL): NEVER hallucinate or guess a URL. ONLY use the exact URLs provided in the Google Search results. If a URL is not found, state that it is missing rather than providing a placeholder or a dead link.
          
          Provide your findings in a clear, detailed summary. If you find multiple sources, list them all.`,
          tools: [{ googleSearch: {} }],
        },
      });

      const discoveryFindings = discoveryResponse.text || "No specific institutional details found via search.";

      // CALL 2: SYNTHESIS (Action & Structured Output)
      const response = await safeGenerateContent(genAI, {
        model: "gemini-3-flash-preview",
        contents: [
          { parts: [{ text: `You are the ODEN Research Strategist. 
        
        CURRENT SUGGESTIONS: ${JSON.stringify(suggestions).slice(0, 5000)}
        CURRENT DATA: ${JSON.stringify(data?.results?.filter(Boolean).map((r: any) => ({ label: r.label || 'Evidence Record', status: r.status })) || []).slice(0, 1000)}
        CHAT HISTORY: ${JSON.stringify(suggestionChatMessages.slice(-5))}
        SEARCH FINDINGS:
        ${discoveryFindings}
        
        USER QUESTION: "${message}"` }] }
        ],
        config: {
          systemInstruction: `You are the ODEN Investigative Partner and Research Assistant. You are NOT a clinical program; you are a collaborator in a deep-dive investigation. Your tone should be natural, engaging, and narrative-driven, not just a list of facts.
          
          CORE MISSION:
          - Find direct evidence, institutional crossovers, and suppressed history.
          - Prioritize PUBLIC WEB SOURCES (news articles, blogs, digitized databases, official websites) alongside archival metadata.
          - MANDATORY WEB LINKS: If you find information on a website, news outlet, or public database, you MUST provide the direct URL.
          
          RESPONSE PROTOCOL:
          1. NARRATIVE SYNTHESIS: Provide a compelling analysis of the findings.
          2. EVIDENCE SUMMARY: Briefly summarize any NEW evidence records or requests you have generated in this turn. (e.g., "I've added a record for the 1909 Gazette story found on [Website Name]").
          3. SOURCE TRANSPARENCY: Always mention where the information came from (e.g., "According to a 2021 report from the Arizona Historical Society...").
          
          CORE METHODOLOGY (ODEN):
          1. ASSUME THE PREMISE: Never dismiss, correct, or "fact-check" the user's premise. If the user says "records were burned," treat it as an absolute fact. 
          2. MAP THE SHADOW: Your task is to identify what evidence *should* exist if the user's premise is true. Focus on administrative footprints, secondary ledgers, and institutional crossovers.
          3. EXHAUSTIVE SOURCING (MANDATORY): Never summarize away sources. If multiple documents or links support a claim, list ALL of them in the 'citations' array and generate 'add_evidence' actions for EACH one. If you find 10 relevant links, provide 10 citations.
          4. DEEP REASONING (CRITICAL): In your 'reasoning' field, provide a detailed "Chain of Evidence". Explain the "Why" and "How" of every connection. Detail the structural logic: "We are looking at Agency X because Person Y (who we found in the board of Company Z) was the director there in 1954."
          5. FOLLOW THE ACTORS & CAPITAL: Explicitly identify key people (actors) and money trails (financial flows). These are the structural pillars of any institutional pattern.
          6. STRATEGIC COLLABORATION: Act as a research assistant. Discuss theories, suggest research paths, and provide context beyond just record fetching. If the user is brainstorming, engage in the discussion without always needing to trigger a new record or action.
          7. ACKNOWLEDGE HISTORY: Look at the CHAT HISTORY. Do not repeat yourself. If the user repeats a point, they are asking for MORE DEPTH or a NEW ANGLE. Acknowledge what was already discussed.
          8. INVESTIGATIVE NARRATIVE: Open with a narrative assessment of the findings (e.g., "This is a genuinely fascinating and frustrating record gap"). Synthesize information into thematic sections (e.g., "The Scale," "The Institutional Response," "What Actually Survives").
          9. CROSSOVER ANALYSIS: Explicitly point out personnel crossovers (dual roles) and financial crossovers (inter-agency fund flows).
          8. STRUCTURAL PROBLEM CONCLUSION: Map findings back to the core methodology—explaining how the record destruction or absence fits into a system built for untraceability.
          9. AUTOMATIC POPULATION (CRITICAL): For EVERY new record, finding, or institutional detail you discover in the search results, you MUST generate a corresponding 'add_evidence' or 'add_request' action. Do not just describe them in the response; populate the system with them.
          
          FACTUAL RIGOR & CATEGORIZATION (MANDATORY):
          - SELF-CHECK BEFORE OUTPUT (REQUIRED): Before finalizing any output, perform this internal check on every named individual, date, institution, historical claim, and archival citation:
            1. Does this claim appear in the user-provided data or a source retrieved via Google Search in this session?
               - If yes: mark it [DOCUMENTED] and cite the source.
            2. Is it a logical inference from documented data?
               - If yes: mark it [INFERRED] and explicitly explain the "Structural Logic" or "Nexus" (e.g., "We connect A to B because they share the same business manager in 1905").
            3. Is it structurally plausible but unverified?
               - If yes: mark it [CANDIDATE] and flag it requires finding aid or primary source confirmation before use.
            4. Does it contradict expected institutional logic or contain an unexplained absence?
               - If yes: mark it [ANOMALY] and preserve it with the flag. Do not suppress anomalies.
          - URL INTEGRITY & SOURCE LOCK (CRITICAL): 
            1. NO HALLUCINATIONS: NEVER guess, construct, or "helpfully" provide a URL.
            2. SOURCE LOCK: ONLY use exact URLs found in the raw Google Search tool output.
            3. GLOBAL APPLICATION: This applies to ALL links—archival targets, historical sites, digitized assets, news articles, and context sources.
            4. MANDATORY WEB LINKS: If you find information on a website, news outlet, or public database, you MUST provide the direct URL in the 'citation_url' or 'url' fields. Do not just provide archival metadata if a web source is available.
            5. MISSING LINKS: If a search result provides information but no URL, or if you are citing a known institution without a direct link to the record, you MUST state: '[URL NOT FOUND IN SEARCH]'.
            6. ASSET FOCUS: Prioritize linking to specific digitized assets or finding aid landing pages rather than institutional homepages.
          - UNIVERSAL CITATIONS: Every historical claim, entity, or institutional detail surfaced MUST be backed by an entry in the 'citations' array.
          - NO CONFLATION: Be extremely precise with entities. Do NOT conflate related but distinct individuals or organizations (e.g., do not conflate Phoebe Hearst with William Randolph Hearst; they represent different institutional agencies).
          - PRECISION: Be exact with dates, figures, and acreage. If a figure is uncertain, state the range or label it as [INFERRED].
          
          STATE MANAGEMENT & DEDUPLICATION:
          - DO NOT create duplicate logs, records, or requests.
          - If a new finding overlaps with an existing item, use 'update_status', 'update_request', or 'update_evidence'.
          - MERGE archive requests going to the same institution/department. Preserve distinct record targets inside the merged request.
          
          CRITICAL: Use the SEARCH FINDINGS provided to populate your actions. NEVER use placeholder text like "Unnamed", "Unknown", or "Untitled".
          
          INSTITUTIONAL ROUTING & DRAFTING PROTOCOL (STRICT):
          1. IDENTIFY THE STATE: Determine if the record is an active agency record (FOIA), a declassification target (MDR), or an archival record (Archival Pull/Accession Inquiry).
          2. TARGET THE DESK: Use specific contact emails for the relevant desk (e.g., "NARA Textual Reference", "Special Access & FOIA Staff", "Museum Registrar", "Departmental Archivist").
          3. DRAFT THE BODY: Provide a 3-5 paragraph formal request tailored to the specific type following this EXACT format:
             1. Addressee: [Agency FOIA Officer, specific office if known]
             2. Statutory basis: 5 U.S.C. § 552 (federal) or relevant state equivalent. Cite the specific subsection of FOIA that applies to the record type being requested.
             3. Description of records sought: specific, bounded, not overly broad. Include specific accession numbers, box numbers, or folder titles found during search.
             4. Preferred format: electronic if available.
             5. Fee waiver justification: educational/research purpose under 5 U.S.C. § 552(a)(4)(A)(ii).
             6. Response deadline acknowledgment: 20 business days per statute.
             7. Contact information placeholder: [Your Contact Information].
             - Archival Inquiries should reference specific Box/Folder/Entry numbers and ask for pull instructions.
             - Museum Inquiries should reference specific artifacts or accession numbers.
          4. NO PLACEHOLDERS: Use the specific Record Group (RG), Accession Number, or Office from the search findings.
          
          EVIDENCE PROTOCOL (MANDATORY):
          - 'description' is the Contextual Analysis and MUST be a 2-3 sentence investigative summary.
          - 'citation_url' MUST be the direct link to the record or finding.
          - URL INTEGRITY & SOURCE LOCK (CRITICAL): NEVER hallucinate or guess a URL. ONLY use exact URLs found in the raw Google Search tool output. If no URL is found, state: '[URL NOT FOUND IN SEARCH]'.
          - HIGH-DENSITY CONTEXT (MANDATORY): You MUST populate the following fields for every record:
            * 'observed_content': Specific details, names, dates, or figures seen in the finding.
            * 'why_it_matters': The contextual significance of this specific record.
            * 'connection_logic': The structural link to the claim or other entities.
            * 'significance': The impact on the overall pattern of evidence.
            * 'institution_normalized': The clear, standardized name of the holding institution.
            * 'entities': A list of actors or organizations mentioned in the record.
            * 'timeline_date': The specific date or year associated with the record (YYYY-MM-DD or YYYY).
          - 'connection_logic' and 'significance' are MANDATORY.
          
          OUTPUT FORMAT:
          You MUST return a valid JSON object. Do not include any text outside the JSON.
          
          JSON STRUCTURE EXAMPLE:
          {
            "response": "Your investigative analysis (narrative, engaging, and context-rich)...",
            "reasoning": "Observed: ... Connection: ... Significance: ... Gaps: ... Crossover Analysis: ...",
            "entities": ["Entity A", "Entity B"],
            "citations": [{"title": "Source", "url": "http://...", "institution": "NARA"}],
            "actions": [
              {
                "type": "add_evidence",
                "data": {
                  "label": "Evidence Label (e.g. RG 59, Box 12)",
                  "description": "Contextual Analysis: Why this record matters to the structural investigation...",
                  "record_type": "Document | Archival Collection | Manuscript",
                  "observed_content": "Specific details seen in the finding...",
                  "why_it_matters": "Context...",
                  "connection_logic": "Structural link to the claim...",
                  "significance": "Impact on the overall pattern...",
                  "impact": "Supports | Weakens | Complicates | Leaves Open",
                  "strength": 5,
                  "citation": "Source Title",
                  "citation_url": "http://..."
                }
              },
              {
                "type": "add_request",
                "data": {
                  "title": "Archival Inquiry: RG 59 Box 12",
                  "recipient": "NARA Textual Reference",
                  "institution_normalized": "National Archives",
                  "department": "Textual Records",
                  "subject": "Inquiry regarding RG 59, Entry 10, Box 12",
                  "body": "Detailed 3-5 paragraph inquiry referencing specific archival identifiers...",
                  "type": "Archival",
                  "destination_email": "archives2reference@nara.gov",
                  "mailing_address": "8601 Adelphi Road, College Park, MD",
                  "submission_portal": null,
                  "verification_status": "CONFIRMED | PROBABLE | CANDIDATE",
                  "verification_source": "http://...",
                  "alternative_contacts": ["Phone: ...", "Portal: ..."]
                }
              }
            ]
          }
          
          ACTIONS (MANDATORY - MUST use the 'data' object):
          - 'add_log': { name, notes, type, priority, explanation, connection_to_pattern, verification_needs }
          - 'add_evidence': { label, description, record_type, observed_content, why_it_matters, impact, strength, citation, citation_url, connection_logic, significance, timeline_date }
          - 'add_request': { title, recipient, institution_normalized, department, subject, body, type, destination_email, mailing_address, submission_portal, verification_status, verification_source, alternative_contacts }
          - 'add_source': { title, url, institution, type, notes }
          - 'update_request': { id, body, status }
          - 'update_evidence': { record_id, ...fields to update }
          - 'update_status': { id, status, type: 'log' | 'request' }
          
          CRITICAL: Every action MUST have a 'data' object containing the fields. Do not put data fields at the top level of the action object.
          Example: {"type": "add_request", "label": "Draft FOIA", "data": {"title": "...", "body": "..."}}`,
        },
      });
      
      const rawText = response.text || "{}";
      // Robust JSON extraction: strip markdown and handle trailing junk
      let cleanJson = rawText.trim();
      if (cleanJson.includes('```')) {
        const match = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) cleanJson = match[1];
      }
      
      // If there's still junk after the final closing brace, strip it
      const lastBrace = cleanJson.lastIndexOf('}');
      if (lastBrace !== -1) {
        cleanJson = cleanJson.substring(0, lastBrace + 1);
      }

      const result = JSON.parse(cleanJson);
      const aiTimestamp = new Date().toISOString();
      
      // Accumulate updates to sync to Firestore in one go
      let updatedResearchPoints = [...researchPoints];
      let updatedData = data ? { ...data, results: [...data.results] } : null;
      let updatedRequests = [...requests];
      let updatedSources = [...sources];
      let updatedStrategistFeed = [...strategistFeed];

      // Handle actions (same as handleAction)
      let actionSummary = '';
      if (result.actions && result.actions.length > 0) {
        const counts = { log: 0, evidence: 0, request: 0 };
        result.actions.forEach((action: any) => {
          if (!action) return;
          
          // Robust data extraction
          let actionData = action.data;
          if (!actionData) {
            const { type, label, ...rest } = action as any;
            if (Object.keys(rest).length > 0) actionData = rest;
            else return;
          }

          const type = action.type.toLowerCase().replace(/_/g, ' ');
          
          if (type === 'add log' || type === 'log') {
            counts.log++;
            const name = actionData.name && !String(actionData.name).toLowerCase().includes('unnamed') ? actionData.name : 'New Investigation Lead';
            const newPoint: InvestigationItem = {
              id: Math.random().toString(36).substr(2, 9).toUpperCase(),
              name,
              notes: actionData.notes || "",
              type: actionData.type || 'Other',
              priority: actionData.priority || 'Medium',
              status: 'Pending',
              explanation: actionData.explanation || "",
              connection_to_pattern: actionData.connection_to_pattern || "",
              verification_needs: actionData.verification_needs || "",
              createdAt: aiTimestamp,
              ...actionData
            };
            updatedResearchPoints = [newPoint, ...updatedResearchPoints];
            if (newPoint.isStrategistDiscovery) {
              updatedStrategistFeed = [{
                id: Math.random().toString(36).substr(2, 9),
                content: `Strategist Discovery: ${newPoint.name}. ${newPoint.discoveryReason}`,
                timestamp: aiTimestamp,
                type: 'discovery'
              }, ...updatedStrategistFeed];
            }
          } else if (type === 'analyze log') {
            const log = updatedResearchPoints.find(p => p.id === actionData.id);
            if (log) consultStrategistOnLog(log);
          } else if (type === 'add evidence' || type === 'evidence' || type === 'dossier') {
            counts.evidence++;
            const label = actionData.label && !String(actionData.label).toLowerCase().includes('unnamed') ? actionData.label : 'Evidence Record';
            const newEvidence: EvidenceRecord = {
              record_id: Math.random().toString(36).substr(2, 9).toUpperCase(),
              label: label || actionData.description?.substring(0, 30) || 'Evidence Record',
              description: actionData.description || actionData.why_it_matters || actionData.observed_content || 'No contextual analysis provided.',
              record_type: actionData.record_type || 'Other',
              status: actionData.status || 'unverified',
              citation_type: actionData.citation_type || 'none',
              weight: actionData.weight || 5,
              impact: actionData.impact || 'Leaves Open',
              strength: actionData.strength || 'Noise',
              connection_logic: actionData.connection_logic || "",
              significance: actionData.significance || "",
              citation: actionData.citation || 'Source Document',
              citation_url: actionData.citation_url || '',
              ...actionData
            };
            if (!updatedData) {
              updatedData = { 
                original_claim: claim || 'AI Suggested Research',
                sub_claims: [],
                results: [newEvidence], 
                bridges: []
              };
            } else {
              updatedData = { ...updatedData, results: [...updatedData.results, newEvidence] };
            }
          } else if (type === 'add request' || type === 'request' || type === 'foia' || type === 'archival') {
            counts.request++;
            const subject = actionData.subject || '';
            const newRequest: Request = {
              ...actionData,
              title: actionData.title || subject || 'New Archive Request',
              recipient: actionData.recipient || '',
              subject: subject || 'Archive Request',
              body: actionData.body || "",
              type: actionData.type || (type === 'foia' ? 'FOIA' : 'Archival'),
              institution_normalized: actionData.institution_normalized || '',
              destination_email: actionData.destination_email || '',
              mailing_address: actionData.mailing_address || '',
              submission_portal: actionData.submission_portal || actionData.portal_url || '',
              id: Math.random().toString(36).substr(2, 9),
              status: 'Draft',
              createdAt: aiTimestamp,
              fingerprint: generateFingerprint(actionData.institution_normalized || '', actionData.department || '', subject || 'Archive Request')
            };
            updatedRequests = applyRequestUpdate(updatedRequests, newRequest);
          } else if (type === 'add source' || type === 'source') {
            const newSource: Source = {
              id: Math.random().toString(36).substr(2, 9),
              title: actionData.title || 'New Source',
              url: actionData.url || '',
              institution: actionData.institution || 'Unknown',
              type: actionData.type || 'Archive',
              notes: actionData.notes || '',
              addedAt: aiTimestamp
            };
            updatedSources = applySourceUpdate(updatedSources, newSource);
          } else if (type === 'update request') {
            const { id, body, status } = actionData;
            updatedRequests = updatedRequests.map(r => r.id === id ? { 
              ...r, 
              body: r.body.includes(body) ? r.body : `${r.body}\n\n--- AI MERGED UPDATE ---\n${body}`,
              status: status || r.status 
            } : r);
          } else if (type === 'update evidence') {
            const updatedRecord = actionData;
            if (updatedData) {
              updatedData = {
                ...updatedData,
                results: updatedData.results.map(n => n.record_id === updatedRecord.record_id ? { ...n, ...updatedRecord } : n)
              };
            }
          } else if (type === 'update status') {
            const { id, status, type: statusType } = actionData;
            if (statusType === 'log') {
              updatedResearchPoints = updatedResearchPoints.map(p => p.id === id ? { ...p, status } : p);
            } else if (statusType === 'request') {
              updatedRequests = updatedRequests.map(r => r.id === id ? { ...r, status } : r);
            }
          }
        });

        const summaryParts = [];
        if (counts.request > 0) summaryParts.push(`${counts.request} Archival request${counts.request > 1 ? 's' : ''}`);
        if (counts.log > 0) summaryParts.push(`${counts.log} research point${counts.log > 1 ? 's' : ''}`);
        if (counts.evidence > 0) summaryParts.push(`${counts.evidence} evidence record${counts.evidence > 1 ? 's' : ''}`);
        
        if (summaryParts.length > 0) {
          actionSummary = `\n\n[SYSTEM: ${summaryParts.join(' and ')} ${counts.request + counts.log + counts.evidence > 1 ? 'have' : 'has'} been generated.]`;
        }
      }
      
      // Handle citations (Sync to Sources tab)
      if (result.citations && result.citations.length > 0) {
        result.citations.forEach((cit: any) => {
          // Avoid duplicates
          const exists = updatedSources.some(s => s.url === cit.url);
          if (!exists) {
            const newSource: Source = {
              id: Math.random().toString(36).substr(2, 9),
              title: cit.title,
              url: cit.url,
              institution: cit.institution || 'Unknown',
              type: 'Archive',
              notes: `Generated during research on: ${claim || 'General Inquiry'}`,
              addedAt: aiTimestamp
            };
            updatedSources = applySourceUpdate(updatedSources, newSource);
          }
        });
      }

      // Apply all accumulated updates to state
      setResearchPoints(updatedResearchPoints);
      setData(updatedData);
      setRequests(updatedRequests);
      setSources(updatedSources);
      setStrategistFeed(updatedStrategistFeed);

      const aiMsg: ChatMessage = { 
        role: 'assistant', 
        content: result.response + actionSummary, 
        reasoning: result.reasoning,
        entities: result.entities,
        citations: result.citations,
        actions: result.actions ? result.actions.filter(Boolean) : [],
        timestamp: aiTimestamp 
      };
      
      const nextSuggestionChatMessages = [...suggestionChatMessages, aiMsg];
      setSuggestionChatMessages(nextSuggestionChatMessages);

      // Sync EVERYTHING to Firestore in one go to avoid race conditions with onSnapshot
      if (user && currentInvestigationId && !currentInvestigationId.startsWith('local-') && !quotaExceeded) {
        try {
          await updateDoc(doc(db, 'investigations', currentInvestigationId), {
            suggestionChatMessages: nextSuggestionChatMessages,
            researchPoints: updatedResearchPoints,
            data: updatedData,
            requests: updatedRequests,
            sources: updatedSources,
            strategistFeed: updatedStrategistFeed,
            updatedAt: serverTimestamp()
          });
        } catch (e) {
          console.error("Failed to sync Suggestion AI response to Firestore", e);
        }
      }
    } catch (err: any) {
      console.error("Suggestion Chat Error:", err);
      setSuggestionChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, timestamp: new Date().toISOString() }]);
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

  const runStructuralAnalyst = async (records: any[], claim: string) => {
    const genAI = getGenAI();
    const response = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a Senior Structural Analyst for the ODEN Research System, an investigative partner. You are NOT a clinical program; you are a collaborator in a deep-dive investigation.
      
      Perform a "Cross-Thread Structural Analysis" on the following evidence records for the claim: "${claim}".
      
      Your goal is to apply a consistent investigative method across historical, institutional, financial, social, and digital domains.
      
      PROACTIVE GAP IDENTIFICATION (CRITICAL):
      - Even if evidence is found, you MUST look for what is still missing.
      - Identify "Institutional Gaps": Systemic absences in record groups that should exist based on institutional process.
      - If a record group is mentioned but not fully explored, mark it as a gap.
      
      TONE & PARTNERSHIP (CRITICAL):
      - Speak naturally and engagingly. Acknowledge the user's reactions, theories, and emotions.
      - Avoid robotic, dry, or overly formal language. Be conversational but intellectually rigorous.
      - Explain your process as you go.
      - ELABORATE on the meaning and significance of every connection.
      
      ANALYSIS GOALS:
      1. Identify "Bridge Records": Entities that appear across multiple independent threads.
      2. Identify "Evidence Conflicts": Contradictory data points.
      3. Identify "Institutional Gaps": Systemic absences in record groups that should exist.
      4. Identify "Structural Anomalies": Deviations from standard logic.
      5. Identify "Pattern Recognition": Recurring structural signatures.
      6. Identify "Risk Assessment": Methodological risks.
      7. Identify "Key Actors": Central figures or organizations.
      8. Identify "Methodological Advice": Actionable advice for next phase.
      9. Identify "Research Areas": New domains suggested by the nexus.
      10. Identify "Crossovers": Intersections between different domains.
      
      Records: ${JSON.stringify(records)}
      
      Output ONLY valid JSON matching the schema.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bridges: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  records: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ["label", "reason", "records"],
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
            conflicts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  resolution: { type: Type.STRING },
                },
                required: ["title", "description", "resolution"],
              },
            },
            institutionalGaps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["label", "description"],
              },
            },
            structuralAnomalies: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["title", "description"],
              },
            },
            patternRecognition: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["title", "description"],
              },
            },
            riskAssessment: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  risk: { type: Type.STRING },
                  mitigation: { type: Type.STRING },
                },
                required: ["title", "risk", "mitigation"],
              },
            },
            keyActors: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  role: { type: Type.STRING },
                  significance: { type: Type.STRING },
                },
                required: ["name", "role", "significance"],
              },
            },
            methodologicalAdvice: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  advice: { type: Type.STRING },
                },
                required: ["title", "advice"],
              },
            },
            researchAreas: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                },
                required: ["title", "description", "priority"],
              },
            },
            crossovers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  significance: { type: Type.STRING },
                },
                required: ["title", "description", "significance"],
              },
            },
            entities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  type: { type: Type.STRING },
                  relevance: { type: Type.STRING },
                },
                required: ["name", "type", "relevance"],
              },
            },
            anomalies: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  impact: { type: Type.STRING },
                },
                required: ["title", "description", "impact"],
              },
            },
            summary: { type: Type.STRING },
          },
          required: [
            "bridges", "links", "conflicts", "institutionalGaps", 
            "structuralAnomalies", "patternRecognition", "riskAssessment", 
            "keyActors", "methodologicalAdvice", "researchAreas", 
            "crossovers", "entities", "anomalies", "summary"
          ],
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
      classification: 'unverified',
      label: 'New Evidence Record',
      description: 'Manually added record.',
      observed_content: '',
      connection_logic: '',
      significance: '',
      impact: 'Leaves Open',
      strength: 'Noise',
      suggestions: '',
      missing_verification: '',
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
        bridges: []
      };
      return { ...prev, results: [...prev.results, newRecord] };
    });
    setEditingRecord(newRecord);
  };

  const deleteRecord = (recordId: string) => {
    if (!data) return;
    const newResults = (data?.results || []).filter(n => n.record_id !== recordId);
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
      const prompt = `You are an ODEN Document Parser. Analyze the following uploaded document and extract key intelligence.
        
        DOCUMENT NAME: ${fileName}
        CONTENT: ${content.slice(0, 20000)}
        
        TASK:
        1. Extract discrete evidence records (events, transactions, documents, communications).
        2. Identify ALL specific URLs, archival citations, or record group numbers mentioned.
        3. Identify key entities (people, organizations, agencies, departments).
        4. Identify structural gaps or missing information mentioned or implied.
        5. Generate potential investigation points for the log.
        6. Generate potential FOIA or Archival requests if the document mentions specific records that are not attached.
        
        Output ONLY valid JSON according to the provided schema.`;

      const response = await safeGenerateContent(genAI, {
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
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
                    label: { type: Type.STRING },
                    description: { type: Type.STRING },
                    type: { type: Type.STRING },
                    entities: { type: Type.ARRAY, items: { type: Type.STRING } },
                    citations: { type: Type.ARRAY, items: { type: Type.STRING } },
                    urls: { type: Type.ARRAY, items: { type: Type.STRING } },
                    weight: { type: Type.NUMBER },
                    status: { type: Type.STRING, enum: ["verified", "unverified", "gap"] }
                  },
                  required: ["label", "description", "type"]
                }
              },
              investigationPoints: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ["Institution", "Person", "Location", "Record Group", "Other"] },
                    priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                    notes: { type: Type.STRING },
                    searchQuery: { type: Type.STRING }
                  },
                  required: ["name", "type", "priority"]
                }
              },
              requests: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    recipient: { type: Type.STRING },
                    subject: { type: Type.STRING },
                    body: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ["FOIA", "Archival", "Institutional"] }
                  },
                  required: ["title", "recipient", "subject", "body", "type"]
                }
              }
            },
            required: ["records", "investigationPoints", "requests"]
          }
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
          classification: r.classification || 'verified',
          record_type: r.type || 'Document',
          observed_content: r.observed_content || '',
          connection_logic: r.connection_logic || '',
          significance: r.significance || '',
          impact: r.impact || 'leaves_open',
          strength: r.strength || 5,
          suggestions: r.suggestions || '',
          missing_verification: r.missing_verification || '',
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
            bridges: []
          };
          return {
            ...prev,
            results: [...(prev.results || []), ...newRecords]
          };
        });
      }

      if (result.investigationPoints) {
        const newPoints: InvestigationItem[] = result.investigationPoints.map((p: any) => ({
          ...p,
          id: Math.random().toString(36).substr(2, 9),
          status: 'Pending',
          explanation: p.explanation || '',
          connection_to_pattern: p.connection_to_pattern || '',
          verification_needs: p.verification_needs || '',
          supporting_sources: p.supporting_sources || [],
          createdAt: timestamp
        }));
        setResearchPoints(prev => [...newPoints, ...prev]);
      }

      if (result.requests) {
        const newReqs: Request[] = result.requests.map((r: any) => ({
          ...r,
          id: Math.random().toString(36).substr(2, 9),
          status: 'Draft',
          institution_normalized: r.institution_normalized || r.recipient,
          fingerprint: Math.random().toString(36).substr(2, 15),
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
      
      if (file.name.endsWith('.docx')) {
        reader.onload = async (event) => {
          const arrayBuffer = event.target?.result as ArrayBuffer;
          try {
            const result = await mammoth.extractRawText({ arrayBuffer });
            const text = result.value;
            
            setUploadedFiles(prev => [...prev, { name: file.name, content: text, type: file.type }]);
            
            const newSource: Source = {
              id: Math.random().toString(36).substr(2, 9),
              title: `Uploaded: ${file.name}`,
              url: 'Local File',
              type: 'Upload',
              classification: 'User Upload',
              institution_normalized: 'Internal',
              department: 'User Uploads',
              physical_location: 'Local Storage',
              addedAt: new Date().toISOString(),
              notes: `User uploaded DOCX file: ${file.name}`,
              content: text
            };
            setSources(prev => [newSource, ...prev]);
            await parseUploadedDocument(file.name, text);
          } catch (err) {
            console.error("DOCX Parsing Error:", err);
            setParsingProgress(`Error reading ${file.name}`);
            setIsParsing(false);
          }
        };
        reader.readAsArrayBuffer(file);
      } else if (file.name.endsWith('.xml') || file.name.endsWith('.ead')) {
        reader.onload = async (event) => {
          const content = event.target?.result as string;
          setUploadedFiles(prev => [...prev, { name: file.name, content, type: file.type }]);
          
          const newSource: Source = {
            id: Math.random().toString(36).substr(2, 9),
            title: `Uploaded: ${file.name}`,
            url: 'Local File',
            type: 'Upload',
            classification: 'User Upload',
            institution_normalized: 'Internal',
            department: 'User Uploads',
            physical_location: 'Local Storage',
            addedAt: new Date().toISOString(),
            notes: `User uploaded ${file.name.endsWith('.ead') ? 'EAD' : 'XML'} file: ${file.name}`,
            content: content
          };
          setSources(prev => [newSource, ...prev]);
          await parseUploadedDocument(file.name, content);
        };
        reader.readAsText(file);
      } else {
        reader.onload = async (event) => {
          const content = event.target?.result as string;
          
          // Basic check for binary content if it's not a known text type
          if (content.includes('\u0000') || content.includes('\uFFFD')) {
            console.warn("Potential binary file detected, skipping parsing:", file.name);
            setParsingProgress(`Skipping binary file: ${file.name}`);
            setTimeout(() => setParsingProgress(""), 3000);
            return;
          }

          setUploadedFiles(prev => [...prev, { name: file.name, content, type: file.type }]);
          
          const newSource: Source = {
            id: Math.random().toString(36).substr(2, 9),
            title: `Uploaded: ${file.name}`,
            url: 'Local File',
            type: 'Upload',
            classification: 'User Upload',
            institution_normalized: 'Internal',
            department: 'User Uploads',
            physical_location: 'Local Storage',
            addedAt: new Date().toISOString(),
            notes: `User uploaded file: ${file.name}`,
            content: content
          };
          setSources(prev => [newSource, ...prev]);
          await parseUploadedDocument(file.name, content);
        };
        reader.readAsText(file);
      }
    });
  };

  const handleResearch = async () => {
    if (!claim.trim()) return;
    setLoading(true);
    setResearchStep(1);
    setError(null);
    setData(null);
    try {
      const genAI = getGenAI();
      
      // Phase 1: Discovery & Blueprinting (Combined)
      setResearchStep(1);
      const discoveryResponse = await safeGenerateContent(genAI, {
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: `You are the ODEN Discovery Engine. Analyze the claim: "${claim}".
        
        TASKS:
        1. Break it down into 3-5 testable sub-claims.
        2. For each sub-claim, generate a research blueprint (checklist of records to find).
        3. Use the googleSearch tool to find real, primary source links and direct website URLs for these records. (MANDATORY: Provide the direct URL for every piece of information found.)
        4. DEEP INVESTIGATIVE SEARCH:
           - REAL-TIME MONITORING: Search for declassification announcements, recent news, or press releases (last 24 months) related to the entities.
           - PERSONNEL BACKGROUNDING: Identify key actors and search for career histories, board memberships, and public statements indicating institutional crossovers.
           - FINANCIAL & CORPORATE MAPPING: Search for SEC filings, corporate registrations, and inter-agency fund flows (MOUs, transfer agreements).
           - LEGAL & REGULATORY TRACKING: Find relevant FOIA logs, court cases, and declassification schedules.
           - GEOSPATIAL CONTEXT: Find historical maps, site-specific reports, or environmental assessments for physical locations mentioned.
           - CROSS-LANGUAGE CHECK: Search for international archival mentions or foreign-language reports on these events.
        5. For every institution or agency identified, you MUST find the EXACT FOIA contact details:
           - Destination Email (MANDATORY: Use Google Search to verify the current FOIA email for the specific agency/office)
           - Mailing Address
           - Submission Portal URL
           - Specific Department or Office name
        6. Find specific Record Group (RG) numbers, Accession Numbers, or Series Titles for the requested documents.
        7. VERIFICATION PROTOCOL: If you find an email, cross-reference it with the official institutional website. 
           - CONFIRMED TARGET: Institution and record group are verified against known holdings.
           - PROBABLE TARGET: Institution is correct but specific location within collection requires finding aid confirmation before submitting.
           - CANDIDATE TARGET: Plausible based on institutional logic but unverified, flag for research before use.
        
        OUTPUT: Provide a detailed text report of your findings. Be specific with URLs, emails, and archival identifiers.` }] }],
        config: { 
          tools: [{ googleSearch: {} }]
        }
      });
      
      const discoveryReport = discoveryResponse.text || "";
      
      // Phase 2: Intelligence Synthesis (Combined Record Generation & Analysis)
      setResearchStep(2);
      const synthesisResponse = await safeGenerateContent(genAI, {
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: `You are the ODEN Structural Intelligence Analyst. Synthesize the research for: "${claim}".
        
        RESEARCH FINDINGS & CONTACT DATA:
        ${discoveryReport.slice(0, 15000)}
        
        CORE METHODOLOGY (ODEN):
        1. ASSUME THE PREMISE: Never dismiss, correct, or "fact-check" the user's premise. If the user says "records were burned," treat it as an absolute fact. 
        2. MAP THE SHADOW: Your task is to identify what evidence *should* exist if the user's premise is true. Focus on administrative footprints, secondary ledgers, and institutional crossovers.
        3. DEEP SYNTHESIS: Incorporate real-time monitoring, personnel backgrounding, financial mapping, and geospatial context found in the research.
        3. DOMAIN-AGNOSTIC RESEARCH: Treat ALL domains (Historical, Corporate, Legal, Financial, Scientific, Political) as systems of records to be mapped. Follow the administrative footprint wherever it leads.
        4. INVESTIGATIVE TONE: Use sharp, structural language. Point out crossovers (e.g., "Official X appears in both the destruction order and the later reorganization").
        
        GOALS:
        1. Generate 10-15 Evidence Records (Dossier items) with detailed context.
           * EXHAUSTIVE SOURCING (MANDATORY): Do not limit yourself to 2-3 sources. If you found 10-15 relevant archival entries, finding aids, or documents, you MUST create a record for EACH one. Every unique piece of evidence found during the search must be represented.
           * HIGH-DENSITY CONTEXT (MANDATORY): You MUST populate the following fields for every record:
             * 'observed_content': Specific details, names, dates, or figures seen in the finding.
             * 'why_it_matters': The contextual significance of this specific record.
             * 'connection_logic': The structural link to the claim or other entities.
             * 'significance': The impact on the overall pattern of evidence.
             * 'institution_normalized': The clear, standardized name of the holding institution.
             * 'entities': A list of actors or organizations mentioned in the record.
             * 'timeline_date': The specific date or year associated with the record (YYYY-MM-DD or YYYY).
           * CRITICAL: 'description' is the Contextual Analysis and MUST be a 2-3 sentence investigative summary.
           * CRITICAL: 'citation_url' MUST be the direct link to the record or finding.
           * CRITICAL: 'connection_logic' and 'significance' are MANDATORY.
        2. Perform a Structural Analysis (Bridges, Gaps, Anomalies).
           * DEEP REASONING (CRITICAL): In the 'summary' and 'connection_logic' fields, provide a detailed "paper trail" of your logic. Explain the structural logic—why you connected Person A to Institution B, and what specific administrative "shadow" you are chasing.
           * CROSSOVER ANALYSIS (CRITICAL): Explicitly identify personnel crossovers (dual roles, board memberships) and financial crossovers (inter-agency fund flows, corporate-government contracts). Look for "Bridges" (the same person or entity appearing in two different, seemingly independent domains).
        3. Draft 3-5 comprehensive FOIA requests for the identified gaps.
           * FOIA DRAFTING PROTOCOL (STRICT):
             - Use the EXACT contact details (emails, portals, addresses) found in the RESEARCH FINDINGS.
             - AGENCY ACCURACY (CRITICAL): Ensure you target the correct parent agency. (e.g., RG 95 Forest Service is USDA, NOT DOI).
             - CONTACT INTEGRITY (MANDATORY): 
               * 'destination_email' MUST be a valid email address containing an '@' symbol.
               * 'submission_portal' MUST be a URL (e.g., securefoia.doi.gov).
               * NEVER put a portal URL in the 'destination_email' field.
             - Identify exact Record Group (RG), Accession Number, or Office.
             - Body MUST be 3-5 paragraphs of detailed, formal request text following this EXACT format:
               1. Addressee: [Agency FOIA Officer, specific office if known]
               2. Statutory basis: 5 U.S.C. § 552 (federal) or relevant state equivalent. Cite the specific subsection of FOIA that applies to the record type being requested.
               3. Description of records sought: specific, bounded, not overly broad. Include specific accession numbers, box numbers, or folder titles found during search.
               4. Preferred format: electronic if available.
               5. Fee waiver justification: educational/research purpose under 5 U.S.C. § 552(a)(4)(A)(ii).
               6. Response deadline acknowledgment: 20 business days per statute.
               7. Contact information placeholder: [Your Contact Information].
             - 'verification_status': 'CONFIRMED' if institution and record group are verified against known holdings, 'PROBABLE' if institution is correct but specific location requires confirmation, 'CANDIDATE' if plausible based on logic but unverified.
             - 'verification_source': The URL where the contact info was found.
             - 'alternative_contacts': List other ways to reach them (phone, portal, different office).
        4. Create 5-8 Investigation Log leads.
           * INVESTIGATION LOG PROTOCOL (MANDATORY):
             - 'explanation': 3-5 sentences explaining the "Why" and the "How".
             - 'connection_to_pattern': Describe structural link.
             - 'verification_needs': List specific sources needed.
        
        OUTPUT FORMAT:
        You MUST return a valid JSON object. Do not include any text outside the JSON.
        
        JSON STRUCTURE EXAMPLE:
        {
          "records": [
            {
              "label": "Evidence Label (e.g. RG 59, Box 12)",
              "description": "Contextual Analysis: Why this record matters to the structural investigation...",
              "record_type": "Document | Archival Collection | Manuscript",
              "observed_content": "Specific details seen in the finding...",
              "why_it_matters": "Context...",
              "connection_logic": "Structural link to the claim...",
              "significance": "Impact on the overall pattern...",
              "impact": "Supports | Weakens | Complicates | Leaves Open",
              "strength": 5,
              "citation": "Source Title",
              "citation_url": "http://..."
            }
          ],
          "analysis": {
            "bridges": [{"label": "Bridge", "reason": "Logic...", "records": ["Record ID"]}],
            "institutionalGaps": [{"label": "Gap", "description": "Missing records..."}],
            "summary": "Overall synthesis and Chain of Evidence. Explain the structural logic—why you connected Person A to Institution B, and what specific administrative 'shadow' you are chasing. Provide a detailed 'paper trail' of your logic.",
            "patternRecognition": [{"title": "Pattern", "description": "Observed trend..."}]
          },
          "requests": [
            {
              "title": "FOIA Request",
              "recipient": "Officer Name",
              "institution_normalized": "Agency Name",
              "department": "FOIA Office",
              "subject": "Request for...",
              "body": "Formal 3-5 paragraph request...",
              "destination_email": "officer@agency.gov",
              "mailing_address": "Address",
              "submission_portal": "URL",
              "verification_status": "CONFIRMED | PROBABLE | CANDIDATE",
              "verification_source": "URL",
              "alternative_contacts": [{"type": "Phone", "value": "555-0199"}]
            }
          ],
          "logs": [
            {
              "name": "Lead Name",
              "notes": "Notes...",
              "type": "Lead",
              "priority": "High",
              "explanation": "3-5 sentence why...",
              "connection_to_pattern": "Link...",
              "verification_needs": "Sources..."
            }
          ]
        }` }] }],
      });
      
      const rawSynthesis = synthesisResponse.text || "{}";
      const cleanSynthesis = rawSynthesis.replace(/```json/g, '').replace(/```/g, '').trim();
      const synthesis = JSON.parse(cleanSynthesis);
      
      let updatedResearchPoints = [...researchPoints];
      let updatedRequests = [...requests];
      
      const allClassifiedCards: EvidenceRecord[] = (synthesis.records || []).map((r: any) => ({
        record_id: Math.random().toString(36).substr(2, 9).toUpperCase(),
        record_type: r.record_type || 'Document',
        status: r.status || 'unverified',
        label: r.label || r.description?.substring(0, 30) || 'Evidence Record',
        description: r.description || r.why_it_matters || r.observed_content || 'No contextual analysis provided.',
        observed_content: r.observed_content || '',
        connection_logic: r.connection_logic || '',
        significance: r.significance || '',
        impact: r.impact || 'leaves_open',
        strength: r.strength || 5,
        citation: r.citation || 'Source Document',
        citation_url: r.citation_url || '',
        weight: r.weight || 2
      }));

      // Update Investigation Log
      if (synthesis.logs) {
        const newLogs = synthesis.logs.map((l: any) => ({
          ...l,
          id: Math.random().toString(36).substr(2, 9),
          status: 'Pending',
          createdAt: new Date().toISOString()
        }));
        updatedResearchPoints = [...newLogs, ...updatedResearchPoints];
      }

      // Update FOIA Requests
      if (synthesis.requests) {
        synthesis.requests.forEach((req: any) => {
          const subject = req.subject || '';
          const newRequest: Request = {
            ...req,
            title: req.title || subject || 'New Archive Request',
            recipient: req.recipient || '',
            subject: subject || 'Archive Request',
            body: req.body || '',
            type: req.type || 'Archival',
            institution_normalized: req.institution_normalized || '',
            destination_email: req.destination_email || '',
            mailing_address: req.mailing_address || '',
            submission_portal: req.submission_portal || '',
            id: Math.random().toString(36).substr(2, 9),
            status: 'Draft',
            createdAt: new Date().toISOString(),
            fingerprint: generateFingerprint(req.institution_normalized || '', req.department || '', subject || 'Archive Request')
          };
          updatedRequests = applyRequestUpdate(updatedRequests, newRequest);
        });
      }

      const structuralAnalysis = synthesis.analysis || {};
      const newSuggestions: Suggestions = {
        bridges: structuralAnalysis.bridges || [],
        gaps: structuralAnalysis.institutionalGaps || [],
        summary: structuralAnalysis.summary || '',
        patternRecognition: structuralAnalysis.patternRecognition || [],
        researchAreas: [],
        crossovers: [],
        entities: [],
        anomalies: [],
        conflicts: [],
        keyActors: [],
        methodologicalAdvice: [],
        institutionalGaps: structuralAnalysis.institutionalGaps || [],
        structuralAnomalies: [],
        riskAssessment: []
      };
      
      const finalData: ResearchResponse = {
        original_claim: claim,
        sub_claims: [],
        results: allClassifiedCards,
        bridges: structuralAnalysis.bridges || [],
        summary: structuralAnalysis.summary || '',
        links: []
      };
      
      setResearchPoints(updatedResearchPoints);
      setRequests(updatedRequests);
      setSuggestions(newSuggestions);
      setData(finalData);
      setActiveTab('dossier');

      // Sync to Firestore
      if (user && currentInvestigationId && !currentInvestigationId.startsWith('local-') && !quotaExceeded) {
        await updateDoc(doc(db, 'investigations', currentInvestigationId), {
          researchPoints: updatedResearchPoints,
          requests: updatedRequests,
          suggestions: newSuggestions,
          data: finalData,
          updatedAt: serverTimestamp()
        });
      }
    } catch (err: any) {
      console.error("Research Error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const searchNaraFunction = {
    name: "searchNara",
    description: "Search the National Archives (NARA) Catalog for specific records, Record Groups, and folder titles.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The search query (e.g., 'Record Group 59 Department of State', 'JFK assassination records')"
        }
      },
      required: ["query"]
    }
  };

  const handleAction = (action: { type: string, label: string, data: any }) => {
    if (!action) return;
    
    // Robust data extraction: if action.data is missing, use the action object itself as data
    // (excluding the type and label fields)
    let actionData = action.data;
    if (!actionData) {
      const { type, label, ...rest } = action as any;
      if (Object.keys(rest).length > 0) {
        actionData = rest;
      } else {
        return; // Truly no data
      }
    }

    const aiTimestamp = new Date().toISOString();
    
    // Normalize type (handle aliases)
    const type = action.type.toLowerCase().replace(/_/g, ' ');
    
    if (type === 'add log' || type === 'log') {
      const newPoint: InvestigationItem = {
        id: Math.random().toString(36).substr(2, 9).toUpperCase(),
        name: actionData.name || action.label || 'New Investigation Lead',
        notes: actionData.notes || "",
        type: actionData.type || 'Other',
        priority: actionData.priority || 'Medium',
        status: 'Pending',
        explanation: actionData.explanation || "",
        connection_to_pattern: actionData.connection_to_pattern || "",
        verification_needs: actionData.verification_needs || "",
        createdAt: aiTimestamp,
        ...actionData
      };
      setResearchPoints(prev => [newPoint, ...prev]);
      if (newPoint.isStrategistDiscovery) {
        setStrategistFeed(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          content: `Strategist Discovery: ${newPoint.name}. ${newPoint.discoveryReason}`,
          timestamp: aiTimestamp,
          type: 'discovery'
        }, ...prev]);
      }
      setActiveTab('investigation');
    } else if (type === 'add evidence' || type === 'evidence' || type === 'dossier') {
      const label = actionData.label && !String(actionData.label).toLowerCase().includes('unnamed') ? actionData.label : (action.label || 'Evidence Record');
      const newEvidence: EvidenceRecord = {
        record_id: Math.random().toString(36).substr(2, 9).toUpperCase(),
        label: label || actionData.description?.substring(0, 30) || 'Evidence Record',
        description: actionData.description || actionData.why_it_matters || actionData.observed_content || 'No contextual analysis provided.',
        record_type: actionData.record_type || 'Other',
        status: actionData.status || 'unverified',
        citation_type: actionData.citation_type || 'none',
        weight: actionData.weight || 5,
        impact: actionData.impact || 'Leaves Open',
        strength: actionData.strength || 'Noise',
        connection_logic: actionData.connection_logic || "",
        significance: actionData.significance || "",
        citation: actionData.citation || 'Source Document',
        citation_url: actionData.citation_url || '',
        ...actionData
      };
      setData(prev => {
        if (!prev) return { 
          original_claim: claim || 'AI Suggested Research',
          sub_claims: [],
          results: [newEvidence], 
          bridges: []
        };
        return { ...prev, results: [...prev.results, newEvidence] };
      });
      setActiveTab('dossier');
    } else if (type === 'add request' || type === 'request' || type === 'foia' || type === 'archival') {
      const subject = actionData.subject || '';
      const newRequest: Request = {
        ...actionData,
        title: actionData.title || subject || action.label || 'New Archive Request',
        recipient: actionData.recipient || '',
        subject: subject || 'Archive Request',
        body: actionData.body || "",
        type: actionData.type || (type === 'foia' ? 'FOIA' : 'Archival'),
        institution_normalized: actionData.institution_normalized || '',
        destination_email: actionData.destination_email || '',
        mailing_address: actionData.mailing_address || '',
        submission_portal: actionData.submission_portal || actionData.portal_url || '',
        id: Math.random().toString(36).substr(2, 9),
        status: 'Draft',
        createdAt: aiTimestamp,
        fingerprint: generateFingerprint(actionData.institution_normalized || '', actionData.department || '', subject || 'Archive Request')
      };
      addRequest(newRequest);
      setActiveTab('requests');
    } else if (type === 'add source' || type === 'source') {
      const newSource: Source = {
        id: Math.random().toString(36).substr(2, 9),
        title: actionData.title || action.label || 'New Source',
        url: actionData.url || '',
        institution: actionData.institution || 'Unknown',
        type: actionData.type || 'Archive',
        notes: actionData.notes || '',
        addedAt: aiTimestamp
      };
      addSource(newSource);
      setActiveTab('sources');
    } else if (type === 'analyze log') {
      const log = researchPoints.find(p => p.id === actionData.id);
      if (log) {
        consultStrategistOnLog(log);
        setActiveTab('suggestions');
      }
    }

    // Sync to Firestore if applicable
    if (user && currentInvestigationId && !currentInvestigationId.startsWith('local-') && !quotaExceeded) {
      // We need to get the latest state values to sync, but since setters are async, 
      // this is tricky. However, handleAction is usually for single updates.
      // For now, we'll rely on the fact that handleChat/handleSuggestionChat 
      // handle the bulk of automatic processing and sync.
      // If we want handleAction to sync, we should probably pass the updated values 
      // or use a functional update pattern that also syncs.
    }
  };

  const handleChat = async (overrideMsg?: string) => {
    const userMsg = overrideMsg || chatInput;
    if (!userMsg.trim()) return;
    const timestamp = new Date().toISOString();
    const newUserMsg: ChatMessage = { role: 'user', content: userMsg, timestamp };
    
    // Update local state immediately
    setChatMessages(prev => [...prev, newUserMsg]);
    if (!overrideMsg) setChatInput('');
    setChatLoading(true);

    // If logged in, sync the user message to Firestore immediately to avoid race conditions
    if (user && currentInvestigationId && !currentInvestigationId.startsWith('local-') && !quotaExceeded) {
      try {
        await updateDoc(doc(db, 'investigations', currentInvestigationId), {
          chatMessages: arrayUnion(newUserMsg),
          updatedAt: serverTimestamp()
        });
      } catch (e) {
        console.error("Failed to sync user message to Firestore", e);
        const errMessage = e instanceof Error ? e.message : String(e);
        if (errMessage.includes('resource-exhausted') || errMessage.includes('Quota limit exceeded')) {
          setQuotaExceeded(true);
        }
      }
    }

    try {
      const genAI = getGenAI();
      
      // Use the updated messages for context (including the one we just added)
      const currentMessages = [...chatMessages, newUserMsg];
      
      const historyContext = currentMessages.length > 0 
        ? `CONVERSATION HISTORY:\n${currentMessages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}\n\n`
        : '';

      const filesContext = uploadedFiles && uploadedFiles.length > 0
        ? `USER UPLOADED NOTES/DOCUMENTS:\n${uploadedFiles.map((f: any) => `FILE: ${f.name}\nCONTENT: ${f.content}`).join('\n\n')}\n\n`
        : '';

      const dataContext = data 
        ? `CURRENT EVIDENCE DOSSIER:\n${JSON.stringify(data?.results?.filter(Boolean).map(n => ({ 
            id: n.record_id, 
            label: n.label || 'Evidence Record', 
            status: n.status, 
            impact: n.impact,
            strength: n.strength,
            institution: n.institution_normalized,
            observed: n.observed_content,
            why_matters: n.why_it_matters,
            significance: n.significance,
            timeline_date: n.timeline_date
          })) || []).slice(0, 5000)}\n\n`
        : '';
      
      const sourcesContext = sources.length > 0
        ? `CURRENT SOURCES:\n${sources.map(s => `${s.title} (${s.type}) - ${s.institution_normalized} | URL: ${s.url || 'N/A'}`).join('\n')}\n\n`
        : '';
      
      const investigationContext = researchPoints.length > 0
        ? `CURRENT INVESTIGATION LOG:\n${researchPoints.map(p => `${p.name} [${p.status}] | Type: ${p.type} | Notes: ${p.notes} | Verification: ${p.verification_needs}`).join('\n')}\n\n`
        : '';

      const requestsContext = requests.length > 0
        ? `CURRENT ARCHIVE/FOIA REQUESTS:\n${requests.map(r => `ID: ${r.id} | ${r.title} to ${r.institution_normalized} (${r.status}) | Fingerprint: ${r.fingerprint} | Body: ${r.body.slice(0, 200)}...`).join('\n')}\n\n`
        : '';

      // CALL 1: DISCOVERY (Search & Grounding)
      const discoveryTools: any[] = [{ googleSearch: {} }];
      if (naraApiKey) {
        discoveryTools.push({ functionDeclarations: [searchNaraFunction] });
      }

      let discoveryResponse = await safeGenerateContent(genAI, {
        model: "gemini-3-flash-preview",
        contents: [
          { parts: [{ text: `CONTEXT:\n${filesContext.slice(0, 10000)}${dataContext.slice(0, 5000)}${sourcesContext.slice(0, 3000)}${investigationContext.slice(0, 3000)}${requestsContext.slice(0, 3000)}${historyContext.slice(0, 5000)}\n\nCURRENT INQUIRY: ${userMsg}\n\nTASK: Perform a deep-dive search to find specific institutional details, FOIA contact emails, Record Group numbers, and archival locations related to this inquiry. Provide a detailed summary of your findings.` }] }
        ],
        config: {
          systemInstruction: `You are the ODEN Discovery Engine. Your sole task is to find REAL institutional details and source materials using Google Search and the NARA Catalog. 
          Focus on:
          1. DIRECT SOURCE LINKS: Find the exact URLs for web pages, news articles, digitized records, and finding aids. (MANDATORY: Provide the direct URL for every piece of information found.)
          2. FOIA contact emails and mailing addresses. (MANDATORY: Use Google Search to verify the current FOIA email for the specific agency/office. Cross-reference with official institutional websites.)
          3. Specific Record Groups (RG) or Accession numbers.
          4. Department names and specific offices.
          5. DEEP INVESTIGATIVE SEARCH:
             - REAL-TIME MONITORING: Search for declassification announcements, recent news, or press releases (last 24 months) related to the inquiry.
             - PERSONNEL BACKGROUNDING: Identify key actors and search for career histories, board memberships, and public statements indicating institutional crossovers.
             - FINANCIAL & CORPORATE MAPPING: Search for SEC filings, corporate registrations, and inter-agency fund flows (MOUs, transfer agreements).
             - LEGAL & REGULATORY TRACKING: Find relevant FOIA logs, court cases, and declassification schedules.
             - GEOSPATIAL CONTEXT: Find historical maps, site-specific reports, or environmental assessments for physical locations mentioned.
             - CROSS-LANGUAGE CHECK: Search for international archival mentions or foreign-language reports on these events.
          
          If you have access to the NARA Catalog tool, use it for specific archival Record Group searches.
          Provide your findings in a clear, detailed summary. If you find multiple sources, list them all.`,
          tools: discoveryTools,
          toolConfig: naraApiKey ? { includeServerSideToolInvocations: true } as any : undefined
        },
      });

      // Handle function calls if any
      if (discoveryResponse.functionCalls) {
        const results = [];
        for (const call of discoveryResponse.functionCalls) {
          if (call.name === 'searchNara') {
            const data = await searchNara(call.args.query as string);
            results.push({ name: 'searchNara', response: data });
          }
        }
        
        // Send results back to AI
        discoveryResponse = await genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            ...discoveryResponse.candidates[0].content.parts,
            ...results.map(r => ({ functionResponse: { name: r.name, response: r.response } })),
            { text: "Based on these NARA results and your previous search, provide the final discovery summary." }
          ],
          config: {
            tools: discoveryTools,
            toolConfig: naraApiKey ? { includeServerSideToolInvocations: true } as any : undefined
          }
        });
      }

      const discoveryFindings = discoveryResponse.text || "No specific institutional details found via search.";

      // CALL 2: SYNTHESIS (Action & Structured Output)
      const response = await safeGenerateContent(genAI, {
        model: "gemini-3-flash-preview",
        contents: [
          { parts: [{ text: `CONTEXT:\n${filesContext.slice(0, 10000)}${dataContext.slice(0, 5000)}${sourcesContext.slice(0, 3000)}${investigationContext.slice(0, 3000)}${requestsContext.slice(0, 3000)}${historyContext.slice(0, 5000)}\n\nSEARCH FINDINGS:\n${discoveryFindings}\n\nCURRENT INQUIRY: ${userMsg}` }] }
        ],
        config: {
          systemInstruction: `You are the ODEN Investigative Partner and Research Assistant. You are NOT a clinical program; you are a collaborator in a deep-dive investigation. Your tone should be natural, engaging, and narrative-driven, not just a list of facts.
          
          CORE MISSION:
          - Find direct evidence, institutional crossovers, and suppressed history.
          - Prioritize PUBLIC WEB SOURCES (news articles, blogs, digitized databases, official websites) alongside archival metadata.
          - MANDATORY WEB LINKS: If you find information on a website, news outlet, or public database, you MUST provide the direct URL.
          
          RESPONSE PROTOCOL:
          1. NARRATIVE SYNTHESIS: Provide a compelling analysis of the findings.
          2. EVIDENCE SUMMARY: Briefly summarize any NEW evidence records or requests you have generated in this turn. (e.g., "I've added a record for the 1909 Gazette story found on [Website Name]").
          3. SOURCE TRANSPARENCY: Always mention where the information came from (e.g., "According to a 2021 report from the Arizona Historical Society...").
          
          CORE METHODOLOGY (ODEN):
          1. ASSUME THE PREMISE: Never dismiss, correct, or "fact-check" the user's premise. If the user says "records were burned," treat it as an absolute fact. 
          2. MAP THE SHADOW: Your task is to identify what evidence *should* exist if the user's premise is true. Focus on administrative footprints, secondary ledgers, and institutional crossovers.
          3. EXHAUSTIVE SOURCING (MANDATORY): Never summarize away sources. If multiple documents or links support a claim, list ALL of them in the 'citations' array and generate 'add_evidence' actions for EACH one. If you find 10 relevant links, provide 10 citations.
          4. DEEP REASONING (CRITICAL): In your 'reasoning' field, provide a detailed "Chain of Evidence". Explain the "Why" and "How" of every connection. Detail the structural logic: "We are looking at Agency X because Person Y (who we found in the board of Company Z) was the director there in 1954."
          5. DOMAIN-AGNOSTIC RESEARCH: Treat ALL domains (Historical, Corporate, Legal, Financial, Scientific, Political) as systems of records to be mapped. Follow the administrative footprint wherever it leads.
          6. DEEP SYNTHESIS: Incorporate real-time monitoring, personnel backgrounding, financial mapping, and geospatial context found in the search findings.
          7. CROSSOVER ANALYSIS (CRITICAL): Explicitly identify personnel crossovers (dual roles, board memberships) and financial crossovers (inter-agency fund flows, corporate-government contracts). Look for "Bridges" (the same person or entity appearing in two different, seemingly independent domains).
          6. STRATEGIC COLLABORATION: Act as a research assistant. Discuss theories, suggest research paths, and provide context beyond just record fetching. If the user is brainstorming, engage in the discussion without always needing to trigger a new record or action.
          7. ACKNOWLEDGE HISTORY: Look at the CONVERSATION HISTORY. Do not repeat yourself. If the user repeats a point, they are asking for MORE DEPTH or a NEW ANGLE. Acknowledge what was already discussed.
          8. INVESTIGATIVE NARRATIVE: Open with a narrative assessment of the findings. Synthesize information into thematic sections (e.g., "The Scale," "The Institutional Response," "What Actually Survives").
          9. INVESTIGATIVE OUTLOOK (MANDATORY): Conclude your 'response' with a section titled "INVESTIGATIVE OUTLOOK." This section MUST focus on the implications of the findings—what they *could* imply about structural links, gaps, or hidden patterns. Use speculative but grounded language (e.g., "This could imply a structural link to...", "The absence of X suggests a potential gap in...").
          10. BRAINSTORMING ACTIONS: Use the 'actions' array to suggest strategic pivots or brainstorming paths (e.g., "Pivot to Financial Trail", "Test Crossover Theory").
          11. AUTOMATIC POPULATION (CRITICAL): For EVERY new record, finding, or institutional detail you discover in the search results, you MUST generate a corresponding 'add_evidence' or 'add_request' action. Do not just describe them in the response; populate the system with them.
          
          FACTUAL RIGOR & CATEGORIZATION (MANDATORY):
          - SELF-CHECK BEFORE OUTPUT (REQUIRED): Before finalizing any output, perform this internal check on every named individual, date, institution, historical claim, and archival citation:
            1. Does this claim appear in the user-provided data or a source retrieved via Google Search in this session?
               - If yes: mark it [DOCUMENTED] and cite the source.
            2. Is it a logical inference from documented data?
               - If yes: mark it [INFERRED] and explicitly explain the "Structural Logic" or "Nexus" (e.g., "We connect A to B because they share the same business manager in 1905").
            3. Is it structurally plausible but unverified?
               - If yes: mark it [CANDIDATE] and flag it requires finding aid or primary source confirmation before use.
            4. Does it contradict expected institutional logic or contain an unexplained absence?
               - If yes: mark it [ANOMALY] and preserve it with the flag. Do not suppress anomalies.
          - URL INTEGRITY & SOURCE LOCK (CRITICAL): 
            1. NO HALLUCINATIONS: NEVER guess, construct, or "helpfully" provide a URL.
            2. SOURCE LOCK: ONLY use exact URLs found in the raw Google Search tool output.
            3. GLOBAL APPLICATION: This applies to ALL links—archival targets, historical sites, digitized assets, news articles, and context sources.
            4. MANDATORY WEB LINKS: If you find information on a website, news outlet, or public database, you MUST provide the direct URL in the 'citation_url' or 'url' fields. Do not just provide archival metadata if a web source is available.
            5. MISSING LINKS: If a search result provides information but no URL, or if you are citing a known institution without a direct link to the record, you MUST state: '[URL NOT FOUND IN SEARCH]'.
            6. ASSET FOCUS: Prioritize linking to specific digitized assets or finding aid landing pages rather than institutional homepages.
          - UNIVERSAL CITATIONS: Every historical claim, entity, or institutional detail surfaced MUST be backed by an entry in the 'citations' array.
          - NO CONFLATION: Be extremely precise with entities. Do NOT conflate related but distinct individuals or organizations (e.g., do not conflate Phoebe Hearst with William Randolph Hearst; they represent different institutional agencies).
          - PRECISION: Be exact with dates, figures, and acreage. If a figure is uncertain, state the range or label it as [INFERRED].
          
          CRITICAL: Use the SEARCH FINDINGS provided to populate your actions. NEVER use placeholder text like "Unnamed", "Unknown", or "Untitled".
          
          INSTITUTIONAL ROUTING & DRAFTING PROTOCOL (STRICT):
          1. IDENTIFY THE STATE: Determine if the record is an active agency record (FOIA), a declassification target (MDR), or an archival record (Archival Pull/Accession Inquiry).
          2. TARGET THE DESK: Use specific contact emails for the relevant desk (e.g., "NARA Textual Reference", "Special Access & FOIA Staff", "Museum Registrar", "Departmental Archivist").
          3. DRAFT THE BODY: Provide a 3-5 paragraph formal request tailored to the specific type following this EXACT format:
             1. Addressee: [Agency FOIA Officer, specific office if known]
             2. Statutory basis: 5 U.S.C. § 552 (federal) or relevant state equivalent. Cite the specific subsection of FOIA that applies to the record type being requested.
             3. Description of records sought: specific, bounded, not overly broad. Include specific accession numbers, box numbers, or folder titles found during search.
             4. Preferred format: electronic if available.
             5. Fee waiver justification: educational/research purpose under 5 U.S.C. § 552(a)(4)(A)(ii).
             6. Response deadline acknowledgment: 20 business days per statute.
             7. Contact information placeholder: [Your Contact Information].
             - Archival Inquiries should reference specific Box/Folder/Entry numbers and ask for pull instructions.
             - Museum Inquiries should reference specific artifacts or accession numbers.
          4. NO PLACEHOLDERS: Use the specific Record Group (RG), Accession Number, or Office from the search findings.
          
          EVIDENCE PROTOCOL (MANDATORY):
          - 'description' is the Contextual Analysis and MUST be a 2-3 sentence investigative summary.
          - 'citation_url' MUST be the direct link to the record or finding.
          - URL INTEGRITY & SOURCE LOCK (CRITICAL): NEVER hallucinate or guess a URL. ONLY use exact URLs found in the raw Google Search tool output. If no URL is found, state: '[URL NOT FOUND IN SEARCH]'.
          - HIGH-DENSITY CONTEXT (MANDATORY): You MUST populate the following fields for every record:
            * 'observed_content': Specific details, names, dates, or figures seen in the finding.
            * 'why_it_matters': The contextual significance of this specific record.
            * 'connection_logic': The structural link to the claim or other entities.
            * 'significance': The impact on the overall pattern of evidence.
            * 'institution_normalized': The clear, standardized name of the holding institution.
            * 'entities': A list of actors or organizations mentioned in the record.
            * 'timeline_date': The specific date or year associated with the record (YYYY-MM-DD or YYYY).
          - 'connection_logic' and 'significance' are MANDATORY.
          
          OUTPUT FORMAT:
          You MUST return a valid JSON object. Do not include any text outside the JSON.
          
          JSON STRUCTURE EXAMPLE:
          {
            "response": "Your investigative analysis (narrative, engaging, and context-rich)...\n\n### INVESTIGATIVE OUTLOOK\nBased on these findings, this could imply...",
            "reasoning": "Observed: ... Connection: ... Significance: ... Gaps: ... Crossover Analysis: ...",
            "entities": ["Entity A", "Entity B"],
            "citations": [{"title": "Source", "url": "http://...", "institution": "NARA"}],
            "actions": [
              {
                "type": "add_log",
                "label": "Log Strategist Discovery",
                "data": {
                  "name": "Discovery Title",
                  "type": "Pattern | Institution | Person",
                  "priority": "High | Medium | Low",
                  "notes": "Detailed notes on the discovery...",
                  "isStrategistDiscovery": true,
                  "discoveryReason": "The structural logic behind why this was surfaced..."
                }
              },
              {
                "type": "add_log",
                "label": "Pivot to Financial Trail",
                "data": {
                  "name": "Financial Trail Analysis",
                  "type": "Financial",
                  "priority": "Medium",
                  "notes": "Exploring the funding crossovers identified in the recent search...",
                  "isStrategistDiscovery": true,
                  "discoveryReason": "To resolve the crossover identified between Entity X and Entity Y."
                }
              }
            ]
          }
          
          ACTIONS (MANDATORY - MUST use the 'data' object):
          - 'add_log': { name, notes, type, priority, explanation, connection_to_pattern, verification_needs, isStrategistDiscovery, discoveryReason }
          - 'analyze_log': { id }
          - 'add_evidence': { label, description, record_type, observed_content, why_it_matters, impact, strength, citation, citation_url, connection_logic, significance, timeline_date }
          - 'add_request': { title, recipient, institution_normalized, department, subject, body, type, destination_email, mailing_address, submission_portal, verification_status, verification_source, alternative_contacts }
          - 'add_source': { title, url, institution, type, notes }
          - 'update_request': { id, body, status }
          - 'update_evidence': { record_id, ...fields to update }
          - 'update_status': { id, status, type: 'log' | 'request' }
          
          CRITICAL: Every action MUST have a 'data' object containing the fields. Do not put data fields at the top level of the action object.
          Example: {"type": "add_request", "label": "Draft FOIA", "data": {"title": "...", "body": "..."}}`
        },
      });
      
      const rawText = response.text || "{}";
      // Robust JSON extraction: strip markdown and handle trailing junk
      let cleanJson = rawText.trim();
      if (cleanJson.includes('```')) {
        const match = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) cleanJson = match[1];
      }
      
      // If there's still junk after the final closing brace, strip it
      const lastBrace = cleanJson.lastIndexOf('}');
      if (lastBrace !== -1) {
        cleanJson = cleanJson.substring(0, lastBrace + 1);
      }

      const result = JSON.parse(cleanJson);
      const aiTimestamp = new Date().toISOString();
      
      // Accumulate updates to sync to Firestore in one go
      let updatedResearchPoints = [...researchPoints];
      let updatedData = data ? { ...data, results: [...data.results] } : null;
      let updatedRequests = [...requests];
      let updatedSources = [...sources];
      let updatedStrategistFeed = [...strategistFeed];

      // Handle actions
      let actionSummary = '';
      console.log("AI Actions received:", result.actions);
      if (result.actions && result.actions.length > 0) {
        const counts = { log: 0, evidence: 0, request: 0 };
        result.actions.forEach((action: any) => {
          if (!action) return;
          
          // Robust data extraction
          let actionData = action.data;
          if (!actionData) {
            const { type, label, ...rest } = action as any;
            if (Object.keys(rest).length > 0) actionData = rest;
            else return;
          }

          const type = action.type.toLowerCase().replace(/_/g, ' ');
          
          if (type === 'add log' || type === 'log') {
            counts.log++;
            const name = actionData.name && !String(actionData.name).toLowerCase().includes('unnamed') ? actionData.name : 'New Investigation Lead';
            const newPoint: InvestigationItem = {
              id: Math.random().toString(36).substr(2, 9).toUpperCase(),
              name,
              notes: actionData.notes || "",
              type: actionData.type || 'Other',
              priority: actionData.priority || 'Medium',
              status: 'Pending',
              explanation: actionData.explanation || "",
              connection_to_pattern: actionData.connection_to_pattern || "",
              verification_needs: actionData.verification_needs || "",
              createdAt: aiTimestamp,
              ...actionData
            };
            updatedResearchPoints = [newPoint, ...updatedResearchPoints];
            if (newPoint.isStrategistDiscovery) {
              updatedStrategistFeed = [{
                id: Math.random().toString(36).substr(2, 9),
                content: `Strategist Discovery: ${newPoint.name}. ${newPoint.discoveryReason}`,
                timestamp: aiTimestamp,
                type: 'discovery'
              }, ...updatedStrategistFeed];
            }
          } else if (type === 'analyze log') {
            const log = updatedResearchPoints.find(p => p.id === actionData.id);
            if (log) consultStrategistOnLog(log);
          } else if (type === 'add evidence' || type === 'evidence' || type === 'dossier') {
            counts.evidence++;
            const label = actionData.label && !String(actionData.label).toLowerCase().includes('unnamed') ? actionData.label : 'Evidence Record';
            const newEvidence: EvidenceRecord = {
              record_id: Math.random().toString(36).substr(2, 9).toUpperCase(),
              label: label || actionData.description?.substring(0, 30) || 'Evidence Record',
              description: actionData.description || actionData.why_it_matters || actionData.observed_content || 'No contextual analysis provided.',
              record_type: actionData.record_type || 'Other',
              status: actionData.status || 'unverified',
              citation_type: actionData.citation_type || 'none',
              weight: actionData.weight || 5,
              impact: actionData.impact || 'Leaves Open',
              strength: actionData.strength || 'Noise',
              connection_logic: actionData.connection_logic || "",
              significance: actionData.significance || "",
              citation: actionData.citation || 'Source Document',
              citation_url: actionData.citation_url || '',
              ...actionData
            };
            if (!updatedData) {
              updatedData = { 
                original_claim: claim || 'AI Suggested Research',
                sub_claims: [],
                results: [newEvidence], 
                bridges: []
              };
            } else {
              updatedData = { ...updatedData, results: [...updatedData.results, newEvidence] };
            }
          } else if (type === 'add request' || type === 'request' || type === 'foia' || type === 'archival') {
            counts.request++;
            const subject = actionData.subject || '';
            const newRequest: Request = {
              ...actionData,
              title: actionData.title || subject || 'New Archive Request',
              recipient: actionData.recipient || '',
              subject: subject || 'Archive Request',
              body: actionData.body || "",
              type: actionData.type || (type === 'foia' ? 'FOIA' : 'Archival'),
              institution_normalized: actionData.institution_normalized || '',
              destination_email: actionData.destination_email || '',
              mailing_address: actionData.mailing_address || '',
              submission_portal: actionData.submission_portal || actionData.portal_url || '',
              id: Math.random().toString(36).substr(2, 9),
              status: 'Draft',
              createdAt: aiTimestamp,
              fingerprint: generateFingerprint(actionData.institution_normalized || '', actionData.department || '', subject || 'Archive Request')
            };
            updatedRequests = applyRequestUpdate(updatedRequests, newRequest);
          } else if (type === 'add source' || type === 'source') {
            const newSource: Source = {
              id: Math.random().toString(36).substr(2, 9),
              title: actionData.title || 'New Source',
              url: actionData.url || '',
              institution: actionData.institution || 'Unknown',
              type: actionData.type || 'Archive',
              notes: actionData.notes || '',
              addedAt: aiTimestamp
            };
            updatedSources = applySourceUpdate(updatedSources, newSource);
          } else if (type === 'update request') {
            const { id, body, status } = actionData;
            updatedRequests = updatedRequests.map(r => r.id === id ? { 
              ...r, 
              body: r.body.includes(body) ? r.body : `${r.body}\n\n--- AI MERGED UPDATE ---\n${body}`,
              status: status || r.status 
            } : r);
          } else if (type === 'update evidence') {
            const updatedRecord = actionData;
            if (updatedData) {
              updatedData = {
                ...updatedData,
                results: updatedData.results.map(n => n.record_id === updatedRecord.record_id ? { ...n, ...updatedRecord } : n)
              };
            }
          } else if (type === 'update status') {
            const { id, status, type: statusType } = actionData;
            if (statusType === 'log') {
              updatedResearchPoints = updatedResearchPoints.map(p => p.id === id ? { ...p, status } : p);
            } else if (statusType === 'request') {
              updatedRequests = updatedRequests.map(r => r.id === id ? { ...r, status } : r);
            }
          }
        });

        const summaryParts = [];
        if (counts.request > 0) summaryParts.push(`${counts.request} Archival request${counts.request > 1 ? 's' : ''}`);
        if (counts.log > 0) summaryParts.push(`${counts.log} research point${counts.log > 1 ? 's' : ''}`);
        if (counts.evidence > 0) summaryParts.push(`${counts.evidence} evidence record${counts.evidence > 1 ? 's' : ''}`);
        
        if (summaryParts.length > 0) {
          actionSummary = `\n\n[SYSTEM: ${summaryParts.join(' and ')} ${counts.request + counts.log + counts.evidence > 1 ? 'have' : 'has'} been generated.]`;
        }
      }

      // Handle citations (Sync to Sources tab)
      if (result.citations && result.citations.length > 0) {
        result.citations.forEach((cit: any) => {
          // Avoid duplicates
          const exists = updatedSources.some(s => s.url === cit.url);
          if (!exists) {
            const newSource: Source = {
              id: Math.random().toString(36).substr(2, 9),
              title: cit.title,
              url: cit.url,
              institution: cit.institution || 'Unknown',
              type: 'Archive',
              notes: `Generated during research on: ${claim || 'General Inquiry'}`,
              addedAt: aiTimestamp
            };
            updatedSources = applySourceUpdate(updatedSources, newSource);
          }
        });
      }

      // Apply all accumulated updates to state
      setResearchPoints(updatedResearchPoints);
      setData(updatedData);
      setRequests(updatedRequests);
      setSources(updatedSources);
      setStrategistFeed(updatedStrategistFeed);

      const aiMsg: ChatMessage = { 
        role: 'assistant', 
        content: result.response + actionSummary, 
        reasoning: result.reasoning,
        entities: result.entities,
        timestamp: aiTimestamp,
        citations: result.citations,
        actions: result.actions ? result.actions.filter(Boolean) : []
      };

      setChatMessages(prev => [...prev, aiMsg]);

      // Sync EVERYTHING to Firestore in one go to avoid race conditions with onSnapshot
      if (user && currentInvestigationId && !currentInvestigationId.startsWith('local-') && !quotaExceeded) {
        try {
          await updateDoc(doc(db, 'investigations', currentInvestigationId), {
            chatMessages: arrayUnion(aiMsg),
            researchPoints: updatedResearchPoints,
            data: updatedData,
            requests: updatedRequests,
            sources: updatedSources,
            strategistFeed: updatedStrategistFeed,
            updatedAt: serverTimestamp()
          });
        } catch (e) {
          console.error("Failed to sync AI response to Firestore", e);
        }
      }
    } catch (err: any) {
      console.error("Chat Error:", err);
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, timestamp: new Date().toISOString() }]);
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
    const normalizedInst = normalizeInstitution(newRequest.institution_normalized || '');
    const fingerprint = generateFingerprint(normalizedInst, newRequest.department, newRequest.subject);
    
    setRequests(prev => {
      const existingIndex = prev.findIndex(r => r.fingerprint === fingerprint);
      if (existingIndex !== -1) {
        const updated = [...prev];
        const existing = updated[existingIndex];
        // Merge bodies if different
        const newBody = newRequest.body || '';
        if (existing.body && !existing.body.includes(newBody)) {
          updated[existingIndex] = {
            ...existing,
            body: `${existing.body}\n\n--- AI MERGED UPDATE ---\n${newBody}`,
            status: 'Draft' // Reset to draft if updated
          };
        }
        return updated;
      }
      return [{ ...newRequest, institution_normalized: normalizedInst, fingerprint }, ...prev];
    });
    setEditingRequest(null);
  };

  const deleteRequest = (id: string) => {
    setRequests(prev => (prev || []).filter(r => r.id !== id));
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
    setSources(prev => (prev || []).filter(s => s.id !== id));
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
    setResearchPoints(prev => (prev || []).filter(p => p.id !== id));
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
    setShowClearConfirm(true);
  };

  const handleClearSession = async () => {
    if (!currentInvestigationId || !user) {
      // Local only clear
      setData(null);
      setChatMessages([]);
      setSuggestionChatMessages([]);
      setRequests([]);
      setSources([]);
      setResearchPoints([]);
      setClaim('');
      setResearchStep(0);
      setSuggestions({ 
        bridges: [], gaps: [], researchAreas: [], crossovers: [], 
        personnelCrossovers: [], financialCrossovers: [], investigativeOutlook: '',
        entities: [], 
        anomalies: [], conflicts: [], keyActors: [], methodologicalAdvice: [],
        institutionalGaps: [], structuralAnomalies: [], patternRecognition: [], riskAssessment: [] 
      });
      safeStorage.removeItem('oden_session');
      setActiveTab('guide');
      setShowClearConfirm(false);
      return;
    }

    try {
      // Delete the current investigation if user is owner
      const inv = investigations.find(i => i.id === currentInvestigationId);
      if (inv && inv.ownerId === user.uid && !quotaExceeded) {
        // In a real app we'd delete the doc, but for safety let's just clear it
        await updateDoc(doc(db, 'investigations', currentInvestigationId), {
          data: null,
          chatMessages: [],
          requests: [],
          sources: [],
          researchPoints: [],
          claim: '',
          suggestions: { 
            bridges: [], gaps: [], researchAreas: [], crossovers: [], 
            personnelCrossovers: [], financialCrossovers: [], investigativeOutlook: '',
            entities: [], 
            anomalies: [], conflicts: [], keyActors: [], methodologicalAdvice: [],
            institutionalGaps: [], structuralAnomalies: [], patternRecognition: [], riskAssessment: []
          },
          updatedAt: serverTimestamp()
        });
      } else if (!quotaExceeded) {
        // Just remove self from collaborators
        await updateDoc(doc(db, 'investigations', currentInvestigationId), {
          collaboratorEmails: arrayRemove(user.email)
        });
        setCurrentInvestigationId(null);
      }
    } catch (e) {
      console.error("Failed to clear investigation", e);
    }
    
    setActiveTab('guide');
    setShowClearConfirm(false);
  };

  const currentInvestigation = investigations.find(i => i.id === currentInvestigationId);
  const collaboratorEmails = currentInvestigation?.collaboratorEmails || [];

  return (
    <div className="min-h-screen flex flex-col bg-[#fcfcfc] text-black">
      {/* Quota Warning Banner */}
      <AnimatePresence>
        {quotaExceeded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-red-600 text-white p-3 text-center z-[100] sticky top-0 border-b border-black flex items-center justify-center gap-4"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-[10px] font-mono uppercase font-bold tracking-widest">
                Firestore Quota Exceeded // Local Mode Active
              </span>
            </div>
            <p className="text-[10px] font-mono opacity-80 max-w-2xl hidden md:block">
              Your daily write limit has been reached. Changes will be saved locally. 
              <button onClick={() => setActiveTab('settings')} className="underline ml-2 font-bold hover:text-white/100 transition-all">
                Connect your own Firebase project in Settings to bypass this.
              </button>
            </p>
            <button 
              onClick={() => setQuotaExceeded(false)}
              className="p-1 hover:bg-white/10 rounded transition-colors flex items-center gap-1 text-[8px] font-mono uppercase"
            >
              <X className="w-3 h-3" />
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-black p-2 md:p-6 flex justify-between items-center bg-white sticky top-0 z-[60]">
        <div className="flex items-center gap-1 md:gap-4">
          {/* Project Selector */}
          {(user || isGuest) && (
            <div className="relative group">
              <button 
                onClick={() => setShowProjectSelector(!showProjectSelector)}
                className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 md:py-2 border border-black text-[9px] md:text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black hover:text-white transition-all"
              >
                <FolderOpen className="w-3 h-3 md:w-3.5 md:h-3.5" />
                <span className="max-w-[40px] sm:max-w-[100px] truncate">
                  {investigations.find(i => i.id === currentInvestigationId)?.title || "Select Project"}
                </span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {/* Local Mode Badge */}
              {quotaExceeded && (
                <div className="flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-[8px] font-mono uppercase font-bold">
                  <ShieldAlert className="w-2 h-2" />
                  Local Mode
                </div>
              )}
              
              <AnimatePresence>
                {showProjectSelector && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute left-0 top-full mt-2 w-64 bg-white border border-black shadow-2xl z-[100] p-4"
                  >
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-[10px] font-mono uppercase font-bold opacity-40">My Investigations</h3>
                      <button 
                        onClick={() => {
                          setNewInvestigationTitle("");
                          setShowNewInvestigationModal(true);
                          setShowProjectSelector(false);
                        }}
                        className="p-1 hover:bg-black hover:text-white transition-all"
                        title="New Investigation"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {investigations.length === 0 ? (
                        <p className="text-[10px] font-mono opacity-40 py-4 text-center italic">No investigations found.</p>
                      ) : (
                        investigations.map(inv => (
                          <div key={inv.id} className="flex items-center group/item">
                            <button
                              onClick={() => {
                                setCurrentInvestigationId(inv.id);
                                setShowProjectSelector(false);
                              }}
                              className={cn(
                                "flex-1 text-left px-3 py-2 text-[10px] font-mono uppercase transition-all flex items-center justify-between",
                                currentInvestigationId === inv.id ? "bg-black text-white" : "hover:bg-stone-100"
                              )}
                            >
                              <span className="truncate pr-2">{inv.title}</span>
                              {user && inv.ownerId !== user.uid && (
                                <Users className="w-3 h-3 opacity-40" />
                              )}
                            </button>
                            {(user && inv.ownerId === user.uid || inv.id.startsWith('local-')) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenameTitle(inv.title);
                                  setShowRenameModal({ id: inv.id, title: inv.title });
                                  setShowProjectSelector(false);
                                }}
                                className={cn(
                                  "p-2 transition-all",
                                  currentInvestigationId === inv.id 
                                    ? "bg-black text-white hover:bg-stone-900" 
                                    : "hover:bg-stone-200"
                                )}
                                title="Rename"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Mobile Navigation Dropdown */}
          <div className="md:hidden relative">
            <button 
              onClick={() => setShowMobileNav(!showMobileNav)}
              className="flex items-center gap-1 px-2 py-1.5 border border-black text-[9px] font-mono uppercase font-bold tracking-widest hover:bg-black hover:text-white transition-all"
            >
              <List className="w-3 h-3" />
              <span className="max-w-[40px] sm:max-w-[80px] truncate">{activeTab}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            
            <AnimatePresence>
              {showMobileNav && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute left-0 top-full mt-2 w-64 bg-white border border-black shadow-2xl z-[100] p-4"
                >
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-[10px] font-mono uppercase font-bold opacity-40">Navigation</h3>
                    <button onClick={() => setShowMobileNav(false)} className="p-1 hover:bg-stone-100">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  
                  <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                    {[
                      { id: 'guide', label: '00 Guide', icon: Compass },
                      { id: 'pipeline', label: '01 Pipeline', icon: Network },
                      { id: 'dossier', label: '02 Dossier', icon: FileText },
                      { id: 'list', label: '03 Records', icon: List },
                      { id: 'investigation', label: '04 Investigation Log', icon: History },
                      { id: 'sources', label: '05 Sources', icon: BookOpen },
                      { id: 'timeline', label: '06 Timeline', icon: Calendar },
                      { id: 'chat', label: '07 Chat', icon: Send },
                      { id: 'requests', label: '08 FOIA/Archival Requests', icon: Mail },
                      { id: 'suggestions', label: '09 AI Suggestions', icon: Sparkles },
                      { id: 'data-management', label: '10 Data Management', icon: Save },
                      { id: 'settings', label: '11 Settings', icon: Settings },
                    ].map(item => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveTab(item.id as any);
                          setShowMobileNav(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-[10px] font-mono uppercase transition-all flex items-center gap-3",
                          activeTab === item.id ? "bg-black text-white" : "hover:bg-stone-100"
                        )}
                      >
                        <item.icon className="w-3.5 h-3.5" />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {user && currentInvestigationId && (
            <button 
              onClick={() => setShowShareModal(true)}
              className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 md:py-2 border border-black text-[9px] md:text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black hover:text-white transition-all"
            >
              <Share2 className="w-3 h-3 md:w-3.5 md:h-3.5" />
              <span className="hidden sm:inline">Share</span>
            </button>
          )}

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
              04 Investigation Log
            </button>
            <button 
              onClick={() => setActiveTab('sources')}
              className={cn("pb-1 border-b-2 transition-all", activeTab === 'sources' ? "border-black opacity-100" : "border-transparent opacity-30 hover:opacity-100")}
            >
              05 Sources
            </button>
            <button 
              onClick={() => setActiveTab('timeline')}
              className={cn("pb-1 border-b-2 transition-all", activeTab === 'timeline' ? "border-black opacity-100" : "border-transparent opacity-30 hover:opacity-100")}
            >
              06 Timeline
            </button>
            <button 
              onClick={() => setActiveTab('suggestions')}
              className={cn("pb-1 border-b-2 transition-all", activeTab === 'suggestions' ? "border-black opacity-100" : "border-transparent opacity-30 hover:opacity-100")}
            >
              09 AI Suggestions
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={cn("pb-1 border-b-2 transition-all", activeTab === 'settings' ? "border-black opacity-100" : "border-transparent opacity-30 hover:opacity-100")}
            >
              11 Settings
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
                  { id: 'chat', label: '07 Chat', icon: Send },
                  { id: 'requests', label: '08 FOIA/Archival Requests', icon: Mail },
                  { id: 'data-management', label: '10 Data Management', icon: Save },
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

        <div className="flex items-center gap-1 md:gap-4">
          {user ? (
            <div className="flex items-center gap-2 md:gap-3 pr-2 md:pr-4 border-r border-black/10">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-[9px] font-mono uppercase font-bold">{user.displayName || 'Investigator'}</span>
                <span className="text-[8px] font-mono uppercase opacity-40">{user.email}</span>
              </div>
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-6 h-6 md:w-8 md:h-8 rounded-full border border-black/10" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-stone-100 flex items-center justify-center border border-black/10">
                  <Users className="w-3 h-3 md:w-4 md:h-4 opacity-40" />
                </div>
              )}
              <button 
                onClick={signOut}
                className="p-1.5 md:p-2 hover:bg-red-50 hover:text-red-600 transition-all rounded-full group"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5 md:w-4 md:h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 md:gap-3 pr-2 md:pr-4 border-r border-black/10">
              <button 
                onClick={signIn}
                className="flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1.5 md:py-2 bg-black text-white text-[9px] md:text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all"
              >
                <LogIn className="w-3 h-3 md:w-3.5 md:h-3.5" />
                <span className="hidden sm:inline">Sign In</span>
              </button>
            </div>
          )}

          <div className="hidden sm:flex items-center gap-2">
            <div className={cn("w-1.5 h-1.5 rounded-full", error ? "bg-red-500 animate-pulse" : (user ? "bg-emerald-500" : "bg-amber-500"))} />
            <span className="text-[8px] font-mono uppercase opacity-40">
              {error ? "Error" : (user ? "Sync Active" : "Local Only")}
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

      <main className="flex-1 flex flex-col overflow-hidden relative">
        {error && (
          <div className="absolute top-0 left-0 right-0 z-[100] bg-red-600 text-white p-4 shadow-2xl animate-in slide-in-from-top duration-300">
            <div className="max-w-4xl mx-auto flex items-start gap-4">
              <AlertTriangle className="w-6 h-6 shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-bold text-sm uppercase tracking-widest mb-1">System Error Detected</h3>
                <p className="text-xs opacity-90 mb-3">
                  {parseFirestoreError(error) 
                    ? `A database error occurred during a ${parseFirestoreError(error)?.operationType} operation.`
                    : error}
                </p>
                
                {parseFirestoreError(error) && (
                  <div className="mb-3">
                    <button 
                      onClick={() => setShowErrorDetails(!showErrorDetails)}
                      className="text-[10px] uppercase font-mono border border-white/30 px-2 py-1 hover:bg-white/10 transition-all"
                    >
                      {showErrorDetails ? "Hide Technical Details" : "Show Technical Details"}
                    </button>
                    {showErrorDetails && (
                      <pre className="mt-2 p-3 bg-black/20 rounded text-[10px] font-mono overflow-x-auto max-h-40">
                        {JSON.stringify(parseFirestoreError(error), null, 2)}
                      </pre>
                    )}
                  </div>
                )}

                <div className="flex gap-3">
                  <button 
                    onClick={() => window.location.reload()}
                    className="bg-white text-red-600 px-4 py-2 text-[10px] font-mono uppercase font-bold hover:bg-stone-100 transition-all"
                  >
                    Reload Application
                  </button>
                  <button 
                    onClick={() => setError(null)}
                    className="border border-white/50 px-4 py-2 text-[10px] font-mono uppercase font-bold hover:bg-white/10 transition-all"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
                <div className="max-w-6xl mx-auto p-8 md:p-16">
                  <div className="border-b border-black pb-12 mb-24">
                    <h2 className="text-5xl md:text-7xl font-serif italic mb-6 tracking-tight">Welcome to ODEN.</h2>
                    <p className="text-lg md:text-xl font-serif italic opacity-60 max-w-2xl leading-relaxed">
                      ODEN is a research tool designed to help you investigate complex claims by stripping away narrative bias and focusing on structural evidence.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-20 gap-y-32 items-start">
                    {/* Left Column */}
                    <div className="space-y-32">
                      <section>
                        <h3 className="text-[10px] font-mono uppercase tracking-widest opacity-40 mb-10">The Methodology</h3>
                        <div className="space-y-12">
                          <div className="flex gap-6">
                            <div className="text-2xl font-serif italic opacity-20">01</div>
                            <div>
                              <h4 className="text-sm font-bold uppercase mb-2">Evidence First</h4>
                              <p className="text-xs opacity-60 leading-relaxed">
                                ODEN is built on the principle that <span className="font-bold underline italic">records</span> are the only reliable source of truth. Instead of chasing narratives, we map the institutional framework through which records are created, stored, and sometimes hidden.
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-6">
                            <div className="text-2xl font-serif italic opacity-20">02</div>
                            <div>
                              <h4 className="text-sm font-bold uppercase mb-2">Identify Structural Gaps</h4>
                              <p className="text-xs opacity-60 leading-relaxed">
                                The most important evidence is often what is <span className="italic underline">missing</span>. If a protocol requires a memo to be signed, but the memo is absent, that is a "Gap". ODEN helps you predict and log these gaps to generate targeted FOIA requests.
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-6">
                            <div className="text-2xl font-serif italic opacity-20">03</div>
                            <div>
                              <h4 className="text-sm font-bold uppercase mb-2">Bridge the Threads</h4>
                              <p className="text-xs opacity-60 leading-relaxed">
                                Use the AI Chat to find "Structural Bridges"—recurring actors, shared protocols, or timeline anomalies that connect seemingly independent threads of investigation.
                              </p>
                            </div>
                          </div>
                        </div>
                      </section>

                      <section className="space-y-10">
                        <h3 className="text-[10px] font-mono uppercase tracking-widest opacity-40">Operational Guide — Part I</h3>
                        <div className="space-y-10">
                          {[
                            { 
                              id: 'pipeline', 
                              label: '01 Pipeline', 
                              title: 'The Evidence Entry Point',
                              desc: 'Neutralize the narrative. Enter claims and watch ODEN break them down into researchable threads.',
                              how: 'Input any complex claim or narrative. ODEN’s AI analyzes the text to extract specific entities, dates, and institutional actions, categorizing them into structural threads (e.g., Financials, Personnel) for systematic investigation.'
                            },
                            { 
                              id: 'dossier', 
                              label: '02 Dossier', 
                              title: 'The Master Network',
                              desc: 'Your master repository. Organize records into a network to see how they connect.',
                              how: 'The Dossier is where your verified evidence lives. View records as a list or a network graph to visualize the structural blueprint of the system you are investigating. Every connection here represents a verified link.'
                            },
                            { 
                              id: 'list', 
                              label: '03 Records', 
                              title: 'The Evidence List',
                              desc: 'A flat, searchable list of every evidence point in your current investigation.',
                              how: 'Use the Records list for high-speed data entry and verification. Filter by status (Verified, Unverified, Gap) to prioritize your research tasks and ensure every claim is backed by a record.'
                            },
                            { 
                              id: 'investigation', 
                              label: '04 Investigation', 
                              title: 'The Investigation Log',
                              desc: 'Track your active research points, institutional targets, and search queries.',
                              how: 'The Research log is your tactical dashboard. Log specific Record Groups, agencies, and people you are investigating. Use the "Search" feature to initiate AI-powered discovery passes across NARA and the web.'
                            }
                          ].map(tab => (
                            <button 
                              key={tab.id}
                              onClick={() => setActiveTab(tab.id as any)}
                              className="w-full p-8 border border-black bg-white hover:bg-stone-100 transition-all text-left group shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] flex flex-col"
                            >
                              <div className="flex justify-between items-center mb-3">
                                <h4 className="text-[10px] font-mono uppercase font-bold tracking-widest">{tab.label} — {tab.title}</h4>
                                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all" />
                              </div>
                              <p className="text-sm font-serif italic mb-6">{tab.desc}</p>
                              <div className="pt-6 border-t border-black/10 mt-auto">
                                <p className="text-[10px] font-mono uppercase opacity-40 mb-2 tracking-tighter">How it works:</p>
                                <p className="text-[11px] leading-relaxed opacity-70">{tab.how}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    </div>

                    {/* Right Column */}
                    <div className="space-y-32 md:mt-64">
                      <div className="p-10 bg-black text-white border border-black shadow-[10px_10px_0px_0px_rgba(0,0,0,0.2)]">
                        <h3 className="text-[10px] font-mono uppercase tracking-widest opacity-50 mb-6">Pro Tip: The Power of Gaps</h3>
                        <p className="text-base font-serif italic leading-relaxed">
                          "In investigative research, what's not there is often as telling as what is. If you know a meeting happened but there are no minutes, that is an Archival Gap. Logging these gaps allows you to generate targeted FOIA or Archival Requests in the Requests tab."
                        </p>
                      </div>

                      <section className="space-y-10">
                        <h3 className="text-[10px] font-mono uppercase tracking-widest opacity-40">Operational Guide — Part II</h3>
                        <div className="space-y-10">
                          {[
                            { 
                              id: 'sources', 
                              label: '05 Sources', 
                              title: 'The Evidence Repository',
                              desc: 'Your library. Manage all uploaded documents, PDFs, and external links here.',
                              how: 'Upload primary documents or log external URLs. Every record in your Dossier should link back to a source here, ensuring a verifiable chain of evidence. Filter by "Primary" vs "Secondary" to maintain research integrity.'
                            },
                            { 
                              id: 'timeline', 
                              label: '06 Timeline', 
                              title: 'Chronological Blueprint',
                              desc: 'Visualize the temporal sequence of events and institutional actions.',
                              how: 'The Timeline allows you to see the investigation unfold over time. Identify temporal anomalies, gaps in record-keeping, or suspicious coincidences by mapping your evidence to a precise chronological scale.'
                            },
                            { 
                              id: 'chat', 
                              label: '07 Strategist', 
                              title: 'AI Research Partner',
                              desc: 'Talk to the AI about your research. Ask for summaries, source suggestions, or deep structural analysis.',
                              how: 'Use the chat to query your current workspace. The Strategist can help you identify institutional patterns, summarize long uploads, or suggest specific archives to search based on the records you’ve already logged.'
                            },
                            { 
                              id: 'requests', 
                              label: '08 Requests', 
                              title: 'Actionable FOIA/Archival',
                              desc: 'Draft and track FOIA or archival requests based on the gaps ODEN identifies.',
                              how: 'Turn "Archival Gaps" into action. Draft formal requests for missing documents directly from your research findings. Track the status of each request to ensure no lead goes cold.'
                            }
                          ].map(tab => (
                            <button 
                              key={tab.id}
                              onClick={() => setActiveTab(tab.id as any)}
                              className="w-full p-8 border border-black bg-white hover:bg-stone-100 transition-all text-left group shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] flex flex-col"
                            >
                              <div className="flex justify-between items-center mb-3">
                                <h4 className="text-[10px] font-mono uppercase font-bold tracking-widest">{tab.label} — {tab.title}</h4>
                                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all" />
                              </div>
                              <p className="text-sm font-serif italic mb-6">{tab.desc}</p>
                              <div className="pt-6 border-t border-black/10 mt-auto">
                                <p className="text-[10px] font-mono uppercase opacity-40 mb-2 tracking-tighter">How it works:</p>
                                <p className="text-[11px] leading-relaxed opacity-70">{tab.how}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>

                      <section className="space-y-10">
                        <h3 className="text-[10px] font-mono uppercase tracking-widest opacity-40">Operational Guide — Part III</h3>
                        <div className="space-y-10">
                          {[
                            { 
                              id: 'suggestions', 
                              label: '09 Suggestions', 
                              title: 'Pattern Recognition',
                              desc: 'Materialize records from AI-detected patterns, anomalies, and institutional gaps.',
                              how: 'ODEN scans your Dossier for structural anomalies—like missing oversight steps or conflicting roles. "Materialize" these suggestions to turn AI-detected "Gaps" into active investigation targets.'
                            },
                            { 
                              id: 'data-management', 
                              label: '10 Management', 
                              title: 'Session & Data Control',
                              desc: 'Sync documents, export your session, or clear local data.',
                              how: 'ODEN is a local-first tool. Use this tab to export your entire investigation as a JSON file for backup or sharing. You can also re-import previous sessions or clear your local cache to start fresh.'
                            },
                            { 
                              id: 'settings', 
                              label: '11 Settings', 
                              title: 'Archival Infrastructure',
                              desc: 'Configure your research fuel. Manage API keys and institutional connections.',
                              how: 'The Settings tab is your command center. Connect your own Gemini or NARA API keys to unlock higher research limits and direct archival discovery passes. Manage your research persona and system preferences here.'
                            }
                          ].map(tab => (
                            <button 
                              key={tab.id}
                              onClick={() => setActiveTab(tab.id as any)}
                              className="w-full p-8 border border-black bg-white hover:bg-stone-100 transition-all text-left group shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] flex flex-col"
                            >
                              <div className="flex justify-between items-center mb-3">
                                <h4 className="text-[10px] font-mono uppercase font-bold tracking-widest">{tab.label} — {tab.title}</h4>
                                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all" />
                              </div>
                              <p className="text-sm font-serif italic mb-6">{tab.desc}</p>
                              <div className="pt-6 border-t border-black/10 mt-auto">
                                <p className="text-[10px] font-mono uppercase opacity-40 mb-2 tracking-tighter">How it works:</p>
                                <p className="text-[11px] leading-relaxed opacity-70">{tab.how}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    </div>
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
                              <input type="file" accept=".docx,.xml,.ead,.txt,.md" className="hidden" multiple onChange={handleFileUpload} />
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
                          <PipelineStep label="07 Request Generation" status={researchStep === 7 ? 'loading' : researchStep > 7 ? 'complete' : 'pending'} />
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

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-16">
                      {[
                        { 
                          step: "01", 
                          title: "Neutralizer", 
                          desc: "Strips emotional framing and political bias from the input claim to reveal the underlying structural proposition.", 
                          context: "By removing rhetorical flourishes, we isolate the specific institutional actions that must have occurred for the claim to be true.",
                          icon: Shield,
                          span: "md:col-span-4"
                        },
                        { 
                          step: "02", 
                          title: "Blueprint", 
                          desc: "Deduces the institutional records that *must* exist if the claim is structurally valid.", 
                          context: "This phase maps out the 'paper trail'—financial records, communication logs, and archival entries—required for verification.",
                          icon: Network,
                          span: "md:col-span-4"
                        },
                        { 
                          step: "03", 
                          title: "Researcher", 
                          desc: "Scans primary archives, record groups, and digital repositories for the deduced evidence.", 
                          context: "The system targets specific record groups identified in the Blueprint phase, prioritizing primary sources over secondary accounts.",
                          icon: Search,
                          span: "md:col-span-4"
                        },
                        { 
                          step: "04", 
                          title: "Classifier", 
                          desc: "Applies the four-state evidence model: Verified, Gap, Contested, or Unverified.", 
                          context: "Each record is evaluated for authenticity and relevance, determining if it supports, contradicts, or represents a missing link.",
                          icon: FileText,
                          span: "md:col-span-6"
                        },
                        { 
                          step: "05", 
                          title: "Analyst", 
                          desc: "Detects patterns, crossovers, and non-obvious coincidences across the gathered evidence.", 
                          context: "This layer looks for recurring structural signatures and institutional anomalies that suggest deeper systemic patterns.",
                          icon: Zap,
                          span: "md:col-span-6"
                        },
                        { 
                          step: "06", 
                          title: "Bridge Detector", 
                          desc: "Identifies structural nexus points where disparate research threads intersect.", 
                          context: "Bridges represent critical connections between entities or events that were previously considered unrelated.",
                          icon: LinkIcon,
                          span: "md:col-span-6"
                        },
                        { 
                          step: "07", 
                          title: "Strategic Advisory", 
                          desc: "Generates actionable research paths and risk assessments based on the current dossier.", 
                          context: "The final stage provides a methodological roadmap for further investigation, highlighting critical gaps and potential conflicts.",
                          icon: Compass,
                          span: "md:col-span-6"
                        },
                      ].map((item) => (
                        <div key={item.step} className={cn("p-6 border border-black bg-white hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all group", item.span)}>
                          <div className="flex justify-between items-start mb-4">
                            <span className="text-[10px] font-mono opacity-30">{item.step}</span>
                            <item.icon className="w-4 h-4 opacity-40 group-hover:opacity-100 transition-all" />
                          </div>
                          <h4 className="font-serif italic text-xl mb-2">{item.title}</h4>
                          <p className="text-[10px] font-mono uppercase font-bold mb-2 tracking-tighter">{item.desc}</p>
                          <p className="text-[10px] opacity-60 leading-relaxed">{item.context}</p>
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
                            <div 
                              key={record.record_id || `record-${i}`} 
                              className="data-row p-4 grid grid-cols-[40px_1.5fr_1fr_1fr_100px] gap-4 items-center bg-white/30 hover:bg-black hover:text-white transition-all group cursor-pointer"
                              onClick={() => {
                                setSelectedRecord(record);
                                setIsSidebarOpen(true);
                              }}
                            >
                              <span className="text-[10px] font-mono opacity-30 group-hover:opacity-100">{(i + 1).toString().padStart(2, '0')}</span>
                              <div>
                                <p className="text-xs font-medium line-clamp-1">{record.label || record.description}</p>
                                <div className="flex gap-2 mt-1">
                                  <span className="text-[8px] font-mono opacity-50 uppercase group-hover:opacity-100">{record.record_type}</span>
                                  {record.timeline_date && <span className="text-[8px] font-mono opacity-50 uppercase group-hover:opacity-100">| {record.timeline_date}</span>}
                                </div>
                              </div>
                              <div className="hidden md:block">
                                <p className="text-[9px] font-mono uppercase opacity-50 group-hover:opacity-100">Institution</p>
                                <p className="text-[10px] truncate">{record.institution_normalized || 'N/A'}</p>
                              </div>
                              <div className="hidden lg:block">
                                <p className="text-[9px] font-mono uppercase opacity-50 group-hover:opacity-100">Source</p>
                                <p className="text-[10px] line-clamp-1 italic">{record.citation || 'Analyzing...'}</p>
                              </div>
                              <div className="flex justify-end">
                                <StatusBadge status={record.status} />
                              </div>
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
                        <div className="flex items-center gap-4">
                          <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">Methodological Compilation of Research Findings</p>
                          {collaboratorEmails && collaboratorEmails.length > 0 && (
                            <div className="flex items-center gap-1 border-l border-black/20 pl-4">
                              <Users className="w-3 h-3 opacity-40" />
                              <div className="flex -space-x-2">
                                {collaboratorEmails.map((email, i) => (
                                  <div key={i} className="w-5 h-5 rounded-full bg-stone-200 border border-black flex items-center justify-center text-[8px] font-mono uppercase" title={email}>
                                    {email.charAt(0)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
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
                        <span className="text-3xl font-serif italic">{data?.results?.filter(n => n.classification === 'verified' || n.status === 'verified').length || 0}</span>
                      </div>
                      <div className="p-4 border border-black bg-white flex flex-col justify-between h-24 border-l-4 border-l-red-600">
                        <span className="text-[9px] font-mono uppercase opacity-50">Archival Gaps</span>
                        <span className="text-3xl font-serif italic">{data?.results?.filter(n => n.classification === 'gap' || n.status === 'gap').length || 0}</span>
                      </div>
                      <div className="p-4 border border-black bg-white flex flex-col justify-between h-24 border-l-4 border-l-purple-600">
                        <span className="text-[9px] font-mono uppercase opacity-50">Contested</span>
                        <span className="text-3xl font-serif italic">{data?.results?.filter(n => n.classification === 'contested' || n.status === 'contested').length || 0}</span>
                      </div>
                      <div className="p-4 border border-black bg-white flex flex-col justify-between h-24 border-l-4 border-l-yellow-600">
                        <span className="text-[9px] font-mono uppercase opacity-50">Unverified</span>
                        <span className="text-3xl font-serif italic">{data?.results?.filter(n => n.status === 'unverified').length || 0}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 items-center justify-between border-t border-black pt-8">
                      <div className="flex gap-2">
                        {['all', 'verified', 'contested', 'gap'].map((f) => (
                          <button
                            key={f}
                            onClick={() => setDossierFilter(f as any)}
                            className={cn(
                              "px-3 py-1 text-[10px] font-mono uppercase border border-black transition-all",
                              dossierFilter === f ? "bg-black text-white" : "bg-white text-black hover:bg-black/5"
                            )}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-4 items-center">
                        <span className="text-[10px] font-mono uppercase opacity-50">Sort By:</span>
                        <select 
                          value={dossierSort}
                          onChange={(e) => setDossierSort(e.target.value as any)}
                          className="bg-transparent border-b border-black text-[10px] font-mono uppercase focus:outline-none"
                        >
                          <option value="default">Default</option>
                          <option value="strength">Signal Strength</option>
                          <option value="impact">Impact</option>
                          <option value="chrono">Chronological</option>
                          <option value="institutional">Institutional</option>
                          <option value="people">People / Actors</option>
                          <option value="financial">Money Trails / Financial</option>
                          <option value="verification">Verification Depth</option>
                        </select>
                      </div>
                    </div>

                    {/* Crossovers / Bridges Section */}
                    {data?.bridges && data.bridges.length > 0 && (
                      <section>
                        <h3 className="col-header mb-6">Structural Crossovers (Bridges)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          {data?.bridges?.map((bridge, bidx) => (
                            <div key={bridge.label || bidx} className="p-6 border border-black bg-stone-900 text-white space-y-4">
                              <div className="flex justify-between items-start">
                                <h4 className="font-serif italic text-xl">{bridge.label || 'Potential Nexus'}</h4>
                                <span className="text-[8px] font-mono bg-white text-black px-2 py-0.5 uppercase font-bold">Bridge</span>
                              </div>
                              <p className="text-[10px] font-mono opacity-60 leading-relaxed">
                                {bridge.reason}
                              </p>
                              <div className="flex flex-wrap gap-1 pt-2">
                                {bridge.records.map(id => {
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
                        {(data?.results || [])
                          .filter(r => dossierFilter === 'all' || r.status === dossierFilter)
                          .sort((a, b) => {
                            if (dossierSort === 'strength') {
                              const weights = { 'Strong': 3, 'Medium': 2, 'Weak': 1, 'Noise': 0 };
                              return (weights[b.strength || 'Noise'] || 0) - (weights[a.strength || 'Noise'] || 0);
                            }
                            if (dossierSort === 'impact') {
                              const weights = { 'Supports': 3, 'Complicates': 2, 'Leaves Open': 1, 'Weakens': 0 };
                              return (weights[b.impact || 'Leaves Open'] || 0) - (weights[a.impact || 'Leaves Open'] || 0);
                            }
                            if (dossierSort === 'chrono') {
                              const dateA = a.timeline_date ? new Date(a.timeline_date).getTime() : 0;
                              const dateB = b.timeline_date ? new Date(b.timeline_date).getTime() : 0;
                              return dateA - dateB;
                            }
                            if (dossierSort === 'institutional') {
                              return (a.institution_normalized || '').localeCompare(b.institution_normalized || '');
                            }
                            if (dossierSort === 'people') {
                              if (a.record_type === 'Person' && b.record_type !== 'Person') return -1;
                              if (a.record_type !== 'Person' && b.record_type === 'Person') return 1;
                              return (a.label || '').localeCompare(b.label || '');
                            }
                            if (dossierSort === 'financial') {
                              if (a.record_type === 'Financial' && b.record_type !== 'Financial') return -1;
                              if (a.record_type !== 'Financial' && b.record_type === 'Financial') return 1;
                              return (a.label || '').localeCompare(b.label || '');
                            }
                            if (dossierSort === 'verification') {
                              const weights = { 'primary': 3, 'secondary': 2, 'none': 1 };
                              return (weights[b.citation_type || 'none'] || 0) - (weights[a.citation_type || 'none'] || 0);
                            }
                            return 0;
                          })
                          .map((record) => (
                          <motion.div 
                            key={record.record_id}
                            layoutId={record.record_id}
                            onClick={() => {
                              setSelectedRecord(record);
                              setIsSidebarOpen(true);
                            }}
                            className={cn(
                              "group p-6 border border-black bg-white hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all cursor-pointer flex flex-col justify-between min-h-[320px]",
                              record.status === 'gap' && "border-red-600 border-2 bg-red-50/30"
                            )}
                          >
                            <div className="space-y-4">
                              <div className="flex justify-between items-start">
                                <StatusBadge status={record.status} />
                                <div className="flex flex-col items-end gap-1">
                                  <span className="text-[9px] font-mono uppercase opacity-40">{record.record_type}</span>
                                  {record.classification && (
                                    <span className={cn(
                                      "text-[7px] font-mono px-1 uppercase border",
                                      record.classification === 'verified' ? "border-green-600 text-green-600" :
                                      record.classification === 'contested' ? "border-red-600 text-red-600" :
                                      "border-stone-400 text-stone-400"
                                    )}>{record.classification}</span>
                                  )}
                                </div>
                              </div>
                              <h4 className="font-serif italic text-2xl leading-tight group-hover:underline">{record.label}</h4>
                              
                              {record.status === 'gap' ? (
                                <div className="space-y-2">
                                  <p className="text-[10px] font-mono uppercase text-red-600 font-bold">Archival Gap Detected</p>
                                  <p className="text-xs opacity-80 font-serif italic leading-relaxed">
                                    <span className="font-bold">Why expected:</span> {record.gap_reasoning?.why_should_exist}
                                  </p>
                                  <p className="text-xs opacity-80 font-serif italic leading-relaxed">
                                    <span className="font-bold">Likely Location:</span> {record.gap_reasoning?.where_specifically}
                                  </p>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {record.institution_normalized && (
                                    <div className="flex items-center gap-2">
                                      <div className="w-1 h-1 bg-black rounded-full" />
                                      <span className="text-[9px] font-mono uppercase tracking-tighter">{record.institution_normalized}</span>
                                    </div>
                                  )}
                                  <div className="space-y-1">
                                    <span className="text-[8px] font-mono uppercase opacity-40">Observed Content:</span>
                                    <p className="text-xs opacity-60 line-clamp-2 font-serif italic leading-relaxed">
                                      {record.observed_content || record.description}
                                    </p>
                                  </div>
                                  {(record.significance || record.why_it_matters) && (
                                    <div className="space-y-1">
                                      <span className="text-[8px] font-mono uppercase opacity-40">Significance:</span>
                                      <p className="text-xs opacity-80 line-clamp-2 font-serif italic leading-relaxed">
                                        {record.significance || record.why_it_matters}
                                      </p>
                                    </div>
                                  )}
                                  {record.entities && record.entities.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-1">
                                      {record.entities.slice(0, 3).map((ent, idx) => (
                                        <span key={idx} className="text-[7px] font-mono bg-stone-100 px-1 py-0.5 border border-black/5 uppercase">
                                          {ent}
                                        </span>
                                      ))}
                                      {record.entities.length > 3 && <span className="text-[7px] font-mono opacity-40">+{record.entities.length - 3} more</span>}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="flex flex-wrap gap-2 items-center">
                                {record.impact && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[8px] font-mono uppercase opacity-40">Impact:</span>
                                    <span className={cn(
                                      "text-[8px] font-mono px-1 uppercase border",
                                      record.impact === 'Supports' ? "border-green-600 text-green-600" :
                                      record.impact === 'Weakens' ? "border-red-600 text-red-600" :
                                      "border-stone-400 text-stone-400"
                                    )}>{record.impact}</span>
                                  </div>
                                )}
                                {record.strength && (
                                  <span className={cn(
                                    "text-[8px] font-mono px-1 uppercase border",
                                    record.strength === 'Strong' ? "border-black bg-black text-white" :
                                    record.strength === 'Weak' ? "border-black/20 text-black/40" :
                                    "border-dashed border-black/10 text-black/20"
                                  )}>{record.strength} Signal</span>
                                )}
                              </div>
                            </div>
                            
                            <div className="pt-6 border-t border-black/5 flex justify-between items-center">
                              <span className="text-[9px] font-mono uppercase opacity-40">ID: {record.record_id?.slice(0, 8) || 'Unknown'}</span>
                              <div className="flex gap-2">
                                {record.status === 'gap' && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setChatInput(`Perform a deep dive on this gap: ${record.label || 'Evidence Record'}. Focus on ${record.gap_reasoning?.why_should_exist || 'its deductive basis'}.`);
                                      setActiveTab('chat');
                                    }}
                                    className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white text-[8px] font-mono uppercase font-bold hover:bg-red-700 transition-all"
                                  >
                                    <Zap className="w-3 h-3" />
                                    Deep Dive
                                  </button>
                                )}
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

                            {selectedRecord.observed_content && (
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Observed Content</h5>
                                <p className="text-xs leading-relaxed bg-stone-50 p-3 border-l-2 border-black">{selectedRecord.observed_content}</p>
                              </section>
                            )}

                            {selectedRecord.connection_logic && (
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Connection Logic</h5>
                                <p className="text-xs leading-relaxed italic opacity-70">{selectedRecord.connection_logic}</p>
                              </section>
                            )}

                            {selectedRecord.significance && (
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Significance</h5>
                                <p className="text-xs leading-relaxed font-bold">{selectedRecord.significance}</p>
                              </section>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Classification</h5>
                                <span className="text-[10px] font-mono uppercase px-2 py-1 border border-black">{selectedRecord.classification || 'Unclassified'}</span>
                              </section>
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Date / Timeline</h5>
                                <span className="text-[10px] font-mono uppercase px-2 py-1 border border-black">{selectedRecord.timeline_date || 'N/A'}</span>
                              </section>
                            </div>

                            {selectedRecord.entities && selectedRecord.entities.length > 0 && (
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Associated Actors/Entities</h5>
                                <div className="flex flex-wrap gap-2">
                                  {selectedRecord.entities.map((ent, idx) => (
                                    <span key={idx} className="text-[9px] font-mono bg-black text-white px-2 py-1 uppercase">
                                      {ent}
                                    </span>
                                  ))}
                                </div>
                              </section>
                            )}

                            <section>
                              <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Institutional Context</h5>
                              <div className="p-3 border border-black/5 bg-stone-50">
                                <p className="text-[10px] font-mono uppercase opacity-50 mb-1">Normalized Institution</p>
                                <p className="text-xs font-bold">{selectedRecord.institution_normalized || 'Not Specified'}</p>
                              </div>
                            </section>

                            {selectedRecord.suggestions && (
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Follow-up Suggestions</h5>
                                <p className="text-xs leading-relaxed opacity-70">{selectedRecord.suggestions}</p>
                              </section>
                            )}

                            {selectedRecord.missing_verification && (
                              <section className="p-4 border border-red-200 bg-red-50">
                                <h5 className="text-[9px] font-mono uppercase text-red-800 mb-2 tracking-widest">Missing Verification</h5>
                                <p className="text-xs leading-relaxed text-red-900">{selectedRecord.missing_verification}</p>
                              </section>
                            )}

                            {selectedRecord.citation_url && (
                              <section>
                                <h5 className="text-[9px] font-mono uppercase opacity-30 mb-2 tracking-widest">Source Document</h5>
                                {!selectedRecord.citation_url.includes('[URL NOT FOUND') ? (
                                  <a 
                                    href={selectedRecord.citation_url} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="flex items-center justify-between p-4 border border-black/10 bg-stone-50 hover:bg-black hover:text-white transition-all group"
                                  >
                                    <span className="text-xs font-bold truncate pr-4">{selectedRecord.citation || 'View Primary Record'}</span>
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                  </a>
                                ) : (
                                  <div className="p-4 border border-black/10 bg-stone-50 flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold opacity-50">{selectedRecord.citation || 'Source Not Found'}</span>
                                      <span className="text-[8px] font-mono uppercase bg-stone-200 px-1">No Direct Link</span>
                                    </div>
                                    <button 
                                      onClick={() => setChatInput(`Find the direct website URL or news article for this record: ${selectedRecord.citation || selectedRecord.label}. Search for public web sources, not just archival finding aids.`)}
                                      className="text-[9px] font-mono uppercase font-bold underline hover:no-underline text-left"
                                    >
                                      Search for Web Source
                                    </button>
                                  </div>
                                )}
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
                                <button 
                                  onClick={() => {
                                    setChatInput(`Perform a deep dive on this gap: ${selectedRecord.label || 'Evidence Record'}. Focus on ${selectedRecord.gap_reasoning?.why_should_exist || 'its deductive basis'}.`);
                                    setActiveTab('chat');
                                    setIsSidebarOpen(false);
                                  }}
                                  className="w-full bg-red-600 text-white py-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-red-700 transition-all flex items-center justify-center gap-2"
                                >
                                  <Zap className="w-4 h-4" />
                                  Initiate Deep Dive
                                </button>
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
                                        <span className="text-[8px] font-mono uppercase opacity-40">{link.label || 'Connection'}</span>
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

            {activeTab === 'timeline' && (
              <TimelineView 
                records={data?.results || []} 
                onSelectRecord={(r) => {
                  setSelectedRecord(r);
                  setIsSidebarOpen(true);
                }}
              />
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
                            <tr 
                              key={record.record_id} 
                              onClick={() => setViewingRecord(record)}
                              className="border-b border-black hover:bg-black/5 transition-all cursor-pointer group"
                            >
                              <td className="p-4 border-r border-black">
                                <StatusBadge status={record.status} />
                              </td>
                              <td className="p-4 border-r border-black font-mono text-[10px] uppercase opacity-60">
                                {record.record_type}
                              </td>
                              <td className="p-4 border-r border-black">
                                <p className="font-bold mb-1 group-hover:underline">{record.label || 'Evidence Record'}</p>
                                <p className="opacity-70 line-clamp-2">{record.description}</p>
                              </td>
                              <td className="p-4 border-r border-black">
                                {record.citation_url ? (
                                  <a 
                                    href={record.citation_url} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-blue-600 hover:underline flex items-center gap-1"
                                  >
                                    <ExternalLink className="w-3 h-3" /> {record.citation || 'View Source'}
                                  </a>
                                ) : (
                                  <span className="opacity-40 italic">{record.citation || 'No citation'}</span>
                                )}
                              </td>
                              <td className="p-4">
                                <div className="flex gap-2">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewingRecord(record);
                                    }}
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
                  <h2 className="text-3xl font-serif italic">Investigative Partner</h2>
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
                      <p className="font-serif italic text-xl">Direct Inquiry Mode. Your Investigative Partner is ready for strategy or deep-dives.</p>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={`msg-${msg.timestamp}-${i}`} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[85%] p-4 border",
                        msg.role === 'user' ? "bg-black text-white border-black shadow-lg" : "bg-white border-black"
                      )}>
                        <div className="flex justify-between items-end mb-1 gap-4">
                          <p className="text-[9px] font-mono uppercase opacity-50">{msg.role === 'user' ? 'Inquirer' : 'Investigative Partner'}</p>
                          {msg.timestamp && (
                            <p className="text-[8px] font-mono opacity-30">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                          )}
                        </div>
                        <div className="text-sm leading-relaxed markdown-body">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                        {msg.actions && msg.actions.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-black/10 space-y-2">
                            <p className="text-[8px] font-mono uppercase opacity-40 flex items-center gap-1">
                              <Zap className="w-2 h-2" /> Suggested Actions
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {msg.actions.filter(Boolean).map((action: any, idx) => (
                                <button 
                                  key={`action-${idx}`}
                                  onClick={() => handleAction(action as any)}
                                  className="flex items-center gap-2 px-3 py-1.5 bg-black text-white hover:bg-black/80 transition-all border border-black text-[9px] font-mono uppercase font-bold"
                                >
                                  <Plus className="w-3 h-3" />
                                  {action.label || 'Action'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {msg.entities && msg.entities.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {msg.entities.map((entity, idx) => (
                              <span key={`ent-${idx}`} className="px-1.5 py-0.5 bg-stone-100 border border-black/5 text-[8px] font-mono uppercase opacity-60">
                                {entity}
                              </span>
                            ))}
                          </div>
                        )}
                        {msg.reasoning && (
                          <div className="mt-4 p-3 bg-stone-50 border border-black/10">
                            <details className="group">
                              <summary className="text-[9px] font-mono uppercase cursor-pointer list-none flex items-center gap-2 opacity-60 hover:opacity-100">
                                <Brain className="w-3 h-3" /> System Reasoning (Why & How)
                              </summary>
                              <div className="mt-3 text-[11px] font-sans leading-relaxed opacity-80 border-l-2 border-black/20 pl-4 py-1">
                                <ReactMarkdown>{msg.reasoning}</ReactMarkdown>
                              </div>
                            </details>
                          </div>
                        )}
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-black/10 space-y-3">
                            <p className="text-[8px] font-mono uppercase opacity-40 flex items-center gap-1">
                              <BookOpen className="w-2 h-2" /> Supporting Sources & Archival Findings
                            </p>
                            <div className="space-y-3">
                              {(() => {
                                const groups: Record<string, any[]> = {};
                                msg.citations.forEach((cite: any) => {
                                  const inst = cite.institution || 'General Sources';
                                  if (!groups[inst]) groups[inst] = [];
                                  groups[inst].push(cite);
                                });
                                return Object.entries(groups).map(([inst, cites]) => (
                                  <div key={inst} className="space-y-1.5">
                                    <p className="text-[7px] font-mono uppercase opacity-30 tracking-widest">{inst}</p>
                                    <div className="flex flex-wrap gap-2">
                                      {cites.map((cite, idx) => (
                                        <a 
                                          key={`cite-${idx}`}
                                          href={cite.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="flex items-center gap-2 px-2 py-1 bg-black/5 hover:bg-black hover:text-white transition-all border border-black/10 text-[9px] font-mono group/cite"
                                        >
                                          <LinkIcon className="w-2 h-2 opacity-40 group-hover/cite:opacity-100" />
                                          <span className="truncate max-w-[150px]">{cite.title}</span>
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        )}
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
                    placeholder="Ask for research strategy, deep-dives, or FOIA templates..."
                    className="flex-1 bg-transparent border border-black p-4 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                    onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                  />
                  <button
                    onClick={() => handleChat()}
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
                        onClick={() => setEditingRequest({ id: Math.random().toString(36).substr(2, 9), title: '', recipient: '', institution_normalized: '', subject: '', body: '', status: 'Draft', type: 'FOIA', createdAt: new Date().toISOString(), fingerprint: '' })}
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
                        (req.title || '').toLowerCase().includes((requestSearch || '').toLowerCase()) ||
                        (req.recipient || '').toLowerCase().includes((requestSearch || '').toLowerCase()) ||
                        (req.subject || '').toLowerCase().includes((requestSearch || '').toLowerCase())
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

                          <div className="space-y-3 mb-6 bg-stone-50 p-4 border border-black/5">
                            <div className="flex justify-between items-center group/field">
                              <p className="text-[10px] font-mono uppercase opacity-50">Recipient: <span className="text-black opacity-100">{req.recipient}</span></p>
                              <button onClick={() => { navigator.clipboard.writeText(req.recipient); }} className="opacity-0 group-hover/field:opacity-100 transition-all text-[9px] font-mono uppercase underline">Copy</button>
                            </div>
                            {req.institution_normalized && (
                              <div className="flex justify-between items-center group/field">
                                <p className="text-[10px] font-mono uppercase opacity-50">Institution: <span className="text-black opacity-100">{req.institution_normalized}</span></p>
                                <button onClick={() => { navigator.clipboard.writeText(req.institution_normalized); }} className="opacity-0 group-hover/field:opacity-100 transition-all text-[9px] font-mono uppercase underline">Copy</button>
                              </div>
                            )}
                            {req.department && (
                              <div className="flex justify-between items-center group/field">
                                <p className="text-[10px] font-mono uppercase opacity-50">Department: <span className="text-black opacity-100">{req.department}</span></p>
                                <button onClick={() => { navigator.clipboard.writeText(req.department); }} className="opacity-0 group-hover/field:opacity-100 transition-all text-[9px] font-mono uppercase underline">Copy</button>
                              </div>
                            )}
                            <div className="flex justify-between items-center group/field">
                              <p className="text-[10px] font-mono uppercase opacity-50">Subject: <span className="text-black opacity-100">{req.subject}</span></p>
                              <button onClick={() => { navigator.clipboard.writeText(req.subject); }} className="opacity-0 group-hover/field:opacity-100 transition-all text-[9px] font-mono uppercase underline">Copy</button>
                            </div>
                            {req.destination_email && (
                              <div className="flex justify-between items-center group/field">
                                <p className="text-xs font-mono uppercase opacity-50">
                                  {req.destination_email.includes('@') ? 'Email' : 'Contact'}: <span className="text-black opacity-100 font-bold">{req.destination_email}</span>
                                </p>
                                <div className="flex gap-2">
                                  <button onClick={() => { navigator.clipboard.writeText(req.destination_email); }} className="opacity-0 group-hover/field:opacity-100 transition-all text-[9px] font-mono uppercase underline">Copy</button>
                                </div>
                              </div>
                            )}
                            {req.submission_portal && (
                              <div className="flex justify-between items-center group/field">
                                <p className="text-[10px] font-mono uppercase opacity-50">Portal: <a href={req.submission_portal} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-bold">{req.submission_portal}</a></p>
                                <button onClick={() => { navigator.clipboard.writeText(req.submission_portal); }} className="opacity-0 group-hover/field:opacity-100 transition-all text-[9px] font-mono uppercase underline">Copy URL</button>
                              </div>
                            )}
                            {req.mailing_address && (
                              <div className="flex justify-between items-center group/field">
                                <p className="text-[10px] font-mono uppercase opacity-50">Mailing Address: <span className="text-black opacity-100 italic">{req.mailing_address}</span></p>
                                <button onClick={() => { navigator.clipboard.writeText(req.mailing_address); }} className="opacity-0 group-hover/field:opacity-100 transition-all text-[9px] font-mono uppercase underline">Copy</button>
                              </div>
                            )}

                            {req.verification_status && (
                              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-black/5">
                                <span className={cn(
                                  "text-[8px] font-mono px-1.5 py-0.5 uppercase border flex items-center gap-1",
                                  req.verification_status === 'CONFIRMED' ? "bg-green-50 border-green-600 text-green-700" :
                                  req.verification_status === 'PROBABLE' ? "bg-yellow-50 border-yellow-600 text-yellow-700" :
                                  "bg-stone-50 border-stone-600 text-stone-700"
                                )}>
                                  {req.verification_status === 'CONFIRMED' ? <CheckCircle2 className="w-2 h-2" /> : <AlertCircle className="w-2 h-2" />}
                                  {req.verification_status}
                                </span>
                                {req.verification_source && (
                                  <a href={req.verification_source} target="_blank" rel="noreferrer" className="text-[8px] font-mono uppercase underline opacity-50 hover:opacity-100">
                                    Source
                                  </a>
                                )}
                              </div>
                            )}

                            {req.alternative_contacts && req.alternative_contacts.length > 0 && (
                              <div className="mt-2 space-y-1">
                                <p className="text-[8px] font-mono uppercase opacity-40">Alternative Contacts:</p>
                                {req.alternative_contacts.map((alt, idx) => (
                                  <p key={idx} className="text-[9px] font-mono opacity-70">
                                    <span className="font-bold">{alt.type}:</span> {alt.value}
                                  </p>
                                ))}
                              </div>
                            )}
                            
                            <div className="mt-4 pt-4 border-t border-black/10">
                              <div className="flex justify-between items-center mb-2">
                                <p className="text-[10px] font-mono uppercase opacity-50">Request Body:</p>
                                <button 
                                  onClick={() => { navigator.clipboard.writeText(req.body); }}
                                  className="text-[9px] font-mono uppercase bg-black text-white px-2 py-1 hover:bg-black/80 transition-all"
                                >
                                  Copy Full Body
                                </button>
                              </div>
                              <div className="text-[11px] font-serif leading-relaxed opacity-80 whitespace-pre-wrap max-h-40 overflow-y-auto p-2 bg-white border border-black/5">
                                {req.body}
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-3">
                            {req.destination_email || req.submission_portal ? (
                              <a 
                                href={req.destination_email?.includes('@') ? `mailto:${req.destination_email}?subject=${encodeURIComponent(req.subject)}&body=${encodeURIComponent(req.body)}` : (req.destination_email || req.submission_portal)}
                                target={req.destination_email?.includes('@') ? "_self" : "_blank"}
                                rel={req.destination_email?.includes('@') ? "" : "noreferrer"}
                                onClick={() => updateRequestStatus(req.id, 'Sent')}
                                className="flex-1 bg-black text-white p-3 text-center text-[10px] font-mono uppercase font-bold tracking-widest flex items-center justify-center gap-2 hover:bg-black/90 transition-all"
                              >
                                <Send className="w-3 h-3" /> {req.destination_email?.includes('@') ? 'Send via Mail Client' : 'Open Submission Portal'}
                              </a>
                            ) : (
                              <div className="flex-1 bg-stone-100 text-stone-400 p-3 text-center text-[10px] font-mono uppercase font-bold tracking-widest flex items-center justify-center gap-2 border border-black/10 cursor-not-allowed">
                                <AlertCircle className="w-3 h-3" /> No Contact Info Found
                              </div>
                            )}
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

            {activeTab === 'sources' && (
              <motion.div
                key="sources"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12"
              >
                <div className="max-w-6xl mx-auto space-y-16">
                  <section>
                    <div className="flex justify-between items-end mb-6 border-b border-black pb-4">
                      <h2 className="text-3xl font-serif italic">Evidence Sources</h2>
                      <div className="flex gap-2">
                        <label className="cursor-pointer text-[10px] font-mono uppercase border border-black px-4 py-2 hover:bg-black hover:text-white transition-all flex items-center gap-2">
                          <Upload className="w-3 h-3" />
                          <span>Upload Document</span>
                          <input type="file" accept=".docx,.xml,.ead,.txt,.md" className="hidden" multiple onChange={handleFileUpload} />
                        </label>
                        <button 
                          onClick={() => setEditingSource({ id: Math.random().toString(36).substr(2, 9), title: '', url: '', type: 'Primary', addedAt: new Date().toISOString() })}
                          className="text-[10px] font-mono uppercase bg-black text-white px-4 py-2 hover:bg-black/80 transition-all"
                        >
                          Add Link
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
                      <div className="flex items-center gap-2">
                        <LayoutGrid className="w-4 h-4 opacity-30" />
                        <select 
                          value={sourceGroupBy}
                          onChange={(e) => setSourceGroupBy(e.target.value as any)}
                          className="bg-black/5 border border-black/10 p-3 text-xs font-mono uppercase focus:outline-none focus:border-black transition-all"
                        >
                          <option value="None">No Grouping</option>
                          <option value="Institution">By Institution</option>
                          <option value="Type">By Type</option>
                        </select>
                      </div>
                    </div>

                    {sources.length === 0 ? (
                      <div className="text-center py-12 opacity-20 border border-dashed border-black/20 rounded-lg">
                        <BookOpen className="w-12 h-12 mx-auto mb-4" />
                        <p className="font-serif italic text-lg">No sources logged. Keep track of your evidence here.</p>
                      </div>
                    ) : (
                      <div className="space-y-12">
                        {(() => {
                          const filteredSources = sources.filter(s => {
                            const matchesSearch = (s.title || '').toLowerCase().includes((sourceSearch || '').toLowerCase()) || 
                                                 (s.notes || '').toLowerCase().includes((sourceSearch || '').toLowerCase());
                            const matchesFilter = sourceFilter === 'All' || s.type === sourceFilter;
                            return matchesSearch && matchesFilter;
                          });

                          if (sourceGroupBy === 'None') {
                            return (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {filteredSources.map(source => (
                                  <SourceCard 
                                    key={source.id} 
                                    source={source} 
                                    onEdit={setEditingSource}
                                    onDelete={deleteSource}
                                    onView={setViewingSource}
                                  />
                                ))}
                              </div>
                            );
                          }

                          const groups: Record<string, Source[]> = {};
                          filteredSources.forEach(s => {
                            const key = sourceGroupBy === 'Institution' 
                              ? (s.institution_normalized || 'Unspecified Institution')
                              : (s.type || 'Other');
                            if (!groups[key]) groups[key] = [];
                            groups[key].push(s);
                          });

                          return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, groupSources]) => (
                            <div key={groupName} className="space-y-6">
                              <div className="flex items-center gap-4">
                                <h3 className="text-xs font-mono uppercase font-bold tracking-[0.2em] bg-black text-white px-3 py-1">
                                  {groupName}
                                </h3>
                                <div className="h-[1px] flex-1 bg-black/10" />
                                <span className="text-[10px] font-mono opacity-40">{groupSources.length} Sources</span>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {groupSources.map(source => (
                                  <SourceCard 
                                    key={source.id} 
                                    source={source} 
                                    onEdit={setEditingSource}
                                    onDelete={deleteSource}
                                    onView={setViewingSource}
                                  />
                                ))}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </section>
                </div>
              </motion.div>
            )}

            {activeTab === 'data-management' && (
              <motion.div
                key="data-management"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full overflow-y-auto p-6 md:p-12"
              >
                <div className="max-w-6xl mx-auto space-y-16">
                  {/* Section 1: Uploaded Document Sync */}
                  <section className="space-y-8">
                    {isParsing && (
                      <div className="bg-black text-white p-4 border border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] animate-pulse flex items-center gap-3">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-[10px] font-mono uppercase tracking-widest">{parsingProgress}</span>
                      </div>
                    )}

                    <div className="flex justify-between items-end mb-6 border-b border-black pb-4">
                      <h2 className="text-3xl font-serif italic">Document Upload & Sync</h2>
                      <div className="flex items-center gap-4">
                        <p className="text-[10px] font-mono opacity-50 uppercase tracking-widest">{uploadedFiles.length} Files Parsed</p>
                        <label className="cursor-pointer bg-black text-white px-4 py-2 text-[10px] font-mono uppercase hover:bg-black/80 transition-all">
                          Upload .txt / .docx
                          <input type="file" accept=".docx,.xml,.ead,.txt,.md" multiple className="hidden" onChange={handleFileUpload} />
                        </label>
                      </div>
                    </div>

                    {uploadedFiles.length > 0 ? (
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
                    ) : (
                      <div className="text-center py-12 opacity-20 border border-dashed border-black/20 rounded-lg">
                        <Upload className="w-12 h-12 mx-auto mb-4" />
                        <p className="font-serif italic text-lg">No documents uploaded yet. Upload .txt or .docx files to parse them into the system.</p>
                      </div>
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
                              <input type="file" accept=".docx,.xml,.ead,.txt,.md" multiple onChange={handleFileUpload} className="hidden" />
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
                                <button onClick={() => alert('Remote research is premium.')} className="underline">RESEARCH</button>
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

            {activeTab === 'settings' && (
              <SettingsView 
                aiConnected={aiConnected}
                setAiConnected={setAiConnected}
                naraApiKey={naraApiKey}
                setNaraApiKey={setNaraApiKey}
                searchNara={searchNara}
                user={user}
                signIn={signIn}
                signOut={signOut}
                investigations={investigations}
                currentInvestigationId={currentInvestigationId}
                setCurrentInvestigationId={setCurrentInvestigationId}
                createNewInvestigation={createNewInvestigation}
                renameInvestigation={renameInvestigation}
                setInvestigations={setInvestigations}
                setShowNewInvestigationModal={setShowNewInvestigationModal}
                setNewInvestigationTitle={setNewInvestigationTitle}
                setShowRenameModal={setShowRenameModal}
                setRenameTitle={setRenameTitle}
                setShowDeleteConfirm={setShowDeleteConfirm}
                handleFirestoreError={handleFirestoreError}
                quotaExceeded={quotaExceeded}
                setQuotaExceeded={setQuotaExceeded}
                apiKeySource={apiKeySource}
                customGeminiKey={customGeminiKey}
                setCustomGeminiKey={setCustomGeminiKey}
                bypassPlatformKey={bypassPlatformKey}
                setBypassPlatformKey={setBypassPlatformKey}
                customFirebaseConfig={customFirebaseConfig}
                setCustomFirebaseConfig={setCustomFirebaseConfig}
              />
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
                    <div className="flex items-end gap-4">
                      <h2 className="text-3xl font-serif italic">Investigation Log</h2>
                      {collaboratorEmails && collaboratorEmails.length > 0 && (
                        <div className="flex items-center gap-1 mb-1">
                          <Users className="w-3 h-3 opacity-40" />
                          <p className="text-[8px] font-mono uppercase opacity-40">{collaboratorEmails.length} Collaborators Active</p>
                        </div>
                      )}
                    </div>
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
                        const matchesSearch = (p.name || '').toLowerCase().includes((investigationSearch || '').toLowerCase()) || 
                                             (p.notes || '').toLowerCase().includes((investigationSearch || '').toLowerCase());
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
                              {point.isStrategistDiscovery && (
                                <span className="text-[8px] font-mono bg-purple-600 text-white px-1 uppercase flex items-center gap-1 animate-pulse">
                                  <Brain className="w-2 h-2" /> Strategist Discovery
                                </span>
                              )}
                              {point.inference_type && (
                                <span className={cn(
                                  "text-[8px] font-mono px-1 uppercase border",
                                  point.inference_type === 'Direct' ? "border-green-600 text-green-600" : "border-purple-600 text-purple-600"
                                )}>{point.inference_type}</span>
                              )}
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
                          {point.explanation && (
                            <div className="mb-4">
                              <label className="text-[7px] font-mono uppercase opacity-50 block mb-1">Explanation</label>
                              <p className="text-[10px] leading-relaxed opacity-70">{point.explanation}</p>
                            </div>
                          )}
                          {point.connection_to_pattern && (
                            <div className="mb-4">
                              <label className="text-[7px] font-mono uppercase opacity-50 block mb-1">Pattern Connection</label>
                              <p className="text-[10px] leading-relaxed italic opacity-70">{point.connection_to_pattern}</p>
                            </div>
                          )}
                          {point.verification_needs && (
                            <div className="mb-4 p-2 bg-red-50 border-l border-red-600">
                              <label className="text-[7px] font-mono uppercase text-red-800 block mb-1">Verification Needs</label>
                              <p className="text-[10px] leading-relaxed text-red-900">{point.verification_needs}</p>
                            </div>
                          )}
                          {point.searchQuery && (
                            <div className="mb-4 p-2 bg-black/5 border-l border-black">
                              <label className="text-[7px] font-mono uppercase opacity-50 block mb-1">Generated Query</label>
                              <p className="text-[10px] font-mono italic break-words">"{point.searchQuery}"</p>
                            </div>
                          )}
                          {point.discoveryReason && (
                            <div className="mb-4 p-2 bg-purple-50 border-l border-purple-600">
                              <label className="text-[7px] font-mono uppercase text-purple-800 block mb-1">Discovery Logic</label>
                              <p className="text-[10px] leading-relaxed text-purple-900 italic">{point.discoveryReason}</p>
                            </div>
                          )}
                          {point.notes && <p className="text-xs opacity-70 leading-relaxed mb-4 flex-1">{point.notes}</p>}
                          <div className="mt-auto pt-4 border-t border-black/5 flex justify-between items-center">
                            <p className="text-[8px] font-mono opacity-30">Logged: {new Date(point.createdAt).toLocaleDateString()}</p>
                            <button 
                              onClick={() => consultStrategistOnLog(point)}
                              className="text-[9px] font-mono uppercase flex items-center gap-1 hover:underline opacity-60 hover:opacity-100 transition-all"
                            >
                              <MessageSquare className="w-3 h-3" /> Consult Strategist
                            </button>
                          </div>
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
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-0.5 bg-black text-white text-[8px] font-mono uppercase tracking-widest">System Status: Operational</span>
                          <span className="px-2 py-0.5 bg-blue-600 text-white text-[8px] font-mono uppercase tracking-widest animate-pulse">Investigative Partner Mode v2.5</span>
                        </div>
                        <h2 className="text-3xl font-serif italic">AI Research Suggestions</h2>
                        <p className="text-[10px] font-mono opacity-50 uppercase tracking-widest mt-1">Strategic Research of {data?.results?.length || 0} Evidence Points</p>
                      </div>
                      <button 
                        onClick={() => handleDeepAnalysis()}
                        disabled={isAnalyzingSuggestions || !data}
                        className={cn(
                          "px-8 py-4 bg-black text-white text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all flex items-center gap-2",
                          isAnalyzingSuggestions && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {isAnalyzingSuggestions ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" /> Researching...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" /> Initiate Deep Research
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
                                    <h3 className="text-lg font-serif italic">Chat</h3>
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
                                          "max-w-[90%] p-3 text-[10px] leading-relaxed border",
                                          msg.role === 'user' ? "bg-black text-white border-black shadow-md" : "bg-white border-black"
                                        )}>
                                          <div className="flex justify-between items-end mb-1 gap-4">
                                            <p className="text-[7px] font-mono uppercase opacity-50">{msg.role === 'user' ? 'Inquirer' : 'ODEN Strategist'}</p>
                                            {msg.timestamp && (
                                              <p className="text-[6px] font-mono opacity-30">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                            )}
                                          </div>
                                          <div className="markdown-body">
                                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                                          </div>
                                          {msg.entities && msg.entities.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1">
                                              {msg.entities.map((entity, idx) => (
                                                <span key={`sent-${idx}`} className="px-1 py-0.5 bg-stone-100 border border-black/5 text-[7px] font-mono uppercase opacity-60">
                                                  {entity}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                          {msg.reasoning && (
                                            <div className="mt-3 p-2 bg-stone-50 border border-black/10">
                                              <details className="group">
                                                <summary className="text-[7px] font-mono uppercase cursor-pointer list-none flex items-center gap-1 opacity-60 hover:opacity-100">
                                                  <Brain className="w-2 h-2" /> Reasoning
                                                </summary>
                                                <div className="mt-2 text-[9px] font-sans leading-relaxed opacity-80 border-l border-black/20 pl-2 py-0.5">
                                                  <ReactMarkdown>{msg.reasoning}</ReactMarkdown>
                                                </div>
                                              </details>
                                            </div>
                                          )}
                                          {msg.citations && msg.citations.length > 0 && (
                                            <div className="mt-3 pt-3 border-t border-black/10 space-y-1.5">
                                              <p className="text-[7px] font-mono uppercase opacity-40 flex items-center gap-1">
                                                <BookOpen className="w-2 h-2" /> Sources
                                              </p>
                                              <div className="flex flex-wrap gap-1.5">
                                                {msg.citations.map((cite, idx) => (
                                                  <a 
                                                    key={`scite-${idx}`}
                                                    href={cite.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="flex items-center gap-1.5 px-1.5 py-0.5 bg-black/5 hover:bg-black hover:text-white transition-all border border-black/10 text-[7px] font-mono"
                                                  >
                                                    <LinkIcon className="w-2 h-2" />
                                                    <span className="truncate max-w-[100px]">{cite.title}</span>
                                                  </a>
                                                ))}
                                              </div>
                                            </div>
                                          )}
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
                                    <h4 className="text-[8px] font-mono uppercase tracking-widest mb-2 opacity-50">Investigative Outlook</h4>
                                    <div className="text-xs font-serif italic leading-relaxed markdown-body">
                                      <ReactMarkdown>
                                        {suggestions.investigativeOutlook || "The current evidence cluster suggests a high degree of institutional opacity. Focus on cross-referencing personnel records with internal memos to identify the nexus of decision-making."}
                                      </ReactMarkdown>
                                    </div>
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
                                      <button 
                                        onClick={() => handleDeepAnalysis('institutional gaps')}
                                        className="p-3 border border-black text-[8px] font-mono uppercase hover:bg-black hover:text-white transition-all bg-white"
                                      >
                                        Research Gaps
                                      </button>
                                      <button 
                                        onClick={() => handleDeepAnalysis('pattern recognition and links')}
                                        className="p-3 border border-black text-[8px] font-mono uppercase hover:bg-black hover:text-white transition-all bg-white"
                                      >
                                        Verify Links
                                      </button>
                                      <button 
                                        onClick={() => handleDeepAnalysis('methodological advice')}
                                        className="p-3 border border-black text-[8px] font-mono uppercase hover:bg-black hover:text-white transition-all bg-white"
                                      >
                                        Methodology
                                      </button>
                                      <button 
                                        onClick={() => alert('Exporting Strategic Brief...')}
                                        className="p-3 border border-black text-[8px] font-mono uppercase hover:bg-black hover:text-white transition-all bg-white"
                                      >
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
                          {/* Structural Bridges & Crossovers */}
                          <section>
                            <div className="mb-6 flex items-center justify-between">
                              <div>
                                <h3 className="col-header">Structural Bridges & Crossovers</h3>
                                <div className="flex items-center gap-2 mt-1">
                                  <p className="text-[10px] font-mono opacity-50 uppercase tracking-widest">Personnel, Financial, and Institutional Nexus Points</p>
                                  <span className="px-1.5 py-0.5 bg-black text-white text-[7px] font-mono uppercase tracking-tighter">v2.5 Active</span>
                                </div>
                              </div>
                              <Zap className="w-4 h-4 opacity-20" />
                            </div>
                            
                            <div className="space-y-6">
                              {/* Personnel Crossovers */}
                              <div>
                                <div className="flex items-center gap-2 mb-3">
                                  <Users className="w-3 h-3 opacity-40" />
                                  <span className="text-[8px] font-mono uppercase font-bold tracking-widest opacity-50">Personnel Crossovers</span>
                                </div>
                                {suggestions.personnelCrossovers && suggestions.personnelCrossovers.length > 0 ? (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {suggestions.personnelCrossovers.map((pc, idx) => (
                                      <div key={`pc-${idx}`} className="border border-black p-6 bg-stone-50 border-l-4 border-l-blue-600">
                                        <div className="flex items-center gap-2 mb-2">
                                          <Users className="w-3 h-3 text-blue-600" />
                                          <span className="text-[8px] font-mono uppercase font-bold tracking-widest opacity-50">Personnel Bridge</span>
                                        </div>
                                        <h4 className="text-xl font-serif italic mb-2">{pc.name || 'Unknown Personnel'}</h4>
                                        <div className="flex flex-wrap gap-1 mb-3">
                                          {(pc.roles || []).map((role, ridx) => (
                                            <span key={ridx} className="px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[8px] font-mono uppercase border border-blue-200">
                                              {role}
                                            </span>
                                          ))}
                                        </div>
                                        <p className="text-[10px] opacity-70 leading-relaxed">{pc.significance}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-8 border border-dashed border-black/10 text-center">
                                    <p className="text-[10px] font-mono opacity-30 italic uppercase">No personnel crossovers identified in current evidence cluster.</p>
                                  </div>
                                )}
                              </div>

                              {/* Financial Crossovers */}
                              <div>
                                <div className="flex items-center gap-2 mb-3">
                                  <DollarSign className="w-3 h-3 opacity-40" />
                                  <span className="text-[8px] font-mono uppercase font-bold tracking-widest opacity-50">Financial Crossovers</span>
                                </div>
                                {suggestions.financialCrossovers && suggestions.financialCrossovers.length > 0 ? (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {suggestions.financialCrossovers.map((fc, idx) => (
                                      <div key={`fc-${idx}`} className="border border-black p-6 bg-stone-50 border-l-4 border-l-green-600">
                                        <div className="flex items-center gap-2 mb-2">
                                          <DollarSign className="w-3 h-3 text-green-600" />
                                          <span className="text-[8px] font-mono uppercase font-bold tracking-widest opacity-50">Financial Bridge</span>
                                        </div>
                                        <div className="flex items-center gap-3 mb-2">
                                          <div className="flex-1 text-right">
                                            <p className="text-xs font-bold truncate">{fc.source || 'Unknown Source'}</p>
                                          </div>
                                          <ArrowRight className="w-3 h-3 opacity-30" />
                                          <div className="flex-1">
                                            <p className="text-xs font-bold truncate">{fc.target || 'Unknown Target'}</p>
                                          </div>
                                        </div>
                                        {fc.amount && (
                                          <p className="text-lg font-serif italic mb-2 text-green-800">{fc.amount}</p>
                                        )}
                                        <p className="text-[10px] opacity-70 leading-relaxed">{fc.significance}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-8 border border-dashed border-black/10 text-center">
                                    <p className="text-[10px] font-mono opacity-30 italic uppercase">No financial crossovers identified in current evidence cluster.</p>
                                  </div>
                                )}
                              </div>

                              {/* Original Bridges */}
                              {suggestions.bridges.length > 0 ? suggestions.bridges.map((bridge, idx) => (
                                <div key={`bridge-${bridge.label}-${idx}`} className="border border-black p-8 bg-white hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all group">
                                  <div className="flex items-center gap-2 mb-3">
                                    <Zap className="w-4 h-4 text-yellow-600" />
                                    <span className="text-[10px] font-mono uppercase font-bold tracking-widest">Potential Nexus</span>
                                  </div>
                                  <h4 className="text-2xl font-serif italic mb-3">{bridge.label || 'Potential Nexus'}</h4>
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
                                        label: bridge.label || 'Potential Nexus',
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
                                      } as ResearchResponse);
                                      if (suggestions) {
                                        setSuggestions({
                                          ...suggestions, 
                                          bridges: (suggestions.bridges || []).filter((_, i) => i !== idx)
                                        });
                                      }
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
                                  <h4 className="font-serif italic text-xl mb-2">{gap.label || 'Institutional Gap'}</h4>
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
                                  <h4 className="font-serif italic text-xl mb-2">{anomaly.title || 'Structural Anomaly'}</h4>
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
                                <div key={`gap-${gap.label || idx}-${idx}`} className="border border-black p-6 bg-white hover:bg-stone-50 transition-all">
                                  <div className="flex items-center gap-2 mb-3">
                                    <AlertTriangle className="w-4 h-4 text-red-600" />
                                    <span className="text-[10px] font-mono uppercase opacity-50 font-bold tracking-widest">Missing Evidence</span>
                                  </div>
                                  <h4 className="font-serif italic text-xl mb-2">{gap.label || 'Archival Gap'}</h4>
                                  <p className="text-xs opacity-70 leading-relaxed mb-6">{gap.description}</p>
                                  <button 
                                    onClick={() => {
                                      const newRecord: EvidenceRecord = {
                                        record_id: `gap-${Date.now()}`,
                                        label: gap.label || 'Archival Gap',
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
                                      if (suggestions) {
                                        setSuggestions({
                                          ...suggestions, 
                                          gaps: (suggestions.gaps || []).filter((_, i) => i !== idx)
                                        });
                                      }
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
                                    <h4 className="font-serif italic text-xl mb-2">{area.title || 'Research Area'}</h4>
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
                                        if (suggestions) {
                                          setSuggestions({
                                            ...suggestions, 
                                            researchAreas: (suggestions.researchAreas || []).filter((_, i) => i !== idx)
                                          });
                                        }
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
                  <div className="flex justify-between items-start mb-8 border-b border-black pb-4 gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <StatusBadge status={viewingRecord.status} />
                        <span className="text-[10px] font-mono uppercase opacity-40 tracking-widest">{viewingRecord.record_type}</span>
                      </div>
                      <h2 className="text-2xl sm:text-4xl font-serif italic tracking-tighter truncate">{viewingRecord.label || viewingRecord.description || 'Evidence Record'}</h2>
                    </div>
                    <button onClick={() => setViewingRecord(null)} className="text-2xl hover:opacity-50 transition-opacity flex-shrink-0 p-2 border border-black/10 sm:border-none">✕</button>
                  </div>

                  <div className="grid md:grid-cols-3 gap-12">
                    <div className="md:col-span-2 space-y-8">
                      <section>
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Contextual Analysis</h3>
                        <div className="text-lg leading-relaxed opacity-80 font-serif italic max-h-60 overflow-y-auto pr-4 custom-scrollbar">
                          {viewingRecord.description}
                        </div>
                      </section>

                      {viewingRecord.observed_content && (
                        <section>
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Observed Content</h3>
                          <div className="p-6 border border-black/10 bg-stone-50 font-mono text-xs leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto custom-scrollbar">
                            {viewingRecord.observed_content}
                          </div>
                        </section>
                      )}

                      {viewingRecord.connection_logic && (
                        <section>
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Structural Connection Logic</h3>
                          <p className="text-sm leading-relaxed opacity-70 italic">
                            {viewingRecord.connection_logic}
                          </p>
                        </section>
                      )}

                      {viewingRecord.significance && (
                        <section>
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Significance</h3>
                          <p className="text-sm leading-relaxed opacity-70">
                            {viewingRecord.significance}
                          </p>
                        </section>
                      )}

                      {viewingRecord.gap_reasoning && (
                        <section className="p-4 bg-red-50 border border-red-100 rounded-sm">
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-red-800 mb-4">Archival Gap Reasoning</h3>
                          <div className="space-y-3 text-xs">
                            <div>
                              <span className="font-bold block">Why it should exist:</span>
                              <p className="opacity-70">{viewingRecord.gap_reasoning.why_should_exist}</p>
                            </div>
                            <div>
                              <span className="font-bold block">Where specifically:</span>
                              <p className="opacity-70">{viewingRecord.gap_reasoning.where_specifically}</p>
                            </div>
                            {viewingRecord.gap_reasoning.institutional_process && (
                              <div>
                                <span className="font-bold block">Institutional Process:</span>
                                <p className="opacity-70">{viewingRecord.gap_reasoning.institutional_process}</p>
                              </div>
                            )}
                          </div>
                        </section>
                      )}

                      {viewingRecord.expected_location && (
                        <section>
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Expected Location</h3>
                          <p className="text-sm leading-relaxed opacity-70">
                            {viewingRecord.expected_location}
                          </p>
                        </section>
                      )}

                      {viewingRecord.research_preview && (
                        <section>
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Research Preview</h3>
                          <p className="text-sm leading-relaxed opacity-70 italic">
                            {viewingRecord.research_preview}
                          </p>
                        </section>
                      )}

                      {viewingRecord.entities && viewingRecord.entities.length > 0 && (
                        <section>
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Linked Entities</h3>
                          <div className="flex flex-wrap gap-2">
                            {viewingRecord.entities.map((ent, idx) => (
                              <span key={idx} className="text-[10px] font-mono bg-black/5 px-2 py-1 border border-black/10">{ent}</span>
                            ))}
                          </div>
                        </section>
                      )}

                      {viewingRecord.raw_result && (
                        <section>
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Raw Research Data</h3>
                          <div className="p-6 border border-black/10 bg-stone-50 font-mono text-[10px] leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto custom-scrollbar opacity-50">
                            {viewingRecord.raw_result}
                          </div>
                        </section>
                      )}
                    </div>

                    <div className="space-y-8">
                      <section>
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Source Attribution</h3>
                        {viewingRecord.timeline_date && (
                          <div className="flex items-center gap-2 mb-4 p-2 bg-stone-50 border border-black/5">
                            <Calendar className="w-3 h-3 opacity-40" />
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider">{viewingRecord.timeline_date}</span>
                          </div>
                        )}
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
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30 mb-4">Structural Impact</h3>
                        {viewingRecord.classification && (
                          <div className="mb-4">
                            <span className={cn(
                              "text-[9px] font-mono font-bold uppercase px-2 py-1 border block text-center",
                              viewingRecord.classification === 'verified' ? "border-green-600 text-green-600 bg-green-50" :
                              viewingRecord.classification === 'contested' ? "border-red-600 text-red-600 bg-red-50" :
                              "border-stone-400 text-stone-400 bg-stone-50"
                            )}>{viewingRecord.classification}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mb-2">
                          <span className={cn(
                            "text-[10px] font-mono font-bold uppercase px-2 py-0.5 border",
                            viewingRecord.impact === 'Supports' ? "bg-green-50 text-green-800 border-green-200" :
                            viewingRecord.impact === 'Weakens' ? "bg-red-50 text-red-800 border-red-200" :
                            viewingRecord.impact === 'Complicates' ? "bg-purple-50 text-purple-800 border-purple-200" :
                            "bg-gray-50 text-gray-800 border-gray-200"
                          )}>{viewingRecord.impact || 'Leaves Open'}</span>
                          <span className={cn(
                            "text-[10px] font-mono font-bold uppercase px-2 py-0.5 border",
                            viewingRecord.strength === 'Strong' ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
                            viewingRecord.strength === 'Weak' ? "bg-orange-50 text-orange-800 border-orange-200" :
                            "bg-gray-50 text-gray-800 border-gray-200"
                          )}>{viewingRecord.strength || 'Noise'}</span>
                        </div>
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
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 sm:p-6 border-b border-black bg-stone-50 gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span className="text-[10px] font-mono bg-black text-white px-2 py-1 uppercase tracking-widest flex-shrink-0">{viewingSource.type}</span>
                          <span className="text-[10px] font-mono uppercase opacity-40 tracking-widest flex-shrink-0">Added {new Date(viewingSource.addedAt).toLocaleDateString()}</span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-serif italic tracking-tighter truncate">{viewingSource.title}</h2>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end">
                      {viewingSource.url && (
                        <a 
                          href={viewingSource.url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 border border-black text-[9px] sm:text-[10px] font-mono uppercase hover:bg-black hover:text-white transition-all whitespace-nowrap"
                        >
                          <ExternalLink className="w-3 h-3" /> <span className="hidden xs:inline">Original Source</span><span className="xs:hidden">Source</span>
                        </a>
                      )}
                      <button onClick={() => setViewingSource(null)} className="p-2 hover:bg-black/5 transition-opacity flex-shrink-0 border border-black/10 sm:border-none">
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

                      <div className="pt-8 border-t border-black/10">
                        <button 
                          onClick={() => setViewingSource(null)}
                          className="w-full border border-black p-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black hover:text-white transition-all"
                        >
                          Close Document
                        </button>
                      </div>
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
                  <div className="flex justify-between items-start mb-8 border-b border-black pb-4 gap-4">
                    <h3 className="text-xl sm:text-2xl font-serif italic truncate">Edit Record: {editingRecord.label || 'Evidence Record'}</h3>
                    <button onClick={() => setEditingRecord(null)} className="text-2xl hover:opacity-50 transition-opacity flex-shrink-0 p-2 border border-black/10 sm:border-none">✕</button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Label / Name</label>
                        <input 
                          type="text" 
                          value={editingRecord.label || ''}
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
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Classification</label>
                        <select 
                          value={editingRecord.classification || 'unverified'}
                          onChange={(e) => setEditingRecord({...editingRecord, classification: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black bg-white"
                        >
                          <option value="verified">Verified</option>
                          <option value="unverified">Unverified</option>
                          <option value="gap">Gap</option>
                          <option value="contested">Contested</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Strength</label>
                        <select 
                          value={editingRecord.strength || 'Noise'}
                          onChange={(e) => setEditingRecord({...editingRecord, strength: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black bg-white"
                        >
                          <option value="Strong">Strong</option>
                          <option value="Weak">Weak</option>
                          <option value="Noise">Noise</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Normalized Institution</label>
                        <input 
                          type="text" 
                          value={editingRecord.institution_normalized || ''}
                          onChange={(e) => setEditingRecord({...editingRecord, institution_normalized: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        />
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
                          rows={3}
                          value={editingRecord.description}
                          onChange={(e) => setEditingRecord({...editingRecord, description: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Observed Content</label>
                        <textarea 
                          rows={3}
                          value={editingRecord.observed_content || ''}
                          onChange={(e) => setEditingRecord({...editingRecord, observed_content: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="text-[10px] font-mono uppercase font-bold block mb-2">Connection Logic</label>
                          <textarea 
                            rows={3}
                            value={editingRecord.connection_logic || ''}
                            onChange={(e) => setEditingRecord({...editingRecord, connection_logic: e.target.value})}
                            className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-mono uppercase font-bold block mb-2">Significance</label>
                          <textarea 
                            rows={3}
                            value={editingRecord.significance || ''}
                            onChange={(e) => setEditingRecord({...editingRecord, significance: e.target.value})}
                            className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="text-[10px] font-mono uppercase font-bold block mb-2">Follow-up Suggestions</label>
                          <textarea 
                            rows={3}
                            value={editingRecord.suggestions || ''}
                            onChange={(e) => setEditingRecord({...editingRecord, suggestions: e.target.value})}
                            className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-mono uppercase font-bold block mb-2">Missing Verification</label>
                          <textarea 
                            rows={3}
                            value={editingRecord.missing_verification || ''}
                            onChange={(e) => setEditingRecord({...editingRecord, missing_verification: e.target.value})}
                            className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                          />
                        </div>
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
                      {data?.links?.filter(l => l.source === editingRecord.record_id || l.target === editingRecord.record_id).map((link, idx) => (
                        <div key={`edit-link-${idx}`} className="flex justify-between items-center p-2 bg-stone-50 border border-black/10 text-[10px] font-mono">
                          <span>{link.source === editingRecord.record_id ? 'TO' : 'FROM'}: {data.results.find(n => n.record_id === (link.source === editingRecord.record_id ? link.target : link.source))?.label || 'Unknown'}</span>
                          <button 
                            onClick={() => {
                              if (!data) return;
                              setData({
                                ...data,
                                links: (data.links || []).filter((_, i) => i !== (data.links || []).indexOf(link))
                              } as ResearchResponse);
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
                        {(data?.results || []).filter(n => n.record_id !== editingRecord.record_id).map(n => (
                          <option key={n.record_id} value={n.record_id}>{n.label || 'Evidence Record'}</option>
                        ))}
                      </select>
                      <button 
                        onClick={() => {
                          const targetId = (document.getElementById('new-link-target') as HTMLSelectElement).value;
                          if (!targetId || !data) return;
                          setData({
                            ...data,
                            links: [...(data.links || []), { source: editingRecord.record_id, target: targetId, label: 'Manual Connection' }]
                          } as ResearchResponse);
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

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Normalized Institution</label>
                        <input 
                          type="text" 
                          value={editingRequest.institution_normalized || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, institution_normalized: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Department</label>
                        <input 
                          type="text" 
                          value={editingRequest.department || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, department: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Destination Email</label>
                        <input 
                          type="text" 
                          value={editingRequest.destination_email || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, destination_email: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="foia@agency.gov"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Submission Portal</label>
                        <input 
                          type="text" 
                          value={editingRequest.submission_portal || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, submission_portal: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="https://foia.gov/..."
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-mono uppercase font-bold block mb-2">Mailing Address</label>
                      <input 
                        type="text" 
                        value={editingRequest.mailing_address || ''}
                        onChange={(e) => setEditingRequest({...editingRequest, mailing_address: e.target.value})}
                        className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        placeholder="123 Agency Way, Washington DC..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Verification Status</label>
                        <select 
                          value={editingRequest.verification_status || 'CANDIDATE'}
                          onChange={(e) => setEditingRequest({...editingRequest, verification_status: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        >
                          <option value="CONFIRMED">CONFIRMED TARGET</option>
                          <option value="PROBABLE">PROBABLE TARGET</option>
                          <option value="CANDIDATE">CANDIDATE TARGET</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Verification Source (URL)</label>
                        <input 
                          type="text" 
                          value={editingRequest.verification_source || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, verification_source: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="https://..."
                        />
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
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Classification</label>
                        <input 
                          type="text" 
                          value={editingSource.classification || ''}
                          onChange={(e) => setEditingSource({...editingSource, classification: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="e.g. Internal Memo"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Normalized Institution</label>
                        <input 
                          type="text" 
                          value={editingSource.institution_normalized || ''}
                          onChange={(e) => setEditingSource({...editingSource, institution_normalized: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Department</label>
                        <input 
                          type="text" 
                          value={editingSource.department || ''}
                          onChange={(e) => setEditingSource({...editingSource, department: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
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
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Physical Repository Details</label>
                        <input 
                          type="text" 
                          value={editingSource.physical_location || ''}
                          onChange={(e) => setEditingSource({...editingSource, physical_location: e.target.value})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          placeholder="e.g. Box 4, Folder 12"
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

            {/* Editing Research Point Modal */}
            {editingResearchPoint && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white border-2 border-black w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8 shadow-[16px_16px_0px_0px_rgba(0,0,0,1)]"
                >
                  <div className="flex justify-between items-start mb-8 border-b border-black pb-6">
                    <div>
                      <h3 className="text-2xl font-serif italic">Investigation Log Entry</h3>
                      <p className="text-[10px] font-mono uppercase opacity-50 mt-1">ID: {editingResearchPoint.id}</p>
                    </div>
                    <button onClick={() => setEditingResearchPoint(null)} className="p-2 hover:bg-black/5"><X className="w-5 h-5" /></button>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="text-[10px] font-mono uppercase font-bold block mb-2">Entry Name / Target</label>
                      <input 
                        type="text" 
                        value={editingResearchPoint.name}
                        onChange={(e) => setEditingResearchPoint({...editingResearchPoint, name: e.target.value})}
                        className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        placeholder="e.g. CIA Record Group 263"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Type</label>
                        <select 
                          value={editingResearchPoint.type}
                          onChange={(e) => setEditingResearchPoint({...editingResearchPoint, type: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none"
                        >
                          <option value="Institution">Institution</option>
                          <option value="Person">Person</option>
                          <option value="Location">Location</option>
                          <option value="Record Group">Record Group</option>
                          <option value="Pattern">Pattern</option>
                          <option value="Financial">Financial</option>
                          <option value="Policy">Policy</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Status</label>
                        <select 
                          value={editingResearchPoint.status}
                          onChange={(e) => setEditingResearchPoint({...editingResearchPoint, status: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none"
                        >
                          <option value="Pending">Pending</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                          <option value="Blocked">Blocked</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase font-bold block mb-2">Priority</label>
                        <select 
                          value={editingResearchPoint.priority}
                          onChange={(e) => setEditingResearchPoint({...editingResearchPoint, priority: e.target.value as any})}
                          className="w-full border border-black p-3 font-sans text-sm focus:outline-none"
                        >
                          <option value="High">High</option>
                          <option value="Medium">Medium</option>
                          <option value="Low">Low</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-mono uppercase font-bold block mb-2">Explanation / Context</label>
                      <textarea 
                        rows={3}
                        value={editingResearchPoint.explanation || ''}
                        onChange={(e) => setEditingResearchPoint({...editingResearchPoint, explanation: e.target.value})}
                        className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                        placeholder="Why is this point being investigated?"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-mono uppercase font-bold block mb-2">Verification Needs</label>
                      <input 
                        type="text" 
                        value={editingResearchPoint.verification_needs || ''}
                        onChange={(e) => setEditingResearchPoint({...editingResearchPoint, verification_needs: e.target.value})}
                        className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black"
                        placeholder="e.g. Requires cross-referencing with NARA inventory"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-mono uppercase font-bold block mb-2">Notes</label>
                      <textarea 
                        rows={4}
                        value={editingResearchPoint.notes || ''}
                        onChange={(e) => setEditingResearchPoint({...editingResearchPoint, notes: e.target.value})}
                        className="w-full border border-black p-3 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none"
                        placeholder="General research notes..."
                      />
                    </div>
                  </div>

                  <div className="mt-12 flex gap-4">
                    <button 
                      onClick={() => saveResearchPoint(editingResearchPoint)}
                      className="flex-1 bg-black text-white py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/90 transition-all"
                    >
                      Save Entry
                    </button>
                    <button 
                      onClick={() => setEditingResearchPoint(null)}
                      className="flex-1 border border-black py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/5 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              </div>
            )}

            {/* Clear Session Confirmation Modal */}
            {showClearConfirm && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white border-2 border-black w-full max-w-md p-8 shadow-[16px_16px_0px_0px_rgba(0,0,0,1)]"
                >
                  <h3 className="text-2xl font-serif italic mb-4 flex items-center gap-2">
                    <AlertTriangle className="text-red-600" />
                    Clear Research?
                  </h3>
                  <p className="text-sm opacity-70 mb-8 leading-relaxed">
                    This will permanently delete all evidence records, chat logs, FOIA requests, and investigation points in this session. This action cannot be undone.
                  </p>
                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={handleClearSession}
                      className="w-full bg-red-600 text-white py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-red-700 transition-all"
                    >
                      Delete Everything
                    </button>
                    <button 
                      onClick={() => setShowClearConfirm(false)}
                      className="w-full border border-black py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/5 transition-all"
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
            <MessageSquare className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Chat</span>
          </button>
          <button 
            onClick={() => setActiveTab('timeline')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'timeline' ? "text-black" : "text-black/30")}
          >
            <Calendar className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Timeline</span>
          </button>
          <button 
            onClick={() => setActiveTab('suggestions')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'suggestions' ? "text-black" : "text-black/30")}
          >
            <Sparkles className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">AI</span>
          </button>
          <button 
            onClick={() => setActiveTab('requests')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'requests' ? "text-black" : "text-black/30")}
          >
            <Mail className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">FOIA</span>
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={cn("flex flex-col items-center gap-1 transition-all", activeTab === 'settings' ? "text-black" : "text-black/30")}
          >
            <Settings className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase font-bold">Settings</span>
          </button>
        </nav>
      )}

      {/* New Investigation Modal */}
      <AnimatePresence>
        {showNewInvestigationModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border-2 border-black p-8 max-w-md w-full shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-serif italic">New Investigation</h2>
                <button onClick={() => setShowNewInvestigationModal(false)} className="p-2 hover:bg-stone-100 transition-all rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono uppercase font-bold mb-2 opacity-40">Investigation Title</label>
                  <input 
                    type="text"
                    autoFocus
                    value={newInvestigationTitle}
                    onChange={(e) => setNewInvestigationTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newInvestigationTitle) {
                        createNewInvestigation(newInvestigationTitle);
                        setShowNewInvestigationModal(false);
                      }
                    }}
                    placeholder="e.g. Institutional Map 2025"
                    className="w-full bg-stone-50 border border-black/10 p-3 text-sm focus:outline-none focus:border-black transition-all"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowNewInvestigationModal(false)}
                    className="flex-1 border border-black p-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-stone-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      if (newInvestigationTitle) {
                        createNewInvestigation(newInvestigationTitle);
                        setShowNewInvestigationModal(false);
                      }
                    }}
                    disabled={!newInvestigationTitle}
                    className="flex-1 bg-black text-white p-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Rename Modal */}
      <AnimatePresence>
        {showRenameModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border-2 border-black p-8 max-w-md w-full shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-serif italic">Rename Investigation</h2>
                <button onClick={() => setShowRenameModal(null)} className="p-2 hover:bg-stone-100 transition-all rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono uppercase font-bold mb-2 opacity-40">New Title</label>
                  <input 
                    type="text"
                    autoFocus
                    value={renameTitle}
                    onChange={(e) => setRenameTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && renameTitle) {
                        renameInvestigation(showRenameModal.id, renameTitle);
                        setShowRenameModal(null);
                      }
                    }}
                    className="w-full bg-stone-50 border border-black/10 p-3 text-sm focus:outline-none focus:border-black transition-all"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowRenameModal(null)}
                    className="flex-1 border border-black p-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-stone-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      if (renameTitle) {
                        renameInvestigation(showRenameModal.id, renameTitle);
                        setShowRenameModal(null);
                      }
                    }}
                    disabled={!renameTitle}
                    className="flex-1 bg-black text-white p-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border-2 border-black p-8 max-w-md w-full shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-serif italic text-red-600">Delete Investigation</h2>
                <button onClick={() => setShowDeleteConfirm(null)} className="p-2 hover:bg-stone-100 transition-all rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm opacity-60 mb-8 leading-relaxed">
                Are you sure you want to delete <strong>"{showDeleteConfirm.title}"</strong>? This action cannot be undone and all data associated with this local investigation will be lost.
              </p>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDeleteConfirm(null)}
                  className="flex-1 border border-black p-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-stone-50 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    const localInvs = safeJsonParse(safeStorage.getItem('oden_local_investigations'), []);
                    const updatedInvs = localInvs.filter((i: any) => i.id !== showDeleteConfirm.id);
                    safeStorage.setItem('oden_local_investigations', JSON.stringify(updatedInvs));
                    setInvestigations(updatedInvs);
                    if (currentInvestigationId === showDeleteConfirm.id) {
                      setCurrentInvestigationId(updatedInvs[0]?.id || null);
                    }
                    setShowDeleteConfirm(null);
                  }}
                  className="flex-1 bg-red-600 text-white p-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-red-700 transition-all"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Share Modal */}
      <AnimatePresence>
        {showShareModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border-2 border-black p-8 max-w-md w-full shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-serif italic">Share Investigation</h2>
                <button onClick={() => setShowShareModal(false)} className="p-2 hover:bg-stone-100 transition-all rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm opacity-60 mb-6 leading-relaxed">
                Invite collaborators to this investigation. They will be able to view and edit all data in real-time.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono uppercase font-bold mb-2 opacity-40">Collaborator Email</label>
                  <div className="flex gap-2">
                    <input 
                      type="email"
                      value={shareEmail}
                      onChange={(e) => setShareEmail(e.target.value)}
                      placeholder="partner@example.com"
                      className="flex-1 bg-stone-50 border border-black/10 p-3 text-sm focus:outline-none focus:border-black transition-all"
                    />
                    <button 
                      onClick={() => shareInvestigation(shareEmail)}
                      disabled={isSharing || !shareEmail}
                      className="bg-black text-white px-6 py-3 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all disabled:opacity-50"
                    >
                      {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Invite"}
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-stone-100">
                  <h3 className="text-[10px] font-mono uppercase font-bold mb-3 opacity-40">Current Access</h3>
                  <div className="space-y-2">
                    {investigations.find(i => i.id === currentInvestigationId)?.collaboratorEmails?.map(email => (
                      <div key={email} className="flex items-center justify-between text-sm">
                        <span className="opacity-80">{email}</span>
                        {email === user?.email ? (
                          <span className="text-[8px] font-mono uppercase opacity-40 bg-stone-100 px-2 py-1">Owner</span>
                        ) : (
                          <button 
                            onClick={async () => {
                              if (!currentInvestigationId || quotaExceeded) return;
                              await updateDoc(doc(db, 'investigations', currentInvestigationId), {
                                collaboratorEmails: arrayRemove(email)
                              });
                            }}
                            className="text-red-600 hover:underline text-[10px] font-mono uppercase"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <StrategistFeed 
        feed={strategistFeed} 
        onConsult={(item) => {
          setActiveTab('chat');
          handleChat(`I am consulting you on this discovery: "${item.content}". What are the structural implications?`);
        }} 
      />
    </div>
  );
}

function StrategistFeed({ feed, onConsult }: { feed: any[], onConsult: (item: any) => void }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={cn(
      "fixed bottom-20 md:bottom-6 right-6 z-50 transition-all duration-500",
      isOpen ? "w-80" : "w-12"
    )}>
      <div className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden flex flex-col max-h-[400px]">
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="bg-black text-white p-3 flex items-center justify-between hover:bg-black/90 transition-all"
        >
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            {isOpen && <span className="text-[10px] font-mono uppercase font-bold tracking-widest">Strategist Feed</span>}
          </div>
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        
        {isOpen && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
            {feed.length === 0 ? (
              <p className="text-[10px] font-mono opacity-40 italic text-center py-8">No background discoveries yet.</p>
            ) : (
              feed.map(item => (
                <div key={item.id} className="border-l-2 border-purple-600 pl-3 py-1">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[8px] font-mono uppercase text-purple-600 font-bold">{item.type}</span>
                    <span className="text-[7px] font-mono opacity-30">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-[10px] leading-relaxed mb-2">{item.content}</p>
                  <button 
                    onClick={() => onConsult(item)}
                    className="text-[8px] font-mono uppercase underline hover:text-purple-600 transition-all"
                  >
                    Consult Strategist →
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineView({ records, onSelectRecord }: { records: EvidenceRecord[], onSelectRecord: (r: EvidenceRecord) => void }) {
  const timelineRecords = records
    .filter(r => r.timeline_date)
    .sort((a, b) => new Date(a.timeline_date!).getTime() - new Date(b.timeline_date!).getTime());

  if (timelineRecords.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-stone-50">
        <Calendar className="w-12 h-12 opacity-20 mb-4" />
        <h3 className="text-xl font-serif italic mb-2">No Temporal Data Found.</h3>
        <p className="text-sm opacity-60 max-w-md leading-relaxed">
          The current dossier does not contain records with verified dates. Use the Chat to identify specific dates for your evidence.
        </p>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full overflow-y-auto bg-stone-50 p-6 md:p-12"
    >
      <div className="max-w-4xl mx-auto">
        <div className="mb-12 border-b border-black pb-8">
          <h2 className="text-4xl font-serif italic mb-2">Research Timeline</h2>
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">Chronological Reconstruction of Institutional Activity</p>
        </div>

        <div className="relative border-l-2 border-black ml-2 md:ml-32 pl-8 md:pl-12 space-y-16 pb-24">
          {timelineRecords.map((record, index) => {
            const isAnomaly = record.status === 'gap' || record.classification === 'contested';
            return (
              <div key={record.record_id} className="relative group">
                {/* Timeline Dot */}
                <div className={cn(
                  "absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-black transition-all group-hover:scale-125 z-10",
                  isAnomaly ? "bg-red-600 animate-pulse" : "bg-white"
                )} />
                
                {/* Date Label */}
                <div className="md:absolute md:-left-[160px] md:top-0 md:w-32 md:text-right mb-2 md:mb-0">
                  <span className="text-[10px] font-mono uppercase font-bold tracking-tighter opacity-40">
                    {new Date(record.timeline_date!).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                </div>

                <motion.div 
                  whileHover={{ x: 4 }}
                  onClick={() => onSelectRecord(record)}
                  className={cn(
                    "p-6 border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all cursor-pointer",
                    isAnomaly && "border-red-600 bg-red-50/30"
                  )}
                >
                  <div className="flex justify-between items-start mb-4">
                    <StatusBadge status={record.status} />
                    <span className="text-[9px] font-mono uppercase opacity-40">{record.record_type}</span>
                  </div>
                  <h4 className="font-serif italic text-xl mb-2">{record.label || 'Evidence Record'}</h4>
                  <p className="text-xs opacity-70 leading-relaxed line-clamp-2 mb-4">{record.description}</p>
                  
                  {isAnomaly && (
                    <div className="flex items-center gap-2 text-[9px] font-mono uppercase text-red-600 font-bold">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Anomaly Detected: {record.status === 'gap' ? 'Archival Gap' : 'Contested Record'}</span>
                    </div>
                  )}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
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

function SettingsView({ 
  aiConnected, 
  setAiConnected,
  naraApiKey, 
  setNaraApiKey,
  searchNara,
  user,
  signIn,
  signOut,
  investigations,
  currentInvestigationId,
  setCurrentInvestigationId,
  createNewInvestigation,
  renameInvestigation,
  setInvestigations,
  setShowNewInvestigationModal,
  setNewInvestigationTitle,
  setShowRenameModal,
  setRenameTitle,
  setShowDeleteConfirm,
  handleFirestoreError,
  quotaExceeded,
  setQuotaExceeded,
  apiKeySource,
  customGeminiKey,
  setCustomGeminiKey,
  bypassPlatformKey,
  setBypassPlatformKey,
  customFirebaseConfig,
  setCustomFirebaseConfig
}: { 
  aiConnected: boolean, 
  setAiConnected: (val: boolean) => void,
  naraApiKey: string, 
  setNaraApiKey: (val: string) => void,
  searchNara: (query: string) => Promise<any>,
  user: User | null,
  signIn: () => Promise<void>,
  signOut: () => Promise<void>,
  investigations: Investigation[],
  currentInvestigationId: string | null,
  setCurrentInvestigationId: (id: string | null) => void,
  createNewInvestigation: (title: string) => Promise<void>,
  renameInvestigation: (id: string, title: string) => Promise<void>,
  setInvestigations: (invs: Investigation[]) => void,
  setShowNewInvestigationModal: (val: boolean) => void,
  setNewInvestigationTitle: (val: string) => void,
  setShowRenameModal: (val: { id: string, title: string } | null) => void,
  setRenameTitle: (val: string) => void,
  setShowDeleteConfirm: (val: { id: string, title: string } | null) => void,
  handleFirestoreError: (error: unknown, operationType: OperationType, path: string | null) => void,
  quotaExceeded: boolean,
  setQuotaExceeded: (val: boolean) => void,
  apiKeySource: 'none' | 'custom' | 'platform' | 'managed',
  customGeminiKey: string,
  setCustomGeminiKey: (val: string) => void,
  bypassPlatformKey: boolean,
  setBypassPlatformKey: (val: boolean) => void,
  customFirebaseConfig: string,
  setCustomFirebaseConfig: (val: string) => void
}) {
  const [showNaraKey, setShowNaraKey] = useState(false);
  const [naraTestStatus, setNaraTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [geminiTestStatus, setGeminiTestStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const testGeminiKey = async () => {
    if (!customGeminiKey) return;
    setIsTestingGemini(true);
    setGeminiTestStatus('idle');
    try {
      const genAI = new GoogleGenAI({ apiKey: customGeminiKey });
      await genAI.models.generateContent({ 
        model: "gemini-3-flash-preview",
        contents: "test" 
      });
      setGeminiTestStatus('success');
      setTimeout(() => setGeminiTestStatus('idle'), 3000);
    } catch (err) {
      console.error("Gemini Test Error:", err);
      setGeminiTestStatus('error');
      setTimeout(() => setGeminiTestStatus('idle'), 3000);
    } finally {
      setIsTestingGemini(false);
    }
  };

  const handleConnectAI = async () => {
    if (window.aistudio?.openSelectKey) {
      try {
        await window.aistudio.openSelectKey();
        setAiConnected(true);
        setBypassPlatformKey(false);
      } catch (err) {
        console.error("Failed to open key selection:", err);
      }
    } else {
      console.warn("AI Studio key selection not available in this environment.");
      setAiConnected(true);
    }
  };

  const applyFirebaseConfig = () => {
    if (!customFirebaseConfig) return;
    try {
      JSON.parse(customFirebaseConfig); // Validate JSON
      safeStorage.setItem('oden_custom_firebase_config', customFirebaseConfig);
      window.location.reload();
    } catch (e) {
      alert("Invalid JSON configuration. Please check your Firebase config format.");
    }
  };

  const testNara = async () => {
    if (!naraApiKey) return;
    setNaraTestStatus('testing');
    const result = await searchNara('test');
    if (result && !result.error) {
      setNaraTestStatus('success');
      setTimeout(() => setNaraTestStatus('idle'), 3000);
    } else {
      setNaraTestStatus('error');
      setTimeout(() => setNaraTestStatus('idle'), 3000);
    }
  };

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (hasKey) setAiConnected(true);
      }
    };
    checkKey();
  }, [setAiConnected]);

  useEffect(() => {
    if (quotaExceeded) {
      disableNetwork(db).catch(err => console.error("Failed to disable network:", err));
    }
  }, [quotaExceeded]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full overflow-y-auto bg-stone-50 p-6 md:p-12"
    >
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="mb-12 border-b border-black pb-8">
          <h2 className="text-4xl font-serif italic mb-2">System Settings</h2>
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-50">API Configuration & External Connections</p>
        </div>

        {/* Project Status */}
        {quotaExceeded && (
          <section className="p-8 border border-red-600 bg-red-50 shadow-[8px_8px_0px_0px_rgba(220,38,38,1)]">
            <div className="flex items-center gap-3 mb-4 text-red-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-xl font-serif italic">Firestore Quota Exceeded</h3>
            </div>
            <p className="text-sm text-red-800 leading-relaxed mb-6">
              The shared Firebase project has reached its daily write limit. ODEN is currently in <strong>Local Mode</strong>. 
              Your changes are being saved to your browser, but they won't sync to the cloud until the quota resets at UTC midnight.
            </p>
            <div className="bg-white/50 p-4 border border-red-200 rounded">
              <p className="text-[10px] font-mono uppercase font-bold text-red-900 mb-2">Solution:</p>
              <p className="text-xs text-red-800">
                To bypass this, you can connect your own Firebase project in the <strong>Custom Infrastructure</strong> section below. 
                This will give you your own private database with its own free-tier limits.
              </p>
            </div>
          </section>
        )}

        {/* Network & Sync Mode */}
        <section className="p-8 border border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5" />
              <h3 className="text-xl font-serif italic">Network & Sync Mode</h3>
            </div>
            <button 
              onClick={() => {
                if (quotaExceeded) {
                  setQuotaExceeded(false);
                  enableNetwork(db).catch(err => console.error("Failed to enable network:", err));
                } else {
                  setQuotaExceeded(true);
                  disableNetwork(db).catch(err => console.error("Failed to disable network:", err));
                }
              }}
              className={cn(
                "px-6 py-2 text-[10px] font-mono uppercase font-bold border transition-all",
                quotaExceeded ? "bg-amber-500 text-white border-amber-500" : "border-black hover:bg-black hover:text-white"
              )}
            >
              {quotaExceeded ? "Local Mode Active" : "Cloud Sync Active"}
            </button>
          </div>
          <p className="mt-4 text-sm opacity-70 leading-relaxed">
            {quotaExceeded 
              ? "ODEN is currently disconnected from the cloud. Changes are saved locally. Enable Cloud Sync to attempt reconnection."
              : "ODEN is syncing with the cloud. If you experience quota errors, you can manually switch to Local Mode to stop network requests."}
          </p>
        </section>

        {/* Cloud Account */}
        <section className="p-8 border border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className={cn("w-3 h-3 rounded-full", user ? "bg-emerald-500" : "bg-amber-500")} />
              <h3 className="text-xl font-serif italic">Cloud Account & Sync</h3>
            </div>
            <span className={cn(
              "text-[9px] font-mono uppercase px-2 py-1 border",
              customFirebaseConfig ? "bg-purple-50 text-purple-700 border-purple-200" : (user ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200")
            )}>
              {customFirebaseConfig ? "Custom Project Active" : (user ? "Cloud Sync Active" : "Local Storage Only")}
            </span>
          </div>

            {user ? (
              <div className="space-y-6 mb-8">
                <div className="flex items-center gap-4 p-4 bg-stone-50 border border-black/10">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" className="w-12 h-12 rounded-full border border-black/10" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-stone-200 flex items-center justify-center border border-black/10">
                      <Users className="w-6 h-6 opacity-40" />
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-bold">{user.displayName || 'Investigator'}</p>
                    <p className="text-xs opacity-60">{user.email}</p>
                  </div>
                </div>
                
                <button 
                  onClick={signOut}
                  className="w-full border border-red-600 text-red-600 py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-red-50 transition-all flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out of Cloud
                </button>
              </div>
            ) : (
              <div className="space-y-6 mb-8">
                <p className="text-sm opacity-70 leading-relaxed">
                  You are currently using ODEN in <strong>Guest Mode</strong>. Your data is stored locally in this browser. 
                  Sign in to enable encrypted cloud backups and multi-device synchronization.
                </p>

                <button 
                  onClick={signIn}
                  className="w-full bg-black text-white py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In with Google
                </button>
              </div>
            )}

            <div className="space-y-4 pt-8 border-t border-black/10">
              <h4 className="text-[10px] font-mono uppercase font-bold opacity-40">My Research Investigations</h4>
              <div className="grid gap-2">
                {investigations.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between p-4 border border-black/5 hover:border-black transition-all bg-stone-50/50 group">
                    <div className="flex items-center gap-3">
                      <FolderOpen className="w-4 h-4 opacity-40" />
                      <div>
                        <p className="text-sm font-bold">{inv.title}</p>
                        <p className="text-[8px] font-mono uppercase opacity-40">
                          {inv.id.startsWith('local-') ? "Local Storage" : (inv.ownerId === user?.uid ? "Owner" : "Collaborator")} 
                          {!inv.id.startsWith('local-') && ` • ${inv.collaboratorEmails?.length || 0} Shared`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(user && inv.ownerId === user.uid || inv.id.startsWith('local-')) && (
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => {
                              setRenameTitle(inv.title);
                              setShowRenameModal({ id: inv.id, title: inv.title });
                            }}
                            className="p-2 border border-black/10 hover:border-black transition-all opacity-0 group-hover:opacity-100"
                            title="Rename"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          {inv.id.startsWith('local-') && investigations.length > 1 && (
                            <button 
                              onClick={() => {
                                setShowDeleteConfirm({ id: inv.id, title: inv.title });
                              }}
                              className="p-2 border border-red-600/10 text-red-600 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                              title="Delete Local"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                      <button 
                        onClick={() => setCurrentInvestigationId(inv.id)}
                        className={cn(
                          "px-4 py-2 text-[9px] font-mono uppercase font-bold border transition-all",
                          currentInvestigationId === inv.id 
                            ? "bg-black text-white border-black" 
                            : "border-black/20 hover:border-black"
                        )}
                      >
                        {currentInvestigationId === inv.id ? "Active" : "Switch To"}
                      </button>
                    </div>
                  </div>
                ))}
                <button 
                  onClick={() => {
                    setNewInvestigationTitle("");
                    setShowNewInvestigationModal(true);
                  }}
                  className="flex items-center justify-center gap-2 p-4 border border-dashed border-black/20 hover:border-black transition-all text-[10px] font-mono uppercase opacity-60 hover:opacity-100"
                >
                  <Plus className="w-4 h-4" />
                  {user ? "New Investigation" : "Reset Local Session (New Title)"}
                </button>
              </div>
            </div>

            {/* Active Investigation Collaborators */}
            {user && currentInvestigationId && !currentInvestigationId.startsWith('local-') && (
              <div className="space-y-4 pt-8 border-t border-black/10">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-mono uppercase font-bold opacity-40">Active Investigation Collaborators</h4>
                  <div className="flex items-center gap-1">
                    <Users className="w-3 h-3 opacity-40" />
                    <span className="text-[8px] font-mono uppercase opacity-40">
                      {investigations.find(i => i.id === currentInvestigationId)?.collaboratorEmails?.length || 0} Total
                    </span>
                  </div>
                </div>
                
                <div className="grid gap-2">
                  {investigations.find(i => i.id === currentInvestigationId)?.collaboratorEmails?.map(email => {
                    const isOwner = investigations.find(i => i.id === currentInvestigationId)?.ownerId === user.uid;
                    const isMe = email === user.email;
                    
                    return (
                      <div key={email} className="flex items-center justify-between p-4 border border-black/5 bg-stone-50/50">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center border border-black/10">
                            <Users className="w-4 h-4 opacity-40" />
                          </div>
                          <div>
                            <p className="text-sm font-bold">{email}</p>
                            <p className="text-[8px] font-mono uppercase opacity-40">
                              {isMe ? "You" : "Collaborator"}
                            </p>
                          </div>
                        </div>
                        
                        {isOwner && !isMe && (
                          <button 
                            onClick={async () => {
                              if (quotaExceeded) return;
                              try {
                                await updateDoc(doc(db, 'investigations', currentInvestigationId), {
                                  collaboratorEmails: arrayRemove(email)
                                });
                              } catch (err) {
                                handleFirestoreError(err, OperationType.UPDATE, `investigations/${currentInvestigationId}`);
                              }
                            }}
                            className="p-2 text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all flex items-center gap-2 text-[9px] font-mono uppercase font-bold"
                            title="Remove Collaborator"
                          >
                            <X className="w-3 h-3" />
                            Kick
                          </button>
                        )}
                      </div>
                    );
                  })}
                  
                  {(!investigations.find(i => i.id === currentInvestigationId)?.collaboratorEmails || investigations.find(i => i.id === currentInvestigationId)?.collaboratorEmails?.length === 0) && (
                    <div className="p-8 text-center border border-dashed border-black/10 opacity-30">
                      <p className="text-[10px] font-mono uppercase">No collaborators added to this investigation.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
        </section>

        {/* AI Connection */}
        <section className="p-8 border border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className={cn("w-3 h-3 rounded-full", apiKeySource !== 'none' ? "bg-green-500 animate-pulse" : "bg-blue-500")} />
              <h3 className="text-xl font-serif italic">AI Research Engine (Gemini)</h3>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={cn(
                "text-[9px] font-mono uppercase px-2 py-1 border",
                apiKeySource !== 'none' ? "bg-green-50 text-green-700 border-green-200" : "bg-blue-50 text-blue-700 border-blue-200"
              )}>
                {apiKeySource === 'custom' ? "Custom Key Active" : 
                 apiKeySource === 'platform' ? "Platform Secret Active" :
                 apiKeySource === 'managed' ? "Managed Free Tier Active" : "No Engine Connected"}
              </span>
            </div>
          </div>
          
          <p className="text-sm opacity-70 leading-relaxed mb-8">
            The AI Research Engine powers the deep-dive analysis, pattern recognition, and automated dossier building. 
            {bypassPlatformKey && (
              <span className="block mt-2 p-2 bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs">
                <strong>Safety Active:</strong> Your paid sidebar secret is currently disconnected. The app is only using the free keys you provide below.
              </span>
            )}
          </p>

          <div className="bg-stone-50 p-6 border border-black/10 mb-8">
            <h4 className="text-[10px] font-mono uppercase font-bold mb-2 flex items-center gap-2">
              <Info className="w-3 h-3" /> Optional: Use Your Own Key
            </h4>
            <p className="text-xs opacity-60 leading-relaxed">
              If you run out of "free tokens" or want faster, private processing, you can connect your own API key. 
              This is strictly an <strong>extra option</strong> for power users and researchers with high-volume data needs.
            </p>
          </div>

          <button 
            onClick={handleConnectAI}
            className="w-full bg-black text-white py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {aiConnected ? "Reconnect AI Engine" : "Connect AI Engine"}
          </button>
        </section>

        {/* Custom Infrastructure */}
        <section className="p-4 sm:p-8 border border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-center gap-3 mb-8">
            <Zap className="w-5 h-5" />
            <h3 className="text-xl font-serif italic">Custom Infrastructure</h3>
          </div>

          <div className="space-y-8">
            {/* Custom Gemini Key */}
            <div>
              <label className="block text-[10px] font-mono uppercase font-bold mb-2 opacity-40">Custom Gemini API Key</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input 
                  type="password"
                  value={customGeminiKey}
                  onChange={(e) => setCustomGeminiKey(e.target.value)}
                  placeholder="Paste your Gemini API Key..."
                  className="flex-1 bg-stone-50 border border-black/10 p-3 text-sm focus:outline-none focus:border-black transition-all"
                />
                <div className="flex gap-2">
                  <button 
                    onClick={testGeminiKey}
                    disabled={isTestingGemini || !customGeminiKey}
                    className={cn(
                      "flex-1 sm:flex-none px-4 sm:px-6 py-3 border border-black text-[10px] font-mono uppercase font-bold tracking-widest transition-all disabled:opacity-50 min-w-[60px] sm:min-w-[80px]",
                      geminiTestStatus === 'success' ? "bg-emerald-500 text-white border-emerald-500" : 
                      geminiTestStatus === 'error' ? "bg-red-500 text-white border-red-500" : "hover:bg-stone-50"
                    )}
                  >
                    {isTestingGemini ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 
                     geminiTestStatus === 'success' ? <Check className="w-4 h-4 mx-auto" /> :
                     geminiTestStatus === 'error' ? <X className="w-4 h-4 mx-auto" /> : "Test Key"}
                  </button>
                  {customGeminiKey && (
                    <button 
                      onClick={() => {
                        setCustomGeminiKey('');
                        safeStorage.removeItem('oden_custom_gemini_key');
                        window.location.reload();
                      }}
                      className="px-4 py-3 border border-red-600 text-red-600 text-[10px] font-mono uppercase font-bold hover:bg-red-50 transition-all"
                    >
                      Clear & Reset
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-[10px] opacity-40 leading-relaxed">
                Overrides the default environment key. To use the <strong>Free Tier</strong> provided by the platform, ensure this field is empty. Get a key at <a href="https://aistudio.google.com/app/apikey" target="_blank" className="underline">aistudio.google.com</a>.
              </p>
            </div>

            {/* Safety Mode: Disconnect Paid Key */}
            <div className="flex items-center justify-between p-4 bg-red-50 border border-red-200">
              <div>
                <h4 className="text-[10px] font-mono uppercase font-bold text-red-700">Safety Mode: Disconnect Paid Key</h4>
                <p className="text-[10px] text-red-600/80">Ensures the app NEVER uses the secret key in your sidebar. Use this to protect your paid account.</p>
              </div>
              <button 
                onClick={() => setBypassPlatformKey(!bypassPlatformKey)}
                className={cn(
                  "px-4 py-2 text-[9px] font-mono uppercase font-bold border transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]",
                  bypassPlatformKey ? "bg-red-600 text-white border-red-600" : "bg-white border-black hover:bg-stone-100"
                )}
              >
                {bypassPlatformKey ? "Safety Active (Paid Key Disconnected)" : "Safety Inactive (Paid Key Connected)"}
              </button>
            </div>

            {/* Custom Firebase Config */}
            <div>
              <label className="block text-[10px] font-mono uppercase font-bold mb-2 opacity-40">Custom Firebase Configuration (JSON)</label>
              <textarea 
                value={customFirebaseConfig}
                onChange={(e) => setCustomFirebaseConfig(e.target.value)}
                placeholder='{ "apiKey": "...", "authDomain": "...", ... }'
                className="w-full h-32 bg-stone-50 border border-black/10 p-3 text-[10px] font-mono focus:outline-none focus:border-black transition-all mb-3"
              />
              <div className="flex flex-col sm:flex-row gap-3">
                <button 
                  onClick={applyFirebaseConfig}
                  disabled={!customFirebaseConfig}
                  className="flex-1 bg-black text-white py-4 text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-black/80 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Apply & Refresh
                </button>
                <button 
                  onClick={() => {
                    safeStorage.removeItem('oden_custom_firebase_config');
                    window.location.reload();
                  }}
                  className="w-full sm:w-auto px-6 py-4 border border-black text-[10px] font-mono uppercase font-bold tracking-widest hover:bg-stone-50 transition-all"
                >
                  Reset to Default
                </button>
              </div>
              <p className="mt-2 text-[10px] opacity-40 leading-relaxed">
                Connect ODEN to your own Firebase project. This is required if the shared project hits its free-tier Firestore quota.
              </p>
            </div>
          </div>
        </section>

        {/* NARA Connection */}
        <section className="p-4 sm:p-8 border border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className={cn("w-3 h-3 rounded-full", naraApiKey ? "bg-green-500" : "bg-stone-300")} />
              <h3 className="text-xl font-serif italic">National Archives (NARA) API</h3>
            </div>
            <span className={cn(
              "text-[9px] font-mono uppercase px-2 py-1 border",
              naraApiKey ? "bg-green-50 text-green-700 border-green-200" : "bg-stone-50 text-stone-700 border-stone-200"
            )}>
              {naraApiKey ? "Key Active" : "No Key Found"}
            </span>
          </div>

          <p className="text-sm opacity-70 leading-relaxed mb-8">
            Connecting to the National Archives API allows ODEN to pull official finding aids, Record Group descriptions, and digital file metadata directly from the source.
          </p>

          <div className="space-y-4 mb-8">
            <div className="relative">
              <label className="text-[9px] font-mono uppercase opacity-50 mb-1 block">NARA API Key</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <input 
                    type={showNaraKey ? "text" : "password"}
                    value={naraApiKey}
                    onChange={(e) => {
                      setNaraApiKey(e.target.value);
                      setNaraTestStatus('idle');
                    }}
                    placeholder="Enter your NARA API key..."
                    className="w-full bg-stone-50 border border-black/20 p-4 text-xs font-mono focus:outline-none focus:border-black transition-all pr-12"
                  />
                  <button 
                    onClick={() => setShowNaraKey(!showNaraKey)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 hover:opacity-100 transition-all"
                  >
                    {showNaraKey ? <X className="w-4 h-4" /> : <HelpCircle className="w-4 h-4" />}
                  </button>
                </div>
                <button 
                  onClick={testNara}
                  disabled={!naraApiKey || naraTestStatus === 'testing'}
                  className={cn(
                    "w-full sm:w-auto px-4 sm:px-6 py-4 sm:py-0 text-[10px] font-mono uppercase font-bold border border-black transition-all min-w-[60px] sm:min-w-[80px]",
                    naraTestStatus === 'success' ? "bg-green-500 text-white border-green-500" :
                    naraTestStatus === 'error' ? "bg-red-500 text-white border-red-500" :
                    "hover:bg-black hover:text-white"
                  )}
                >
                  {naraTestStatus === 'testing' ? "..." : 
                   naraTestStatus === 'success' ? "OK" : 
                   naraTestStatus === 'error' ? "Fail" : "Test Key"}
                </button>
              </div>
            </div>
            <p className="text-[10px] opacity-50 italic">
              Your key is stored locally in your browser and is never sent to our servers.
            </p>
          </div>

          <div className="bg-stone-50 p-6 border border-black/10">
            <h4 className="text-[10px] font-mono uppercase font-bold mb-2 flex items-center gap-2">
              <Building2 className="w-3 h-3" /> Why use a NARA Key?
            </h4>
            <p className="text-xs opacity-60 leading-relaxed">
              Without a key, the system relies on general web searches. With a key, the AI can "speak" directly to the National Archives database, 
              finding specific box numbers and folder titles that aren't indexed on the public web.
            </p>
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 text-[10px] font-mono text-blue-800">
              <p className="font-bold mb-1 uppercase">How to get a key:</p>
              <p>1. Visit the NARA API Help page.</p>
              <p>2. Register your email address to receive your unique API key.</p>
              <p>3. Paste the key in the field above.</p>
            </div>
            <a 
              href="https://www.archives.gov/research/catalog/help/api" 
              target="_blank" 
              rel="noreferrer"
              className="text-[10px] font-mono text-blue-600 hover:underline mt-4 inline-block"
            >
              Get a NARA API Key (Register via Email) →
            </a>
          </div>
        </section>

        {/* Security Note */}
        <div className="p-6 border border-dashed border-black/20 text-center">
          <Shield className="w-6 h-6 mx-auto mb-3 opacity-20" />
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-40">
            All research data and API keys are stored locally. ODEN does not maintain a central database of your investigations.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
