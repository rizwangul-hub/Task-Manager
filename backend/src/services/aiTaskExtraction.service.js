import mongoose from 'mongoose';
import { Project } from '../models/project.model.js';
import { logger } from '../utils/logger.js';

export const BUSINESS_CATEGORIES = [
  'PAK_PROPERTY',
  'PAK_FINANCE_EXPENSES',
  'UK_PROPERTY',
  'UK_PROPERTY_FINANCE',
  'UK_PROPERTY_MAINTENANCE_COMPLIANCE',
  'UK_BICYCLE_SHOPS',
  'ROTA_ATTENDANCE',
  'ROTA_SCHEDULING',
  'SOFTWARE_DEVELOPMENT',
  'IT_SUPPORT',
  'CLIENT_COMMUNICATION',
  'MANAGEMENT_REPORTING',
  'ADMINISTRATION',
  'OTHER_BUSINESS',
  'NEEDS_REVIEW'
];

export const PIXX_BUSINESS_CONTEXT = `# PIX X TECHNOLOGIEES — COMPLETE BUSINESS CONTEXT

1. COMPANY OVERVIEW:
PixxTechnologiees manages multiple business streams:
- Pakistani property management, rent, expenses, and financial data verification.
- UK property management, compliance, and client operations.
- UK bicycle shop operations and worker attendance through the Rota System.
- Internal software development, maintenance, automation, and IT infrastructure.
- Management oversight, employee coordination, and administrative reporting.
CRITICAL: Do not treat every message as belonging to the same department. Determine the relevant business, project, client, or system from the message content.

2. PAKISTANI PROPERTY BUSINESS AND EXPENSE MANAGEMENT:
- Operations: Pakistani property records, rent collection, general/unit expenses, cash/bank transactions, financial statements, duplicate expense corrections, staff payroll records, vouchers, and ledgers.
- Key Personnel:
  * Fahad Rasheed: Management oversight and business review.
  * Khurshid Anwar: Operations, administrative verification, and financial system management.
  * Sarfraz: Data-entry responsibilities in property finance workflow.
- Relevant Categories: PAK_PROPERTY, PAK_FINANCE_EXPENSES.
- Note: Never confuse Pakistani property records with UK property transactions.

3. UK PROPERTY BUSINESS AND CLIENT OPERATIONS:
- Known Property Companies / Projects:
  * OLD STREET
  * BEST STANDARD
  * SK HAMILTON
  * HOMEWARDS
  * MILE END ROAD LTD
  * GLOBAL STANDARD
- Operations: Property records, rent/mortgage transactions, financial ledgers, service charges, ground rent, insurance tracking, compliance certificates (gas safety, electrical safety, appliance warranties), document renewals, client inquiries, and maintenance follow-ups.
- Relevant Categories: UK_PROPERTY, UK_PROPERTY_FINANCE, UK_PROPERTY_MAINTENANCE_COMPLIANCE, CLIENT_COMMUNICATION.

4. UK BICYCLE SHOP OPERATIONS — ROTA SYSTEM:
- Known Bicycle Shops:
  * Station
  * Camden
  * Chelsea
  * Edgware
  * Southwark
  * Leebridge
- Operations: Worker attendance, shift coordination, weekly rota creation, worker allocation, checking missing attendance, managing availability/unavailability/half-days, reviewing late arrivals, and attendance reports (PDF/Excel).
- Rules: Attendance is separate from wages/payroll (never expose wages to workers); do not assign a worker to multiple shops on the same date.
- Relevant Categories: UK_BICYCLE_SHOPS, ROTA_ATTENDANCE, ROTA_SCHEDULING.

5. INTERNAL SOFTWARE DEVELOPMENT AND IT OPERATIONS:
- Known Systems: Property finance and expense tracker, UK property management system, Bicycle worker attendance and rota system, AI WhatsApp Task Manager, internal web & mobile applications (PWA/WebView), CCTV snapshot/photo verification, database, cloud hosting, APIs, and authentication.
- Operations: Bug fixes, UI improvements, API testing, database backups, WhatsApp integration fixes, deployment maintenance, and technical error investigations.
- Relevant Categories: SOFTWARE_DEVELOPMENT, IT_SUPPORT.
- Distinguish: "Fix expense tracker login" is SOFTWARE_DEVELOPMENT; "verify expense entries in tracker" is PAK_FINANCE_EXPENSES or UK_PROPERTY_FINANCE.

6. OFFICIAL COMPANY WORKERS & PERSONNEL DIRECTORY:
- Kamran (+44 7880 716972): Boss / Owner / Executive Authority. Direct instructions from Kamran carry highest priority.
- Fahad (+92 318 0442055): Manager. Responsible for management oversight, business reviews, operational reports, project progress, and team delegation.
- Khurshid (+92 345 9028996): Assistant Manager. Responsible for operations, administration, verifying financial records/vouchers, and property system management.
- Sarfraz (+92 300 8032901): Accountant. Responsible for property accounts, data-entry of rents/expenses, preparing ledgers, and financial reconciliation.
- Rizwan (+92 317 9500901): Software Developer. Responsible for web apps, task manager, mobile PWA, bug fixing, backend APIs, and technical maintenance.
- Usman (+92 336 4256874): CCTV. Responsible for CCTV monitoring, security review, footage checks, and photo identification.
- Adeel (+92 316 7196110): Office Boy / CCTV. Responsible for office support, physical tasks, and CCTV assistance.

7. LANGUAGE & LOCALIZATION (URDU / ROMAN URDU / ENGLISH):
Accurately interpret English, Urdu, and Roman Urdu instructions:
- "Fahad bhai, UK property ka report kal tak ready kar dein" -> Assignee: Fahad Rasheed, Category: UK_PROPERTY, DueDate: tomorrow.
- "Khurshid, Sarfraz ki October entries verify kar den" -> Assignee: Khurshid Anwar, Category: PAK_FINANCE_EXPENSES, Title: "Verify Sarfraz's October property expense entries".
- "Station shop ka next week rota bana do" -> Category: ROTA_SCHEDULING, Title: "Prepare next week rota for Station shop".
- "Expense tracker ka login kaam nahi kar raha, please fix karo" -> Category: SOFTWARE_DEVELOPMENT, Title: "Fix login issue in expense tracker".
- "Alhamdulillah, report complete ho gayi" -> Not a new task (it is an acknowledgement/status report).

8. OPERATIONAL CONSTRAINTS:
- TASK TRACKING ONLY: Creating a task draft NEVER executes financial transactions, modifies official attendance databases, or pays money. It creates a task draft for human tracking and review.
- ACCURACY: Never invent worker names, property names, financial amounts, or deadlines that are not in the message.
- AVOID FALSE POSITIVES: Mere mentions of names, greetings ("salam", "hi"), questions ("where are you"), or acknowledgements ("done", "ok") must strictly have isTask: false.`;

