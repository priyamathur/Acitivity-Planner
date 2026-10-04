// Minimal stand-in for the Claude Messages API, used by the integration tests.
// It records each request and replies with a fixed structured-output answer.
import http from 'node:http';

export function startMockAnthropic(port = 9911) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      const question = JSON.stringify(parsed.messages || '').includes("PARENT'S QUESTION");
      const answer = {
        message: question ? 'Here are some gentle ideas for a quiet day.' : 'Three ideas that fit your afternoon.',
        picks: [
          { activityId: 'scavenger', why: 'Popular with 3 families near you and perfect for the park.', placeName: 'Pioneer Square Playground', custom: { title: '', emoji: '', cat: '', minAge: 0, maxAge: 0, mins: 0, setting: '', energy: '', mess: 0, materials: [], steps: [], skills: [], tip: '' } },
          { activityId: 'not-a-real-id', why: 'Hallucinated id — must be dropped.', placeName: 'Made-up Park', custom: { title: '', emoji: '', cat: '', minAge: 0, maxAge: 0, mins: 0, setting: '', energy: '', mess: 0, materials: [], steps: [], skills: [], tip: '' } },
          { activityId: '', why: 'A one-handed idea for little hands.', placeName: '', custom: { title: 'Dinosaur dig in a tray', emoji: '🦕', cat: 'sensory', minAge: 3, maxAge: 7, mins: 30, setting: 'home', energy: 'calm', mess: 1, materials: ['Tray', 'Sand or oats', 'Toy dinosaurs', 'Paintbrush'], steps: ['Bury toy dinosaurs in a tray of sand or oats.', 'Use a paintbrush to gently "excavate" them.', 'Name each dinosaur and line them up by size.'], skills: ['Fine motor', 'Patience'], tip: 'Watch little ones with small toys if under 3.' } },
        ],
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
