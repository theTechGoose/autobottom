/** Seed local KV with fake finished audits for testing the review UI. */

const db = await Deno.openKv();

const FAKE_TRANSCRIPT = `Agent: Thank you for calling Acme Travel Group, my name is Sarah. How can I help you today?
Customer: Hi, yeah, I'm calling because I have a reservation and I need to make some changes to it.
Agent: Of course! I'd be happy to help you with that. Can I get your reservation number please?
Customer: Sure, it's RES-445521.
Agent: Great, let me pull that up real quick. Okay, I have it here. I see you have a 5-night stay at the Westgate Lakes Resort in Orlando, checking in on March 15th and checking out on March 20th. Is that the reservation you're referring to?
Customer: Yes, that's the one. So here's the thing — my wife and I were talking last night and we decided we want to stay a bit longer. We've never been to Orlando before and five nights just doesn't feel like enough, you know? Is it possible to extend the stay by two more nights?
Agent: Oh absolutely, I completely understand! Orlando has so much to offer, especially if it's your first time. Let me check availability for those additional nights... I'm looking at March 20th and 21st at the same property... Okay great news, I do have availability for those two extra nights at the Westgate Lakes Resort.
Customer: Oh perfect, that's great to hear. How much would that cost?
Agent: So the additional two nights would be $198 total. That's $99 per night, same rate as your original booking. So your new checkout date would be March 22nd, bringing you to a 7-night stay.
Customer: Okay, that sounds reasonable. Yeah, let's go ahead and add those nights.
Agent: Perfect, I've added those to your reservation. Now while I have you on the line, I did want to mention — since you're extending your stay, you might be interested in hearing about some of our add-on packages. We have dining packages, attraction tickets, spa packages, and transportation options. Would you like to hear about any of those?
Customer: Actually yeah, my wife mentioned something about a dining package. What does that include?
Agent: Great question! So we have two dining options. The first is our Standard Dining Package which gives you breakfast and dinner daily at select restaurants on the resort property. For a 7-night stay that would be $175 per person. The second option is our Premium Dining Package which includes breakfast, lunch, and dinner, plus you get access to some off-property partner restaurants as well. That one is $245 per person for 7 nights. Both packages include kids under 12 at a reduced rate of 50% off the adult price.
Customer: Hmm, let me think about that. How many restaurants are included in the premium one?
Agent: With the Premium Dining Package you get access to 6 on-property restaurants and 4 off-property partner restaurants. The on-property ones include an Italian restaurant, a steakhouse, a seafood place, a buffet, a poolside grill, and a breakfast cafe. The off-property partners are some really nice spots on International Drive — there's a Brazilian steakhouse, a sushi restaurant, a farm-to-table place, and a Mexican restaurant.
Customer: That actually sounds pretty good. Let me ask — how many people are we talking about? It's me and my wife, and then our two kids. Our daughter is 14 and our son is 9.
Agent: Okay so for the Premium Dining Package, it would be $245 each for you and your wife, then your daughter at 14 would be full adult price so that's another $245, and your son at 9 would be half price at $122.50. So the total for the dining package for all four of you would be $857.50 for the 7 nights.
Customer: Whoa, that's a bit more than I expected. What about the standard one?
Agent: Sure, so the Standard Package — that would be $175 for you, $175 for your wife, $175 for your daughter, and $87.50 for your son. Total would be $612.50 for the 7 nights. And honestly for a family of four, that's breakfast and dinner covered every day, which can save you quite a bit versus paying out of pocket at restaurants in Orlando.
Customer: Yeah that's a good point. Orlando restaurants aren't cheap. Let me go with the standard dining package. We can always eat lunch at the parks or grab something quick.
Agent: Smart choice! I'll add the Standard Dining Package for 4 guests to your reservation. So just to make sure I have everything right — you've got the Westgate Lakes Resort, checking in March 15th, now checking out March 22nd for 7 nights, plus the Standard Dining Package for 2 adults and 2 children. Is that all correct?
Customer: Wait, actually can you double-check something for me? When we originally booked, I think we were supposed to have a suite with a kitchen. Can you verify that?
Agent: Let me look at your room type... Yes, you're in a Two-Bedroom Villa which does include a full kitchen, a living room area, and a washer/dryer. So you're all set there.
Customer: Okay great. And the pool — is there a pool at this resort?
Agent: Oh absolutely! Westgate Lakes has multiple pools actually. There's a main pool with a water slide, a lazy river, a kids' splash area, and then a couple of quieter pools as well. There's also a hot tub. All included with your stay, no extra charge.
Customer: That sounds amazing. The kids are going to love the water slide. Okay, so what are we looking at for the total now with everything?
Agent: Let me tally that up for you. So your original 5-night reservation was $495. The 2 additional nights are $198. And the Standard Dining Package is $612.50. So your new total comes to $1,305.50. Now, you had already paid a deposit of $150 when you originally booked, so your remaining balance would be $1,155.50, which would be due at check-in.
Customer: Okay, that works for us. Is there anything else I should know before the trip?
Agent: A few things! First, check-in time is 4 PM and checkout is 10 AM. If you need a late checkout, just call the front desk the morning of and they'll try to accommodate you. Second, for the dining package, you'll receive your dining cards at check-in — just present those at any participating restaurant. Third, I'd recommend downloading our resort app before your trip. You can see your full itinerary, restaurant menus, pool hours, and even order room service through the app.
Customer: Oh that's handy. I'll definitely download that. One more question — parking. Is parking included or is that extra?
Agent: Parking is complimentary at Westgate Lakes Resort. They have a large covered parking garage right next to the villa buildings. If you're renting a car at the airport, I'd recommend it since the resort is about 20 minutes from Orlando International.
Customer: Yeah we're flying in from Chicago so we'll probably rent a car. Okay Sarah, I think that covers everything. You've been super helpful.
Agent: Aw thank you so much! I'm so glad I could help. You and your family are going to have an amazing time in Orlando. Is there anything else at all I can assist you with today?
Customer: No, that's everything. Thanks again Sarah!
Agent: You're welcome! Have a wonderful trip and don't hesitate to call us if anything comes up before your travel date. Our number is always on your confirmation email. Have a great rest of your day!
Customer: You too, bye!
Agent: Goodbye!`;