export function detectBusinessCategory(text, defaultCategory = 'NEEDS_REVIEW') {
  const lower = (text || '').toLowerCase();
  
  // Software Development / IT
  if (
    /\b(bug|fix|login|error|crash|api|database|mongodb|server|hosting|backup|deployment|code|feature|endpoint|decrypt|decryption|pwa|webview|ui|frontend|backend)\b/i.test(lower) ||
    lower.includes('expense tracker login') ||
    lower.includes('task manager') ||
    lower.includes('not working') ||
    lower.includes('kaam nahi kar raha')
  ) {
    if (/\b(it\s+support|access|password|permission|wifi)\b/i.test(lower)) {
      return 'IT_SUPPORT';
    }
    return 'SOFTWARE_DEVELOPMENT';
  }

  // Rota System / Bicycle Shops
  const isShop = /\b(station|camden|chelsea|edgware|southwark|leebridge|bicycle|shop)\b/i.test(lower);
  const isRota = /\b(rota|shift|schedule|shift\s+timing)\b/i.test(lower);
  const isAttendance = /\b(attendance|present|absent|late\s+arrival|late|overtime|time-in|time-out)\b/i.test(lower);

  if (isRota || (isShop && lower.includes('rota'))) {
    return 'ROTA_SCHEDULING';
  }
  if (isAttendance || (isShop && lower.includes('attendance'))) {
    return 'ROTA_ATTENDANCE';
  }
  if (isShop) {
    return 'UK_BICYCLE_SHOPS';
  }

  // UK Property
  const isUkCompany = /\b(old\s+street|best\s+standard|sk\s+hamilton|homewards|mile\s+end|global\s+standard|uk\s+property)\b/i.test(lower);
  const isUkCompliance = /\b(gas\s+safety|gas\s+cert|electrical\s+safety|epc|certificate|expiry|expire|renew|renewal|warranty|insurance|compliance|inspection)\b/i.test(lower);
  const isUkFinance = /\b(mortgage|ground\s+rent|service\s+charge|tenancy\s+deposit)\b/i.test(lower);

  if (isUkCompliance || (isUkCompany && isUkCompliance)) {
    return 'UK_PROPERTY_MAINTENANCE_COMPLIANCE';
  }
  if (isUkFinance || (isUkCompany && /\b(expense|rent|statement|ledger|invoice|payment)\b/i.test(lower))) {
    return 'UK_PROPERTY_FINANCE';
  }
  if (isUkCompany) {
    return 'UK_PROPERTY';
  }

  // Pakistani Property & Finance
  const isPakProperty = /\b(pakistani\s+property|pak\s+property|property\s+expense|unit\s+expense|rent\s+collection|tenant\s+deposit|voucher|ledger)\b/i.test(lower) ||
    lower.includes('sarfraz') ||
    lower.includes('khurshid');

  if (isPakProperty) {
    if (/\b(expense|voucher|ledger|entries|verify|payment|bank|cash|duplicate)\b/i.test(lower)) {
      return 'PAK_FINANCE_EXPENSES';
    }
    return 'PAK_PROPERTY';
  }

  // Management Reporting & Client Communication
  if (/\b(client\s+proposal|client\s+communication|follow\s+up\s+with\s+client)\b/i.test(lower)) {
    return 'CLIENT_COMMUNICATION';
  }
  if (/\b(management\s+report|monthly\s+report|quarterly\s+report|progress\s+report)\b/i.test(lower)) {
    return 'MANAGEMENT_REPORTING';
  }

  return defaultCategory;
}


