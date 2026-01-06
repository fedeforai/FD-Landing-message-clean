/* pages/index.js */
import { useEffect, useRef, useState } from "react";
import Head from "next/head";

const INSTRUCTORS_API_URL = "/api/instructors";
const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/dgt5e15smwx72qyn9dnfwlqwxu89xdak";
const MAKE_CONFIRM_WEBHOOK_URL = "PASTE_CONFIRM_WEBHOOK";
const WHATSAPP_BASE_LINK = process.env.NEXT_PUBLIC_WA_LINK || "WA_LINK";
const WHATSAPP_PREFILL_TEXT = encodeURIComponent("Ciao, voglio prenotare una lezione");

const CONVERSATION_KEY = "fd_conversation_id";
const CHAT_STORAGE_KEY = "fd_chat_session_id";
const THREAD_HISTORY_PREFIX = "fd_chat_history_";
const SELECTED_INSTRUCTOR_STORAGE_KEY = "frostdesk:selectedInstructor";
const THREAD_STORAGE_KEY = "frostdesk:threadId";
const MAESTRO_APP_URL = "https://app.frostdesk.io";
const BADGE_KEYWORDS = [
  { label: "Olympian", regex: /olympian/i },
  { label: "Ambassador", regex: /ambassador/i },
  { label: "Director", regex: /director/i },
];

/**
 * @typedef SelectedInstructor
 * @property {string} id
 * @property {string} name
 * @property {string | null | undefined} [slug]
 * @property {string | null | undefined} [photo_url]
 * @property {string | null | undefined} [whatsapp_number]
 * @property {boolean} frostdesk_enabled
 */

function safeLocalStorageGet(key) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

function safeLocalStorageSet(key, value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

function safeLocalStorageRemove(key) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

export function saveSelectedInstructor(i) {
  safeLocalStorageSet(SELECTED_INSTRUCTOR_STORAGE_KEY, JSON.stringify(i));
}

export function loadSelectedInstructor() {
  const raw = safeLocalStorageGet(SELECTED_INSTRUCTOR_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("Unable to parse selected instructor:", err);
    return null;
  }
}

export function clearSelectedInstructor() {
  safeLocalStorageRemove(SELECTED_INSTRUCTOR_STORAGE_KEY);
}

export function clearThreadId() {
  safeLocalStorageRemove(THREAD_STORAGE_KEY);
}

function getConversationId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CONVERSATION_KEY);
}
function setConversationId(id) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(CONVERSATION_KEY, id);
}

function getOrCreateChatSessionId() {
  if (typeof window === "undefined") return null;
  const existing = window.localStorage.getItem(CHAT_STORAGE_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "chat_" + Date.now();
  window.localStorage.setItem(CHAT_STORAGE_KEY, id);
  return id;
}

function getStoredThreadId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(THREAD_STORAGE_KEY);
}

function getOrCreateThreadId() {
  const existing = getStoredThreadId();
  if (existing) return existing;
  if (typeof window === "undefined") return null;
  const rand = Math.random().toString(16).slice(2);
  const tid = `thread-web-${Date.now()}-${rand}`;
  window.localStorage.setItem(THREAD_STORAGE_KEY, tid);
  return tid;
}

function newMessageId(prefix = "msg-web") {
  const rand = Math.random().toString(16).slice(2);
  return `${prefix}-${Date.now()}-${rand}`;
}

