/* pages/index.js
   FrostDesk Landing MVP (Next.js)

   UX:
   - L’utente compila form e invia richiesta (Make webhook).
   - Dopo l’invio la chat si apre sempre.
   - Chat history persistita in localStorage per threadId.
   - Ogni messaggio chat -> Supabase Edge Function ingest-inbound con x-fd-ingest-key.
   - Persistenza: selected instructor, threadId, conversation_id.

   Note prod:
   - Non leggere localStorage dentro render: usa state + useEffect (evita mismatch).
   - ThreadId unico per “contesto maestro”, reset quando cambia il maestro.
*/

import { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";

/* =========================
   CONFIG
========================= */

const INSTRUCTORS_API_URL = "/api/instructors";

// Make webhooks
const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/dgt5e15smwx72qyn9dnfwlqwxu89xdak";
const MAKE_CONFIRM_WEBHOOK_URL = "PASTE_CONFIRM_WEBHOOK";

// WhatsApp CTA
const WHATSAPP_BASE_LINK = process.env.NEXT_PUBLIC_WA_LINK || "WA_LINK";
const WHATSAPP_PREFILL_TEXT = encodeURIComponent(
  "Ciao, voglio prenotare una lezione"
);

// Maestro app deep link
const MAESTRO_APP_URL = "https://app.frostdesk.io";

// Local dev helper flag
const DEV_FAKE_AI = process.env.NEXT_PUBLIC_FD_DEV_FAKE_AI === "1";

/* =========================
   STORAGE KEYS
========================= */

const CONVERSATION_KEY = "fd_conversation_id";
const CHAT_STORAGE_KEY = "fd_chat_session_id";
const THREAD_HISTORY_PREFIX = "fd_chat_history_";
const SELECTED_INSTRUCTOR_STORAGE_KEY = "frostdesk:selectedInstructor";
const THREAD_STORAGE_KEY = "frostdesk:threadId";

/* =========================
   BADGES (bio parsing)
========================= */

const BADGE_KEYWORDS = [
  { label: "Olympian", regex: /olympian/i },
  { label: "Ambassador", regex: /ambassador/i },
  { label: "Director", regex: /director/i },
];

/* =========================
   SAFE STORAGE HELPERS
========================= */

function safeLocalStorageGet(key) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeLocalStorageRemove(key) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function getConversationId() {
  return safeLocalStorageGet(CONVERSATION_KEY);
}

function setConversationId(id) {
  if (!id) return;
  safeLocalStorageSet(CONVERSATION_KEY, id);
}

function getOrCreateChatSessionId() {
  const existing = safeLocalStorageGet(CHAT_STORAGE_KEY);
  if (existing) return existing;

  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "chat_" + Date.now();

  safeLocalStorageSet(CHAT_STORAGE_KEY, id);
  return id;
}

function getStoredThreadId() {
  return safeLocalStorageGet(THREAD_STORAGE_KEY);
}

function setStoredThreadId(tid) {
  if (!tid) return;
  safeLocalStorageSet(THREAD_STORAGE_KEY, tid);
}

function clearStoredThreadId() {
  safeLocalStorageRemove(THREAD_STORAGE_KEY);
}

function getOrCreateThreadId() {
  const existing = getStoredThreadId();
  if (existing) return existing;

  if (typeof window === "undefined") return null;
  const rand = Math.random().toString(16).slice(2);
  const tid = `thread-web-${Date.now()}-${rand}`;
  setStoredThreadId(tid);
  return tid;
}

function newMessageId(prefix = "msg-web") {
  const rand = Math.random().toString(16).slice(2);
  return `${prefix}-${Date.now()}-${rand}`;
}

function saveSelectedInstructorToStorage(i) {
  safeLocalStorageSet(SELECTED_INSTRUCTOR_STORAGE_KEY, JSON.stringify(i));
}

function loadSelectedInstructorFromStorage() {
  const raw = safeLocalStorageGet(SELECTED_INSTRUCTOR_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearSelectedInstructorInStorage() {
  safeLocalStorageRemove(SELECTED_INSTRUCTOR_STORAGE_KEY);
}

/* =========================
   TEXT HELPERS
========================= */

function safeText(v) {
  return (v ?? "").toString();
}

function isSchemaString(v) {
  if (!v) return false;
  const s = v.toString().trim();
  return s === '{"type":"string"}' || s.includes('"type":"string"');
}

function normalizeMessage(rawMsg) {
  const s = safeText(rawMsg);
  if (!s) return "Richiesta ricevuta.";
  if (isSchemaString(s)) return "Ok. Per procedere mi servono alcune info.";
  return s;
}

function getInstructorInitials(name) {
  const cleaned = safeText(name).trim();
  if (!cleaned) return "FD";
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "F";
  const first = parts[0][0]?.toUpperCase() ?? "F";
  const last = parts[parts.length - 1][0]?.toUpperCase() ?? "D";
  return `${first}${last}`;
}

function buildWhatsAppLink(instructor) {
  const candidateNumber = instructor?.whatsapp_number?.toString().trim();
  if (candidateNumber) {
    return `https://wa.me/${candidateNumber}?text=${WHATSAPP_PREFILL_TEXT}`;
  }
  return `${WHATSAPP_BASE_LINK}?text=${WHATSAPP_PREFILL_TEXT}`;
}

function getInstructorBadges(bio) {
  if (!bio) return [];
  return BADGE_KEYWORDS.filter(({ regex }) => regex.test(bio)).map(
    ({ label }) => label
  );
}

function formatSlot(startISO, endISO) {
  try {
    const start = new Date(startISO);
    const end = new Date(endISO);
    const date = start.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "long",
    });
    const startTime = start.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const endTime = end.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${date} · ${startTime} - ${endTime}`;
  } catch {
    return "Alternativa disponibile";
  }
}

function getClientTZ() {
  return typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "Europe/Rome";
}

/* =========================
   PAGE
========================= */

export default function Home() {
  // main state
  const [instructors, setInstructors] = useState([]);
  const [instructorsLoading, setInstructorsLoading] = useState(true);

  const [selectedInstructorId, setSelectedInstructorId] = useState("");
  const [selectedInstructor, setSelectedInstructor] = useState(null);

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // alternatives / generic response card
  const [altVisible, setAltVisible] = useState(false);
  const [altMsg, setAltMsg] = useState("");
  const [altMeta, setAltMeta] = useState("");
  const [altAlternatives, setAltAlternatives] = useState([]);

  const [sending, setSending] = useState(false);

  // chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatStatus, setChatStatus] = useState(null);
  const [chatMissingFields, setChatMissingFields] = useState([]);

  const [chatSessionId, setChatSessionId] = useState(null);
  const [threadId, setThreadId] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const [lastBasePayload, setLastBasePayload] = useState(null);

  const [debug, setDebug] = useState(null);

  // persisted snapshot of selected instructor (for CTA visibility)
  const [storedInstructor, setStoredInstructor] = useState(null);

  const chatBodyRef = useRef(null);

  /* =========================
     INIT
  ========================= */

  useEffect(() => {
    // chat session
    setChatSessionId(getOrCreateChatSessionId());

    // thread
    const initialThreadId = getOrCreateThreadId();
    if (initialThreadId) setThreadId(initialThreadId);

    // selected instructor (from storage)
    const saved = loadSelectedInstructorFromStorage();
    setStoredInstructor(saved);
    if (saved?.id) setSelectedInstructorId(saved.id);

    // chat history (if exists)
    if (initialThreadId) {
      const storedHistory = safeLocalStorageGet(
        THREAD_HISTORY_PREFIX + initialThreadId
      );
      if (storedHistory) {
        try {
          setChatMessages(JSON.parse(storedHistory));
          setTimeout(scrollChatToBottom, 50);
        } catch {
          // ignore parse errors
        }
      }
    }

    loadInstructors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist chat history per thread
  useEffect(() => {
    if (!threadId) return;
    safeLocalStorageSet(
      THREAD_HISTORY_PREFIX + threadId,
      JSON.stringify(chatMessages)
    );
  }, [chatMessages, threadId]);

  // Fetch selected instructor details
  useEffect(() => {
    let cancelled = false;

    if (!selectedInstructorId) {
      setSelectedInstructor(null);
      return;
    }

    async function fetchInstructor() {
      try {
        const url =
          INSTRUCTORS_API_URL + "?id=" + encodeURIComponent(selectedInstructorId);
        const res = await fetch(url, { method: "GET" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json || json.ok !== true || !json.data) {
          const msg = json?.error ? String(json.error) : "HTTP " + res.status;
          if (!cancelled) setErrorMsg("Errore caricamento maestro.\n" + msg);
          return;
        }

        if (!cancelled) setSelectedInstructor(json.data);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg("Errore rete nel caricamento maestro.");
      }
    }

    fetchInstructor();
    return () => {
      cancelled = true;
    };
  }, [selectedInstructorId]);

  // Persist selected instructor to localStorage + state snapshot
  useEffect(() => {
    if (selectedInstructor) {
      const snap = {
        id: selectedInstructor.id,
        name: selectedInstructor.name,
        slug: selectedInstructor.slug ?? null,
        photo_url: selectedInstructor.photo_url ?? null,
        whatsapp_number: selectedInstructor.whatsapp_number ?? null,
        frostdesk_enabled: Boolean(selectedInstructor.frostdesk_enabled),
      };
      saveSelectedInstructorToStorage(snap);
      setStoredInstructor(snap);
    } else {
      clearSelectedInstructorInStorage();
      setStoredInstructor(null);
    }
  }, [selectedInstructor]);

  /* =========================
     UI HELPERS
  ========================= */

  function resetFeedback() {
    setSuccessMsg("");
    setErrorMsg("");
    setAltVisible(false);
    setAltMsg("");
    setAltMeta("");
    setAltAlternatives([]);
    setDebug(null);
  }

  // When changing instructor, reset thread + history
  function resetThreadContext() {
    const prevThreadId = getStoredThreadId();
    if (prevThreadId) {
      safeLocalStorageRemove(THREAD_HISTORY_PREFIX + prevThreadId);
    }
    clearStoredThreadId();
    setThreadId("");
    setChatMessages([]);
  }

  async function loadInstructors() {
    setInstructorsLoading(true);
    resetFeedback();

    try {
      const res = await fetch(INSTRUCTORS_API_URL, { method: "GET" });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json || json.ok !== true) {
        const msg = json?.error ? String(json.error) : "HTTP " + res.status;
        setErrorMsg("Non riesco a caricare la lista maestri.\n" + msg);
        setInstructors([]);
        setInstructorsLoading(false);
        return;
      }

      const rawData = Array.isArray(json.data) ? json.data : [];
      const sorted = [...rawData].sort((a, b) => {
        const nameA = safeText(a?.name).toLowerCase();
        const nameB = safeText(b?.name).toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      });

      setInstructors(sorted);
      setInstructorsLoading(false);
    } catch (err) {
      setErrorMsg("Errore rete nel caricamento maestri.");
      setInstructorsLoading(false);
    }
  }

  function ensureThread() {
    const tid = threadId || getOrCreateThreadId();
    if (tid && tid !== threadId) setThreadId(tid);
    return tid;
  }

  function handleSelectChange(e) {
    const id = e.target.value;

    resetFeedback();
    resetThreadContext();

    // Create fresh thread immediately for new context
    const newTid = getOrCreateThreadId();
    if (newTid) setThreadId(newTid);

    setSelectedInstructorId(id);
    if (!id) setSelectedInstructor(null);
  }

  async function onWhatsappClick(event) {
    event.preventDefault();
    const selected = storedInstructor;
    if (!selected) return;

    const externalThreadId = ensureThread();
    if (!externalThreadId) return;

    // Optional tracking endpoint (only if present in your app)
    const payload = {
      channel: "landing",
      external_thread_id: externalThreadId,
      external_message_id: newMessageId("cta-web"),
      from: {
        handle: "landing",
        display_name: "Website Visitor",
        phone_or_email: "unknown",
      },
      timestamp: new Date().toISOString(),
      event_type: "cta_whatsapp_click",
      text: "cta_whatsapp_click",
      instructor_id: selected.id,
    };

    try {
      await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // tracking non critico
    }

    const url = buildWhatsAppLink(selected);
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function applyChip(text) {
    const add = String(text || "").trim();
    if (!add) return;

    setMessage((prev) => {
      const p = safeText(prev).trim();
      if (!p) return add;
      if (p.endsWith("\n")) return p + add;
      return p + "\n" + add;
    });
  }

  function applyMessageTemplate() {
    const template =
      "Domani 10:00, 2 ore, 2 persone, intermedio, Meeting Point Mottolino";
    setMessage((prev) => {
      const p = safeText(prev).trim();
      return p ? p : template;
    });
  }

  // Simple checklist heuristic (UI only)
  function guessChecklist(msg) {
    const m = safeText(msg).toLowerCase();
    const hasPeople =
      /\b(\d+)\s*(persone|people|pax)\b/.test(m) || /\b(1|2|3|4|5)\b/.test(m);
    const hasLevel =
      /\b(principiante|beginner|intermedio|intermediate|avanzato|advanced)\b/.test(
        m
      );
    const hasDuration =
      /\b(\d+)\s*(h|hr|hrs|ore|hours|min|mins|minuti)\b/.test(m) ||
      /\b(1h|2h|3h)\b/.test(m);
    const hasTime =
      /\b\d{1,2}[:.]\d{2}\b/.test(m) ||
      /\b(mattina|pomeriggio|morning|afternoon)\b/.test(m);
    const hasDate =
      /\b(oggi|domani|sabato|domenica|lunedì|martedì|mercoledì|giovedì|venerdì|today|tomorrow|sat|sun|mon|tue|wed|thu|fri|next)\b/.test(
        m
      ) || /\b\d{1,2}\/\d{1,2}\b/.test(m);
    const hasLocation =
      /\b(meeting point|meeting|mottolino|carosello|centro|hotel|lift|funivia|piazza)\b/.test(
        m
      );

    return {
      dateTime: hasDate && hasTime,
      duration: hasDuration,
      location: hasLocation,
      level: hasLevel,
      participants: hasPeople,
    };
  }

  /* =========================
     SUBMIT FLOW -> Make
     + always open chat
  ========================= */

  async function handleSubmit(e) {
    e.preventDefault();
    resetFeedback();

    if (!selectedInstructor) {
      alert("Seleziona prima un maestro");
      return;
    }

    const currentThreadId = ensureThread();

    const payload = {
      conversation_id: getConversationId() || null,
      instructor_id: selectedInstructor.id,
      calendar_id: selectedInstructor.calendar_id,
      instructor_name: selectedInstructor.name || null,
      name: safeText(customerName),
      phone: safeText(phone),
      message: safeText(message),
      client_tz: getClientTZ(),
      source: "landing",
      external_thread_id: currentThreadId || null,
    };

    setLastBasePayload(payload);

    const result = await callMakeEndpoint(payload);

    // Always open chat after submit
    const initial =
      normalizeMessage(result?.normalizedMsg) ||
      "Perfetto. Aggiungi qui altri dettagli (orario, durata, persone, livello, meeting point).";

    const missing = Array.isArray(result?.missingFields)
      ? result.missingFields
      : [];

    openChat(initial, missing);
  }

  async function callMakeEndpoint(payload) {
    setSending(true);

    try {
      const res = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      let data = null;

      if (contentType.includes("application/json")) {
        data = await res.json().catch(() => ({}));
      } else {
        data = { ok: res.ok, message: await res.text() };
      }

      const normalizedMsg = normalizeMessage(data?.message);

      setDebug({
        ok: !!data?.ok,
        status: data?.status || null,
        missing_fields: Array.isArray(data?.missing_fields)
          ? data.missing_fields
          : null,
      });

      if (data?.conversation_id) setConversationId(data.conversation_id);

      if (!res.ok) {
        setErrorMsg(normalizedMsg || "Errore nell'invio.");
        setSending(false);
        return { ok: false, normalizedMsg };
      }

      if (data?.status === "slot_busy") {
        const alts = Array.isArray(data?.alternatives) ? data.alternatives : [];
        renderAlternatives(normalizedMsg, alts);
        setSending(false);
        return {
          ok: true,
          status: "slot_busy",
          normalizedMsg,
          alternatives: alts,
        };
      }

      if (data?.status === "need_more_info") {
        const mf = Array.isArray(data?.missing_fields) ? data.missing_fields : [];
        setSending(false);
        return { ok: true, status: "need_more_info", normalizedMsg, missingFields: mf };
      }

      if (data?.status === "ask_info") {
        setAltVisible(true);
        setAltMsg(normalizedMsg);
        setSending(false);
        return { ok: true, status: "ask_info", normalizedMsg };
      }

      if (data?.ok === true) {
        setSuccessMsg(normalizedMsg || "Richiesta inviata con successo.");
        setSending(false);
        return { ok: true, status: "ok", normalizedMsg };
      }

      setAltVisible(true);
      setAltMsg(normalizedMsg);
      setSending(false);
      return { ok: true, status: "unknown", normalizedMsg };
    } catch (err) {
      setErrorMsg("Errore rete.");
      setSending(false);
      return { ok: false, normalizedMsg: "Errore rete." };
    }
  }

  function renderAlternatives(messageText, alternatives) {
    setAltVisible(true);
    setAltMsg(
      messageText || "Quello slot è già occupato. Ti propongo alcune alternative:"
    );

    const firstTwo = (alternatives || []).slice(0, 2);
    setAltAlternatives(firstTwo);

    if (firstTwo.length === 0) {
      setAltMsg(
        "Mi dispiace, ma non ho alternative immediate. Puoi indicarmi un altro orario?"
      );
    }
  }

  async function confirmBooking(payload) {
    if (!MAKE_CONFIRM_WEBHOOK_URL || MAKE_CONFIRM_WEBHOOK_URL.includes("PASTE_")) {
      setErrorMsg(
        "Manca MAKE_CONFIRM_WEBHOOK_URL. Incolla l'URL del webhook di conferma."
      );
      return;
    }

    try {
      const res = await fetch(MAKE_CONFIRM_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      let data = null;

      if (contentType.includes("application/json")) {
        data = await res.json().catch(() => ({}));
      } else {
        data = { ok: res.ok, message: await res.text() };
      }

      if (!res.ok) {
        setErrorMsg(normalizeMessage(data?.message) || "Errore nella conferma.");
        return;
      }

      const msg = normalizeMessage(data?.message) || "Booking confermato.";
      setAltVisible(true);
      setAltMsg(msg);

      const ref = safeText(data?.booking_ref || data?.reference || "");
      const st = safeText(data?.start_time || payload?.chosen_start_time || "");
      const en = safeText(data?.end_time || payload?.chosen_end_time || "");
      const inst = safeText(
        data?.instructor_name || payload?.instructor_name || ""
      );

      const lines = [];
      if (inst) lines.push(`Maestro: ${inst}`);
      if (st && en) lines.push(`Orario: ${formatSlot(st, en)}`);
      if (ref) lines.push(`Riferimento: ${ref}`);
      setAltMeta(lines.join(" | "));
    } catch {
      setErrorMsg("Errore rete nella conferma.");
    }
  }

  /* =========================
     CHAT
  ========================= */

  function openChat(initialAiMessage, missingFields) {
    setChatMissingFields(Array.isArray(missingFields) ? missingFields : []);

    const aiLabel = selectedInstructor
      ? `${selectedInstructor.name || "FrostDesk"} (FrostDesk)`
      : "FrostDesk";

    setChatMessages((prev) => {
      if (Array.isArray(prev) && prev.length > 0) return prev;
      return [
        {
          role: "ai",
          text: initialAiMessage || "Dimmi pure i dettagli mancanti.",
          label: aiLabel,
        },
      ];
    });

    setChatOpen(true);
    setTimeout(scrollChatToBottom, 50);
  }

  function closeChat() {
    setChatOpen(false);
  }

  function addChatMsg(role, text, label) {
    setChatMessages((prev) => [...prev, { role, text, label }]);
    setTimeout(scrollChatToBottom, 50);
  }

  function scrollChatToBottom() {
    if (!chatBodyRef.current) return;
    chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }

  async function copyTranscript() {
    if (typeof window === "undefined" || !threadId) return;

    const transcript = {
      channel: "landing",
      external_thread_id: threadId,
      instructor: {
        id: selectedInstructor?.id ?? null,
        name: selectedInstructor?.name ?? null,
      },
      messages: chatMessages,
    };

    const payload = JSON.stringify(transcript, null, 2);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = payload;
        textarea.style.position = "fixed";
        textarea.style.top = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    } finally {
      setTimeout(() => setCopyStatus(""), 2000);
    }
  }

  async function postToIngestInbound({ contentText }) {
    const currentThreadId = ensureThread();
    if (!currentThreadId) {
      throw new Error("Impossibile inizializzare il thread.");
    }

    const normalizedPhone = safeText(phone).trim();
    const normalizedCustomerName = safeText(customerName).trim();
    const normalizedContent = safeText(contentText).trim();

    const payload = {
      channel: "landing",
      external_thread_id: currentThreadId,
      phone: normalizedPhone || null,
      client_name: normalizedCustomerName || null,
      instructor_id: selectedInstructor?.id ?? null,
      content: normalizedContent,
      role: "user",
      metadata: {
        source: "fd-landing-chat",
        client_tz: getClientTZ(),
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        page: "landing",
        chat_session_id: chatSessionId,
      },
    };

    const res = await fetch("/api/ingest-inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    let parsed = null;
    if (isJson && text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!res.ok) {
      const errorMessage =
        safeText(parsed?.error || parsed?.message || parsed?.details) ||
        safeText(text) ||
        `HTTP ${res.status}`;
      throw new Error(errorMessage);
    }

    return {
      conversation_id: parsed?.conversation_id ?? null,
      message_id: parsed?.message_id ?? null,
      assistant_message: parsed?.assistant_message ?? null,
    };
  }

  async function onChatSend() {
    const userText = safeText(chatText).trim();
    if (!userText) return;

    const aiLabel = selectedInstructor
      ? `${selectedInstructor.name || "FrostDesk"} (FrostDesk)`
      : "FrostDesk";

    // UI: add user message immediately
    addChatMsg("user", userText);
    setChatText("");
    setChatSending(true);
    setChatStatus(null);

    try {
      const result = await postToIngestInbound({ contentText: userText });
      if (result?.conversation_id) setConversationId(result.conversation_id);

      const assistantMessage =
        result?.assistant_message ||
        (DEV_FAKE_AI
          ? "Perfetto. Mi confermi quante persone siete e il livello?"
          : "Ok, ricevuto.");

      addChatMsg("ai", assistantMessage, aiLabel);
      setChatStatus({
        type: "success",
        text: "Chat inoltrata con successo.",
        conversation_id: result?.conversation_id ?? null,
        message_id: result?.message_id ?? null,
      });
    } catch (err) {
      const errorText =
        safeText(err?.message) || "Errore nella chat. Riprova tra pochi secondi.";
      setChatStatus({ type: "error", text: errorText });
      addChatMsg(
        "ai",
        `Errore nella chat. ${errorText}`,
        aiLabel
      );
    } finally {
      setChatSending(false);
    }
  }

  /* =========================
     RENDER UI
  ========================= */

  const checklist = useMemo(() => guessChecklist(message), [message]);

  const selectedInstructorBadges = useMemo(() => {
    return selectedInstructor ? getInstructorBadges(selectedInstructor.bio) : [];
  }, [selectedInstructor]);

  const showWhatsAppCTA = Boolean(storedInstructor && storedInstructor.frostdesk_enabled);

  const chatMetaText =
    chatMissingFields.length > 0
      ? "Mi servono: " + chatMissingFields.join(", ")
      : "Rispondi qui con i dettagli.";

  return (
    <>
      <Head>
        <title>FrostDesk Booking</title>
        <meta
          name="description"
          content="Prenota una lezione di sci in 30 secondi. FrostDesk controlla l’agenda del maestro e gestisce la richiesta."
        />
        <meta name="author" content="FrostDesk" />
        <meta property="og:title" content="FrostDesk Booking" />
        <meta
          property="og:description"
          content="Scrivi al maestro. FrostDesk controlla l’agenda e ti propone subito lo slot giusto."
        />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="/og-image.png" />
        <link rel="icon" href="/favicon.ico" />
        <style>{`
          body {
            margin: 0;
            padding: 0;
            background: radial-gradient(1200px 600px at 20% 0%, rgba(59,130,246,0.18), transparent 60%),
                        radial-gradient(900px 500px at 90% 10%, rgba(99,102,241,0.14), transparent 55%),
                        radial-gradient(900px 500px at 50% 100%, rgba(16,185,129,0.08), transparent 60%),
                        #0b0c0f;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #e5e7eb;
          }
          .container {
            max-width: 560px;
            margin: 0 auto;
            padding: 34px;
            background: rgba(17, 19, 24, 0.78);
            margin-top: 56px;
            border-radius: 26px;
            border: 1px solid rgba(255, 255, 255, 0.07);
            box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            animation: fadeIn 0.6s ease;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          h1 {
            text-align: center;
            font-size: 34px;
            font-weight: 800;
            margin-bottom: 10px;
            color: #ffffff;
            letter-spacing: -0.5px;
            text-shadow: 0 8px 30px rgba(0,0,0,0.35);
          }
          p.subtitle {
            text-align: center;
            color: #9ca3af;
            margin-bottom: 22px;
            font-size: 15px;
          }
          .hint {
            margin: 10px 0 18px 0;
            padding: 12px;
            border-radius: 14px;
            border: 1px solid #2f333a;
            background: linear-gradient(180deg, rgba(14,15,18,0.75), rgba(14,15,18,0.45));
            color: #cbd5e1;
            font-size: 13px;
            line-height: 1.35;
          }
          .fieldHelp {
            margin-top: 10px;
            padding: 12px;
            border-radius: 14px;
            border: 1px solid #2f333a;
            background: #0e0f12;
            color: #cbd5e1;
            font-size: 13px;
            line-height: 1.35;
          }
          .fieldHelpTop {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 8px;
          }
          .fieldHelpTitle {
            font-weight: 700;
            color: #e5e7eb;
            font-size: 13px;
          }
          .miniBtn {
            border: 1px solid #2f333a;
            background: #111318;
            color: #e5e7eb;
            border-radius: 999px;
            padding: 8px 10px;
            font-size: 12px;
            cursor: pointer;
            transition: 0.2s ease;
            white-space: nowrap;
          }
          .miniBtn:hover { background: #171a22; transform: translateY(-1px); }
          .exampleBox {
            margin-top: 8px;
            border-radius: 12px;
            border: 1px solid #2f333a;
            background: #111318;
            padding: 10px 12px;
            color: #e5e7eb;
            font-size: 13px;
          }
          .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
          .chip {
            cursor: pointer;
            border: 1px solid #2f333a;
            background: #0e0f12;
            color: #e5e7eb;
            border-radius: 999px;
            padding: 8px 10px;
            font-size: 12px;
            transition: 0.2s ease;
          }
          .chip:hover { background: #171a22; transform: translateY(-1px); }
          .checklist {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-top: 10px;
          }
          .checkItem {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border-radius: 14px;
            border: 1px solid #2f333a;
            background: #111318;
            font-size: 12px;
            color: #cbd5e1;
          }
          .dot { width: 10px; height: 10px; border-radius: 999px; background: #374151; }
          .dot.ok { background: #22c55e; }
          label {
            font-weight: 600;
            display: block;
            margin-top: 16px;
            margin-bottom: 6px;
            color: #c7c7c7;
          }
          select, input, textarea {
            width: 100%;
            padding: 14px;
            font-size: 16px;
            background: #24272e;
            border: 1px solid #3d414a;
            border-radius: 12px;
            color: white;
            transition: 0.2s ease;
            box-sizing: border-box;
          }
          select:focus, input:focus, textarea:focus {
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3);
            outline: none;
          }
          textarea { height: 120px; }
          .button {
            width: 100%;
            padding: 16px;
            margin-top: 20px;
            background-color: #3b82f6;
            color: white;
            font-size: 18px;
            border: none;
            border-radius: 14px;
            cursor: pointer;
            font-weight: 700;
            transition: 0.25s ease;
          }
          .button:hover { background-color: #2563eb; transform: translateY(-1px); }
          .button.secondary {
            background-color: #111318;
            border: 1px solid #3d414a;
            font-size: 16px;
            margin-top: 10px;
          }
          .button.secondary:hover { background-color: #171a22; transform: translateY(-1px); }
          .card {
            margin-top: 24px;
            padding: 20px;
            background: #24272e;
            border-radius: 16px;
            border: 1px solid #2f333a;
            animation: fadeIn 0.4s ease;
          }
          .card img {
            width: 140px;
            height: 140px;
            border-radius: 16px;
            object-fit: cover;
            margin-bottom: 14px;
            background: #0e0f12;
          }
          .placeholder-avatar {
            width: 140px;
            height: 140px;
            border-radius: 16px;
            margin-bottom: 14px;
            background: radial-gradient(circle at 30% 20%, rgba(59, 130, 246, 0.5), transparent 55%),
              radial-gradient(circle at 70% 60%, rgba(16, 185, 129, 0.45), transparent 60%),
              #111318;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 42px;
            font-weight: 700;
            letter-spacing: 1px;
            color: #e5e7eb;
            border: 1px solid rgba(255, 255, 255, 0.08);
            text-transform: uppercase;
          }
          .badgeRow { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
          .instructorBadge {
            font-size: 10px;
            padding: 4px 8px;
            border-radius: 999px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            background: rgba(255, 255, 255, 0.04);
            color: #a5b4fc;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .smallMuted { margin-top: 10px; font-size: 12px; color: #9ca3af; }
          #success { color: #22c55e; margin-top: 18px; white-space: pre-wrap; }
          #errorMsg { color: #f87171; margin-top: 18px; white-space: pre-wrap; }
          .debug {
            margin-top: 12px;
            font-size: 12px;
            color: #9ca3af;
            background: #111318;
            border: 1px solid #2f333a;
            border-radius: 14px;
            padding: 10px 12px;
            white-space: pre-wrap;
          }
          #chatOverlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(2px);
            z-index: 1000;
            align-items: center;
            justify-content: center;
            padding: 18px;
            box-sizing: border-box;
            display: none;
          }
          #chatOverlay.open { display: flex; }
          #chatModal {
            width: 100%;
            max-width: 560px;
            background: #111318;
            border: 1px solid #2f333a;
            border-radius: 18px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.55);
            overflow: hidden;
          }
          #chatHeader {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            border-bottom: 1px solid #2f333a;
            background: #0e0f12;
          }
          #chatHeaderTitle { font-weight: 800; font-size: 14px; color: #e5e7eb; }
          #chatClose {
            background: transparent;
            border: 1px solid #2f333a;
            color: #e5e7eb;
            border-radius: 10px;
            padding: 8px 10px;
            cursor: pointer;
            font-size: 12px;
          }
          #chatClose:hover { background: #171a22; }
          #chatBody {
            padding: 14px 16px;
            height: 320px;
            overflow-y: auto;
            background: #111318;
          }
          .chatMsg {
            padding: 10px 12px;
            border-radius: 14px;
            margin-bottom: 10px;
            line-height: 1.35;
            font-size: 14px;
            border: 1px solid #2f333a;
            white-space: pre-wrap;
            word-break: break-word;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .chatMsg.ai { background: #0e0f12; color: #e5e7eb; }
          .chatMsg.user { background: #1a1d22; color: #ffffff; border-color: #3d414a; }
          .chatMsgLabel {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            color: #9ca3af;
          }
          .chatInstructorInfo {
            font-size: 12px;
            color: #c7d2ff;
            padding: 0 16px 8px;
          }
          #chatMeta {
            padding: 10px 16px;
            border-top: 1px solid #2f333a;
            background: #0e0f12;
            font-size: 12px;
            color: #9ca3af;
          }
          .chatMetaStatus {
            margin-top: 4px;
            font-size: 11px;
            color: #94a3b8;
          }
          .chatMetaStatus.error { color: #f87171; }
          .chatMetaStatus.success { color: #34d399; }
          .chatActions {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 16px;
            border-bottom: 1px solid #2f333a;
            background: #0e0f12;
            flex-wrap: wrap;
          }
          .chatActions .chatToast { font-size: 12px; color: #34d399; margin-left: auto; }
          .chatLink { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
          .whatsappCTA { display: flex; flex-direction: column; gap: 4px; }
          .whatsappMicro { font-size: 11px; color: #94a3b8; }
          .whatsappDisabled {
            font-size: 12px;
            color: #f87171;
            text-transform: uppercase;
            letter-spacing: 0.4px;
          }
          #chatFooter {
            display: flex;
            gap: 10px;
            padding: 12px 12px;
            border-top: 1px solid #2f333a;
            background: #0e0f12;
            box-sizing: border-box;
          }
          #chatInput {
            flex: 1;
            padding: 12px;
            font-size: 14px;
            background: #24272e;
            border: 1px solid #3d414a;
            border-radius: 12px;
            color: white;
          }
          #chatSend {
            padding: 12px 14px;
            font-size: 14px;
            background: #3b82f6;
            border: none;
            border-radius: 12px;
            color: white;
            cursor: pointer;
            font-weight: 700;
          }
          #chatSend:disabled { opacity: 0.7; cursor: default; }
        `}</style>
      </Head>

      <div className="container">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <img
            src="/frostdesk-logo1.svg"
            alt="FrostDesk"
            style={{
              width: 72,
              height: 72,
              borderRadius: "20px",
              objectFit: "contain",
              background: "#0e0f12",
            }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </div>

        <h1>FrostDesk</h1>

        <p className="subtitle">
          Invia una richiesta al maestro. FrostDesk controlla l’agenda e ti risponde subito.
        </p>

        <div className="hint">
          Suggerimento: scrivi così per essere confermato più velocemente.
          <div style={{ marginTop: 8, color: "#e5e7eb" }}>
            “Domani 10:00, 2 ore, 2 persone, intermedio, Meeting Point Mottolino”
          </div>

          <div className="chips">
            <button type="button" className="chip" onClick={() => applyChip("Oggi")}>Oggi</button>
            <button type="button" className="chip" onClick={() => applyChip("Domani")}>Domani</button>
            <button type="button" className="chip" onClick={() => applyChip("10:00")}>10:00</button>
            <button type="button" className="chip" onClick={() => applyChip("2 ore")}>2 ore</button>
            <button type="button" className="chip" onClick={() => applyChip("2 persone")}>2 persone</button>
            <button type="button" className="chip" onClick={() => applyChip("Principiante")}>Principiante</button>
            <button type="button" className="chip" onClick={() => applyChip("Intermedio")}>Intermedio</button>
            <button type="button" className="chip" onClick={() => applyChip("Avanzato")}>Avanzato</button>
            <button type="button" className="chip" onClick={() => applyChip("Meeting point:")}>Meeting point:</button>
          </div>

          <div className="checklist">
            <div className="checkItem"><span className={`dot ${checklist.dateTime ? "ok" : ""}`} /> Data e ora</div>
            <div className="checkItem"><span className={`dot ${checklist.duration ? "ok" : ""}`} /> Durata</div>
            <div className="checkItem"><span className={`dot ${checklist.participants ? "ok" : ""}`} /> Persone</div>
            <div className="checkItem"><span className={`dot ${checklist.level ? "ok" : ""}`} /> Livello</div>
            <div className="checkItem" style={{ gridColumn: "1 / -1" }}>
              <span className={`dot ${checklist.location ? "ok" : ""}`} /> Location / Meeting point
            </div>
          </div>
        </div>

        <label>Seleziona il maestro</label>
        <select
          value={selectedInstructorId}
          onChange={handleSelectChange}
          disabled={instructorsLoading}
        >
          {instructorsLoading && <option>Caricamento maestri...</option>}
          {!instructorsLoading && instructors.length === 0 && (
            <option>Nessun maestro disponibile</option>
          )}
          {!instructorsLoading && instructors.length > 0 && (
            <>
              <option value="">Scegli un maestro</option>
              {instructors.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name || "Maestro"}
                </option>
              ))}
            </>
          )}
        </select>

        {selectedInstructor && (
          <div className="card">
            {selectedInstructor.photo_url?.trim() ? (
              <img src={selectedInstructor.photo_url} alt="Foto maestro" />
            ) : (
              <div className="placeholder-avatar">
                {getInstructorInitials(selectedInstructor.name)}
              </div>
            )}

            {selectedInstructorBadges.length > 0 && (
              <div className="badgeRow">
                {selectedInstructorBadges.map((badge) => (
                  <span key={badge} className="instructorBadge">{badge}</span>
                ))}
              </div>
            )}

            <h2 style={{ margin: "0 0 8px 0" }}>{selectedInstructor.name || ""}</h2>
            <p style={{ margin: 0, color: "#cbd5e1" }}>{selectedInstructor.bio || ""}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label>Nome</label>
          <input
            placeholder="Il tuo nome"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />

          <label>Telefono</label>
          <input
            placeholder="+39..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <label>Messaggio</label>
          <div className="fieldHelp">
            <div className="fieldHelpTop">
              <div className="fieldHelpTitle">Come scrivere il messaggio</div>
              <button type="button" className="miniBtn" onClick={applyMessageTemplate}>
                Inserisci esempio
              </button>
            </div>
            <div>Include sempre: data e ora, durata, numero persone, livello, meeting point.</div>
            <div className="exampleBox">
              Domani 10:00, 2 ore, 2 persone, intermedio, Meeting Point Mottolino
            </div>
          </div>

          <textarea
            placeholder="Scrivi qui, seguendo l’esempio sopra"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <button className="button" type="submit" disabled={sending}>
            {sending ? "Invio in corso..." : "Invia richiesta"}
          </button>
        </form>

        {successMsg && <p id="success">{successMsg}</p>}
        {errorMsg && <p id="errorMsg">{errorMsg}</p>}

        {debug && <div className="debug">Debug: {JSON.stringify(debug, null, 2)}</div>}

        {altVisible && (
          <div className="card">
            <h3 style={{ margin: "0 0 10px 0" }}>Risposta</h3>
            <p style={{ color: "#e5e7eb", fontSize: 14, margin: 0 }}>{altMsg}</p>

            <div style={{ marginTop: 12 }}>
              {altAlternatives.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  className="button secondary"
                  onClick={async () => {
                    resetFeedback();
                    setAltVisible(true);
                    setAltMsg("Perfetto, sto confermando questa alternativa...");
                    setAltAlternatives([]);

                    await confirmBooking({
                      ...lastBasePayload,
                      chosen_start_time: a?.start_time || null,
                      chosen_end_time: a?.end_time || null,
                    });
                  }}
                >
                  {formatSlot(a.start_time, a.end_time)}
                </button>
              ))}
            </div>

            {altMeta ? <div className="smallMuted">{altMeta}</div> : null}
          </div>
        )}
      </div>

      {/* MINI CHAT MODAL */}
      <div id="chatOverlay" className={chatOpen ? "open" : ""}>
        <div id="chatModal">
          <div id="chatHeader">
            <div id="chatHeaderTitle">Completiamo la richiesta</div>
            <button id="chatClose" type="button" onClick={closeChat}>Chiudi</button>
          </div>

          <div className="chatInstructorInfo">
            {selectedInstructor
              ? `Stai chattando con: ${selectedInstructor.name || "FrostDesk"}`
              : "FrostDesk"}
          </div>

          <div id="chatBody" ref={chatBodyRef}>
            {chatMessages.map((m, i) => (
              <div
                key={i}
                className={`chatMsg ${m.role === "user" ? "user" : "ai"}`}
              >
                {m.label && <span className="chatMsgLabel">{m.label}</span>}
                {m.text}
              </div>
            ))}
          </div>

          <div id="chatMeta">
            <div>{chatMetaText}</div>
            {chatSending && <div className="chatMetaStatus">Invio in corso...</div>}
            {chatStatus?.text && (
              <div
                className={`chatMetaStatus ${
                  chatStatus.type === "error" ? "error" : "success"
                }`}
              >
                {chatStatus.text}
              </div>
            )}
          </div>

          <div className="chatActions">
            {showWhatsAppCTA ? (
              <div className="whatsappCTA">
                <button type="button" className="button secondary" onClick={onWhatsappClick}>
                  Continua su WhatsApp
                </button>
                <div className="whatsappMicro">Ti risponde subito il sistema di booking.</div>
              </div>
            ) : storedInstructor && storedInstructor.frostdesk_enabled === false ? (
              <div className="whatsappDisabled">Questo maestro risponde in app</div>
            ) : null}

            <button type="button" className="button secondary" onClick={copyTranscript}>
              Copy transcript
            </button>

            {MAESTRO_APP_URL && threadId && (
              <a
                className="button secondary chatLink"
                target="_blank"
                rel="noreferrer"
                href={`${MAESTRO_APP_URL}/maestro/inbox?threadId=${encodeURIComponent(threadId)}`}
              >
                Open in Maestro App
              </a>
            )}

            {copyStatus && <span className="chatToast">{copyStatus}</span>}
          </div>

          <div id="chatFooter">
            <input
              id="chatInput"
              placeholder="Scrivi qui..."
              autoComplete="off"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onChatSend();
                }
              }}
            />
            <button id="chatSend" type="button" disabled={chatSending} onClick={onChatSend}>
              {chatSending ? "..." : "Invia"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