const GREETINGS_AND_CASUAL = [
  /^(hi|hello|hey|good\s+morning|good\s+afternoon|good\s+evening|salam|assalam|aaoa|namaste)(\s+(all|everyone|guys|team|there))?[!.,\s]*$/i,
  /^(thanks|thank\s+you(\s+so\s+much|\s+a\s+lot)?|thx|ty|ok|okay|k|noted|seen|great|cool|awesome|done|perfect|yes|no|yup|nope|got\s+it|theek\s+hai|shukriya|accha|acha)[!.,\s]*$/i,
  /^(how\s+are\s+you(\s+doing)?|what'?s\s+up|how'?s\s+it\s+going|kya\s+haal|kese\s+ho|kaise\s+ho)[!.,?\s]*$/i,
  /^(where\s+are\s+you|are\s+you\s+(free|busy|available|there)|can\s+you\s+talk|can\s+we\s+talk|did\s+you\s+(reach|eat)|kahan\s+ho|free\s+ho|baat\s+ho\s+sakti)[!.,?\s]*$/i,
  /^(call\s+me(\s+back)?|call\s+when\s+free|please\s+call|pick\s+up|give\s+me\s+a\s+call|call\s+karo|mujhe\s+call)[!.,?\s]*$/i,
  /^(alhamdulillah|subhanallah|mashaallah|mashallah|shukar)[!.,\s]*(hai|ho\s+gaya|done|sab\s+theek\s+hai)?[!.,\s]*$/i,
  /^(?:alhamdulillah|subhanallah|mashaallah|mashallah|shukar)?[!.,\s]*(?:report\s+complete\s+ho\s+gayi|complete\s+ho\s+gayi|kaam\s+ho\s+gaya|done\s+hai|sab\s+theek\s+hai)[!.,\s]*$/i
];

const ACTION_VERBS = [
  'update', 'finish', 'complete', 'prepare', 'create', 'make', 'send', 'upload',
  'fix', 'check', 'review', 'verify', 'submit', 'inspect', 'reconcile', 'draft',
  'email', 'organize', 'clean', 'investigate', 'resolve', 'process', 'pay', 'schedule'
];

const ACTION_INDICATORS = [
  /\bplease\b/i,
  /\bkindly\b/i,
  /\bcan\s+you\b/i,
  /\bcould\s+you\b/i,
  /\bneed\s+to\b/i,
  /\bmake\s+sure\b/i,
  /\bensure\b/i,
  /\bhave\s+to\b/i,
  /\bdon'?t\s+forget\b/i,
  /\basap\b/i,
  /\burgent\b/i,
  /\bby\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|end\s+of\s+day)\b/i,
  /\b(karo|karna|karen|karein|kar\s+do|kar\s+dein|kar\s+den|bana\s+do|bana\s+dein|bhejo|bhej\s+do|bhej\s+dein)\b/i,
  /\b(ready\s+kar|check\s+kar|verify\s+kar|update\s+kar|fix\s+kar)\b/i,
  /\b(kal\s+tak|aaj\s+tak|parso\s+tak)\b/i
];

/**
 * Strict validator for AI or heuristic extraction output
 */
export function validateExtractionOutput(raw, availableProjects = []) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Extraction output must be an object');
  }

  const isTask = Boolean(raw.isTask);
  let confidence = typeof raw.confidence === 'number' ? raw.confidence : (isTask ? 0.8 : 0);
  confidence = Math.max(0, Math.min(1, confidence));

  let title = String(raw.title || '').trim().slice(0, 200);
  let description = String(raw.description || '').trim().slice(0, 10000);
  let assigneeName = typeof raw.assigneeName === 'string' ? raw.assigneeName.trim().slice(0, 100) : '';
  let assigneePhone = typeof raw.assigneePhone === 'string' ? raw.assigneePhone.trim().slice(0, 30) : '';
  let projectName = typeof raw.projectName === 'string' ? raw.projectName.trim().slice(0, 150) : '';
  let reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  let businessCategory = 'NEEDS_REVIEW';
  if (typeof raw.businessCategory === 'string' && BUSINESS_CATEGORIES.includes(raw.businessCategory.trim().toUpperCase())) {
    businessCategory = raw.businessCategory.trim().toUpperCase();
  }
  let modelUsed = typeof raw.modelUsed === 'string' ? raw.modelUsed.trim() : '';

  // Validate Project ID against available projects
  let projectId = null;
  if (raw.projectId) {
    const matched = availableProjects.find(
      (p) => String(p._id) === String(raw.projectId) || p.title.toLowerCase() === String(raw.projectId).toLowerCase()
    );
    if (matched) {
      projectId = matched._id;
      if (!projectName) projectName = matched.title;
    }
  }

  // If no projectId matched yet but projectName was provided, try fuzzy match
  if (!projectId && projectName) {
    const matchedByName = availableProjects.find(
      (p) => p.title.toLowerCase().includes(projectName.toLowerCase()) || projectName.toLowerCase().includes(p.title.toLowerCase())
    );
    if (matchedByName) {
      projectId = matchedByName._id;
    }
  }

  // Priority validation
  let priority = 'Medium';
  const allowedPriorities = ['Low', 'Medium', 'High', 'Urgent'];
  if (raw.priority && allowedPriorities.includes(raw.priority)) {
    priority = raw.priority;
  }

  // Date parsing & validation
  let startDate = null;
  if (raw.startDate) {
    const parsed = new Date(raw.startDate);
    if (!isNaN(parsed.getTime())) startDate = parsed;
  }

  let dueDate = null;
  if (raw.dueDate) {
    const parsed = new Date(raw.dueDate);
    if (!isNaN(parsed.getTime())) dueDate = parsed;
  }

  const dateInterpretation = typeof raw.dateInterpretation === 'string' ? raw.dateInterpretation.trim() : '';
  const sourceSender = typeof raw.sourceSender === 'string' ? raw.sourceSender.trim() : '';
  const missingInformation = Array.isArray(raw.missingInformation)
    ? raw.missingInformation.map((m) => String(m).trim()).filter(Boolean)
    : [];

  return {
    isTask,
    confidence,
    title,
    description,
    assigneeName,
    assigneePhone,
    projectName,
    projectId,
    priority,
    startDate,
    dueDate,
    dateInterpretation,
    sourceSender,
    reason,
    missingInformation,
    modelUsed,
    businessCategory
  };
}

