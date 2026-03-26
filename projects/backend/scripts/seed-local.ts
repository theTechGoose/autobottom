/** Seed script: creates a test org, reviewer user, and review queue items with transcripts for local testing. */

import { createOrg, createUser } from "./auth/kv.ts";
import { populateReviewQueue } from "./review/kv.ts";
import { saveTranscript } from "./lib/kv.ts";

const orgId = await createOrg("test-org", "seed");
console.log("Created org:", orgId);

await createUser(orgId, "test@test.com", "test", "reviewer");
console.log("Created user: test@test.com / test");

// Seed 3 findings with transcripts and review queue items
const findings = [
  {
    id: "finding-001",
    transcript: {
      raw: `Agent: Hello, thank you for calling support. How can I help you today?
Customer: Hi, I need help with my billing issue. I was charged twice for the same service.
Agent: I understand your concern. Let me look into that for you right away.
Customer: I noticed it on my statement last Tuesday. The charge was for $49.99 and it appeared twice.
Agent: I can see the duplicate charge on your account. I'll process a refund for the extra charge immediately.
Customer: Thank you so much. How long will the refund take?
Agent: The refund should appear on your statement within 3 to 5 business days.
Customer: Great, that works for me. Is there anything else I should watch for?
Agent: No, everything else on your account looks good. Is there anything else I can help you with?
Customer: No, that's all. Thank you for your help.
Agent: You're welcome. Have a great day!`,
      diarized: `[Agent] Hello, thank you for calling support. How can I help you today?
[Customer] Hi, I need help with my billing issue. I was charged twice for the same service.
[Agent] I understand your concern. Let me look into that for you right away.
[Customer] I noticed it on my statement last Tuesday. The charge was for $49.99 and it appeared twice.
[Agent] I can see the duplicate charge on your account. I'll process a refund for the extra charge immediately.
[Customer] Thank you so much. How long will the refund take?
[Agent] The refund should appear on your statement within 3 to 5 business days.
[Customer] Great, that works for me. Is there anything else I should watch for?
[Agent] No, everything else on your account looks good. Is there anything else I can help you with?
[Customer] No, that's all. Thank you for your help.
[Agent] You're welcome. Have a great day!`,
    },
    questions: [
      { answer: "No", header: "Was the customer greeted properly?", populated: "Agent greeting compliance check", thinking: "The agent said hello but did not identify themselves by name", defense: "The agent started with 'Hello, thank you for calling support' which is a proper greeting" },
      { answer: "No", header: "Was the billing issue resolved?", populated: "Billing resolution check", thinking: "The agent processed a refund for the duplicate charge", defense: "Agent confirmed 'I'll process a refund for the extra charge immediately'" },
      { answer: "No", header: "Was a follow-up offered?", populated: "Follow-up compliance check", thinking: "Agent asked if there was anything else", defense: "Agent said 'Is there anything else I can help you with?'" },
    ],
  },
  {
    id: "finding-002",
    transcript: {
      raw: `Agent: Good afternoon, this is Sarah from technical support.
Customer: Hi Sarah, my internet has been down for two hours now.
Agent: I'm sorry to hear that. Let me check your connection status.
Customer: I've already tried restarting the modem three times.
Agent: I appreciate you trying that. I can see there's an outage in your area affecting several customers.
Customer: Do you know when it will be fixed?
Agent: Our team is working on it and we expect service to be restored within the next hour.
Customer: That's frustrating. Can I get a credit for the downtime?
Agent: Absolutely, I'll apply a prorated credit to your next bill automatically.
Customer: Okay, thanks Sarah.
Agent: You're welcome. I'll also send you a text notification when service is restored.`,
      diarized: `[Agent] Good afternoon, this is Sarah from technical support.
[Customer] Hi Sarah, my internet has been down for two hours now.
[Agent] I'm sorry to hear that. Let me check your connection status.
[Customer] I've already tried restarting the modem three times.
[Agent] I appreciate you trying that. I can see there's an outage in your area affecting several customers.
[Customer] Do you know when it will be fixed?
[Agent] Our team is working on it and we expect service to be restored within the next hour.
[Customer] That's frustrating. Can I get a credit for the downtime?
[Agent] Absolutely, I'll apply a prorated credit to your next bill automatically.
[Customer] Okay, thanks Sarah.
[Agent] You're welcome. I'll also send you a text notification when service is restored.`,
    },
    questions: [
      { answer: "No", header: "Did the agent identify themselves?", populated: "Agent identification check", thinking: "Agent said 'this is Sarah from technical support'", defense: "The agent clearly identified as 'Sarah from technical support'" },
      { answer: "No", header: "Was empathy shown?", populated: "Empathy compliance check", thinking: "Agent said 'I'm sorry to hear that'", defense: "Agent expressed empathy with 'I'm sorry to hear that'" },
    ],
  },
  {
    id: "finding-003",
    transcript: {
      raw: `Agent: Welcome to customer service. How may I assist you?
Customer: I want to cancel my subscription.
Agent: I understand. May I ask the reason for cancellation?
Customer: It's too expensive and I found a cheaper alternative.
Agent: I appreciate your honesty. Before you go, I'd like to offer you a 30% discount for the next 6 months.
Customer: Hmm, that's interesting. What would my monthly cost be?
Agent: With the discount, your monthly cost would drop from $29.99 to $20.99.
Customer: Let me think about it. Can you email me the details?
Agent: Of course. I'll send that over right away. The offer is valid for 48 hours.
Customer: Okay, I'll look it over tonight. Thanks.
Agent: Thank you for considering it. Have a wonderful evening!`,
      diarized: `[Agent] Welcome to customer service. How may I assist you?
[Customer] I want to cancel my subscription.
[Agent] I understand. May I ask the reason for cancellation?
[Customer] It's too expensive and I found a cheaper alternative.
[Agent] I appreciate your honesty. Before you go, I'd like to offer you a 30% discount for the next 6 months.
[Customer] Hmm, that's interesting. What would my monthly cost be?
[Agent] With the discount, your monthly cost would drop from $29.99 to $20.99.
[Customer] Let me think about it. Can you email me the details?
[Agent] Of course. I'll send that over right away. The offer is valid for 48 hours.
[Customer] Okay, I'll look it over tonight. Thanks.
[Agent] Thank you for considering it. Have a wonderful evening!`,
    },
    questions: [
      { answer: "No", header: "Was retention attempted?", populated: "Retention offer check", thinking: "Agent offered a 30% discount to retain the customer", defense: "Agent proactively offered '30% discount for the next 6 months'" },
    ],
  },
];

for (const f of findings) {
  await saveTranscript(orgId, f.id, f.transcript.raw, f.transcript.diarized);
  await populateReviewQueue(orgId, f.id, f.questions);
  console.log(`Seeded ${f.id}: ${f.questions.length} questions + transcript`);
}

console.log("\n--- Ready ---");
console.log("Start server: deno task dev");
console.log("Login: test@test.com / test");
console.log("Org slug: test-org");
console.log("Press / to search transcripts");
