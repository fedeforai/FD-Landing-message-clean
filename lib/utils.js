// Utility functions for FrostDesk Landing

/**
 * Get instructor initials from name
 */
export function getInstructorInitials(name) {
  if (!name || typeof name !== "string") return "FD";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0][0]?.toUpperCase() || "F";
  }
  const first = parts[0][0]?.toUpperCase() || "F";
  const last = parts[parts.length - 1][0]?.toUpperCase() || "D";
  return `${first}${last}`;
}

/**
 * Extract badges from instructor bio
 */
const BADGE_KEYWORDS = [
  { label: "Olympian", regex: /olympian/i },
  { label: "Ambassador", regex: /ambassador/i },
  { label: "Director", regex: /director/i },
];

export function getInstructorBadges(bio) {
  if (!bio || typeof bio !== "string") return [];
  return BADGE_KEYWORDS.filter(({ regex }) => regex.test(bio)).map(({ label }) => label);
}

/**
 * Build WhatsApp link
 */
export function buildWhatsAppLink(instructor) {
  const number = instructor?.whatsapp_number?.toString().trim();
  const prefillText = encodeURIComponent("Ciao, voglio prenotare una lezione");
  
  if (number) {
    return `https://wa.me/${number}?text=${prefillText}`;
  }
  
  // Fallback to generic link if env var is set
  const baseLink = process.env.NEXT_PUBLIC_WA_LINK;
  if (baseLink) {
    return `${baseLink}?text=${prefillText}`;
  }
  
  return null;
}

/**
 * Debounce function for rate limiting
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Generate a unique idempotency key for message deduplication
 * Format: "landing:{timestamp}:{random}"
 */
export function generateIdempotencyKey() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `landing:${timestamp}:${random}`;
}

/**
 * Generate a UUID v4 for trace_id or external_message_id
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