/**
 * Heuristic Relative Date Calculator
 * Interprets dates like "tomorrow", "Monday", "by Friday" relative to message reference date
 */
export function parseRelativeDate(text, referenceDate = new Date()) {
  const lower = text.toLowerCase();
  const ref = new Date(referenceDate);
  const dayOfWeekNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  
  if (lower.includes('today') || lower.includes('eod') || lower.includes('end of day') || lower.includes('aaj') || lower.includes('aaj tak')) {
    const d = new Date(ref);
    d.setHours(18, 0, 0, 0);
    return { date: d, interpretation: `Due by end of day today (${d.toISOString().slice(0, 10)})` };
  }

  if (lower.includes('tomorrow') || lower.includes('kal') || lower.includes('kal tak')) {
    const d = new Date(ref);
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    return { date: d, interpretation: `Due tomorrow (${d.toISOString().slice(0, 10)})` };
  }

  // Match day names: "by Monday", "on Tuesday", "next Friday"
  for (let targetDay = 0; targetDay < dayOfWeekNames.length; targetDay++) {
    const dayName = dayOfWeekNames[targetDay];
    const regex = new RegExp(`\\b(?:by|on|next|this)?\\s*${dayName}\\b`, 'i');
    if (regex.test(lower)) {
      const currentDay = ref.getDay();
      let diff = targetDay - currentDay;
      if (diff <= 0) diff += 7; // Next occurrence
      if (lower.includes(`next ${dayName}`)) diff += 7;

      const d = new Date(ref);
      d.setDate(d.getDate() + diff);
      d.setHours(18, 0, 0, 0);
      const formattedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      return {
        date: d,
        interpretation: `Due ${formattedDay} (${d.toISOString().slice(0, 10)}) relative to message date (${ref.toISOString().slice(0, 10)})`
      };
    }
  }

  return { date: null, interpretation: '' };
}

/**
 * Heuristic Extractor: Rule-based task detector when AI credentials are absent
 */
