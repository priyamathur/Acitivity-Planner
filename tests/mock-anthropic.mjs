// Minimal stand-in for the Claude Messages API, used by the integration tests.
// It records each request and replies with a fixed structured-output answer.
import http from 'node:http';

const textOf = (m) => (typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
const toolUse = (name, input) => ({ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2, 10)}`, name, input });
const text = (t, citations) => ({ type: 'text', text: t, ...(citations ? { citations } : {}) });

// Scripted chat: picks a scenario from the parent's latest message, then plays
// one step per call (tool calls → results → confirmation).
function chatReply(messages) {
  let lastUser = messages.length - 1;
  while (lastUser >= 0 && !(messages[lastUser].role === 'user' && textOf(messages[lastUser]))) lastUser--;
  const m = messages[lastUser];
  const said = typeof m.content === 'string' ? m.content : m.content.find((x) => x.type === 'text').text; // what the parent typed
  const after = messages.slice(lastUser + 1);
  const results = after.filter((m) => m.role === 'user').flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
  const lastResult = results.at(-1);
  const step = results.length;
  const state = textOf(m); // includes <app_state>
  const idOf = (title) => (state.match(new RegExp(`id (\\w+): ${title}`)) || [])[1];

  if (/pumpkin/i.test(said)) {
    if (!after.length) return { stop_reason: 'pause_turn', content: [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'pumpkin festival Saturday near me' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://example.org/pumpkin-fest', title: 'Valley Pumpkin Festival', encrypted_content: 'enc', page_age: null }] },
    ] };
    if (step === 0) return { stop_reason: 'tool_use', content: [
      text('Found it: the Valley Pumpkin Festival runs 11:00–14:00 on Saturday.', [{ type: 'web_search_result_location', url: 'https://example.org/pumpkin-fest', title: 'Valley Pumpkin Festival', encrypted_index: 'x', cited_text: '11am–2pm' }]),
      toolUse('add_to_calendar', { title: 'Pumpkin festival', kind: 'event', repeat: 'once', days: [], date: '2026-10-10', start: '11:00', end: '14:00', who: '', where: 'Valley Farm' }),
    ] };
    return { stop_reason: 'end_turn', content: [text("Added the Pumpkin festival to Saturday 10 Oct, 11:00–14:00. I've moved things around it. Do double-check opening times on their site.")] };
  }
  if (/football/i.test(said)) {
    if (step === 0) return { stop_reason: 'tool_use', content: [toolUse('update_calendar_item', { id: idOf('Football'), title: '', days: [], start: '17:00', end: '18:00', who: '', where: '' })] };
    return { stop_reason: 'end_turn', content: [text("Done. Leo's football is now 17:00–18:00.")] };
  }
  if (/cosy|plan next/i.test(said)) {
    if (step === 0) return { stop_reason: 'tool_use', content: [toolUse('plan_weekend', { week: 'next', vibe: 'cosy' })] };
    if (step === 1) {
      const slot = (JSON.parse(lastResult.content).planned.match(/(sun@\d\d:\d\d)/) || [])[1];
      return { stop_reason: 'tool_use', content: [toolUse('set_slot', { week: 'next', slot_id: slot, activity_id: 'blanket-fort', reason: 'Rain is forecast, so a cosy fort fits.' })] };
    }
    return { stop_reason: 'end_turn', content: [text('Next weekend is planned and cosy, with a blanket fort on Sunday.')] };
  }
  if (/zoo all day/i.test(said)) {
    if (step === 0) return { stop_reason: 'tool_use', content: [toolUse('set_slot', { week: 'this', slot_id: 'sat@99:99', activity_id: 'zoo-day', reason: 'x' }), toolUse('add_to_calendar', { title: 'Zoo', kind: 'event', repeat: 'once', days: [], date: '2020-01-01', start: '10:00', end: '09:00', who: 'Nobody', where: '' })] };
    const errors = results.filter((r) => r.is_error).length;
    return { stop_reason: 'end_turn', content: [text(`Sorry, ${errors} of those didn't work. Which day would you like the zoo?`)] };
  }
  if (/swimming class/i.test(said)) {
    if (step === 0) return { stop_reason: 'tool_use', content: [toolUse('find_places', { type: 'swimming', radius_km: 5 })] };
    const places = JSON.parse(lastResult.content).places || [];
    return { stop_reason: 'end_turn', content: [text(`The nearest pool is ${places[0]?.name} (${places[0]?.km} km). Want me to look up their Saturday lessons?`)] };
  }
  if (/skip swimming/i.test(said)) {
    if (step === 0) return { stop_reason: 'tool_use', content: [toolUse('skip_class_once', { id: idOf('Swimming'), date: '2026-10-17' })] };
    return { stop_reason: 'end_turn', content: [text('Swimming is skipped on 17 Oct.')] };
  }
  return { stop_reason: 'end_turn', content: [text('Happy to help! What would you like to plan?')] };
}

