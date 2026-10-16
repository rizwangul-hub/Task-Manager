import { Project } from '../models/project.model.js';
import { logger } from '../utils/logger.js';

const GREETINGS_AND_CASUAL = [
  /^(hi|hello|hey|good\s+morning|good\s+afternoon|good\s+evening|salam|assalam|aaoa)\b.*$/i,
  /^(thanks|thank\s+you(\s+so\s+much|\s+a\s+lot)?|thx|ty|ok|okay|k|noted|seen|great|cool|awesome|done|perfect|yes|no|yup|nope|got\s+it)\b.*$/i,
  /^(how\s+are\s+you(\s+doing)?|what'?s\s+up|how'?s\s+it\s+going)\b.*$/i
];

const ACTION_VERBS = [
  'update', 'finish', 'complete', 'prepare', 'create', 'make', 'send', 'upload',
  'fix', 'check', 'review', 'verify', 'submit', 'inspect', 'reconcile', 'draft',
  'call', 'email', 'organize', 'clean', 'investigate', 'resolve', 'process', 'pay'
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
  /\bby\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|end\s+of\s+day)\b/i
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
  let description = String(raw.description || '').trim().slice(0, 5000);
  let assigneeName = typeof raw.assigneeName === 'string' ? raw.assigneeName.trim().slice(0, 100) : '';
  let assigneePhone = typeof raw.assigneePhone === 'string' ? raw.assigneePhone.trim().slice(0, 30) : '';
  let projectName = typeof raw.projectName === 'string' ? raw.projectName.trim().slice(0, 150) : '';
  let reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
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
    modelUsed
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
  
  if (lower.includes('today') || lower.includes('eod') || lower.includes('end of day')) {
    const d = new Date(ref);
    d.setHours(18, 0, 0, 0);
    return { date: d, interpretation: `Due by end of day today (${d.toISOString().slice(0, 10)})` };
  }

  if (lower.includes('tomorrow')) {
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
export function extractTaskHeuristic(text, { senderName = '', messageTimestamp = new Date(), projects = [] } = {}) {
  const trimmed = text.trim();
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

  // Detect Assignee Name (e.g. "Rizwan, please ...", "Hey Ahmed, ...")
  let detectedAssignee = '';
  const nameMatch = trimmed.match(/^([a-z0-9_-]+)[,:]\s*/i) || trimmed.match(/^(?:hi|hey|hello|dear)\s+([a-z0-9_-]+)[,:]?\s*/i);
  if (nameMatch && nameMatch[1]) {
    const nameCand = nameMatch[1].trim();
    if (!['good', 'morning', 'afternoon', 'evening', 'please', 'all', 'team'].includes(nameCand.toLowerCase())) {
      detectedAssignee = nameCand.charAt(0).toUpperCase() + nameCand.slice(1);
    }
  }

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
    missingInformation,
    modelUsed: 'heuristic'
  };
}

/**
 * Call Gemini API with official REST structure, x-goog-api-key, and dynamic model fallback
 */