function safeText(v) {
  return (v ?? "").toString();
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
  return BADGE_KEYWORDS.filter(({ regex }) => regex.test(bio)).map(({ label }) => label);
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
function formatSlot(startISO, endISO) {
  try {
    const start = new Date(startISO);
    const end = new Date(endISO);
    const date = start.toLocaleDateString("it-IT", { day: "2-digit", month: "long" });
    const startTime = start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const endTime = end.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
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

export default function Home() {
  // stato principale
  const [instructors, setInstructors] = useState([]);
  const [instructorsLoading, setInstructorsLoading] = useState(true);
  const [selectedInstructorId, setSelectedInstructorId] = useState("");
  const [selectedInstructor, setSelectedInstructor] = useState(null);

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [altVisible, setAltVisible] = useState(false);
  const [altMsg, setAltMsg] = useState("");
  const [altMeta, setAltMeta] = useState("");
  const [altAlternatives, setAltAlternatives] = useState([]);

  const [sending, setSending] = useState(false);

  // mini-chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatMissingFields, setChatMissingFields] = useState([]);
  const [chatDraftFields, setChatDraftFields] = useState({});
  const [chatSessionId, setChatSessionIdState] = useState(null);
  const [threadId, setThreadId] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const [lastBasePayload, setLastBasePayload] = useState(null);

  // debug leggero per capire Make
  const [debug, setDebug] = useState(null);

  const chatBodyRef = useRef(null);

  // init
  useEffect(() => {
    setChatSessionIdState(getOrCreateChatSessionId());
    loadInstructors();
  }, []);

  function resetThreadContext() {
    if (typeof window !== "undefined") {
      const prevThreadId = window.localStorage.getItem(THREAD_STORAGE_KEY);
      if (prevThreadId) {
        window.localStorage.removeItem(THREAD_HISTORY_PREFIX + prevThreadId);
      }
    }
    clearThreadId();
    setThreadId("");
    setChatMessages([]);
  }

  useEffect(() => {
    const saved = loadSelectedInstructor();
    if (saved?.id) {
      setSelectedInstructorId(saved.id);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedId = getStoredThreadId();
    if (!storedId) return;
    setThreadId(storedId);
    const stored = window.localStorage.getItem(THREAD_HISTORY_PREFIX + storedId);
    if (stored) {
      try {
        setChatMessages(JSON.parse(stored));
        setTimeout(scrollChatToBottom, 50);
      } catch (err) {
        console.error("Failed to parse saved chat history:", err);
      }
    }
  }, []);

  useEffect(() => {
    if (!threadId || typeof window === "undefined") return;
    window.localStorage.setItem(THREAD_HISTORY_PREFIX + threadId, JSON.stringify(chatMessages));
  }, [chatMessages, threadId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedInstructorId) {
      setSelectedInstructor(null);
      return;
    }

    async function fetchInstructor() {
      try {
        const url = INSTRUCTORS_API_URL + "?id=" + encodeURIComponent(selectedInstructorId);
        const res = await fetch(url, { method: "GET" });
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json || json.ok !== true || !json.data) {
          const msg = json?.error ? String(json.error) : "HTTP " + res.status;
          setErrorMsg("Errore caricamento maestro selezionato.\n" + msg);
          return;
        }

        if (!cancelled) {
          setSelectedInstructor(json.data);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Errore loadInstructor:", err);
        setErrorMsg("Errore rete nel caricamento maestro.");
      }
    }

    fetchInstructor();

    return () => {
      cancelled = true;
    };
  }, [selectedInstructorId]);

  useEffect(() => {
    if (selectedInstructor) {
      saveSelectedInstructor({
        id: selectedInstructor.id,
        name: selectedInstructor.name,
        slug: selectedInstructor.slug ?? null,
        photo_url: selectedInstructor.photo_url ?? null,
        whatsapp_number: selectedInstructor.whatsapp_number ?? null,
        frostdesk_enabled: Boolean(selectedInstructor.frostdesk_enabled),
      });
    } else {
      clearSelectedInstructor();
    }
  }, [selectedInstructor]);

  function resetFeedback() {
    setSuccessMsg("");
    setErrorMsg("");
    setAltVisible(false);
    setAltMsg("");
    setAltMeta("");
    setAltAlternatives([]);
    setDebug(null);
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
      console.error("Errore loadInstructors:", err);
      setErrorMsg("Errore rete nel caricamento maestri.");
      setInstructorsLoading(false);
    }
  }

  function handleSelectChange(e) {
    const id = e.target.value;
    resetFeedback();
    resetThreadContext();
    setSelectedInstructorId(id);
    if (!id) {
      setSelectedInstructor(null);
      return;
    }

  }
  async function onWhatsappClick(event) {
    event.preventDefault();
    const selected = loadSelectedInstructor();
    if (!selected) return;

    const externalThreadId = getOrCreateThreadId();
    if (!externalThreadId) {
      console.warn("CTA clicked but thread id missing");
      return;
    }

    const payload = {
      channel: "webchat",
      external_thread_id: externalThreadId,
      external_message_id: newMessageId("cta-web"),
      from: {
        handle: "webchat",
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
    } catch (err) {
      console.error("Errore tracking CTA WhatsApp:", err);
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
    const template = "Domani 10:00, 2 ore, 2 persone, intermedio, Meeting Point Mottolino";
    setMessage((prev) => {
      const p = safeText(prev).trim();
      return p ? p : template;
    });
  }

  // heuristics super light per checklist
  function guessChecklist(msg) {
    const m = safeText(msg).toLowerCase();
    const hasPeople = /\b(\d+)\s*(persone|people|pax)\b/.test(m) || /\b(1|2|3|4|5)\b/.test(m);
    const hasLevel = /\b(principiante|beginner|intermedio|intermediate|avanzato|advanced)\b/.test(m);
    const hasDuration = /\b(\d+)\s*(h|hr|hrs|ore|hours|min|mins|minuti)\b/.test(m) || /\b(1h|2h|3h)\b/.test(m);
    const hasTime = /\b\d{1,2}[:.]\d{2}\b/.test(m) || /\b(mattina|pomeriggio|morning|afternoon)\b/.test(m);
    const hasDate = /\b(oggi|domani|sabato|domenica|lunedì|martedì|mercoledì|giovedì|venerdì|today|tomorrow|sat|sun|mon|tue|wed|thu|fri|next)\b/.test(m) || /\b\d{1,2}\/\d{1,2}\b/.test(m);
    const hasLocation = /\b(meeting point|meeting|mottolino|carosello|centro|hotel|lift|funivia|piazza)\b/.test(m);

    return {
      dateTime: hasDate && hasTime,
      duration: hasDuration,
      location: hasLocation,
      level: hasLevel,
      participants: hasPeople,
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    resetFeedback();

    if (!selectedInstructor) {
      alert("Seleziona prima un maestro");
      return;
    }

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
    };

    setLastBasePayload(payload);
    setChatMissingFields([]);
    setChatDraftFields({});
    await callMakeEndpoint(payload);
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
      let data;
      if (contentType.includes("application/json")) data = await res.json();
      else data = { ok: res.ok, message: await res.text() };

      // debug minimo utile
      setDebug({
        ok: !!data?.ok,
        status: data?.status || null,
        missing_fields: Array.isArray(data?.missing_fields) ? data.missing_fields : null,
      });

      if (data && data.conversation_id) {
        setConversationId(data.conversation_id);
      }

      if (!res.ok) {
        setErrorMsg(normalizeMessage(data?.message) || "Errore nell'invio.");
        setSending(false);
        return;
      }

      const normalizedMsg = normalizeMessage(data?.message);

      if (data?.status === "ask_info") {
        setAltVisible(true);
        setAltMsg(normalizedMsg);
        setSending(false);
        return;
      }

      if (data?.status === "need_more_info") {
        const mf = Array.isArray(data?.missing_fields) ? data.missing_fields : [];
        openChat(normalizedMsg, mf);
        setSending(false);
        return;
      }

      if (data?.status === "slot_busy") {
        const alts = Array.isArray(data?.alternatives) ? data.alternatives : [];
        renderAlternatives(normalizedMsg, alts);
        setSending(false);
        return;
      }

      if (data?.ok === true) {
        setSuccessMsg(normalizedMsg || "Richiesta inviata con successo.");
        setSending(false);
        return;
      }

      setAltVisible(true);
      setAltMsg(normalizedMsg);
      setSending(false);
    } catch (err) {
      console.error("Errore fetch verso Make:", err);
      setErrorMsg("Errore rete.");
      setSending(false);
    }
  }

  function renderAlternatives(message, alternatives) {
    setAltVisible(true);
    setAltMsg(message || "Quello slot è già occupato. Ti propongo alcune alternative:");
    const firstTwo = (alternatives || []).slice(0, 2);
    setAltAlternatives(firstTwo);

    if (firstTwo.length === 0) {
      setAltMsg("Mi dispiace, ma non ho alternative immediate. Puoi indicarmi un altro orario?");
    }
  }

  async function confirmBooking(payload) {
    if (!MAKE_CONFIRM_WEBHOOK_URL || MAKE_CONFIRM_WEBHOOK_URL.includes("PASTE_")) {
      setErrorMsg("Manca MAKE_CONFIRM_WEBHOOK_URL. Incolla l'URL del webhook di conferma.");
      return;
    }

    try {
      const res = await fetch(MAKE_CONFIRM_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) data = await res.json();
      else data = { ok: res.ok, message: await res.text() };

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
      const inst = safeText(data?.instructor_name || payload?.instructor_name || "");

      const lines = [];
      if (inst) lines.push(`Maestro: ${inst}`);
      if (st && en) lines.push(`Orario: ${formatSlot(st, en)}`);
      if (ref) lines.push(`Riferimento: ${ref}`);
      setAltMeta(lines.join(" | "));
    } catch (err) {
      console.error("Errore confirmBooking:", err);
      setErrorMsg("Errore rete nella conferma.");
    }
  }

  // === mini chat ===
  function openChat(initialAiMessage, missingFields) {
    setChatMissingFields(Array.isArray(missingFields) ? missingFields : []);
    const aiLabel = selectedInstructor
      ? `${selectedInstructor.name || "FrostDesk"} (FrostDesk)`
      : "FrostDesk";
    setChatMessages([
      {
        role: "ai",
        text: initialAiMessage || "Dimmi pure i dettagli mancanti.",
        label: aiLabel,
      },
    ]);
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

  async function copyTranscript() {
    if (typeof window === "undefined" || !threadId) return;
    const transcript = {
      channel: "webchat",
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
    } catch (err) {
      console.error("Unable to copy transcript:", err);
      setCopyStatus("Copy failed");
    } finally {
      setTimeout(() => setCopyStatus(""), 2000);
    }
  }

  function scrollChatToBottom() {
    if (!chatBodyRef.current) return;
    chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }

  async function onChatSend() {
    const userText = safeText(chatText).trim();
    if (!userText) return;

    const currentThreadId = getOrCreateThreadId();
    if (!currentThreadId) {
      console.warn("Unable to send message: missing thread id");
      return;
    }
    setThreadId(currentThreadId);
    const externalMessageId = newMessageId("msg-web");
    const aiLabel = selectedInstructor
      ? `${selectedInstructor.name || "FrostDesk"} (FrostDesk)`
      : "FrostDesk";

    addChatMsg("user", userText);
    setChatText("");
    setChatSending(true);

    const selected = loadSelectedInstructor();
    const payload = {
      channel: "webchat",
      external_thread_id: currentThreadId,
      external_message_id: externalMessageId,
      from: {
        handle: "webchat",
        display_name: "Website Visitor",
        phone_or_email: "unknown",
      },
      timestamp: new Date().toISOString(),
      text: userText,
      ...(selected?.id ? { instructor_id: selected.id } : {}),
    };

    console.log("Sending chat payload", {
      threadId: currentThreadId,
      instructorId: selected?.id ?? null,
    });

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data = null;
      try {
        data = await res.json();
      } catch (parseErr) {
        console.error("Unable to parse orchestration response:", parseErr);
      }

      if (!res.ok) {
        addChatMsg("ai", "Errore nella chat. Riprova tra pochi secondi.");
        return;
      }

      const staticFallback = "Ok, ricevuto.";
      const replyText = normalizeMessage(
        (data?.replyText ?? data?.message) || staticFallback
      );
      addChatMsg("ai", replyText, aiLabel);
    } catch (err) {
      console.error("Errore mini chat:", err);
      addChatMsg("ai", "Errore rete. Riprova tra pochi secondi.", aiLabel);
    } finally {
      setChatSending(false);
    }
  }

  // meta per la chat
  const chatMetaText =
    chatMissingFields.length > 0
      ? "Mi servono: " + chatMissingFields.join(", ")
      : "Rispondi qui con i dettagli.";

  const checklist = guessChecklist(message);
  const selectedInstructorBadges = selectedInstructor
    ? getInstructorBadges(selectedInstructor.bio)
    : [];
  const storedInstructor = loadSelectedInstructor();
  const showWhatsAppCTA = Boolean(storedInstructor && storedInstructor.frostdesk_enabled);

  return (
    <>
      <Head>
        <title>FrostDesk Booking</title>
        <meta name="description" content="Prenota una lezione di sci in 30 secondi. FrostDesk controlla l’agenda del maestro e gestisce la richiesta." />
        <meta name="author" content="FrostDesk" />
        <meta property="og:title" content="FrostDesk Booking" />
        <meta property="og:description" content="Scrivi al maestro. FrostDesk controlla l’agenda e ti propone subito lo slot giusto." />
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
          .miniBtn:hover {
            background: #171a22;
            transform: translateY(-1px);
          }
          .exampleBox {
            margin-top: 8px;
            border-radius: 12px;
            border: 1px solid #2f333a;
            background: #111318;
            padding: 10px 12px;
            color: #e5e7eb;
            font-size: 13px;
          }
          .chips {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
          }
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
          .chip:hover {
            background: #171a22;
            transform: translateY(-1px);
          }
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
          .dot {
            width: 10px;
            height: 10px;
            border-radius: 999px;
            background: #374151;
          }
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
          .button:hover {
            background-color: #2563eb;
            transform: translateY(-1px);
          }
          .button.secondary {
            background-color: #111318;
            border: 1px solid #3d414a;
            font-size: 16px;
            margin-top: 10px;
          }
          .button.secondary:hover {
            background-color: #171a22;
            transform: translateY(-1px);
          }
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
          .badgeRow {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 6px;
          }
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
          .smallMuted {
            margin-top: 10px;
            font-size: 12px;
            color: #9ca3af;
          }
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
          .chatActions {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 16px;
            border-bottom: 1px solid #2f333a;
            background: #0e0f12;
          }
          .chatActions .chatToast {
            font-size: 12px;
            color: #34d399;
            margin-left: auto;
          }
          .chatLink {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            text-decoration: none;
          }
          .whatsappCTA {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .whatsappMicro {
            font-size: 11px;
            color: #94a3b8;
          }
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
              background: "#0e0f12"
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
            <div className="checkItem" style={{ gridColumn: "1 / -1" }}><span className={`dot ${checklist.location ? "ok" : ""}`} /> Location / Meeting point</div>
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
              <img
                id="photo"
                src={selectedInstructor.photo_url}
                alt="Foto maestro"
              />
            ) : (
              <div className="placeholder-avatar">
                {getInstructorInitials(selectedInstructor.name)}
              </div>
            )}
            {selectedInstructorBadges.length > 0 && (
              <div className="badgeRow">
                {selectedInstructorBadges.map((badge) => (
                  <span key={badge} className="instructorBadge">
                    {badge}
                  </span>
                ))}
              </div>
            )}
            <h2 id="name" style={{ margin: "0 0 8px 0" }}>
              {selectedInstructor.name || ""}
            </h2>
            <p id="bio" style={{ margin: 0, color: "#cbd5e1" }}>
              {selectedInstructor.bio || ""}
            </p>
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

        {debug && (
          <div className="debug">
            Debug: {JSON.stringify(debug, null, 2)}
          </div>
        )}

        {altVisible && (
          <div id="altBox" className="card">
            <h3 style={{ margin: "0 0 10px 0" }}>Risposta</h3>
            <p id="altMsg" style={{ color: "#e5e7eb", fontSize: 14, margin: 0 }}>
              {altMsg}
            </p>

            <div id="altList" style={{ marginTop: 12 }}>
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
            <button id="chatClose" type="button" onClick={closeChat}>
              Chiudi
            </button>
          </div>
          <div className="chatInstructorInfo">
            {selectedInstructor
              ? `Stai chattando con: ${selectedInstructor.name || "FrostDesk"}`
              : "FrostDesk"}
          </div>

          <div id="chatBody" ref={chatBodyRef}>
            {chatMessages.map((m, i) => (
              <div key={i} className={`chatMsg ${m.role === "user" ? "user" : "ai"}`}>
                {m.label && (
                  <span className="chatMsgLabel">{m.label}</span>
                )}
                {m.text}
              </div>
            ))}
          </div>

          <div id="chatMeta">{chatMetaText}</div>
          <div className="chatActions">
            {showWhatsAppCTA ? (
              <div className="whatsappCTA">
                <button
                  type="button"
                  className="button secondary"
                  onClick={onWhatsappClick}
                >
                  Continua su WhatsApp
                </button>
                <div className="whatsappMicro">
                  Ti risponde subito il sistema di booking.
                </div>
              </div>
            ) : storedInstructor && storedInstructor.frostdesk_enabled === false ? (
              <div className="whatsappDisabled">
                Questo maestro risponde in app
              </div>
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
            <button
              id="chatSend"
              type="button"
              disabled={chatSending}
              onClick={onChatSend}
            >
              {chatSending ? "..." : "Invia"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