function reply(res, parsed, { stop_reason, content }) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model: parsed.model, content, stop_reason, stop_details: null, usage: { input_tokens: 1, output_tokens: 1 } }));
}

export function startMockAnthropic(port = 9911) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      if (Array.isArray(parsed.tools)) return reply(res, parsed, chatReply(parsed.messages));
      // School newsletter photo → dates (one deliberately bad date to be cleaned up server-side).
      const first = parsed.messages?.[0]?.content;
      if (Array.isArray(first) && first.some((b) => b.type === 'image')) return reply(res, parsed, { stop_reason: 'end_turn', content: [text(JSON.stringify({
        note: 'This looks like the October newsletter.',
        events: [
          { date: '2026-10-16', end: '2026-10-16', title: 'No school – conference day', kind: 'off' },
          { date: '2026-10-21', end: '2026-10-21', title: 'Early release 12:30', kind: 'early' },
          { date: '2026-10-30', end: '2026-10-30', title: 'Harvest parade', kind: 'event' },
          { date: '2026-02-31', end: '2026-02-31', title: 'Impossible date', kind: 'off' },
        ],
      }))] });
      const prompt = String(parsed.messages?.[0]?.content || '');
      const note = prompt.includes("PARENT'S NOTE");
      const wins = [...prompt.matchAll(/\[((?:sat|sun)@\d\d:\d\d)\]/g)].map((m) => m[1]);
      const blank = { title: '', emoji: '', cat: '', minAge: 0, maxAge: 0, mins: 0, setting: '', energy: '', mess: 0, materials: [], steps: [], skills: [], tip: '' };
      const answer = {
        message: note ? 'A gentle weekend that works around your plans.' : 'A weekend with one big outing and plenty of cosy time.',
        picks: [
          { windowId: wins[0], activityId: 'scavenger', why: 'Popular with 3 families near you and perfect for the park.', placeName: 'Pioneer Square Playground', custom: blank },
          { windowId: 'mon@09:00', activityId: 'volcano', why: 'Bad window, must be dropped.', placeName: '', custom: blank },
          { windowId: wins[1], activityId: 'not-a-real-id', why: 'Hallucinated id, must be dropped.', placeName: 'Made-up Park', custom: blank },
          { windowId: wins[1], activityId: '', why: 'A one-handed idea for little hands.', placeName: '', custom: { title: 'Dinosaur dig in a tray', emoji: '🦕', cat: 'sensory', minAge: 3, maxAge: 7, mins: 30, setting: 'home', energy: 'calm', mess: 1, materials: ['Tray', 'Sand or oats', 'Toy dinosaurs', 'Paintbrush'], steps: ['Bury toy dinosaurs in a tray of sand or oats.', 'Use a paintbrush to gently "excavate" them.', 'Name each dinosaur and line them up by size.'], skills: ['Fine motor', 'Patience'], tip: 'Watch little ones with small toys if under 3.' } },
        ].filter((p) => p.windowId),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_mock', type: 'message', role: 'assistant', model: parsed.model,
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        stop_reason: 'end_turn', stop_details: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ requests, close: () => server.close() })));
}