export function extractTaskHeuristic(text, { senderName = '', messageTimestamp = new Date(), projects = [], audio = null } = {}) {
  const trimmed = text.trim();
  if (audio?.buffer) {
    return {
      isTask: true,
      confidence: 0.85,
      title: `Review voice note from ${senderName || 'Sender'}`,
      description: `Voice message received (${Math.round(audio.buffer.length / 1024)} KB). Audio recording is attached to this draft for playback.`,
      assigneeName: '',
      assigneePhone: '',
      projectName: '',
      projectId: null,
      priority: 'Medium',
      startDate: null,
      dueDate: null,
      dateInterpretation: '',
      sourceSender: senderName,
      reason: 'Voice note received from team member/client. Attached for audio review.',
      missingInformation: ['Listen to audio recording to confirm task specifics'],
      businessCategory: 'NEEDS_REVIEW'
    };
  }
  if (!trimmed) {
    return {
      isTask: false,
      confidence: 0,
      title: '',
      description: '',
      assigneeName: '',
      assigneePhone: '',
      projectName: '',
      projectId: null,
      priority: 'Medium',
      startDate: null,
      dueDate: null,
      dateInterpretation: '',
      sourceSender: senderName,
      reason: 'Empty message content',
      missingInformation: [],
      businessCategory: 'NEEDS_REVIEW',
      modelUsed: 'heuristic'
    };
  }

  // Check if casual greeting or acknowledgment
  for (const regex of GREETINGS_AND_CASUAL) {
    if (regex.test(trimmed)) {
      return {
        isTask: false,
        confidence: 0,
        title: '',
        description: '',
        assigneeName: '',
        assigneePhone: '',
        projectName: '',
        projectId: null,
        priority: 'Medium',
        startDate: null,
        dueDate: null,
        dateInterpretation: '',
        sourceSender: senderName,
        reason: 'Casual conversation or greeting',
        missingInformation: [],
        modelUsed: 'heuristic'
      };
    }
  }

  const hasActionVerb = ACTION_VERBS.some((v) => new RegExp(`\\b${v}\\b`, 'i').test(trimmed));
  const hasActionIndicator = ACTION_INDICATORS.some((r) => r.test(trimmed));

  const isTask = hasActionVerb || hasActionIndicator;
  if (!isTask) {
    return {
      isTask: false,
      confidence: 0,
      title: '',
      description: trimmed,
      assigneeName: '',
      assigneePhone: '',
      projectName: '',
      projectId: null,
      priority: 'Medium',
      startDate: null,
      dueDate: null,
      dateInterpretation: '',
      sourceSender: senderName,
      reason: 'No work instruction or task action detected',
      missingInformation: [],
      businessCategory: 'NEEDS_REVIEW',
      modelUsed: 'heuristic'
    };
  }

  // Calculate Priority
  let priority = 'Medium';
  if (/\b(asap|urgent|urgently|emergency)\b/i.test(trimmed)) {
    priority = 'Urgent';
  } else if (/\b(high\s+priority|important|critical)\b/i.test(trimmed)) {
    priority = 'High';
  } else if (/\b(low\s+priority|whenever|no\s+rush)\b/i.test(trimmed)) {
    priority = 'Low';
  }

  // Parse Due Date
  const { date: dueDate, interpretation: dateInterpretation } = parseRelativeDate(trimmed, messageTimestamp);

  // Match Project
  let matchedProjectId = null;
  let matchedProjectName = '';
  const lowerText = trimmed.toLowerCase();
  for (const project of projects) {
    const pTitle = (project.title || '').trim().toLowerCase();
    if (pTitle && lowerText.includes(pTitle)) {
      matchedProjectId = project._id;
      matchedProjectName = project.title;
      break;
    }
  }

  // Detect Assignee Name across official team directory
  let detectedAssignee = '';
  if (/\b(?:kamran|boss|kamran\s+bhai)\b/i.test(trimmed)) {
    detectedAssignee = 'Kamran';
  } else if (/\b(?:fahad\s+bhai|fahad\s+rasheed|fahad)\b/i.test(trimmed)) {
    detectedAssignee = 'Fahad Rasheed';
  } else if (/\b(?:khurshid\s+bhai|khurshid\s+anwar|khurshid)\b/i.test(trimmed)) {
    detectedAssignee = 'Khurshid Anwar';
  } else if (/\bsarfraz\b/i.test(trimmed)) {
    detectedAssignee = 'Sarfraz';
  } else if (/\b(?:rizwan\s+bhai|rizwan)\b/i.test(trimmed)) {
    detectedAssignee = 'Rizwan';
  } else if (/\b(?:usman\s+bhai|usman)\b/i.test(trimmed)) {
    detectedAssignee = 'Usman';
  } else if (/\b(?:adeel\s+bhai|adeel)\b/i.test(trimmed)) {
    detectedAssignee = 'Adeel';
  } else {
    const nameMatch = trimmed.match(/^([a-z0-9_-]+)[,:]\s*/i) || trimmed.match(/^(?:hi|hey|hello|dear)\s+([a-z0-9_-]+)[,:]?\s*/i);
    if (nameMatch && nameMatch[1]) {
      const nameCand = nameMatch[1].trim();
      if (!['good', 'morning', 'afternoon', 'evening', 'please', 'all', 'team'].includes(nameCand.toLowerCase())) {
        detectedAssignee = nameCand.charAt(0).toUpperCase() + nameCand.slice(1);
      }
    }
  }

  const detectedCategory = detectBusinessCategory(trimmed);

  // Generate Title & Description
  let cleanedTitle = trimmed
    .replace(/^([a-z0-9_-]+)[,:]\s*/i, '')
    .replace(/^(hi|hello|dear)\s+([a-z0-9_-]+)[,:]?\s*/i, '')
    .replace(/^(please|kindly|could you|can you)\s+/i, '');

  cleanedTitle = cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1);
  if (cleanedTitle.length > 100) {
    const periodIdx = cleanedTitle.indexOf('.');
    if (periodIdx > 20 && periodIdx < 120) {
      cleanedTitle = cleanedTitle.slice(0, periodIdx);
    } else {
      cleanedTitle = cleanedTitle.slice(0, 97) + '...';
    }
  }

  const missingInformation = [];
  if (!dueDate && (lowerText.includes('deadline') || lowerText.includes('due') || lowerText.includes('by'))) {
    missingInformation.push('Target deadline is mentioned but ambiguous.');
  }
  if (!matchedProjectId && projects.length > 0) {
    missingInformation.push('No project explicitly matched.');
  }

  return {
    isTask: true,
    confidence: hasActionVerb && hasActionIndicator ? 0.9 : 0.7,
    title: cleanedTitle,
    description: trimmed,
    assigneeName: detectedAssignee,
    assigneePhone: '',
    projectName: matchedProjectName,
    projectId: matchedProjectId,
    priority,
    startDate: null,
    dueDate,
    dateInterpretation,
    sourceSender: senderName,
    reason: 'Actionable work instruction detected via keywords and imperative structure',
    businessCategory: detectedCategory,
    missingInformation,
    modelUsed: 'heuristic'
  };
}

/**
 * Call Gemini API with official REST structure, x-goog-api-key, and dynamic model fallback
 */
