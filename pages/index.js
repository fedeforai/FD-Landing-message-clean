/* pages/index.js
   FrostDesk Landing - Minimal conversion-focused page
   
   Features:
   - Instructor list (sorted alphabetically, with avatars/badges)
   - Chat widget (sends to /api/ingest)
   - WhatsApp CTA (conditional visibility)
   - Event tracking (select_instructor, cta_click)
   - localStorage for thread_id and instructor_id
*/

import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import {
  getExternalThreadId,
  getOrCreateExternalThreadId,
  getSelectedInstructorId,
  setExternalThreadId,
  setSelectedInstructorId,
  getOrCreateTraceId,
  getClientName,
  setClientName,
  getClientPhone,
  setClientPhone,
} from "../lib/storage";
import { sendChatMessage, trackEvent, fetchInstructors, fetchInstructor } from "../lib/api";
import { getInstructorInitials, getInstructorBadges, buildWhatsAppLink, generateIdempotencyKey, generateUUID } from "../lib/utils";
import * as Sentry from "@sentry/nextjs";

export default function Home() {
  // State
  const [clientName, setClientNameState] = useState("");
  const [clientPhone, setClientPhoneState] = useState("");
  const [showClientForm, setShowClientForm] = useState(true);
  const [instructors, setInstructors] = useState([]);
  const [instructorsLoading, setInstructorsLoading] = useState(true);
  const [selectedInstructorId, setSelectedInstructorIdState] = useState("");
  const [selectedInstructor, setSelectedInstructor] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [messageCount, setMessageCount] = useState(0); // Track messages for CTA visibility
  const [messageSuggestions] = useState([
    "Ciao! Vorrei prenotare una lezione",
    "Quali sono i tuoi orari disponibili?",
    "Sono principiante, puoi aiutarmi?",
    "Quanto costa una lezione?",
    "Hai disponibilità questo weekend?",
  ]);

  const chatBodyRef = useRef(null);
  const externalThreadIdRef = useRef(null);
  const honeypotFieldRef = useRef(null);
  const traceIdRef = useRef(null);
  
  // Message state machine: sending -> delivered -> waiting -> replied | fallback
  // State tracking for pending messages
  const pendingMessagesRef = useRef(new Map()); // Map<idempotency_key, { timeoutId, state }>
  
  // Timeout configuration
  const AI_RESPONSE_TIMEOUT = 30000; // 30 seconds for AI response
  const FALLBACK_MESSAGE_DELAY = 10000; // 10 seconds before showing fallback
  
  // Anti-spam: minimum time between form render and submit (2 seconds)
  const MIN_SUBMIT_TIME = 2000; // 2 seconds
  const formRenderTimeRef = useRef(Date.now());

  // Initialize: load instructors and restore selected instructor
  useEffect(() => {
    async function init() {
      // Load instructors
      const list = await fetchInstructors();
      setInstructors(list);
      setInstructorsLoading(false);

      // Restore client info from localStorage
      const savedName = getClientName();
      const savedPhone = getClientPhone();
      if (savedName && savedPhone) {
        setClientNameState(savedName);
        setClientPhoneState(savedPhone);
        setShowClientForm(false);
      }

      // Restore selected instructor from localStorage
      const savedInstructorId = getSelectedInstructorId();
      if (savedInstructorId) {
        setSelectedInstructorIdState(savedInstructorId);
        const instructor = await fetchInstructor(savedInstructorId);
        if (instructor) {
          setSelectedInstructor(instructor);
        }
      }

      // Ensure thread ID exists
      const threadId = getOrCreateExternalThreadId();
      externalThreadIdRef.current = threadId;

      // Ensure trace_id exists (one per session/thread)
      const traceId = getOrCreateTraceId();
      traceIdRef.current = traceId;
    }

    init();
  }, []);

  // Handle client form submission
  function handleClientFormSubmit(e) {
    e.preventDefault();
    if (!clientName.trim() || !clientPhone.trim()) {
      alert("Please fill in both name and phone number");
          return;
        }

    setClientName(clientName.trim());
    setClientPhone(clientPhone.trim());
    setShowClientForm(false);
  }

  // Scroll chat to bottom when messages change
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Cleanup pending messages on unmount
  useEffect(() => {
    return () => {
      // Clear all pending timeouts
      pendingMessagesRef.current.forEach((pending) => {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
      });
      pendingMessagesRef.current.clear();
    };
  }, []);

  // Handle instructor selection
  async function handleInstructorSelect(instructorId) {
    if (!instructorId) {
      setSelectedInstructorIdState("");
      setSelectedInstructor(null);
      setSelectedInstructorId("");
      return;
    }

    setSelectedInstructorIdState(instructorId);
    setSelectedInstructorId(instructorId);

    const instructor = await fetchInstructor(instructorId);
    if (instructor) {
      setSelectedInstructor(instructor);
    }

    // Track select_instructor event
    const threadId = getOrCreateExternalThreadId();
    externalThreadIdRef.current = threadId;
    await trackEvent({
      external_thread_id: threadId,
      instructor_id: instructorId,
      intent: "select_instructor",
    });
  }

  // Rate limiting: prevent sending if already sending
  const lastSendTimeRef = useRef(0);
  const MIN_SEND_INTERVAL = 1000; // 1 second minimum between sends

  // Update message state in the UI
  function updateMessageState(idempotencyKey, updates) {
    setChatMessages((prev) =>
      prev.map((msg) =>
        msg.idempotency_key === idempotencyKey ? { ...msg, ...updates } : msg
      )
    );
  }

  // Clean up pending message timeout
  function cleanupPendingMessage(idempotencyKey) {
    const pending = pendingMessagesRef.current.get(idempotencyKey);
    if (pending?.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    pendingMessagesRef.current.delete(idempotencyKey);
  }

  async function handleChatSend() {
    const text = chatInput.trim();
    if (!text || chatSending) return;

    if (!selectedInstructorId) {
      alert("Please select an instructor first");
      return;
    }

    // Rate limiting check
    const now = Date.now();
    if (now - lastSendTimeRef.current < MIN_SEND_INTERVAL) {
      return; // Too soon, ignore
    }
    lastSendTimeRef.current = now;

    // Anti-spam: minimum submit time check
    const timeSinceRender = now - formRenderTimeRef.current;
    if (timeSinceRender < MIN_SUBMIT_TIME) {
      // Silently ignore - likely bot
      console.warn('Message rejected: submit time too fast', timeSinceRender);
      return;
    }

    // Validate message length
    if (text.length > 5000) {
      alert(`Message too long. Maximum 5000 characters allowed.`);
      return;
    }

    const threadId = getOrCreateExternalThreadId();
    externalThreadIdRef.current = threadId;

    // Get or create trace_id (one per session/thread, persisted in localStorage)
    // trace_id: generato una volta per sessione/thread, persistito e riutilizzato
    const traceId = getOrCreateTraceId();
    traceIdRef.current = traceId;

    // Generate identifiers
    // external_message_id: sempre generato per idempotenza nei retry (nuovo per ogni messaggio)
    const externalMessageId = generateUUID();
    const idempotencyKey = generateIdempotencyKey();
    
    // Honeypot field (should be empty for real users)
    // Check if honeypot field was filled (bots will fill it)
    const honeypot = honeypotFieldRef.current ? honeypotFieldRef.current.value : "";

    // Validate payload before sending
    if (!threadId || !selectedInstructorId || !text || !traceId) {
      console.error('[CLIENT] Missing required fields before send:', {
        has_threadId: !!threadId,
        has_instructorId: !!selectedInstructorId,
        has_text: !!text,
        has_traceId: !!traceId,
      });
      alert("Missing required information. Please refresh the page and try again.");
      return;
    }

    // Add user message immediately with state machine
    const userMessage = {
      role: "user",
      text,
      idempotency_key: idempotencyKey,
      trace_id: traceId,
      external_message_id: externalMessageId,
      state: "sending",
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatSending(true);

    // Log payload being sent
    console.log('[CLIENT] Sending message payload:', {
      external_thread_id: threadId,
      instructor_id: selectedInstructorId,
      text_length: text.length,
      has_idempotency_key: !!idempotencyKey,
      trace_id: traceId,
      external_message_id: externalMessageId,
      has_client_name: !!clientName,
      has_client_phone: !!clientPhone,
    });

    // Log to Sentry (non-blocking)
    Sentry.addBreadcrumb({
      category: 'message',
      message: 'Sending message',
      level: 'info',
      data: {
        trace_id: traceId,
        external_message_id: externalMessageId,
        external_thread_id: threadId,
        instructor_id: selectedInstructorId,
        text_length: text.length,
      },
    });

    // Set up timeout for slow response handling
    const timeoutId = setTimeout(() => {
      updateMessageState(idempotencyKey, { state: "waiting" });
      
      // Show fallback message after additional delay
      setTimeout(() => {
        const pending = pendingMessagesRef.current.get(idempotencyKey);
        if (pending && pending.state === "waiting") {
          updateMessageState(idempotencyKey, { state: "fallback" });
          // Add fallback message
          setChatMessages((prev) => [
            ...prev,
            {
              role: "ai",
              text: "I'm taking a bit longer than usual. Your instructor will reply soon, or you can continue on WhatsApp for faster response.",
              state: "fallback",
              isFallback: true,
            },
          ]);
        }
      }, FALLBACK_MESSAGE_DELAY);
    }, AI_RESPONSE_TIMEOUT);

    // Track pending message
    pendingMessagesRef.current.set(idempotencyKey, {
      timeoutId,
      state: "sending",
    });

    try {
      const result = await sendChatMessage({
        external_thread_id: threadId,
        instructor_id: selectedInstructorId,
        text,
        idempotency_key: idempotencyKey,
        trace_id: traceId,
        external_message_id: externalMessageId,
        submit_time: formRenderTimeRef.current,
        honeypot: honeypot,
        client_name: clientName,
        client_phone: clientPhone,
      });

      // Clear timeout since we got a response
      cleanupPendingMessage(idempotencyKey);

      // Log outcome to Sentry
      if (result.ok) {
        // Debug logging
        console.log('[CLIENT] Message response:', {
          ok: result.ok,
          has_replyText: !!result.replyText,
          replyText: result.replyText?.substring(0, 100) || null,
          handoff_to_human: result.handoff_to_human,
          conversation_id: result.conversation_id,
          trace_id: result.trace_id,
        });

        Sentry.addBreadcrumb({
          category: 'message',
          message: 'Message sent successfully',
          level: 'info',
          data: {
            trace_id: result.trace_id || traceId,
            conversation_id: result.conversation_id,
            message_id: result.message_id,
            has_reply: !!result.replyText,
            replyText_length: result.replyText?.length || 0,
          },
        });
        
        // Update message state to delivered
        updateMessageState(idempotencyKey, { 
          state: "delivered",
          trace_id: result.trace_id || traceId,
          conversation_id: result.conversation_id,
          message_id: result.message_id,
        });

        // Check if conversation was handed off to human
        if (result.handoff_to_human) {
          // Handoff to human - show appropriate message
          updateMessageState(idempotencyKey, { state: "delivered" });
          setChatMessages((prev) => [
            ...prev,
            {
              role: "system",
              text: "Your conversation has been handed off to a human. They will reply soon.",
              state: "handoff",
              isHandoff: true,
            },
          ]);
          setMessageCount((prev) => prev + 1);
        } else if (result.replyText && result.replyText.trim().length > 0) {
          // We have an AI reply
          console.log('[CLIENT] Adding AI reply to chat:', result.replyText.substring(0, 100));
          setChatMessages((prev) => [
            ...prev,
            {
              role: "ai",
              text: result.replyText.trim(),
              state: "replied",
              trace_id: result.trace_id,
              conversation_id: result.conversation_id,
            },
          ]);
          setMessageCount((prev) => prev + 1);
      } else {
          // No immediate reply - show waiting state
          console.log('[CLIENT] No replyText received, showing waiting message');
          updateMessageState(idempotencyKey, { state: "waiting" });
          setChatMessages((prev) => [
            ...prev,
            {
              role: "ai",
              text: "Your instructor will reply soon. You can continue on WhatsApp for faster response.",
              state: "waiting",
              isWaiting: true,
            },
          ]);
        }
      } else {
        // Error response - log to Sentry
        Sentry.captureMessage('Message send failed', {
          level: 'error',
          tags: {
            error_code: result.error_code || 'UNKNOWN',
            status_code: result.statusCode,
          },
          extra: {
            trace_id: result.trace_id || traceId,
            external_thread_id: threadId,
            instructor_id: selectedInstructorId,
            error: result.error,
          },
        });

        // Update user message state to show it was delivered but failed
        // Don't mark user message as error - only the error response message should be marked as error
        updateMessageState(idempotencyKey, { 
          state: "delivered", // Mark as delivered even if there was an error
          trace_id: result.trace_id || traceId,
        });
        
        // Display user-friendly error message
        const errorMessage = result.error || "Sorry, there was an error. Please try again.";
        setChatMessages((prev) => [
          ...prev,
        {
          role: "ai",
            text: errorMessage,
            isError: true,
            trace_id: result.trace_id || traceId,
          },
        ]);
      }
    } catch (err) {
      // Network error - log to Sentry
      Sentry.captureException(err, {
        tags: {
          error_code: 'NETWORK_ERROR',
        },
        extra: {
          trace_id: traceId,
      external_thread_id: threadId,
          instructor_id: selectedInstructorId,
        },
      });

      cleanupPendingMessage(idempotencyKey);
      // Update user message state - don't mark as error, just mark as delivered
      updateMessageState(idempotencyKey, { 
        state: "delivered", // Mark as delivered even if there was a network error
      });
      
      setChatMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: "Network error. Please check your connection and try again.",
          isError: true,
          trace_id: traceId,
        },
      ]);
    } finally {
      setChatSending(false);
    }
  }

  // Handle WhatsApp CTA click
  async function handleWhatsAppClick() {
    if (!selectedInstructor || !selectedInstructor.frostdesk_enabled) return;

    const link = buildWhatsAppLink(selectedInstructor);
    if (!link) {
      alert("WhatsApp link not available");
      return;
    }

    // Track cta_click event
    const threadId = getOrCreateExternalThreadId();
    await trackEvent({
      external_thread_id: threadId,
      instructor_id: selectedInstructor.id,
      intent: "cta_click",
      metadata: {
        cta_type: "whatsapp",
      },
    });

    window.open(link, "_blank", "noopener,noreferrer");
  }

  // Determine if WhatsApp CTA should be visible
  const showWhatsAppCTA =
    selectedInstructor &&
    selectedInstructor.frostdesk_enabled === true &&
    messageCount >= 1; // Optional: show after at least 1 message

  const selectedInstructorBadges = selectedInstructor
    ? getInstructorBadges(selectedInstructor.bio)
    : [];

  return (
    <>
      <Head>
        <title>FrostDesk - Book a Lesson</title>
        <meta
          name="description"
          content="Book a ski lesson in under 2 minutes. Select an instructor and start chatting."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <style>{`
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            background-attachment: fixed;
            min-height: 100vh;
            color: #1a1a1a;
            line-height: 1.6;
          }
          .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 40px 24px;
          }
          .header {
            text-align: center;
            margin-bottom: 48px;
            color: white;
            animation: fadeInDown 0.6s ease-out;
          }
          @keyframes fadeInDown {
            from {
              opacity: 0;
              transform: translateY(-20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .header h1 {
            font-size: 48px;
            font-weight: 800;
            margin: 0 0 12px 0;
            text-shadow: 0 2px 8px rgba(0,0,0,0.15);
            letter-spacing: -0.5px;
          }
          .header p {
            font-size: 20px;
            margin: 0;
            opacity: 0.95;
            font-weight: 400;
            letter-spacing: 0.2px;
          }
          .main-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 32px;
            margin-bottom: 32px;
            animation: fadeInUp 0.8s ease-out 0.2s both;
          }
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @media (max-width: 968px) {
            .main-content {
              grid-template-columns: 1fr;
              gap: 24px;
            }
            .container {
              padding: 24px 16px;
            }
            .header h1 {
              font-size: 36px;
            }
            .header p {
              font-size: 18px;
            }
          }
          .panel {
            background: white;
            border-radius: 20px;
            padding: 32px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.05);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          .panel:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 48px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08);
          }
          .panel h2 {
            margin: 0 0 24px 0;
            font-size: 24px;
            font-weight: 700;
            color: #1a1a1a;
            letter-spacing: -0.3px;
          }
          .instructor-list {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .instructor-item {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 20px;
            border: 2px solid transparent;
            border-radius: 16px;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            background: #f9fafb;
            position: relative;
            overflow: hidden;
          }
          .instructor-item::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 4px;
            height: 100%;
            background: #667eea;
            transform: scaleY(0);
            transition: transform 0.3s ease;
          }
          .instructor-item:hover {
            background: #f3f4f6;
            border-color: #667eea;
            transform: translateX(4px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
          }
          .instructor-item:hover::before {
            transform: scaleY(1);
          }
          .instructor-item.selected {
            border-color: #667eea;
            background: linear-gradient(135deg, #eef2ff 0%, #f5f7ff 100%);
            box-shadow: 0 4px 16px rgba(102, 126, 234, 0.2);
            transform: translateX(4px);
          }
          .instructor-item.selected::before {
            transform: scaleY(1);
          }
          .instructor-avatar {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            object-fit: cover;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            color: white;
            flex-shrink: 0;
            font-size: 20px;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          .instructor-item:hover .instructor-avatar {
            transform: scale(1.05);
            box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
          }
          .instructor-avatar img {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            object-fit: cover;
          }
          .instructor-info {
            flex: 1;
            min-width: 0;
          }
          .instructor-name {
            font-weight: 600;
            margin: 0 0 6px 0;
            font-size: 18px;
            color: #1a1a1a;
            letter-spacing: -0.2px;
          }
          .instructor-bio {
            font-size: 14px;
            color: #6b7280;
            margin: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            line-height: 1.5;
          }
          .instructor-badges {
            display: flex;
            gap: 8px;
            margin-top: 8px;
            flex-wrap: wrap;
          }
          .badge {
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            box-shadow: 0 2px 4px rgba(102, 126, 234, 0.2);
            transition: transform 0.2s ease;
          }
          .badge:hover {
            transform: translateY(-1px);
          }
          .chat-widget {
            display: flex;
            flex-direction: column;
            height: 650px;
          }
          .chat-header {
            padding-bottom: 16px;
            border-bottom: 2px solid #e5e7eb;
            margin-bottom: 16px;
          }
          .chat-header-title {
            font-weight: 700;
            margin: 0 0 8px 0;
            font-size: 20px;
            color: #1a1a1a;
            letter-spacing: -0.3px;
          }
          .chat-header-instructor {
            font-size: 15px;
            color: #6b7280;
            margin: 0;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .chat-header-instructor::before {
            content: '💬';
            font-size: 16px;
          }
          .chat-messages {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin-bottom: 16px;
            padding-right: 8px;
            scroll-behavior: smooth;
          }
          .chat-messages::-webkit-scrollbar {
            width: 6px;
          }
          .chat-messages::-webkit-scrollbar-track {
            background: #f3f4f6;
            border-radius: 10px;
          }
          .chat-messages::-webkit-scrollbar-thumb {
            background: #d1d5db;
            border-radius: 10px;
          }
          .chat-messages::-webkit-scrollbar-thumb:hover {
            background: #9ca3af;
          }
          .chat-message {
            padding: 14px 18px;
            border-radius: 18px;
            max-width: 80%;
            word-wrap: break-word;
            animation: slideIn 0.3s ease-out;
            line-height: 1.5;
          }
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .chat-message.user {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
          }
          .chat-message.ai {
            background: #f3f4f6;
            color: #1a1a1a;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
          }
          .chat-message.error {
            background: #fee2e2;
            color: #991b1b;
            border: 1px solid #fecaca;
            align-self: flex-start;
          }
          .chat-message.waiting {
            background: #fef3c7;
            color: #92400e;
            border: 1px solid #fde68a;
            align-self: flex-start;
          }
          .chat-message.fallback {
            background: #dbeafe;
            color: #1e40af;
            border: 1px solid #93c5fd;
            align-self: flex-start;
          }
          .chat-message-state {
            font-size: 10px;
            opacity: 0.7;
            margin-top: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .chat-message.sending .chat-message-state::after {
            content: "Sending...";
          }
          .chat-message.delivered .chat-message-state::after {
            content: "Delivered";
          }
          .chat-message.waiting .chat-message-state::after {
            content: "Waiting for reply...";
          }
          .chat-input-area {
            display: flex;
            gap: 12px;
            padding-top: 16px;
            border-top: 2px solid #e5e7eb;
          }
          .chat-input {
            flex: 1;
            padding: 14px 18px;
            border: 2px solid #d1d5db;
            border-radius: 12px;
            font-size: 15px;
            transition: all 0.2s ease;
            font-family: inherit;
          }
          .chat-input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          }
          .chat-input:disabled {
            background: #f3f4f6;
            cursor: not-allowed;
          }
          .chat-send {
            padding: 14px 28px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            font-size: 15px;
          }
          .chat-send:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
          }
          .chat-send:active:not(:disabled) {
            transform: translateY(0);
          }
          .chat-send:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
          }
          .whatsapp-cta {
            margin-top: 20px;
            padding: 16px 24px;
            background: #25d366;
            color: white;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.3s ease;
            width: 100%;
            box-shadow: 0 4px 12px rgba(37, 211, 102, 0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
          }
          .whatsapp-cta::before {
            content: '💬';
            font-size: 20px;
          }
          .whatsapp-cta:hover {
            background: #20ba5a;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(37, 211, 102, 0.4);
          }
          .whatsapp-cta:active {
            transform: translateY(0);
          }
          .loading {
            text-align: center;
            padding: 40px 24px;
            color: #6b7280;
            font-size: 15px;
          }
          .loading::after {
            content: '...';
            animation: dots 1.5s steps(4, end) infinite;
          }
          @keyframes dots {
            0%, 20% { content: '.'; }
            40% { content: '..'; }
            60%, 100% { content: '...'; }
          }
          .empty-state {
            text-align: center;
            padding: 60px 24px;
            color: #9ca3af;
            font-size: 15px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
          }
          .empty-state::before {
            content: '💭';
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
          }
          .chat-privacy-notice {
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
          }
          .chat-privacy-notice small {
            font-size: 12px;
            color: #9ca3af;
            line-height: 1.5;
          }
          .chat-privacy-notice a {
            color: #667eea;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.2s ease;
          }
          .chat-privacy-notice a:hover {
            color: #764ba2;
            text-decoration: underline;
          }
          .footer {
            text-align: center;
            padding: 32px 24px;
            margin-top: 48px;
            color: white;
            opacity: 0.9;
          }
          .footer a {
            color: white;
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            transition: opacity 0.2s ease;
            padding: 8px 16px;
            border-radius: 8px;
            display: inline-block;
          }
          .footer a:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.1);
            text-decoration: none;
          }
          .client-form {
            background: white;
            border-radius: 20px;
            padding: 32px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.05);
            margin-bottom: 32px;
            animation: fadeInUp 0.8s ease-out;
          }
          .client-form h2 {
            margin: 0 0 24px 0;
            font-size: 24px;
            font-weight: 700;
            color: #1a1a1a;
            letter-spacing: -0.3px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #374151;
            font-size: 14px;
          }
          .form-group input {
            width: 100%;
            padding: 14px 18px;
            border: 2px solid #d1d5db;
            border-radius: 12px;
            font-size: 15px;
            transition: all 0.2s ease;
            font-family: inherit;
          }
          .form-group input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          }
          .form-submit {
            width: 100%;
            padding: 14px 28px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            font-size: 16px;
          }
          .form-submit:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
          }
          .form-submit:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .instructor-select {
            width: 100%;
            padding: 14px 18px;
            border: 2px solid #d1d5db;
            border-radius: 12px;
            font-size: 15px;
            background: white;
            cursor: pointer;
            transition: all 0.2s ease;
            font-family: inherit;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23667eea' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 18px center;
            padding-right: 45px;
          }
          .instructor-select:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          }
          .instructor-detail {
            margin-top: 24px;
            padding: 24px;
            background: linear-gradient(135deg, #f5f7ff 0%, #eef2ff 100%);
            border-radius: 16px;
            border: 2px solid #e0e7ff;
          }
          .instructor-detail-header {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 16px;
          }
          .instructor-detail-avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            object-fit: cover;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            color: white;
            font-size: 32px;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            flex-shrink: 0;
          }
          .instructor-detail-avatar img {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            object-fit: cover;
          }
          .instructor-detail-info h3 {
            margin: 0 0 8px 0;
            font-size: 20px;
            font-weight: 700;
            color: #1a1a1a;
          }
          .instructor-detail-bio {
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #e0e7ff;
            color: #4b5563;
            line-height: 1.6;
            font-size: 15px;
          }
          .message-suggestions {
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #e5e7eb;
          }
          .message-suggestions-title {
            font-size: 13px;
            font-weight: 600;
            color: #6b7280;
            margin-bottom: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .suggestion-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }
          .suggestion-chip {
            padding: 8px 14px;
            background: #f3f4f6;
            border: 1px solid #e5e7eb;
            border-radius: 20px;
            font-size: 13px;
            color: #4b5563;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .suggestion-chip:hover {
            background: #e5e7eb;
            border-color: #d1d5db;
            transform: translateY(-1px);
          }
        `}</style>
      </Head>

      <div className="container">
        <div className="header">
        <h1>FrostDesk</h1>
          <p>Book a lesson in under 2 minutes</p>
          </div>

        {/* Client Info Form */}
        {showClientForm && (
          <form className="client-form" onSubmit={handleClientFormSubmit}>
            <h2>Tell us about yourself</h2>
            <div className="form-group">
              <label htmlFor="client-name">Your Name *</label>
              <input
                id="client-name"
                type="text"
                value={clientName}
                onChange={(e) => setClientNameState(e.target.value)}
                placeholder="Enter your name"
                required
                maxLength={100}
              />
          </div>
            <div className="form-group">
              <label htmlFor="client-phone">Phone Number *</label>
              <input
                id="client-phone"
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhoneState(e.target.value)}
                placeholder="+39 123 456 7890"
                required
                maxLength={20}
              />
            </div>
            <button type="submit" className="form-submit">
              Continue
            </button>
          </form>
        )}

        {!showClientForm && (
          <div className="main-content">
            {/* Instructor Selection Panel */}
            <div className="panel">
              <h2>Select an Instructor</h2>
              {instructorsLoading ? (
                <div className="loading">Loading instructors...</div>
              ) : instructors.length === 0 ? (
                <div className="empty-state">No instructors available</div>
              ) : (
                <>
        <select
                    className="instructor-select"
                    value={selectedInstructorId || ""}
                    onChange={(e) => handleInstructorSelect(e.target.value)}
                  >
                    <option value="">-- Select an instructor --</option>
                    {instructors.map((instructor) => (
                      <option key={instructor.id} value={instructor.id}>
                        {instructor.name}
                </option>
              ))}
        </select>

        {selectedInstructor && (
                    <div className="instructor-detail">
                      <div className="instructor-detail-header">
                        <div className="instructor-detail-avatar">
                          {selectedInstructor.photo_url ? (
                            <img src={selectedInstructor.photo_url} alt={selectedInstructor.name} />
                          ) : (
                            getInstructorInitials(selectedInstructor.name)
                          )}
                        </div>
                        <div className="instructor-detail-info">
                          <h3>{selectedInstructor.name}</h3>
                          {getInstructorBadges(selectedInstructor.bio).length > 0 && (
                            <div className="instructor-badges">
                              {getInstructorBadges(selectedInstructor.bio).map((badge) => (
                                <span key={badge} className="badge">
                                  {badge}
                                </span>
                ))}
              </div>
            )}
          </div>
            </div>
                      {selectedInstructor.bio && (
                        <div className="instructor-detail-bio">
                          {selectedInstructor.bio}
            </div>
                      )}
          </div>
                  )}
                </>
        )}
      </div>

          {/* Chat Widget Panel */}
          <div className="panel">
            <div className="chat-widget">
              <div className="chat-header">
                <h2 className="chat-header-title">Chat</h2>
                <p className="chat-header-instructor">
                  {selectedInstructor
                    ? `Chatting with ${selectedInstructor.name}`
                    : "Select an instructor to start chatting"}
                </p>
          </div>

              <div className="chat-messages" ref={chatBodyRef}>
                {chatMessages.length === 0 ? (
                  <div className="empty-state">
            {selectedInstructor
                      ? "Start the conversation..."
                      : "Select an instructor to begin"}
          </div>
                ) : (
                  chatMessages.map((msg, idx) => {
                    // Determine CSS classes based on state and type
                    // Priority: isError > role > state
                    const classes = [
                      'chat-message',
                      msg.isError ? 'error' : msg.role, // Primary class: error or role (user/ai)
                      // Only add state classes if not error and state is meaningful
                      !msg.isError && msg.state === 'waiting' ? 'waiting' : '',
                      !msg.isError && msg.isFallback ? 'fallback' : '',
                      !msg.isError && msg.isWaiting ? 'waiting' : '',
                      // Don't add 'error' as a state class if it's already the primary class
                      !msg.isError && msg.state && msg.state !== 'error' ? msg.state : '',
                    ].filter(Boolean).join(' ');
                    
                    return (
                      <div key={msg.idempotency_key || `msg-${idx}`} className={classes}>
                        {msg.text}
                        {(msg.state === 'sending' || msg.state === 'delivered' || msg.state === 'waiting') && (
                          <div className="chat-message-state" />
            )}
              </div>
                    );
                  })
            )}
          </div>

              <div className="message-suggestions">
                <div className="message-suggestions-title">💡 Suggested Messages</div>
                <div className="suggestion-chips">
                  {messageSuggestions.map((suggestion, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="suggestion-chip"
                      onClick={() => {
                        if (selectedInstructor && !chatSending) {
                          setChatInput(suggestion);
                        }
                      }}
                      disabled={!selectedInstructor || chatSending}
                    >
                      {suggestion}
                </button>
                  ))}
              </div>
          </div>

              <div className="chat-input-area">
                {/* Honeypot field - hidden from users, bots will fill it */}
            <input
                  ref={honeypotFieldRef}
                  type="text"
                  name="website"
                  style={{ display: 'none' }}
                  tabIndex={-1}
              autoComplete="off"
                  aria-hidden="true"
                />
                <input
                  className="chat-input"
                  type="text"
                  placeholder={
                    selectedInstructor
                      ? "Type your message..."
                      : "Select an instructor first"
                  }
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                      handleChatSend();
                    }
                  }}
                  disabled={!selectedInstructor || chatSending}
                  maxLength={5000}
                />
                <button
                  className="chat-send"
                  onClick={handleChatSend}
                  disabled={!selectedInstructor || chatSending || !chatInput.trim()}
                >
                  {chatSending ? "..." : "Send"}
            </button>
          </div>

              {showWhatsAppCTA && (
                <button className="whatsapp-cta" onClick={handleWhatsAppClick}>
                  Continue on WhatsApp
                </button>
              )}

              <div className="chat-privacy-notice">
                <small>
                  By using this chat, you agree to our{" "}
                  <Link href="/privacy" style={{ color: "#667eea", textDecoration: "underline" }}>
                    Privacy Policy
                  </Link>
                </small>
        </div>
            </div>
          </div>
          </div>
        )}

        <footer className="footer">
          <Link href="/privacy">Privacy Policy</Link>
        </footer>
      </div>
    </>
  );
}
