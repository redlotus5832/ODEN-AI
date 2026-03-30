# ODEN: Structural Discovery Engine for Archival Research
## Product Strategy & Methodology Document

### 1. Product Vision: The "Deductive Strategist"
ODEN is not a standard AI research tool. While most AI tools (Perplexity, ChatGPT) are **Surface-Level Aggregators** that summarize existing public information, ODEN is a **Targeting Package Generator**.

*   **The Goal:** To move from "Topic" to "Request."
*   **The Difference:** ODEN doesn't give you a "Book Report"; it gives you the **Institutional Footprint** (Record Groups, Entry Numbers, Accession IDs, and FOIA Officer contacts).

---

### 2. Core Methodology: "Mapping the Shadow"
ODEN operates on the principle that bureaucracies are predictable and leave consistent paper trails.

*   **Structural Anomalies:** If "Process A" occurred, "Record B" *must* have been created. If Record B is missing from the Dossier, it is flagged as a "Structural Absence" rather than just "missing info."
*   **Bridge Records:** The system automatically identifies entities (people, companies, locations) that appear across multiple independent research threads, connecting dots the user might miss.
*   **Assuming the Premise:** The AI is instructed to spend 100% of its energy finding the evidence that *should* exist if the user's theory is correct, rather than wasting time on generic skepticism.

---

### 3. Current Capabilities (v1.0)
*   **Discovery Engine:** A two-stage search process that hunts for institutional details across Google and the National Archives (NARA) Catalog.
*   **Deep Structural Analysis:** A dedicated reasoning mode that scans the entire Dossier for crossovers, evidence conflicts, and institutional gaps.
*   **Coordinated FOIA Generation:** Automatically drafts formal, archival-ready requests for multiple agencies simultaneously, ensuring consistent language and professional terminology.
*   **BYOK (Bring Your Own Key):** Optional integration for Gemini API and NARA API keys to bypass shared limits and enhance privacy.

---

### 4. Proposed Subscription Model: "The Sovereign Path"
A tiered structure built around **Data Sovereignty** and **Research Intensity**.

| Tier | API Source | Data Privacy | Key Features |
| :--- | :--- | :--- | :--- |
| **Free** | Shared Keys (Limited) | Local Only | Basic Search, 3 Deep Analyses/day, Manual FOIA drafting. |
| **Field Agent** | Shared Keys (High Limit) | Local + Encrypted Export | Unlimited Search, Full Structural Analysis, PDF Evidence Parsing. |
| **Specialist** | Shared Keys (Unlimited) | Opt-in Cloud Sync | Batch FOIA Generation, Institutional Mapping, "Bridge Record" Auto-Detection. |
| **Sovereign** | **User's Own Keys** | **Air-Gapped / Local** | Full feature set, zero data leaves their machine, custom NARA/Gemini endpoints. |

---

### 5. Privacy & Data Sovereignty Strategy
Privacy is the "North Star" of the ODEN system.

*   **Local-First Architecture:** Use **IndexedDB** for browser-based storage, keeping hundreds of megabytes of research data entirely on the user's hard drive.
*   **BYOK Privacy:** In the "Sovereign" tier, API calls are made directly from the user's browser to the provider (Google/NARA), bypassing the ODEN backend entirely.
*   **Encrypted .oden Files:** A custom, AES-256 encrypted file format for secure research sharing and local backups.

---

### 6. Future Roadmap
*   **Nexus Visualization:** A D3.js powered "Spider Web" map that visually connects Bridge Records and institutional overlaps.
*   **AI Redaction Tool:** Automatically identify and blur PII (Names, SSNs, Addresses) in uploaded evidence before sharing.
*   **FOIA Tracker:** A dashboard that monitors the 20-day statutory clock for every generated request and flags follow-up dates.
*   **Institutional Mapping:** A global database of agency structures to help the AI predict record locations with higher accuracy.

---
**ODEN v1.0 // Methodological Constraint Active**
*Document Generated: 2026-03-30*