export async function callGemini(apiKey, text, context, options = {}) {
  const primaryModel = options.model || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const explicitApiUrl = options.apiUrl;
  const modelsToAttempt = explicitApiUrl
    ? [primaryModel]
    : [...new Set([primaryModel, 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-1.5-flash'])].filter(Boolean);

  const isVoice = Boolean(context.audio?.buffer);
  const prompt = `You are an expert, strict task classification and extraction AI for PIX X TECHNOLOGIEES.
${isVoice ? 'The user sent a WhatsApp voice message / audio note. Listen carefully to the voice note (it may be spoken in English, Urdu, Hindi, or conversational mix).' : 'Analyze the following WhatsApp message received in a team group or direct chat.'}

${PIXX_BUSINESS_CONTEXT}

CRITICAL TASK CLASSIFICATION RULES:
1. ONLY set isTask: true if the message contains a CLEAR, EXPLICIT WORK TASK, DELEGATION, OR INSTRUCTION to perform work (e.g. "prepare the proposal", "fix the login page", "update the database", "submit the report by tomorrow", "Fahad bhai UK property report ready kar dein", "Station shop ka rota bana do").
2. STRICTLY SET isTask: false for:
   - Casual conversation, personal chatter, or greetings ("hi", "how are you", "salam", "good morning").
   - Questions about availability, whereabouts, or routine status ("where are you", "are you free", "can you talk", "did you reach?").
   - Routine communication requests ("call me", "call when free", "pick up the phone", "let me know").
   - Acknowledgements, completion reports, or simple remarks ("ok", "noted", "seen", "thanks", "Alhamdulillah report complete ho gayi").
   - Personal plans ("let's meet for lunch", "going home now").
3. When in doubt or if the message is ambiguous casual chatting, ALWAYS set isTask: false with confidence: 0.

VOICE MESSAGE / AUDIO INSTRUCTIONS:
${isVoice ? `- Listen carefully and attentively to the entire audio note clip.
- Accurately transcribe what was spoken into the "description" field (in English, Urdu, Hindi, Punjabi, or conversational mix).
- If the voice message contains a genuine work directive or task, extract the action, assignee, and deadline clearly.
- If it is casual chatter or greeting, set isTask: false.` : ''}

LONG MESSAGE EVALUATION INSTRUCTIONS:
- If a message is long, multi-paragraph, detailed, or forwarded:
  1. Carefully read and analyze the ENTIRE message from start to finish.
  2. Determine whether there is an actual actionable instruction or deliverable requested.
  3. Distinguish between informational background context vs the actionable instruction.
  4. If actionable work is requested, summarize it concisely in "title" and include the full context in "description".
  5. If the long message is purely an announcement, forward, or casual story with NO task requested, strictly return isTask: false.

BUSINESS CATEGORY SELECTION:
Choose exactly one businessCategory from:
- PAK_PROPERTY (Pakistani property records, rent collection, general property management)
- PAK_FINANCE_EXPENSES (Pakistani property expenses, vouchers, ledgers, bank transactions, entries verification)
- UK_PROPERTY (UK properties: Old Street, Best Standard, SK Hamilton, Homewards, Mile End, Global Standard)
- UK_PROPERTY_FINANCE (UK property rent, mortgages, service charges, ledgers, statements)
- UK_PROPERTY_MAINTENANCE_COMPLIANCE (Gas safety, electrical certificates, renewals, warranties, insurance, inspections)
- UK_BICYCLE_SHOPS (Shops: Station, Camden, Chelsea, Edgware, Southwark, Leebridge general operations)
- ROTA_ATTENDANCE (Worker attendance, late arrivals, missing attendance, check-in records)
- ROTA_SCHEDULING (Weekly rotas, worker allocation, shift scheduling, worker availability)
- SOFTWARE_DEVELOPMENT (Internal apps, expense tracker bugs, task manager features, APIs, database, code)
- IT_SUPPORT (Hosting, server infrastructure, credentials, access, IT hardware)
- CLIENT_COMMUNICATION (Client follow-ups, proposals, inquiries)
- MANAGEMENT_REPORTING (High-level business reports, executive summaries, KPI tracking)
- ADMINISTRATION (General office administration, legal, staff coordination)
- OTHER_BUSINESS (Other company initiatives)
- NEEDS_REVIEW (Ambiguous or requiring manual human review)

Reference message timestamp: ${context.messageTimestamp.toISOString()}
Sender: ${context.senderName || 'Unknown'}
Available workspace projects: ${JSON.stringify(context.projects.map((p) => ({ id: p._id, title: p.title })))}

${isVoice ? 'Listen to the audio content provided in the attachment.' : `Input WhatsApp Message:\n"""${text}"""`}

Return ONLY a valid JSON object matching this schema:
{
  "isTask": boolean,
  "title": string (concise actionable title, max 100 chars, or empty string if not a task),
  "description": string (clear instructions${isVoice ? ' including complete speech transcription' : ' based strictly on message content'}, or empty string if not a task),
  "assigneeName": string or null (name of the person asked to do the task, e.g. "Fahad Rasheed", "Khurshid Anwar", "Sarfraz", or null),
  "assigneePhone": string or null (never invent, leave null if not provided),
  "priority": "Low" | "Medium" | "High" | "Urgent",
  "dueDate": ISO string or null (interpret relative dates like 'tomorrow', 'kal', 'by Monday' using the reference message timestamp),
  "businessCategory": "PAK_PROPERTY" | "PAK_FINANCE_EXPENSES" | "UK_PROPERTY" | "UK_PROPERTY_FINANCE" | "UK_PROPERTY_MAINTENANCE_COMPLIANCE" | "UK_BICYCLE_SHOPS" | "ROTA_ATTENDANCE" | "ROTA_SCHEDULING" | "SOFTWARE_DEVELOPMENT" | "IT_SUPPORT" | "CLIENT_COMMUNICATION" | "MANAGEMENT_REPORTING" | "ADMINISTRATION" | "OTHER_BUSINESS" | "NEEDS_REVIEW",
  "projectName": string or null (matching title from available projects only if confident),
  "projectId": string or null (matching id from available projects only if confident),
  "confidence": number between 0 and 1,
  "reason": string (brief explanation of business context, department, and whether this is a genuine work task),
  "missingInformation": array of strings (ambiguous details that require manual confirmation)
}`;

  let lastError = null;

  for (const modelToTry of modelsToAttempt) {
    const url = explicitApiUrl
      ? explicitApiUrl
      : (modelToTry === primaryModel && process.env.GEMINI_API_URL
          ? process.env.GEMINI_API_URL
          : `https://generativelanguage.googleapis.com/v1beta/models/${modelToTry}:generateContent`);

    // Bounded retry loop for transient network/rate-limit issues
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        logger.info(`[WA_GEMINI_CALL] Calling Gemini REST API.`, {
          model: modelToTry,
          attempt: attempt + 1
        });

        const parts = [];
        if (context.audio?.buffer) {
          const rawMime = context.audio.mimeType || 'audio/ogg';
          const cleanMime = rawMime.split(';')[0].trim();
          parts.push({
            inlineData: {
              mimeType: cleanMime,
              data: context.audio.buffer.toString('base64')
            }
          });
        }
        parts.push({ text: prompt });

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1
            }
          })
        });

        logger.info(`[WA_GEMINI_RESPONSE] Gemini HTTP status received: ${response.status}`, {
          model: modelToTry,
          status: response.status
        });

        // Fast fail on auth / bad request without retaining provider response bodies.
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          logger.warn(`[WA_GEMINI_ERROR] Gemini request rejected HTTP ${response.status}`, { model: modelToTry, status: response.status });
          const error = new Error(`Gemini API Authentication or Client Error (${response.status}).`);
          error.status = response.status;
          throw error;
        }

        // Model not found -> try next model in fallback list
        if (response.status === 404) {
          logger.warn(`[GEMINI_API] Model "${modelToTry}" returned HTTP 404. Attempting supported fallback...`);
          lastError = new Error(`Gemini model "${modelToTry}" returned HTTP 404.`);
          lastError.status = response.status;
          break; // Break inner retry loop to try next model in modelsToAttempt
        }

        // Rate limit (429) or Server error (500, 503) -> wait and retry with backoff
        if (response.status === 429 || response.status >= 500) {
          logger.warn(`[WA_GEMINI_ERROR] Gemini transient error HTTP ${response.status}`, { model: modelToTry, status: response.status });
          lastError = new Error(`Gemini API transient error (${response.status}).`);
          lastError.status = response.status;
          if (attempt < 2) {
            const delayMs = (attempt + 1) * 1000;
            await new Promise((res) => setTimeout(res, delayMs));
            continue;
          }
          break;
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          throw new Error('Gemini response candidates did not contain expected text payload');
        }

        const parsed = JSON.parse(rawText);
        parsed.modelUsed = modelToTry;
        logger.info(`[WA_GEMINI_SUCCESS] Gemini successfully parsed task output.`, {
          modelUsed: modelToTry,
          isTask: parsed.isTask,
          title: parsed.title || '(no title)',
          confidence: parsed.confidence
        });
        return parsed;
      } catch (err) {
        lastError = err;
        if (err.message.includes('Authentication') || err.message.includes('Client Error')) {
          throw err; // Do not retry client auth failures
        }
        if (attempt < 2) {
          const delayMs = (attempt + 1) * 1000;
          await new Promise((res) => setTimeout(res, delayMs));
        }
      }
    }
  }

  throw lastError || new Error('Gemini API call failed after attempting all candidate models.');
}