const questions = [
  { header: "Greeting", unpopulated: "Did the agent greet the customer?", populated: "Did the agent greet the customer by name and identify themselves with their name and company?", answer: "Yes", thinking: "Agent said 'Thank you for calling Acme Travel Group, my name is Sarah. How can I help you today?' — identifies company, gives name, and offers help.", defense: "Clear greeting with agent name (Sarah) and company identification (Acme Travel Group) at the start of the call." },
  { header: "Identity Verification", unpopulated: "Did the agent verify the customer?", populated: "Did the agent verify the customer's identity by confirming at least two pieces of identifying information (e.g., name, DOB, phone number, address) in addition to the reservation number?", answer: "No", thinking: "Agent asked for reservation number and confirmed the reservation details, but never asked the caller to verify their name, date of birth, phone number, or any other personal identifying information. The reservation number alone is not sufficient identity verification.", defense: "Agent only asked 'Can I get your reservation number please?' and proceeded to make changes after receiving it, without verifying the caller's identity through any additional means." },
  { header: "Upsell Attempt", unpopulated: "Did the agent attempt an upsell?", populated: "Did the agent proactively offer additional products, services, or upgrades before the customer asked about them?", answer: "No", thinking: "The agent did eventually mention add-on packages ('dining packages, attraction tickets, spa packages, and transportation options'), but this only happened AFTER the customer had already asked about extending their stay. The customer then specifically brought up the dining package first ('my wife mentioned something about a dining package'). The agent's mention of packages could be considered proactive, but the dining package discussion was customer-initiated.", defense: "While the agent did mention add-on packages proactively after adding the extra nights, the primary upsell (dining package) was driven by the customer saying 'my wife mentioned something about a dining package.' The agent responded to customer interest rather than initiating the upsell." },
  { header: "Pricing Transparency", unpopulated: "Did the agent disclose pricing?", populated: "Did the agent clearly disclose all costs and obtain verbal confirmation from the customer before making any changes to the reservation?", answer: "Yes", thinking: "Agent disclosed $198 for additional nights before adding them, customer said 'let's go ahead.' Agent disclosed both dining package options with per-person pricing and totals. Agent provided a full cost summary at the end ($1,305.50 total, $1,155.50 remaining after deposit).", defense: "Agent provided pricing at each decision point: '$198 total' for extra nights, '$175 per person' for standard dining, '$245 per person' for premium, and a complete total breakdown of $1,305.50 before ending the call." },
  { header: "Reservation Recap", unpopulated: "Did the agent close properly?", populated: "Did the agent read back a complete summary of all reservation changes including dates, room type, add-ons, and total cost before ending the call?", answer: "Yes", thinking: "Agent provided a detailed recap: 'Westgate Lakes Resort, checking in March 15th, now checking out March 22nd for 7 nights, plus the Standard Dining Package for 2 adults and 2 children.' Agent also gave a full price breakdown later in the call.", defense: "Agent summarized: property name, check-in/out dates, length of stay, dining package details, and then provided a complete cost breakdown including original booking, additions, and remaining balance." },
  { header: "Hold Procedure", unpopulated: "Did the agent follow hold procedure?", populated: "When the agent needed to check system information or look something up, did they ask the customer's permission before placing them on hold or making them wait?", answer: "No", thinking: "Agent said 'Let me check availability for those additional nights... I'm looking at March 20th and 21st at the same property... Okay great news' — this indicates the agent either placed the customer on a brief hold or made them wait while checking the system, without first asking permission or explaining how long it might take.", defense: "Agent said 'Let me check availability for those additional nights...' and proceeded to check without asking 'Do you mind if I place you on a brief hold?' or 'May I put you on hold for a moment while I check?' This violates standard hold procedure which requires asking permission before any hold or extended silence." },
  { header: "Customer Name Usage", unpopulated: "Did the agent use the customer's name?", populated: "Did the agent address the customer by their first or last name at any point during the call to personalize the interaction?", answer: "No", thinking: "Reviewing the entire transcript, the agent never once addressed the customer by name. The customer never provided their name explicitly, and the agent never asked for it or looked it up from the reservation. The agent used generic terms like 'you' and 'your family' throughout.", defense: "At no point in the call did the agent use the customer's name. The agent addressed them as 'you' throughout the entire interaction, missing an opportunity to personalize the service experience." },
  { header: "Callback Number", unpopulated: "Did the agent collect a callback number?", populated: "Did the agent ask for or confirm a callback phone number in case the call was disconnected?", answer: "No", thinking: "The agent never asked for a phone number or callback number at any point during the call. This is a standard practice in case the call drops, especially when making financial changes to a reservation.", defense: "No callback number was requested. Agent proceeded through the entire call including financial changes without securing a way to reach the customer if disconnected." },
  { header: "Empathy Statement", unpopulated: "Did the agent show empathy?", populated: "Did the agent demonstrate empathy or acknowledge the customer's feelings or situation at least once during the call?", answer: "Yes", thinking: "Agent said 'Oh absolutely, I completely understand! Orlando has so much to offer, especially if it's your first time.' This acknowledges the customer's excitement and validates their decision to extend their trip.", defense: "Agent showed empathy when responding to the extension request: 'I completely understand! Orlando has so much to offer, especially if it's your first time.' Also expressed warmth with 'You and your family are going to have an amazing time in Orlando.'" },
  { header: "Compliance Disclosure", unpopulated: "Did the agent read the compliance disclosure?", populated: "Did the agent read the required compliance disclosure statement informing the customer that the call may be recorded for quality assurance purposes?", answer: "No", thinking: "The agent began the call with a standard greeting but did not include any disclosure about call recording or monitoring. There is no mention of 'this call may be recorded' or any similar compliance language anywhere in the transcript.", defense: "No compliance disclosure was read at any point during the call. The agent's opening was 'Thank you for calling Acme Travel Group, my name is Sarah. How can I help you today?' with no recording or monitoring disclosure." },
];

