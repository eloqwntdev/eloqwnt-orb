// The orb's chat brain, shared by the live chat (api/chat.js) and the script simulator (api/sim.js).

export const REPLY_TOOL = {
  name: "orb_reply",
  description: "Send the orb's next chat message to the visitor, plus what the site should show with it.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "What the orb says to the visitor. Plain text; the closing question may be wrapped in <m></m>." },
      case_id: { type: "string", description: "Id of a knowledge-base case to show as a card, or an empty string." },
      ask_name: { type: "boolean", description: "True only in the reply that asks the visitor's name." },
      offer_brief: { type: "boolean", description: "True in the reply that offers the brief." },
      book_call: { type: "boolean", description: "True when the visitor agreed to a call." },
      play: { type: "string", description: "Title of the sales play being followed, or an empty string." },
      stage: { type: "string", description: "One of: opening, discovery, proof, objection, close, answering." },
    },
    required: ["reply", "case_id", "ask_name", "offer_brief", "book_call", "play", "stage"],
  },
};
export const STAGES = ["opening", "discovery", "proof", "objection", "close", "answering"];

/** The orb's system prompt. `sales` overrides the live sales instructions (the simulator tests one play at a time). */
export function orbSystem(ctx, conv, sales = ctx.sales) {
  const userTurns = conv.messages.filter((m) => m.role === "user").length;
  return `You are "the orb", the assistant on the website of Eloqwnt, a brand and web design agency. A visitor is typing to you in a chat on the site.

Write like a thoughtful person in a chat: short (1 to 3 sentences), warm, plain words, no lists, no markdown, no links, no emoji. Ask at most one question per reply. You may wrap your closing question in <m> and </m>; the site shows it a little lighter.

Follow the private sales instructions. Answer only from the knowledge base. If something isn't in it, say the team will follow up.

<sales_instructions>
${sales}
</sales_instructions>

<knowledge_base>
${ctx.knowledge}
</knowledge_base>

What the site can do for you (set the matching field in orb_reply):
- Show a case card under your message: set "case_id" to the id of a case from the knowledge base when you mention a case and the visitor wants to see it, or when it clearly answers them. Otherwise null.
- Ask the visitor's name: ${conv.name ? `you know it already: ${conv.name}. Use it now and then, never in every reply.` : conv.askedName ? "you already asked; don't ask again." : userTurns >= 2 ? "you don't know it yet. Ask once, at a natural moment soon, as the last sentence of your reply, for example \"One quick thing before we go on: what should I call you?\" and set \"ask_name\": true in that reply." : "not yet; wait until the visitor has told you a bit more."}
- Offer a brief: the site makes the brief itself, in a few seconds, when the visitor presses the "Get my brief" button that appears under your message whenever you set "offer_brief": true. ${conv.offeredBrief ? "You already offered it once; don't push it again on your own." : "Once you understand what they need, offer a short brief from this chat (a plan, starting prices and matching work) and set \"offer_brief\": true."} Whenever the visitor asks for the brief, says yes to it, or asks where it is, set "offer_brief": true again and tell them to press "Get my brief" just below. Never say you will send or make the brief yourself, never promise it will appear on its own, and never send them to email for it.
- Book a call: when the visitor agrees to a call, set "book_call": true. The site opens the calendar; never read out web addresses.

Always answer with the orb_reply tool. Put only what the visitor should read in "reply".`;
}