/**
 * Test Gemini API connectivity with configured credentials
 */
export async function testGeminiConnectivity({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  apiUrl = null
} = {}) {
  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey) {
    return {
      success: false,
      configured: false,
      error: 'GEMINI_API_KEY is not configured in environment variables. Please add your GEMINI_API_KEY to backend/.env.'
    };
  }

  const candidateModels = apiUrl
    ? [model]
    : [...new Set([model, 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-1.5-flash'])].filter(Boolean);

  let lastStatus = 500;
  let lastErrorDetail = '';

  for (const modelToTry of candidateModels) {
    const effectiveUrl = apiUrl || `https://generativelanguage.googleapis.com/v1beta/models/${modelToTry}:generateContent`;

    try {
      const response = await fetch(effectiveUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': trimmedKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with valid JSON: {"ping": "pong", "status": "ok"}' }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        })
      });

      lastStatus = response.status;

      if (!response.ok) {
        let detail = '';
        try {
          const errData = await response.json();
          detail = errData?.error?.message ? `: ${errData.error.message}` : '';
        } catch {
          detail = '';
        }
        lastErrorDetail = detail;

        // If 404 or 503 and more models to try, try next candidate
        if ((response.status === 404 || response.status === 503) && candidateModels.indexOf(modelToTry) < candidateModels.length - 1) {
          continue;
        }

        return {
          success: false,
          configured: true,
          status: response.status,
          model: modelToTry,
          error: `Gemini API returned HTTP ${response.status}${detail}`
        };
      }

      const data = await response.json();
      return {
        success: true,
        configured: true,
        model: modelToTry,
        message: 'Google Gemini API connection test succeeded.',
        projectNumber: process.env.GOOGLE_CLOUD_PROJECT_NUMBER || '1061431060123',
        sampleResult: data.candidates?.[0]?.content?.parts?.[0]?.text || null
      };
    } catch (err) {
      return {
        success: false,
        configured: true,
        model: modelToTry,
        error: `Network or connectivity error contacting Gemini (${err?.message || err?.name || 'Error'}).`
      };
    }
  }

  return {
    success: false,
    configured: true,
    status: lastStatus,
    model,
    error: `Gemini API returned HTTP ${lastStatus}${lastErrorDetail}`
  };
}