export async function callGemini(apiKey, text, context, options = {}) {
  const primaryModel = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const explicitApiUrl = options.apiUrl;
  const modelsToAttempt = explicitApiUrl ? [primaryModel] : [primaryModel, 'gemini-1.5-flash', 'gemini-2.0-flash'];

  const prompt = `You are an AI assistant in a task management system.
Analyze the following WhatsApp message received in a team group.
Decide if the message is an actionable work task or instruction.
If it is casual chit-chat, a greeting, joke, or announcement with no actionable task, return isTask: false.

Reference message timestamp: ${context.messageTimestamp.toISOString()}
Sender: ${context.senderName || 'Unknown'}
Available workspace projects: ${JSON.stringify(context.projects.map((p) => ({ id: p._id, title: p.title })))}

Input WhatsApp Message:
"""${text}"""

Return ONLY a valid JSON object matching this schema:
{
  "isTask": boolean,
  "title": string (concise actionable title, max 100 chars),
  "description": string (clear instructions based strictly on message content),
  "assigneeName": string or null (name of the person asked to do the task, only if clearly stated in the message),
  "assigneePhone": string or null (never invent, leave null if not provided),
  "priority": "Low" | "Medium" | "High" | "Urgent",
  "dueDate": ISO string or null (interpret relative dates like 'tomorrow' or 'by Monday' using the reference message timestamp),
  "projectName": string or null (matching title from available projects only if confident),
  "projectId": string or null (matching id from available projects only if confident),
  "confidence": number between 0 and 1,
  "reason": string (brief justification for whether this is a task or not),
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
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1
            }
          })
        });

        // Fast fail on auth / bad request
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          const errBody = await response.text();
          throw new Error(`Gemini API Authentication or Client Error (${response.status}): ${errBody}`);
        }

        // Model not found -> try next model in fallback list
        if (response.status === 404) {
          const errBody = await response.text();
          logger.warn(`[GEMINI_API] Model "${modelToTry}" returned 404 (${errBody}). Attempting supported fallback...`);
          lastError = new Error(`Gemini Model ${modelToTry} not available: ${errBody}`);
          break; // Break inner retry loop to try next model in modelsToAttempt
        }

        // Rate limit (429) or Server error (500, 503) -> wait and retry with backoff
        if (response.status === 429 || response.status >= 500) {
          const errBody = await response.text();
          lastError = new Error(`Gemini API Transient Error (${response.status}): ${errBody}`);
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
  model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  apiUrl = process.env.GEMINI_API_URL
} = {}) {
  if (!apiKey) {
    return {
      success: false,
      configured: false,
      error: 'GEMINI_API_KEY is not configured in environment variables.'
    };
  }

  const effectiveUrl = apiUrl || `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const response = await fetch(effectiveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Respond with valid JSON: {"ping": "pong", "status": "ok"}' }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      return {
        success: false,
        configured: true,
        status: response.status,
        model,
        error: `Gemini API returned HTTP ${response.status}: ${errBody}`
      };
    }

    const data = await response.json();
    return {
      success: true,
      configured: true,
      model,
      message: 'Google Gemini API connection test succeeded.',
      projectNumber: process.env.GOOGLE_CLOUD_PROJECT_NUMBER || '1061431060123',
      sampleResult: data.candidates?.[0]?.content?.parts?.[0]?.text || null
    };
  } catch (err) {
    return {
      success: false,
      configured: true,
      model,
      error: `Network or connectivity error contacting Gemini: ${err.message}`
    };
  }
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
    providedProjects = null
  } = {}
) {
  const text = String(rawText || '').trim();
  const projects = providedProjects || (await Project.find({ isArchived: { $ne: true } }).select('_id title').lean());
  const context = {
    senderName,
    messageTimestamp: messageTimestamp instanceof Date ? messageTimestamp : new Date(messageTimestamp),
    projects
  };

  const openAiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const preferredProvider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  let rawOutput = null;
  let providerUsed = 'heuristic';

  // Prioritize Gemini if configured or requested
  if ((preferredProvider === 'gemini' || (!process.env.AI_PROVIDER && geminiKey)) && geminiKey) {
    try {
      rawOutput = await callGemini(geminiKey, text, context);
      providerUsed = 'gemini';
    } catch (err) {
      logger.warn(`[AI_EXTRACTOR] Gemini extraction failed, falling back to heuristic: ${err.message}`);
    }
  } else if ((preferredProvider === 'openai' || (!preferredProvider && openAiKey)) && openAiKey) {
    try {
      rawOutput = await callOpenAI(openAiKey, text, context);
      providerUsed = 'openai';
    } catch (err) {
      logger.warn(`[AI_EXTRACTOR] OpenAI extraction failed, falling back to heuristic: ${err.message}`);
    }
  }

  if (!rawOutput) {
    rawOutput = extractTaskHeuristic(text, context);
    providerUsed = 'heuristic';
  }

  const validated = validateExtractionOutput(rawOutput, projects);
  return {
    extraction: validated,
    provider: providerUsed
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