// Create two fake findings
for (let f = 0; f < 2; f++) {
  const id = `test-finding-${f + 1}`;
  const finding = {
    id,
    auditJobId: `test-job-${f + 1}`,
    findingStatus: "finished",
    recordingId: `${444780 + f}`,
    recordingIdField: "Genie",
    answeredQuestions: questions.map((q) => ({
      ...q,
      autoYesExp: "",
      astResults: {},
      autoYesVal: false,
      autoYesMsg: "",
    })),
    feedback: { heading: "Test Audit", text: "This is a test audit for review UI testing.", viewUrl: "", disputeUrl: "", recordingUrl: "" },
    record: { RecordId: `${444780 + f}` },
  };

  await db.set(["audit-finding", id], finding);

  // Save transcript (chunked format)
  const raw = JSON.stringify({ raw: FAKE_TRANSCRIPT, diarized: FAKE_TRANSCRIPT });
  await db.set(["audit-transcript", id, 0], raw);
  await db.set(["audit-transcript", id, "_n"], 1);

  // Populate review queue with "No" answers
  const noAnswers = finding.answeredQuestions
    .map((q, i) => ({ ...q, index: i }))
    .filter((q) => q.answer === "No");

  const atomic = db.atomic();
  for (const q of noAnswers) {
    atomic.set(["review-pending", id, q.index], {
      findingId: id,
      questionIndex: q.index,
      header: q.header,
      populated: q.populated,
      thinking: q.thinking,
      defense: q.defense,
      answer: q.answer,
    });
  }
  atomic.set(["review-audit-pending", id], noAnswers.length);
  await atomic.commit();

  console.log(`Seeded ${id}: ${noAnswers.length} items in review queue`);
}

console.log("Done. Visit http://localhost:8000/review");
db.close();