/**
 * OpenAI Provider Extractor
 */
async function callOpenAI(apiKey, text, context) {
  const systemPrompt = `You are an AI assistant in a task management system.
Analyze the following WhatsApp message received in a team group.
Decide if the message is an actionable work task or instruction.
If it is casual chit-chat, a greeting, joke, or announcement with no actionable task, return isTask: false.

Reference message timestamp: ${context.messageTimestamp.toISOString()}
Sender: ${context.senderName || 'Unknown'}
Available workspace projects: ${JSON.stringify(context.projects.map((p) => ({ id: p._id, title: p.title })))}

Return ONLY valid JSON matching this schema:
{
  "isTask": boolean,
  "confidence": number between 0 and 1,
  "title": string,
  "description": string,
  "assigneeName": string or null,
  "assigneePhone": string or null,
  "projectId": string or null,
  "priority": "Low" | "Medium" | "High" | "Urgent",
  "dueDate": ISO string or null,
  "reason": string,
  "missingInformation": array of strings
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API responded with status ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

/**
 * Main Task Extraction Service Method
 */
export async function extractTaskFromWhatsAppMessage(
  rawText,
  {
    senderName = '',
    messageTimestamp = new Date(),
    providedProjects = null,
    audio = null
  } = {}
) {
  const text = String(rawText || '').trim();
  let projects = providedProjects;
  if (!projects) {
    try {
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        projects = await Project.find({ isArchived: { $ne: true } })
          .select('_id title')
          .lean()
          .maxTimeMS(2500);
      } else {
        projects = [];
      }
    } catch {
      projects = [];
    }
  }
  const context = {
    senderName,
    messageTimestamp: messageTimestamp instanceof Date ? messageTimestamp : new Date(messageTimestamp),
    projects: projects || [],
    audio
  };

  const openAiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const preferredProvider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  let rawOutput = null;
  let providerUsed = 'heuristic';
  let fallbackReason = null;

  // Prioritize Gemini if configured or requested
  if ((preferredProvider === 'gemini' || (!process.env.AI_PROVIDER && geminiKey)) && geminiKey) {
    try {
      logger.info(`[WA_EXTRACT] Initiating AI task extraction with Google Gemini REST API (model: ${process.env.GEMINI_MODEL || 'gemini-3.5-flash'})...`);
      rawOutput = await callGemini(geminiKey, text, context);
      providerUsed = 'gemini';
    } catch (err) {
      const status = err?.status ? ` (HTTP ${err.status})` : '';
      fallbackReason = `Gemini extraction failed${status}; rule-based fallback was used.`;
      logger.warn(`[WA_EXTRACT] ${fallbackReason}`);
    }
  } else if ((preferredProvider === 'openai' || (!preferredProvider && openAiKey)) && openAiKey) {
    try {
      logger.info('[WA_EXTRACT] Initiating AI task extraction with OpenAI API...');
      rawOutput = await callOpenAI(openAiKey, text, context);
      providerUsed = 'openai';
    } catch (err) {
      const status = err?.status ? ` (HTTP ${err.status})` : '';
      fallbackReason = `OpenAI extraction failed${status}; rule-based fallback was used.`;
      logger.warn(`[WA_EXTRACT] ${fallbackReason}`);
    }
  } else {
    logger.info('[WA_EXTRACT] GEMINI_API_KEY is not configured; using rule-based heuristic extractor.');
  }

  if (!rawOutput) {
    rawOutput = extractTaskHeuristic(text, context);
    providerUsed = 'heuristic';
  }

  const validated = validateExtractionOutput(rawOutput, projects);
  return {
    extraction: validated,
    provider: providerUsed,
    fallbackReason
  };
}

export default {
  extractTaskFromWhatsAppMessage,
  extractTaskHeuristic,
  validateExtractionOutput,
  parseRelativeDate,
  callGemini,
  testGeminiConnectivity
};
