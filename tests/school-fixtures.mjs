// Stand-ins for the outside world the school finder talks to, so tests run
// offline: an OpenStreetMap (Overpass) endpoint and two school websites.
//  - "Grand Ridge" links a calendar page that offers an iCal feed.
//  - "Synergy" has a website with no calendar feed (so the AI search is used).
import http from 'node:http';

export const GR_ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261009', 'DTEND;VALUE=DATE:20261010', 'SUMMARY:No School - Professional Learning Day', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261021', 'SUMMARY:Early Release - all elementary', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261106', 'SUMMARY:No school for kindergarten - conferences', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261111', 'SUMMARY:Veterans Day - No School', 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');

export function startSchoolSites(port = 9922) {
  const hits = [];
  const base = `http://127.0.0.1:${port}`;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits.push({ url: req.url, method: req.method, body });
      const html = (h) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(h); };
      if (req.url.startsWith('/overpass')) {
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        const q = decodeURIComponent(body.replace(/\+/g, ' '));
        const elements = [];
        if (/g \?r \?a \?n \?d/.test(q)) elements.push(
          { type: 'way', id: 2, center: { lat: 47.55, lon: -122.02 }, tags: { name: 'Grand Ridge Elementary School', amenity: 'school', website: `${base}/gr/`, operator: 'Issaquah School District', 'addr:city': 'Issaquah' } },
          { type: 'node', id: 1, lat: 47.54, lon: -122.03, tags: { name: 'Grand Ridge Plaza Daycare', amenity: 'childcare' } },
        );
        if (/s \?y \?n \?e \?r \?g \?y/.test(q)) elements.push({ type: 'node', id: 3, lat: 47.54, lon: -122.05, tags: { name: 'Synergy Learning Academy', amenity: 'kindergarten', website: `${base}/syn/`, 'addr:city': 'Issaquah' } });
        return res.end(JSON.stringify({ elements }));
      }
      if (req.url === '/gr/') return html('<html><body><a href="/gr/news">News</a><a href="/gr/our-school/calendar">School calendar</a></body></html>');
      if (req.url === '/gr/our-school/calendar') return html('<html><body><h1>Calendar</h1><a href="/gr/calendar.ics">Subscribe (iCal)</a></body></html>');
      if (req.url === '/gr/calendar.ics') { res.writeHead(200, { 'content-type': 'text/calendar' }); return res.end(GR_ICS); }
      if (req.url === '/syn/') return html('<html><body><h1>Synergy Learning Academy</h1><a href="/syn/enroll">Enroll</a></body></html>');
      res.writeHead(404);
      res.end('not found');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ hits, base, close: () => server.close() })));
}
