
export function normalizeInstitution(name: string = ''): string {
  const n = (name || '').toLowerCase().trim();
  if (n.includes('nara') || n.includes('national archives')) return 'National Archives and Records Administration (NARA)';
  if (n.includes('cia') || n.includes('central intelligence')) return 'Central Intelligence Agency (CIA)';
  if (n.includes('fbi') || n.includes('federal bureau')) return 'Federal Bureau of Investigation (FBI)';
  if (n.includes('state dept') || n.includes('department of state')) return 'U.S. Department of State';
  if (n.includes('dod') || n.includes('department of defense')) return 'U.S. Department of Defense';
  if (n.includes('loc') || n.includes('library of congress')) return 'Library of Congress (LOC)';
  if (n.includes('nysa') || n.includes('new york state archives')) return 'New York State Archives (NYSA)';
  if (n.includes('archives ontario')) return 'Archives of Ontario';
  if (n.includes('national archives uk') || n.includes('tna')) return 'The National Archives (UK)';
  return name || '';
}

export function generateFingerprint(institution: string = '', department: string = '', subject: string = ''): string {
  const normalized = normalizeInstitution(institution);
  const base = `${normalized}|${(department || '').toLowerCase().trim()}|${(subject || '').toLowerCase().trim()}`;
  // Simple hash for fingerprinting
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    const char = base.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}
